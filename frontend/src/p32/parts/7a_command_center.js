<style>
.cc-grid{display:grid;gap:12px}
.cc-kpis{grid-template-columns:repeat(6,minmax(0,1fr))}
@media (max-width:1250px){.cc-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:700px){.cc-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
.cc-kpi{padding:14px 16px;display:flex;flex-direction:column;gap:6px;border-top:3px solid var(--line)}
.cc-kpi .lbl{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--ink-muted);font-weight:500}
.cc-kpi .lbl svg{width:14px;height:14px}
.cc-kpi .v{font-size:28px;font-weight:600;letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums}
.cc-kpi .s{font-size:11.5px;color:var(--ink-soft)}
.cc-kpi.t-crit{border-top-color:#e5484d}.cc-kpi.t-warn{border-top-color:#f5b544}.cc-kpi.t-ok{border-top-color:#22c55e}.cc-kpi.t-brand{border-top-color:var(--brand)}
.cc-row{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:12px;margin-top:12px}
@media (max-width:1100px){.cc-row{grid-template-columns:1fr}}
.cc-inc{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;padding:10px 0;border-bottom:1px solid var(--line);cursor:pointer}
.cc-inc:last-child{border-bottom:0}
.cc-inc:hover{background:var(--hover)}
.cc-inc .t{font-size:13px;font-weight:500;line-height:1.35}
.cc-inc .m{font-size:11.5px;color:var(--ink-muted);display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center}
.cc-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#22c55e;flex:none}
.cc-dot.warning,.cc-dot.degraded{background:#f5b544}.cc-dot.critical{background:#e5484d}.cc-dot.impacted{background:#a78bfa}.cc-dot.unknown{background:#c4c4cc}
.cc-dot.pulse{box-shadow:0 0 0 0 rgba(229,72,77,.5);animation:ccpulse 1.6s infinite}
@keyframes ccpulse{0%{box-shadow:0 0 0 0 rgba(229,72,77,.45)}70%{box-shadow:0 0 0 7px rgba(229,72,77,0)}100%{box-shadow:0 0 0 0 rgba(229,72,77,0)}}
@media (prefers-reduced-motion:reduce){.cc-dot.pulse{animation:none}}
.cc-svc{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}
.cc-svc>div{border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:12px;display:flex;gap:8px;align-items:center;min-width:0}
.cc-svc b{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cc-int{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--line);font-size:12.5px}
.cc-int:last-child{border-bottom:0}
.cc-int .d{font-size:11.5px;color:var(--ink-muted)}
.cc-act{list-style:none;margin:0;padding:0;position:relative}
.cc-act li{display:grid;grid-template-columns:14px minmax(0,1fr) auto;gap:8px;padding:6px 0;font-size:12.5px;align-items:start}
.cc-act li .dt{width:8px;height:8px;border-radius:50%;margin-top:5px;background:var(--ink-faint)}
.cc-act li .dt.ok{background:#22c55e}.cc-act li .dt.warn{background:#f5b544}.cc-act li .dt.bad{background:#e5484d}.cc-act li .dt.info{background:var(--brand)}
.cc-act li .w{color:var(--ink-muted);font-size:11px;white-space:nowrap}
.cc-ev{border:1px solid var(--line);border-radius:10px;margin-top:8px;background:var(--surface)}
.cc-ev>summary{list-style:none;cursor:pointer;padding:9px 12px;display:flex;gap:8px;align-items:center;font-size:12.5px}
.cc-ev>summary::-webkit-details-marker{display:none}
.cc-ev>summary .chev{margin-left:auto;transition:transform .2s;color:var(--ink-muted)}
.cc-ev[open]>summary .chev{transform:rotate(180deg)}
.cc-ev .body{padding:0 12px 10px;font-size:12.5px;line-height:1.55;color:var(--ink-soft)}
.cc-src{font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;border-radius:5px;padding:1px 6px;white-space:nowrap}
.cc-src.live{background:#e8f6ec;color:#15803d}.cc-src.demo{background:#fff4dc;color:#8a5a00}.cc-src.calc{background:var(--brand-soft);color:var(--brand)}
</style>
<script>
"use strict";
/* =====================================================================
   ITOps Command Center (operational dashboard) and the small reusable
   components the command-center pages share. Every figure comes from
   this browser's workbench runs, predictions and connection status, or
   from the labelled synthetic datasets. Nothing here calls a backend
   that the existing pages don't already call.
   ===================================================================== */
// ------------------------------------------------- reusable components
const ccSrc = (kind, text) => `<span class="cc-src ${kind}">${esc(text || { live: "Live", demo: "Demo / simulated", calc: "Calculated" }[kind])}</span>`;
function ccMetricCard(ic, label, value, sub, tone) {
  return `<div class="card cc-kpi ${tone ? `t-${tone}` : ""}"><span class="lbl">${icon(ic)}${esc(label)}</span><span class="v">${value}</span><span class="s">${sub}</span></div>`;
}
function ccHealthDot(state, pulse) { return `<span class="cc-dot ${esc(state)} ${pulse && state === "critical" ? "pulse" : ""}" aria-hidden="true"></span>`; }
const ccHealthLabel = (s) => ({ normal: "Healthy", healthy: "Healthy", warning: "Degraded", degraded: "Degraded", critical: "Critical", impacted: "Impacted upstream", unknown: "No telemetry" }[s] || s);
function ccIncidentCard(inc, opts = {}) {
  const st = wbStatusOf(inc); const sg = wbStageOf(inc); const pri = String(inc.priority);
  const pk = pri.startsWith("1") ? "critical" : pri.startsWith("2") ? "serious" : pri.startsWith("3") ? "warning" : "info";
  return `<div class="cc-inc" ${psCanRoute("workbench") ? `data-act="wb-open" data-id="${esc(inc.id)}"` : ""}>
    <div style="min-width:0"><div class="t">${esc(inc.title)}</div>
      <div class="m">${wbLink(inc)}<span>${esc(inc.service)}</span><span>${esc(sg.stage)}${sg.agent && sg.agent !== "—" ? ` · ${esc(sg.agent)}` : ""}</span>${opts.age !== false ? `<span>${rel(wbReportedAt(inc))}</span>` : ""}</div></div>
    <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">${badge(pk, pri)}${badge(st.kind, st.label)}</div></div>`;
}
function ccActivity(items) {
  if (!items.length) return `<p style="font-size:12.5px;color:var(--ink-muted);margin:8px 0 0">No activity yet in this browser.</p>`;
  return `<ul class="cc-act">${items.map((e) => `<li><span class="dt ${esc(e.result || "info")}"></span><div><b style="font-weight:500">${esc(e.actor)}</b> <span style="color:var(--ink-soft)">${esc(e.text)}</span>${e.ref ? ` <span class="wb-chip">${esc(e.ref)}</span>` : ""}</div><span class="w">${rel(e.at)}</span></li>`).join("")}</ul>`;
}
function ccEvidence(title, body, opts = {}) {
  return `<details class="cc-ev" ${opts.open ? "open" : ""}><summary>${opts.icon ? icon(opts.icon) : ""}<span>${title}</span>${opts.tag || ""}<span class="chev">${icon("chevdown")}</span></summary><div class="body">${body}</div></details>`;
}

// ------------------------------------------------------------- data
function ccIncidents() { return WB_DATA.use_cases.flatMap((u) => wbIncidentsFor(u.id)); }
function ccOpen(list) { return list.filter((i) => !["completed", "linked"].includes((WB.runs[i.id] || {}).status)); }
function ccRecentActivity(n) {
  const out = [];
  Object.values(WB.runs).forEach((r) => (r.events || []).forEach((e) => out.push({ ...e, ref: r.incId })));
  PI.preds.forEach((p) => (p.events || []).forEach((e) => out.push({ at: e.at, actor: e.actor, text: e.text, result: e.result === "bad" ? "bad" : e.result, ref: p.id })));
  return out.filter((e) => e.at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, n);
}
function ccIntegrations() {
  const s = WBL.status; const live = wbMode() === "live";
  const sig = PI.live && PI.live.sso;
  return [
    { name: "AURA backend API", state: WBL.available ? "normal" : WBL.checked ? "critical" : "unknown", detail: WBL.available ? "Reachable through the frontend proxy" : WBL.checked ? (WBL.reason || "Not reachable") : "Checking…" },
    { name: "LLM (agents)", state: s && s.llm && s.llm.configured ? "normal" : "unknown", detail: s && s.llm && s.llm.configured ? `${s.llm.provider} ${s.llm.model}${live ? "" : " · not used in Controlled Demo Mode"}` : "Not configured or not checked" },
    { name: "ServiceNow", state: s && s.servicenow && s.servicenow.configured ? "normal" : "unknown", detail: s && s.servicenow && s.servicenow.configured ? `${s.servicenow.instance.replace(/^https:\/\//, "")}${live ? "" : " · not called in Controlled Demo Mode"}` : (s && s.servicenow && s.servicenow.reason) || "Not configured or not checked" },
    { name: "SSO sign-in signal", state: live && sig && !sig.error ? "normal" : live && sig && sig.error ? "critical" : "unknown", detail: live ? (sig ? (sig.error ? `Error: ${sig.error}` : `Live ServiceNow sign-in events, read ${rel(sig.at)}`) : "Not read yet") : "Simulated in Controlled Demo Mode" },
    { name: "Monitoring platform", state: s && s.dynatrace && s.dynatrace.configured ? "normal" : "unknown", detail: s && s.dynatrace && s.dynatrace.configured ? `Dynatrace ${s.dynatrace.environment}` : "No monitoring connector: service telemetry is simulated" },
  ];
}

// ------------------------------------------------------------- page
function pageCommandCenter() {
  piSync();
  const all = ccIncidents(); const open = ccOpen(all);
  const runs = Object.values(WB.runs);
  const crit = open.filter((i) => /^[12]/.test(i.priority));
  const preds = piActive();
  const running = runs.filter((r) => r.status === "running").length + PIL.loops.size;
  const gates = runs.filter((r) => r.status === "waiting").length;
  const resolved = runs.filter((r) => r.status === "completed").length;
  const nodes = MS_DATA.graph.nodes.map((n) => ({ n, h: msNodeHealth(n.id) }));
  const bad = nodes.filter((x) => ["critical", "warning"].includes(x.h)).length;
  const active = runs.filter((r) => ["running", "waiting", "attention", "paused", "failed"].includes(r.status)).sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
  const live = wbMode() === "live";
  const order = (i) => (WB.runs[i.id] && ["running", "waiting", "attention", "failed"].includes(WB.runs[i.id].status) ? 0 : 1) * 10 + Number(String(i.priority)[0] || 9);
  const topOpen = [...open].sort((a, b) => order(a) - order(b) || Date.parse(wbReportedAt(b)) - Date.parse(wbReportedAt(a))).slice(0, 7);
  const days = piDays(14);
  const perDay = (type) => days.map((d) => PI.ledger.filter((e) => e.type === type && e.at.slice(0, 10) === d).length);
  const ucs = WB_DATA.use_cases;
  return `${head("ITOps Command Center", "Operational overview: open incidents, predicted disruptions, what the agents are doing right now, service health and integration status.", "AIOps", wbModePill())}
  <div class="pi-src"><span>${icon("info")} Incidents: <b>workbench records in this browser</b> (synthetic demo incidents; live ones link to ServiceNow)</span><span>Service health: <b>simulated telemetry</b>${live ? " (SSO sign-ins live)" : ""}</span><span>Agent status: <b>actual runs</b></span></div>
  <div class="cc-grid cc-kpis">
    ${ccMetricCard("siren", "Open incidents", open.length, `${all.length} tracked across ${ucs.length} use cases`, "brand")}
    ${ccMetricCard("alert", "Critical + high", crit.length, `${open.filter((i) => i.priority.startsWith("1")).length} priority 1 · ${open.filter((i) => i.priority.startsWith("2")).length} priority 2`, crit.length ? "crit" : "ok")}
    ${ccMetricCard("trend", "Predicted disruptions", preds.length, `${preds.filter((p) => ["High", "Critical"].includes(p.cls)).length} high or critical risk`, preds.some((p) => p.cls === "Critical") ? "crit" : preds.length ? "warn" : "ok")}
    ${ccMetricCard("bot", "Agents working", running, `${gates} waiting at a human gate`, running ? "brand" : "")}
    ${ccMetricCard("check", "Resolved", resolved, "Verified and closed in this browser", "ok")}
    ${ccMetricCard("activity", "Service health", `${nodes.length - bad}/${nodes.length}`, bad ? `${bad} service(s) degraded or critical` : "All services healthy", bad ? "warn" : "ok")}
  </div>
  <div class="cc-row">
    <div class="card pad"><div class="sec-head"><p class="sec-title">${icon("siren")} Incidents needing attention</p>${psCanRoute("workbench") ? `<a class="btn ghost" href="#/workbench">${icon("arrow")} All incidents</a>` : ""}</div>
      <div style="margin-top:6px">${topOpen.length ? topOpen.map((i) => ccIncidentCard(i)).join("") : `<p style="font-size:12.5px;color:var(--ink-muted)">No open incidents.</p>`}</div></div>
    <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
      <div class="card pad"><div class="sec-head"><p class="sec-title">${icon("bot")} Agent execution status</p>${psCanRoute("agent-execution") ? `<a class="btn ghost" href="#/agent-execution">${icon("arrow")} Open</a>` : ""}</div>
        ${active.length ? active.slice(0, 6).map((r) => { const inc = wbInc(r.incId); const key = r.gate ? r.gate.node : r.current || r.next; const n = WB_NODES[key]; const st = wbStatusOf(inc || { id: r.incId }); return `<div class="cc-int"><div style="min-width:0"><b style="font-weight:500">${esc(r.incId)}</b> <span class="d">${esc(inc ? inc.service : "")}</span><div class="d">${n ? `${esc(n.name)}${n.kind === "human" ? " (human gate)" : ""}` : "Between steps"} · ${r.mode === "live" ? "live agents" : "scripted demo"}</div></div>${badge(st.kind, st.label)}</div>`; }).join("") : `<p style="font-size:12.5px;color:var(--ink-muted);margin:8px 0 0">No agent runs in progress. Start one from the Incident Workbench or the Digital FrontDoor.</p>`}</div>
      <div class="card pad"><div class="sec-head"><p class="sec-title">${icon("trend")} Predictive intelligence alerts</p>${psCanRoute("sso-investigation") ? `<a class="btn ghost" href="#/sso-investigation">${icon("play")} SSO investigation</a>` : ""}</div>
        ${preds.length ? [...preds].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5).map((p) => `<div class="cc-int"><div style="min-width:0">${psCanRoute("predictive") ? `<a href="#/predictive/p/${encodeURIComponent(p.id)}" style="font-weight:500;color:var(--brand)">${esc(PI_SCEN[p.sid].title)}</a>` : `<b style="font-weight:500">${esc(PI_SCEN[p.sid].title)}</b>`}<div class="d">${esc(piTarget(p).service)} · ${esc(p.status)} · ${p.mode === "live" ? "live agents" : "scripted demo"}</div></div><span style="white-space:nowrap"><b>${p.score != null ? p.score : "—"}</b> ${piClsBadge(p.cls)}</span></div>`).join("") : `<p style="font-size:12.5px;color:var(--ink-muted);margin:8px 0 0">No active predictions.</p>`}</div>
    </div>
  </div>
  <div class="card pad" style="margin-top:12px"><div class="sec-head"><p class="sec-title">${icon("network")} Service health</p><span class="note-r">${ccSrc("demo", "Simulated telemetry")} ${psCanRoute("dependency-graph") ? `<a href="#/dependency-graph" style="color:var(--brand);margin-left:8px">Dependency graph ${icon("arrow")}</a>` : ""}</span></div>
    <div class="cc-svc" style="margin-top:10px">${nodes.map(({ n, h }) => `<div title="${esc(ccHealthLabel(h))}">${ccHealthDot(h, true)}<b>${esc(n.label)}</b><span class="note-r" style="margin-left:auto">${esc(ccHealthLabel(h))}</span></div>`).join("")}</div></div>
  <div class="cc-row">
    <div class="card pad"><div class="sec-head"><p class="sec-title">${icon("history")} Recent activity</p><span class="note-r">Agents, engineers and predictions · this browser</span></div>${ccActivity(ccRecentActivity(12))}</div>
    <div class="card pad"><div class="sec-head"><p class="sec-title">${icon("radar")} Integration health</p><span class="note-r">${live ? "Live Agent Mode" : "Controlled Demo Mode"}</span></div>
      ${ccIntegrations().map((x) => `<div class="cc-int"><div style="min-width:0"><div style="display:flex;gap:8px;align-items:center">${ccHealthDot(x.state)}<b style="font-weight:500">${esc(x.name)}</b></div><div class="d" style="margin-left:17px">${esc(x.detail)}</div></div><span class="note-r">${esc({ normal: "OK", critical: "Error", unknown: "—" }[x.state] || x.state)}</span></div>`).join("")}</div>
  </div>
  <div class="pi-charts">
    <div class="card pad pi-chart"><p class="sec-title">${icon("barchart")} Incidents by use case</p>${piBarChart(ucs.map((u) => u.short), [{ name: "Open", color: PI_COLORS[0], values: ucs.map((u) => ccOpen(wbIncidentsFor(u.id)).length) }, { name: "Resolved here", color: PI_COLORS[1], values: ucs.map((u) => wbIncidentsFor(u.id).filter((i) => (WB.runs[i.id] || {}).status === "completed").length) }], { label: "Incidents by use case", note: "Workbench records" })}</div>
    <div class="card pad pi-chart"><p class="sec-title">${icon("trend")} Predictions and incidents (14 days)</p>${piLineChart(days.map((d) => d.slice(5)), [{ name: "Predictions", color: PI_COLORS[0], values: perDay("prediction") }, { name: "Incidents raised", color: PI_COLORS[3], values: perDay("incident") }], { label: "Trend", note: "Includes a synthetic 13-day baseline" })}</div>
  </div>
  ${simnote("Command Center figures are calculated in the browser from the workbench runs, predictions and connection status. Incidents are synthetic demonstration records unless they link to ServiceNow; service health uses simulated telemetry (the SSO sign-in signal is live in Live Agent Mode).")}`;
}
</script>
