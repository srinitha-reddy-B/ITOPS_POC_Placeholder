<script>
"use strict";
/* =====================================================================
   Predictive Incident Intelligence: simulation, risk engine and agents.
   A prediction runs five agents in order (Monitoring -> Historical
   Incident Analysis -> Predictive Intelligence -> Impact Analysis ->
   Notification). The existing eight-stage RCA workflow is NOT duplicated:
   when IT starts an investigation, the prediction becomes a workbench
   incident (and a real ServiceNow incident in Live Agent Mode) and the
   existing RCA agents take over.
   - Monitoring metrics are simulated in both modes (labelled), unless the
     backend reports Dynatrace as configured.
   - Live Agent Mode: agents are real LLM calls through /api/p32/wb/agent;
     incident history is read from the POC ServiceNow instance.
   - Controlled Demo Mode: scripted outputs and synthetic incident history.
   - The risk score comes from the rule-based engine below (rules-v1), never
     from the LLM, and is never presented as machine learning.
   ===================================================================== */
const PI_DATA = __PI_DATA__;
Object.assign(ICON_PATHS, {
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
  zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
});
const PI_SCEN = Object.fromEntries(PI_DATA.scenarios.map((s) => [s.id, s]));
const PI_ORDER = ["monitor", "history", "predict", "impact", "notify"];
const PI_NODES = {
  monitor: { name: "Monitoring Agent", short: "Monitoring", icon: "activity", agent: "pi_monitor", role: "Analyses the operational metrics against their baselines and thresholds and decides whether the behaviour is abnormal." },
  history: { name: "Historical Incident Analysis Agent", short: "History", icon: "history", agent: "pi_history", role: "Retrieves similar ServiceNow incidents, finds recurring patterns and checks whether similar anomalies led to disruption." },
  predict: { name: "Predictive Intelligence Agent", short: "Prediction", icon: "trend", agent: "pi_predict", role: "Explains the risk score calculated by the rule-based engine and recommends preventive actions. Never changes the score." },
  impact: { name: "Impact Analysis Agent", short: "Impact", icon: "users", agent: "pi_impact", role: "Maps the service to dependent applications and employee groups (synthetic directory) to find who could be affected." },
  notify: { name: "Notification Agent", short: "Notification", icon: "bell", agent: "pi_notify", role: "Drafts the proactive employee alert and the IT alert. Threshold rules decide whether each alert is sent." },
  rca: { name: "RCA Agent (existing 8-stage workflow)", short: "RCA hand-off", icon: "siren", role: "Takes over only when IT raises or associates an actual incident; runs the existing workflow with its approval gates." },
};
const PI_ACTIVE = new Set(["Early warning", "Alert generated", "Investigation required", "Acknowledged", "Investigating", "Monitoring"]);
const PI_UC_OF_FAMILY = { "Identity & SSO": "IAM", "Payment API": "CLM", "Employee Center": "IAM", "Member Portal": "MBR", "Claims Processing": "CLM", "Pharmacy Benefits": "INT", "Provider Directory": "PRV", "Data Warehouse": "INT", VPN: "IAM", Workday: "INT" };

/* ---------------------------------------------------------------- state */
const PI_KEY = "p32-pi-v1";
function piRng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
function piDefaultConfig() { const c = PI_DATA.config; return { weights: { ...c.weights }, employee_alert_threshold: c.employee_alert_threshold, it_alert_threshold: c.it_alert_threshold, thresholds: {} }; }
function piSeedLedger(now) {
  // Synthetic baseline history for the trend charts (flagged synthetic and drawn differently).
  const rnd = piRng("ledger"); const out = [];
  for (let d = 13; d >= 1; d--) {
    const day = new Date(now - d * 86400000).toISOString();
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) out.push({ at: day, type: "prediction", synthetic: true });
    if (rnd() < 0.45) out.push({ at: day, type: "incident", synthetic: true });
    for (let i = 0; i < Math.floor(rnd() * 3); i++) out.push({ at: day, type: "employee_alert", synthetic: true });
    for (let i = 0; i < 1 + Math.floor(rnd() * 2); i++) out.push({ at: day, type: "it_alert", synthetic: true });
  }
  return out;
}
function piFresh() {
  const now = Date.now(); const sim = {};
  PI_DATA.scenarios.forEach((s) => { sim[s.id] = { state: s.start, onset: s.start === "abnormal" ? new Date(now - s.spike.minutes * 60000).toISOString() : null }; });
  return { v: 1, epoch: now, sim, preds: [], ledger: piSeedLedger(now), config: piDefaultConfig(), hist: {}, trends: null, seeded: false, demo: {}, audit: [], live: {} };
}
let PI;
try { PI = JSON.parse(localStorage.getItem(PI_KEY)) || piFresh(); } catch (e) { PI = piFresh(); }
if (!PI || PI.v !== 1 || !PI.sim) PI = piFresh();
if (!PI.live) PI.live = {};
const PIL = { loops: new Set(), cycle: false, trendsAt: 0, histAt: {} };
function piSave() { try { localStorage.setItem(PI_KEY, JSON.stringify(PI)); } catch (e) {} }
function piCommit() { piSave(); render(); }
PI.preds.forEach((p) => { if (p.status === "Analysing") { p.status = "Interrupted"; piEvent(p, "Orchestrator", "The page was reloaded while the agents were running; run the agents again."); } });
function piAudit(text) { PI.audit.unshift({ at: wbNow(), text }); PI.audit = PI.audit.slice(0, 200); }
function piEvent(pred, actor, text, result = "ok") { pred.events.push({ at: wbNow(), actor, text, result }); }
const piPred = (id) => PI.preds.find((p) => p.id === id) || null;
const piLatest = (sid) => PI.preds.find((p) => p.sid === sid && p.status !== "Superseded") || null;

/* --------------------------------------------------------- monitoring sim */
function piThr(sid, m) { const o = (PI.config.thresholds[sid] || {})[m.key] || {}; return { warn: o.warn != null ? +o.warn : m.warn, crit: o.crit != null ? +o.crit : m.crit }; }
function piAbnMinutes(sid) { if (sid === "sso" && piLiveSso()) return piSignalMinutes(piReadings("sso"));
  return piSimAbnMinutes(sid); }
