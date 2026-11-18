"""CIO Control Tower metrics for the Point32Health POC, from the live ServiceNow instance.

Every metric carries a classification so the dashboard never mixes real and made-up
numbers:
  live        -- read directly from ServiceNow (or the LLM provider's usage report)
  calculated  -- derived from live records with the documented formula in `formula`
  unavailable -- the instance has no data source for it; `reason` says what is missing

Read-only: this module never writes to ServiceNow.
"""

import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from . import itops_servicenow as snow
from . import platform_connect as pc

UTC = timezone.utc
_FMT = "%Y-%m-%d %H:%M:%S"
_PAGE = 1000
_RECUR_DAYS = 30
_ROLES = {"cio", "it_admin", "engineer"}


class Forbidden(Exception):
    pass


def check_role(role: str | None, allowed: set[str] = _ROLES) -> str:
    """POC-level role check (sent by the UI). Production would take the role from SSO."""
    r = (role or "").strip().lower()
    if r not in allowed:
        raise Forbidden(f"Role '{role or 'none'}' may not view this data.")
    return r


# ------------------------------------------------------------------ fetching


def _get(c: dict, table: str, query: str, fields: str, display: str = "false", limit: int = _PAGE) -> list[dict]:
    out: list[dict] = []
    offset = 0
    while True:
        resp = httpx.get(
            f"{c['instance_url']}/api/now/table/{table}",
            params={"sysparm_query": query, "sysparm_fields": fields, "sysparm_display_value": display, "sysparm_limit": limit, "sysparm_offset": offset, "sysparm_exclude_reference_link": "true"},
            auth=snow._auth(c), headers={"Accept": "application/json"}, timeout=snow._TIMEOUT,
        )
        resp.raise_for_status()
        rows = pc._safe_json(resp, "servicenow").get("result", [])
        out += rows
        if len(rows) < limit or offset > 10 * limit:
            return out
        offset += limit


def _ts(v) -> datetime | None:
    if isinstance(v, dict):
        v = v.get("value")
    if not v:
        return None
    try:
        return datetime.strptime(v, _FMT).replace(tzinfo=UTC)
    except ValueError:
        return None


def _v(row: dict, key: str) -> str:
    x = row.get(key)
    return (x.get("value") if isinstance(x, dict) else x) or ""


def _d(row: dict, key: str) -> str:
    x = row.get(key)
    return (x.get("display_value") if isinstance(x, dict) else x) or ""


def _hours(a: datetime | None, b: datetime | None) -> float | None:
    if not a or not b or b < a:
        return None
    return (b - a).total_seconds() / 3600


def _mean(xs: list[float]) -> float | None:
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def _median(xs: list[float]) -> float | None:
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    m = len(xs) // 2
    return xs[m] if len(xs) % 2 else (xs[m - 1] + xs[m]) / 2


def _norm_symptom(text: str) -> str:
    words = re.sub(r"[^a-z\s]", " ", (text or "").lower()).split()
    return " ".join(w for w in words if len(w) > 2)[:60]


# ------------------------------------------------------- AURA work notes


def _aura_kind(text: str) -> tuple[str, str]:
    """Classify an AURA work note into a workflow event (kind, actor)."""
    t = text or ""
    # Asset & Endpoint Agent (employee device incidents from the employee portal).
    if t.startswith("[AURA] Asset agent"):
        if "Employee confirmed" in t:
            return ("asset_resolved", "Employee")
        if "still not working" in t:
            return ("caller_rejected", "Employee")
        if "Manual takeover" in t:
            return ("asset_manual", "IT technician")
        if "Action failed" in t:
            return ("asset_failed", "Asset & Endpoint Agent")
        if "after retry" in t:
            return ("asset_retry", "Asset & Endpoint Agent")
        if "Diagnostics" in t:
            return ("asset_diag", "Asset & Endpoint Agent")
        if "Device checked" in t:
            return ("asset_check", "Asset & Endpoint Agent")
        if "Routed" in t:
            return ("asset_intake", "Asset & Endpoint Agent")
        return ("asset_action", "Asset & Endpoint Agent")
    if "AURA RCA AGENT" in t:
        return ("rca_posted", "ServiceNow RCA Agent")
    if t.startswith("[AURA] Triage"):
        return ("triage", "ServiceNow RCA Agent")
    if "Evidence reviewed" in t:
        return ("evidence_review", "Engineer")
    if "returned by" in t and "for changes" in t:
        return ("change_request", "Engineer")
    if "executed manually" in t:
        return ("manual_takeover", "Engineer")
    if "executed by automation" in t:
        return ("sop_retry" if "retry" in t else "sop_executed", "Remediation automation")
    if "still occurs" in t:
        return ("caller_rejected", "Caller")
    if "Verification passed" in t:
        return ("verification", "Service health checks")
    if "Approved the AURA RCA Agent" in t:
        return ("approval", "Engineer")
    if "Knowledge" in t:
        return ("knowledge", "ServiceNow RCA Agent")
    return ("note", "AURA")


