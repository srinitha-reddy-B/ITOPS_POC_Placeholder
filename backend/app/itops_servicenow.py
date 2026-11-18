"""Live ServiceNow write-back for the Agentic ITOps page.

The page runs its agent story either against the sandbox (mock) or, when
this module is configured, against a real ServiceNow instance: it creates
the incident, moves its state, posts AURA's work notes, attaches the SOP as
a real PDF, opens/closes the change request and resolves the incident with
a resolution code and notes.

Credentials come from backend/.env only -- never from the browser:

    AURA_ITOPS_SNOW_INSTANCE=https://devXXXXX.service-now.com
    AURA_ITOPS_SNOW_USERNAME=...
    AURA_ITOPS_SNOW_PASSWORD=...

Basic Auth REST, reusing platform_connect's helpers (choice lookup, JSON
safety, record PATCH/POST). Choice values (state, close_code) are looked up
live from sys_choice rather than hardcoded, since they vary by release.
"""

import json
import os

import httpx

from . import platform_connect as pc

_TIMEOUT = 45.0  # developer instances can take several seconds per write


class NotConfigured(Exception):
    pass


def _creds() -> dict:
    instance = os.getenv("AURA_ITOPS_SNOW_INSTANCE", "").strip().rstrip("/")
    username = os.getenv("AURA_ITOPS_SNOW_USERNAME", "").strip()
    password = os.getenv("AURA_ITOPS_SNOW_PASSWORD", "")
    if not (instance and username and password):
        raise NotConfigured("ServiceNow live mode isn't configured (AURA_ITOPS_SNOW_* in backend/.env).")
    if not instance.startswith("http"):
        instance = f"https://{instance}"
    return {"instance_url": instance, "username": username, "password": password}


def _auth(c: dict) -> tuple[str, str]:
    return (c["username"], c["password"])


