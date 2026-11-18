"""Keycloak OIDC for the Ops Console: the backend verifies every access token itself.

The browser signs in with Authorization Code + PKCE against the realm's public client `cc-ops-console`.
Each API call carries the access token; this module checks its signature against the realm's published
keys (JWKS), the issuer, the expiry and that it was issued to this client, then reads the realm roles.
Access is never decided by the frontend alone.

Roles (realm roles, created by scripts/setup_keycloak.py):
  ops-viewer     read the console
  ops-engineer   run demos and investigations
  ops-approver   approve or reject remediation, root cause and account changes
  ops-manager    business manager: sees Operational Insights and raises predicted escalations as incidents
"""

import threading
import time

import httpx
import jwt
from fastapi import Header, HTTPException

from . import config

ROLES = ("ops-viewer", "ops-engineer", "ops-approver", "ops-manager")
_jwks: dict = {"keys": None, "at": 0.0}
_lock = threading.Lock()


def issuer() -> list[str]:
    """Tokens carry the URL the browser used to reach Keycloak (CC_KEYCLOAK_PUBLIC_URL, or the 127.0.0.1 form)."""
    base = config.KEYCLOAK_PUBLIC_URL.rstrip("/")
    forms = {base, base.replace("localhost", "127.0.0.1"), base.replace("127.0.0.1", "localhost")}
    return [f"{b}/realms/{config.KEYCLOAK_REALM}" for b in forms]


def _keys(force: bool = False) -> jwt.PyJWKSet:
    with _lock:
        if force or not _jwks["keys"] or time.time() - _jwks["at"] > 600:
            try:
                r = httpx.get(f"{config.KEYCLOAK_URL}/realms/{config.KEYCLOAK_REALM}/protocol/openid-connect/certs", timeout=5)
                r.raise_for_status()
                _jwks.update(keys=jwt.PyJWKSet.from_dict(r.json()), at=time.time())
            except httpx.HTTPError:
                if not _jwks["keys"]:
                    raise
                # Keycloak is down: keep checking signatures with the keys we already have
        return _jwks["keys"]


def _key_for(kid: str):
    for attempt in (False, True):  # refetch once if Keycloak rotated its keys
        for k in _keys(force=attempt).keys:
            if k.key_id == kid:
                return k.key
    raise HTTPException(401, "token signed with an unknown key")


def verify(token: str) -> dict:
    try:
        head = jwt.get_unverified_header(token)
        claims = jwt.decode(token, _key_for(head.get("kid", "")), algorithms=["RS256"], issuer=issuer(),
                            options={"verify_aud": False, "require": ["exp", "iat", "iss", "sub"]}, leeway=10)
    except HTTPException:
        raise
    except httpx.HTTPError:
        raise HTTPException(503, "Keycloak is unreachable, so the sign-in cannot be verified")
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "session expired, sign in again")
    except jwt.PyJWTError as exc:
        raise HTTPException(401, f"invalid token: {exc}")
    if claims.get("azp") != config.OIDC_CLIENT_ID:
        raise HTTPException(401, "token was not issued to the Ops Console")
    roles = [r for r in claims.get("realm_access", {}).get("roles", []) if r in ROLES]
    return {"sub": claims["sub"], "username": claims.get("preferred_username"), "name": claims.get("name") or claims.get("preferred_username"),
            "email": claims.get("email"), "title": claims.get("title") or "", "facility": claims.get("facility") or "",
            "roles": roles, "session_id": claims.get("sid"), "auth_time": claims.get("auth_time"), "expires": claims.get("exp"),
            "auth": "Keycloak"}


# Demo persona switch (config.DEMO_PERSONAS): the three demo personas and their roles
DEMO_ROLES = {"marcus.reed": ["ops-viewer"], "john.taylor": ["ops-viewer", "ops-manager"],
              "mark.wood": ["ops-viewer", "ops-engineer", "ops-approver"]}


def _demo_user(persona: str) -> dict:
    from .identity import PERSONAS
    if persona not in DEMO_ROLES:
        raise HTTPException(401, "unknown demo persona")
    p = PERSONAS.get(persona, {})
    return {"sub": f"demo:{persona}", "username": persona, "name": p.get("name", persona), "email": None, "title": p.get("title", ""),
            "facility": p.get("facility", ""), "roles": DEMO_ROLES[persona], "session_id": None, "auth_time": None, "expires": None,
            "auth": "demo persona"}


def user(authorization: str | None = Header(default=None), x_demo_persona: str | None = Header(default=None)) -> dict:
    """FastAPI dependency: any signed-in console user (needs ops-viewer)."""
    if config.DEMO_PERSONAS and x_demo_persona and not authorization:
        return _demo_user(x_demo_persona.strip().lower())
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "sign in with Keycloak first")
    u = verify(authorization.split(" ", 1)[1].strip())
    if not u["roles"]:
        raise HTTPException(403, f"{u['username']} has no Ops Console role in Keycloak")
    return u


def need(role: str):
    def dep(authorization: str | None = Header(default=None), x_demo_persona: str | None = Header(default=None)) -> dict:
        u = user(authorization, x_demo_persona)
        if role not in u["roles"]:
            raise HTTPException(403, f"{u['username']} lacks the Keycloak role '{role}'")
        return u
    return dep
