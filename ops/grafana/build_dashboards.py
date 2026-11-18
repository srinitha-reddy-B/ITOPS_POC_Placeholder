"""Generates the Grafana dashboards in ops/grafana/dashboards (provisioned at startup). Re-run after editing:
    python ops/grafana/build_dashboards.py
"""

import json
from pathlib import Path

OUT = Path(__file__).parent / "dashboards"
DS = {"type": "prometheus", "uid": "cc-prometheus"}
CHI, IND = "CC-CHICAGO-NORTH", "CC-INDIANAPOLIS"


def ts(title, exprs, unit="short", x=0, y=0, w=12, h=8, thresholds=None, maxv=None):
    steps = [{"color": "green", "value": None}] + [{"color": c, "value": v} for v, c in (thresholds or [])]
    p = {"type": "timeseries", "title": title, "datasource": DS, "gridPos": {"x": x, "y": y, "w": w, "h": h},
         "targets": [{"refId": chr(65 + i), "expr": e, "legendFormat": l, "datasource": DS} for i, (e, l) in enumerate(exprs)],
         "fieldConfig": {"defaults": {"unit": unit, "thresholds": {"mode": "absolute", "steps": steps},
                                      "custom": {"thresholdsStyle": {"mode": "line" if thresholds else "off"}, "lineWidth": 2, "fillOpacity": 8}},
                         "overrides": []}, "options": {"legend": {"displayMode": "list", "placement": "bottom"}}}
    if maxv is not None:
        p["fieldConfig"]["defaults"]["max"] = maxv
        p["fieldConfig"]["defaults"]["min"] = 0
    return p


def stat(title, expr, unit="short", x=0, y=0, w=6, h=4, thresholds=None, decimals=1):
    steps = [{"color": "green", "value": None}] + [{"color": c, "value": v} for v, c in (thresholds or [])]
    return {"type": "stat", "title": title, "datasource": DS, "gridPos": {"x": x, "y": y, "w": w, "h": h},
            "targets": [{"refId": "A", "expr": expr, "datasource": DS}],
            "fieldConfig": {"defaults": {"unit": unit, "decimals": decimals, "thresholds": {"mode": "absolute", "steps": steps}}, "overrides": []},
            "options": {"colorMode": "background", "graphMode": "area", "reduceOptions": {"calcs": ["lastNotNull"]}}}


def dash(uid, title, panels, desc):
    return {"uid": uid, "title": title, "description": desc, "tags": ["crystal-clean", "ops-console"], "timezone": "browser",
            "refresh": "5s", "time": {"from": "now-15m", "to": "now"}, "schemaVersion": 39, "editable": False, "panels": panels}


VOL = 'volume="V:"'
USED = f"100 * (1 - windows_logical_disk_free_bytes{{{VOL}}} / windows_logical_disk_size_bytes{{{VOL}}})"
ROUTE = 'route="/routes/today"'
LOSS = '100 * (1 - avg by (facility) (avg_over_time(probe_success{{link="vpn-wan",facility="{f}"}}[30s])))'
LAT = '1000 * avg by (facility) (avg_over_time((probe_duration_seconds{{link="vpn-wan",facility="{f}"}} and probe_success == 1)[30s:5s]))'

