"""Per-platform specs for "Connect via MCP" -- Salesforce, Databricks,
Snowflake, Oracle, and Microsoft 365 each already connect via
platform_connect.py's token/OAuth path; this is a second, alternative
connection method for each, mirroring ServiceNow's existing OAuth/MCP
option (servicenow_mcp.py) but over the generic HTTP transport in
mcp_client.py, since that's the transport every vendor's real 2026 MCP
offering actually uses (a managed, hosted endpoint), not a locally-spawned
subprocess.

This module is intentionally standalone -- it knows nothing about
platform_connect._connections or session storage. platform_connect.py
imports THIS module (one direction only) and does the actual credential
storage itself, since it already owns that dict; keeping the connect/
smoke-test/read logic here and the storage there avoids a circular import.

No live credentials exist for any of these five vendors' MCP servers to
test against, so smoke_test()/read() lean on the MCP protocol's own
list_tools() rather than guessing a vendor-specific tool name the way
servicenow_mcp.py does for one known community package -- that keeps this
honest (a real, verifiable connection) even though the exact "best" tool
to call for a read can't be confirmed here.
"""

from . import mcp_client

# "<platform>_mcp" auth-option key -> the base PlatformId it connects,
# exactly the convention servicenow_oauth already uses for "servicenow".
BASE_PLATFORM = {
    "salesforce_mcp": "salesforce",
    "databricks_mcp": "databricks",
    "snowflake_mcp": "snowflake",
    "oracle_mcp": "oracle",
    "m365_mcp": "m365",
}

_FIELDS = ["mcp_url", "access_token"]

CONNECTOR_SPECS = {
    "salesforce_mcp": {
        "label": "Salesforce (MCP)",
        "fields": _FIELDS,
        "example": "connect salesforce_mcp https://<org>.my.salesforce.com/mcp <access_token>",
        "instructions": (
            "To connect Salesforce via MCP:\n"
            "1. Enable the Salesforce Hosted MCP Server for your org (Enterprise Edition and above) — "
            "see salesforce.com/agentforce/mcp-support/model-context-protocol\n"
            "2. Note its MCP endpoint URL and obtain an access token (OAuth 2.0 + PKCE per Salesforce's docs).\n"
            "3. Tell me: connect salesforce_mcp <mcp_url> <access_token>"
        ),
    },
    "databricks_mcp": {
        "label": "Databricks (MCP)",
        "fields": _FIELDS,
        "example": "connect databricks_mcp https://<workspace>/api/mcp <access_token>",
        "instructions": (
            "To connect Databricks via MCP:\n"
            "1. Enable a Managed MCP server on your workspace — see "
            "docs.databricks.com/aws/en/generative-ai/mcp\n"
            "2. Note its Streamable HTTP endpoint URL and a personal access token.\n"
            "3. Tell me: connect databricks_mcp <mcp_url> <access_token>"
        ),
    },
    "snowflake_mcp": {
        "label": "Snowflake (MCP)",
        "fields": _FIELDS,
        "example": "connect snowflake_mcp https://<account>.snowflakecomputing.com/mcp <access_token>",
        "instructions": (
            "To connect Snowflake via MCP:\n"
            "1. Enable Snowflake's managed MCP server — see "
            "snowflake.com/en/developers/guides/getting-started-with-snowflake-mcp-server\n"
            "2. Note its endpoint URL and an access token.\n"
            "3. Tell me: connect snowflake_mcp <mcp_url> <access_token>"
        ),
    },
    "oracle_mcp": {
        "label": "Oracle (MCP)",
        "fields": _FIELDS,
        "example": "connect oracle_mcp https://<region>.oci.oraclecloud.com/mcp <access_token>",
        "instructions": (
            "To connect Oracle via MCP:\n"
            "1. Provision the OCI Database Tools MCP Server — see "
            "docs.oracle.com/en-us/iaas/releasenotes/database-tools/mcp.htm\n"
            "2. Note its endpoint URL and an OAuth2 access token from your IAM Identity Domain.\n"
            "3. Tell me: connect oracle_mcp <mcp_url> <access_token>"
        ),
    },
    "m365_mcp": {
        "label": "Microsoft 365 (MCP)",
        "fields": _FIELDS,
        "example": "connect m365_mcp https://graph.microsoft.com/mcp <access_token>",
        "instructions": (
            "To connect Microsoft 365 via MCP:\n"
            "1. Enable the Microsoft Graph MCP Server for your tenant — see "
            "learn.microsoft.com/en-us/graph/mcp-server/overview\n"
            "2. Note its endpoint URL and a Graph-scoped access token.\n"
            "3. Tell me: connect m365_mcp <mcp_url> <access_token>"
        ),
    },
}


_FIELD_LABELS = {"mcp_url": "MCP URL", "access_token": "Access Token"}


def form_fields(platform: str) -> list[dict]:
    return [
        {"name": f, "label": _FIELD_LABELS.get(f, f.replace("_", " ").title()), "type": "password" if "token" in f else "text"}
        for f in CONNECTOR_SPECS[platform]["fields"]
    ]


_READ_KEYWORDS = ("query", "list", "search", "get", "read", "find", "fetch")


def _pick_read_tool(tools: list[dict]) -> dict | None:
    for t in tools:
        haystack = f"{t['name']} {t['description']}".lower()
        if any(kw in haystack for kw in _READ_KEYWORDS):
            return t
    return tools[0] if tools else None


def smoke_test(creds: dict) -> tuple[bool, str]:
    try:
        tools = mcp_client.list_tools_http(creds["mcp_url"], creds["access_token"])
    except Exception as exc:
        return False, str(exc)
    return True, f"connected — {len(tools)} tool(s) available"


def read(creds: dict) -> dict:
    tools = mcp_client.list_tools_http(creds["mcp_url"], creds["access_token"])
    if not tools:
        return {"mcp_tools_available": 0, "note": "connected, but this server exposes no tools"}
    chosen = _pick_read_tool(tools)
    result = mcp_client.call_tool_http(creds["mcp_url"], creds["access_token"], chosen["name"], {})
    return {"mcp_tool_called": chosen["name"], "mcp_tools_available": len(tools), "result": result}
