"""HTTP API of the Ops Console (/api/ops/*). Every route except the sign-in helpers needs a verified Keycloak token.

  ops-viewer    read everything
  ops-engineer  run demos, start and cancel investigations
  ops-approver  approve / reject remediation (enforced here, not only in the UI)
  ops-manager   Operational Insights: raise the predicted escalation as an incident (Manager portal)
"""

import threading
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

import secrets

from . import apps, auth, prom, backup, config, demo, desk, engine, escalation, identity, integrations, network, storage, store, ticketing
from . import routeops as ro
from .pb_backup import BackupPlaybook
from .pb_infra import AVG, CPU, ERR, LAT, LOSS, MEM, P95, USED, W, ApiPlaybook, NetworkPlaybook, StoragePlaybook
from .pb_base import r, series, q
from .pb_mail import MailPlaybook
from .pb_sso import SsoPlaybook

router = APIRouter(prefix="/api/ops")
viewer, engineer, approver = auth.user, auth.need("ops-engineer"), auth.need("ops-approver")
manager = auth.need("ops-manager")


def init() -> None:
    for pb in (SsoPlaybook(), StoragePlaybook(), ApiPlaybook(), NetworkPlaybook(), BackupPlaybook(), MailPlaybook()):
        engine.register(pb)
    ro.init()  # start the RouteOps Dispatch demo service and its health monitor
    network.start_branch_host()
    storage.start_sampler()
    threading.Thread(target=network.ensure_links, daemon=True).start()
    identity.init()
    engine.PLAYBOOKS["api"].start_traffic()
    engine.init()


# ------------------------------------------------------------ sign-in helpers (no token yet)

@router.get("/config")
def public_config():
    return {"keycloak_url": config.KEYCLOAK_PUBLIC_URL, "realm": config.KEYCLOAK_REALM, "client_id": config.OIDC_CLIENT_ID,
            "demo_personas": config.DEMO_PERSONAS and [{"username": u, "roles": r, **{k: identity.PERSONAS[u][k] for k in ("name", "title", "facility")}}
                                                       for u, r in auth.DEMO_ROLES.items()],
            "personas": [{"username": u, **{k: p[k] for k in ("label", "name", "title", "facility")}} for u, p in identity.PERSONAS.items()]}


class Attempt(BaseModel):
    username: str


@router.get("/auth/sso-status")
def sso_status():
    """Is single sign-on answering? The portal checks before sending someone to sign in."""
    from . import sso_service
    return {"up": sso_service.responding()}


@router.post("/auth/attempt")
def auth_attempt(req: Attempt):
    try:
        return identity.start_attempt(req.username)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/auth/attempt/{ticket}")
def auth_attempt_status(ticket: str):
    try:
        return identity.attempt_status(ticket)
    except ValueError as exc:
        raise HTTPException(404, str(exc))


# ------------------------------------------------------------ console

@router.get("/me")
def me(u: dict = Depends(viewer)):
    p = identity.PERSONAS.get(u["username"], {})
    return {**u, "persona": p, "can_engineer": "ops-engineer" in u["roles"], "can_approve": "ops-approver" in u["roles"],
            "can_manage": "ops-manager" in u["roles"]}


@router.get("/integrations")
def get_integrations(u: dict = Depends(viewer)):
    return integrations.status()


@router.get("/alerts")
def get_alerts(u: dict = Depends(viewer)):
    return engine.alerts()


@router.get("/investigations")
def list_investigations(u: dict = Depends(viewer)):
    keep = ("id", "created", "updated", "usecase", "usecase_title", "category", "title", "status", "severity", "risk_score",
            "component", "facility", "outcome", "rca", "started_by")
    return [{k: d.get(k) for k in keep} for d in store.list_investigations(200)]


@router.get("/investigations/{inv_id}")
def get_investigation(inv_id: str, u: dict = Depends(viewer)):
    d = store.get_investigation(inv_id)
    if not d:
        raise HTTPException(404, "not found")
    return {**d, "before_after": before_after(d)}


class Start(BaseModel):
    usecase: str


