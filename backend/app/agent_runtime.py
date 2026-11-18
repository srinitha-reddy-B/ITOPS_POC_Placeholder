"""Runs a chat turn against an already-approved blueprint: routes to the
right specialist, enforces the write-confirmation gate (FR8), runs the
guardrail check (FR7), and calls the platform tool -- real once a session
has connected that platform, or mocked if the user explicitly opted into
demo mode ("use mock data") -- and writes every step to the trace store
(FR6) so the trace panel has something real to show.

Default behavior is to NOT silently use fake data: the first time an agent
needs a platform that isn't connected yet, it interactively walks the user
through connecting it (chat instructions for the token/password platforms,
an OAuth button for Salesforce) rather than pretending with mock numbers.
"""

import re

from . import humanize, knowledge, llm, mock_platforms, platform_connect, salesforce_connect, servicenow_mcp, trace_store

_KNOWN_ACCOUNTS = ["Acme Corp", "Globex Inc", "Initech", "Umbrella Retail"]


def _extract_account(message: str) -> str | None:
    for acc in _KNOWN_ACCOUNTS:
        if acc.lower() in message.lower():
            return acc
    return None


def handle_message(
    session_id: str, message: str, blueprint: dict, pending_write: dict | None, mock_mode: bool,
    forced_agent: str | None = None, last_agent: str | None = None,
) -> dict:
    """Returns {"reply": str, "pending_write": dict|None, "action": {"label","url"}|None,
    "last_agent": str|None}.

    `forced_agent` bypasses routing entirely: the user clicked a specific
    agent's own chat, so whatever they say goes straight to that agent --
    no scoring, no ambiguity, no risk of a typo landing on the wrong one.

    `last_agent` is which specialist handled the previous turn in the root
    (auto-routing) chat, if any -- see llm.route_message for why this
    matters for natural follow-ups. The caller is expected to persist
    whatever this returns as "last_agent" and pass it back in next turn.
    """

    if pending_write is not None:
        return _resolve_pending_write(session_id, message, pending_write, mock_mode)

    if forced_agent:
        participant = next((p for p in blueprint["root_agent"]["participants"] if p["name"] == forced_agent), None)
        if participant is None:
            return _reply(f"There's no agent called \"{forced_agent}\" in this blueprint.")
        analysis = llm.analyze_message(message)
        decision = {
            "platform": participant["platform"], "agent": participant["name"], **analysis,
            "decision": f"directly addressed to {participant['name']} (agent chat)",
        }
    else:
        decision = llm.route_message(message, blueprint["root_agent"]["participants"], last_agent=last_agent)

    if decision.get("uncovered_platform"):
        missing = decision["uncovered_platform"]
        trace_store.record(
            session_id,
            trace_store.new_event(
                "route", "Root Orchestrator", f"no agent covers {missing}", 5, status="blocked",
                decision=decision["decision"], platform=missing,
            ),
        )
        covered = ", ".join(p["name"] for p in blueprint["root_agent"]["participants"] if p["platform"] != "human")
        return _reply(
            f"I don't have a {missing.capitalize()} agent in this blueprint yet — it currently only covers "
            f"{covered}. Want me to add one?",
            propose_platform=missing,
            action={"type": "confirm_button", "label": f"Add a {missing.capitalize()} agent", "message": "add it"},
        )

    if decision["guardrail_blocked"]:
        trace_store.record(
            session_id,
            trace_store.new_event(
                "guardrail", "Root Orchestrator", message[:120], 5,
                status="blocked", decision=decision["guardrail_reason"],
            ),
        )
        return _reply(f"I can't do that — {decision['guardrail_reason']}.")

    platform = decision["platform"]
    agent = decision["agent"] or "Root Orchestrator"

    if platform is not None and not decision.get("matched_by_score", True) and not mock_mode:
        # route_message picked this agent only because it's the lone
        # specialist (or the previous turn's agent) -- not because anything
        # in the message actually matched it. If this session has trained
        # knowledge, give that a chance to answer before defaulting straight
        # to a specialist the question may have nothing to do with.
        knowledge_reply = _try_knowledge_answer(session_id, message)
        if knowledge_reply is not None:
            return knowledge_reply

    trace_store.record(
        session_id,
        trace_store.new_event(
            "route", "Root Orchestrator", f"routed to {agent}", 8,
            decision=decision["decision"], platform=platform,
        ),
    )

    if decision["escalate"]:
        human = next((p for p in blueprint["root_agent"]["participants"] if p["platform"] == "human"), None)
        if human:
            rule = human["routing_rules"][-1] if human["routing_rules"] else "escalation condition met"
            trace_store.record(
                session_id,
                trace_store.new_event(
                    "route", human["name"], "handed off for human review", 6,
                    decision=f"escalation rule fired: {rule}", platform="human",
                ),
            )

    if platform is None:
        candidates = decision.get("ambiguous_candidates")
        if candidates:
            return _reply(
                "I'm not sure which of your agents should handle that — could be "
                f"{' or '.join(candidates)}. Click one of them in the agents panel to talk to it directly, "
                "or tell me which one you mean."
            )
        knowledge_reply = _try_knowledge_answer(session_id, message)
        if knowledge_reply is not None:
            return knowledge_reply
        return _reply("I don't have an agent configured to handle that yet — try approving a blueprint that covers it first.")

    if not mock_mode:
        gate = _connection_gate(session_id, agent, platform)
        if gate is not None:
            return gate

    account = _extract_account(message)
    params = {"account": account} if account else {}

    if decision["action"] == "write":
        pending = {"platform": platform, "agent": agent, "params": params, "raw_message": message}
        confirm_text = f"{agent} is ready to make this change in {platform.capitalize()}. Confirm to proceed, or say cancel."

        if platform == "salesforce":
            # Figure out what the user actually asked for (Lead, Account,
            # Opportunity, ...) instead of always creating a generic Task
            # regardless of intent, and show exactly what will be written
            # before it happens.
            intent = llm.parse_write_intent(message)
            fields, note = _fill_missing_fields(intent["sobject"], intent["fields"], intent["missing_required"])
            pending["salesforce_intent"] = {"sobject": intent["sobject"], "fields": fields}
            field_summary = ", ".join(f"{k}={v!r}" for k, v in fields.items()) or "no extra fields"
            article = "an" if intent["sobject"][0] in "AEIOU" else "a"
            confirm_text = f"{agent} is ready to create {article} {intent['sobject']} in Salesforce with {field_summary}."
            if note:
                confirm_text += f" {note}"
            confirm_text += " Confirm to proceed, or say cancel."

        if platform == "servicenow":
            # Full incident lifecycle (create/update/assign/resolve/close/
            # cancel/delete), not just "create a new incident" every time --
            # see llm.parse_servicenow_write_intent for how the action is
            # recognized.
            intent = llm.parse_servicenow_write_intent(message)
            table_label = llm.SERVICENOW_TABLES[intent["table"]]["label"]
            if intent["action"] == "create" and not llm.SERVICENOW_TABLES[intent["table"]]["creatable"]:
                return _reply(
                    f"{agent}: I can look up {table_label}s, but creating one needs fields I can't safely "
                    "guess yet -- that's not wired up.",
                    last_agent=agent,
                )
            if intent["action"] != "create" and not intent["incident_number"]:
                return _reply(
                    f"{agent}: I need the {table_label}'s number to {intent['action']} it (e.g. INC0010086) -- "
                    "which one did you mean?",
                    last_agent=agent,
                )
            pending["servicenow_intent"] = intent
            confirm_text = _servicenow_confirm_text(agent, intent, message)

        trace_store.record(
            session_id,
            trace_store.new_event(
                "route", agent, "write action proposed, awaiting user confirmation", 4,
                decision="FR8 gate: writes require explicit confirmation", platform=platform,
            ),
        )
        return _reply(confirm_text, pending_write=pending, action=_confirm_cancel_buttons(), last_agent=agent)

    if platform == "servicenow":
        # Which incidents to list (open/closed/all), or a lookup against
        # one specific incident (its details, or just its attachments) --
        # instead of always running the same generic incident-list query
        # regardless of what was actually asked.
        read_intent = llm.parse_servicenow_read_intent(message)
        if read_intent["query_type"] in ("attachments", "detail") and not read_intent["incident_number"]:
            table_label = llm.SERVICENOW_TABLES[read_intent["table"]]["label"]
            return _reply(
                f"{agent}: I need the {table_label}'s number to check that (e.g. INC0010086) -- which one did you mean?",
                last_agent=agent,
            )
        params = {**params, **read_intent}

    try:
        result, latency_ms, live = _run_read(session_id, platform, params, mock_mode, message)
    except (salesforce_connect.AuthExpired, platform_connect.AuthExpired) as exc:
        return _reconnect_prompt(session_id, agent, platform, str(exc))
    except platform_connect.BadResponse as exc:
        return _diagnostic_prompt(session_id, agent, platform, exc)
    label = _live_label(session_id, platform, live)
    trace_store.record(
        session_id,
        trace_store.new_event(
            "read", agent, str(result), latency_ms,
            decision=decision["decision"] + (f" [{label.strip(' ·')}]" if live else " [mock]"), platform=platform,
        ),
    )
    return _reply(_agent_says(agent, platform, label, result), last_agent=agent)


