"""Mocked read/write connectors for the six showcase platforms.

No sandbox credentials exist for Salesforce/Databricks/Snowflake/Oracle/
ServiceNow/Microsoft 365 in this environment yet (see the BRD's Assumptions
& Risks).
These functions stand in for the real platform APIs described in the BRD's
per-platform integration table so the end-to-end chat -> agent -> action ->
trace flow can be demoed today. Swap each function body for a real API call
once sandbox credentials are provisioned -- the call signature (an
"action" name plus a plain dict of parameters, returning a plain dict) is
deliberately the same shape a real call would use.
"""

import random
import time

from . import llm

_ACCOUNTS = ["Acme Corp", "Globex Inc", "Initech", "Umbrella Retail"]

# Fake records in the SAME shape salesforce_connect.query_records() returns
# for real -- so a mock read/write renders through humanize.py exactly like
# a real one, and mock mode actually reflects which object was asked for
# (Lead, Account, ...) instead of always returning Opportunity data.
_FAKE_RECORDS = {
    "Account": [
        {"Id": "001fk00000A1B2C", "Name": "Acme Corp", "Industry": "Manufacturing"},
        {"Id": "001fk00000A1B2D", "Name": "Globex Inc", "Industry": "Technology"},
        {"Id": "001fk00000A1B2E", "Name": "Initech", "Industry": "Software"},
        {"Id": "001fk00000A1B2F", "Name": "Umbrella Retail", "Industry": "Retail"},
    ],
    "Opportunity": [
        {"Id": "006fk00000O1A1A", "Name": "Acme Corp — Renewal FY26", "StageName": "Negotiation", "Amount": 84000},
        {"Id": "006fk00000O1A1B", "Name": "Acme Corp — Expansion", "StageName": "Proposal", "Amount": 21000},
        {"Id": "006fk00000O1A1C", "Name": "Globex Inc — New Business", "StageName": "Qualification", "Amount": 45000},
    ],
    "Lead": [
        {"Id": "00Qfk00000L1A1A", "Name": "Jordan Lee", "Company": "Acme Corp", "Status": "Open"},
        {"Id": "00Qfk00000L1A1B", "Name": "Priya Nair", "Company": "Globex Inc", "Status": "Contacted"},
    ],
    "Contact": [
        {"Id": "003fk00000C1A1A", "FirstName": "Sam", "LastName": "Rivera", "Email": "sam.rivera@acmecorp.example"},
        {"Id": "003fk00000C1A1B", "FirstName": "Dana", "LastName": "Kim", "Email": "dana.kim@globex.example"},
    ],
    "Case": [
        {"Id": "500fk00000C1A1A", "CaseNumber": "00001042", "Subject": "Login issue", "Status": "New"},
        {"Id": "500fk00000C1A1B", "CaseNumber": "00001043", "Subject": "Billing question", "Status": "Working"},
    ],
    "Task": [
        {"Id": "00Tfk00000T1A1A", "Subject": "Follow up call", "Status": "Not Started"},
    ],
}

_ID_PREFIX = {"Lead": "00Q", "Account": "001", "Opportunity": "006", "Contact": "003", "Case": "500", "Task": "00T"}


def _latency(low_ms: int = 120, high_ms: int = 480) -> int:
    ms = random.randint(low_ms, high_ms)
    time.sleep(ms / 1000)
    return ms


def salesforce_read(params: dict) -> tuple[dict, int]:
    latency = _latency()
    sobject = params.get("sobject", "Opportunity")
    account = params.get("account")
    count_only = params.get("count_only", False)
    records = list(_FAKE_RECORDS.get(sobject, []))
    if account and sobject in ("Opportunity", "Account"):
        matching = [r for r in records if account.lower() in r.get("Name", "").lower()]
        records = matching or records
    if count_only:
        return {"sobject": sobject, "count": len(records)}, latency
    return {"sobject": sobject, "count": len(records), "records": records}, latency


def salesforce_write(params: dict) -> tuple[dict, int]:
    latency = _latency(200, 600)
    sobject = params.get("sobject", "Task")
    fields = params.get("fields", {})
    record_id = f"{_ID_PREFIX.get(sobject, '000')}fk{random.randint(100000, 999999)}"
    return (
        {"action": f"create_{sobject.lower()}", "object": sobject, "record_id": record_id, "fields": fields},
        latency,
    )


def databricks_read(params: dict) -> tuple[dict, int]:
    latency = _latency(150, 500)
    account = params.get("account", random.choice(_ACCOUNTS))
    score = round(random.uniform(0.1, 0.95), 2)
    return (
        {
            "account": account,
            "table": "analytics.churn_scores",
            "churn_score": score,
            "risk_band": "high" if score >= 0.6 else "low",
        },
        latency,
    )


def databricks_write(params: dict) -> tuple[dict, int]:
    latency = _latency(200, 550)
    return (
        {
            "action": "MERGE",
            "table": params.get("table", "analytics.account_flags"),
            "rows_affected": 1,
        },
        latency,
    )


