"""ServiceNow REST client for the Ops Console: incidents, states, work notes, comments, resolution, read-back.

Credentials come from backend/.env only, never from the browser:

    AURA_ITOPS_SNOW_INSTANCE=https://devXXXXX.service-now.com
    AURA_ITOPS_SNOW_USERNAME=...
    AURA_ITOPS_SNOW_PASSWORD=...

Choice values (state, close_code) are looked up live from sys_choice because they differ between releases.
"""

import os

import httpx

_TIMEOUT = 45.0  # developer instances can take several seconds per write


class NotConfigured(Exception):
    pass


class BadResponse(Exception):
    """2xx status but not JSON: usually SSO, MFA or a REST access policy intercepted the call."""


def _creds() -> dict:
    instance = os.getenv("AURA_ITOPS_SNOW_INSTANCE", "").strip().rstrip("/")
    username = os.getenv("AURA_ITOPS_SNOW_USERNAME", "").strip()
    password = os.getenv("AURA_ITOPS_SNOW_PASSWORD", "")
    if not (instance and username and password):
        raise NotConfigured("ServiceNow isn't configured (AURA_ITOPS_SNOW_* in backend/.env).")
    if not instance.startswith("http"):
        instance = f"https://{instance}"
    return {"instance_url": instance, "username": username, "password": password}


def _auth(c: dict) -> tuple[str, str]:
    return (c["username"], c["password"])


def _json(resp: httpx.Response):
    try:
        return resp.json()
    except ValueError:
        body = resp.text.strip()
        hint = "an HTML page (check Web Service Access / REST API access policy)" if body.startswith("<") else repr(body[:150])
        raise BadResponse(f"ServiceNow returned {hint} instead of JSON")


def _get(c: dict, path: str, params: dict) -> dict:
    resp = httpx.get(f"{c['instance_url']}{path}", params=params, auth=_auth(c), headers={"Accept": "application/json"}, timeout=_TIMEOUT)
    resp.raise_for_status()
    return _json(resp)


def _choices(c: dict, table: str, field: str) -> list[dict]:
    return _get(c, "/api/now/table/sys_choice", {"sysparm_query": f"name={table}^element={field}^inactive=false",
                                                 "sysparm_fields": "value,label"}).get("result", [])


def _choice(c: dict, table: str, field: str, preferences: list[str]) -> str | None:
    """First choice whose label matches a preference; exact matches first, never a 'No …' label."""
    rows = [r for r in _choices(c, table, field) if not r.get("label", "").lower().startswith("no ")]
    for pref in preferences:
        for row in rows:
            if row.get("label", "").strip().lower() == pref:
                return row["value"]
    for pref in preferences:
        for row in rows:
            if pref in row.get("label", "").lower():
                return row["value"]
    return None


def _first_choice_containing(c: dict, table: str, field: str, words: list[str]) -> str | None:
    for row in _choices(c, table, field):
        label = row.get("label", "").lower()
        if not label.startswith("no ") and any(w in label for w in words):
            return row["value"]
    return None


def _record(c: dict, table: str, method: str, sys_id: str | None, fields: dict) -> dict:
    url = f"{c['instance_url']}/api/now/table/{table}" + (f"/{sys_id}" if sys_id else "")
    resp = httpx.request(method, url, json=fields, auth=_auth(c),
                         headers={"Content-Type": "application/json", "Accept": "application/json"}, timeout=_TIMEOUT)
    resp.raise_for_status()
    return _json(resp)["result"]


def _record_url(c: dict, table: str, sys_id: str) -> str:
    return f"{c['instance_url']}/{table}.do?sys_id={sys_id}"


def _lookup(c: dict, table: str, query: str) -> str | None:
    """sys_id of the first matching record, or None (best effort)."""
    try:
        rows = _get(c, f"/api/now/table/{table}", {"sysparm_query": query, "sysparm_fields": "sys_id", "sysparm_limit": 1}).get("result", [])
    except (httpx.HTTPError, BadResponse):
        return None
    return rows[0]["sys_id"] if rows else None