def _resolve_pending_write(session_id: str, message: str, pending: dict, mock_mode: bool) -> dict:
    text = message.lower()
    if re.search(r"\b(yes|confirm|go ahead|approve|do it)\b", text):
        try:
            result, latency_ms, live = _run_write(session_id, pending, mock_mode)
        except (salesforce_connect.AuthExpired, platform_connect.AuthExpired) as exc:
            # Keep the pending write queued -- once reconnected, "confirm"
            # retries the same write instead of making the user start over.
            reply = _reconnect_prompt(session_id, pending["agent"], pending["platform"], str(exc))
            reply["pending_write"] = pending
            return reply
        except platform_connect.BadResponse as exc:
            reply = _diagnostic_prompt(session_id, pending["agent"], pending["platform"], exc)
            reply["pending_write"] = pending
            return reply
        label = _live_label(session_id, pending["platform"], live)
        trace_store.record(
            session_id,
            trace_store.new_event(
                "write", pending["agent"], str(result), latency_ms,
                decision="user confirmed the pending write" + (f" [{label.strip(' ·')}]" if live else " [mock]"),
                platform=pending["platform"],
            ),
        )
        return _reply(_agent_says(pending["agent"], pending["platform"], label, result), last_agent=pending["agent"])

    if re.search(r"\b(no|cancel|stop|don't)\b", text):
        trace_store.record(
            session_id,
            trace_store.new_event(
                "write", pending["agent"], "write cancelled by user", 3,
                status="blocked", decision="user declined the pending write", platform=pending["platform"],
            ),
        )
        return _reply("Cancelled — no changes were made.", last_agent=pending["agent"])

    return _reply(
        "Please confirm (\"yes\") or cancel (\"no\") the pending write before we continue.",
        pending_write=pending, action=_confirm_cancel_buttons(), last_agent=pending["agent"],
    )


