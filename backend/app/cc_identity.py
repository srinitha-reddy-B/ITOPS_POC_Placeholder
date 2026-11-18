"""Crystal Clean Workforce Identity & SSO demo.

Two demo personas sign in on the real Keycloak login page with OIDC authorization code + PKCE through a
confidential client. The backend exchanges the code, validates the ID token (signature from the realm's
JWKS, issuer, audience, expiry, nonce) and keeps every token server-side; the browser only holds an opaque
HttpOnly session cookie. Protected calls are re-checked with Keycloak token introspection, so a session
whose user is disabled or logged out stops working at once.

A disabled account never reaches the callback: Keycloak refuses it on its own login page. The hub learns
the outcome, and the reason, from the LOGIN_ERROR event Keycloak records for that attempt.

Configured by scripts/setup_identity_demo.py; settings come from backend/.env.
"""

import base64
import hashlib
import os
import secrets
import threading
import time
from collections import deque
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
import jwt

PERSONAS = {"alex": "alex.morgan", "sarah": "sarah.johnson"}
REQUIRED_ROLE = "employee"
COOKIE = "cc_sso"
ATTEMPT_TTL_S = 600
SESSION_TTL_S = 8 * 3600
INTROSPECT_CACHE_S = 5
REASONS = {
    "user_disabled": "User account is disabled.",
    "user_temporarily_disabled": "Account is temporarily locked by brute-force protection.",
    "invalid_user_credentials": "Invalid username or password.",
    "user_not_found": "No such user in the realm.",
}
FINAL_ERRORS = {"user_disabled", "user_temporarily_disabled"}  # Keycloak won't accept these on retry


class NotSignedIn(Exception):
    """401: no valid session or token."""


class AccessDenied(Exception):
    """403: authenticated, but not allowed."""


class NotConfigured(Exception):
    """503: the demo client is not set up."""


_LOCK = threading.RLock()
_ATTEMPTS: dict[str, dict] = {}
_BY_STATE: dict[str, str] = {}
_SESSIONS: dict[str, dict] = {}
_TIMELINE: deque = deque(maxlen=60)
_STATS = {"success": 0, "failed": 0, "since": None}
_ADMIN = {"token": "", "exp": 0.0}
_INTROSPECT: dict[str, tuple[float, dict]] = {}
_JWKS: dict[str, jwt.PyJWKClient] = {}
_HTTP = httpx.Client(timeout=10)  # one pooled client: a fresh connection to Keycloak costs ~0.4 s on Windows


# ---------------------------------------------------------------- config
def _cfg() -> dict:
    internal = (os.getenv("KEYCLOAK_URL") or "http://127.0.0.1:8080").strip().rstrip("/")
    return {
        "internal": internal,
        "public": (os.getenv("CC_KEYCLOAK_PUBLIC_URL") or internal).strip().rstrip("/"),
        "realm": (os.getenv("KEYCLOAK_REALM") or "crystal-clean").strip(),
        "client_id": (os.getenv("KEYCLOAK_CLIENT_ID") or "crystal-clean-hub").strip(),
        "secret": (os.getenv("KEYCLOAK_CLIENT_SECRET") or "").strip(),
        "svc_user": (os.getenv("KEYCLOAK_SERVICE_USER") or "").strip(),
        "svc_password": (os.getenv("KEYCLOAK_SERVICE_PASSWORD") or "").strip(),
    }


