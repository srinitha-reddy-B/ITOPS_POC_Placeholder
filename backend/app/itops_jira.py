"""Live Jira write-back for the Agentic ITOps page -- the same operations as
itops_servicenow.py, so the page runs the identical flow against whichever
ticketing system is selected.

Credentials come from backend/.env only -- never from the browser:

    AURA_ITOPS_JIRA_SITE=https://<site>.atlassian.net
    AURA_ITOPS_JIRA_PROJECT=KAN
    AURA_ITOPS_JIRA_EMAIL=<atlassian account email>
    AURA_ITOPS_JIRA_TOKEN=<api token>

Mapping (works for Jira Software and Jira Service Management projects):
incident -> issue (KAN-12), work note -> comment, state -> workflow
transition (matched by name, not hardcoded ids), resolve -> transition to a
Done-category status plus a resolution comment, attachments -> issue
attachments, change -> a "[Change]" issue, SOP knowledge article -> a "[SOP]"
issue carrying the SOP text and PDFs. SOP/change issues are excluded from the
incident queue.
"""

import json
import os
from datetime import date, timedelta

import httpx

from . import itops_servicenow as sn  # shared SOP PDF renderer

_TIMEOUT = 45.0
_SOP_PREFIX = "[SOP] "
_CHANGE_PREFIX = "[Change] "
_PREFERRED_TYPES = ["incident", "bug", "task", "story"]
_type_cache: dict[str, str] = {}


class NotConfigured(Exception):
    pass


def _cfg() -> dict:
    site = os.getenv("AURA_ITOPS_JIRA_SITE", "").strip().rstrip("/")
    project = os.getenv("AURA_ITOPS_JIRA_PROJECT", "").strip()
    email = os.getenv("AURA_ITOPS_JIRA_EMAIL", "").strip()
    token = os.getenv("AURA_ITOPS_JIRA_TOKEN", "").strip()
    missing = [n for n, v in (("SITE", site), ("PROJECT", project), ("EMAIL", email), ("TOKEN", token)) if not v]
    if missing:
        raise NotConfigured(f"Jira live mode isn't configured (AURA_ITOPS_JIRA_{', AURA_ITOPS_JIRA_'.join(missing)} in backend/.env).")
    if not site.startswith("http"):
        site = f"https://{site}"
    return {"site": site, "project": project, "auth": (email, token)}


def _req(c: dict, method: str, path: str, **kw) -> httpx.Response:
    headers = {"Accept": "application/json", **kw.pop("headers", {})}
    resp = httpx.request(method, f"{c['site']}{path}", auth=c["auth"], headers=headers, timeout=_TIMEOUT, **kw)
    resp.raise_for_status()
    return resp


def _url(c: dict, key: str) -> str:
    return f"{c['site']}/browse/{key}"


# ------------------------------------------------------------- ADF helpers


def _adf(text: str) -> dict:
    paras = [
        {"type": "paragraph", "content": [{"type": "text", "text": line}]}
        for line in (text or "").splitlines()
        if line.strip()
    ]
    return {"type": "doc", "version": 1, "content": paras or [{"type": "paragraph", "content": []}]}


def _adf_text(node) -> str:
    if not node:
        return ""
    if isinstance(node, str):
        return node
    if node.get("type") == "text":
        return node.get("text", "")
    parts = [_adf_text(ch) for ch in node.get("content", [])]
    sep = "\n" if node.get("type") in ("doc", "bulletList", "orderedList") else ""
    return sep.join(p for p in parts if p)


def _sop_text(sop: dict) -> str:
    lines = [
        f"{sop.get('label', '')} · {sop.get('domain_name', '')} · v{sop.get('version', '1.0')}",
        f"Status: {sop.get('status', 'PROPOSED')}",
    ]
    lines += [f"{k}: {v}" for k, v in sop.get("meta", [])]
    for i, sec in enumerate(sop.get("sections", []), 1):
        lines.append(f"{i}. {sec['name']}")
        lines += [f"{it['id']}  {it['text']}  (Evidence: {it['ref']})" for it in sec.get("items", [])]
    lines.append(f"{len(sop.get('sections', [])) + 1}. Evidence")
    lines += [f"{s['type']} · {s['ref']} · {s['title']}" for s in sop.get("sources", [])]
    if sop.get("revisions"):
        lines.append("Revision history")
        lines += [f"v{r['version']} · {r['note']}" for r in sop["revisions"]]
    if sop.get("footer"):
        lines.append(sop["footer"])
    return "\n".join(lines)


