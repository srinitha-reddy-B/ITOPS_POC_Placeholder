"""RouteOps Dispatch API: a small, real HTTP service that the Service Hub monitors and repairs.

It stands in for the dispatch API behind the drivers' RouteOps Mobile app. It holds a database
connection pool of 50. The nightly manifest-export job has a bug: when it runs it takes a pool
connection every few seconds and never returns it. Requests slow down as the pool fills, and once
it is exhausted every request fails with HTTP 503, so drivers can't load their routes. A restart
clears the pool; starting with --export-job off keeps the faulty job paused until it is patched.

Run by the backend (app/ops/routeops.py), not by hand:
    python -m app.ops.routeops_service --port 8090 --log <file> --export-job on|off
"""

import argparse
import json
import logging
import os
import random
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

POOL_MAX = 50
BASELINE = 12
LEAK_EVERY_S = 2.5
VERSION = "3.2.1"


BUCKETS = (0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 3.0, 5.0)


class Metrics:
    """Prometheus counters, written by hand so the service needs no extra packages."""
    lock = threading.Lock()
    requests: dict = {}      # (route, code) -> count
    hist: dict = {}          # route -> [bucket counts..., +Inf count, sum]

    @classmethod
    def observe(cls, route: str, code: int, seconds: float) -> None:
        with cls.lock:
            cls.requests[(route, code)] = cls.requests.get((route, code), 0) + 1
            h = cls.hist.setdefault(route, [0] * (len(BUCKETS) + 1) + [0.0])
            for i, b in enumerate(BUCKETS):
                if seconds <= b:
                    h[i] += 1
            h[len(BUCKETS)] += 1
            h[-1] += seconds

    @classmethod
    def render(cls) -> str:
        out = ["# HELP routeops_http_requests_total Requests served, by route and HTTP status.",
               "# TYPE routeops_http_requests_total counter"]
        with cls.lock:
            for (route, code), n in sorted(cls.requests.items()):
                out.append(f'routeops_http_requests_total{{route="{route}",code="{code}"}} {n}')
            out += ["# HELP routeops_http_request_duration_seconds Request latency.",
                    "# TYPE routeops_http_request_duration_seconds histogram"]
            for route, h in sorted(cls.hist.items()):
                for i, b in enumerate(BUCKETS):
                    out.append(f'routeops_http_request_duration_seconds_bucket{{route="{route}",le="{b}"}} {h[i]}')
                out.append(f'routeops_http_request_duration_seconds_bucket{{route="{route}",le="+Inf"}} {h[len(BUCKETS)]}')
                out.append(f'routeops_http_request_duration_seconds_count{{route="{route}"}} {h[len(BUCKETS)]}')
                out.append(f'routeops_http_request_duration_seconds_sum{{route="{route}"}} {h[-1]:.4f}')
        out += ["# HELP routeops_db_pool_in_use Database connections in use.", "# TYPE routeops_db_pool_in_use gauge",
                f"routeops_db_pool_in_use {State.in_use}",
                "# HELP routeops_db_pool_max Database pool size.", "# TYPE routeops_db_pool_max gauge",
                f"routeops_db_pool_max {POOL_MAX}",
                "# HELP routeops_export_job_running 1 while the nightly manifest-export job runs.",
                "# TYPE routeops_export_job_running gauge", f"routeops_export_job_running {int(State.leaking)}",
                "# HELP routeops_export_job_enabled 0 when the job is paused.", "# TYPE routeops_export_job_enabled gauge",
                f"routeops_export_job_enabled {int(State.export_enabled)}",
                "# HELP routeops_start_time_seconds Process start time.", "# TYPE routeops_start_time_seconds gauge",
                f"routeops_start_time_seconds {State.started:.0f}"]
        return "\n".join(out) + "\n"


class State:
    in_use = BASELINE
    leaking = False
    leak_every = LEAK_EVERY_S
    export_enabled = True
    started = time.time()


log = logging.getLogger("routeops")


def _leak_loop() -> None:
    while True:
        time.sleep(State.leak_every)
        if State.leaking and State.in_use < POOL_MAX:
            State.in_use += 1
            log.warning("ReportExportJob: DB connection not returned to pool (job=nightly-manifest-export, in_use=%d/%d)",
                        State.in_use, POOL_MAX)
            if State.in_use == POOL_MAX:
                log.error("DB connection pool exhausted (%d/%d in use)", POOL_MAX, POOL_MAX)


