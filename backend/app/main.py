"""Tachyon Aura Agent Factory.

Not the real Aura platform -- a standalone app built on Aura's underlying
idea (a root orchestrator handing off to platform-specific specialist
agents, built from a reviewable blueprint), with no dependency on the real
AURA-Agent-Orchestrator service.

Single entry point: whatever the user types or pastes (a process
description, an SOP excerpt) is treated as context, automatically turned
into a proposed multi-agent blueprint (FR9-FR11), refined conversationally
(FR12). On approval, each specialist agent is built and deployed straight
onto its own target platform (FR13) and immediately usable against
Salesforce / Databricks / Snowflake / ServiceNow / Microsoft 365 tools
(FR3/FR14), with every step traced (FR6).

The first time an agent needs a platform, if that platform isn't connected
yet it interactively walks the user through connecting it right there in
chat -- setup instructions plus a "connect <platform> <credentials...>"
command for the four token/password platforms, an OAuth "Connect to
Salesforce" button for Salesforce -- rather than silently faking data.
Saying "use mock data" opts a session back into fake data for a quick demo.

API only: the UI lives in ../frontend, which serves the pages and proxies
/api/* and /connect/* here.

Run: uv run uvicorn app.main:app --port 8001 --reload
"""

import json
import re
import uuid
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, Request, UploadFile
from fastapi.responses import JSONResponse
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

load_dotenv(Path(__file__).parent.parent / ".env")

from . import agent_runtime, deploy, itops_jira, itops_servicenow, knowledge, llm, maf_scaffold, platform_connect, platform_mcp, salesforce_connect, servicenow_mcp, state_store, trace_store
from . import p32_metrics as p32_metrics_mod
from . import p32_rca as p32_rca_mod
from . import p32_workbench as p32_workbench_mod
from . import p32_domains  # noqa: F401  (registers the asset and HR agents and tools)
from . import p32_predictive  # noqa: F401  (registers the predictive agents and tools)
from . import p32_frontdoor as p32_frontdoor_mod
from . import p32_access as p32_access_mod
from .ops import api as ops_api  # Crystal Clean Ops Console (IT Administrator portal); settings are read at import, after .env is loaded
from . import cc_hub
from . import cc_identity

app = FastAPI(title="Tachyon Aura Agent Factory")
app.include_router(ops_api.router)  # /api/ops/*, the IT Administrator's Ops Console


@app.on_event("startup")
def _ops_startup() -> None:
    try:
        ops_api.init()  # playbooks, demo services, samplers
    except Exception as exc:  # the rest of the app must keep working if a lab service can't start
        print(f"[ops] console services did not fully start: {type(exc).__name__}: {exc}")


@app.get("/metrics", include_in_schema=False)
def ops_metrics():
    """Prometheus scrape target for the Ops Console (backup results, sign-in counters, lab state)."""
    return ops_api.metrics_response()

_SESSIONS: dict[str, dict] = state_store.load()

_APPROVE_RE = re.compile(r"\b(approve|approved|looks good|go ahead|build it|deploy( it)?|confirm|create it)\b", re.I)
_RESET_RE = re.compile(r"^\s*(reset|start over|new session)\s*$", re.I)
_CONNECT_RE = re.compile(r"^\s*connect\s+(\w+)(?:\s+(.+))?$", re.I)
_USE_MOCK_RE = re.compile(r"\b(use mock( data)?|demo mode|skip connecting)\b", re.I)
_USE_REAL_RE = re.compile(r"\b(use real data|stop mock mode|exit demo mode)\b", re.I)
_EXPAND_CONFIRM_RE = re.compile(r"\b(yes|yeah|sure|add it|add (it |them )?in|do it|go ahead)\b", re.I)
# "I need an agent that..." / "create an agent named..." is unambiguously a
# request to build a NEW agent -- even once other agents are already live,
# and even if the platform it names is already covered by an existing one
# (e.g. a second, more narrowly-scoped Salesforce agent). Without this,
# that phrasing was falling through to operational routing and getting
# misassigned to whichever existing agent scored highest.
_NEW_AGENT_RE = re.compile(
    r"\b(i need (a|an|another)\s+agent|create (a|an|another)\s+agent|build (a|an|another)\s+agent|"
    r"add (a|an|another)\s+agent|new agent (named|called)|agent named)\b", re.I,
)
_APPROVE_WORDS = ["approve", "approved", "confirm", "confirmed"]


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (0 if ca == cb else 1))
        prev = curr
    return prev[len(b)]


def _looks_like_approve(message: str) -> bool:
    """Matches the exact approve phrases, plus a typo like "approcve" for a
    one-word reply -- a mistyped approval shouldn't be silently reinterpreted
    as a request to change the blueprint."""
    if _APPROVE_RE.search(message):
        return True
    word = message.strip().lower()
    if " " in word or len(word) < 4:
        return False
    return any(_levenshtein(word, w) <= 2 for w in _APPROVE_WORDS)

