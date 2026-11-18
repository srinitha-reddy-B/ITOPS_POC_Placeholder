"""Point32Health Agentic Incident Workbench: agents, tools and governance (Live Agent Mode).

The workbench page (served by the frontend at /p32) runs one incident through a chain of specialised agents.
The page sequences the stages; this module is the trusted side of every step:

* run_agent: one LLM call per agent, each with its own system instruction and JSON contract.
  The model output is parsed and validated before it is returned; invalid output, timeouts,
  rate limits and API errors come back as {ok: false, kind, error} and are never replaced
  with made-up content. Token counts are the provider's billed units (p32_metrics ledger).
* run_tool: ServiceNow reads (similar incidents, knowledge, changes, CMDB, read-back) and the
  governed writes (work notes, resolution). Writes check the approvals recorded here, on the
  server, for that run; the browser can't skip a gate by calling the tool directly.
* record_approval: the human gates (RCA approval, SOP approval). POC control: the approver
  role comes from the X-P32-Role header because the POC has no sign-in.

Credentials stay in backend/.env. Audit lines record what ran and whether it worked, never
incident text or credentials. All workbench incidents are synthetic demo data.
"""

import json
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

from . import itops_servicenow as snow
from . import llm
from . import p32_frontdoor as fd
from . import p32_metrics as metrics
from . import platform_connect as pc

_DIR = Path(__file__).parent
_DATA = json.loads((_DIR / "p32_workbench_data.json").read_text(encoding="utf-8"))
_RUNS_FILE = _DIR.parent / ".p32_workbench_runs.json"
_AUDIT_FILE = _DIR.parent / ".p32_workbench_audit.jsonl"
_MODEL = os.environ.get("P32_AGENT_MODEL") or os.environ.get("P32_RCA_MODEL") or "command-r7b-12-2024"
_LLM_TIMEOUT = float(os.environ.get("P32_AGENT_TIMEOUT", "75"))
CONFIDENCE_THRESHOLD = 0.7
APPROVER_ROLES = {"engineer", "approver"}
# Demo persona switcher (no sign-in in this POC): each approval gate accepts only the
# persona that owns it. "approver" is kept for older pages of the POC.
GATE_ROLES = {
    "rca": {"engineer"},
    "sop": {"engineer"},
    "asset": {"asset_manager", "approver"},
    "hr": {"hr_partner", "approver"},
    "pi": {"it_admin", "approver"},
}
GATE_OWNER = {"rca": "IT engineer", "sop": "IT engineer", "asset": "IT/asset manager", "hr": "HR partner", "pi": "IT administrator"}
_TAG = "P32-WB:"
_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _audit(entry: dict) -> None:
    try:
        with _AUDIT_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"at": _now(), **entry}) + "\n")
    except OSError:
        pass


# ------------------------------------------------------------------ run store


