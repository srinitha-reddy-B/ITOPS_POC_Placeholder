"""The shared multi-agent investigation engine. Every use case runs through the same stages.

    Monitoring -> Anomaly Detection -> Prediction -> Historical Analysis -> Evidence Collection -> Dependency Analysis
    -> Root Cause Analysis -> Critic -> Risk Assessment -> Resolution -> Approval (human) -> Remediation
    -> Verification -> Closure

What decides what
  * Data agents (monitoring, evidence, dependencies, verification) call the real integrations through the playbook.
  * Root cause: each playbook lists candidate causes with concrete tests against the collected evidence. Code runs
    the tests; a cause is "supported" only if its required tests pass. The LLM writes the analysis and may rank
    supported causes; it cannot promote a cause the evidence does not support.
  * Critic: code checks (are alternatives ruled out, is the evidence fresh and cited) plus an LLM challenge. A
    challenge only counts if it cites real evidence. Low confidence turns the plan into a hand-over, not a fix.
  * Nothing is changed without a recorded human approval from a Keycloak user holding ops-approver.

Every step, decision and result is persisted in SQLite (store.py) as the investigation history.
"""

import threading
import time
import traceback

from . import config, reasoning, store, ticketing

AGENTS = [
    ("monitoring", "Monitoring Agent", "Analyses incoming metrics and events"),
    ("anomaly", "Anomaly Detection Agent", "Identifies unusual patterns against thresholds and baselines"),
    ("prediction", "Prediction Agent", "Estimates failure risk and time to threshold"),
    ("historical", "Historical Analysis Agent", "Checks previous incidents and historical patterns"),
    ("evidence", "Evidence Collection Agent", "Collects logs, metrics, events and configuration"),
    ("dependency", "Dependency Analysis Agent", "Identifies affected applications, infrastructure and users"),
    ("rca", "Root Cause Analysis Agent", "Tests candidate causes against the evidence"),
    ("critic", "Critic Agent", "Challenges unsupported conclusions"),
    ("risk", "Risk Assessment Agent", "Evaluates severity and business impact"),
    ("resolution", "Resolution Agent", "Prepares the corrective action and its guardrails"),
    ("approval", "Approval Agent", "Coordinates human approval"),
    ("remediation", "Remediation Agent", "Executes the approved action"),
    ("verification", "Verification Agent", "Confirms the fix using the source integration"),
    ("closure", "Closure Agent", "Records the outcome"),
]
OPEN = {"investigating", "awaiting_approval", "remediating", "verifying"}
PLAYBOOKS: dict = {}
_threads: dict = {}
_decisions: dict = {}
_lock = threading.RLock()
ALERTS: dict = {}
HOLD_DOWN_S = 90
_detector = {"on": True, "last": 0.0, "errors": {}}


def register(pb) -> None:
    PLAYBOOKS[pb.key] = pb


def ev(source: str, title: str, data, kind: str = "metric", mode: str = "live") -> dict:
    """An evidence item. mode: live (real integration data) | lab (real tool, demo environment) | record (history)."""
    return {"source": source, "title": title, "data": data, "kind": kind, "mode": mode, "at": time.time()}


def test(check: str, passed: bool, actual, expected: str, evidence: str = "", required: bool = True) -> dict:
    return {"check": check, "passed": bool(passed), "actual": actual, "expected": expected, "evidence": evidence, "required": required}


# ----------------------------------------------------------------- investigation document

def _new_doc(pb, alert: dict, started_by: str, reporter: dict | None = None) -> dict:
    now = time.time()
    return {"id": store.new_id("INV"), "created": now, "updated": now, "usecase": pb.key, "usecase_title": pb.title,
            "category": alert.get("category", "predictive"), "title": alert["title"], "status": "investigating",
            "component": alert.get("component"), "facility": alert.get("facility"), "severity": alert.get("severity", "warning"),
            "risk_score": alert.get("risk_score"), "alert": alert, "started_by": started_by,
            "agents": [{"key": k, "name": n, "role": r, "status": "pending"} for k, n, r in AGENTS],
            "evidence": [], "graph": {"nodes": [], "edges": []}, "candidates": [], "rca": None, "impact": None, "plan": None,
            "approvals": [], "actions": [], "verification": None, "outcome": None, "history": [],
            "reporter": reporter, "ticket": None, "origin": "employee" if reporter else "monitoring",
            "integrations_used": sorted(pb.integrations), "reality": pb.reality}


