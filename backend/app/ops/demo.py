"""Live demonstration mode: stage and reset each scenario on the real integrations.

Staging only creates the conditions (a fault). Detection, investigation, approval, remediation and verification
then happen through the normal pipeline, driven by the data the integrations report.
"""

import threading
import time

from . import routeops as ro
from . import backup, config, engine, identity, network, sso_service, storage, store
from . import escalation

GRAFANA = config.GRAFANA_URL

SCENARIOS = [
    {"key": "sso", "order": 1, "title": "Sign-in service outage", "integration": "Keycloak",
     "summary": "The single sign-on service stops on the identity server, so nobody can sign in. The agents prove it is the service, "
                "not the network or anyone's account, and restart it after approval.",
     "actions": [{"id": "outage", "label": "Stop the sign-in service"}, {"id": "reset", "label": "Reset (sign-in service running)"}],
     "script": ["Sign in as Jordan in the IT window first (you stay signed in during the outage)",
                "Stop the sign-in service", "Employee window: type dana.whitfield and Continue: 'single sign-on isn't responding'",
                "Report it to the IT Help Desk: 'I can't sign in, the sign-in page won't load'",
                "IT desk: root cause 'sign-in service stopped', network and accounts ruled out; Approve the restart",
                "About a minute later Dana signs in"],
     "grafana": f"{GRAFANA}/d/cc-sso"},
    {"key": "storage", "order": 2, "title": "Predictive server storage exhaustion", "integration": "Prometheus + windows_exporter",
     "summary": f"A release leaves DEBUG logging on and logs fill {config.STORAGE_SERVER} ({config.STORAGE_VOLUME}). Prometheus sees real disk "
                "usage climb; the agents predict when it crosses 90%, find the cause and fix it after approval.",
     "actions": [{"id": "stage", "label": "Deploy release 3.2.1 (DEBUG logging)"}, {"id": "reset", "label": "Reset disk to 69%"}],
     "script": ["Reset the disk to 69% (takes a few seconds)", "Deploy release 3.2.1: watch Live Monitoring as usage climbs",
                "The detector raises a predictive alert with a time to 90%", "Walk through the evidence, graph and root cause; approve the fix",
                "Verification reads fresh Prometheus samples: usage drops and growth stops"],
     "grafana": f"{GRAFANA}/d/cc-storage"},
    {"key": "api", "order": 3, "title": "Application / API degradation", "integration": "Prometheus (service metrics)",
     "summary": "The RouteOps export job leaks database connections. Latency and 5xx climb in Prometheus while driver traffic flows; "
                "the agents predict pool exhaustion and restart the service with the job paused after approval.",
     "actions": [{"id": "stage", "label": "Start the export job (leak)"}, {"id": "reset", "label": "Reset service"}],
     "script": ["Start the export job", "Watch the pool, p95 and 5xx rise in Live Monitoring or Grafana",
                "The predictive alert gives the time to pool exhaustion", "Approve the restart; verification uses 30 s Prometheus windows"],
     "grafana": f"{GRAFANA}/d/cc-api"},
    {"key": "network", "order": 4, "title": "Branch network connectivity", "integration": "Blackbox Exporter + Toxiproxy (lab)",
     "summary": "The Chicago North branch link (a Toxiproxy lab link) degrades step by step. Blackbox probes measure it for real; the agents "
                "prove it is the branch link, not the data center, and clear it after approval.",
     "actions": [{"id": "latency", "label": "Add latency"}, {"id": "loss", "label": "Add latency + loss"},
                 {"id": "outage", "label": "Take the link down"}, {"id": "reset", "label": "Restore normal"}],
     "script": ["Add latency: probes show ~850 ms", "Add loss: ~25% of probes fail", "The alert opens; the agents compare the direct probe and Indianapolis",
                "Approve: the impairment is cleared; verification uses fresh 20 s probe windows"],
     "grafana": f"{GRAFANA}/d/cc-network"},
    {"key": "backup", "order": 5, "title": "Backup failure and DR readiness", "integration": "Restic",
     "summary": "Nightly snapshots were never pruned, so the backup volume fills and the real Restic backup fails. The agents find why, "
                "apply a retention policy after approval, re-run the backup and prove recovery with a restore test.",
     "actions": [{"id": "backup_now", "label": "Run backup now"}, {"id": "storage_full", "label": "Fill backup storage + run backup"},
                 {"id": "credential", "label": "Outdated job credential + run backup"}, {"id": "reset", "label": "Reset"}],
     "script": ["Run backup now: a successful snapshot", "Fill backup storage + run backup: Restic fails with 'not enough space'",
                "The alert opens; evidence shows the error, 94% usage and no retention policy",
                "Approve: retention, prune, retry, restore test with SHA-256 comparison"],
     "grafana": f"{GRAFANA}/d/cc-backup"},
    {"key": "mail", "order": 6, "title": "Outlook / Exchange Online disruption (Manager portal)", "integration": "Simulated mail telemetry + ServiceNow",
     "summary": "A predicted email disruption on the Manager portal's Operational Insights. Jordan Patel raises it as an incident: a real "
                "ServiceNow incident opens, the agents find a Microsoft-side Exchange Online outage, and Mark Wood approves notifying Microsoft and the email continuity workaround. "
                "The mail telemetry is simulated (no Microsoft tenant in the lab).",
     "actions": [{"id": "next", "label": "Advance the escalation one stage"}, {"id": "reset", "label": "Restart the escalation (Degrading)"}],
     "script": ["Sign in as Jordan Patel: Operational Insights shows the escalation", "Raise Incident for IT Admin: a ServiceNow incident opens",
                "Sign in as Mark Wood in another window: the incident is in the IT Admin Portal", "Start the investigation, then approve: notify Microsoft and use the email continuity workaround",
                "John's Operational Insights shows the incident resolved"],
     "grafana": None},
]