def _confirm_cancel_buttons() -> dict:
    """A clickable alternative to typing "confirm"/"cancel" -- either one
    just sends the same canned text _resolve_pending_write already matches
    on, so no other write-confirmation logic needs to know these exist."""
    return {
        "type": "action_group",
        "items": [
            {"type": "confirm_button", "label": "Confirm", "message": "confirm"},
            {"type": "confirm_button", "label": "Cancel", "message": "cancel", "variant": "secondary"},
        ],
    }


def _servicenow_connect_options(label_prefix: str) -> dict:
    """Two real, clickable ways to connect ServiceNow -- Basic Auth (fields
    it already had) and OAuth via a real ServiceNow MCP server (a second
    path that plausibly sidesteps an SSO/Basic-Auth block, since it's a
    different auth mechanism -- see servicenow_mcp.py). Offering both lets
    the user pick without us guessing which one their instance needs."""
    return {
        "type": "action_group",
        "items": [
            {"type": "form", "platform": "servicenow", "label": f"{label_prefix} (Basic Auth)", "fields": platform_connect.form_fields("servicenow")},
            {"type": "form", "platform": "servicenow_oauth", "label": f"{label_prefix} via OAuth/MCP", "fields": servicenow_mcp.form_fields()},
        ],
    }


def _reconnect_prompt(session_id: str, agent: str, platform: str, reason: str) -> dict:
    """A live call just failed on auth and couldn't recover on its own --
    offer to reconnect right here instead of leaving the user at a dead-end
    error message with no next step."""
    trace_store.record(
        session_id,
        trace_store.new_event(
            "route", agent, "connection expired, offering reconnect", 3, status="blocked",
            decision=reason, platform=platform,
        ),
    )
    if platform == "salesforce":
        return _reply(
            f"{agent}: {reason} Click below to reconnect — it opens a real Salesforce login popup.",
            action={"type": "oauth_popup", "label": "Reconnect to Salesforce", "url": salesforce_connect.authorize_url(session_id)},
            last_agent=agent,
        )
    label = platform_connect.CONNECTOR_SPECS[platform]["label"]
    if platform == "servicenow":
        return _reply(
            f"{agent}: {reason} Please reconnect with a fresh credential.",
            action=_servicenow_connect_options("Reconnect ServiceNow"), last_agent=agent,
        )
    return _reply(
        f"{agent}: {reason} Please reconnect with a fresh credential.",
        action={"type": "form", "platform": platform, "label": f"Reconnect {label}", "fields": platform_connect.form_fields(platform)},
        last_agent=agent,
    )


