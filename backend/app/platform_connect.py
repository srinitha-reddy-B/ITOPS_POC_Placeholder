"""Interactive, chat-driven connections for the five platforms that don't
need a browser OAuth redirect (Salesforce does -- see salesforce_connect.py).
These authenticate with a token/password the user pastes straight into
chat via `connect <platform> <field1> <field2> ...`, which main.py parses
and routes to `connect()` below. Each connect attempt makes one real,
read-only smoke-test call before being accepted, so a typo'd credential
fails immediately instead of silently "connecting."

Real reads are wired for all five. Real writes are wired only for
ServiceNow (creating an Incident is a safe, standard action every instance
has); Databricks/Snowflake/Oracle/M365 writes stay mocked because a generic
write would have to assume a business table/list that doesn't exist -- see
mock_platforms.py and agent_runtime.py.

Oracle is the one platform here with no simple token-auth REST SQL
endpoint (Databricks/Snowflake both expose one), so it talks straight to
the database over the `oracledb` driver in "thin" mode -- pure Python, no
Oracle Instant Client install required.
"""

import httpx
import oracledb

from . import llm, platform_mcp, servicenow_mcp

SERVICENOW_TABLE_LABELS = {table: meta["label"] for table, meta in llm.SERVICENOW_TABLES.items()}
SERVICENOW_CREATABLE = {table: meta["creatable"] for table, meta in llm.SERVICENOW_TABLES.items()}

CONNECTOR_SPECS = {
    "servicenow": {
        "label": "ServiceNow",
        "fields": ["instance_url", "username", "password"],
        "example": "connect servicenow https://devXXXXX.service-now.com admin MyPassword123",
        "instructions": (
            "To connect ServiceNow:\n"
            "1. Get admin access to a ServiceNow instance (a free Personal Developer Instance works — "
            "developer.servicenow.com).\n"
            "2. Use an account that can read/write the Incident table.\n"
            "3. Tell me: connect servicenow <instance_url> <username> <password>"
        ),
    },
    "databricks": {
        "label": "Databricks",
        "fields": ["host", "token", "warehouse_id"],
        "example": "connect databricks https://dbc-xxxx.cloud.databricks.com dapiXXXX 0123456789abcdef",
        "instructions": (
            "To connect Databricks:\n"
            "1. In your workspace: User Settings → Developer → Access tokens → Generate new token.\n"
            "2. SQL Warehouses → your warehouse → copy its Warehouse ID.\n"
            "3. Tell me: connect databricks <workspace-host> <token> <warehouse_id>\n"
            "(reads run a live connectivity query — I don't know your table names yet, so tell me the "
            "table/query you want once we're connected)"
        ),
    },
    "snowflake": {
        "label": "Snowflake",
        "fields": ["account", "token", "warehouse"],
        "example": "connect snowflake xy12345.us-east-1 <programmatic-access-token> COMPUTE_WH",
        "instructions": (
            "To connect Snowflake:\n"
            "1. In Snowsight: your name → Settings → Authentication → Programmatic access tokens → "
            "Generate new token.\n"
            "2. Note your account identifier (e.g. xy12345.us-east-1) and a warehouse you can use.\n"
            "3. Tell me: connect snowflake <account> <token> <warehouse>"
        ),
    },
    "m365": {
        "label": "Microsoft 365",
        "fields": ["tenant_id", "client_id", "client_secret"],
        "example": "connect m365 <tenant_id> <client_id> <client_secret>",
        "instructions": (
            "To connect Microsoft 365 / SharePoint:\n"
            "1. Azure Portal → Entra ID → App registrations → New registration.\n"
            "2. API permissions (Application) → add Sites.Read.All (Microsoft Graph) → grant admin consent.\n"
            "3. Certificates & secrets → New client secret → copy the value immediately.\n"
            "4. Tell me: connect m365 <tenant_id> <client_id> <client_secret>"
        ),
    },
    "oracle": {
        "label": "Oracle",
        "fields": ["dsn", "username", "password"],
        "example": "connect oracle dbhost.example.com:1521/ORCLPDB1 app_user MyPassword123",
        "instructions": (
            "To connect Oracle:\n"
            "1. Get a user/password with SELECT (and ideally minimal write) grants on the schema you want.\n"
            "2. Note the connection string as host:port/service_name (ask your DBA if unsure).\n"
            "3. Make sure this server can reach the DB host/port (no VPN-only network in the way).\n"
            "4. Tell me: connect oracle <host:port/service_name> <username> <password>"
        ),
    },
}

