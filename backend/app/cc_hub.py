"""Crystal Clean Service Hub: the employee front door and the IT pipeline behind it.

One employee (Marcus Reed, Field Service Representative, Indianapolis branch) has three real
problems in a working day. Each is solved on a real system and shown with real evidence:

  account_locked  Locked out after a password change: his RouteOps handheld kept signing in with
                  the old password and Keycloak's brute-force protection locked the account.
                  Evidence: the real sign-in attempts and the password-change event.
                  Fix: unlock, sign out stale device sessions. Self-service policy: no approval.
  app_down        RouteOps won't load routes: the nightly manifest-export job leaks DB
                  connections in the RouteOps Dispatch API (a real local service, see
                  cc_routeops.py) until the pool is exhausted and every request returns 503.
                  Evidence: health-check history, pool usage, the service log.
                  Fix: restart the service with the export job paused. A restart affects every
                  driver, so IT must approve it first.
  storage_full    Scanned manifests won't save: the branch scan server volume is full.
                  Evidence: usage by folder and the growth trend. Fix: clear temp files and old
                  logs, archive (never delete) scans older than 90 days. Self-service policy.

Anything else goes through the same pipeline and is handed to the Service Desk.

Pipeline (sequential, one ServiceNow work note per stage):
  Intake → ServiceNow → Context → Hypothesis → Critic → Judge → IT approval (when needed)
  → Remediation → Verification → RCA Writer

The AI agents (Cohere) can only make a decision more cautious: policy guardrails in code decide
whether an automated fix is allowed, and a challenge blocks the fix only if both the Critic and
the Judge back it with a value that is really in the evidence.

Caller identity: the demo has no sign-in screen, so the employee comes from X-CC-User and the
IT view needs X-CC-Role: it. In production both come from the SSO token.
"""

import json
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from . import cc_routeops as ro
from . import itops_servicenow as snow
from . import llm
from . import p32_metrics as metrics
from . import platform_connect as pc

_STATE_FILE = Path(__file__).parent.parent / ".cc_hub_state.json"
_LOCK = threading.RLock()
TAG = "CC-HUB:"
CHANNEL = "Crystal Clean Service Hub"
_STEP_MIN_S = float(os.getenv("CC_STEP_MIN_SECONDS", "3"))  # paces each stage so people can follow it
_LLM_TIMEOUT = float(os.getenv("CC_AGENT_TIMEOUT", "30"))
_AGENT_MODEL = os.getenv("CC_AGENT_MODEL") or "command-a-03-2025"  # command-r7b could not critique reliably
CONFIDENCE_MIN = 0.7
LOCK_AFTER = 5
HANDHELD_IP = os.getenv("CC_HANDHELD_IP", "10.42.7.23")  # branch Wi-Fi address the handheld signs in from
IT_APPROVER = "Mark Wood (IT Administrator)"


class Forbidden(Exception):
    pass


EMPLOYEES = {
    "marcus": {"id": "CC-1042", "name": "Marcus Reed", "first": "Marcus", "initials": "MR",
               "title": "Field Service Representative", "site": "Indianapolis, IN branch",
               "login": os.getenv("CC_LOGIN_MARCUS", "marcus.reed")},
}


def employee(key: str | None) -> dict:
    emp = EMPLOYEES.get((key or "marcus").strip().lower())
    if not emp:
        raise Forbidden("Unknown employee.")
    return {**emp, "key": (key or "marcus").strip().lower()}


def require_it(role: str | None) -> None:
    if (role or "").strip().lower() != "it":
        raise Forbidden("The IT view needs the IT role.")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(d: datetime | None = None) -> str:
    return (d or _now()).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


# ------------------------------------------------------------------ state


def _blank_state() -> dict:
    return {"runs": {}, "hidden_sys_ids": [], "disk_samples": [], "dismissed": [],
            "directory": {e["login"]: {"status": "ACTIVE", "failed": [], "pw_changed_at": None} for e in EMPLOYEES.values()}}


