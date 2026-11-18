# Tachyon Aura — Frontend

The one UI for this repo. It is the UI the backend used to serve itself
(`backend/app/static/`), moved here so the backend is API-only.

| Route   | Page                                   | Source                                  |
| ------- | -------------------------------------- | --------------------------------------- |
| `/`     | Aura Agent Factory chat                | `public/index.html`                     |
| `/p32`  | Point32Health Control Tower / workbench | `src/p32/parts/*` → `dist/p32/index.html` |

`/api/*` and `/connect/*` are proxied to the FastAPI backend, so the browser
only talks to this origin: no CORS on the Python side, and the Salesforce
OAuth popup can `postMessage` back to its opener.

## Run

Start the backend first (see the repo README), then:

```bash
cd frontend
npm run dev        # http://localhost:3000  and  http://localhost:3000/p32
```

No `npm install` needed — the server has no dependencies (Node 18+).

| Script          | What it does                                                                   |
| --------------- | ------------------------------------------------------------------------------ |
| `npm run dev`   | Builds `/p32`, serves, and rebuilds it when `src/p32/parts` or the backend datasets change (refresh the browser). |
| `npm start`     | Builds `/p32` once and serves.                                                  |
| `npm run build` | Only builds `dist/p32/index.html`.                                              |
| `npm test`      | Builds `/p32` and runs its tests (`scripts/p32.test.mjs`, Node's built-in runner). |

Settings (env vars, or `frontend/.env` — see `.env.example`):

```
AURA_API_ORIGIN=http://127.0.0.1:8001   # backend
PORT=3000
HOST=127.0.0.1
```

If the backend is down, `/api/*` calls return `502 { ok: false, error }`. The
workbench then shows "Backend not reachable" and stays in Controlled Demo Mode.

## Layout

```
server.mjs              static server + /api, /connect proxy (+ watch/rebuild in dev)
scripts/build-p32.mjs   builds the /p32 page from src/p32/parts
scripts/https-proxy.mjs optional HTTPS front door for the https://tachyon-aura demo host
public/                 served as-is (/, logo)
src/p32/                workbench page source — see src/p32/README.md
dist/                   build output (git-ignored)
```

The `/p32` build embeds the demo datasets from `backend/app/p32_*.json`, the
same files the backend reads, so edit them there.
