"""In-memory trace/log store, one list of events per chat session.

This is the backing store for the trace panel: every agent invocation, tool
call, and guardrail check gets appended here as a structured event, keyed by
session_id. Nothing is persisted across process restarts -- that's fine for
a showcase; a real deployment would swap this for the OpenTelemetry exporter
described in the BRD.
"""

import itertools
from dataclasses import dataclass, field, asdict
from typing import Literal

EventKind = Literal["route", "read", "write", "guardrail", "build", "system"]

_counter = itertools.count(1)
_sessions: dict[str, list[dict]] = {}


@dataclass
class TraceEvent:
    id: int
    kind: EventKind
    agent: str
    detail: str
    latency_ms: int
    status: Literal["ok", "blocked", "error"] = "ok"
    decision: str = ""
    platform: str | None = None


def record(session_id: str, event: TraceEvent) -> None:
    _sessions.setdefault(session_id, []).append(asdict(event))


def new_event(
    kind: EventKind,
    agent: str,
    detail: str,
    latency_ms: int,
    *,
    status: Literal["ok", "blocked", "error"] = "ok",
    decision: str = "",
    platform: str | None = None,
) -> TraceEvent:
    return TraceEvent(
        id=next(_counter),
        kind=kind,
        agent=agent,
        detail=detail,
        latency_ms=latency_ms,
        status=status,
        decision=decision,
        platform=platform,
    )


def resume_counter() -> None:
    """Called once after state_store restores old trace events from disk.
    `_counter` always restarts at 1 on process boot (it's an in-memory
    itertools.count, never itself persisted) -- without this, a freshly
    booted process hands out id=1, id=2, ... again, colliding with ids
    already sitting in the just-restored history.

    Also repairs any duplicate ids already baked into the file -- e.g. from
    a session saved before this function existed, back when a reload really
    could produce two events sharing an id. Preventing new collisions can't
    undo old ones already on disk, so every restored event gets a fresh,
    globally unique id here, reassigned in its existing (chronological)
    order -- newestFirst() just reverses array order, it never sorts by id,
    so renumbering can't change what the trace panel shows, only guarantee
    React never sees two children with the same key again."""
    global _counter
    next_id = 1
    for events in _sessions.values():
        if not isinstance(events, list):
            continue
        for ev in events:
            if isinstance(ev, dict):
                ev["id"] = next_id
                next_id += 1
    _counter = itertools.count(next_id)


def get_trace(session_id: str) -> list[dict]:
    return _sessions.get(session_id, [])


def clear(session_id: str) -> None:
    _sessions.pop(session_id, None)
