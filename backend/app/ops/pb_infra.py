"""Playbooks for use cases 1, 3 and 4: storage, application/API and branch network."""

import threading
import time

import httpx

from . import routeops as ro
from . import config, network, storage, store
from .pb_base import Playbook, ago, edge, eid, ev, node, q, r, rows, series, test, wait_until

# =============================================================== 1. storage

VOL = f'volume="{config.STORAGE_VOLUME}"'
USED = f"100 * (1 - windows_logical_disk_free_bytes{{{VOL}}} / windows_logical_disk_size_bytes{{{VOL}}})"
RATE = f"deriv(({USED})[1m:5s]) * 60"  # percentage points per minute (last minute)
# growth that held for the whole last minute: a one-off jump (a reset, a big copy) is not a trend
SUSTAINED = f"min_over_time((deriv(({USED})[1m:5s]) * 60)[1m:10s])"
CPU = '100 * (1 - avg(rate(windows_cpu_time_seconds_total{mode="idle"}[1m])))'
MEM = "100 * (1 - windows_memory_available_bytes / windows_memory_physical_total_bytes)"

T_DISK = "Disk utilisation (Prometheus / windows_exporter)"
T_HOST = "Server CPU and memory (Prometheus / windows_exporter)"
T_FOLDERS = "Folder usage on the volume"
T_FILES = "Largest files on the volume"
T_LOGCFG = "Application log configuration (logging.json)"
T_CHANGES = "Recent change records"
T_LOGRATE = "Log write rate (last 5 min)"
T_MAP = "Service map for CC-APP-SRV-01"