def _load_runs() -> dict:
    try:
        return json.loads(_RUNS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


_RUNS: dict = _load_runs()


def _save_runs() -> None:
    try:
        _RUNS_FILE.write_text(json.dumps(_RUNS), encoding="utf-8")
    except OSError:
        pass


def _run(run_id: str) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{6,80}", run_id or ""):
        raise ValueError("invalid run_id")
    with _lock:
        r = _RUNS.setdefault(run_id, {"approvals": [], "verified": False, "sn": None, "snapshot": None, "created": _now()})
    return r


def list_runs() -> dict:
    with _lock:
        return {"ok": True, "runs": [r["snapshot"] for r in _RUNS.values() if r.get("snapshot")]}


def save_run(run_id: str, snapshot: dict) -> dict:
    r = _run(run_id)
    text = json.dumps(snapshot)
    if len(text) > 600_000:
        return {"ok": False, "error": "run snapshot too large"}
    with _lock:
        r["snapshot"] = snapshot
        _save_runs()
    return {"ok": True}


def reset_runs() -> dict:
    """Demo reset: forget run state here. ServiceNow records are never deleted."""
    with _lock:
        n = len(_RUNS)
        _RUNS.clear()
        _save_runs()
    _audit({"kind": "reset", "runs_cleared": n})
    return {"ok": True, "cleared": n}


# --------------------------------------------------------------------- status

_status_cache: dict = {"at": 0.0, "value": None}


def status() -> dict:
    if time.time() - _status_cache["at"] < 60 and _status_cache["value"]:
        return _status_cache["value"]
    sn = snow.status()
    value = {
        "ok": True,
        "llm": {"configured": llm.llm_available(), "provider": "Cohere", "model": _MODEL},
        "servicenow": {"configured": bool(sn.get("live")), "instance": sn.get("instance_url", ""), "reason": sn.get("reason", "")},
        "confidence_threshold": CONFIDENCE_THRESHOLD,
    }
    _status_cache.update(at=time.time(), value=value)
    return value


# --------------------------------------------------------------------- agents

_COMMON = """You are the {name} in the Point32Health Agentic Incident Workbench, a proof of concept.
Your responsibility: {role}
Rules:
- Use only the CONTEXT below. Never invent logs, metrics, incident numbers, change numbers, knowledge articles, people or systems that are not in it.
- When you cite evidence, use the evidence ids exactly as given (for example L1, M1, CHG-DEMO-3101, INC0010012).
- Evidence has a weight: "direct" items (logs, metrics, configuration diffs, change records) show what actually happened; "background" items (knowledge articles, past incidents) only suggest what to check. A knowledge article that lists possible causes is not evidence that any of them occurred.
- Evidence marked "simulated" is synthetic demonstration telemetry; treat it as the available evidence but do not call it production data.
- Be specific and concise. Plain language that an engineer and an IT manager can both follow.
- Each list in the CONTRACT shows the shape of ONE item; produce the number of items its description asks for (for example "3-6 items").
- Respond with one JSON object only, no markdown, using exactly the keys in the CONTRACT.
"""

AGENTS = {
    "intake": {
        "name": "Intake & Validation Agent",
        "role": "Validate a newly reported incident: understand the employee's description, identify the affected service, extract symptoms and keywords, spot missing information and possible duplicates, and decide whether there is enough to investigate.",
        "contract": {
            "summary": "one-sentence validated summary",
            "service": "affected service name",
            "symptoms": ["2-4 items: one observed symptom each"],
            "keywords": ["3-6 items: technical keyword"],
            "missing_info": ["information still needed (empty if none)"],
            "possible_duplicate_of": "id of a similar OPEN record only if it clearly describes the same problem on the same service, else empty string",
            "recommended_priority": "1 - Critical | 2 - High | 3 - Moderate | 4 - Low",
            "business_impact": "who is affected and how",
            "validation": "pass | needs_info",
            "reasoning": "why it passed or failed validation",
        },
        "lists": ["symptoms", "keywords", "missing_info"],
        "enums": {"validation": ["pass", "needs_info"]},
        "required": ["summary", "service", "validation", "reasoning"],
    },
    "triage": {
        "name": "ServiceNow Triage Agent",
        "role": "Perform structured triage: recommend category, assignment group (only from the groups list), affected service and CI, impact, urgency and priority, with a reason for each. You recommend; you never overwrite values already set on the record.",
        "contract": {
            "category": "category",
            "assignment_group": "one group from the groups list",
            "group_rationale": "why this group",
            "affected_service": "service",
            "configuration_item": "CI",
            "impact": "1 - High | 2 - Medium | 3 - Low",
            "urgency": "1 - High | 2 - Medium | 3 - Low",
            "priority_recommendation": "1 - Critical | 2 - High | 3 - Moderate | 4 - Low",
            "priority_rationale": "why",
            "business_impact": "business impact assessment",
            "related_records": ["related record ids from the context"],
            "summary": "one-paragraph triage assessment",
        },
        "lists": ["related_records"],
        "required": ["assignment_group", "priority_recommendation", "summary"],
    },
    "evidence": {
        "name": "Context & Evidence Agent",
        "role": "Correlate the evidence the tools returned: what it shows, in what order things happened, which records and changes are related, and what evidence is still missing.",
        "contract": {
            "summary": "what the evidence shows, 2-4 sentences",
            "key_findings": [{"finding": "3-6 items: one finding each", "sources": ["evidence id"]}],
            "timeline": [{"at": "3-8 items: time from the evidence", "event": "event", "source": "evidence id"}],
            "related_records": ["record ids"],
            "gaps": ["1-4 items: missing evidence or unavailable integration"],
            "sufficiency": "high | medium | low (high only if the evidence shows the failing component AND the mechanism, not just the symptom and timing)",
        },
        "lists": ["key_findings", "timeline", "related_records", "gaps"],
        "enums": {"sufficiency": ["high", "medium", "low"]},
        "required": ["summary", "key_findings", "sufficiency"],
    },
    "hypothesis": {
        "name": "Hypothesis Agent",
        "role": "Generate 2 or 3 distinct root-cause hypotheses from the evidence. Each hypothesis names a CAUSE (the failing component and the mechanism), never a restatement of the symptom: say which component failed and why, citing the evidence that shows it. In investigation round 2 or later, re-derive the hypotheses from the newest evidence items and cite them. Give each supporting evidence ids, a confidence between 0 and 1 with a reason, and what evidence would confirm or reject it. Take earlier Critic, Judge or approver feedback into account if present. Never state a definitive root cause.",
        "contract": {
            "hypotheses": [{"id": "H1 (produce 2-3 hypotheses: H1, H2, H3)", "title": "short hypothesis naming the component and mechanism", "explanation": "mechanism", "supporting_evidence": ["evidence id"], "confidence": 0.0, "confidence_reason": "why", "would_confirm": "evidence that would confirm it", "would_reject": "evidence that would reject it"}],
            "notes": "how feedback from the previous round was used, or empty",
        },
        "lists": ["hypotheses"],
        "required": ["hypotheses"],
    },
    "critic": {
        "name": "Critic Agent",
        "role": "Independently challenge each hypothesis. Do not restate it: test whether the cited evidence really supports it, list unsupported assumptions and contradicting evidence, offer alternative explanations, and say what extra investigation is needed. Recommend retain, reject or needs_evidence per hypothesis.",
        "contract": {
            "assessments": [{"hypothesis_id": "one item per hypothesis, e.g. H1", "verdict": "retain (only if the cited evidence directly shows the mechanism) | reject | needs_evidence", "evidence_really_supports": True, "unsupported_assumptions": ["assumption"], "contradictions": ["contradicting evidence"], "alternative_explanations": ["alternative"], "comment": "independent critique"}],
            "additional_investigation": ["0-4 items: specific evidence to collect next"],
            "overall": "overall critique",
        },
        "lists": ["assessments", "additional_investigation"],
        "required": ["assessments", "overall"],
    },
    "judge": {
        "name": "Judge Agent",
        "role": f"Weigh the hypotheses against the Critic's objections and the evidence. Select the best supported hypothesis and give an evidence-based confidence between 0 and 1. Decide approved_for_rca only if confidence is at least {CONFIDENCE_THRESHOLD} and the Critic's material objections are answered by evidence; otherwise decide further_investigation and list the evidence to request. If the context says no further investigation rounds are available, still pick the best hypothesis and report the honest confidence.",
        "contract": {
            "selected_hypothesis_id": "H1",
            "selected_title": "title",
            "decision": "approved_for_rca | further_investigation",
            "confidence": 0.0,
            "rationale": "why this hypothesis, addressing the Critic",
            "supporting_evidence": ["evidence id"],
            "evidence_requests": ["evidence needed if further investigation"],
        },
        "lists": ["supporting_evidence", "evidence_requests"],
        "enums": {"decision": ["approved_for_rca", "further_investigation"]},
        "required": ["selected_hypothesis_id", "decision", "confidence", "rationale"],
    },
    "rca": {
        "name": "RCA Writer Agent",
        "role": "Write the structured root cause analysis from the Judge's selected hypothesis and the evidence. The root cause states only the selected hypothesis; do not add rejected or unselected hypotheses as possible causes. Address every correction or engineer change request in the context. Separate verified facts (from evidence) from conclusions.",
        "contract": {
            "executive_summary": "ONE short plain-language sentence, at most 20 words: what broke and the fix",
            "incident_overview": "what happened",
            "business_impact": "business impact",
            "technical_impact": "technical impact",
            "affected_service": "service",
            "timeline": [{"at": "3-8 items: time", "event": "event"}],
            "investigation_performed": ["3-6 items: the most relevant entries from investigation_log in the context, one each"],
            "evidence_reviewed": ["3-8 items: evidence id and what it showed"],
            "root_cause": "one complete sentence of 20-45 words naming the component, the mechanism and the trigger",
            "contributing_factors": ["1-4 items: contributing factor"],
            "resolution_recommendation": ["3-6 items: ordered corrective action, safe and specific"],
            "preventive_recommendations": ["2-4 items: preventive action"],
            "confidence": "high | medium | low",
            "evidence_references": ["2-8 items: evidence id cited"],
            "assumptions": ["0-3 items: assumption"],
        },
        "lists": ["timeline", "investigation_performed", "evidence_reviewed", "contributing_factors", "resolution_recommendation", "preventive_recommendations", "evidence_references", "assumptions"],
        "enums": {"confidence": ["high", "medium", "low"]},
        "required": ["executive_summary", "root_cause", "resolution_recommendation", "evidence_references"],
    },
    "quality": {
        "name": "Quality & Governance Agent",
        "role": "Review the RCA before a human sees it. Check: root cause consistent with the Judge's decision; technically plausible; business impact accurate to the evidence; remediation safe (no destructive production action without approval, rollback possible); no duplicate or contradictory recommendations; ready to turn into an SOP. Give a correction for every warn or fail.",
        "contract": {
            "checks": [{"name": "exactly 6 items, one per name: Root-cause consistency, Technical plausibility, Business-impact accuracy, Remediation safety, No contradictory recommendations, SOP readiness", "status": "pass | warn | fail", "detail": "reason"}],
            "corrections": ["correction for the RCA Writer"],
            "decision": "pass | fail",
        },
        "lists": ["checks", "corrections"],
        "enums": {"decision": ["pass", "fail"]},
        "required": ["checks", "decision"],
    },
    "sop": {
        "name": "SOP Generation Agent",
        "role": "Write an incident-specific standard operating procedure from the approved RCA and remediation, in a safe execution order. Every step has an expected result. Include preconditions, permissions, rollback, verification and escalation. Cite evidence or runbooks for steps. Never invent commands, hostnames or thresholds that aren't in the context. If the context includes verification findings, revise the SOP to address them.",
        "contract": {
            "sop_id": "SOP-<SERVICE ABBREVIATION>-<4 digits>",
            "title": "title",
            "purpose": "purpose",
            "scope": "scope",
            "preconditions": ["2-4 items: precondition"],
            "permissions": ["1-3 items: permission or role required"],
            "steps": [{"action": "4-8 items: one imperative step each", "expected_result": "expected result", "mode": "automated | manual", "risk": "low | medium | high"}],
            "rollback": ["1-3 items: rollback step"],
            "verification": ["2-4 items: verification step"],
            "escalation": ["1-3 items: escalation path"],
            "evidence_references": ["evidence or KB id"],
        },
        "lists": ["preconditions", "permissions", "steps", "rollback", "verification", "escalation", "evidence_references"],
        "required": ["title", "steps", "rollback", "verification"],
    },
    "verification": {
        "name": "Verification Agent",
        "role": "Decide whether the remediation actually resolved the incident. Compare before and after health evidence against the threshold, check whether the original symptoms persist, and review execution results. Finishing the SOP does not by itself mean resolved. If not resolved, recommend reopen_remediation and say what extra action is needed.",
        "contract": {
            "resolved": True,
            "checks": [{"check": "2-5 items: one check each", "result": "pass | fail", "detail": "detail"}],
            "evidence_reviewed": ["evidence"],
            "remaining_issues": ["issue, or empty"],
            "resolution_confidence": 0.0,
            "recommendation": "close | reopen_remediation",
            "additional_action": "action needed if reopening, else empty",
        },
        "lists": ["checks", "evidence_reviewed", "remaining_issues"],
        "enums": {"recommendation": ["close", "reopen_remediation"]},
        "required": ["resolved", "checks", "recommendation"],
    },
    "closure": {
        "name": "Closure Agent",
        "role": "Prepare the closure: a resolution summary for the record, a work note for engineers, and a short plain-language update for the employee who reported it (no internal agent names, logs or investigation details in the employee update).",
        "contract": {
            "resolution_summary": "3-5 sentences: cause, fix, verification",
            "close_code": "Solution provided | Workaround provided | Resolved by change",
            "work_note": "engineer-facing closure note",
            "employee_update": "plain-language update for the reporter",
        },
        "required": ["resolution_summary", "work_note", "employee_update"],
    },
}


class AgentOutputError(ValueError):
    pass


def _as_list(v) -> list:
    if v is None or v == "":
        return []
    return v if isinstance(v, list) else [v]


def _validate(agent: str, raw) -> dict:
    spec = AGENTS[agent]
    if not isinstance(raw, dict):
        raise AgentOutputError("the model did not return a JSON object")
    out = dict(raw)
    if agent == "quality" and str(out.get("decision", "")).strip().lower() not in ("pass", "fail") and isinstance(out.get("checks"), list) and out["checks"]:
        # Deterministic rule, not invented content: a review with any failed check is a fail.
        out["decision"] = "fail" if any(str(c.get("status", "")).lower() == "fail" for c in out["checks"] if isinstance(c, dict)) else "pass"
        out["decision_derived"] = True
    for k in spec.get("lists", []):
        out[k] = _as_list(out.get(k))
    for k, allowed in spec.get("enums", {}).items():
        v = str(out.get(k, "")).strip().lower()
        if v not in allowed:
            raise AgentOutputError(f"'{k}' must be one of {allowed}, got '{v[:40]}'")
        out[k] = v
    missing = [k for k in spec["required"] if out.get(k) in (None, "", [])]
    if missing:
        raise AgentOutputError(f"missing required field(s): {', '.join(missing)}")
    for k in ("confidence", "resolution_confidence"):
        if k in out and agent in ("judge", "verification"):
            try:
                out[k] = max(0.0, min(1.0, float(out[k])))
            except (TypeError, ValueError):
                raise AgentOutputError(f"'{k}' must be a number between 0 and 1")
    if agent == "verification":
        out["resolved"] = out["resolved"] is True or str(out["resolved"]).lower() == "true"
    if agent == "hypothesis":
        hs = [h for h in out["hypotheses"] if isinstance(h, dict) and h.get("title")]
        if not 1 <= len(hs) <= 4:
            raise AgentOutputError("expected 2 or 3 hypotheses")
        for n, h in enumerate(hs, 1):
            h["id"] = str(h.get("id") or f"H{n}")
            try:
                h["confidence"] = max(0.0, min(1.0, float(h.get("confidence", 0))))
            except (TypeError, ValueError):
                h["confidence"] = 0.0
            h["supporting_evidence"] = _as_list(h.get("supporting_evidence"))
        out["hypotheses"] = hs
    if agent == "sop":
        steps = [s for s in out["steps"] if isinstance(s, dict) and s.get("action")]
        if len(steps) < 2:
            raise AgentOutputError("an SOP needs at least 2 executable steps")
        out["steps"] = steps[:10]
    return out


def _call_cohere(prompt: str, model: str) -> tuple[str, dict]:
    from cohere import ClientV2

    client = ClientV2(api_key=llm._cohere_api_key(), timeout=_LLM_TIMEOUT)
    resp = client.chat(model=model, messages=[{"role": "user", "content": prompt}], response_format={"type": "json_object"}, temperature=0.2)
    billed = getattr(getattr(resp, "usage", None), "billed_units", None)
    usage = {"input_tokens": None, "output_tokens": None}
    if billed is not None:
        usage = {"input_tokens": int(billed.input_tokens or 0), "output_tokens": int(billed.output_tokens or 0)}
    text = next(item.text for item in resp.message.content if getattr(item, "text", None)).strip()
    return re.sub(r"^```(json)?|```$", "", text, flags=re.MULTILINE).strip(), usage


def _error_kind(exc: Exception) -> tuple[str, str]:
    code = getattr(exc, "status_code", None)
    name = type(exc).__name__
    if code == 429 or "TooManyRequests" in name:
        return "rate_limit", "The LLM provider rate-limited this call (HTTP 429). Wait a moment and retry the stage."
    if isinstance(exc, (httpx.TimeoutException, TimeoutError)) or "Timeout" in name:
        return "timeout", f"The LLM call timed out after {int(_LLM_TIMEOUT)} s."
    if code in (401, 403):
        return "auth", "The LLM provider rejected the API key (check COHERE_API_KEY in backend/.env)."
    return "api_error", f"LLM call failed: {name}: {str(exc)[:200]}"


def run_agent(run_id: str, agent: str, context: dict, incident_ref: str = "") -> dict:
    if agent not in AGENTS:
        return {"ok": False, "kind": "bad_request", "error": f"unknown agent '{agent}'"}
    try:
        r = _run(run_id)
    except ValueError as exc:
        return {"ok": False, "kind": "bad_request", "error": str(exc)}
    if not llm.llm_available():
        return {"ok": False, "kind": "not_configured", "error": "Live Agent Mode needs an LLM: COHERE_API_KEY is not set in backend/.env."}
    spec = AGENTS[agent]
    model = os.environ.get(f"P32_AGENT_MODEL_{agent.upper()}") or _MODEL  # optional per-agent override
    ctx = json.dumps(context, ensure_ascii=False, default=str)
    if len(ctx) > 16000:
        ctx = ctx[:16000] + " …(truncated)"
    prompt = (
        _COMMON.format(name=spec["name"], role=spec["role"])
        + "\nCONTRACT (JSON keys and value shapes)\n" + json.dumps(spec["contract"], indent=1)
        + "\n\nCONTEXT\n" + ctx
    )
    started = time.time()
    attempts, out, usage_total, err = 0, None, {"input_tokens": 0, "output_tokens": 0}, None
    while attempts < 2 and out is None:
        attempts += 1
        try:
            text, usage = _call_cohere(prompt, model)
            for k in usage_total:
                usage_total[k] += usage[k] or 0
            out = _validate(agent, json.loads(text))
        except json.JSONDecodeError:
            err = ("invalid_output", "The model's response was not valid JSON.")
        except AgentOutputError as exc:
            err = ("invalid_output", f"The model's response failed validation: {exc}.")
        except Exception as exc:  # network, auth, quota, timeout
            err = _error_kind(exc)
            if err[0] == "rate_limit" and attempts < 2:
                time.sleep(4)
                continue
            if err[0] in ("auth", "timeout"):
                break
    ms = int((time.time() - started) * 1000)
    ok = out is not None
    metrics.record_usage({
        "at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ"), "agent": f"Workbench · {spec['name']}", "model": model,
        "incident": incident_ref[:40], "ok": ok, "error": "" if ok else err[1][:200], "duration_ms": ms, "redraft": False,
        "input_tokens": usage_total["input_tokens"] or None, "output_tokens": usage_total["output_tokens"] or None,
    })
    _audit({"kind": "agent", "run_id": run_id, "agent": agent, "ok": ok, "ms": ms, "attempts": attempts, "error_kind": None if ok else err[0]})
    if not ok:
        return {"ok": False, "kind": err[0], "error": err[1], "duration_ms": ms, "attempts": attempts, "model": f"Cohere {model}"}
    if agent == "verification":
        with _lock:
            r["verified"] = bool(out["resolved"]) and out["recommendation"] == "close"
            _save_runs()
    return {"ok": True, "output": out, "model": f"Cohere {model}", "duration_ms": ms, "attempts": attempts, "usage": usage_total, "context_chars": len(ctx)}


