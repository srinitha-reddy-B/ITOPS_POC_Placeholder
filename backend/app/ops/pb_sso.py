"""Playbook for use case 2: workforce SSO disruption and identity access (real Keycloak).

The detector raises two different kinds of alert and the agents keep them apart:
  sso:user:<name>   identity-access incident: one account cannot sign in (disabled, locked, wrong password).
                    Not a predictive infrastructure failure; the prediction agent says so.
  sso:disruption    many users failing at once, or Keycloak itself unavailable: an SSO service disruption.
"""

import time

import httpx

from . import config, identity, sso_service, store
from .pb_base import Playbook, edge, eid, ev, node, q, r, test, wait_until

T_KC = "Keycloak availability"
T_ACC = "Keycloak account state"
T_EVT = "Keycloak sign-in events for the user"
T_ADM = "Keycloak admin events for the user"
T_OTHERS = "Other users' sign-ins (same period)"
T_APP = "RouteOps Mobile sign-in log (handheld app)"
T_KCERR = "Keycloak sign-in errors by reason"
T_CLIENT = "Keycloak client configuration: routeops-mobile"
T_CHG = "Recent identity change records"
T_MAP = "Service map for SSO"
T_SVC = "Sign-in service process and port"
T_SVCLOG = "Sign-in service log (last lines)"
T_HOSTSVC = "Other services on the identity server"


def _admin_events(resource_prefix: str, n: int = 20) -> list[dict]:
    try:
        rows = identity._req("GET", "/admin-events", params={"max": 100}) or []
    except httpx.HTTPError:
        return []
    out = []
    for e in rows:
        if str(e.get("resourcePath", "")).startswith(resource_prefix):
            out.append({"at": time.strftime("%H:%M:%S", time.localtime(int(e["time"]) / 1000)), "operation": e.get("operationType"),
                        "resource": e.get("resourcePath"), "by_user_id": (e.get("authDetails") or {}).get("userId", "")[:8]})
    return out[:n]


def _up(url: str) -> bool:
    try:
        return httpx.get(url, timeout=3).status_code < 400
    except httpx.HTTPError:
        return False


def _kc_probe() -> float | None:
    return q('avg_over_time(probe_success{service="Keycloak SSO"}[1m])')


