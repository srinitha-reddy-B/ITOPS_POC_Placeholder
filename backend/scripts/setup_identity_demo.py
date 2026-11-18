"""Adds the Workforce Identity & SSO demo to the existing "crystal-clean" realm.

Run scripts/setup_keycloak.py first (it creates the realm), keep Keycloak running, then from backend/:

    uv run python scripts/setup_identity_demo.py

Additive only: existing users, clients, lockout policy and the hub's own sign-in are left as they are.
It ensures, creating or updating each item:
  - realm role "employee"
  - user-profile attributes "employee_id" and "department" (admin-managed)
  - sign-in event types: adds CODE_TO_TOKEN, LOGOUT and their errors to whatever is already enabled
  - client KEYCLOAK_CLIENT_ID (default "crystal-clean-hub"): confidential, authorization code + PKCE (S256)
    only, redirect URIs for each origin in CC_APP_ORIGINS, employee_id / department token claims
  - users alex.morgan (enabled) and sarah.johnson (disabled), both with the "employee" role
  - read-only "view-clients" for the hub's sign-in user, so the IT view can show the client is configured

Secrets come from backend/.env (KEYCLOAK_ADMIN_PASSWORD, KEYCLOAK_CLIENT_SECRET, CC_PERSONA_PASSWORD);
missing ones are generated and written there. Nothing secret is printed.
"""

import argparse
import os
import re
import secrets
from pathlib import Path

import httpx