def snowflake_read(params: dict) -> tuple[dict, int]:
    latency = _latency(130, 420)
    account = params.get("account", random.choice(_ACCOUNTS))
    return (
        {
            "account": account,
            "recent_orders": random.randint(0, 6),
            "last_order_date": "2026-08-14",
        },
        latency,
    )


def snowflake_write(params: dict) -> tuple[dict, int]:
    latency = _latency(180, 500)
    return (
        {"action": "INSERT", "table": params.get("table", "sales.order_notes"), "rows_affected": 1},
        latency,
    )


def servicenow_read(params: dict) -> tuple[dict, int]:
    latency = _latency(140, 460)
    query_type = params.get("query_type", "list")
    table = params.get("table", "incident")
    number = params.get("incident_number")

    if query_type == "attachments":
        count = random.randint(0, 2)
        names = [f"{['screenshot', 'log', 'error_report'][i % 3]}_{i + 1}.png" for i in range(count)]
        return {"attachments_for": number, "attachment_count": count, "attachment_names": names}, latency

    if query_type == "detail":
        return {
            "table": table, "incident_detail": True, "number": number,
            "short_description": "Escalation from Aura chat agent", "state": "In Progress",
            "priority": "3 - Moderate", "assigned_to": "Jamie Rivera", "opened_at": "2026-08-20 09:14:00",
        }, latency

    status = params.get("status", "open")
    ci_name = params.get("ci_name")
    keyword = params.get("keyword")
    prefix = _MOCK_NUMBER_PREFIXES.get(table, "INC")
    count = random.randint(0, 3)
    numbers = [f"{prefix}00{random.randint(10000, 99999)}" for _ in range(count)]
    return {
        "table": table, "incident_status": status, "incident_count": count,
        "numbers": numbers, "ci_name": ci_name, "keyword": keyword,
    }, latency


_MOCK_NUMBER_PREFIXES = {"incident": "INC", "problem": "PRB", "change_request": "CHG", "sc_req_item": "RITM", "kb_knowledge": "KB"}


def servicenow_write(params: dict, message: str = "") -> tuple[dict, int]:
    latency = _latency(220, 620)
    action = params.get("action", "create")
    table = params.get("table", "incident")
    prefix = _MOCK_NUMBER_PREFIXES.get(table, "INC")
    number = params.get("incident_number") or f"{prefix}00{random.randint(10000, 99999)}"

    short_description = llm.resolve_incident_summary(params, message) or "Escalation from Aura chat agent"
    if action == "create":
        return {
            "table": table, "action": "create_incident",
            "ticket_id": number,
            "short_description": short_description,
        }, latency
    if action == "update":
        fields = {**params.get("fields", {}), **params.get("choice_updates", {})}
        return {"table": table, "action": "update_incident", "number": number, "fields": fields}, latency
    if action == "assign":
        return {"table": table, "action": "assign_incident", "number": number, "assignee": params.get("assignee", "someone")}, latency
    if action == "delete":
        return {"table": table, "action": "delete_incident", "number": number}, latency
    if action in ("resolve", "close", "cancel"):
        return {"table": table, "action": f"{action}_incident", "number": number}, latency
    return {"table": table, "action": "create_incident", "ticket_id": number, "short_description": short_description}, latency


def oracle_read(params: dict) -> tuple[dict, int]:
    latency = _latency(140, 450)
    account = params.get("account", random.choice(_ACCOUNTS))
    return (
        {
            "account": account,
            "table": "ORDERS",
            "open_order_count": random.randint(0, 9),
            "last_updated": "2026-08-21",
        },
        latency,
    )


def oracle_write(params: dict) -> tuple[dict, int]:
    latency = _latency(200, 560)
    return (
        {"action": "UPDATE", "table": params.get("table", "ORDERS"), "rows_affected": 1},
        latency,
    )


def m365_read(params: dict) -> tuple[dict, int]:
    latency = _latency(150, 480)
    doc = params.get("document", "Acme Corp Proposal.docx")
    return (
        {
            "document": doc,
            "site": "sharepoint.com/sites/sales",
            "summary": f"Latest revision of '{doc}' — last edited 3 days ago, status: pending client sign-off.",
        },
        latency,
    )


def m365_write(params: dict) -> tuple[dict, int]:
    latency = _latency(200, 520)
    return (
        {"action": "update_list_item", "list": params.get("list", "Account Tracker"), "result": "updated"},
        latency,
    )


PLATFORM_TOOLS = {
    "salesforce": {"read": salesforce_read, "write": salesforce_write},
    "databricks": {"read": databricks_read, "write": databricks_write},
    "snowflake": {"read": snowflake_read, "write": snowflake_write},
    "oracle": {"read": oracle_read, "write": oracle_write},
    "servicenow": {"read": servicenow_read, "write": servicenow_write},
    "m365": {"read": m365_read, "write": m365_write},
}