def _hist(doc: dict, actor: str, text: str) -> None:
    doc["history"].append({"ts": time.time(), "actor": actor, "text": text})


def _agent(doc: dict, key: str) -> dict:
    return next(a for a in doc["agents"] if a["key"] == key)


def _add_evidence(doc: dict, items: list[dict]) -> list[str]:
    ids = []
    for it in items or []:
        it = {**it, "id": f"E{len(doc['evidence']) + 1}"}
        doc["evidence"].append(it)
        ids.append(it["id"])
    return ids


def _run_step(doc: dict, key: str, fn, ctx: dict | None = None) -> dict:
    """Run one agent: mark running, call fn(), store its structured output, pace it so people can follow."""
    a = _agent(doc, key)
    a.update(status="running", started=time.time())
    store.save_investigation(doc)
    t0 = time.time()
    try:
        out = fn() or {}
    except Exception as exc:
        out = {"analysis": f"Agent error: {type(exc).__name__}: {str(exc)[:200]}", "findings": [], "confidence": None,
               "status": "failed", "next_step": "Hand over to an engineer"}
        traceback.print_exc()
    new_ids = _add_evidence(doc, out.pop("evidence", []))
    if ctx is not None:
        ctx["ids"] = {e["title"]: e["id"] for e in doc["evidence"]}
    out.setdefault("input_evidence", [])
    refs = {x for x in set(out["input_evidence"]) | set(new_ids) if isinstance(x, str) and x[1:].isdigit()}
    out["input_evidence"] = sorted(refs, key=lambda x: int(x[1:]))
    out.setdefault("engine", "system")
    a.update({k: v for k, v in out.items() if k != "data"}, status=out.get("status", "done"), finished=time.time())
    if key not in ("approval",):
        ticketing.agent_note(doc, a)
    wait = config.STEP_MIN_SECONDS - (time.time() - t0)
    if wait > 0:
        time.sleep(wait)
    store.save_investigation(doc)
    return out


def _evidence_by_id(doc: dict) -> dict:
    return {e["id"]: e for e in doc["evidence"]}


def _refresh_graph(doc: dict, pb, ctx: dict) -> None:
    try:
        g = pb.graph(ctx)
    except Exception:
        traceback.print_exc()
        return
    done = {a["key"] for a in doc["agents"] if a["status"] in ("done", "waiting", "failed")}
    for n in g["nodes"]:
        n["visible"] = n.get("revealed_by", "monitoring") in done
    doc["graph"] = g


# ----------------------------------------------------------------- the pipeline

def _historical(doc: dict, pb) -> dict:
    past = [d for d in store.list_investigations(200) if d["usecase"] == pb.key and d["id"] != doc["id"] and d.get("outcome")]
    causes: dict = {}
    for d in past:
        c = (d.get("rca") or {}).get("cause")
        if c:
            causes[c] = causes.get(c, 0) + 1
    mttr = [d["outcome"]["closed"] - d["created"] for d in past if d["outcome"].get("closed")]
    extra = pb.history() if hasattr(pb, "history") else {}
    data = {"previous_investigations": len(past), "previous_root_causes": causes,
            "outcomes": {o: sum(1 for d in past if d["outcome"].get("result") == o) for o in ("mitigated", "incident", "false_positive", "rejected")},
            "mean_time_to_resolve_s": round(sum(mttr) / len(mttr)) if mttr else None, **extra.get("data", {})}
    findings = [f"{len(past)} earlier investigation(s) of this kind in the history"]
    if causes:
        top = max(causes, key=causes.get)
        findings.append(f"Most frequent earlier root cause: {top} ({causes[top]}x)")
    findings += extra.get("findings", [])
    return {"analysis": "Searched the investigation history and the integration's own history for similar events.",
            "findings": findings, "confidence": None, "evidence": [ev("Ops Console history", "Similar past investigations", data, "record", "record")]
            + extra.get("evidence", []), "next_step": "Collect current evidence", "tools": ["SQLite investigation history"] + extra.get("tools", [])}


