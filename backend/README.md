# Tachyon Aura Agent Factory

Not the real Aura platform — a standalone app built on Aura's underlying idea (a root orchestrator
handing off to platform-specific specialist agents, built from a reviewable blueprint), with no
dependency on the real AURA-Agent-Orchestrator service.

Type a business process description, or paste an SOP, into the chat. It automatically:

1. Proposes a multi-agent blueprint (a root orchestrator + specialist agents, including a human
   escalation agent if the text names an escalation condition).
2. Lets you refine it conversationally ("add a routing rule to human escalation based on negative
   sentiment") before you approve it.
3. On approval, builds and deploys it: each specialist agent is activated directly against its own
   target platform, with its own deployment record.
4. The moment it's built, the agents are live in the same chat: ask them to read or write against
   Salesforce, Databricks, Snowflake, ServiceNow, or Microsoft 365/SharePoint. Writes always ask for
   confirmation first. **Salesforce can be real** (see below); the other four are still mocked until
   the same connect pattern is repeated for them.
5. Every step — routing decision, tool call, guardrail check, deployment — shows up in the trace
   panel on the right in real time.

## Run it

```bash
cd aura-chat-builder
uv run uvicorn app.main:app --port 8001
# Add --reload --reload-dir app only when editing backend code. In a OneDrive folder, plain
# --reload keeps restarting the server (OneDrive touches backend/.venv) and cuts agent calls off.
```

This is the API only. The UI is in `../frontend` — run it too (`cd frontend; npm run dev`) and open
http://localhost:3000 (Point32Health Control Tower: http://localhost:3000/p32). API docs: http://localhost:8001/docs

Works with no configuration (heuristic keyword mode, mocked platforms). Optionally copy
`.env.example` to `.env` and set `COHERE_API_KEY` for real language understanding instead of the
keyword heuristic.

## Connecting a real Salesforce org

Without this, Salesforce stays mocked like the other four platforms. With it, the chat shows a
**"Connect to Salesforce"** button the first time an agent needs Salesforce, and after you click
through and authorize, that session's reads/writes hit your real org (SOQL query for reads, a real
Task record for writes).

1. In Salesforce Setup (a sandbox org is safest for this): **App Manager → New Connected App**.
2. Fill in name/API name/contact email. Check **Enable OAuth Settings**.
3. Callback URL: `http://localhost:8811/connect/salesforce/callback` (must match `SALESFORCE_REDIRECT_URI`
   below exactly, including the port you actually run on).
4. Selected OAuth Scopes: add **"Manage user data via APIs (api)"** and **"Perform requests at any
   time (refresh_token, offline_access)"**.
5. Save — it can take a few minutes to activate. Then open **Manage Consumer Details** (may require
   an emailed verification code) to get the **Consumer Key** and **Consumer Secret**.
6. In `aura-chat-builder/.env`:
   ```
   SALESFORCE_CLIENT_ID=<consumer key>
   SALESFORCE_CLIENT_SECRET=<consumer secret>
   SALESFORCE_REDIRECT_URI=http://localhost:8811/connect/salesforce/callback
   SALESFORCE_LOGIN_URL=https://test.salesforce.com   # omit this line for a production/dev org
   ```
7. Restart the server. The Salesforce user you log in as needs read access to Opportunity/Account
   and create access to Task for the demo's read and write actions to work.

This is a real OAuth authorization-code flow — no refresh-token renewal is implemented (fine for a
demo session; the access token just expires after Salesforce's default window and you'd reconnect).

## Try it

Paste something like:

> Customers contact us about order status and returns. If the customer's tone is negative, or this
> is a repeat issue, escalate to a human agent instead of resolving it automatically.

Approve the proposal, then try:

> Pull the open opportunities for Acme Corp from Salesforce
>
> Check their churn score in Databricks
>
> Open a ServiceNow ticket for the account team — they need a callback

The last one is a write, so it'll ask you to confirm before it "creates" the ticket.
