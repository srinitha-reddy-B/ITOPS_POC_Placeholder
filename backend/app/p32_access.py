"""Employee sign-in help: "I can't sign in" -> ServiceNow incident -> IT engineer approval -> access restored.

The scenario: an infrastructure problem (a network fault between the sign-in page and the identity
provider) stops an employee from signing in even though the username and password are right.

* login: checks the credentials against the real Keycloak realm. While the simulated network fault
  is active for that user, the sign-in service is "unreachable" and the credentials are not checked.
* raise_ticket: the employee's helpdesk message becomes a real ServiceNow incident (tagged to them).
* decide: only the IT engineer (X-P32-Role: engineer) can approve. Approval clears the fault,
  makes sure the Keycloak account is enabled and unlocked, and resolves the incident with work notes
  and a plain-language comment. Declining leaves the incident open for the service desk.

Keycloak settings come from backend/.env (KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_ADMIN_PASSWORD,
CC_PERSONA_PASSWORD). The employee's Keycloak user is created on first use if it is missing.
"""

import contextlib
import json
import secrets
import os
import threading
import time
from pathlib import Path

import httpx

from . import itops_servicenow as snow
from . import platform_connect as pc

EMPLOYEE = {"username": "maya.thompson", "first": "Maya", "last": "Thompson", "email": "maya.thompson@example.com"}
# Portal accounts (Keycloak users created on first use, password CC_PERSONA_PASSWORD) and the /p32 persona each opens.
ACCOUNTS = {
    "maya.thompson": {"first": "Maya", "last": "Thompson", "persona": "employee", "landing": "#/"},
    "jordan.patel": {"first": "Jordan", "last": "Patel", "persona": "it_admin", "landing": "/crystal-clean/ops/"},
    "arya.hajarha": {"first": "Arya", "last": "Hajarha", "persona": "engineer", "landing": "#/workbench"},
}
CLIENT_ID = "routeops-mobile"  # public client in the realm with direct (username + password) grants enabled
APPROVER_ROLE = "engineer"  # the IT engineer approves sign-in access requests
_STATE_FILE = Path(__file__).parent.parent / ".p32_access_state.json"
_lock = threading.Lock()
_TIMEOUT = 10

NETWORK_MESSAGE = ("The identity provider didn't respond in time. This is a network problem on our side, not your password.")


def _net_detail() -> dict:
    """What a real failed Keycloak token request looks like (gateway timeout before credentials are checked)."""
    realm = os.environ.get("KEYCLOAK_REALM", "crystal-clean")
    return {"status": 504, "title": "Gateway Timeout", "endpoint": f"POST /realms/{realm}/protocol/openid-connect/token",
            "reason": "upstream connect timeout after 10 s (identity provider not reachable from the sign-in gateway)",
            "error_id": "KC-" + secrets.token_hex(3).upper(), "at": time.strftime("%H:%M:%S")}


class AccessError(Exception):
    pass


def _cfg() -> dict:
    c = {k: os.environ.get(k, "") for k in ("KEYCLOAK_URL", "KEYCLOAK_REALM", "KEYCLOAK_ADMIN_PASSWORD", "CC_PERSONA_PASSWORD", "CC_DEMO_USER_PASSWORD")}
    if not (c["KEYCLOAK_URL"] and c["KEYCLOAK_REALM"]):
        raise AccessError("Keycloak is not configured (KEYCLOAK_URL / KEYCLOAK_REALM in backend/.env).")
    return c


# ------------------------------------------------------------------ state

def _load() -> dict:
    try:
        return json.loads(_STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"outage": {EMPLOYEE["username"]: True}, "requests": [], "seq": 1}


def _save(s: dict) -> None:
    try:
        _STATE_FILE.write_text(json.dumps(s, indent=1), encoding="utf-8")
    except Exception:
        pass


# --------------------------------------------------------------- keycloak

def _admin(c: dict) -> tuple[httpx.Client, str]:
    if not c["KEYCLOAK_ADMIN_PASSWORD"]:
        raise AccessError("KEYCLOAK_ADMIN_PASSWORD is not set in backend/.env.")
    cl = httpx.Client(timeout=_TIMEOUT)
    r = cl.post(f"{c['KEYCLOAK_URL']}/realms/master/protocol/openid-connect/token",
                data={"grant_type": "password", "client_id": "admin-cli", "username": "admin", "password": c["KEYCLOAK_ADMIN_PASSWORD"]})
    r.raise_for_status()
    cl.headers["Authorization"] = "Bearer " + r.json()["access_token"]
    return cl, f"{c['KEYCLOAK_URL']}/admin/realms/{c['KEYCLOAK_REALM']}"


