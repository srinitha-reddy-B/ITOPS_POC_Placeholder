"""ServiceNow ticketing for every investigation (the existing ServiceNow integration, AURA_ITOPS_SNOW_* in .env).

  opened            incident created (In Progress); employee gets a customer-visible comment
  each agent step   a work note with that agent's analysis, findings and confidence
  approval needed   state On Hold + work note; employee told IT is reviewing the fix
  decision          work note with the approver's Keycloak identity; back to In Progress
  closed            Resolved with close notes (cause, action, verification); employee told it is fixed

ServiceNow being unavailable never stops an investigation: the failure is recorded on the investigation.
"""

import time

from . import servicenow as snow

TAG = "CC-OPS:"
CHANNEL = "Crystal Clean Ops"
CATEGORY = {"sso": "inquiry", "storage": "hardware", "api": "software", "network": "network", "backup": "database", "mail": "software"}
GROUP = {"sso": "Service Desk", "storage": "Server Operations", "api": "Application Support", "network": "Network Operations",
         "backup": "Database Operations", "mail": "Application Support"}


def enabled() -> bool:
    try:
        snow._creds()
        return True
    except snow.NotConfigured:
        return False


def _safe(doc: dict, what: str, fn):
    try:
        return fn()
    except Exception as exc:  # network, auth, instance asleep: keep going, record it
        doc.setdefault("ticket_errors", []).append({"at": time.time(), "what": what, "error": f"{type(exc).__name__}: {str(exc)[:160]}"})
        return None


def opened(doc: dict) -> None:
    if not enabled():
        return
    rep = doc.get("reporter") or {}
    who = f"{rep.get('name')} ({rep.get('username')}, {rep.get('title', '')})" if rep else "Ops Console monitoring (detected before any employee report)"
    desc = (f"Reported by: {who}\n" + (f"Employee's words: \"{rep.get('text')}\"\n" if rep.get("text") else "") +
            f"Use case: {doc['usecase_title']}\nComponent: {doc.get('component')}\nFacility: {doc.get('facility')}\n"
            f"Investigation: {doc['id']} (Crystal Clean Ops Console)")
    sev = doc.get("severity")
    urgency, impact = ("1", "1") if sev == "critical" else ("2", "2") if sev in ("high", "warning") else ("3", "3")

    def create():
        inc = snow.create_incident({"short_description": doc["title"][:160], "description": desc, "urgency": urgency, "impact": impact,
                                    "category": CATEGORY.get(doc["usecase"], "inquiry"), "contact_type": "self-service" if rep else "monitoring",
                                    "assignment_group_name": GROUP.get(doc["usecase"])}, extra={"correlation_id": f"{TAG}{doc['id']}"})
        snow.set_state({"sys_id": inc["sys_id"], "state": "in progress"})
        return inc
    inc = _safe(doc, "create incident", create)
    if inc:
        doc["ticket"] = {**inc, "state": "In Progress", "opened": time.time()}
        if rep:
            comment(doc, f"Hi {rep.get('name', '').split(' ')[0]}, we have received your request ({inc['number']}). "
                         "Our automated assistant is investigating now; you will get an update here.")


def note(doc: dict, title: str, text: str) -> None:
    t = doc.get("ticket")
    if not t:
        return
    body = f"[{CHANNEL} · {title}]\n{text}".strip()
    if _safe(doc, f"work note: {title}", lambda: snow.work_note({"sys_id": t["sys_id"], "text": body[:3800]})) is not None:
        t.setdefault("notes_posted", 0)
        t["notes_posted"] += 1


def comment(doc: dict, text: str) -> None:
    t = doc.get("ticket")
    if t:
        _safe(doc, "comment", lambda: snow.comment({"sys_id": t["sys_id"], "text": text}))


def state(doc: dict, label: str) -> None:
    t = doc.get("ticket")
    if t and _safe(doc, f"state {label}", lambda: snow.set_state({"sys_id": t["sys_id"], "state": label.lower()})) is not None:
        t["state"] = label