_WELCOME = (
    "Tell me about a business process, or paste an SOP, and I'll propose the agents needed to run it — "
    "who they are, what they hand off to a human for, and which systems they read and write. "
    "Once you approve, they go live immediately. The first time an agent needs a platform you haven't "
    "connected, I'll walk you through connecting it right here (or say \"use mock data\" for a quick demo)."
)


class ChatRequest(BaseModel):
    session_id: str
    message: str
    agent_name: str | None = None  # set when the user is talking to one specific agent's own chat


@app.get("/")
def index():
    """API only. The pages are served by the frontend (cd frontend; npm run dev)."""
    return {
        "service": "Tachyon Aura Agent Factory API",
        "ui": "Served by the frontend: cd frontend; npm run dev, then open http://localhost:3000 (Point32Health: /p32).",
        "docs": "/docs",
    }


def _new_session() -> dict:
    return {
        "phase": "gather", "context": "", "blueprint": None, "pending_write": None,
        "mock_mode": False, "pending_expansion": None, "last_agent": None,
        "chatbot_name": None, "onboarded": False, "default_language": "en",
        "who_builds": None, "experience_level": None, "timeframe": None,
    }


@app.post("/api/session")
def create_session():
    session_id = uuid.uuid4().hex[:12]
    _SESSIONS[session_id] = _new_session()
    return {"session_id": session_id, "welcome": _WELCOME, "llm_mode": "llm" if llm.llm_available() else "heuristic"}


@app.get("/api/session/{session_id}")
def resume_session(session_id: str):
    """Lets the browser reconnect to a session it already has (localStorage)
    instead of always starting fresh on reload -- without this, refreshing
    the page loses every agent you'd already built."""
    session = _SESSIONS.get(session_id)
    if session is None:
        return {"found": False}
    if session["phase"] == "live" and session["blueprint"]:
        names = ", ".join(p["name"] for p in session["blueprint"]["root_agent"]["participants"])
        note = f"Reconnected — your agents are still live: {names}. Ask them something."
    elif session["phase"] == "awaiting_approval":
        note = "Reconnected — you still have a blueprint proposal waiting on your approval."
    else:
        note = _WELCOME
    return {
        "found": True,
        "note": note,
        "phase": session["phase"],
        "blueprint": _annotate_blueprint(session["blueprint"], session_id, session["mock_mode"]),
        "trace": trace_store.get_trace(session_id),
        "llm_mode": "llm" if llm.llm_available() else "heuristic",
        "chatbot_name": session.get("chatbot_name"),
    }


@app.post("/api/chat")
def chat(req: ChatRequest):
    session = _SESSIONS.setdefault(req.session_id, _new_session())
    response = _handle_chat(req.session_id, session, req.message, req.agent_name)
    response["blueprint"] = _annotate_blueprint(response["blueprint"], req.session_id, session["mock_mode"])
    state_store.save(_SESSIONS)
    return response


def _annotate_blueprint(blueprint: dict | None, session_id: str, mock_mode: bool) -> dict | None:
    """Adds a connection_status to each participant so the agents panel can
    show, per agent, whether it's live/mock/needs-connecting -- without
    mutating the stored blueprint itself."""
    if not blueprint:
        return blueprint
    bp = json.loads(json.dumps(blueprint))
    for p in bp["root_agent"]["participants"]:
        platform = p["platform"]
        if platform == "human":
            status = "n/a"
        elif mock_mode:
            status = "mock"
        elif platform == "salesforce":
            # Two independent connection mechanisms for the same platform --
            # native OAuth (salesforce_connect.py) or Connect via MCP
            # (platform_mcp.py, stored through platform_connect.py since
            # Salesforce isn't in its own CONNECTOR_SPECS) -- either counts.
            status = "connected" if (salesforce_connect.is_connected(session_id) or platform_connect.is_connected(session_id, "salesforce")) else "needs connection"
        elif platform in platform_connect.CONNECTOR_SPECS:
            status = "connected" if platform_connect.is_connected(session_id, platform) else "needs connection"
        else:
            status = "unknown"
        p["connection_status"] = status
    return bp


