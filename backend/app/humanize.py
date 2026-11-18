"""Turns a raw platform-call result dict into a sentence an agent would
actually say, instead of dumping "key: value; key: value" at the user.
Dispatches on the shape of the result (which fields are present) since the
same shape can come from a real API call or the matching mock. Falls back
to a plain dump only for a shape nothing here recognizes, so nothing is
ever silently dropped -- just less polished for the long tail.
"""

from . import llm

_INCIDENT_PAST_TENSE = {"resolve_incident": "resolved", "close_incident": "closed", "cancel_incident": "canceled"}


def _table_label(result: dict) -> str:
    """"incident" by default (matches the original, Incident-only
    wording) -- otherwise whichever ServiceNow table this result actually
    came from (problem, change request, request item, ...)."""
    return llm.SERVICENOW_TABLES.get(result.get("table", "incident"), {}).get("label", "incident")


def describe(result: dict) -> str:
    if "error" in result:
        return f"I ran into a problem: {result['error']}"
    if "note" in result and len(result) == 1:
        return result["note"]

    # Real Salesforce list read: {"sobject", "count", "records": [...]}
    if "sobject" in result and "records" in result:
        sobject, count, records = result["sobject"], result["count"], result["records"]
        if not records:
            return f"No {sobject} records found."
        lines = [_describe_record(r) for r in records[:5]]
        more = f" (and {count - len(records)} more)" if count > len(records) else ""
        plural = "s" if count != 1 else ""
        return f"Found {count} {sobject}{plural}:\n" + "\n".join(f"  • {l}" for l in lines) + more

    # Real Salesforce count-only read: {"sobject", "count"}
    if "sobject" in result and "count" in result:
        count = result["count"]
        verb = "is" if count == 1 else "are"
        plural = "" if count == 1 else "s"
        return f"There {verb} {count} {result['sobject']}{plural} in Salesforce."

    # Real Salesforce write: {"action": "create_x", "object", "record_id", "fields"}
    if str(result.get("action", "")).startswith("create_") and "record_id" in result:
        obj = result.get("object", "record")
        fields = result.get("fields", {})
        detail = ", ".join(f"{k} = {v}" for k, v in fields.items() if v and v != "Unknown")
        tail = f" ({detail})" if detail else ""
        return f"Done — created a new {obj}{tail}. Record ID: {result['record_id']}."

    # Mock Salesforce read: {"account", "open_opportunities": [...]}
    if "open_opportunities" in result:
        opps = result["open_opportunities"]
        who = f" for {result['account']}" if result.get("account") else ""
        if not opps:
            return f"No open opportunities{who}."
        lines = [f"{o['name']} — {o['stage']}, ${o['amount']:,.0f}" for o in opps[:5]]
        return f"Open opportunities{who}:\n" + "\n".join(f"  • {l}" for l in lines)

    # Mock Salesforce write: {"action": "update_record", "object", "record_id", "result"}
    if result.get("action") == "update_record":
        return f"Updated the {result.get('object', 'record')} record ({result.get('record_id', '')})."

    # Databricks mock read: {"account", "churn_score", "risk_band"}
    if "churn_score" in result:
        who = result.get("account", "That account")
        return f"{who}'s churn score is {result['churn_score']} ({result['risk_band']} risk)."

    # Snowflake mock read: {"account", "recent_orders", "last_order_date"}
    if "recent_orders" in result:
        who = result.get("account", "That account")
        return f"{who} has {result['recent_orders']} recent order(s), most recently on {result['last_order_date']}."

    # Real Databricks/Snowflake SQL read: {"columns", "rows"}
    if "columns" in result and "rows" in result:
        rows = result["rows"]
        n = len(rows)
        if not n:
            return "That query returned no rows."
        first = dict(zip(result["columns"], rows[0]))
        return f"Query returned {n} row{'s' if n != 1 else ''}. First row: {first}"

    # ServiceNow read, real or mock: {"table", "incident_status": "open"|"closed"|"all",
    # "incident_count", "numbers": [...], "ci_name": str|None}
    if "incident_count" in result:
        count = result["incident_count"]
        verb = "is" if count == 1 else "are"
        status = result.get("incident_status", "open")
        qualifier = "" if status == "all" else f"{status} "
        label = _table_label(result)
        plural_label = f"{label}s" if count != 1 else label
        ci_name = result.get("ci_name")
        keyword = result.get("keyword")
        scope = f" related to {ci_name}" if ci_name else (f" about {keyword}" if keyword else "")
        numbers = [n for n in result.get("numbers", []) if n]
        if not numbers:
            return f"There {verb} {count} {qualifier}{plural_label}{scope}."
        listed = ", ".join(numbers)
        return f"There {verb} {count} {qualifier}{plural_label}{scope}: {listed}."

    # ServiceNow attachments read, real or mock: {"attachments_for", "attachment_count", "attachment_names"}
    if "attachment_count" in result:
        number, count = result["attachments_for"], result["attachment_count"]
        if not count:
            return f"{number} has no attachments."
        names = ", ".join(n for n in result.get("attachment_names", []) if n)
        return f"{number} has {count} attachment{'s' if count != 1 else ''}: {names}."

    # ServiceNow single-record detail read, real or mock
    if result.get("incident_detail"):
        return (
            f"{result['number']} ({_table_label(result)}): \"{result.get('short_description', '')}\" -- "
            f"{result.get('state', 'unknown state')}, priority {result.get('priority', 'unknown')}, "
            f"assigned to {result.get('assigned_to', 'unassigned')} (opened {result.get('opened_at', 'unknown time')})."
        )

    # ServiceNow lookup that found nothing, real: {"incident_not_found": number}
    if "incident_not_found" in result:
        return f"I couldn't find a record numbered {result['incident_not_found']}."

    # ServiceNow write, real: {"table", "action": "create_incident", "number", "sys_id"}
    if "number" in result and "sys_id" in result:
        return f"Opened {_table_label(result)} {result['number']}."

    # ServiceNow write, mock: {"table", "action": "create_incident", "ticket_id", "short_description"}
    if result.get("action") == "create_incident":
        return f"Opened {_table_label(result)} {result.get('ticket_id')}: {result.get('short_description', '')}"

    # ServiceNow lifecycle writes, real or mock: {"action": "update_incident"|"assign_incident"|
    # "resolve_incident"|"close_incident"|"cancel_incident"|"delete_incident", "number", ...}
    if result.get("action") == "update_incident":
        fields = result.get("fields", {})
        detail = ", ".join(f"{k} = {v!r}" for k, v in fields.items())
        return f"Updated {result['number']}" + (f" ({detail})." if detail else ".")
    if result.get("action") == "assign_incident":
        return f"Assigned {result['number']} to {result.get('assignee', 'someone')}."
    if result.get("action") in _INCIDENT_PAST_TENSE:
        return f"Marked {result['number']} as {_INCIDENT_PAST_TENSE[result['action']]}."
    if result.get("action") == "delete_incident":
        return f"Deleted {_table_label(result)} {result['number']}."

    # M365 read, real: {"organization", "tenant_id"}
    if "organization" in result:
        return f"Your Microsoft 365 tenant is {result['organization']}."

    # M365 read, mock: {"document", "site", "summary"}
    if "summary" in result:
        return result["summary"]

    # M365 write, mock: {"action": "update_list_item", "list", "result"}
    if result.get("action") == "update_list_item":
        return f"Updated the '{result.get('list')}' list."

    return "; ".join(f"{k}: {v}" for k, v in result.items())


def _describe_record(r: dict) -> str:
    if r.get("Name"):
        extra = ", ".join(f"{k}={v}" for k, v in r.items() if k not in ("Id", "Name") and v is not None)
        return r["Name"] + (f" ({extra})" if extra else "")
    if r.get("CaseNumber"):
        return f"{r['CaseNumber']} — {r.get('Subject', '')}"
    if r.get("Subject"):
        return r["Subject"]
    if r.get("FirstName") or r.get("LastName"):
        return f"{r.get('FirstName', '')} {r.get('LastName', '')}".strip()
    return str(r)