# ---------------------------------------------------------------------- tools

_STOP = set("the and for with from that this into after when been have has not are was were since about then than only some more most very their there which while what will would could should does".split())


def _keywords(text: str, n: int = 3) -> list[str]:
    seen, out = set(), []
    for w in re.findall(r"[A-Za-z][A-Za-z0-9-]{3,}", text or ""):
        lw = w.lower()
        if lw in _STOP or lw in seen:
            continue
        seen.add(lw)
        out.append(lw)
    out.sort(key=len, reverse=True)
    return out[:n]


def _q(table: str, query: str, fields: str, limit: int = 5) -> list[dict]:
    c = snow._creds()
    resp = httpx.get(
        f"{c['instance_url']}/api/now/table/{table}",
        params={"sysparm_query": query, "sysparm_fields": fields, "sysparm_limit": limit, "sysparm_display_value": "true"},
        auth=snow._auth(c), headers={"Accept": "application/json"}, timeout=snow._TIMEOUT,
    )
    resp.raise_for_status()

    def disp(v):
        return v.get("display_value", "") if isinstance(v, dict) else (v or "")

    return [{k: disp(v) for k, v in row.items()} for row in pc._safe_json(resp, "servicenow").get("result", [])]


def _url(table: str, sys_id: str) -> str:
    return snow._record_url(snow._creds(), table, sys_id)


