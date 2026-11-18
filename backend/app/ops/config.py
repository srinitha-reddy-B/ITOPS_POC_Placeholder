"""Settings for the Crystal Clean Ops Console. Every value can be overridden with an environment variable."""

import os
import re
import tempfile
from pathlib import Path


def _env(key: str, default: str) -> str:
    return (os.getenv(key) or default).strip()


def _num(key: str, default: float) -> float:
    try:
        return float(os.getenv(key) or default)
    except ValueError:
        return default


BACKEND_DIR = Path(__file__).resolve().parents[2]
STACK_DIR = Path(_env("CC_OPS_STACK_DIR", str(Path.home() / "crystal-clean-keycloak" / "ops")))
BIN_DIR = STACK_DIR / "bin"
DATA_DIR = Path(_env("CC_OPS_DATA_DIR", str(Path(tempfile.gettempdir()) / "crystal-clean-ops")))
DB_PATH = BACKEND_DIR / ".cc_ops.sqlite3"

# Integration endpoints (127.0.0.1, not localhost: on Windows localhost tries IPv6 first and adds ~2 s)
PROMETHEUS_URL = _env("CC_PROMETHEUS_URL", "http://127.0.0.1:9090")
GRAFANA_URL = _env("CC_GRAFANA_URL", "http://127.0.0.1:3001")
WINDOWS_EXPORTER_URL = _env("CC_WINDOWS_EXPORTER_URL", "http://127.0.0.1:9182")
BLACKBOX_URL = _env("CC_BLACKBOX_URL", "http://127.0.0.1:9115")
TOXIPROXY_URL = _env("CC_TOXIPROXY_URL", "http://127.0.0.1:8474")
KEYCLOAK_URL = _env("KEYCLOAK_URL", "http://127.0.0.1:8080").replace("localhost", "127.0.0.1").rstrip("/")
KEYCLOAK_REALM = _env("KEYCLOAK_REALM", "crystal-clean")
KEYCLOAK_PUBLIC_URL = _env("CC_KEYCLOAK_PUBLIC_URL", "http://localhost:8080")  # what the browser uses
OIDC_CLIENT_ID = _env("CC_OPS_OIDC_CLIENT", "cc-ops-console")
RESTIC_EXE = Path(_env("CC_RESTIC_EXE", str(BIN_DIR / "restic.exe")))

# Use case 1: storage. The demo disk is a real virtual disk mounted as its own drive.
STORAGE_VOLUME = _env("CC_STORAGE_VOLUME", "V:")
STORAGE_SERVER = _env("CC_STORAGE_SERVER", "CC-APP-SRV-01")
STORAGE_WARN_PCT = _num("CC_STORAGE_WARN_PCT", 75)
STORAGE_CRIT_PCT = _num("CC_STORAGE_CRIT_PCT", 90)

# Use case 3: API. Thresholds for the RouteOps Dispatch API.
API_P95_WARN_MS = _num("CC_API_P95_WARN_MS", 800)
API_ERR_WARN_PCT = _num("CC_API_ERR_WARN_PCT", 5)
API_POOL_WARN_PCT = _num("CC_API_POOL_WARN_PCT", 80)

# Use case 4: network
NET_LATENCY_WARN_MS = _num("CC_NET_LATENCY_WARN_MS", 300)
NET_LOSS_WARN_PCT = _num("CC_NET_LOSS_WARN_PCT", 5)
BRANCH_PORT = int(_num("CC_BRANCH_SERVICES_PORT", 8091))

# Use case 5: backup
BACKUP_RPO_HOURS = _num("CC_BACKUP_RPO_HOURS", 24)
BACKUP_REPO_CAPACITY_MB = _num("CC_BACKUP_REPO_CAPACITY_MB", 64)

# Use case 2: identity
AUTH_FAIL_WARN = int(_num("CC_AUTH_FAIL_WARN", 3))          # failures for one user in the window
AUTH_MULTI_USER_WARN = int(_num("CC_AUTH_MULTI_USER_WARN", 3))  # distinct users failing = wider SSO problem
AUTH_WINDOW_MIN = _num("CC_AUTH_WINDOW_MIN", 15)

STEP_MIN_SECONDS = _num("CC_OPS_STEP_SECONDS", 1.2)

# Demo persona switch: the console offers a "Viewing as" dropdown (Employee / Manager / IT Admin) instead of the
# Keycloak sign-in page. Set CC_DEMO_PERSONAS=off to require Keycloak SSO again (the sign-in code is unchanged).
DEMO_PERSONAS = _env("CC_DEMO_PERSONAS", "on").lower() in ("1", "on", "true", "yes")  # paces each agent so the audience can follow


ENV_FILE = BACKEND_DIR / ".env"


def env_get_or_create(key: str, make) -> str:
    """Read a setting from the environment / backend/.env, creating and saving it once if missing (never printed)."""
    v = os.getenv(key, "").strip()
    if v:
        return v
    text = ENV_FILE.read_text(encoding="utf-8") if ENV_FILE.exists() else ""
    m = re.search(rf"^{key}=(.*)$", text, re.M)
    if m and m.group(1).strip():
        v = m.group(1).strip()
    else:
        v = make()
        ENV_FILE.write_text(text.rstrip("\n") + f"\n{key}={v}\n", encoding="utf-8")
    os.environ[key] = v
    return v
