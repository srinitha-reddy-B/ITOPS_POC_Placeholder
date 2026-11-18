"""Use case 5: real Restic backups of a demo database server, with real failures and a real restore test.

Source   %TEMP%\\crystal-clean-ops\\cc-db-srv-01   a sample manifests database plus the nightly export file
Repo     W:\\restic-repo  on the 160 MB backup volume CC-BKP-STOR-01 (scripts\\create_demo_disks.ps1);
         without W: it falls back to a local folder and the storage-full scenario is unavailable.
Job      the "scheduled backup job" reads its repository password from its own credential file, the way
         a real job config does. The vault copy is RESTIC_PASSWORD in backend\\.env.

Failure modes the demo can cause, both produce genuine Restic errors:
  storage_full   old nightly snapshots were never pruned (no retention policy) and fill the backup volume,
                 so the next backup fails with "not enough space on the disk"
  credential     the job's credential file holds an outdated password, so Restic answers "wrong password"

Corrective actions (each needs human approval in the console):
  apply_retention   restic forget --keep-last N --prune   (removes old restore points: approval required)
  resync_credential copy the vault password back into the job's credential file
Verification: a fresh backup, then a restore of the latest snapshot into a scratch folder whose files are
compared by SHA-256 against what was backed up. Backup created != recovery verified; the UI keeps them apart.
"""

import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from . import config, store

SERVER = "CC-DB-SRV-01"
SOURCE = config.DATA_DIR / "cc-db-srv-01"
JOB_DIR = config.DATA_DIR / "backup-job"
CRED_FILE = JOB_DIR / "repository.pwd"
EXPORT_MB = 12
_lock = threading.Lock()


def repo_path() -> Path:
    w = Path("W:/")
    if os.getenv("CC_RESTIC_REPO"):
        return Path(os.environ["CC_RESTIC_REPO"])
    return w / "restic-repo" if w.exists() else config.STACK_DIR / "data" / "restic-repo"


def on_backup_volume() -> bool:
    return str(repo_path()).upper().startswith("W:")


def _vault_password() -> str:
    import secrets
    return config.env_get_or_create("RESTIC_PASSWORD", lambda: secrets.token_urlsafe(24))


def _restic(args: list[str], password_file: Path | None = None, timeout: int = 300) -> tuple[int, str, str]:
    if not config.RESTIC_EXE.exists():
        return 127, "", f"restic not installed at {config.RESTIC_EXE}"
    pw_file = password_file or CRED_FILE
    env = {**os.environ, "RESTIC_REPOSITORY": str(repo_path()), "RESTIC_PASSWORD_FILE": str(pw_file),
           "RESTIC_CACHE_DIR": str(config.DATA_DIR / "restic-cache")}
    env.pop("RESTIC_PASSWORD", None)
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    p = subprocess.run([str(config.RESTIC_EXE), *args], env=env, capture_output=True, text=True, timeout=timeout, creationflags=flags)
    return p.returncode, p.stdout, p.stderr


def _vault_file() -> Path:
    JOB_DIR.mkdir(parents=True, exist_ok=True)
    f = JOB_DIR / ".vault.pwd"
    f.write_text(_vault_password(), encoding="utf-8")
    return f


def _write_export() -> Path:
    """The nightly database export: new, incompressible content each night (so each snapshot adds real data)."""
    ex = SOURCE / "exports"
    ex.mkdir(parents=True, exist_ok=True)
    for old in ex.glob("nightly-*.bin"):
        old.unlink()
    f = ex / f"nightly-{time.strftime('%Y%m%d-%H%M%S')}.bin"
    f.write_bytes(os.urandom(EXPORT_MB * 1024 * 1024))
    return f


def ensure_source() -> None:
    SOURCE.mkdir(parents=True, exist_ok=True)
    db = SOURCE / "manifests.db"
    if not db.exists():
        c = sqlite3.connect(db)
        c.execute("CREATE TABLE manifests (id TEXT PRIMARY KEY, branch TEXT, customer TEXT, waste_stream TEXT, gallons REAL, picked_up TEXT)")
        rows = [(f"MAN-{100000 + i}", ["Indianapolis", "Chicago North", "Elgin", "Detroit"][i % 4],
                 f"Customer {i % 120:03d}", ["Used oil", "Parts washer solvent", "Antifreeze", "Oily water"][i % 4],
                 round(40 + (i * 7) % 300, 1), f"2026-{(i % 12) + 1:02d}-{(i % 27) + 1:02d}") for i in range(5000)]
        c.executemany("INSERT INTO manifests VALUES (?,?,?,?,?,?)", rows)
        c.commit()
        c.close()
    ex = SOURCE / "exports"
    if not ex.exists() or not any(ex.glob("nightly-*.bin")):
        _write_export()


