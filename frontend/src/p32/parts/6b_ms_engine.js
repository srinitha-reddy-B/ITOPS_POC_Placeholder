<script>
"use strict";
/* =====================================================================
   Multi-signal predictive engine (demo data, local deterministic rules).
   - Every scenario has signals in up to seven categories (infrastructure,
     application, database, network, business, user experience, capacity)
     plus change/deployment events. Each signal follows a predefined path
     Normal -> Drifting -> Warning -> Degrading -> Critical (steps 0-4).
   - "Simulate spike" walks a scenario up that path step by step, so charts
     update progressively; recovery walks it back. Same step, same values.
   - The correlation engine turns the abnormal signals into ONE consolidated
     view per service (no alert per metric), and rules-v2 extends the risk
     score with rate of change, correlated signals, business impact, recent
     changes, capacity forecast and data reliability.
   - Nothing here calls an external system. Values are synthetic and are
     always labelled Simulated / Calculated.
   ===================================================================== */
const MS_DATA = __MS_DATA__;
const MS_CAT = Object.fromEntries(MS_DATA.categories.map((c) => [c.id, c]));
const MS_STEPS = MS_DATA.steps;
const MS_NODE = Object.fromEntries(MS_DATA.graph.nodes.map((n) => [n.id, n]));

// Scenarios added for the multi-signal demo reuse a scripted RCA scenario from the workbench data.
PI_DATA.scenarios.forEach((s) => {
  if (s.rca || !s.rca_from) return;
  const src = WB_DATA.incidents.find((i) => i.id === s.rca_from); if (!src) return;
  s.rca = { ...JSON.parse(JSON.stringify(src)), id: `PRED-${s.id.toUpperCase()}`, title: `${s.prediction.replace(/^Potential /, "Predicted ")}: ${s.service}`, service: s.service, ci: s.ci, reported_by: "AURA Predictive Intelligence (proactive, synthetic)", reported_min_ago: 5 };
});

/* ---------------------------------------------------------------- state */
const MS_KEY = "p32-ms-v1";
function msStartStep(sid) { const d = MS_DATA.scenarios[sid]; return d ? d.start_step : 0; }
function msFresh() { const st = {}; PI_DATA.scenarios.forEach((s) => { st[s.id] = { step: msStartStep(s.id) }; }); return { v: 1, st, wi: { sid: "claims", ov: {} }, sel: "claims", demand: "open_enrollment" }; }
let MS;
try { MS = JSON.parse(localStorage.getItem(MS_KEY)); } catch (e) { MS = null; }
if (!MS || MS.v !== 1 || !MS.st) {
  MS = msFresh();
  // First load after the upgrade: keep what the user had simulated.
  PI_DATA.scenarios.forEach((s) => { const sim = PI.sim[s.id]; if (sim && s.id !== "recurring" && MS_DATA.scenarios[s.id]) MS.st[s.id].step = sim.state === "abnormal" ? (msStartStep(s.id) || 4) : 0; });
}
PI_DATA.scenarios.forEach((s) => { if (!MS.st[s.id]) MS.st[s.id] = { step: msStartStep(s.id) }; });
// Simulation state for the added scenarios, and the rules-v2 configuration.
PI_DATA.scenarios.forEach((s) => { if (!PI.sim[s.id]) PI.sim[s.id] = { state: s.start === "recurring" ? "recurring" : msStartStep(s.id) > 0 ? "abnormal" : "normal", onset: msStartStep(s.id) > 0 ? new Date(Date.now() - s.spike.minutes * 60000).toISOString() : null }; });
if (!PI.config.weights || PI.config.weights.correlated == null) { PI.config = { ...piDefaultConfig(), thresholds: PI.config.thresholds || {}, employee_alert_threshold: PI.config.employee_alert_threshold || PI_DATA.config.employee_alert_threshold, it_alert_threshold: PI.config.it_alert_threshold || PI_DATA.config.it_alert_threshold }; }
piSave();
const MSL = { anim: {} };
function msSave() { try { localStorage.setItem(MS_KEY, JSON.stringify(MS)); } catch (e) {} }
function msCommit() { msSave(); piCommit(); }
const msStep = (sid) => (MS.st[sid] ? MS.st[sid].step : 0);
const msClip = (x) => Math.max(0, Math.min(1, x));