class StoragePlaybook(Playbook):
    key, title = "storage", "Predictive server storage exhaustion"
    component, facility = config.STORAGE_SERVER, "Demo lab (this machine)"
    integrations = {"Prometheus", "windows_exporter", "Grafana"}
    reality = [{"item": f"Disk usage of {config.STORAGE_VOLUME} read by windows_exporter, stored and queried in Prometheus", "mode": "live"},
               {"item": f"{config.STORAGE_VOLUME} is a real 2 GB virtual disk on this machine, named {config.STORAGE_SERVER} for the demo", "mode": "lab"},
               {"item": "Disk growth: real log files written by a controlled DEBUG-logging fault, at an accelerated rate", "mode": "lab"},
               {"item": "Remediation: real file compression, cache clean-up and log-level change on the disk", "mode": "live"},
               {"item": "Service map (which apps and users depend on the server)", "mode": "simulated"}]

    def _now(self) -> dict:
        used, rate, steady = q(USED), q(RATE), q(SUSTAINED)
        eta = None
        if used is not None and rate and rate > 0.01 and used < config.STORAGE_CRIT_PCT:
            eta = int((config.STORAGE_CRIT_PCT - used) / rate * 60)
        return {"used_pct": r(used), "growth_pct_per_min": r(rate, 2), "sustained_growth_pct_per_min": r(steady, 2), "eta_crit_s": eta}

    def detect(self):
        if not storage.mounted():
            return None
        m = self._now()
        used, eta = m["used_pct"], m["eta_crit_s"]
        if used is None:
            return None
        hot = used >= config.STORAGE_WARN_PCT or (eta is not None and eta < 3600 and (m["sustained_growth_pct_per_min"] or 0) > 0.3)
        if not hot:
            return None
        sev = "critical" if used >= config.STORAGE_CRIT_PCT or (eta and eta < 300) else "warning"
        score = max(5, min(98, int(35 + (used - 60) * 1.3 + (25 if eta and eta < 600 else 12 if eta and eta < 1800 else 0))))
        what = f"reach {config.STORAGE_CRIT_PCT:.0f}% in ~{max(1, eta // 60)} min" if eta else f"at {used}%"
        return {"key": f"storage:{config.STORAGE_SERVER}", "title": f"{config.STORAGE_SERVER} storage predicted to {what}",
                "category": "predictive", "source": "Prometheus (windows_exporter)", "component": config.STORAGE_SERVER,
                "facility": self.facility, "severity": sev, "risk_score": score, "metric": "Disk used",
                "current": f"{used}%", "threshold": f"{config.STORAGE_CRIT_PCT:.0f}%", "eta_s": eta, "metrics": m}

    def monitor(self, ctx):
        m = self._now()
        u = storage.usage()
        cpu, mem = q(CPU), q(MEM)
        return {"analysis": f"{config.STORAGE_SERVER} ({config.STORAGE_VOLUME}) is {m['used_pct']}% used and changing by "
                            f"{m['growth_pct_per_min']} percentage points per minute.",
                "findings": [f"Disk used: {m['used_pct']}% of {u.get('total_mb')} MB", f"Growth: {m['growth_pct_per_min']} %/min",
                             f"CPU {r(cpu)}%, memory {r(mem)}% (host context)"],
                "evidence": [ev("Prometheus", T_DISK, {**m, "free_mb": u.get("free_mb"), "size_mb": u.get("total_mb"), "query": USED,
                                                        "series_15m": series(USED, 15, 15)}),
                             ev("Prometheus", T_HOST, {"cpu_pct": r(cpu), "memory_pct": r(mem)})],
                "data": m, "tools": ["Prometheus query API"], "next_step": "Compare with the baseline"}

    def anomaly(self, ctx):
        before = q(f"({USED}) offset 10m")
        now = ctx["snapshot"].get("used_pct")
        rate = ctx["snapshot"].get("growth_pct_per_min") or 0
        base_rate = q(f"deriv(({USED})[5m:15s] offset 10m) * 60")
        return {"analysis": "Compared current usage and growth with the same disk 10 minutes earlier.",
                "findings": [f"Usage {r(before)}% -> {now}% over 10 min" if before is not None else f"Usage now {now}% (no data 10 min ago)",
                             f"Growth {rate} %/min now vs {r(base_rate, 2)} %/min before" if base_rate is not None else f"Growth {rate} %/min",
                             "Abnormal: sustained growth far above baseline" if rate > 0.3 else "Usage above warning threshold"],
                "confidence": 0.9 if rate > 0.3 else 0.7, "input_evidence": [eid(ctx, T_DISK)], "next_step": "Predict time to threshold"}

    def predict(self, ctx):
        s = ctx["snapshot"]
        eta, rate = s.get("eta_crit_s"), s.get("growth_pct_per_min") or 0
        in30 = q(f"predict_linear(({USED})[3m:5s], 1800)")
        pred = {"metric": "Disk used %", "current": s.get("used_pct"), "threshold": config.STORAGE_CRIT_PCT, "eta_s": eta,
                "rate_per_min": rate, "predicted_30min": r(min(100, in30) if in30 else None),
                "method": "Linear trend (Prometheus deriv / predict_linear) over the last 2-3 minutes of samples",
                "note": "Demo time is accelerated: the growth here takes minutes instead of days"}
        return {"analysis": f"At {rate} %/min the volume reaches {config.STORAGE_CRIT_PCT:.0f}% in about {eta // 60 if eta else '?'} min.",
                "findings": [f"Time to {config.STORAGE_CRIT_PCT:.0f}%: {eta // 60 if eta else 'n/a'} min {eta % 60 if eta else ''} s",
                             f"Predicted usage in 30 min: {pred['predicted_30min']}%"],
                "confidence": 0.8 if rate > 0.3 else 0.5, "prediction": pred, "input_evidence": [eid(ctx, T_DISK)],
                "next_step": "Find what is consuming the disk"}

    def collect(self, ctx):
        inv = storage.investigate()
        changes = [{"at": time.strftime("%H:%M:%S", time.localtime(e["ts"])), "summary": e["summary"], **e["data"]}
                   for e in store.events("change", 20, time.time() - 7200) if e["data"].get("server") == config.STORAGE_SERVER]
        return {"analysis": f"Scanned {config.STORAGE_VOLUME}: folder sizes, the largest files, the application's log configuration and change records.",
                "findings": [f"Logs written in the last 5 min: {inv.get('logs_written_last_5min_mb')} MB",
                             f"Log level: {inv.get('log_config', {}).get('level')}", f"{len(changes)} change record(s) in the last 2 h"],
                "evidence": [ev("Disk scan", T_FOLDERS, inv.get("folders_mb"), "state", "lab"),
                             ev("Disk scan", T_FILES, inv.get("largest_files"), "state", "lab"),
                             ev("Server config", T_LOGCFG, inv.get("log_config"), "config", "lab"),
                             ev("Change log", T_CHANGES, changes, "event", "lab"),
                             ev("Disk scan", T_LOGRATE, {"mb_last_5min": inv.get("logs_written_last_5min_mb"), "debug_log_files": inv.get("debug_logs"),
                                                        "growth_last_minute_mb_by_folder": inv.get("growth_1m_mb")}, "state", "lab")],
                "data": inv, "tools": ["File system scan", "Change log"], "next_step": "Map dependencies"}

    def dependencies(self, ctx):
        deps = {"server": config.STORAGE_SERVER, "apps": ["RouteOps Dispatch (application and background jobs)", "Manifest archive (business records)",
                                                          "Report service (report cache)"],
                "users": "Dispatchers and drivers at Indianapolis and Chicago North", "facilities": ["Indianapolis", "Chicago North"]}
        return {"analysis": "Mapped what runs on the server and who depends on it (demo service map).",
                "findings": [f"Hosts: {', '.join(deps['apps'])}", f"Used by: {deps['users']}"],
                "evidence": [ev("Service map (demo CMDB)", T_MAP, deps, "config", "simulated")], "data": deps, "next_step": "Test candidate causes"}

    def hypotheses(self, ctx):
        inv = ctx["evidence"]
        fold = inv.get("folders_mb", {})
        logs_mb = fold.get("apps/routeops/logs", 0)
        rate = inv.get("logs_written_last_5min_mb", 0)
        level = inv.get("log_config", {}).get("level")
        chg = next((e for e in store.events("change", 20, time.time() - 7200) if "logging" in str(e["data"])), None)
        used = (inv.get("usage") or {}).get("used_mb", 1) or 1
        grew = inv.get("growth_1m_mb", {})
        data_grew = grew.get("data", 0)
        logs_grew = grew.get("apps/routeops/logs", 0)
        cache_mb = fold.get("apps/routeops/tmp/report-cache", 0)
        big_other = [f for f in inv.get("largest_files", []) if not f["protected"] and "logs" not in f["path"] and f["mb"] > 150 and f["modified_s_ago"] < 900]
        E = lambda t: eid(ctx, t)
        return [
            {"key": "debug_logging", "cause": "Application DEBUG logging left on after release 3.2.1 is filling the disk", "category": "configuration",
             "tests": [test("Logs grew in the last minute", logs_grew > 10, f"{logs_grew} MB", "> 10 MB", E(T_LOGRATE)),
                       test("Log level is DEBUG", level == "DEBUG", level, "DEBUG", E(T_LOGCFG)),
                       test("Logs are a large consumer", logs_mb > 50, f"{logs_mb} MB", "> 50 MB", E(T_FOLDERS)),
                       test("A recent change switched logging", bool(chg), chg["summary"] if chg else "none", "change record", E(T_CHANGES), required=False)]},
            {"key": "business_data", "cause": "Growth of business data (manifest archive)", "category": "capacity",
             "tests": [test("Business data grew in the last minute", data_grew > 10, f"{data_grew} MB", "> 10 MB", E(T_LOGRATE))]},
            {"key": "cache", "cause": "Report cache accumulation", "category": "housekeeping",
             "tests": [test("Report cache is over 15% of used space", cache_mb > used * 0.15, f"{cache_mb} MB", f"> {round(used * 0.15)} MB", E(T_FOLDERS))]},
            {"key": "unknown_file", "cause": "A large unexpected file was copied to the server", "category": "operational",
             "tests": [test("Recent large file outside logs", bool(big_other), [f["path"] for f in big_other][:2], "> 150 MB, < 15 min old", E(T_FILES))]},
        ]

    def impact(self, ctx):
        s, pred = ctx["snapshot"], ctx.get("prediction") or {}
        eta = pred.get("eta_s")
        sev = "critical" if (s.get("used_pct") or 0) >= config.STORAGE_CRIT_PCT or (eta and eta < 300) else "high" if eta and eta < 1800 else "medium"
        score = {"critical": 92, "high": 78, "medium": 55}[sev]
        data = {"severity": sev, "risk_score": score, "applications": ctx["deps"]["apps"], "facilities": ctx["deps"]["facilities"],
                "users_affected": ctx["deps"]["users"],
                "business_impact": f"If {config.STORAGE_VOLUME} keeps filling, RouteOps Dispatch background jobs start failing at about "
                                   f"{config.STORAGE_CRIT_PCT:.0f}% and the application stops writing manifests when the disk is full, "
                                   "so dispatchers and drivers at Indianapolis and Chicago North cannot sync routes or manifests."}
        return {"analysis": data["business_impact"], "findings": [f"Severity: {sev} (risk score {score})", f"Time to threshold: {eta // 60 if eta else 'n/a'} min"],
                "confidence": 0.8, "data": data, "next_step": "Prepare a safe fix"}

    def plan(self, ctx):
        cause = ctx.get("cause") or {}
        if cause.get("key") != "debug_logging":
            return {"analysis": "No safe automated fix for this cause: handing over.", "data": None, "findings": ["Hand over to the server team"]}
        logs_mb = ctx["evidence"].get("folders_mb", {}).get("apps/routeops/logs", 0)
        p = {"action": "Compress the debug logs, clear expired report cache, set the log level back to INFO", "gate": "infrastructure_change",
             "mode": "real", "steps": ["Set logging.json level=INFO (stops the growth)", "gzip rotated dispatch-debug logs into logs/archive (kept, not deleted)",
                                       "Delete report-cache files older than 1 minute (regenerated on demand)", "Re-read disk usage from Prometheus"],
             "expected_outcome": f"About {round(logs_mb * 0.85)} MB freed, usage back under {config.STORAGE_WARN_PCT:.0f}%, growth stops",
             "risks": ["Debug detail is kept in compressed archives, not deleted", "First reports after the cache clean-up are slower",
                       f"Protected business data under {config.STORAGE_VOLUME}\\data is never touched (enforced in code)"],
             "rollback": "Set the level back to DEBUG in logging.json"}
        return {"analysis": p["action"], "findings": p["steps"], "data": p, "confidence": ctx["doc"]["rca"]["confidence"], "next_step": "Request approval"}

    def execute(self, ctx, plan, gate):
        res = storage.remediate()
        return {"analysis": f"Executed after approval by {gate['by']}: usage {res['before_pct']}% -> {res['after_pct']}%.",
                "findings": [f"{len(res['logs_compressed'])} log file(s) compressed", f"{res['cache_cleared_mb']} MB cache cleared", "Log level INFO"],
                "evidence": [ev("Ops Console", "Remediation result", res, "action", "live")], "data": res, "tools": ["File system", "gzip"]}

    def verify(self, ctx):
        t_fix = time.time()

        def check():
            used, rate = q(USED), q(f"deriv(({USED})[40s:5s]) * 60")
            fresh = q(f'time() - timestamp(windows_logical_disk_free_bytes{{{VOL}}})')
            ok = used is not None and used < config.STORAGE_WARN_PCT and (rate is None or rate <= 0.05) and time.time() - t_fix > 12
            return ok, {"used_pct": r(used), "growth_pct_per_min": r(rate, 2), "sample_age_s": r(fresh, 0)}
        passed, log = wait_until(check, 90, every=5, settle=6)
        last = log[-1] if log else {}
        data = {"passed": passed, "checks": log[-4:], "used_pct": last.get("used_pct"), "growth_pct_per_min": last.get("growth_pct_per_min"),
                "source": "Prometheus (fresh windows_exporter samples after the fix)"}
        return {"analysis": ("Verified: " if passed else "Not verified: ") + f"usage {last.get('used_pct')}%, growth {last.get('growth_pct_per_min')} %/min "
                            "from new Prometheus samples taken after the fix.",
                "findings": [f"Usage below {config.STORAGE_WARN_PCT:.0f}%: {'yes' if passed else 'no'}", "Growth stopped" if passed else "Growth not confirmed stopped"],
                "evidence": [ev("Prometheus", "Disk utilisation after the fix", data)], "data": data, "confidence": 0.95 if passed else 0.3,
                "tools": ["Prometheus query API"]}

    def breached(self, ctx):
        mx = q(f"max_over_time(({USED})[30m:15s])")
        return mx is not None and mx >= config.STORAGE_CRIT_PCT

    def graph(self, ctx):
        s = ctx.get("snapshot", {})
        cause = (ctx.get("cause") or {}).get("key")
        fixed = ctx.get("verified")
        used = s.get("used_pct")
        hot = "resolved" if fixed else ("critical" if (used or 0) >= config.STORAGE_CRIT_PCT else "warning")
        E = lambda t: eid(ctx, t)
        n = [node("srv", config.STORAGE_SERVER, "server", "monitoring", hot, [E(T_DISK), E(T_HOST)], f"Volume {config.STORAGE_VOLUME}"),
             node("disk", f"Disk utilisation {used}%", "metric", "monitoring", hot, [E(T_DISK)], f"{s.get('growth_pct_per_min')} %/min"),
             node("risk", "Disk growth", "risk", "prediction", "resolved" if fixed else "warning", [E(T_DISK)], "Predicted to cross the threshold"),
             node("logs", "Application logs (DEBUG)", "log", "evidence", "resolved" if fixed else ("cause" if cause == "debug_logging" else "warning"),
                  [E(T_LOGRATE), E(T_FOLDERS)]),
             node("cfg", "logging.json level", "config", "evidence", "resolved" if fixed else ("cause" if cause == "debug_logging" else "normal"), [E(T_LOGCFG)]),
             node("chg", "Release 3.2.1 (CHG-DEMO-3021)", "change", "evidence", "normal", [E(T_CHANGES)]),
             node("arch", "Manifest archive (protected)", "data", "dependency", "normal", [E(T_FOLDERS)], "Never touched by remediation"),
             node("app", "RouteOps Dispatch", "application", "dependency", "resolved" if fixed else "warning", [E(T_MAP)]),
             node("users", "Dispatchers and drivers", "users", "dependency", "normal", [E(T_MAP)])]
        e = [edge("srv", "disk", "has metric"), edge("srv", "app", "hosts", "dependency"), edge("srv", "arch", "stores", "dependency"),
             edge("logs", "disk", "consumes", "evidence", "cause" if cause == "debug_logging" and not fixed else "normal"),
             edge("cfg", "logs", "sets DEBUG", "evidence"), edge("chg", "cfg", "changed", "evidence"),
             edge("disk", "risk", "trend", "prediction"), edge("risk", "app", "creates risk for", "prediction"),
             edge("app", "users", "used by", "dependency")]
        return {"nodes": n, "edges": e}


