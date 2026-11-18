"""Use case 2: workforce SSO and identity access, against the real local Keycloak.

Two different situations the agents must tell apart:
  identity-access incident   one account is disabled by an administrator (dana.whitfield). Keycloak itself refuses
                             the sign-in ("Account is disabled") and records LOGIN_ERROR error=user_disabled.
  SSO disruption             many users fail at once. In the lab the cause is a real configuration change: the
                             routeops-mobile client stops allowing handheld sign-in, so every technician's handheld
                             gets LOGIN_ERROR. Or Keycloak itself is down (the blackbox probe of Keycloak fails).

Handheld sign-in traffic: tom.becker, aisha.khan and raj.mehta sign in to routeops-mobile every few seconds
(real Keycloak sign-ins through the token endpoint, labelled as generated traffic in the UI).
All reads and changes use the realm's service user (KEYCLOAK_SERVICE_USER), never the master admin.
"""

import os
import threading
import time
from collections import Counter, deque

import httpx

from . import config, store

PERSONAS = {
    "dana.whitfield": {"label": "Employee A", "name": "Dana Whitfield", "title": "Field Service Technician", "facility": "CC-CHICAGO-NORTH"},
    "jordan.patel": {"label": "Employee B", "name": "Jordan Patel", "title": "IT Operations Engineer (on-call)", "facility": "IT Operations"},
    "alex.romero": {"label": "Branch manager", "name": "Alex Romero", "title": "Branch Manager", "facility": "CC-CHICAGO-NORTH"},
    "marcus.reed": {"label": "Employee", "name": "Marcus Reed", "title": "Field Service Representative", "facility": "Indianapolis, IN branch"},
    "john.taylor": {"label": "IT Administrator", "name": "Jordan Patel", "title": "IT Administrator", "facility": "Corporate Operations"},
    "mark.wood": {"label": "IT Admin", "name": "Mark Wood", "title": "IT Administrator", "facility": "IT Operations"},
}
FIELD_TECHS = ["tom.becker", "aisha.khan", "raj.mehta"]
HANDHELD_CLIENT = "routeops-mobile"
CONSOLE_CLIENT = config.OIDC_CLIENT_ID
REASONS = {"user_disabled": "Account disabled by an administrator", "user_temporarily_disabled": "Account locked (too many failures)",
           "invalid_user_credentials": "Wrong password", "user_not_found": "Unknown user", "not_allowed": "Sign-in method not allowed for this app",
           "invalid_client": "App not recognised", "unauthorized_client": "App not allowed to sign users in", "client_disabled": "App disabled"}

_tok = {"v": "", "exp": 0.0}
_tok_lock = threading.Lock()
_events: deque = deque(maxlen=4000)
_seen: set = set()
_counts: Counter = Counter()
_poll = {"last_ok": 0.0, "error": ""}
_tickets: dict = {}
_traffic = {"on": os.getenv("CC_SSO_TRAFFIC", "on").lower() != "off", "i": 0}
_app_log: deque = deque(maxlen=600)  # the handheld app's own sign-in log: (ts, user, ok, error)
_NOISE_CLIENTS = {"admin-cli"}       # the hub's own service sign-ins


def _base() -> str:
    return f"{config.KEYCLOAK_URL}/admin/realms/{config.KEYCLOAK_REALM}"


def _bearer() -> str:
    with _tok_lock:
        if not _tok["v"] or time.time() > _tok["exp"]:
            r = httpx.post(f"{config.KEYCLOAK_URL}/realms/{config.KEYCLOAK_REALM}/protocol/openid-connect/token", timeout=8,
                           data={"grant_type": "password", "client_id": "admin-cli", "username": os.getenv("KEYCLOAK_SERVICE_USER", ""),
                                 "password": os.getenv("KEYCLOAK_SERVICE_PASSWORD", "")})
            r.raise_for_status()
            j = r.json()
            _tok.update(v=j["access_token"], exp=time.time() + int(j.get("expires_in", 60)) - 15)
        return _tok["v"]


def _req(method: str, path: str, **kw):
    r = httpx.request(method, f"{_base()}{path}", headers={"Authorization": f"Bearer {_bearer()}"}, timeout=8, **kw)
    r.raise_for_status()
    return r.json() if r.content else None


