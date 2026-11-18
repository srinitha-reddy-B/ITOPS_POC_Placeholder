"""One-off data migration: add the documented ITOPS-DEMO scenario (INC0010048, Payment API
cold-start HTTP 504) to the workbench dataset as a curated incident.

It is bound to the real ServiceNow record by number ("servicenow_number"), not by the
P32-WB tag, so the seeding endpoint skips it and Live Agent Mode writes to INC0010048.
Run from the repo root:  python backend/scripts/add_inc0010048.py
"""
import json
from pathlib import Path

P = Path(__file__).resolve().parents[1] / "app" / "p32_workbench_data.json"
data = json.loads(P.read_text(encoding="utf-8"))
if any(i["id"] == "DEMO-PAY-048" for i in data["incidents"]):
    raise SystemExit("already present")

incident = {
    "id": "DEMO-PAY-048",
    "use_case": "CLM",
    "servicenow_number": "INC0010048",
    "title": "Payment API returning HTTP 504 after idle period",
    "description": "Production Payment API is intermittently returning HTTP 504 Gateway Timeout on the first request after an idle period. The issue appears after the container app scales from zero to one replica. Subsequent requests succeed once the application is warm. Initial investigation suggests application startup may take longer than the API gateway (APIM) timeout.",
    "service": "Payment API",
    "ci": "payment-api-prod",
    "reported_by": "Monitoring alert (documented ITOPS demo, INC0010048)",
    "reported_min_ago": 70,
    "priority": "2 - High",
    "impact": "1 - High",
    "urgency": "2 - Medium",
    "category": "Software",
    "group": "",
    "business_impact": "Payment calls after quiet periods fail with HTTP 504 and must be retried; Finance and provider remittance see intermittent failures.",
    "complexity": "Single round: documented ITOPS demo scenario",
    "evidence": {
        "logs": [
            {"id": "L1", "t": 45, "source": "APIM gateway log", "text": "HTTP 504 on POST /payments: backend did not respond within 30 s; occurs only on the first request after 15+ minutes without traffic."},
            {"id": "L2", "t": 44, "source": "Container app system log", "text": "Replica scaled 0 -> 1 at the time of each failing request; container ready after 38-44 s (image pull, runtime start, dependency warm-up)."},
            {"id": "L3", "t": 40, "source": "Request traces", "text": "Requests after the replica is warm complete in about 180 ms; no 504s while traffic is continuous."},
        ],
        "metrics": [
            {"id": "M1", "name": "HTTP 504 rate on first request after idle", "unit": "%", "before": 100, "threshold": 5, "after": 0, "after2": 0, "better": "lower"},
        ],
        "changes": [
            {"id": "CHG-DEMO-7301", "t_hours": 72, "title": "Payment API scale-to-zero enabled (cost optimisation)", "detail": "Container app minimum replicas lowered from 1 to 0 for the production revision."},
        ],
        "history": [
            {"id": "SYN-PAY-11", "title": "Reporting API 504 after idle on scale-to-zero revision", "resolution": "Minimum replicas set to 1; gateway timeout raised."},
        ],
        "kb": [
            {"id": "SOP-APP-0142", "title": "Payment API cold-start HTTP 504 remediation", "summary": "Keep min replicas at 1 for production APIs and set the APIM backend timeout above the worst-case cold-start time."},
        ],
        "cmdb": {"class": "API service (container app behind APIM)", "depends_on": ["APIM gateway", "payments database"], "owner_group": "Cloud Platform Operations", "environment": "Production (synthetic telemetry)"},
        "deep": [],
    },
    "script": {
        "hypotheses": [
            {"title": "Cold start after scale-to-zero exceeds the 30 s gateway timeout", "why": "504s occur only on the first request after idle, exactly when the replica scales from 0 to 1 and takes 38-44 s to become ready.", "evidence": ["L1", "L2", "CHG-DEMO-7301"], "confidence": 0.86},
            {"title": "Payments database slow to accept new connections", "why": "A slow dependency could delay the first request.", "evidence": [], "confidence": 0.09},
            {"title": "Intermittent network loss between APIM and the container app", "why": "Gateway timeouts can come from network drops.", "evidence": [], "confidence": 0.05},
        ],
        "critic": [
            "Directly supported: the 504 timing matches every scale-up from zero.",
            "Warm requests succeed in 180 ms, so the database is not the bottleneck.",
            "Failures only after idle periods do not fit random network loss.",
        ],
        "selected": 0,
        "needs_round2": False,
        "root_cause": "Change CHG-DEMO-7301 set the Payment API container app to scale to zero; the first request after an idle period triggers a cold start of 38-44 seconds, which exceeds the 30 second APIM backend timeout, so the gateway returns HTTP 504 before the replica is ready.",
        "contributing": ["The APIM timeout was not reviewed when scale-to-zero was enabled.", "No synthetic check calls the API after idle periods."],
        "remediation": [
            {"step": "Record the current min/max replica settings and the APIM backend timeout in the incident.", "expected": "Settings captured: min replicas 0, APIM timeout 30 s."},
            {"step": "Set min replicas to 1 for the production revision (standard change template 'Scale settings').", "expected": "One replica stays warm."},
            {"step": "Raise the APIM backend timeout for the Payment API from 30 s to 60 s.", "expected": "Gateway timeout exceeds the worst-case cold start."},
            {"step": "Let the service idle for 15 minutes, then send a test payment request.", "expected": "HTTP 200 on the first request after idle."},
        ],
        "rollback": "Restore the previous scale settings and APIM timeout from the recorded values.",
        "prevention": ["Keep a minimum replica of 1 for latency-sensitive production APIs.", "Alert when startup time approaches the gateway timeout; add a synthetic check after idle periods."],
        "exec_fail": None,
        "verify_fail_first": False,
    },
}
data["incidents"].insert(0, incident)
P.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print("added DEMO-PAY-048 (INC0010048)")
