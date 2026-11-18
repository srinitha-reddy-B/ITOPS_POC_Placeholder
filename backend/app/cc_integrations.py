"""Free third-party services the Service Hub uses to resolve problems for real.

ntfy (https://ntfy.sh, open source, no account)
    Push notifications to a phone or browser. The hub sends the employee a one-time code before an
    unlock, tells IT on-call when a fix needs approval, and tells people when it is fixed. Topics are
    random names kept in backend/.env (CC_NTFY_TOPIC_EMPLOYEE, CC_NTFY_TOPIC_IT); anyone who knows a
    topic can read it, so only fictional demo data is sent. CC_NTFY_URL can point at a self-hosted server.

MinIO (https://min.io, open source, S3-compatible object storage)
    The archive tier for regulated manifest scans. Files are uploaded with their SHA-256 in the object
    metadata, then read back and checked before the local copy is removed. The backend starts
    %USERPROFILE%\\crystal-clean-keycloak\\minio\\minio.exe on 127.0.0.1:9000 (console :9001) when the
    program is there; credentials are generated once into backend/.env. Without MinIO, archives go to a
    local archive folder and the UI says so.
"""

import hashlib
import os
import re
import secrets
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

_ENV = Path(__file__).resolve().parent.parent / ".env"


def _env_get_or_create(key: str, make) -> str:
    """Read a setting from the environment / backend/.env, creating and saving it once if missing."""
    v = os.getenv(key, "").strip()
    if v:
        return v
    text = _ENV.read_text(encoding="utf-8") if _ENV.exists() else ""
    m = re.search(rf"^{key}=(.*)$", text, re.M)
    if m and m.group(1).strip():
        v = m.group(1).strip()
    else:
        v = make()
        with open(_ENV, "a", encoding="utf-8") as f:
            f.write(f"\n{key}={v}\n")
    os.environ[key] = v
    return v


# ------------------------------------------------------------------ ntfy

NTFY_URL = os.getenv("CC_NTFY_URL", "https://ntfy.sh").rstrip("/")


def ntfy_topics() -> dict:
    return {"employee": _env_get_or_create("CC_NTFY_TOPIC_EMPLOYEE", lambda: f"cc-hub-marcus-{secrets.token_hex(5)}"),
            "it": _env_get_or_create("CC_NTFY_TOPIC_IT", lambda: f"cc-hub-it-oncall-{secrets.token_hex(5)}")}


def notify(to: str, title: str, message: str, tags: str = "", priority: int = 3) -> dict:
    """Send one push notification. Returns a record for the ticket's notification log (never raises)."""
    topic = ntfy_topics()[to]
    rec = {"at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "to": "Marcus Reed (phone)" if to == "employee" else "IT on-call (phone)",
           "channel": "ntfy push", "title": title, "message": message, "ok": False, "link": f"{NTFY_URL}/{topic}"}
    try:
        r = httpx.post(f"{NTFY_URL}/{topic}", content=message.encode("utf-8"), timeout=8,
                       headers={"Title": title.encode("utf-8").decode("latin-1", "replace"), "Tags": tags, "Priority": str(priority)})
        rec["ok"] = r.status_code == 200
        if not rec["ok"]:
            rec["error"] = f"HTTP {r.status_code}"
    except httpx.HTTPError as exc:
        rec["error"] = type(exc).__name__
    return rec


def ntfy_status() -> dict:
    try:
        ok = httpx.get(f"{NTFY_URL}/v1/health", timeout=4).status_code == 200
    except httpx.HTTPError:
        ok = False
    return {"ok": ok, "url": NTFY_URL, "topics": ntfy_topics()}


# ----------------------------------------------------------------- MinIO

MINIO_EXE = Path(os.getenv("CC_MINIO_EXE") or Path.home() / "crystal-clean-keycloak" / "minio" / "minio.exe")
MINIO_DATA = MINIO_EXE.parent / "data"
MINIO_ENDPOINT = os.getenv("CC_MINIO_ENDPOINT", "127.0.0.1:9000")
MINIO_CONSOLE = "http://127.0.0.1:9001"
BUCKET = "ind-fs01-manifest-archive"
_minio_proc: subprocess.Popen | None = None


