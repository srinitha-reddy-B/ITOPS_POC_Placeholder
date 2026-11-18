// Keycloak OpenID Connect sign-in: Authorization Code + PKCE (S256), in a popup so the console stays in place.
// The console never decides who you are: Keycloak authenticates, and the backend verifies every token it receives.

const STORE = "cc-ops-session";
let cfg = null;
let session = load();
let refreshTimer = null;
const listeners = new Set();

function load() {
  try { return JSON.parse(sessionStorage.getItem(STORE)) || null; } catch { return null; }
}
function save(s) {
  session = s;
  try { s ? sessionStorage.setItem(STORE, JSON.stringify(s)) : sessionStorage.removeItem(STORE); } catch { /* private mode */ }
  listeners.forEach((fn) => fn(s));
  schedule();
}
export function onSession(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getSession() { return session; }
export function accessToken() { return session?.access_token || null; }

export async function config() {
  if (!cfg) {
    const r = await fetch("/api/ops/config");
    if (!r.ok) throw new Error(`Backend not reachable (HTTP ${r.status})`);
    cfg = await r.json();
  }
  return cfg;
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const endpoint = (c, p) => `${c.keycloak_url}/realms/${c.realm}/protocol/openid-connect/${p}`;
const redirectUri = () => `${location.origin}/crystal-clean/ops/callback.html`;

export function decode(jwt) {
  try { return JSON.parse(decodeURIComponent(escape(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))))); } catch { return {}; }
}

/** Opens Keycloak's sign-in page for `username`. Resolves with the session, or rejects with Keycloak's error. */
export async function signIn(username) {
  const c = await config();
  const verifier = rand(48);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = rand(16);
  sessionStorage.setItem(`cc-pkce-${state}`, verifier);
  const url = new URL(endpoint(c, "auth"));
  Object.entries({ client_id: c.client_id, response_type: "code", scope: "openid profile email", redirect_uri: redirectUri(),
    code_challenge: challenge, code_challenge_method: "S256", state, prompt: "login", ...(username ? { login_hint: username } : {}) })
    .forEach(([k, v]) => url.searchParams.set(k, v));
  // Full-page redirect to single sign-on, as company portals do; callback.html brings the code back to this app.
  location.assign(url);
  return new Promise(() => {});
}

async function finish(msg) {
  if (msg.error) throw new Error(msg.error_description || msg.error);
  const c = await config();
  const verifier = sessionStorage.getItem(`cc-pkce-${msg.state}`);
  sessionStorage.removeItem(`cc-pkce-${msg.state}`);
  if (!verifier) throw new Error("Sign-in state not recognised; try again");
  const r = await fetch(endpoint(c, "token"), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: c.client_id, code: msg.code, redirect_uri: redirectUri(), code_verifier: verifier }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || "token exchange failed");
  const s = { ...j, received: Date.now() };
  save(s);
  return s;
}

/** Called on page load: completes a sign-in that ran in this tab because the popup was blocked. */
export async function resumeRedirect() {
  const raw = sessionStorage.getItem("cc-oidc-callback");
  if (!raw) return null;
  sessionStorage.removeItem("cc-oidc-callback");
  return finish(JSON.parse(raw));
}

async function refresh() {
  if (!session?.refresh_token) return;
  const c = await config();
  let r;
  try {
    r = await fetch(endpoint(c, "token"), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: c.client_id, refresh_token: session.refresh_token }) });
  } catch {
    // Sign-in service unreachable: keep the current session and try again shortly
    clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 20000); return;
  }
  if (!r.ok) { save(null); return; } // SSO session ended in Keycloak (signed out, disabled, expired)
  save({ ...(await r.json()), received: Date.now() });
}

function schedule() {
  clearTimeout(refreshTimer);
  if (!session) return;
  const ms = Math.max(5000, session.received + (session.expires_in - 30) * 1000 - Date.now());
  refreshTimer = setTimeout(refresh, ms);
}
schedule();

/** Ends the Keycloak SSO session (not just the local tokens) and returns to the sign-in screen. */
export async function signOut() {
  const c = await config();
  const idt = session?.id_token;
  save(null);
  const url = new URL(endpoint(c, "logout"));
  url.searchParams.set("client_id", c.client_id);
  url.searchParams.set("post_logout_redirect_uri", `${location.origin}/crystal-clean/ops/?signedout=1`);
  if (idt) url.searchParams.set("id_token_hint", idt);
  location.assign(url);
}

export function expireLocal() { save(null); }