def _load() -> dict:
    try:
        data = json.loads(_STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _blank_state()
    if not all("pipeline" in r and any(s["key"] == "approval" for s in r["pipeline"]) for r in data.get("runs", {}).values()):
        data["runs"] = {}  # runs from an earlier format
    for r in data["runs"].values():  # a backend restart interrupts runs that were in flight
        if r["outcome"] is None:
            r.update(outcome="handover", awaiting=False, employee_message="This one needs a technician. Our team has your ticket and will contact you.")
    data["directory"] = {e["login"]: {"status": "ACTIVE", "failed": [], "pw_changed_at": None} for e in EMPLOYEES.values()} \
        if any(isinstance(x, str) for u in data.get("directory", {}).values() for x in u.get("failed", [])) else data.get("directory", {})
    return {**_blank_state(), **data}


_S = _load()


def _save() -> None:
    try:
        _STATE_FILE.write_text(json.dumps(_S, indent=1), encoding="utf-8")
    except OSError:
        pass


# ------------------------------------------------------------- identity

APP_NAMES = {"routeops-mobile": "RouteOps Mobile (handheld)", "account-console": "Account console", "admin-cli": "Admin tools",
             "security-admin-console": "Admin console"}
REASONS = {"invalid_user_credentials": "Wrong password", "user_temporarily_disabled": "Account locked", "user_disabled": "Account locked",
           "user_not_found": "Unknown user"}


def _attempt_summary(attempts: list[dict], pw_changed_at: str | None) -> dict:
    failed = [a for a in attempts if a["result"] == "Failed"]
    after = [a for a in failed if pw_changed_at and a["at"] >= pw_changed_at]
    apps = sorted({a["app"] for a in failed})
    return {"failed_attempts": len(failed), "failed_after_password_change": len(after), "failing_apps": apps,
            "failing_ips": sorted({a["ip"] for a in failed if a.get("ip")}),
            "first_failure": failed[0]["at"] if failed else None, "last_failure": failed[-1]["at"] if failed else None}


class DemoDirectory:
    """Local stand-in used only when neither Keycloak nor Okta is configured."""
    name = "Demo directory"
    live = False

    def _u(self, login: str) -> dict:
        return _S["directory"].setdefault(login, {"status": "ACTIVE", "failed": [], "pw_changed_at": None})

    def user(self, login: str) -> dict:
        u = self._u(login)
        since = _iso(_now() - timedelta(hours=1))
        recent = [f for f in u["failed"] if f["at"] > since]
        return {"login": login, "status": u["status"], "failed_1h": len(recent), "sources": len({f["ip"] for f in recent})}

    def attempts(self, login: str) -> list[dict]:
        return [{"at": f["at"], "app": f["app"], "ip": f["ip"], "result": "Failed", "reason": "Wrong password"} for f in self._u(login)["failed"]]

    def password_changed_at(self, login: str) -> str | None:
        return self._u(login).get("pw_changed_at")

    def locked_others(self, login: str) -> int:
        return sum(1 for k, u in _S["directory"].items() if k != login and u["status"] == "LOCKED_OUT")

    def unlock(self, login: str) -> None:
        with _LOCK:
            self._u(login).update(status="ACTIVE")
            _save()

    def logout(self, login: str) -> None:
        pass

    def stage_lockout(self, login: str) -> str:
        with _LOCK:
            u = self._u(login)
            u.update(pw_changed_at=_iso(_now() - timedelta(minutes=7)), failed=[], status="LOCKED_OUT")
            for i in range(LOCK_AFTER):
                u["failed"].append({"at": _iso(_now() - timedelta(minutes=6 - i)), "ip": HANDHELD_IP, "app": APP_NAMES["routeops-mobile"]})
            _save()
        return f"{login}: password changed, then {LOCK_AFTER} failed sign-ins with the old password from the handheld; account locked."


class OktaDirectory:
    """Okta Users and System Log APIs with an SSWS API token (server side only). Not yet tested against a real org."""
    name = "Okta"
    live = True

    def __init__(self, org: str, token: str):
        self.org = org.rstrip("/")
        self.h = {"Authorization": f"SSWS {token}", "Accept": "application/json", "Content-Type": "application/json"}

    def _req(self, method: str, path: str, **kw):
        r = httpx.request(method, f"{self.org}{path}", headers=self.h, timeout=20, **kw)
        r.raise_for_status()
        return r.json() if r.content else None

    def _id(self, login: str) -> str:
        return self._req("GET", f"/api/v1/users/{login}")["id"]

    def _fail_logs(self, login: str) -> list:
        since = _iso(_now() - timedelta(hours=2))
        flt = f'eventType eq "user.session.start" and outcome.result eq "FAILURE" and actor.alternateId eq "{login}"'
        return self._req("GET", "/api/v1/logs", params={"since": since, "filter": flt, "limit": 100}) or []

    def user(self, login: str) -> dict:
        u = self._req("GET", f"/api/v1/users/{login}")
        logs = self._fail_logs(u["profile"]["login"])
        return {"login": login, "status": u["status"], "failed_1h": len(logs),
                "sources": len({(e.get("client") or {}).get("ipAddress") for e in logs} - {None})}

    def attempts(self, login: str) -> list[dict]:
        return sorted(({"at": e["published"][:19] + "Z", "app": ((e.get("client") or {}).get("userAgent") or {}).get("rawUserAgent", "Okta sign-in")[:40],
                        "ip": (e.get("client") or {}).get("ipAddress"), "result": "Failed", "reason": (e.get("outcome") or {}).get("reason") or "Failed"}
                       for e in self._fail_logs(login)), key=lambda a: a["at"])

    def password_changed_at(self, login: str) -> str | None:
        return None

    def locked_others(self, login: str) -> int:
        rows = self._req("GET", "/api/v1/users", params={"search": 'status eq "LOCKED_OUT"', "limit": 200}) or []
        return sum(1 for u in rows if u["profile"]["login"].lower() != login.lower())

    def unlock(self, login: str) -> None:
        self._req("POST", f"/api/v1/users/{self._id(login)}/lifecycle/unlock")

    def logout(self, login: str) -> None:
        self._req("DELETE", f"/api/v1/users/{self._id(login)}/sessions")

    def stage_lockout(self, login: str) -> str:
        return (f"Okta has no API to lock an account. Sign in at {self.org} as {login} with a wrong password "
                f"{LOCK_AFTER} times (Okta's lockout policy then locks it for real).")


class KeycloakDirectory:
    """Keycloak Admin REST API, signed in as a dedicated realm user with user-management roles.

    Keycloak 26.8 rejects service-account (client_credentials) tokens on the admin API, user tokens work.
    Lockout is Keycloak's own brute-force detection (5 failures, permanent until unlocked). Attempts come
    from the realm's LOGIN / LOGIN_ERROR events; the password change from its admin events.
    """
    name = "Keycloak"
    live = True
    _token: tuple[str, float] = ("", 0.0)

    def __init__(self, url: str, realm: str, user: str, password: str):
        self.url, self.realm, self.svc_user, self.svc_password = url.rstrip("/"), realm, user, password
        self.admin = f"{self.url}/admin/realms/{realm}"

    def _bearer(self) -> str:
        tok, exp = KeycloakDirectory._token
        if not tok or time.time() > exp:
            r = httpx.post(f"{self.url}/realms/{self.realm}/protocol/openid-connect/token", timeout=15,
                           data={"grant_type": "password", "client_id": "admin-cli", "username": self.svc_user, "password": self.svc_password})
            r.raise_for_status()
            j = r.json()
            KeycloakDirectory._token = (j["access_token"], time.time() + int(j.get("expires_in", 60)) - 15)
        return KeycloakDirectory._token[0]

    def _req(self, method: str, path: str, **kw):
        r = httpx.request(method, f"{self.admin}{path}", headers={"Authorization": f"Bearer {self._bearer()}"}, timeout=15, **kw)
        r.raise_for_status()
        return r.json() if r.content else None

    def _user(self, login: str) -> dict:
        rows = self._req("GET", "/users", params={"username": login, "exact": "true"}) or []
        if not rows:
            raise ValueError(f"Keycloak user '{login}' not found in realm '{self.realm}'")
        return rows[0]

    def _locked(self, u: dict) -> tuple[bool, dict]:
        bf = self._req("GET", f"/attack-detection/brute-force/users/{u['id']}") or {}
        return bool(bf.get("disabled")) or not u.get("enabled", True), bf

    def _events(self, uid: str, hours: float = 2) -> list[dict]:
        since = int((_now() - timedelta(hours=hours)).timestamp() * 1000)
        ev = self._req("GET", "/events", params={"user": uid, "max": 100}) or []
        return [e for e in ev if e.get("type") in ("LOGIN", "LOGIN_ERROR") and int(e.get("time", 0)) >= since]

    def user(self, login: str) -> dict:
        u = self._user(login)
        locked, bf = self._locked(u)
        fails = [e for e in self._events(u["id"], 1) if e["type"] == "LOGIN_ERROR"]
        return {"login": login, "status": "LOCKED_OUT" if locked else "ACTIVE",
                "failed_1h": int(bf.get("numFailures", 0)) or (len(fails) if locked else 0),
                "sources": len({e.get("ipAddress") for e in fails} - {None})}

    def attempts(self, login: str) -> list[dict]:
        u = self._user(login)
        out = [{"at": _iso(datetime.fromtimestamp(int(e["time"]) / 1000, timezone.utc)), "app": APP_NAMES.get(e.get("clientId"), e.get("clientId") or "?"),
                "ip": e.get("ipAddress"), "result": "Success" if e["type"] == "LOGIN" else "Failed",
                "reason": "" if e["type"] == "LOGIN" else REASONS.get(e.get("error"), e.get("error") or "")} for e in self._events(u["id"])]
        return sorted(out, key=lambda a: a["at"])

    def password_changed_at(self, login: str) -> str | None:
        try:
            u = self._user(login)
            ev = self._req("GET", "/admin-events", params={"resourcePath": f"users/{u['id']}/reset-password", "max": 5}) or []
            t = max((int(e["time"]) for e in ev), default=0)
            return _iso(datetime.fromtimestamp(t / 1000, timezone.utc)) if t else None
        except httpx.HTTPError:
            return None

    def locked_others(self, login: str) -> int:
        n = 0
        for u in self._req("GET", "/users", params={"max": 200, "briefRepresentation": "true"}) or []:
            if u.get("username") not in (login, self.svc_user) and self._locked(u)[0]:
                n += 1
        return n

    def unlock(self, login: str) -> None:
        u = self._user(login)
        self._req("DELETE", f"/attack-detection/brute-force/users/{u['id']}")
        if not u.get("enabled", True):
            self._req("PUT", f"/users/{u['id']}", json={"enabled": True})

    def logout(self, login: str) -> None:
        self._req("POST", f"/users/{self._user(login)['id']}/logout")

    def stage_lockout(self, login: str) -> str:
        """The real sequence: the password is changed, then the handheld keeps signing in with the old one."""
        u = self._user(login)
        self._req("DELETE", f"/attack-detection/brute-force/users/{u['id']}")
        new = os.getenv("CC_DEMO_USER_PASSWORD") or f"Demo-{uuid.uuid4().hex[:10]}"
        self._req("PUT", f"/users/{u['id']}/reset-password", json={"type": "password", "value": new, "temporary": False})
        time.sleep(2)
        for _ in range(LOCK_AFTER):
            httpx.post(f"{self.url}/realms/{self.realm}/protocol/openid-connect/token", timeout=15,
                       headers={"X-Forwarded-For": HANDHELD_IP},  # used when Keycloak runs with --proxy-headers xforwarded
                       data={"grant_type": "password", "client_id": "routeops-mobile", "username": login, "password": "the-old-password"})
            time.sleep(1.1)  # outside Keycloak's quick-login window, so each attempt counts normally
        return f"{login}: password changed, then {LOCK_AFTER} real sign-ins with the old password from RouteOps Mobile; Keycloak locked the account."


def directory():
    org, token = os.getenv("OKTA_ORG_URL", "").strip(), os.getenv("OKTA_API_TOKEN", "").strip()
    if org and token:
        return OktaDirectory(org, token)
    kc = {k: os.getenv(f"KEYCLOAK_{k}", "").strip() for k in ("URL", "REALM", "SERVICE_USER", "SERVICE_PASSWORD")}
    if all(kc.values()):
        return KeycloakDirectory(kc["URL"], kc["REALM"], kc["SERVICE_USER"], kc["SERVICE_PASSWORD"])
    return DemoDirectory()


# ---------------------------------------------------------- branch server

SERVER = {"name": "BR-IND-FS01", "volume": "D: Scans", "site": "Indianapolis, IN branch", "capacity_mb": 250}
_SANDBOX = Path(os.getenv("CC_SANDBOX_DIR") or Path(tempfile.gettempdir()) / "crystal-clean-hub")
_VOL = _SANDBOX / SERVER["name"] / "D"
_ARCHIVE = _SANDBOX / "archive-tier" / SERVER["name"]
_MB = 1024 * 1024


def _size(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0


def disk() -> dict:
    cap = SERVER["capacity_mb"] * _MB
    used = _size(_VOL)
    parts = {"Manifest scans": _size(_VOL / "ManifestScans") - _size(_VOL / "ManifestScans" / "Older"),
             "Manifest scans > 90 days": _size(_VOL / "ManifestScans" / "Older"),
             "Scanner temp files": _size(_VOL / "ScanStaging"), "Service logs": _size(_VOL / "Logs")}
    return {**SERVER, "used_mb": round(used / _MB, 1), "free_mb": round((cap - used) / _MB, 1),
            "pct": round(100 * used / cap, 1), "parts_mb": {k: round(v / _MB, 1) for k, v in parts.items()}}


def _write(path: Path, mb: float, age_days: float) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.truncate(int(mb * _MB))
    t = (_now() - timedelta(days=age_days)).timestamp()
    os.utime(path, (t, t))


def _sample() -> None:
    with _LOCK:
        _S["disk_samples"].append({"at": _iso(), "pct": disk()["pct"]})
        _S["disk_samples"] = _S["disk_samples"][-200:]
        _save()


def _baseline() -> None:
    shutil.rmtree(_VOL, ignore_errors=True)
    for i in range(30):
        _write(_VOL / "ManifestScans" / f"MAN-IND-{i + 1:05d}.pdf", 2.0, i * 2)
    _write(_VOL / "Logs" / "scansvc-current.log", 20, 0)
    with _LOCK:
        _S["disk_samples"] = []
        _save()
    _sample()


if not _VOL.exists():
    _baseline()


def fill_disk(target_pct: float = 96.0) -> str:
    """Demo control: the scan volume fills the way it does in a branch (scanner temp files and verbose logs pile up)."""
    shutil.rmtree(_VOL, ignore_errors=True)
    total = SERVER["capacity_mb"] * target_pct / 100
    plan = [("ManifestScans", 0.24, 30, "MAN-IND-{:05d}.pdf", 1, 60),
            ("ManifestScans/Older", 0.20, 25, "MAN-IND-{:05d}.pdf", 95, 400),
            ("ScanStaging", 0.18, 45, "scan_{:05d}.tmp", 8, 40),
            ("Logs", 0.35, 70, "scansvc-{:05d}.log", 15, 120),
            ("Logs", 0.03, 5, "scansvc-current-{:05d}.log", 0, 4)]
    n = 10000
    for folder, share, count, pattern, age_lo, age_hi in plan:
        for i in range(count):
            n += 1
            _write(_VOL / folder / pattern.format(n), total * share / count, age_lo + (age_hi - age_lo) * i / max(count - 1, 1))
    now_pct = disk()["pct"]
    with _LOCK:  # growth over the last three days, as the branch saw it (scenario history)
        _S["disk_samples"] = [{"at": _iso(_now() - timedelta(hours=h)), "pct": round(now_pct - h * 0.33, 1), "scenario": True}
                              for h in (72, 60, 48, 36, 24, 12)]
        _save()
    _sample()
    return f"{SERVER['name']} {SERVER['volume']} filled to {disk()['pct']}%."


def forecast() -> dict | None:
    pts = [(_parse(s["at"]).timestamp() / 3600, s["pct"]) for s in _S["disk_samples"]][-12:]
    if len(pts) < 3:
        return None
    mx, my = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    den = sum((x - mx) ** 2 for x, _ in pts)
    slope = sum((x - mx) * (y - my) for x, y in pts) / den if den else 0
    pct = disk()["pct"]
    if slope <= 0.01:
        return {"pct": pct, "hours_to_full": None, "growth_per_day": round(slope * 24, 1)}
    return {"pct": pct, "hours_to_full": round(max(0.0, (100 - pct) / slope), 1), "growth_per_day": round(slope * 24, 1)}


_CLEANUP = [
    ("ScanStaging", "*.tmp", 7, False, "Remove stuck scanner temp files older than 7 days"),
    ("Logs", "scansvc-*.log", 14, False, "Rotate scan-service logs older than 14 days"),
    ("ManifestScans/Older", "*.pdf", 90, True, "Move manifest scans older than 90 days to the archive tier (kept, not deleted)"),
]
_RECLAIM_LABEL = ["scanner temp files older than 7 days (delete)", "service logs older than 14 days (delete)",
                  "manifest scans older than 90 days (move to archive tier)"]


def _reclaimable() -> dict:
    now, out = _now().timestamp(), {}
    for (folder, pattern, days, _, _), label in zip(_CLEANUP, _RECLAIM_LABEL):
        out[label] = round(sum(f.stat().st_size for f in (_VOL / folder).glob(pattern)
                               if f.is_file() and now - f.stat().st_mtime > days * 86400) / _MB, 1)
    return out


def _clean_disk() -> list[dict]:
    now, out = _now().timestamp(), []
    for folder, pattern, days, archive, label in _CLEANUP:
        freed = files = 0
        for f in sorted((_VOL / folder).glob(pattern)):
            if f.is_file() and now - f.stat().st_mtime > days * 86400:
                freed += f.stat().st_size
                files += 1
                if archive:
                    _ARCHIVE.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(f), str(_ARCHIVE / f.name))
                else:
                    f.unlink()
        out.append({"action": label, "files": files, "freed_mb": round(freed / _MB, 1)})
    return out


def _scan_test() -> bool:
    d = disk()
    if d["free_mb"] < 2 or d["pct"] > 90:
        return False
    p = _VOL / "ManifestScans" / "_hub_scan_test.pdf"
    _write(p, 2, 0)
    ok = p.exists()
    p.unlink(missing_ok=True)
    return ok


# ------------------------------------------------------------ ServiceNow


def _sn_on() -> bool:
    try:
        snow._creds()
        return True
    except snow.NotConfigured:
        return False


def _sn_get(table: str, query: str, fields: str, limit: int) -> list[dict]:
    c = snow._creds()
    r = httpx.get(f"{c['instance_url']}/api/now/table/{table}", params={
        "sysparm_query": query, "sysparm_fields": fields, "sysparm_display_value": "true", "sysparm_limit": limit,
    }, auth=snow._auth(c), headers={"Accept": "application/json"}, timeout=snow._TIMEOUT)
    r.raise_for_status()
    d = lambda v: v.get("display_value", "") if isinstance(v, dict) else (v or "")  # noqa: E731
    return [{k: d(row.get(k)) for k in fields.split(",")} for row in pc._safe_json(r, "servicenow").get("result", [])]


def _sn_list() -> list[dict]:
    return _sn_get("incident", f"correlation_idSTARTSWITH{TAG}^ORDERBYDESCsys_created_on",
                   "sys_id,number,short_description,state,priority,correlation_id,opened_at,resolved_at", 50)


def _sn_url(sys_id: str) -> str:
    try:
        return snow._record_url(snow._creds(), "incident", sys_id)
    except snow.NotConfigured:
        return ""


def _similar(words: list[str], exclude: str | None) -> list[dict]:
    if not _sn_on() or not words:
        return []
    q = "^OR".join(f"short_descriptionLIKE{w}" for w in words) + "^stateIN6,7" + (f"^sys_id!={exclude}" if exclude else "") + "^ORDERBYDESCsys_updated_on"
    try:
        rows = _sn_get("incident", q, "sys_id,number,short_description,close_notes", 3)
    except Exception:  # noqa: BLE001 -- context is best effort
        return []
    return [{"number": r["number"], "short_description": r["short_description"], "url": _sn_url(r["sys_id"]),
             "close_notes": (r["close_notes"] or "")[:160]} for r in rows]


# --------------------------------------------------------- AI agent calls


def _llm_json(agent: str, prompt: str, run: dict) -> tuple[dict | None, str, str]:
    if not llm.llm_available():
        return None, "rules", "No LLM configured"
    t0, usage, err, out = time.time(), {"input_tokens": None, "output_tokens": None}, "", None
    try:
        resp = llm._cohere_client().chat(
            model=_AGENT_MODEL, temperature=0, response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}], request_options={"timeout_in_seconds": _LLM_TIMEOUT})
        billed = getattr(getattr(resp, "usage", None), "billed_units", None)
        if billed is not None:
            usage = {"input_tokens": int(billed.input_tokens or 0), "output_tokens": int(billed.output_tokens or 0)}
        raw = next(i.text for i in resp.message.content if getattr(i, "text", None)).strip()
        out = json.loads(re.sub(r"^```(json)?|```$", "", raw, flags=re.MULTILINE).strip())
    except Exception as exc:  # network, auth, quota, timeout, bad JSON
        err = f"{type(exc).__name__}: {str(exc)[:160]}"
    metrics.record_usage({"at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ"), "agent": f"Service Hub {agent}",
                          "model": _AGENT_MODEL, "incident": run.get("number") or "", "kind": "service_hub", "employee": run["emp_id"],
                          "ok": out is not None, "error": err[:200], "duration_ms": int((time.time() - t0) * 1000), **usage})
    return (out, "ai", "") if isinstance(out, dict) else (None, "rules", err or "invalid output")