function piSimAbnMinutes(sid) { const s = PI.sim[sid]; return s && s.state === "abnormal" && s.onset ? Math.max(0, (Date.now() - Date.parse(s.onset)) / 60000) : 0; }
function piRound(v, unit) { const a = Math.abs(v); return unit === "%" ? Math.round(v * 100) / 100 : a >= 100 ? Math.round(v) : Math.round(v * 10) / 10; }
function piSeries(sid, m) {
  const st = PI.sim[sid]; const N = 48;
  const rnd = piRng(`${sid}:${m.key}:${st.onset || "base"}`);
  const amp = Math.abs(m.warn - m.baseline) * 0.12;
  const k = st.state === "abnormal" ? Math.min(N, Math.max(1, Math.ceil(piAbnMinutes(sid) / 5))) : 0;
  const out = [];
  for (let i = 0; i < N; i++) {
    let v = m.baseline + (rnd() - 0.5) * 2 * amp;
    if (i >= N - k) { const f = (i - (N - k) + 1) / k; v = m.baseline + (m.abnormal - m.baseline) * Math.pow(f, 0.8) + (rnd() - 0.5) * amp; }
    if (m.unit === "%") v = Math.min(100, v);
    out.push(piRound(Math.max(0, v), m.unit));
  }
  return out;
}
function piStatus(m, v) {
  if (v == null || isNaN(v)) return "unknown";
  if (m.better === "higher") return v <= m.crit ? "critical" : v <= m.warn ? "warning" : "normal";
  return v >= m.crit ? "critical" : v >= m.warn ? "warning" : "normal";
}
/* ---- live SSO signal: real ServiceNow sign-in events (Live Agent Mode) ---- */
const PI_LIVE_SSO = PI_SCEN.sso.live_signal;
function piLiveSso() { return wbMode() === "live" && !!PI_LIVE_SSO; }
function piSignalReadings(res) {
  return PI_LIVE_SSO.metrics.map((m) => {
    const t = piThr("sso", m); const v = res && res.metrics ? res.metrics[m.from] : null;
    const x = { ...m, ...t, baseline: v ? v.baseline : null, current: v ? v.current : null, series: v ? v.series : null, source: "live" };
    // A failure rate on a handful of attempts is noise: it only counts from 5 attempts in the window.
    if (m.key === "sn_failure_rate" && res && res.last_hour && res.last_hour.attempts < 5) return { ...x, status: v ? "normal" : "unknown", name: `${m.name}, needs 5+ attempts` };
    return { ...x, status: v && v.current != null ? piStatus(x, x.current) : "unknown" };
  });
}
function piSignalMinutes(readings) {
  const m = readings[0]; if (!m || !m.series) return 0; let k = 0;
  for (let i = m.series.length - 1; i >= 0; i--) { if (piStatus(m, m.series[i]) === "normal") break; k++; }
  return k * 5;
}
async function piLoadSignal(force) {
  if (!piLiveSso() || PIL.signalBusy || (!force && Date.now() - (PIL.signalAt || 0) < 30000)) return;
  PIL.signalBusy = true; PIL.signalAt = Date.now();
  const r = await wbApi("tool", { run_id: "PI-SIGNAL-001", tool: "pi_signin", args: {} });
  PIL.signalBusy = false;
  PI.live.sso = r.ok ? { ...r.result, at: wbNow() } : { error: r.error, at: wbNow() };
  piCommit();
}
async function piDrill() {
  if (!piLiveSso() || UI.pi.drill === "busy") return;
  UI.pi.drill = "busy"; render();
  const r = await wbApi("tool", { run_id: "PI-SIGNAL-001", tool: "pi_signin_drill", args: { count: PI_LIVE_SSO.drill_count } });
  UI.pi.drill = r.ok ? `Sent ${r.result.sent} real failed sign-ins with the made-up account ${r.result.user_name}.` : `Not sent: ${r.error}`;
  if (!r.ok) { render(); return; }
  piAudit(`Sign-in drill: ${r.result.sent} real failed sign-ins sent to the POC ServiceNow instance with a made-up account.`);
  // ServiceNow writes its transaction log about a minute later: re-read until the new failures appear (up to ~2 minutes).
  const before = PI.live.sso && PI.live.sso.last_hour ? PI.live.sso.last_hour.failures : 0;
  UI.pi.drill += " Waiting for ServiceNow to log them (about a minute)…"; render();
  for (let i = 0; i < 8; i++) {
    await wbSleep(15000); await piLoadSignal(true);
    const now = PI.live.sso && PI.live.sso.last_hour ? PI.live.sso.last_hour.failures : 0;
    if (now >= before + r.result.sent) break;
  }
  UI.pi.drill = `Sent ${r.result.sent} real failed sign-ins; ServiceNow now shows ${PI.live.sso && PI.live.sso.last_hour ? PI.live.sso.last_hour.failures : "?"} failed in the last 60 minutes.`; render();
}
function piReadings(sid) {
  if (sid === "sso" && piLiveSso()) { const r = PI.live.sso; if (!r || r.error || Date.now() - Date.parse(r.at) > 30000) piLoadSignal(); return piSignalReadings(r && !r.error ? r : null); }
  return piSimReadings(sid);
}
function piSimReadings(sid) {
  const s = PI_SCEN[sid];
  return s.metrics.map((m) => {
    const t = piThr(sid, m);
    if (PI.sim[sid].state === "recurring") return { ...m, ...t, current: m.abnormal, series: null, source: "simulated" };
    const series = piSeries(sid, { ...m, ...t });
    return { ...m, ...t, current: series[series.length - 1], series, source: "simulated" };
  }).map((m) => ({ ...m, status: piStatus(m, m.current) }));
}
function piRecurringReadings(h) {
  const p = h.pattern; const base = PI_SCEN.recurring.metrics;
  const vals = { recurrences_90d: h.n90, days_to_expiry: p.next_expected_in_days, mttr: h.mttr_hours };
  return base.filter((m) => vals[m.key] != null).map((m) => { const t = piThr("recurring", m); const x = { ...m, ...t, current: vals[m.key], series: null, source: "live" }; if (m.key === "days_to_expiry") x.name = "Days until the next expected recurrence"; return { ...x, status: piStatus(x, x.current) }; });
}
function piFmt(v, unit) {
  if (v == null || v === "") return "—";
  const n = Number(v); const s = isNaN(n) ? String(v) : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return unit ? (unit.startsWith("/") ? `${s}${unit}` : `${s} ${unit}`) : s;
}
function piSimSet(sid, state) {
  const s = PI_SCEN[sid];
  if (state === "abnormal") PI.sim[sid] = { state: "abnormal", onset: new Date(Date.now() - Math.max(5, s.spike.minutes) * 60000).toISOString() };
  else PI.sim[sid] = { state: s.start === "recurring" ? "recurring" : "normal", onset: null };
  piAudit(`${s.short}: monitoring simulation set to ${state === "abnormal" ? "abnormal" : "normal"}.`);
  if (sid === "sso") PI.demo.spiked = state === "abnormal";
  piCommit();
}

/* ---------------------------------------------------------- risk engine */
// rules-v1: explainable weighted scoring. Replaceable: anything that returns
// { score, cls, contributions[] } from the same features can take its place.
function piClassOf(score) { for (const [max, label] of PI_DATA.config.classes) if (score <= max) return label; return "Critical"; }
function piScore(f, cfg) {
  const clip = (x) => Math.max(0, Math.min(1, x));
  const devs = f.metrics.map((m) => ({ m, d: clip(m.better === "higher" ? (m.baseline - m.current) / (m.baseline - m.crit || 1) : (m.current - m.baseline) / (m.crit - m.baseline || 1)) }));
  const dmax = devs.length ? devs.reduce((a, b) => (b.d > a.d ? b : a)) : null;
  const dev = devs.length ? 0.7 * dmax.d + 0.3 * (devs.reduce((a, b) => a + b.d, 0) / devs.length) : 0;
  const sub = {
    deviation: dev * 100,
    history: clip(f.n90 / 10) * 100,
    similar: f.similar ? clip(f.disruptive / f.similar) * clip(f.similar / 5) * 100 : 0,
    criticality: clip(f.criticality / 5) * 100,
    recurrence: clip((f.max_cluster - 1) / 5) * 100,
    duration: clip(f.minutes / 60) * 100,
  };
  const val = {
    deviation: dmax ? `${dmax.m.name} ${piFmt(dmax.m.current, dmax.m.unit)} vs normal ${piFmt(dmax.m.baseline, dmax.m.unit)} (critical at ${piFmt(dmax.m.crit, dmax.m.unit)})` : "No metrics",
    history: `${f.n90} incident(s) on this service in 90 days`,
    similar: `${f.disruptive} of ${f.similar} similar incident(s) caused a disruption`,
    criticality: `${f.criticality} of 5`,
    recurrence: f.max_cluster > 1 ? `Same problem repeated ${f.max_cluster} times` : "No repeat pattern",
    duration: f.minutes ? `Abnormal for ${Math.round(f.minutes)} min` : "Not yet abnormal",
  };
  const w = cfg.weights; const wsum = Object.values(w).reduce((a, b) => a + (+b || 0), 0) || 1;
  const contributions = Object.keys(sub).map((k) => ({ factor: k, label: PI_DATA.factors[k].label, value: val[k], sub: Math.round(sub[k]), weight: +w[k] || 0, points: Math.round((sub[k] * (+w[k] || 0) / wsum) * 10) / 10 }));
  const score = Math.max(0, Math.min(100, Math.round(contributions.reduce((a, c) => a + c.points, 0))));
  return { score, cls: piClassOf(score), contributions, engine: PI_DATA.config.engine_label, weights_total: wsum };
}