# =============================================================== 3. application / API

ROUTE = 'route="/routes/today"'
RPS = f"sum(rate(routeops_http_requests_total{{{ROUTE}}}[{{w}}]))"
ERR = (f'100 * (sum(rate(routeops_http_requests_total{{{ROUTE},code=~"5..|0"}}[{{w}}])) or vector(0)) / '
       f"sum(rate(routeops_http_requests_total{{{ROUTE}}}[{{w}}]))")
P95 = f"1000 * histogram_quantile(0.95, sum by (le) (rate(routeops_http_request_duration_seconds_bucket{{{ROUTE}}}[{{w}}])))"
AVG = (f"1000 * sum(rate(routeops_http_request_duration_seconds_sum{{{ROUTE}}}[{{w}}])) / "
       f"sum(rate(routeops_http_request_duration_seconds_count{{{ROUTE}}}[{{w}}]))")
POOL = "100 * routeops_db_pool_in_use / routeops_db_pool_max"


def W(template: str, window: str) -> str:
    """Fill the rate window. (str.format would trip over the PromQL label braces.)"""
    return template.replace("{w}", window)

T_API = "API latency, errors and traffic (Prometheus)"
T_POOL = "Database connection pool (Prometheus)"
T_LOG = "RouteOps Dispatch service log"
T_JOB = "Export job state (Prometheus)"
T_DEPLOY = "Recent deployments and restarts"
T_ROUTES = "Errors by endpoint (Prometheus)"
T_HOST2 = "Host CPU (Prometheus / windows_exporter)"
T_MAP2 = "Service map for RouteOps Dispatch"

_traffic = {"on": True, "started": False}


def _driver_traffic() -> None:
    """Generated driver traffic: the handhelds polling for today's route (about 4 requests/second)."""
    with httpx.Client(timeout=6) as c:
        while True:
            if _traffic["on"]:
                try:
                    c.get(f"{ro.BASE}/routes/today")
                except httpx.HTTPError:
                    time.sleep(0.5)
            time.sleep(0.25)