_GROUND = "Use only the evidence given. Never invent systems, hostnames, numbers, people or commands. Reply with JSON only."


def _flat(d: dict, prefix: str = "") -> dict:
    out = {}
    for k, v in d.items():
        out[f"{prefix}{k}"] = v
        out.setdefault(k, v)
        if isinstance(v, dict):
            for kk, vv in _flat(v, f"{prefix}{k}.").items():
                out.setdefault(kk, vv)
    return out


def _grounded(ev: dict, key, value) -> bool:
    """True if `key` is an evidence field and `value` matches what the evidence really holds."""
    if not isinstance(key, str) or key.startswith("similar"):
        return False  # past incidents are context, not proof about this system
    flat = _flat(ev)
    if key not in flat:
        return False
    real, claim = flat[key], str(value).strip().lower().strip("'\"")
    if isinstance(real, bool):
        return claim in ("true", "yes") if real else claim in ("false", "no")
    if isinstance(real, (int, float)):
        try:
            return abs(float(claim.split()[0].rstrip("%")) - float(real)) < 0.51
        except (ValueError, IndexError):
            return False
    text = json.dumps(real).lower() if not isinstance(real, str) else real.lower()
    return bool(claim) and (claim in text or text in claim)


def _conf(v, default: float) -> float:
    try:
        return round(min(1.0, max(0.0, float(v))), 2)
    except (TypeError, ValueError):
        return round(default, 2)


# --------------------------------------------------------- understanding

USE_CASES = {
    "account_locked": {"title": "Locked out", "category": "inquiry", "group": "Service Desk", "similar": ["locked", "lockout", "unlock"]},
    "app_down": {"title": "RouteOps not loading", "category": "software", "group": "Application Support",
                 "similar": ["not loading", "503", "service down", "outage"]},
    "storage_full": {"title": "Scans won't save", "category": "hardware", "group": "Infrastructure",
                     "similar": ["disk full", "disk space", "out of space", "storage full"]},
    "other_issue": {"title": "IT issue", "category": "inquiry", "group": "Service Desk", "similar": []},
}