_busy: dict = {}


def _close_open(usecase: str, why: str) -> None:
    for a in engine.ALERTS.values():
        if a["usecase"] == usecase and a["status"] in ("open", "investigating"):
            a.update(status="cleared", closed=time.time())
    for d in store.list_investigations(50):
        if d["usecase"] == usecase and d["status"] in engine.OPEN:
            try:
                engine.cancel(d["id"], {"name": why, "username": "demo", "roles": []})
            except ValueError:
                pass


def run(key: str, action: str, user: dict) -> dict:
    if _busy.get(key):
        raise ValueError("this scenario is already being set up")
    pb = engine.PLAYBOOKS[key]
    _busy[key] = True
    pb.staging = True
    try:
        store.log_event("demo", "Demo control", f"{key}: {action} by {user['username']}")
        if key == "storage":
            if action == "reset":
                _close_open(key, "Demo reset")
                return {"ok": True, "result": storage.baseline(69)}
            if action == "stage":
                if (storage.usage().get("used_pct") or 100) > 72:
                    storage.baseline(69)
                return {"ok": True, "result": storage.start_growth()}
        if key == "api":
            if action == "reset":
                _close_open(key, "Demo reset")
                ro.reset_clean()
                return {"ok": True, "result": "RouteOps restarted clean (export job enabled, idle)"}
            if action == "stage":
                return {"ok": True, "result": engine.PLAYBOOKS["api"].stage(4.0)}
        if key == "network":
            if action == "reset":
                _close_open(key, "Demo reset")
            return {"ok": True, "result": network.set_fault("normal" if action == "reset" else action)}
        if key == "sso":
            if action == "reset":
                _close_open(key, "Demo reset")
                return {"ok": True, "result": identity.reset_lab()}
            if action == "outage":
                return {"ok": True, "result": sso_service.stop()}
            if action == "disruption":
                return {"ok": True, "result": identity.break_handheld_client()}
        if key == "mail":
            if action == "reset":
                _close_open(key, "Demo reset")
                return {"ok": True, "result": escalation.step("restart")}
            if action == "next":
                return {"ok": True, "result": escalation.step("next")}
        if key == "backup":
            if action == "backup_now":
                return {"ok": True, "result": _strip(backup.run_backup("manual"))}
            if action == "reset":
                _close_open(key, "Demo reset")
                backup.resync_credential()
                if backup.on_backup_volume():
                    backup.apply_retention(2)
                return {"ok": True, "result": _strip(backup.run_backup("manual"))}
            if action == "storage_full":
                backup.resync_credential()
                if not backup.last(True):
                    backup.run_backup("manual")
                fill = backup.fill_history(94)
                res = backup.run_backup("scheduled")
                return {"ok": True, "result": {"fill": fill, "backup": _strip(res)}}
            if action == "credential":
                backup.break_credential()
                return {"ok": True, "result": _strip(backup.run_backup("scheduled"))}
        raise ValueError(f"unknown action {key}/{action}")
    finally:
        if action in ("reset", "backup_now"):
            pb.quiet_until = time.time() + 30  # restarted services need a few scrapes before they read healthy
        pb.staging = False
        _busy[key] = False