@router.post("/investigations")
def start_investigation(req: Start, u: dict = Depends(engineer)):
    if req.usecase not in engine.PLAYBOOKS:
        raise HTTPException(400, "unknown use case")
    pb = engine.PLAYBOOKS[req.usecase]
    alert = pb.detect()
    if alert and alert["key"] in engine.ALERTS and engine.ALERTS[alert["key"]].get("investigation_id"):
        cur = store.get_investigation(engine.ALERTS[alert["key"]]["investigation_id"])
        if cur and cur["status"] in engine.OPEN:
            return cur
    return engine.start(req.usecase, alert, started_by=f"{u['name']} (manual)")


class Decision(BaseModel):
    decision: str
    comment: str = ""


@router.post("/investigations/{inv_id}/decision")
def decide(inv_id: str, req: Decision, u: dict = Depends(approver)):
    try:
        return engine.decide(inv_id, req.decision, u, req.comment)
    except ValueError as exc:
        raise HTTPException(409, str(exc))


@router.post("/investigations/{inv_id}/begin")
def begin(inv_id: str, u: dict = Depends(engineer)):
    """IT starts the investigation of an incident that is waiting (raised from the Manager portal)."""
    try:
        d = engine.begin(inv_id, u)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    return {"id": d["id"], "status": d["status"]}


@router.post("/investigations/{inv_id}/cancel")
def cancel(inv_id: str, u: dict = Depends(engineer)):
    try:
        return engine.cancel(inv_id, u)
    except ValueError as exc:
        raise HTTPException(409, str(exc))


@router.get("/approvals")
def approvals(u: dict = Depends(viewer)):
    pending, history = [], []
    for d in store.list_investigations(200):
        for g in d.get("approvals", []):
            row = {"investigation": d["id"], "title": d["title"], "usecase": d["usecase"], "severity": d["severity"], **g}
            (pending if d["status"] == "awaiting_approval" and not g.get("decision") else history).append(row)
    return {"pending": pending, "history": sorted(history, key=lambda x: x.get("decided") or 0, reverse=True)}


@router.get("/outcomes")
def outcomes(u: dict = Depends(viewer)):
    docs = store.list_investigations(500)
    buckets = {"mitigated": [], "incident": [], "false_positive": [], "ongoing": [], "other": []}
    for d in docs:
        res = (d.get("outcome") or {}).get("result")
        key = "ongoing" if d["status"] in engine.OPEN else res if res in buckets else "incident" if res == "resolved_incident" else "other"
        buckets[key].append({k: d.get(k) for k in ("id", "title", "usecase", "created", "status", "severity", "outcome", "category")})
    return {"counts": {k: len(v) for k, v in buckets.items()}, "items": buckets, "note": "Counts come from investigations recorded on this machine"}


@router.get("/overview")
def overview(u: dict = Depends(viewer)):
    ints = integrations.status()
    al = engine.alerts()
    docs = store.list_investigations(200)
    open_inv = [d for d in docs if d["status"] in engine.OPEN]
    health = []
    for pb in engine.PLAYBOOKS.values():
        a = next((x for x in al if x["usecase"] == pb.key and x["status"] in ("open", "investigating")), None)
        health.append({"usecase": pb.key, "title": pb.title, "component": pb.component, "state": a["severity"] if a else "healthy",
                       "alert": a and {k: a[k] for k in ("title", "risk_score", "eta_s", "id")}})
    return {"integrations": {"connected": sum(1 for i in ints if i["ok"]), "total": len(ints)},
            "alerts_open": sum(1 for a in al if a["status"] in ("open", "investigating")),
            "critical": sum(1 for a in al if a["status"] in ("open", "investigating") and a["severity"] == "critical"),
            "predicted": sum(1 for a in al if a["status"] in ("open", "investigating") and a.get("eta_s")),
            "investigations_open": len(open_inv), "awaiting_approval": sum(1 for d in open_inv if d["status"] == "awaiting_approval"),
            "facilities_affected": sorted({a.get("facility") for a in al if a["status"] in ("open", "investigating") and a.get("facility")}),
            "health": health, "recent": [{k: d.get(k) for k in ("id", "title", "status", "outcome", "usecase", "created")} for d in docs[:6]],
            "detector": {"last_run": engine._detector["last"], "errors": engine._detector["errors"]}}


