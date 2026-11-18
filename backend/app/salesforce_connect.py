"""Real Salesforce connection: OAuth2 web-server flow + REST API calls.

This is the "click to connect" path the user asked for -- once a session
has connected a real Salesforce org, the Salesforce agent's reads/writes hit
that org for real (SOQL query, and a Task creation for writes).

The Connected App's Client ID/Secret can come from env vars (SALESFORCE_
CLIENT_ID/SECRET/LOGIN_URL) at startup, or be set live from chat via
`configure()` -- see the "connect salesforce <client_id> <client_secret>"
command in main.py -- so a fresh install never has to touch a .env file or
restart the server to get going.
"""

import os
import urllib.parse

import httpx

_REDIRECT_URI = os.environ.get("SALESFORCE_REDIRECT_URI") or "http://localhost:8811/connect/salesforce/callback"
_API_VERSION = "v61.0"

_PRODUCTION = "https://login.salesforce.com"
_SANDBOX = "https://test.salesforce.com"
_OTHER_HOST = {_PRODUCTION: _SANDBOX, _SANDBOX: _PRODUCTION}

# Runtime-settable app credentials -- env vars are just the initial values.
# login_base is a best guess, not something the user has to know: it's
# whichever host last worked for this Client ID, defaulting to production.
# See complete_connection()/next_host_to_try() for the auto-detect flow.
_app_config = {
    "login_base": os.environ.get("SALESFORCE_LOGIN_URL") or _PRODUCTION,
    "client_id": os.environ.get("SALESFORCE_CLIENT_ID") or "",
    "client_secret": os.environ.get("SALESFORCE_CLIENT_SECRET") or "",
}

# session_id -> {access_token, instance_url, org_type}. In-memory only --
# lost on restart, same simplification as trace_store and the chat session state.
_connections: dict[str, dict] = {}

SETUP_INSTRUCTIONS = (
    "Salesforce requires a one-time Connected App before any login screen can grant real API access — "
    "that's a Salesforce rule, not something this app can skip:\n"
    "1. Setup → App Manager → New Connected App.\n"
    "2. Enable OAuth Settings. Callback URL: " + _REDIRECT_URI + "\n"
    "3. Selected OAuth Scopes: add \"Manage user data via APIs (api)\" and "
    "\"Perform requests at any time (refresh_token, offline_access)\".\n"
    "4. Save, then open Manage Consumer Details for the Consumer Key and Consumer Secret.\n"
    "5. Fill in the two fields below — you don't need to know if your org is Production or a "
    "Sandbox, I'll detect that automatically and tell you which it was."
)

SETUP_FORM_FIELDS = [
    {"name": "client_id", "label": "Consumer Key", "type": "text"},
    {"name": "client_secret", "label": "Consumer Secret", "type": "password"},
]


def configure(client_id: str, client_secret: str) -> None:
    _app_config["client_id"] = client_id.strip()
    _app_config["client_secret"] = client_secret.strip()


def configured() -> bool:
    return bool(_app_config["client_id"] and _app_config["client_secret"])


def current_login_base() -> str:
    return _app_config["login_base"]


def is_connected(session_id: str) -> bool:
    return session_id in _connections


def org_type(session_id: str) -> str | None:
    conn = _connections.get(session_id)
    return conn["org_type"] if conn else None


def disconnect(session_id: str) -> None:
    _connections.pop(session_id, None)


def authorize_url(session_id: str, host: str | None = None, retried: bool = False) -> str:
    """The URL to send the user's browser to. `state` carries the session_id,
    which host this attempt is against, and whether this is already an
    automatic retry -- so the callback can flip to the other host on an
    invalid_client_id error exactly once, instead of looping forever."""
    host = host or _app_config["login_base"]
    params = {
        "response_type": "code",
        "client_id": _app_config["client_id"],
        "redirect_uri": _REDIRECT_URI,
        "scope": "api refresh_token",
        "state": f"{session_id}|{host}|{'1' if retried else '0'}",
    }
    return f"{host}/services/oauth2/authorize?{urllib.parse.urlencode(params)}"


def parse_state(state: str) -> tuple[str, str, bool]:
    session_id, host, retried = state.split("|", 2)
    return session_id, host, retried == "1"


def other_host(host: str) -> str:
    return _OTHER_HOST.get(host, _PRODUCTION)


def complete_connection(code: str, host: str, session_id: str) -> str:
    """Exchanges the OAuth code for a token and stores it against session_id.
    Returns "Production" or "Sandbox" so the caller can report which one this
    Client ID actually turned out to belong to."""
    resp = httpx.post(
        f"{host}/services/oauth2/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "client_id": _app_config["client_id"],
            "client_secret": _app_config["client_secret"],
            "redirect_uri": _REDIRECT_URI,
        },
        timeout=10.0,
    )
    resp.raise_for_status()
    data = resp.json()
    org_label = "Sandbox" if host == _SANDBOX else "Production"
    _connections[session_id] = {
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token"),
        "instance_url": data["instance_url"],
        "org_type": org_label,
        "host": host,
    }
    _app_config["login_base"] = host  # remember what worked, so future sessions guess right first try
    return org_label


def _headers(session_id: str) -> dict:
    return {"Authorization": f"Bearer {_connections[session_id]['access_token']}"}


