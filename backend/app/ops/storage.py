"""Use case 1: predictive storage exhaustion on CC-APP-SRV-01 (the real V: virtual disk).

Layout on V:
  data\\manifest-archive\\     business records. PROTECTED: no remediation ever touches this folder.
  apps\\routeops\\logs\\         application logs. The fault: a release left DEBUG logging on, so logs grow fast.
  apps\\routeops\\config\\logging.json   the live log level the "application" reads
  apps\\routeops\\tmp\\report-cache\\  regenerable report cache files

The growth is real file writes, so windows_exporter -> Prometheus shows the disk filling. Demo time is
accelerated: about 1 MB/s here stands in for ~3% a day on a real server; the UI labels this.

Remediation (after approval): compress rotated debug logs (kept, not deleted), clear report-cache files
older than 1 minute (regenerable), and set the log level back to INFO so the growth stops.
"""

import gzip
import json
import os
import shutil
import threading
import time
from pathlib import Path

from . import config, store

ROOT = Path(config.STORAGE_VOLUME + "/")
PROTECTED = ROOT / "data"
LOGS = ROOT / "apps" / "routeops" / "logs"
CFG = ROOT / "apps" / "routeops" / "config" / "logging.json"
CACHE = ROOT / "apps" / "routeops" / "tmp" / "report-cache"
ROTATE_MB = 40
GROWTH_MB_S = float(os.getenv("CC_STORAGE_GROWTH_MB_S", "1.2"))
STOP_AT_PCT = 96.0  # the generator never fills the disk completely
_MB = 1024 * 1024
_writer: threading.Thread | None = None
_stop = threading.Event()
_samples: list = []  # (time, {folder: MB}) every 15 s, to tell which folder is growing now

_LINES = [
    "DEBUG RouteOptimizer - evaluating stop sequence candidate {i} for route IND-{r} (cost={c:.2f})\n",
    "DEBUG ManifestSync - payload diff computed for manifest MAN-{m}: 14 fields compared, 0 changed\n",
    "DEBUG GeoCache - cache miss for tile 39.7{r}/-86.1{g}; fetching from provider\n",
    "DEBUG DbPool - connection lease granted (pool=dispatch, in_use={p}, wait_ms=0)\n",
]


def mounted() -> bool:
    return ROOT.exists()


def usage() -> dict:
    if not mounted():
        return {"mounted": False, "volume": config.STORAGE_VOLUME}
    u = shutil.disk_usage(ROOT)
    return {"mounted": True, "volume": config.STORAGE_VOLUME, "total_mb": round(u.total / _MB), "used_mb": round(u.used / _MB),
            "free_mb": round(u.free / _MB), "used_pct": round(u.used / u.total * 100, 1)}


def _log_level() -> str:
    try:
        return json.loads(CFG.read_text(encoding="utf-8")).get("level", "INFO")
    except (OSError, ValueError):
        return "INFO"


def _set_log_level(level: str, by: str) -> None:
    CFG.parent.mkdir(parents=True, exist_ok=True)
    CFG.write_text(json.dumps({"level": level, "changed_by": by, "changed_at": time.strftime("%Y-%m-%dT%H:%M:%S")}, indent=2), encoding="utf-8")


def _write_random(path: Path, mb: float) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as f:
        left = int(mb * _MB)
        while left > 0:
            n = min(left, 8 * _MB)
            f.write(os.urandom(n))
            left -= n


def baseline(target_pct: float = 69.0) -> dict:
    """Reset to a healthy state: business data up to ~69% of the disk, INFO logging, a normal log and cache."""
    if not mounted():
        raise RuntimeError(f"{config.STORAGE_VOLUME} is not mounted (run scripts\\create_demo_disks.ps1 as admin)")
    stop_growth()
    for d in (LOGS, CACHE):
        shutil.rmtree(d, ignore_errors=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    _set_log_level("INFO", "release 3.2.0")
    (LOGS / "dispatch.log").write_text("INFO RouteOps Dispatch started\n" * 2000, encoding="utf-8")
    for i in range(6):
        _write_random(CACHE / f"report-{i:03d}.cache", 2)
    u = usage()
    need = u["total_mb"] * target_pct / 100 - u["used_mb"]
    i = len(list(PROTECTED.glob("**/*.dat"))) if PROTECTED.exists() else 0
    while need > 1:
        chunk = min(need, 100)
        _write_random(PROTECTED / "manifest-archive" / f"manifests-{2019 + i // 12}-{i % 12 + 1:02d}.dat", chunk)
        need -= chunk
        i += 1
    if need < -20:  # above target: trim the newest business-data files we created (only ours, never anything else)
        for f in sorted(PROTECTED.glob("manifest-archive/manifests-*.dat"), reverse=True):
            if usage()["used_pct"] <= target_pct:
                break
            f.unlink()
    store.log_event("demo", "Demo control", f"{config.STORAGE_SERVER} reset to baseline ({usage()['used_pct']}% used)")
    return usage()


def _growth_loop() -> None:
    i, part = 0, 1
    LOGS.mkdir(parents=True, exist_ok=True)
    active = LOGS / "dispatch-debug.log"
    while not _stop.is_set():
        if _log_level() != "DEBUG" or usage().get("used_pct", 100) >= STOP_AT_PCT:
            _stop.wait(1)
            continue
        target = int(GROWTH_MB_S * _MB / 2)
        buf = []
        size = 0
        while size < target:
            line = _LINES[i % 4].format(i=i, r=i % 400, g=i % 97, c=(i % 1000) / 7, m=100000 + i % 5000, p=12 + i % 30)
            buf.append(line)
            size += len(line)
            i += 1
        with active.open("a", encoding="utf-8") as f:
            f.write("".join(buf))
        if active.stat().st_size > ROTATE_MB * _MB:
            active.rename(LOGS / f"dispatch-debug.{part:03d}.log")
            part += 1
        _stop.wait(0.5)


def start_growth() -> dict:
    """Stage use case 1: release 3.2.1 ships with DEBUG logging on, and logs start filling the disk."""
    global _writer
    if not mounted():
        raise RuntimeError(f"{config.STORAGE_VOLUME} is not mounted (run scripts\\create_demo_disks.ps1 as admin)")
    _set_log_level("DEBUG", "release 3.2.1 (deployment pipeline)")
    store.log_event("change", "Change record (demo)", "RouteOps Dispatch release 3.2.1 deployed to CC-APP-SRV-01",
                    {"server": config.STORAGE_SERVER, "change": "CHG-DEMO-3021", "includes": "logging.json level=DEBUG"})
    if _writer and _writer.is_alive() and _stop.is_set():
        _writer.join(timeout=3)  # a reset just stopped the previous writer: let it finish before starting again
    if not (_writer and _writer.is_alive()):
        _stop.clear()
        _writer = threading.Thread(target=_growth_loop, daemon=True, name="storage-growth")
        _writer.start()
    return {"ok": True, "log_level": "DEBUG"}


def stop_growth() -> None:
    _stop.set()


def growing() -> bool:
    return bool(_writer and _writer.is_alive() and not _stop.is_set() and _log_level() == "DEBUG")


def _folder_mb(p: Path) -> float:
    return round(sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) / _MB, 1) if p.exists() else 0.0


