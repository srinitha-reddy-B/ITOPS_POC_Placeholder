"""The employee help bot: a message becomes a ServiceNow incident and an investigation by the agents.

  1. Understand the message: which of the five problems is it (Cohere; keyword rules when no LLM)?
  2. If the agents are already working on that problem (e.g. monitoring caught it first), link the employee to
     the existing ServiceNow incident instead of opening a duplicate.
  3. Otherwise start an investigation for it; the engine raises the incident and writes every step to ServiceNow.
  4. The employee sees plain-language progress; the technical detail stays in ServiceNow work notes.

Anything outside the five problems still gets a ServiceNow incident, routed to the Service Desk.
"""

import json
import re
import time

import httpx

from . import cohere as llm
from . import engine, identity, sso_service, store, ticketing

INTENTS = {
    "sso": {"label": "Sign-in problem", "words": ["sign in", "signin", "log in", "login", "logon", "password", "account", "locked", "disabled", "sso", "keycloak", "access denied"]},
    "api": {"label": "RouteOps / dispatch app problem", "words": ["routeops", "route", "dispatch", "handheld app", "app is slow", "503", "loading", "stops"]},
    "network": {"label": "Branch network problem", "words": ["network", "vpn", "internet", "connection", "connectivity", "erp", "file share", "branch", "chicago", "latency", "slow network"]},
    "storage": {"label": "Server storage problem", "words": ["disk", "storage", "space", "full", "can't save", "cannot save", "server is slow", "app server"]},
    "backup": {"label": "Backup problem", "words": ["backup", "restore", "recovery", "snapshot"]},
    "mail": {"label": "Email / Outlook problem", "words": ["outlook", "email", "e-mail", "mail", "exchange", "calendar", "teams", "inbox"]},
}
SUGGESTIONS = ["I can't sign in to my account", "RouteOps won't load today's routes", "The network at the Chicago North branch is very slow",
               "The app server says the disk is almost full", "Last night's database backup failed"]
EMP_STEPS = ["Received", "Investigating", "Fix ready", "Fixing", "Resolved"]


def _rules(text: str) -> str:
    t = text.lower()
    scores = {k: sum(1 for w in v["words"] if w in t) for k, v in INTENTS.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] else "other"


def classify(text: str) -> dict:
    """Which problem the employee describes. The LLM may only answer with one of the known keys."""
    if llm.llm_available():
        try:
            prompt = ("Classify an employee's IT help request at Crystal Clean (environmental services). Categories:\n"
                      + "\n".join(f"- {k}: {v['label']}" for k, v in INTENTS.items()) + "\n- other: anything else\n"
                      f'Message: "{text[:500]}"\nReply with JSON: {{"category": "<key>", "summary": "<8-12 word ticket title>"}}')
            resp = llm._cohere_client().chat(model="command-a-03-2025", temperature=0, response_format={"type": "json_object"},
                                             messages=[{"role": "user", "content": prompt}], request_options={"timeout_in_seconds": 15})
            raw = next(i.text for i in resp.message.content if getattr(i, "text", None))
            j = json.loads(re.sub(r"^```(json)?|```$", "", raw.strip(), flags=re.M))
            if j.get("category") in (*INTENTS, "other"):
                return {"usecase": j["category"], "summary": str(j.get("summary") or text)[:120], "engine": "llm"}
        except Exception:
            pass
    return {"usecase": _rules(text), "summary": text[:120], "engine": "rules"}


def _say(user: dict, role: str, text: str, inv: str | None = None, ticket: dict | None = None) -> dict:
    return store.log_event("chat", user["username"], text[:300], {"user": user["username"], "role": role, "text": text, "inv": inv, "ticket": ticket})


