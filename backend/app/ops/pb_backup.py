"""Playbook for use case 5: backup failure and disaster-recovery readiness (real Restic)."""

import time
import uuid

from . import backup, config, store
from .pb_base import Playbook, ago, edge, eid, ev, node, q, r, test

T_JOB = "Backup job run history (Restic)"
T_ERR = "Restic error output of the failed run"
T_VOL = "Backup storage volume usage"
T_SNAP = "Snapshots in the repository"
T_RET = "Retention policy of the backup job"
T_CRED = "Job credential check"
T_PERM = "Write test on the repository location"
T_PROM = "Backup metrics in Prometheus"
T_MAP = "Service map for CC-DB-SRV-01"


class BackupPlaybook(Playbook):
    key, title = "backup", "Backup failure and disaster-recovery readiness"
    component, facility = backup.SERVER, "Data center (demo)"
    integrations = {"Restic", "Prometheus", "Grafana"}
    reality = [{"item": "Backups, failures, retention and the restore test are real Restic operations on this machine", "mode": "live"},
               {"item": "CC-DB-SRV-01 is a sample manifests database (5,000 rows) plus a nightly export file in a local folder", "mode": "lab"},
               {"item": "Backup storage CC-BKP-STOR-01 is a real 160 MB virtual disk (W:)", "mode": "lab"},
               {"item": "Older nightly snapshots are created on demand to fill the storage (no retention policy configured)", "mode": "lab"},
               {"item": "Recovery readiness is proven by restoring the latest snapshot and comparing every file's SHA-256", "mode": "live"}]

    def _state(self) -> dict:
        last = backup.last()
        good = backup.last(True)
        vol = backup.volume()
        hours = (time.time() - good["ts"]) / 3600 if good else None
        return {"last_run_ok": last["ok"] if last else None, "last_run_at": last["ts"] if last else None, "last_failure": (last or {}).get("failure"),
                "last_success_at": good["ts"] if good else None, "hours_since_success": r(hours, 2),
                "rpo_hours": config.BACKUP_RPO_HOURS, "volume_used_pct": vol.get("used_pct"), "volume_free_mb": vol.get("free_mb"),
                "on_backup_volume": vol.get("on_backup_volume")}

    staging = False

    def detect(self):
        if self.staging:
            return None
        s = self._state()
        if s["last_run_ok"] is None:
            return None
        failed = s["last_run_ok"] is False
        full = (s["volume_used_pct"] or 0) >= 90 and s["on_backup_volume"]
        rpo_breached = s["hours_since_success"] is None or s["hours_since_success"] > config.BACKUP_RPO_HOURS
        if not (failed or full or (rpo_breached and s["last_success_at"])):
            return None
        title = f"{backup.SERVER} backup failed ({s['last_failure'] or 'error'}): RPO at risk" if failed else \
            f"Backup storage {s['volume_used_pct']}% full: next {backup.SERVER} backup likely to fail"
        eta = int(s["last_success_at"] + config.BACKUP_RPO_HOURS * 3600 - time.time()) if s["last_success_at"] else 0
        return {"key": f"backup:{backup.SERVER}", "title": title, "category": "incident" if failed else "predictive",
                "source": "Restic (backup job)", "component": backup.SERVER, "facility": self.facility,
                "severity": "critical" if rpo_breached else "high" if failed else "warning",
                "risk_score": 90 if rpo_breached else 78 if failed else 62, "metric": "Last backup / storage",
                "current": f"{'failed' if failed else 'ok'} / {s['volume_used_pct']}%", "threshold": f"RPO {config.BACKUP_RPO_HOURS:.0f} h / 90%",
                "eta_s": max(0, eta), "metrics": s}

    def monitor(self, ctx):
        s = self._state()
        runs = [{"at": time.strftime("%H:%M:%S", time.localtime(e["ts"])), "ok": e["data"].get("ok"), "failure": e["data"].get("failure"),
                 "snapshot": e["data"].get("snapshot"), "duration_s": e["data"].get("duration_s"), "trigger": e["data"].get("trigger")}
                for e in store.events("backup", 30) if "trigger" in e["data"]][:10]
        prom = {"last_success_timestamp": q("cc_backup_last_success_timestamp_seconds"), "last_run_ok": q("cc_backup_last_run_success"),
                "volume_used_pct": q("cc_backup_volume_used_percent")}
        return {"analysis": f"Last run {'succeeded' if s['last_run_ok'] else 'FAILED'} {ago(s['last_run_at'])}; last good backup {ago(s['last_success_at'])}; "
                            f"backup storage {s['volume_used_pct']}% used.",
                "findings": [f"Last run: {'ok' if s['last_run_ok'] else 'failed (' + str(s['last_failure']) + ')'}",
                             f"Last successful backup: {ago(s['last_success_at'])}", f"Backup storage: {s['volume_used_pct']}% used"],
                "evidence": [ev("Restic", T_JOB, {"runs": runs, **s}), ev("Prometheus", T_PROM, prom)], "data": s,
                "tools": ["Restic run history", "Prometheus"], "next_step": "Compare with history"}

    def anomaly(self, ctx):
        runs = [e["data"] for e in store.events("backup", 100) if "trigger" in e["data"]]
        ok = sum(1 for d in runs if d.get("ok"))
        return {"analysis": "Compared the latest run with the job's run history.",
                "findings": [f"{ok}/{len(runs)} recent runs succeeded", f"Latest failure type: {ctx['snapshot'].get('last_failure') or 'none'}"],
                "confidence": 0.85, "input_evidence": [eid(ctx, T_JOB)], "next_step": "Evaluate the recovery point objective"}

    def predict(self, ctx):
        s = ctx["snapshot"]
        left = (s["last_success_at"] + config.BACKUP_RPO_HOURS * 3600 - time.time()) if s.get("last_success_at") else None
        nxt = backup.EXPORT_MB
        pred = {"metric": "Hours since last good backup", "current": s.get("hours_since_success"), "threshold": config.BACKUP_RPO_HOURS,
                "eta_s": int(left) if left and left > 0 else 0, "method": "Last successful snapshot time + RPO",
                "next_backup_needs_mb": nxt, "free_mb": s.get("volume_free_mb"),
                "next_backup_will_fail": bool(s.get("on_backup_volume") and (s.get("volume_free_mb") or 0) < nxt * 1.2)}
        txt = (f"RPO of {config.BACKUP_RPO_HOURS:.0f} h is breached in {round(left / 3600, 1)} h if no backup succeeds." if left and left > 0
               else "The RPO is already breached.")
        return {"analysis": txt, "findings": [txt, f"Next backup needs ~{nxt} MB, {s.get('volume_free_mb')} MB free: "
                                              f"{'will fail' if pred['next_backup_will_fail'] else 'fits'}"],
                "prediction": pred, "confidence": 0.85, "input_evidence": [eid(ctx, T_JOB)], "next_step": "Collect logs and configuration"}

    def collect(self, ctx):
        last = backup.last() or {}
        vol = backup.volume()
        snaps = backup.snapshots()
        cred_ok = backup.credential_in_sync()
        perm_ok, perm_err = True, ""
        try:
            p = backup.repo_path() / f".cc-write-test-{uuid.uuid4().hex[:6]}"
            p.write_text("x")
            p.unlink()
        except OSError as exc:
            perm_ok, perm_err = False, str(exc)[:160]
        retention = {"policy": None, "note": "The job has no forget/prune step: every nightly snapshot is kept"}
        return {"analysis": "Read Restic's error output, the backup volume, the repository's snapshots, the job's retention policy and credential, and tested writes.",
                "findings": [f"Error: {(last.get('error') or 'none')[:120]}", f"{len(snaps)} snapshots in the repository, no retention policy",
                             f"Job credential matches the vault: {cred_ok}", f"Repository writable: {perm_ok}"],
                "evidence": [ev("Restic", T_ERR, {"exit_code": last.get("exit_code"), "failure": last.get("failure"), "stderr": last.get("error")}, "log"),
                             ev("Backup volume", T_VOL, vol, "state"), ev("Restic", T_SNAP, {"count": len(snaps), "oldest": snaps[0]["time"] if snaps else None,
                                                                                         "newest": snaps[-1]["time"] if snaps else None}),
                             ev("Backup job config", T_RET, retention, "config", "lab"),
                             ev("Backup job config", T_CRED, {"matches_vault": cred_ok, "note": "compared without revealing either value"}, "config"),
                             ev("Backup volume", T_PERM, {"writable": perm_ok, "error": perm_err}, "state")],
                "data": {"last": last, "vol": vol, "snaps": snaps, "cred_ok": cred_ok, "perm_ok": perm_ok},
                "tools": ["restic snapshots", "File system"], "next_step": "Map dependencies"}

    def dependencies(self, ctx):
        deps = {"protects": "Manifests database (regulated waste manifests, 5,000 rows)", "job": "Nightly backup job",
                "storage": "CC-BKP-STOR-01 (W:)" if backup.on_backup_volume() else "Local folder", "applications": ["Manifest system", "Compliance reporting"],
                "facilities": ["All branches (central database)"]}
        return {"analysis": "The nightly job protects the central manifests database and writes to the backup storage volume.",
                "findings": [f"Protects: {deps['protects']}", f"Writes to: {deps['storage']}"],
                "evidence": [ev("Service map (demo CMDB)", T_MAP, deps, "config", "simulated")], "data": deps, "next_step": "Test candidate causes"}

    def hypotheses(self, ctx):
        e = ctx["evidence"]
        last, vol = e["last"], e["vol"]
        E = lambda t: eid(ctx, t)
        return [
            {"key": "storage_full", "cause": "Backup storage is full because old snapshots are never pruned (no retention policy)", "category": "capacity",
             "tests": [test("Restic reported no space, or the next backup cannot fit",
                            last.get("failure") == "storage_full" or (vol.get("free_mb") or 0) < backup.EXPORT_MB * 1.2,
                            f"{last.get('failure') or 'no failure yet'}; {vol.get('free_mb')} MB free", f"no space / < {backup.EXPORT_MB * 1.2:.0f} MB free", E(T_ERR)),
                       test("Backup volume over 90% used", (vol.get("used_pct") or 0) >= 90, vol.get("used_pct"), ">= 90%", E(T_VOL)),
                       test("Many snapshots and no retention", len(e["snaps"]) > 3, len(e["snaps"]), "> 3, none pruned", E(T_SNAP), required=False)]},
            {"key": "credential", "cause": "The backup job uses an outdated repository credential", "category": "configuration",
             "tests": [test("Restic rejected the password", last.get("failure") == "credential", last.get("failure"), "credential", E(T_ERR)),
                       test("Job credential differs from the vault", not e["cred_ok"], e["cred_ok"], "False", E(T_CRED))]},
            {"key": "unreachable", "cause": "The repository location is unreachable", "category": "connectivity",
             "tests": [test("Restic could not open the repository", last.get("failure") == "repository_unreachable", last.get("failure"), "repository_unreachable", E(T_ERR))]},
            {"key": "permissions", "cause": "The job cannot write to the repository (permissions)", "category": "access",
             "tests": [test("Write test failed", not e["perm_ok"], e["perm_ok"], "False", E(T_PERM))]},
        ]

    def impact(self, ctx):
        s = ctx["snapshot"]
        breached = s.get("hours_since_success") is None or s["hours_since_success"] > config.BACKUP_RPO_HOURS
        sev = "critical" if breached else "high"
        data = {"severity": sev, "risk_score": 90 if breached else 76, "applications": ctx["deps"]["applications"],
                "facilities": ctx["deps"]["facilities"], "users_affected": "Every branch that records manifests",
                "business_impact": f"Until a backup succeeds, a database failure would lose every manifest recorded since the last good backup "
                                   f"({ago(s.get('last_success_at'))}). Waste manifests are regulatory records: losing them is a compliance exposure."}
        return {"analysis": data["business_impact"], "findings": [f"Severity {sev}", f"RPO breached: {breached}"], "confidence": 0.85, "data": data}

    def plan(self, ctx):
        k = (ctx.get("cause") or {}).get("key")
        snaps = ctx["evidence"]["snaps"]
        if k == "storage_full":
            keep = 3
            p = {"action": f"Apply a retention policy (keep the last {keep} snapshots), prune, retry the backup, then run a restore test",
                 "gate": "backup_operation", "mode": "real", "keep_last": keep,
                 "steps": [f"restic forget --keep-last {keep} --prune (removes {max(0, len(snaps) - keep)} older snapshots)", "Run the backup job again",
                           "Restore the new snapshot to a scratch folder and compare SHA-256 of every file"],
                 "expected_outcome": "Backup storage under 50%, a new successful snapshot, restore verified",
                 "risks": [f"{max(0, len(snaps) - keep)} older restore points are removed permanently (oldest: {snaps[0]['time'] if snaps else 'n/a'})",
                           "Restores to dates before the kept snapshots will no longer be possible"], "rollback": "Not reversible for removed snapshots"}
        elif k == "credential":
            p = {"action": "Re-synchronise the job's repository credential from the vault, retry the backup, then run a restore test",
                 "gate": "backup_operation", "mode": "real", "steps": ["Write the vault credential into the job's credential file", "Run the backup job again",
                                                                        "Restore test with SHA-256 comparison"],
                 "expected_outcome": "A new successful snapshot and a verified restore", "risks": ["None to existing backups"],
                 "rollback": "Restore the previous credential file"}
        else:
            return {"analysis": "No safe automated fix for this cause: handing over to the backup team.", "data": None, "findings": ["Hand over"]}
        return {"analysis": p["action"], "findings": p["steps"], "data": p, "next_step": "Request approval"}

    def execute(self, ctx, plan, gate):
        steps = []
        if (ctx.get("cause") or {}).get("key") == "storage_full":
            steps.append({"step": "retention", **backup.apply_retention(plan.get("keep_last", 3))})
        else:
            steps.append({"step": "credential", **backup.resync_credential()})
        b = backup.run_backup("retry after approved fix")
        steps.append({"step": "backup", **{k: v for k, v in b.items() if k != "manifest"}})
        ok = all(s.get("ok") for s in steps)
        return {"analysis": f"Executed after approval by {gate['by']}: " + "; ".join(f"{s['step']} {'ok' if s.get('ok') else 'failed'}" for s in steps),
                "findings": [f"{s['step']}: {'ok' if s.get('ok') else s.get('error', 'failed')[:100]}" for s in steps],
                "evidence": [ev("Restic", "Remediation steps", steps, "action")], "data": {"ok": ok, "steps": steps}, "tools": ["restic forget/prune", "restic backup"]}

    def verify(self, ctx):
        t_fix = ctx["doc"]["actions"][-1]["at"] if ctx["doc"].get("actions") else time.time() - 600
        good = backup.last(True)
        new_ok = bool(good and good["ts"] >= t_fix - 5)
        rt = backup.restore_test() if new_ok else {"ok": False, "error": "no new successful backup"}
        vol = backup.volume()
        passed = new_ok and rt.get("ok")
        data = {"passed": bool(passed), "backup_created": new_ok, "snapshot": (good or {}).get("snapshot"), "recovery_verified": bool(rt.get("ok")),
                "restore_test": rt, "volume_used_pct": vol.get("used_pct"), "source": "Restic (backup run + restore test)"}
        return {"analysis": ("Verified: " if passed else "Not verified: ") + f"backup created {new_ok}, restore test {'passed' if rt.get('ok') else 'failed'} "
                            f"({rt.get('files_checked', 0)} files, {rt.get('db_rows')} DB rows).",
                "findings": [f"Backup created: {new_ok} (snapshot {data['snapshot']})", f"Recovery verified: {bool(rt.get('ok'))}",
                             f"Backup storage now {vol.get('used_pct')}%"],
                "evidence": [ev("Restic", "Restore test result", rt), ev("Backup volume", "Backup storage after the fix", vol, "state")],
                "data": data, "confidence": 0.97 if passed else 0.3, "tools": ["restic restore", "SHA-256"]}

    def breached(self, ctx):
        s = ctx.get("snapshot") or {}
        return s.get("hours_since_success") is None or s["hours_since_success"] > config.BACKUP_RPO_HOURS

    def graph(self, ctx):
        s = ctx.get("snapshot", {})
        cause = (ctx.get("cause") or {}).get("key")
        fixed = ctx.get("verified")
        st = "resolved" if fixed else ("critical" if s.get("last_run_ok") is False else "warning")
        E = lambda t: eid(ctx, t)
        n = [node("db", "CC-DB-SRV-01 manifests DB", "database", "monitoring", "normal", [E(T_MAP)]),
             node("job", "Nightly backup job", "job", "monitoring", st, [E(T_JOB)], f"Last run {'ok' if s.get('last_run_ok') else 'failed'}"),
             node("status", "Status: " + ("Succeeded" if fixed else "Failed" if s.get("last_run_ok") is False else "At risk"), "status", "monitoring", st, [E(T_JOB)]),
             node("stor", f"Backup storage {s.get('volume_used_pct')}%", "storage", "evidence", "resolved" if fixed else ("cause" if cause == "storage_full" else "normal"), [E(T_VOL)]),
             node("ret", "Retention policy: none", "config", "evidence", "resolved" if fixed else ("cause" if cause == "storage_full" else "normal"), [E(T_RET), E(T_SNAP)]),
             node("cred", "Job credential", "config", "evidence", "resolved" if fixed and cause == "credential" else ("cause" if cause == "credential" else "normal"), [E(T_CRED)]),
             node("rpo", f"RPO {config.BACKUP_RPO_HOURS:.0f} h", "risk", "prediction", "resolved" if fixed else "warning", [E(T_JOB)]),
             node("restore", "Restore test", "verification", "verification", "resolved" if fixed else "normal", [])]
        e = [edge("db", "job", "protected by"), edge("job", "stor", "writes to", "evidence"), edge("job", "status", "has status"),
             edge("ret", "stor", "lets snapshots fill", "evidence", "cause" if cause == "storage_full" and not fixed else "normal"),
             edge("cred", "job", "authenticates", "evidence"), edge("status", "rpo", "puts at risk", "prediction"),
             edge("restore", "db", "proves recovery of", "verification")]
        return {"nodes": n, "edges": e}