def _sizes() -> dict:
    return {"data": _folder_mb(PROTECTED), "apps/routeops/logs": _folder_mb(LOGS), "apps/routeops/tmp/report-cache": _folder_mb(CACHE)}


def _sampler() -> None:
    while True:
        if mounted():
            try:
                _samples.append((time.time(), _sizes()))
                del _samples[:-40]
            except OSError:
                pass
        time.sleep(15)


def start_sampler() -> None:
    threading.Thread(target=_sampler, daemon=True, name="storage-sampler").start()


def growth_last_minute() -> dict:
    """MB each folder grew over the last ~60 s (from the 15 s samples)."""
    now = _sizes()
    old = next((sz for t, sz in reversed(_samples) if time.time() - t >= 55), None)
    if old is None:
        return {k: 0.0 for k in now}
    return {k: round(now[k] - old.get(k, now[k]), 1) for k in now}


def investigate() -> dict:
    """Evidence: what is using the disk, the biggest files, and the current log configuration."""
    if not mounted():
        return {"mounted": False}
    folders = {}
    for top in [PROTECTED, LOGS, CACHE, ROOT / "apps" / "routeops" / "config"]:
        folders[str(top.relative_to(ROOT)).replace("\\", "/")] = _folder_mb(top)
    files = sorted((f for f in ROOT.rglob("*") if f.is_file() and "System Volume Information" not in str(f)),
                   key=lambda f: f.stat().st_size, reverse=True)[:8]
    now = time.time()
    largest = [{"path": str(f.relative_to(ROOT)).replace("\\", "/"), "mb": round(f.stat().st_size / _MB, 1),
                "modified_s_ago": int(now - f.stat().st_mtime), "protected": PROTECTED in f.parents} for f in files]
    recent = sum(f.stat().st_size for f in LOGS.rglob("*.log") if now - f.stat().st_mtime < 300) / _MB if LOGS.exists() else 0
    try:
        cfg = json.loads(CFG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cfg = {}
    return {"mounted": True, "usage": usage(), "folders_mb": folders, "largest_files": largest,
            "log_config": cfg, "debug_logs": len(list(LOGS.glob("dispatch-debug*.log"))) if LOGS.exists() else 0,
            "logs_written_last_5min_mb": round(recent, 1), "growth_active": growing(), "growth_1m_mb": growth_last_minute()}


def remediate() -> dict:
    """Approved fix: compress rotated debug logs, clear old regenerable cache, set logging back to INFO."""
    before = usage()
    _set_log_level("INFO", "Ops Console remediation (approved)")
    time.sleep(1.2)  # let the writer notice and stop appending
    compressed, freed_cache = [], 0
    arch = LOGS / "archive"
    arch.mkdir(parents=True, exist_ok=True)
    for f in sorted(LOGS.glob("dispatch-debug*.log")):
        if PROTECTED in f.parents:
            continue  # guardrail (cannot happen with these paths, kept on purpose)
        gz = arch / (f.name + ".gz")
        with f.open("rb") as src, gzip.open(gz, "wb", compresslevel=6) as dst:
            shutil.copyfileobj(src, dst)
        compressed.append({"file": f.name, "mb": round(f.stat().st_size / _MB, 1), "gz_mb": round(gz.stat().st_size / _MB, 2)})
        f.unlink()
    now = time.time()
    for f in CACHE.glob("*.cache") if CACHE.exists() else []:
        if now - f.stat().st_mtime > 60:
            freed_cache += f.stat().st_size
            f.unlink()
    after = usage()
    data = {"before_pct": before.get("used_pct"), "after_pct": after.get("used_pct"), "log_level": "INFO",
            "logs_compressed": compressed, "cache_cleared_mb": round(freed_cache / _MB, 1),
            "protected_untouched": str(PROTECTED), "freed_mb": round(before.get("used_mb", 0) - after.get("used_mb", 0))}
    store.log_event("remediation", "Ops Console", f"{config.STORAGE_SERVER}: logs compressed, cache cleared, DEBUG logging off "
                    f"({data['before_pct']}% -> {data['after_pct']}%)", data)
    return data