_INTAKE = """You are the Intake Agent of Crystal Clean's IT Service Hub. Crystal Clean is an environmental services
company (parts cleaning, used oil collection and re-refining, waste and vacuum services, about 130 branches).
Drivers use the RouteOps Mobile app on handhelds to get their daily route; branches scan waste manifests to a branch server.
Classify the employee's message. JSON only:
{{"intent": "account_locked" | "app_down" | "storage_full" | "other_issue" | "status" | "question" | "greeting",
  "summary": "a ServiceNow short description, max 80 characters (empty for question/greeting/status)",
  "answer": "for question/greeting only: a helpful answer in at most 3 short sentences, else empty"}}

- account_locked: cannot sign in, account locked, too many attempts, password not accepted, locked out of handheld/laptop
- app_down: an app or system won't load, is down, errors or is very slow (RouteOps, routes, dispatch, stops won't load)
- storage_full: scans or files won't save to the branch share/server, disk or drive full, out of space, manifests not uploading
- other_issue: anything else that is broken or needs IT (hardware damage, printer, email, VPN failure...)
- status: asks about their ticket or request
- question: a how-to or policy question
Message: {text}"""

_RULES = [
    ("account_locked", r"lock|can'?t (log|sign)|cannot (log|sign)|unable to (log|sign)|password (is )?(not|isn'?t|doesn'?t|won'?t)|not accept"),
    ("app_down", r"route ?ops|routeops|route list|my route|won'?t load|not loading|isn'?t loading|\bdown\b|503|time ?out|spinning|very slow"),
    ("storage_full", r"disk|storage|space|full|scan|manifest|share|drive"),
    ("status", r"status|update on|my (ticket|request)|any news"),
    ("greeting", r"^\s*(hi|hello|hey|good (morning|afternoon))\b"),
]


def _rules(text: str) -> dict:
    t = text.lower()
    for intent, pat in _RULES:
        if re.search(pat, t):
            return {"intent": intent, "summary": text[:80], "answer": ""}
    broken = re.search(r"not working|broken|broke|error|fail|can'?t|cannot|won'?t|issue|problem|damage|crack", t)
    return {"intent": "other_issue" if broken else "question", "summary": text[:80], "answer": ""}


def understand(text: str, emp: dict) -> dict:
    t0 = time.time()
    out, engine, err = _llm_json("Intake Agent", _INTAKE.format(text=json.dumps(text)), {"emp_id": emp["id"]})
    if out and out.get("intent") in (*USE_CASES, "status", "question", "greeting"):
        res = {"intent": out["intent"], "summary": str(out.get("summary") or text)[:80], "answer": str(out.get("answer") or ""), "engine": "ai"}
    else:
        res = {**_rules(text), "engine": "rules", "fallback_reason": err or "unrecognised intent"}
    res["ms"] = int((time.time() - t0) * 1000)
    return res


_FAQ = {
    "vpn": "Open the VPN app on your laptop and sign in with your Crystal Clean account. If it doesn't connect, tell me and I'll raise it.",
    "password": "You can change your password from the sign-in page with 'Forgot password'. Remember to update it on your route handheld too.",
    "printer": "Most branch printers show up under 'Branch-Printer'. If yours is missing or jammed, tell me and I'll raise it.",
}


def _answer(text: str, res: dict) -> str:
    if res.get("answer"):
        return res["answer"]
    for k, v in _FAQ.items():
        if k in text.lower():
            return v
    return "I can help with sign-in problems, RouteOps, branch scan storage and most IT issues. Tell me what's not working."


# ------------------------------------------------------------ the pipeline

AGENTS = [
    ("intake", "Intake Agent", "Understands the employee's message and picks the use case"),
    ("ticket", "ServiceNow", "Opens the incident and sets it In Progress"),
    ("context", "Context Agent", "Gathers evidence from the affected system and similar resolved incidents"),
    ("hypothesis", "Hypothesis Agent", "Proposes the most likely root cause from the evidence"),
    ("critic", "Critic Agent", "Challenges the hypothesis and checks the safety guardrails"),
    ("judge", "Judge Agent", "Decides: fix automatically, or hand to a person"),
    ("approval", "IT approval", "A person approves fixes that affect other users"),
    ("remediate", "Remediation Agent", "Runs the approved runbook on the real system"),
    ("verify", "Verification Agent", "Checks the problem is really gone"),
    ("close", "RCA Writer", "Writes the resolution to ServiceNow and tells the employee"),
]
EMP_STAGES = ["Message received", "Ticket raised", "Finding the cause", "Fixing it", "Resolved"]
_EMP_OF = {"intake": 0, "ticket": 1, "context": 2, "hypothesis": 2, "critic": 2, "judge": 2, "approval": 3, "remediate": 3, "verify": 3, "close": 4}
_WAITERS: dict[str, threading.Event] = {}


def _stage(run: dict, key: str) -> dict:
    return next(s for s in run["pipeline"] if s["key"] == key)


def _begin(run: dict, key: str, inp=None) -> float:
    with _LOCK:
        s = _stage(run, key)
        s.update(status="running", started=_iso(), input=inp)
        run["emp_stage"] = max(run["emp_stage"], _EMP_OF[key])
        _save()
    return time.time()


def _finish(run: dict, key: str, t0: float, output: dict, engine: str, tools: list | None = None,
            note: str | None = None, status: str = "done", pace: bool = True) -> None:
    s = _stage(run, key)
    posted = None
    if note and run.get("sys_id"):
        try:
            snow.work_note({"sys_id": run["sys_id"], "text": f"[{CHANNEL} · {s['agent']}]\n{note}"})
            posted = True
        except Exception as exc:  # noqa: BLE001 -- the stage still happened; the note failure is shown
            posted = False
            output = {**output, "work_note_error": f"{type(exc).__name__}"}
    left = _STEP_MIN_S - (time.time() - t0)
    if pace and left > 0:
        time.sleep(left)
    with _LOCK:
        s.update(status=status, ended=_iso(), ms=int((time.time() - t0) * 1000), output=output, engine=engine,
                 tools=tools or [], note_posted=posted)
        _save()


def _tell(run: dict, text: str) -> None:
    with _LOCK:
        run["journey"].append({"at": _iso(), "stage": run["emp_stage"], "text": text})
        run["employee_message"] = text
        _save()


def start(emp: dict, text: str, intake: dict, origin: str = "chat") -> dict:
    uc = USE_CASES[intake["intent"]]
    run = {"id": f"R{uuid.uuid4().hex[:8]}", "emp": emp["key"], "emp_id": emp["id"], "employee": emp["name"], "text": text,
           "intent": intake["intent"], "use_case": uc["title"], "summary": intake["summary"], "origin": origin,
           "created": _iso(), "emp_stage": 0, "outcome": None, "employee_message": "", "journey": [], "awaiting": False,
           "number": None, "sys_id": None, "url": None, "system": None, "visual": None, "visual_after": None,
           "pipeline": [{"key": k, "agent": a, "purpose": p, "status": "pending", "engine": None, "started": None, "ended": None,
                         "ms": None, "input": None, "output": None, "tools": [], "note_posted": None} for k, a, p in AGENTS]}
    s = run["pipeline"][0]
    s.update(status="done", started=run["created"], ended=run["created"], ms=intake.get("ms", 0),
             engine=intake.get("engine", "rules") if origin == "chat" else "alert",
             input={"message": text} if origin == "chat" else {"alert": text},
             output={"use_case": uc["title"], "intent": intake["intent"], "summary": intake["summary"],
                     **({"fallback_reason": intake["fallback_reason"]} if intake.get("fallback_reason") else {}),
                     **({"source": "early-warning alert accepted by the employee"} if origin == "alert" else {})})
    run["journey"].append({"at": run["created"], "stage": 0, "text": "We got your message."})
    run["employee_message"] = "We got your message."
    with _LOCK:
        _S["runs"][run["id"]] = run
        _save()
    threading.Thread(target=_execute, args=(run["id"],), daemon=True).start()
    return run


# ---- use case 1: locked out after a password change


def _ev_locked(emp):
    d = directory()
    u = d.user(emp["login"])
    pw = d.password_changed_at(emp["login"])
    attempts = d.attempts(emp["login"])
    if pw:  # the story starts shortly before the password change
        start = _iso(_parse(pw) - timedelta(minutes=10))
        attempts = [a for a in attempts if a["at"] >= start]
    summ = _attempt_summary(attempts, pw)
    ev = {"identity_system": d.name, "account": emp["login"], "status": u["status"], "lockout_threshold": LOCK_AFTER,
          "password_changed_at": pw, **summ, "distinct_sources": len(summ["failing_ips"]) or u["sources"],
          "other_locked_accounts": d.locked_others(emp["login"])}
    visual = {"kind": "signins", "attempts": attempts[-12:], "password_changed_at": pw, "status": u["status"], "account": emp["login"],
              "system": d.name}
    return ev, [f"{d.name}: account status", f"{d.name}: sign-in events (2 h)", f"{d.name}: admin events (password change)",
                f"{d.name}: other locked accounts"], visual


def _hyp_locked(ev):
    if ev["status"] != "LOCKED_OUT":
        return "The account is not locked; the sign-in problem is on the device or app.", 0.55
    if ev["password_changed_at"] and ev["failed_after_password_change"] >= LOCK_AFTER:
        apps = ", ".join(ev["failing_apps"]) or "one app"
        return (f"The password was changed at {ev['password_changed_at'][11:16]} UTC, but {apps} kept signing in with the old one: "
                f"{ev['failed_after_password_change']} failures locked the account."), 0.93
    return f"Account locked after {ev['failed_attempts']} failed sign-ins from {ev['distinct_sources']} source(s).", 0.85