def _alert_for(uc: str, user: dict, summary: str) -> dict:
    pb = engine.PLAYBOOKS[uc]
    if uc == "sso":
        sig = pb.detect()
        if sig and sig["key"] == "sso:disruption" and (user["username"] in identity.FIELD_TECHS or not sso_service.responding()):
            return sig
        if not sso_service.responding():  # the sign-in service is down for everyone: this is the outage, not one account
            return {"key": "sso:disruption", "title": "Sign-in service not responding: employees can't sign in", "category": "incident",
                    "source": "Employee report", "component": "Keycloak (sign-in service)", "facility": "All sites", "severity": "critical",
                    "risk_score": 92, "metric": "Sign-in service", "current": "not responding", "threshold": "responding", "eta_s": None,
                    "subtype": "disruption", "metrics": {}}
        try:
            acc = identity.account(user["username"])
        except (httpx.HTTPError, ValueError):
            acc = {"status": "UNKNOWN"}
        last = next((e for e in identity.recent(30) if e["type"] == "LOGIN_ERROR" and (e["username"] == user["username"] or e["user_id"] == acc.get("id"))), None)
        p = identity.PERSONAS.get(user["username"], {})
        return {"key": f"sso:user:{user['username']}", "title": f"Identity access: {user['name']} cannot sign in" + (f" ({last['reason']})" if last else ""),
                "category": "identity", "source": "Employee report", "component": f"Account {user['username']}", "facility": p.get("facility", ""),
                "severity": "medium", "risk_score": 45, "metric": "Sign-in result", "current": (last or {}).get("error") or acc.get("status"),
                "threshold": "successful sign-in", "eta_s": None, "subtype": "user", "username": user["username"],
                "metrics": {"error": (last or {}).get("error"), "status": acc.get("status")}}
    sig = pb.detect()
    if sig:
        return sig
    return {"key": f"{uc}:report", "title": f"{summary} (reported by {user['name']})", "category": "incident", "source": "Employee report",
            "component": pb.component, "facility": pb.facility, "severity": "warning", "risk_score": 40, "metric": "-", "current": "-",
            "threshold": "-", "eta_s": None, "metrics": {}}


def chat(user: dict, text: str, pre_signin: bool = False) -> dict:
    text = (text or "").strip()
    if not text:
        raise ValueError("empty message")
    _say(user, "employee", text)
    c = classify(text)
    uc = c["usecase"]
    if pre_signin and uc != "sso":
        msg = "Without signing in I can only help with sign-in problems. Please sign in to report anything else, or call the Service Desk."
        _say(user, "bot", msg)
        return {"reply": msg}
    if uc == "other":
        inc = None
        if ticketing.enabled():
            try:
                from . import servicenow as snow
                inc = snow.create_incident({"short_description": c["summary"], "description": f"Reported by {user['name']} ({user['username']}): \"{text}\"",
                                            "urgency": "3", "impact": "3", "category": "inquiry", "contact_type": "self-service",
                                            "assignment_group_name": "Service Desk"}, extra={"correlation_id": f"{ticketing.TAG}chat"})
            except Exception:
                inc = None
        msg = (f"I've raised {inc['number']} for the Service Desk: they will contact you." if inc else
               "I couldn't match this to a problem I can fix automatically. The Service Desk will contact you.")
        _say(user, "bot", msg, ticket=inc and {"number": inc["number"], "url": inc["url"]})
        return {"reply": msg}

    reporter = {"username": user["username"], "name": user["name"], "title": user.get("title", ""), "text": text}
    alert = _alert_for(uc, user, c["summary"])
    existing = next((d for d in store.list_investigations(60) if d["alert"].get("key") == alert["key"] and d["status"] in engine.OPEN), None)
    if existing:
        t = existing.get("ticket") or {}
        if t.get("sys_id"):
            ticketing.comment(existing, f"{user['name']} has also reported this: \"{text[:200]}\". They are linked to this incident.")
        msg = (f"We already know about this and are fixing it: {t.get('number', existing['id'])}. "
               "I've added you to it, so you'll see the progress here.")
        _say(user, "bot", msg, inv=existing["id"], ticket=t and {"number": t.get("number"), "url": t.get("url")})
        return {"reply": msg, "investigation": existing["id"]}

    if alert["key"] in engine.ALERTS:
        engine.ALERTS[alert["key"]].update(status="investigating")
    else:
        engine.ALERTS[alert["key"]] = {**alert, "id": store.new_id("ALR"), "usecase": uc, "status": "investigating", "first_seen": time.time(),
                                       "last_seen": time.time(), "investigation_id": None}
    doc = engine.start(uc, alert, started_by=f"{user['name']} (help bot)", reporter=reporter)
    engine.ALERTS[alert["key"]]["investigation_id"] = doc["id"]
    msg = f"Thanks {user['name'].split(' ')[0]}. I'm raising a ServiceNow incident for this ({INTENTS[uc]['label'].lower()}) and our assistant is looking into it now."
    _say(user, "bot", msg, inv=doc["id"])
    return {"reply": msg, "investigation": doc["id"]}