class ApiPlaybook(Playbook):
    key, title = "api", "Business-critical application / API degradation"
    component, facility = "RouteOps Dispatch API", "Data center (demo)"
    integrations = {"Prometheus", "RouteOps Dispatch API", "Grafana"}
    reality = [{"item": "Latency, 5xx rate and DB pool usage measured by the service itself and scraped by Prometheus", "mode": "live"},
               {"item": "RouteOps Dispatch API is a real local service standing in for the dispatch backend", "mode": "lab"},
               {"item": "Driver traffic (about 4 requests/s) is generated by the backend", "mode": "simulated"},
               {"item": "The fault: a real connection leak in the export job, started on demand", "mode": "lab"},
               {"item": "Remediation: a real restart of the service with the faulty job paused", "mode": "live"}]

    def start_traffic(self):
        if not _traffic["started"]:
            _traffic["started"] = True
            for _ in range(2):
                threading.Thread(target=_driver_traffic, daemon=True, name="driver-traffic").start()

    def _now(self, w: str = "1m") -> dict:
        up = q('max_over_time(up{job="routeops"}[15s])')  # down only if it missed every scrape for 15 s (not a restart blip)
        pool = q("routeops_db_pool_in_use")
        slope = q("deriv(routeops_db_pool_in_use[1m])")
        mx = q("routeops_db_pool_max") or 50
        eta = int((mx - pool) / slope) if pool is not None and slope and slope > 0.02 and pool < mx else None
        return {"up": up, "rps": r(q(W(RPS, w)), 2), "error_pct": r(q(W(ERR, w))), "p95_ms": r(q(W(P95, w)), 0),
                "avg_ms": r(q(W(AVG, w)), 0), "pool_in_use": pool, "pool_max": mx, "pool_pct": r(q(POOL)),
                "pool_slope_per_s": r(slope, 3), "eta_exhausted_s": eta}

    def detect(self):
        m = self._now()
        if m["up"] is None:
            return None
        bad = []
        if m["up"] == 0:
            bad.append("service not answering")
        if (m["error_pct"] or 0) > config.API_ERR_WARN_PCT:
            bad.append(f"{m['error_pct']}% 5xx")
        if (m["p95_ms"] or 0) > config.API_P95_WARN_MS:
            bad.append(f"p95 {m['p95_ms']:.0f} ms")
        if (m["pool_pct"] or 0) > config.API_POOL_WARN_PCT:
            bad.append(f"DB pool {m['pool_pct']}%")
        trending = m["eta_exhausted_s"] is not None and (m["pool_in_use"] or 0) >= 20 and (m["pool_slope_per_s"] or 0) > 0.08
        if not bad and not trending:
            return None
        sev = "critical" if m["up"] == 0 or (m["error_pct"] or 0) > 15 else "warning"
        score = max(10, min(98, int(40 + (m["pool_pct"] or 0) * 0.4 + min(30, (m["error_pct"] or 0) * 1.5))))
        title = ("RouteOps Dispatch API degrading: " + ", ".join(bad)) if bad else \
                f"RouteOps Dispatch DB pool predicted to be exhausted in ~{m['eta_exhausted_s']} s"
        return {"key": "api:routeops", "title": title, "category": "predictive" if not bad else "incident" if sev == "critical" else "predictive",
                "source": "Prometheus (service metrics)", "component": self.component, "facility": self.facility, "severity": sev,
                "risk_score": score, "metric": "DB pool / p95 / 5xx", "current": f"{m['pool_pct']}% / {m['p95_ms']} ms / {m['error_pct']}%",
                "threshold": f"{config.API_POOL_WARN_PCT:.0f}% / {config.API_P95_WARN_MS:.0f} ms / {config.API_ERR_WARN_PCT:.0f}%",
                "eta_s": m["eta_exhausted_s"], "metrics": m}

    def monitor(self, ctx):
        m = self._now()
        return {"analysis": f"RouteOps Dispatch: p95 {m['p95_ms']} ms, avg {m['avg_ms']} ms, 5xx {m['error_pct']}%, "
                            f"{m['rps']} req/s, DB pool {m['pool_in_use']}/{m['pool_max']}.",
                "findings": [f"p95 latency {m['p95_ms']} ms", f"5xx rate {m['error_pct']}%", f"DB pool {m['pool_pct']}%", f"Traffic {m['rps']} req/s"],
                "evidence": [ev("Prometheus", T_API, {k: m[k] for k in ("p95_ms", "avg_ms", "error_pct", "rps", "up")} |
                                {"p95_series": series(W(P95, "1m"), 10, 10), "error_series": series(W(ERR, "1m"), 10, 10)}),
                             ev("Prometheus", T_POOL, {k: m[k] for k in ("pool_in_use", "pool_max", "pool_pct", "pool_slope_per_s", "eta_exhausted_s")} |
                                {"series": series("routeops_db_pool_in_use", 10, 10)})],
                "data": m, "tools": ["Prometheus query API"], "next_step": "Compare with the baseline"}

    def anomaly(self, ctx):
        m = ctx["snapshot"]
        base = {"p95_ms": r(q(f"({W(P95, '5m')}) offset 10m"), 0), "error_pct": r(q(f"({W(ERR, '5m')}) offset 10m")),
                "pool_in_use": q("min_over_time(routeops_db_pool_in_use[15m])")}
        return {"analysis": "Compared latency, error rate and pool usage with the previous 10-15 minutes.",
                "findings": [f"p95 {base['p95_ms']} ms -> {m['p95_ms']} ms", f"5xx {base['error_pct']}% -> {m['error_pct']}%",
                             f"DB pool {r(base['pool_in_use'], 0)} -> {m['pool_in_use']} connections ({m['pool_slope_per_s']}/s)"],
                "confidence": 0.85, "input_evidence": [eid(ctx, T_API), eid(ctx, T_POOL)], "baseline": base, "next_step": "Predict"}

    def predict(self, ctx):
        m = ctx["snapshot"]
        eta = m.get("eta_exhausted_s")
        pred = {"metric": "DB connections in use", "current": m.get("pool_in_use"), "threshold": m.get("pool_max"), "eta_s": eta,
                "rate_per_min": r((m.get("pool_slope_per_s") or 0) * 60, 1),
                "method": "Linear trend of the pool (Prometheus deriv over 1 min)",
                "note": "When the pool is exhausted every request fails with HTTP 503"}
        return {"analysis": f"The pool grows by {pred['rate_per_min']} connections/min; exhaustion in about {eta} s." if eta else
                            "No sustained pool growth; the degradation is not predicted to worsen on its own.",
                "findings": [f"Pool exhausted in: {eta} s" if eta else "Pool exhaustion: not predicted"], "prediction": pred,
                "confidence": 0.8 if eta else 0.5, "input_evidence": [eid(ctx, T_POOL)], "next_step": "Collect logs and change history"}

    def collect(self, ctx):
        tail = ro.log_tail(3000)  # driver traffic writes an INFO line per request: look further back, keep warnings/errors
        lines = [l for l in tail if " WARNING " in l or " ERROR " in l or "started" in l.lower()][-20:]
        leaks = sum(1 for l in tail[-1500:] if "not returned to pool" in l)
        job = {"running": q("routeops_export_job_running"), "enabled": q("routeops_export_job_enabled")}
        started = q("routeops_start_time_seconds")
        rps_now, rps_before = q(W(RPS, "1m")), q(f"({W(RPS, '5m')}) offset 10m")
        routes = {x["labels"].get("route"): r(x["value"]) for x in rows(
            '100 * sum by (route) (rate(routeops_http_requests_total{code=~"5..|0"}[1m])) / sum by (route) (rate(routeops_http_requests_total[1m]))')}
        cpu = q(CPU)
        deploys = [{"at": time.strftime("%H:%M:%S", time.localtime(x["ts"])), "summary": x["summary"]} for x in store.events("change", 20, time.time() - 3600)
                   if "RouteOps Dispatch API" in x["summary"] or x["data"].get("app") == "routeops-dispatch"]
        return {"analysis": "Read the service log, the export job state, restarts and deployments, per-endpoint errors and host CPU.",
                "findings": [f"{leaks} connection-leak warnings in the recent service log", f"Export job running: {bool(job['running'])}",
                             f"Traffic {r(rps_now, 2)} req/s now vs {r(rps_before, 2)} req/s 10 min ago"],
                "evidence": [ev("RouteOps Dispatch", T_LOG, lines[-15:], "log", "lab"), ev("Prometheus", T_JOB, job),
                             ev("Prometheus", T_DEPLOY, {"service_started": time.strftime("%H:%M:%S", time.localtime(started)) if started else None,
                                                         "started_ago_s": int(time.time() - started) if started else None, "version": "3.2.1",
                                                         "restarts_by_hub": ro.summary().get("restarts"), "deployment_changes_1h": deploys}),
                             ev("Prometheus", T_ROUTES, routes), ev("Prometheus", T_HOST2, {"cpu_pct": r(cpu)}),
                             ev("Prometheus", "Request rate now vs 10 min ago", {"now": r(rps_now, 2), "before": r(rps_before, 2)})],
                "data": {"leak_lines": leaks, "deploys": deploys, "job": job, "started": started, "rps_now": rps_now, "rps_before": rps_before, "routes": routes, "cpu": cpu},
                "tools": ["Service log", "Prometheus query API"], "next_step": "Map dependencies"}

    def dependencies(self, ctx):
        deps = {"apps": ["RouteOps Mobile (driver handhelds)", "Dispatch console"], "depends_on": ["Dispatch database (connection pool of 50)"],
                "endpoints": list(ctx["evidence"].get("routes", {}).keys()), "facilities": ["Indianapolis", "Chicago North"],
                "users": "Drivers loading today's routes, dispatchers"}
        return {"analysis": "RouteOps Mobile and the dispatch console call this API; it depends on the dispatch database pool.",
                "findings": [f"Affected endpoints: {', '.join(deps['endpoints']) or 'n/a'}", f"Users: {deps['users']}"],
                "evidence": [ev("Service map (demo CMDB)", T_MAP2, deps, "config", "simulated")], "data": deps, "next_step": "Test candidate causes"}

    def hypotheses(self, ctx):
        e, m = ctx["evidence"], ctx["snapshot"]
        rps_ratio = (e["rps_now"] or 0) / e["rps_before"] if e.get("rps_before") else 1.0
        started_ago = time.time() - e["started"] if e.get("started") else 1e9
        E = lambda t: eid(ctx, t)
        return [
            {"key": "connection_leak", "cause": "The nightly manifest-export job leaks database connections until the pool is exhausted",
             "category": "application defect",
             "tests": [test("Pool usage rising", (m.get("pool_slope_per_s") or 0) > 0.05 or (m.get("pool_pct") or 0) >= 90, m.get("pool_slope_per_s"), "> 0.05 conn/s", E(T_POOL)),
                       test("Export job running", bool(e["job"]["running"]), e["job"]["running"], "1", E(T_JOB)),
                       test("Leak warnings in the service log", e["leak_lines"] >= 2, e["leak_lines"], ">= 2", E(T_LOG)),
                       test("Traffic not higher than before", rps_ratio < 1.5, r(rps_ratio, 2), "< 1.5x", E("Request rate now vs 10 min ago"))]},
            {"key": "traffic_surge", "cause": "A surge in traffic is overloading the API", "category": "capacity",
             "tests": [test("Traffic over 2x the earlier rate", rps_ratio > 2, r(rps_ratio, 2), "> 2x", E("Request rate now vs 10 min ago"))]},
            {"key": "bad_deploy", "cause": "A deployment shortly before the degradation", "category": "change",
             "tests": [test("Service (re)started in the last 10 min", started_ago < 600, int(started_ago) if started_ago < 1e8 else None, "< 600 s", E(T_DEPLOY)),
                       test("A deployment change record in the last hour", bool(e.get("deploys")), len(e.get("deploys") or []), ">= 1", E(T_DEPLOY))]},
            {"key": "host_cpu", "cause": "Host CPU saturation", "category": "infrastructure",
             "tests": [test("Host CPU above 90%", (e.get("cpu") or 0) > 90, r(e.get("cpu")), "> 90%", E(T_HOST2))]},
        ]

    def impact(self, ctx):
        m = ctx["snapshot"]
        down = m.get("up") == 0 or (m.get("error_pct") or 0) > 50
        sev = "critical" if down or (m.get("error_pct") or 0) > 15 else "high"
        data = {"severity": sev, "risk_score": 90 if sev == "critical" else 75, "applications": ctx["deps"]["apps"],
                "facilities": ctx["deps"]["facilities"], "users_affected": ctx["deps"]["users"],
                "business_impact": "Drivers cannot load today's routes and dispatchers cannot assign pickups; at full pool exhaustion every "
                                   "route request fails (HTTP 503), stopping used-oil and waste collections until it is fixed."}
        return {"analysis": data["business_impact"], "findings": [f"Severity {sev}", f"Endpoints: {', '.join(ctx['deps']['endpoints'])}"],
                "confidence": 0.8, "data": data, "next_step": "Prepare a fix"}

    def plan(self, ctx):
        if (ctx.get("cause") or {}).get("key") != "connection_leak":
            return {"analysis": "No safe automated fix for this cause: handing over.", "data": None, "findings": ["Hand over to application support"]}
        p = {"action": "Restart RouteOps Dispatch with the nightly export job paused", "gate": "infrastructure_change", "mode": "real",
             "steps": ["Stop the service (in-flight requests fail for ~3 s)", "Start it with --export-job off", "Watch latency, 5xx and pool in Prometheus",
                       "Raise a problem record to patch the export job"],
             "expected_outcome": "Pool back to ~12 connections, p95 under 250 ms, 5xx under 1%",
             "risks": [f"About {ctx['snapshot'].get('rps')} req/s fail during the ~3 s restart (drivers retry automatically)",
                       "The nightly manifest export does not run until the job is patched"], "rollback": "Restart with the export job on"}
        return {"analysis": p["action"], "findings": p["steps"], "data": p, "next_step": "Request approval"}

    def execute(self, ctx, plan, gate):
        s = ro.restart("off")
        return {"analysis": f"Restarted after approval by {gate['by']}; first health check: HTTP {s['code']} in {s['ms']} ms.",
                "findings": ["Service restarted", "Export job paused"], "evidence": [ev("RouteOps Dispatch", "Restart result", s, "action", "live")],
                "data": s, "tools": ["Service control"]}

    def verify(self, ctx):
        def check():
            m = self._now("30s")
            ok = m["up"] == 1 and (m["pool_in_use"] or 99) <= 20 and (m["error_pct"] or 0) < 1 and (m["p95_ms"] or 9e9) < 400
            return ok, {k: m[k] for k in ("pool_in_use", "error_pct", "p95_ms", "rps")}
        passed, log = wait_until(check, 90, every=5, settle=25)
        last = log[-1] if log else {}
        data = {"passed": passed, "checks": log[-4:], **last, "source": "Prometheus (30 s windows after the restart)"}
        return {"analysis": ("Verified: " if passed else "Not verified: ") + f"p95 {last.get('p95_ms')} ms, 5xx {last.get('error_pct')}%, pool {last.get('pool_in_use')}.",
                "findings": [f"p95 {last.get('p95_ms')} ms", f"5xx {last.get('error_pct')}%", f"Pool {last.get('pool_in_use')}"],
                "evidence": [ev("Prometheus", "API metrics after the fix", data)], "data": data, "confidence": 0.95 if passed else 0.3}

    def breached(self, ctx):
        mx = q("max_over_time(routeops_db_pool_in_use[20m])")
        return mx is not None and mx >= 50

    def graph(self, ctx):
        m = ctx.get("snapshot", {})
        cause = (ctx.get("cause") or {}).get("key")
        fixed = ctx.get("verified")
        st = "resolved" if fixed else ("critical" if (m.get("error_pct") or 0) > 15 or m.get("up") == 0 else "warning")
        E = lambda t: eid(ctx, t)
        n = [node("api", "RouteOps Dispatch API", "application", "monitoring", st, [E(T_API)]),
             node("lat", f"Latency p95 {m.get('p95_ms')} ms", "metric", "monitoring", st, [E(T_API)]),
             node("err", f"5xx {m.get('error_pct')}%", "metric", "monitoring", st, [E(T_API)]),
             node("db", "Dispatch database", "database", "dependency", st, [E(T_POOL)]),
             node("pool", f"DB pool {m.get('pool_pct')}%", "metric", "monitoring", st, [E(T_POOL)]),
             node("job", "Nightly manifest-export job", "job", "evidence", "resolved" if fixed else ("cause" if cause == "connection_leak" else "normal"), [E(T_JOB), E(T_LOG)]),
             node("ep", "/routes/today", "endpoint", "dependency", st, [E(T_ROUTES)]),
             node("mobile", "RouteOps Mobile", "application", "dependency", "normal", [E(T_MAP2)]),
             node("drivers", "Drivers and dispatchers", "users", "dependency", "normal", [E(T_MAP2)])]
        e = [edge("api", "lat", "shows"), edge("api", "err", "shows"), edge("api", "db", "depends on", "dependency"),
             edge("db", "pool", "shows", "monitoring"), edge("job", "pool", "leaks connections", "evidence", "cause" if cause and not fixed else "normal"),
             edge("api", "ep", "serves", "dependency"), edge("mobile", "ep", "calls", "dependency"), edge("drivers", "mobile", "use", "dependency")]
        return {"nodes": n, "edges": e}

    def stage(self, every: float = 4.0) -> str:
        try:
            r_ = httpx.post(f"{ro.BASE}/admin/fault?every={every}", timeout=4)
            if r_.status_code == 409:
                ro.restart("on")
                httpx.post(f"{ro.BASE}/admin/fault?every={every}", timeout=4)
        except httpx.HTTPError:
            ro.start("on")
            httpx.post(f"{ro.BASE}/admin/fault?every={every}", timeout=4)
        store.log_event("demo", "Demo control", "RouteOps export job started with a connection leak (lab fault)")
        return "Export job started: it leaks one DB connection every few seconds"