def _handle_chat(session_id: str, session: dict, message: str, agent_name: str | None = None) -> dict:
    if _RESET_RE.match(message):
        trace_store.clear(session_id)
        session.update(_new_session())
        return {"reply": _WELCOME, "phase": "gather", "blueprint": None, "trace": [], "action": None}

    _APPROVE_ACTION = {"type": "confirm_button", "label": "Approve", "message": "approve"}

    if session["phase"] == "gather":
        reply, blueprint = _propose(session_id, message, prior=None)
        session["context"] = message
        session["blueprint"] = blueprint
        session["phase"] = "awaiting_approval"
        return {"reply": reply, "phase": session["phase"], "blueprint": blueprint, "trace": trace_store.get_trace(session_id), "action": _APPROVE_ACTION}

    if session["phase"] == "awaiting_approval":
        if _looks_like_approve(message):
            reply = _build(session_id, session["blueprint"])
            session["phase"] = "live"
            return {"reply": reply, "phase": session["phase"], "blueprint": session["blueprint"], "trace": trace_store.get_trace(session_id), "action": None}

        reply, blueprint = _propose(session_id, session["context"], prior=session["blueprint"], change_request=message)
        session["blueprint"] = blueprint
        return {"reply": reply, "phase": session["phase"], "blueprint": blueprint, "trace": trace_store.get_trace(session_id), "action": _APPROVE_ACTION}

    if session.get("pending_expansion"):
        platform = session["pending_expansion"]
        session["pending_expansion"] = None
        if _EXPAND_CONFIRM_RE.search(message):
            reply, blueprint = _propose(
                session_id, session["context"], prior=session["blueprint"],
                change_request=f"add a {platform} specialist agent with read and write actions for {platform}",
            )
            session["blueprint"] = blueprint
            session["phase"] = "awaiting_approval"
            return {"reply": reply, "phase": session["phase"], "blueprint": blueprint, "trace": trace_store.get_trace(session_id), "action": _APPROVE_ACTION}
        # not a confirmation -- drop the offer and handle this message normally below

    if not session["pending_write"] and _NEW_AGENT_RE.search(message):
        # "I need an agent that..." always means build a new one -- even
        # once agents are already live, and even if the platform it names
        # is already covered by an existing agent (e.g. a second, more
        # narrowly-scoped one). Don't let this get treated as an
        # operational request to whichever existing agent scores highest.
        reply, blueprint = _propose(session_id, session["context"], prior=session["blueprint"], change_request=message)
        session["blueprint"] = blueprint
        session["phase"] = "awaiting_approval"
        return {"reply": reply, "phase": session["phase"], "blueprint": blueprint, "trace": trace_store.get_trace(session_id), "action": _APPROVE_ACTION}

    connect_reply = _try_handle_connect_or_mode(session_id, session, message)
    if connect_reply is not None:
        return {**connect_reply, "phase": session["phase"], "blueprint": session["blueprint"], "trace": trace_store.get_trace(session_id)}

    result = agent_runtime.handle_message(
        session_id, message, session["blueprint"], session["pending_write"], session["mock_mode"],
        forced_agent=agent_name, last_agent=session.get("last_agent"),
    )
    session["pending_write"] = result["pending_write"]
    session["pending_expansion"] = result.get("propose_platform")
    if result.get("last_agent"):
        session["last_agent"] = result["last_agent"]
    return {
        "reply": result["reply"],
        "phase": session["phase"],
        "blueprint": session["blueprint"],
        "trace": trace_store.get_trace(session_id),
        "action": result["action"],
    }


@app.get("/api/trace/{session_id}")
def get_trace(session_id: str):
    return {"trace": trace_store.get_trace(session_id)}


@app.get("/connect/salesforce/callback")
def salesforce_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    if not state:
        return HTMLResponse(_popup_result_page(False, "Salesforce didn't authorize the connection (missing state)."), status_code=400)
    session_id, host, retried = salesforce_connect.parse_state(state)

    if error == "invalid_client_id" and not retried:
        # This Client ID doesn't exist on `host` -- automatically retry the
        # other host (production <-> sandbox) in this same popup, once,
        # before concluding the Client ID itself is wrong. No need for the
        # user to know or specify which kind of org they have.
        other = salesforce_connect.other_host(host)
        org_label = "Sandbox" if other == "https://test.salesforce.com" else "Production"
        retry_url = salesforce_connect.authorize_url(session_id, host=other, retried=True)
        return HTMLResponse(_auto_retry_page(retry_url, org_label))

    if error or not code:
        detail = "neither Production nor Sandbox recognized that Consumer Key/Secret" if error == "invalid_client_id" else error
        return HTMLResponse(_popup_result_page(False, f"Salesforce didn't authorize the connection ({detail})."), status_code=400)

    try:
        org_label = salesforce_connect.complete_connection(code, host, session_id)
    except Exception as exc:
        return HTMLResponse(_popup_result_page(False, f"Token exchange failed: {exc}"), status_code=502)
    state_store.save(_SESSIONS)
    return HTMLResponse(_popup_result_page(True, f"Connected to your {org_label} Salesforce org."))