def _diagnostic_prompt(session_id: str, agent: str, platform: str, exc: Exception) -> dict:
    """The call failed for a reason that isn't a rejected credential --
    something in the platform's own configuration is intercepting it (e.g.
    ServiceNow SSO/access-policy blocking Basic Auth). Reconnecting alone
    won't fix this, so explain the real cause and how to fix it there,
    with a reconnect action to retry once it's addressed."""
    trace_store.record(
        session_id,
        trace_store.new_event(
            "route", agent, "diagnosable failure, offering remediation", 3, status="blocked",
            decision=str(exc), platform=platform,
        ),
    )
    text = f"{agent}: {exc}"
    remediation = getattr(exc, "remediation", None)
    if remediation:
        text += f"\n\n{remediation}"
    label = platform_connect.CONNECTOR_SPECS[platform]["label"]
    if platform == "servicenow":
        text += "\n\nOnce that's fixed, click below to reconnect -- or try OAuth instead, which uses a different auth mechanism and may sidestep this entirely."
        return _reply(text, action=_servicenow_connect_options("Reconnect ServiceNow"), last_agent=agent)
    text += "\n\nOnce that's fixed, click below to reconnect and I'll retry."
    return _reply(
        text,
        action={"type": "form", "platform": platform, "label": f"Reconnect {label}", "fields": platform_connect.form_fields(platform)},
        last_agent=agent,
    )