# ------------------------------------------------------------------ status


def status() -> dict:
    try:
        c = _cfg()
    except NotConfigured as exc:
        return {"live": False, "reason": str(exc)}
    try:
        me = _req(c, "GET", "/rest/api/3/myself").json()
        pr = _req(c, "GET", f"/rest/api/3/project/{c['project']}").json()
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        hint = " (email/token rejected)" if code == 401 else " (no access to the project?)" if code in (403, 404) else ""
        return {"live": False, "reason": f"Jira returned HTTP {code}{hint}."}
    except httpx.HTTPError as exc:
        return {"live": False, "reason": f"Couldn't reach Jira: {exc}"}
    return {
        "live": True,
        "instance_url": c["site"],
        "username": me.get("displayName"),
        "project": pr.get("key"),
        "project_name": pr.get("name"),
        "home_url": f"{c['site']}/browse/{pr.get('key')}",
    }


# ------------------------------------------------------------------ issues


def _issue_type(c: dict) -> str:
    if c["project"] in _type_cache:
        return _type_cache[c["project"]]
    pr = _req(c, "GET", f"/rest/api/3/project/{c['project']}").json()
    types = [t for t in pr.get("issueTypes", []) if not t.get("subtask") and t.get("name", "").lower() != "epic"]
    name = next((t["name"] for p in _PREFERRED_TYPES for t in types if t["name"].lower() == p), types[0]["name"] if types else "Task")
    _type_cache[c["project"]] = name
    return name


def _create(c: dict, summary: str, text: str, labels: list[str] | None = None) -> dict:
    fields = {
        "project": {"key": c["project"]},
        "summary": summary[:250],
        "description": _adf(text),
        "issuetype": {"name": _issue_type(c)},
    }
    if labels:
        fields["labels"] = labels
    try:
        rec = _req(c, "POST", "/rest/api/3/issue", json={"fields": fields}).json()
    except httpx.HTTPStatusError:
        if not labels:
            raise
        fields.pop("labels")
        rec = _req(c, "POST", "/rest/api/3/issue", json={"fields": fields}).json()
    key = rec["key"]
    return {"number": key, "sys_id": key, "url": _url(c, key)}


def _comment(c: dict, key: str, text: str) -> None:
    _req(c, "POST", f"/rest/api/3/issue/{key}/comment", json={"body": _adf(text)})


def _transition(c: dict, key: str, targets: list[str], done: bool = False) -> str | None:
    """Move the issue through the workflow transition whose name / target status matches."""
    trs = _req(c, "GET", f"/rest/api/3/issue/{key}/transitions").json().get("transitions", [])
    chosen = None
    for target in targets:
        chosen = next((t for t in trs if target in t.get("to", {}).get("name", "").lower() or target in t.get("name", "").lower()), None)
        if chosen:
            break
    if chosen is None and done:
        chosen = next((t for t in trs if t.get("to", {}).get("statusCategory", {}).get("key") == "done"), None)
    if chosen is None:
        return None
    _req(c, "POST", f"/rest/api/3/issue/{key}/transitions", json={"transition": {"id": chosen["id"]}})
    return chosen.get("to", {}).get("name") or chosen.get("name")


def create_incident(p: dict) -> dict:
    c = _cfg()
    return _create(c, p["short_description"], p.get("description", ""), ["aura-itops"])


def set_state(p: dict) -> dict:
    c = _cfg()
    name = _transition(c, p["sys_id"], [p.get("state", "in progress").lower()])
    return {"updated": name is not None, "state": name}


def work_note(p: dict) -> dict:
    c = _cfg()
    _comment(c, p["sys_id"], p["text"])
    return {"posted": True}