# session_id -> platform -> creds dict
_connections: dict[str, dict[str, dict]] = {}


def instructions_for(platform: str) -> str:
    return CONNECTOR_SPECS[platform]["instructions"]


def form_fields(platform: str) -> list[dict]:
    """Field metadata for rendering an actual clickable connect form in
    chat, instead of asking the user to type a `connect ...` command."""
    return [
        {
            "name": f,
            "label": f.replace("_", " ").title(),
            "type": "password" if any(k in f for k in ("token", "password", "secret")) else "text",
        }
        for f in CONNECTOR_SPECS[platform]["fields"]
    ]


def is_connected(session_id: str, platform: str) -> bool:
    return platform in _connections.get(session_id, {})


def connect_from_fields(session_id: str, platform: str, fields: dict) -> dict:
    """Returns {"reply": str, "action": dict|None}."""
    args = [fields.get(f, "") for f in CONNECTOR_SPECS[platform]["fields"]]
    return connect(session_id, platform, args)


def admin_deep_link(platform: str, creds: dict) -> dict | None:
    """A one-click link straight into the right admin screen on the user's
    OWN instance -- opened in their own authenticated browser session, not
    through our (currently broken) credential. Only returned where the URL
    pattern is one I'm actually confident is stable and correct; guessing
    wrong here would be worse than saying nothing."""
    if platform == "servicenow" and creds.get("instance_url"):
        return {
            "type": "open_link",
            "label": "Open ServiceNow Users list",
            "url": f"{creds['instance_url'].rstrip('/')}/nav_to.do?uri=sys_user_list.do",
        }
    return None


def connect_servicenow_oauth(session_id: str, args: list[str]) -> dict:
    """A second, alternate ServiceNow connection path -- OAuth through a
    real ServiceNow MCP server instead of our own Basic Auth REST calls.
    Stores into the same _connections[session_id]["servicenow"] slot as
    the regular connect() path (just with a "backend": "mcp" marker) so
    routing/is_connected/read/write elsewhere don't need to know which
    path was used -- see servicenow_mcp.py for why this exists."""
    args = [a.strip() if isinstance(a, str) else a for a in args]
    fields = servicenow_mcp.FIELDS
    if len(args) < len(fields) or not all(args[: len(fields)]):
        return {
            "reply": f"I need {len(fields)} value(s): {', '.join(fields)}.\ne.g. {servicenow_mcp.EXAMPLE}",
            "action": None,
        }
    creds = dict(zip(fields, args))
    ok, detail = servicenow_mcp.smoke_test(creds)
    if not ok:
        return {"reply": f"Couldn't connect to ServiceNow via OAuth/MCP — {detail}", "action": admin_deep_link("servicenow", creds)}
    _connections.setdefault(session_id, {})["servicenow"] = {**creds, "backend": "mcp"}
    return {"reply": "Connected to ServiceNow via OAuth (through its MCP server) for real. Ask the agent something.", "action": None}


def connect_servicenow_oauth_from_fields(session_id: str, fields: dict) -> dict:
    args = [fields.get(f, "") for f in servicenow_mcp.FIELDS]
    return connect_servicenow_oauth(session_id, args)


def connect(session_id: str, platform: str, args: list[str]) -> dict:
    """Returns {"reply": str, "action": dict|None}."""
    spec = CONNECTOR_SPECS[platform]
    fields = spec["fields"]
    args = [a.strip() if isinstance(a, str) else a for a in args]
    if len(args) < len(fields) or not all(args[: len(fields)]):
        return {
            "reply": f"I need {len(fields)} value(s) for {spec['label']}: {', '.join(fields)}.\ne.g. {spec['example']}",
            "action": None,
        }
    creds = dict(zip(fields, args))
    ok, detail = _smoke_test(platform, creds)
    if not ok:
        return {"reply": f"Couldn't connect to {spec['label']} — {detail}", "action": admin_deep_link(platform, creds)}
    _connections.setdefault(session_id, {})[platform] = creds
    return {"reply": f"Connected to {spec['label']} for real. Ask the agent something.", "action": None}