def _like(field: str, words: list[str]) -> str:
    return "^OR".join(f"{field}LIKE{w}" for w in words)


def _tool_sn_similar(r: dict, a: dict) -> dict:
    words = _keywords(a.get("text", ""), 3)
    if not words:
        return {"records": [], "query": ""}
    rows = _q("incident", f"{_like('short_description', words)}^ORDERBYDESCsys_created_on", "sys_id,number,short_description,state,sys_created_on,priority", 6)
    exclude = (r.get("sn") or {}).get("number")
    recs = [{"id": x["number"], "title": x["short_description"], "state": x["state"], "opened": x["sys_created_on"], "url": _url("incident", x["sys_id"])} for x in rows if x["number"] != exclude][:5]
    return {"records": recs, "query": " OR ".join(words)}


def _tool_sn_kb(r: dict, a: dict) -> dict:
    words = _keywords(a.get("text", ""), 3)
    if not words:
        return {"articles": []}
    rows = _q("kb_knowledge", f"{_like('short_description', words)}^ORDERBYDESCsys_updated_on", "sys_id,number,short_description,workflow_state", 4)
    return {"articles": [{"id": x["number"], "title": x["short_description"], "state": x["workflow_state"], "url": _url("kb_knowledge", x["sys_id"])} for x in rows], "query": " OR ".join(words)}