boards = {
    "cc-storage": dash("cc-storage", "Crystal Clean · 1 · Server storage (CC-APP-SRV-01)", [
        stat("Disk used (V:)", USED, "percent", 0, 0, thresholds=[(75, "orange"), (90, "red")]),
        stat("Growth (points/min)", f"deriv(({USED})[2m:5s]) * 60", "none", 6, 0, thresholds=[(0.3, "orange"), (1, "red")], decimals=2),
        stat("CPU", '100 * (1 - avg(rate(windows_cpu_time_seconds_total{mode="idle"}[1m])))', "percent", 12, 0, thresholds=[(80, "orange"), (95, "red")]),
        stat("Memory", "100 * (1 - windows_memory_available_bytes / windows_memory_physical_total_bytes)", "percent", 18, 0,
             thresholds=[(85, "orange"), (95, "red")]),
        ts("Disk used % with 30-min linear forecast", [(USED, "used %"), (f"predict_linear(({USED})[3m:5s], 1800)", "forecast in 30 min")],
           "percent", 0, 4, 24, 9, [(75, "orange"), (90, "red")], 100),
        ts("All volumes on this machine", [('100 * (1 - windows_logical_disk_free_bytes{volume=~"[A-Z]:"} / windows_logical_disk_size_bytes{volume=~"[A-Z]:"})',
                                            "{{volume}}")], "percent", 0, 13, 24, 7, maxv=100)],
        "Real disk usage from windows_exporter. V: is a 2 GB demo virtual disk named CC-APP-SRV-01."),
    "cc-api": dash("cc-api", "Crystal Clean · 3 · RouteOps Dispatch API", [
        stat("p95 latency", f"1000 * histogram_quantile(0.95, sum by (le) (rate(routeops_http_request_duration_seconds_bucket{{{ROUTE}}}[1m])))",
             "ms", 0, 0, thresholds=[(800, "orange"), (2000, "red")], decimals=0),
        stat("5xx rate", f'100 * sum(rate(routeops_http_requests_total{{{ROUTE},code=~"5..|0"}}[1m])) / sum(rate(routeops_http_requests_total{{{ROUTE}}}[1m]))',
             "percent", 6, 0, thresholds=[(5, "orange"), (15, "red")]),
        stat("DB pool in use", "100 * routeops_db_pool_in_use / routeops_db_pool_max", "percent", 12, 0, thresholds=[(80, "orange"), (95, "red")]),
        stat("Traffic", f"sum(rate(routeops_http_requests_total{{{ROUTE}}}[1m]))", "reqps", 18, 0, decimals=2),
        ts("Latency", [(f"1000 * histogram_quantile(0.95, sum by (le) (rate(routeops_http_request_duration_seconds_bucket{{{ROUTE}}}[1m])))", "p95"),
                       (f"1000 * sum(rate(routeops_http_request_duration_seconds_sum{{{ROUTE}}}[1m])) / sum(rate(routeops_http_request_duration_seconds_count{{{ROUTE}}}[1m]))", "average")],
           "ms", 0, 4, 12, 8, [(800, "orange")]),
        ts("Requests by status", [("sum by (code) (rate(routeops_http_requests_total[1m]))", "{{code}}")], "reqps", 12, 4, 12, 8),
        ts("DB connection pool", [("routeops_db_pool_in_use", "in use"), ("routeops_db_pool_max", "max"), ("routeops_export_job_running * 50", "export job running")],
           "short", 0, 12, 24, 8)],
        "Metrics exposed by the RouteOps Dispatch service itself. Driver traffic is generated by the Ops Console backend."),
    "cc-network": dash("cc-network", "Crystal Clean · 4 · Branch connectivity (lab links)", [
        stat("Chicago North probe loss", LOSS.format(f=CHI), "percent", 0, 0, thresholds=[(5, "orange"), (15, "red")]),
        stat("Chicago North latency", LAT.format(f=CHI), "ms", 6, 0, thresholds=[(300, "orange"), (700, "red")], decimals=0),
        stat("Indianapolis probe loss", LOSS.format(f=IND), "percent", 12, 0, thresholds=[(5, "orange"), (15, "red")]),
        stat("Keycloak reachable", 'avg_over_time(probe_success{service="Keycloak SSO"}[1m]) * 100', "percent", 18, 0,
             thresholds=[(0, "red"), (90, "green")]),
        ts("Probe loss by facility", [(LOSS.format(f=CHI), CHI), (LOSS.format(f=IND), IND)], "percent", 0, 4, 12, 8, [(5, "orange")], 100),
        ts("Round-trip time by facility", [(LAT.format(f=CHI), CHI), (LAT.format(f=IND), IND)], "ms", 12, 4, 12, 8, [(300, "orange")]),
        ts("Probe success by endpoint", [("probe_success", "{{facility}} {{service}} ({{link}})")], "short", 0, 12, 24, 8, maxv=1)],
        "Blackbox Exporter probes. The branch links are Toxiproxy lab proxies on this machine, not Crystal Clean's network."),
    "cc-backup": dash("cc-backup", "Crystal Clean · 5 · Backups (Restic)", [
        stat("Last run succeeded", "cc_backup_last_run_success", "bool_yes_no", 0, 0, thresholds=[(0, "red"), (1, "green")], decimals=0),
        stat("Hours since last good backup", "(time() - cc_backup_last_success_timestamp_seconds) / 3600", "h", 6, 0, thresholds=[(12, "orange"), (24, "red")]),
        stat("Backup storage used", "cc_backup_volume_used_percent", "percent", 12, 0, thresholds=[(80, "orange"), (90, "red")]),
        stat("Last restore test", "cc_backup_restore_test_success", "bool_yes_no", 18, 0, thresholds=[(0, "red"), (1, "green")], decimals=0),
        ts("Backup storage and repository size", [("cc_backup_volume_used_percent", "volume used %")], "percent", 0, 4, 12, 8, [(90, "red")], 100),
        ts("Repository size", [("cc_backup_repo_megabytes", "MB")], "decmbytes", 12, 4, 12, 8)],
        "Results of real Restic runs and restore tests, exported by the Ops Console backend."),
    "cc-sso": dash("cc-sso", "Crystal Clean · 2 · SSO (Keycloak)", [
        stat("Keycloak reachable", 'avg_over_time(probe_success{service="Keycloak SSO"}[1m]) * 100', "percent", 0, 0, thresholds=[(0, "red"), (90, "green")]),
        stat("Sign-in failures (5 min)", 'sum(increase(cc_keycloak_logins_total{result="failure"}[5m]))', "short", 6, 0,
             thresholds=[(3, "orange"), (10, "red")], decimals=0),
        stat("Successful sign-ins (5 min)", 'sum(increase(cc_keycloak_logins_total{result="success"}[5m]))', "short", 12, 0, decimals=0),
        stat("Keycloak event feed", "cc_keycloak_event_poll_ok", "bool_yes_no", 18, 0, thresholds=[(0, "red"), (1, "green")], decimals=0),
        ts("Sign-ins by app and result", [("sum by (client, result) (rate(cc_keycloak_logins_total[1m])) * 60", "{{client}} {{result}}")],
           "short", 0, 4, 12, 8),
        ts("Failures by reason", [('sum by (error) (rate(cc_keycloak_logins_total{result="failure"}[1m])) * 60', "{{error}}")], "short", 12, 4, 12, 8)],
        "Counts of Keycloak LOGIN / LOGIN_ERROR events read from the realm's event log."),
}

OUT.mkdir(exist_ok=True)
for uid, d in boards.items():
    (OUT / f"{uid}.json").write_text(json.dumps(d, indent=2), encoding="utf-8")
print(f"wrote {len(boards)} dashboards to {OUT}")