/* ------------------------------------------------------- signal values */
function msDef(sid, sg) {
  if (sg.ref) { const m = PI_SCEN[sid].metrics.find((x) => x.key === sg.key); return { ...m, ...piThr(sid, m), cat: sg.cat, path: sg.path, quality: sg.quality, action: sg.action || "", primary: true }; }
  return { ...sg, ...piThr(sid, sg) };
}
function msGenPath(m) { return [0, 0.3, 0.55, 0.8, 1].map((f) => piRound(m.baseline + (m.abnormal - m.baseline) * f, m.unit)); }
function msSeries(sid, m, step, n) {
  const rnd = piRng(`ms:${sid}:${m.key}`); const amp = Math.abs(m.warn - m.baseline) * 0.08;
  const k = step * Math.max(2, Math.round(n / 12)); const out = [];
  for (let i = 0; i < n; i++) {
    let v;
    if (i >= n - k) { const pos = ((i - (n - k) + 1) / k) * step; const lo = Math.floor(pos); const hi = Math.min(step, lo + 1); v = m.path[lo] + (m.path[hi] - m.path[lo]) * (pos - lo) + (i === n - 1 ? 0 : (rnd() - 0.5) * amp); }
    else v = m.path[0] + (rnd() - 0.5) * 2 * amp;
    if (m.unit === "%") v = Math.min(100, v);
    out.push(piRound(Math.max(0, v), m.unit));
  }
  out[n - 1] = m.path[step];
  return out;
}
function msDev(m, v) { return msClip(m.better === "higher" ? (m.baseline - v) / (m.baseline - m.crit || 1) : (v - m.baseline) / (m.crit - m.baseline || 1)); }
function msTrend(m, series) {
  const a = series[Math.max(0, series.length - 7)], b = series[series.length - 1]; const span = Math.abs(m.crit - m.baseline) || 1;
  const d = (b - a) / span; if (Math.abs(d) < 0.04) return "stable";
  return (m.better === "higher" ? d < 0 : d > 0) ? "worsening" : "improving";
}
function msSignals(sid, ov, stepOverride) {
  const d = MS_DATA.scenarios[sid]; if (!d) return [];
  const step = stepOverride != null ? stepOverride : msStep(sid);
  return d.signals.map((sg) => {
    const def = msDef(sid, sg); const series = msSeries(sid, def, step, 24);
    if (ov && ov[def.key] != null && ov[def.key] !== "") series[series.length - 1] = +ov[def.key];
    const cur = series[series.length - 1]; const status = piStatus(def, cur);
    return { ...def, current: cur, series, status, dev: msDev(def, cur), trend: msTrend(def, series), source: "simulated", overridden: !!(ov && ov[def.key] != null && ov[def.key] !== "") };
  });
}

/* ------------------------------------------------------ dependency graph */
function msDown(id, seen = new Set()) { MS_DATA.graph.edges.filter((e) => e[0] === id).forEach((e) => { if (!seen.has(e[1])) { seen.add(e[1]); msDown(e[1], seen); } }); return seen; }
function msUp(id, seen = new Set()) { MS_DATA.graph.edges.filter((e) => e[1] === id).forEach((e) => { if (!seen.has(e[0])) { seen.add(e[0]); msUp(e[0], seen); } }); return seen; }
function msScenarioHealth(sid) {
  if (!MS_DATA.scenarios[sid]) return "normal";
  const sigs = msSignals(sid); return sigs.some((x) => x.status === "critical") ? "critical" : sigs.some((x) => x.status === "warning") ? "warning" : "normal";
}
function msNodeHealth(id) {
  const n = MS_NODE[id]; const own = n.scenario ? msScenarioHealth(n.scenario) : "normal";
  if (own !== "normal") return own;
  return [...msUp(id)].some((u) => MS_NODE[u].scenario && msScenarioHealth(MS_NODE[u].scenario) !== "normal") ? "impacted" : "normal";
}
function msDeptsFor(apps) {
  const deps = PI_DATA.directory.departments;
  if (apps.includes("SSO")) return deps.map((d) => ({ department: d.name, count: d.headcount }));
  if (apps.length === 1 && apps[0] === "Remote Access VPN") return deps.map((d) => ({ department: d.name, count: Math.round(d.headcount * d.remote_pct) }));
  return deps.filter((d) => d.apps.some((a) => apps.includes(a))).map((d) => ({ department: d.name, count: d.headcount }));
}
function msNodeApps(id) { const n = MS_NODE[id]; if (n.apps.length) return n.apps; return [...new Set([...msDown(id)].flatMap((x) => MS_NODE[x].apps))]; }