def _user(username: str) -> dict:
    rows = _req("GET", "/users", params={"username": username, "exact": "true"}) or []
    if not rows:
        raise ValueError(f"Keycloak user '{username}' not found")
    return rows[0]


def account(username: str) -> dict:
    """Account state exactly as Keycloak reports it."""
    u = _user(username)
    bf = _req("GET", f"/attack-detection/brute-force/users/{u['id']}") or {}
    roles = [r["name"] for r in (_req("GET", f"/users/{u['id']}/role-mappings/realm") or []) if r["name"].startswith("ops-")]
    status = "DISABLED" if not u.get("enabled", True) else ("LOCKED" if bf.get("disabled") else "ACTIVE")
    return {"username": username, "enabled": u.get("enabled", True), "brute_force_locked": bool(bf.get("disabled")),
            "failures": int(bf.get("numFailures", 0)), "status": status, "roles": roles, "id": u["id"]}


def personas() -> list[dict]:
    out = []
    for username, meta in PERSONAS.items():
        try:
            out.append({**meta, **account(username)})
        except (httpx.HTTPError, ValueError) as exc:
            out.append({**meta, "username": username, "status": "UNKNOWN", "error": type(exc).__name__})
    return out


# ------------------------------------------------------------------- event polling

def _fetch_events(minutes: float = 60) -> list[dict]:
    since = int((time.time() - minutes * 60) * 1000)
    rows = _req("GET", "/events", params={"max": 500, "type": ["LOGIN", "LOGIN_ERROR", "LOGOUT", "CODE_TO_TOKEN", "CODE_TO_TOKEN_ERROR"]}) or []
    out = []
    for e in rows:
        if int(e.get("time", 0)) < since:
            continue
        d = e.get("details") or {}
        out.append({"id": e.get("id") or f"{e.get('time')}-{e.get('userId')}-{e.get('type')}", "ts": int(e["time"]) / 1000,
                    "type": e["type"], "client": e.get("clientId"), "user_id": e.get("userId"), "username": d.get("username") or "",
                    "ip": e.get("ipAddress"), "error": e.get("error") or "", "reason": REASONS.get(e.get("error") or "", e.get("error") or ""),
                    "session": e.get("sessionId")})
    return out


def _poll_loop() -> None:
    while True:
        try:
            for e in sorted(_fetch_events(30), key=lambda x: x["ts"]):
                if e["id"] in _seen:
                    continue
                _seen.add(e["id"])
                _events.append(e)
                if e["type"] in ("LOGIN", "LOGIN_ERROR"):
                    _counts[(e["client"] or "?", "success" if e["type"] == "LOGIN" else "failure", e["error"] or "")] += 1
            _poll.update(last_ok=time.time(), error="")
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            _poll["error"] = type(exc).__name__
        time.sleep(4)


def recent(minutes: float | None = None, client: str | None = None) -> list[dict]:
    cut = time.time() - (minutes or config.AUTH_WINDOW_MIN) * 60
    rows = [e for e in _events if e["ts"] >= cut and (client is None or e["client"] == client)]
    return sorted(rows, key=lambda e: e["ts"], reverse=True)


def window_stats(minutes: float | None = None) -> dict:
    rows = [e for e in recent(minutes) if e["type"] in ("LOGIN", "LOGIN_ERROR") and e["client"] not in _NOISE_CLIENTS]
    fails = [e for e in rows if e["type"] == "LOGIN_ERROR"]
    by_user = Counter(e["username"] or e["user_id"] or "?" for e in fails)
    by_reason = Counter(e["error"] for e in fails)
    by_client = Counter(e["client"] for e in fails)
    cut = time.time() - (minutes or config.AUTH_WINDOW_MIN) * 60
    app = [a for a in _app_log if a["ts"] >= cut]
    app_fail_users = sorted({a["user"] for a in app if not a["ok"]})
    app_ok_users = sorted({a["user"] for a in app if a["ok"]})
    return {"window_min": minutes or config.AUTH_WINDOW_MIN, "attempts": len(rows), "failures": len(fails),
            "handheld_app": {"attempts": len(app), "failures": sum(1 for a in app if not a["ok"]),
                             "users_failing": app_fail_users, "users_ok": app_ok_users,
                             "errors": dict(Counter(a["error"] for a in app if not a["ok"]))},
            "failure_rate_pct": round(len(fails) / len(rows) * 100, 1) if rows else 0.0,
            "users_failing": len(by_user), "by_user": dict(by_user.most_common(10)), "by_reason": dict(by_reason),
            "by_client": dict(by_client)}


