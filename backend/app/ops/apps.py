"""The employee's own apps, checked for real: what the employee experiences before and after a fix.

Each check goes through the same path the problem affects, so a fault shows up here as the employee would see it:
  signin     the account state as Keycloak reports it (Keycloak admin API)
  routeops   load today's route from the RouteOps Dispatch API (fails with HTTP 503 when its DB pool is exhausted)
  erp        open the ERP from Chicago North, through the branch link (slow or timing out when the link degrades)
  scan       save a manifest scan to CC-APP-SRV-01 (refused when the server disk is critically full)
  restore    list restore points with the backup job's own credential (fails while that credential is wrong)
"""

import os
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from . import routeops as ro
from . import backup, config, identity, network, sso_service, storage

APPS = [
    {"key": "signin", "name": "Crystal Clean sign-in", "what": "Your account", "usecase": "sso"},
    {"key": "routeops", "name": "RouteOps Mobile", "what": "Load today's route", "usecase": "api"},
    {"key": "erp", "name": "Chicago North ERP", "what": "Open the ERP from the branch", "usecase": "network"},
    {"key": "scan", "name": "Manifest scanning", "what": "Save a scan on CC-APP-SRV-01", "usecase": "storage"},
    {"key": "restore", "name": "Manifest backups", "what": "See restore points", "usecase": "backup"},
]
SCAN_LIMIT_PCT = config.STORAGE_CRIT_PCT  # the scanning app refuses new files above this, to protect the server


def _signin(user: str) -> dict:
    if not sso_service.responding():
        return {"state": "fail", "detail": "Sign-in service isn't responding: nobody can sign in right now"}
    a = identity.account(user)
    if a["status"] == "ACTIVE":
        return {"state": "ok", "detail": "Account active: you can sign in"}
    why = "disabled by an administrator" if not a["enabled"] else "locked after failed sign-ins"
    return {"state": "fail", "detail": f"Account {why}: sign-in refused by Keycloak"}


def _routeops(user: str) -> dict:
    t0 = time.time()
    try:
        r = httpx.get(f"{ro.BASE}/routes/today", timeout=6)
    except httpx.HTTPError as exc:
        return {"state": "fail", "detail": f"RouteOps not answering ({type(exc).__name__})", "ms": int((time.time() - t0) * 1000)}
    ms = int((time.time() - t0) * 1000)
    if r.status_code == 200:
        stops = len(r.json().get("stops", []))
        return {"state": "slow" if ms > 800 else "ok", "detail": f"Today's route loaded: {stops} stops", "ms": ms}
    err = (r.json() if r.headers.get("content-type", "").startswith("application/json") else {}).get("error", "")
    return {"state": "fail", "detail": f"Route did not load: HTTP {r.status_code}" + (f" ({err})" if err else ""), "ms": ms}


def _erp(user: str) -> dict:
    port = network.LINKS["chi-north-erp"]["listen"]
    t0 = time.time()
    try:
        r = httpx.get(f"http://127.0.0.1:{port}/health", timeout=4)
        ms = int((time.time() - t0) * 1000)
        if r.status_code == 200:
            return {"state": "slow" if ms > config.NET_LATENCY_WARN_MS else "ok",
                    "detail": f"ERP opened in {ms / 1000:.2f} s" + (" (very slow)" if ms > config.NET_LATENCY_WARN_MS else ""), "ms": ms}
        return {"state": "fail", "detail": f"ERP error HTTP {r.status_code}", "ms": ms}
    except httpx.HTTPError:
        ms = int((time.time() - t0) * 1000)
        return {"state": "fail", "detail": f"ERP did not open: no response after {ms / 1000:.1f} s", "ms": ms}


def _scan(user: str) -> dict:
    if not storage.mounted():
        return {"state": "na", "detail": f"Server disk {config.STORAGE_VOLUME} is not set up for the demo"}
    u = storage.usage()
    pct = u["used_pct"]
    if pct >= SCAN_LIMIT_PCT:
        return {"state": "fail", "detail": f"Scan not saved: server storage critically low ({pct}% used)"}
    d = storage.ROOT / "apps" / "routeops" / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    f = d / f"manifest-scan-{time.strftime('%Y%m%d-%H%M%S')}.pdf"
    t0 = time.time()
    try:
        f.write_bytes(os.urandom(256 * 1024))
    except OSError as exc:
        return {"state": "fail", "detail": f"Scan not saved: {exc.strerror or type(exc).__name__}"}
    for old in sorted(d.glob("manifest-scan-*.pdf"))[:-20]:  # keep the uploads folder small
        old.unlink(missing_ok=True)
    ms = int((time.time() - t0) * 1000)
    if pct >= config.STORAGE_WARN_PCT:
        return {"state": "slow", "detail": f"Scan saved, but the server is {pct}% full and filling", "ms": ms}
    return {"state": "ok", "detail": f"Scan saved ({pct}% of the server disk used)", "ms": ms}


def _restore(user: str) -> dict:
    if not config.RESTIC_EXE.exists():
        return {"state": "na", "detail": "Backups are not set up for the demo"}
    code, out, err = backup._restic(["snapshots", "--json", "--latest", "1"])  # the job's own credential file
    if code != 0:
        why = "wrong backup password" if "wrong password" in err.lower() or "no key" in err.lower() else err.strip()[-80:] or f"exit {code}"
        return {"state": "fail", "detail": f"Cannot reach your backups ({why})"}
    import json
    try:
        snaps = json.loads(out or "[]")
    except ValueError:
        snaps = []
    last = backup.last()
    if not snaps:
        return {"state": "fail", "detail": "No restore points yet"}
    when = snaps[-1].get("time", "")[11:16]
    if last and not last.get("ok"):
        return {"state": "slow", "detail": f"Last night's backup failed; newest restore point {when}"}
    return {"state": "ok", "detail": f"Restore point available from {when} today"}


CHECKS = {"signin": _signin, "routeops": _routeops, "erp": _erp, "scan": _scan, "restore": _restore}


def check(key: str, user: str) -> dict:
    meta = next(a for a in APPS if a["key"] == key)
    try:
        res = CHECKS[key](user)
    except Exception as exc:
        res = {"state": "na", "detail": f"Check unavailable ({type(exc).__name__})"}
    return {**meta, **res, "at": time.time()}


def check_all(user: str, keys: list[str] | None = None) -> list[dict]:
    keys = keys or [a["key"] for a in APPS]
    with ThreadPoolExecutor(max_workers=len(keys)) as ex:
        return list(ex.map(lambda k: check(k, user), keys))
