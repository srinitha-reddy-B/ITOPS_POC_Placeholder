"""RouteOps Dispatch API: a small, real HTTP service that the Service Hub monitors and repairs.

It stands in for the dispatch API behind the drivers' RouteOps Mobile app. It holds a database
connection pool of 50. The nightly manifest-export job has a bug: when it runs it takes a pool
connection every few seconds and never returns it. Requests slow down as the pool fills, and once
it is exhausted every request fails with HTTP 503, so drivers can't load their routes. A restart
clears the pool; starting with --export-job off keeps the faulty job paused until it is patched.

Run by the backend (app/cc_routeops.py), not by hand:
    python -m app.cc_routeops_service --port 8090 --log <file> --export-job on|off
"""

import argparse
import json
import logging
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

POOL_MAX = 50
BASELINE = 12
LEAK_EVERY_S = 2.5
VERSION = "3.2.1"


class State:
    in_use = BASELINE
    leaking = False
    export_enabled = True
    started = time.time()


log = logging.getLogger("routeops")


def _leak_loop() -> None:
    while True:
        time.sleep(LEAK_EVERY_S)
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
        if State.in_use >= 38:
            log.warning("DB pool usage high: %d/%d connections in use", State.in_use, POOL_MAX)
        return True

    def do_GET(self):
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
        if self.path == "/admin/fault":
            if not State.export_enabled:
                self._send(409, {"error": "export job is paused"})
                return
            State.leaking = True
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
