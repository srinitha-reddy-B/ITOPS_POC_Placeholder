"""Digital FrontDoor domains beyond incidents: IT Assets and HR (Live Agent Mode).

Registers extra agents and ServiceNow tools on the workbench (same /api/p32/wb/agent and
/api/p32/wb/tool endpoints, same validation, audit and usage logging):

* router: classifies a FrontDoor request as an IT incident, an IT asset request or an HR request.
* IT Assets: asset intake, asset context (real alm_hardware record + the CI's incident history),
  lifecycle decision (repair / replace / loaner), request closure. Fulfillment places real
  Service Catalog orders, only after the asset approval is recorded on the server.
* HR: HR intake, HR policy (synthetic POC policy library; the POC instance has no HR module),
  onboarding / case plan, request closure. Onboarding places a real "New Hire" catalog order
  after the HR approval is recorded on the server.

Catalog items that may be ordered are whitelisted here; the browser can't order anything else.
"""

import re

import httpx

from . import itops_servicenow as snow
from . import p32_workbench as wb

# ----------------------------------------------------------------- agents

wb.AGENTS.update({
    "router": {
        "name": "FrontDoor Router Agent",
        "role": "Read an employee's request and route it to exactly one domain: 'incident' (something is broken or failing for a business application or service), 'asset' (the employee's own device or equipment: faulty, damaged, lost, needs replacing or a loaner), or 'hr' (onboarding, leave, benefits, HR policy). For incidents, choose the closest service from the services list (exact text) or leave it empty.",
        "contract": {
            "domain": "incident | asset | hr",
            "confidence": 0.0,
            "reason": "one sentence: why this domain",
            "use_case": "use-case id from the list for incidents, else empty",
            "service": "exact service name from the list for incidents, else empty",
            "summary": "one-sentence restatement of the request",
        },
        "enums": {"domain": ["incident", "asset", "hr"]},
        "required": ["domain", "reason", "summary"],
    },
    "a_intake": {
        "name": "Asset Intake Agent",
        "role": "Validate an IT asset request: what is wrong with which device, the request type, any asset tag mentioned, and the impact on the employee's work. Say what is missing if the request can't be acted on.",
        "contract": {
            "issue_summary": "one sentence",
            "request_type": "fault | damage | loss | upgrade | new_equipment",
            "symptoms": ["1-4 items: symptom"],
            "asset_tag_mentioned": "asset tag if the request names one, else empty",
            "business_impact": "impact on the employee's work",
            "missing_info": ["0-3 items: what is missing"],
            "validation": "pass | needs_info",
            "reasoning": "why it passed or failed",
        },
        "lists": ["symptoms", "missing_info"],
        "enums": {"validation": ["pass", "needs_info"], "request_type": ["fault", "damage", "loss", "upgrade", "new_equipment"]},
        "required": ["issue_summary", "request_type", "validation", "reasoning"],
    },
    "a_context": {
        "name": "Asset Context Agent",
        "role": "Summarise the device's real asset record, its repair/incident history and the device health readings, and point out what matters for a repair-or-replace decision.",
        "contract": {
            "asset_summary": "model, owner, status in one or two sentences",
            "age_years": 0.0,
            "warranty_status": "in_warranty | expired | unknown",
            "history_summary": "what the incident history shows",
            "health_findings": ["1-5 items: finding from the device health readings, citing the reading"],
            "risks": ["0-3 items: risk, e.g. data loss"],
            "gaps": ["0-3 items: missing information"],
        },
        "lists": ["health_findings", "risks", "gaps"],
        "enums": {"warranty_status": ["in_warranty", "expired", "unknown"]},
        "required": ["asset_summary", "warranty_status", "health_findings"],
    },
    "a_decision": {
        "name": "Lifecycle Decision Agent",
        "role": "Recommend repair under warranty, paid repair, replacement, or a loaner while repairing, by applying the lifecycle policy rules in the context to the asset facts. Only use catalog items from the allowed list. Say what happens to the employee's data and the old device.",
        "contract": {
            "recommendation": "repair_under_warranty | paid_repair | replace | loaner_and_repair | no_action",
            "rationale": "2-3 sentences citing the policy rules and asset facts",
            "policy_rules_applied": ["1-4 items: rule id and how it applied"],
            "catalog_items": ["0-2 items: exact names from allowed_catalog_items"],
            "estimated_cost": "cost estimate with basis, or 'covered by warranty'",
            "data_handling": ["1-3 items: backup, transfer or wipe step"],
            "employee_impact": "what the employee should expect",
            "confidence": "high | medium | low",
        },
        "lists": ["policy_rules_applied", "catalog_items", "data_handling"],
        "enums": {"recommendation": ["repair_under_warranty", "paid_repair", "replace", "loaner_and_repair", "no_action"], "confidence": ["high", "medium", "low"]},
        "required": ["recommendation", "rationale", "policy_rules_applied"],
    },
    "h_intake": {
        "name": "HR Intake Agent",
        "role": "Understand an HR request: the type (onboarding a new hire, leave, benefits change, policy question), who it is for, the key dates and details, and what is missing. Do not ask for or repeat sensitive personal data (medical details, identifiers).",
        "contract": {
            "request_type": "onboarding | leave | benefits | policy_question | other",
            "summary": "one sentence",
            "person": "name of the new hire or employee as given (synthetic), or 'the requester'",
            "key_dates": ["0-3 items: date and what it is"],
            "details": ["1-5 items: relevant detail (role, department, equipment, systems)"],
            "missing_info": ["0-3 items"],
            "validation": "pass | needs_info",
            "reasoning": "why",
        },
        "lists": ["key_dates", "details", "missing_info"],
        "enums": {"validation": ["pass", "needs_info"], "request_type": ["onboarding", "leave", "benefits", "policy_question", "other"]},
        "required": ["request_type", "summary", "validation", "reasoning"],
    },
    "h_policy": {
        "name": "HR Policy Agent",
        "role": "Answer from the HR policy library in the context only (it is a synthetic POC library). Quote the policy ids you used, state eligibility and conditions, and say plainly when the library doesn't cover something so an HR partner can confirm.",
        "contract": {
            "answer": "plain-language answer for the employee, 2-5 sentences",
            "policies_applied": [{"id": "policy id", "title": "title", "how_it_applies": "one sentence"}],
            "eligibility": "eligible | not_eligible | needs_review",
            "conditions": ["0-4 items: condition or deadline"],
            "gaps": ["0-3 items: what the library doesn't cover"],
        },
        "lists": ["policies_applied", "conditions", "gaps"],
        "enums": {"eligibility": ["eligible", "not_eligible", "needs_review"]},
        "required": ["answer", "policies_applied", "eligibility"],
    },
    "h_plan": {
        "name": "HR Plan Agent",
        "role": "Turn the request and the policy answer into an actionable plan: tasks with an owner team, a due date relative to the key date, and the system involved. Only use ServiceNow catalog items from the allowed list, and only when the request needs them (for example onboarding equipment and accounts).",
        "contract": {
            "plan_title": "title",
            "tasks": [{"task": "3-8 items: task", "owner": "team", "due": "date or relative date", "system": "system"}],
            "servicenow_requests": ["0-2 items: exact names from allowed_catalog_items"],
            "employee_message": "what the requester will be told",
            "notes": "anything the HR partner should check",
        },
        "lists": ["tasks", "servicenow_requests"],
        "required": ["plan_title", "tasks", "employee_message"],
    },
    "r_close": {
        "name": "Request Closure Agent",
        "role": "Close out the request: a short summary of what was decided and done, a work note for the fulfilment team, and a plain-language update for the requester (no internal agent names or technical logs).",
        "contract": {
            "summary": "2-4 sentences",
            "work_note": "fulfilment-team note",
            "employee_update": "2-3 short sentences for the requester: what happens next and when. No policy ids, no device readings, no costs, no internal team or agent names.",
        },
        "required": ["summary", "work_note", "employee_update"],
    },
})

