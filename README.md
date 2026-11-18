# Tachyon Aura Agent Factory / Point32Health POC

```
backend/    FastAPI app — API only (/api/*, /connect/*), no UI
frontend/   the UI — Aura Agent Factory chat (/) and Point32Health Control Tower (/p32)
```

There is one frontend. The backend no longer serves any pages, so you need
both processes running to use the app.

## Run it

Two terminals. Backend first.

```powershell
# terminal 1 — backend (API)
cd backend
copy .env.example .env        # first time only: add COHERE_API_KEY etc.
uv run uvicorn app.main:app --port 8001
# Add --reload --reload-dir app only when editing backend code. In a OneDrive folder, plain
# --reload keeps restarting the server (OneDrive touches backend/.venv) and cuts agent calls off.

# terminal 2 — frontend (UI)
cd frontend
npm run dev                   # no npm install needed
```

Open:

- http://localhost:3000/p32 — Point32Health Control Tower
  (e.g. http://localhost:3000/p32#/predictive/p/PRD-SSO-MWITZRQG)
- http://localhost:3000 — Aura Agent Factory chat

The backend on :8001 only answers API calls (`http://127.0.0.1:8001/docs` lists them).

## How they connect

`frontend/server.mjs` serves the pages and proxies `/api/*` and `/connect/*`
to the backend, so the browser only ever talks to one origin. No CORS
middleware is needed on the Python side, and the Salesforce OAuth popup can
postMessage back to its opener.

Run the backend on a different port? Tell the frontend with
`AURA_API_ORIGIN` (env var or `frontend/.env`, see `frontend/.env.example`):

```
AURA_API_ORIGIN=http://127.0.0.1:8001
```

## Editing the UI

- Point32Health workbench: edit `frontend/src/p32/parts/*`. `npm run dev`
  rebuilds `/p32` on save; refresh the browser.
- Aura chat: edit `frontend/public/index.html`.
- Demo datasets stay in `backend/app/p32_*.json` (the backend's agents use
  them too); the `/p32` build embeds them.

## Salesforce OAuth

`SALESFORCE_REDIRECT_URI` in `backend/.env` must match your Connected App's
callback URL exactly. Use the frontend origin so the popup stays same-origin:

- `http://localhost:3000/connect/salesforce/callback`

## Not included

`backend/.env` (holds API keys), `backend/.venv`, `frontend/dist/` (built
on start) and `.aura_state.json` are git-ignored.