def _refresh_access_token(session_id: str) -> bool:
    """Access tokens expire (Salesforce's default is a couple of hours); we
    asked for the `refresh_token` scope specifically so we could recover
    from that automatically instead of just failing with a 401 forever
    until the user manually reconnects. Returns True if it got a new token."""
    conn = _connections.get(session_id)
    if not conn or not conn.get("refresh_token"):
        return False
    try:
        resp = httpx.post(
            f"{conn['host']}/services/oauth2/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": conn["refresh_token"],
                "client_id": _app_config["client_id"],
                "client_secret": _app_config["client_secret"],
            },
            timeout=10.0,
        )
        resp.raise_for_status()
        data = resp.json()
        conn["access_token"] = data["access_token"]
        conn["instance_url"] = data.get("instance_url", conn["instance_url"])
        return True
    except Exception:
        return False


class AuthExpired(Exception):
    """Raised when a 401 can't be recovered by refreshing the token -- either
    there's no refresh_token stored (a connection from before that feature
    existed) or the refresh itself was rejected (revoked/expired). Callers
    should offer to reconnect, not just report the error and stop."""


def _request(session_id: str, method: str, url: str, *, headers: dict | None = None, **kwargs) -> httpx.Response:
    """GET/POST wrapper that transparently refreshes an expired access token
    and retries once, instead of surfacing a raw 401 to the user every time
    the token has simply timed out. If that doesn't recover it, disconnects
    the session (so is_connected() reflects reality) and raises AuthExpired
    instead of a generic HTTP error, so the caller can offer a reconnect
    action instead of a dead-end error message."""
    def do_request() -> httpx.Response:
        merged = {**_headers(session_id), **(headers or {})}
        return httpx.request(method, url, headers=merged, timeout=15.0, **kwargs)

    resp = do_request()
    if resp.status_code == 401:
        if _refresh_access_token(session_id):
            resp = do_request()
        if resp.status_code == 401:
            disconnect(session_id)
            raise AuthExpired("Your Salesforce session expired and couldn't be refreshed automatically.")
    resp.raise_for_status()
    return resp


_LIST_FIELDS = {
    "Account": ["Id", "Name", "Industry"],
    "Opportunity": ["Id", "Name", "StageName", "Amount"],
    "Lead": ["Id", "Name", "Company", "Status"],
    "Contact": ["Id", "FirstName", "LastName", "Email"],
    "Case": ["Id", "CaseNumber", "Subject", "Status"],
    "Task": ["Id", "Subject", "Status"],
}

# Which field to filter by account name on, per object -- Account itself
# filters on its own Name; the others filter through their Account lookup.
_ACCOUNT_FILTER_FIELD = {
    "Account": "Name",
    "Opportunity": "Account.Name",
    "Contact": "Account.Name",
    "Case": "Account.Name",
}


def query_records(session_id: str, sobject: str, account: str | None, count_only: bool) -> dict:
    """Queries whatever object llm.parse_read_intent() determined (Account,
    Opportunity, Lead, ...) instead of always querying Opportunity
    regardless of what was actually asked."""
    conn = _connections[session_id]
    filter_field = _ACCOUNT_FILTER_FIELD.get(sobject)
    where = f"WHERE {filter_field} = '{_escape(account)}'" if account and filter_field else ""

    if count_only:
        soql = f"SELECT COUNT() FROM {sobject} {where}"
        resp = _request(session_id, "GET", f"{conn['instance_url']}/services/data/{_API_VERSION}/query", params={"q": soql})
        return {"sobject": sobject, "count": resp.json().get("totalSize", 0)}

    fields = _LIST_FIELDS.get(sobject, ["Id", "Name"])
    soql = f"SELECT {', '.join(fields)} FROM {sobject} {where} ORDER BY CreatedDate DESC LIMIT 10"
    resp = _request(session_id, "GET", f"{conn['instance_url']}/services/data/{_API_VERSION}/query", params={"q": soql})
    body = resp.json()
    return {
        "sobject": sobject,
        "count": body.get("totalSize", 0),
        "records": [{f: r.get(f) for f in fields} for r in body.get("records", [])],
    }


def create_record(session_id: str, sobject: str, fields: dict, account: str | None = None) -> dict:
    """Creates a real record of whatever object llm.parse_write_intent()
    determined (Lead, Account, Opportunity, Case, Task, ...) with the fields
    it extracted -- this replaces the old behavior of always creating a
    generic Task regardless of what was actually asked for."""
    conn = _connections[session_id]
    payload = dict(fields)

    if sobject in ("Task", "Case") and account and "WhatId" not in payload:
        found = _request(
            session_id, "GET", f"{conn['instance_url']}/services/data/{_API_VERSION}/query",
            params={"q": f"SELECT Id FROM Account WHERE Name = '{_escape(account)}' LIMIT 1"},
        ).json()
        records = found.get("records", [])
        if records:
            payload["WhatId"] = records[0]["Id"]

    resp = _request(
        session_id, "POST", f"{conn['instance_url']}/services/data/{_API_VERSION}/sobjects/{sobject}",
        json=payload, headers={"Content-Type": "application/json"},
    )
    body = resp.json()
    return {"action": f"create_{sobject.lower()}", "object": sobject, "record_id": body["id"], "fields": payload}


def _escape(value: str) -> str:
    return value.replace("'", "\\'")