ENV = Path(__file__).resolve().parent.parent / ".env"
ROLE = "employee"
EXTRA_EVENTS = ["LOGIN", "LOGIN_ERROR", "CODE_TO_TOKEN", "CODE_TO_TOKEN_ERROR", "LOGOUT", "LOGOUT_ERROR"]
PERSONAS = [
    # username, first, last, employee id, department, enabled in Keycloak
    ("alex.morgan", "Alex", "Morgan", "CC-EMP-1001", "Operations", True),
    ("sarah.johnson", "Sarah", "Johnson", "CC-EMP-1002", "Finance", False),
]
ATTRIBUTES = [("employee_id", "Employee ID"), ("department", "Department")]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=_env("KEYCLOAK_URL") or "http://127.0.0.1:8080")
    ap.add_argument("--realm", default=_env("KEYCLOAK_REALM") or "crystal-clean")
    a = ap.parse_args()
    admin_pw = _env("KEYCLOAK_ADMIN_PASSWORD")
    if not admin_pw:
        raise SystemExit("No KEYCLOAK_ADMIN_PASSWORD in backend/.env: start Keycloak with scripts/start_keycloak.ps1 first.")
    base, realm = a.url.rstrip("/"), a.realm
    client_id = _env("KEYCLOAK_CLIENT_ID") or "crystal-clean-hub"
    secret = _env("KEYCLOAK_CLIENT_SECRET") or secrets.token_urlsafe(32)
    persona_pw = _env("CC_PERSONA_PASSWORD") or f"Persona-{secrets.token_urlsafe(9)}"
    origins = [o.strip().rstrip("/") for o in (os.getenv("CC_APP_ORIGINS") or _env("CC_APP_ORIGINS")
                                                 or "http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip()]

    h: dict[str, str] = {}

    def login() -> None:
        r = httpx.post(f"{base}/realms/master/protocol/openid-connect/token", timeout=20,
                       data={"grant_type": "password", "client_id": "admin-cli", "username": "admin", "password": admin_pw})
        r.raise_for_status()
        h["Authorization"] = f"Bearer {r.json()['access_token']}"

    def call(method: str, path: str, ok=(200, 201, 204), **kw):
        r = httpx.request(method, f"{base}/admin/realms/{realm}{path}", headers=h, timeout=20, **kw)
        if r.status_code == 401:
            login()
            r = httpx.request(method, f"{base}/admin/realms/{realm}{path}", headers=h, timeout=20, **kw)
        if r.status_code not in ok:
            raise SystemExit(f"{method} {path} -> HTTP {r.status_code}: {r.text[:300]}")
        return r

    login()
    if call("GET", "", ok=(200, 404)).status_code == 404:
        raise SystemExit(f"Realm {realm} not found: run scripts/setup_keycloak.py first.")

    # realm role
    if call("GET", f"/roles/{ROLE}", ok=(200, 404)).status_code == 404:
        call("POST", "/roles", json={"name": ROLE, "description": "Crystal Clean employee: may use the employee applications"})
    role = call("GET", f"/roles/{ROLE}").json()
    print(f"realm role: {ROLE}")

    # user-profile attributes (Keycloak 24+ only stores declared attributes)
    prof = call("GET", "/users/profile").json()
    have = {x["name"] for x in prof.get("attributes", [])}
    added = [n for n, _ in ATTRIBUTES if n not in have]
    for name, label in ATTRIBUTES:
        if name not in have:
            prof.setdefault("attributes", []).append({"name": name, "displayName": label, "permissions": {"view": ["admin", "user"], "edit": ["admin"]},
                                                      "multivalued": False})
    if added:
        call("PUT", "/users/profile", json=prof)
    print("user attributes:", ", ".join(n for n, _ in ATTRIBUTES), "(added)" if added else "(already present)")

    # sign-in events: keep everything already enabled, add what the timeline needs
    rr = call("GET", "").json()
    types = sorted(set(rr.get("enabledEventTypes") or []) | set(EXTRA_EVENTS))
    call("PUT", "", json={"eventsEnabled": True, "enabledEventTypes": types, "eventsExpiration": rr.get("eventsExpiration") or 86400})
    print("event types:", ", ".join(types))

    # client
    body = {"clientId": client_id, "name": "Crystal Clean Service Hub", "enabled": True, "protocol": "openid-connect",
            "publicClient": False, "clientAuthenticatorType": "client-secret", "secret": secret,
            "standardFlowEnabled": True, "implicitFlowEnabled": False, "directAccessGrantsEnabled": False, "serviceAccountsEnabled": False,
            "redirectUris": [f"{o}/api/cc/identity/callback" for o in origins], "webOrigins": origins,
            "attributes": {"pkce.code.challenge.method": "S256", "post.logout.redirect.uris": "+"}}
    rows = call("GET", "/clients", params={"clientId": client_id}).json()
    if rows:
        cid = rows[0]["id"]
        call("PUT", f"/clients/{cid}", json={**rows[0], **body, "attributes": {**rows[0].get("attributes", {}), **body["attributes"]}})
    else:
        call("POST", "/clients", json=body)
        cid = call("GET", "/clients", params={"clientId": client_id}).json()[0]["id"]
    mappers = {m["name"] for m in call("GET", f"/clients/{cid}/protocol-mappers/models").json()}
    if f"{client_id}-audience" not in mappers:  # Keycloak 26 only introspects tokens whose audience includes the asking client
        call("POST", f"/clients/{cid}/protocol-mappers/models", json={
            "name": f"{client_id}-audience", "protocol": "openid-connect", "protocolMapper": "oidc-audience-mapper",
            "config": {"included.client.audience": client_id, "id.token.claim": "false", "access.token.claim": "true",
                       "introspection.token.claim": "true"}})
    for attr, _ in ATTRIBUTES:
        if attr not in mappers:
            call("POST", f"/clients/{cid}/protocol-mappers/models", json={
                "name": attr, "protocol": "openid-connect", "protocolMapper": "oidc-usermodel-attribute-mapper",
                "config": {"user.attribute": attr, "claim.name": attr, "jsonType.label": "String",
                           "id.token.claim": "true", "access.token.claim": "true", "userinfo.token.claim": "true"}})
    print(f"client: {client_id} (confidential, code + PKCE S256), redirect URIs for: {', '.join(origins)}")

    # personas
    for username, first, last, emp_id, dept, enabled in PERSONAS:
        user = {"username": username, "firstName": first, "lastName": last, "email": f"{username}@example.com", "emailVerified": True,
                "enabled": enabled, "attributes": {"employee_id": [emp_id], "department": [dept]}}
        found = call("GET", "/users", params={"username": username, "exact": "true"}).json()
        if found:
            uid = found[0]["id"]
            call("PUT", f"/users/{uid}", json=user)
        else:
            call("POST", "/users", json=user)
            uid = call("GET", "/users", params={"username": username, "exact": "true"}).json()[0]["id"]
        call("PUT", f"/users/{uid}/reset-password", json={"type": "password", "value": persona_pw, "temporary": False})
        call("DELETE", f"/attack-detection/brute-force/users/{uid}")
        call("POST", f"/users/{uid}/role-mappings/realm", json=[role])
        print(f"user {username}: {first} {last}, {emp_id}, {dept}, role {ROLE}, {'ENABLED' if enabled else 'DISABLED'}")

    # read-only client visibility for the hub's own sign-in
    svc = _env("KEYCLOAK_SERVICE_USER") or "svc-service-hub"
    found = call("GET", "/users", params={"username": svc, "exact": "true"}).json()
    if found:
        rm = call("GET", "/clients", params={"clientId": "realm-management"}).json()[0]["id"]
        call("POST", f"/users/{found[0]['id']}/role-mappings/clients/{rm}", json=[call("GET", f"/clients/{rm}/roles/view-clients").json()])
        print(f"hub sign-in {svc}: + view-clients (read-only)")

    _write_env({"KEYCLOAK_CLIENT_ID": client_id, "KEYCLOAK_CLIENT_SECRET": secret, "CC_PERSONA_PASSWORD": persona_pw})
    print(f"backend/.env: KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET, CC_PERSONA_PASSWORD present (values not shown). Restart the backend.")


def _env(key: str) -> str:
    if not ENV.exists():
        return ""
    m = re.search(rf"^{key}=(.*)$", ENV.read_text(encoding="utf-8"), re.M)
    return m.group(1).strip() if m else ""


def _write_env(values: dict) -> None:
    text = ENV.read_text(encoding="utf-8") if ENV.exists() else ""
    for k, v in values.items():
        if re.search(rf"^{k}=.+$", text, re.M):
            continue  # never overwrite a value that is already set
        line = f"{k}={v}"
        text, n = re.subn(rf"^{k}=.*$", line, text, flags=re.M)
        if not n:
            text = text.rstrip("\n") + "\n" + line + "\n"
    ENV.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
