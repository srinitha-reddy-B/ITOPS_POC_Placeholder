"""Predictive Incident Intelligence for the Point32Health workbench (Live Agent Mode side).

Extends the existing workbench (same /api/p32/wb/agent, /api/p32/wb/tool and /api/p32/wb/approval
endpoints, same validation, retry, audit and token ledger) with:

* Five predictive agents: Monitoring, Historical Incident Analysis, Predictive Intelligence,
  Impact Analysis and Notification. The existing RCA workflow stays the only path for an actual
  incident: a prediction hands over to it by creating (or associating) a ServiceNow incident.
* ServiceNow history tools: similar-incident statistics and recurrence clusters for a scenario,
  and incident trends for the overview charts. These read the real POC instance.
* Dynatrace readiness: a metrics tool that queries the Dynatrace Metrics API v2 when DT_ENV_URL and
  DT_API_TOKEN are set. Without them it reports "not configured" and the page uses its simulated
  monitoring feed (always labelled as simulated). No Dynatrace call is ever faked.
* Governed writes: creating or associating a ServiceNow incident from a prediction requires the
  "pi" approval recorded on the server for that run (role engineer/approver).

The risk score itself is calculated by the explainable rule-based engine in the page
(piScore, rules-v2 multi-signal) so the offline demo build works too; agents explain it but never change it.
All scenario metrics and the employee directory mapping are synthetic POC data.
"""

import json
import os
import re
import threading
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import httpx

from . import itops_servicenow as snow
from . import p32_workbench as wb
from . import platform_connect as pc

_DATA = json.loads((Path(__file__).parent / "p32_predictive_data.json").read_text(encoding="utf-8"))
_SCEN = {s["id"]: s for s in _DATA["scenarios"]}
_TAG = "P32-PI:"
_FIELDS = "sys_id,number,short_description,priority,state,opened_at,resolved_at,cmdb_ci,assignment_group,close_notes"

# ------------------------------------------------------------------ agents

_EMPLOYEE_SAFE = "plain language, calm, 1-2 sentences per field; never mention internal agent names, system hostnames, incident numbers, log details, risk-model internals, tokens or the word 'agent'"

