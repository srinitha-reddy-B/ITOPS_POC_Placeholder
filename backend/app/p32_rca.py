"""LLM-generated root cause analysis and SOP for the Point32Health POC RCA Agent.

Reads the incident (from ServiceNow when a sys_id is given, otherwise from the
payload), adds the evidence the agent's investigation tools gathered, and asks
Cohere for a structured RCA + SOP. The browser posts the result to the
incident's work notes. Failures come back as {ok: false, error} so the POC can
fall back to its scripted RCA and say so.
"""

import json
import os
import re
import time
from datetime import datetime, timezone

import httpx

from . import itops_servicenow as snow
from . import llm
from . import p32_metrics as metrics
from . import platform_connect as pc

# A fast model keeps the live demo responsive (~10 s); command-a writes richer prose but
# took 70-80 s per RCA on this account. Override with P32_RCA_MODEL in backend/.env.
_MODEL = os.environ.get("P32_RCA_MODEL") or "command-r7b-12-2024"

_LIST_KEYS = ("technical_explanation", "diagnosis_steps", "resolution_steps", "preventive_measures", "assumptions")

_PROMPT = """You are the AURA RCA Agent, a site reliability engineer working a ServiceNow incident for Point32Health.
Write a root cause analysis (RCA) and a standard operating procedure (SOP) for the incident below.

Rules:
- Base every statement on the incident record and the evidence. Do not invent systems, metrics or names that aren't given.
- If the evidence doesn't prove something, say "likely" and add it to "assumptions".
- Write for support engineers: plain, specific, imperative steps. No marketing language.
- Keep each list item to one or two sentences. 3-6 items per list. 4-8 SOP steps.

INCIDENT
{incident}

EVIDENCE GATHERED BY THE AGENT'S TOOLS
{evidence}
{review}
Respond with one JSON object only, no prose and no markdown fences, using exactly these keys:
{{
  "incident_summary": "2-3 sentences: what is failing, when, and the business impact",
  "probable_root_cause": "one complete sentence of 20-35 words naming the component, the mechanism, and the measured values and limit involved",
  "technical_explanation": ["..."],
  "diagnosis_steps": ["..."],
  "resolution_steps": ["..."],
  "preventive_measures": ["..."],
  "sop": {{"id": "SOP-APP-<4 digits>", "title": "short title", "steps": ["..."]}},
  "confidence": "high | medium | low",
  "assumptions": ["..."]
}}
"""


def _incident_from_snow(sys_id: str) -> dict:
    """The incident's fields plus the people's own work notes and comments (AURA's
    notes are left out so the model doesn't summarise itself)."""
    rec = snow.activity({"sys_id": sys_id})
    human = [
        f"{n['created_on']} {n['created_by']} ({n['element']}): {n['value'][:600]}"
        for n in rec.get("notes", [])
        if not n["value"].startswith("[AURA]") and "AURA RCA AGENT" not in n["value"]
    ][:5]
    keep = ("number", "short_description", "description", "priority", "impact", "urgency", "category",
            "subcategory", "ci", "assignment_group", "state", "opened_at")
    incident = {k: rec.get(k, "") for k in keep if rec.get(k)}
    if human:
        incident["work_notes_and_comments"] = human
    return incident


def _clean_list(value) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    return [re.sub(r"^\s*(\d+[.)]|[-•*])\s*", "", str(v)).strip() for v in value if str(v).strip()]