def _guard_locked(ev, emp):
    if ev["status"] != "LOCKED_OUT":
        return False, "Account is not locked: nothing to unlock."
    if ev["distinct_sources"] > 2 or ev["other_locked_accounts"] > 2:
        return False, (f"Failures from {ev['distinct_sources']} sources and {ev['other_locked_accounts']} other locked accounts: "
                       "possible password spraying. Security must review before unlocking.")
    return True, "Single-device lockout: the self-service unlock policy allows an automated unlock."


def _fix_locked(emp, ev):
    d = directory()
    d.unlock(emp["login"])
    d.logout(emp["login"])
    return {"steps": [f"Cleared the brute-force lock on {emp['login']} in {d.name}",
                      f"Signed out every session of {emp['login']}, so the handheld must sign in again with the new password"]}, \
        [f"{d.name}: clear lockout", f"{d.name}: sign out all sessions"]


def _check_locked(emp, ev):
    u = directory().user(emp["login"])
    return u["status"] != "LOCKED_OUT", {"status_after": u["status"], "failed_count_after": u["failed_1h"]}


# ---- use case 2: RouteOps not loading (real service, restart needs IT approval)


def _ev_app(emp):
    s = ro.summary()
    tail = ro.log_tail(16)
    errors = [ln for ln in tail if " ERROR " in ln]
    leaks = [ln for ln in tail if "not returned to pool" in ln]
    ev = {"service": ro.NAME, "status": s["status"], "http_code": s["http_code"], "pool_in_use": s["pool_in_use"], "pool_max": s["pool_max"],
          "consecutive_failed_health_checks": s["consecutive_failures"], "availability_last_min_pct": s["availability_last_min"],
          "p95_latency_ms": s["p95_ms"], "seconds_to_pool_exhausted": s["secs_to_pool_exhausted"],
          "log_errors_recent": len(errors), "log_connection_leak_warnings": len(leaks),
          "last_error": errors[-1][20:] if errors else None, "last_leak_warning": leaks[-1][20:] if leaks else None,
          "users_affected": "every RouteOps Mobile handheld (route lists and stop updates)"}
    visual = {"kind": "service", "samples": ro.samples(60), "log": tail, "summary": s}
    return ev, ["Health checks (GET /health, every 3 s)", "Service log (last 16 lines)", "Process status"], visual


def _app_unhealthy(ev) -> bool:
    return ev["status"] != "up" or (ev["pool_in_use"] or 0) >= 30 or ev["log_connection_leak_warnings"] > 0


def _hyp_app(ev):
    if not _app_unhealthy(ev):
        return "The service is healthy; the problem is on the handheld or its network.", 0.5
    if ev["log_connection_leak_warnings"]:
        state = "exhausted, so every request fails with HTTP 503" if ev["status"] != "up" else f"at {ev['pool_in_use']}/{ev['pool_max']} and slowing requests"
        return (f"The nightly manifest-export job is leaking database connections: the pool is {state}, "
                "so handhelds can't load routes."), 0.9
    return f"The service is {ev['status']} (HTTP {ev['http_code']}); cause not visible in the log.", 0.6


def _guard_app(ev, emp):
    if not _app_unhealthy(ev):
        return False, "The service is healthy and nothing is leaking: restarting it would not help."
    return True, ("A restart clears the pool and starts the service with the export job paused until it is patched. "
                  "It interrupts every driver for about 10 seconds, so IT must approve it.")


def _fix_app(emp, ev):
    before = ro.summary()
    s = ro.restart("off")
    return {"steps": [f"Graceful shutdown of {ro.NAME} (pid {before.get('pid') or 'n/a'})",
                      "Started a new process with the manifest-export job paused",
                      f"First health check: HTTP {s['code']}, pool {s['pool']}/{s['pool_max']}"]}, \
        [f"{ro.NAME}: POST /admin/shutdown", f"{ro.NAME}: start process (export job paused)"]


def _check_app(emp, ev):
    checks = []
    for _ in range(3):
        time.sleep(2)
        checks.append(ro.probe())
    try:
        routes = httpx.get(f"{ro.BASE}/routes/today", timeout=5).status_code
    except httpx.HTTPError:
        routes = 0
    ok = all(c["ok"] for c in checks) and routes == 200
    return ok, {"health_checks": [f"HTTP {c['code']} in {c['ms']} ms, pool {c['pool']}/{c['pool_max']}" for c in checks],
                "routes_today": f"HTTP {routes}", "service": "up" if ok else "still failing"}


# ---- use case 3: scans won't save (branch server full)


def _ev_storage(emp):
    d, fc = disk(), forecast()
    rec = _reclaimable()
    total = round(sum(rec.values()), 1)
    ev = {"server": SERVER["name"], "volume": SERVER["volume"], "capacity_mb": SERVER["capacity_mb"], "used_pct": d["pct"],
          "free_mb": d["free_mb"], "used_by_folder_mb": d["parts_mb"],
          "reclaimable_by_approved_cleanup_mb": rec, "reclaimable_total_mb": total,
          "used_pct_after_cleanup": round(d["pct"] - 100 * total / SERVER["capacity_mb"], 1),
          "hours_to_full": fc.get("hours_to_full") if fc else None,
          "retention_policy": "Manifest scans are regulated records: they may be moved to the archive tier but never deleted. "
                              "Scanner temp files (7 days) and service logs (14 days) have no further retention requirement."}
    visual = {"kind": "disk", "parts": d["parts_mb"], "capacity_mb": SERVER["capacity_mb"], "used_pct": d["pct"],
              "samples": _S["disk_samples"][-12:], "server": SERVER["name"], "volume": SERVER["volume"]}
    return ev, [f"{SERVER['name']}: volume usage", f"{SERVER['name']}: folder breakdown", "Forecast: least-squares trend"], visual


def _hyp_storage(ev):
    if ev["used_pct"] < 80:
        return f"The volume is only {ev['used_pct']}% full; storage is not the cause.", 0.5
    b = ev["used_by_folder_mb"]
    return (f"The volume is {ev['used_pct']}% full because scanner temp files ({b['Scanner temp files']} MB) and unrotated "
            f"service logs ({b['Service logs']} MB) piled up, so new scans cannot be written."), 0.88


def _guard_storage(ev, emp):
    if ev["used_pct"] < 80:
        return False, "Volume below 80%: cleanup would not fix the reported problem."
    after = ev["used_pct_after_cleanup"]
    if after > 80:
        return False, f"Safe cleanup only frees {ev['reclaimable_total_mb']} MB (would leave {after:.0f}%): needs more capacity, a person must decide."
    return True, f"Safe cleanup frees {ev['reclaimable_total_mb']} MB (to about {after:.0f}%); manifests are archived, never deleted."


def _fix_storage(emp, ev):
    actions = _clean_disk()
    return {"steps": [f"{a['action']}: {a['files']} files, {a['freed_mb']} MB" for a in actions],
            "freed_mb": round(sum(a["freed_mb"] for a in actions), 1)}, \
        [f"{SERVER['name']}: delete temp files", f"{SERVER['name']}: rotate logs", f"{SERVER['name']}: move to archive tier"]


def _check_storage(emp, ev):
    _sample()
    d = disk()
    ok = _scan_test()
    return ok, {"used_pct_after": d["pct"], "free_mb_after": d["free_mb"], "test_scan_written": ok}


def _ev_other(emp):
    return {"automated_runbook": None, "reported_by": f"{emp['title']}, {emp['site']}"}, [], None


def _hyp_other(ev):
    return "No automated runbook matches this problem; it needs a technician.", 0.5


def _guard_other(ev, emp):
    return False, "No approved automated runbook for this problem: route to the Service Desk."


FIX_LABEL = {
    "account_locked": "clear the lockout in the identity provider and sign out the account's sessions so devices re-authenticate",
    "app_down": "restart the RouteOps Dispatch API with the leaking manifest-export job paused",
    "storage_full": ("delete scanner temp files older than 7 days and service logs older than 14 days (neither has a retention "
                     "requirement), and move (not delete) manifest scans older than 90 days to the archive tier, which the retention policy allows"),
}