def _popup_result_page(success: bool, message: str) -> str:
    """A tiny page the OAuth popup lands on: tells the main chat window it's
    done via postMessage, then closes itself -- so connecting really is just
    click, log in, and the popup vanishes with the chat already reconnected,
    no manual tab-switching or copy-pasting anything back."""
    payload = {"type": "aura_connected" if success else "aura_connect_failed", "platform": "salesforce", "message": message}
    return f"""<!doctype html><html><body style="font-family:sans-serif;padding:2rem;">
<p>{message}</p>
<script>
  if (window.opener) {{ window.opener.postMessage({json.dumps(payload)}, '*'); }}
  setTimeout(() => window.close(), 800);
</script>
</body></html>"""


def _auto_retry_page(retry_url: str, org_label: str) -> str:
    """Shown for an instant inside the popup while it automatically flips to
    the other login host -- this is the "figure it out and show what it is"
    step, not a dead end the user has to react to."""
    return f"""<!doctype html><html><body style="font-family:sans-serif;padding:2rem;">
<p>That Consumer Key isn't a Production org — trying your {org_label} org instead…</p>
<script>window.location.href = {json.dumps(retry_url)};</script>
</body></html>"""


class ConnectRequest(BaseModel):
    session_id: str
    platform: str
    fields: dict


@app.post("/api/connect")
def connect(req: ConnectRequest):
    """Backs the inline connect forms rendered in chat (agent_runtime's
    "form" actions) -- a real click-to-submit flow instead of typing a
    `connect <platform> ...` command. The text command in
    _try_handle_connect_or_mode still works too; both call the same
    underlying configure()/connect() functions."""
    if req.platform == "salesforce":
        client_id = req.fields.get("client_id", "")
        client_secret = req.fields.get("client_secret", "")
        if not client_id or not client_secret:
            response = {"reply": "I need both the Consumer Key and Consumer Secret.", "action": None}
        else:
            salesforce_connect.configure(client_id, client_secret)
            response = {
                "reply": "Salesforce app configured. Opening the login popup — log in there and you're connected.",
                "action": {"type": "oauth_popup", "label": "Connect to Salesforce", "url": salesforce_connect.authorize_url(req.session_id)},
            }
    elif req.platform == "servicenow_oauth":
        response = platform_connect.connect_servicenow_oauth_from_fields(req.session_id, req.fields)
    elif req.platform in platform_connect.CONNECTOR_SPECS:
        response = platform_connect.connect_from_fields(req.session_id, req.platform, req.fields)
    elif req.platform in platform_mcp.CONNECTOR_SPECS:
        response = platform_connect.connect_mcp_from_fields(req.session_id, req.platform, req.fields)
    else:
        response = {"reply": f"Unknown platform '{req.platform}'.", "action": None}
    state_store.save(_SESSIONS)
    return response


# ------------------------------------------------------- agentic itops (live ServiceNow)


class ItopsSnowRequest(BaseModel):
    op: str
    payload: dict = {}


_ITSM = {"servicenow": itops_servicenow, "jira": itops_jira}


@app.get("/api/itops/{itsm}/status")
def itops_itsm_status(itsm: str):
    """Whether the Agentic ITOps page can run live against the selected ticketing
    system (ServiceNow or Jira, configured in .env) -- otherwise it uses the sandbox."""
    mod = _ITSM.get(itsm)
    return mod.status() if mod else {"live": False, "reason": f"unknown ticketing system '{itsm}'"}


@app.post("/api/itops/{itsm}")
def itops_itsm_op(itsm: str, req: ItopsSnowRequest):
    """One live write-back step (create incident, note, attach SOP PDF, change,
    resolve...) against the selected ticketing system. Always returns {ok, ...};
    failures come back as {ok: false, error} so the page can fall back."""
    mod = _ITSM.get(itsm)
    return mod.run(req.op, req.payload) if mod else {"ok": False, "error": f"unknown ticketing system '{itsm}'"}


# ------------------------------------------- Point32Health POC: LLM RCA


@app.post("/api/p32/rca")
def p32_rca(req: ItopsSnowRequest):
    """LLM-generated RCA + SOP for the POC incident. payload: {sys_id?, incident?, ci?, evidence[]}.
    Always returns {ok, ...}; on failure the POC falls back to its scripted RCA."""
    return p32_rca_mod.generate(req.payload)


@app.post("/api/p32/frontdoor")
def p32_frontdoor(req: ItopsSnowRequest):
    """Digital FrontDoor: AI intent routing and the session employee's own incidents.
    ops: route {text}, whoami, my_incidents, incident_status {number}, raise_incident {...}.
    Always returns {ok, ...}; identity is resolved server-side, never from the payload."""
    return p32_frontdoor_mod.run(req.op, req.payload)


@app.post("/api/p32/access")
def p32_access(req: ItopsSnowRequest, x_p32_role: str | None = Header(default=None)):
    """Sign-in help: login (Keycloak), raise_ticket, list_requests, decide (IT manager only), status, simulate_outage."""
    return p32_access_mod.run(req.op, req.payload, x_p32_role)


# ------------------------------------------- Crystal Clean Service Hub