/* ------------------------------------------------------- correlation */
function msCorrelate(sid, ov, stepOverride) {
  const s = PI_SCEN[sid]; const d = MS_DATA.scenarios[sid]; if (!d) return null;
  const sigs = msSignals(sid, ov, stepOverride);
  const abn = sigs.filter((x) => x.status === "warning" || x.status === "critical");
  const has = (k) => abn.some((a) => a.key === k); const ok = (k) => sigs.some((a) => a.key === k) && !has(k);
  const cats = [...new Set(abn.map((x) => x.cat))]; const allCats = [...new Set(sigs.map((x) => x.cat))];
  const hyp = abn.length ? d.hypotheses.find((h) => h.when.every(has) && (!h.healthy || h.healthy.every(ok))) || null : null;
  const changes = d.changes.map((c) => ({ ...c, related: c.hours_ago >= 0 && c.hours_ago <= 48 && c.correlates.some(has) }));
  const recent = changes.filter((c) => c.related).sort((a, b) => a.hours_ago - b.hours_ago)[0] || null;
  const top = (abn.length ? abn : sigs).reduce((a, b) => (b.dev > a.dev ? b : a), sigs[0]);
  const rate = top ? msClip(Math.abs(top.series[top.series.length - 1] - top.series[Math.max(0, top.series.length - 7)]) / (Math.abs(top.crit - top.baseline) || 1)) : 0;
  // Time until the worst signal reaches its critical threshold at the current pace (5-minute readings).
  let eta = null;
  if (top && top.status !== "critical" && top.trend === "worsening") { const per = (top.series[top.series.length - 1] - top.series[Math.max(0, top.series.length - 7)]) / 6; const gap = top.crit - top.current; if (per && gap / per > 0) eta = Math.round(((gap / per) * 5) / 6) / 10; }
  else if (top && top.status === "critical") eta = 0;
  // Capacity forecast: only from capacity-category signals (time to limit, or days to a known expiry).
  const capSig = sigs.find((x) => x.key === "hours_to_limit") || sigs.find((x) => x.key === "pwd_expiry");
  const capHours = capSig ? (capSig.key === "pwd_expiry" ? capSig.current * 24 : capSig.current) : null;
  const q = abn.length ? abn.reduce((a, x) => a + (x.quality || 0.8), 0) / abn.length : 0;
  const reliability = q * Math.min(1, cats.length / 3);
  const biz = sigs.filter((x) => x.cat === "business"); const bizAbn = biz.filter((x) => abn.includes(x));
  const business = abn.length ? msClip(d.business_level / 5) * (0.5 + 0.5 * (biz.length ? bizAbn.length / biz.length : 0)) : 0;
  const affected = abn.length ? [d.node, ...msDown(d.node)] : [];
  const confidence = !abn.length ? "—" : cats.length >= 3 && reliability >= 0.6 ? "High" : cats.length >= 2 ? "Medium" : "Low";
  const sev = !abn.length ? "None expected" : s.criticality >= 5 && business >= 0.7 ? "Sev 1 (enterprise-wide)" : s.criticality >= 4 ? "Sev 2 (major business service)" : "Sev 3 (degraded, workaround available)";
  const fill = (t) => t.replace(/\{(\w+)\}/g, (m, k) => { const x = sigs.find((y) => y.key === k); return x ? piFmt(x.current, x.unit) : m; });
  return { sid, step: stepOverride != null ? stepOverride : msStep(sid), sigs, abn, cats, allCats, healthy: allCats.filter((c) => !cats.includes(c)), hyp, changes, recent, top, rate, eta, capHours, reliability, business, business_level: d.business_level, business_text: fill(d.business_text), affected, confidence, severity: sev };
}
// Compact copy stored on a prediction (series kept for abnormal signals only).
function msSnapshot(c) {
  if (!c) return null;
  return { ...c, sigs: c.sigs.map((x) => ({ key: x.key, name: x.name, cat: x.cat, unit: x.unit, baseline: x.baseline, warn: x.warn, crit: x.crit, better: x.better, current: x.current, status: x.status, dev: Math.round(x.dev * 100) / 100, trend: x.trend, quality: x.quality, action: x.action, primary: !!x.primary, series: x.status === "normal" ? null : x.series })), abn: undefined, top: c.top ? { key: c.top.key, name: c.top.name } : null, at: wbNow() };
}
function msAbn(c) { return c ? c.sigs.filter((x) => x.status === "warning" || x.status === "critical") : []; }