CASES = {
    "account_locked": dict(
        ev=_ev_locked, hyp=_hyp_locked, guard=_guard_locked, fix=_fix_locked, check=_check_locked, approval=None,
        look="Checking your account.", found="Found it: your password was changed, but your handheld kept using the old one, so the account locked.",
        fixing="Unlocking your account now.",
        done=lambda e: (f"Hi {e['first']}, your account is unlocked. Open RouteOps on your handheld and sign in with your new password. "
                        "The old one is no longer accepted."),
        close=lambda ev, out: (f"Root cause: password changed at {(ev.get('password_changed_at') or '?')[11:16]} UTC; "
                               f"{', '.join(ev['failing_apps']) or 'a device'} kept using the old password ({ev['failed_after_password_change'] or ev['failed_attempts']} failures) "
                               f"and {ev['identity_system']} locked the account. Fix: lockout cleared, sessions signed out. Verified status {out.get('status_after')}.")),
    "app_down": dict(
        ev=_ev_app, hyp=_hyp_app, guard=_guard_app, fix=_fix_app, check=_check_app,
        approval="Restarting the RouteOps Dispatch API interrupts every driver for about 10 seconds.",
        look="Checking the RouteOps service.", found="Found it: a background job overloaded the RouteOps service, so routes can't load.",
        waiting="We know how to fix it. IT is approving the fix now because it briefly affects all drivers.",
        fixing="Restarting RouteOps now.",
        done=lambda e: f"Hi {e['first']}, RouteOps is back. Pull down to refresh your route list.",
        close=lambda ev, out: (f"Root cause: the nightly manifest-export job leaked DB connections until the pool was exhausted "
                               f"({ev['pool_in_use']}/{ev['pool_max']}, HTTP {ev['http_code']}). Fix: service restarted with the export job paused "
                               f"(approved by IT). Verified: {'; '.join(out.get('health_checks', []))}; routes {out.get('routes_today')}. "
                               "Follow-up: patch the export job's connection handling before re-enabling it.")),
    "storage_full": dict(
        ev=_ev_storage, hyp=_hyp_storage, guard=_guard_storage, fix=_fix_storage, check=_check_storage, approval=None,
        look="Checking the branch scan server.", found="Found it: the branch scan server ran out of space.",
        fixing="Freeing up space now. Your manifests are safe.",
        done=lambda e: (f"Hi {e['first']}, the branch scan storage is back to normal. Scans will save again, and no manifests were lost: "
                        "older ones were moved to the archive."),
        close=lambda ev, out: (f"Root cause: {SERVER['name']} {SERVER['volume']} at {ev['used_pct']}% from scanner temp files and unrotated logs. "
                               f"Fix: temp files and logs past retention removed, manifest scans older than 90 days archived. "
                               f"Verified {out.get('used_pct_after')}% used and a test scan written.")),
    "other_issue": dict(ev=_ev_other, hyp=_hyp_other, guard=_guard_other, fix=None, check=None, approval=None,
                        look="Looking into it.", found="", fixing="", done=lambda e: "", close=lambda ev, out: ""),
}


def _note_lines(d: dict) -> str:
    return "\n".join(f"- {k}: {v}" for k, v in d.items() if k not in ("similar_resolved_incidents",))