def ensure_user(username: str = EMPLOYEE["username"]) -> dict:
    """Make sure the employee exists in Keycloak, is enabled and has the demo password; clear any lockout."""
    c = _cfg()
    cl, base = _admin(c)
    with contextlib.closing(cl):
        found = cl.get(f"{base}/users", params={"username": username, "exact": "true"}).json()
        if not found:
            acct = ACCOUNTS.get(username)
            if not acct:
                raise AccessError(f"No Keycloak user '{username}'.")
            cl.post(f"{base}/users", json={"username": username, "firstName": acct["first"], "lastName": acct["last"],
                                           "email": f"{username}@example.com", "enabled": True, "emailVerified": True}).raise_for_status()
            found = cl.get(f"{base}/users", params={"username": username, "exact": "true"}).json()
        u = found[0]
        # Portal accounts are app personas (like jordan.patel), so they use CC_PERSONA_PASSWORD from backend/.env.
        pw = c["CC_PERSONA_PASSWORD"] or c["CC_DEMO_USER_PASSWORD"]
        if username in ACCOUNTS and pw:
            cl.put(f"{base}/users/{u['id']}/reset-password", json={"type": "password", "value": pw, "temporary": False}).raise_for_status()
        if not u.get("enabled"):
            cl.put(f"{base}/users/{u['id']}", json={**u, "enabled": True}).raise_for_status()
        cl.delete(f"{base}/attack-detection/brute-force/users/{u['id']}")
        return {"id": u["id"], "username": username, "name": f"{u.get('firstName', '')} {u.get('lastName', '')}".strip()}


# -------------------------------------------------------------------- ops

def status(p: dict) -> dict:
    s = _load()
    user = EMPLOYEE["username"]
    mine = [r for r in s["requests"] if r["username"] == user and not r.get("consumed")]
    return {"username": user, "employee": f"{EMPLOYEE['first']} {EMPLOYEE['last']}", "outage": bool(s["outage"].get(user)),
            "request": mine[-1] if mine else None}


def login(p: dict) -> dict:
    username = "." .join(str(p.get("username", "")).strip().lower().split())  # "Arya Hajarha" -> arya.hajarha
    password = str(p.get("password", ""))
    if not username or not password:
        raise ValueError("Enter your username and password.")
    s = _load()
    if s["outage"].get(username):
        # The sign-in service can't be reached, so nothing is checked: a correct password fails the same way.
        time.sleep(3.5)  # a real request hangs until the gateway gives up
        return {"signed_in": False, "kind": "network", "error": NETWORK_MESSAGE, "detail": _net_detail()}
    c = _cfg()
    try:
        ensure_user(username) if username in ACCOUNTS else None
        r = httpx.post(f"{c['KEYCLOAK_URL']}/realms/{c['KEYCLOAK_REALM']}/protocol/openid-connect/token",
                       data={"grant_type": "password", "client_id": CLIENT_ID, "username": username, "password": password}, timeout=_TIMEOUT)
    except (httpx.HTTPError, AccessError):
        return {"signed_in": False, "kind": "network", "error": NETWORK_MESSAGE, "detail": _net_detail()}
    if r.status_code == 200:
        a = ACCOUNTS.get(username)
        if username == EMPLOYEE["username"]:
            # Demo: once the restored access has been used, the network fault comes back for the next run.
            with _lock:
                s = _load()
                s["outage"][username] = True
                for q in s["requests"]:
                    if q["username"] == username and q["status"] == "approved":
                        q["consumed"] = True
                _save(s)
        return {"signed_in": True, "username": username, "name": f"{a['first']} {a['last']}" if a else username,
                "persona": a["persona"] if a else None, "landing": a["landing"] if a else "#/"}
    return {"signed_in": False, "kind": "credentials", "error": "That username or password isn't right."}


def raise_ticket(p: dict) -> dict:
    text = str(p.get("text", "")).strip()[:600]
    if len(text) < 6:
        raise ValueError("Tell us briefly what is happening.")
    user = EMPLOYEE["username"]
    with _lock:
        s = _load()
        open_req = next((r for r in s["requests"] if r["username"] == user and r["status"] == "pending_approval"), None)
        if open_req:
            return {"request": open_req, "existing": True}
    err_id = str(p.get("error_id", "")).strip()[:20] or "KC-" + secrets.token_hex(3).upper()
    realm = os.environ.get("KEYCLOAK_REALM", "crystal-clean")
    inc = snow.create_incident(
        {
            "short_description": "Employee cannot sign in: Keycloak SSO unreachable (504 gateway timeout)",
            "description": (f"Employee {EMPLOYEE['first']} {EMPLOYEE['last']} ({user}) cannot sign in although the username and password are correct.\n"
                            f"Employee's words: {text}\n\n"
                            f"Diagnostics captured at sign-in: identity provider Keycloak, realm {realm}, client {CLIENT_ID}.\n"
                            f"POST /realms/{realm}/protocol/openid-connect/token returned 504 Gateway Timeout (upstream connect timeout after 10 s). "
                            f"Error ID {err_id}. The credentials were never checked."),
            "category": "network", "urgency": "2", "impact": "2", "caller_is_me": True,
        },
        extra={"correlation_id": f"P32-ACCESS:{user}", "correlation_display": "Crystal Clean sign-in help"},
    )
    snow.work_note({"sys_id": inc["sys_id"], "text": (
        f"[P32 sign-in help] Diagnostic (error {err_id}): the sign-in gateway cannot reach the identity provider (Keycloak, realm {realm}) from the employee's network. "
        "The account itself is not known to be locked or disabled. Routed to IT Engineering for investigation.")})
    with _lock:
        s = _load()
        req = {"id": f"AR{s['seq']:04d}", "username": user, "employee": f"{EMPLOYEE['first']} {EMPLOYEE['last']}", "message": text,
               "incident": inc["number"], "incident_sys_id": inc["sys_id"], "url": inc["url"], "status": "pending_approval",
               "error_id": err_id, "priority": "2 - High", "assigned_to": "IT Engineering",
               "created": time.strftime("%Y-%m-%d %H:%M:%S"), "decided": None, "decided_by": None}
        s["seq"] += 1
        s["requests"].append(req)
        _save(s)
    return {"request": req, "existing": False}