/* ------------------------------------------------------- run plumbing */
function piNodeStart(pred, key) {
  const n = { status: "running", started: wbNow(), ended: null, ms: null, tools: [], input: null, output: null, error: null, source: null, model: null, usage: null, decision: "", note: "" };
  pred.nodes[key] = n; pred.current = key; piEvent(pred, PI_NODES[key].name, "Started", "info"); piCommit();
  return n;
}
function piDone(pred, key, decision) { const n = pred.nodes[key]; n.status = "done"; n.ended = wbNow(); n.decision = decision; piEvent(pred, PI_NODES[key].name, decision); }
function piFail(pred, key, msg) {
  const n = pred.nodes[key]; n.status = "failed"; n.ended = wbNow(); n.error = n.error || msg || "Step failed.";
  pred.status = "Failed"; pred.failedAt = key; piEvent(pred, PI_NODES[key].name, `Failed: ${n.error}`, "bad");
  return false;
}
async function piTool(pred, key, spec) {
  const node = pred.nodes[key];
  const t = { name: spec.name, input: spec.input, source: spec.source, status: "running", at: wbNow(), ms: null, result: null, error: null, summary: "" };
  node.tools.push(t); piCommit();
  const t0 = performance.now();
  try {
    if (spec.live) {
      const r = await wbApi("tool", { run_id: pred.id, tool: spec.live.tool, args: spec.live.args });
      t.ms = r.duration_ms != null ? r.duration_ms : Math.round(performance.now() - t0);
      if (r.ok) { t.status = "ok"; t.result = r.result; } else { t.status = "failed"; t.error = r.error || "Tool call failed."; t.kind = r.kind; }
    } else {
      if (spec.pace) await wbSleep(spec.pace);
      t.result = spec.run(); t.status = "ok"; t.ms = Math.round(performance.now() - t0);
    }
  } catch (e) { t.status = "failed"; t.error = String(e.message || e); }
  if (t.status === "ok" && spec.summarize) { try { t.summary = spec.summarize(t.result); } catch (e) { t.summary = "ok"; } }
  if (t.status !== "ok") t.summary = t.error;
  piEvent(pred, PI_NODES[key].name, `${t.name} [${t.source}]: ${t.summary}`, t.status === "ok" ? "ok" : "bad");
  return t;
}
async function piAgent(pred, key, context, scripted, fast) {
  const node = pred.nodes[key]; node.input = context;
  if (pred.mode === "live") {
    const r = await wbApi("agent", { run_id: pred.id, agent: PI_NODES[key].agent, context, incident: pred.id });
    node.model = r.model || null; node.ms = r.duration_ms != null ? r.duration_ms : null; node.source = "llm";
    if (!r.ok) { node.error = r.error || "Agent call failed."; node.kind = r.kind; return null; }
    node.usage = r.usage; node.output = r.output;
    piEvent(pred, PI_NODES[key].name, `LLM output validated (${r.model}, ${(r.duration_ms / 1000).toFixed(1)} s${r.attempts > 1 ? `, ${r.attempts} attempts` : ""})`);
    return r.output;
  }
  if (!fast) await wbSleep(650);
  node.source = "scripted"; node.output = scripted();
  return node.output;
}
const piTarget = (pred) => (pred.target ? pred.target : { service: PI_SCEN[pred.sid].service, short: PI_SCEN[pred.sid].short, family: PI_SCEN[pred.sid].family, ci: PI_SCEN[pred.sid].ci });