def _rca(doc: dict, pb, ctx: dict) -> dict:
    cands = pb.hypotheses(ctx)
    for c in cands:
        req = [t for t in c["tests"] if t["required"]]
        c["passed"] = sum(1 for t in c["tests"] if t["passed"])
        c["supported"] = bool(req) and all(t["passed"] for t in req)
        c["score"] = round(c["passed"] / max(1, len(c["tests"])), 2)
    cands.sort(key=lambda c: (c["supported"], c["score"]), reverse=True)
    doc["candidates"] = cands
    supported = [c for c in cands if c["supported"]]
    winner = supported[0] if supported else None
    conf = round(0.55 + 0.4 * winner["score"], 2) if winner else 0.3
    analysis = (f"Tested {len(cands)} candidate causes against the evidence. " +
                (f"'{winner['cause']}' is supported: {winner['passed']}/{len(winner['tests'])} checks pass." if winner
                 else "No candidate cause is fully supported by the evidence."))
    engine, llm_note = "rules", ""
    ids = {e["id"] for e in doc["evidence"]}
    if winner:
        ans, err = reasoning.ask(
            "Root Cause Analysis Agent",
            "Explain the most likely root cause. You may only choose among the candidate keys marked supported=true.",
            doc["evidence"], {"candidates": [{k: c[k] for k in ("key", "cause", "supported", "score", "tests")} for c in cands]},
            '{"cause_key": str, "analysis": str (3 sentences max, cite evidence ids), "findings": [str], "confidence": 0..1}')
        if ans:
            pick = next((c for c in supported if c["key"] == ans.get("cause_key")), None)
            valid, invalid = reasoning.grounded_refs(ans, ids)
            if pick and valid:
                winner, engine = pick, "llm"
                analysis = str(ans.get("analysis") or analysis)
                try:
                    conf = round(min(conf + 0.05, max(0.0, min(1.0, float(ans.get("confidence", conf))))), 2)
                except (TypeError, ValueError):
                    pass
                if invalid:
                    llm_note = f"Removed citations to evidence that does not exist: {', '.join(invalid)}"
            else:
                llm_note = "LLM answer rejected: it chose a cause the evidence does not support or cited no evidence"
        elif err:
            llm_note = f"LLM unavailable ({err}); deterministic analysis used"
    ctx["cause"] = winner
    doc["rca"] = {"cause": winner["cause"] if winner else None, "cause_key": winner["key"] if winner else None,
                  "category": winner.get("category") if winner else None, "confidence": conf,
                  "alternatives_ruled_out": [c["cause"] for c in cands if not c["supported"]]}
    cited = sorted({t["evidence"] for c in cands for t in c["tests"] if t["evidence"]}, key=lambda x: int(x[1:]))
    return {"analysis": analysis, "engine": engine, "llm_note": llm_note, "confidence": conf, "input_evidence": cited,
            "findings": ([f"Most likely cause: {winner['cause']}"] if winner else ["Cause not established"]) +
                        [f"Ruled out: {c['cause']}" for c in cands if not c["supported"]],
            "observations": [f"{t['check']}: {t['actual']} (expected {t['expected']}) {'✓' if t['passed'] else '✗'}"
                             for t in (winner or {"tests": []})["tests"]],
            "next_step": "Critic challenges the conclusion", "tools": ["Hypothesis tests (code)"] + (["Cohere"] if engine == "llm" else [])}


