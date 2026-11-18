"""One-time setup of the Crystal Clean demo realm in a local Keycloak.

Run Keycloak first (see docs/CRYSTAL_CLEAN_DEMO.md), then from backend/:

    uv run python scripts/setup_keycloak.py      (admin password read from KEYCLOAK_ADMIN_PASSWORD in backend/.env)

It creates (or updates) realm "crystal-clean" with:
  - brute-force detection: 5 failed sign-ins lock the account until it is unlocked
  - sign-in events kept for 1 day (the hub reads LOGIN_ERROR events)
  - groups "Field Service", "Branch Operations", "RouteOps-Mobile"
  - users marcus.reed, priya.shah, luis.ortega (Luis without RouteOps-Mobile)
  - client "routeops-mobile" (the route app: public, password sign-in for the lockout demo)
  - user "svc-service-hub": the hub's own sign-in, with user-management rights only
    (Keycloak 26.8 rejects service-account tokens on the admin API; a realm user's token works)

and writes KEYCLOAK_URL / _REALM / _SERVICE_USER / _SERVICE_PASSWORD plus the demo users'
password into backend/.env. Secrets are never printed.
"""

import argparse
import re
import secrets
from pathlib import Path

import httpx

REALM = "crystal-clean"
GROUPS = ["Field Service", "Branch Operations", "RouteOps-Mobile"]
USERS = [
    ("marcus.reed", "Marcus", "Reed", ["Field Service", "RouteOps-Mobile"]),
    ("priya.shah", "Priya", "Shah", ["Branch Operations"]),
    ("luis.ortega", "Luis", "Ortega", ["Field Service"]),
]
HUB_ROLES = ["manage-users", "view-users", "query-users", "query-groups", "view-events"]
ENV = Path(__file__).resolve().parent.parent / ".env"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8080")  # not localhost: on Windows that tries IPv6 first (+2 s per call)
    ap.add_argument("--admin-user", default="admin")
    ap.add_argument("--admin-password", default="", help="defaults to KEYCLOAK_ADMIN_PASSWORD in backend/.env")
    a = ap.parse_args()
    a.admin_password = a.admin_password or _env_value("KEYCLOAK_ADMIN_PASSWORD")
    if not a.admin_password:
        raise SystemExit("No admin password: start Keycloak with scripts/start_keycloak.ps1 first, or pass --admin-password.")
    base = a.url.rstrip("/")

    h = {}

    def login():
        tok = httpx.post(f"{base}/realms/master/protocol/openid-connect/token", timeout=20, data={
            "grant_type": "password", "client_id": "admin-cli", "username": a.admin_user, "password": a.admin_password})
        tok.raise_for_status()
        h["Authorization"] = f"Bearer {tok.json()['access_token']}"

    login()
    adm = f"{base}/admin/realms"

    def call(method, path, ok=(200, 201, 204), **kw):
        r = httpx.request(method, f"{adm}{path}", headers=h, timeout=20, **kw)
        if r.status_code == 401:  # admin token lifetime is short; sign in again and retry once
            login()
            r = httpx.request(method, f"{adm}{path}", headers=h, timeout=20, **kw)
        if r.status_code not in ok:
            raise SystemExit(f"{method} {path} -> HTTP {r.status_code}: {r.text[:300]}")
        return r

    realm = {"realm": REALM, "enabled": True, "displayName": "Crystal Clean (demo)",
             "bruteForceProtected": True, "permanentLockout": True, "failureFactor": 5,
             "maxDeltaTimeSeconds": 43200, "quickLoginCheckMilliSeconds": 1000, "minimumQuickLoginWaitSeconds": 60,
             "eventsEnabled": True, "eventsExpiration": 86400, "enabledEventTypes": ["LOGIN", "LOGIN_ERROR"],
             "adminEventsEnabled": True, "adminEventsDetailsEnabled": False}
    if call("GET", f"/{REALM}", ok=(200, 404)).status_code == 404:
        call("POST", "", json=realm)
        print(f"created realm {REALM}")
    else:
        call("PUT", f"/{REALM}", json=realm)
        print(f"updated realm {REALM}")
    r = f"/{REALM}"

    existing = {g["name"] for g in call("GET", f"{r}/groups").json()}
    for g in GROUPS:
        if g not in existing:
            call("POST", f"{r}/groups", json={"name": g})
    gid = {g["name"]: g["id"] for g in call("GET", f"{r}/groups").json()}
    print("groups:", ", ".join(GROUPS))

    password = _env_value("CC_DEMO_USER_PASSWORD") or f"Demo-{secrets.token_urlsafe(9)}"
    for username, first, last, groups in USERS:
        found = call("GET", f"{r}/users", params={"username": username, "exact": "true"}).json()
        body = {"username": username, "firstName": first, "lastName": last, "email": f"{username}@example.com",
                "emailVerified": True, "enabled": True}
        if found:
            uid = found[0]["id"]
            call("PUT", f"{r}/users/{uid}", json=body)
        else:
            call("POST", f"{r}/users", json=body)
            uid = call("GET", f"{r}/users", params={"username": username, "exact": "true"}).json()[0]["id"]
        call("PUT", f"{r}/users/{uid}/reset-password", json={"type": "password", "value": password, "temporary": False})
        call("DELETE", f"{r}/attack-detection/brute-force/users/{uid}")
        have = {g["name"] for g in call("GET", f"{r}/users/{uid}/groups").json()}
        for g in GROUPS:
            if g in groups and g not in have:
                call("PUT", f"{r}/users/{uid}/groups/{gid[g]}")
            if g not in groups and g in have:
                call("DELETE", f"{r}/users/{uid}/groups/{gid[g]}")
        print(f"user {username}: {', '.join(groups)}")

    def client(client_id, body):
        rows = call("GET", f"{r}/clients", params={"clientId": client_id}).json()
        if rows:
            call("PUT", f"{r}/clients/{rows[0]['id']}", json={**rows[0], **body})
            return rows[0]["id"]
        call("POST", f"{r}/clients", json={"clientId": client_id, **body})
        return call("GET", f"{r}/clients", params={"clientId": client_id}).json()[0]["id"]

    client("routeops-mobile", {"name": "RouteOps Mobile", "publicClient": True, "directAccessGrantsEnabled": True,
                               "standardFlowEnabled": True, "redirectUris": ["http://localhost:3000/*"]})
    svc, svc_pw = "svc-service-hub", _env_value("KEYCLOAK_SERVICE_PASSWORD") or secrets.token_urlsafe(24)
    found = call("GET", f"{r}/users", params={"username": svc, "exact": "true"}).json()
    if not found:
        call("POST", f"{r}/users", json={"username": svc, "firstName": "Service", "lastName": "Hub", "email": "service-hub@example.com",
                                         "emailVerified": True, "enabled": True})
        found = call("GET", f"{r}/users", params={"username": svc, "exact": "true"}).json()
    sid = found[0]["id"]
    call("PUT", f"{r}/users/{sid}/reset-password", json={"type": "password", "value": svc_pw, "temporary": False})
    call("DELETE", f"{r}/attack-detection/brute-force/users/{sid}")
    rm = call("GET", f"{r}/clients", params={"clientId": "realm-management"}).json()[0]["id"]
    roles = [call("GET", f"{r}/clients/{rm}/roles/{name}").json() for name in HUB_ROLES]
    call("POST", f"{r}/users/{sid}/role-mappings/clients/{rm}", json=roles)
    print(f"client: routeops-mobile; hub sign-in: {svc} (roles: " + ", ".join(HUB_ROLES) + ")")

    _write_env({"KEYCLOAK_URL": base, "KEYCLOAK_REALM": REALM, "KEYCLOAK_SERVICE_USER": svc,
                "KEYCLOAK_SERVICE_PASSWORD": svc_pw, "CC_DEMO_USER_PASSWORD": password})
    print(f"wrote KEYCLOAK_* and CC_DEMO_USER_PASSWORD to {ENV} (values not shown). Restart the backend.")


def _env_value(key: str) -> str:
    if not ENV.exists():
        return ""
    m = re.search(rf"^{key}=(.*)$", ENV.read_text(encoding="utf-8"), re.M)
    return m.group(1).strip() if m else ""


def _write_env(values: dict) -> None:
    text = ENV.read_text(encoding="utf-8") if ENV.exists() else ""
    for k, v in values.items():
        line = f"{k}={v}"
        text, n = re.subn(rf"^{k}=.*$", line, text, flags=re.M)
        if not n:
            text = text.rstrip("\n") + ("\n\n# Crystal Clean Service Hub: local Keycloak (scripts/setup_keycloak.py)\n" if k == "KEYCLOAK_URL" else "\n") + line + "\n"
    ENV.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