def status() -> dict:
    try:
        c = _creds()
    except NotConfigured as exc:
        return {"live": False, "reason": str(exc)}
    try:
        resp = httpx.get(
            f"{c['instance_url']}/api/now/table/incident",
            params={"sysparm_limit": 1, "sysparm_fields": "sys_id"},
            auth=_auth(c), headers={"Accept": "application/json"}, timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        pc._safe_json(resp, "servicenow")
    except pc.BadResponse as exc:
        return {"live": False, "reason": str(exc), "remediation": exc.remediation}
    except httpx.HTTPStatusError as exc:
        return {"live": False, "reason": f"ServiceNow returned HTTP {exc.response.status_code}."}
    except httpx.HTTPError as exc:
        return {"live": False, "reason": f"Couldn't reach ServiceNow: {exc}"}
    return {"live": True, "instance_url": c["instance_url"], "username": c["username"]}


def _choices(c: dict, table: str, field: str) -> list[dict]:
    resp = httpx.get(
        f"{c['instance_url']}/api/now/table/sys_choice",
        params={"sysparm_query": f"name={table}^element={field}^inactive=false", "sysparm_fields": "value,label"},
        auth=_auth(c), headers={"Accept": "application/json"}, timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    return pc._safe_json(resp, "servicenow").get("result", [])


def _choice(c: dict, table: str, field: str, preferences: list[str]) -> str | None:
    """First choice value whose label matches a preference, in preference order.
    Exact label matches win over substring matches, and negative labels
    ("No resolution provided" contains "solution provided") are never picked."""
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


def _record(c: dict, table: str, method: str, sys_id: str | None, fields: dict) -> dict:
    url = f"{c['instance_url']}/api/now/table/{table}" + (f"/{sys_id}" if sys_id else "")
    resp = httpx.request(
        method, url, json=fields, auth=_auth(c),
        headers={"Content-Type": "application/json", "Accept": "application/json"}, timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    return pc._safe_json(resp, "servicenow")["result"]


def _first_choice_containing(c: dict, table: str, field: str, words: list[str]) -> str | None:
    for row in _choices(c, table, field):
        label = row.get("label", "").lower()
        if not label.startswith("no ") and any(w in label for w in words):
            return row["value"]
    return None


def _record_url(c: dict, table: str, sys_id: str) -> str:
    return f"{c['instance_url']}/{table}.do?sys_id={sys_id}"


# ------------------------------------------------------------------ incident


def _lookup(c: dict, table: str, query: str) -> str | None:
    """sys_id of the first matching record, or None (lookups are best effort)."""
    try:
        resp = httpx.get(
            f"{c['instance_url']}/api/now/table/{table}",
            params={"sysparm_query": query, "sysparm_fields": "sys_id", "sysparm_limit": 1},
            auth=_auth(c), headers={"Accept": "application/json"}, timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        rows = pc._safe_json(resp, "servicenow").get("result", [])
    except (httpx.HTTPError, pc.BadResponse):
        return None
    return rows[0]["sys_id"] if rows else None


def create_incident(p: dict, extra: dict | None = None) -> dict:
    """`extra` is set by trusted server code only (e.g. the FrontDoor's employee tag), never from the request."""
    c = _creds()
    fields = {
        "short_description": p["short_description"],
        "description": p.get("description", ""),
        "urgency": str(p.get("urgency", "1")),
        "impact": str(p.get("impact", "2")),
        "category": p.get("category", "software"),
        "contact_type": p.get("contact_type", "self-service"),
    }
    # Optional reference fields by display name; skipped when the instance has no match.
    for key, table, field in (
        ("caller_name", "sys_user", "caller_id"),
        ("assignment_group_name", "sys_user_group", "assignment_group"),
        ("ci_name", "cmdb_ci", "cmdb_ci"),
    ):
        if p.get(key):
            sys_id = _lookup(c, table, f"name={p[key]}")
            if sys_id:
                fields[field] = sys_id
    # Caller = the ServiceNow user the backend signs in as, so the incident shows in that user's own lists.
    if p.get("caller_is_me"):
        me = _lookup(c, "sys_user", f"user_name={c['username']}")
        if me:
            fields["caller_id"] = me
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
    c = _creds()
    _record(c, p.get("table", "incident"), "PATCH", p["sys_id"], {"work_notes": p["text"]})
    return {"posted": True}


def comment(p: dict) -> dict:
    """Additional comment (customer-visible): the caller sees it in their portal and notifications.
    Used for plain-language employee updates; technical detail goes in work notes."""
    c = _creds()
    _record(c, p.get("table", "incident"), "PATCH", p["sys_id"], {"comments": p["text"]})
    return {"posted": True}


def resolve(p: dict) -> dict:
    c = _creds()
    state = _choice(c, "incident", "state", ["resolved"])
    if state is None:
        raise ValueError("couldn't find a 'Resolved' state on this instance's incident table")
    # Close-code labels differ across releases/instances; prefer the caller's choice, then a permanent-fix code,
    # then any "resolved" one.
    prefs = ["permanent fix applied", "solved (permanently)", "solution provided", "resolved by change"]
    if p.get("close_code"):
        prefs.insert(0, str(p["close_code"]).strip().lower())
    code = _choice(c, "incident", "close_code", prefs)
    if code is None:
        code = _first_choice_containing(c, "incident", "close_code", ["resolved", "solved"])
    fields = {"state": state, "close_notes": p["close_notes"]}
    if code is not None:
        fields["close_code"] = code
    _record(c, "incident", "PATCH", p["sys_id"], fields)
    return {"resolved": True, "close_code": code}


# ------------------------------------------------------- fields & links


def update_fields(p: dict) -> dict:
    """Priority (urgency/impact), due date (SLA target) and assignee on the incident.
    Labels have no incident field in ServiceNow; they are carried in the work notes."""
    c = _creds()
    fields: dict = {}
    if p.get("priority"):
        fields.update({"urgency": "1", "impact": "2"})  # -> 2 - High
    if p.get("due_in_days") is not None:
        from datetime import datetime, timedelta

        fields["due_date"] = (datetime.utcnow() + timedelta(days=int(p["due_in_days"]))).strftime("%Y-%m-%d %H:%M:%S")
    if p.get("caller_is_me"):
        me = _lookup(c, "sys_user", f"user_name={c['username']}")
        if me:
            fields["caller_id"] = me
    if p.get("assigned_to_name"):
        sys_id = _lookup(c, "sys_user", f"name={p['assigned_to_name']}")
        if sys_id:
            fields["assigned_to"] = sys_id
    if p.get("assign_to_me") and "assigned_to" not in fields:
        resp = httpx.get(
            f"{c['instance_url']}/api/now/table/sys_user",
            params={"sysparm_query": f"user_name={c['username']}", "sysparm_fields": "sys_id", "sysparm_limit": 1},
            auth=_auth(c), headers={"Accept": "application/json"}, timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        rows = pc._safe_json(resp, "servicenow").get("result", [])
        if rows:
            fields["assigned_to"] = rows[0]["sys_id"]
    if not fields:
        return {"updated": False}
    _record(c, "incident", "PATCH", p["sys_id"], fields)
    return {"updated": True, "applied": sorted(fields)}


def link(p: dict) -> dict:
    """change -> change_request.parent = incident; parent -> incident.parent_incident (repeat -> first incident)."""
    c = _creds()
    kind = p.get("kind", "")
    if not p.get("to") or kind not in ("change", "parent"):
        return {"linked": False}
    if kind == "change":
        # The change request's Parent is the incident it was raised for.
        _record(c, "change_request", "PATCH", p["to"], {"parent": p["sys_id"]})
        return {"linked": True, "field": "change_request.parent"}
    _record(c, "incident", "PATCH", p["sys_id"], {"parent_incident": p["to"]})
    return {"linked": True, "field": "parent_incident"}


# ---------------------------------------------------------------- attachments


def _attach(c: dict, table: str, sys_id: str, file_name: str, content_type: str, data: bytes) -> dict:
    resp = httpx.post(
        f"{c['instance_url']}/api/now/attachment/file",
        params={"table_name": table, "table_sys_id": sys_id, "file_name": file_name},
        content=data,
        auth=_auth(c),
        headers={"Content-Type": content_type, "Accept": "application/json"},
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    rec = pc._safe_json(resp, "servicenow").get("result", {})
    att = rec.get("sys_id", "")
    return {
        "attached": True,
        "file_name": rec.get("file_name", file_name),
        "size_bytes": rec.get("size_bytes", len(data)),
        "attachment_sys_id": att,
        "download_url": f"{c['instance_url']}/sys_attachment.do?sys_id={att}" if att else "",
    }


def attach_sop(p: dict) -> dict:
    c = _creds()
    pdf = sop_pdf(p["sop"])
    return _attach(c, p.get("table", "incident"), p["sys_id"], p.get("file_name", "sop.pdf"), "application/pdf", pdf)


def attach_json(p: dict) -> dict:
    c = _creds()
    data = json.dumps(p["data"], indent=2).encode("utf-8")
    return _attach(c, p.get("table", "incident"), p["sys_id"], p.get("file_name", "log.json"), "application/json", data)


# ------------------------------------------------------------------ reads


def get_incident(p: dict) -> dict:
    """Fetch a (previously resolved) incident with its resolution and attachments."""
    c = _creds()
    resp = httpx.get(
        f"{c['instance_url']}/api/now/table/incident/{p['sys_id']}",
        params={"sysparm_fields": "number,state,close_code,close_notes,resolved_at,short_description", "sysparm_display_value": "true"},
        auth=_auth(c), headers={"Accept": "application/json"}, timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    rec = pc._safe_json(resp, "servicenow")["result"]
    att = httpx.get(
        f"{c['instance_url']}/api/now/table/sys_attachment",
        params={"sysparm_query": f"table_name=incident^table_sys_id={p['sys_id']}", "sysparm_fields": "sys_id,file_name"},
        auth=_auth(c), headers={"Accept": "application/json"}, timeout=_TIMEOUT,
    )
    att.raise_for_status()
    files = [
        {"file_name": a.get("file_name"), "download_url": f"{c['instance_url']}/sys_attachment.do?sys_id={a.get('sys_id')}"}
        for a in pc._safe_json(att, "servicenow").get("result", [])
    ]
    return {
        "number": rec.get("number"),
        "state": rec.get("state"),
        "close_code": rec.get("close_code"),
        "close_notes": rec.get("close_notes"),
        "resolved_at": rec.get("resolved_at"),
        "attachments": files,
        "url": _record_url(c, "incident", p["sys_id"]),
    }


def activity(p: dict) -> dict:
    """The incident as ServiceNow shows it now: key fields (display values) and the
    Activities stream (work notes and comments), newest first. Lets the POC read back
    exactly what landed in the instance."""
    c = _creds()
    resp = httpx.get(
        f"{c['instance_url']}/api/now/table/incident/{p['sys_id']}",
        params={
            "sysparm_fields": "number,state,priority,impact,urgency,category,subcategory,cmdb_ci,contact_type,short_description,description,opened_at,assigned_to,assignment_group,caller_id,close_code,close_notes,resolved_at,sys_updated_on",
            "sysparm_display_value": "true",
        },
        auth=_auth(c), headers={"Accept": "application/json"}, timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    rec = pc._safe_json(resp, "servicenow")["result"]

    def disp(v):
        return v.get("display_value", "") if isinstance(v, dict) else (v or "")

    jr = httpx.get(
        f"{c['instance_url']}/api/now/table/sys_journal_field",
        params={
            "sysparm_query": f"element_id={p['sys_id']}^elementINwork_notes,comments^ORDERBYDESCsys_created_on",
            "sysparm_fields": "sys_id,element,value,sys_created_on,sys_created_by",
            "sysparm_display_value": "true",
            "sysparm_limit": 50,
        },
        auth=_auth(c), headers={"Accept": "application/json"}, timeout=_TIMEOUT,
    )
    jr.raise_for_status()
    notes = [
        {
            "id": disp(j.get("sys_id")),
            "element": disp(j.get("element")),
            "value": disp(j.get("value")),
            "created_on": disp(j.get("sys_created_on")),
            "created_by": disp(j.get("sys_created_by")),
        }
        for j in pc._safe_json(jr, "servicenow").get("result", [])
    ]
    return {
        "number": disp(rec.get("number")),
        "state": disp(rec.get("state")),
        "priority": disp(rec.get("priority")),
        "impact": disp(rec.get("impact")),
        "urgency": disp(rec.get("urgency")),
        "category": disp(rec.get("category")),
        "subcategory": disp(rec.get("subcategory")),
        "ci": disp(rec.get("cmdb_ci")),
        "channel": disp(rec.get("contact_type")),
        "short_description": disp(rec.get("short_description")),
        "description": disp(rec.get("description")),
        "opened_at": disp(rec.get("opened_at")),
        "assigned_to": disp(rec.get("assigned_to")),
        "assignment_group": disp(rec.get("assignment_group")),
        "caller": disp(rec.get("caller_id")),
        "close_code": disp(rec.get("close_code")),
        "close_notes": disp(rec.get("close_notes")),
        "resolved_at": disp(rec.get("resolved_at")),
        "updated_on": disp(rec.get("sys_updated_on")),
        "notes": notes,
        "url": _record_url(c, "incident", p["sys_id"]),
    }


def recent_incidents(p: dict) -> dict:
    """Latest incidents on the instance, newest first -- the page polls this to
    pick up incidents people create directly in ServiceNow."""
    c = _creds()
    resp = httpx.get(
        f"{c['instance_url']}/api/now/table/incident",
        params={
            "sysparm_query": "ORDERBYDESCsys_created_on",
            "sysparm_limit": int(p.get("limit", 15)),
            "sysparm_fields": "sys_id,number,short_description,description,priority,state,sys_created_on,caller_id,assignment_group,assigned_to,category",
            "sysparm_display_value": "true",
        },
        auth=_auth(c), headers={"Accept": "application/json"}, timeout=_TIMEOUT,
    )
    resp.raise_for_status()

    def disp(v):
        return v.get("display_value", "") if isinstance(v, dict) else (v or "")

    out = []
    for r in pc._safe_json(resp, "servicenow").get("result", []):
        sys_id = disp(r.get("sys_id"))
        out.append({
            "number": disp(r.get("number")),
            "sys_id": sys_id,
            "short_description": disp(r.get("short_description")),
            "description": disp(r.get("description")),
            "priority": disp(r.get("priority")),
            "state": disp(r.get("state")),
            "created": disp(r.get("sys_created_on")),
            "caller": disp(r.get("caller_id")),
            "assignment_group": disp(r.get("assignment_group")),
            "assigned_to": disp(r.get("assigned_to")),
            "category": disp(r.get("category")),
            "url": _record_url(c, "incident", sys_id),
        })
    return {"incidents": out}


# ------------------------------------------------------------- knowledge (SOP)


def _kb_base(c: dict) -> str | None:
    resp = httpx.get(
        f"{c['instance_url']}/api/now/table/kb_knowledge_base",
        params={"sysparm_query": "active=true", "sysparm_fields": "sys_id,title"},
        auth=_auth(c), headers={"Accept": "application/json"}, timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    rows = pc._safe_json(resp, "servicenow").get("result", [])
    for row in rows:
        if row.get("title", "").strip().lower() == "it":
            return row["sys_id"]
    return rows[0]["sys_id"] if rows else None


def kb_upsert(p: dict) -> dict:
    """Create (v1) or update (vN) the SOP as a ServiceNow Knowledge article.
    Articles go through the instance's own publishing workflow, so they stay
    Draft until a knowledge manager approves them -- the SOP is 'proposed'.
    Optionally posts the article link as a work note on the incident."""
    c = _creds()
    fields = {"short_description": p["title"], "text": sop_html(p["sop"])}
    if p.get("sys_id"):
        rec = _record(c, "kb_knowledge", "PATCH", p["sys_id"], fields)
    else:
        base = _kb_base(c)
        if base:
            fields["kb_knowledge_base"] = base
        rec = _record(c, "kb_knowledge", "POST", None, fields)
    url = _record_url(c, "kb_knowledge", rec.get("sys_id", ""))
    if p.get("incident_sys_id"):
        verb = "updated" if p.get("sys_id") else "published"
        _record(c, "incident", "PATCH", p["incident_sys_id"], {
            "work_notes": f"[AURA] {p['sop'].get('label', 'SOP')} v{p['sop'].get('version', '1.0')} {verb} to Knowledge as {rec.get('number')} ({rec.get('workflow_state', 'draft')}, review required): {url}",
        })
    return {"number": rec.get("number"), "sys_id": rec.get("sys_id"), "workflow_state": rec.get("workflow_state"), "url": url}


# -------------------------------------------------------------------- change


def create_change(p: dict) -> dict:
    c = _creds()
    base = {"short_description": p["short_description"], "description": p.get("description", "")}
    try:
        rec = _record(c, "change_request", "POST", None, {**base, "type": "standard"})
    except httpx.HTTPStatusError:
        rec = _record(c, "change_request", "POST", None, base)
    return {"number": rec.get("number"), "sys_id": rec.get("sys_id"), "url": _record_url(c, "change_request", rec.get("sys_id", ""))}


def close_change(p: dict) -> dict:
    """Best effort: change state models often block jumping straight to
    Closed through the Table API. If they do, record the outcome as a work
    note on the change instead of failing the incident flow."""
    c = _creds()
    closed = _choice(c, "change_request", "state", ["closed"])
    code = _choice(c, "change_request", "close_code", ["successful"])
    fields = {"close_notes": p["close_notes"]}
    if closed is not None:
        fields["state"] = closed
    if code is not None:
        fields["close_code"] = code
    try:
        _record(c, "change_request", "PATCH", p["sys_id"], fields)
        return {"closed": closed is not None}
    except httpx.HTTPStatusError:
        _record(c, "change_request", "PATCH", p["sys_id"], {"work_notes": f"Implemented successfully. {p['close_notes']}"})
        return {"closed": False, "noted": True}


# ------------------------------------------------------------------- dispatch

OPS = {
    "create_incident": create_incident,
    "set_state": set_state,
    "work_note": work_note,
    "comment": comment,
    "resolve": resolve,
    "attach_sop": attach_sop,
    "attach_json": attach_json,
    "create_change": create_change,
    "close_change": close_change,
    "get_incident": get_incident,
    "activity": activity,
    "kb_upsert": kb_upsert,
    "recent_incidents": recent_incidents,
    "update_fields": update_fields,
    "link": link,
}


def run(op: str, payload: dict) -> dict:
    fn = OPS.get(op)
    if fn is None:
        return {"ok": False, "error": f"unknown op '{op}'"}
    try:
        return {"ok": True, **fn(payload)}
    except NotConfigured as exc:
        return {"ok": False, "error": str(exc)}
    except pc.BadResponse as exc:
        return {"ok": False, "error": str(exc), "remediation": exc.remediation}
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:200].replace("\n", " ")
        return {"ok": False, "error": f"ServiceNow HTTP {exc.response.status_code}: {detail}"}
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


# ------------------------------------------------------------------- SOP PDF


def _pdf_text(s: str) -> bytes:
    s = s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    for a, b in (("→", "->"), ("✓", "OK"), ("…", "...")):
        s = s.replace(a, b)
    return s.encode("cp1252", errors="replace")


def _wrap(text: str, width: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > width:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return lines or [""]


def sop_html(sop: dict) -> str:
    """The SOP as Knowledge-article HTML, same structure as the PDF."""
    from html import escape as e

    parts = [
        f"<p><strong>{e(sop.get('label', ''))} &middot; {e(sop.get('domain_name', ''))} &middot; v{e(str(sop.get('version', '1.0')))}</strong></p>",
        f"<p>Status: <strong>{e(sop.get('status', 'PROPOSED'))}</strong></p>",
        "<table>" + "".join(f"<tr><td><strong>{e(str(k))}</strong></td><td>{e(str(v))}</td></tr>" for k, v in sop.get("meta", [])) + "</table>",
    ]
    for i, sec in enumerate(sop.get("sections", []), 1):
        parts.append(f"<h3>{i}. {e(sec['name'])}</h3><ul>")
        for it in sec.get("items", []):
            parts.append(f"<li><strong>{e(it['id'])}</strong> {e(it['text'])}<br/><em>Evidence: {e(it['ref'])}</em></li>")
        parts.append("</ul>")
    parts.append(f"<h3>{len(sop.get('sections', [])) + 1}. Evidence</h3><ul>")
    parts += [f"<li>{e(s['type'])} &middot; {e(s['ref'])} &middot; {e(s['title'])}</li>" for s in sop.get("sources", [])]
    parts.append("</ul>")
    if sop.get("revisions"):
        parts.append("<h3>Revision history</h3><ul>")
        parts += [f"<li>v{e(r['version'])} &middot; {e(r['note'])}</li>" for r in sop["revisions"]]
        parts.append("</ul>")
    if sop.get("footer"):
        parts.append(f"<p><em>{e(sop['footer'])}</em></p>")
    return "".join(parts)


def sop_pdf(sop: dict) -> bytes:
    """Dependency-free, text-only PDF laid out like sop-publish's SOP:
    label, title, status, metadata, numbered sections with an Evidence line
    per item, then sources."""
    rows: list[tuple[str, float, bool, int]] = []  # text, size, bold, indent

    def add(text: str, size: float = 10, bold: bool = False, indent: int = 0, gap: float = 0):
        if gap:
            rows.append(("", gap, False, 0))
        width = int((512 - indent) / (size * 0.5))
        for line in _wrap(text, width):
            rows.append((line, size, bold, indent))

    add(f"{sop.get('label', '')}  -  {sop.get('domain_name', '')}".upper(), 8.5, True)
    add(sop.get("title", "SOP"), 16, True, gap=4)
    add(f"Status: {sop.get('status', 'PROPOSED')}", 10, True, gap=4)
    for k, v in sop.get("meta", []):
        add(f"{k}: {v}", 9.5, indent=0)
    for i, sec in enumerate(sop.get("sections", []), 1):
        add(f"{i}. {sec['name']}", 12, True, gap=10)
        for it in sec.get("items", []):
            add(f"{it['id']}   {it['text']}", 10, indent=0, gap=2)
            add(f"Evidence: {it['ref']}", 8.5, indent=34)
    add(f"{len(sop.get('sections', [])) + 1}. Evidence", 12, True, gap=10)
    for s in sop.get("sources", []):
        add(f"{s['type']}   {s['ref']}   {s['title']}", 9.5, gap=1)
    if sop.get("revisions"):
        add("Revision history", 12, True, gap=10)
        for r in sop["revisions"]:
            add(f"v{r['version']}   {r['note']}", 9.5, gap=1)
    if sop.get("footer"):
        add(sop["footer"], 8, gap=10)

    # Paginate.
    pages: list[list[tuple[str, float, bool, int, float]]] = [[]]
    y = 742.0
    for text, size, bold, indent in rows:
        lh = size * 1.4 if text else size
        if y - lh < 50:
            pages.append([])
            y = 742.0
        y -= lh
        if text:
            pages[-1].append((text, size, bold, indent, y))

    objs: list[bytes] = []
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    n = len(pages)
    kids = " ".join(f"{5 + 2 * i} 0 R" for i in range(n))
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {n} >>".encode())
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    for i, page in enumerate(pages):
        stream = b""
        for text, size, bold, indent, yy in page:
            font = b"/F2" if bold else b"/F1"
            stream += b"BT " + font + f" {size} Tf {50 + indent} {yy:.1f} Td (".encode() + _pdf_text(text) + b") Tj ET\n"
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {6 + 2 * i} 0 R >>".encode()
        )
        objs.append(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"endstream")

    out = b"%PDF-1.4\n"
    offsets = []
    for idx, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{idx} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out
