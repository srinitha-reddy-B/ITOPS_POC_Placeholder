"""The sign-in service itself (Keycloak on this machine): is it running, stop it (demo fault), start it (approved fix).

Use case 2 is an infrastructure problem: the single sign-on service stops on the identity server, so nobody can sign
in. The agents read this module's evidence (process, port, connection result, service log) to tell a stopped service
from a network problem or an account problem, and the approved fix starts it again through scripts/start_keycloak.ps1.
"""

import json
import socket
import subprocess
import time
from pathlib import Path

import httpx

from . import config, store

SCRIPT = config.BACKEND_DIR / "scripts" / "start_keycloak.ps1"
LOG = config.STACK_DIR / "logs" / "keycloak-service.log"
PORT = 8080
_NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _ps(cmd: str, timeout: int = 20) -> str:
    p = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd], capture_output=True, text=True,
                       timeout=timeout, creationflags=_NOWIN)
    return p.stdout.strip()


def processes() -> list[dict]:
    """Keycloak's Java processes (found by their command line, which points into the Keycloak install folder)."""
    out = _ps("Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" | Where-Object { $_.CommandLine -like '*crystal-clean-keycloak*' } "
              "| Select-Object ProcessId, CreationDate | ConvertTo-Json -Compress")
    if not out:
        return []
    rows = json.loads(out)
    rows = rows if isinstance(rows, list) else [rows]
    return [{"pid": r["ProcessId"], "started": str(r.get("CreationDate", ""))} for r in rows]


def connect() -> str:
    """How a TCP connection to the sign-in port ends: ok, refused (nothing listening) or timeout (path problem)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(5)  # Windows takes ~2 s to refuse a closed local port; only a real path problem runs out the clock
    try:
        s.connect(("127.0.0.1", PORT))
        return "ok"
    except ConnectionRefusedError:
        return "refused"
    except (socket.timeout, TimeoutError):
        return "timeout"
    except OSError as exc:
        return f"error: {exc.strerror or type(exc).__name__}"
    finally:
        s.close()


def responding() -> bool:
    try:
        r = httpx.get(f"{config.KEYCLOAK_URL}/realms/{config.KEYCLOAK_REALM}/.well-known/openid-configuration", timeout=3)
        return r.status_code == 200
    except httpx.HTTPError:
        return False


def state() -> dict:
    procs = processes()
    return {"responding": responding(), "connection": connect(), "processes": procs, "running": bool(procs)}


def log_tail(n: int = 12) -> list[str]:
    for f in (LOG, config.STACK_DIR / "logs" / "keycloak.log"):
        try:
            lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
            return [l[:220] for l in lines if l.strip()][-n:]
        except OSError:
            continue
    return []


def clean_shutdown_logged() -> bool:
    """Keycloak (Quarkus) writes 'stopped in' when it shuts down cleanly; a crash or kill leaves no such line."""
    return any("stopped in" in l.lower() for l in log_tail(6))


def stop(reason: str = "Demo control") -> dict:
    """Demo fault: the sign-in service process ends abruptly (as after a crash)."""
    procs = processes()
    for p in procs:
        _ps(f"Stop-Process -Id {int(p['pid'])} -Force -ErrorAction SilentlyContinue")
    time.sleep(2)
    store.log_event("demo", "Demo control", "Sign-in service (Keycloak) process stopped", {"pids": [p["pid"] for p in procs], "by": reason})
    return state()


def start(wait_s: float = 120) -> dict:
    """Start the sign-in service (hidden, detached, logging to keycloak-service.log) and wait until it answers."""
    if not responding():
        LOG.parent.mkdir(parents=True, exist_ok=True)
        log = open(LOG, "a", encoding="utf-8")
        log.close()
        # Started by Windows (WMI), hidden, not as a child of this backend: restarting or stopping the backend must not
        # take the sign-in service down with it.
        line = (f'cmd.exe /c powershell -NoProfile -ExecutionPolicy Bypass -File "{SCRIPT}" >> "{LOG}" 2>&1')
        _ps("$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}; "
            f"Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{{CommandLine='{line}'; "
            f"CurrentDirectory='{SCRIPT.parent.parent}'; ProcessStartupInformation=$si}} | Out-Null")
    t0 = time.time()
    while time.time() - t0 < wait_s:
        if responding():
            break
        time.sleep(2)
    return {**state(), "start_seconds": round(time.time() - t0)}