def _minio_creds() -> tuple[str, str]:
    return (_env_get_or_create("CC_MINIO_ROOT_USER", lambda: "cc-archive-admin"),
            _env_get_or_create("CC_MINIO_ROOT_PASSWORD", lambda: secrets.token_urlsafe(18)))


def _minio_up() -> bool:
    try:
        return httpx.get(f"http://{MINIO_ENDPOINT}/minio/health/live", timeout=2).status_code == 200
    except httpx.HTTPError:
        return False


def minio_start() -> bool:
    """Start the MinIO server if the program is installed and nothing answers yet."""
    global _minio_proc
    if _minio_up():
        return True
    if not MINIO_EXE.exists():
        return False
    user, pw = _minio_creds()
    MINIO_DATA.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "MINIO_ROOT_USER": user, "MINIO_ROOT_PASSWORD": pw}
    _minio_proc = subprocess.Popen([str(MINIO_EXE), "server", str(MINIO_DATA), "--address", MINIO_ENDPOINT, "--console-address", ":9001"],
                                   env=env, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        if _minio_up():
            return True
        time.sleep(0.25)
    return False


def _client():
    from minio import Minio  # imported lazily: only needed when MinIO is installed
    user, pw = _minio_creds()
    c = Minio(MINIO_ENDPOINT, access_key=user, secret_key=pw, secure=False)
    if not c.bucket_exists(BUCKET):
        c.make_bucket(BUCKET)
    return c


def archive_status() -> dict:
    if minio_start():
        try:
            objs = list(_client().list_objects(BUCKET, recursive=True))
            return {"kind": "minio", "ok": True, "label": f"MinIO (S3) bucket {BUCKET}", "objects": len(objs),
                    "size_mb": round(sum(o.size for o in objs) / 1048576, 1), "console": MINIO_CONSOLE}
        except Exception as exc:  # noqa: BLE001
            return {"kind": "minio", "ok": False, "label": "MinIO", "error": f"{type(exc).__name__}: {str(exc)[:120]}"}
    return {"kind": "folder", "ok": False, "label": "Local archive folder (MinIO not installed)",
            "hint": f"Put minio.exe in {MINIO_EXE.parent} to archive to S3-compatible storage."}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def archive_files(files: list[Path], base: Path, folder_fallback: Path, category: str) -> dict:
    """Archive files and verify each copy before the original is removed. Returns a receipt."""
    receipt = {"target": None, "objects": 0, "bytes": 0, "verified": 0, "failed": [], "sample": []}
    use_minio = minio_start()
    client = _client() if use_minio else None
    receipt["target"] = f"MinIO (S3) bucket {BUCKET}" if use_minio else f"Local archive folder {folder_fallback}"
    for f in files:
        digest, size = sha256(f), f.stat().st_size
        key = f"BR-IND-FS01/D/{f.relative_to(base).as_posix()}"
        try:
            if client:
                client.fput_object(BUCKET, key, str(f), metadata={"sha256": digest, "category": category, "retention": "regulated-7y"})
                st = client.stat_object(BUCKET, key)
                ok = st.size == size and (st.metadata.get("x-amz-meta-sha256") or st.metadata.get("X-Amz-Meta-Sha256")) == digest
            else:
                dest = folder_fallback / key
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(f.read_bytes())
                ok = sha256(dest) == digest
        except Exception as exc:  # noqa: BLE001 -- keep the original when the copy can't be verified
            ok = False
            receipt["failed"].append(f"{f.name}: {type(exc).__name__}")
        if ok:
            f.unlink()
            receipt["objects"] += 1
            receipt["verified"] += 1
            receipt["bytes"] += size
            if len(receipt["sample"]) < 3:
                receipt["sample"].append({"key": key, "sha256": digest[:16] + "…"})
        elif not receipt["failed"] or not receipt["failed"][-1].startswith(f.name):
            receipt["failed"].append(f"{f.name}: copy did not verify, original kept")
    receipt["console"] = MINIO_CONSOLE if use_minio else None
    return receipt