def _execute(run_id: str) -> None:
    run = _S["runs"][run_id]
    emp = employee(run["emp"])
    uc, case = USE_CASES[run["intent"]], CASES[run["intent"]]
    try:
        # 2 · ServiceNow
        t0 = _begin(run, "ticket", {"short_description": run["summary"], "assignment_group": uc["group"]})
        if _sn_on():
            said = f"Alert accepted: \"{run['text']}\"" if run["origin"] == "alert" else f"Employee's words: \"{run['text']}\""
            inc = snow.create_incident(
                {"short_description": run["summary"], "description": f"Raised by {emp['name']} ({emp['title']}, {emp['site']}) via {CHANNEL}.\n\n{said}\nUse case: {uc['title']}",
                 "urgency": "1" if run["intent"] == "app_down" else "2", "impact": "1" if run["intent"] in ("app_down", "storage_full") else "2",
                 "category": uc["category"], "contact_type": "self-service", "caller_is_me": True, "assignment_group_name": uc["group"]},
                extra={"correlation_id": f"{TAG}{emp['id']}", "correlation_display": CHANNEL})
            with _LOCK:
                run.update(number=inc["number"], sys_id=inc["sys_id"], url=inc["url"])
            try:
                snow.set_state({"sys_id": inc["sys_id"], "state": "in progress"})
            except Exception:  # noqa: BLE001 -- cosmetic
                pass
            _finish(run, "ticket", t0, {"number": inc["number"], "state": "In Progress", "url": inc["url"]}, "tool",
                    ["ServiceNow: create incident", "ServiceNow: set state"],
                    note=f"Intake Agent: use case '{uc['title']}' ({'early-warning alert accepted by the employee' if run['origin'] == 'alert' else run['pipeline'][0]['engine']}). "
                         "The Service Hub pipeline is handling this incident; each agent writes its result here.")
            _tell(run, f"Ticket {inc['number']} raised. {case['look']}")
        else:
            _finish(run, "ticket", t0, {"number": None, "reason": "ServiceNow is not configured; no incident number was invented."}, "tool", status="warn")
            _tell(run, f"Request recorded. {case['look']}")

        # 3 · Context
        t0 = _begin(run, "context", {"use_case": uc["title"], "employee": f"{emp['name']} ({emp['title']}, {emp['site']})"})
        ev, tools, visual = case["ev"](emp)
        with _LOCK:
            run.update(system=ev.get("identity_system") or ev.get("service") or ev.get("server"), visual=visual)
        sim = _similar(uc["similar"] or [w for w in re.findall(r"[a-z]{5,}", run["summary"].lower())][:3], run.get("sys_id"))
        ev_out = {**ev, "similar_resolved_incidents": [f"{s['number']}: {s['short_description']}" for s in sim]}
        _finish(run, "context", t0, {**ev_out, "similar_links": sim}, "tool", tools + (["ServiceNow: similar resolved incidents"] if _sn_on() else []),
                note="Evidence:\n" + _note_lines(ev) + ("\n- similar resolved incidents: " + ", ".join(s["number"] for s in sim) if sim else ""))

        # 4 · Hypothesis
        rule_rc, rule_conf = case["hyp"](ev)
        t0 = _begin(run, "hypothesis", {"report": run["text"], "evidence": "from Context Agent"})
        out, engine, err = _llm_json("Hypothesis Agent", (
            f"You are the Hypothesis Agent in an IT operations pipeline at Crystal Clean. Explain the underlying cause, not just the "
            f"symptom: say what changed or what is consuming the resource, using the timestamps, counts and log lines in the evidence. {_GROUND}\n"
            f'Return {{"root_cause": "one sentence", "confidence": 0.0-1.0, "evidence_used": ["short items"]}}.\n'
            f"Employee report: {json.dumps(run['text'])}\nUse case: {uc['title']}\nEvidence: {json.dumps(ev_out)}"), run)
        if out and isinstance(out.get("root_cause"), str) and out["root_cause"].strip():
            hyp = {"root_cause": out["root_cause"].strip()[:300], "confidence": _conf(out.get("confidence"), rule_conf),
                   "evidence_used": [str(x)[:120] for x in (out.get("evidence_used") or [])][:5]}
        else:
            hyp, engine = {"root_cause": rule_rc, "confidence": rule_conf, "evidence_used": list(ev)[:5]}, "rules"
            if err:
                hyp["fallback_reason"] = err
        _finish(run, "hypothesis", t0, hyp, engine, ["Cohere chat (JSON)"] if engine == "ai" else ["Rule-based diagnosis"],
                note=f"Root cause hypothesis ({hyp['confidence']:.2f}): {hyp['root_cause']}")

        # 5 · Critic
        allowed, policy = case["guard"](ev, emp)
        t0 = _begin(run, "critic", {"hypothesis": hyp["root_cause"]})
        out, engine, err = _llm_json("Critic Agent", (
            f"You are the Critic Agent in an IT operations pipeline. Try to prove the hypothesis wrong, or the automated fix unsafe. "
            f"List up to 3 alternative explanations or risks. For each, check the evidence and give a verdict: "
            f'"ruled_out" when the evidence contradicts it or nothing supports it (speculation), "confirmed_risk" when a specific '
            f"evidence item shows the hypothesis may be wrong or the fix unsafe. Restating the hypothesis is not a challenge. {_GROUND}\n"
            f'Return {{"challenges": [{{"challenge": "short sentence", "verdict": "ruled_out" or "confirmed_risk", "evidence": "the evidence item"}}]}}.\n'
            f"Hypothesis: {json.dumps(hyp['root_cause'])}\nEvidence: {json.dumps(ev_out)}"), run)
        raw_ch = (out or {}).get("challenges") or []
        challenges = []
        for c in (raw_ch if isinstance(raw_ch, list) else [raw_ch])[:3]:
            if isinstance(c, dict) and c.get("challenge"):
                challenges.append({"challenge": str(c["challenge"])[:200], "supported_by_evidence": c.get("verdict") == "confirmed_risk",
                                   "evidence": str(c.get("evidence") or "")[:160]})
            elif isinstance(c, str):
                challenges.append({"challenge": c[:200], "supported_by_evidence": False, "evidence": ""})
        crit = {"challenges": challenges, "risks_raised": sum(1 for c in challenges if c["supported_by_evidence"])}
        if not out:
            engine = "rules"
            if err:
                crit["fallback_reason"] = err
        crit["policy_guardrail"] = {"automated_fix_allowed": allowed, "reason": policy}
        _finish(run, "critic", t0, crit, engine, (["Cohere chat (JSON)"] if engine == "ai" else []) + ["Policy guardrail check"],
                note=("Challenges:\n" + "\n".join(f"- {c['challenge']} [{'risk raised' if c['supported_by_evidence'] else 'ruled out'}"
                                                   + (f": {c['evidence']}" if c["evidence"] else "") + "]" for c in challenges) + "\n" if challenges else "")
                     + f"Guardrail: {policy}")

        # 6 · Judge
        fix_label = FIX_LABEL.get(run["intent"], "none (no automated runbook)")
        t0 = _begin(run, "judge", {"proposed_fix": fix_label, "hypothesis_confidence": hyp["confidence"],
                                   "risks_raised_by_critic": crit["risks_raised"], "guardrail_allows_fix": allowed})
        out, engine, err = _llm_json("Judge Agent", (
            f"You are the Judge Agent in an IT operations pipeline. Decide whether each critic challenge is upheld. "
            f"Proposed fix: {fix_label}. Uphold a challenge only if a specific evidence value shows this fix would be wrong or unsafe. "
            f"Do not uphold speculation, a challenge that restates the hypothesis, or an alternative cause that leads to the same fix. "
            f"After the fix the Verification Agent re-checks the system and hands the ticket to a person if the problem remains, "
            f"so a risk that the fix might not fully work is not a reason to stop; uphold only risks of harm (data loss, security) "
            f"or evidence that the cause is different. "
            f"Then give your confidence that the hypothesis is correct. {_GROUND}\n"
            f'Return {{"upheld": [{{"index": n, "evidence_key": "a key from Evidence", "evidence_value": "its value"}}], '
            f'"confidence": 0.0-1.0, "rationale": "one or two sentences citing evidence"}}. Return "upheld": [] when nothing is upheld.\n'
            f"Hypothesis: {json.dumps(hyp['root_cause'])}\nEvidence: {json.dumps(ev_out)}\nChallenges: {json.dumps(list(enumerate(crit['challenges'])))}"), run)
        discarded = []
        if out and isinstance(out.get("upheld"), list):
            upheld = []  # two-key rule: Critic risk AND Judge uphold citing a value that really is in the evidence
            for u in out["upheld"]:
                i = u.get("index") if isinstance(u, dict) else u
                if not (isinstance(i, int) and 0 <= i < len(crit["challenges"])):
                    continue
                ch = crit["challenges"][i]
                if ch["supported_by_evidence"] and isinstance(u, dict) and _grounded(ev_out, u.get("evidence_key"), u.get("evidence_value")):
                    upheld.append(f"{ch['challenge']} ({u['evidence_key']} = {u['evidence_value']})")
                else:
                    discarded.append(f"{ch['challenge']} ({'Critic ruled it out' if not ch['supported_by_evidence'] else 'cited evidence not found'})")
            conf = _conf(out.get("confidence"), rule_conf)
            rationale = str(out.get("rationale") or "")[:320]
            if discarded and not upheld:
                rationale = "No challenge is backed by both agents and the evidence. " + rationale
        else:
            engine = "rules"
            upheld = [c["challenge"] for c in crit["challenges"] if c["supported_by_evidence"]]
            conf = _conf(rule_conf - 0.2 * len(upheld), rule_conf)
            rationale = ""
        auto = allowed and not upheld and conf >= CONFIDENCE_MIN and case["fix"] is not None
        decision = ("Fix after IT approval" if case.get("approval") else "Fix automatically") if auto else "Hand to a person"
        if not rationale:
            rationale = policy if not allowed else ("Upheld: " + "; ".join(upheld) if upheld else "The evidence supports the hypothesis; no challenge was upheld.")
        judge = {"decision": decision, "confidence": conf, "threshold": CONFIDENCE_MIN, "upheld_challenges": upheld or "None",
                 **({"discarded_upholds": discarded} if discarded else {}), "guardrail": policy, "rationale": rationale,
                 "rule": f"Fix only if the guardrail allows it, no challenge is upheld (Critic risk + Judge citing real evidence) and confidence ≥ {CONFIDENCE_MIN}"}
        _finish(run, "judge", t0, judge, engine, (["Cohere chat (JSON)"] if engine == "ai" else []) + ["Decision policy"],
                note=f"Decision: {decision} (confidence {conf:.2f}, threshold {CONFIDENCE_MIN}). {rationale}")
        if not auto:
            return _handover(run, emp, {"reason": rationale}, uc)
        _tell(run, case["found"])

        # 7 · IT approval (only for fixes that affect other users)
        if case.get("approval"):
            t0 = _begin(run, "approval", {"requested_fix": fix_label, "why_a_person_must_approve": case["approval"], "approver": IT_APPROVER})
            waiter = _WAITERS[run_id] = threading.Event()
            with _LOCK:
                run["awaiting"] = True
                _save()
            if run.get("sys_id"):
                try:
                    snow.work_note({"sys_id": run["sys_id"], "text": f"[{CHANNEL} · IT approval]\nApproval requested from {IT_APPROVER}: {fix_label}. {case['approval']}"})
                except Exception:  # noqa: BLE001
                    pass
            _tell(run, case["waiting"])
            waiter.wait(timeout=1800)
            _WAITERS.pop(run_id, None)
            got = run.get("approval") or {"decision": "timed out"}
            with _LOCK:
                run["awaiting"] = False
                _save()
            if got["decision"] != "approve":
                _finish(run, "approval", t0, {"decision": "Rejected" if got["decision"] == "reject" else "No answer in 30 minutes",
                                              "by": got.get("by")}, "human", note=f"Fix not approved ({got['decision']}).", status="warn", pace=False)
                return _handover(run, emp, {"reason": "IT did not approve the automated fix."}, uc)
            _finish(run, "approval", t0, {"decision": "Approved", "approved_by": got["by"], "approved_at": got["at"],
                                          "waited_seconds": int(time.time() - t0)}, "human",
                    note=f"Approved by {got['by']}: {fix_label}.", pace=False)
        else:
            with _LOCK:
                _stage(run, "approval").update(status="na", engine="policy",
                                               output={"reason": "Not needed: the fix only affects this employee's own account or a branch server, "
                                                                 "and the self-service policy allows it."})
                _save()

        # 8 · Remediation
        t0 = _begin(run, "remediate", {"runbook": fix_label})
        _tell(run, case["fixing"])
        fix, tools = case["fix"](emp, ev)
        _finish(run, "remediate", t0, fix, "tool", tools, note="Runbook executed:\n" + "\n".join(f"- {s}" for s in fix["steps"]))

        # 9 · Verification
        t0 = _begin(run, "verify", {"check": "re-read the affected system after the fix"})
        ok, check = case["check"](emp, ev)
        with _LOCK:
            run["visual_after"] = case["ev"](emp)[2] if ok else None
        _finish(run, "verify", t0, {"passed": ok, **check}, "tool", ["Re-check affected system"],
                note=f"Verification {'passed' if ok else 'FAILED'}: " + "; ".join(f"{k}={v}" for k, v in check.items()), status="done" if ok else "fail")
        if not ok:
            return _handover(run, emp, {"reason": "Verification failed after the fix."}, uc)

        # 10 · RCA Writer
        t0 = _begin(run, "close", {"incident": run["number"]})
        close_notes, msg = case["close"](ev, check), case["done"](emp)
        if run.get("sys_id"):
            snow.comment({"sys_id": run["sys_id"], "text": msg})
            snow.resolve({"sys_id": run["sys_id"], "close_notes": close_notes})
        _finish(run, "close", t0, {"close_notes": close_notes, "message_to_employee": msg,
                                   "servicenow": f"{run['number']} resolved" if run.get("number") else "not configured"},
                "tool", ["ServiceNow: comment to caller", "ServiceNow: resolve incident"] if run.get("sys_id") else [])
        with _LOCK:
            run.update(outcome="resolved", resolved=_iso(), emp_stage=4)
            _save()
        _tell(run, msg)
    except Exception as exc:  # noqa: BLE001
        with _LOCK:
            for s in run["pipeline"]:
                if s["status"] == "running":
                    s.update(status="fail", ended=_iso(), output={"error": f"{type(exc).__name__}: {str(exc)[:200]}"})
        _handover(run, emp, {"reason": f"Pipeline error: {type(exc).__name__}"}, uc)


def _handover(run: dict, emp: dict, judge: dict, uc: dict) -> None:
    with _LOCK:
        for s in run["pipeline"]:
            if s["status"] == "pending":
                s["status"] = "skipped"
        run.update(outcome="handover", emp_stage=max(run["emp_stage"], 2), awaiting=False)
        _save()
    if run.get("sys_id"):
        try:
            snow.work_note({"sys_id": run["sys_id"], "text": f"[{CHANNEL} · Handover]\nNot fixed automatically: {judge.get('reason', '')} "
                                                            f"Assigned to {uc['group']} for a technician."})
            snow.comment({"sys_id": run["sys_id"], "text": "A technician from our team will pick this up and contact you."})
        except Exception:  # noqa: BLE001
            pass
    _tell(run, "This one needs a technician. Our team has your ticket and will contact you.")


def approve(role: str | None, run_id: str, decision: str) -> dict:
    require_it(role)
    run = _S["runs"].get(run_id)
    if not run or not run.get("awaiting") or run_id not in _WAITERS:
        raise ValueError("That fix is not waiting for approval.")
    if decision not in ("approve", "reject"):
        raise ValueError("decision must be approve or reject")
    with _LOCK:
        run["approval"] = {"decision": decision, "by": IT_APPROVER, "at": _iso()}
        _save()
    _WAITERS[run_id].set()
    return {"ok": True}


# ------------------------------------------------------------ predictions