def connect_mcp(session_id: str, platform: str, args: list[str]) -> dict:
    """Generic "Connect via MCP" flow for the five platforms whose primary
    connector lives in this file but which also expose a real MCP server
    -- see platform_mcp.py. Mirrors connect() above exactly, just against
    a different CONNECTOR_SPECS/smoke_test source, and stores into the
    SAME _connections[session_id][<base platform>] slot (tagged
    "backend": "mcp") that connect_servicenow_oauth already uses, so
    is_connected()/disconnect()/_annotate_blueprint's connection_status all
    keep working unmodified."""
    spec = platform_mcp.CONNECTOR_SPECS[platform]
    fields = spec["fields"]
    args = [a.strip() if isinstance(a, str) else a for a in args]
    if len(args) < len(fields) or not all(args[: len(fields)]):
        return {
            "reply": f"I need {len(fields)} value(s) for {spec['label']}: {', '.join(fields)}.\ne.g. {spec['example']}",
            "action": None,
        }
    creds = dict(zip(fields, args))
    ok, detail = platform_mcp.smoke_test(creds)
    if not ok:
        return {"reply": f"Couldn't connect to {spec['label']} — {detail}", "action": None}
    base_platform = platform_mcp.BASE_PLATFORM[platform]
    _connections.setdefault(session_id, {})[base_platform] = {**creds, "backend": "mcp"}
    return {"reply": f"Connected to {spec['label']} for real. Ask the agent something.", "action": None}


def connect_mcp_from_fields(session_id: str, platform: str, fields: dict) -> dict:
    args = [fields.get(f, "") for f in platform_mcp.CONNECTOR_SPECS[platform]["fields"]]
    return connect_mcp(session_id, platform, args)


def mcp_read(session_id: str, platform: str) -> dict:
    """For a platform that has its own bespoke connector module and never
    goes through read()/_read_impl at all (Salesforce, via salesforce_connect.py)
    -- lets agent_runtime dispatch an MCP-backed read without reaching into
    _connections directly, keeping that dict's shape an implementation detail
    of this module."""
    creds = _connections[session_id][platform]
    return platform_mcp.read(creds)


class AuthExpired(Exception):
    """A platform call failed with 401/403 -- the stored credential is no
    longer valid. These platforms use static tokens/passwords (no OAuth
    refresh), so the only recovery is asking the user to reconnect with a
    fresh credential, not retrying automatically."""


def disconnect(session_id: str, platform: str) -> None:
    _connections.get(session_id, {}).pop(platform, None)


class BadResponse(Exception):
    """The call returned a 2xx status but the body wasn't the JSON we
    expected. This is NOT the same as a rejected credential (401/403) --
    it usually means something between the request and the API (an SSO
    redirect, an access policy) intercepted it, and a raw JSONDecodeError
    ("Expecting value: line 1 column 1") would otherwise tell the user
    nothing about why. `remediation` carries platform-specific steps to
    fix the actual cause, when known -- reconnecting alone won't help."""

    def __init__(self, message: str, remediation: str | None = None):
        super().__init__(message)
        self.remediation = remediation


# Confirmed against ServiceNow's own docs (Community "Eliminating Basic Auth
# Across All Inbound Surfaces" + REST API Access Policy docs): a 200 with an
# HTML body on a Basic-Auth REST call almost always means SSO/MFA or a REST
# API Access Policy intercepted the request before Basic Auth was evaluated
# -- not a wrong password, which would normally 401 instead.
SERVICENOW_HTML_REMEDIATION = (
    "This isn't a wrong password -- something intercepted the request before Basic Auth was even "
    "checked. On your ServiceNow instance, check:\n"
    "1. User Administration → Users → the account you connected with → enable \"Web Service Access "
    "Only\" (exempts it from SSO/UI login redirects on API calls).\n"
    "2. System Web Services → REST API Access Policies → if a policy applies to this API, confirm "
    "Basic Auth is actually included as an allowed method (newer instances can explicitly block it).\n"
    "3. If SSO/MFA is enforced instance-wide, that policy may need this integration account excluded."
)


