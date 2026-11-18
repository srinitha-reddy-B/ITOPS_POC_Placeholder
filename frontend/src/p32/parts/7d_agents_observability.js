<style>
.ag-chain{display:flex;flex-wrap:wrap;align-items:stretch;row-gap:14px}
.ag-node{width:150px;border:1px solid var(--line);border-radius:12px;padding:9px 10px;background:var(--surface);text-align:left;font:inherit;color:var(--ink);cursor:pointer;display:flex;flex-direction:column;gap:3px;border-top:3px solid #dededf}
.ag-node.done{border-top-color:#22c55e}.ag-node.running{border-top-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}.ag-node.failed,.ag-node.attention{border-top-color:#e5484d}.ag-node.waiting{border-top-color:#f5b544;box-shadow:0 0 0 3px #fdf3e3}
.ag-node.human{background:#fbfaf7}
.ag-node.sel{outline:2px solid var(--ink);outline-offset:1px}
.ag-node .nm{display:flex;gap:6px;align-items:center;font-size:12px;font-weight:600;line-height:1.25}
.ag-node .nm svg{width:13px;height:13px;flex:none}
.ag-node .mt{font-size:10.5px;color:var(--ink-muted)}
.ag-link{width:58px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:3px;position:relative}
.ag-link .ln{width:100%;height:2px;background:#dededf;position:relative;overflow:hidden}
.ag-link.done .ln{background:#22c55e}.ag-link.live .ln{background:var(--brand-soft)}
.ag-link.live .ln::after{content:"";position:absolute;top:-2px;left:-8px;width:8px;height:6px;border-radius:3px;background:var(--brand);animation:agflow 1.1s linear infinite}
@keyframes agflow{to{left:100%}}
@media (prefers-reduced-motion:reduce){.ag-link.live .ln::after{animation:none;left:45%}}
.ag-link .lb{font-size:9.5px;color:var(--ink-muted);text-align:center;line-height:1.2;max-width:58px}
.ag-io{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}
@media (max-width:900px){.ag-io{grid-template-columns:1fr}}
.tl{list-style:none;margin:0;padding:0 0 0 14px;border-left:2px solid var(--line)}
.tl li{position:relative;padding:6px 0 8px 10px;font-size:12.5px}
.tl li::before{content:"";position:absolute;left:-21px;top:10px;width:10px;height:10px;border-radius:50%;background:var(--ink-faint);border:2px solid var(--surface)}
.tl li.ok::before{background:#22c55e}.tl li.warn::before{background:#f5b544}.tl li.bad::before{background:#e5484d}.tl li.human::before{background:var(--brand)}
.tl .when{font-size:11px;color:var(--ink-muted)}
.tl-stage{font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-muted);margin:12px 0 4px}
.wn{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-top:8px}
.wn pre{white-space:pre-wrap;font:12px/1.55 var(--mono);margin:6px 0 0;color:var(--ink-soft)}
</style>
<script>
"use strict";
/* =====================================================================
   Agent execution view, observability dashboard, and the incident
   Timeline and ServiceNow work-notes tabs. All read the existing run
   records; none of them changes how the pipeline executes.
   ===================================================================== */
UI.ag = UI.ag || { inc: null, sel: null };
UI.obs = UI.obs || { sid: "claims" };
const AG_HANDOFF = {
  intake: "summary, symptoms", triage: "priority, team, CI", evidence: "evidence items", hypothesis: "2-3 hypotheses", critic: "verdicts", judge: "selected cause, confidence",
  rca: "RCA draft", quality: "RCA + 9 checks", approval: "approved RCA", sop: "SOP steps", sop_approval: "approved SOP", execution: "execution record", verification: "verified result",
  a_intake: "device, issue", a_context: "asset record, health", a_decision: "recommendation", a_approval: "approved order", a_fulfil: "requests", a_verify: "checks",
  h_intake: "request, dates", h_policy: "answer, eligibility", h_plan: "tasks", h_approval: "approved plan", h_fulfil: "requests", h_verify: "checks",
};
const agMs = (n) => (n ? (n.ms != null ? n.ms : n.ended && n.started ? Date.parse(n.ended) - Date.parse(n.started) : null) : null);
function agRuns() { return Object.values(WB.runs).filter((r) => wbInc(r.incId)).sort((a, b) => Date.parse(b.updated || 0) - Date.parse(a.updated || 0)); }
function agKeys(run) { return WB_FLOWS[run.flow || "incident"].stages.flatMap((s) => s.nodes); }
function agNodeState(run, k) {
  const n = run.nodes[k];
  if (run.gate && run.gate.node === k) return run.status === "waiting" ? "waiting" : "attention";
  return n ? n.status : "pending";
}

// ------------------------------------------------------- agent execution page
function pageAgentExecution() {
  const runs = agRuns();
  const fromRoute = decodeURIComponent(route().split("/")[1] || "");
  if (fromRoute && WB.runs[fromRoute]) UI.ag.inc = fromRoute;
  if (!UI.ag.inc || !WB.runs[UI.ag.inc]) UI.ag.inc = runs[0] ? runs[0].incId : null;
  const hd = head("Agent execution", "How the agents work an incident: one agent at a time, in a fixed order, each one's output becoming the next one's input, with human approval gates in between.", "Sequential multi-agent pipeline", wbModePill());
  if (!UI.ag.inc) return `${hd}<div class="card pad"><p class="sec-title">${icon("info")} No agent runs yet</p><p style="font-size:12.5px;color:var(--ink-soft);margin:6px 0 0">Start an incident in the Incident Workbench, report one on the Digital FrontDoor, or raise an investigation from a prediction. Every run appears here.</p>${psCanRoute("workbench") ? `<a class="btn" style="margin-top:10px" href="#/workbench">${icon("arrow")} Incident Workbench</a>` : ""}</div>`;
  const run = WB.runs[UI.ag.inc]; const inc = wbInc(run.incId); const keys = agKeys(run);
  const cur = run.gate ? run.gate.node : run.current || run.next;
  const sel = UI.ag.sel && keys.includes(UI.ag.sel) && run.nodes[UI.ag.sel] ? UI.ag.sel : cur && run.nodes[cur] ? cur : keys.filter((k) => run.nodes[k]).pop() || keys[0];
  const chain = keys.map((k, i) => {
    const st = agNodeState(run, k); const n = run.nodes[k]; const meta = WB_NODES[k]; const ms = agMs(n);
    const next = keys[i + 1]; const nst = next ? agNodeState(run, next) : null;
    const link = next ? `<div class="ag-link ${st === "done" && ["running", "waiting"].includes(nst) ? "live" : st === "done" && nst !== "pending" ? "done" : ""}" aria-hidden="true"><span class="lb">${esc(AG_HANDOFF[k] || "output")}</span><span class="ln"></span>${icon("arrow")}</div>` : "";
    return `<button class="ag-node ${st} ${meta.kind === "human" ? "human" : ""} ${sel === k ? "sel" : ""}" data-act="ag-sel" data-k="${k}"><span class="nm">${icon(meta.icon)}${esc(meta.short || meta.name)}</span><span class="mt">${meta.kind === "human" ? "Human gate" : n && n.source === "llm" ? `Live LLM${n.model ? ` · ${esc(n.model.replace(/-\d{2}-\d{4}$/, ""))}` : ""}` : n && n.source === "scripted" ? "Scripted" : n ? "Tools / rules" : "Pending"}</span><span class="mt">${badge(st === "done" ? "good" : st === "running" ? "running" : st === "waiting" ? "warning" : ["failed", "attention"].includes(st) ? "critical" : "info", st)}${ms != null ? ` · ${wbDur(ms)}` : ""}${n && n.attempts > 1 ? ` · run ${n.attempts}` : ""}</span></button>${link}`;
  }).join("");
  const n = run.nodes[sel]; const meta = WB_NODES[sel];
  const idx = keys.indexOf(sel); const prev = keys.slice(0, idx).reverse().find((k) => run.nodes[k]); const nxt = keys[idx + 1];
  const detail = n ? `<div class="sec-head"><p class="sec-title">${icon(meta.icon)} ${esc(meta.name)}</p>${badge(agNodeState(run, sel) === "done" ? "good" : "info", agNodeState(run, sel))}</div>
    <p style="font-size:12.5px;color:var(--ink-soft);margin:4px 0 8px">${esc(meta.role)}</p>
    ${wbKv([["Source", n.source === "llm" ? `Live LLM (${n.model || ""})` : n.source === "scripted" ? "Scripted demo output" : n.source === "human" ? "Human decision" : "Tools and rules"], ["Duration", agMs(n) != null ? wbDur(agMs(n)) : "—"], ["Runs of this step", n.attempts || 1], ["LLM attempts (validation retries)", n.llmAttempts || (n.source === "llm" ? 1 : "—")], ["Error", n.error || "None"], ["Decision", n.decision || "—"]])}
    <div class="ag-io" style="margin-top:10px">
      <div>${wbSec(`Input${prev ? ` (from ${esc(WB_NODES[prev].short || WB_NODES[prev].name)})` : ""}`, n.input ? `<pre class="wb-pre" style="max-height:260px;overflow:auto">${esc(JSON.stringify(n.input, null, 2))}</pre>` : `<p style="font-size:12px;color:var(--ink-muted);margin:0">No structured input recorded.</p>`)}</div>
      <div>${wbSec(`Output${nxt ? ` (to ${esc(WB_NODES[nxt].short || WB_NODES[nxt].name)})` : ""}`, n.output ? `<pre class="wb-pre" style="max-height:260px;overflow:auto">${esc(JSON.stringify(n.output, null, 2))}</pre>` : `<p style="font-size:12px;color:var(--ink-muted);margin:0">No output yet.</p>`)}</div>
    </div>
    ${n.tools && n.tools.length ? wbSec("Tools called", wbUl(n.tools.map((t) => `${t.name} [${t.source}] ${t.status}${t.ms != null ? `, ${wbDur(t.ms)}` : ""}: ${t.summary || t.error || ""}`))) : ""}`
    : `<p style="font-size:12.5px;color:var(--ink-muted)">This step hasn't run yet.</p>`;
  return `${hd}
  <div class="card pad"><div class="sec-head"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label for="x-ag-inc" class="note-r">Run</label><select class="sel" id="x-ag-inc" style="height:32px;font-size:12.5px;max-width:520px">${runs.map((r) => { const i = wbInc(r.incId); return `<option value="${esc(r.incId)}" ${r.incId === UI.ag.inc ? "selected" : ""}>${esc(r.incId)} · ${esc((i ? i.title : "").slice(0, 70))} · ${esc(wbStatusOf(i || { id: r.incId }).label)}</option>`; }).join("")}</select></div>
    <span class="note-r">${run.mode === "live" ? ccSrc("live", "Live agents") : ccSrc("demo", "Scripted demo")} · investigation round ${run.round || 1} · RCA draft ${run.rcaAttempt || 0} · remediation round ${run.remRound || 1}${psCanRoute("workbench") ? ` · <a href="#/workbench/${encodeURIComponent(run.incId)}" style="color:var(--brand)">open incident</a>` : ""}</span></div>
    <p style="font-size:13px;font-weight:500;margin:10px 0 2px">${esc(inc.title)}</p>
    <p style="font-size:11.5px;color:var(--ink-muted);margin:0 0 12px">Strictly sequential: a step starts only after the previous one finishes. The label on each link is what is handed over. Loops back (second investigation round, RCA redraft, new remediation round) re-run earlier steps; "run N" shows how often.</p>
    <div class="ag-chain">${chain}</div></div>
  <div class="split" style="margin-top:12px;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)">
    <div class="card pad">${detail}</div>
    <div class="card pad"><div class="sec-head"><p class="sec-title">${icon("history")} Execution events</p><span class="note-r">${run.events.length} event(s)</span></div>${ccActivity([...run.events].reverse().slice(0, 25).map((e) => ({ ...e, result: e.result === "warn" ? "warn" : e.result === "bad" ? "bad" : e.result })))}</div>
  </div>
  ${simnote("Every value comes from the run record. Agent outputs are labelled Live LLM or Scripted; SOP execution is simulated in this POC.")}`;
}

// ------------------------------------------------------- incident tabs
function wbTabTimeline(run, inc) {
  const tri = run && wbOut(run, "triage"); const scen = wbScenario(inc);
  const sn = wbSnRef(inc);
  const sum = wbKv([["Incident", sn && sn.number ? `${sn.number} (ServiceNow)` : `${inc.id} (synthetic)`], ["Short description", inc.title], ["Priority", inc.priority], ["Severity (impact)", inc.impact], ["Affected service", `${inc.service}${inc.ci ? ` · ${inc.ci}` : ""}`], ["Status", wbStatusOf(inc).label], ["Assigned team", (tri && tri.assignment_group) || (scen && scen.evidence && scen.evidence.cmdb ? `${scen.evidence.cmdb.owner_group} (CMDB owner, before triage)` : "Not assigned yet")], ["Current stage", wbStageOf(inc).stage]]);
  if (!run) return `${sum}<p style="font-size:12.5px;color:var(--ink-muted);margin:10px 0 0">The timeline starts when the investigation starts.</p>`;
  const stages = wbStagesFor(run);
  const stageOf = (actor) => { const k = Object.keys(WB_NODES).find((x) => WB_NODES[x].name === actor); if (!k) return null; const i = stages.findIndex((s) => s.nodes.includes(k)); return i < 0 ? null : stages[i].title; };
  let last = null; const items = [];
  run.events.forEach((e) => {
    const st = stageOf(e.actor) || last || "Start";
    if (st !== last) { items.push(`<li class="tl-stage" style="list-style:none;margin-left:-24px;padding-left:0">${esc(st)}</li>`); last = st; }
    const human = /human|Engineer|manager|partner|administrator/i.test(e.actor) || e.type === "approval";
    items.push(`<li class="${human ? "human" : e.result === "ok" ? "ok" : e.result === "warn" ? "warn" : e.result === "bad" ? "bad" : ""}"><b style="font-weight:500">${esc(e.actor)}</b> <span style="color:var(--ink-soft)">${esc(e.text)}</span><div class="when">${stamp(e.at)}</div></li>`);
  });
  return `<div class="grid g2" style="gap:16px;align-items:start"><div>${wbSec("Incident summary", sum)}${wbSec("Approvals", run.approvals.length ? wbUl(run.approvals.map((a) => `${String(a.gate).toUpperCase()}: ${a.decision.replace("_", " ")} by ${a.approver} at ${stamp(a.at)}${a.feedback ? ` ("${a.feedback}")` : ""} · recorded ${a.recorded}`)) : `<p style="font-size:12.5px;margin:0;color:var(--ink-muted)">None yet.</p>`)}</div>
    <div>${wbSec("Timeline", `<ul class="tl">${items.join("")}</ul>`)}</div></div>`;
}
function wbTabNotes(run, inc) {
  if (!run) return `<p style="font-size:12.5px;color:var(--ink-muted)">Start the investigation to see the notes the agents prepare for ServiceNow.</p>`;
  const sn = run.sn && run.sn.number ? run.sn.number : null;
  const posted = (node, re) => { const n = run.nodes[node]; const t = n && n.tools.find((x) => re.test(x.name)); return t ? (t.status === "ok" ? { ok: true, at: t.at } : { ok: false, err: t.error }) : null; };
  const status = (p) => (p ? (p.ok ? `${ccSrc("live", `Posted to ${sn}`)} <span class="note-r">${p.at ? stamp(p.at) : ""}</span>` : `${badge("critical", "Not posted")} <span class="note-r">${esc(p.err || "")}</span>`) : run.mode === "live" && sn ? `${badge("info", "Not posted yet")}` : ccSrc("demo", run.mode === "live" ? "Prepared, not sent: no ServiceNow record" : "Prepared, not sent (Controlled Demo Mode)"));
  const notes = [];
  run.events.filter((e) => e.actor === "ServiceNow Work Notes API").forEach((e) => notes.push({ title: "Progress note", text: e.text, st: e.result === "ok" ? `${ccSrc("live", `Posted to ${sn}`)} <span class="note-r">${stamp(e.at)}</span>` : badge("warning", "Not posted") }));
  if (run.approvals.some((a) => a.gate === "rca" && a.decision === "approve") && wbOut(run, "rca")) notes.push({ title: "Approved root cause analysis", text: wbRcaNote(run), st: status(posted("approval", /Work Notes/)) });
  const ex = wbOut(run, "execution"); const sop = wbOut(run, "sop");
  if (ex && sop) notes.push({ title: "SOP execution record", text: `[AURA Workbench] ${sop.sop_id} v${run.sopVersion} executed: ${ex.executed} step(s) by the execution handler (simulated POC actions), ${ex.manual} completed manually by the engineer, ${ex.retries} retry(ies).`, st: status(posted("execution", /Work Notes/)) });
  if (run.closeNote) notes.push({ title: "Resolution (work note, caller update, close notes)", text: `${run.closeNote.work_note}\n\nCaller update: ${run.closeNote.employee_update}\n\nClose notes: ${run.closeNote.resolution_summary}`, st: run.snResult && run.snResult.written ? `${ccSrc("live", `Resolved in ${sn}`)} <span class="note-r">read back: ${esc(run.snResult.readback.state)}</span>` : ccSrc("demo", run.snResult && run.snResult.reason ? "Prepared, not sent" : "Prepared") });
  const ref = wbSnRef(inc);
  return `<p style="font-size:12.5px;color:var(--ink-soft);margin:0 0 8px">${ref && ref.url ? `ServiceNow record: ${wbLink(inc)}` : "Demo scenario: not linked to a ServiceNow record."}</p>
    ${notes.length ? notes.map((n) => `<div class="wn"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b style="font-size:13px;font-weight:500">${esc(n.title)}</b></div><pre>${esc(n.text)}</pre></div>`).join("") : `<p style="font-size:12.5px;color:var(--ink-muted)">No notes yet. The first one is prepared when the engineer approves the RCA.</p>`}`;
}

// ------------------------------------------------------- observability
function obsSeriesChart(title, sigs, srcTag) {
  if (!sigs.length) return "";
  const m = sigs[0]; const n = m.series.length; const labels = m.series.map((_, i) => `${-(n - 1 - i) * 5}m`);
  return `<div class="card pad pi-chart"><div class="sec-head"><p class="sec-title">${icon("activity")} ${esc(title)}</p>${srcTag}</div>${piLineChart(labels, [...sigs.map((s, i) => ({ name: `${s.name} (${s.unit || "count"})`, color: PI_COLORS[[3, 0, 2][i] || i], values: s.series })), { name: `Warning (${m.name})`, color: "#d08a1e", dash: true, values: m.series.map(() => m.warn) }], { label: title, h: 170 })}</div>`;
}
function pageObservability() {
  const live = wbMode() === "live";
  const sid = PI_SCEN[UI.obs.sid] && MS_DATA.scenarios[UI.obs.sid] && !MS_DATA.scenarios[UI.obs.sid].fixed ? UI.obs.sid : "claims";
  const sigs = msSignals(sid);
  const pick = (re) => sigs.filter((x) => re.test(`${x.key} ${x.name}`));
  const err = pick(/err|5xx|fail|timeout/i).slice(0, 2); const lat = pick(/latency|_rt|time|p95/i).slice(0, 2);
  let auth; let authTag;
  if (live && PI.live.sso && PI.live.sso.metrics && PI.live.sso.metrics.login_failures && PI.live.sso.metrics.login_failures.series) { const r = piReadings("sso").find((x) => x.key === "sn_login_failures"); auth = r && r.series ? [{ ...r, name: "Failed sign-ins (60-min window)", unit: "" }] : []; authTag = ccSrc("live", "Live ServiceNow"); }
  else { auth = msSignals("sso").filter((x) => x.key === "login_failures"); authTag = ccSrc("demo", "Simulated"); }
  const runs = Object.values(WB.runs);
  const agg = {};
  runs.forEach((r) => Object.entries(r.nodes).forEach(([k, n]) => { if (!WB_NODES[k] || WB_NODES[k].kind === "human") return; const a = (agg[k] = agg[k] || { k, runs: 0, failed: 0, llm: 0, ms: [] }); a.runs++; if (n.status === "failed" || n.error) a.failed++; if (n.source === "llm") a.llm++; const ms = agMs(n); if (ms != null && n.status === "done") a.ms.push(ms); }));
  const agents = Object.values(agg).sort((a, b) => Object.keys(WB_NODES).indexOf(a.k) - Object.keys(WB_NODES).indexOf(b.k));
  const avg = (a) => (a.ms.length ? a.ms.reduce((x, y) => x + y, 0) / a.ms.length : 0);
  const done = runs.filter((r) => r.status === "completed" && r.started && r.ended);
  const ba = done.map((r) => { const t = r.nodes.verification && r.nodes.verification.tools.find((x) => /health check/i.test(x.name) && x.result); return t ? { id: r.incId, ...t.result } : null; }).filter(Boolean);
  const tr = live && PI.trends && !PI.trends.error && PI.trends.total ? PI.trends : null;
  const rnd = piRng("trend-demo"); const synthTotal = Array.from({ length: 12 }, () => 28 + Math.round(rnd() * 22));
  const nodes = MS_DATA.graph.nodes.map((n) => ({ n, h: msNodeHealth(n.id) }));
  return `${head("Observability", "Error rates, latency, authentication failures, service health, incident frequency, agent execution history, investigation duration and before-and-after remediation results.", "AIOps", wbModePill())}
  <div class="ms-chips">${[...PI_DATA.scenarios].filter((s) => !MS_DATA.scenarios[s.id].fixed).sort((a, b) => a.order - b.order).map((s) => `<button class="ms-chip ${s.id === sid ? "on" : ""}" data-act="obs-sid" data-s="${s.id}"><span class="ms-dot ${msScenarioHealth(s.id)}"></span>${esc(s.short)}</button>`).join("")}</div>
  <div class="pi-charts" style="margin-top:0">
    ${obsSeriesChart(`Error rate trend · ${PI_SCEN[sid].short}`, err, ccSrc("demo", "Simulated"))}
    ${obsSeriesChart(`API latency · ${PI_SCEN[sid].short}`, lat, ccSrc("demo", "Simulated"))}
    ${obsSeriesChart("Authentication failures · Workforce SSO", auth, authTag)}
    <div class="card pad pi-chart"><div class="sec-head"><p class="sec-title">${icon("barchart")} Incident frequency (per week)</p>${tr ? ccSrc("live", "Live ServiceNow") : ccSrc("demo", "Synthetic")}</div>${piLineChart(piWeekLabels(), [{ name: "Incidents per week", color: PI_COLORS[0], values: tr ? tr.total : synthTotal }], { label: "Incident frequency", h: 170, note: tr ? `${tr.scanned} incidents scanned` : live ? "Open Predictive Intelligence → Overview to load live data" : "Synthetic series" })}</div>
  </div>
  <div class="card pad" style="margin-top:12px"><div class="sec-head"><p class="sec-title">${icon("network")} Service health</p>${ccSrc("demo", "Simulated telemetry")}</div><div class="cc-svc" style="margin-top:10px">${nodes.map(({ n, h }) => `<div>${ccHealthDot(h, true)}<b>${esc(n.label)}</b><span class="note-r" style="margin-left:auto">${esc(ccHealthLabel(h))}</span></div>`).join("")}</div></div>
  <div class="pi-charts">
    <div class="card pad pi-chart"><div class="sec-head"><p class="sec-title">${icon("bot")} Agent execution history</p>${ccSrc("live", "Actual runs (this browser)")}</div>${agents.length ? `${piBarChart(agents.map((a) => (WB_NODES[a.k].short || a.k).slice(0, 10)), [{ name: "Average duration (s)", color: PI_COLORS[0], values: agents.map((a) => Math.round(avg(a) / 100) / 10) }], { label: "Agent duration", h: 170 })}<div class="tbl-wrap" style="margin-top:8px"><table class="t" style="min-width:460px"><thead><tr><th>Agent</th><th>Runs</th><th>Live LLM</th><th>Failed</th><th>Avg time</th></tr></thead><tbody>${agents.map((a) => `<tr><td>${esc(WB_NODES[a.k].name)}</td><td>${a.runs}</td><td>${a.llm}</td><td>${a.failed}</td><td>${a.ms.length ? wbDur(avg(a)) : "—"}</td></tr>`).join("")}</tbody></table></div>` : `<p style="font-size:12.5px;color:var(--ink-muted)">No agent runs yet.</p>`}</div>
    <div class="card pad pi-chart"><div class="sec-head"><p class="sec-title">${icon("clock")} Investigation duration</p>${ccSrc("live", "Actual runs (this browser)")}</div>${done.length ? piBarChart(done.slice(-10).map((r) => r.incId.replace(/^DEMO-/, "")), [{ name: "Minutes from start to closure", color: PI_COLORS[1], values: done.slice(-10).map((r) => Math.round((Date.parse(r.ended) - Date.parse(r.started)) / 6000) / 10) }], { label: "Investigation duration", h: 170, note: "Includes time waiting at human gates" }) : `<p style="font-size:12.5px;color:var(--ink-muted)">No closed investigations yet.</p>`}</div>
  </div>
  <div class="card pad" style="margin-top:12px"><div class="sec-head"><p class="sec-title">${icon("shield")} Before and after remediation</p>${ccSrc("demo", "Simulated health checks")}</div>
    ${ba.length ? `<div class="tbl-wrap" style="margin-top:8px"><table class="t" style="min-width:620px"><thead><tr><th>Incident</th><th>Metric</th><th>Before</th><th>After</th><th>Threshold</th><th>Result</th></tr></thead><tbody>${ba.map((x) => `<tr><td class="mono" style="font-size:11.5px">${esc(x.id)}</td><td>${esc(x.metric)}</td><td>${x.before} ${esc(x.unit)}</td><td><b>${x.after} ${esc(x.unit)}</b></td><td>${x.better === "higher" ? "≥" : "≤"} ${x.threshold}</td><td>${x.meets_threshold ? badge("good", "Within threshold") : badge("critical", "Still outside")}</td></tr>`).join("")}</tbody></table></div>` : `<p style="font-size:12.5px;color:var(--ink-muted);margin:8px 0 0">No verified remediations yet. They appear here once an incident passes verification.</p>`}</div>
  ${simnote("Telemetry trends are simulated (multi-signal demo data), except the SSO sign-in signal and the incident frequency, which are live in Live Agent Mode. Agent history and investigation durations are actual runs in this browser; before-and-after values come from the Verification Agent's simulated health check.")}`;
}
function xChange(t) {
  if (t.id === "x-ag-inc") { UI.ag.inc = t.value; UI.ag.sel = null; location.hash = `#/agent-execution/${encodeURIComponent(t.value)}`; }
}
const AG_ACTIONS = {
  "ag-sel": (el) => { UI.ag.sel = el.dataset.k; render(); },
  "obs-sid": (el) => { UI.obs.sid = el.dataset.s; render(); },
};
</script>