/* ------------------------------------------------------------ agents */
async function piStepMonitor(pred, fast) {
  const s = PI_SCEN[pred.sid]; piNodeStart(pred, "monitor");
  let readings; let src = "simulated";
  if (pred.sid === "recurring" && pred.mode === "live") {
    const t = await piTool(pred, "monitor", { name: "ServiceNow incident pattern scan", source: "live", input: "All incidents, clustered by problem and component (families watched by use cases 1-4 excluded)", live: { tool: "pi_history", args: { scenario: "recurring" } }, summarize: (r) => (r.pattern ? `Strongest repeat: ${r.pattern.family || "service"} "${r.pattern.problem}"${r.pattern.ci ? ` on ${r.pattern.ci}` : ""} (${r.pattern.count} times) in ${r.scanned} incidents` : `No problem repeated 3 or more times in ${r.scanned} incidents`) });
    if (t.status !== "ok") return piFail(pred, "monitor", t.error);
    pred.hist = t.result;
    if (!t.result.pattern) { pred.status = "No anomaly"; piDone(pred, "monitor", "No recurring pattern found in ServiceNow: no prediction raised."); return false; }
    const p = t.result.pattern;
    pred.target = { service: `${p.family || "Service"}${p.ci ? ` (${p.ci})` : ""}`, short: p.family || "Recurring problem", family: p.family, ci: p.ci, problem: p.problem };
    readings = piRecurringReadings(t.result); src = "live";
  } else if (pred.sid === "sso" && pred.mode === "live") {
    const t = await piTool(pred, "monitor", { name: "ServiceNow sign-in events (transaction log + login events)", source: "live", input: "Interactive sign-ins on the POC instance, rolling 60 minutes (counts and timings only)", live: { tool: "pi_signin", args: {} }, summarize: (r) => `Last 60 min: ${r.last_hour.attempts} attempt(s), ${r.last_hour.successes} successful, ${r.last_hour.failures} failed; 7-day normal ${r.metrics.login_failures.baseline} failed/hour` });
    if (t.status !== "ok") return piFail(pred, "monitor", t.error);
    PI.live.sso = { ...t.result, at: wbNow() };
    pred.signal = { ...t.result.last_hour, seven_days: t.result.seven_days, read_at: t.result.read_at, label: PI_LIVE_SSO.label };
    readings = piSignalReadings(t.result); src = "live";
  } else {
    const dt = WBL.status && WBL.status.dynatrace && WBL.status.dynatrace.configured && pred.mode === "live" && pred.sid !== "recurring";
    readings = piReadings(pred.sid);
    if (dt) {
      const t = await piTool(pred, "monitor", { name: "Dynatrace Metrics API v2", source: "live", input: `${s.ci}, last 4 hours`, live: { tool: "pi_dynatrace", args: { scenario: pred.sid } }, summarize: (r) => `${Object.keys(r.metrics).length} metric(s) read` });
      if (t.status === "ok") { readings = readings.map((m) => { const d = t.result.metrics[m.key]; if (!d || d.current == null) return m; const x = { ...m, current: d.current, series: d.values, source: "dynatrace" }; return { ...x, status: piStatus(x, x.current) }; }); src = "dynatrace"; }
    }
    await piTool(pred, "monitor", { name: pred.sid === "recurring" ? "Incident pattern metrics (synthetic)" : "Monitoring feed (simulated)", source: "simulated", input: pred.sid === "recurring" ? `${s.ci}: recurrence, interval and MTTR` : `${s.ci}: last 4 hours, 5-minute readings`, run: () => readings.map((m) => ({ metric: m.name, current: m.current, unit: m.unit })), summarize: (r) => `${r.length} metric(s) read${src === "dynatrace" ? " (Dynatrace values used where returned)" : ""}`, pace: fast ? 0 : 200 });
  }
  pred.readings = readings.map((m) => ({ key: m.key, name: m.name, unit: m.unit, baseline: m.baseline, warn: m.warn, crit: m.crit, better: m.better, current: m.current, status: m.status, series: m.series, source: m.source }));
  const checks = pred.readings.map((m) => ({ metric: m.name, unit: m.unit, baseline: m.baseline, current: m.current, warning_threshold: m.warn, critical_threshold: m.crit, better: m.better, status: m.status }));
  const abn = checks.filter((c) => c.status === "warning" || c.status === "critical");
  await piTool(pred, "monitor", { name: "Baseline and threshold rules", source: "rules", input: `${checks.length} metric(s) against configured thresholds`, run: () => checks, summarize: () => (abn.length ? `${abn.length} of ${checks.length} outside normal (${abn.filter((c) => c.status === "critical").length} critical)` : "All within normal thresholds") });
  pred.minutes = pred.sid === "recurring" ? 0 : pred.signal ? piSignalMinutes(pred.readings) : Math.round(piSimAbnMinutes(pred.sid));
  // Multi-signal correlation (simulated signals only; never mixed into a live signal or a live ServiceNow pattern).
  if (!pred.signal && !(pred.sid === "recurring" && pred.mode === "live") && MS_DATA.scenarios[pred.sid]) {
    const c = msCorrelate(pred.sid); pred.ms = msSnapshot(c);
    await piTool(pred, "monitor", { name: "Multi-signal correlation engine (local rules)", source: "rules", input: `${c.sigs.length} simulated signals in ${c.allCats.length} categories and ${c.changes.length} change event(s)`, run: () => ({ abnormal_signals: c.abn.map((x) => x.name), categories: c.cats, possible_issue: c.hyp ? c.hyp.text : null, suspected_change: c.recent ? c.recent.id : null }), summarize: () => (c.abn.length ? `${c.abn.length} abnormal signal(s) in ${c.cats.length} categor${c.cats.length === 1 ? "y" : "ies"} consolidated into one view${c.recent ? `; suspected contributing change ${c.recent.id}` : ""}` : "No abnormal signals") });
  }
  if (!abn.length) {
    const n = pred.nodes.monitor; n.source = "rules"; n.output = { summary: `All ${checks.length} metrics for ${s.short} are within their normal thresholds.`, abnormal_signals: [], trend: "stable", anomaly_detected: false };
    pred.status = "No anomaly"; piDone(pred, "monitor", "All metrics within normal thresholds: no prediction raised; the agent was not needed. Monitoring continues."); return false;
  }
  const tgt = piTarget(pred);
  const out = await piAgent(pred, "monitor", { service: tgt.service, configuration_item: tgt.ci, signal_facts: pred.signal || undefined, data_source: pred.signal ? PI_LIVE_SSO.how : src === "live" ? "ServiceNow incident pattern (live)" : src === "dynatrace" ? "Dynatrace" : "simulated monitoring feed (POC)", abnormal_for_minutes: pred.minutes, metric_checks: checks }, () => ({
    summary: `${abn.length} of ${checks.length} metrics for ${tgt.short} are outside normal: ${abn.map((c) => `${c.metric} ${piFmt(c.current, c.unit)} (normal ${piFmt(c.baseline, c.unit)})`).join("; ")}.${pred.minutes ? ` Abnormal for about ${pred.minutes} minutes and still rising.` : ""}`,
    abnormal_signals: abn.map((c) => ({ metric: c.metric, observation: `${piFmt(c.current, c.unit)} against a normal ${piFmt(c.baseline, c.unit)}; past the ${c.status} threshold (${piFmt(c.status === "critical" ? c.critical_threshold : c.warning_threshold, c.unit)}).` })),
    trend: pred.sid === "recurring" ? "recurring" : "rising", anomaly_detected: true,
  }), fast);
  if (!out) return piFail(pred, "monitor");
  if (out.anomaly_detected === false) pred.nodes.monitor.note = "The agent's narrative said no anomaly, but the threshold rules found abnormal metrics; the rule result is kept.";
  piDone(pred, "monitor", `Abnormal behaviour: ${abn.map((c) => c.metric).join(", ")}. Handed to the Historical Incident Analysis Agent.`);
  return true;
}
function piDemoHistory(sid) {
  const d = PI_SCEN[sid].demo_history;
  const records = d.records.map((r) => ({ number: r.id, title: r.title, priority: r.priority, state: r.state, days_ago: r.days_ago, ci: r.ci, resolution: r.resolution, url: null, synthetic: true }));
  const c = {}; records.forEach((r) => { c[r.title] = (c[r.title] || 0) + 1; });
  const clusters = Object.entries(c).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ problem: t, ci: "", count: n }));
  if (sid === "recurring") clusters.unshift({ problem: records[0].title, ci: records[0].ci, count: d.max_cluster });
  const weekly = Array(12).fill(0); records.forEach((r) => { if (r.days_ago < 84) weekly[11 - Math.floor(r.days_ago / 7)]++; });
  return { family_total: records.length, n90: d.n90, n30: records.filter((r) => r.days_ago <= 30).length, similar: d.similar, disruptive: d.disruptive, max_cluster: d.max_cluster, clusters: clusters.slice(0, 3), mttr_hours: d.mttr_hours, records, weekly, synthetic: true, rca_findings: d.rca_findings || "" };
}
async function piStepHistory(pred, fast) {
  const s = PI_SCEN[pred.sid]; piNodeStart(pred, "history");
  let h;
  if (pred.mode === "live") {
    if (pred.hist) {
      await piTool(pred, "history", { name: "ServiceNow incident pattern (from the Monitoring Agent's scan)", source: "local", input: "Reuse", run: () => ({ records: pred.hist.records.length }), summarize: (r) => `${r.records} record(s) in the pattern` });
      h = pred.hist;
    } else {
      const t = await piTool(pred, "history", { name: "ServiceNow historical incident analysis", source: "live", input: s.sn_query.replace(/\^OR/g, " OR ").replace(/short_description/g, "").replace(/STARTSWITH/g, "starts with ").replace(/LIKE/g, "contains "), live: { tool: "pi_history", args: { scenario: pred.sid } }, summarize: (r) => `${r.family_total} incident(s) on the service family; ${r.similar} similar, ${r.disruptive} with priority 1-2; largest repeat ${r.max_cluster}` });
      if (t.status !== "ok") return piFail(pred, "history", t.error);
      h = t.result; pred.hist = h;
    }
  } else {
    h = piDemoHistory(pred.sid); pred.hist = h;
    await piTool(pred, "history", { name: "Historical incident search (synthetic history)", source: "simulated", input: s.family, run: () => ({ records: h.records.length }), summarize: () => `${h.similar} similar incident(s), ${h.disruptive} caused disruption (synthetic, Controlled Demo Mode)`, pace: fast ? 0 : 250 });
  }
  const tgt = piTarget(pred);
  const ctx = { service: tgt.service, anomaly: (pred.nodes.monitor.output || {}).summary, statistics: { incidents_on_service_family: h.family_total, last_90_days: h.n90, last_30_days: h.n30, similar: h.similar, similar_with_priority_1_or_2: h.disruptive, largest_repeat_cluster: h.max_cluster, mean_time_to_resolve_hours: h.mttr_hours }, recurring_clusters: h.clusters, historical_incidents: h.records.slice(0, 10).map((r) => ({ number: r.number, title: r.title, priority: r.priority, state: r.state, days_ago: r.days_ago, resolution: r.resolution || "" })), previous_rca_findings: h.rca_findings || "" };
  const out = await piAgent(pred, "history", ctx, () => {
    const res = [...new Set(h.records.map((r) => r.resolution).filter(Boolean))].slice(0, 2);
    return {
      summary: `${h.similar} similar incident(s) on ${tgt.short}${h.synthetic ? " (synthetic history)" : ""}; ${h.disruptive} of them caused a service disruption (priority 1 or 2).${h.max_cluster > 1 ? ` The same problem has repeated up to ${h.max_cluster} times.` : ""}`,
      most_similar: h.records.slice(0, 3).map((r) => ({ number: r.number, why: `${r.title} (${r.priority}, ${Math.round(r.days_ago)} days ago)` })),
      patterns: h.clusters.slice(0, 2).map((c) => `${c.problem}${c.ci ? ` on ${c.ci}` : ""}: ${c.count} times`),
      prior_resolutions: res, disruption_history: `${h.disruptive} of ${h.similar} similar incidents caused a disruption.`,
      recurrence_assessment: h.max_cluster >= 3 ? "Recurring problem: the same failure has come back several times." : "No strong recurrence on this service.",
    };
  }, fast);
  if (!out) return piFail(pred, "history");
  const known = new Set(h.records.map((r) => r.number));
  const cited = wbArr(out.most_similar);
  const kept = cited.filter((x) => known.has(String((x && x.number) || x).trim()));
  if (kept.length < cited.length) pred.nodes.history.note = `${cited.length - kept.length} cited incident number(s) were not in the search results and were removed.`;
  out.most_similar = kept;
  piDone(pred, "history", `${h.similar} similar incident(s), ${h.disruptive} with disruption, largest repeat ${h.max_cluster}${h.synthetic ? " (synthetic history)" : " (ServiceNow)"}. Handed to the Predictive Intelligence Agent.`);
  return true;
}
async function piStepPredict(pred, fast) {
  const s = PI_SCEN[pred.sid]; const h = pred.hist; piNodeStart(pred, "predict");
  const features = { metrics: pred.readings, n90: h.n90, similar: h.similar, disruptive: h.disruptive, criticality: s.criticality, max_cluster: h.max_cluster, minutes: pred.minutes, ms: pred.ms || null, business_level: (MS_DATA.scenarios[pred.sid] || {}).business_level, live: !!pred.signal };
  pred.features = features;
  const t = await piTool(pred, "predict", { name: `Risk engine (${PI_DATA.config.engine}, explainable)`, source: "rules", input: Object.values(PI_DATA.factors).map((f) => f.label).join(", "), run: () => piScore(features, PI.config), summarize: (r) => `Risk ${r.score}/100 (${r.cls})` });
  const risk = t.result; pred.risk = risk; pred.score = risk.score; pred.cls = risk.cls;
  const top = [...risk.contributions].sort((a, b) => b.points - a.points).slice(0, 3);
  const tgt = piTarget(pred);
  const live5 = pred.sid === "recurring" && pred.mode === "live";
  const actions = pred.signal ? PI_LIVE_SSO.actions : live5 ? [`Review how the ${h.records.length} previous "${tgt.problem}" incidents were resolved and why the fix didn't hold.`, "Open a problem record linking the repeat incidents.", `Schedule preventive work on ${tgt.ci || tgt.short} before the next expected occurrence.`] : s.actions;
  const horizon = live5 ? (h.pattern.next_expected_in_days > 0 ? `Next occurrence expected in about ${h.pattern.next_expected_in_days} days` : "Overdue: the pattern suggests it could happen at any time") : pred.sid === "recurring" ? "Next occurrence expected in about 4 days" : { Critical: "Within the next hour", High: "Within the next few hours", Moderate: "Within the next day", Low: "No disruption expected soon" }[risk.cls];
  const msa = pred.ms ? msAbn(pred.ms) : [];
  const out = await piAgent(pred, "predict", { service: tgt.service, criticality: s.criticality, monitoring: (pred.nodes.monitor.output || {}).summary, history: (pred.nodes.history.output || {}).summary, correlated_signals: pred.ms ? { abnormal: msa.map((x) => `${x.name} ${piFmt(x.current, x.unit)} (normal ${piFmt(x.baseline, x.unit)})`), categories: pred.ms.cats, possible_underlying_issue: pred.ms.hyp ? pred.ms.hyp.text : null, suspected_contributing_change: pred.ms.recent ? `${pred.ms.recent.id}: ${pred.ms.recent.title} (not confirmed)` : null, note: "Simulated demo signals" } : undefined, risk_engine: { score: risk.score, classification: risk.cls, engine: risk.engine, factors: risk.contributions.map((c) => ({ factor: c.label, value: c.value, sub_score: c.sub, weight: c.weight, points: c.points })) }, candidate_actions: actions }, () => ({
    prediction: `${s.prediction}: ${tgt.service}.`,
    explanation: `Risk ${risk.score}/100 (${risk.cls}). The biggest contributors are ${top.map((c) => `${c.label.toLowerCase()} (${c.value}; ${c.points} points)`).join(", ")}.${pred.ms && msa.length ? ` ${msa.length} signals in ${pred.ms.cats.length} categories point the same way${pred.ms.hyp ? `: ${pred.ms.hyp.text.charAt(0).toLowerCase()}${pred.ms.hyp.text.slice(1)}` : "."}${pred.ms.recent ? ` ${pred.ms.recent.id} (${pred.ms.recent.title}) is a suspected contributing change, not a confirmed cause.` : ""}` : ""}`,
    key_drivers: top.map((c) => ({ factor: c.label, detail: c.value })),
    uncertainty: pred.sid === "recurring" ? "The pattern would break if the cause was fixed without a ServiceNow record." : s.demo_only ? "Every signal in this scenario is predefined demo data; the score is a rule-based calculation, not a validated probability." : "Monitoring readings in this POC are simulated; a spike that recovers on its own would lower the risk.",
    time_horizon: horizon, recommended_actions: actions,
  }), fast);
  if (!out) return piFail(pred, "predict");
  pred.horizon = out.time_horizon || horizon;
  piDone(pred, "predict", `Risk ${risk.score}/100 (${risk.cls}) from the rule-based engine; the agent explained it without changing it. Handed to the Impact Analysis Agent.`);
  return true;
}
function piGroups(pred) {
  const s = PI_SCEN[pred.sid]; const deps = PI_DATA.directory.departments;
  const live5 = pred.sid === "recurring" && pred.mode === "live";
  const apps = live5 ? [PI_DATA.directory.family_apps[pred.target.family] || pred.target.family] : s.apps;
  const rule = live5 ? "apps" : s.impact_rule;
  const reason = live5 ? `These teams use ${apps[0]}, which the recurring problem affects.` : s.impact_reason;
  return deps.filter((d) => rule === "all" || rule === "remote" || d.apps.some((a) => apps.includes(a)))
    .map((d) => ({ department: d.name, count: rule === "remote" ? Math.round(d.headcount * d.remote_pct) : d.headcount, apps: rule === "all" ? apps : d.apps.filter((a) => apps.includes(a) || (rule === "remote" && a === "Remote Access VPN")), reason: rule === "remote" ? `${Math.round(d.remote_pct * 100)}% work remotely or hybrid and use the VPN.` : reason }))
    .filter((g) => g.count > 0);
}
async function piStepImpact(pred, fast) {
  const s = PI_SCEN[pred.sid]; piNodeStart(pred, "impact");
  const t = await piTool(pred, "impact", { name: "Dependency and employee directory mapping (synthetic)", source: "simulated", input: `${piTarget(pred).short} → applications → departments`, run: () => piGroups(pred), summarize: (g) => `${g.reduce((a, x) => a + x.count, 0).toLocaleString()} employees in ${g.length} department(s)`, pace: fast ? 0 : 200 });
  const groups = t.result; pred.groups = groups; pred.affected = groups.reduce((a, g) => a + g.count, 0);
  const deps = pred.sid === "recurring" && pred.mode === "live" ? [] : s.dependents;
  const out = await piAgent(pred, "impact", { service: piTarget(pred).service, dependent_applications: deps, affected_groups: groups.map((g) => ({ department: g.department, employees: g.count, applications: g.apps, rule_reason: g.reason })), directory_note: PI_DATA.directory.note }, () => ({
    summary: `${pred.affected.toLocaleString()} employees in ${groups.length} department(s) depend on ${piTarget(pred).short}.`,
    groups: groups.map((g) => ({ department: g.department, reason: g.reason })), dependent_applications: deps,
    notification_rationale: groups.length === PI_DATA.directory.departments.length ? "Every department depends on this service, so all employees should be warned if the risk is high enough." : `Only ${groups.map((g) => g.department).join(", ")} depend on it, so only they should be warned.`,
  }), fast);
  if (!out) return piFail(pred, "impact");
  const names = new Set(groups.map((g) => g.department));
  const cited = wbArr(out.groups); out.groups = cited.filter((g) => names.has(String((g && g.department) || g).trim()));
  if (out.groups.length < cited.length) pred.nodes.impact.note = "Departments not in the directory mapping were removed from the agent's answer.";
  piDone(pred, "impact", `${pred.affected.toLocaleString()} employees in ${groups.length} department(s) potentially affected (synthetic directory). Handed to the Notification Agent.`);
  return true;
}
const piPriority = (cls) => ({ Critical: "1 - Critical", High: "2 - High", Moderate: "3 - Moderate", Low: "4 - Low" }[cls] || "3 - Moderate");
async function piStepNotify(pred, fast) {
  const s = PI_SCEN[pred.sid]; const cfg = PI.config; piNodeStart(pred, "notify");
  const emp = pred.score >= cfg.employee_alert_threshold && pred.groups.length > 0; const it = pred.score >= cfg.it_alert_threshold;
  await piTool(pred, "notify", { name: "Alert threshold rules", source: "rules", input: `Risk ${pred.score}; employee alert at ${cfg.employee_alert_threshold}+, IT alert at ${cfg.it_alert_threshold}+`, run: () => ({ employee_alert: emp, it_alert: it }), summarize: () => `${emp ? "Employee alert" : "No employee alert"} · ${it ? "IT alert" : "no IT alert"}` });
  if (!it && !emp) { const n = pred.nodes.notify; n.source = "rules"; n.output = { note: "Below both alert thresholds." }; pred.status = "Monitoring"; piDone(pred, "notify", `Risk ${pred.score} is below the alert thresholds: no alert sent; monitoring continues.`); return true; }
  const tgt = piTarget(pred); const ea = s.employee_alert;
  const out = await piAgent(pred, "notify", { service: tgt.service, service_for_employees: tgt.short, risk: { score: pred.score, classification: pred.cls }, prediction: (pred.nodes.predict.output || {}).prediction, explanation: (pred.nodes.predict.output || {}).explanation, monitoring: (pred.nodes.monitor.output || {}).summary, history: (pred.nodes.history.output || {}).summary, recommended_actions: (pred.nodes.predict.output || {}).recommended_actions, affected_departments: pred.groups.map((g) => g.department), employee_alert_will_be_sent: emp, approved_employee_wording: pred.sid === "recurring" && pred.mode === "live" ? null : ea }, () => ({
    employee_title: ea.title, employee_message: ea.message, employee_action: ea.recommended_action, employee_status: ea.status_text,
    it_title: `${s.prediction}: ${tgt.short} (risk ${pred.score}/100)`, it_summary: `${(pred.nodes.monitor.output || {}).summary} ${(pred.nodes.history.output || {}).disruption_history || ""}`.trim(),
    it_steps: wbArr((pred.nodes.predict.output || {}).recommended_actions).slice(0, 4), it_priority: piPriority(pred.cls),
  }), fast);
  if (!out) return piFail(pred, "notify");
  const at = wbNow();
  if (it) { pred.alerts.it = { title: out.it_title, summary: out.it_summary, steps: wbArr(out.it_steps), priority: out.it_priority || piPriority(pred.cls), team: (s.owner_group && !(pred.sid === "recurring" && pred.mode === "live")) ? s.owner_group : PI_DATA.directory.family_groups[tgt.family] || "Service Desk", at }; PI.ledger.push({ at, type: "it_alert", mode: pred.mode }); }
  pred.alerts.draft = { title: out.employee_title, message: out.employee_message, action: out.employee_action, status: out.employee_status || "Early warning" };
  if (emp) { pred.alerts.employee = { ...pred.alerts.draft, score: pred.score, cls: pred.cls, service: tgt.short, departments: pred.groups.map((g) => g.department), at }; PI.ledger.push({ at, type: "employee_alert", mode: pred.mode }); }
  pred.status = pred.score >= 81 ? "Investigation required" : emp ? "Alert generated" : "Early warning";
  piDone(pred, "notify", `${emp ? `Employee alert sent to ${pred.affected.toLocaleString()} employees in ${pred.groups.length} department(s)` : "Employee alert drafted but not sent (below the employee threshold)"}; ${it ? `IT alert sent to ${pred.alerts.it.team}` : "no IT alert (below the IT threshold)"}. Status: ${pred.status}. An actual incident is raised only when IT starts an investigation.`);
  return true;
}
const PI_STEPS = { monitor: piStepMonitor, history: piStepHistory, predict: piStepPredict, impact: piStepImpact, notify: piStepNotify };