@router.get("/monitoring")
def monitoring(u: dict = Depends(viewer)):
    def s(expr, minutes=15, step=10):
        return [[int(t), r(v, 2)] for t, v in series(expr, minutes, step)]
    st = identity.window_stats(15)
    vol = backup.volume()
    last, good, rt = backup.last(), backup.last(True), backup.last_restore_test()
    return {
        "server": {"name": config.STORAGE_SERVER, "volume": config.STORAGE_VOLUME, "mounted": storage.mounted(), "source": "Prometheus / windows_exporter",
                   "disk_pct": r(q(USED)), "cpu_pct": r(q(CPU)), "mem_pct": r(q(MEM)), "disk_series": s(USED), "cpu_series": s(CPU),
                   "mem_series": s(MEM), "growth_active": storage.growing(), "warn": config.STORAGE_WARN_PCT, "crit": config.STORAGE_CRIT_PCT},
        "api": {"source": "Prometheus / RouteOps metrics", "p95_ms": r(q(W(P95, "1m")), 0), "avg_ms": r(q(W(AVG, "1m")), 0),
                "error_pct": r(q(W(ERR, "1m"))), "pool_in_use": q("routeops_db_pool_in_use"), "pool_max": q("routeops_db_pool_max"),
                "p95_series": s(W(P95, "1m")), "error_series": s(W(ERR, "1m")), "pool_series": s("routeops_db_pool_in_use")},
        "network": {"source": "Prometheus / Blackbox Exporter (Toxiproxy lab links)", "fault": network.state(),
                    "facilities": {f: {"loss_pct": r(q(LOSS.format(f=f, w="1m"))), "latency_ms": r(q(LAT.format(f=f, w="1m")), 0),
                                       "loss_series": s(LOSS.format(f=f, w="30s"), 10, 10), "latency_series": s(LAT.format(f=f, w="30s"), 10, 10)}
                                   for f in ("CC-CHICAGO-NORTH", "CC-INDIANAPOLIS")}},
        "backup": {"source": "Restic", "last_run": last and {k: last.get(k) for k in ("ok", "ts", "failure", "snapshot", "duration_s", "trigger", "error")},
                   "last_success": good and {"ts": good["ts"], "snapshot": good["snapshot"]}, "restore_test": rt, "volume": vol,
                   "rpo_hours": config.BACKUP_RPO_HOURS},
        "identity": {"source": "Keycloak event log", "stats": st, "recent": identity.recent(15)[:15], "handheld": identity.app_log(10)},
        "at": time.time()}


@router.get("/identity")
def identity_view(u: dict = Depends(viewer)):
    try:
        client = identity.handheld_client()
    except Exception:
        client = None
    return {"personas": identity.personas(), "client": client, "traffic_on": identity.traffic_on(), "stats": identity.window_stats(15)}


@router.get("/scenarios")
def scenarios(u: dict = Depends(viewer)):
    return demo.catalog()


@router.post("/scenarios/{key}/{action}")
def scenario(key: str, action: str, u: dict = Depends(engineer)):
    if key not in engine.PLAYBOOKS:
        raise HTTPException(404, "unknown scenario")
    try:
        return demo.run_async(key, action, u)
    except ValueError as exc:
        raise HTTPException(409, str(exc))


@router.get("/events")
def events(kind: str | None = None, u: dict = Depends(viewer)):
    return store.events(kind, 150)


# ------------------------------------------------------------ Prometheus scrape target (local only)

def metrics_text() -> str:
    lines = identity.metrics_lines()
    last, good = backup.last(), backup.last(True)
    vol = backup.volume()
    rt = backup.last_restore_test()

    def g(name, help_, value):
        if value is None:
            return
        lines.extend([f"# HELP {name} {help_}", f"# TYPE {name} gauge", f"{name} {float(value)}"])
    g("cc_backup_last_run_success", "1 if the last Restic backup run succeeded.", None if not last else int(bool(last["ok"])))
    g("cc_backup_last_run_timestamp_seconds", "Time of the last backup run.", last and last["ts"])
    g("cc_backup_last_success_timestamp_seconds", "Time of the last successful backup.", good and good["ts"])
    g("cc_backup_volume_used_percent", "Backup storage volume usage.", vol.get("used_pct"))
    g("cc_backup_repo_megabytes", "Restic repository size.", vol.get("repo_mb"))
    g("cc_backup_restore_test_success", "1 if the last restore test verified every file.", None if not rt else int(bool(rt.get("ok"))))
    g("cc_ops_alerts_open", "Open predictive alerts.", sum(1 for a in engine.ALERTS.values() if a["status"] in ("open", "investigating")))
    g("cc_network_lab_fault", "Branch link lab fault (0 normal, 1 latency, 2 loss, 3 outage).",
      {"normal": 0, "latency": 1, "loss": 2, "outage": 3}.get(network.state()["fault"], 0))
    return "\n".join(lines) + "\n"


