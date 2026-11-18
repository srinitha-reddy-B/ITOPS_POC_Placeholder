<style>
.pi-src{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:11.5px;color:var(--ink-muted);margin:-4px 0 14px}
.pi-src b{font-weight:500;color:var(--ink-soft)}
.pi-charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}
@media (max-width:1100px){.pi-charts{grid-template-columns:1fr}}
.pi-chart>svg{width:100%;height:auto;display:block}
.pi-legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11px;color:var(--ink-soft);margin-top:6px}
.pi-legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.pi-scens{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.pi-scen{display:flex;flex-direction:column;gap:8px;padding:14px 16px}
.pi-scen h3{margin:0;font-size:13.5px}
.pi-scen .meta{font-size:11.5px;color:var(--ink-muted)}
.pi-score{font-size:30px;font-weight:600;letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums}
.pi-gauge{position:relative;height:8px;border-radius:99px;background:linear-gradient(90deg,#22c55e 0 30%,#f5b544 30% 60%,#f08a3c 60% 80%,#e5484d 80% 100%);margin:10px 0 4px}
.pi-gauge i{position:absolute;top:-4px;width:3px;height:16px;border-radius:2px;background:var(--ink)}
.pi-contrib{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.6fr) 90px 46px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line);font-size:12px}
.pi-contrib:last-child{border-bottom:0}
.pi-contrib .bar{height:7px;border-radius:99px;background:var(--hover);overflow:hidden}
.pi-contrib .bar i{display:block;height:100%;background:var(--brand)}
@media (max-width:700px){.pi-contrib{grid-template-columns:1fr 60px}.pi-contrib .v,.pi-contrib .bar{display:none}}
.pi-flow{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.pi-flow .arr{color:var(--ink-faint);font-size:12px}
.pi-alert{border:1px solid var(--line);border-left:4px solid var(--warn);border-radius:10px;padding:12px 14px;background:var(--surface);margin-top:10px}
.pi-alert.crit{border-left-color:#e5484d}.pi-alert.high{border-left-color:#f08a3c}.pi-alert.done{border-left-color:var(--ok-dot);opacity:.9}
.pi-alert h4{margin:2px 0 4px;font-size:14px}
.pi-alert .row{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--ink-soft)}
.pi-alert .acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.pi-alert .acts .btn{height:28px;font-size:12px}
.pi-track{list-style:none;margin:8px 0 0;padding:0;font-size:12.5px}
.pi-track li{display:flex;gap:8px;align-items:center;padding:4px 0;color:var(--ink-muted)}
.pi-track li.d{color:var(--ink)} .pi-track li svg{width:14px;height:14px} .pi-track li.d svg{color:var(--ok)}
.pi-walk{list-style:none;margin:10px 0 0;padding:0}
.pi-walk li{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);font-size:12.5px}
.pi-walk li:last-child{border-bottom:0}
.pi-walk .n{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:600;background:var(--hover)}
.pi-walk li.d .n{background:var(--ok);color:#fff}
.pi-walk .s{font-size:11.5px;color:var(--ink-muted)}
.pi-num{width:80px;height:30px;font-size:12.5px}
.pi-set td{padding:6px 12px!important}
</style>
<script>
"use strict";
/* ---------------------------------------------- Predictive Intelligence UI */
UI.pi = { sel: null, dtab: "risk", confirm: null, busy: null, err: "", draft: {}, fdOpen: {}, cfg: null };
const PI_COLORS = ["#0a5c9e", "#0e9f8e", "#d08a1e", "#d4443b", "#64748b", "#c2417a"];
const piClsKind = (c) => ({ Critical: "critical", High: "serious", Moderate: "warning", Low: "good" }[c] || "info");
const piClsBadge = (c) => (c ? badge(piClsKind(c), c) : "");
const piStKind = (s) => ({ "False positive": "warning", "Investigation required": "critical", "Alert generated": "serious", "Early warning": "warning", Monitoring: "info", Acknowledged: "info", Investigating: "running", Mitigated: "good", Dismissed: "info", Superseded: "info", "No anomaly": "good", Failed: "critical", Analysing: "running", Interrupted: "warning" }[s] || "info");
const piStBadge = (s) => badge(piStKind(s), s);
const piModeTag = (m) => (m === "live" ? `<span class="wb-src live" title="Live LLM agents; ServiceNow history from the POC instance">Live agents</span>` : `<span class="wb-src scripted" title="Scripted outputs and synthetic history (Controlled Demo Mode)">Scripted demo</span>`);
const piMetricKind = (s) => ({ critical: "critical", warning: "warning", normal: "good", unknown: "info" }[s]);
function piNice(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }
function piDays(n) { const out = []; for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000); out.push(d.toISOString().slice(0, 10)); } return out; }
const piWeekLabels = () => Array.from({ length: 12 }, (_, i) => (i === 11 ? "This wk" : `-${11 - i}w`));