async function piDrive(pred, from, fast) {
  if (PIL.loops.has(pred.id)) return;
  PIL.loops.add(pred.id);
  try {
    pred.status = "Analysing"; pred.failedAt = null;
    for (const key of PI_ORDER.slice(PI_ORDER.indexOf(from || "monitor"))) {
      const ok = await PI_STEPS[key](pred, fast);
      pred.updated = wbNow(); piSave(); if (!fast) render();
      if (!ok) break;
    }
  } catch (e) {
    const key = pred.current || "monitor"; if (pred.nodes[key]) pred.nodes[key].error = `Unexpected error: ${e.message || e}`; piFail(pred, key); console.error(e);
  } finally { PIL.loops.delete(pred.id); pred.current = null; piCommit(); }
}
async function piRunScenario(sid, opts = {}) {
  const mode = opts.mode || wbMode();
  const prev = PI.preds.filter((p) => p.sid === sid && p.status !== "Superseded");
  if (prev.some((p) => PIL.loops.has(p.id))) return null;
  const pred = { id: `PRD-${sid.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`, sid, mode, created: opts.created || wbNow(), status: "Analysing", nodes: {}, events: [], score: null, cls: null, risk: null, readings: [], hist: null, groups: [], affected: 0, alerts: { employee: null, it: null, draft: null }, ack: { admin: null, employee: null }, incident: null, mitigation: null, dismissed: null, recheck: null, target: null };
  // A new analysis replaces the previous one for the scenario unless IT is already investigating it.
  prev.forEach((p) => { if (!p.incident && !["Mitigated", "Dismissed"].includes(p.status)) { p.status = "Superseded"; piEvent(p, "Orchestrator", `Superseded by ${pred.id}.`); } });
  PI.preds.unshift(pred); PI.preds = PI.preds.slice(0, 60);
  piEvent(pred, "Orchestrator", `Prediction run started in ${mode === "live" ? "Live Agent Mode" : "Controlled Demo Mode"}.`, "info");
  if (!opts.synthetic) PI.ledger.push({ at: pred.created, type: "prediction", mode });
  await piDrive(pred, "monitor", opts.fast);
  return pred;
}
async function piRunCycle() {
  if (PIL.cycle) return; PIL.cycle = true; render();
  try { for (const s of [...PI_DATA.scenarios].sort((a, b) => a.order - b.order)) await piRunScenario(s.id); }
  finally { PIL.cycle = false; render(); }
}
async function piSeed() {
  if (PI.seeded) return;
  PI.seeded = true;
  for (const sid of ["payment", "portal", "vpn", "recurring"]) await piRunScenario(sid, { mode: "demo", fast: true, created: new Date(Date.now() - (sid === "recurring" ? 95 : 20) * 60000).toISOString() });
  piCommit();
}

