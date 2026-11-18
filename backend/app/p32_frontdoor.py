"""Digital FrontDoor: the single employee gateway for IT Assets, IT Incidents and HR.

Two jobs live here, both server-side so no key or credential reaches the browser:

1. Intent routing. The employee's message is classified by Cohere into a domain
   (assets / incidents / hr / general) and an intent within it. When no LLM is
   configured or the call fails, a keyword classifier answers instead and the
   result says so (engine = "rules"). Each LLM call is written to the AI usage
   ledger with the provider's billed tokens.

2. The employee's own incidents. Incidents raised through the FrontDoor are
   tagged in ServiceNow (correlation_id = P32-FD:<employee id>). Every read here
   filters on the tag of the employee in the current session, so an employee
   can only see or ask about their own incidents.

Identity: the demo has no sign-in screen, so the session employee is fixed
below. In production it comes from the Point32Health SSO token validated at the
gateway; nothing in the request body can change it.
"""

import json
import re
import time
from datetime import datetime, timezone

import httpx

from . import itops_servicenow as snow
from . import llm
from . import p32_metrics as metrics
from . import platform_connect as pc
from .p32_rca import _MODEL

SESSION_EMPLOYEE = {"id": "EMP-24817", "name": "Maya Thompson", "department": "Finance"}
CHANNEL = "Crystal Clean Digital FrontDoor"


def session_employee() -> dict:
    return dict(SESSION_EMPLOYEE)


def _tag(emp: dict) -> str:
    return f"P32-FD:{emp['id']}"


# ------------------------------------------------------------------ routing

INTENTS = {
    "assets": ["my_assets", "asset_requests", "asset_history", "request_asset"],
    "incidents": ["report_issue", "incident_status", "incident_history", "troubleshoot"],
    "hr": ["leave_balance", "my_profile", "onboarding", "hr_policy", "hr_request", "hr_request_status", "sensitive"],
    "general": ["greeting", "thanks", "unclear"],
}

_PROMPT = """You route employee messages for Point32Health's Digital FrontDoor to the right team.

Domains and intents:
- assets (IT Assets: devices assigned to the employee, asset requests and history)
  - my_assets: which laptop/devices are assigned to me, asset details, warranty
  - asset_requests: status of a device or equipment request
  - asset_history: history of my devices (assignments, repairs, replacements)
  - request_asset: asks for new equipment (monitor, headset, keyboard, dock, new laptop)
- incidents (IT Incidents: something broken, incident status, troubleshooting)
  - report_issue: something is not working (device, app, network, email, printer) and they need help
  - incident_status: status of an incident or ticket (often gives a number like INC0010063)
  - incident_history: list of my incidents or tickets
  - troubleshoot: help setting up or configuring the system (MFA, VPN, email, apps install)
- hr (HR: leave, employee information, onboarding, policies, HR requests)
  - leave_balance: remaining leave, PTO, vacation, sick days, holidays
  - my_profile: my manager, department, start date, employee ID, job title, buddy
  - onboarding: what to complete before joining, onboarding checklist, documents, training
  - hr_policy: a question about an HR policy or benefit
  - hr_request: asks HR to do something (letter, address change, benefits enrolment change)
  - hr_request_status: status of an HR request or case
  - sensitive: salary, payroll, medical, disability, pregnancy, grievance, harassment, leave of absence
- general
  - greeting, thanks, unclear

Message: {text}

Respond with one JSON object only:
{{"domain": "assets|incidents|hr|general", "intent": "<one intent from that domain>", "device_issue": true|false, "confidence": "high|medium|low"}}
device_issue is true only when the problem is with the employee's own laptop or computer hardware."""

_NUM = re.compile(r"\b((?:INC|RITM|REQ|HRC)\d{7})\b", re.I)


