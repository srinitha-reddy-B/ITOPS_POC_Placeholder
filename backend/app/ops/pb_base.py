"""Shared helpers for the use-case playbooks."""

import time

from . import prom
from .engine import ev, test  # noqa: F401  (re-exported for the playbooks)


def q(expr: str) -> float | None:
    """Instant Prometheus value, or None when there is no data or Prometheus is down."""
    try:
        return prom.scalar(expr)
    except prom.PromError:
        return None


def rows(expr: str) -> list[dict]:
    try:
        return prom.query(expr)
    except prom.PromError:
        return []


def series(expr: str, minutes: float = 15, step: float = 5) -> list[list[float]]:
    try:
        s = prom.series(expr, minutes, step)
    except prom.PromError:
        return []
    return s[0]["points"] if s else []


def r(v, n: int = 1):
    return None if v is None else round(v, n)


def ago(ts: float | None) -> str:
    if not ts:
        return "never"
    s = int(time.time() - ts)
    if s < 90:
        return f"{s} s ago"
    if s < 5400:
        return f"{s // 60} min ago"
    return f"{s // 3600} h {s % 3600 // 60} min ago"


def eid(ctx: dict, title: str) -> str:
    """Evidence id for an evidence title collected earlier in this investigation ('' if none)."""
    return ctx.get("ids", {}).get(title, "")


def node(id_: str, label: str, type_: str, revealed_by: str, status: str = "normal", evidence: list | None = None, detail: str = "") -> dict:
    return {"id": id_, "label": label, "type": type_, "revealed_by": revealed_by, "status": status,
            "evidence": [e for e in (evidence or []) if e], "detail": detail}


def edge(src: str, dst: str, label: str, revealed_by: str = "monitoring", status: str = "normal") -> dict:
    return {"id": f"{src}->{dst}", "source": src, "target": dst, "label": label, "revealed_by": revealed_by, "status": status}


def wait_until(check, timeout: float, every: float = 5, settle: float = 0, need: int = 2) -> tuple[bool, list]:
    """Poll check() -> (ok, detail) until it passes `need` times in a row or the timeout ends."""
    time.sleep(settle)
    log, streak, end = [], 0, time.time() + timeout
    while time.time() < end:
        ok, detail = check()
        log.append({"at": time.time(), "ok": ok, **detail})
        streak = streak + 1 if ok else 0
        if streak >= need:
            return True, log
        time.sleep(every)
    return False, log


class Playbook:
    key = ""
    title = ""
    component = ""
    facility = ""
    integrations: set = set()
    reality: list = []          # [{"item": ..., "mode": "live" | "lab" | "simulated"}] shown in the UI
    auto_investigate = True
    staging = False             # True while a demo scenario is being set up: detection pauses
    quiet_until = 0.0           # after a demo reset, detection pauses briefly while restarted services settle

    def detect(self) -> dict | None:
        raise NotImplementedError

    def breached(self, ctx: dict) -> bool:
        return False