/* ------------------------------------------------ admin decisions */
function piAck(id) { const p = piPred(id); if (!p || p.ack.admin) return; p.ack.admin = { at: wbNow(), by: "IT administrator (POC role)" }; if (["Early warning", "Alert generated", "Investigation required", "Monitoring"].includes(p.status)) p.status = "Acknowledged"; piEvent(p, "IT administrator (human)", "Prediction acknowledged."); piAudit(`${p.id} acknowledged by the IT administrator.`); piCommit(); }
function piDismiss(id, reason, kind) { const p = piPred(id); if (!p || reason.trim().length < 10) return; const fp = kind === "false_positive"; const lbl = { not_real: "Not a real risk", false_positive: "False positive", planned: "Planned work or known event", duplicate: "Duplicate" }[kind] || "Not a real risk"; p.dismissed = { at: wbNow(), reason: `${lbl}: ${reason.trim()}`, kind: kind || "not_real" }; p.status = fp ? "False positive" : "Dismissed"; PI.ledger.push({ at: wbNow(), type: fp ? "false_positive" : "dismissed", mode: p.mode }); piEvent(p, "IT administrator (human)", `${fp ? "Closed as a false positive" : "Dismissed"}: "${reason.trim()}"`, "warn"); piAudit(`${p.id} ${fp ? "closed as a false positive" : "dismissed"}.`); piCommit(); }
async function piRecheck(id) {
  const p = piPred(id); if (!p) return;
  if (p.signal) await piLoadSignal(true);
  if (p.sid === "recurring") { p.recheck = { at: wbNow(), normal: false, note: "Recurring patterns can't be re-checked by monitoring; confirm mitigation through the linked investigation." }; piCommit(); return; }
  const r = p.signal ? piSignalReadings(PI.live.sso && !PI.live.sso.error ? PI.live.sso : null) : piSimReadings(p.sid);
  p.recheck = { at: wbNow(), normal: r.every((m) => m.status === "normal"), checks: r.map((m) => ({ metric: m.name, current: m.current, unit: m.unit, status: m.status })) };
  piEvent(p, "Monitoring rules", p.recheck.normal ? "Re-check: all metrics back within normal thresholds." : `Re-check: ${r.filter((m) => m.status !== "normal").length} metric(s) still abnormal.`, p.recheck.normal ? "ok" : "warn");
  piCommit();
}
function piConfirmMitigation(id, note) {
  const p = piPred(id); if (!p || !p.recheck || !p.recheck.normal || note.trim().length < 10) return;
  p.mitigation = { at: wbNow(), by: "IT administrator (POC role)", basis: "Metrics re-checked and back to normal", note: note.trim(), confirmed: true };
  p.status = "Mitigated"; PI.ledger.push({ at: wbNow(), type: "mitigated", mode: p.mode });
  piEvent(p, "IT administrator (human)", `Mitigation confirmed: "${note.trim()}"`); piAudit(`${p.id} confirmed mitigated.`); piCommit();
}
function piSync() {
  let changed = false;
  for (const p of PI.preds) {
    if (!p.incident || p.mitigation) continue;
    const run = WB.runs[p.incident.incId];
    if (!run) continue;
    const sn = run.sn && run.sn.number; if (sn && !p.incident.number) { p.incident.number = sn; p.incident.url = run.sn.url; changed = true; }
    if (run.status === "completed") { p.mitigation = { at: run.ended || wbNow(), by: "Verification Agent (RCA workflow)", basis: "The linked incident was verified as fixed and closed", confirmed: true }; p.status = "Mitigated"; PI.ledger.push({ at: wbNow(), type: "mitigated", mode: p.mode }); piEvent(p, "RCA workflow", "Linked incident verified and closed: risk mitigated."); changed = true; }
  }
  if (changed) piSave();
}