def _rules(text: str) -> dict:
    t = text.lower()
    device = bool(re.search(r"\b(laptop|computer|pc|notebook|machine|dell|latitude)\b", t))
    broken = bool(re.search(r"not working|isn'?t working|broken|won'?t|doesn'?t|dead|slow|crash|freez|black|blue screen|stopped|can'?t|cannot|unable|error|issue|problem", t))
    num = _NUM.search(text)

    def r(domain: str, intent: str, dev: bool = False) -> dict:
        return {"domain": domain, "intent": intent, "device_issue": dev, "confidence": "medium"}

    if re.search(r"salary|payroll|\bpay\b|compensation|medical|disab|pregnan|grievance|harass|leave of absence", t):
        return r("hr", "sensitive")
    if num and num.group(1).upper().startswith("HRC"):
        return r("hr", "hr_request_status")
    if num and num.group(1).upper().startswith(("RITM", "REQ")):
        return r("assets", "asset_requests")
    if num or re.search(r"(incident|ticket).*(status|update)|(status|update).*(incident|ticket)", t):
        return r("incidents", "incident_status")
    if re.search(r"\b(leaves?|pto|vacation|holiday|time off|sick days?)\b", t):
        return r("hr", "leave_balance")
    if device and broken:
        return r("incidents", "report_issue", True)
    if re.search(r"my (incidents|tickets)|incident history|tickets? (have i|i raised)", t):
        return r("incidents", "incident_history")
    if re.search(r"set ?(it |my |me )?up|setting up|install|configure|mfa|authenticator|vpn|remote access", t):
        return r("incidents", "troubleshoot")
    if broken:
        return r("incidents", "report_issue")
    if re.search(r"(asset|device|equipment|laptop|monitor|headset).*(request|order)|(request|order).*(asset|device|equipment|laptop)", t) and re.search(r"status|where|track", t):
        return r("assets", "asset_requests")
    if re.search(r"\b(need|want|request|order|get) (a |an |another |new )?(second )?(monitor|headset|keyboard|mouse|dock|docking|webcam|laptop|charger)", t):
        return r("assets", "request_asset")
    if re.search(r"history", t) and re.search(r"laptop|device|asset", t):
        return r("assets", "asset_history")
    if re.search(r"(assigned|my) (laptop|device|computer|assets?|equipment)|serial|warranty|asset tag", t) or (device and "which" in t):
        return r("assets", "my_assets")
    if re.search(r"hr (request|case)|my (hr )?requests?", t):
        return r("hr", "hr_request_status")
    if re.search(r"letter|verification|change (my )?address|update (my )?(address|bank|details)|benefits? (enrol|change)", t):
        return r("hr", "hr_request")
    if re.search(r"manager|employee id|job title|department|start date|buddy|my profile|who am i", t):
        return r("hr", "my_profile")
    if re.search(r"before (i )?join|onboard|first day|checklist|documents?|i-9|w-4|training|to ?do|complete", t):
        return r("hr", "onboarding")
    if re.search(r"polic|benefit|dress code|working hours|hybrid|401k|insurance", t):
        return r("hr", "hr_policy")
    if re.search(r"^(thanks|thank you|great|ok|okay|cool)\b", t):
        return r("general", "thanks")
    if re.search(r"^(hi|hello|hey|good (morning|afternoon|evening))\b", t):
        return r("general", "greeting")
    return {"domain": "general", "intent": "unclear", "device_issue": False, "confidence": "low"}


def _normalise(raw: dict) -> dict:
    domain = str(raw.get("domain", "")).strip().lower()
    intent = str(raw.get("intent", "")).strip().lower()
    if domain not in INTENTS:
        raise ValueError(f"unknown domain '{domain}'")
    if intent not in INTENTS[domain]:
        # The model sometimes picks a sensible intent from another domain; keep the pair consistent.
        owner = next((d for d, names in INTENTS.items() if intent in names), None)
        if not owner:
            raise ValueError(f"unknown intent '{intent}'")
        domain = owner
    conf = str(raw.get("confidence", "medium")).lower()
    return {
        "domain": domain,
        "intent": intent,
        "device_issue": bool(raw.get("device_issue")),
        "confidence": conf if conf in ("high", "medium", "low") else "medium",
    }


def route(p: dict) -> dict:
    text = str(p.get("text", "")).strip()[:600]
    if not text:
        raise ValueError("text is required")
    num = _NUM.search(text)
    entities = {"number": num.group(1).upper()} if num else {}
    emp = session_employee()

    if not llm.llm_available():
        return {**_rules(text), "entities": entities, "engine": "rules", "reason": "No LLM configured (COHERE_API_KEY is not set)."}

    started = time.time()
    usage = {"input_tokens": None, "output_tokens": None}

    def log(ok: bool, error: str = "", result: dict | None = None) -> None:
        # Provider-billed tokens only; nothing estimated. No message text is stored.
        metrics.record_usage({
            "at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ"), "agent": "Digital FrontDoor Intent Router",
            "model": _MODEL, "incident": "", "kind": "routing", "employee": emp["id"],
            "routed_to": (result or {}).get("domain", ""), "ok": ok, "error": error[:200],
            "duration_ms": int((time.time() - started) * 1000), **usage,
        })

    try:
        resp = llm._cohere_client().chat(
            model=_MODEL,
            messages=[{"role": "user", "content": _PROMPT.format(text=json.dumps(text))}],
            response_format={"type": "json_object"},
            temperature=0,
        )
        billed = getattr(getattr(resp, "usage", None), "billed_units", None)
        if billed is not None:
            usage = {"input_tokens": int(billed.input_tokens or 0), "output_tokens": int(billed.output_tokens or 0)}
        out = next(item.text for item in resp.message.content if getattr(item, "text", None)).strip()
        out = re.sub(r"^```(json)?|```$", "", out, flags=re.MULTILINE).strip()
        result = _normalise(json.loads(out))
    except Exception as exc:  # network, auth, quota, invalid JSON, unknown labels
        log(False, f"{type(exc).__name__}: {exc}")
        return {**_rules(text), "entities": entities, "engine": "rules", "reason": f"AI routing unavailable ({type(exc).__name__}); used keyword rules."}

    # A ticket number in the text is unambiguous; let it correct a vague classification.
    if entities.get("number", "").startswith("INC") and result["intent"] not in ("incident_status", "report_issue"):
        result.update(domain="incidents", intent="incident_status")
    log(True, result=result)
    return {**result, "entities": entities, "engine": "ai", "model": f"Cohere {_MODEL}", "usage": usage}