def app_origin(forwarded_proto: str | None, forwarded_host: str | None) -> str:
    """The app origin the browser used, if it's one the Keycloak client allows; never an arbitrary host."""
    allowed = [o.strip().rstrip("/") for o in (os.getenv("CC_APP_ORIGINS") or "http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip()]
    seen = f"{(forwarded_proto or 'http').split(',')[0].strip()}://{(forwarded_host or '').split(',')[0].strip()}"
    return seen if seen in allowed else allowed[0]


def _oidc(path: str = "") -> str:
    c = _cfg()
    return f"{c['internal']}/realms/{c['realm']}/protocol/openid-connect{path}"


def _as_public() -> dict:
    """Keycloak stamps tokens with the hostname the browser signed in on and refuses them on any other one
    (refresh, introspection, logout). Calls go to the fast internal address but present that hostname."""
    c = _cfg()
    pub, internal = c["public"].split("://", 1)[-1], c["internal"].split("://", 1)[-1]
    return {"Host": pub} if pub != internal else {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ms_iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat(timespec="seconds")


def _event(text: str, source: str, kind: str = "info", attempt: str | None = None, at: str | None = None) -> None:
    with _LOCK:
        _TIMELINE.append({"at": at or _now_iso(), "text": text, "source": source, "kind": kind, "attempt": attempt})


# ------------------------------------------------------------- Keycloak
def _admin(method: str, path: str, **kw):
    c = _cfg()
    if not c["svc_user"] or not c["svc_password"]:
        raise NotConfigured("KEYCLOAK_SERVICE_USER / KEYCLOAK_SERVICE_PASSWORD are not set: run scripts/setup_keycloak.py.")
    if time.time() > _ADMIN["exp"]:
        r = _HTTP.post(_oidc("/token"), timeout=10, data={"grant_type": "password", "client_id": "admin-cli",
                                                          "username": c["svc_user"], "password": c["svc_password"]})
        r.raise_for_status()
        j = r.json()
        _ADMIN.update(token=j["access_token"], exp=time.time() + int(j.get("expires_in", 60)) - 15)
    r = _HTTP.request(method, f"{c['internal']}/admin/realms/{c['realm']}{path}", headers={"Authorization": f"Bearer {_ADMIN['token']}"}, timeout=10, **kw)
    r.raise_for_status()
    return r.json() if r.content else None


def _user(username: str) -> dict | None:
    rows = _admin("GET", "/users", params={"username": username, "exact": "true"}) or []
    return rows[0] if rows else None


def persona(key: str) -> dict:
    """What Keycloak itself says about a persona: verified account information, nothing assumed."""
    username = PERSONAS[key]
    u = _user(username)
    if not u:
        return {"key": key, "username": username, "exists": False}
    roles = [r["name"] for r in (_admin("GET", f"/users/{u['id']}/role-mappings/realm") or [])]
    attrs = u.get("attributes") or {}
    first, last = u.get("firstName") or "", u.get("lastName") or ""
    return {"key": key, "username": username, "exists": True, "user_id": u["id"], "name": f"{first} {last}".strip() or username,
            "initials": (first[:1] + last[:1]).upper() or username[:2].upper(), "employee_id": (attrs.get("employee_id") or [""])[0],
            "department": (attrs.get("department") or [""])[0], "enabled": bool(u.get("enabled")),
            "role": "Employee" if REQUIRED_ROLE in roles else None}


def _issuers() -> set[str]:
    c = _cfg()
    return {f"{c['public']}/realms/{c['realm']}", f"{c['internal']}/realms/{c['realm']}"}


def _verify(token: str, *, audience: str | None = None, nonce: str | None = None) -> dict:
    url = _oidc("/certs")
    if url not in _JWKS:
        _JWKS[url] = jwt.PyJWKClient(url, cache_keys=True, lifespan=300)
    try:
        key = _JWKS[url].get_signing_key_from_jwt(token).key
        claims = jwt.decode(token, key, algorithms=["RS256"], audience=audience, leeway=30,
                            options={"verify_aud": audience is not None, "require": ["exp", "iat", "iss", "sub"]})
    except jwt.PyJWTError as exc:
        raise NotSignedIn(f"Token rejected: {exc}") from exc
    if claims["iss"] not in _issuers():
        raise NotSignedIn("Token was not issued by this realm.")
    if nonce is not None and claims.get("nonce") != nonce:
        raise NotSignedIn("Token nonce does not match this sign-in attempt.")
    return claims


def _verify_access(token: str) -> dict:
    claims = _verify(token)
    aud = claims.get("aud")
    if claims.get("azp") != _cfg()["client_id"] or _cfg()["client_id"] not in (aud if isinstance(aud, list) else [aud]):
        raise NotSignedIn("Token was issued to a different application.")
    return claims


def _introspect(token: str) -> dict:
    hit = _INTROSPECT.get(token)
    if hit and time.time() - hit[0] < INTROSPECT_CACHE_S:
        return hit[1]
    c = _cfg()
    r = _HTTP.post(_oidc("/token/introspect"), timeout=10, headers=_as_public(), data={"token": token, "client_id": c["client_id"], "client_secret": c["secret"]})
    r.raise_for_status()
    j = r.json()
    _INTROSPECT[token] = (time.time(), j)
    return j


# ----------------------------------------------------------------- login
def start_login(key: str, origin: str) -> dict:
    if key not in PERSONAS:
        raise ValueError("Unknown persona.")
    c = _cfg()
    if not c["secret"]:
        raise NotConfigured("KEYCLOAK_CLIENT_SECRET is not set: run scripts/setup_identity_demo.py, then restart the backend.")
    p = persona(key)
    if not p["exists"]:
        raise NotConfigured(f"Keycloak has no user '{p['username']}': run scripts/setup_identity_demo.py.")
    for other in PERSONAS.values():  # demo personas only: never touches any other account
        u = _user(other)
        if u:
            _admin("POST", f"/users/{u['id']}/logout")
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    aid, state, nonce = secrets.token_urlsafe(12), secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    redirect_uri = f"{origin}/api/cc/identity/callback"
    with _LOCK:
        _ATTEMPTS[aid] = {"id": aid, "persona": key, "username": p["username"], "user_id": p["user_id"], "name": p["name"],
                          "started_ms": int(time.time() * 1000), "state": state, "nonce": nonce, "verifier": verifier,
                          "redirect_uri": redirect_uri, "status": "pending", "result": None, "last_error": None, "seen_events": set()}
        _BY_STATE[state] = aid
    _event(f"{p['name']} initiated SSO login.", "app", attempt=aid)
    _event("Redirected to Keycloak (authorization code + PKCE, fresh sign-in required).", "app", attempt=aid)
    url = f"{c['public']}/realms/{c['realm']}/protocol/openid-connect/auth?" + urlencode({
        "client_id": c["client_id"], "response_type": "code", "scope": "openid profile", "redirect_uri": redirect_uri,
        "state": state, "nonce": nonce, "code_challenge": challenge, "code_challenge_method": "S256",
        "prompt": "login", "login_hint": p["username"]})
    return {"attempt": aid, "authorization_url": url}


def _finish(att: dict, status: str, result: dict) -> None:
    with _LOCK:
        att.update(status=status, result=result, verifier=None)
        _BY_STATE.pop(att["state"], None)
        if status in ("success", "denied"):
            _STATS["success" if status == "success" else "failed"] += 1
            _STATS["since"] = _STATS["since"] or _now_iso()


def _deny(att: dict, reason: str, *, keycloak_error: str | None, source: str, at: str | None = None) -> None:
    try:
        p = persona(att["persona"])
        account = "Enabled" if p.get("enabled") else "Disabled"
    except Exception:  # noqa: BLE001 -- show what we could verify, nothing more
        account = "Unavailable"
    _finish(att, "denied", {"employee": att["name"], "identity_provider": "Keycloak", "account_status": account,
                            "authentication": "Failed", "access": "Denied", "reason": reason, "keycloak_error": keycloak_error,
                            "source": source, "at": at or _now_iso()})
    _event(f"Keycloak rejected authentication ({keycloak_error})." if keycloak_error else f"Sign-in failed: {reason}", source, "bad", att["id"], at)
    _event("Application access denied. No session was created.", "app", "bad", att["id"])


def callback(params: dict) -> tuple[str, str | None]:
    """Handles Keycloak's redirect back. Returns (popup HTML, new session id or None)."""
    with _LOCK:
        att = _ATTEMPTS.get(_BY_STATE.get(params.get("state") or "", ""))
    if not att or att["status"] != "pending" or time.time() * 1000 - att["started_ms"] > ATTEMPT_TTL_S * 1000:
        return _popup("This sign-in attempt is no longer valid. Start again from the persona cards.", None), None
    if params.get("error"):
        _deny(att, params.get("error_description") or params["error"], keycloak_error=params["error"], source="keycloak")
        return _popup("Sign-in was not completed.", att["id"]), None
    c = _cfg()
    r = _HTTP.post(_oidc("/token"), timeout=15, headers=_as_public(), data={"grant_type": "authorization_code", "code": params.get("code", ""),
                                                      "redirect_uri": att["redirect_uri"], "client_id": c["client_id"],
                                                      "client_secret": c["secret"], "code_verifier": att["verifier"]})
    if r.status_code != 200:
        err = (r.json() if r.headers.get("content-type", "").startswith("application/json") else {}).get("error", f"HTTP {r.status_code}")
        _deny(att, f"Keycloak refused the code exchange ({err}).", keycloak_error=err, source="keycloak")
        return _popup("Sign-in failed.", att["id"]), None
    tok = r.json()
    try:
        idc = _verify(tok["id_token"], audience=c["client_id"], nonce=att["nonce"])
        acc = _verify_access(tok["access_token"])
    except NotSignedIn as exc:
        _deny(att, str(exc), keycloak_error=None, source="app")
        return _popup("Sign-in failed token validation.", att["id"]), None
    _event("Authentication successful: Keycloak issued tokens.", "keycloak", "ok", att["id"])
    _event("Tokens validated: signature (realm JWKS), issuer, audience, expiry, nonce.", "app", "ok", att["id"])
    roles = (acc.get("realm_access") or {}).get("roles", [])
    if REQUIRED_ROLE not in roles:
        _end_keycloak_session(tok.get("refresh_token"))
        _deny(att, "Signed in, but the account has no Employee role.", keycloak_error=None, source="app")
        return _popup("Access denied.", att["id"]), None
    name = idc.get("name") or idc.get("preferred_username")
    sid = secrets.token_urlsafe(32)
    with _LOCK:
        _SESSIONS[sid] = {"username": idc.get("preferred_username"), "name": name, "employee_id": idc.get("employee_id") or "",
                          "department": idc.get("department") or "", "role": "Employee", "created": time.time(), "attempt": att["id"],
                          "access_token": tok["access_token"], "refresh_token": tok.get("refresh_token"),
                          "access_exp": time.time() + int(tok.get("expires_in", 60)), "kc_session": idc.get("sid")}
    selected_other = idc.get("preferred_username") != att["username"]
    _finish(att, "success", {"employee": name, "username": idc.get("preferred_username"), "identity_provider": "Keycloak",
                             "account_status": "Enabled", "authentication": "Successful", "access": "Granted", "role": "Employee",
                             "selected_persona_mismatch": att["name"] if selected_other else None, "source": "keycloak", "at": _now_iso()})
    _event(f"Application access granted to {name}.", "app", "ok", att["id"])
    return _popup("Signed in. You can close this window.", att["id"]), sid


def _popup(message: str, attempt: str | None) -> str:
    safe = "".join(ch for ch in (attempt or "") if ch.isalnum() or ch in "-_")
    return f"""<!doctype html><meta charset="utf-8"><title>Crystal Clean sign-in</title>
<body style="font:15px 'Segoe UI',system-ui,sans-serif;padding:24px;color:#17212b">{message}
<script>try {{ if (window.opener) window.opener.postMessage({{ type: "cc-sso", attempt: "{safe}" }}, location.origin); }} catch (e) {{}}
setTimeout(() => window.close(), 300);</script></body>"""


def attempt(aid: str) -> dict:
    """Status of one sign-in attempt. While pending, Keycloak's own LOGIN_ERROR events are checked."""
    att = _ATTEMPTS.get(aid)
    if not att:
        raise ValueError("Unknown sign-in attempt.")
    if att["status"] == "pending":
        if time.time() * 1000 - att["started_ms"] > ATTEMPT_TTL_S * 1000:
            _finish(att, "expired", {"reason": "The sign-in window was left open too long.", "source": "app", "at": _now_iso()})
        else:
            _check_events(att)
    return {k: att[k] for k in ("id", "persona", "name", "status", "result", "last_error")}


def _check_events(att: dict) -> None:
    c = _cfg()
    try:
        rows = _admin("GET", "/events", params={"client": c["client_id"], "type": "LOGIN_ERROR", "max": 20}) or []
    except Exception:  # noqa: BLE001 -- keep waiting; the status panel reports Keycloak health separately
        return
    mine = sorted((e for e in rows if int(e.get("time", 0)) >= att["started_ms"] - 1000 and
                   (e.get("userId") == att["user_id"] or (e.get("details") or {}).get("username") == att["username"])),
                  key=lambda e: int(e["time"]))
    for e in mine:
        key = f"{e.get('time')}:{e.get('error')}"
        if key in att["seen_events"]:
            continue
        att["seen_events"].add(key)
        err, at = e.get("error") or "unknown_error", _ms_iso(int(e["time"]))
        if err in FINAL_ERRORS:
            _deny(att, REASONS.get(err, err), keycloak_error=err, source="keycloak", at=at)
            return
        att["last_error"] = {"error": err, "reason": REASONS.get(err, err), "at": at}
        _event(f"Keycloak rejected the credentials ({err}); waiting for another try.", "keycloak", "bad", att["id"], at)


# --------------------------------------------------------------- session
def require(session_id: str | None, bearer: str | None = None) -> dict:
    """The backend's access decision for protected calls: valid token, live Keycloak session, enabled account, Employee role."""
    if bearer:
        claims, token, s = _verify_access(bearer), bearer, None
    else:
        s = _SESSIONS.get(session_id or "")
        if not s or time.time() - s["created"] > SESSION_TTL_S:
            raise NotSignedIn("Not signed in.")
        if time.time() > s["access_exp"] - 10:
            _refresh(session_id, s)
        claims, token = _verify_access(s["access_token"]), s["access_token"]
    if not _introspect(token).get("active"):
        if session_id:
            _SESSIONS.pop(session_id, None)
        raise NotSignedIn("Keycloak reports this session is no longer active.")
    u = _user(claims.get("preferred_username") or "")
    if not u or not u.get("enabled"):
        raise AccessDenied("This account is disabled in Keycloak.")
    if REQUIRED_ROLE not in (claims.get("realm_access") or {}).get("roles", []):
        raise AccessDenied("This account does not have the Employee role.")
    return {"claims": claims, "session": s}


def _refresh(session_id: str, s: dict) -> None:
    c = _cfg()
    r = _HTTP.post(_oidc("/token"), timeout=10, headers=_as_public(), data={"grant_type": "refresh_token", "refresh_token": s["refresh_token"],
                                                      "client_id": c["client_id"], "client_secret": c["secret"]})
    if r.status_code != 200:
        _SESSIONS.pop(session_id, None)
        raise NotSignedIn("Keycloak would not renew this session.")
    tok = r.json()
    s.update(access_token=tok["access_token"], refresh_token=tok.get("refresh_token", s["refresh_token"]),
             access_exp=time.time() + int(tok.get("expires_in", 60)))


def session(session_id: str | None) -> dict:
    if not session_id or session_id not in _SESSIONS:
        return {"authenticated": False}
    try:
        ctx = require(session_id)
    except NotSignedIn as exc:
        return {"authenticated": False, "ended": str(exc)}
    except AccessDenied as exc:
        return {"authenticated": False, "ended": str(exc)}
    s = ctx["session"]
    return {"authenticated": True, "profile": {"name": s["name"], "username": s["username"], "employee_id": s["employee_id"],
                                               "department": s["department"], "role": s["role"]},
            "keycloak_session": "Active (verified by token introspection)", "signed_in_at": datetime.fromtimestamp(s["created"], timezone.utc).isoformat(timespec="seconds")}


def protected_workspace(session_id: str | None, bearer: str | None) -> dict:
    ctx = require(session_id, bearer)
    c = ctx["claims"]
    return {"ok": True, "employee": c.get("name") or c.get("preferred_username"), "employee_id": c.get("employee_id"),
            "features": [{"name": "Employee Service Hub", "detail": "Raise and track IT requests"},
                         {"name": "My requests", "detail": "Status of every request you have raised"},
                         {"name": "Company announcements", "detail": "Read-only"}],
            "checked": ["JWT signature, issuer, expiry and client", "Keycloak session active (introspection)", "Account enabled", "Employee role"]}


def _end_keycloak_session(refresh_token: str | None) -> bool:
    if not refresh_token:
        return False
    c = _cfg()
    r = _HTTP.post(_oidc("/logout"), timeout=10, headers=_as_public(), data={"client_id": c["client_id"], "client_secret": c["secret"], "refresh_token": refresh_token})
    return r.status_code in (200, 204)


def logout(session_id: str | None) -> dict:
    with _LOCK:
        s = _SESSIONS.pop(session_id or "", None)
    if not s:
        return {"ok": True, "keycloak_session_ended": False}
    ended = False
    try:
        ended = _end_keycloak_session(s.get("refresh_token"))
    except httpx.HTTPError:
        pass
    _event(f"{s['name']} switched persona: {'Keycloak session ended' if ended else 'local session cleared (Keycloak logout failed)'}.", "app",
           "info" if ended else "bad")
    return {"ok": True, "keycloak_session_ended": ended}


# ---------------------------------------------------------------- status
def status() -> dict:
    c = _cfg()
    out: dict = {"realm": c["realm"], "client_id": c["client_id"], "checked_at": _now_iso(),
                 "local": {"success": _STATS["success"], "failed": _STATS["failed"], "since": _STATS["since"]},
                 "timeline": list(reversed(_TIMELINE))[:24]}
    try:
        d = _HTTP.get(f"{c['internal']}/realms/{c['realm']}/.well-known/openid-configuration", timeout=5, headers=_as_public()).json()
        keys = _HTTP.get(_oidc("/certs"), timeout=5).json().get("keys", [])
        out["keycloak"] = {"ok": True, "issuer": d.get("issuer"), "pkce": "S256" in (d.get("code_challenge_methods_supported") or []),
                           "signing_keys": len(keys)}
    except Exception as exc:  # noqa: BLE001
        out["keycloak"] = {"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:120]}"}
        return out
    try:
        rows = _admin("GET", "/clients", params={"clientId": c["client_id"]}) or []
        cl = rows[0] if rows else None
        out["client"] = {"exists": bool(cl), "name": (cl or {}).get("name"), "enabled": (cl or {}).get("enabled"),
                         "code_flow": (cl or {}).get("standardFlowEnabled"), "confidential": cl is not None and not cl.get("publicClient"),
                         "pkce": ((cl or {}).get("attributes") or {}).get("pkce.code.challenge.method")}
    except Exception as exc:  # noqa: BLE001
        out["client"] = {"exists": None, "error": f"{type(exc).__name__}: {str(exc)[:120]}"}
    try:
        out["personas"] = [persona(k) for k in PERSONAS]
    except Exception as exc:  # noqa: BLE001
        out["personas_error"] = f"{type(exc).__name__}: {str(exc)[:120]}"
    try:
        ev = _admin("GET", "/events", params={"client": c["client_id"], "max": 100}) or []
        names = {p["user_id"]: p["username"] for p in out.get("personas", []) if p.get("user_id")}
        day = int(time.time() * 1000) - 86400 * 1000
        recent = [e for e in ev if int(e.get("time", 0)) >= day]
        last = ev[0] if ev else None
        out["events"] = {"ok": True, "logins_24h": sum(e["type"] == "LOGIN" for e in recent),
                         "login_errors_24h": sum(e["type"] == "LOGIN_ERROR" for e in recent),
                         "last": {"type": last["type"], "error": last.get("error"), "at": _ms_iso(int(last["time"])),
                                  "user": names.get(last.get("userId")) or (last.get("details") or {}).get("username")} if last else None}
    except Exception as exc:  # noqa: BLE001
        out["events"] = {"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:120]}"}
    return out