/* ------------------------------------------------- rules-v2 risk score */
const _piScoreV1 = piScore;
piScore = function (f, cfg) {
  const clip = msClip; const ms = f.ms || null;
  const pool = [...(f.metrics || [])]; if (ms) ms.sigs.forEach((x) => { if (!pool.some((m) => m.key === x.key)) pool.push(x); });
  const devs = pool.filter((m) => m.current != null).map((m) => ({ m, d: msDev(m, m.current) }));
  const dmax = devs.length ? devs.reduce((a, b) => (b.d > a.d ? b : a)) : null;
  const dev = devs.length ? 0.7 * dmax.d + 0.3 * (devs.reduce((a, b) => a + b.d, 0) / devs.length) : 0;
  const liveAbn = (f.metrics || []).filter((m) => m.status === "warning" || m.status === "critical").length;
  let liveRate = 0;
  if (!ms && dmax && dmax.m.series && dmax.m.series.length > 6) { const sr = dmax.m.series; liveRate = clip(Math.abs(sr[sr.length - 1] - sr[sr.length - 7]) / (Math.abs(dmax.m.crit - dmax.m.baseline) || 1)); }
  const abnCats = ms ? [...new Set(msAbn(ms).map((x) => x.cat))].length : 0;
  const sub = {
    deviation: dev * 100,
    rate: (ms ? ms.rate : liveRate) * 100,
    duration: clip((f.minutes || 0) / 60) * 100,
    history: clip((f.n90 || 0) / 10) * 100,
    similar: f.similar ? clip(f.disruptive / f.similar) * clip(f.similar / 5) * 100 : 0,
    recurrence: clip(((f.max_cluster || 1) - 1) / 5) * 100,
    correlated: ms ? clip((abnCats - 1) / 4) * 100 : clip((liveAbn - 1) / 3) * 100,
    business: ms ? ms.business * 100 : liveAbn ? clip((f.business_level || f.criticality || 3) / 5) * 50 : 0,
    criticality: clip((f.criticality || 0) / 5) * 100,
    // null = no data source for this factor: it is left out and its weight is shared by the others
    // (missing data is not evidence of low risk). 0 = the data says there is no risk from it.
    changes: ms ? (ms.recent ? clip(1 - ms.recent.hours_ago / 48) * 100 : 0) : null,
    capacity: ms && ms.capHours != null ? clip(1 - ms.capHours / 168) * 100 : null,
    reliability: (ms ? ms.reliability : liveAbn ? (f.live ? 0.95 : 0.6) * Math.min(1, liveAbn / 3) : 0) * 100,
  };
  const val = {
    deviation: dmax ? `${dmax.m.name} ${piFmt(dmax.m.current, dmax.m.unit)} vs normal ${piFmt(dmax.m.baseline, dmax.m.unit)} (critical at ${piFmt(dmax.m.crit, dmax.m.unit)})` : "No metrics",
    rate: ms ? (ms.top ? `${ms.top.name}: ${Math.round(ms.rate * 100)}% of its normal-to-critical range in the last 30 min` : "Stable") : liveRate ? `${Math.round(liveRate * 100)}% of the normal-to-critical range in the last 30 min` : "Not enough readings",
    duration: f.minutes ? `Abnormal for ${Math.round(f.minutes)} min` : "Not yet abnormal",
    history: `${f.n90 || 0} incident(s) on this service in 90 days`,
    similar: `${f.disruptive || 0} of ${f.similar || 0} similar incident(s) caused a disruption`,
    recurrence: f.max_cluster > 1 ? `Same problem repeated ${f.max_cluster} times` : "No repeat pattern",
    correlated: ms ? `${abnCats} of ${ms.allCats.length} signal categories abnormal (${msAbn(ms).length} signals)` : `${liveAbn} live metric(s) abnormal (no simulated signals mixed in)`,
    business: ms ? `Impact level ${ms.business_level}/5${msAbn(ms).some((x) => x.cat === "business") ? ", business transactions already affected" : ", business transactions not yet affected"}` : `Impact level from service criticality (live signal)`,
    criticality: `${f.criticality} of 5`,
    changes: ms && ms.recent ? `${ms.recent.id} ${ms.recent.hours_ago} h ago: suspected contributor, not a confirmed cause` : ms ? "No related change in the last 48 h" : "Not applicable: no change data for the live signal",
    capacity: ms && ms.capHours != null ? `Capacity limit in about ${Math.round(ms.capHours)} h` : "Not applicable: no capacity forecast for this service",
    reliability: ms ? `Synthetic source quality ${Math.round((msAbn(ms).reduce((a, x) => a + (x.quality || 0.8), 0) / Math.max(1, msAbn(ms).length)) * 100)}%, ${abnCats} independent categor${abnCats === 1 ? "y" : "ies"} agree` : f.live ? "Live ServiceNow sign-in events" : "Simulated metrics only",
  };
  const w = cfg.weights; const keys = Object.keys(PI_DATA.factors);
  const wsum = keys.filter((k) => sub[k] != null).reduce((a, k) => a + (+w[k] || 0), 0) || 1;
  const contributions = keys.map((k) => (sub[k] == null ? { factor: k, label: PI_DATA.factors[k].label, value: val[k], sub: null, weight: +w[k] || 0, points: 0, na: true } : { factor: k, label: PI_DATA.factors[k].label, value: val[k], sub: Math.round(sub[k]), weight: +w[k] || 0, points: Math.round((sub[k] * (+w[k] || 0) / wsum) * 10) / 10 }));
  const naW = contributions.filter((c) => c.na).reduce((a, c) => a + c.weight, 0);
  const score = Math.max(0, Math.min(100, Math.round(contributions.reduce((a, c) => a + c.points, 0))));
  return { score, cls: piClassOf(score), contributions, engine: PI_DATA.config.engine_label, weights_total: wsum, na_weight: naW };
};