def _critic(doc: dict, pb, ctx: dict) -> dict:
    rca, cands = doc["rca"], doc["candidates"]
    winner = ctx.get("cause")
    issues, upheld = [], []
    if not winner:
        issues.append("No supported root cause: an automated fix is not justified")
    else:
        ev_ids = [t["evidence"] for t in winner["tests"] if t["passed"] and t["evidence"]]
        if len(set(ev_ids)) < 2:
            issues.append("The conclusion rests on fewer than two independent pieces of evidence")
        stale = [e["id"] for e in doc["evidence"] if e["mode"] != "record" and time.time() - e["at"] > 600]
        if stale:
            issues.append(f"Evidence older than 10 minutes: {', '.join(stale)}")
        others = [c for c in cands if c is not winner and c["supported"]]
        if others:
            issues.append(f"Alternative cause also supported: {others[0]['cause']}")
    engine, note = "rules", ""
    ids = {e["id"] for e in doc["evidence"]}
    if winner:
        ans, err = reasoning.ask(
            "Critic Agent", "Try to prove the root cause wrong or the evidence insufficient. Only raise a challenge you can tie to an evidence id.",
            doc["evidence"], {"root_cause": rca, "tests": winner["tests"]},
            '{"challenges": [{"claim": str, "issue": str, "evidence": "E#", "severity": "low|medium|high"}], "verdict": "upheld|weakened|rejected"}')
        if ans:
            engine = "llm"
            for ch in ans.get("challenges", []) or []:
                if isinstance(ch, dict) and ch.get("evidence") in ids and ch.get("severity") == "high":
                    upheld.append(f"{ch.get('issue')} ({ch.get('evidence')})")
                elif isinstance(ch, dict):
                    note += f"Dismissed challenge without valid evidence or low severity: {str(ch.get('issue'))[:120]}. "
        elif err:
            note = f"LLM unavailable ({err}); rule checks only"
    conf = rca["confidence"]
    conf = round(max(0.0, conf - 0.12 * len(issues) - 0.15 * len(upheld)), 2)
    rca["confidence"] = conf
    rca["critic"] = {"issues": issues, "upheld": upheld}
    verdict = "upheld" if not issues and not upheld else ("weakened" if conf >= 0.6 else "rejected")
    rca["verdict"] = verdict
    return {"analysis": f"Verdict: {verdict}. " + ("No unresolved challenge." if verdict == "upheld" else
                                                  "Challenges: " + "; ".join(issues + upheld)),
            "findings": issues + upheld or ["Alternatives ruled out by failed checks", "Evidence is fresh and from live integrations"],
            "confidence": conf, "engine": engine, "llm_note": note.strip(),
            "next_step": "Assess risk" if conf >= 0.6 else "Confidence too low for an automated fix: hand over to an engineer"}


def _wait_for_decision(doc: dict, gate: dict) -> dict:
    ev_ = threading.Event()
    with _lock:
        _decisions[doc["id"]] = {"event": ev_, "decision": None}
    while not ev_.wait(5):
        cur = store.get_investigation(doc["id"]) or {}
        if cur.get("status") == "cancelled":
            return {"decision": "cancelled"}
    with _lock:
        return _decisions.pop(doc["id"])["decision"]


def decide(inv_id: str, decision: str, user: dict, comment: str = "") -> dict:
    if decision not in ("approve", "reject", "false_positive"):
        raise ValueError("decision must be approve, reject or false_positive")
    with _lock:
        slot = _decisions.get(inv_id)
        if not slot or slot["decision"] is not None:
            raise ValueError("this investigation is not waiting for approval")
        slot["decision"] = {"decision": decision, "by": user["name"], "username": user["username"], "roles": user["roles"], "auth": user.get("auth", "Keycloak"),
                            "comment": comment[:500], "at": time.time()}
        slot["event"].set()
    store.log_event("approval", "Ops Console", f"{inv_id}: {decision} by {user['username']}", {"comment": comment[:500]})
    return {"ok": True}