# ------------------------------------------------------------------ periods


def _buckets(start: datetime, end: datetime, days: int) -> list[dict]:
    step = timedelta(days=30) if days > 120 else timedelta(days=7)
    out, cur = [], start
    while cur < end:
        nxt = min(cur + step, end)
        out.append({"start": cur, "end": nxt, "label": cur.strftime("%d %b") if step.days == 7 else cur.strftime("%b %Y")})
        cur = nxt
    return out


def _in(t: datetime | None, a: datetime, b: datetime) -> bool:
    return bool(t) and a <= t < b


# --------------------------------------------------------------- the report


def ops_metrics(days: int = 90, role: str | None = None) -> dict:
    check_role(role)
    days = max(7, min(int(days), 365))
    c = snow._creds()
    t0 = time.time()
    now = datetime.now(UTC).replace(microsecond=0)
    start = now - timedelta(days=days)
    prev_start = start - timedelta(days=days)
    q_from = (prev_start - timedelta(days=_RECUR_DAYS)).strftime(_FMT)
    errors: list[str] = []

    def safe(name: str, fn):
        try:
            return fn()
        except (httpx.HTTPError, pc.BadResponse) as exc:
            errors.append(f"{name}: {exc}")
            return None

    incidents = safe("incidents", lambda: _get(
        c, "incident", f"opened_at>={q_from}^ORresolved_at>={q_from}",
        "sys_id,number,short_description,opened_at,resolved_at,closed_at,state,priority,category,assignment_group,assigned_to,cmdb_ci,reopen_count,close_code,caller_id",
        display="all",
    )) or []
    ids = {_v(r, "sys_id") for r in incidents}

    audits = safe("audit", lambda: _get(
        c, "sys_audit", f"tablename=incident^fieldnameINstate,assigned_to^sys_created_on>={prev_start.strftime(_FMT)}",
        "documentkey,fieldname,oldvalue,newvalue,sys_created_on", limit=_PAGE,
    ))
    slas = safe("sla", lambda: _get(
        c, "task_sla", f"task.sys_class_name=incident^start_time>={prev_start.strftime(_FMT)}",
        "task,sla,stage,has_breached,start_time,planned_end_time,end_time", display="all",
    ))
    changes = safe("changes", lambda: _get(
        c, "change_request", f"closed_at>={prev_start.strftime(_FMT)}",
        "sys_id,number,short_description,close_code,closed_at,type", display="all",
    ))
    outages = safe("outages", lambda: _get(
        c, "cmdb_ci_outage", f"begin<{now.strftime(_FMT)}^end>={prev_start.strftime(_FMT)}^ORendISEMPTY",
        "sys_id,cmdb_ci,begin,end,type", display="all",
    ))
    notes = safe("work notes", lambda: _get(
        c, "sys_journal_field",
        f"element=work_notes^sys_created_on>={prev_start.strftime(_FMT)}^valueSTARTSWITH[AURA]^ORvalueLIKEAURA RCA AGENT",
        "element_id,value,sys_created_on,sys_created_by",
    ))

    # ---- per-incident facts
    first_ack: dict[str, datetime] = {}
    for a in audits or []:
        key, f = a.get("documentkey"), a.get("fieldname")
        if key not in ids:
            continue
        ack = (f == "state" and a.get("oldvalue") == "1") or (f == "assigned_to" and not a.get("oldvalue") and a.get("newvalue"))
        t = _ts(a.get("sys_created_on"))
        if ack and t and (key not in first_ack or t < first_ack[key]):
            first_ack[key] = t

    breached: dict[str, bool] = {}
    sla_rows = []
    for s in slas or []:
        key = _v(s, "task")
        hb = _v(s, "has_breached") == "true"
        breached[key] = breached.get(key, False) or hb
        sla_rows.append({
            "task": _d(s, "task"), "sla": _d(s, "sla"), "stage": _d(s, "stage"), "breached": hb,
            "start": _v(s, "start_time"), "planned_end": _v(s, "planned_end_time"),
            # Record link from the instance URL and the incident's sys_id (task_sla is restricted to incidents above).
            "url": f"{c['instance_url']}/incident.do?sys_id={key}" if key else "",
        })

    events_by_inc: dict[str, list[dict]] = {}
    for n in notes or []:
        kind, actor = _aura_kind(n.get("value", ""))
        events_by_inc.setdefault(n.get("element_id"), []).append({
            "at": n.get("sys_created_on"), "kind": kind, "actor": actor, "by": n.get("sys_created_by"),
            "text": (n.get("value") or "")[:400],
        })
    for evs in events_by_inc.values():
        evs.sort(key=lambda e: e["at"] or "")

    recs = []
    for r in incidents:
        sid = _v(r, "sys_id")
        opened, resolved = _ts(r.get("opened_at")), _ts(r.get("resolved_at")) or _ts(r.get("closed_at"))
        ev = events_by_inc.get(sid, [])
        recs.append({
            "sys_id": sid, "number": _d(r, "number"), "short": _d(r, "short_description"),
            "state": _d(r, "state"), "priority": _d(r, "priority"), "category": _d(r, "category"),
            "group": _d(r, "assignment_group"), "assigned_to": _d(r, "assigned_to"), "ci": _d(r, "cmdb_ci"), "ci_id": _v(r, "cmdb_ci"),
            "opened": opened, "resolved": resolved, "reopened": int(_v(r, "reopen_count") or 0) > 0,
            "close_code": _d(r, "close_code"),
            "mttr_h": _hours(opened, resolved), "mtta_h": _hours(opened, first_ack.get(sid)),
            "sla_breached": breached.get(sid), "ai_assisted": any(e["kind"] in ("rca_posted", "asset_diag") for e in ev),
            "url": f"{c['instance_url']}/incident.do?sys_id={sid}",
        })

    # Recurrence: same CI, or same symptom, within the previous 30 days.
    by_time = sorted([x for x in recs if x["opened"]], key=lambda x: x["opened"])
    for i, x in enumerate(by_time):
        x["recurring"] = False
        for y in by_time[:i]:
            if x["opened"] - y["opened"] > timedelta(days=_RECUR_DAYS):
                continue
            if (x["ci_id"] and x["ci_id"] == y["ci_id"]) or (_norm_symptom(x["short"]) and _norm_symptom(x["short"]) == _norm_symptom(y["short"])):
                x["recurring"] = True
                x["recurs_of"] = y["number"]
                break

    # ---- metric functions over a time window
    def window(a: datetime, b: datetime) -> dict:
        opened = [x for x in recs if _in(x["opened"], a, b)]
        resolved = [x for x in recs if _in(x["resolved"], a, b)]
        sla_in = [s for s in sla_rows if _in(_ts(s["start"]), a, b)]
        ch = [ch for ch in (changes or []) if _in(_ts(ch.get("closed_at")), a, b)]
        ch_fail = [c_ for c_ in ch if _d(c_, "close_code").lower() == "unsuccessful"]
        mins = (b - a).total_seconds() / 60
        out_by_ci: dict[str, float] = {}
        out_n = 0
        for o in outages or []:
            if _d(o, "type").lower() == "planned":
                continue
            ob, oe = _ts(o.get("begin")), _ts(o.get("end")) or now
            if not ob:
                continue
            lo, hi = max(ob, a), min(oe, b)
            if hi > lo:
                out_n += 1
                ci = _d(o, "cmdb_ci") or "Unknown service"
                out_by_ci[ci] = out_by_ci.get(ci, 0) + (hi - lo).total_seconds() / 60
        avail = _mean([max(0.0, 1 - m / mins) for m in out_by_ci.values()]) if out_by_ci else None
        return {
            "opened": len(opened),
            "resolved": len(resolved),
            "mttr_h": _mean([x["mttr_h"] for x in resolved]),
            "mttr_median_h": _median([x["mttr_h"] for x in resolved]),
            "mtta_h": _mean([x["mtta_h"] for x in opened]),
            "mtta_n": len([x for x in opened if x["mtta_h"] is not None]),
            "recurrence_pct": (100 * len([x for x in opened if x.get("recurring")]) / len(opened)) if opened else None,
            "recurring": len([x for x in opened if x.get("recurring")]),
            "reopened": len([x for x in opened if x["reopened"]]),
            "ai_assisted_resolved": len([x for x in resolved if x["ai_assisted"]]),
            "ai_assisted_pct": (100 * len([x for x in resolved if x["ai_assisted"]]) / len(resolved)) if resolved else None,
            "sla_total": len(sla_in),
            "sla_breached": len([s for s in sla_in if s["breached"]]),
            "sla_met_pct": (100 * (1 - len([s for s in sla_in if s["breached"]]) / len(sla_in))) if sla_in else None,
            "changes_closed": len(ch),
            "changes_failed": len(ch_fail),
            "change_failure_pct": (100 * len(ch_fail) / len(ch)) if ch else None,
            "outages": out_n,
            "outage_hours": sum(out_by_ci.values()) / 60,
            "availability_pct": (100 * avail) if avail is not None else None,
            "services_affected": len(out_by_ci),
        }

    cur, prev = window(start, now), window(prev_start, start)
    trend = [{"label": b["label"], **window(b["start"], b["end"])} for b in _buckets(start, now, days)]

    def iso(t):
        return t.strftime(_FMT) + "Z" if t else None

    records = [
        {**{k: v for k, v in x.items() if k not in ("opened", "resolved", "ci_id")}, "opened": iso(x["opened"]), "resolved": iso(x["resolved"]),
         "in_period": _in(x["opened"], start, now) or _in(x["resolved"], start, now)}
        for x in recs if _in(x["opened"], prev_start, now) or _in(x["resolved"], prev_start, now)
    ]
    records.sort(key=lambda x: x["opened"] or "", reverse=True)

    # AURA activity (live, from ServiceNow work notes)
    num_by_id = {x["sys_id"]: x["number"] for x in recs}
    url_by_id = {x["sys_id"]: x["url"] for x in recs}
    activity = []
    for sid, evs in events_by_inc.items():
        for e in evs:
            activity.append({**e, "number": num_by_id.get(sid, sid[:8]), "url": url_by_id.get(sid, f"{c['instance_url']}/incident.do?sys_id={sid}"), "in_period": _in(_ts(e["at"]), start, now)})
    activity.sort(key=lambda e: e["at"] or "", reverse=True)

    return {
        "ok": True,
        "generated_at": iso(now),
        "elapsed_ms": int((time.time() - t0) * 1000),
        "instance": c["instance_url"].replace("https://", ""),
        "period": {"days": days, "start": iso(start), "end": iso(now), "prev_start": iso(prev_start)},
        "current": cur,
        "previous": prev,
        "trend": trend,
        "incidents": records,
        "changes": [{"number": _d(x, "number"), "short": _d(x, "short_description"), "close_code": _d(x, "close_code"), "closed": _v(x, "closed_at"), "type": _d(x, "type"),
                     "url": f"{c['instance_url']}/change_request.do?sys_id={_v(x, 'sys_id')}"} for x in (changes or [])],
        "outages": [{"service": _d(o, "cmdb_ci"), "type": _d(o, "type"), "begin": _v(o, "begin"), "end": _v(o, "end")} for o in (outages or [])][:300],
        "slas": sla_rows[:300],
        "activity": activity[:300],
        "sources": {
            "incidents": "incident table (live)",
            "acknowledge": "sys_audit: first state change from New or first assignee (calculated)" if audits is not None else None,
            "sla": "task_sla (live)" if slas is not None else None,
            "changes": "change_request close codes (live)" if changes is not None else None,
            "outages": "cmdb_ci_outage outage records (calculated; not live monitoring)" if outages is not None else None,
            "detection": None,
            "aura": "AURA work notes in sys_journal_field (live)" if notes is not None else None,
        },
        "unavailable": {
            "mttd": "No monitoring or event data on this instance (Event Management is not installed and no Dynatrace feed is connected). MTTD needs the time the fault started.",
        },
        "errors": errors,
    }


