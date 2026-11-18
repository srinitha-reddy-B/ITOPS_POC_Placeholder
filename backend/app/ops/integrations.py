"""Integration registry: every status shown in the console comes from a real health check made here.

`mode` says what kind of data an integration provides:
  live         real product, real data from this machine (Prometheus, Keycloak, Restic, ...)
  lab          real product, controlled demo environment (Toxiproxy as the branch WAN link)
"""

import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from . import backup, config, identity, network, prom, storage

_last_ok: dict = {}
_cache = {"at": 0.0, "rows": []}
_lock = threading.Lock()


def _http_ok(url: str, timeout: float = 3) -> tuple[bool, str]:
    try:
        r = httpx.get(url, timeout=timeout)
        return r.status_code < 400, f"HTTP {r.status_code}"
    except httpx.HTTPError as exc:
        return False, f"not reachable ({type(exc).__name__})"


def _target(job: str) -> dict:
    try:
        rows = [t for t in prom.targets() if t["job"] == job]
    except prom.PromError:
        return {"up": None, "detail": "Prometheus unavailable"}
    up = sum(1 for t in rows if t["health"] == "up")
    return {"up": up, "total": len(rows), "error": next((t["error"] for t in rows if t["error"]), "")}


def _prometheus():
    ok, d = _http_ok(f"{config.PROMETHEUS_URL}/-/ready")
    info = {}
    if ok:
        try:
            ts = prom.targets()
            info = {"targets_up": sum(1 for t in ts if t["health"] == "up"), "targets": len(ts)}
            d = f"{info['targets_up']}/{info['targets']} scrape targets up"
        except prom.PromError as exc:
            ok, d = False, str(exc)
    return ok, d, info


def _windows_exporter():
    ok, d = _http_ok(f"{config.WINDOWS_EXPORTER_URL}/metrics", 5)
    info = {}
    if ok:
        t = _target("windows")
        info = {"scraped_by_prometheus": bool(t.get("up")), "demo_disk_mounted": storage.mounted()}
        try:
            vols = prom.query('windows_logical_disk_size_bytes{volume=~"[A-Z]:"}')
            info["volumes"] = sorted(v["labels"]["volume"] for v in vols)
        except prom.PromError:
            pass
        d = "Exporting CPU, memory, disk" + ("" if storage.mounted() else f" ({config.STORAGE_VOLUME} demo disk not mounted)")
    return ok, d, info


def _grafana():
    try:
        r = httpx.get(f"{config.GRAFANA_URL}/api/health", timeout=3)
        j = r.json()
        return r.status_code == 200 and j.get("database") == "ok", f"Grafana {j.get('version', '')}".strip(), {}
    except (httpx.HTTPError, ValueError) as exc:
        return False, f"not reachable ({type(exc).__name__})", {}


def _blackbox():
    ok, d = _http_ok(f"{config.BLACKBOX_URL}/-/healthy")
    info = _target("blackbox-http") if ok else {}
    if ok and info.get("total"):
        d = f"Probing {info['total']} endpoints"
    return ok, d, info


def _toxiproxy():
    h = network.health()
    return h["ok"], h["detail"], {"fault": network.state()["label"]} if h["ok"] else {}


def _keycloak():
    h = identity.health()
    return h["ok"], h["detail"], {k: v for k, v in h.items() if k not in ("ok", "detail")}


def _restic():
    h = backup.health()
    return h["ok"], h["detail"], {k: v for k, v in h.items() if k not in ("ok", "detail")}


def _routeops():
    ok, d = _http_ok("http://127.0.0.1:8090/metrics")
    t = _target("routeops")
    return ok, ("Serving metrics" if ok else d), {"scraped_by_prometheus": bool(t.get("up"))}


def _llm():
    key = bool(os.getenv("COHERE_API_KEY", "").strip())
    return key, ("API key configured" if key else "No COHERE_API_KEY: agents use deterministic reasoning only"), {
        "model": os.getenv("CC_AGENT_MODEL") or "command-a-03-2025"}