/* ------------------------------------------------- simulation controls */
function msAnimate(sid, target, ms) {
  clearInterval(MSL.anim[sid]);
  const tick = () => {
    const cur = msStep(sid);
    if (cur === target) { clearInterval(MSL.anim[sid]); delete MSL.anim[sid]; msSyncSim(sid); msCommit(); return; }
    MS.st[sid].step = cur + (target > cur ? 1 : -1); msSyncSim(sid); msCommit();
  };
  tick(); if (msStep(sid) !== target) MSL.anim[sid] = setInterval(tick, ms);
}
function msSyncSim(sid) {
  const s = PI_SCEN[sid]; if (!s || PI.sim[sid].state === "recurring") return;
  const step = msStep(sid);
  if (step > 0 && PI.sim[sid].state !== "abnormal") PI.sim[sid] = { state: "abnormal", onset: new Date(Date.now() - Math.max(5, s.spike.minutes) * 60000).toISOString() };
  if (step === 0) PI.sim[sid] = { state: "normal", onset: null };
  if (sid === "sso") PI.demo.spiked = step > 0;
}
function msSpike(sid) { const s = PI_SCEN[sid]; if (!s || s.start === "recurring") return; piAudit(`${s.short}: spike simulation started (signals move step by step to critical).`); msAnimate(sid, 4, 1100); }
function msRecover(sid) { const s = PI_SCEN[sid]; if (!s || s.start === "recurring") return; piAudit(`${s.short}: recovery simulated (signals return to normal).`); msAnimate(sid, 0, 600); }
function msReset(sid) { clearInterval(MSL.anim[sid]); delete MSL.anim[sid]; MS.st[sid].step = msStartStep(sid); if (MS.wi.sid === sid) MS.wi.ov = {}; msSyncSim(sid); piAudit(`${PI_SCEN[sid].short}: scenario reset to its starting state.`); msCommit(); }
piSimSet = function (sid, state) { if (state === "abnormal") msSpike(sid); else msRecover(sid); };