def list_requests(p: dict) -> dict:
    return {"requests": list(reversed(_load()["requests"]))}


def decide(p: dict, role: str | None) -> dict:
    if role != APPROVER_ROLE:
        raise PermissionError("Only the IT engineer can approve or decline sign-in access requests.")
    decision = p.get("decision")
    if decision not in ("approve", "decline"):
        raise ValueError("decision must be approve or decline")
    with _lock:
        s = _load()
        req = next((r for r in s["requests"] if r["id"] == p.get("id")), None)
        if not req:
            raise ValueError("unknown request")
        if req["status"] != "pending_approval":
            raise ValueError(f"already {req['status']}")
    note = str(p.get("note", "")).strip()[:500]
    if decision == "approve":
        acct = ensure_user(req["username"])
        with _lock:
            s = _load()
            s["outage"][req["username"]] = False
            _save(s)
        snow.work_note({"sys_id": req["incident_sys_id"], "text": (
            f"[P32 sign-in help] IT engineer approved restoring sign-in access. Keycloak account '{acct['username']}' verified enabled and unlocked; "
            f"the network fault flag for the account was cleared.{(' Manager note: ' + note) if note else ''}")})
        snow.comment({"sys_id": req["incident_sys_id"], "text": "Your sign-in access has been restored. Please try signing in again."})
        snow.resolve({"sys_id": req["incident_sys_id"], "close_notes": "Sign-in service reachability restored and account verified; approved by the IT engineer."})
        new_status = "approved"
    else:
        snow.work_note({"sys_id": req["incident_sys_id"], "text": f"[P32 sign-in help] IT engineer declined the access request.{(' Reason: ' + note) if note else ''} Left open for the service desk."})
        snow.comment({"sys_id": req["incident_sys_id"], "text": "Your sign-in request needs a closer look. The service desk will contact you."})
        new_status = "declined"
    with _lock:
        s = _load()
        for r in s["requests"]:
            if r["id"] == req["id"]:
                r.update(status=new_status, decided=time.strftime("%Y-%m-%d %H:%M:%S"), decided_by="IT Engineer (Arya Hajarha)")
                req = r
        _save(s)
    return {"request": req}


def simulate_outage(p: dict) -> dict:
    """Demo control: bring the network fault back for the employee (and close nothing in ServiceNow)."""
    with _lock:
        s = _load()
        s["outage"][EMPLOYEE["username"]] = True
        _save(s)
    return status({})


def reset_demo(p: dict) -> dict:
    """Demo control: back to the starting state (network fault on, no sign-in requests). ServiceNow tickets are kept."""
    with _lock:
        seq = _load().get("seq", 1)  # keep request ids unique across resets
        _save({"outage": {EMPLOYEE["username"]: True}, "requests": [], "seq": seq})
    return status({})


OPS = {"status": status, "login": login, "raise_ticket": raise_ticket, "list_requests": list_requests, "simulate_outage": simulate_outage, "reset_demo": reset_demo}


def run(op: str, payload: dict, role: str | None = None) -> dict:
    try:
        if op == "decide":
            return {"ok": True, **decide(payload, role)}
        fn = OPS.get(op)
        if fn is None:
            return {"ok": False, "error": f"unknown op '{op}'"}
        return {"ok": True, **fn(payload)}
    except PermissionError as exc:
        return {"ok": False, "error": str(exc), "forbidden": True}
    except snow.NotConfigured as exc:
        return {"ok": False, "error": str(exc), "not_configured": True}
    except AccessError as exc:
        return {"ok": False, "error": str(exc)}
    except pc.BadResponse as exc:
        return {"ok": False, "error": str(exc)}
    except httpx.HTTPStatusError as exc:
        return {"ok": False, "error": f"HTTP {exc.response.status_code} from {exc.request.url.host}"}
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