wb.AGENTS.update({
    "pi_monitor": {
        "name": "Monitoring Agent",
        "role": "Analyse the operational metrics for one service. The rules have already compared every metric with its baseline and thresholds (metric_checks: status normal, warning or critical). Explain which signals are abnormal, how they developed over the readings, and which matter most. Do not change the rule results; say so if the readings look normal.",
        "contract": {
            "summary": "2-3 sentences: what the metrics show",
            "abnormal_signals": [{"metric": "0-4 items: metric name exactly as given", "observation": "what changed, with values"}],
            "trend": "rising | stable | recovering | recurring",
            "anomaly_detected": True,
        },
        "lists": ["abnormal_signals"],
        "enums": {"trend": ["rising", "stable", "recovering", "recurring"]},
        "required": ["summary", "trend"],
    },
    "pi_history": {
        "name": "Historical Incident Analysis Agent",
        "role": "Compare the current anomaly with the historical incidents returned by the search tool (historical_incidents and statistics). Identify the most similar past incidents (cite their numbers exactly as given), the recurring problem patterns, how they were resolved, and whether similar anomalies previously led to service disruption (priority 1 or 2). Use only the records and statistics given; never invent incident numbers.",
        "contract": {
            "summary": "2-3 sentences",
            "most_similar": [{"number": "2-5 items: incident number exactly as given", "why": "why it is similar"}],
            "patterns": ["1-3 items: recurring problem pattern"],
            "prior_resolutions": ["0-3 items: how similar incidents were resolved, only if the records say so"],
            "disruption_history": "one sentence on how often similar incidents caused disruption",
            "recurrence_assessment": "one sentence: is this a recurring problem",
        },
        "lists": ["most_similar", "patterns", "prior_resolutions"],
        "required": ["summary", "most_similar", "disruption_history"],
    },
    "pi_predict": {
        "name": "Predictive Intelligence Agent",
        "role": "The rule-based risk engine has already calculated the risk score, the classification and the contribution of each factor (risk_engine). Explain the prediction for an IT administrator: what disruption may happen to which service, why (cite the largest contributing factors and their values), what could make the prediction wrong, and the preventive actions to take. Never change the score or classification. Use calibrated language: this is a prediction, so say what may happen and how likely, and never claim a 'complete outage' unless the metrics show a total failure. You are explaining a rule-based model; do not describe it as machine learning.",
        "contract": {
            "prediction": "one sentence: what may happen and to which service",
            "explanation": "2-4 sentences citing the main factors and values",
            "key_drivers": [{"factor": "2-4 items: factor label exactly as given", "detail": "value and why it matters"}],
            "uncertainty": "what could make this prediction wrong",
            "time_horizon": "when the disruption could happen if nothing is done",
            "recommended_actions": ["3-5 items: specific preventive action"],
        },
        "lists": ["key_drivers", "recommended_actions"],
        "required": ["prediction", "explanation", "recommended_actions"],
    },
    "pi_impact": {
        "name": "Impact Analysis Agent",
        "role": "The rules have matched the affected applications to the synthetic employee directory (affected_groups with counts). Explain which employee groups and dependent applications could be affected and why. Use only the groups and counts given; never name individual employees or invent groups or numbers.",
        "contract": {
            "summary": "1-2 sentences",
            "groups": [{"department": "1-9 items: department exactly as given", "reason": "why this group is affected"}],
            "dependent_applications": ["0-5 items: dependent application from the context"],
            "notification_rationale": "one sentence: who should be told and why",
        },
        "lists": ["groups", "dependent_applications"],
        "required": ["summary", "groups"],
    },
    "pi_notify": {
        "name": "Notification Agent",
        "role": f"Write the proactive alerts for a predicted disruption. The employee alert is read by non-technical staff: {_EMPLOYEE_SAFE}. Say what might happen, what they can do now, and that IT has been notified. Don't overstate the risk: this is an early warning, not a confirmed outage (never say 'complete outage'). Describe only the effect that fits this service and its problem (for example slowness, failed requests or delayed updates); never borrow wording about sign-in or any other service. The action must be concrete (what to do now, what to do if it happens). If approved_employee_wording is given, keep its meaning and tone and adapt it to the facts. The IT alert is for the support team: concise and specific, citing the evidence and the investigation steps.",
        "contract": {
            "employee_title": "short alert title for employees",
            "employee_message": "1-2 sentences: what might happen",
            "employee_action": "1-2 sentences: what to do now, and that IT has been notified",
            "employee_status": "short status, e.g. 'Early warning: investigation required'",
            "it_title": "short title for IT",
            "it_summary": "2-3 sentences with the evidence",
            "it_steps": ["2-5 items: investigation step"],
            "it_priority": "1 - Critical | 2 - High | 3 - Moderate | 4 - Low",
        },
        "lists": ["it_steps"],
        "required": ["employee_title", "employee_message", "employee_action", "it_title", "it_summary", "it_steps"],
    },
})

_FORBIDDEN = [
    (re.compile(r"\bagent\b", re.I), "the word 'agent'"),
    (re.compile(r"\bINC\d{5,}\b", re.I), "an incident number"),
    (re.compile(r"\b[a-z]{2,}-[a-z0-9]{2,}-\d{1,3}\b"), "a system hostname"),
    (re.compile(r"\b(token|llm|cohere|risk engine|weight|score)\b", re.I), "model or engine internals"),
]
_base_validate = wb._validate


_TREND_SYNONYMS = {
    "worsening": "rising", "increasing": "rising", "deteriorating": "rising", "escalating": "rising", "growing": "rising", "spiking": "rising",
    "improving": "recovering", "decreasing": "recovering", "declining": "recovering", "normalising": "recovering", "normalizing": "recovering",
    "steady": "stable", "flat": "stable", "unchanged": "stable", "repeating": "recurring", "periodic": "recurring", "cyclical": "recurring",
}


