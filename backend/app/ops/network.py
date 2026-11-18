"""Use case 4 lab: a controllable branch WAN link, measured for real.

    Blackbox probe  ->  Toxiproxy proxy (the "branch gateway" link)  ->  branch services host (127.0.0.1:8091)

* The branch services host is a tiny HTTP service run by this backend. It stands in for the data-center
  apps a branch reaches over its VPN (ERP access, file share).
* Each branch link is a Toxiproxy proxy. Faults are real Toxiproxy "toxics": added latency, a share of
  connections that stall (seen by the probe as loss), or the link disabled (outage).
* Blackbox Exporter probes every link through its proxy, and the host directly. Prometheus stores it.
  Because the direct probe bypasses the link, the agents can tell a link fault from a service fault.

This is a demonstration environment on this machine, not Crystal Clean's branch network. The UI says so.
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx

from . import config

LINKS = {
    "chi-north-erp": {"facility": "CC-CHICAGO-NORTH", "gateway": "CHI-NORTH-GW01", "service": "Branch ERP access", "listen": 18101},
    "chi-north-files": {"facility": "CC-CHICAGO-NORTH", "gateway": "CHI-NORTH-GW01", "service": "Branch file share", "listen": 18102},
    "indy-erp": {"facility": "CC-INDIANAPOLIS", "gateway": "IND-GW01", "service": "Branch ERP access", "listen": 18201},
}
FAULTS = {
    "normal": "Normal connectivity",
    "latency": "High latency (about 850 ms added, ±150 ms jitter)",
    "loss": "High latency and about 25% of connections stalling (probe loss)",
    "outage": "Link down (VPN tunnel disabled)",
}
_state = {"fault": "normal", "since": time.time()}
_server: ThreadingHTTPServer | None = None


class _Branch(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        body = json.dumps({"status": "ok", "host": "dc-branch-services", "time": time.time()}).encode()
        self.send_response(200 if self.path.startswith("/health") else 404)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def start_branch_host() -> None:
    global _server
    if _server:
        return
    try:
        _server = ThreadingHTTPServer(("127.0.0.1", config.BRANCH_PORT), _Branch)
    except OSError:  # already running (e.g. another backend process); fine
        return
    threading.Thread(target=_server.serve_forever, daemon=True, name="branch-host").start()


def _tp(method: str, path: str, **kw):
    r = httpx.request(method, f"{config.TOXIPROXY_URL}{path}", timeout=4, **kw)
    if r.status_code >= 400 and r.status_code != 409:
        r.raise_for_status()
    return r.json() if r.content else None


def ensure_links() -> bool:
    """Create the Toxiproxy proxies if missing. Returns False when Toxiproxy isn't running."""
    try:
        have = _tp("GET", "/proxies") or {}
    except httpx.HTTPError:
        return False
    for name, l in LINKS.items():
        if name not in have:
            _tp("POST", "/proxies", json={"name": name, "listen": f"127.0.0.1:{l['listen']}",
                                          "upstream": f"127.0.0.1:{config.BRANCH_PORT}", "enabled": True})
    return True


def links() -> list[dict]:
    """Live link configuration as Toxiproxy holds it (this is the gateway's real config in the lab)."""
    have = _tp("GET", "/proxies") or {}
    out = []
    for name, meta in LINKS.items():
        p = have.get(name)
        out.append({"name": name, **meta, "present": bool(p), "enabled": bool(p and p.get("enabled")),
                    "toxics": [{"type": t["type"], "toxicity": t.get("toxicity", 1), **t.get("attributes", {})}
                               for t in (p or {}).get("toxics", [])]})
    return out


def set_fault(fault: str, facility: str = "CC-CHICAGO-NORTH") -> dict:
    if fault not in FAULTS:
        raise ValueError(f"unknown fault '{fault}'")
    if not ensure_links():
        raise RuntimeError("Toxiproxy is not running (start it with scripts\\start_ops_stack.ps1)")
    names = [n for n, l in LINKS.items() if l["facility"] == facility]
    for n in names:
        p = (_tp("GET", f"/proxies/{n}") or {})
        for t in p.get("toxics", []):
            _tp("DELETE", f"/proxies/{n}/toxics/{t['name']}")
        _tp("POST", f"/proxies/{n}", json={"enabled": fault != "outage"})
        if fault in ("latency", "loss"):
            _tp("POST", f"/proxies/{n}/toxics", json={"name": "wan-latency", "type": "latency", "stream": "downstream",
                                                      "toxicity": 1.0, "attributes": {"latency": 850, "jitter": 150}})
        if fault == "loss":
            _tp("POST", f"/proxies/{n}/toxics", json={"name": "wan-loss", "type": "timeout", "stream": "upstream",
                                                      "toxicity": 0.25, "attributes": {"timeout": 6000}})
    _state.update(fault=fault, since=time.time(), facility=facility)
    return {"fault": fault, "label": FAULTS[fault], "links": names}


def state() -> dict:
    return {**_state, "label": FAULTS.get(_state["fault"], "")}


def health() -> dict:
    try:
        v = _tp("GET", "/version")
        ok = ensure_links()
        return {"ok": ok, "detail": f"Toxiproxy {v.get('version', '') if isinstance(v, dict) else v or ''}".strip(), "links": len(LINKS)}
    except (httpx.HTTPError, ValueError) as exc:
        return {"ok": False, "detail": f"not reachable ({type(exc).__name__})"}