def _connection_gate(session_id: str, agent: str, platform: str) -> dict | None:
    """Returns a reply dict if `platform` needs connecting before it can act for real, else None."""
    if platform == "human":
        return None

    if platform == "salesforce":
        if salesforce_connect.is_connected(session_id) or platform_connect.is_connected(session_id, "salesforce"):
            return None
        if salesforce_connect.configured():
            trace_store.record(
                session_id,
                trace_store.new_event(
                    "route", agent, "blocked on missing authorization", 3, status="blocked",
                    decision="Salesforce app is configured but this session hasn't authorized it yet", platform=platform,
                ),
            )
            current_host = salesforce_connect.current_login_base()
            other_host = salesforce_connect.other_host(current_host)
            other_label = "Sandbox" if other_host == "https://test.salesforce.com" else "Production"
            return _reply(
                f"{agent} needs authorization to access your Salesforce org. Click below — it opens a real "
                "Salesforce login popup; once you log in, you're connected automatically. If that login screen "
                "shows an \"invalid_client_id\" error *on Salesforce's own page* (the browser never comes back "
                "to this app), Salesforce isn't redirecting back for us to auto-detect it -- either the "
                f"Consumer Key/Secret are wrong (use the second option), or this Connected App actually lives in "
                f"your {other_label} org, not the one this is currently trying (use the third option to try that "
                "instead).",
                action={
                    "type": "action_group",
                    "items": [
                        {"type": "oauth_popup", "label": "Connect to Salesforce", "url": salesforce_connect.authorize_url(session_id)},
                        {"type": "form", "platform": "salesforce", "label": "Fix Salesforce credentials", "fields": salesforce_connect.SETUP_FORM_FIELDS},
                        {
                            "type": "oauth_popup", "label": f"Try {other_label} instead",
                            "url": salesforce_connect.authorize_url(session_id, host=other_host, retried=True),
                        },
                    ],
                },
                last_agent=agent,
            )
        trace_store.record(
            session_id,
            trace_store.new_event(
                "route", agent, "blocked, Salesforce not configured", 3, status="blocked",
                decision="no Connected App configured yet", platform=platform,
            ),
        )
        return _reply(
            f"{agent} needs a real Salesforce connection first.\n\n{salesforce_connect.SETUP_INSTRUCTIONS}\n\n"
            "(Or say \"use mock data\" to try the demo with fake data instead.)",
            action={"type": "form", "platform": "salesforce", "label": "Connect Salesforce", "fields": salesforce_connect.SETUP_FORM_FIELDS},
            last_agent=agent,
        )

    if platform in platform_connect.CONNECTOR_SPECS:
        if platform_connect.is_connected(session_id, platform):
            return None
        trace_store.record(
            session_id,
            trace_store.new_event(
                "route", agent, f"blocked, {platform} not connected", 3, status="blocked",
                decision=f"no live {platform} connection for this session yet", platform=platform,
            ),
        )
        label = platform_connect.CONNECTOR_SPECS[platform]["label"]
        if platform == "servicenow":
            return _reply(
                f"{agent} needs a real {label} connection first.\n\n{platform_connect.instructions_for(platform)}\n\n"
                f"Or connect via OAuth instead:\n\n{servicenow_mcp.INSTRUCTIONS}\n\n"
                "(Or say \"use mock data\" to try the demo with fake data instead.)",
                action=_servicenow_connect_options("Connect ServiceNow"), last_agent=agent,
            )
        return _reply(
            f"{agent} needs a real {label} connection first.\n\n{platform_connect.instructions_for(platform)}\n\n"
            "(Or say \"use mock data\" to try the demo with fake data instead.)",
            action={"type": "form", "platform": platform, "label": f"Connect {label}", "fields": platform_connect.form_fields(platform)},
            last_agent=agent,
        )

    return None


