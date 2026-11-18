"""Persists all in-memory state to a single JSON file so restarting the dev
server (which happens a lot mid-build) doesn't silently wipe every chat
session, built agent, and platform connection out from under the user.

Demo-grade simplification, same spirit as everything else in this app: a
single local file, best-effort, no encryption at rest for the credentials
it contains (same trust boundary as the plaintext `.env` this app already
reads its own Cohere/Salesforce app credentials from).
"""

import json
from pathlib import Path

from . import knowledge, platform_connect, salesforce_connect, trace_store

_STATE_FILE = Path(__file__).parent.parent / ".aura_state.json"


def save(sessions: dict) -> None:
    data = {
        "sessions": sessions,
        "trace": trace_store._sessions,
        "salesforce_connections": salesforce_connect._connections,
        "salesforce_app_config": salesforce_connect._app_config,
        "platform_connections": platform_connect._connections,
        "knowledge": knowledge._sources,
    }
    try:
        _STATE_FILE.write_text(json.dumps(data), encoding="utf-8")
    except Exception:
        pass  # persistence is a convenience, never let it break the chat


def load() -> dict:
    if not _STATE_FILE.exists():
        return {}
    try:
        data = json.loads(_STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}
    try:
        trace_store._sessions.update(data.get("trace", {}))
        trace_store.resume_counter()
        salesforce_connect._connections.update(data.get("salesforce_connections", {}))
        salesforce_connect._app_config.update(data.get("salesforce_app_config", {}))
        platform_connect._connections.update(data.get("platform_connections", {}))
        knowledge._sources.update(data.get("knowledge", {}))
    except Exception:
        pass  # persistence is a convenience, never let it break the chat
    return data.get("sessions", {})