def resolve(p: dict) -> dict:
    c = _cfg()
    _comment(c, p["sys_id"], f"Resolution notes:\n{p['close_notes']}")
    name = _transition(c, p["sys_id"], ["done", "resolve", "close"], done=True)
    if name is None:
        raise ValueError("no transition to a Done/Resolved status is available for this issue")
    return {"resolved": True, "close_code": name}


# ---------------------------------------------------------------- attachments


def _attach(c: dict, key: str, file_name: str, content_type: str, data: bytes) -> dict:
    resp = _req(
        c, "POST", f"/rest/api/3/issue/{key}/attachments",
        files={"file": (file_name, data, content_type)},
        headers={"X-Atlassian-Token": "no-check"},
    )
    items = resp.json() or [{}]
    item = items[0]
    return {
        "attached": True,
        "file_name": item.get("filename", file_name),
        "size_bytes": item.get("size", len(data)),
        "attachment_sys_id": item.get("id", ""),
        "download_url": item.get("content", ""),
    }


def attach_sop(p: dict) -> dict:
    c = _cfg()
    return _attach(c, p["sys_id"], p.get("file_name", "sop.pdf"), "application/pdf", sn.sop_pdf(p["sop"]))


def attach_json(p: dict) -> dict:
    c = _cfg()
    return _attach(c, p["sys_id"], p.get("file_name", "log.json"), "application/json", json.dumps(p["data"], indent=2).encode("utf-8"))


# -------------------------------------------------------------------- change


def create_change(p: dict) -> dict:
    c = _cfg()
    return _create(c, _CHANGE_PREFIX + p["short_description"], p.get("description", ""), ["aura-change"])


def close_change(p: dict) -> dict:
    c = _cfg()
    _comment(c, p["sys_id"], f"Implemented successfully. {p['close_notes']}")
    name = _transition(c, p["sys_id"], ["done", "close"], done=True)
    return {"closed": name is not None}


# ------------------------------------------------------- fields & links


_me_cache: dict[str, str] = {}


def _me(c: dict) -> str:
    if c["site"] not in _me_cache:
        _me_cache[c["site"]] = _req(c, "GET", "/rest/api/3/myself").json()["accountId"]
    return _me_cache[c["site"]]


def update_fields(p: dict) -> dict:
    """Set the record fields a service desk maintains: priority, labels, due
    date (SLA target) and assignee. Each field is applied on its own so a field
    missing from the project's screen is skipped instead of failing the rest."""
    c = _cfg()
    key = p["sys_id"]
    parts: list[tuple[str, dict]] = []
    if p.get("priority"):
        parts.append(("priority", {"fields": {"priority": {"name": p["priority"]}}}))
    if p.get("labels"):
        parts.append(("labels", {"update": {"labels": [{"add": l} for l in p["labels"]]}}))
    if p.get("due_in_days") is not None:
        parts.append(("duedate", {"fields": {"duedate": (date.today() + timedelta(days=int(p["due_in_days"]))).isoformat()}}))
    if p.get("assign_to_me"):
        parts.append(("assignee", {"fields": {"assignee": {"accountId": _me(c)}}}))
    applied, skipped = [], []
    for name, body in parts:
        try:
            _req(c, "PUT", f"/rest/api/3/issue/{key}", json=body)
            applied.append(name)
        except httpx.HTTPStatusError:
            skipped.append(name)
    return {"updated": bool(applied), "applied": applied, "skipped": skipped}


def link(p: dict) -> dict:
    """Link two issues (incident <-> SOP, incident <-> change, repeat <-> first incident)."""
    c = _cfg()
    if not p.get("to"):
        return {"linked": False}
    _req(c, "POST", "/rest/api/3/issueLink", json={
        "type": {"name": p.get("type", "Relates")},
        "inwardIssue": {"key": p["sys_id"]},
        "outwardIssue": {"key": p["to"]},
    })
    return {"linked": True}


# ------------------------------------------------------------------ reads