def metrics_lines() -> list[str]:
    out = ["# HELP cc_keycloak_logins_total Keycloak sign-ins seen in the realm's event log.", "# TYPE cc_keycloak_logins_total counter"]
    for (client, result, error), n in sorted(_counts.items()):
        out.append(f'cc_keycloak_logins_total{{client="{client}",result="{result}",error="{error}"}} {n}')
    out += ["# HELP cc_keycloak_event_poll_ok 1 if the last Keycloak event read succeeded.", "# TYPE cc_keycloak_event_poll_ok gauge",
            f"cc_keycloak_event_poll_ok {int(time.time() - _poll['last_ok'] < 20)}"]
    return out


# ------------------------------------------------------------------- sign-in attempt tickets (login screen)

def start_attempt(username: str) -> dict:
    if username not in PERSONAS:
        raise ValueError("unknown persona")
    t = f"t{int(time.time() * 1000)}{len(_tickets)}"
    _tickets[t] = {"username": username, "since": time.time() - 2}
    for k in [k for k, v in _tickets.items() if time.time() - v["since"] > 900]:
        _tickets.pop(k, None)
    return {"ticket": t}


def attempt_status(ticket: str) -> dict:
    """Outcome of one sign-in attempt, read from Keycloak's event log (the same answer Keycloak showed the user)."""
    t = _tickets.get(ticket)
    if not t:
        raise ValueError("unknown or expired attempt")
    try:
        rows = _fetch_events(15)
    except httpx.HTTPError:
        return {"state": "unknown", "detail": "Keycloak event log unreachable"}
    mine = [e for e in rows if e["ts"] >= t["since"] and e["client"] == CONSOLE_CLIENT and e["type"] in ("LOGIN", "LOGIN_ERROR")
            and (e["username"] == t["username"] or _uid(t["username"]) == e["user_id"])]
    if not mine:
        return {"state": "pending", "username": t["username"]}
    e = max(mine, key=lambda x: x["ts"])
    return {"state": "success" if e["type"] == "LOGIN" else "denied", "username": t["username"], "error": e["error"], "reason": e["reason"],
            "at": e["ts"], "source": "Keycloak event log", "event_type": e["type"]}


_uids: dict = {}


def _uid(username: str) -> str:
    if username not in _uids:
        try:
            _uids[username] = _user(username)["id"]
        except (httpx.HTTPError, ValueError):
            return ""
    return _uids[username]


# ------------------------------------------------------------------- demo controls and approved fixes

def disable_persona(username: str = "dana.whitfield", by: str = "Demo control") -> dict:
    """What an administrator does: set the account to disabled (a real Keycloak admin change, audited)."""
    u = _user(username)
    _req("PUT", f"/users/{u['id']}", json={"enabled": False})
    store.log_event("identity", "Keycloak", f"{username} disabled by an administrator", {"username": username, "by": by})
    return account(username)


def enable_user(username: str, approved_by: str) -> dict:
    u = _user(username)
    _req("PUT", f"/users/{u['id']}", json={"enabled": True})
    _req("DELETE", f"/attack-detection/brute-force/users/{u['id']}")
    store.log_event("remediation", "Keycloak", f"{username} re-enabled after approval by {approved_by}", {"username": username})
    return account(username)


def _client(client_id: str) -> dict:
    rows = _req("GET", "/clients", params={"clientId": client_id}) or []
    if not rows:
        raise ValueError(f"client {client_id} not found")
    return rows[0]


def handheld_client() -> dict:
    c = _client(HANDHELD_CLIENT)
    return {"client": HANDHELD_CLIENT, "enabled": c.get("enabled", True), "direct_access_grants": c.get("directAccessGrantsEnabled", False)}