class CcText(BaseModel):
    text: str = ""


def _cc(fn):
    """Consistent errors for the hub: 403 role/identity, 400 bad input, 503 not configured, 502 upstream."""
    try:
        return fn()
    except cc_hub.Forbidden as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=403)
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except itops_servicenow.NotConfigured as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=503)
    except Exception as exc:  # upstream failures
        return JSONResponse({"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:300]}"}, status_code=502)


@app.get("/api/cc/hub")
def cc_hub_view(x_cc_user: str | None = Header(default=None)):
    """Employee front door: the employee's alerts and requests (plain language only)."""
    return _cc(lambda: cc_hub.hub(x_cc_user))


@app.post("/api/cc/chat")
def cc_chat(req: CcText, x_cc_user: str | None = Header(default=None)):
    return _cc(lambda: cc_hub.chat(x_cc_user, req.text))


@app.post("/api/cc/alerts/{alert_id}/act")
def cc_alert_act(alert_id: str, x_cc_user: str | None = Header(default=None)):
    return _cc(lambda: cc_hub.act_on_alert(x_cc_user, alert_id))


@app.post("/api/cc/alerts/{alert_id}/dismiss")
def cc_alert_dismiss(alert_id: str, x_cc_user: str | None = Header(default=None)):
    return _cc(lambda: cc_hub.dismiss(x_cc_user, alert_id))


@app.get("/api/cc/ops")
def cc_ops(x_cc_role: str | None = Header(default=None)):
    """IT view: the hub's ServiceNow incidents, what happened on each, predictions and systems."""
    return _cc(lambda: cc_hub.ops(x_cc_role))


@app.get("/api/cc/ops/notes/{sys_id}")
def cc_notes(sys_id: str, x_cc_role: str | None = Header(default=None)):
    """Work notes and comments as ServiceNow holds them now."""
    return _cc(lambda: cc_hub.notes(x_cc_role, sys_id))


@app.post("/api/cc/demo/{action}")
def cc_demo(action: str, x_cc_role: str | None = Header(default=None)):
    """Stage a scenario (lockout, storage, outage) or reset. IT role only."""
    return _cc(lambda: cc_hub.demo(x_cc_role, action))


class CcDecision(BaseModel):
    decision: str


@app.post("/api/cc/ops/approve/{run_id}")
def cc_approve(run_id: str, req: CcDecision, x_cc_role: str | None = Header(default=None)):
    """IT approves or rejects a fix that affects other users (IT role only)."""
    return _cc(lambda: cc_hub.approve(x_cc_role, run_id, req.decision))


# ------------------------- Crystal Clean Workforce Identity & SSO (Keycloak OIDC)


def _sso(fn):
    """401 not signed in, 403 signed in but not allowed, 503 not configured, 502 Keycloak unreachable."""
    try:
        return fn()
    except cc_identity.NotSignedIn as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=401)
    except cc_identity.AccessDenied as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=403)
    except cc_identity.NotConfigured as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=503)
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001 -- Keycloak unreachable or an unexpected upstream reply
        return JSONResponse({"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:300]}"}, status_code=502)


class SsoLogin(BaseModel):
    persona: str


@app.get("/api/cc/identity/status")
def cc_sso_status():
    """Live Keycloak health, client, personas and events, plus this backend's own demo counters and timeline."""
    return _sso(cc_identity.status)


@app.post("/api/cc/identity/login")
def cc_sso_login(req: SsoLogin, x_forwarded_proto: str | None = Header(default=None), x_forwarded_host: str | None = Header(default=None)):
    """Starts a real Keycloak sign-in for a persona: returns the authorization URL to open."""
    return _sso(lambda: cc_identity.start_login(req.persona, cc_identity.app_origin(x_forwarded_proto, x_forwarded_host)))


@app.get("/api/cc/identity/callback")
def cc_sso_callback(request: Request):
    """Keycloak redirects here. Tokens stay on the server; the browser gets an opaque HttpOnly cookie."""
    try:
        html, sid = cc_identity.callback(dict(request.query_params))
    except Exception as exc:  # noqa: BLE001
        return HTMLResponse(f"<p>Sign-in failed: {type(exc).__name__}</p>", status_code=502)
    resp = HTMLResponse(html)
    if sid:
        resp.set_cookie(cc_identity.COOKIE, sid, max_age=cc_identity.SESSION_TTL_S, httponly=True, samesite="lax", path="/api/cc/identity")
    return resp


@app.get("/api/cc/identity/attempt/{attempt_id}")
def cc_sso_attempt(attempt_id: str):
    return _sso(lambda: cc_identity.attempt(attempt_id))


@app.get("/api/cc/identity/session")
def cc_sso_session(request: Request):
    return _sso(lambda: cc_identity.session(request.cookies.get(cc_identity.COOKIE)))