def agent_note(doc: dict, a: dict) -> None:
    """One work note per agent: what it looked at, what it found, how sure it is."""
    if a.get("status") == "pending":
        return
    lines = [a.get("analysis") or ""]
    if a.get("findings"):
        lines += [f"- {f}" for f in a["findings"][:6]]
    meta = []
    if a.get("confidence") is not None:
        meta.append(f"confidence {round(a['confidence'] * 100)}%")
    if a.get("input_evidence"):
        meta.append("evidence " + ", ".join(a["input_evidence"][:8]))
    if a.get("engine"):
        meta.append({"llm": "AI (Cohere), evidence-checked", "rules": "rules", "system": "system call", "human": "human"}.get(a["engine"], a["engine"]))
    if meta:
        lines.append("(" + "; ".join(meta) + ")")
    note(doc, a["name"], "\n".join(l for l in lines if l))


def approval_requested(doc: dict, gate: dict) -> None:
    r = gate["request"]
    note(doc, "Approval requested",
         f"Root cause: {r.get('root_cause') or 'not established'} (confidence {round((r.get('confidence') or 0) * 100)}%)\n"
         f"Proposed action: {r.get('recommended_action') or 'hand over to an engineer'}\nExpected outcome: {r.get('expected_outcome') or '-'}\n"
         "Risks: " + "; ".join(r.get("potential_risks") or ["-"]) + "\nWaiting for an IT approver (Keycloak role ops-approver).")
    state(doc, "On Hold")
    if doc.get("reporter"):
        comment(doc, "We found the cause and a fix is ready. An IT engineer is reviewing it now before it is applied.")


def decided(doc: dict, gate: dict) -> None:
    note(doc, "Approval decision", f"{gate.get('decision')} by {gate.get('by')} ({gate.get('username')}, {gate.get('auth') or 'Keycloak'})"
         + (f"\nComment: {gate['comment']}" if gate.get("comment") else ""))
    state(doc, "In Progress")


def closed(doc: dict) -> None:
    t = doc.get("ticket")
    if not t:
        return
    o, rca, v = doc.get("outcome") or {}, doc.get("rca") or {}, doc.get("verification") or {}
    act = (doc.get("actions") or [{}])[-1]
    if o.get("result") in ("mitigated", "incident", "resolved_incident", "false_positive"):
        notes = (f"Root cause: {rca.get('cause') or 'none found'}\n"
                 f"Action: {act.get('action') or 'none'}" + (f" (approved by {act.get('by')})" if act.get("by") else "") + "\n"
                 f"Verification: {'passed' if v.get('passed') else 'n/a'}" + (f" - {v.get('source')}" if v.get("source") else "") + "\n"
                 f"Outcome: {o.get('result')}. Investigation {doc['id']}.")
        if _safe(doc, "resolve", lambda: snow.resolve({"sys_id": t["sys_id"], "close_notes": notes})) is not None:
            t["state"] = "Resolved"
        if doc.get("reporter"):
            comment(doc, "Fixed and checked. " + {"sso": "Please try signing in again.", "network": "Branch connectivity is back to normal.",
                                                  "api": "RouteOps is responding normally again.", "storage": "The server has space again.",
                                                  "backup": "Backups are running and a restore test passed.",
                                                  "mail": "Email access and delivery are back to normal."}.get(doc["usecase"], "")
                    + " Reply if anything is still wrong.")
    else:
        why = ("The evidence shows no fault right now (no supported cause), so nothing was changed. " if not rca.get("cause") else "")
        note(doc, "Handed to an engineer", f"Outcome: {o.get('result')}. {why}The automated assistant did not apply a fix; an engineer takes over.")
        if doc.get("reporter"):
            comment(doc, "An IT engineer has taken over your request and will contact you.")


def read_back(sys_id: str) -> dict:
    """The incident and its work notes / comments exactly as ServiceNow holds them now."""
    return snow.activity({"sys_id": sys_id})


def interrupted(doc: dict) -> None:
    """The backend restarted mid-investigation: say so in ServiceNow and close the incident without any action."""
    t = doc.get("ticket")
    if not t or t.get("state") == "Resolved":
        return
    note(doc, "Interrupted", "The Ops Console restarted while this investigation was running. No change was made. "
                             "If the problem is still there, monitoring or the employee's next report opens a new incident.")
    if _safe(doc, "resolve", lambda: snow.resolve({"sys_id": t["sys_id"], "close_notes": f"Investigation {doc['id']} interrupted by a restart; no action taken."})) is not None:
        t["state"] = "Resolved"