def _execute(inv_id: str) -> None:
    doc = store.get_investigation(inv_id)
    pb = PLAYBOOKS[doc["usecase"]]
    ctx: dict = {"doc": doc, "alert": doc["alert"]}
    try:
        _hist(doc, "System", f"Investigation opened ({doc['started_by']})")
        if not doc.get("ticket"):
            ticketing.opened(doc)
        if doc.get("ticket"):
            _hist(doc, "ServiceNow", f"Incident {doc['ticket']['number']} created")
        store.save_investigation(doc)
        out = _run_step(doc, "monitoring", lambda: pb.monitor(ctx), ctx)
        ctx["snapshot"] = out.get("data", {})
        _refresh_graph(doc, pb, ctx)
        _run_step(doc, "anomaly", lambda: pb.anomaly(ctx), ctx)
        _run_step(doc, "prediction", lambda: pb.predict(ctx), ctx)
        ctx["prediction"] = _agent(doc, "prediction").get("prediction")
        _run_step(doc, "historical", lambda: _historical(doc, pb), ctx)
        out = _run_step(doc, "evidence", lambda: pb.collect(ctx), ctx)
        ctx["evidence"] = out.get("data", {})
        ctx["ids"] = {e["title"]: e["id"] for e in doc["evidence"]}
        _refresh_graph(doc, pb, ctx)
        out = _run_step(doc, "dependency", lambda: pb.dependencies(ctx), ctx)
        ctx["deps"] = out.get("data", {})
        ctx["ids"] = {e["title"]: e["id"] for e in doc["evidence"]}
        _refresh_graph(doc, pb, ctx)
        _run_step(doc, "rca", lambda: _rca(doc, pb, ctx), ctx)
        _refresh_graph(doc, pb, ctx)
        _run_step(doc, "critic", lambda: _critic(doc, pb, ctx), ctx)
        out = _run_step(doc, "risk", lambda: pb.impact(ctx), ctx)
        doc["impact"] = out.get("data")
        if doc["impact"]:
            doc["severity"], doc["risk_score"] = doc["impact"].get("severity", doc["severity"]), doc["impact"].get("risk_score", doc["risk_score"])
        _refresh_graph(doc, pb, ctx)

        confident = ctx.get("cause") and doc["rca"]["confidence"] >= 0.6
        out = _run_step(doc, "resolution", lambda: pb.plan(ctx) if confident else {
            "analysis": "The evidence does not support an automated fix. Handing over to an engineer with the evidence collected.",
            "findings": ["No action prepared"], "data": None, "next_step": "Engineer review"})
        doc["plan"] = out.get("data")

        # ---- human approval (always, nothing changes without it)
        a = _agent(doc, "approval")
        gate = {"gate": (doc["plan"] or {}).get("gate", "root_cause_confirmation"), "requested": time.time(),
                "request": {"issue": doc["title"], "category": doc["category"], "evidence": [e["id"] for e in doc["evidence"]][:12],
                            "risk_level": doc["severity"], "risk_score": doc["risk_score"],
                            "business_impact": (doc["impact"] or {}).get("business_impact"), "root_cause": doc["rca"]["cause"],
                            "confidence": doc["rca"]["confidence"], "recommended_action": (doc["plan"] or {}).get("action"),
                            "expected_outcome": (doc["plan"] or {}).get("expected_outcome"), "potential_risks": (doc["plan"] or {}).get("risks", []),
                            "mode": (doc["plan"] or {}).get("mode")}}
        doc["approvals"].append(gate)
        doc["status"] = "awaiting_approval"
        a.update(status="waiting", started=time.time(), engine="human",
                 analysis="Waiting for a Keycloak user with the ops-approver role to approve or reject.",
                 findings=[f"Approval gate: {gate['gate'].replace('_', ' ')}"], next_step="Human decision")
        _hist(doc, "Approval Agent", f"Approval requested: {gate['request']['recommended_action'] or 'confirm root cause / hand over'}")
        ticketing.approval_requested(doc, gate)
        store.save_investigation(doc)
        d = _wait_for_decision(doc, gate)
        doc = store.get_investigation(inv_id) or doc
        ctx["doc"] = doc
        gate = doc["approvals"][-1]
        gate.update(decided=time.time(), decision=d.get("decision"), by=d.get("by"), username=d.get("username"), comment=d.get("comment", ""), auth=d.get("auth"))
        a = _agent(doc, "approval")
        a.update(status="done", finished=time.time(), findings=[f"{d.get('decision')} by {d.get('by')}"] + ([d["comment"]] if d.get("comment") else []))
        _hist(doc, d.get("by") or "System", f"Decision: {d.get('decision')}" + (f" ({d['comment']})" if d.get("comment") else ""))
        ticketing.decided(doc, gate)

        if d.get("decision") != "approve" or not doc["plan"]:
            for k in ("remediation", "verification"):
                _agent(doc, k).update(status="skipped")
            result = {"cancelled": "cancelled", "false_positive": "false_positive"}.get(d.get("decision"), "rejected")
            if d.get("decision") == "approve" and not doc["plan"]:
                result = "handed_over"
            _close(doc, pb, ctx, result, verified=None)
            return

        doc["status"] = "remediating"
        out = _run_step(doc, "remediation", lambda: pb.execute(ctx, doc["plan"], gate), ctx)
        doc["actions"].append({"at": time.time(), "action": doc["plan"]["action"], "by": gate["by"], "mode": doc["plan"].get("mode"),
                               "result": out.get("data")})
        ctx["action_result"] = out.get("data")
        doc["status"] = "verifying"
        out = _run_step(doc, "verification", lambda: pb.verify(ctx), ctx)
        doc["verification"] = out.get("data")
        passed = bool((doc["verification"] or {}).get("passed"))
        ctx["verified"] = passed
        _refresh_graph(doc, pb, ctx)
        _close(doc, pb, ctx, None, verified=passed)
    except Exception as exc:
        traceback.print_exc()
        doc["status"] = "failed"
        _hist(doc, "System", f"Engine error: {type(exc).__name__}: {exc}")
        store.save_investigation(doc)
        a = ALERTS.get(doc["alert"].get("key"))
        if a and a.get("investigation_id") == doc["id"]:
            a["status"] = "open"  # can be investigated again from the console; not restarted automatically
    finally:
        _threads.pop(inv_id, None)


