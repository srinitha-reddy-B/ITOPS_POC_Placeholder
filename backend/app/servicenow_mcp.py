"""Alternate ServiceNow connection path: instead of our own direct Basic
Auth REST calls (see platform_connect.py), this speaks to a real
ServiceNow MCP server (jschuller/mcp-server-servicenow, run per-call via
`uvx` in its own isolated environment -- it needs a newer httpx/fastapi
than this project pins, so it can't live in our venv) and drives it as an
MCP client using OAuth (the ServiceNow "password" grant: client_id +
client_secret from an Application Registry entry, plus the same
username/password).

Why this exists: our Basic Auth path can get silently intercepted by an
SSO/access-policy setting on the ServiceNow instance (an HTML login page
comes back instead of JSON) -- see SERVICENOW_HTML_REMEDIATION in
platform_connect.py. OAuth is a genuinely different auth mechanism from
Basic Auth, so it plausibly sidesteps that specific block. It will NOT
help if the instance fully delegates login to an external identity
provider with no local ServiceNow password at all -- OAuth here still
validates the same username/password, just through a different endpoint.

Each call spawns a fresh `mcp-server-servicenow` subprocess (simplest
correct thing given our request handlers are synchronous and per-request;
no long-lived session to manage across requests). `uvx` caches the
installed environment after the first run, so only the very first call
pays a real install cost.
"""

import asyncio
import json

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from . import llm

FIELDS = ["instance_url", "client_id", "client_secret", "username", "password"]

EXAMPLE = "connect servicenow_oauth https://devXXXXX.service-now.com <client_id> <client_secret> admin MyPassword123"

INSTRUCTIONS = (
    "To connect ServiceNow via OAuth instead of Basic Auth (a different auth mechanism, so it can "
    "sidestep an SSO/access-policy block on Basic Auth specifically):\n"
    "1. In ServiceNow: System OAuth -> Application Registry -> New -> \"Create an OAuth API endpoint "
    "for external clients\".\n"
    "2. Save it, then open it again to copy the generated Client ID and Client Secret.\n"
    "3. This still authenticates as a real user account (username/password) that can read/write the "
    "Incident table -- if your instance fully delegates login to an external identity provider with no "
    "local password at all, OAuth won't help here either, since it validates the same credentials.\n"
    "4. Tell me: connect servicenow_oauth <instance_url> <client_id> <client_secret> <username> <password>"
)

# uvx's Windows hardlink step can fail under memory pressure with
# "insufficient system resources" -- copying instead of hardlinking avoids
# that at the cost of a little extra disk on first install.
_UVX_ENV = {"UV_LINK_MODE": "copy"}

_TIMEOUT_S = 30


def form_fields() -> list[dict]:
    return [
        {"name": f, "label": f.replace("_", " ").title(), "type": "password" if f in ("client_secret", "password") else "text"}
        for f in FIELDS
    ]


def _server_params(creds: dict) -> "StdioServerParameters":
    instance_url = creds["instance_url"].rstrip("/")
    return StdioServerParameters(
        command="uvx",
        args=[
            "--prerelease", "allow", "mcp-server-servicenow",
            "--instance-url", instance_url,
            "--auth-type", "oauth",
            "--client-id", creds["client_id"],
            "--client-secret", creds["client_secret"],
            "--username", creds["username"],
            "--password", creds["password"],
            "--token-url", f"{instance_url}/oauth_token.do",
            "--transport", "stdio",
        ],
        env=_UVX_ENV,
    )


async def _call_tool(creds: dict, tool: str, arguments: dict) -> dict:
    params = _server_params(creds)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool, arguments)
            if result.isError:
                text = "; ".join(getattr(c, "text", str(c)) for c in result.content)
                raise RuntimeError(text or "ServiceNow MCP tool call failed")
            for c in result.content:
                text = getattr(c, "text", None)
                if text:
                    try:
                        return json.loads(text)
                    except ValueError:
                        return {"text": text}
            return {}


def _run(coro):
    return asyncio.run(asyncio.wait_for(coro, timeout=_TIMEOUT_S))


def _unwrap(exc: BaseException) -> str:
    """anyio wraps failures from its internal task groups in an
    ExceptionGroup, so the top-level message is a useless "unhandled
    errors in a TaskGroup (1 sub-exception)" -- surface the real cause
    instead, recursing through nested groups."""
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    return str(exc) or type(exc).__name__