# The closure node is a_close (assets) or h_close (HR) in the page; both use the request closure agent.
wb.AGENTS["a_close"] = wb.AGENTS["h_close"] = wb.AGENTS["r_close"]

# ---------------------------------------------------------- catalog items

CATALOG = {
    "Standard Laptop": "04b7e94b4f7b4200086eeed18110c7fd",
    "Loaner Laptop": "10f110aec611227601fbe1841e7e417c",
    "Developer Laptop (Mac)": "774906834fbb4200086eeed18110c737",
    "New Hire": "6690750f4f7b4200086eeed18110c761",
}
ALLOWED = {"asset": ["Standard Laptop", "Loaner Laptop", "Developer Laptop (Mac)"], "hr": ["New Hire", "Standard Laptop"]}


def _me(c: dict) -> str | None:
    return snow._lookup(c, "sys_user", f"user_name={c['username']}")


# ------------------------------------------------------------------ tools


def _tool_asset_lookup(r: dict, a: dict) -> dict:
    tag = str(a.get("asset_tag", "")).strip()
    if tag and not re.fullmatch(r"[A-Za-z0-9-]{3,20}", tag):
        raise ValueError("invalid asset tag")
    fields = "sys_id,asset_tag,display_name,model,model_category,assigned_to,install_status,substatus,purchase_date,warranty_expiration,cost,ci,location,department"
    c = snow._creds()
    if tag:
        rows = wb._q("alm_hardware", f"asset_tag={tag}", fields, 1)
    else:  # the requester's own primary computer
        rows = wb._q("alm_hardware", f"assigned_to.user_name={c['username']}^model_category.nameLIKEcomputer^ORDERBYDESCpurchase_date", fields, 1)
    if not rows:
        return {"found": False, "reason": f"No hardware asset {'with tag ' + tag if tag else 'assigned to the requester'} in ServiceNow."}
    x = rows[0]
    ci_rows = wb._q("cmdb_ci", f"name={x['ci']}", "sys_id,name", 1) if x.get("ci") else []
    with wb._lock:
        r["asset"] = {"sys_id": x["sys_id"], "tag": x["asset_tag"], "ci": ci_rows[0]["sys_id"] if ci_rows else ""}
        wb._save_runs()
    x["url"] = wb._url("alm_hardware", x.pop("sys_id"))
    x["found"] = True
    return x