def break_handheld_client() -> dict:
    """Stage an SSO disruption: a configuration change stops the RouteOps handheld app from signing users in."""
    c = _client(HANDHELD_CLIENT)
    _req("PUT", f"/clients/{c['id']}", json={**c, "directAccessGrantsEnabled": False})
    store.log_event("change", "Change record (demo)", "Keycloak client routeops-mobile updated: 'Direct access grants' turned off",
                    {"client": HANDHELD_CLIENT, "change": "CHG-DEMO-4410", "setting": "directAccessGrantsEnabled=false"})
    return handheld_client()


def restore_handheld_client(approved_by: str) -> dict:
    c = _client(HANDHELD_CLIENT)
    _req("PUT", f"/clients/{c['id']}", json={**c, "directAccessGrantsEnabled": True})
    store.log_event("remediation", "Keycloak", f"routeops-mobile sign-in setting restored after approval by {approved_by}", {})
    return handheld_client()


def test_handheld_signin(username: str = "tom.becker") -> dict:
    """A real sign-in through the handheld app, used to verify a fix."""
    r = httpx.post(f"{config.KEYCLOAK_URL}/realms/{config.KEYCLOAK_REALM}/protocol/openid-connect/token", timeout=8,
                   data={"grant_type": "password", "client_id": HANDHELD_CLIENT, "username": username,
                         "password": os.getenv("CC_DEMO_USER_PASSWORD", "")})
    j = r.json() if r.content else {}
    return {"username": username, "ok": r.status_code == 200, "http": r.status_code, "error": j.get("error", ""),
            "error_description": j.get("error_description", "")}


def _traffic_loop() -> None:
    while True:
        time.sleep(5)
        if not _traffic["on"] or not os.getenv("CC_DEMO_USER_PASSWORD"):
            continue
        user = FIELD_TECHS[_traffic["i"] % len(FIELD_TECHS)]
        _traffic["i"] += 1
        try:
            r = test_handheld_signin(user)
            _app_log.append({"ts": time.time(), "user": user, "ok": r["ok"], "error": r["error"], "detail": r["error_description"]})
        except httpx.HTTPError as exc:
            _app_log.append({"ts": time.time(), "user": user, "ok": False, "error": "idp_unreachable", "detail": type(exc).__name__})


def app_log(n: int = 30) -> list[dict]:
    return list(_app_log)[-n:][::-1]


def set_traffic(on: bool) -> dict:
    _traffic["on"] = on
    return {"on": on}


def traffic_on() -> bool:
    return _traffic["on"]


def reset_lab() -> dict:
    """Healthy SSO lab: sign-in service running, handheld client allowed, every persona and technician active."""
    from . import sso_service
    out = {}
    if not sso_service.responding():
        out["sign_in_service"] = "started" if sso_service.start()["responding"] else "did not start"
    try:
        c = _client(HANDHELD_CLIENT)
        if not c.get("directAccessGrantsEnabled"):
            _req("PUT", f"/clients/{c['id']}", json={**c, "directAccessGrantsEnabled": True})
        for u in FIELD_TECHS + list(PERSONAS):
            uid = _user(u)["id"]
            _req("DELETE", f"/attack-detection/brute-force/users/{uid}")
            _req("PUT", f"/users/{uid}", json={"enabled": True})
        out["accounts"] = "all active"
    except (httpx.HTTPError, ValueError) as exc:
        out["error"] = f"{type(exc).__name__}: {exc}"
    return out


def health() -> dict:
    try:
        r = httpx.get(f"{config.KEYCLOAK_URL}/realms/{config.KEYCLOAK_REALM}/.well-known/openid-configuration", timeout=4)
        r.raise_for_status()
        _bearer()
        return {"ok": True, "detail": f"realm {config.KEYCLOAK_REALM}", "events_polled": bool(time.time() - _poll["last_ok"] < 20),
                "client": CONSOLE_CLIENT}
    except httpx.HTTPError as exc:
        return {"ok": False, "detail": f"not reachable ({type(exc).__name__})"}


def init() -> None:
    threading.Thread(target=_poll_loop, daemon=True, name="kc-events").start()
    threading.Thread(target=_traffic_loop, daemon=True, name="kc-traffic").start()