def _safe_json(resp: httpx.Response, platform: str):
    try:
        return resp.json()
    except ValueError:
        body = resp.text.strip()
        label = CONNECTOR_SPECS[platform]["label"]
        remediation = None
        if not body:
            hint = "the response body was empty"
        elif body.startswith("<"):
            hint = "got an HTML page back instead of JSON"
            remediation = SERVICENOW_HTML_REMEDIATION if platform == "servicenow" else None
        else:
            hint = f"got a non-JSON response: {body[:150]!r}"
        raise BadResponse(f"{label} {hint}.", remediation)


def _check_auth(session_id: str, platform: str, fn):
    try:
        return fn()
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        if status == 401:
            # The credential itself is no longer valid -- only case where
            # disconnecting and asking to reconnect actually helps.
            disconnect(session_id, platform)
            raise AuthExpired(f"Your {CONNECTOR_SPECS[platform]['label']} credentials were rejected (HTTP 401).") from exc
        if status == 403:
            # A valid credential can still be denied a specific operation by
            # an ACL/business rule (e.g. hard-delete is often blocked for
            # integration accounts even when create/update/read work fine).
            # Disconnecting here would send the user to "reconnect" for a
            # problem reconnecting can't fix.
            raise ValueError(
                f"{CONNECTOR_SPECS[platform]['label']} rejected that specific action (HTTP 403) -- your credentials "
                "are still valid, but this account's permissions don't allow it."
            ) from exc
        raise
    except oracledb.DatabaseError as exc:
        # ORA-01017 invalid username/password, ORA-28000/ORA-28001 account
        # locked/expired -- the same "static credential, no refresh, ask to
        # reconnect" case the 401 branch above handles for the REST platforms.
        (error_obj,) = exc.args
        if getattr(error_obj, "code", None) in (1017, 28000, 28001):
            disconnect(session_id, platform)
            raise AuthExpired(f"Your Oracle credentials were rejected ({error_obj.message.strip()}).") from exc
        raise


def read(session_id: str, platform: str, params: dict) -> dict:
    return _check_auth(session_id, platform, lambda: _read_impl(session_id, platform, params))


_STATUS_QUERY = {"open": "active=true", "closed": "active=false", "all": ""}


def _read_impl(session_id: str, platform: str, params: dict) -> dict:
    creds = _connections[session_id][platform]
    if platform != "servicenow" and creds.get("backend") == "mcp":
        # Salesforce/Databricks/Snowflake/Oracle/M365 connected via
        # platform_mcp.py instead of this file's own token/OAuth path --
        # see connect_mcp() above for how creds land in this same slot.
        return platform_mcp.read(creds)
    if platform == "servicenow":
        table = params.get("table", "incident")
        query_type = params.get("query_type", "list")
        if creds.get("backend") == "mcp":
            return servicenow_mcp.read_servicenow(creds, table, query_type, params)
        if query_type == "attachments":
            return _read_attachments(creds, table, params["incident_number"])
        if query_type == "detail":
            return _read_record_detail(creds, table, params["incident_number"])
        status = params.get("status", "open")
        ci_name = params.get("ci_name")
        keyword = params.get("keyword")
        query = _STATUS_QUERY.get(status, "active=true")
        if ci_name:
            # Dot-walk onto the record's Configuration Item reference
            # field to scope the count/list to just that CI, instead of
            # always returning every record regardless of what CI (if
            # any) was actually named in the question.
            query = f"{query}^cmdb_ci.nameLIKE{ci_name}" if query else f"cmdb_ci.nameLIKE{ci_name}"
        elif keyword:
            # Free-text search over the record's own description, for a
            # topic ("incidents related to DB issues") instead of a CI.
            query = f"{query}^short_descriptionLIKE{keyword}" if query else f"short_descriptionLIKE{keyword}"
        resp = httpx.get(
            f"{creds['instance_url']}/api/now/table/{table}",
            params={"sysparm_limit": 5, "sysparm_query": query},
            auth=(creds["username"], creds["password"]),
            headers={"Accept": "application/json"},
            timeout=15.0,
        )
        resp.raise_for_status()
        rows = _safe_json(resp, platform).get("result", [])
        return {
            "table": table, "incident_status": status, "incident_count": len(rows),
            "numbers": [r["number"] for r in rows], "ci_name": ci_name, "keyword": keyword,
        }

    if platform == "databricks":
        return _run_sql_databricks(creds, "SELECT current_date() AS today, current_user() AS who")

    if platform == "snowflake":
        return _run_sql_snowflake(creds, "SELECT CURRENT_USER() AS who, CURRENT_ACCOUNT() AS account, CURRENT_TIMESTAMP() AS at")

    if platform == "oracle":
        return _run_sql_oracle(creds, "SELECT USER AS who, SYS_CONTEXT('USERENV', 'DB_NAME') AS db_name, SYSDATE AS at FROM DUAL")

    if platform == "m365":
        token = _graph_token(creds)
        resp = httpx.get(
            "https://graph.microsoft.com/v1.0/organization",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=15.0,
        )
        resp.raise_for_status()
        orgs = _safe_json(resp, platform).get("value", [])
        return {"organization": orgs[0]["displayName"] if orgs else "unknown", "tenant_id": creds["tenant_id"]}

    raise ValueError(f"no real read implemented for {platform}")