/* ---------------------------------- hand-off to the existing RCA workflow */
function piDynamicRca(pred) {
  const t = pred.target; const h = pred.hist; const grp = PI_DATA.directory.family_groups[t.family] || "Service Desk";
  return {
    id: "PRED-REC-LIVE", use_case: PI_UC_OF_FAMILY[t.family] || "INT", title: `Predicted recurrence: ${t.family || "service"} ${t.problem}${t.ci ? ` on ${t.ci}` : ""}`.slice(0, 150),
    service: t.service, ci: t.ci || (t.family || "service").toLowerCase(), priority: piPriority(pred.cls), impact: "2 - Medium", urgency: "2 - Medium", category: "Software", group: "",
    business_impact: `Users of ${PI_DATA.directory.family_apps[t.family] || t.family} are affected each time "${t.problem}" recurs.`, complexity: "Live recurring pattern",
    evidence: {
      logs: [{ id: "L1", t: 0, source: "ServiceNow incident pattern (live)", text: `${h.pattern.count} incidents with "${t.problem}"${t.ci ? ` on ${t.ci}` : ""}, about every ${h.pattern.avg_interval_days} days; the last one ${h.pattern.last_days_ago} days ago.` }],
      metrics: [{ id: "M1", name: "Recurrences in 30 days", unit: "", before: h.n30, threshold: 0, after: 0, after2: 0, better: "lower" }],
      changes: [], kb: [], deep: [],
      history: [],
      cmdb: { class: "Service component", depends_on: [], owner_group: grp, environment: "Production (POC ServiceNow data)" },
    },
    script: { hypotheses: [], critic: [], selected: 0, needs_round2: false, root_cause: "", contributing: [], remediation: [], rollback: "", prevention: [], exec_fail: null, verify_fail_first: false },
  };
}
function piSignalRca(pred) {
  const s = PI_SCEN.sso; const g = pred.signal; const r = pred.readings;
  const f = r.find((m) => m.key === "sn_login_failures") || {}; const rate = r.find((m) => m.key === "sn_failure_rate") || {}; const lat = r.find((m) => m.key === "sn_auth_latency") || {};
  return {
    id: "PRED-SSO-LIVE", use_case: "IAM", title: `Predicted sign-in disruption: ${g.failures} failed sign-ins in 60 minutes on the POC ServiceNow instance`,
    service: s.service, ci: "servicenow-login", priority: piPriority(pred.cls), impact: "1 - High", urgency: "2 - Medium", category: "Access", group: "",
    business_impact: "If sign-in failures keep rising, employees could be unable to sign in to the Employee Center and ServiceNow.", complexity: "Live sign-in signal",
    evidence: {
      logs: [
        { id: "L1", t: 0, source: "ServiceNow transaction log + login events (live)", text: `Last 60 minutes: ${g.attempts} interactive sign-in attempt(s), ${g.successes} successful, ${g.failures} failed (failure rate ${rate.current}%). 7-day normal: ${f.baseline} failed sign-ins per hour.` },
        { id: "L2", t: 0, source: "ServiceNow transaction log (live)", text: `The sign-in attempts in the last hour came from ${g.distinct_sources} distinct source address(es); ${g.failed_events_existing_accounts} failure(s) were for an existing account, the rest used user names that don't exist in the instance.` },
        { id: "L3", t: 0, source: "ServiceNow transaction log (live)", text: `Average sign-in response time ${lat.current} ms against a 7-day average of ${lat.baseline} ms.` },
      ],
      metrics: [{ id: "M1", name: "Failed sign-ins (last 60 min)", unit: "", before: g.failures, threshold: f.warn, after: 0, after2: 0, better: "lower" }],
      changes: [], kb: [], deep: [], history: [],
      cmdb: { class: "Authentication service", depends_on: ["identity provider", "ServiceNow login"], owner_group: s.owner_group, environment: "POC ServiceNow instance (live sign-in data)" },
    },
    script: { hypotheses: [], critic: [], selected: 0, needs_round2: false, root_cause: "", contributing: [], remediation: [], rollback: "", prevention: [], exec_fail: null, verify_fail_first: false },
  };
}
function piIncidentText(pred, scen) {
  const mon = pred.nodes.monitor.output || {}; const h = pred.hist || {}; const pr = pred.nodes.predict.output || {};
  return {
    title: scen.title,
    description: `Raised proactively by AURA Predictive Intelligence before any employee report (prediction ${pred.id}, risk ${pred.score}/100, ${pred.cls}). ${pr.prediction || ""} Monitoring${pred.signal ? " (live ServiceNow sign-in events)" : pred.sid === "recurring" && pred.mode === "live" ? " (ServiceNow pattern)" : " (simulated in this POC)"}: ${mon.summary || ""} History: ${h.similar} similar incident(s), ${h.disruptive} caused disruption. Recommended first action: ${wbArr(pr.recommended_actions)[0] || ""}`.replace(/\s+/g, " ").trim().slice(0, 2800),
  };
}
async function piInvestigate(predId, assocNumber) {
  const pred = piPred(predId); if (!pred || pred.incident) return { ok: false, error: "Already linked to an incident." };
  if (pred.mode !== wbMode()) return { ok: false, error: pred.mode === "live" ? "This prediction came from live agents: switch to Live Agent Mode to raise a real ServiceNow incident." : "This prediction is a scripted demo: switch to Controlled Demo Mode to raise a synthetic incident (a scripted prediction never creates a real ServiceNow record)." };
  if (assocNumber && pred.mode !== "live") return { ok: false, error: "Associating an existing incident needs Live Agent Mode and ServiceNow." };
  const scen = pred.sid === "recurring" && pred.mode === "live" ? piDynamicRca(pred) : pred.signal ? piSignalRca(pred) : PI_SCEN[pred.sid].rca;
  const text = piIncidentText(pred, scen); const uc = scen.use_case;
  WB.seq += 1;
  const inc = {
    id: `${pred.mode === "live" ? "PI" : "DEMO"}-${uc}-P${String(WB.seq).padStart(2, "0")}`, use_case: uc, submitted: true, predicted: { id: pred.id, score: pred.score, cls: pred.cls },
    title: text.title, description: text.description, service: scen.service, ci: scen.ci, reported_by: "AURA Predictive Intelligence (raised by the IT administrator)", reported_at: wbNow(),
    priority: piPriority(pred.cls), impact: scen.impact, urgency: scen.urgency, category: scen.category, group: "", sn: null, piScen: scen,
  };
  const runId = `RUN-${inc.id}-${Date.now().toString(36)}`;
  if (pred.mode === "live") {
    const ap = await wbApi("approval", { run_id: runId, gate: "pi", decision: "approve", feedback: "", approver: "IT administrator (POC role)" }, "POST", { "X-P32-Role": "approver" });
    if (!ap.ok) { WB.seq -= 1; return { ok: false, error: `Approval not recorded: ${ap.error}` }; }
    const r = assocNumber
      ? await wbApi("tool", { run_id: runId, tool: "pi_associate", args: { number: assocNumber, prediction_id: pred.id, risk_score: pred.score } })
      : await wbApi("tool", { run_id: runId, tool: "pi_create", args: { scenario: pred.sid, prediction_id: pred.id, short_description: inc.title, description: inc.description, impact: inc.impact, risk_score: pred.score, risk_class: pred.cls, signal_source: pred.signal ? "servicenow_signin" : pred.sid === "recurring" ? "servicenow_pattern" : "simulated" } });
    if (!r.ok) { WB.seq -= 1; return { ok: false, error: `ServiceNow ${assocNumber ? "association" : "incident creation"} failed: ${r.error}` }; }
    inc.sn = { number: r.result.number, url: r.result.url };
    if (assocNumber && r.result.title) inc.title = `${r.result.title}`.slice(0, 160);
  }
  const list = wbIncidentsFor(uc).filter((o) => !["running", "waiting", "attention", "paused", "failed"].includes((WB.runs[o.id] || {}).status));
  const victim = (list.length ? list : wbIncidentsFor(uc)).sort((a, b) => Date.parse(wbReportedAt(a)) - Date.parse(wbReportedAt(b)))[0];
  if (victim) { if (victim.submitted) { inc.replaces = victim.replaces; WB.submitted = WB.submitted.filter((x) => x.id !== victim.id); } else inc.replaces = victim.id; delete WB.runs[victim.id]; }
  WB.submitted.unshift(inc);
  const run = wbNewRun(inc); run.id = runId; run.status = "running"; run.started = wbNow();
  wbEvent(run, "AURA Predictive Intelligence", "result", inc.sn ? `${assocNumber ? "Associated" : "Raised"} from prediction ${pred.id}: ServiceNow ${inc.sn.number}.` : `Raised from prediction ${pred.id} (synthetic incident, Controlled Demo Mode).`, "ok");
  if (victim) wbEvent(run, "Workbench", "decision", `Five-record demo limit: this incident replaced ${victim.id} in the ${wbUseCase(uc).short} list (Reset demo restores it).`, "info");
  pred.incident = { incId: inc.id, number: inc.sn ? inc.sn.number : null, url: inc.sn ? inc.sn.url : null, at: wbNow(), associated: !!assocNumber };
  pred.status = "Investigating"; pred.nodes.rca = { status: "running", started: wbNow(), tools: [], decision: `Handed to the existing RCA workflow as ${inc.sn ? inc.sn.number : inc.id}.`, source: "human" };
  PI.ledger.push({ at: wbNow(), type: "incident", mode: pred.mode });
  piEvent(pred, "IT administrator (human)", `Investigation started: ${inc.sn ? `ServiceNow ${inc.sn.number} ${assocNumber ? "associated" : "created"}` : `synthetic incident ${inc.id}`}; the RCA workflow takes over.`);
  piAudit(`${pred.id}: investigation started (${inc.sn ? inc.sn.number : inc.id}).`);
  piSave(); wbCommit(); wbDrive(inc.id);
  return { ok: true, incId: inc.id };
}