def metrics_response() -> PlainTextResponse:
    return PlainTextResponse(metrics_text(), media_type="text/plain; version=0.0.4")


# ------------------------------------------------------------ employee help bot

class ChatMsg(BaseModel):
    text: str


def _employee(u: dict) -> dict:
    p = identity.PERSONAS.get(u["username"], {})
    return {"username": u["username"], "name": u["name"] or u["username"], "title": p.get("title", "")}


@router.post("/chat")
def chat(req: ChatMsg, u: dict = Depends(viewer)):
    try:
        return desk.chat(_employee(u), req.text)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/chat")
def chat_history(u: dict = Depends(viewer)):
    return desk.conversation(u["username"])


# Help without signing in (only for sign-in problems). The browser gets a private random token for its conversation.
_help_tokens: dict = {}


class HelpMsg(BaseModel):
    username: str
    text: str
    token: str = ""


@router.post("/help/chat")
def help_chat(req: HelpMsg):
    user = req.username.strip().lower()
    if user not in identity.PERSONAS:
        raise HTTPException(404, "Unknown username. Use your Crystal Clean username, for example dana.whitfield")
    tok = req.token if _help_tokens.get(req.token) == user else secrets.token_urlsafe(16)
    _help_tokens[tok] = user
    p = identity.PERSONAS[user]
    try:
        out = desk.chat({"username": user, "name": p["name"], "title": p["title"]}, req.text, pre_signin=True)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {**out, "token": tok}


@router.get("/help/chat/{token}")
def help_history(token: str):
    user = _help_tokens.get(token)
    if not user:
        raise HTTPException(404, "conversation not found")
    return desk.conversation(user)


# ------------------------------------------------------------ IT desk

it_staff = auth.need("ops-engineer")


@router.get("/tickets")
def tickets(u: dict = Depends(it_staff)):
    out = []
    since = demo.session_start()
    for d in store.list_investigations(100):
        if d["created"] < since:
            continue  # before the last demo reset: kept in the database, not shown
        t = d.get("ticket") or {}
        out.append({"id": d["id"], "created": d["created"], "usecase": d["usecase"], "title": d["title"], "status": d["status"],
                    "severity": d["severity"], "origin": d.get("origin", "monitoring"), "reporter": (d.get("reporter") or {}).get("name"),
                    "via": (d.get("reporter") or {}).get("via"),
                    "ticket": {"number": t.get("number"), "url": t.get("url"), "state": t.get("state")} if t else None,
                    "cause": (d.get("rca") or {}).get("cause"), "outcome": (d.get("outcome") or {}).get("result")})
    return {"tickets": out, "servicenow": ticketing.enabled()}


@router.get("/tickets/{inv_id}/servicenow")
def ticket_servicenow(inv_id: str, u: dict = Depends(it_staff)):
    d = store.get_investigation(inv_id)
    if not d or not (d.get("ticket") or {}).get("sys_id"):
        raise HTTPException(404, "no ServiceNow incident for this investigation")
    try:
        return ticketing.read_back(d["ticket"]["sys_id"])
    except Exception as exc:
        raise HTTPException(502, f"ServiceNow: {type(exc).__name__}: {str(exc)[:200]}")


@router.post("/demo/reset")
def demo_reset(u: dict = Depends(it_staff)):
    try:
        return demo.reset_all(u)
    except ValueError as exc:
        raise HTTPException(409, str(exc))


@router.get("/demo/reset")
def demo_reset_status(u: dict = Depends(it_staff)):
    return demo.reset_status()


# ------------------------------------------------------------ the employee's own apps (live checks)

@router.get("/apps")
def my_apps(u: dict = Depends(viewer)):
    return apps.check_all(u["username"])


@router.get("/help/apps/{token}")
def help_apps(token: str):
    user = _help_tokens.get(token)
    if not user:
        raise HTTPException(404, "conversation not found")
    return apps.check_all(user, ["signin"])