// The primary metrics of every scenario now follow the same step-based simulation.
const _piSimReadingsMS = piSimReadings;
piSimReadings = function (sid) {
  const d = MS_DATA.scenarios[sid];
  if (!d || PI.sim[sid].state === "recurring") return _piSimReadingsMS(sid);
  const step = msStep(sid);
  return PI_SCEN[sid].metrics.map((m) => {
    const t = piThr(sid, m); const sg = d.signals.find((x) => x.ref && x.key === m.key);
    const x = { ...m, ...t, path: sg ? sg.path : msGenPath(m) };
    const series = msSeries(sid, x, step, 48);
    const out = { ...m, ...t, current: series[series.length - 1], series, source: "simulated" };
    return { ...out, status: piStatus(out, out.current) };
  });
};
piSimAbnMinutes = function (sid) {
  const s = PI.sim[sid]; if (!s || s.state !== "abnormal" || !s.onset) return 0;
  const full = Math.max(0, (Date.now() - Date.parse(s.onset)) / 60000);
  return Math.round(full * (msStep(sid) / 4));
};

/* --------------------------------------- hooks into the existing pipeline */
const _piRunScenarioMS = piRunScenario;
piRunScenario = function (sid, opts = {}) { return _piRunScenarioMS(sid, PI_SCEN[sid] && PI_SCEN[sid].demo_only ? { ...opts, mode: "demo" } : opts); };
const _piLoadHistMS = piLoadHist;
piLoadHist = function (sid, force) { if (PI_SCEN[sid] && PI_SCEN[sid].demo_only) return; return _piLoadHistMS(sid, force); };
// Demo-only scenarios never write to ServiceNow: their investigation is always a synthetic incident run in Controlled Demo Mode.
const _piInvestigateMS = piInvestigate;
piInvestigate = async function (predId, assoc) {
  const p = piPred(predId);
  if (!p || !PI_SCEN[p.sid].demo_only || WB.mode !== "live") return _piInvestigateMS(predId, assoc);
  WB.mode = "demo";
  try { return await _piInvestigateMS(predId, assoc); } finally { WB.mode = "live"; wbCommit(); }
};
// Associate a prediction with an existing synthetic (demo) incident: no ServiceNow call.
function msAssociateDemo(predId, incId) {
  const p = piPred(predId); const inc = wbInc(incId);
  if (!p || !inc || p.incident) return { ok: false, error: "Already linked, or the incident no longer exists." };
  p.incident = { incId: inc.id, number: null, url: null, at: wbNow(), associated: true };
  p.status = "Investigating"; p.nodes.rca = { status: "running", started: wbNow(), tools: [], decision: `Associated with the existing demo incident ${inc.id}.`, source: "human" };
  piEvent(p, "IT administrator (human)", `Associated with existing demo incident ${inc.id} (${inc.title}). The RCA workflow and its approval gates stay with the engineer.`);
  piAudit(`${p.id}: associated with demo incident ${inc.id}.`); piCommit();
  return { ok: true };
}
function msRescoreAll(reason) {
  let n = 0;
  PI.preds.forEach((p) => {
    if (!p.features || !PI_ACTIVE.has(p.status)) return;
    const r = piScore(p.features, PI.config); if (r.score === p.score) return;
    piEvent(p, "Risk engine (rules-v2)", `Re-scored after ${reason}: ${p.score} → ${r.score} (${r.cls}). Alerts already sent are not changed.`, "info");
    p.risk = r; p.score = r.score; p.cls = r.cls; n++;
  });
  return n;
}