def get_incident(p: dict) -> dict:
    c = _cfg()
    d = _req(c, "GET", f"/rest/api/3/issue/{p['sys_id']}", params={"fields": "summary,status,resolution,attachment,comment"}).json()
    f = d.get("fields", {})
    comments = [_adf_text(cm.get("body")) for cm in (f.get("comment") or {}).get("comments", [])]
    notes = next((cm.split("\n", 1)[-1] for cm in reversed(comments) if cm.startswith("Resolution notes")), comments[-1] if comments else "")
    return {
        "number": d.get("key"),
        "state": (f.get("status") or {}).get("name", ""),
        "close_code": (f.get("resolution") or {}).get("name") or (f.get("status") or {}).get("name", ""),
        "close_notes": notes,
        "attachments": [{"file_name": a.get("filename"), "download_url": a.get("content")} for a in f.get("attachment") or []],
        "url": _url(c, d.get("key", "")),
    }


def recent_incidents(p: dict) -> dict:
    c = _cfg()
    limit = int(p.get("limit", 15))
    params = {
        "jql": f"project = {c['project']} ORDER BY created DESC",
        "fields": "summary,description,status,created,reporter,priority",
        "maxResults": limit + 10,
    }
    try:
        issues = _req(c, "GET", "/rest/api/3/search/jql", params=params).json().get("issues", [])
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code not in (404, 410):
            raise
        issues = _req(c, "GET", "/rest/api/3/search", params=params).json().get("issues", [])
    out = []
    for it in issues:
        f = it.get("fields", {})
        summary = f.get("summary") or ""
        if summary.startswith((_SOP_PREFIX, _CHANGE_PREFIX)):
            continue
        created = (f.get("created") or "").replace("T", " ")[:19]
        out.append({
            "number": it.get("key"),
            "sys_id": it.get("key"),
            "short_description": summary,
            "description": _adf_text(f.get("description")),
            "priority": (f.get("priority") or {}).get("name", ""),
            "state": (f.get("status") or {}).get("name", ""),
            "created": created,
            "caller": (f.get("reporter") or {}).get("displayName", ""),
            "url": _url(c, it.get("key", "")),
        })
    return {"incidents": out[:limit]}


# ------------------------------------------------------------- SOP (knowledge)


def kb_upsert(p: dict) -> dict:
    """The SOP lives as a '[SOP]' issue (text in the description, PDFs attached)."""
    c = _cfg()
    sop = p["sop"]
    summary = _SOP_PREFIX + p["title"]
    text = _sop_text(sop)
    if p.get("sys_id"):
        key = p["sys_id"]
        _req(c, "PUT", f"/rest/api/3/issue/{key}", json={"fields": {"summary": summary[:250], "description": _adf(text)}})
        _comment(c, key, f"SOP updated to v{sop.get('version', '')} by AURA.")
        verb = "updated"
    else:
        key = _create(c, summary, text, ["aura-sop"])["number"]
        verb = "published"
    # The SOP is published once the engineer has validated the RCA, so the record is Done;
    # later versions update the same record (revision history in the description).
    approved = str(sop.get("status", "")).upper() == "APPROVED"
    state = _transition(c, key, ["done"], done=True)
    url = _url(c, key)
    if p.get("incident_sys_id"):
        note = "approved for automation" if approved else "validated by engineer"
        _comment(c, p["incident_sys_id"], f"[AURA] {sop.get('label', 'SOP')} v{sop.get('version', '1.0')} {verb} as {key} ({note}): {url}")
    return {"number": key, "sys_id": key, "workflow_state": state or "SOP issue", "url": url}


# ------------------------------------------------------------------ dispatch

OPS = {
    "create_incident": create_incident,
    "set_state": set_state,
    "work_note": work_note,
    "resolve": resolve,
    "attach_sop": attach_sop,
    "attach_json": attach_json,
    "create_change": create_change,
    "close_change": close_change,
    "get_incident": get_incident,
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
    except httpx.HTTPStatusError as exc:
        try:
            body = exc.response.json()
            detail = "; ".join(body.get("errorMessages", []) + [f"{k}: {v}" for k, v in (body.get("errors") or {}).items()])
        except ValueError:
            detail = exc.response.text[:200]
        return {"ok": False, "error": f"Jira HTTP {exc.response.status_code}: {detail[:240]}"}
    except (httpx.HTTPError, KeyError, ValueError, IndexError) as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