def write(session_id: str, platform: str, intent: dict, message: str) -> dict:
    if platform != "servicenow":
        raise NotImplementedError(
            f"real writes for {CONNECTOR_SPECS[platform]['label']} aren't wired yet — "
            "would need to know which table/list to write to"
        )
    return _check_auth(session_id, platform, lambda: _write_impl(session_id, intent, message))


# Which ServiceNow state a "resolve"/"close"/"cancel" action means, in
# words -- the ACTUAL numeric value is never hardcoded (it varies by
# table and can be customized per instance). _resolve_choice_value below
# looks the real number up live from the instance's own sys_choice
# metadata for whichever table/field this write is against -- the same
# mechanism handles the `state` field for lifecycle actions AND free-text
# choice fields like priority/urgency (see llm._SERVICENOW_CHOICE_FIELDS).
_LIFECYCLE_LABEL_KEYWORDS = {"resolve": ["resolved"], "close": ["closed"], "cancel": ["cancelled", "canceled"]}


def _resolve_choice_value(creds: dict, table: str, field: str, label_keywords: list[str]) -> str:
    resp = httpx.get(
        f"{creds['instance_url']}/api/now/table/sys_choice",
        params={"sysparm_query": f"name={table}^element={field}", "sysparm_fields": "value,label", "sysparm_limit": 50},
        auth=(creds["username"], creds["password"]),
        headers={"Accept": "application/json"},
        timeout=15.0,
    )
    resp.raise_for_status()
    rows = _safe_json(resp, "servicenow").get("result", [])
    for row in rows:
        row_label = row.get("label", "").lower()
        if any(kw in row_label or row_label in kw for kw in label_keywords):
            return row["value"]
    table_label = SERVICENOW_TABLE_LABELS.get(table, table)
    raise ValueError(f"I couldn't match {label_keywords[0]!r} to a real {field} value for {table_label} on this instance.")


