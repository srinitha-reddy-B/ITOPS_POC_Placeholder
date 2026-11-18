import { useEffect, useRef, useState, useCallback } from "react";
import { accessToken, expireLocal } from "./auth.js";

export class ApiError extends Error {
  constructor(status, detail) { super(detail); this.status = status; }
}

const PERSONA_KEY = "cc-demo-persona";
export function demoPersona() { try { return localStorage.getItem(PERSONA_KEY) || ""; } catch { return ""; } }
export function setDemoPersona(u) { try { localStorage.setItem(PERSONA_KEY, u); } catch { /* private mode */ } }

export async function api(path, { method = "GET", body } = {}) {
  const auth = accessToken() ? { Authorization: `Bearer ${accessToken()}` } : demoPersona() ? { "X-Demo-Persona": demoPersona() } : {};
  const r = await fetch(`/api/ops${path}`, {
    method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...auth },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch { /* empty */ }
  if (r.status === 401 && accessToken()) expireLocal(); // token rejected by the backend: back to sign-in
  if (!r.ok) throw new ApiError(r.status, j?.detail || j?.error || `HTTP ${r.status}`);
  return j;
}

/** Poll an endpoint every `ms`. Returns {data, error, reload}. Pauses while the tab is hidden. */
export function usePoll(path, ms = 4000, enabled = true) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!path || !enabled) return;
    try { const d = await api(path); if (alive.current) { setData(d); setError(null); } }
    catch (e) { if (alive.current) setError(e); }
  }, [path, enabled]);
  useEffect(() => {
    alive.current = true;
    setData(null);
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, ms);
    return () => { alive.current = false; clearInterval(t); };
  }, [load, ms]);
  return { data, error, reload: load };
}