def _validate(raw: dict) -> dict:
    """Normalise the model's JSON into the shape the POC renders; raise if it's unusable."""
    out = {
        "incident_summary": str(raw.get("incident_summary", "")).strip(),
        "probable_root_cause": str(raw.get("probable_root_cause", "")).strip(),
        "confidence": str(raw.get("confidence", "medium")).strip().lower() or "medium",
    }
    for key in _LIST_KEYS:
        out[key] = _clean_list(raw.get(key))
    sop = raw.get("sop") if isinstance(raw.get("sop"), dict) else {}
    out["sop"] = {
        "id": str(sop.get("id") or "SOP-APP-0142").strip(),
        "title": str(sop.get("title") or "Remediation procedure").strip(),
        "steps": _clean_list(sop.get("steps")),
    }
    if out["confidence"] not in ("high", "medium", "low"):
        out["confidence"] = "medium"
    missing = [k for k in ("incident_summary", "probable_root_cause") if not out[k]]
    missing += [k for k in ("diagnosis_steps", "resolution_steps") if not out[k]]
    if not out["sop"]["steps"]:
        missing.append("sop.steps")
    if missing:
        raise ValueError(f"model response is missing {', '.join(missing)}")
    return out


def generate(p: dict) -> dict:
    if not llm.llm_available():
        return {"ok": False, "error": "No LLM configured (COHERE_API_KEY is not set in backend/.env)."}
    try:
        incident = _incident_from_snow(p["sys_id"]) if p.get("sys_id") else dict(p.get("incident") or {})
    except (snow.NotConfigured, httpx.HTTPError, pc.BadResponse, KeyError) as exc:
        return {"ok": False, "error": f"Couldn't read the incident from ServiceNow: {exc}"}
    if p.get("ci") and not incident.get("ci"):
        incident["configuration_item"] = p["ci"]

    evidence = "\n".join(f"- {e}" for e in p.get("evidence", [])) or (
        "- No monitoring or log telemetry is connected for this incident. Reason from the record, its work notes "
        "and comments only; set confidence accordingly and make the diagnosis steps say what to check to confirm."
    )
    # The reviewing engineer's input: notes added during evidence review, and change requests on a previous draft.
    review = ""
    if p.get("engineer_note"):
        review += f"\nENGINEER NOTES FROM EVIDENCE REVIEW\n{str(p['engineer_note'])[:1000]}\n"
    if p.get("feedback"):
        review += (
            "\nTHE ENGINEER REJECTED THE PREVIOUS DRAFT AND ASKED FOR THESE CHANGES (address every point)\n"
            f"{str(p['feedback'])[:1000]}\n"
        )
    prompt = _PROMPT.format(incident=json.dumps(incident, indent=2, ensure_ascii=False), evidence=evidence, review=review)

    started = time.time()
    resp = None
    usage = {"input_tokens": None, "output_tokens": None}

    def log(ok: bool, error: str = "") -> None:
        # Token counts are the provider's billed units for this call; nothing is estimated.
        metrics.record_usage({
            "at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ"), "agent": "ServiceNow RCA Agent", "model": _MODEL,
            "incident": incident.get("number", ""), "ok": ok, "error": error[:200], "duration_ms": int((time.time() - started) * 1000),
            "redraft": bool(p.get("feedback")), **usage,
        })

    try:
        resp = llm._cohere_client().chat(
            model=_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.2,
        )
        billed = getattr(getattr(resp, "usage", None), "billed_units", None)
        if billed is not None:
            usage = {"input_tokens": int(billed.input_tokens or 0), "output_tokens": int(billed.output_tokens or 0)}
        text = next(item.text for item in resp.message.content if getattr(item, "text", None)).strip()
        text = re.sub(r"^```(json)?|```$", "", text, flags=re.MULTILINE).strip()
        rca = _validate(json.loads(text))
    except json.JSONDecodeError:
        log(False, "invalid JSON")
        return {"ok": False, "error": "The LLM didn't return valid JSON."}
    except Exception as exc:  # network, auth, quota, validation
        log(False, f"{type(exc).__name__}: {exc}")
        return {"ok": False, "error": f"LLM call failed: {type(exc).__name__}: {str(exc)[:200]}"}

    log(True)
    return {"ok": True, "rca": rca, "model": f"Cohere {_MODEL}", "incident": incident.get("number", ""), "usage": usage}
