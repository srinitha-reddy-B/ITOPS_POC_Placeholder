// Tachyon Aura frontend server (no dependencies, Node 18+).
//
//   /                 Aura Agent Factory chat         public/index.html
//   /p32              Point32Health workbench          dist/p32/index.html (built from src/p32)
//   /portal           Employee landing page and sign-in  public/portal/index.html
//   /crystal-clean/ops  IT Administrator's Ops Console  dist/crystal-clean/ops (built from ops-console: npm run build:ops)
//   /crystal-clean    Crystal Clean Service Hub demo   public/crystal-clean/index.html
//   /api/*, /connect/* proxied to the FastAPI backend  (AURA_API_ORIGIN)
//
// The browser only ever talks to this origin, so the backend needs no CORS
// middleware and the Salesforce OAuth popup can postMessage back to its opener.
//
//   npm run dev     build, serve, and rebuild /p32 whenever src/p32 or the backend datasets change
//   npm start       build once and serve
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildP32, OUT as P32_PAGE, WATCH } from "./scripts/build-p32.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(ROOT, ".env"));

const DEV = process.argv.includes("--dev");
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";
const API = new URL(process.env.AURA_API_ORIGIN ?? "http://127.0.0.1:8001");
const PROXY_PREFIXES = ["/api/", "/connect/"];
const STATIC_DIRS = [path.join(ROOT, "public"), path.join(ROOT, "dist")];
const CC_PAGE = path.join(ROOT, "public", "crystal-clean", "index.html");
const PORTAL = path.join(ROOT, "public", "portal", "index.html");
const OPS_CONSOLE = path.join(ROOT, "dist", "crystal-clean", "ops", "index.html");
const PAGES = { "/": path.join(ROOT, "public", "index.html"), "/portal": PORTAL, "/portal/": PORTAL, "/crystal-clean/ops": OPS_CONSOLE, "/crystal-clean/ops/": OPS_CONSOLE, "/p32": P32_PAGE, "/p32/": P32_PAGE, "/crystal-clean": CC_PAGE, "/crystal-clean/": CC_PAGE };
const BACKEND_HINT = `cd backend; uv run uvicorn app.main:app --port ${API.port || 80}`;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2",
};

// ---------------------------------------------------------------- build
try {
  buildP32();
} catch (e) {
  console.error(e.message);
  if (!DEV || !fs.existsSync(P32_PAGE)) process.exit(1);
  console.error("[p32] serving the previous build until the source is fixed");
}
if (DEV) watchP32();

// ---------------------------------------------------------------- server
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://x").pathname); }
  catch { return send(res, 400, "text/plain; charset=utf-8", "Bad request"); }
  if (PROXY_PREFIXES.some((p) => pathname.startsWith(p))) return proxy(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "text/plain; charset=utf-8", "Method not allowed");
  const file = PAGES[pathname] ?? findStatic(pathname);
  if (!file) return send(res, 404, "text/plain; charset=utf-8", `Not found: ${pathname}`);
  serveFile(req, res, file);
});
server.listen(PORT, HOST, () => {
  console.log(`\n  Tachyon Aura frontend  http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`    /      Aura Agent Factory`);
  console.log(`    /p32   Point32Health Control Tower`);
  console.log(`    /crystal-clean   Crystal Clean Service Hub`);
  console.log(`  API -> ${API.origin}${DEV ? "   (dev: /p32 rebuilds on change)" : ""}\n`);
  checkBackend();
});

function proxy(req, res) {
  const client = API.protocol === "https:" ? https : http;
  const upstream = client.request(
    {
      protocol: API.protocol, hostname: API.hostname, port: API.port || undefined,
      method: req.method, path: req.url,
      headers: {
        ...req.headers,
        host: API.host,
        "x-forwarded-host": req.headers.host ?? "",
        "x-forwarded-proto": req.headers["x-forwarded-proto"] ?? "http",
        "x-forwarded-for": req.socket.remoteAddress ?? "",
      },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    if (res.headersSent) return res.destroy();
    // Same shape the pages already handle for backend failures ({ ok: false, error }).
    send(res, 502, "application/json; charset=utf-8", JSON.stringify({
      ok: false, kind: "network",
      error: `nothing answered at ${API.origin} (${err.code ?? err.message}). Start the backend: ${BACKEND_HINT}`,
    }));
  });
  res.on("close", () => { if (!res.writableFinished) upstream.destroy(); });
  req.pipe(upstream);
}

function findStatic(pathname) {
  for (const dir of STATIC_DIRS) {
    const file = path.join(dir, pathname);
    if (!file.startsWith(dir + path.sep)) continue; // no path traversal
    try { if (fs.statSync(file).isFile()) return file; } catch {}
  }
  return null;
}

function serveFile(req, res, file) {
  fs.readFile(file, (err, body) => {
    if (err) return send(res, err.code === "ENOENT" ? 404 : 500, "text/plain; charset=utf-8", err.code === "ENOENT" ? "Not built yet" : err.message);
    const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "content-length": body.length,
      "cache-control": type.startsWith("text/html") ? "no-store" : "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  });
}

function send(res, status, type, body) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

// ---------------------------------------------------------------- helpers
function watchP32() {
  let timer = null;
  const rebuild = (what) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { buildP32({ quiet: true }); console.log(`[p32] rebuilt (${what})`); }
      catch (e) { console.error(e.message); }
    }, 150);
  };
  for (const dir of WATCH.dirs) fs.watch(dir, (_e, name) => rebuild(name ?? path.basename(dir)));
  for (const file of WATCH.files) fs.watchFile(file, { interval: 1000 }, () => rebuild(path.basename(file)));
}

function checkBackend() {
  const client = API.protocol === "https:" ? https : http;
  const req = client.get(new URL("/api/p32/wb/status", API), (r) => {
    r.resume();
    console.log(`  backend: reachable (HTTP ${r.statusCode})`);
  });
  req.setTimeout(3000, () => req.destroy(new Error("timeout")));
  req.on("error", (e) => console.warn(`  backend: NOT reachable at ${API.origin} (${e.code ?? e.message})\n  start it with: ${BACKEND_HINT}`));
}

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
