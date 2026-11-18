"""Runs, monitors and restarts the RouteOps Dispatch API (app/cc_routeops_service.py).

The backend starts the service as a child process on 127.0.0.1:CC_ROUTEOPS_PORT (8090) and probes
GET /health every few seconds. The samples feed the IT view's health chart, the early warning
(pool filling up) and the agents' evidence. Restart = graceful /admin/shutdown, then a new process.
"""

import atexit
import os
import subprocess
import sys
import tempfile
import threading
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

import httpx

PORT = int(os.getenv("CC_ROUTEOPS_PORT", "8090"))
BASE = f"http://127.0.0.1:{PORT}"
NAME = "RouteOps Dispatch API"
_DIR = Path(os.getenv("CC_SANDBOX_DIR") or Path(tempfile.gettempdir()) / "crystal-clean-hub")
LOG = _DIR / "routeops-dispatch.log"
_BACKEND = Path(__file__).resolve().parent.parent
_PROBE_EVERY = 3.0

_lock = threading.RLock()
_proc: subprocess.Popen | None = None
_samples: deque = deque(maxlen=200)
_info = {"restarts": 0, "started_at": None, "export_job": "on"}
_busy = threading.Event()  # set while we stop/start the service on purpose


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def probe() -> dict:
    t0 = time.time()
    try:
        r = httpx.get(f"{BASE}/health", timeout=4)
        j = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        return {"at": _now(), "ok": r.status_code == 200, "code": r.status_code, "ms": int((time.time() - t0) * 1000),
                "pool": j.get("pool_in_use"), "pool_max": j.get("pool_max", 50)}
    except httpx.HTTPError:
        return {"at": _now(), "ok": False, "code": 0, "ms": int((time.time() - t0) * 1000), "pool": None, "pool_max": 50}


def start(export_job: str = "on") -> None:
    global _proc
    with _lock:
        _DIR.mkdir(parents=True, exist_ok=True)
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        _proc = subprocess.Popen([sys.executable, "-m", "app.cc_routeops_service", "--port", str(PORT), "--log", str(LOG),
                                  "--export-job", export_job], cwd=str(_BACKEND), creationflags=flags,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        _info.update(started_at=_now(), export_job=export_job, pid=_proc.pid)
    for _ in range(40):
        if probe()["ok"]:
            return
        time.sleep(0.25)


def stop() -> None:
    global _proc
    try:
        httpx.post(f"{BASE}/admin/shutdown", timeout=3)
    except httpx.HTTPError:
        pass
    with _lock:
        if _proc is not None:
            try:
                _proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _proc.kill()
            _proc = None
    for _ in range(40):  # wait until the port is free
        if probe()["code"] == 0:
            return
        time.sleep(0.25)


def restart(export_job: str = "off") -> dict:
    _busy.set()
    try:
        stop()
        start(export_job)
    finally:
        _busy.clear()
    _info["restarts"] += 1
    s = probe()
    _samples.append(s)
    return s


def inject_fault() -> str:
    try:
        r = httpx.post(f"{BASE}/admin/fault", timeout=4)
        if r.status_code == 409:
            restart("on")
            httpx.post(f"{BASE}/admin/fault", timeout=4)
    except httpx.HTTPError:
        start("on")
        httpx.post(f"{BASE}/admin/fault", timeout=4)
    return f"{NAME}: the nightly manifest-export job is running and leaking DB connections; the pool fills in about 1.5 minutes."


def reset_clean() -> None:
    restart("on")
    _samples.clear()
    _info["restarts"] = 0


def log_tail(n: int = 14) -> list[str]:
    try:
        with open(LOG, encoding="utf-8", errors="replace") as f:
            return [line.rstrip() for line in f.readlines()[-n:]]
    except OSError:
        return []


def samples(n: int = 80) -> list[dict]:
    return list(_samples)[-n:]


def summary() -> dict:
    s = samples(40)
    last = s[-1] if s else probe()
    fails = 0
    for x in reversed(s):
        if x["ok"]:
            break
        fails += 1
    recent = [x for x in s[-20:]]
    ms = sorted(x["ms"] for x in recent if x["ok"]) or [0]
    pools = [(i, x["pool"]) for i, x in enumerate(s[-10:]) if x.get("pool") is not None]
    secs_to_exhaust = None
    if len(pools) >= 3:
        (i0, p0), (i1, p1) = pools[0], pools[-1]
        rate = (p1 - p0) / max(1, (i1 - i0)) / _PROBE_EVERY  # connections per second
        if rate > 0 and p1 < last.get("pool_max", 50):
            secs_to_exhaust = int((last.get("pool_max", 50) - p1) / rate)
    return {"name": NAME, "status": "up" if last["ok"] else ("down" if last["code"] in (0, 503) else "degraded"),
            "http_code": last["code"], "pool_in_use": last.get("pool"), "pool_max": last.get("pool_max", 50),
            "consecutive_failures": fails, "p95_ms": ms[int(0.95 * (len(ms) - 1))],
            "availability_last_min": round(100 * sum(1 for x in s[-20:] if x["ok"]) / max(1, len(s[-20:]))),
            "secs_to_pool_exhausted": secs_to_exhaust, "restarts": _info["restarts"], "pid": _info.get("pid"),
            "started_at": _info.get("started_at")}


def _monitor() -> None:
    dead = 0
    while True:
        s = probe()
        _samples.append(s)
        dead = dead + 1 if s["code"] == 0 and not _busy.is_set() else 0
        if dead >= 2:  # process gone (not an outage: those answer 503): supervise it back up
            start(_info.get("export_job", "on"))
            dead = 0
        time.sleep(_PROBE_EVERY)


def init() -> None:
    """Start the service if nothing answers on the port, then start the health monitor."""
    if probe()["code"] == 0:
        start("on")
    threading.Thread(target=_monitor, daemon=True).start()
    atexit.register(stop)