def _tool_sn_changes(r: dict, a: dict) -> dict:
    words = _keywords(a.get("text", ""), 3)
    if not words:
        return {"changes": []}
    rows = _q("change_request", f"{_like('short_description', words)}^sys_created_on>=javascript:gs.daysAgoStart(30)^ORDERBYDESCsys_created_on", "sys_id,number,short_description,state,sys_created_on", 4)
    return {"changes": [{"id": x["number"], "title": x["short_description"], "state": x["state"], "opened": x["sys_created_on"], "url": _url("change_request", x["sys_id"])} for x in rows], "query": " OR ".join(words)}


def _tool_sn_cmdb(r: dict, a: dict) -> dict:
    ci = str(a.get("ci", "")).strip()[:80]
    if not ci:
        return {"items": []}
    rows = _q("cmdb_ci", f"nameLIKE{ci}", "sys_id,name,sys_class_name,operational_status", 3)
    return {"items": [{"name": x["name"], "class": x["sys_class_name"], "status": x["operational_status"]} for x in rows], "query": ci}


def _tool_sn_groups(r: dict, a: dict) -> dict:
    name = str(a.get("group", "")).strip()[:80]
    rows = _q("sys_user_group", f"name={name}", "sys_id,name", 1) if name else []
    return {"group": name, "exists_in_servicenow": bool(rows)}