# --------------------------------------------------------- employee's incidents

_FIELDS = "sys_id,number,short_description,state,priority,category,opened_at,resolved_at,sys_updated_on,close_notes"


def _disp(v):
    return v.get("display_value", "") if isinstance(v, dict) else (v or "")


def _employee_view(c: dict, r: dict) -> dict:
    """Only what the employee needs: no assignment group, no work notes, no agent detail."""
    sys_id = _disp(r.get("sys_id"))
    return {
        "number": _disp(r.get("number")),
        "sys_id": sys_id,
        "short_description": _disp(r.get("short_description")),
        "state": _disp(r.get("state")),
        "priority": _disp(r.get("priority")),
        "category": _disp(r.get("category")),
        "opened_at": _disp(r.get("opened_at")),
        "resolved_at": _disp(r.get("resolved_at")),
        "updated_at": _disp(r.get("sys_updated_on")),
        "url": snow._record_url(c, "incident", sys_id),
    }


def _query(c: dict, query: str, limit: int = 50) -> list[dict]:
    resp = httpx.get(
        f"{c['instance_url']}/api/now/table/incident",
        params={"sysparm_query": query, "sysparm_fields": _FIELDS, "sysparm_display_value": "true", "sysparm_limit": limit},
        auth=snow._auth(c), headers={"Accept": "application/json"}, timeout=snow._TIMEOUT,
    )
    resp.raise_for_status()
    return pc._safe_json(resp, "servicenow").get("result", [])


def my_incidents(p: dict) -> dict:
    c = snow._creds()
    emp = session_employee()
    rows = _query(c, f"correlation_id={_tag(emp)}^ORDERBYDESCsys_created_on")
    return {"employee": emp, "incidents": [_employee_view(c, r) for r in rows]}


def incident_status(p: dict) -> dict:
    number = str(p.get("number", "")).strip().upper()
    if not re.fullmatch(r"INC\d{7}", number):
        raise ValueError("number must look like INC0010063")
    c = snow._creds()
    emp = session_employee()
    rows = _query(c, f"number={number}^correlation_id={_tag(emp)}", limit=1)
    # Same answer whether the incident doesn't exist or belongs to someone else: nothing leaks.
    if not rows:
        return {"found": False, "number": number}
    rec = _employee_view(c, rows[0])
    latest = _latest_comment(c, rec["sys_id"])
    return {"found": True, **rec, "latest_update": latest}


def _latest_comment(c: dict, sys_id: str) -> dict | None:
    """The newest customer-visible comment (never work notes, which are for IT)."""
    resp = httpx.get(
        f"{c['instance_url']}/api/now/table/sys_journal_field",
        params={
            "sysparm_query": f"element_id={sys_id}^element=comments^ORDERBYDESCsys_created_on",
            "sysparm_fields": "value,sys_created_on", "sysparm_display_value": "true", "sysparm_limit": 1,
        },
        auth=snow._auth(c), headers={"Accept": "application/json"}, timeout=snow._TIMEOUT,
    )
    resp.raise_for_status()
    rows = pc._safe_json(resp, "servicenow").get("result", [])
    return {"text": _disp(rows[0].get("value")), "at": _disp(rows[0].get("sys_created_on"))} if rows else None


def raise_incident(p: dict) -> dict:
    """Create the incident for the session employee and tag it, so it shows in their records only."""
    emp = session_employee()
    payload = {k: p[k] for k in ("short_description", "description", "impact", "urgency", "category", "assignment_group_name") if p.get(k)}
    payload.update(contact_type="self-service", caller_is_me=True)
    return snow.create_incident(payload, extra={"correlation_id": _tag(emp), "correlation_display": CHANNEL})


# ------------------------------------------------------------------ dispatch

OPS = {
    "route": route,
    "whoami": lambda p: {"employee": session_employee()},
    "my_incidents": my_incidents,
    "incident_status": incident_status,
    "raise_incident": raise_incident,
}


def run(op: str, payload: dict) -> dict:
    fn = OPS.get(op)
    if fn is None:
        return {"ok": False, "error": f"unknown op '{op}'"}
    try:
        return {"ok": True, **fn(payload)}
    except snow.NotConfigured as exc:
        return {"ok": False, "error": str(exc), "not_configured": True}
    except pc.BadResponse as exc:
        return {"ok": False, "error": str(exc)}
    except httpx.HTTPStatusError as exc:
        return {"ok": False, "error": f"ServiceNow HTTP {exc.response.status_code}"}
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