def smoke_test(creds: dict) -> tuple[bool, str]:
    try:
        _run(_call_tool(creds, "get_current_user", {}))
        return True, "ok"
    except asyncio.TimeoutError:
        return False, f"ServiceNow MCP server didn't respond within {_TIMEOUT_S}s."
    except Exception as exc:
        return False, _unwrap(exc)


_STATUS_QUERY = {"open": "active=true", "closed": "active=false", "all": ""}


def read_records(creds: dict, table: str, status: str = "open", ci_name: str | None = None, keyword: str | None = None) -> dict:
    query = _STATUS_QUERY.get(status, "active=true")
    if ci_name:
        query = f"{query}^cmdb_ci.nameLIKE{ci_name}" if query else f"cmdb_ci.nameLIKE{ci_name}"
    elif keyword:
        query = f"{query}^short_descriptionLIKE{keyword}" if query else f"short_descriptionLIKE{keyword}"
    try:
        body = _run(_call_tool(creds, "list_records", {
            "table": table, "query": query, "limit": 5, "fields": ["number"],
        }))
    except Exception as exc:
        raise RuntimeError(_unwrap(exc)) from exc
    rows = body.get("records") or body.get("result") or []
    return {
        "table": table, "incident_status": status, "incident_count": len(rows),
        "numbers": [r.get("number") for r in rows if isinstance(r, dict)], "ci_name": ci_name, "keyword": keyword,
    }


_DETAIL_FIELDS = ["number", "short_description", "state", "priority", "assigned_to", "opened_at"]


def read_record_detail(creds: dict, table: str, number: str) -> dict:
    try:
        body = _run(_call_tool(creds, "list_records", {
            "table": table, "query": f"number={number}", "limit": 1, "fields": _DETAIL_FIELDS, "display_value": True,
        }))
    except Exception as exc:
        raise RuntimeError(_unwrap(exc)) from exc
    rows = body.get("records") or body.get("result") or []
    if not rows:
        return {"incident_not_found": number}
    r = rows[0]
    return {
        "table": table, "incident_detail": True, "number": r.get("number"), "short_description": r.get("short_description"),
        "state": r.get("state"), "priority": r.get("priority"), "assigned_to": r.get("assigned_to") or "unassigned",
        "opened_at": r.get("opened_at"),
    }


def read_attachments(creds: dict, table: str, number: str) -> dict:
    sys_id = _find_record_sys_id(creds, table, number)
    if not sys_id:
        return {"incident_not_found": number}
    try:
        body = _run(_call_tool(creds, "list_records", {
            "table": "sys_attachment", "query": f"table_sys_id={sys_id}^table_name={table}",
            "limit": 20, "fields": ["file_name", "size_bytes"],
        }))
    except Exception as exc:
        raise RuntimeError(_unwrap(exc)) from exc
    rows = body.get("records") or body.get("result") or []
    return {
        "attachments_for": number, "attachment_count": len(rows),
        "attachment_names": [r.get("file_name") for r in rows if isinstance(r, dict)],
    }


def read_servicenow(creds: dict, table: str, query_type: str, params: dict) -> dict:
    """Single entry point platform_connect.py calls for any ServiceNow
    read against the MCP backend -- dispatches to whichever of the above
    the parsed intent (list/detail/attachments), against whichever table
    (Incident/Problem/Change Request/Request Item/Knowledge Article),
    actually asked for."""
    if query_type == "attachments":
        return read_attachments(creds, table, params["incident_number"])
    if query_type == "detail":
        return read_record_detail(creds, table, params["incident_number"])
    return read_records(creds, table, params.get("status", "open"), params.get("ci_name"), params.get("keyword"))


def create_record(creds: dict, table: str, short_description: str) -> dict:
    try:
        body = _run(_call_tool(creds, "create_record", {
            "table": table,
            "data": {"short_description": short_description[:160], "urgency": "2", "impact": "2"},
        }))
    except Exception as exc:
        raise RuntimeError(_unwrap(exc)) from exc
    record = body.get("record") or body.get("result") or body
    return {"table": table, "action": "create_incident", "number": record.get("number"), "sys_id": record.get("sys_id")}