def _validate(agent: str, raw) -> dict:
    if agent == "pi_monitor" and isinstance(raw, dict):
        # Deterministic synonym mapping for a descriptive field; anything else still fails validation.
        t = str(raw.get("trend", "")).strip().lower()
        if t in _TREND_SYNONYMS:
            raw = {**raw, "trend": _TREND_SYNONYMS[t], "trend_as_written": t}
    out = _base_validate(agent, raw)
    if agent == "pi_notify":
        text = " ".join(str(out.get(k, "")) for k in ("employee_title", "employee_message", "employee_action", "employee_status"))
        for rx, what in _FORBIDDEN:
            if rx.search(text):
                raise wb.AgentOutputError(f"the employee alert mentions {what}; employee alerts must not")
    if agent == "pi_monitor":
        out["anomaly_detected"] = out.get("anomaly_detected") is True or str(out.get("anomaly_detected")).lower() == "true"
    return out


wb._validate = _validate

# ------------------------------------------------------------- ServiceNow history

_FAMILIES = ["Identity & SSO", "Payment API", "Employee Center", "Member Portal", "Claims Processing", "Pharmacy Benefits", "Provider Directory", "Data Warehouse"]


def _parse(ts: str):
    try:
        return datetime.strptime(ts[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _split(title: str) -> tuple[str, str, str]:
    """'Identity & SSO: dns resolution failure on sso-lb-04' -> (family, problem, ci)."""
    t = (title or "").strip()
    fam = next((f for f in _FAMILIES if t.startswith(f)), "")
    if not fam and re.search(r"\bVPN\b", t, re.I):
        fam = "VPN"
    if not fam and re.search(r"workday|payroll|\bHR\b", t, re.I):
        fam = "Workday"
    rest = t[len(fam):].lstrip(" :") if fam and t.startswith(fam) else t
    m = re.search(r"\bon ([a-z0-9][a-z0-9-]+-\d{1,3})\s*$", rest)
    ci = m.group(1) if m else ""
    problem = rest[: m.start()].strip() if m else rest
    return fam, problem.lower()[:90], ci


def _rows(query: str, limit: int) -> list[dict]:
    rows = wb._q("incident", query, _FIELDS, limit)
    now = datetime.now(timezone.utc)
    out = []
    for x in rows:
        opened, resolved = _parse(x.get("opened_at", "")), _parse(x.get("resolved_at", ""))
        fam, problem, ci = _split(x.get("short_description", ""))
        out.append({
            "number": x["number"], "title": x.get("short_description", ""), "priority": x.get("priority", ""), "state": x.get("state", ""),
            "opened": x.get("opened_at", ""), "days_ago": round((now - opened).total_seconds() / 86400, 1) if opened else None,
            "ttr_hours": round((resolved - opened).total_seconds() / 3600, 1) if opened and resolved and resolved > opened else None,
            "ci": x.get("cmdb_ci") or ci, "group": x.get("assignment_group", ""), "family": fam, "problem": problem, "ci_from_title": ci,
            "resolution": (x.get("close_notes") or "")[:240], "url": wb._url("incident", x["sys_id"]),
        })
    return out


def _weekly(rows: list[dict], weeks: int = 12) -> list[int]:
    counts = [0] * weeks
    for r in rows:
        if r["days_ago"] is not None and r["days_ago"] < weeks * 7:
            counts[weeks - 1 - int(r["days_ago"] // 7)] += 1
    return counts


def _clusters(rows: list[dict]) -> list[dict]:
    c = Counter((r["family"], r["problem"], r["ci_from_title"]) for r in rows if r["problem"])
    out = []
    for (fam, problem, ci), n in c.most_common():
        if n < 2:
            break
        members = sorted([r for r in rows if (r["family"], r["problem"], r["ci_from_title"]) == (fam, problem, ci)], key=lambda r: r["days_ago"] if r["days_ago"] is not None else 9e9)
        ages = [r["days_ago"] for r in members if r["days_ago"] is not None]
        gaps = [round(b - a, 1) for a, b in zip(ages, ages[1:])]
        out.append({"family": fam, "problem": problem, "ci": ci, "count": n, "last_days_ago": ages[0] if ages else None,
                    "avg_interval_days": round(sum(gaps) / len(gaps), 1) if gaps else None, "numbers": [r["number"] for r in members][:12]})
    return out


def _stats(rows: list[dict], signature: list[str]) -> dict:
    sig = [s.lower() for s in signature]
    similar = [r for r in rows if any(s in r["title"].lower() for s in sig)] or rows
    disruptive = [r for r in similar if str(r["priority"]).startswith(("1", "2"))]
    ttr = [r["ttr_hours"] for r in rows if r["ttr_hours"] is not None]
    clusters = _clusters(rows)
    return {
        "family_total": len(rows),
        "n90": sum(1 for r in rows if r["days_ago"] is not None and r["days_ago"] <= 90),
        "n30": sum(1 for r in rows if r["days_ago"] is not None and r["days_ago"] <= 30),
        "similar": len(similar), "disruptive": len(disruptive),
        "max_cluster": clusters[0]["count"] if clusters else (1 if rows else 0),
        "clusters": clusters[:5],
        "mttr_hours": round(sum(ttr) / len(ttr), 1) if ttr else None, "resolved_count": len(ttr),
        "resolved_with_notes": sum(1 for r in rows if r["resolution"]),
        "weekly": _weekly(rows),
        "records": sorted(similar, key=lambda r: r["days_ago"] if r["days_ago"] is not None else 9e9)[:10],
    }


def _tool_history(r: dict, a: dict) -> dict:
    sid = str(a.get("scenario", ""))
    if sid not in _SCEN:
        raise ValueError("unknown scenario")
    s = _SCEN[sid]
    if sid != "recurring":
        rows = _rows(s["sn_query"] + "^ORDERBYDESCopened_at", 300)
        return {"scenario": sid, "query": s["sn_query"], **_stats(rows, s["signature"])}
    # Recurring: scan the whole history for the strongest repeat pattern (same problem on the same component).
    # Families already watched by use cases 1-4 are left out, so this use case surfaces a different problem.
    watched = {x["family"] for x in _DATA["scenarios"] if x["id"] != "recurring"}
    rows = [x for x in _rows("ORDERBYDESCopened_at", 1000) if x["family"] not in watched]
    clusters = [c for c in _clusters(rows) if c["count"] >= 3]
    if not clusters:
        return {"scenario": sid, "query": "all incidents", "excluded_families": sorted(watched), "pattern": None, "family_total": 0, "n90": 0, "n30": 0, "similar": 0, "disruptive": 0, "max_cluster": 0, "clusters": [], "mttr_hours": None, "resolved_count": 0, "resolved_with_notes": 0, "weekly": [0] * 12, "records": [], "scanned": len(rows)}
    top = sorted(clusters, key=lambda c: (-c["count"], c["last_days_ago"] if c["last_days_ago"] is not None else 9e9))[0]
    members = [x for x in rows if (x["family"], x["problem"], x["ci_from_title"]) == (top["family"], top["problem"], top["ci"])]
    st = _stats(members, [top["problem"]])
    nxt = round(top["avg_interval_days"] - top["last_days_ago"], 1) if top["avg_interval_days"] and top["last_days_ago"] is not None else None
    return {"scenario": sid, "query": "all incidents, clustered by problem and component", "excluded_families": sorted(watched), "scanned": len(rows), "pattern": {**top, "next_expected_in_days": nxt}, **st, "clusters": clusters[:5]}


_trend_cache: dict = {"at": 0.0, "value": None}


def _tool_trends(r: dict, a: dict) -> dict:
    if time.time() - _trend_cache["at"] < 300 and _trend_cache["value"]:
        return _trend_cache["value"]
    rows = _rows("ORDERBYDESCopened_at", 1000)
    fams = Counter(x["family"] for x in rows if x["family"])
    value = {
        "weeks": 12, "scanned": len(rows), "total": _weekly(rows),
        "by_family": {f: _weekly([x for x in rows if x["family"] == f]) for f, _ in fams.most_common(6)},
        "priority": dict(Counter(x["priority"] for x in rows)),
    }
    _trend_cache.update(at=time.time(), value=value)
    return value


# ------------------------------------------------------- live sign-in signal (SSO)
# Real authentication signal from the POC ServiceNow instance:
#   attempts  = interactive sign-in posts in the transaction log (syslog_transaction, URL starts /login.do with sysverb_login;
#               API calls are excluded, including this tool's own queries)
#   successes = 'login' events (sysevent); failures = attempts - successes in the same window
# ServiceNow raises 'login.failed' only for existing accounts, so failures are derived from the two counts.
# Only counts and timings leave the backend: no user names or IP addresses.

_SIGNIN_LOCK = threading.Lock()
_signin_last_drill = {"at": 0.0}


def _q_utc(table: str, query: str, fields: str, limit: int) -> list[dict]:
    c = snow._creds()
    resp = httpx.get(
        f"{c['instance_url']}/api/now/table/{table}",
        params={"sysparm_query": query, "sysparm_fields": fields, "sysparm_limit": limit, "sysparm_display_value": "false", "sysparm_exclude_reference_link": "true"},
        auth=snow._auth(c), headers={"Accept": "application/json"}, timeout=snow._TIMEOUT,
    )
    resp.raise_for_status()
    return pc._safe_json(resp, "servicenow").get("result", [])


def _tool_signin(r: dict, a: dict) -> dict:
    now = datetime.now(timezone.utc)
    tx = _q_utc("syslog_transaction", "urlSTARTSWITH/login.do^urlLIKEsysverb_login^sys_created_on>=javascript:gs.daysAgoStart(7)", "sys_created_on,response_time,remote_ip", 3000)
    ok = _q_utc("sysevent", "name=login^sys_created_on>=javascript:gs.daysAgoStart(7)", "sys_created_on", 3000)
    bad = _q_utc("sysevent", "name=login.failed^sys_created_on>=javascript:gs.daysAgoStart(7)", "sys_created_on", 3000)

    def ts(v):
        p = _parse(v)
        return p if p else None

    att = [(ts(x["sys_created_on"]), float(x.get("response_time") or 0), x.get("remote_ip") or "") for x in tx]
    att = [x for x in att if x[0]]
    succ = [t for t in (ts(x["sys_created_on"]) for x in ok) if t]
    failed_ev = [t for t in (ts(x["sys_created_on"]) for x in bad) if t]

    def window(end, minutes=60):
        start = end.timestamp() - minutes * 60
        a_ = [x for x in att if start < x[0].timestamp() <= end.timestamp()]
        s_ = [t for t in succ if start < t.timestamp() <= end.timestamp()]
        f = max(0, len(a_) - len(s_))
        lat = round(sum(x[1] for x in a_) / len(a_)) if a_ else None
        return {"attempts": len(a_), "successes": len(s_), "failures": f, "rate": round(100.0 * f / len(a_), 1) if a_ else 0.0, "latency": lat, "sources": len({x[2] for x in a_ if x[2]})}

    points = [window(datetime.fromtimestamp(now.timestamp() - (47 - i) * 300, timezone.utc)) for i in range(48)]
    cur = points[-1]
    span_h = 7 * 24 - 1
    old = [x for x in att if x[0].timestamp() <= now.timestamp() - 3600]
    old_s = [t for t in succ if t.timestamp() <= now.timestamp() - 3600]
    base_fail = max(0, len(old) - len(old_s))
    lat_all = [x[1] for x in old if x[1]]
    return {
        "source": "servicenow", "window_minutes": 60, "read_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "metrics": {
            "login_failures": {"current": cur["failures"], "baseline": round(base_fail / span_h, 2), "series": [p["failures"] for p in points]},
            "failure_rate": {"current": cur["rate"], "baseline": round(100.0 * base_fail / len(old), 1) if old else 0.0, "series": [p["rate"] for p in points]},
            "auth_latency": {"current": cur["latency"], "baseline": round(sum(lat_all) / len(lat_all)) if lat_all else None, "series": [p["latency"] or 0 for p in points]},
        },
        "last_hour": {"attempts": cur["attempts"], "successes": cur["successes"], "failures": cur["failures"], "distinct_sources": cur["sources"], "failed_events_existing_accounts": sum(1 for t in failed_ev if t.timestamp() > now.timestamp() - 3600)},
        "seven_days": {"attempts": len(att), "successes": len(succ), "failures": max(0, len(att) - len(succ)), "failed_events_existing_accounts": len(failed_ev)},
    }


_DRILL_USER = "p32.poc.signal.test"  # made-up account: real failed sign-ins, nobody can be locked out


def _tool_signin_drill(r: dict, a: dict) -> dict:
    """Demo control: real failed sign-ins against the POC instance with a made-up user name."""
    n = max(1, min(15, int(a.get("count", 12) or 12)))
    with _SIGNIN_LOCK:
        if time.time() - _signin_last_drill["at"] < 120:
            raise PermissionError("A sign-in drill ran less than 2 minutes ago; wait before sending more.")
        _signin_last_drill["at"] = time.time()
    url = snow._creds()["instance_url"] + "/login.do"
    sent = 0
    with httpx.Client(timeout=20, follow_redirects=False) as cl:
        for i in range(n):
            page = cl.get(url)
            m = re.search(r'name="sysparm_ck"[^>]*value="([^"]*)"|id="sysparm_ck"[^>]*value="([^"]*)"', page.text)
            ck = (m.group(1) or m.group(2)) if m else ""
            cl.post(url, data={"sysparm_ck": ck, "user_name": _DRILL_USER, "user_password": f"wrong-{os.urandom(6).hex()}", "sys_action": "sysverb_login", "sysparm_login_url": "welcome.do"})
            sent += 1
    return {"sent": sent, "user_name": _DRILL_USER, "note": "Real failed sign-in attempts against the POC instance using a made-up account (no real account affected)."}


# ------------------------------------------------------------------ Dynatrace


def dynatrace_status() -> dict:
    url, tok = os.environ.get("DT_ENV_URL", "").strip(), os.environ.get("DT_API_TOKEN", "").strip()
    return {"configured": bool(url and tok), "environment": re.sub(r"^https?://", "", url)[:80] if url else ""}


def _tool_dynatrace(r: dict, a: dict) -> dict:
    """Dynatrace Metrics API v2. Only used when configured; never returns made-up readings."""
    sid = str(a.get("scenario", ""))
    if sid not in _SCEN:
        raise ValueError("unknown scenario")
    url, tok = os.environ.get("DT_ENV_URL", "").rstrip("/"), os.environ.get("DT_API_TOKEN", "")
    if not (url and tok):
        raise snow.NotConfigured("Dynatrace is not configured (set DT_ENV_URL and DT_API_TOKEN in backend/.env); the page uses simulated monitoring.")
    out = {}
    for m in _SCEN[sid]["metrics"]:
        sel = os.environ.get(f"DT_METRIC_{sid.upper()}_{m['key'].upper()}") or m.get("dt")
        if not sel:
            continue
        resp = httpx.get(f"{url}/api/v2/metrics/query", params={"metricSelector": sel, "from": "now-4h", "resolution": "5m"},
                         headers={"Authorization": f"Api-Token {tok}", "Accept": "application/json"}, timeout=20)
        resp.raise_for_status()
        series = ((resp.json().get("result") or [{}])[0].get("data") or [{}])[0]
        vals = [v for v in series.get("values", []) if v is not None]
        out[m["key"]] = {"selector": sel, "values": vals[-48:], "current": vals[-1] if vals else None}
    return {"source": "dynatrace", "metrics": out}


# -------------------------------------------------------- governed writes


def _need_pi_approval(r: dict) -> None:
    if not wb._approved(r, "pi"):
        raise PermissionError("Blocked: an IT administrator must approve starting the investigation (pi gate) before ServiceNow is changed.")


_SIGNAL_NOTE = {
    "servicenow_signin": "Monitoring signal: live sign-in events from this ServiceNow instance (transaction log and login events).",
    "servicenow_pattern": "Monitoring signal: a recurring incident pattern found in this ServiceNow instance.",
    "simulated": "Monitoring metrics in this POC are simulated.",
}


def _tool_create(r: dict, a: dict) -> dict:
    _need_pi_approval(r)
    pid = str(a.get("prediction_id", ""))
    if not re.fullmatch(r"PRD-[A-Z0-9-]{3,40}", pid):
        raise ValueError("invalid prediction id")
    sid = str(a.get("scenario", ""))
    if sid not in _SCEN:
        raise ValueError("unknown scenario")
    existing = wb._q("incident", f"correlation_id={_TAG}{pid}", "sys_id,number,state", 1)
    if existing:
        x = existing[0]
        with wb._lock:
            r["sn"] = {"sys_id": x["sys_id"], "number": x["number"]}
            wb._save_runs()
        return {"number": x["number"], "url": wb._url("incident", x["sys_id"]), "already_existed": True}
    if r.get("sn"):
        raise ValueError("this run already has a ServiceNow record")
    short = str(a.get("short_description", "")).strip()[:160]
    if len(short) < 10:
        raise ValueError("short description too short")
    impact = {"1 - High": "1", "2 - Medium": "2", "3 - Low": "3"}.get(a.get("impact", ""), "2")
    cat = {"network": "network", "access": "software"}.get(str(_SCEN[sid]["rca"].get("category", "")).lower(), "software")
    risk = f"{int(a.get('risk_score', 0))}/100 ({str(a.get('risk_class', ''))[:12]})"
    fields = {
        "short_description": short,
        "description": str(a.get("description", ""))[:3000] + f"\n\n[AURA Predictive Intelligence] Raised proactively from prediction {pid}, risk {risk}, before any employee report. {_SIGNAL_NOTE.get(str(a.get('signal_source', '')), _SIGNAL_NOTE['simulated'])} Incident history is from this ServiceNow instance. POC record.",
        "impact": impact, "urgency": impact, "category": cat,
        "correlation_id": _TAG + pid, "correlation_display": "AURA Predictive Intelligence (POC)",
    }
    rec = snow._record(snow._creds(), "incident", "POST", None, fields)
    with wb._lock:
        r["sn"] = {"sys_id": rec["sys_id"], "number": rec["number"]}
        wb._save_runs()
    return {"number": rec["number"], "url": wb._url("incident", rec["sys_id"]), "already_existed": False}


def _tool_associate(r: dict, a: dict) -> dict:
    _need_pi_approval(r)
    num = str(a.get("number", "")).strip().upper()
    pid = str(a.get("prediction_id", ""))
    if not re.fullmatch(r"INC\d{7}", num) or not re.fullmatch(r"PRD-[A-Z0-9-]{3,40}", pid):
        raise ValueError("invalid incident number or prediction id")
    rows = wb._q("incident", f"number={num}", "sys_id,number,state,short_description", 2)
    if not rows:
        raise ValueError(f"{num} was not found in ServiceNow")
    if len(rows) > 1:
        raise ValueError(f"{num} matches more than one ServiceNow record (duplicate numbering from before the counter fix); choose another incident")
    x = rows[0]
    if r.get("sn") and r["sn"].get("sys_id") != x["sys_id"]:
        raise ValueError("this run is already linked to another ServiceNow record")
    with wb._lock:
        r["sn"] = {"sys_id": x["sys_id"], "number": x["number"]}
        wb._save_runs()
    snow.work_note({"sys_id": x["sys_id"], "text": f"[AURA Predictive Intelligence | status] Associated with prediction {pid} (risk {int(a.get('risk_score', 0))}/100). The RCA workflow will investigate this incident; approved findings will be posted here."})
    return {"number": x["number"], "state": x["state"], "title": x["short_description"], "url": wb._url("incident", x["sys_id"])}


wb.TOOLS.update({
    "pi_history": ("ServiceNow historical incident analysis", _tool_history),
    "pi_trends": ("ServiceNow incident trends", _tool_trends),
    "pi_dynatrace": ("Dynatrace Metrics API v2", _tool_dynatrace),
    "pi_signin": ("ServiceNow sign-in events (transaction log + login events)", _tool_signin),
    "pi_signin_drill": ("ServiceNow sign-in drill (made-up account)", _tool_signin_drill),
    "pi_create": ("ServiceNow incident creation (from prediction)", _tool_create),
    "pi_associate": ("ServiceNow incident association (from prediction)", _tool_associate),
})

# ------------------------------------------------------------------ status

_base_status = wb.status


def _status() -> dict:
    value = dict(_base_status())
    value["dynatrace"] = dynatrace_status()
    value["predictive"] = {"engine": _DATA["config"]["engine_label"], "scenarios": len(_DATA["scenarios"])}
    return value


wb.status = _status