def _close(doc: dict, pb, ctx: dict, result: str | None, verified: bool | None) -> None:
    def fn():
        nonlocal result
        if result is None:
            breached = pb.breached(ctx) if hasattr(pb, "breached") else False
            if not verified:
                result = "unresolved"
            elif doc["category"] == "identity":
                result = "resolved_incident"
            else:
                result = "incident" if breached else "mitigated"
        doc["outcome"] = {"result": result, "verified": verified, "closed": time.time(),
                          "duration_s": round(time.time() - doc["created"]), "root_cause": (doc["rca"] or {}).get("cause")}
        labels = {"mitigated": "Risk mitigated before it caused an outage", "incident": "Became an incident before it was fixed; now resolved",
                  "resolved_incident": "Identity access incident resolved", "false_positive": "Marked as a false positive by the approver",
                  "rejected": "Recommended action rejected by the approver", "unresolved": "Fix did not verify: handed to an engineer",
                  "handed_over": "Handed over to an engineer", "cancelled": "Cancelled"}
        return {"analysis": labels.get(result, result), "findings": [f"Outcome: {labels.get(result, result)}",
                f"Time from detection to closure: {doc['outcome']['duration_s']} s"] +
                ([f"Verified from {(doc.get('verification') or {}).get('source', 'the source integration')}"] if verified else []), "next_step": "Closed"}
    _run_step(doc, "closure", fn)
    doc["status"] = {"mitigated": "resolved", "incident": "resolved", "resolved_incident": "resolved"}.get(doc["outcome"]["result"], "closed")
    if doc["outcome"]["result"] == "unresolved":
        doc["status"] = "escalated"
    _hist(doc, "Closure Agent", f"Closed: {doc['outcome']['result']}")
    ticketing.closed(doc)
    akey = doc["alert"].get("key")
    if akey in ALERTS and ALERTS[akey].get("investigation_id") == doc["id"]:
        ALERTS[akey].update(status="resolved" if verified else "closed", closed=time.time())
    store.save_investigation(doc)
    store.log_event("investigation", "Ops Console", f"{doc['id']} closed: {doc['outcome']['result']}", {"usecase": doc["usecase"]})


def start(usecase: str, alert: dict | None = None, started_by: str = "Detector", reporter: dict | None = None) -> dict:
    pb = PLAYBOOKS[usecase]
    with _lock:
        for d in store.list_investigations(50):
            same = d["alert"].get("key") == alert["key"] if alert else d["usecase"] == usecase
            if same and d["status"] in OPEN and d["id"] in _threads:
                return d
        if alert is None:
            alert = pb.detect() or {"key": f"{usecase}:manual", "title": f"{pb.title}: manual investigation", "category": "predictive",
                                    "component": pb.component, "facility": pb.facility, "severity": "info", "risk_score": 10}
        doc = _new_doc(pb, alert, started_by, reporter)
        store.save_investigation(doc)
        t = threading.Thread(target=_execute, args=(doc["id"],), daemon=True, name=f"inv-{doc['id']}")
        _threads[doc["id"]] = t
        t.start()
    if alert.get("key") in ALERTS:
        ALERTS[alert["key"]].update(status="investigating", investigation_id=doc["id"])
    return doc


def open_incident(usecase: str, alert: dict, started_by: str, reporter: dict | None = None) -> dict:
    """Raise an incident (with its ServiceNow ticket) but hold the agents until IT starts the investigation."""
    pb = PLAYBOOKS[usecase]
    doc = _new_doc(pb, alert, started_by, reporter)
    doc["status"] = "new"
    _hist(doc, "System", f"Incident raised ({started_by}); waiting for IT to start the investigation")
    ticketing.opened(doc)
    if doc.get("ticket"):
        _hist(doc, "ServiceNow", f"Incident {doc['ticket']['number']} created")
        ticketing.note(doc, "Raised", "Raised from the Manager portal. Waiting for an IT Administrator to start the investigation.")
    store.save_investigation(doc)
    return doc


