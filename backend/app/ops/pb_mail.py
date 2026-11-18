"""Playbook for use case 6: Microsoft Outlook / Exchange Online disruption (raised from the Manager portal).

The Operations Manager sees a predictive escalation in Operational Insights and raises it as an incident. The
engine opens a real ServiceNow incident and runs the normal pipeline. The cause is a Microsoft-side Exchange Online
outage; the IT Administrator approves notifying Microsoft and the email continuity workaround.

SIMULATED: the mail telemetry, logs, certificate inventory and service map below. There is no Microsoft tenant or
mail gateway in the lab, so every evidence item is marked "simulated". The values follow escalation.py, so the
manager's screen and the agents always agree. Remediation is simulated too (no real Microsoft case or continuity service).
"""

from . import escalation as esc
from .pb_base import Playbook, edge, eid, ev, node, test

T_TEL = "Mail service telemetry"
T_ESC = "Predictive escalation (Operational Insights)"
T_LOG = "Mail Transport connector log"
T_CERT = "Certificate inventory: outbound Exchange Online connector"
T_SVC = "Microsoft 365 Service Health: Exchange Online"
T_CHG = "Change calendar (last 24 hours)"
T_DNS = "DNS resolution of mail endpoints"
T_NET = "Branch network latency"
T_IDP = "Sign-in success for other applications"
T_MAP = "Service map for Outlook / Exchange Online"

DOWNSTREAM = ["Teams and Calendar", "Dispatch Notifications", "Customer Communications", "Branch Reporting"]