def _tool_sn_bind(r: dict, a: dict) -> dict:
    """Link the run to its ServiceNow record: a seeded curated incident (by tag), resolved server-side."""
    iid = str(a.get("incident_id", ""))
    if not re.fullmatch(r"DEMO-[A-Z]{3}-\d{3}", iid):
        raise ValueError("invalid incident id")
    # A curated incident can name its real ServiceNow record (the documented INC0010048 demo);
    # every other curated incident is found by its P32-WB tag.
    known = next((i.get("servicenow_number") for i in _DATA["incidents"] if i["id"] == iid), None)
    if known:
        rows = _q("incident", f"number={known}", "sys_id,number,state", 1)
    else:
        rows = _q("incident", f"correlation_id={_TAG}{iid}", "sys_id,number,state", 1)
    if not rows:
        return {"bound": False, "reason": "This curated demo incident is not in ServiceNow (not seeded). Write-back will be prepared but not sent."}
    with _lock:
        r["sn"] = {"sys_id": rows[0]["sys_id"], "number": rows[0]["number"]}
        _save_runs()
    return {"bound": True, "number": rows[0]["number"], "state": rows[0]["state"], "url": _url("incident", rows[0]["sys_id"])}


def _tool_sn_create(r: dict, a: dict) -> dict:
    """FrontDoor submission in Live mode: a real ServiceNow incident for the session employee."""
    if r.get("sn"):
        raise ValueError("this run already has a ServiceNow record")
    impact = {"1 - High": "1", "2 - Medium": "2", "3 - Low": "3"}.get(a.get("impact", ""), "2")
    short = str(a.get("short_description", "")).strip()[:160]
    if len(short) < 10:
        raise ValueError("short description too short")
    out = fd.raise_incident({
        "short_description": short,
        "description": str(a.get("description", ""))[:3000] + f"\n\n[Digital FrontDoor] Use case: {a.get('use_case', '')}. Service: {a.get('service', '')}. Synthetic POC submission.",
        "impact": impact, "urgency": impact, "category": "software",
    })
    with _lock:
        r["sn"] = {"sys_id": out["sys_id"], "number": out["number"]}
        _save_runs()
    return {"number": out["number"], "url": out["url"]}