def _write_impl(session_id: str, intent: dict, message: str) -> dict:
    creds = _connections[session_id]["servicenow"]
    table = intent.get("table", "incident")
    action = intent.get("action", "create")
    if creds.get("backend") == "mcp":
        return servicenow_mcp.perform_record_action(creds, table, action, intent, message)

    if action == "create":
        if not SERVICENOW_CREATABLE.get(table, True):
            label = SERVICENOW_TABLE_LABELS.get(table, table)
            raise ValueError(f"I can look up {label}s, but creating one needs fields I can't safely guess yet.")
        short_description = llm.resolve_incident_summary(intent, message)
        body = _patch_or_post_record(creds, table, "POST", None, {
            "short_description": short_description, "urgency": "2", "impact": "2",
        })
        return {"table": table, "action": "create_incident", "number": body.get("number"), "sys_id": body.get("sys_id")}

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
        _patch_or_post_record(creds, table, "PATCH", sys_id, fields)
        return {"table": table, "action": "update_incident", "number": number, "fields": fields}

    if action == "assign":
        assignee = intent.get("assignee")
        found = _find_user_sys_id(creds, assignee) if assignee else None
        if not found:
            raise ValueError(f"I couldn't find a ServiceNow user matching '{assignee}'.")
        user_sys_id, user_display_name = found
        _patch_or_post_record(creds, table, "PATCH", sys_id, {"assigned_to": user_sys_id})
        return {"table": table, "action": "assign_incident", "number": number, "assignee": user_display_name}

    if action in _LIFECYCLE_LABEL_KEYWORDS:
        fields = {"state": _resolve_choice_value(creds, table, "state", _LIFECYCLE_LABEL_KEYWORDS[action])}
        if action in ("resolve", "close"):
            fields["close_notes"] = "Resolved via Tachyon Aura Agent Factory."
        _patch_or_post_record(creds, table, "PATCH", sys_id, fields)
        return {"table": table, "action": f"{action}_incident", "number": number}

    if action == "delete":
        resp = httpx.delete(
            f"{creds['instance_url']}/api/now/table/{table}/{sys_id}",
            auth=(creds["username"], creds["password"]),
            headers={"Accept": "application/json"},
            timeout=15.0,
        )
        resp.raise_for_status()
        return {"table": table, "action": "delete_incident", "number": number}

    raise ValueError(f"unsupported ServiceNow action: {action}")


def _patch_or_post_record(creds: dict, table: str, method: str, sys_id: str | None, fields: dict) -> dict:
    url = f"{creds['instance_url']}/api/now/table/{table}" + (f"/{sys_id}" if sys_id else "")
    resp = httpx.request(
        method, url, json=fields,
        auth=(creds["username"], creds["password"]),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        timeout=15.0,
    )
    resp.raise_for_status()
    return _safe_json(resp, "servicenow")["result"]


_DETAIL_FIELDS = "number,short_description,state,priority,assigned_to,opened_at"


def _read_record_detail(creds: dict, table: str, number: str) -> dict:
    resp = httpx.get(
        f"{creds['instance_url']}/api/now/table/{table}",
        params={
            "sysparm_query": f"number={number}", "sysparm_limit": 1,
            "sysparm_fields": _DETAIL_FIELDS, "sysparm_display_value": "true",
        },
        auth=(creds["username"], creds["password"]),
        headers={"Accept": "application/json"},
        timeout=15.0,
    )
    resp.raise_for_status()
    rows = _safe_json(resp, "servicenow").get("result", [])
    if not rows:
        return {"incident_not_found": number}
    r = rows[0]
    return {
        "table": table, "incident_detail": True, "number": r.get("number"), "short_description": r.get("short_description"),
        "state": r.get("state"), "priority": r.get("priority"), "assigned_to": r.get("assigned_to") or "unassigned",
        "opened_at": r.get("opened_at"),
    }


def _read_attachments(creds: dict, table: str, number: str) -> dict:
    sys_id = _find_record_sys_id(creds, table, number)
    if not sys_id:
        return {"incident_not_found": number}
    resp = httpx.get(
        f"{creds['instance_url']}/api/now/table/sys_attachment",
        params={"sysparm_query": f"table_sys_id={sys_id}^table_name={table}", "sysparm_fields": "file_name,size_bytes"},
        auth=(creds["username"], creds["password"]),
        headers={"Accept": "application/json"},
        timeout=15.0,
    )
    resp.raise_for_status()
    rows = _safe_json(resp, "servicenow").get("result", [])
    return {
        "attachments_for": number, "attachment_count": len(rows),
        "attachment_names": [r.get("file_name") for r in rows],
    }


def _find_record_sys_id(creds: dict, table: str, number: str) -> str | None:
    resp = httpx.get(
        f"{creds['instance_url']}/api/now/table/{table}",
        params={"sysparm_query": f"number={number}", "sysparm_limit": 1, "sysparm_fields": "sys_id,number"},
        auth=(creds["username"], creds["password"]),
        headers={"Accept": "application/json"},
        timeout=15.0,
    )
    resp.raise_for_status()
    rows = _safe_json(resp, "servicenow").get("result", [])
    return rows[0]["sys_id"] if rows else None