def _strip(d: dict) -> dict:
    return {k: v for k, v in d.items() if k != "manifest"}


def run_async(key: str, action: str, user: dict) -> dict:
    """Long actions (filling disks, backups) run in the background; the UI polls the scenario state."""
    out = {"started": time.time(), "key": key, "action": action}
    job = {"status": "running", **out}
    _jobs[key] = job

    def go():
        try:
            job.update(status="done", result=run(key, action, user))
        except Exception as exc:
            job.update(status="failed", error=f"{type(exc).__name__}: {str(exc)[:300]}")
    threading.Thread(target=go, daemon=True).start()
    return job


_jobs: dict = {}


def catalog() -> list[dict]:
    out = []
    for s in SCENARIOS:
        pb = engine.PLAYBOOKS[s["key"]]
        out.append({**s, "reality": pb.reality, "job": _jobs.get(s["key"]), "busy": bool(_busy.get(s["key"]))})
    return out


# ------------------------------------------------------------ reset everything (the ↻ button)

def session_start() -> float:
    """Time of the last full demo reset; the desk and the chat only show what happened after it."""
    ev = store.events("session", 1)
    return ev[0]["ts"] if ev else 0.0


def reset_all(user: dict) -> dict:
    """Put every demo system back to its starting state and begin a clean demo session (history is kept, not shown)."""
    if _jobs.get("_all", {}).get("status") == "running":
        raise ValueError("a reset is already running")
    job = {"status": "running", "started": time.time(), "steps": []}
    _jobs["_all"] = job

    def go():
        plan = [("sso", "reset", "Sign-in service running, all accounts active"), ("network", "reset", "Branch links back to normal"),
                ("api", "reset", "RouteOps restarted clean"), ("backup", "reset", "Backup credential fixed, fresh backup"),
                ("storage", "reset", "Server disk back to 69%"), ("mail", "reset", "Outlook escalation back to Degrading")]
        for key, action, label in plan:
            if key == "storage" and not storage.mounted():
                job["steps"].append({"label": label, "ok": None, "note": "skipped: demo disk V: not mounted"})
                continue
            try:
                run(key, action, user)
                job["steps"].append({"label": label, "ok": True})
            except Exception as exc:
                job["steps"].append({"label": label, "ok": False, "note": f"{type(exc).__name__}: {str(exc)[:160]}"})
        for a in engine.ALERTS.values():
            if a["status"] in ("open", "investigating"):
                a.update(status="cleared", closed=time.time())
        store.log_event("session", "Demo control", f"Demo reset by {user['username']}", {"steps": job["steps"]})
        job.update(status="done", finished=time.time())
    threading.Thread(target=go, daemon=True).start()
    return job


def reset_status() -> dict:
    return _jobs.get("_all") or {"status": "idle"}