def status() -> dict:
    try:
        c = _creds()
        _get(c, "/api/now/table/incident", {"sysparm_limit": 1, "sysparm_fields": "sys_id"})
        return {"live": True, "instance_url": c["instance_url"]}
    except NotConfigured as exc:
        return {"live": False, "reason": str(exc)}
    except (httpx.HTTPError, BadResponse) as exc:
        return {"live": False, "reason": f"{type(exc).__name__}: {str(exc)[:160]}"}


def create_incident(p: dict, extra: dict | None = None) -> dict:
    c = _creds()
    fields = {"short_description": p["short_description"], "description": p.get("description", ""),
              "urgency": str(p.get("urgency", "2")), "impact": str(p.get("impact", "2")),
              "category": p.get("category", "inquiry"), "contact_type": p.get("contact_type", "self-service")}
    if p.get("assignment_group_name"):
        gid = _lookup(c, "sys_user_group", f"name={p['assignment_group_name']}")
        if gid:
            fields["assignment_group"] = gid
    fields.update(extra or {})
    rec = _record(c, "incident", "POST", None, fields)
    return {"number": rec.get("number"), "sys_id": rec.get("sys_id"), "url": _record_url(c, "incident", rec.get("sys_id", ""))}


def set_state(p: dict) -> dict:
    c = _creds()
    value = _choice(c, "incident", "state", [p.get("state", "in progress").lower()])
    if value is None:
        return {"updated": False, "reason": f"no '{p.get('state')}' state on this instance"}
    _record(c, "incident", "PATCH", p["sys_id"], {"state": value})
    return {"updated": True, "state": value}


def work_note(p: dict) -> dict:
    _record(_creds(), "incident", "PATCH", p["sys_id"], {"work_notes": p["text"]})
    return {"posted": True}


def comment(p: dict) -> dict:
    """Customer-visible comment: the caller sees it; technical detail goes in work notes."""
    _record(_creds(), "incident", "PATCH", p["sys_id"], {"comments": p["text"]})
    return {"posted": True}


def resolve(p: dict) -> dict:
    c = _creds()
    state = _choice(c, "incident", "state", ["resolved"])
    if state is None:
        raise ValueError("no 'Resolved' state on this instance's incident table")
    code = _choice(c, "incident", "close_code", ["permanent fix applied", "solved (permanently)", "solution provided", "resolved by change"]) \
        or _first_choice_containing(c, "incident", "close_code", ["resolved", "solved"])
    fields = {"state": state, "close_notes": p["close_notes"]}
    if code is not None:
        fields["close_code"] = code
    _record(c, "incident", "PATCH", p["sys_id"], fields)
    return {"resolved": True, "close_code": code}


def activity(p: dict) -> dict:
    """The incident and its work notes / comments as ServiceNow holds them now, newest first."""
    c = _creds()
    rec = _get(c, f"/api/now/table/incident/{p['sys_id']}", {
        "sysparm_fields": "number,state,assignment_group,short_description,close_notes,resolved_at", "sysparm_display_value": "true"})["result"]
    notes = _get(c, "/api/now/table/sys_journal_field", {
        "sysparm_query": f"element_id={p['sys_id']}^elementINwork_notes,comments^ORDERBYDESCsys_created_on",
        "sysparm_fields": "sys_id,element,value,sys_created_on", "sysparm_display_value": "true", "sysparm_limit": 50}).get("result", [])
    d = lambda v: v.get("display_value", "") if isinstance(v, dict) else (v or "")
    return {"number": d(rec.get("number")), "state": d(rec.get("state")), "assignment_group": d(rec.get("assignment_group")),
            "short_description": d(rec.get("short_description")), "close_notes": d(rec.get("close_notes")), "resolved_at": d(rec.get("resolved_at")),
            "notes": [{"id": d(n.get("sys_id")), "element": d(n.get("element")), "value": d(n.get("value")), "created_on": d(n.get("sys_created_on"))}
                      for n in notes], "url": _record_url(c, "incident", p["sys_id"])}