REGISTRY = [
    {"key": "keycloak", "name": "Keycloak", "mode": "live", "purpose": "SSO, identity and roles (OIDC)",
     "endpoint": config.KEYCLOAK_PUBLIC_URL, "console": f"{config.KEYCLOAK_PUBLIC_URL}/admin/master/console/#/{config.KEYCLOAK_REALM}",
     "collecting": "Sign-in events, account status, roles, client configuration", "use_cases": ["sso"], "check": _keycloak},
    {"key": "prometheus", "name": "Prometheus", "mode": "live", "purpose": "Metrics store and queries",
     "endpoint": config.PROMETHEUS_URL, "console": f"{config.PROMETHEUS_URL}/targets",
     "collecting": "Every metric below, scraped every 5 s", "use_cases": ["storage", "api", "network", "backup", "sso"], "check": _prometheus},
    {"key": "windows_exporter", "name": "windows_exporter", "mode": "live",
     "purpose": "Server metrics of this machine (the Windows counterpart of Node Exporter)",
     "endpoint": config.WINDOWS_EXPORTER_URL, "console": f"{config.WINDOWS_EXPORTER_URL}/metrics",
     "collecting": f"CPU, memory, disk of every volume incl. {config.STORAGE_VOLUME} ({config.STORAGE_SERVER})", "use_cases": ["storage"],
     "check": _windows_exporter},
    {"key": "grafana", "name": "Grafana", "mode": "live", "purpose": "Monitoring dashboards",
     "endpoint": config.GRAFANA_URL, "console": f"{config.GRAFANA_URL}/dashboards",
     "collecting": "Dashboards for all five use cases, reading Prometheus", "use_cases": ["storage", "api", "network", "backup", "sso"],
     "check": _grafana},
    {"key": "blackbox", "name": "Blackbox Exporter", "mode": "live", "purpose": "Network and endpoint probes",
     "endpoint": config.BLACKBOX_URL, "console": f"{config.BLACKBOX_URL}",
     "collecting": "Probe success and round-trip time for branch links and Keycloak", "use_cases": ["network", "sso"], "check": _blackbox},
    {"key": "toxiproxy", "name": "Toxiproxy", "mode": "lab", "purpose": "Branch WAN link lab (controllable latency, loss, outage)",
     "endpoint": config.TOXIPROXY_URL, "console": f"{config.TOXIPROXY_URL}/proxies",
     "collecting": "Live link configuration of the demo branch gateways", "use_cases": ["network"], "check": _toxiproxy},
    {"key": "restic", "name": "Restic", "mode": "live", "purpose": "Backups and restore tests",
     "endpoint": "restic.exe (local)", "console": "",
     "collecting": "Backup runs, snapshots, repository size, restore verification", "use_cases": ["backup"], "check": _restic},
    {"key": "routeops", "name": "RouteOps Dispatch API", "mode": "lab", "purpose": "Demo business application with Prometheus metrics",
     "endpoint": "http://127.0.0.1:8090", "console": "http://127.0.0.1:8090/metrics",
     "collecting": "Requests, 5xx errors, latency histogram, DB pool usage", "use_cases": ["api"], "check": _routeops},
    {"key": "llm", "name": "Cohere (LLM)", "mode": "live", "purpose": "Agent reasoning (existing integration)",
     "endpoint": "api.cohere.com", "console": "", "collecting": "Hypotheses, critiques and summaries, grounded in evidence",
     "use_cases": ["storage", "api", "network", "backup", "sso"], "check": _llm},
]


def _run(item: dict) -> dict:
    try:
        ok, detail, info = item["check"]()
    except Exception as exc:  # a broken integration must never break the page
        ok, detail, info = False, f"check failed ({type(exc).__name__})", {}
    if ok:
        _last_ok[item["key"]] = time.time()
    return {k: v for k, v in item.items() if k != "check"} | {
        "ok": ok, "status": "Connected" if ok else "Unavailable", "detail": detail, "info": info,
        "last_ok": _last_ok.get(item["key"]), "checked": time.time()}


def status(max_age: float = 8) -> list[dict]:
    with _lock:
        if time.time() - _cache["at"] < max_age and _cache["rows"]:
            return _cache["rows"]
    with ThreadPoolExecutor(max_workers=len(REGISTRY)) as ex:
        rows = list(ex.map(_run, REGISTRY))
    with _lock:
        _cache.update(at=time.time(), rows=rows)
    return rows


def is_up(key: str) -> bool:
    return any(r["key"] == key and r["ok"] for r in status())