def _ev(d: dict, title_start: str) -> dict:
    e = next((e for e in d.get("evidence", []) if e["title"].startswith(title_start)), None)
    return e["data"] if e and isinstance(e["data"], dict) else {}


def _worst(expr: str, d: dict, agg: str = "max") -> float | None:
    """Worst value Prometheus recorded between the start of the investigation and the fix."""
    end = (d.get("actions") or [{}])[-1].get("at") or time.time()
    start = min(d["created"], end) - 60  # include the minute before detection
    secs = max(30, int(end - start))
    return prom.scalar_at(f"{agg}_over_time(({expr})[{secs}s:5s])", end)


def _fmt(v, unit="", nd=0):
    return "?" if v is None else f"{v:.{nd}f}{unit}"


def before_after(d: dict) -> list[dict]:
    """The worst measurement before the fix (from Prometheus history), and the measurement after the verified fix."""
    v = d.get("verification") or {}
    if not v:
        return []
    uc = d["usecase"]
    if uc == "network":
        f = "CC-CHICAGO-NORTH"
        return [{"label": "Probe loss", "before": _fmt(_worst(LOSS.format(f=f, w="30s"), d), "%", 1), "after": f"{v.get('loss_pct')}%"},
                {"label": "Latency", "before": _fmt(_worst(LAT.format(f=f, w="30s"), d), " ms"), "after": f"{v.get('latency_ms')} ms"}]
    if uc == "api":
        return [{"label": "p95 latency", "before": _fmt(_worst(W(P95, "30s"), d), " ms"), "after": f"{v.get('p95_ms')} ms"},
                {"label": "5xx errors", "before": _fmt(_worst(W(ERR, "30s"), d), "%", 1), "after": f"{v.get('error_pct')}%"},
                {"label": "DB pool in use", "before": _fmt(_worst("routeops_db_pool_in_use", d), " of 50"), "after": f"{int(v.get('pool_in_use') or 0)} of 50"}]
    if uc == "storage":
        return [{"label": "Disk used", "before": _fmt(_worst(USED, d), "%", 1), "after": f"{v.get('used_pct')}%"},
                {"label": "Growth", "before": _fmt(_worst(f"deriv(({USED})[2m:5s]) * 60", d), " %/min", 2), "after": f"{v.get('growth_pct_per_min')} %/min"}]
    if uc == "backup":
        b = _ev(d, "Backup job run history")
        return [{"label": "Last backup", "before": "failed" if b.get("last_run_ok") is False else "ok", "after": "succeeded" if v.get("backup_created") else "failed"},
                {"label": "Recovery proven", "before": "no", "after": f"yes, {(v.get('restore_test') or {}).get('db_rows')} rows restored" if v.get("recovery_verified") else "no"}]
    if uc == "mail":
        b = _ev(d, "Mail service telemetry")
        rows = [("Availability", "availability_pct", "%"), ("Response latency", "latency_ms", " ms"), ("Failed requests", "failed_per_min", " /min"),
                ("Authentication errors", "auth_errors_per_min", " /min"), ("Connection failures", "error_rate_pct", "%")]
        return [{"label": l, "before": f"{b.get(k)}{u}", "after": f"{v.get(k)}{u}"} for l, k, u in rows]
    if uc == "sso":
        if "account_status" in v:
            b = _ev(d, "Keycloak account state")
            return [{"label": "Account", "before": b.get("status", "?"), "after": v.get("account_status")},
                    {"label": "Can sign in", "before": "no, refused by Keycloak", "after": "yes, signed in" if v.get("user_signed_in") else "yes (account active)"}]
        ok = sum(1 for x in v.get("sign_ins", []) if x.get("ok"))
        if "service_responding" in v and (d.get("rca") or {}).get("cause_key") == "sso_down":
            return [{"label": "Sign-in service", "before": "not responding", "after": "responding" if v["service_responding"] else "not responding"},
                    {"label": "Test sign-ins", "before": "impossible", "after": f"{ok}/{len(v.get('sign_ins', []))} succeed"}]
        return [{"label": "Handheld sign-ins", "before": "failing for all users", "after": f"{ok}/{len(v.get('sign_ins', []))} succeed"}]
    return []