class SsoPlaybook(Playbook):
    key, title = "sso", "Workforce SSO and identity access"
    component, facility = "Keycloak (realm crystal-clean)", "Identity platform"
    integrations = {"Keycloak", "Prometheus", "Blackbox Exporter"}
    # Monitoring raises the alert, but the ticket is raised when an employee reports it through the IT Help Desk
    auto_investigate = False
    reality = [{"item": "Sign-in, denial, account state, roles and admin events all come from the real Keycloak", "mode": "live"},
               {"item": "Personas (Dana Whitfield, Jordan Patel, Alex Romero) and field technicians are demo users in a demo realm", "mode": "lab"},
               {"item": "Handheld sign-in traffic: real Keycloak sign-ins generated every 5 s for three technicians", "mode": "simulated"},
               {"item": "The SSO disruption is a real configuration change on the routeops-mobile client", "mode": "lab"},
               {"item": "Account and client changes are made through Keycloak's admin API only after approval", "mode": "live"}]

    # ---------------------------------------------------------- detection
    def _current_failing_users(self) -> tuple[list, list]:
        last = {}
        for a in reversed(identity.app_log(60)):
            last[a["user"]] = a
        fail = [u for u, a in last.items() if not a["ok"] and time.time() - a["ts"] < 60]
        ok = [u for u, a in last.items() if a["ok"] and time.time() - a["ts"] < 60]
        return fail, ok

    def detect(self):
        kc = _kc_probe()
        fail, ok = self._current_failing_users()
        down = (kc is not None and kc < 0.5) or not sso_service.responding()
        if down or len(fail) >= min(config.AUTH_MULTI_USER_WARN, len(identity.FIELD_TECHS)):
            title = ("Sign-in service not responding: employees can't sign in" if down
                     else f"SSO disruption: {len(fail)} of {len(fail) + len(ok)} handheld users failing to sign in")
            return {"key": "sso:disruption", "title": title, "category": "incident", "source": "Blackbox probe + sign-in attempts",
                    "component": "Keycloak (sign-in service)" if down else "routeops-mobile / Keycloak", "facility": "All sites",
                    "severity": "critical", "risk_score": 92 if down else 88,
                    "metric": "Users failing", "current": f"{len(fail)}/{len(fail) + len(ok)}", "threshold": f">= {config.AUTH_MULTI_USER_WARN}",
                    "eta_s": None, "subtype": "disruption", "metrics": {"failing": fail, "ok": ok, "kc_probe": kc}}
        # single user: a persona was denied recently and Keycloak still has the account blocked
        for e in identity.recent(15, identity.CONSOLE_CLIENT):
            if e["type"] != "LOGIN_ERROR":
                continue
            user = e["username"] or next((u for u in identity.PERSONAS if identity._uid(u) == e["user_id"]), "")
            if user not in identity.PERSONAS:
                continue
            try:
                acc = identity.account(user)
            except (httpx.HTTPError, ValueError):
                continue
            if acc["status"] == "ACTIVE" and e["error"] != "invalid_user_credentials":
                continue
            if acc["status"] == "ACTIVE":
                fails = [x for x in identity.recent(10, identity.CONSOLE_CLIENT) if x["type"] == "LOGIN_ERROR" and x["username"] == user]
                later_ok = [x for x in identity.recent(10, identity.CONSOLE_CLIENT) if x["type"] == "LOGIN" and x["user_id"] == acc["id"] and x["ts"] > e["ts"]]
                if len(fails) < config.AUTH_FAIL_WARN or later_ok:
                    continue
            p = identity.PERSONAS[user]
            return {"key": f"sso:user:{user}", "title": f"Identity access: {p['name']} denied sign-in ({e['reason'] or e['error']})",
                    "category": "identity", "source": "Keycloak event log", "component": f"Account {user}", "facility": p["facility"],
                    "severity": "medium", "risk_score": 45, "metric": "Sign-in result", "current": e["error"], "threshold": "successful sign-in",
                    "eta_s": None, "subtype": "user", "username": user, "metrics": {"error": e["error"], "status": acc["status"]}}
        return None

    def _sub(self, ctx) -> str:
        return ctx["alert"].get("subtype") or ("disruption" if ctx["alert"]["key"] == "sso:disruption" else "user")

    # ---------------------------------------------------------- agents
    def monitor(self, ctx):
        kc = _kc_probe()
        st = identity.window_stats(15)
        h = identity.health()
        return {"analysis": f"Keycloak {'is reachable' if h['ok'] else 'is NOT reachable'}; {st['failures']} failed of {st['attempts']} sign-ins in "
                            f"15 min; handheld app: {st['handheld_app']['failures']} failures.",
                "findings": [f"Keycloak availability (probe, 1 min): {r((kc or 0) * 100)}%", f"Sign-in failure rate: {st['failure_rate_pct']}%",
                             f"Failures by reason: {st['by_reason'] or 'none'}"],
                "evidence": [ev("Keycloak / Blackbox", T_KC, {"reachable": h["ok"], "probe_success_pct": r((kc or 0) * 100), "realm": config.KEYCLOAK_REALM}),
                             ev("Keycloak", T_KCERR, st)], "data": st, "tools": ["Keycloak admin API (events)", "Prometheus"], "next_step": "Find the pattern"}

    def anomaly(self, ctx):
        sub = self._sub(ctx)
        st = ctx["snapshot"]
        if sub == "user":
            u = ctx["alert"]["username"]
            return {"analysis": f"The failures are concentrated on one account ({u}); other users sign in normally.",
                    "findings": ["Pattern: single user", f"Error: {ctx['alert']['metrics'].get('error')}", "Classified as an identity-access incident, not an infrastructure failure"],
                    "confidence": 0.85, "classification": "identity-access incident", "input_evidence": [eid(ctx, T_KCERR)], "next_step": "Check history"}
        app = st["handheld_app"]
        return {"analysis": f"Failures across {len(app['users_failing'])} different users of the same app at the same time: a service-level pattern.",
                "findings": ["Pattern: many users, one application", f"Users failing: {', '.join(app['users_failing'])}", f"Errors: {app['errors']}"],
                "confidence": 0.85, "classification": "SSO disruption", "input_evidence": [eid(ctx, T_KCERR)], "next_step": "Check history"}

    def predict(self, ctx):
        if self._sub(ctx) == "user":
            return {"analysis": "Not a predictive failure: an account state set by an administrator or the lockout policy. "
                                "There is no infrastructure trend to project.",
                    "findings": ["Prediction not applicable (identity-access incident)"],
                    "prediction": {"metric": "n/a", "meaningful": False, "method": "Not applicable"}, "confidence": None, "next_step": "Collect evidence"}
        app = ctx["snapshot"]["handheld_app"]
        return {"analysis": "Every handheld sign-in is failing. Technicians already signed in keep working until their session expires; "
                            "after that, every field technician is locked out of RouteOps Mobile.",
                "findings": [f"{len(app['users_failing'])} users already failing", "Remaining users fail as sessions expire (Keycloak session lifetime)"],
                "prediction": {"metric": "Handheld users unable to sign in", "current": len(app["users_failing"]), "threshold": "all field users",
                               "eta_s": None, "method": "Session expiry", "meaningful": True},
                "confidence": 0.7, "next_step": "Collect evidence"}

    def history(self):
        st = identity.window_stats(60)
        return {"data": {"sign_ins_last_hour": st["attempts"], "failures_last_hour": st["failures"]},
                "findings": [f"Last hour: {st['attempts']} sign-ins, {st['failures']} failures in Keycloak's event log"], "tools": ["Keycloak events"]}

    def collect(self, ctx):
        if self._sub(ctx) == "user":
            u = ctx["alert"]["username"]
            acc = identity.account(u)
            evs = [{"at": time.strftime("%H:%M:%S", time.localtime(e["ts"])), "type": e["type"], "client": e["client"], "error": e["error"],
                    "reason": e["reason"], "ip": e["ip"]} for e in identity.recent(60) if e["user_id"] == acc["id"] or e["username"] == u][:15]
            adm = _admin_events(f"users/{acc['id']}")
            others = [{"user": p["username"], "status": p.get("status")} for p in identity.personas() if p["username"] != u]
            ok_others = sorted({e["username"] or e["user_id"][:8] for e in identity.recent(60, identity.CONSOLE_CLIENT) if e["type"] == "LOGIN" and e["user_id"] != acc["id"]})
            return {"analysis": f"Read {u}'s account state, sign-in events and admin changes from Keycloak, and compared with other users.",
                    "findings": [f"Account: {acc['status']} (enabled={acc['enabled']}, locked={acc['brute_force_locked']})", f"{len(evs)} sign-in events",
                                 f"{len(adm)} admin change(s) on the account", f"Other users signing in: {len(ok_others)}"],
                    "evidence": [ev("Keycloak", T_ACC, {k: acc[k] for k in ("username", "status", "enabled", "brute_force_locked", "failures", "roles")}),
                                 ev("Keycloak", T_EVT, evs, "event"), ev("Keycloak", T_ADM, adm, "event"),
                                 ev("Keycloak", T_OTHERS, {"personas": others, "successful_console_sign_ins_by": ok_others}, "event")],
                    "data": {"acc": acc, "events": evs, "admin": adm, "ok_others": ok_others}, "tools": ["Keycloak admin API"], "next_step": "Map dependencies"}
        app = identity.app_log(30)
        st = ctx["snapshot"]
        try:
            cl = identity.handheld_client()
        except (httpx.HTTPError, ValueError):
            cl = {}
        cl_id = identity._client(identity.HANDHELD_CLIENT)["id"] if cl else ""
        adm = _admin_events(f"clients/{cl_id}") if cl_id else []
        chg = [{"at": time.strftime("%H:%M:%S", time.localtime(e["ts"])), "summary": e["summary"]} for e in store.events("change", 10, time.time() - 7200)
               if "Keycloak" in e["summary"] or "routeops-mobile" in e["summary"]]
        console_ok = sum(1 for e in identity.recent(15, identity.CONSOLE_CLIENT) if e["type"] == "LOGIN")
        svc = sso_service.state()
        lines = sso_service.log_tail(12)
        host = {"routeops_dispatch": _up("http://127.0.0.1:8090/health"), "prometheus": _up(f"{config.PROMETHEUS_URL}/-/ready"),
                "grafana": _up(f"{config.GRAFANA_URL}/api/health")}
        extra = [ev("Identity server", T_SVC, svc, "state"),
                 ev("Identity server", T_SVCLOG, {"lines": lines, "clean_shutdown_logged": sso_service.clean_shutdown_logged()}, "log"),
                 ev("Identity server", T_HOSTSVC, host, "state")]
        return {"analysis": "Checked the sign-in service's process, port and log, the other services on the same server, the handheld app's "
                            "sign-in log, Keycloak's errors and the client configuration.",
                "findings": [f"Client direct sign-in allowed: {cl.get('direct_access_grants')}", f"{len(adm)} admin change(s) on the client",
                             f"Ops Console sign-ins still succeeding: {console_ok}"],
                "evidence": [ev("RouteOps Mobile", T_APP, [{"at": time.strftime("%H:%M:%S", time.localtime(a["ts"])), "user": a["user"], "ok": a["ok"],
                                                            "error": a["error"]} for a in app[:12]], "log", "lab"),
                             ev("Keycloak", T_CLIENT, cl, "config"), ev("Keycloak", "Keycloak admin events for the client", adm, "event"),
                             ev("Change log", T_CHG, chg, "event", "lab"),
                             ev("Keycloak", "Other applications' sign-ins", {"ops_console_successful_sign_ins_15m": console_ok}, "event")] + extra,
                "data": {"client": cl, "admin": adm, "chg": chg, "console_ok": console_ok, "st": st, "svc": svc, "host": host,
                         "clean_shutdown": sso_service.clean_shutdown_logged()},
                "tools": ["Process and port check", "Service log", "Keycloak admin API"], "next_step": "Map dependencies"}

    def dependencies(self, ctx):
        if self._sub(ctx) == "user":
            u = ctx["alert"]["username"]
            p = identity.PERSONAS[u]
            deps = {"user": p["name"], "title": p["title"], "facility": p["facility"], "applications": ["Ops Console", "Internal business apps behind SSO"],
                    "identity_provider": "Keycloak realm crystal-clean"}
            return {"analysis": f"{p['name']} ({p['title']}, {p['facility']}) reaches internal applications only through Keycloak SSO.",
                    "findings": [f"Blast radius: 1 user ({p['name']})", "Applications: Ops Console and other SSO apps"],
                    "evidence": [ev("Service map (demo CMDB)", T_MAP, deps, "config", "simulated")], "data": deps, "next_step": "Test candidate causes"}
        deps = {"application": "RouteOps Mobile (client routeops-mobile)", "users": identity.FIELD_TECHS + ["all field technicians in production"],
                "facilities": ["All field branches"], "identity_provider": "Keycloak realm crystal-clean"}
        return {"analysis": "All field technicians sign in to RouteOps Mobile through the routeops-mobile client.",
                "findings": ["Blast radius: every handheld user", "Other SSO applications: separate clients"],
                "evidence": [ev("Service map (demo CMDB)", T_MAP, deps, "config", "simulated")], "data": deps, "next_step": "Test candidate causes"}

    def hypotheses(self, ctx):
        E = lambda t: eid(ctx, t)
        kc = _kc_probe()
        kc_ok = kc is None or kc >= 0.9
        if self._sub(ctx) == "user":
            d = ctx["evidence"]
            acc, evs = d["acc"], d["events"]
            errs = [e["error"] for e in evs if e["type"] == "LOGIN_ERROR"]
            disabled_by_admin = any(a["operation"] == "UPDATE" for a in d["admin"])
            return [
                {"key": "account_disabled", "cause": "The account was disabled by an administrator", "category": "identity access",
                 "tests": [test("Keycloak account is disabled", not acc["enabled"], acc["enabled"], "False", E(T_ACC)),
                           test("Keycloak denied with user_disabled", "user_disabled" in errs, sorted(set(errs)), "user_disabled", E(T_EVT)),
                           test("An admin change on the account", disabled_by_admin, len(d["admin"]), ">= 1 UPDATE", E(T_ADM), required=False)]},
                {"key": "locked", "cause": "The account is locked after repeated failed sign-ins", "category": "identity access",
                 "tests": [test("Brute-force lock active", acc["brute_force_locked"], acc["brute_force_locked"], "True", E(T_ACC))]},
                {"key": "wrong_password", "cause": "The user is entering a wrong password", "category": "user error",
                 "tests": [test("Repeated invalid credentials", errs.count("invalid_user_credentials") >= config.AUTH_FAIL_WARN,
                                errs.count("invalid_user_credentials"), f">= {config.AUTH_FAIL_WARN}", E(T_EVT)),
                           test("Account enabled", acc["enabled"], acc["enabled"], "True", E(T_ACC))]},
                {"key": "missing_role", "cause": "The user lacks the role the application requires", "category": "authorisation",
                 "tests": [test("Account has no Ops Console role", not acc["roles"], acc["roles"], "no ops-* role", E(T_ACC))]},
                {"key": "idp_down", "cause": "Keycloak (the identity provider) is unavailable", "category": "availability",
                 "tests": [test("Keycloak probe failing", not kc_ok, r((kc or 0) * 100), "< 90%", E(T_KC)),
                           test("No other user can sign in", not d["ok_others"], len(d["ok_others"]), "0", E(T_OTHERS))]},
            ]
        d = ctx["evidence"]
        st = d["st"]
        svc, host = d.get("svc", {}), d.get("host", {})
        app_errs = st["handheld_app"]["errors"]
        client_errs = {k: v for k, v in st["by_reason"].items() if k in ("not_allowed", "unauthorized_client", "invalid_client", "client_disabled")}
        host_ok = bool(host) and all(host.values())
        return [
            {"key": "sso_down", "cause": "The sign-in service (Keycloak) stopped running on the identity server", "category": "infrastructure",
             "tests": [test("Sign-in service not answering", not svc.get("responding", True), svc.get("responding"), "False", E(T_SVC)),
                       test("Nothing listening on the sign-in port (connection refused)", svc.get("connection") == "refused",
                            svc.get("connection"), "refused", E(T_SVC)),
                       test("Other services on the same server are healthy", host_ok, host, "all up", E(T_HOSTSVC), required=False),
                       test("No clean shutdown recorded in the service log", not d.get("clean_shutdown"), not d.get("clean_shutdown"), "True",
                            E(T_SVCLOG), required=False)]},
            {"key": "network_path", "cause": "The network path to the sign-in service is broken", "category": "network",
             "tests": [test("Sign-in service not answering", not svc.get("responding", True), svc.get("responding"), "False", E(T_SVC)),
                       test("Connections time out (not refused)", svc.get("connection") == "timeout", svc.get("connection"), "timeout", E(T_SVC)),
                       test("Other services on the identity server unreachable too", bool(host) and not any(host.values()), host, "all down",
                            E(T_HOSTSVC))]},
            {"key": "client_config", "cause": "A configuration change on the routeops-mobile client stopped handheld sign-in", "category": "configuration change",
             "tests": [test("Handheld sign-ins rejected as 'not allowed'", bool(client_errs) or "unauthorized_client" in app_errs,
                            client_errs or app_errs, "not_allowed / unauthorized_client", E(T_KCERR)),
                       test("Client no longer allows direct sign-in", d["client"].get("direct_access_grants") is False,
                            d["client"].get("direct_access_grants"), "False", E(T_CLIENT)),
                       test("Keycloak itself is up", kc_ok, r((kc or 0) * 100), ">= 90%", E(T_KC)),
                       test("A recent change touched the client", bool(d["admin"] or d["chg"]), len(d["admin"]) + len(d["chg"]), ">= 1",
                            E(T_CHG), required=False)]},
            {"key": "mass_lockout", "cause": "Many accounts locked by the brute-force policy", "category": "identity policy",
             "tests": [test("Lockout errors across users", st["by_reason"].get("user_temporarily_disabled", 0) >= 3,
                            st["by_reason"].get("user_temporarily_disabled", 0), ">= 3", E(T_KCERR))]},
            {"key": "credentials", "cause": "Passwords changed or rejected for many users", "category": "credentials",
             "tests": [test("Invalid-credential errors across users", "invalid_grant" in app_errs and st["by_reason"].get("invalid_user_credentials", 0) >= 3,
                            st["by_reason"].get("invalid_user_credentials", 0), ">= 3", E(T_KCERR))]},
        ]

    def impact(self, ctx):
        if self._sub(ctx) == "user":
            u = ctx["alert"]["username"]
            p = identity.PERSONAS[u]
            data = {"severity": "medium", "risk_score": 45, "users_affected": f"1 ({p['name']})", "facilities": [p["facility"]],
                    "applications": ctx["deps"]["applications"],
                    "business_impact": f"{p['name']} ({p['title']}) cannot reach internal applications. Single-user impact; no other users are affected."}
        elif (ctx.get("cause") or {}).get("key") in ("sso_down", "network_path"):
            data = {"severity": "critical", "risk_score": 92, "users_affected": "Every employee (sign-in is shared by all applications)",
                    "facilities": ["All sites"], "applications": ["Employee portal", "RouteOps Mobile", "Branch ERP", "Every app behind single sign-on"],
                    "business_impact": "Nobody can sign in to any Crystal Clean application: drivers can't load routes, branches can't record "
                                       "manifests. People already signed in keep working until their session expires."}
        else:
            data = {"severity": "critical", "risk_score": 88, "users_affected": "Every field technician using RouteOps Mobile",
                    "facilities": ["All field branches"], "applications": ["RouteOps Mobile"],
                    "business_impact": "Field technicians cannot sign in to their handhelds: no routes, no electronic manifests, pickups delayed across branches."}
        return {"analysis": data["business_impact"], "findings": [f"Severity {data['severity']}", f"Users affected: {data['users_affected']}"],
                "confidence": 0.85, "data": data}

    def plan(self, ctx):
        k = (ctx.get("cause") or {}).get("key")
        if self._sub(ctx) == "user" and k in ("account_disabled", "locked"):
            u = ctx["alert"]["username"]
            p = {"action": f"Re-enable {u} in Keycloak" + (" and clear the lockout" if k == "locked" else ""), "gate": "account_change", "mode": "real",
                 "steps": [f"Set {u} enabled=true through the Keycloak admin API", "Clear any brute-force lock", "Confirm the account state in Keycloak",
                           "Ask the user to sign in again (the Verification Agent watches for the sign-in)"],
                 "expected_outcome": f"{u} can sign in; Keycloak records a successful LOGIN",
                 "risks": ["The account may have been disabled on purpose (offboarding, security hold). Confirm with the user's manager before approving.",
                           "Approval is recorded with your Keycloak identity"], "rollback": "Disable the account again"}
            return {"analysis": p["action"], "findings": p["steps"], "data": p, "next_step": "Request approval from an authorised administrator"}
        if self._sub(ctx) == "disruption" and k == "sso_down":
            p = {"action": "Restart the sign-in service (Keycloak) on the identity server", "gate": "infrastructure_change", "mode": "real",
                 "steps": ["Start the Keycloak service", "Wait until the sign-in page answers", "Run a real test sign-in"],
                 "expected_outcome": "Sign-in works again within about a minute",
                 "risks": ["Sign-in stays unavailable for another 30-60 s while the service starts",
                           "Raise a problem record: find out why the service stopped"], "rollback": "Not needed"}
            return {"analysis": p["action"], "findings": p["steps"], "data": p, "next_step": "Request approval"}
        if self._sub(ctx) == "disruption" and k == "client_config":
            p = {"action": "Revert the routeops-mobile client change (allow direct sign-in again)", "gate": "infrastructure_change", "mode": "real",
                 "steps": ["Set directAccessGrantsEnabled=true on routeops-mobile through the Keycloak admin API", "Test a real handheld sign-in for each technician"],
                 "expected_outcome": "All handheld sign-ins succeed", "risks": ["Restores the previous configuration; review why it was changed (change record)"],
                 "rollback": "Turn direct sign-in off again"}
            return {"analysis": p["action"], "findings": p["steps"], "data": p, "next_step": "Request approval"}
        return {"analysis": "No safe automated fix for this cause (e.g. wrong password: the user resets it). Handing over to the service desk.",
                "data": None, "findings": ["Hand over"]}

    def execute(self, ctx, plan, gate):
        if self._sub(ctx) == "user":
            acc = identity.enable_user(ctx["alert"]["username"], gate["by"])
            return {"analysis": f"{acc['username']} re-enabled by the Keycloak admin API after approval by {gate['by']}.",
                    "findings": [f"Account now {acc['status']}"], "evidence": [ev("Keycloak", "Account state after the change", acc)],
                    "data": acc, "tools": ["Keycloak admin API"]}
        if (ctx.get("cause") or {}).get("key") == "sso_down":
            res = sso_service.start()
            store.log_event("remediation", "Identity server", f"Sign-in service restarted after approval by {gate['by']}", res)
            return {"analysis": f"Sign-in service started after approval by {gate['by']}; answering after {res['start_seconds']} s."
                                if res["responding"] else "The sign-in service did not come back within 2 minutes.",
                    "findings": [f"Responding: {res['responding']}", f"Port: {res['connection']}"],
                    "evidence": [ev("Identity server", "Sign-in service after the restart", res, "state")], "data": res, "tools": ["Service control"]}
        cl = identity.restore_handheld_client(gate["by"])
        return {"analysis": f"routeops-mobile restored after approval by {gate['by']}.", "findings": [f"Direct sign-in allowed: {cl['direct_access_grants']}"],
                "evidence": [ev("Keycloak", "Client configuration after the change", cl, "config")], "data": cl, "tools": ["Keycloak admin API"]}

    def verify(self, ctx):
        if self._sub(ctx) == "user":
            u = ctx["alert"]["username"]
            t_fix = time.time()
            acc = identity.account(u)

            def check():
                seen = [e for e in identity._fetch_events(5) if e["type"] == "LOGIN" and e["user_id"] == acc["id"] and e["ts"] >= t_fix]
                return bool(seen), {"sign_in_seen": bool(seen)}
            seen, _ = wait_until(check, 60, every=4, need=1)
            acc = identity.account(u)
            passed = acc["status"] == "ACTIVE"
            data = {"passed": passed, "account_status": acc["status"], "user_signed_in": seen,
                    "source": "Keycloak account state" + (" and a real successful sign-in" if seen else "")}
            return {"analysis": f"Keycloak reports {u} as {acc['status']}." + (" A successful sign-in by the user was recorded." if seen else
                                                                              " No sign-in by the user yet within 60 s (ask them to try)."),
                    "findings": [f"Account {acc['status']}", f"User signed in: {seen}"], "evidence": [ev("Keycloak", "Account after the fix", data)],
                    "data": data, "confidence": 0.97 if seen else 0.85 if passed else 0.2}
        up = sso_service.responding()
        results = [identity.test_handheld_signin(u) for u in identity.FIELD_TECHS] if up else []
        passed = up and bool(results) and all(x["ok"] for x in results)
        data = {"passed": passed, "service_responding": up, "sign_ins": results, "source": "Sign-in service check and real test sign-ins"}
        return {"analysis": f"{sum(x['ok'] for x in results)}/{len(results)} test sign-ins through the handheld app succeeded.",
                "findings": [f"{x['username']}: {'ok' if x['ok'] else x['error']}" for x in results],
                "evidence": [ev("Keycloak", "Handheld test sign-ins after the fix", data)], "data": data, "confidence": 0.95 if passed else 0.3}

    def breached(self, ctx):
        return self._sub(ctx) == "disruption"

    def graph(self, ctx):
        E = lambda t: eid(ctx, t)
        fixed = ctx.get("verified")
        cause = (ctx.get("cause") or {}).get("key")
        if self._sub(ctx) == "user":
            u = ctx["alert"]["username"]
            p = identity.PERSONAS.get(u, {})
            acc = (ctx.get("evidence") or {}).get("acc", {})
            status = "ACTIVE" if fixed else acc.get("status", ctx["alert"]["metrics"].get("status", "?"))
            n = [node("emp", f"{p.get('label')}: {p.get('name')}", "user", "monitoring", "resolved" if fixed else "warning", [E(T_KCERR)], p.get("title", "")),
                 node("kc", "Keycloak (crystal-clean)", "identity", "monitoring", "normal", [E(T_KC)]),
                 node("acc", f"User account {u}", "account", "evidence", "resolved" if fixed else "warning", [E(T_ACC)]),
                 node("st", f"Status: {status}", "status", "evidence", "resolved" if fixed else ("cause" if cause in ("account_disabled", "locked") else "warning"), [E(T_ACC)]),
                 node("ev", "Authentication event LOGIN_ERROR", "event", "evidence", "resolved" if fixed else "warning", [E(T_EVT)]),
                 node("adm", "Admin change on the account", "change", "evidence", "normal", [E(T_ADM)]),
                 node("app", "Ops Console (OIDC client)", "application", "dependency", "normal", [E(T_MAP)]),
                 node("other", "Other users: signing in OK", "users", "evidence", "normal", [E(T_OTHERS)])]
            e = [edge("emp", "kc", "authenticates through"), edge("kc", "acc", "manages", "evidence"), edge("acc", "st", "has status", "evidence",
                 "cause" if cause and not fixed else "normal"), edge("ev", "emp", "indicates login failure for", "evidence"),
                 edge("adm", "st", "set", "evidence"), edge("app", "kc", "protected by", "dependency"), edge("other", "kc", "authenticate through", "evidence")]
            return {"nodes": n, "edges": e}
        if cause in ("sso_down", "network_path") or (not cause and not fixed and not sso_service.responding()):
            n = [node("emp", "Employees at every site", "users", "monitoring", "resolved" if fixed else "critical", [E(T_KCERR)]),
                 node("apps", "Portal, RouteOps, ERP", "application", "dependency", "resolved" if fixed else "critical", [E(T_MAP)]),
                 node("svc", "Sign-in service (Keycloak)", "identity", "evidence", "resolved" if fixed else ("cause" if cause == "sso_down" else "critical"),
                      [E(T_SVC), E(T_SVCLOG)], "running" if fixed else "stopped"),
                 node("port", "Port 8080: answering" if fixed else "Port 8080: connection refused", "metric", "evidence",
                      "resolved" if fixed else "critical", [E(T_SVC)]),
                 node("host", "Identity server", "server", "evidence", "normal", [E(T_HOSTSVC)], "other services healthy"),
                 node("probe", "Blackbox probe", "metric", "monitoring", "resolved" if fixed else "critical", [E(T_KC)])]
            e = [edge("emp", "apps", "sign in to"), edge("apps", "svc", "depend on", "dependency", "cause" if cause and not fixed else "normal"),
                 edge("host", "svc", "runs", "evidence"), edge("svc", "port", "listens on", "evidence"), edge("probe", "port", "checks")]
            return {"nodes": n, "edges": e}
        cl = (ctx.get("evidence") or {}).get("client", {})
        n = [node("techs", "Field technicians (3)", "users", "monitoring", "resolved" if fixed else "critical", [E(T_KCERR)]),
             node("app", "RouteOps Mobile (handheld)", "application", "monitoring", "resolved" if fixed else "critical", [E(T_APP)]),
             node("client", "Client routeops-mobile", "config", "evidence", "resolved" if fixed else ("cause" if cause == "client_config" else "warning"), [E(T_CLIENT)],
                  f"Direct sign-in: {cl.get('direct_access_grants')}"),
             node("chg", "Change CHG-DEMO-4410", "change", "evidence", "normal", [E(T_CHG)]),
             node("kc", "Keycloak (crystal-clean)", "identity", "evidence", "normal", [E(T_KC)], "Available"),
             node("evts", "LOGIN_ERROR across users", "event", "monitoring", "resolved" if fixed else "critical", [E(T_KCERR)]),
             node("console", "Ops Console sign-ins: OK", "application", "evidence", "normal", [])]
        e = [edge("techs", "app", "sign in via"), edge("app", "client", "uses", "evidence"), edge("client", "kc", "registered in", "evidence"),
             edge("chg", "client", "changed", "evidence", "cause" if cause == "client_config" and not fixed else "normal"),
             edge("evts", "techs", "indicate failures for"), edge("console", "kc", "authenticates through", "evidence")]
        return {"nodes": n, "edges": e}