/* ---------------------------------------------- live data for the charts */
async function piLoadTrends(force) {
  if (wbMode() !== "live" || (!force && Date.now() - PIL.trendsAt < 300000)) return;
  PIL.trendsAt = Date.now();
  const r = await wbApi("tool", { run_id: "PI-TRENDS-001", tool: "pi_trends", args: {} });
  PI.trends = r.ok ? { ...r.result, at: wbNow() } : { error: r.error, at: wbNow() };
  piCommit();
}
async function piLoadHist(sid, force) {
  if (wbMode() !== "live" || (!force && Date.now() - (PIL.histAt[sid] || 0) < 300000)) return;
  PIL.histAt[sid] = Date.now();
  const r = await wbApi("tool", { run_id: "PI-HISTORY-001", tool: "pi_history", args: { scenario: sid } });
  PI.hist[sid] = r.ok ? { ...r.result, at: wbNow() } : { error: r.error, at: wbNow() };
  piCommit();
}

/* ------------------------------------------- integration with existing code */
const _wbScenarioBasePI = wbScenario;
wbScenario = function (inc) { return (inc && inc.piScen) || _wbScenarioBasePI(inc); };
const _wbResetAllPI = wbResetAll;
wbResetAll = function () { _wbResetAllPI(); PI = piFresh(); piSave(); piSeed(); };
NAV[1].items.push({ label: "Predictive Intelligence", route: "predictive", icon: "trend", badge: "predictive" });
// Seed only after every script has run (the router defines render()).
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", piSeed); else setTimeout(piSeed, 0);
</script>