def _tool_ci_history(r: dict, a: dict) -> dict:
    ci = (r.get("asset") or {}).get("ci")
    if not ci:
        return {"incidents": [], "note": "The asset has no configuration item, so no incident history."}
    rows = wb._q("incident", f"cmdb_ci={ci}^sys_created_on>=javascript:gs.daysAgoStart(730)^ORDERBYDESCsys_created_on", "sys_id,number,short_description,state,sys_created_on", 10)
    return {"incidents": [{"id": x["number"], "title": x["short_description"], "state": x["state"], "opened": x["sys_created_on"], "url": wb._url("incident", x["sys_id"])} for x in rows]}


def _tool_catalog_order(r: dict, a: dict) -> dict:
    domain = a.get("domain")
    item = str(a.get("item", ""))
    if domain not in ALLOWED or item not in ALLOWED[domain]:
        raise ValueError(f"'{item}' is not an allowed catalog item for {domain}")
    if not wb._approved(r, domain):
        raise PermissionError(f"Blocked: the {domain.upper()} approval has not been recorded for this run.")
    if any(o["item"] == item for o in r.get("orders", [])):
        raise ValueError(f"'{item}' was already ordered for this run")
    c = snow._creds()
    me = _me(c)
    variables = {}
    if item == "New Hire":
        group = None
        for name in ("Finance", "Service Desk", "Hardware"):
            group = snow._lookup(c, "sys_user_group", f"name={name}")
            if group:
                break
        variables = {"hiring_manager": me or "", "hiring_group": group or "", "remote": "false", "standard_package": "true"}
    elif item == "Loaner Laptop":
        variables = {"how_long_do_you_need_it_for": "2 weeks"}
    resp = httpx.post(
        f"{c['instance_url']}/api/sn_sc/servicecatalog/items/{CATALOG[item]}/order_now",
        json={"sysparm_quantity": "1", "variables": variables, **({"sysparm_requested_for": me} if me else {})},
        auth=snow._auth(c), headers={"Content-Type": "application/json", "Accept": "application/json"}, timeout=snow._TIMEOUT,
    )
    resp.raise_for_status()
    res = resp.json().get("result", {})
    req_id = res.get("sys_id") or res.get("request_id")
    note = str(a.get("note", ""))[:900]
    snow._record(c, "sc_request", "PATCH", req_id, {"special_instructions": f"[P32 Agentic Workbench, synthetic POC request] {note}"})
    ritms = wb._q("sc_req_item", f"request={req_id}", "sys_id,number,stage,state,approval,cat_item", 5)
    order = {"item": item, "request": res.get("request_number") or res.get("number"), "request_sys_id": req_id, "url": wb._url("sc_request", req_id),
             "ritms": [{"number": x["number"], "sys_id": x["sys_id"], "url": wb._url("sc_req_item", x["sys_id"])} for x in ritms]}
    with wb._lock:
        r.setdefault("orders", []).append(order)
        wb._save_runs()
    return {k: v for k, v in order.items() if k != "request_sys_id"}


def _tool_request_readback(r: dict, a: dict) -> dict:
    out = []
    for o in r.get("orders", []):
        req = wb._q("sc_request", f"sys_id={o['request_sys_id']}", "number,request_state,approval,stage,requested_for,price", 1)
        items = wb._q("sc_req_item", f"request={o['request_sys_id']}", "sys_id,number,stage,state,approval,cat_item", 5)
        appr = wb._q("sysapproval_approver", f"sysapproval.sys_idIN{','.join(i['sys_id'] for i in items) or 'none'}^ORsysapproval={o['request_sys_id']}", "state,approver,sysapproval", 10)
        tasks = wb._q("sc_task", f"request_item.sys_idIN{','.join(i['sys_id'] for i in items) or 'none'}", "number,state,short_description,assignment_group", 10)
        out.append({"item": o["item"], "request": req[0] if req else {}, "items": items, "approvals": appr, "tasks": tasks, "url": o["url"]})
    return {"orders": out}


def _tool_request_note(r: dict, a: dict) -> dict:
    domain = a.get("domain")
    if domain not in ALLOWED or not wb._approved(r, domain):
        raise PermissionError("Blocked: approval not recorded for this run.")
    c = snow._creds()
    n = 0
    for o in r.get("orders", []):
        for it in o["ritms"]:
            snow._record(c, "sc_req_item", "PATCH", it["sys_id"], {"work_notes": str(a.get("text", ""))[:3000]})
            n += 1
    if not n:
        raise ValueError("no ServiceNow request items on this run")
    return {"posted": n}


wb.TOOLS.update({
    "sn_asset_lookup": ("ServiceNow asset lookup (alm_hardware)", _tool_asset_lookup),
    "sn_ci_history": ("ServiceNow incident history for the device", _tool_ci_history),
    "sn_catalog_order": ("ServiceNow Service Catalog order", _tool_catalog_order),
    "sn_request_readback": ("ServiceNow request read-back", _tool_request_readback),
    "sn_request_note": ("ServiceNow request work notes", _tool_request_note),
})