class Handler(BaseHTTPRequestHandler):
    server_version = f"RouteOps-Dispatch/{VERSION}"

    def log_message(self, fmt, *args):  # access log off; the service logs what matters
        pass

    def _send(self, code: int, body: dict) -> None:
        self._code = code
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _gate(self, what: str) -> bool:
        """Simulates acquiring a pool connection: slower as the pool fills, fails when it is exhausted."""
        if State.in_use >= POOL_MAX:
            time.sleep(1.5)
            log.error("Timeout acquiring DB connection from pool (%d/%d in use) - %s failed with 503", State.in_use, POOL_MAX, what)
            self._send(503, {"status": "down", "error": "DB connection pool exhausted", "pool_in_use": State.in_use, "pool_max": POOL_MAX})
            return False
        time.sleep(0.02 + max(0, State.in_use - 30) * 0.03)
        if State.in_use >= 42 and random.random() < (State.in_use - 41) / 9 * 0.5:  # some requests time out before the pool is full
            time.sleep(0.8)
            log.error("Timeout acquiring DB connection (%d/%d in use) - %s failed with 503", State.in_use, POOL_MAX, what)
            self._send(503, {"status": "degraded", "error": "DB connection timeout", "pool_in_use": State.in_use, "pool_max": POOL_MAX})
            return False
        if State.in_use >= 38:
            log.warning("DB pool usage high: %d/%d connections in use", State.in_use, POOL_MAX)
        return True

    def do_GET(self):
        if self.path == "/metrics":
            data = Metrics.render().encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        route = "/routes/today" if self.path.startswith("/routes/today") else self.path if self.path == "/health" else "other"
        self._code, t0 = 0, time.time()
        try:
            self._get()
        finally:
            Metrics.observe(route, self._code, time.time() - t0)

    def _get(self):
        if self.path == "/health":
            if self._gate("GET /health"):
                self._send(200, {"status": "ok", "version": VERSION, "pool_in_use": State.in_use, "pool_max": POOL_MAX,
                                 "uptime_s": int(time.time() - State.started), "export_job": "running" if State.leaking else
                                 ("paused" if not State.export_enabled else "idle")})
        elif self.path.startswith("/routes/today"):
            if self._gate("GET /routes/today"):
                log.info("Served today's route (3 stops)")
                self._send(200, {"date": time.strftime("%Y-%m-%d"), "stops": [
                    {"seq": 1, "customer": "Northside Auto Care", "service": "Parts washer service"},
                    {"seq": 2, "customer": "Eastgate Fleet Garage", "service": "Used oil pickup"},
                    {"seq": 3, "customer": "Lakeview Machine Works", "service": "Drum waste pickup"}]})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.startswith("/admin/fault"):
            if not State.export_enabled:
                self._send(409, {"error": "export job is paused"})
                return
            State.leaking = True
            if "every=" in self.path:  # optional slower leak, e.g. /admin/fault?every=4
                try:
                    State.leak_every = max(0.5, float(self.path.split("every=", 1)[1].split("&")[0]))
                except ValueError:
                    pass
            log.info("ReportExportJob started (job=nightly-manifest-export)")
            self._send(200, {"ok": True})
        elif self.path == "/admin/shutdown":
            log.info("Shutdown requested; stopping RouteOps Dispatch API")
            self._send(200, {"ok": True})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
        else:
            self._send(404, {"error": "not found"})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8090)
    ap.add_argument("--log", required=True)
    ap.add_argument("--export-job", choices=["on", "off"], default="on")
    a = ap.parse_args()
    logging.basicConfig(filename=a.log, level=logging.INFO, format="%(asctime)s %(levelname)-5s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    State.export_enabled = a.export_job == "on"
    log.info("RouteOps Dispatch API v%s started (pid=%d, port=%d, db_pool_max=%d, export_job=%s)",
             VERSION, os.getpid(), a.port, POOL_MAX, "enabled" if State.export_enabled else "paused")
    threading.Thread(target=_leak_loop, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", a.port), Handler).serve_forever()
    log.info("RouteOps Dispatch API stopped")


if __name__ == "__main__":
    main()
