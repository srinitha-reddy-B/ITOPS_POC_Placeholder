"""The Microsoft Outlook / Exchange Online escalation (use case 6, the Manager portal's Operational Insights).

SIMULATED: there is no Microsoft tenant or mail gateway in the lab. This module holds the one state that both sides
read, so what the Operations Manager sees and what the agents find always agree:

  stage   0 Normal · 1 Degrading · 2 Worsening · 3 High Impact · 4 Potential Critical Impact (30 min apart)
  fixed   set by the approved action (Microsoft notified, email continuity on, Microsoft restored Exchange Online)

The manager raises the escalation as an incident; the engine then opens a real ServiceNow incident and runs the
normal 14-agent pipeline (playbook pb_mail.py). Only the mail telemetry is simulated.
"""

import threading
import time

STAGES = [
    {"name": "Normal", "time": "08:10", "employees": 0, "risk": "Low"},
    {"name": "Degrading", "time": "08:40", "employees": 1240, "risk": "High"},
    {"name": "Worsening", "time": "09:10", "employees": 2150, "risk": "High"},
    {"name": "High Impact", "time": "09:40", "employees": 3100, "risk": "Critical"},
    {"name": "Potential Critical Impact", "time": "10:10", "employees": 3600, "risk": "Critical"},
]
# Simulated mail-service telemetry per stage, and after the approved fix
METRICS = {
    "availability_pct": [99.9, 91.2, 86.5, 80.1, 72.4],
    "latency_ms": [210, 1900, 4500, 8000, 12000],
    "failed_per_min": [3, 246, 520, 860, 1240],
    "auth_errors_per_min": [6, 312, 610, 940, 1300],
    "error_rate_pct": [0.3, 4.8, 11, 19, 27],
    "m365_warnings": [0, 2, 3, 4, 4],
}
FIXED = {"availability_pct": 99.9, "latency_ms": 240, "failed_per_min": 4, "auth_errors_per_min": 7, "error_rate_pct": 0.3, "m365_warnings": 0}
TARGETS = {"availability_pct": (">=", 99.5), "latency_ms": ("<", 300), "failed_per_min": ("<", 10), "auth_errors_per_min": ("<", 20), "error_rate_pct": ("<", 0.5)}
RISK = [10, 72, 78, 86, 92]

_lock = threading.Lock()
_state = {"stage": 1, "fixed": False, "fixed_at": None, "fixed_by": None, "started_at": time.time()}


def state() -> dict:
    with _lock:
        return dict(_state)


def metrics(stage: int | None = None) -> dict:
    s = state()
    if s["fixed"] and stage is None:
        return dict(FIXED)
    i = s["stage"] if stage is None else stage
    return {k: v[i] for k, v in METRICS.items()}


def active() -> bool:
    s = state()
    return s["stage"] >= 1 and not s["fixed"]


def step(action: str) -> dict:
    """Demo control: move the escalation (next / back / restart). A fixed escalation stays fixed until restart."""
    with _lock:
        if action == "restart":
            _state.update(stage=1, fixed=False, fixed_at=None, fixed_by=None, started_at=time.time())
        elif _state["fixed"]:
            raise ValueError("the escalation was fixed; restart the demo to play it again")
        elif action == "next":
            _state["stage"] = min(4, _state["stage"] + 1)
        elif action == "back":
            _state["stage"] = max(0, _state["stage"] - 1)
        else:
            raise ValueError("action must be next, back or restart")
        return dict(_state)


def fix(by: str) -> dict:
    """The approved action (simulated): Microsoft notified and continuity on; Microsoft then restores Exchange Online."""
    with _lock:
        _state.update(fixed=True, fixed_at=time.time(), fixed_by=by)
        return dict(_state)


def passes(m: dict) -> dict:
    out = {}
    for k, (op, limit) in TARGETS.items():
        out[k] = m[k] >= limit if op == ">=" else m[k] < limit
    return out