@app.post("/api/cc/identity/logout")
def cc_sso_logout(request: Request):
    """Switch persona: ends the Keycloak session (back-channel) and clears the app session cookie."""
    out = _sso(lambda: cc_identity.logout(request.cookies.get(cc_identity.COOKIE)))
    resp = out if isinstance(out, JSONResponse) else JSONResponse(out)
    resp.delete_cookie(cc_identity.COOKIE, path="/api/cc/identity")
    return resp


@app.get("/api/cc/identity/protected/workspace")
def cc_sso_protected(request: Request, authorization: str | None = Header(default=None)):
    """A protected employee API: needs the session cookie or a Bearer token from this client, a live Keycloak
    session, an enabled account and the Employee role. Everything is checked here, not in the browser."""
    bearer = authorization[7:].strip() if authorization and authorization.lower().startswith("bearer ") else None
    return _sso(lambda: cc_identity.protected_workspace(request.cookies.get(cc_identity.COOKIE), bearer))


# ------------------------------- Point32Health Agentic Incident Workbench


class WbAgentRequest(BaseModel):
    run_id: str
    agent: str
    context: dict = {}
    incident: str = ""


class WbToolRequest(BaseModel):
    run_id: str
    tool: str
    args: dict = {}


class WbApprovalRequest(BaseModel):
    run_id: str
    gate: str
    decision: str
    feedback: str = ""
    approver: str = "Engineer"


@app.get("/api/p32/wb/status")
def p32_wb_status():
    return p32_workbench_mod.status()


@app.post("/api/p32/wb/agent")
def p32_wb_agent(req: WbAgentRequest):
    """One agent step: the agent's own LLM call with validated JSON output. Never substitutes content on failure."""
    return p32_workbench_mod.run_agent(req.run_id, req.agent, req.context, req.incident)


@app.post("/api/p32/wb/tool")
def p32_wb_tool(req: WbToolRequest):
    """ServiceNow tools. Writes are checked against the approvals recorded server-side for the run."""
    return p32_workbench_mod.run_tool(req.run_id, req.tool, req.args)


@app.post("/api/p32/wb/approval")
def p32_wb_approval(req: WbApprovalRequest, x_p32_role: str | None = Header(default=None)):
    try:
        out = p32_workbench_mod.record_approval(req.run_id, req.gate, req.decision, req.feedback, req.approver, x_p32_role)
    except ValueError as exc:
        out = {"ok": False, "kind": "bad_request", "error": str(exc)}
    return out if out.get("ok") else JSONResponse(out, status_code=403 if out.get("kind") == "forbidden" else 400)


@app.get("/api/p32/wb/runs")
def p32_wb_runs():
    return p32_workbench_mod.list_runs()


@app.put("/api/p32/wb/runs/{run_id}")
def p32_wb_save_run(run_id: str, snapshot: dict):
    try:
        return p32_workbench_mod.save_run(run_id, snapshot)
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)


@app.delete("/api/p32/wb/runs")
def p32_wb_reset():
    return p32_workbench_mod.reset_runs()


@app.get("/api/p32/wb/snow-map")
def p32_wb_snow_map():
    return p32_workbench_mod.snow_map()


@app.post("/api/p32/wb/seed")
def p32_wb_seed(x_p32_confirm: str | None = Header(default=None)):
    """Creates the 25 curated demo incidents in ServiceNow. Requires an explicit confirmation header."""
    return p32_workbench_mod.seed_curated(x_p32_confirm)


def _p32_guarded(fn):
    """Run a read-only metrics call with consistent errors: 403 role, 503 not configured, 502 upstream."""
    try:
        return fn()
    except p32_metrics_mod.Forbidden as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=403)
    except itops_servicenow.NotConfigured as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=503)
    except Exception as exc:  # upstream ServiceNow / parsing failures
        return JSONResponse({"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:300]}"}, status_code=502)


@app.get("/api/p32/ops-metrics")
def p32_ops_metrics(days: int = 90, x_p32_role: str | None = Header(default=None)):
    """CIO Control Tower: IT operations KPIs from the live ServiceNow instance (read-only).
    Every value is classified live / calculated / unavailable; nothing is simulated here."""
    return _p32_guarded(lambda: p32_metrics_mod.ops_metrics(days, x_p32_role))


@app.get("/api/p32/ai-usage")
def p32_ai_usage(days: int | None = None, x_p32_role: str | None = Header(default=None)):
    """Actual LLM usage (provider-reported tokens) and costs at configured or labelled prices."""
    return _p32_guarded(lambda: p32_metrics_mod.ai_usage(x_p32_role, days))


# ------------------------------------------------------------- onboarding


class OnboardingRequest(BaseModel):
    session_id: str
    chatbot_name: str
    default_language: str = "en"
    who_builds: str | None = None
    experience_level: str | None = None
    timeframe: str | None = None