def _progress(d: dict) -> dict:
    st = d["status"]
    agents = {a["key"]: a["status"] for a in d["agents"]}
    if st in ("resolved",):
        step, text = 4, "Fixed and checked. " + {"sso": "You can sign in again.", "network": "The branch connection is back to normal.",
                                                 "api": "RouteOps is working normally.", "storage": "The server has space again.",
                                                 "backup": "Backups are running and a restore test passed.",
                                                 "mail": "Email is working normally again."}.get(d["usecase"], "")
    elif st in ("remediating", "verifying"):
        step, text = 3, "The fix is being applied and checked."
    elif st == "awaiting_approval":
        step, text = 2, "We found the cause and a fix is ready. An IT engineer is approving it."
    elif st == "new":
        step, text = 0, "Your incident is with IT. An IT Administrator will start the investigation shortly."
    elif st in ("investigating",):
        step = 1
        text = "Looking into it: " + ("checking the cause." if agents.get("rca") in ("running", "done") else "collecting information.")
    elif not (d.get("rca") or {}).get("cause") and (d.get("outcome") or {}).get("result") in ("handed_over", "rejected", "false_positive"):
        area = {"sso": "your account", "network": "the branch network", "api": "RouteOps", "storage": "the server",
                "backup": "the backups", "mail": "email"}.get(d["usecase"], "the system")
        step, text = 2, (f"We checked {area} and found it working normally right now, so there was nothing to fix automatically. "
                         "An IT engineer has your ticket and will contact you if it happens again.")
    else:
        step, text = 2 if st == "closed" else 1, {"escalated": "An IT engineer has taken over and will contact you.",
                                                  "closed": "An IT engineer has taken over your ticket.",
                                                  "interrupted": "Interrupted: please send your message again.",
                                                  "cancelled": "Cancelled.", "failed": "Something went wrong: an IT engineer will contact you."}.get(st, st)
    t = d.get("ticket") or {}
    return {"investigation": d["id"], "status": st, "step": step, "steps": EMP_STEPS, "text": text,
            "ticket": {"number": t.get("number"), "url": t.get("url"), "state": t.get("state")} if t else None,
            "cause": (d.get("rca") or {}).get("cause") if st in ("awaiting_approval", "remediating", "verifying", "resolved") else None,
            "title": d["title"]}


def conversation(username: str) -> dict:
    from .demo import session_start
    since = session_start()
    msgs = [e for e in store.events("chat", 400, since) if e["data"].get("user") == username][::-1][-60:]
    invs = {m["data"]["inv"] for m in msgs if m["data"].get("inv")}
    progress = {}
    for i in invs:
        d = store.get_investigation(i)
        if d:
            progress[i] = _progress(d)
    return {"messages": [{"id": m["id"], "ts": m["ts"], "role": m["data"]["role"], "text": m["data"]["text"], "inv": m["data"].get("inv"),
                          "ticket": m["data"].get("ticket")} for m in msgs], "progress": progress, "suggestions": SUGGESTIONS}