# =============================================================== 4. branch network

FAC = "CC-CHICAGO-NORTH"
LOSS = '100 * (1 - avg by (facility) (avg_over_time(probe_success{{link="vpn-wan",facility="{f}"}}[{w}])))'
LAT = '1000 * avg by (facility) (avg_over_time((probe_duration_seconds{{link="vpn-wan",facility="{f}"}} and probe_success == 1)[{w}:5s]))'
T_NET = "Branch link probes (Prometheus / Blackbox)"
T_DIRECT = "Direct probe of the data-center host (bypasses the branch link)"
T_OTHER = "Other facility link (Indianapolis)"
T_KC = "Keycloak availability probe"
T_GW = "Gateway CHI-NORTH-GW01 link configuration (Toxiproxy lab)"
T_DNS = "DNS lookup time (Blackbox)"
T_MAP3 = "Service map for CC-CHICAGO-NORTH"


class NetworkPlaybook(Playbook):
    key, title = "network", "Predictive branch network connectivity disruption"
    component, facility = "CHI-NORTH-GW01", FAC
    integrations = {"Prometheus", "Blackbox Exporter", "Toxiproxy", "Grafana"}
    reality = [{"item": "Latency and probe success measured by Blackbox Exporter every 5 s and stored in Prometheus", "mode": "live"},
               {"item": "The branch WAN links are Toxiproxy proxies on this machine (a lab), not Crystal Clean's network", "mode": "lab"},
               {"item": "Faults are real impairments added to those proxies: latency, stalled connections (loss), link down", "mode": "lab"},
               {"item": "'Packet loss' is the share of failed probes, not ICMP packet loss", "mode": "lab"},
               {"item": "Remediation clears the impairment on the lab link (production: fail over to the backup circuit)", "mode": "lab"}]

    def _now(self, w: str = "1m", f: str = FAC) -> dict:
        loss, lat = q(LOSS.format(f=f, w=w)), q(LAT.format(f=f, w=w))
        down = q(f'max(max_over_time(probe_success{{link="vpn-wan",facility="{f}"}}[30s]))')
        return {"loss_pct": r(loss), "latency_ms": r(lat, 0), "link_down": down == 0 if down is not None else None}

    def detect(self):
        m = self._now()
        if m["loss_pct"] is None:
            return None
        bad = []
        if m["link_down"]:
            bad.append("link down")
        if m["loss_pct"] > config.NET_LOSS_WARN_PCT and not m["link_down"]:
            bad.append(f"{m['loss_pct']}% probe loss")
        if (m["latency_ms"] or 0) > config.NET_LATENCY_WARN_MS:
            bad.append(f"latency {m['latency_ms']:.0f} ms")
        if not bad:
            return None
        sev = "critical" if m["link_down"] or m["loss_pct"] > 15 else "warning"
        return {"key": f"network:{FAC}", "title": f"{FAC} connectivity degrading: " + ", ".join(bad), "category": "incident" if m["link_down"] else "predictive",
                "source": "Prometheus (Blackbox Exporter)", "component": "CHI-NORTH-GW01", "facility": FAC, "severity": sev,
                "risk_score": 92 if m["link_down"] else max(30, min(90, int(30 + m["loss_pct"] * 1.5 + (m["latency_ms"] or 0) / 30))),
                "metric": "Probe loss / latency", "current": f"{m['loss_pct']}% / {m['latency_ms']} ms",
                "threshold": f"{config.NET_LOSS_WARN_PCT:.0f}% / {config.NET_LATENCY_WARN_MS:.0f} ms", "eta_s": None, "metrics": m}

    def monitor(self, ctx):
        m = self._now()
        per = [{"service": x["labels"].get("service"), "facility": x["labels"].get("facility"), "link": x["labels"].get("link"),
                "success_1m_pct": r(x["value"] * 100)} for x in rows("avg_over_time(probe_success[1m])")]
        return {"analysis": f"{FAC}: {m['loss_pct']}% of probes failing, average round trip {m['latency_ms']} ms over the last minute.",
                "findings": [f"Probe loss {m['loss_pct']}%", f"Latency {m['latency_ms']} ms", f"Link down: {bool(m['link_down'])}"],
                "evidence": [ev("Prometheus", T_NET, {**m, "targets": per, "loss_series": series(LOSS.format(f=FAC, w="30s"), 10, 10),
                                                       "latency_series": series(LAT.format(f=FAC, w="30s"), 10, 10)})],
                "data": m, "tools": ["Prometheus query API"], "next_step": "Compare with normal"}

    def anomaly(self, ctx):
        m = ctx["snapshot"]
        base_loss = q(f"({LOSS.format(f=FAC, w='5m')}) offset 10m")
        base_lat = q(f"({LAT.format(f=FAC, w='5m')}) offset 10m")
        return {"analysis": "Compared with the same link 10 minutes earlier.",
                "findings": [f"Loss {r(base_loss)}% -> {m['loss_pct']}%", f"Latency {r(base_lat, 0)} ms -> {m['latency_ms']} ms"],
                "confidence": 0.85, "input_evidence": [eid(ctx, T_NET)], "next_step": "Assess the trend"}

    def predict(self, ctx):
        m = ctx["snapshot"]
        slope = q(f"deriv(({LOSS.format(f=FAC, w='30s')})[2m:5s]) * 60")
        if m.get("link_down"):
            pred = {"metric": "Probe loss %", "current": 100, "threshold": 100, "eta_s": 0, "method": "Link already down", "meaningful": True}
            text = "The link is already down: this is now an outage."
        elif slope and slope > 2:
            eta = int((100 - (m["loss_pct"] or 0)) / slope * 60)
            pred = {"metric": "Probe loss %", "current": m["loss_pct"], "threshold": 100, "eta_s": eta, "rate_per_min": r(slope),
                    "method": "Linear trend of loss over 2 min", "meaningful": True}
            text = f"Loss is rising {r(slope)} points/min: complete loss of connectivity in about {eta // 60} min if the trend continues."
        else:
            pred = {"metric": "Probe loss %", "current": m.get("loss_pct"), "threshold": 100, "eta_s": None, "rate_per_min": r(slope),
                    "method": "Linear trend of loss over 2 min", "meaningful": False}
            text = "The degradation is stable: a time to failure would not be meaningful. Risk: intermittent VPN drops."
        return {"analysis": text, "findings": [text], "prediction": pred, "confidence": 0.6, "input_evidence": [eid(ctx, T_NET)], "next_step": "Collect evidence"}

    def collect(self, ctx):
        direct = q('avg_over_time(probe_success{link="direct",service="Branch services host"}[30s])')
        indy = self._now(f="CC-INDIANAPOLIS")
        kc = q('avg_over_time(probe_success{service="Keycloak SSO"}[1m])')
        dns = q("max(max_over_time(probe_dns_lookup_time_seconds[1m]))")
        try:
            gw = [l for l in network.links() if l["facility"] == FAC]
        except httpx.HTTPError:
            gw = []
        return {"analysis": "Probed the data-center host directly, compared another facility, checked Keycloak and DNS, and read the gateway's live link configuration.",
                "findings": [f"Direct host probe success: {r((direct or 0) * 100)}%", f"Indianapolis link loss {indy['loss_pct']}%, latency {indy['latency_ms']} ms",
                             f"Gateway impairments: {sum(len(l['toxics']) for l in gw)} active, links disabled: {sum(1 for l in gw if not l['enabled'])}"],
                "evidence": [ev("Prometheus", T_DIRECT, {"success_pct": r((direct or 0) * 100)}), ev("Prometheus", T_OTHER, indy),
                             ev("Prometheus", T_KC, {"success_pct": r((kc or 0) * 100)}), ev("Prometheus", T_DNS, {"max_lookup_s": r(dns, 3)}),
                             ev("Toxiproxy", T_GW, gw, "config", "lab")],
                "data": {"direct": direct, "indy": indy, "kc": kc, "dns": dns, "gw": gw}, "tools": ["Prometheus", "Toxiproxy API"], "next_step": "Map dependencies"}

    def dependencies(self, ctx):
        deps = {"facility": FAC, "gateway": "CHI-NORTH-GW01", "services": [l["service"] for l in network.LINKS.values() if l["facility"] == FAC],
                "users": "Chicago North branch staff and drivers dispatching from the branch", "applications": ["ERP (manifests, billing)", "Branch file share"]}
        return {"analysis": "Chicago North reaches data-center services through gateway CHI-NORTH-GW01 over the VPN.",
                "findings": [f"Affected services: {', '.join(deps['services'])}", f"Users: {deps['users']}"],
                "evidence": [ev("Service map (demo CMDB)", T_MAP3, deps, "config", "simulated")], "data": deps, "next_step": "Test candidate causes"}

    def hypotheses(self, ctx):
        e, m = ctx["evidence"], ctx["snapshot"]
        chi_bad = (m.get("loss_pct") or 0) > config.NET_LOSS_WARN_PCT or (m.get("latency_ms") or 0) > config.NET_LATENCY_WARN_MS or bool(m.get("link_down"))
        indy_ok = (e["indy"]["loss_pct"] or 0) <= config.NET_LOSS_WARN_PCT and (e["indy"]["latency_ms"] or 0) <= config.NET_LATENCY_WARN_MS
        direct_ok = (e["direct"] or 0) >= 0.8      # one stray failed probe must not decide the cause
        direct_down = (e["direct"] or 0) < 0.5    # a host that is really down fails most probes
        impaired = [l for l in e["gw"] if l["toxics"] or not l["enabled"]]
        E = lambda t: eid(ctx, t)
        return [
            {"key": "wan_link", "cause": "Degradation of the Chicago North WAN/VPN link at gateway CHI-NORTH-GW01", "category": "network",
             "tests": [test("Chicago North links degraded", chi_bad, f"{m.get('loss_pct')}% / {m.get('latency_ms')} ms", "loss or latency over threshold", E(T_NET)),
                       test("Data-center host healthy when probed directly", direct_ok, r((e['direct'] or 0) * 100), ">= 80%", E(T_DIRECT)),
                       test("Other facility unaffected", indy_ok, f"{e['indy']['loss_pct']}% / {e['indy']['latency_ms']} ms", "normal", E(T_OTHER)),
                       test("Gateway link shows impairment", bool(impaired), [t["type"] for l in impaired for t in l["toxics"]] or
                            ["link disabled"] if impaired else "none", "impairment present", E(T_GW), required=False)]},
            {"key": "host_down", "cause": "The data-center services host is failing", "category": "server",
             "tests": [test("Direct probe of the host failing", direct_down, r((e['direct'] or 0) * 100), "< 50%", E(T_DIRECT))]},
            {"key": "dns", "cause": "DNS resolution problems", "category": "network service",
             "tests": [test("DNS lookups slow or failing", (e["dns"] or 0) > 0.5, r(e["dns"], 3), "> 0.5 s", E(T_DNS))]},
            {"key": "core", "cause": "Wider data-center or core network outage", "category": "network",
             "tests": [test("More than one facility degraded", not indy_ok, f"Indianapolis {e['indy']['loss_pct']}%", "degraded", E(T_OTHER)),
                       test("Keycloak unreachable as well", (e["kc"] or 0) < 0.9, r((e['kc'] or 0) * 100), "< 90%", E(T_KC))]},
        ]

    def impact(self, ctx):
        m = ctx["snapshot"]
        sev = "critical" if m.get("link_down") else "high" if (m.get("loss_pct") or 0) > 15 else "medium"
        data = {"severity": sev, "risk_score": {"critical": 92, "high": 80, "medium": 60}[sev], "facilities": [FAC],
                "applications": ctx["deps"]["applications"], "users_affected": ctx["deps"]["users"],
                "business_impact": "Chicago North staff lose or get unreliable access to the ERP and the file share: manifests and pickups "
                                   "cannot be recorded centrally and branch communication degrades. Other facilities are not affected."}
        return {"analysis": data["business_impact"], "findings": [f"Severity {sev}", "Single facility affected"], "confidence": 0.8, "data": data}

    def plan(self, ctx):
        if (ctx.get("cause") or {}).get("key") != "wan_link":
            return {"analysis": "No safe automated fix for this cause: handing over to the network team.", "data": None, "findings": ["Hand over"]}
        p = {"action": "Fail Chicago North over to the backup path (lab: clear the impairment on the CHI-NORTH-GW01 links)",
             "gate": "infrastructure_change", "mode": "lab",
             "steps": ["Remove the latency/loss impairment and re-enable the links on CHI-NORTH-GW01 (Toxiproxy)", "Re-probe the links from Blackbox",
                       "Open a carrier ticket for the primary circuit (production step)"],
             "expected_outcome": f"Probe loss under 1% and latency under {config.NET_LATENCY_WARN_MS:.0f} ms within a minute",
             "risks": ["Active sessions through the gateway reconnect once", "In production the backup path may have less bandwidth"],
             "rollback": "Re-apply the previous link configuration"}
        return {"analysis": p["action"], "findings": p["steps"], "data": p, "next_step": "Request approval"}

    def execute(self, ctx, plan, gate):
        res = network.set_fault("normal", FAC)
        after = [l for l in network.links() if l["facility"] == FAC]
        return {"analysis": f"Link impairment cleared after approval by {gate['by']}.", "findings": ["Links enabled", "No impairments left"],
                "evidence": [ev("Toxiproxy", "Gateway configuration after the fix", after, "config", "lab")], "data": res, "tools": ["Toxiproxy API"]}

    def verify(self, ctx):
        def check():
            m = self._now("20s")
            ok = m["loss_pct"] is not None and m["loss_pct"] < 1 and (m["latency_ms"] or 9e9) < config.NET_LATENCY_WARN_MS
            return ok, m
        passed, log = wait_until(check, 90, every=5, settle=20)
        last = log[-1] if log else {}
        data = {"passed": passed, "checks": log[-4:], **last, "source": "Blackbox probes in Prometheus (20 s windows after the fix)"}
        return {"analysis": ("Verified: " if passed else "Not verified: ") + f"loss {last.get('loss_pct')}%, latency {last.get('latency_ms')} ms.",
                "findings": [f"Loss {last.get('loss_pct')}%", f"Latency {last.get('latency_ms')} ms"],
                "evidence": [ev("Prometheus", "Link probes after the fix", data)], "data": data, "confidence": 0.95 if passed else 0.3}

    def breached(self, ctx):
        mx = q(f"max_over_time(({LOSS.format(f=FAC, w='30s')})[20m:10s])")
        return mx is not None and mx >= 99

    def graph(self, ctx):
        m = ctx.get("snapshot", {})
        cause = (ctx.get("cause") or {}).get("key")
        fixed = ctx.get("verified")
        st = "resolved" if fixed else ("critical" if m.get("link_down") or (m.get("loss_pct") or 0) > 15 else "warning")
        E = lambda t: eid(ctx, t)
        n = [node("fac", FAC, "facility", "monitoring", st, [E(T_NET)]),
             node("gw", "Gateway CHI-NORTH-GW01", "network", "evidence", "resolved" if fixed else ("cause" if cause == "wan_link" else st), [E(T_GW)]),
             node("loss", f"Loss {m.get('loss_pct')}% / {m.get('latency_ms')} ms", "metric", "monitoring", st, [E(T_NET)]),
             node("dc", "Data-center services host", "server", "evidence", "normal", [E(T_DIRECT)], "Healthy when probed directly"),
             node("erp", "ERP access", "application", "dependency", st, [E(T_MAP3)]),
             node("files", "Branch file share", "application", "dependency", st, [E(T_MAP3)]),
             node("indy", "CC-INDIANAPOLIS (IND-GW01)", "facility", "evidence", "normal", [E(T_OTHER)], "Unaffected"),
             node("kc", "Keycloak SSO", "identity", "evidence", "normal", [E(T_KC)])]
        e = [edge("fac", "gw", "connects through"), edge("gw", "loss", "shows"), edge("gw", "dc", "VPN to", "evidence"),
             edge("loss", "erp", "affects access to", "dependency"), edge("loss", "files", "affects access to", "dependency"),
             edge("indy", "dc", "VPN to", "evidence"), edge("dc", "kc", "same data center", "evidence")]
        return {"nodes": n, "edges": e}
