# Crystal Clean Service Hub demo

Page: **http://localhost:3000/crystal-clean**, with two views:
- **Employee:** the front door. There is one chat box, early-warning alerts and My requests.
- **IT team:** the view behind it. It shows the ServiceNow tickets with links, how each was fixed, the work notes read back from ServiceNow, early warnings and connected systems.

Code:
- `backend/app/cc_hub.py`
- the `/api/cc/*` routes in `backend/app/main.py`
- `frontend/public/crystal-clean/index.html`

The existing `/p32` app is unchanged.

## Why these three use cases

Crystal Clean runs more than 130 branches, industrial facilities and waste recovery centres. It is a route-based field business: drivers service customers' parts washers and collect used oil and waste. Hazardous-waste manifests are regulated records. It also grew through acquisitions in 2024–25: Envirosafe, Premium Environmental Services and Worldwide Recovery Systems.

| # | Who | Problem | What the hub really does |
|---|---|---|---|
| 1 | Field Service Rep, Elgin | Locked out before the route starts | Checks the account in the identity provider: status, failed sign-ins and how many sources they came from. If the failures came from three or more sources, it hands over to a person. Otherwise it unlocks the account and confirms it is active again. |
| 2 | Branch Office Admin, Indianapolis | Manifest scans won't save because the branch scan server is full | Checks the volume and forecasts when it will be full. It removes stuck scanner temp files older than 7 days and logs older than 14 days. Scans older than 90 days move to the archive tier and are never deleted. It writes a test scan to confirm the fix. |
| 3 | New Field Service Rep from an acquired company, Fontana | Can't open RouteOps Mobile | Checks group membership. The Field Service role is entitled to the app, so it adds the right group and confirms the access. Other roles go to a person for approval. |

Every step is posted as a ServiceNow work note. The employee gets a plain-language comment and the incident is resolved. If the hub finds no fault, it does not resolve the ticket: it hands it to the Service Desk.

**Predictive layer:** the employee sees an alert before the problem hits, and one click starts the same fix.
- failed sign-ins building up
- account locked
- scan volume forecast to fill (least-squares trend)
- route-app access missing for the employee's role

## Demo script (about 5 minutes)

1. In the IT team view, open **Demo controls** and click Reset, then *Lock Marcus's account* and *Fill the scan server*. Luis starts without app access.
2. Switch to the Employee view as **Marcus** and type "my handheld says my account is locked". The request moves Received → Working on it → Resolved.
3. Switch to **Priya**. The alert "Branch scan storage almost full" appears; click **Fix it now**.
4. Switch to **Luis** and type "I joined from Worldwide Recovery and RouteOps Mobile says not authorized".
5. Switch to **IT team**. Each ticket links to ServiceNow, and the timeline and real work notes are shown. Click a number to open the incident in ServiceNow.

## What is real, what is stand-in

| Part | Status |
|---|---|
| ServiceNow incidents, work notes, comments, resolution | Real (dev instance in `backend/.env`) |
| Understanding the message | Cohere when `COHERE_API_KEY` is set; keyword rules otherwise |
| Identity: unlock, groups | **Okta, real**, when `OKTA_ORG_URL` and `OKTA_API_TOKEN` are set. Otherwise a local demo directory. The IT view shows which one is in use. |
| Branch server | A sandbox volume on this machine with a 250 MB capacity (`%TEMP%\crystal-clean-hub`). The files and the cleanup are real; the server is a stand-in. |

The employee view never shows system names, models or agent details.

## Make the identity fix real with a free SSO (about 10 minutes)

The recommended option is the **Okta Integrator Free Plan**. It is free and replaced Okta's Developer Edition in 2025.

1. Sign up at developer.okta.com.
2. Create the following in the Okta Admin console:
   - Users `marcus.reed@…` and `luis.ortega@…`
   - Groups `Field Service` and `RouteOps-Mobile`
   - A bookmark app "RouteOps Mobile" assigned to `RouteOps-Mobile`

   Put both users in `Field Service`.
3. Create an API token: Security → API → Tokens.
4. Add the following to `backend/.env`:
   ```
   OKTA_ORG_URL=https://integrator-XXXX.okta.com
   OKTA_API_TOKEN=...
   CC_LOGIN_MARCUS=marcus.reed@yourdomain
   CC_LOGIN_LUIS=luis.ortega@yourdomain
   ```
5. To lock Marcus for real, sign in as him with a wrong password until Okta's lockout policy locks the account. Okta has no API to lock an account.

Other free options, if Okta isn't wanted:
- **Auth0 Free:** the Management API can remove user blocks.
- **Keycloak:** open source and self-hosted (needs Docker or Java). Its brute-force detection can lock a user and its admin API can unlock them.
- **Microsoft Entra ID Free:** needs a tenant, and unlocking needs the right admin role.

Free ways to make the server real later:
- an Oracle Cloud Always Free VM or an Azure free-tier VM, reached over SSH
- Netdata or Uptime Kuma as the monitoring source

## Settings (optional)

| Variable | Default |
|---|---|
| `CC_SANDBOX_DIR` | `%TEMP%\crystal-clean-hub` |
| `CC_STEP_MIN_SECONDS` | `1.4` (pause so each step can be watched) |
| `CC_ROUTE_APP_NAME` / `CC_ROUTE_GROUP` | `RouteOps Mobile` / `RouteOps-Mobile` |

## Logo

`frontend/public/crystal-clean/logo.webp` is the Crystal Clean logo. To change it, replace that file and keep the same name.

## Access

The demo has no sign-in screen:
- the employee comes from the `X-CC-User` header, checked against the three demo employees
- the IT view and demo controls need `X-CC-Role: it`
- employees only see their own requests

In production both come from the SSO token.
