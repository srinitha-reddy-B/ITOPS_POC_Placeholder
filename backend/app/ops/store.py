"""Persistent history for the Ops Console (SQLite, part of Python, nothing to install).

Tables
  investigations  one JSON document per investigation (agents, evidence, graph, approvals, outcome)
  events          append-only log: backup runs, demo actions, approvals, integration errors
"""

import json
import sqlite3
import threading
import time
import uuid

from . import config

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None


def _db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.executescript("""
            CREATE TABLE IF NOT EXISTS investigations (
                id TEXT PRIMARY KEY, created REAL, updated REAL, usecase TEXT, status TEXT, doc TEXT);
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, kind TEXT, source TEXT, summary TEXT, data TEXT);
            CREATE INDEX IF NOT EXISTS ix_events_kind ON events(kind, ts);
        """)
    return _conn


def new_id(prefix: str) -> str:
    return f"{prefix}-{time.strftime('%y%m%d')}-{uuid.uuid4().hex[:5].upper()}"


def save_investigation(doc: dict) -> None:
    doc["updated"] = time.time()
    with _lock:
        _db().execute("INSERT OR REPLACE INTO investigations VALUES (?,?,?,?,?,?)",
                      (doc["id"], doc["created"], doc["updated"], doc["usecase"], doc["status"], json.dumps(doc, default=str)))
        _db().commit()


def get_investigation(inv_id: str) -> dict | None:
    with _lock:
        row = _db().execute("SELECT doc FROM investigations WHERE id=?", (inv_id,)).fetchone()
    return json.loads(row[0]) if row else None


def list_investigations(limit: int = 100) -> list[dict]:
    with _lock:
        rows = _db().execute("SELECT doc FROM investigations ORDER BY created DESC LIMIT ?", (limit,)).fetchall()
    return [json.loads(r[0]) for r in rows]


def log_event(kind: str, source: str, summary: str, data: dict | None = None) -> dict:
    ev = {"ts": time.time(), "kind": kind, "source": source, "summary": summary, "data": data or {}}
    with _lock:
        cur = _db().execute("INSERT INTO events (ts, kind, source, summary, data) VALUES (?,?,?,?,?)",
                            (ev["ts"], kind, source, summary, json.dumps(data or {}, default=str)))
        _db().commit()
    ev["id"] = cur.lastrowid
    return ev


def events(kind: str | None = None, limit: int = 100, since: float = 0) -> list[dict]:
    q, args = "SELECT id, ts, kind, source, summary, data FROM events WHERE ts >= ?", [since]
    if kind:
        q += " AND kind = ?"
        args.append(kind)
    q += " ORDER BY ts DESC LIMIT ?"
    args.append(limit)
    with _lock:
        rows = _db().execute(q, args).fetchall()
    return [{"id": r[0], "ts": r[1], "kind": r[2], "source": r[3], "summary": r[4], "data": json.loads(r[5] or "{}")} for r in rows]