# Which ServiceNow state a "resolve"/"close"/"cancel" action means, in
# words -- the actual numeric value is looked up live from the instance's
# own sys_choice metadata (see _resolve_choice_value), never hardcoded:
# it varies by table and can be customized per instance. The same lookup
# also handles free-text choice fields like priority/urgency.
_LIFECYCLE_LABEL_KEYWORDS = {"resolve": ["resolved"], "close": ["closed"], "cancel": ["cancelled", "canceled"]}


def _resolve_choice_value(creds: dict, table: str, field: str, label_keywords: list[str]) -> str:
    body = _run(_call_tool(creds, "list_records", {
        "table": "sys_choice", "query": f"name={table}^element={field}", "limit": 50, "fields": ["value", "label"],
    }))
    rows = body.get("records") or body.get("result") or []
    for row in rows:
        if not isinstance(row, dict):
            continue
        row_label = (row.get("label") or "").lower()
        if any(kw in row_label or row_label in kw for kw in label_keywords):
            return row["value"]
    raise ValueError(f"I couldn't match {label_keywords[0]!r} to a real {field} value for {table} on this instance.")


def _find_record_sys_id(creds: dict, table: str, number: str) -> str | None:
    body = _run(_call_tool(creds, "list_records", {
        "table": table, "query": f"number={number}", "limit": 1, "fields": ["sys_id"],
    }))
    rows = body.get("records") or body.get("result") or []
    return rows[0].get("sys_id") if rows else None


def _find_user_sys_id(creds: dict, name: str) -> tuple[str, str] | None:
    body = _run(_call_tool(creds, "list_records", {
        "table": "sys_user", "query": f"nameLIKE{name}", "limit": 1, "fields": ["sys_id", "name"],
    }))
    rows = body.get("records") or body.get("result") or []
    return (rows[0]["sys_id"], rows[0]["name"]) if rows else None


def perform_record_action(creds: dict, table: str, action: str, intent: dict, message: str) -> dict:
    """The MCP-backed equivalent of platform_connect.py's _write_impl --
    same lifecycle actions (create/update/assign/resolve/close/cancel/
    delete), against whichever table was detected, driven through the
    ServiceNow MCP server's generic Table API tools instead of our own
    httpx calls."""
    try:
        if action == "create":
            return create_record(creds, table, llm.resolve_incident_summary(intent, message))

        number = intent.get("incident_number")
        if not number:
            raise ValueError(f"I need the record number (e.g. INC0010086) to {action} it.")
        sys_id = _find_record_sys_id(creds, table, number)
        if not sys_id:
            raise ValueError(f"I couldn't find a record numbered {number}.")

        if action == "update":
            fields = dict(intent.get("fields", {}))
            for choice_field, label in intent.get("choice_updates", {}).items():
                fields[choice_field] = _resolve_choice_value(creds, table, choice_field, [label.lower()])
            _run(_call_tool(creds, "update_record", {"table": table, "sys_id": sys_id, "data": fields}))
            return {"table": table, "action": "update_incident", "number": number, "fields": fields}

        if action == "assign":
            assignee = intent.get("assignee")
            found = _find_user_sys_id(creds, assignee) if assignee else None
            if not found:
                raise ValueError(f"I couldn't find a ServiceNow user matching '{assignee}'.")
            user_sys_id, user_display_name = found
            _run(_call_tool(creds, "update_record", {"table": table, "sys_id": sys_id, "data": {"assigned_to": user_sys_id}}))
            return {"table": table, "action": "assign_incident", "number": number, "assignee": user_display_name}

        if action in _LIFECYCLE_LABEL_KEYWORDS:
            fields = {"state": _resolve_choice_value(creds, table, "state", _LIFECYCLE_LABEL_KEYWORDS[action])}
            if action in ("resolve", "close"):
                fields["close_notes"] = "Resolved via Tachyon Aura Agent Factory."
            _run(_call_tool(creds, "update_record", {"table": table, "sys_id": sys_id, "data": fields}))
            return {"table": table, "action": f"{action}_incident", "number": number}

        if action == "delete":
            _run(_call_tool(creds, "delete_record", {"table": table, "sys_id": sys_id}))
            return {"table": table, "action": "delete_incident", "number": number}

        raise ValueError(f"unsupported ServiceNow action: {action}")
    except ValueError:
        raise
    except Exception as exc:
        raise RuntimeError(_unwrap(exc)) from exc