def _alerts_for(emp: dict) -> list[dict]:
    out, d = [], directory()
    open_intents = {r["intent"] for r in _S["runs"].values() if r["emp"] == emp["key"] and r["outcome"] is None}
    try:
        u = d.user(emp["login"])
        if u["status"] == "LOCKED_OUT" and "account_locked" not in open_intents:
            out.append({"id": "lock", "level": "high", "intent": "account_locked", "title": "Your account is locked",
                        "text": f"{u['failed_1h'] or LOCK_AFTER} sign-in attempts failed. We can unlock it for you now.", "action": "Unlock my account"})
        elif 2 <= u["failed_1h"] < LOCK_AFTER and "account_locked" not in open_intents:
            out.append({"id": "fail", "level": "medium", "intent": None, "title": "Sign-in attempts failing",
                        "text": f"{u['failed_1h']} failed sign-ins. After {LOCK_AFTER} your account locks. "
                                "If you changed your password, update it on your handheld.", "action": None})
    except Exception:  # noqa: BLE001 -- predictions are best effort
        pass
    if "app_down" not in open_intents:
        s = ro.summary()
        if s["status"] != "up":
            out.append({"id": "app", "level": "high", "intent": "app_down", "title": "RouteOps is down",
                        "text": "Route lists can't load right now. We can get it fixed now.", "action": "Get it fixed"})
        elif (s["pool_in_use"] or 0) >= 35 or (s["secs_to_pool_exhausted"] is not None and s["secs_to_pool_exhausted"] < 120):
            when = f"in about {s['secs_to_pool_exhausted']} seconds" if s["secs_to_pool_exhausted"] else "soon"
            out.append({"id": "app", "level": "medium", "intent": "app_down", "title": "RouteOps is slowing down",
                        "text": f"Our monitoring predicts RouteOps will stop loading routes {when}.", "action": "Fix it now"})
    if emp["site"] == SERVER["site"] and "storage_full" not in open_intents:
        fc = forecast()
        if fc and (fc["pct"] >= 85 or (fc.get("hours_to_full") is not None and fc["hours_to_full"] < 72)):
            when = f"in about {fc['hours_to_full']:.0f} hours" if fc.get("hours_to_full") is not None else "soon"
            out.append({"id": "disk", "level": "high" if fc["pct"] >= 90 else "medium", "intent": "storage_full",
                        "title": "Branch scan storage almost full", "text": f"The branch scan server is {fc['pct']:.0f}% full and will be full {when}. Scans will start failing.",
                        "action": "Fix it now"})
    return [a for a in out if a["id"] not in _S["dismissed"]]


# ----------------------------------------------------------------- views


def _public(run: dict) -> dict:
    """What the employee sees: plain language only, no agent or system internals."""
    return {"id": run["id"], "summary": run["summary"], "use_case": run["use_case"], "created": run["created"],
            "number": run["number"], "outcome": run["outcome"], "resolved": run.get("resolved"),
            "stage": run["emp_stage"], "stages": EMP_STAGES, "message": run["employee_message"], "journey": run["journey"]}


def hub(emp_key: str | None) -> dict:
    emp = employee(emp_key)
    runs = sorted((r for r in _S["runs"].values() if r["emp"] == emp["key"]), key=lambda r: r["created"], reverse=True)
    return {"employee": {k: emp[k] for k in ("key", "name", "first", "initials", "title", "site")},
            "alerts": _alerts_for(emp), "requests": [_public(r) for r in runs]}


def chat(emp_key: str | None, text: str) -> dict:
    emp = employee(emp_key)
    text = (text or "").strip()[:600]
    if not text:
        raise ValueError("Type a message.")
    res = understand(text, emp)
    if res["intent"] in USE_CASES:
        run = start(emp, text, res)
        msg = {"account_locked": "Sorry you're locked out. I've raised a ticket and I'm checking your account now.",
               "app_down": "Thanks. I've raised a ticket and I'm checking the RouteOps service now.",
               "storage_full": "Thanks for flagging it. I've raised a ticket and I'm checking the branch scan server now.",
               "other_issue": "Thanks, I've raised a ticket for this."}[res["intent"]]
        return {"reply": msg + " You can follow every step under My requests.", "request": _public(run)}
    if res["intent"] == "status":
        mine = [r for r in _S["runs"].values() if r["emp"] == emp["key"]]
        if not mine:
            return {"reply": "You don't have any requests yet."}
        r = max(mine, key=lambda r: r["created"])
        return {"reply": f"Your latest request ({r['number'] or r['summary']}): {EMP_STAGES[r['emp_stage']]}. {r['employee_message']}"}
    if res["intent"] == "greeting":
        return {"reply": res.get("answer") or f"Hi {emp['first']}! Tell me what's not working and I'll take care of it."}
    return {"reply": _answer(text, res)}


def act_on_alert(emp_key: str | None, alert_id: str) -> dict:
    emp = employee(emp_key)
    alert = next((a for a in _alerts_for(emp) if a["id"] == alert_id), None)
    if not alert or not alert["intent"]:
        raise ValueError("That alert is no longer active.")
    summary = {"account_locked": "Account locked - unlock requested from alert",
               "app_down": f"{ro.NAME} degraded - routes not loading for drivers",
               "storage_full": f"{SERVER['name']} scan volume nearly full - proactive fix"}[alert["intent"]]
    run = start(emp, alert["title"], {"intent": alert["intent"], "summary": summary, "engine": "alert", "ms": 0}, origin="alert")
    return {"request": _public(run)}


def dismiss(emp_key: str | None, alert_id: str) -> dict:
    employee(emp_key)
    with _LOCK:
        if alert_id not in _S["dismissed"]:
            _S["dismissed"].append(alert_id)
        _save()
    return {"ok": True}


def ops(role: str | None) -> dict:
    require_it(role)
    d = directory()
    sn = {"connected": _sn_on(), "error": None}
    tickets, by_sys = [], {r["sys_id"]: r for r in _S["runs"].values() if r.get("sys_id")}
    if sn["connected"]:
        try:
            for row in _sn_list():
                if row["sys_id"] in _S["hidden_sys_ids"]:
                    continue
                tickets.append({**row, "url": _sn_url(row["sys_id"]), "run": by_sys.get(row["sys_id"])})
        except Exception as exc:  # noqa: BLE001
            sn["error"] = f"{type(exc).__name__}: {str(exc)[:160]}"
    watch = [{**a, "who": SERVER["site"] if a["id"] == "disk" else ("All drivers" if a["id"] == "app" else e["name"])}
             for k, e in EMPLOYEES.items() for a in _alerts_for({**e, "key": k})]
    runs = list(_S["runs"].values())
    done = [r for r in runs if r["outcome"] == "resolved" and r.get("resolved")]
    mins = [(_parse(r["resolved"]) - _parse(r["created"])).total_seconds() / 60 for r in done]
    svc = ro.summary()
    return {
        "tickets": tickets, "watch": watch, "agents": [{"key": k, "agent": a, "purpose": p} for k, a, p in AGENTS],
        "kpis": {"open": sum(1 for r in runs if r["outcome"] is None), "awaiting": sum(1 for r in runs if r.get("awaiting")),
                 "auto_resolved": len(done), "handover": sum(1 for r in runs if r["outcome"] == "handover"),
                 "avg_minutes": round(sum(mins) / len(mins), 1) if mins else None},
        "systems": [
            {"name": "ServiceNow", "ok": sn["connected"] and not sn["error"], "detail": sn["error"] or ("Connected" if sn["connected"] else "Not configured")},
            {"name": "Identity", "ok": d.live, "detail": f"{d.name} (live)" if d.live else "Demo directory (Keycloak or Okta not connected)"},
            {"name": "RouteOps Dispatch API", "ok": svc["status"] == "up", "detail": f"{svc['status']}, pool {svc['pool_in_use']}/{svc['pool_max']} (local service)"},
            {"name": SERVER["name"], "ok": False, "detail": f"Sandbox on this laptop, {disk()['pct']}% used"},
            {"name": "AI agents", "ok": llm.llm_available(), "detail": f"Cohere {_AGENT_MODEL}" if llm.llm_available() else "Rules only (no COHERE_API_KEY)"},
        ],
        "service": {"summary": svc, "samples": ro.samples(60)}, "server": disk(), "forecast": forecast(),
    }


def notes(role: str | None, sys_id: str) -> dict:
    require_it(role)
    if not re.fullmatch(r"[0-9a-f]{32}", sys_id or ""):
        raise ValueError("bad sys_id")
    a = snow.activity({"sys_id": sys_id})
    return {"number": a["number"], "state": a["state"], "url": a["url"], "close_notes": a["close_notes"], "notes": a["notes"]}


# ------------------------------------------------------------ demo controls


def demo(role: str | None, action: str) -> dict:
    require_it(role)
    login = EMPLOYEES["marcus"]["login"]
    if action == "lockout":
        return {"message": directory().stage_lockout(login)}
    if action == "storage":
        return {"message": fill_disk(96.0)}
    if action == "outage":
        return {"message": ro.inject_fault()}
    if action == "reset":
        hidden = []
        if _sn_on():
            try:
                hidden = [r["sys_id"] for r in _sn_list()]
            except Exception:  # noqa: BLE001
                pass
        global _S
        for ev in list(_WAITERS.values()):
            ev.set()
        with _LOCK:
            fresh = _blank_state()
            fresh["hidden_sys_ids"] = list(set(_S.get("hidden_sys_ids", []) + hidden))
            _S = fresh
            _save()
        lock = directory().stage_lockout(login)
        fill_disk(96.0)
        ro.reset_clean()
        ro.inject_fault()
        return {"message": "Demo reset. Marcus is locked out, the scan server is 96% full, and the RouteOps export job is leaking "
                           "(RouteOps fails in about 1.5 minutes)." + (f" {lock}" if isinstance(directory(), OktaDirectory) else "")}
    raise ValueError("unknown demo action")


if os.getenv("CC_ROUTEOPS_AUTOSTART", "1") != "0":
    ro.init()