@app.post("/api/onboarding")
def onboarding(req: OnboardingRequest):
    """First-run wizard submission -- purely session-level branding/prefs,
    no effect on routing or blueprints. `chatbot_name` replaces "Aura" in
    the topbar once set (falls back to the default when never onboarded)."""
    session = _SESSIONS.setdefault(req.session_id, _new_session())
    session["chatbot_name"] = req.chatbot_name.strip() or None
    session["default_language"] = req.default_language
    session["who_builds"] = req.who_builds
    session["experience_level"] = req.experience_level
    session["timeframe"] = req.timeframe
    session["onboarded"] = True
    state_store.save(_SESSIONS)
    return {"reply": f"Welcome to {session['chatbot_name'] or 'Aura'}!", "chatbot_name": session["chatbot_name"]}


@app.get("/api/onboarding/suggest-name")
def onboarding_suggest_name():
    names, generated_by = llm.suggest_chatbot_names()
    return {"names": names, "generated_by": generated_by}


# ------------------------------------------------------------- marketplace


class MarketplaceSearchRequest(BaseModel):
    session_id: str
    query: str


@app.post("/api/marketplace/search")
def marketplace_search(req: MarketplaceSearchRequest):
    result = llm.generate_marketplace_templates(req.query)
    trace_store.record(
        req.session_id,
        trace_store.new_event(
            "build", "Marketplace", f"searched \"{req.query}\" -> {len(result.get('templates', []))} template(s)",
            180, decision=f"generated_by={result.get('generated_by', 'heuristic')}",
        ),
    )
    return result


class MarketplaceApplyRequest(BaseModel):
    session_id: str
    blueprint: dict


@app.post("/api/marketplace/apply")
def marketplace_apply(req: MarketplaceApplyRequest):
    """Loads a ready-made template straight into the session -- the same
    envelope shape /api/chat returns, so the frontend can feed it through
    the exact same applyResponse() path a normal chat turn uses. Reuses the
    entire existing approve -> _build -> deploy pipeline with no changes."""
    session = _SESSIONS.setdefault(req.session_id, _new_session())
    session["blueprint"] = req.blueprint
    session["phase"] = "awaiting_approval"
    session["context"] = req.blueprint.get("description", "") or session["context"]
    repo_name = req.blueprint.get("repo_name", "template")
    trace_store.record(
        req.session_id,
        trace_store.new_event(
            "build", "Marketplace", f"applied template \"{repo_name}\"",
            50, decision="user applied a marketplace template",
        ),
    )
    state_store.save(_SESSIONS)
    return {
        "reply": f"Applied the \"{repo_name}\" template. Review it below and say \"approve\" to build it.",
        "phase": session["phase"],
        "blueprint": _annotate_blueprint(session["blueprint"], req.session_id, session["mock_mode"]),
        "trace": trace_store.get_trace(req.session_id),
        "action": {"type": "confirm_button", "label": "Approve", "message": "approve"},
    }


# --------------------------------------------------------- knowledge base


class KnowledgeUrlRequest(BaseModel):
    session_id: str
    url: str


def _source_public(entry: dict) -> dict:
    return {k: v for k, v in entry.items() if k != "text"}


@app.post("/api/knowledge/url")
def knowledge_add_url(req: KnowledgeUrlRequest):
    try:
        text = knowledge.fetch_webpage_text(req.url)
        entry = knowledge.add_source(req.session_id, req.url, text)
    except Exception as exc:
        return {"reply": f"Couldn't read that page: {exc}", "source": None}
    return {"reply": f"Learned from {req.url} ({entry['stored_chars']} characters).", "source": _source_public(entry)}


@app.post("/api/knowledge/upload")
async def knowledge_upload(session_id: str = Form(...), file: UploadFile = File(...)):
    try:
        content = await file.read()
        filename = file.filename or "upload"
        text = knowledge.extract_document_text(filename, content)
        entry = knowledge.add_source(session_id, filename, text)
    except Exception as exc:
        return {"reply": f"Couldn't read that file: {exc}", "source": None}
    return {"reply": f"Learned from {filename} ({entry['stored_chars']} characters).", "source": _source_public(entry)}


@app.get("/api/knowledge/{session_id}")
def knowledge_list(session_id: str):
    return {"sources": knowledge.list_sources(session_id)}


@app.delete("/api/knowledge/{session_id}/{source_id}")
def knowledge_delete(session_id: str, source_id: str):
    return {"removed": knowledge.remove_source(session_id, source_id)}