/* ------------------------------------------------------------------ charts */
function piLineChart(labels, series, opt = {}) {
  const W = 560, H = opt.h || 190, L = 34, R = 10, T = 10, B = 24;
  const max = piNice(Math.max(1, ...series.flatMap((s) => s.values.filter((v) => v != null))));
  const n = labels.length; const x = (i) => L + (n === 1 ? 0 : (i * (W - L - R)) / (n - 1)); const y = (v) => T + (1 - v / max) * (H - T - B);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="#ececf0"/><text x="${L - 6}" y="${y(max * f) + 3}" text-anchor="end" font-size="10" fill="#8e8e9a">${Math.round(max * f * 10) / 10}</text>`).join("");
  const step = Math.ceil(n / 7);
  const xl = labels.map((l, i) => (i % step === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#8e8e9a">${esc(l)}</text>` : "")).join("");
  const lines = series.map((s) => `<polyline fill="none" stroke="${s.color}" stroke-width="2" ${s.dash ? 'stroke-dasharray="4 3"' : ""} points="${s.values.map((v, i) => `${x(i)},${y(v || 0)}`).join(" ")}"/><circle cx="${x(n - 1)}" cy="${y(s.values[n - 1] || 0)}" r="3" fill="${s.color}"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label || "Line chart")}">${grid}${xl}${lines}</svg><div class="pi-legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}${opt.note ? `<span style="color:var(--ink-muted)">${esc(opt.note)}</span>` : ""}</div>`;
}
function piBarChart(labels, series, opt = {}) {
  const W = 560, H = opt.h || 190, L = 34, R = 10, T = 10, B = 24;
  const max = piNice(Math.max(1, ...series.flatMap((s) => s.values)));
  const n = labels.length; const gw = (W - L - R) / n; const bw = Math.max(3, (gw * 0.72) / series.length);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const grid = [0, 0.5, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="#ececf0"/><text x="${L - 6}" y="${y(max * f) + 3}" text-anchor="end" font-size="10" fill="#8e8e9a">${Math.round(max * f)}</text>`).join("");
  const step = Math.ceil(n / 8);
  const bars = labels.map((l, i) => series.map((s, j) => { const v = s.values[i] || 0; const syn = s.synthetic && s.synthetic[i]; const x0 = L + i * gw + (gw - bw * series.length) / 2 + j * bw; return `<rect x="${x0}" y="${y(v)}" width="${bw - 1}" height="${Math.max(0, H - B - y(v))}" rx="2" fill="${s.color}" opacity="${syn ? 0.35 : 1}"><title>${esc(`${l} · ${s.name}: ${v}${syn ? " (synthetic baseline)" : ""}`)}</title></rect>`; }).join("") + (i % step === 0 || i === n - 1 ? `<text x="${L + i * gw + gw / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#8e8e9a">${esc(l)}</text>` : "")).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label || "Bar chart")}">${grid}${bars}</svg><div class="pi-legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}${opt.note ? `<span style="color:var(--ink-muted)">${esc(opt.note)}</span>` : ""}</div>`;
}
function piSpark(m) {
  if (!m.series || !m.series.length) return `<span style="font-size:11px;color:var(--ink-faint)">No time series</span>`;
  const W = 130, H = 30; const vals = m.series; const lo = Math.min(...vals, m.baseline, m.warn), hi = Math.max(...vals, m.baseline, m.warn);
  const y = (v) => H - 3 - ((v - lo) / (hi - lo || 1)) * (H - 6); const x = (i) => (i * W) / (vals.length - 1);
  const col = { critical: "#e5484d", warning: "#d08a1e" }[m.status] || "#0e9f8e";
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-label="Last 4 hours"><line x1="0" x2="${W}" y1="${y(m.warn)}" y2="${y(m.warn)}" stroke="#d08a1e" stroke-dasharray="3 3" stroke-width="1"/><polyline fill="none" stroke="${col}" stroke-width="1.6" points="${vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/></svg>`;
}
function piGauge(score) { return `<div class="pi-gauge" title="Low 0-30 · Moderate 31-60 · High 61-80 · Critical 81-100"><i style="left:calc(${Math.max(0, Math.min(100, score))}% - 1px)"></i></div><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--ink-faint)"><span>0</span><span>30</span><span>60</span><span>80</span><span>100</span></div>`; }

/* --------------------------------------------------------- shared bits */
function piActive() { return PI.preds.filter((p) => PI_ACTIVE.has(p.status)); }
function piKpis() {
  const act = piActive();
  const svc = new Set(act.filter((p) => ["High", "Critical"].includes(p.cls)).map((p) => piTarget(p).service));
  const byDept = {}; act.forEach((p) => (p.groups || []).forEach((g) => { byDept[g.department] = Math.max(byDept[g.department] || 0, g.count); }));
  return { active: act.length, critical: act.filter((p) => p.cls === "Critical").length, services: svc.size, affected: Object.values(byDept).reduce((a, b) => a + b, 0), alerts: PI.preds.filter((p) => p.alerts && p.alerts.employee).length, mitigated: PI.preds.filter((p) => p.mitigation && p.mitigation.confirmed).length };
}
function piSourceLine() {
  const live = wbMode() === "live"; const dt = WBL.status && WBL.status.dynatrace;
  return `<div class="pi-src"><span>${icon("activity")} Monitoring: ${live && PI_LIVE_SSO ? `<b>SSO: ServiceNow sign-in events (live)</b> · other services: ` : ""}<b>${dt && dt.configured ? `Dynatrace (${esc(dt.environment)}) with simulated fallback` : "simulated feed"}</b>${dt && dt.configured ? "" : " · Dynatrace not configured"}</span><span>${icon("history")} Incident history: <b>${live ? "ServiceNow POC instance (live)" : "Synthetic (Controlled Demo Mode)"}</b></span><span>${icon("gauge")} Risk: <b>${esc(PI_DATA.config.engine_label)}</b> · not a machine-learning model</span><span>${icon("users")} Employee mapping: <b>Synthetic directory</b></span></div>`;
}
function piTabs(cur) {
  const tabs = [["overview", "Overview"], ["signals", "Multi-signal monitoring"], ["metrics", "Operational metrics"], ["predictions", "Risk engine & predictions"], ["map", "Dependency map"], ["whatif", "What-if simulation"], ["impact", "Employee impact"], ["alerts", "Notifications"], ["settings", "Settings"]];
  return `<div class="subtabs" style="margin-bottom:14px">${tabs.map(([k, l]) => `<button class="subtab ${cur === k ? "on" : ""}" data-act="pi-tab" data-t="${k}">${l}</button>`).join("")}</div>`;
}
function pagePredictive() {
  piSync();
  const parts = route().split("/");
  if (parts[1] === "p" && parts[2]) return piDetail(decodeURIComponent(parts[2]));
  const tab = parts[1] || "overview";
  if (wbMode() === "live") { if (tab === "overview") piLoadTrends(); if (tab === "metrics") PI_DATA.scenarios.forEach((s) => piLoadHist(s.id)); }
  const body = { overview: piTabOverview, signals: msTabSignals, metrics: piTabMetrics, predictions: piTabPredictions, map: msTabMap, whatif: msTabWhatIf, impact: piTabImpact, alerts: msTabAlerts, settings: piTabSettings }[tab] || piTabOverview;
  return `${head("Predictive Intelligence", "Proactive incident prevention: AURA watches operational metrics and ServiceNow incident history, predicts disruptions before employees report them, alerts the people who could be affected and IT, and hands confirmed risks to the existing RCA workflow.", "Predictive Incident Intelligence", wbModePill())}
  ${piSourceLine()}${piTabs(tab)}${body()}
  ${simnote(`Monitoring signals (infrastructure, application, database, network, business, user experience, capacity, change events and forecasts) are simulated demo data, except the SSO sign-in signal in Live Agent Mode, which reads real sign-in events from the POC ServiceNow instance and is never mixed with simulated signals. The dependency map, employee directory mapping and Controlled Demo Mode history are synthetic. In Live Agent Mode the agents are real LLM calls and incident history comes from the POC ServiceNow instance; the three multi-signal-only scenarios (claims, database, capacity) always run scripted and never write to ServiceNow. The risk score is a rule-based, explainable calculation (${PI_DATA.config.engine}), not machine learning and not a probability. Predicted incidents are never shown as actual ServiceNow incidents until IT raises or associates one.`)}`;
}

/* ---------------------------------------------------------------- overview */
function piWalkthrough() {
  const sso = piLatest("sso"); const spiked = PI.sim.sso.state === "abnormal";
  const ran = sso && sso.nodes.notify && sso.nodes.notify.status === "done";
  const run = sso && sso.incident && WB.runs[sso.incident.incId];
  const step = (n, done, t, s, act) => `<li class="${done ? "d" : ""}"><span class="n">${done ? icon("check") : n}</span><div><div>${t}</div>${s ? `<div class="s">${s}</div>` : ""}</div><div>${act || ""}</div></li>`;
  const live = piLiveSso(); const m = piReadings("sso")[0];
  const sig = live ? PI.live.sso : null; const abn = live && m.status !== "normal" && m.status !== "unknown";
  const inst = WBL.status && WBL.status.servicenow && WBL.status.servicenow.instance;
  const s2 = live ? (sig && sig.error ? `<span style="color:var(--danger)">ServiceNow sign-in events unavailable: ${esc(sig.error)}</span>` : !sig ? "Reading ServiceNow sign-in events…" : `<b>Real data:</b> ${sig.last_hour.attempts} sign-in attempt(s) in the last 60 min, ${sig.last_hour.successes} successful, <b>${sig.last_hour.failures} failed</b> (7-day normal ${piFmt(m.baseline)} failed per hour; warning at ${piFmt(m.warn)}) ${badge(piMetricKind(m.status), m.status)}`) : `Login failures now: <b>${piFmt(m.current, m.unit)}</b> (normal ${piFmt(m.baseline, m.unit)}, warning at ${piFmt(m.warn, m.unit)}) ${badge(piMetricKind(m.status), m.status)}`;
  const d = UI.pi.drill && UI.pi.drill !== "busy" ? `<br><span style="color:var(--ink-soft)">${esc(UI.pi.drill)}</span>` : "";
  return `<div class="card pad"><div class="sec-head"><p class="sec-title">${icon("play")} Live demonstration: SSO disruption</p><a class="btn ghost" href="#/sso-investigation">${icon("network")} Animated investigation view</a><span class="note-r">${wbMode() === "live" ? "Live Agent Mode: real agents, ServiceNow history" : "Controlled Demo Mode: scripted agents"}</span></div>
  <ol class="pi-walk">
    ${step(1, true, "Open Predictive Intelligence", "You're here.")}
    ${step(2, true, live ? "Check the real sign-in signal (ServiceNow)" : "Check normal authentication metrics", s2, live ? `<button class="btn ghost" data-act="pi-signal">${icon("rotate")} Refresh</button>` : `<a class="btn ghost" href="#/predictive/metrics">View metrics</a>`)}
    ${live ? step(3, abn, "Cause real failed sign-ins", `Either sign in at ${inst ? `<a href="${esc(inst)}/login.do" target="_blank" rel="noopener noreferrer" style="color:var(--brand)">${esc(inst.replace(/^https:\/\//, ""))}/login.do</a>` : "the ServiceNow login page"} with a wrong password a few times, or send ${PI_LIVE_SSO.drill_count} real failed sign-ins with a made-up account (nobody is locked out). Failures stay in the 60-minute window, then roll off.${d}`, `<button class="btn ${abn ? "" : "primary"}" data-act="pi-drill" ${UI.pi.drill === "busy" ? "disabled" : ""}>${icon(UI.pi.drill === "busy" ? "loader" : "zap", UI.pi.drill === "busy" ? "spin" : "")} ${UI.pi.drill === "busy" ? "Sending…" : `Send ${PI_LIVE_SSO.drill_count} failed sign-ins`}</button>`) : step(3, spiked, "Simulate an increase in authentication failures", spiked ? `Spike active: login failures rising for ${Math.round(piAbnMinutes("sso"))} min (simulated).` : "Injects 35 minutes of rising login failures into the simulated feed.", spiked ? `<button class="btn ghost" data-act="pi-sim" data-s="sso" data-v="normal">Reset to normal</button>` : `<button class="btn primary" data-act="pi-sim" data-s="sso" data-v="abnormal">${icon("zap")} Simulate spike</button>`)}
    ${step("4-8", ran, "Run the agents: Monitoring → History → Prediction → Impact → Notification", sso ? `${esc(sso.id)} · ${sso.score != null ? `risk ${sso.score}/100 ${sso.cls}` : esc(sso.status)}` : "Each agent's tools and output are shown step by step.", `<button class="btn ${(live ? abn : spiked) && !ran ? "primary" : ""}" data-act="pi-run" data-s="sso" ${PIL.loops.size ? "disabled" : ""}>${icon("bot")} Run predictive agents</button>`)}
    ${step(9, !!(sso && sso.alerts.employee), "See the employee alert", "Shown on the Digital FrontDoor before anyone reports a problem (Finance is affected, so Maya sees it).", `<button class="btn ghost" data-act="ps-switch" data-p="employee">${icon("user")} View as the employee</button>`)}
    ${step(10, !!(sso && sso.alerts.it), "See the IT administrator warning", "In the notification centre, with its alert lifecycle.", `<a class="btn ghost" href="#/predictive/alerts">Open notifications</a>`)}
    ${step(11, !!(sso && sso.incident), "Initiate the investigation", sso && sso.incident ? `Incident ${esc(sso.incident.number || sso.incident.incId)} raised from the prediction.` : "IT approves raising an incident from the prediction.", sso ? `<a class="btn ghost" href="#/predictive/p/${encodeURIComponent(sso.id)}">Open prediction</a>` : "")}
    ${step(12, !!(run && run.status === "completed"), "The existing RCA Agent takes over (8-stage workflow)", run ? `RCA workflow: ${esc(wbStatusOf(wbInc(sso.incident.incId) || { id: "" }).label)}` : "Runs the existing workflow with its engineer and SOP approval gates.", run ? `<a class="btn ghost" href="#/workbench/${encodeURIComponent(sso.incident.incId)}">Open RCA workflow (view only)</a><button class="btn ghost" data-act="ps-switch" data-p="engineer">${icon("user")} Continue as the engineer</button>` : "")}
  </ol></div>`;
}
function piTabOverview() {
  const k = piKpis(); const live = wbMode() === "live"; const tr = live ? PI.trends : null;
  const tile = (ic, label, v, sub, tone) => `<div class="card tile"><div class="h"><span style="color:${tone || "var(--ink-muted)"}">${icon(ic)}</span><span class="eyebrow">${label}</span></div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  const rnd = piRng("trend-demo");
  const fams = ["Identity & SSO", "Payment API", "Employee Center", "Claims Processing", "Member Portal"];
  const synth = { total: Array.from({ length: 12 }, () => 28 + Math.round(rnd() * 22)), by_family: Object.fromEntries(fams.map((f) => [f, Array.from({ length: 12 }, () => 3 + Math.round(rnd() * 8))])) };
  const useLive = tr && !tr.error && tr.total;
  const src = useLive ? tr : synth;
  const srcNote = useLive ? `ServiceNow POC instance (live) · ${tr.scanned} incidents scanned` : live ? (tr && tr.error ? `ServiceNow unavailable (${tr.error}); synthetic series shown` : "Loading from ServiceNow… synthetic series shown meanwhile") : "Synthetic series (Controlled Demo Mode)";
  const act = piActive(); const classes = ["Low", "Moderate", "High", "Critical"];
  const days = piDays(14); const lab = days.map((d) => d.slice(5));
  const cnt = (type) => days.map((d) => PI.ledger.filter((e) => e.type === type && e.at.slice(0, 10) === d).length);
  const syn = days.map((d) => PI.ledger.some((e) => e.synthetic && e.at.slice(0, 10) === d) && !PI.ledger.some((e) => !e.synthetic && e.at.slice(0, 10) === d));
  return `${piWalkthrough()}
  <div class="grid g6" style="gap:12px;margin-top:16px">
    ${tile("trend", "Active predictions", k.active, "Open early warnings and alerts", "var(--brand)")}
    ${tile("alert", "Critical risk alerts", k.critical, "Risk 81-100", "var(--danger)")}
    ${tile("siren", "High-risk services", k.services, "High or Critical", "var(--warn)")}
    ${tile("users", "Potentially affected employees", k.affected.toLocaleString(), "Synthetic directory mapping")}
    ${tile("bell", "Proactive alerts sent", k.alerts, "Employee alerts published")}
    ${tile("shield", "Issues prevented or mitigated", k.mitigated, "Only when mitigation is confirmed", "var(--ok)")}
  </div>
  <div class="pi-charts">
    <div class="card pad pi-chart"><div class="sec-head"><p class="sec-title">${icon("barchart")} Incident frequency over time</p>${live ? `<button class="btn ghost" data-act="pi-trends">${icon("rotate")} Refresh</button>` : ""}</div>${piLineChart(piWeekLabels(), [{ name: "Incidents per week", color: PI_COLORS[0], values: src.total }], { label: "Incidents per week", note: srcNote })}</div>
    <div class="card pad pi-chart"><p class="sec-title">${icon("activity")} Application failure trends</p>${piLineChart(piWeekLabels(), Object.entries(src.by_family || {}).slice(0, 6).map(([f, v], i) => ({ name: f, color: PI_COLORS[i % 6], values: v })), { label: "Incidents per week by application", note: srcNote })}</div>
    <div class="card pad pi-chart"><p class="sec-title">${icon("gauge")} Risk distribution (active predictions)</p>${piBarChart(classes, [{ name: "Active predictions", color: PI_COLORS[0], values: classes.map((c) => act.filter((p) => p.cls === c).length) }], { label: "Risk distribution", note: "From this POC's predictions" })}</div>
    <div class="card pad pi-chart"><p class="sec-title">${icon("trend")} Predicted versus actual incidents</p>${piBarChart(lab, [{ name: "Predictions", color: PI_COLORS[0], values: cnt("prediction"), synthetic: syn }, { name: "Became actual incidents", color: PI_COLORS[3], values: cnt("incident"), synthetic: syn }], { label: "Predicted versus actual incidents", note: "Faded bars = synthetic baseline days" })}</div>
    <div class="card pad pi-chart"><p class="sec-title">${icon("bell")} Alerts generated over time</p>${piBarChart(lab, [{ name: "Employee alerts", color: PI_COLORS[2], values: cnt("employee_alert"), synthetic: syn }, { name: "IT alerts", color: PI_COLORS[1], values: cnt("it_alert"), synthetic: syn }], { label: "Alerts over time", note: "Faded bars = synthetic baseline days" })}</div>
    <div class="card pad"><p class="sec-title">${icon("radar")} Active predictions</p>${piPredTable(act.slice(0, 6), true)}</div>
  </div>`;
}

/* ----------------------------------------------------------------- metrics */
function piHistFor(sid) {
  if (wbMode() === "live") { const h = PI.hist[sid]; return h ? (h.error ? { error: h.error } : { ...h, src: "live" }) : { loading: true }; }
  return { ...piDemoHistory(sid), src: "synthetic" };
}
function piTabMetrics() {
  const rows = PI_DATA.scenarios.map((s) => ({ s, r: piReadings(s.id) }));
  const kinds = [["response", "Application response time"], ["api", "API failure rate"], ["auth", "Authentication failure rate"], ["availability", "System availability"], ["error", "Error rate"]];
  const worst = (k) => { const ms = rows.flatMap((x) => x.r.filter((m) => m.kind === k).map((m) => ({ ...m, svc: x.s.short }))); const bad = ms.filter((m) => m.status !== "normal"); return { ms, bad }; };
  const hrows = PI_DATA.scenarios.map((s) => ({ s, h: piHistFor(s.id) }));
  const sum = `<div class="card"><div class="sec-head" style="padding:12px 20px;border-bottom:1px solid var(--line)"><p class="sec-title">${icon("radar")} Operational metrics at a glance</p>${wbMode() === "live" ? `<button class="btn ghost" data-act="pi-hist">${icon("rotate")} Refresh ServiceNow history</button>` : ""}</div>
    <div class="tbl-wrap"><table class="t" style="min-width:760px"><thead><tr><th>Metric</th><th>Services watched</th><th>Status</th><th>Source</th></tr></thead><tbody>
    ${kinds.map(([k, l]) => { const w = worst(k); return `<tr><td>${l}</td><td style="color:var(--ink-soft)">${w.ms.map((m) => esc(m.svc)).join(", ")}</td><td>${w.bad.length ? w.bad.map((m) => `${badge(piMetricKind(m.status), `${m.svc}: ${piFmt(m.current, m.unit)}`)}`).join(" ") : badge("good", "All normal")}</td><td>${w.ms.some((m) => m.source === "live") ? wbSrcTag("live") + " " : ""}${w.ms.some((m) => m.source !== "live") ? wbSrcTag("simulated") : ""}</td></tr>`; }).join("")}
    <tr><td>Incident recurrence frequency</td><td style="color:var(--ink-soft)">All five</td><td>${hrows.map(({ s, h }) => (h.max_cluster != null ? `<span class="wb-chip">${esc(s.short)}: ${h.max_cluster}x</span>` : "")).join("")}</td><td>${wbSrcTag(wbMode() === "live" ? "live" : "simulated")}</td></tr>
    <tr><td>Mean time to resolve (MTTR)</td><td style="color:var(--ink-soft)">All five</td><td>${hrows.map(({ s, h }) => (h.mttr_hours != null ? `<span class="wb-chip">${esc(s.short)}: ${h.mttr_hours} h</span>` : "")).join("")}</td><td>${wbSrcTag(wbMode() === "live" ? "live" : "simulated")}</td></tr>
    <tr><td>Historical incident patterns</td><td style="color:var(--ink-soft)">All five</td><td style="font-size:12px;color:var(--ink-soft)">${hrows.map(({ s, h }) => (h.clusters && h.clusters[0] ? `${esc(s.short)}: ${esc(h.clusters[0].problem)}${h.clusters[0].ci ? ` on ${esc(h.clusters[0].ci)}` : ""} (${h.clusters[0].count}x)` : "")).filter(Boolean).join(" · ") || (wbMode() === "live" ? "Loading…" : "")}</td><td>${wbSrcTag(wbMode() === "live" ? "live" : "simulated")}</td></tr>
    </tbody></table></div></div>`;
  return `${sum}${rows.map(({ s, r }) => {
    const h = piHistFor(s.id); const st = PI.sim[s.id].state;
    const liveSig = s.id === "sso" && piLiveSso();
    const simBtn = liveSig ? `<button class="btn" data-act="pi-drill" ${UI.pi.drill === "busy" ? "disabled" : ""}>${icon("zap")} Send ${PI_LIVE_SSO.drill_count} failed sign-ins</button><button class="btn ghost" data-act="pi-signal">${icon("rotate")} Refresh</button>` : st === "recurring" ? "" : st === "abnormal" ? `<button class="btn ghost" data-act="pi-sim" data-s="${s.id}" data-v="normal">${icon("check")} Simulate recovery</button>` : `<button class="btn" data-act="pi-sim" data-s="${s.id}" data-v="abnormal">${icon("zap")} ${esc(s.spike.label)}</button>`;
    return `<div class="card" style="margin-top:12px"><div class="sec-head" style="padding:12px 20px;border-bottom:1px solid var(--line);flex-wrap:wrap;gap:8px"><div><p class="sec-title">${icon("activity")} ${esc(s.short)} · ${esc(s.service)}</p><p style="margin:2px 0 0;font-size:11.5px;color:var(--ink-muted)">Component ${esc(s.ci)} · owner ${esc(s.owner_group)} · criticality ${s.criticality}/5 · ${liveSig ? `<b>live ServiceNow sign-in events</b>, rolling 60 minutes${PI.live.sso && PI.live.sso.read_at ? `, read ${rel(PI.live.sso.at)}` : ""}` : st === "abnormal" ? `abnormal for ${Math.round(piAbnMinutes(s.id))} min (simulated)` : st === "recurring" ? "pattern metrics" : "normal behaviour"}</p></div><div class="wb-ctrl">${simBtn}<button class="btn" data-act="pi-run" data-s="${s.id}" ${PIL.loops.size ? "disabled" : ""}>${icon("bot")} Run predictive agents</button></div></div>
    <div class="tbl-wrap"><table class="t" style="min-width:820px"><thead><tr><th>Metric</th><th>Normal</th><th>Current</th><th>Warning / critical</th><th>Status</th><th>Last 4 hours</th><th>Source</th></tr></thead><tbody>
      ${r.map((m) => `<tr><td>${esc(m.name)}</td><td>${piFmt(m.baseline, m.unit)}</td><td><b>${piFmt(m.current, m.unit)}</b></td><td style="color:var(--ink-soft)">${m.better === "higher" ? "≤ " : "≥ "}${piFmt(m.warn, m.unit)} / ${piFmt(m.crit, m.unit)}</td><td>${badge(piMetricKind(m.status), m.status)}</td><td>${piSpark(m)}</td><td>${wbSrcTag(m.source === "live" ? "live" : "simulated")}</td></tr>`).join("")}
    </tbody></table></div>${liveSig && UI.pi.drill && UI.pi.drill !== "busy" ? `<p style="margin:0;padding:8px 20px;font-size:12px;color:var(--ink-soft);border-top:1px solid var(--line)">${esc(UI.pi.drill)}</p>` : ""}
    <div style="padding:10px 20px;border-top:1px solid var(--line);font-size:12px;color:var(--ink-soft)">${icon("history")} Incident history (${h.src === "live" ? `ServiceNow, ${esc(s.family)} family` : h.src === "synthetic" ? "synthetic" : "ServiceNow"}): ${h.loading ? "loading…" : h.error ? `<span style="color:var(--danger)">${esc(h.error)}</span>` : s.id === "recurring" && h.src === "live" ? (h.pattern ? `strongest repeat outside use cases 1-4: <b>${esc(h.pattern.family || "")} ${esc(h.pattern.problem)}${h.pattern.ci ? ` on ${esc(h.pattern.ci)}` : ""}</b>, ${h.pattern.count} times, every ~${h.pattern.avg_interval_days} days` : "no repeat pattern found") : `${h.n90} in 90 days · ${h.similar} similar · ${h.disruptive} caused disruption · largest repeat ${h.max_cluster}x · MTTR ${h.mttr_hours != null ? `${h.mttr_hours} h` : "n/a"}`}</div></div>`;
  }).join("")}`;
}

/* ------------------------------------------------------- predictions tab */
function piPredTable(list, compact) {
  if (!list.length) return `<p style="font-size:12.5px;color:var(--ink-muted);margin:10px 0 0">No predictions yet.</p>`;
  return `<div class="tbl-wrap" style="${compact ? "margin:8px -20px 0" : ""}"><table class="t" style="min-width:${compact ? 520 : 860}px"><thead><tr><th>Prediction</th><th>Service</th><th>Risk</th><th>Status</th>${compact ? "" : "<th>ServiceNow incident</th><th>Source</th><th>Created</th>"}</tr></thead><tbody>
  ${list.map((p) => `<tr class="click" data-act="pi-open" data-id="${esc(p.id)}"><td><div style="font-weight:500">${esc(PI_SCEN[p.sid].title)}</div><div class="mono" style="font-size:11px;color:var(--ink-muted)">${esc(p.id)}</div></td><td>${esc(piTarget(p).short)}</td><td>${p.score != null ? `<b>${p.score}</b> ${piClsBadge(p.cls)}` : "—"}</td><td>${piStBadge(p.status)}</td>${compact ? "" : `<td>${p.incident ? (p.incident.url && WB_SN_URL.test(p.incident.url) ? `<a class="snlink" href="${esc(p.incident.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${esc(p.incident.number)}${icon("external")}</a>` : `<span class="mono" style="font-size:11.5px" title="Synthetic demo incident">${esc(p.incident.incId)}</span>`) : `<span style="color:var(--ink-faint)">Not raised (predicted only)</span>`}</td><td>${piModeTag(p.mode)}</td><td style="white-space:nowrap;color:var(--ink-soft)">${rel(p.created)}</td>`}</tr>`).join("")}
  </tbody></table></div>`;
}
function piTabPredictions() {
  const live = wbMode() === "live"; const busy = PIL.loops.size > 0 || PIL.cycle;
  return `<div class="card pad"><div class="sec-head" style="flex-wrap:wrap;gap:8px"><div><p class="sec-title">${icon("gauge")} Predictive risk engine</p><p style="margin:2px 0 0;font-size:12px;color:var(--ink-soft)">${esc(PI_DATA.config.engine_label)}: a weighted, explainable score from ${Object.keys(PI_DATA.factors).length} factors, fed by the multi-signal correlation engine. Low 0-30 · Moderate 31-60 · High 61-80 · Critical 81-100. Weights and thresholds are on the Settings tab. It is designed so a trained model can replace it later; it is not machine learning today.</p></div>
    <button class="btn primary" data-act="pi-cycle" ${busy ? "disabled" : ""}>${icon(PIL.cycle ? "loader" : "play", PIL.cycle ? "spin" : "")} ${PIL.cycle ? "Monitoring cycle running…" : `Run monitoring cycle (all ${PI_DATA.scenarios.length} services)`}</button></div>
    <div class="grid g3" style="gap:8px;margin-top:10px">${Object.entries(PI_DATA.factors).map(([k, f]) => `<div style="border:1px solid var(--line);border-radius:10px;padding:8px 10px"><div style="display:flex;justify-content:space-between;gap:6px"><b style="font-size:12.5px;font-weight:500">${esc(f.label)}</b><span class="wb-chip">weight ${PI.config.weights[k]}</span></div><div style="font-size:11.5px;color:var(--ink-muted);margin-top:2px">${esc(f.how)}</div></div>`).join("")}</div>
    ${live ? `<p style="font-size:11.5px;color:var(--ink-muted);margin:10px 0 0">Live Agent Mode: each anomalous service makes 5 real LLM calls (about 30-40 s); services whose metrics are normal stop after the threshold rules without an LLM call.</p>` : ""}</div>
  <div class="pi-scens" style="margin-top:12px">${[...PI_DATA.scenarios].sort((a, b) => a.order - b.order).map((s) => {
    const p = piLatest(s.id); const st = PI.sim[s.id].state; const running = p && PIL.loops.has(p.id);
    return `<div class="card pi-scen"><div style="display:flex;justify-content:space-between;gap:8px"><span class="eyebrow">Use case ${s.order}</span>${p ? piModeTag(p.mode) : ""}</div><h3>${esc(s.title)}</h3><div class="meta">${esc(p ? piTarget(p).service : s.service)} · ${st === "abnormal" ? "metrics abnormal (simulated)" : st === "recurring" ? "pattern analysis" : "metrics normal"}</div>
      ${p ? `<div style="display:flex;align-items:baseline;gap:8px"><span class="pi-score">${p.score != null ? p.score : "—"}</span><span style="font-size:12px;color:var(--ink-muted)">/100</span>${piClsBadge(p.cls)}</div><div>${piStBadge(running ? "Analysing" : p.status)} <span class="meta">${rel(p.created)}</span></div>` : `<div class="meta">Not analysed yet.</div>`}
      <div class="wb-ctrl" style="margin-top:auto">${p ? `<a class="btn" href="#/predictive/p/${encodeURIComponent(p.id)}">Open</a>` : ""}<button class="btn ${p ? "" : "primary"}" data-act="pi-run" data-s="${s.id}" ${busy ? "disabled" : ""}>${icon("bot")} ${p ? "Re-run agents" : "Run agents"}</button></div></div>`;
  }).join("")}</div>
  <div class="card pad" style="margin-top:12px"><p class="sec-title">${icon("history")} All predictions</p>${piPredTable(PI.preds.slice(0, 30), false)}</div>`;
}

/* ----------------------------------------------------------- impact tab */
function piTabImpact() {
  const act = piActive().filter((p) => p.groups && p.groups.length);
  return `<div class="card"><div class="sec-head" style="padding:12px 20px;border-bottom:1px solid var(--line)"><p class="sec-title">${icon("users")} Employee impact analysis</p><span class="note-r">${esc(PI_DATA.directory.note)}</span></div>
  ${act.length ? `<div class="tbl-wrap"><table class="t" style="min-width:860px"><thead><tr><th>Affected application</th><th>Department</th><th>Potentially affected employees</th><th>Risk level</th><th>Reason for impact</th></tr></thead><tbody>
  ${act.flatMap((p) => p.groups.map((g, i) => `<tr>${i === 0 ? `<td rowspan="${p.groups.length}" style="vertical-align:top"><a href="#/predictive/p/${encodeURIComponent(p.id)}" style="font-weight:500;color:var(--brand)">${esc(piTarget(p).short)}</a><div style="font-size:11.5px;color:var(--ink-muted)">${esc(PI_SCEN[p.sid].title)}</div></td>` : ""}<td>${esc(g.department)}</td><td><b>${g.count.toLocaleString()}</b></td><td>${p.score} ${piClsBadge(p.cls)}</td><td style="color:var(--ink-soft);font-size:12px">${esc(g.reason)}</td></tr>`)).join("")}
  </tbody></table></div>` : `<p style="padding:16px 20px;margin:0;font-size:12.5px;color:var(--ink-muted)">No active predictions with an impact analysis.</p>`}</div>
  <p style="font-size:11.5px;color:var(--ink-muted);margin:10px 0 0">Only departments that depend on the affected application receive the employee alert. Counts are department totals (or the remote share for VPN); no individual employee data is used.</p>`;
}

/* --------------------------------------------------------- settings tab */
function piTabSettings() {
  if (!UI.pi.cfg) UI.pi.cfg = JSON.parse(JSON.stringify(PI.config));
  const c = UI.pi.cfg; const wsum = Object.values(c.weights).reduce((a, b) => a + (+b || 0), 0);
  const num = (id, v, step) => `<input class="input pi-num" id="${id}" type="number" step="${step || 1}" value="${esc(String(v))}">`;
  return `<div class="grid g2" style="gap:12px;align-items:start">
  <div class="card pad"><p class="sec-title">${icon("sliders")} Risk factor weights</p><p style="font-size:12px;color:var(--ink-soft);margin:4px 0 8px">Weights are normalised, so the score stays 0-100. Current total: <b>${wsum}</b>.</p>
    <table class="t pi-set"><tbody>${Object.entries(PI_DATA.factors).map(([k, f]) => `<tr><td>${esc(f.label)}</td><td>${num(`pi-w-${k}`, c.weights[k])}</td></tr>`).join("")}</tbody></table>
    <div id="pi-w-preview">${piWeightPreview()}</div>
    <p class="sec-title" style="margin-top:16px">${icon("bell")} Alert thresholds</p>
    <table class="t pi-set"><tbody><tr><td>Employee alert when risk is at least</td><td>${num("pi-thr-emp", c.employee_alert_threshold)}</td></tr><tr><td>IT alert when risk is at least</td><td>${num("pi-thr-it", c.it_alert_threshold)}</td></tr></tbody></table>
    <div class="wb-ctrl" style="margin-top:12px"><button class="btn primary" data-act="pi-cfg-save">${icon("check")} Save settings</button><button class="btn ghost" data-act="pi-cfg-reset">Restore defaults</button></div>
    ${UI.pi.err ? `<div class="wb-flash" style="margin-top:10px">${esc(UI.pi.err)}</div>` : ""}
    <p style="font-size:11.5px;color:var(--ink-muted);margin:10px 0 0">POC control: there is no sign-in, so settings changes are recorded in the audit list below as the IT administrator role. New values apply to the next agent run.</p></div>
  <div class="card pad"><p class="sec-title">${icon("activity")} Metric thresholds</p>
    ${PI_DATA.scenarios.map((s) => `<div class="wb-sect"><span class="eyebrow">${esc(s.short)}</span><table class="t pi-set"><thead><tr><th>Metric</th><th>Warning</th><th>Critical</th></tr></thead><tbody>${[...s.metrics, ...(s.live_signal ? s.live_signal.metrics : [])].map((m) => { const t = (c.thresholds[s.id] || {})[m.key] || {}; return `<tr><td style="font-size:12px">${esc(m.name)}${m.unit ? ` (${esc(m.unit)})` : ""}</td><td>${num(`pi-t-${s.id}-${m.key}-warn`, t.warn != null ? t.warn : m.warn, "any")}</td><td>${num(`pi-t-${s.id}-${m.key}-crit`, t.crit != null ? t.crit : m.crit, "any")}</td></tr>`; }).join("")}</tbody></table></div>`).join("")}
  </div></div>
  <div class="card pad" style="margin-top:12px"><p class="sec-title">${icon("history")} Predictive audit trail</p>${PI.audit.length ? `<ul class="wb-ul">${PI.audit.slice(0, 25).map((a) => `<li><span class="mono" style="font-size:11px;color:var(--ink-muted)">${stamp(a.at)}</span> ${esc(a.text)}</li>`).join("")}</ul>` : `<p style="font-size:12.5px;color:var(--ink-muted);margin:6px 0 0">No administrator actions yet.</p>`}</div>`;
}
function piSaveSettings() {
  const c = UI.pi.cfg; if (!c) return;
  const ws = Object.values(c.weights).map(Number);
  if (ws.some((w) => isNaN(w) || w < 0) || ws.reduce((a, b) => a + b, 0) <= 0) { UI.pi.err = "Weights must be zero or more, with a total above zero."; render(); return; }
  const e = +c.employee_alert_threshold, i = +c.it_alert_threshold;
  if ([e, i].some((x) => isNaN(x) || x < 0 || x > 100)) { UI.pi.err = "Alert thresholds must be between 0 and 100."; render(); return; }
  for (const s of PI_DATA.scenarios) for (const m of [...s.metrics, ...(s.live_signal ? s.live_signal.metrics : [])]) { const t = (c.thresholds[s.id] || {})[m.key]; if (!t) continue; const w = +t.warn, cr = +t.crit; if (isNaN(w) || isNaN(cr) || (m.better === "higher" ? cr > w : cr < w)) { UI.pi.err = `${s.short} · ${m.name}: the critical threshold must be ${m.better === "higher" ? "below" : "above"} the warning threshold.`; render(); return; } }
  PI.config = JSON.parse(JSON.stringify({ ...c, employee_alert_threshold: e, it_alert_threshold: i }));
  const n = msRescoreAll("a weight change");
  UI.pi.err = ""; piAudit(`Risk weights, alert thresholds or metric thresholds changed by the IT administrator${n ? `; ${n} active prediction(s) re-scored` : ""}.`); piCommit();
}
function piWeightPreview() {
  const c = UI.pi.cfg || PI.config; const list = PI.preds.filter((p) => p.features && PI_ACTIVE.has(p.status)).slice(0, 6);
  if (!list.length) return "";
  return `<div style="margin-top:10px;border:1px solid var(--line);border-radius:10px;padding:8px 10px"><span class="eyebrow">Recalculated with these weights (preview)</span>${list.map((p) => { const r = piScore(p.features, { ...c, weights: Object.fromEntries(Object.entries(c.weights).map(([k, v]) => [k, +v || 0])) }); return `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px;padding:3px 0"><span>${esc(PI_SCEN[p.sid].short)}</span><span>${p.score} → <b>${r.score}</b> ${piClsBadge(r.cls)}</span></div>`; }).join("")}<p style="font-size:11px;color:var(--ink-muted);margin:4px 0 0">Updates as you type. Save to re-score the active predictions.</p></div>`;
}

/* ------------------------------------------------------- prediction detail */
function piNodeOut(p, key, o) {
  if (!o) return "";
  switch (key) {
    case "monitor": return `${wbKv([["Summary", o.summary], ["Trend", o.trend]])}${wbSec("Abnormal signals", wbUl(wbArr(o.abnormal_signals).map((x) => `${wbTxt(x.metric)}: ${wbTxt(x.observation)}`)))}`;
    case "history": return `${wbKv([["Summary", o.summary], ["Disruption history", o.disruption_history], ["Recurrence", o.recurrence_assessment]])}${wbSec("Most similar incidents", wbUl(wbArr(o.most_similar).map((x) => `${wbTxt(x.number)}: ${wbTxt(x.why)}`)))}${wbSec("Patterns", wbUl(o.patterns))}${wbSec("Prior resolutions", wbUl(o.prior_resolutions))}`;
    case "predict": return `${wbKv([["Prediction", o.prediction], ["Explanation", o.explanation], ["Time horizon", o.time_horizon], ["Uncertainty", o.uncertainty]])}${wbSec("Key drivers", wbUl(wbArr(o.key_drivers).map((x) => `${wbTxt(x.factor)}: ${wbTxt(x.detail)}`)))}${wbSec("Recommended preventive actions", wbUl(o.recommended_actions))}`;
    case "impact": return `${wbKv([["Summary", o.summary], ["Who to notify", o.notification_rationale]])}${wbSec("Groups", wbUl(wbArr(o.groups).map((g) => `${wbTxt(g.department)}: ${wbTxt(g.reason)}`)))}${wbSec("Dependent applications", wbUl(o.dependent_applications))}`;
    case "notify": return o.note ? `<p style="font-size:12.5px;margin:0">${esc(o.note)}</p>` : `${wbKv([["Employee alert", o.employee_title], ["IT alert", o.it_title], ["Suggested priority", o.it_priority]])}`;
    default: return "";
  }
}
function piNodeDetail(p, key) {
  const n = p.nodes[key]; const meta = PI_NODES[key];
  if (key === "rca") {
    const run = p.incident && WB.runs[p.incident.incId];
    return `<p style="font-size:12.5px;margin:0 0 8px;color:var(--ink-soft)">${esc(meta.role)}</p>${p.incident ? `${wbKv([["Incident", p.incident.number || p.incident.incId], ["RCA workflow", run ? wbStatusOf(wbInc(p.incident.incId) || { id: "" }).label : "—"], ["Current stage", run ? wbStageOf(wbInc(p.incident.incId) || { id: "" }).stage : "—"]])}<a class="btn" style="margin-top:8px" href="#/workbench/${encodeURIComponent(p.incident.incId)}">${icon("arrow")} Open the RCA workflow</a>` : `<p style="font-size:12.5px;margin:0">Not started. The RCA Agent only takes over when IT raises or associates an actual incident (Actions panel).</p>`}`;
  }
  if (!n) return `<p style="font-size:12.5px;color:var(--ink-muted);margin:0">${esc(meta.role)} Not run.</p>`;
  return `<p style="font-size:12.5px;margin:0 0 8px;color:var(--ink-soft)">${esc(meta.role)}</p>
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11.5px;color:var(--ink-muted)">${n.source ? wbSrcTag(n.source) : ""}${n.model ? `<span>${esc(n.model)}</span>` : ""}${n.ms ? `<span>${wbDur(n.ms)}</span>` : ""}${n.usage && n.usage.input_tokens ? `<span>${n.usage.input_tokens} in / ${n.usage.output_tokens} out tokens (billed)</span>` : ""}</div>
    ${n.decision ? `<p style="font-size:12.5px;margin:8px 0 0"><b>Decision:</b> ${esc(n.decision)}</p>` : ""}
    ${n.note ? `<p style="font-size:12px;margin:6px 0 0;color:var(--warn)">${icon("alert")} ${esc(n.note)}</p>` : ""}
    ${n.error ? `<div class="wb-flash" style="margin-top:8px">${esc(n.error)}</div><button class="btn" data-act="pi-retry" data-id="${esc(p.id)}">${icon("rotate")} Retry from this step</button>` : ""}
    ${n.tools.length ? wbSec(`Tools invoked (${n.tools.length})`, n.tools.map((t) => `<div class="wb-tool"><div class="h">${icon("tool")} ${esc(t.name)} ${wbSrcTag(t.source)} ${t.status === "ok" ? badge("good", "ok") : t.status === "running" ? badge("running", "running") : badge("critical", "failed")} ${t.ms != null ? `<span class="note-r">${wbDur(t.ms)}</span>` : ""}</div><div style="font-size:12px;color:var(--ink-soft);margin-top:2px">${esc(t.summary || "")}</div></div>`).join("")) : ""}
    ${n.output ? wbSec("Output", piNodeOut(p, key, n.output)) : ""}${wbRaw(n.input, "Context passed to this agent")}${wbRaw(n.output)}`;
}
function piEmployeeCard(p, preview) {
  const a = p.alerts.employee || (preview ? p.alerts.draft && { ...p.alerts.draft, score: p.score, cls: p.cls, service: piTarget(p).short } : null);
  if (!a) return "";
  const cls = a.cls === "Critical" ? "crit" : a.cls === "High" ? "high" : "";
  return `<div class="pi-alert ${cls}"><span class="eyebrow" style="color:var(--danger)">${icon("bell")} Predictive alert</span><h4>${esc(a.title)}</h4><div class="row"><span>Risk score: <b>${a.score}/100</b> (${esc(a.cls)})</span><span>Affected service: <b>${esc(a.service)}</b></span></div><p style="font-size:12.5px;margin:8px 0 0"><b>Reason:</b> ${esc(a.message)}</p><p style="font-size:12.5px;margin:6px 0 0"><b>Recommended action:</b> ${esc(a.action)}</p><p style="font-size:12px;margin:6px 0 0;color:var(--ink-soft)"><b>Status:</b> ${esc(a.status)}</p></div>`;
}
function piDetail(id) {
  const p = piPred(id);
  if (!p) return `<a class="btn ghost" href="#/predictive">${icon("back")} Predictive Intelligence</a><div class="card pad" style="margin-top:12px">Prediction not found (it may have been cleared by Reset demo).</div>`;
  const s = PI_SCEN[p.sid]; const t = piTarget(p); const running = PIL.loops.has(p.id);
  const sel = UI.pi.sel && (p.nodes[UI.pi.sel] || UI.pi.sel === "rca") ? UI.pi.sel : running && p.current ? p.current : p.failedAt || "monitor";
  const nodeKeys = [...PI_ORDER, "rca"];
  const flow = `<div class="pi-flow">${nodeKeys.map((k, i) => { const n = p.nodes[k]; const st = k === "rca" ? (p.incident ? (p.status === "Mitigated" ? "done" : "running") : "pending") : n ? n.status : "pending"; return `${i ? `<span class="arr">→</span>` : ""}<button class="wb-node s-${st} ${sel === k ? "sel" : ""} ${k === "rca" ? "human" : ""}" data-act="pi-sel" data-k="${k}"><span class="st"></span>${icon(PI_NODES[k].icon)}${esc(PI_NODES[k].short)}</button>`; }).join("")}</div>`;
  const pr = p.nodes.predict && p.nodes.predict.output;
  const live = wbMode() === "live"; const modeOk = p.mode === wbMode();
  const busy = UI.pi.busy === p.id; const d = UI.pi.draft;
  const run = p.incident && WB.runs[p.incident.incId];
  const canAct = PI_ACTIVE.has(p.status);
  const actions = `<div class="card pad"><p class="sec-title">${icon("usercheck")} IT administrator actions</p>
    <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">${piStBadge(running ? "Analysing" : p.status)}${p.ack.admin ? `<span class="note-r">Acknowledged ${rel(p.ack.admin.at)}</span>` : ""}</div>
    ${UI.pi.err && UI.pi.errFor === p.id ? `<div class="wb-flash" style="margin-top:10px">${esc(UI.pi.err)}</div>` : ""}
    ${canAct && !p.ack.admin ? `<button class="btn" style="margin-top:10px" data-act="pi-ack" data-id="${esc(p.id)}">${icon("check")} Acknowledge prediction</button>` : ""}
    ${p.incident ? wbSec("Linked incident", `${wbKv([["Incident", p.incident.url && WB_SN_URL.test(p.incident.url) ? `<a class="snlink" href="${esc(p.incident.url)}" target="_blank" rel="noopener noreferrer">${esc(p.incident.number)}${icon("external")}</a> (ServiceNow)` : `<span class="mono">${esc(p.incident.incId)}</span> (synthetic, demo)`, true], ["How", p.incident.associated ? "Associated existing incident" : "Raised from this prediction"], ["RCA workflow", run ? wbStatusOf(wbInc(p.incident.incId) || { id: "" }).label : "—"]])}<a class="btn" href="#/workbench/${encodeURIComponent(p.incident.incId)}">${icon("arrow")} Track in the RCA workflow</a>`)
      : canAct ? wbSec("Start an investigation", !modeOk ? `<p style="font-size:12px;margin:0;color:var(--warn)">${p.mode === "live" ? "This prediction came from live agents: switch to Live Agent Mode to raise a real ServiceNow incident." : "This is a scripted demo prediction: switch to Controlled Demo Mode to raise a synthetic incident. Scripted predictions never create real ServiceNow records."}</p>`
        : UI.pi.confirm === p.id ? `<p style="font-size:12.5px;margin:0 0 8px">${live ? "This creates a real incident in the POC ServiceNow instance (tagged to this prediction)" : "This creates a synthetic incident (no ServiceNow call)"} and hands it to the existing RCA workflow, which keeps its engineer and SOP approval gates.</p><div class="wb-ctrl"><button class="btn primary" data-act="pi-inv-go" data-id="${esc(p.id)}" ${busy ? "disabled" : ""}>${icon(busy ? "loader" : "siren", busy ? "spin" : "")} ${busy ? "Creating…" : "Approve and raise incident"}</button><button class="btn ghost" data-act="pi-inv-cancel">Cancel</button></div>`
        : `<button class="btn primary" data-act="pi-inv-ask" data-id="${esc(p.id)}">${icon("siren")} Initiate investigation</button>${live && !PI_SCEN[p.sid].demo_only ? `<div style="display:flex;gap:6px;margin-top:8px"><input class="input" id="pi-assoc" placeholder="Or associate an existing INC number" value="${esc(d.assoc || "")}" style="height:32px;font-size:12.5px"><button class="btn" data-act="pi-assoc" data-id="${esc(p.id)}" data-need="assoc" ${/^INC\d{7}$/i.test((d.assoc || "").trim()) && !busy ? "" : "disabled"}>Associate</button></div>` : `<div style="display:flex;gap:6px;margin-top:8px"><select class="sel" id="ms-assoc-sel" style="height:32px;font-size:12.5px;flex:1;min-width:0"><option value="">Or associate an existing demo incident…</option>${wbIncidentsFor(PI_SCEN[p.sid].use_case).filter((i) => !PI.preds.some((q) => q.incident && q.incident.incId === i.id)).map((i) => `<option value="${esc(i.id)}" ${UI.ms.assoc === i.id ? "selected" : ""}>${esc(i.id)} · ${esc(i.title.slice(0, 60))}</option>`).join("")}</select><button class="btn" data-act="ms-assoc" data-id="${esc(p.id)}" ${UI.ms.assoc ? "" : "disabled"}>Associate</button></div><p style="font-size:11px;color:var(--ink-muted);margin:4px 0 0">Demo incidents only: no ServiceNow call.</p>`}`) : ""}
    ${canAct || p.status === "Investigating" ? wbSec("Confirm mitigation", p.sid === "recurring" ? `<p style="font-size:12px;margin:0;color:var(--ink-soft)">Recurring risks are confirmed mitigated when the linked incident is verified and closed by the RCA workflow.</p>` : `<p style="font-size:12px;margin:0 0 6px;color:var(--ink-soft)">Counted as prevented or mitigated only after a re-check shows every metric back to normal${p.incident ? ", or automatically when the linked incident is verified and closed" : ""}.</p>
      ${p.signal ? `<p style="font-size:12px;margin:0 0 6px;color:var(--ink-soft)">Live signal: the re-check reads the real ServiceNow sign-in events again. Failed sign-ins leave the 60-minute window an hour after they happened.</p>` : ""}<div class="wb-ctrl">${PI.sim[p.sid].state === "abnormal" && !p.signal ? `<button class="btn ghost" data-act="pi-sim" data-s="${p.sid}" data-v="normal" title="Demo control: the simulated metrics recover">${icon("zap")} Simulate recovery</button>` : ""}<button class="btn" data-act="pi-recheck" data-id="${esc(p.id)}">${icon("activity")} Re-check metrics</button></div>
      ${p.recheck ? `<p style="font-size:12px;margin:6px 0 0;color:${p.recheck.normal ? "var(--ok)" : "var(--warn)"}">${p.recheck.normal ? "All metrics back to normal" : `${(p.recheck.checks || []).filter((c) => c.status !== "normal").length || ""} metric(s) still abnormal`} (${rel(p.recheck.at)})</p>` : ""}
      <textarea class="ta" id="pi-note" rows="2" style="margin-top:8px" placeholder="What was done to mitigate the risk (required)">${esc(d.note || "")}</textarea><button class="btn" style="margin-top:6px" data-act="pi-mitigate" data-id="${esc(p.id)}" data-need="note" ${p.recheck && p.recheck.normal && (d.note || "").trim().length >= 10 ? "" : "disabled"}>${icon("shield")} Confirm mitigated</button>`) : ""}
    ${canAct && !p.incident ? wbSec("Dismiss", `<select class="sel" id="pi-dis-kind" style="height:32px;font-size:12.5px;margin-bottom:6px;width:100%">${[["not_real", "Not a real risk"], ["false_positive", "False positive (the signals were wrong or misleading)"], ["planned", "Planned work or known event"], ["duplicate", "Duplicate of another prediction"]].map(([k, l]) => `<option value="${k}" ${UI.ms.disKind === k ? "selected" : ""}>${l}</option>`).join("")}</select><textarea class="ta" id="pi-dis" rows="2" placeholder="Why this is not a real risk (required)">${esc(d.dis || "")}</textarea><button class="btn danger" style="margin-top:6px" data-act="pi-dismiss" data-id="${esc(p.id)}" data-need="dis" ${(d.dis || "").trim().length >= 10 ? "" : "disabled"}>${icon("xcircle")} Dismiss prediction</button>`) : ""}
    ${p.mitigation ? wbSec("Mitigation", wbKv([["Confirmed by", p.mitigation.by], ["Basis", p.mitigation.basis], ["Note", p.mitigation.note || ""], ["When", stamp(p.mitigation.at)]])) : ""}
    ${p.dismissed ? wbSec(p.status === "False positive" ? "Closed as a false positive" : "Dismissed", `<p style="font-size:12.5px;margin:0">${esc(p.dismissed.reason)}</p><p style="font-size:11px;color:var(--ink-muted);margin:4px 0 0">Not counted as a mitigation.</p>`) : ""}
    ${wbSec("Alert lifecycle", msLifeHtml(p))}
  </div>`;
  const tabs = [["risk", "Risk breakdown"], ["metrics", "Supporting metrics"], ["history", "Historical incidents"], ["impact", "Affected employees"], ["alerts", "Alerts"], ["audit", "Audit trail"]];
  const dt = tabs.some((x) => x[0] === UI.pi.dtab) ? UI.pi.dtab : "risk";
  const h = p.hist;
  const body = {
    risk: () => (p.risk ? `<p style="font-size:12px;color:var(--ink-soft);margin:0 0 8px">${esc(p.risk.engine)}: each factor scores 0-100, then is weighted (weights total ${p.risk.weights_total}). Points add up to the risk score.${p.risk.na_weight ? ` Factors with no data source for this prediction are marked "not applicable": they are left out and their weight (${p.risk.na_weight}) is shared by the others, because missing data isn't evidence of low risk.` : ""}</p>${p.risk.contributions.map((c) => `<div class="pi-contrib"><div><b style="font-weight:500">${esc(c.label)}</b><div style="font-size:11px;color:var(--ink-muted)">${c.na ? `not applicable · weight ${c.weight} redistributed` : `factor ${c.sub}/100 · weight ${c.weight}`}</div></div><div class="v" style="color:var(--ink-soft)">${esc(c.value)}</div><div class="bar" title="${c.points} of ${Math.round((c.weight / p.risk.weights_total) * 1000) / 10} possible points"><i style="width:${(c.points / Math.max(0.1, (c.weight / p.risk.weights_total) * 100)) * 100}%"></i></div><b style="text-align:right">${c.na ? "—" : c.points}</b></div>`).join("")}<div class="pi-contrib"><b>Risk score</b><div class="v"></div><div></div><b style="text-align:right">${p.score}</b></div>` : `<p style="font-size:12.5px;color:var(--ink-muted);margin:0">No score: the run stopped before the Predictive Intelligence Agent.</p>`),
    metrics: () => (p.readings.length ? `<div class="tbl-wrap"><table class="t" style="min-width:700px"><thead><tr><th>Metric</th><th>Normal</th><th>At prediction</th><th>Warning / critical</th><th>Status</th><th>Readings</th><th>Source</th></tr></thead><tbody>${p.readings.map((m) => `<tr><td>${esc(m.name)}</td><td>${piFmt(m.baseline, m.unit)}</td><td><b>${piFmt(m.current, m.unit)}</b></td><td style="color:var(--ink-soft)">${piFmt(m.warn, m.unit)} / ${piFmt(m.crit, m.unit)}</td><td>${badge(piMetricKind(m.status), m.status)}</td><td>${piSpark(m)}</td><td>${wbSrcTag(m.source === "live" ? "live" : m.source === "dynatrace" ? "live" : "simulated")}</td></tr>`).join("")}</tbody></table></div>` : `<p style="font-size:12.5px;color:var(--ink-muted);margin:0">No readings.</p>`),
    history: () => (h ? `<p style="font-size:12px;color:var(--ink-soft);margin:0 0 8px">${h.synthetic ? "Synthetic history (Controlled Demo Mode)." : "Read from the POC ServiceNow instance."} ${h.family_total} on the service family · ${h.n90} in 90 days · ${h.similar} similar · ${h.disruptive} with priority 1-2 · largest repeat ${h.max_cluster}x · MTTR ${h.mttr_hours != null ? `${h.mttr_hours} h` : "n/a"}</p>${h.clusters && h.clusters.length ? wbSec("Recurring clusters", wbUl(h.clusters.map((c) => `${c.problem}${c.ci ? ` on ${c.ci}` : ""}: ${c.count} times${c.avg_interval_days ? `, about every ${c.avg_interval_days} days` : ""}`))) : ""}<div class="tbl-wrap" style="margin-top:8px"><table class="t" style="min-width:720px"><thead><tr><th>Incident</th><th>Short description</th><th>Priority</th><th>State</th><th>Opened</th><th>Resolution</th></tr></thead><tbody>${h.records.map((r) => `<tr><td>${r.url && WB_SN_URL.test(r.url) ? `<a class="snlink" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.number)}${icon("external")}</a>` : `<span class="mono" style="font-size:11.5px" title="Synthetic record, not in ServiceNow">${esc(r.number)}</span>`}</td><td>${esc(r.title)}</td><td>${esc(r.priority)}</td><td>${esc(r.state)}</td><td style="white-space:nowrap">${r.days_ago != null ? `${Math.round(r.days_ago)} d ago` : "—"}</td><td style="font-size:12px;color:var(--ink-soft)">${esc(r.resolution || "—")}</td></tr>`).join("")}</tbody></table></div>` : `<p style="font-size:12.5px;color:var(--ink-muted);margin:0">Not analysed.</p>`),
    impact: () => (p.groups && p.groups.length ? `<div class="tbl-wrap"><table class="t" style="min-width:640px"><thead><tr><th>Department</th><th>Potentially affected employees</th><th>Applications</th><th>Reason</th></tr></thead><tbody>${p.groups.map((g) => `<tr><td>${esc(g.department)}</td><td><b>${g.count.toLocaleString()}</b></td><td style="font-size:12px">${esc(g.apps.join(", "))}</td><td style="font-size:12px;color:var(--ink-soft)">${esc(g.reason)}</td></tr>`).join("")}</tbody></table></div><p style="font-size:11.5px;color:var(--ink-muted);margin:8px 0 0">Total ${p.affected.toLocaleString()} employees · synthetic directory mapping, department-level only.</p>` : `<p style="font-size:12.5px;color:var(--ink-muted);margin:0">Not analysed.</p>`),
    alerts: () => `<div style="margin-bottom:10px">${msLifeHtml(p)}</div><div class="grid g2" style="gap:12px;align-items:start"><div>${wbSec(p.alerts.employee ? `Employee alert (sent to ${p.alerts.employee.departments.length} department(s))` : "Employee alert (drafted, not sent: below threshold)", piEmployeeCard(p, true) || `<p style="font-size:12.5px;color:var(--ink-muted);margin:0">None.</p>`)}</div><div>${wbSec("IT alert", p.alerts.it ? `<div class="pi-alert high"><span class="eyebrow">IT alert · ${esc(p.alerts.it.team)} · ${esc(p.alerts.it.priority)}</span><h4>${esc(p.alerts.it.title)}</h4><p style="font-size:12.5px;margin:4px 0 0">${esc(p.alerts.it.summary)}</p>${wbSec("Investigation steps", wbUl(p.alerts.it.steps))}</div>` : `<p style="font-size:12.5px;color:var(--ink-muted);margin:0">None.</p>`)}</div></div>`,
    audit: () => `<ul class="wb-ul">${p.events.map((e) => `<li><span class="mono" style="font-size:11px;color:var(--ink-muted)">${stamp(e.at).slice(11)}</span> <b style="font-weight:500">${esc(e.actor)}</b>: ${esc(e.text)}</li>`).join("")}</ul>`,
  }[dt]();
  return `<a class="btn ghost" href="#/predictive/predictions" style="padding-left:0">${icon("back")} Predictive Intelligence</a>
  <div class="phead" style="margin-top:6px"><div style="min-width:0"><div class="t"><h1 style="font-size:20px">${esc((pr && pr.prediction) || `${s.prediction}: ${t.service}`)}</h1></div><p style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center"><span class="mono" style="font-size:11.5px">${esc(p.id)}</span><span>${esc(t.service)}</span><span>${rel(p.created)}</span>${piModeTag(p.mode)}<span class="pill p-warn"><span class="d"></span>Predicted, not an actual incident${p.incident ? " (incident raised)" : ""}</span></p></div></div>
  <div class="wb-split">
    <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
      <div class="card pad"><div class="sec-head"><p class="sec-title">${icon("gauge")} Risk score</p><span class="note-r">${esc(PI_DATA.config.engine_label)}</span></div>
        <div style="display:flex;align-items:baseline;gap:10px;margin-top:8px"><span class="pi-score" style="font-size:40px">${p.score != null ? p.score : "—"}</span><span style="color:var(--ink-muted)">/100</span>${piClsBadge(p.cls)}${p.horizon ? `<span class="note-r">${esc(p.horizon)}</span>` : ""}</div>${p.score != null ? piGauge(p.score) : ""}
        ${pr ? `<p style="font-size:12.5px;line-height:1.6;margin:10px 0 0">${esc(pr.explanation)}</p>` : ""}</div>
      ${p.ms && msAbn(p.ms).length ? msCorrPanel(p.ms, p.risk, { title: "Consolidated prediction" }) : p.score != null ? `<div class="card pad"><p class="sec-title">${icon("layers")} Risk, probability, severity, impact and confidence</p><div style="margin-top:8px">${msMeasures(p.score, p.cls, null, p)}</div><p style="font-size:11.5px;color:var(--ink-muted);margin:8px 0 0">${p.signal ? "Live signal: only the real ServiceNow sign-in events are used; no simulated signals are mixed in." : "No multi-signal snapshot for this prediction."}</p></div>` : ""}
      <div class="card pad"><div class="sec-head"><p class="sec-title">${icon("bot")} Agent collaboration</p>${running ? badge("running", "Agents running") : ""}</div><div style="margin-top:10px">${flow}</div>
        <div style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px"><p style="margin:0 0 6px;font-weight:600;font-size:13px">${icon(PI_NODES[sel].icon)} ${esc(PI_NODES[sel].name)}</p>${piNodeDetail(p, sel)}</div></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px;min-width:0">${actions}</div>
  </div>
  <div class="card" style="margin-top:12px"><div class="subtabs" style="padding:8px 12px 0">${tabs.map(([k, l]) => `<button class="subtab ${dt === k ? "on" : ""}" data-act="pi-dtab" data-t="${k}">${l}</button>`).join("")}</div><div class="pad">${body}</div></div>`;
}

/* -------------------------------------------- employee alert centre (FD) */
function piMyAlerts() { const dept = typeof psEmployee === "function" ? psEmployee().dept : PI_DATA.employee.department; return PI.preds.filter((p) => p.alerts && p.alerts.employee && p.alerts.employee.departments.includes(dept) && !["Superseded"].includes(p.status)); }
function piEmpStatus(p) { return p.status === "Mitigated" ? "Resolved: the risk has been fixed" : p.status === "Dismissed" || p.status === "False positive" ? "Closed: no disruption expected" : p.status === "Investigating" ? "IT is investigating" : p.alerts.employee.status; }
function piAlertCentre() {
  piSync();
  const list = piMyAlerts(); if (!list.length) return "";
  const open = list.filter((p) => !["Mitigated", "Dismissed", "False positive"].includes(p.status));
  return `<div class="card pad" style="margin-bottom:16px"><div class="sec-head"><p class="sec-title">${icon("bell")} Alerts for you</p><span class="note-r">${open.length} active · early warnings before anyone reports a problem</span></div>
  ${list.slice(0, 4).map((p) => {
    const a = p.alerts.employee; const done = ["Mitigated", "Dismissed", "False positive"].includes(p.status); const v = UI.pi.fdOpen[p.id] || "";
    const cls = done ? "done" : a.cls === "Critical" ? "crit" : a.cls === "High" ? "high" : "";
    const track = [["Prediction detected", true, rel(p.created)], ["Alert generated", true, rel(a.at)], ["You were notified", true, "here on the FrontDoor"], ["Acknowledged", !!p.ack.employee || !!p.ack.admin, p.ack.employee ? "by you" : p.ack.admin ? "by IT" : ""], ["Investigation initiated", !!p.incident, p.incident && p.incident.number ? `ticket ${p.incident.number}` : ""], [p.status === "Dismissed" || p.status === "False positive" ? "Closed: no disruption expected" : "Resolved", done, ""]];
    return `<div class="pi-alert ${cls}"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span class="eyebrow" style="color:${done ? "var(--ok)" : "var(--danger)"}">${done ? "Resolved alert" : "Predictive alert"}</span>${p.ack.employee ? `<span class="note-r">${icon("check")} Acknowledged</span>` : ""}</div>
      <h4>${esc(a.title)}</h4><div class="row"><span>Risk score: <b>${a.score}/100</b> (${esc(a.cls)})</span><span>Affected service: <b>${esc(a.service)}</b></span><span>Status: <b>${esc(piEmpStatus(p))}</b></span></div>
      <p style="font-size:12.5px;margin:8px 0 0"><b>Reason:</b> ${esc(a.message)}</p>
      ${v === "details" ? `<div style="margin-top:8px;font-size:12.5px;line-height:1.6;border-top:1px solid var(--line);padding-top:8px">${esc(a.message)} This is an early warning: nothing may go wrong, but IT has been notified so they can act before it affects you.<br><span style="color:var(--ink-muted)">Issued ${stamp(a.at)} · applies to ${esc(psEmployee().dept)}</span></div>` : ""}
      ${v === "action" ? `<div style="margin-top:8px;font-size:12.5px;line-height:1.6;border-top:1px solid var(--line);padding-top:8px"><b>Recommended action:</b> ${esc(a.action)}</div>` : ""}
      ${v === "track" ? `<ul class="pi-track">${track.map(([l, d2, x]) => `<li class="${d2 ? "d" : ""}">${icon(d2 ? "check" : "circle")}${esc(l)}${x ? ` <span style="color:var(--ink-muted)">· ${esc(x)}</span>` : ""}</li>`).join("")}</ul>` : ""}
      <div class="acts"><button class="btn ${v === "details" ? "primary" : ""}" data-act="pi-fd" data-id="${esc(p.id)}" data-v="details">View alert details</button>${p.ack.employee || done ? "" : `<button class="btn" data-act="pi-fd-ack" data-id="${esc(p.id)}">${icon("check")} Acknowledge</button>`}<button class="btn ${v === "action" ? "primary" : ""}" data-act="pi-fd" data-id="${esc(p.id)}" data-v="action">View recommended action</button><button class="btn ${v === "track" ? "primary" : ""}" data-act="pi-fd" data-id="${esc(p.id)}" data-v="track">Track investigation</button></div></div>`;
  }).join("")}</div>`;
}
const _pageDigitalFrontDoorPI = pageDigitalFrontDoor;
pageDigitalFrontDoor = function () {
  // The alerts are on their own page ("Alerts for you" in the menu), so they are not repeated here.
  return _pageDigitalFrontDoorPI();
};

/* ------------------------------------------ Control Tower: admin view */
function piTowerSection() {
  piSync();
  const rows = [...PI_DATA.scenarios].sort((a, b) => a.order - b.order).map((s) => piLatest(s.id)).filter(Boolean);
  const k = piKpis();
  return `<div class="card pad" style="margin-top:16px"><div class="sec-head"><p class="sec-title">${icon("trend")} Predictive monitoring</p>${psCanRoute("predictive") ? `<a class="btn" href="#/predictive">${icon("arrow")} Open Predictive Intelligence</a>` : `<a class="btn" href="#/accuracy">${icon("target")} Prediction outcomes</a>`}</div>
  <p style="font-size:12px;color:var(--ink-soft);margin:4px 0 0">${k.active} active prediction(s) · ${k.critical} critical · ${k.alerts} employee alert(s) sent · ${k.mitigated} confirmed mitigated. Predicted risks are not incidents until IT raises or associates one.</p>
  <div class="tbl-wrap" style="margin:10px -20px 0"><table class="t" style="min-width:820px"><thead><tr><th style="padding-left:20px">Prediction</th><th>Service</th><th>Risk</th><th>Status</th><th>ServiceNow incident</th><th>Source</th><th></th></tr></thead><tbody>
  ${rows.map((p) => `<tr class="click" data-act="pi-open" data-id="${esc(p.id)}"><td style="padding-left:20px">${esc(PI_SCEN[p.sid].title)}</td><td>${esc(piTarget(p).short)}</td><td>${p.score != null ? `<b>${p.score}</b> ${piClsBadge(p.cls)}` : "—"}</td><td>${piStBadge(PIL.loops.has(p.id) ? "Analysing" : p.status)}</td><td>${p.incident ? (p.incident.url && WB_SN_URL.test(p.incident.url) ? `<a class="snlink" href="${esc(p.incident.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${esc(p.incident.number)}${icon("external")}</a>` : `<span class="mono" style="font-size:11.5px">${esc(p.incident.incId)}</span> <span class="note-r">synthetic</span>`) : `<span style="color:var(--ink-faint)">None (predicted)</span>`}</td><td>${piModeTag(p.mode)}</td><td><span style="font-size:12px;color:var(--brand)">Details ${icon("arrow")}</span></td></tr>`).join("")}
  </tbody></table></div></div>`;
}
const _wbTowerSectionPI = wbTowerSection;
wbTowerSection = function () { return piTowerSection() + _wbTowerSectionPI(); };

/* ------------------------------------------------------- sidebar badges */
const _renderSidebarPI = renderSidebar;
renderSidebar = function () {
  _renderSidebarPI();
  try {
    piSync();
    const sb = document.getElementById("sidebar");
    const add = (href, txt) => { const a = sb.querySelector(`a.navlink[href="${href}"]`); if (a && txt && !a.querySelector(".badge")) a.insertAdjacentHTML("beforeend", `<span class="badge">${esc(txt)}</span>`); };
    const hi = piActive().filter((p) => ["High", "Critical"].includes(p.cls)).length;
    add("#/predictive", hi ? `${hi} high risk` : "");
    // Employee alert counts live on the notification bell in the top bar, not in the menu.
  } catch (e) { /* badges are decorative */ }
};

/* --------------------------------------------------------------- actions */
function piSyncButtons() {
  const d = UI.pi.draft;
  document.querySelectorAll("[data-need]").forEach((b) => {
    const need = b.dataset.need;
    if (need === "note") { const p = piPred(b.dataset.id); b.disabled = !(p && p.recheck && p.recheck.normal && (d.note || "").trim().length >= 10); }
    else if (need === "dis") b.disabled = (d.dis || "").trim().length < 10;
    else if (need === "assoc") b.disabled = !/^INC\d{7}$/i.test((d.assoc || "").trim()) || !!UI.pi.busy;
  });
}
function piInput(el) {
  const id = el.id; const d = UI.pi.draft;
  if (id === "pi-note") d.note = el.value;
  else if (id === "pi-dis") d.dis = el.value;
  else if (id === "pi-assoc") d.assoc = el.value;
  else if (id.startsWith("pi-w-")) { UI.pi.cfg.weights[id.slice(5)] = el.value; const pv = document.getElementById("pi-w-preview"); if (pv) pv.innerHTML = piWeightPreview(); }
  else if (id === "pi-thr-emp") UI.pi.cfg.employee_alert_threshold = el.value;
  else if (id === "pi-thr-it") UI.pi.cfg.it_alert_threshold = el.value;
  else if (id.startsWith("pi-t-")) {
    const [sid, ...rest] = id.slice(5).split("-"); const which = rest.pop(); const key = rest.join("-");
    const c = UI.pi.cfg.thresholds; c[sid] = c[sid] || {}; const m = [...PI_SCEN[sid].metrics, ...(PI_SCEN[sid].live_signal ? PI_SCEN[sid].live_signal.metrics : [])].find((x) => x.key === key);
    c[sid][key] = c[sid][key] || { warn: m.warn, crit: m.crit }; c[sid][key][which] = el.value;
  }
  piSyncButtons();
}
async function piInvAction(id, assoc) {
  UI.pi.busy = id; UI.pi.err = ""; render();
  const r = await piInvestigate(id, assoc);
  UI.pi.busy = null;
  if (!r.ok) { UI.pi.err = r.error; UI.pi.errFor = id; } else { UI.pi.confirm = null; UI.pi.draft.assoc = ""; }
  render();
}
const PI_ACTIONS = {
  "pi-tab": (el) => { UI.pi.err = ""; if (el.dataset.t !== "settings") UI.pi.cfg = null; location.hash = el.dataset.t === "overview" ? "#/predictive" : `#/predictive/${el.dataset.t}`; },
  "pi-open": (el) => { UI.pi.sel = null; UI.pi.dtab = "risk"; UI.pi.err = ""; location.hash = `#/predictive/p/${encodeURIComponent(el.dataset.id)}`; },
  "pi-run": (el) => { UI.pi.sel = null; UI.pi.dtab = "risk"; UI.pi.err = ""; UI.pi.draft = {}; piRunScenario(el.dataset.s); const p = piLatest(el.dataset.s); if (p) location.hash = `#/predictive/p/${encodeURIComponent(p.id)}`; },
  "pi-cycle": () => { piRunCycle(); },
  "pi-sim": (el) => piSimSet(el.dataset.s, el.dataset.v),
  "pi-sel": (el) => { UI.pi.sel = el.dataset.k; render(); },
  "pi-dtab": (el) => { UI.pi.dtab = el.dataset.t; render(); },
  "pi-ack": (el) => piAck(el.dataset.id),
  "pi-inv-ask": (el) => { UI.pi.confirm = el.dataset.id; UI.pi.err = ""; render(); },
  "pi-inv-cancel": () => { UI.pi.confirm = null; render(); },
  "pi-inv-go": (el) => piInvAction(el.dataset.id),
  "pi-assoc": (el) => piInvAction(el.dataset.id, (UI.pi.draft.assoc || "").trim().toUpperCase()),
  "pi-dismiss": (el) => { piDismiss(el.dataset.id, UI.pi.draft.dis || "", UI.ms.disKind); UI.pi.draft.dis = ""; },
  "pi-recheck": (el) => piRecheck(el.dataset.id),
  "pi-mitigate": (el) => { piConfirmMitigation(el.dataset.id, UI.pi.draft.note || ""); UI.pi.draft.note = ""; },
  "pi-retry": (el) => { const p = piPred(el.dataset.id); if (p && p.failedAt) { const k = p.failedAt; delete p.nodes[k]; piDrive(p, k); } },
  "pi-trends": () => piLoadTrends(true),
  "pi-hist": () => PI_DATA.scenarios.forEach((s) => piLoadHist(s.id, true)),
  "pi-cfg-save": () => piSaveSettings(),
  "pi-cfg-reset": () => { UI.pi.cfg = piDefaultConfig(); PI.config = piDefaultConfig(); UI.pi.err = ""; piAudit("Risk settings restored to defaults by the IT administrator."); piCommit(); },
  "pi-fd": (el) => { UI.pi.fdOpen[el.dataset.id] = UI.pi.fdOpen[el.dataset.id] === el.dataset.v ? "" : el.dataset.v; render(); },
  "pi-drill": () => piDrill(),
  "pi-signal": () => piLoadSignal(true),
  "pi-fd-ack": (el) => { const p = piPred(el.dataset.id); if (p && !p.ack.employee) { p.ack.employee = { at: wbNow() }; piEvent(p, "Employee", "Alert acknowledged on the Digital FrontDoor."); piCommit(); } },
};
</script>