def ensure_repo() -> dict:
    """Create the job credential file and the repository if missing."""
    JOB_DIR.mkdir(parents=True, exist_ok=True)
    if not CRED_FILE.exists():
        CRED_FILE.write_text(_vault_password(), encoding="utf-8")
    ensure_source()
    rp = repo_path()
    if not (rp / "config").exists():
        rp.parent.mkdir(parents=True, exist_ok=True)
        code, out, err = _restic(["init"], password_file=_vault_file())
        if code != 0:
            return {"ok": False, "error": err.strip()[-400:]}
        store.log_event("backup", "Restic", f"Repository created at {rp}")
    return {"ok": True}


def _manifest(base: Path) -> dict:
    out = {}
    for f in sorted(base.rglob("*")):
        if f.is_file():
            h = hashlib.sha256()
            with f.open("rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    h.update(chunk)
            out[f.relative_to(base).as_posix()] = h.hexdigest()
    return out


def _classify(code: int, err: str) -> str:
    e = err.lower()
    if "not enough space" in e or "no space left" in e:
        return "storage_full"
    if code == 12 or "wrong password" in e or "no key found" in e:
        return "credential"
    if code == 11 or "already locked" in e:
        return "locked"
    if code == 10 or "repository does not exist" in e or "unable to open config" in e:
        return "repository_unreachable"
    if "access is denied" in e or "permission denied" in e:
        return "permissions"
    return "unknown" if code else ""


def run_backup(trigger: str = "scheduled", new_export: bool = True) -> dict:
    """Run the scheduled backup job now. Records the real outcome."""
    with _lock:
        r = ensure_repo()
        if not r["ok"]:
            ev = store.log_event("backup", "Restic", "Backup could not start", {"ok": False, "error": r["error"], "trigger": trigger,
                                                                                "failure": _classify(1, r["error"])})
            return ev["data"]
        if new_export:
            _write_export()
        manifest = _manifest(SOURCE)
        t0 = time.time()
        code, out, err = _restic(["backup", "--json", "--host", SERVER, "--tag", "nightly", str(SOURCE)], timeout=600)
        dur = round(time.time() - t0, 1)
        summary = {}
        for line in out.splitlines():
            try:
                j = json.loads(line)
            except ValueError:
                continue
            if j.get("message_type") == "summary":
                summary = j
        ok = code == 0 and bool(summary.get("snapshot_id"))
        data = {"ok": ok, "trigger": trigger, "exit_code": code, "duration_s": dur, "server": SERVER,
                "snapshot": (summary.get("snapshot_id") or "")[:8], "added_mb": round(summary.get("data_added", 0) / 1048576, 1),
                "files": summary.get("total_files_processed"), "error": "" if ok else (err.strip() or out.strip())[-600:],
                "failure": "" if ok else _classify(code, err), "manifest": manifest if ok else {}, "repo": str(repo_path())}
        msg = f"Backup of {SERVER} {'succeeded' if ok else 'FAILED'} ({dur}s)" + (f", snapshot {data['snapshot']}" if ok else f": {data['failure']}")
        store.log_event("backup", "Restic", msg, data)
        return data


def snapshots() -> list[dict]:
    code, out, err = _restic(["snapshots", "--json"], password_file=_vault_file())
    if code != 0:
        return []
    try:
        rows = json.loads(out or "[]")
    except ValueError:
        return []
    return [{"id": s.get("short_id") or s["id"][:8], "time": s.get("time", "")[:19], "host": s.get("hostname"), "tags": s.get("tags", [])}
            for s in rows]


def volume() -> dict:
    rp = repo_path()
    anchor = Path(rp.anchor or "C:/")
    try:
        u = shutil.disk_usage(anchor)
    except OSError:
        return {"path": str(rp), "on_backup_volume": on_backup_volume(), "available": False}
    repo_bytes = sum(f.stat().st_size for f in rp.rglob("*") if f.is_file()) if rp.exists() else 0
    return {"path": str(rp), "on_backup_volume": on_backup_volume(), "available": True, "volume": str(anchor),
            "total_mb": round(u.total / 1048576, 1), "used_mb": round(u.used / 1048576, 1), "free_mb": round(u.free / 1048576, 1),
            "used_pct": round(u.used / u.total * 100, 1), "repo_mb": round(repo_bytes / 1048576, 1)}


def last(kind_ok: bool | None = None) -> dict | None:
    for e in store.events("backup", 200):
        d = e["data"]
        if "ok" not in d or "trigger" not in d:
            continue
        if kind_ok is None or d["ok"] == kind_ok:
            return {**d, "ts": e["ts"]}
    return None


def restore_test() -> dict:
    """Restore the latest snapshot into a scratch folder and compare every file's SHA-256 with what was backed up."""
    with _lock:
        good = last(True)
        if not good:
            return {"ok": False, "error": "no successful backup to restore"}
        target = Path(tempfile.mkdtemp(prefix="cc-restore-", dir=config.DATA_DIR))
        t0 = time.time()
        # restore just the backed-up folder (snapshot:path), so Windows parent folders (e.g. C:\Users) are not recreated
        inner = "/" + str(SOURCE).replace(":", "").replace("\\", "/")
        code, out, err = _restic(["restore", f"{good['snapshot']}:{inner}", "--target", str(target)], password_file=_vault_file(), timeout=600)
        restored_root = next((p for p in target.rglob("manifests.db")), None)
        base = restored_root.parent if restored_root else target
        got = _manifest(base)
        want = good.get("manifest") or {}
        mismatched = [k for k, v in want.items() if got.get(k) != v]
        ok = bool(want) and bool(got) and not mismatched  # the file-by-file comparison decides, not the exit code
        rows = None
        if restored_root:
            try:
                c = sqlite3.connect(restored_root)
                rows = c.execute("SELECT COUNT(*) FROM manifests").fetchone()[0]
                c.close()
            except sqlite3.Error:
                ok = False
        shutil.rmtree(target, ignore_errors=True)
        data = {"ok": ok, "snapshot": good["snapshot"], "files_checked": len(want), "mismatched": mismatched[:5],
                "db_rows": rows, "duration_s": round(time.time() - t0, 1), "restic_exit_code": code,
                "restic_warnings": "" if code == 0 else err.strip()[-300:], "error": "" if ok else (err.strip()[-300:] or "files differ")}
        store.log_event("restore_test", "Restic", f"Restore test of snapshot {good['snapshot']}: {'verified' if ok else 'FAILED'}", data)
        return data


def last_restore_test() -> dict | None:
    ev = store.events("restore_test", 1)
    return {**ev[0]["data"], "ts": ev[0]["ts"]} if ev else None


# ------------------------------------------------------------ demo controls and approved fixes

def fill_history(target_pct: float = 94.0, max_snapshots: int = 14) -> dict:
    """Stage use case 5: nightly snapshots kept with no retention policy until the backup volume is ~94% full."""
    if not on_backup_volume():
        raise RuntimeError("The backup volume W: is not mounted (run scripts\\create_demo_disks.ps1 as admin)")
    made = 0
    with _lock:
        ensure_repo()
        while volume().get("used_pct", 100) < target_pct and made < max_snapshots:
            if volume().get("free_mb", 0) < EXPORT_MB * 1.6:
                break
            _write_export()
            code, out, err = _restic(["backup", "--host", SERVER, "--tag", "nightly", "--quiet", str(SOURCE)], timeout=600)
            if code != 0:
                break
            made += 1
    v = volume()
    store.log_event("demo", "Demo control", f"Staged {made} older nightly snapshots without a retention policy; backup volume {v.get('used_pct')}% used",
                    {"snapshots_added": made, "volume": v})
    return {"snapshots_added": made, "volume": v}


def break_credential() -> dict:
    """Stage the credential failure: the job's credential file holds a superseded password."""
    ensure_repo()
    CRED_FILE.write_text("superseded-password-2026-q3", encoding="utf-8")
    store.log_event("demo", "Demo control", "Backup job credential file replaced with an outdated password")
    return {"ok": True}


def credential_in_sync() -> bool:
    try:
        return CRED_FILE.read_text(encoding="utf-8").strip() == _vault_password()
    except OSError:
        return False


def apply_retention(keep_last: int = 3) -> dict:
    t0 = time.time()
    before = volume()
    code, out, err = _restic(["forget", "--keep-last", str(keep_last), "--prune", "--host", SERVER], password_file=_vault_file(), timeout=900)
    after = volume()
    data = {"ok": code == 0, "keep_last": keep_last, "before_used_pct": before.get("used_pct"), "after_used_pct": after.get("used_pct"),
            "freed_mb": round((before.get("used_mb", 0) or 0) - (after.get("used_mb", 0) or 0), 1),
            "duration_s": round(time.time() - t0, 1), "error": "" if code == 0 else err.strip()[-400:]}
    store.log_event("backup", "Restic", f"Retention applied (keep last {keep_last}): {data['freed_mb']} MB freed", data)
    return data


def resync_credential() -> dict:
    JOB_DIR.mkdir(parents=True, exist_ok=True)
    CRED_FILE.write_text(_vault_password(), encoding="utf-8")
    store.log_event("backup", "Backup job", "Job credential re-synchronised from the vault")
    return {"ok": True}


def health() -> dict:
    if not config.RESTIC_EXE.exists():
        return {"ok": False, "detail": "restic.exe not installed"}
    code, out, err = _restic(["version"])
    if code != 0:
        return {"ok": False, "detail": err.strip()[:120]}
    v = volume()
    return {"ok": True, "detail": out.strip().split(" compiled")[0], "repo": v.get("path"),
            "on_backup_volume": on_backup_volume(), "used_pct": v.get("used_pct")}