# ------------------------------------------------------------ AI usage ledger

_LEDGER = Path(__file__).parent.parent / ".p32_ai_usage.json"

# Per-million-token prices used only when backend/.env sets none. These are labelled
# assumptions taken from Cohere's public price list; verify before quoting.
_DEFAULT_PRICES = {
    "command-r7b-12-2024": (0.0375, 0.15),
    "command-r-08-2024": (0.15, 0.60),
    "command-a-03-2025": (2.50, 10.00),
}


def record_usage(entry: dict) -> None:
    """Append one LLM call to the ledger. Token counts come from the provider's response."""
    try:
        data = json.loads(_LEDGER.read_text(encoding="utf-8")) if _LEDGER.exists() else []
    except (OSError, ValueError):
        data = []
    data.append(entry)
    try:
        _LEDGER.write_text(json.dumps(data[-5000:], indent=1), encoding="utf-8")
    except OSError:
        pass


def _price(model: str) -> dict:
    key = re.sub(r"[^A-Z0-9]", "_", model.upper())
    pin, pout = os.getenv(f"P32_PRICE_{key}_IN"), os.getenv(f"P32_PRICE_{key}_OUT")
    if pin and pout:
        try:
            return {"in": float(pin), "out": float(pout), "source": "configured in backend/.env"}
        except ValueError:
            pass
    d = _DEFAULT_PRICES.get(model)
    if d:
        return {"in": d[0], "out": d[1], "source": "assumption: Cohere public list price (override in backend/.env)"}
    return {"in": None, "out": None, "source": "no price configured"}