class MailPlaybook(Playbook):
    key, title = "mail", "Microsoft Outlook / Exchange Online disruption"
    component, facility = "Outlook / Exchange Online", "All sites"
    integrations = {"Predictive Intelligence (simulated)", "ServiceNow"}
    auto_investigate = False  # the Operations Manager raises it from Operational Insights
    reality = [{"item": "Mail telemetry, connector logs, certificate inventory and the service map are simulated (no Microsoft tenant in the lab)", "mode": "simulated"},
               {"item": "The predictive escalation follows the stage shown on the Manager portal's Operational Insights", "mode": "simulated"},
               {"item": "The ServiceNow incident, work notes, approval and resolution are real", "mode": "live"},
               {"item": "Remediation (certificate renewal and Mail Transport restart) is simulated", "mode": "simulated"}]

    def detect(self):
        if not esc.active():
            return None
        s, m = esc.state(), esc.metrics()
        st = esc.STAGES[s["stage"]]
        return {"key": "mail:exchange-online", "title": "Microsoft Outlook / Exchange Online disruption: email access and delivery degrading",
                "category": "predictive", "source": "Predictive Intelligence (simulated mail telemetry)", "component": self.component,
                "facility": self.facility, "severity": "critical" if s["stage"] >= 3 else "high", "risk_score": esc.RISK[s["stage"]],
                "metric": "Email connection failures", "current": f"{m['error_rate_pct']}%", "threshold": "0.5%",
                "eta_s": (4 - s["stage"]) * 1800 if s["stage"] < 4 else 0, "stage": st["name"], "metrics": m}

    def monitor(self, ctx):
        s, m = esc.state(), esc.metrics()
        st = esc.STAGES[s["stage"]]
        return {"analysis": f"Outlook / Exchange Online is {st['name'].lower()}: availability {m['availability_pct']}%, connection failures "
                            f"{m['error_rate_pct']}%, response delay {m['latency_ms']} ms.",
                "findings": [f"Escalation stage: {st['name']} (since {esc.STAGES[1]['time']})", f"Failed requests: {m['failed_per_min']}/min",
                             f"Related Microsoft 365 services with early warnings: {m['m365_warnings']} of 5"],
                "evidence": [ev("Mail telemetry (simulated)", T_TEL, m, "metric", "simulated"),
                             ev("Predictive Intelligence", T_ESC, {"stage": st["name"], "employees_affected": st["employees"], "risk": st["risk"],
                                                                   "next": esc.STAGES[min(4, s["stage"] + 1)]["name"]}, "event", "simulated")],
                "data": {**m, "stage": s["stage"]}, "tools": ["Mail telemetry (simulated)"], "next_step": "Compare with the baseline"}

    def anomaly(self, ctx):
        m = ctx["snapshot"]
        base = esc.metrics(0)
        return {"analysis": "Compared every mail signal with its baseline from 08:00 to 08:35.",
                "findings": [f"Connection failures {m['error_rate_pct']}% vs {base['error_rate_pct']}% normal",
                             f"Response delay {m['latency_ms']} ms vs {base['latency_ms']} ms normal",
                             f"Authentication errors {m['auth_errors_per_min']}/min vs {base['auth_errors_per_min']}/min normal"],
                "confidence": 0.9, "input_evidence": [eid(ctx, T_TEL)], "next_step": "Forecast the escalation"}

    def predict(self, ctx):
        s = esc.state()["stage"]
        nxt = esc.STAGES[min(4, s + 1)]
        pred = {"metric": "Escalation stage", "current": esc.STAGES[s]["name"], "threshold": "Potential Critical Impact",
                "eta_s": (4 - s) * 1800 if s < 4 else 0, "next": nxt["name"], "next_at": nxt["time"],
                "method": "Dependency-based forecast (simulated)"}
        txt = (f"Next: {nxt['name']} at about {nxt['time']}; Teams and Calendar, then dispatch notifications, then customer email are hit."
               if s < 4 else "The final predicted stage has been reached.")
        return {"analysis": txt, "findings": [txt], "prediction": pred, "confidence": 0.8, "input_evidence": [eid(ctx, T_ESC)],
                "next_step": "Collect logs and configuration"}

    def collect(self, ctx):
        health = {"service": "Exchange Online", "incident": "EX1042981", "status": "Service degradation",
                  "title": "Users may be unable to access or send email in Outlook", "started": "08:36", "scope": "Multiple tenants in the region",
                  "microsoft_update": "Microsoft is investigating a failure on part of the mailbox infrastructure"}
        logs = {"window": "08:38-08:45", "failed_connections": 2412, "timeouts_from_microsoft_pct": 91,
                "sample": "08:38:04 WARN mail-gw Exchange Online endpoint timed out (HTTP 503 from Microsoft)"}
        cert = {"subject": "CN=mail-gw.crystalclean.example", "not_after": "2027-03-14", "status": "VALID"}
        return {"analysis": "Read Microsoft 365 Service Health, the Mail Transport log, the certificate inventory, the change calendar, DNS, branch network and other sign-ins.",
                "findings": ["Microsoft 365 Service Health: active Exchange Online incident EX1042981 since 08:36",
                             "91% of failed connections are timeouts / HTTP 503 returned by Microsoft",
                             "Crystal Clean side is healthy: connector certificate valid, no changes, DNS and network normal"],
                "evidence": [ev("Microsoft 365 Service Health (simulated)", T_SVC, health, "event", "simulated"),
                             ev("Mail Transport (simulated)", T_LOG, logs, "log", "simulated"),
                             ev("Certificate inventory (simulated)", T_CERT, cert, "config", "simulated"),
                             ev("Change calendar (simulated)", T_CHG, {"changes": 0}, "record", "simulated"),
                             ev("DNS (simulated)", T_DNS, {"resolves": True, "ms": 12}, "state", "simulated"),
                             ev("Network monitor (simulated)", T_NET, {"latency_ms": 38, "normal": True}, "metric", "simulated"),
                             ev("Identity provider (simulated)", T_IDP, {"success_pct": 99.6, "normal": True}, "metric", "simulated")],
                "data": {"health": health, "logs": logs, "cert": cert, "changes": 0, "dns_ok": True, "net_ok": True, "idp_ok": True},
                "tools": ["Microsoft 365 Service Health", "Mail Transport log", "Certificate inventory", "Change calendar"], "next_step": "Map dependencies"}

    def dependencies(self, ctx):
        deps = {"affected": "Outlook / Exchange Online (Microsoft cloud)", "upstream": ["Microsoft Exchange Online servers", "Mail Transport", "Identity and Access"],
                "foundation": ["DNS", "Network / Branch Connectivity", "Supporting Infrastructure"], "downstream": DOWNSTREAM,
                "applications": ["Outlook", *DOWNSTREAM], "facilities": ["All branches"]}
        return {"analysis": "Every failing service depends on Exchange Online. Crystal Clean's own path to Microsoft (Mail Transport, DNS, network) is healthy.",
                "findings": ["Failure point: Microsoft Exchange Online servers (outside Crystal Clean)", f"Downstream at risk: {', '.join(DOWNSTREAM)}"],
                "evidence": [ev("Service map (demo CMDB)", T_MAP, deps, "config", "simulated")], "data": deps, "next_step": "Test candidate causes"}

    def hypotheses(self, ctx):
        e = ctx["evidence"]
        E = lambda t: eid(ctx, t)
        return [
            {"key": "microsoft_outage", "cause": "Microsoft Exchange Online server outage (Microsoft side, incident EX1042981)", "category": "provider",
             "tests": [test("Microsoft 365 Service Health reports an active Exchange Online incident", e["health"]["status"] != "Healthy",
                            f"{e['health']['incident']}: {e['health']['status']}", "active incident", E(T_SVC)),
                       test("Failures are timeouts / 503s returned by Microsoft", e["logs"]["timeouts_from_microsoft_pct"] >= 80,
                            f"{e['logs']['timeouts_from_microsoft_pct']}%", ">= 80%", E(T_LOG))]},
            {"key": "cert_expired", "cause": "Expired connector certificate on Crystal Clean's Mail Transport", "category": "configuration",
             "tests": [test("Connector certificate expired", e["cert"]["status"] == "EXPIRED", e["cert"]["status"], "EXPIRED", E(T_CERT))]},
            {"key": "change", "cause": "A recent deployment or configuration change", "category": "change",
             "tests": [test("Change in the last 24 hours", e["changes"] > 0, e["changes"], "> 0", E(T_CHG))]},
            {"key": "dns", "cause": "DNS cannot resolve the mail endpoints", "category": "network",
             "tests": [test("DNS resolution failing", not e["dns_ok"], e["dns_ok"], "False", E(T_DNS))]},
            {"key": "network", "cause": "Branch network / WAN problem", "category": "network",
             "tests": [test("Branch latency abnormal", not e["net_ok"], e["net_ok"], "False", E(T_NET))]},
            {"key": "identity", "cause": "Identity provider fault", "category": "identity",
             "tests": [test("Other applications fail to sign in", not e["idp_ok"], e["idp_ok"], "False", E(T_IDP))]},
        ]

    def impact(self, ctx):
        s = esc.state()["stage"]
        st = esc.STAGES[s]
        data = {"severity": "critical" if s >= 3 else "high", "risk_score": esc.RISK[s], "applications": ctx["deps"]["applications"],
                "facilities": ctx["deps"]["facilities"], "users_affected": st["employees"],
                "business_impact": f"About {st['employees']:,} employees have slow or failing email. Until Microsoft restores Exchange Online, Teams and Calendar "
                                   "fail next, then dispatch notifications to drivers, then customer communications."}
        return {"analysis": data["business_impact"], "findings": [f"Severity {data['severity']}", f"{st['employees']:,} employees affected now"],
                "confidence": 0.85, "data": data}

    def plan(self, ctx):
        if (ctx.get("cause") or {}).get("key") != "microsoft_outage":
            return {"analysis": "No safe automated action for this cause: handing over to the messaging team.", "data": None, "findings": ["Hand over"]}
        p = {"action": "Notify Microsoft and switch to the email continuity workaround until Microsoft restores Exchange Online",
             "gate": "remediation", "mode": "simulated",
             "steps": ["Open a Microsoft 365 support case and link it to service incident EX1042981",
                       "Activate the email continuity service: the backup mail gateway queues and delivers mail",
                       "Notify employees and managers: use Teams chat or phone for urgent messages",
                       "Watch Microsoft 365 Service Health and switch back when Exchange Online is restored"],
             "expected_outcome": "Email keeps flowing through the continuity service within about 10 minutes; full service returns when Microsoft fixes its servers",
             "risks": ["Continuity mail has no calendar or shared-mailbox features", "Mail sent during the switch-over may arrive twice"],
             "rollback": "Turn off the continuity service once Exchange Online is healthy"}
        return {"analysis": p["action"], "findings": p["steps"], "data": p, "next_step": "Request approval"}

    def execute(self, ctx, plan, gate):
        esc.fix(gate.get("by") or "IT approver")
        steps = [{"step": s, "ok": True} for s in plan["steps"]]
        return {"analysis": f"Done after approval by {gate['by']} (simulated): Microsoft notified (case linked to EX1042981), email continuity active, "
                            "employees informed; Microsoft has since restored Exchange Online.",
                "findings": [f"{s['step']}: done (simulated)" for s in steps],
                "evidence": [ev("Microsoft 365 / continuity (simulated)", "Workaround and Microsoft notification", steps, "action", "simulated")],
                "data": {"ok": True, "steps": steps}, "tools": ["Microsoft 365 support (simulated)", "Email continuity (simulated)"]}

    def verify(self, ctx):
        m = esc.metrics()
        ok = esc.passes(m)
        passed = all(ok.values())
        data = {"passed": passed, **m, "checks": ok, "source": "Mail telemetry after Microsoft restored Exchange Online (simulated)"}
        return {"analysis": ("Verified: " if passed else "Not verified: ") + f"Microsoft incident EX1042981 resolved; availability {m['availability_pct']}%, "
                            f"latency {m['latency_ms']} ms, connection failures {m['error_rate_pct']}%.",
                "findings": [f"{k.replace('_', ' ')}: {m[k]} {'✓' if v else '✗'}" for k, v in ok.items()],
                "evidence": [ev("Mail telemetry (simulated)", "Mail service after the fix", m, "metric", "simulated")],
                "data": data, "confidence": 0.95 if passed else 0.3, "tools": ["Mail telemetry (simulated)", "Microsoft 365 Service Health (simulated)"]}

    def breached(self, ctx):
        return esc.state()["stage"] >= 3

    def graph(self, ctx):
        cause = (ctx.get("cause") or {}).get("key")
        fixed = ctx.get("verified")
        E = lambda t: eid(ctx, t)
        n = [node("ms", "Microsoft Exchange Online servers", "service", "evidence", "resolved" if fixed else ("cause" if cause == "microsoft_outage" else "critical"), [E(T_SVC)]),
             node("exo", "Outlook / Exchange Online", "service", "monitoring", "resolved" if fixed else "critical", [E(T_TEL)]),
             node("mail", "Mail Transport (Crystal Clean)", "service", "evidence", "normal", [E(T_LOG), E(T_CERT)]),
             node("idp", "Identity and Access", "service", "evidence", "normal", [E(T_IDP)]),
             node("dns", "DNS", "service", "evidence", "normal", [E(T_DNS)]),
             node("net", "Branch network", "network", "evidence", "normal", [E(T_NET)])]
        n += [node(f"d{i}", name, "application", "dependency", "resolved" if fixed else "warning", [E(T_MAP)]) for i, name in enumerate(DOWNSTREAM)]
        e = [edge("ms", "exo", "hosts", "evidence", "cause" if cause == "microsoft_outage" and not fixed else "normal"),
             edge("mail", "exo", "delivers mail for", "evidence"), edge("idp", "exo", "signs in", "evidence"), edge("dns", "mail", "resolves", "evidence"),
             edge("net", "mail", "carries", "evidence")]
        e += [edge("exo", f"d{i}", "used by", "dependency") for i in range(len(DOWNSTREAM))]
        return {"nodes": n, "edges": e}