# ------------------------------------------------------------ Manager portal: Operational Insights (use case 6)

def _mail_incident() -> dict | None:
    """The investigation raised for the current escalation (the latest mail investigation since the escalation started)."""
    since = escalation.state()["started_at"]
    return next((d for d in store.list_investigations(100) if d["usecase"] == "mail" and d["created"] >= since), None)


def _summary(d: dict) -> dict:
    t = d.get("ticket") or {}
    g = (d.get("approvals") or [{}])[-1]
    return {"id": d["id"], "created": d["created"], "status": d["status"], "title": d["title"], "severity": d["severity"],
            "reporter": d.get("reporter"), "cause": (d.get("rca") or {}).get("cause"), "outcome": d.get("outcome"),
            "ticket": {"number": t.get("number"), "url": t.get("url"), "state": t.get("state")} if t else None,
            "ticket_errors": d.get("ticket_errors") or [], "approval": {k: g.get(k) for k in ("decision", "by", "decided")} if g else None,
            "progress": desk._progress(d), "agents_done": sum(1 for a in d["agents"] if a["status"] in ("done", "skipped"))}


@router.get("/escalation")
def escalation_view(u: dict = Depends(viewer)):
    s = escalation.state()
    inc = _mail_incident()
    return {**s, "stages": escalation.STAGES, "metrics": escalation.metrics(), "baseline": escalation.metrics(0),
            "series": {k: v for k, v in escalation.METRICS.items()}, "targets": escalation.TARGETS,
            "incident": _summary(inc) if inc else None, "servicenow": ticketing.enabled(),
            "mode": "simulated", "note": "Simulated mail telemetry: there is no Microsoft tenant in the lab. The ServiceNow incident is real."}


class RaiseReq(BaseModel):
    note: str = ""


@router.post("/escalation/raise")
def escalation_raise(req: RaiseReq, u: dict = Depends(manager)):
    """The Operations Manager raises the predicted escalation as an incident for IT. The engine opens the ServiceNow incident."""
    pb = engine.PLAYBOOKS["mail"]
    alert = pb.detect()
    if not alert:
        raise HTTPException(409, "There is no active escalation to raise.")
    cur = _mail_incident()
    if cur:
        return {"investigation": cur["id"], "existing": True}
    st = escalation.STAGES[escalation.state()["stage"]]
    p = identity.PERSONAS.get(u["username"], {})
    reporter = {"username": u["username"], "name": u["name"] or u["username"], "title": p.get("title", ""), "via": "Operational Insights",
                "text": (f"Raised from Operational Insights: Microsoft Outlook / Exchange Online disruption. Email access and delivery are "
                         f"experiencing issues. Current state: {st['name']}, about {st['employees']:,} employees affected."
                         + (f" Note: {req.note.strip()[:300]}" if req.note.strip() else ""))}
    if alert["key"] in engine.ALERTS:
        engine.ALERTS[alert["key"]].update(status="investigating")
    else:
        engine.ALERTS[alert["key"]] = {**alert, "id": store.new_id("ALR"), "usecase": "mail", "status": "investigating",
                                       "first_seen": time.time(), "last_seen": time.time(), "investigation_id": None}
    doc = engine.open_incident("mail", alert, started_by=f"{reporter['name']} (Operational Insights)", reporter=reporter)
    engine.ALERTS[alert["key"]]["investigation_id"] = doc["id"]
    store.log_event("escalation", "Operational Insights", f"{doc['id']} raised by {u['username']}", {"stage": st["name"]})
    return {"investigation": doc["id"], "existing": False}


class StepReq(BaseModel):
    action: str


@router.post("/escalation/step")
def escalation_step(req: StepReq, u: dict = Depends(viewer)):
    """Demo control for the simulated escalation (managers and IT engineers)."""
    if not {"ops-manager", "ops-engineer"} & set(u["roles"]):
        raise HTTPException(403, f"{u['username']} cannot run demo controls")
    try:
        return escalation.step(req.action)
    except ValueError as exc:
        raise HTTPException(409, str(exc))


@router.get("/manager/incidents")
def manager_incidents(u: dict = Depends(manager)):
    since = demo.session_start()
    return [_summary(d) for d in store.list_investigations(100) if d["created"] >= since and (d.get("reporter") or {}).get("username") == u["username"]]