def ai_usage(role: str | None = None, days: int | None = None) -> dict:
    r = check_role(role)
    try:
        everything = json.loads(_LEDGER.read_text(encoding="utf-8")) if _LEDGER.exists() else []
    except (OSError, ValueError):
        everything = []
    # Same reporting window as the operations metrics, so cost and savings line up.
    cutoff = (datetime.now(UTC) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%SZ") if days else ""
    data = [e for e in everything if (e.get("at") or "") >= cutoff]
    models: dict[str, dict] = {}
    agents: dict[str, dict] = {}
    tot = {"calls": 0, "ok": 0, "failed": 0, "input_tokens": 0, "output_tokens": 0, "cost": 0.0, "priced": True, "duration_ms": 0}
    incidents: set[str] = set()
    # Cost per incident number (aggregate, no prompt or note content), so the dashboard can relate
    # tracked LLM spend to the incidents it was spent on.
    by_incident: dict[str, float] = {}
    for e in data:
        m = e.get("model", "unknown")
        p = _price(m)
        cost = None
        if p["in"] is not None and e.get("input_tokens") is not None:
            cost = (e.get("input_tokens", 0) * p["in"] + e.get("output_tokens", 0) * p["out"]) / 1_000_000
        for bucket, key in ((models, m), (agents, e.get("agent", "unknown"))):
            b = bucket.setdefault(key, {"calls": 0, "ok": 0, "input_tokens": 0, "output_tokens": 0, "cost": 0.0, "duration_ms": 0})
            b["calls"] += 1
            b["ok"] += 1 if e.get("ok") else 0
            b["input_tokens"] += e.get("input_tokens") or 0
            b["output_tokens"] += e.get("output_tokens") or 0
            b["duration_ms"] += e.get("duration_ms") or 0
            b["cost"] += cost or 0
        tot["calls"] += 1
        tot["ok" if e.get("ok") else "failed"] += 1
        tot["input_tokens"] += e.get("input_tokens") or 0
        tot["output_tokens"] += e.get("output_tokens") or 0
        tot["duration_ms"] += e.get("duration_ms") or 0
        if cost is None:
            tot["priced"] = False
        tot["cost"] += cost or 0
        if e.get("incident"):
            incidents.add(e["incident"])
            by_incident[e["incident"]] = by_incident.get(e["incident"], 0.0) + (cost or 0)
    for m in models:
        models[m]["price"] = _price(m)
    return {
        "ok": True,
        "since": everything[0]["at"] if everything else None,
        "days": days,
        "totals": {**tot, "incidents": len(incidents)},
        "by_model": models,
        "by_agent": agents,
        "by_incident": by_incident,
        # Per-call detail is for administrators and engineers; the CIO view gets aggregates.
        "calls": data[-200:][::-1] if r in ("it_admin", "engineer") else None,
        "classification": "live",
        "note": "Token counts are the provider's billed units for each call (Cohere usage.billed_units). Costs = tokens x price per million tokens.",
    }