def _approved(r: dict, gate: str) -> bool:
    last = [x for x in r["approvals"] if x["gate"] == gate]
    return bool(last) and last[-1]["decision"] == "approve"


def _need_sn(r: dict) -> dict:
    if not r.get("sn"):
        raise PermissionError("This run has no ServiceNow record, so nothing was written.")
    return r["sn"]


def _tool_sn_note(r: dict, a: dict) -> dict:
    kind = a.get("kind")
    # "progress" notes carry stage status only (never RCA content), so they need no approval.
    gates = {"started": [], "progress": [], "rca_approved": ["rca"], "sop_executed": ["rca", "sop"]}
    if kind not in gates:
        raise ValueError("unknown note kind")
    for g in gates[kind]:
        if not _approved(r, g):
            raise PermissionError(f"Blocked: the {g.upper()} approval gate has not been approved for this run.")
    sn = _need_sn(r)
    text = str(a.get("text", ""))[:4000]
    if kind == "progress" and not text.startswith("[AURA Workbench | status]"):
        text = "[AURA Workbench | status] " + text
    snow.work_note({"sys_id": sn["sys_id"], "text": text})
    return {"posted": True, "number": sn["number"]}


def _tool_sn_resolve(r: dict, a: dict) -> dict:
    for g in ("rca", "sop"):
        if not _approved(r, g):
            raise PermissionError(f"Blocked: the {g.upper()} approval gate has not been approved for this run.")
    if not r.get("verified"):
        raise PermissionError("Blocked: the Verification Agent has not confirmed the fix for this run.")
    sn = _need_sn(r)
    snow.work_note({"sys_id": sn["sys_id"], "text": str(a.get("work_note", ""))[:4000]})
    if a.get("employee_update"):
        snow.comment({"sys_id": sn["sys_id"], "text": str(a["employee_update"])[:2000]})
    res = snow.resolve({"sys_id": sn["sys_id"], "close_notes": str(a.get("close_notes", ""))[:3000], "close_code": a.get("close_code", "")})
    back = snow.activity({"sys_id": sn["sys_id"]})
    return {"resolved": res.get("resolved", False), "readback": {"number": back["number"], "state": back["state"], "close_code": back["close_code"], "resolved_at": back["resolved_at"], "notes": len(back["notes"])}, "url": back["url"]}


def _tool_sn_readback(r: dict, a: dict) -> dict:
    sn = _need_sn(r)
    back = snow.activity({"sys_id": sn["sys_id"]})
    return {"number": back["number"], "state": back["state"], "priority": back["priority"], "assignment_group": back["assignment_group"], "updated_on": back["updated_on"], "notes": len(back["notes"]), "url": back["url"]}


TOOLS = {
    "sn_similar": ("ServiceNow historical incident search", _tool_sn_similar),
    "sn_kb": ("ServiceNow knowledge search", _tool_sn_kb),
    "sn_changes": ("ServiceNow change search", _tool_sn_changes),
    "sn_cmdb": ("ServiceNow CMDB lookup", _tool_sn_cmdb),
    "sn_group": ("ServiceNow assignment group lookup", _tool_sn_groups),
    "sn_bind": ("ServiceNow incident retrieval", _tool_sn_bind),
    "sn_create": ("ServiceNow incident creation", _tool_sn_create),
    "sn_note": ("ServiceNow Work Notes API", _tool_sn_note),
    "sn_resolve": ("ServiceNow resolution update", _tool_sn_resolve),
    "sn_readback": ("ServiceNow read-back", _tool_sn_readback),
}