// Reset demo also resets every scenario's simulation and the what-if sandbox.
const _wbResetAllMS = wbResetAll;
wbResetAll = function () { Object.values(MSL.anim).forEach(clearInterval); MSL.anim = {}; MS = msFresh(); msSave(); _wbResetAllMS(); };

/* ------------------------------------------------- capacity forecasting */
function msForecast(id) {
  const p = MS_DATA.demand.find((x) => x.id === id) || MS_DATA.demand[0];
  const past = Array.from({ length: 7 }, (_, i) => piRound(p.current * (0.9 + 0.1 * (i / 6)) + ((i * 37) % 5) - 2, "%"));
  const exp = p.curve.map((m, i) => piRound(p.current * m * (i >= p.starts_in_days ? 1 : 1), "%"));
  const peak = Math.max(...exp); const cross = exp.findIndex((v) => v >= p.threshold); const hit = exp.findIndex((v) => v >= p.limit);
  return { ...p, past, exp, peak, crossDay: cross < 0 ? null : cross, limitDay: hit < 0 ? null : hit };
}

/* ------------------------------------------------------------- what-if */
function msWhatIfSignals(sid) {
  const sigs = msSignals(sid); const pick = sigs.filter((x) => x.primary);
  const seen = new Set(pick.map((x) => x.cat));
  sigs.forEach((x) => { if (!x.primary && !seen.has(x.cat) && pick.length < 8) { seen.add(x.cat); pick.push(x); } });
  return pick.map((x) => {
    let lo, hi;
    if (x.better === "higher") { lo = Math.min(x.crit, x.baseline) * (x.unit === "%" ? 0.9 : 0.5); hi = x.unit === "%" ? 100 : x.baseline * 1.1; }
    else { lo = 0; hi = x.unit === "%" ? 100 : Math.max(x.crit * 1.5, x.path[4] * 1.2); }
    const step = hi - lo > 1000 ? 10 : hi - lo > 100 ? 1 : hi - lo > 10 ? 0.5 : 0.1;
    return { ...x, lo: piRound(lo, x.unit), hi: piRound(hi, x.unit), stepv: step };
  });
}
function msWhatIf(sid) {
  const ov = MS.wi.sid === sid ? MS.wi.ov : {};
  const c = msCorrelate(sid, ov); const s = PI_SCEN[sid];
  const h = piDemoHistory(sid);
  const prim = c.sigs.filter((x) => x.primary).map((x) => ({ ...x }));
  const metrics = prim.length ? prim : c.sigs.slice(0, 3);
  const minutes = c.abn.length ? Math.max(piSimAbnMinutes(sid), 30) : 0;
  const f = { metrics, n90: h.n90, similar: h.similar, disruptive: h.disruptive, criticality: s.criticality, max_cluster: h.max_cluster, minutes, ms: c, business_level: c.business_level };
  const risk = piScore(f, PI.config);
  const groups = c.abn.length ? piGroups({ sid, mode: "demo" }) : [];
  const top = c.abn.length ? c.abn.reduce((a, b) => (b.dev > a.dev ? b : a)) : null;
  return { c, risk, groups, affected: groups.reduce((a, g) => a + g.count, 0), disruption: c.abn.length ? (c.hyp ? c.hyp.text : `${s.prediction}: ${s.service}`) : "No disruption predicted: every signal is within its normal thresholds.", action: top ? top.action || s.actions[0] : "No action needed.", empAlert: risk.score >= PI.config.employee_alert_threshold, itAlert: risk.score >= PI.config.it_alert_threshold };
}
</script>