def begin(inv_id: str, user: dict) -> dict:
    """IT starts the investigation of a held incident: the agents run from here."""
    with _lock:
        doc = store.get_investigation(inv_id)
        if not doc or doc["status"] != "new":
            raise ValueError("this incident is not waiting for an investigation")
        doc["status"] = "investigating"
        doc["started_by"] = f"{user['name']} (IT Admin)"
        _hist(doc, user["name"], "Investigation started")
        ticketing.note(doc, "Investigation started", f"{user['name']} ({user['username']}) started the investigation; the agents are running.")
        store.save_investigation(doc)
        t = threading.Thread(target=_execute, args=(doc["id"],), daemon=True, name=f"inv-{doc['id']}")
        _threads[doc["id"]] = t
        t.start()
    return doc


def cancel(inv_id: str, user: dict) -> dict:
    doc = store.get_investigation(inv_id)
    if not doc or doc["status"] not in OPEN:
        raise ValueError("not an open investigation")
    with _lock:
        slot = _decisions.get(inv_id)
        if slot and slot["decision"] is None:
            slot["decision"] = {"decision": "cancelled", "by": user["name"], "username": user["username"], "at": time.time()}
            slot["event"].set()
            return {"ok": True}
    doc["status"] = "cancelled"
    store.save_investigation(doc)
    return {"ok": True}


def recover_orphans() -> None:
    """After a backend restart, investigations whose thread is gone cannot continue: mark them clearly."""
    for d in store.list_investigations(200):
        if d["status"] in OPEN and d["id"] not in _threads:
            d["status"] = "interrupted"
            _hist(d, "System", "Backend restarted while this investigation was open; start a new one from its alert")
            ticketing.interrupted(d)
            store.save_investigation(d)


# ----------------------------------------------------------------- detection loop

def _detect_once() -> None:
    for key, pb in PLAYBOOKS.items():
        if pb.staging or time.time() < pb.quiet_until:
            continue
        try:
            sig = pb.detect()
            _detector["errors"].pop(key, None)
        except Exception as exc:
            _detector["errors"][key] = f"{type(exc).__name__}: {str(exc)[:160]}"
            continue
        live = {k for k, a in ALERTS.items() if a["usecase"] == key and a["status"] in ("open", "investigating")}
        if sig:
            k = sig["key"]
            cur = ALERTS.get(k)
            if cur and cur["status"] not in ("open", "investigating") and time.time() - cur.get("closed", 0) < HOLD_DOWN_S:
                continue  # hold-down: trailing metric windows still show the old problem right after a fix or reset
            if cur and cur["status"] in ("open", "investigating"):
                cur.update({x: sig[x] for x in ("risk_score", "current", "eta_s", "severity", "detail", "metrics") if x in sig}, last_seen=time.time())
            else:
                ALERTS[k] = {**sig, "id": store.new_id("ALR"), "usecase": key, "status": "open", "first_seen": time.time(),
                             "last_seen": time.time(), "investigation_id": None}
                store.log_event("alert", sig.get("source", pb.title), sig["title"], {"usecase": key, "risk_score": sig.get("risk_score")})
                if pb.auto_investigate:
                    start(key, ALERTS[k], started_by="Detector (automatic)")
            live.discard(k)
        for k in live:  # signal gone
            if ALERTS[k]["status"] == "open":
                ALERTS[k].update(status="cleared", closed=time.time())


WARMUP_S = 75  # rate windows (1 min) must fill after a backend start before they mean anything


def _detect_loop() -> None:
    time.sleep(WARMUP_S)
    while True:
        if _detector["on"]:
            _detect_once()
            _detector["last"] = time.time()
        time.sleep(6)


def alerts() -> list[dict]:
    return sorted(ALERTS.values(), key=lambda a: a["first_seen"], reverse=True)


def init() -> None:
    recover_orphans()
    threading.Thread(target=_detect_loop, daemon=True, name="ops-detector").start()
