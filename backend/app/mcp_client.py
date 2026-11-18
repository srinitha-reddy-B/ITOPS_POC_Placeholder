"""Generic MCP client helpers shared by every "Connect via MCP" option added
after ServiceNow's. ServiceNow keeps its own module (servicenow_mcp.py)
because it launches a local stdio subprocess with vendor-specific CLI args
against one specific community package; every platform since then
(Salesforce/Databricks/Snowflake/Oracle/M365) connects to a remote, managed
MCP endpoint instead -- that's where every major vendor actually points
production users as of 2026: a hosted endpoint plus a bearer token, not
something to spawn locally. See platform_mcp.py for the per-platform specs
built on top of this.

Same "fresh connection per call, no long-lived session" reasoning as
servicenow_mcp.py: request handlers here are synchronous and per-request,
so there's no natural place to keep a session alive across calls anyway.
"""

import asyncio
import json

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

_TIMEOUT_S = 30


def _run(coro):
    return asyncio.run(asyncio.wait_for(coro, timeout=_TIMEOUT_S))


def _unwrap(exc: BaseException) -> str:
    """anyio wraps failures from its internal task groups in an
    ExceptionGroup, so the top-level message is a useless "unhandled
    errors in a TaskGroup (1 sub-exception)" -- surface the real cause
    instead, recursing through nested groups. Same fix as servicenow_mcp.py."""
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    return str(exc) or type(exc).__name__


async def _with_session(url: str, token: str, fn):
    headers = {"Authorization": f"Bearer {token}"} if token else None
    async with streamablehttp_client(url, headers=headers) as (read, write, _get_session_id):
        async with ClientSession(read, write) as session:
            await session.initialize()
            return await fn(session)


def list_tools_http(url: str, token: str) -> list[dict]:
    """Real proof of a live connection -- the MCP protocol's own tool
    listing, not a vendor-specific guess about what this server exposes.
    No live credentials exist here for any of these five vendors' MCP
    servers, so this is deliberately protocol-generic rather than assuming
    a fixed tool name the way servicenow_mcp.py does for one known package."""

    async def _list(session):
        result = await session.list_tools()
        return [{"name": t.name, "description": t.description or ""} for t in result.tools]

    try:
        return _run(_with_session(url, token, _list))
    except Exception as exc:
        raise RuntimeError(_unwrap(exc)) from exc


def call_tool_http(url: str, token: str, tool: str, arguments: dict) -> dict:
    async def _call(session):
        result = await session.call_tool(tool, arguments)
        if result.isError:
            text = "; ".join(getattr(c, "text", str(c)) for c in result.content)
            raise RuntimeError(text or f"MCP tool '{tool}' call failed")
        for c in result.content:
            text = getattr(c, "text", None)
            if text:
                try:
                    return json.loads(text)
                except ValueError:
                    return {"text": text}
        return {}

    try:
        return _run(_with_session(url, token, _call))
    except Exception as exc:
        raise RuntimeError(_unwrap(exc)) from exc