def run_tool(run_id: str, tool: str, args: dict) -> dict:
    if tool not in TOOLS:
        return {"ok": False, "kind": "bad_request", "error": f"unknown tool '{tool}'"}
    started = time.time()
    try:
        r = _run(run_id)
        result = TOOLS[tool][1](r, args or {})
        ok, out = True, {"ok": True, "result": result}
    except snow.NotConfigured as exc:
        ok, out = False, {"ok": False, "kind": "not_configured", "error": str(exc)}
    except PermissionError as exc:
        ok, out = False, {"ok": False, "kind": "blocked", "error": str(exc)}
    except pc.BadResponse as exc:
        ok, out = False, {"ok": False, "kind": "api_error", "error": str(exc)}
    except httpx.TimeoutException:
        ok, out = False, {"ok": False, "kind": "timeout", "error": "ServiceNow did not answer in time."}
    except httpx.HTTPStatusError as exc:
        ok, out = False, {"ok": False, "kind": "api_error", "error": f"ServiceNow HTTP {exc.response.status_code}"}
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        ok, out = False, {"ok": False, "kind": "api_error", "error": f"{type(exc).__name__}: {str(exc)[:200]}"}
    ms = int((time.time() - started) * 1000)
    _audit({"kind": "tool", "run_id": run_id, "tool": tool, "ok": ok, "ms": ms, "error_kind": None if ok else out.get("kind")})
    return {**out, "tool": TOOLS[tool][0], "duration_ms": ms, "source": "live"}


# ------------------------------------------------------------------ approvals


def record_approval(run_id: str, gate: str, decision: str, feedback: str, approver: str, role: str | None) -> dict:
    if gate not in GATE_ROLES or decision not in ("approve", "request_changes", "reject"):
        return {"ok": False, "kind": "bad_request", "error": "invalid gate or decision"}
    if (role or "").lower() not in GATE_ROLES[gate]:
        return {"ok": False, "kind": "forbidden", "error": f"Only the {GATE_OWNER[gate]} persona can record this approval."}
    if decision != "approve" and len((feedback or "").strip()) < 10:
        return {"ok": False, "kind": "bad_request", "error": "Feedback (at least 10 characters) is required to reject or request changes."}
    r = _run(run_id)
    entry = {"gate": gate, "decision": decision, "feedback": (feedback or "")[:1500], "approver": (approver or "Engineer")[:80], "at": _now()}
    with _lock:
        r["approvals"].append(entry)
        if gate == "rca" and decision != "approve":
            r["verified"] = False
        _save_runs()
    _audit({"kind": "approval", "run_id": run_id, "gate": gate, "decision": decision})
    return {"ok": True, "recorded": entry}


# ----------------------------------------------------------- ServiceNow mapping


def snow_map() -> dict:
    """Which curated demo incidents exist in ServiceNow (seeded with tag P32-WB:<id>)."""
    try:
        rows = _q("incident", f"correlation_idSTARTSWITH{_TAG}", "sys_id,number,state,correlation_id", 100)
    except snow.NotConfigured as exc:
        return {"ok": False, "error": str(exc), "map": {}}
    except (httpx.HTTPError, pc.BadResponse) as exc:
        return {"ok": False, "error": f"ServiceNow lookup failed: {type(exc).__name__}", "map": {}}
    out = {}
    for x in rows:
        iid = x["correlation_id"][len(_TAG):]
        out[iid] = {"number": x["number"], "state": x["state"], "url": _url("incident", x["sys_id"])}
    return {"ok": True, "map": out}


def seed_curated(confirm: str | None) -> dict:
    """Create the 25 curated incidents in ServiceNow (idempotent). Only on an explicit confirm header."""
    if confirm != "yes-create-25-incidents":
        return {"ok": False, "error": "Seeding writes 25 incidents to ServiceNow; send X-P32-Confirm: yes-create-25-incidents."}
    existing = snow_map().get("map", {})
    created = []
    c = snow._creds()
    for inc in _DATA["incidents"]:
        if inc["id"] in existing or inc.get("servicenow_number"):
            continue
        fields = {
            "short_description": inc["title"][:160],
            "description": inc["description"] + "\n\n[Synthetic Point32Health POC demo record. Not a real incident.]",
            "impact": inc["impact"][0], "urgency": inc["urgency"][0], "category": "software",
            "correlation_id": _TAG + inc["id"], "correlation_display": "Point32Health Agentic Workbench (demo)",
        }
        rec = snow._record(c, "incident", "POST", None, fields)
        created.append({"id": inc["id"], "number": rec.get("number")})
    _audit({"kind": "seed", "created": len(created)})
    return {"ok": True, "created": created, "already_present": len(existing)}