def _find_user_sys_id(creds: dict, name: str) -> tuple[str, str] | None:
    resp = httpx.get(
        f"{creds['instance_url']}/api/now/table/sys_user",
        params={"sysparm_query": f"nameLIKE{name}", "sysparm_limit": 1, "sysparm_fields": "sys_id,name"},
        auth=(creds["username"], creds["password"]),
        headers={"Accept": "application/json"},
        timeout=15.0,
    )
    resp.raise_for_status()
    rows = _safe_json(resp, "servicenow").get("result", [])
    return (rows[0]["sys_id"], rows[0]["name"]) if rows else None


def _smoke_test(platform: str, creds: dict) -> tuple[bool, str]:
    try:
        if platform == "servicenow":
            resp = httpx.get(
                f"{creds['instance_url']}/api/now/table/incident",
                params={"sysparm_limit": 1},
                auth=(creds["username"], creds["password"]),
                headers={"Accept": "application/json"},
                timeout=10.0,
            )
            resp.raise_for_status()
            _safe_json(resp, platform)  # a 200 with an HTML login page must fail here, not later
        elif platform == "databricks":
            _run_sql_databricks(creds, "SELECT 1")
        elif platform == "snowflake":
            _run_sql_snowflake(creds, "SELECT 1")
        elif platform == "oracle":
            _run_sql_oracle(creds, "SELECT 1 FROM DUAL")
        elif platform == "m365":
            _graph_token(creds)
        return True, "ok"
    except BadResponse as exc:
        detail = str(exc) + (f"\n\n{exc.remediation}" if exc.remediation else "")
        return False, detail
    except httpx.HTTPStatusError as exc:
        return False, f"HTTP {exc.response.status_code}: {exc.response.text[:200]}"
    except Exception as exc:
        return False, str(exc)


def _run_sql_databricks(creds: dict, sql: str) -> dict:
    resp = httpx.post(
        f"{creds['host'].rstrip('/')}/api/2.0/sql/statements",
        json={"statement": sql, "warehouse_id": creds["warehouse_id"], "wait_timeout": "10s"},
        headers={"Authorization": f"Bearer {creds['token']}", "Accept": "application/json"},
        timeout=20.0,
    )
    resp.raise_for_status()
    body = _safe_json(resp, "databricks")
    columns = [c["name"] for c in body.get("manifest", {}).get("schema", {}).get("columns", [])]
    rows = body.get("result", {}).get("data_array", [])
    return {"columns": columns, "rows": rows}


def _run_sql_snowflake(creds: dict, sql: str) -> dict:
    resp = httpx.post(
        f"https://{creds['account']}.snowflakecomputing.com/api/v2/statements",
        json={"statement": sql, "warehouse": creds["warehouse"], "timeout": 10},
        headers={
            "Authorization": f"Bearer {creds['token']}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        timeout=20.0,
    )
    resp.raise_for_status()
    body = _safe_json(resp, "snowflake")
    columns = [c["name"] for c in body.get("resultSetMetaData", {}).get("rowType", [])]
    return {"columns": columns, "rows": body.get("data", [])}


def _run_sql_oracle(creds: dict, sql: str) -> dict:
    # `thin` mode (the oracledb default) speaks Oracle's wire protocol
    # directly -- no Oracle Instant Client / libclntsh needed on this host.
    with oracledb.connect(dsn=creds["dsn"], user=creds["username"], password=creds["password"]) as conn:
        with conn.cursor() as cursor:
            cursor.execute(sql)
            columns = [col.name for col in cursor.description]
            rows = [list(row) for row in cursor.fetchall()]
    return {"columns": columns, "rows": rows}


def _graph_token(creds: dict) -> str:
    resp = httpx.post(
        f"https://login.microsoftonline.com/{creds['tenant_id']}/oauth2/v2.0/token",
        data={
            "grant_type": "client_credentials",
            "client_id": creds["client_id"],
            "client_secret": creds["client_secret"],
            "scope": "https://graph.microsoft.com/.default",
        },
        timeout=10.0,
    )
    resp.raise_for_status()
    return _safe_json(resp, "m365")["access_token"]