def _run_read(session_id: str, platform: str, params: dict, mock_mode: bool, message: str) -> tuple[dict, int, bool]:
    # For servicenow, `params` already carries the parsed read intent
    # (query_type/status/incident_number) -- see handle_message, which
    # also handles asking for a missing incident number before this runs.
    if not mock_mode:
        if platform == "salesforce" and salesforce_connect.is_connected(session_id):
            intent = llm.parse_read_intent(message)
            try:
                return (*_timed(lambda: salesforce_connect.query_records(
                    session_id, intent["sobject"], params.get("account"), intent["count_only"],
                )), True)
            except salesforce_connect.AuthExpired:
                raise
            except Exception as exc:
                return ({"error": f"live Salesforce call failed: {exc}"}, 200, True)
        if (
            platform == "salesforce"
            and not salesforce_connect.is_connected(session_id)
            and platform_connect.is_connected(session_id, "salesforce")
        ):
            # Connected via MCP, not native OAuth -- see platform_mcp.py.
            try:
                return (*_timed(lambda: platform_connect.mcp_read(session_id, "salesforce")), True)
            except Exception as exc:
                return ({"error": f"live Salesforce call failed: {exc}"}, 200, True)
        if platform in platform_connect.CONNECTOR_SPECS and platform_connect.is_connected(session_id, platform):
            try:
                return (*_timed(lambda: platform_connect.read(session_id, platform, params)), True)
            except (platform_connect.AuthExpired, platform_connect.BadResponse):
                raise
            except Exception as exc:
                return ({"error": f"live {platform} call failed: {exc}"}, 200, True)
    if platform == "salesforce":
        # Mock mode should still reflect what was actually asked for
        # (Lead/Account/...), not always return Opportunity data.
        intent = llm.parse_read_intent(message)
        result, latency_ms = mock_platforms.salesforce_read({**params, **intent})
        return result, latency_ms, False
    result, latency_ms = mock_platforms.PLATFORM_TOOLS[platform]["read"](params)
    return result, latency_ms, False


def _live_label(session_id: str, platform: str, live: bool) -> str:
    if not live:
        return " · mock"
    if platform == "salesforce":
        org = salesforce_connect.org_type(session_id)
        return f" · live ({org})" if org else " · live"
    return " · live"


def _servicenow_confirm_text(agent: str, intent: dict, message: str) -> str:
    action, number = intent["action"], intent.get("incident_number")
    table_label = llm.SERVICENOW_TABLES[intent["table"]]["label"]
    if action == "create":
        summary = llm.resolve_incident_summary(intent, message)
        text = f"{agent} is ready to open a new {table_label}: \"{summary}\"."
    elif action == "update":
        changes = [f"description to \"{v}\"" if k == "short_description" else f"{k} to \"{v}\"" for k, v in intent["fields"].items()]
        changes += [f"{k} to \"{v}\"" for k, v in intent.get("choice_updates", {}).items()]
        text = f"{agent} is ready to update {number}'s {' and '.join(changes)}."
    elif action == "assign":
        text = f"{agent} is ready to assign {number} to {intent['assignee']}."
    elif action == "delete":
        text = f"{agent} is ready to permanently delete {number}. This cannot be undone."
    else:  # resolve, close, cancel
        past_tense = {"resolve": "resolved", "close": "closed", "cancel": "canceled"}[action]
        text = f"{agent} is ready to mark {number} as {past_tense}."
    return text + " Confirm to proceed, or say cancel."


def _fill_missing_fields(sobject: str, fields: dict, missing: list[str]) -> tuple[dict, str]:
    """llm.parse_write_intent() never invents values for required fields it
    couldn't infer -- this fills them with an obvious placeholder right
    before the write, and returns a note so the confirmation prompt says so
    instead of silently writing made-up data."""
    if not missing:
        return fields, ""
    filled = dict(fields)
    for f in missing:
        if f == "CloseDate":
            from datetime import date, timedelta

            filled[f] = (date.today() + timedelta(days=30)).isoformat()
        else:
            filled[f] = "Unknown"
    return filled, f"(I didn't have {', '.join(missing)}, so I used a placeholder — cancel and tell me the real value if that's wrong.)"


