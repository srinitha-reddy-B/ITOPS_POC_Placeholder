"""Thin Prometheus HTTP API client (instant and range queries)."""

import time

import httpx

from . import config


class PromError(Exception):
    pass


def _get(path: str, params: dict) -> dict:
    try:
        r = httpx.get(f"{config.PROMETHEUS_URL}{path}", params=params, timeout=6)
        r.raise_for_status()
        j = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise PromError(f"Prometheus unavailable: {type(exc).__name__}") from exc
    if j.get("status") != "success":
        raise PromError(j.get("error", "query failed"))
    return j["data"]


def query(expr: str) -> list[dict]:
    """[{labels: {...}, value: float}] for an instant query."""
    data = _get("/api/v1/query", {"query": expr})
    out = []
    for row in data.get("result", []):
        try:
            v = float(row["value"][1])
        except (KeyError, ValueError, IndexError):
            continue
        if v != v:  # NaN
            continue
        out.append({"labels": row.get("metric", {}), "value": v})
    return out


def scalar(expr: str) -> float | None:
    rows = query(expr)
    return rows[0]["value"] if rows else None


def series(expr: str, minutes: float = 15, step: float = 5) -> list[dict]:
    """[{labels, points: [[unix, value], ...]}] for a range query over the last N minutes."""
    end = time.time()
    data = _get("/api/v1/query_range", {"query": expr, "start": end - minutes * 60, "end": end, "step": step})
    out = []
    for row in data.get("result", []):
        pts = []
        for t, v in row.get("values", []):
            try:
                f = float(v)
            except ValueError:
                continue
            if f == f:
                pts.append([float(t), f])
        out.append({"labels": row.get("metric", {}), "points": pts})
    return out


def targets() -> list[dict]:
    data = _get("/api/v1/targets", {"state": "active"})
    return [{"job": t["labels"].get("job"), "instance": t["labels"].get("instance"), "health": t.get("health"),
             "last_scrape": t.get("lastScrape"), "error": t.get("lastError") or ""} for t in data.get("activeTargets", [])]


def scalar_at(expr: str, at: float) -> float | None:
    """Instant value of an expression evaluated at a past time."""
    try:
        data = _get("/api/v1/query", {"query": expr, "time": at})
    except PromError:
        return None
    for row in data.get("result", []):
        try:
            v = float(row["value"][1])
            if v == v:
                return v
        except (KeyError, ValueError, IndexError):
            pass
    return None