def _try_handle_connect_or_mode(session_id: str, session: dict, message: str) -> dict | None:
    if _USE_MOCK_RE.search(message):
        session["mock_mode"] = True
        return {"reply": "Switched to mock data for this session — agents will use fake data instead of asking you to connect.", "action": None}

    if _USE_REAL_RE.search(message):
        session["mock_mode"] = False
        return {"reply": "Switched back to real connections — agents will ask you to connect a platform before using it.", "action": None}

    m = _CONNECT_RE.match(message)
    if not m:
        return None
    platform = m.group(1).lower()
    args = m.group(2).split() if m.group(2) else []

    if platform == "salesforce":
        if len(args) < 2:
            # A masked form (password-style input, not visible chat text)
            # instead of asking the user to type their Consumer Secret
            # into the chat -- this is also what re-enters fresh
            # credentials when the app already thinks it's "configured"
            # (even with bad values), since that state otherwise skips
            # straight to the OAuth button with no way to fix the key.
            return {
                "reply": "Let's set (or fix) your Salesforce Connected App credentials:",
                "action": {"type": "form", "platform": "salesforce", "label": "Connect Salesforce", "fields": salesforce_connect.SETUP_FORM_FIELDS},
            }
        salesforce_connect.configure(args[0], args[1])
        return {
            "reply": "Salesforce app configured. Now authorize access to your org:",
            "action": {"type": "oauth_popup", "label": "Connect to Salesforce", "url": salesforce_connect.authorize_url(session_id)},
        }

    if platform == "servicenow_oauth":
        if len(args) < len(servicenow_mcp.FIELDS):
            return {
                "reply": "Let's set your ServiceNow OAuth/MCP credentials:",
                "action": {"type": "form", "platform": "servicenow_oauth", "label": "Connect ServiceNow via OAuth/MCP", "fields": servicenow_mcp.form_fields()},
            }
        return platform_connect.connect_servicenow_oauth(session_id, args)

    if platform in platform_connect.CONNECTOR_SPECS:
        fields = platform_connect.CONNECTOR_SPECS[platform]["fields"]
        if len(args) < len(fields):
            # A masked form (password-style inputs, not visible chat
            # text) instead of asking the user to type tokens/passwords
            # into the chat -- same reasoning as the Salesforce form above.
            label = platform_connect.CONNECTOR_SPECS[platform]["label"]
            return {
                "reply": f"Let's set your {label} credentials:",
                "action": {"type": "form", "platform": platform, "label": f"Connect {label}", "fields": platform_connect.form_fields(platform)},
            }
        return platform_connect.connect(session_id, platform, args)

    if platform in platform_mcp.CONNECTOR_SPECS:
        fields = platform_mcp.CONNECTOR_SPECS[platform]["fields"]
        if len(args) < len(fields):
            label = platform_mcp.CONNECTOR_SPECS[platform]["label"]
            return {
                "reply": f"Let's set your {label} credentials:",
                "action": {"type": "form", "platform": platform, "label": f"Connect {label}", "fields": platform_mcp.form_fields(platform)},
            }
        return platform_connect.connect_mcp(session_id, platform, args)

    return {
        "reply": (
            "I don't know a platform called "
            f"'{platform}'. Try: salesforce, servicenow, servicenow_oauth, databricks, snowflake, oracle, m365, "
            "or their _mcp variants (e.g. salesforce_mcp) to connect via MCP instead."
        ),
        "action": None,
    }


def _propose(session_id: str, context: str, prior: dict | None, change_request: str | None = None) -> tuple[str, dict]:
    blueprint = llm.generate_blueprint(context, prior, change_request)
    trace_store.record(
        session_id,
        trace_store.new_event(
            "build", "Blueprint Generator",
            f"proposed {len(blueprint['root_agent']['participants'])} participant(s)" + (" (revised)" if prior else ""),
            220,
            decision=f"generated_by={blueprint.get('generated_by', 'heuristic')}",
        ),
    )
    names = ", ".join(p["name"] for p in blueprint["root_agent"]["participants"])
    mode_note = "" if blueprint.get("generated_by", "").startswith("llm") else " (heuristic mode — set COHERE_API_KEY for full language understanding)"
    verb = "Here's the revised proposal" if prior else "Here's what I'd build"
    reply = f"{verb}: a Root Orchestrator handing off to — {names}.{mode_note}\nSay \"approve\" to build it, or tell me what to change."
    return reply, blueprint


def _build(session_id: str, blueprint: dict) -> str:
    deployments = deploy.deploy_blueprint(session_id, blueprint)
    lines = [f"  • {d['agent']} → {d['platform']} ({d['endpoint']})" for d in deployments]

    try:
        scaffold_dir = maf_scaffold.write_scaffold(blueprint)
        scaffold_note = f"\n\nReal MAF config also written to {scaffold_dir} (root-agent-config.yaml + participants/*.yaml) — see its README.md."
    except Exception as exc:
        scaffold_note = f"\n\n(Couldn't write the MAF scaffold files: {exc})"

    return "Built and deployed:\n" + "\n".join(lines) + scaffold_note + "\n\nThe agents are live — ask them something."