def _run_write(session_id: str, pending: dict, mock_mode: bool) -> tuple[dict, int, bool]:
    platform, params, raw_message = pending["platform"], pending["params"], pending["raw_message"]
    if not mock_mode:
        if platform == "salesforce" and salesforce_connect.is_connected(session_id):
            intent = pending.get("salesforce_intent") or {"sobject": "Task", "fields": {"Subject": raw_message[:255]}}
            try:
                return (*_timed(lambda: salesforce_connect.create_record(
                    session_id, intent["sobject"], intent["fields"], account=params.get("account"),
                )), True)
            except salesforce_connect.AuthExpired:
                raise
            except Exception as exc:
                return ({"error": f"live Salesforce call failed: {exc}"}, 200, True)
        if platform in platform_connect.CONNECTOR_SPECS and platform_connect.is_connected(session_id, platform):
            intent = pending.get("servicenow_intent") or {"action": "create"}
            try:
                return (*_timed(lambda: platform_connect.write(session_id, platform, intent, raw_message)), True)
            except NotImplementedError as exc:
                return ({"note": str(exc)}, 50, False)
            except (platform_connect.AuthExpired, platform_connect.BadResponse):
                raise
            except Exception as exc:
                return ({"error": f"live {platform} call failed: {exc}"}, 200, True)
    if platform == "salesforce":
        if (
            not mock_mode
            and not salesforce_connect.is_connected(session_id)
            and platform_connect.is_connected(session_id, "salesforce")
        ):
            # Connected via MCP, not native OAuth -- real writes aren't
            # wired up for it (same reasoning platform_connect.write()
            # already documents for Databricks/Snowflake/Oracle/M365: a
            # generic write would have to assume a business action that
            # doesn't exist). Say so honestly instead of silently
            # returning mocked data for a session that's really connected.
            return ({"note": "Real writes for Salesforce via MCP aren't wired up yet — would need to confirm which MCP tool performs the write."}, 50, False)
        intent = pending.get("salesforce_intent") or {"sobject": "Task", "fields": {"Subject": raw_message[:255]}}
        result, latency_ms = mock_platforms.salesforce_write({**params, **intent})
        return result, latency_ms, False
    if platform == "servicenow":
        intent = pending.get("servicenow_intent") or {"action": "create"}
        result, latency_ms = mock_platforms.servicenow_write({**params, **intent}, raw_message)
        return result, latency_ms, False
    result, latency_ms = mock_platforms.PLATFORM_TOOLS[platform]["write"](params)
    return result, latency_ms, False


def _timed(fn):
    import time

    start = time.monotonic()
    result = fn()
    latency_ms = int((time.monotonic() - start) * 1000)
    return result, latency_ms


def _reply(
    text: str, *, pending_write: dict | None = None, action: dict | None = None,
    propose_platform: str | None = None, last_agent: str | None = None,
) -> dict:
    return {"reply": text, "pending_write": pending_write, "action": action, "propose_platform": propose_platform, "last_agent": last_agent}


def _try_knowledge_answer(session_id: str, message: str) -> dict | None:
    """Only reached once routing has already given up on every real agent
    (see the `platform is None` branch above) -- an upload/URL trained
    against this session is a graceful upgrade to what was otherwise a dead
    end, never a change to how a message that DOES match a platform gets
    handled. Returns None (falls through to the old dead-end message)
    whenever there's no knowledge stored, no Cohere key, or the model
    couldn't ground an answer -- never fabricates one on failure."""
    if not knowledge.has_knowledge(session_id):
        return None
    answer = llm.answer_from_knowledge(message, knowledge.get_text(session_id))
    if not answer:
        return None
    trace_store.record(
        session_id,
        trace_store.new_event(
            "read", "Knowledge Base", answer[:160], 300,
            decision="answered from uploaded/trained knowledge base",
        ),
    )
    return _reply(f"{answer}\n\nvia KnowledgeBase")


def _agent_says(agent: str, platform: str, label: str, result: dict) -> str:
    """A natural sentence, not a key/value dump -- the "via ..." line stays
    for traceability (this demo's whole point), just moved to a quiet
    footer instead of being jammed into the sentence itself."""
    sentence = humanize.describe(result)
    return f"{agent}: {sentence}\n\nvia {platform.capitalize()}{label}"
