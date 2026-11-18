<script>
"use strict";
/* =====================================================================
   Agentic Incident Workbench: orchestrator, agents and state.
   One incident moves through specialised agents. The orchestrator below
   decides the next agent from each agent's actual output (branching on
   validation, duplicates, Judge decisions, the quality gate, approvals,
   execution failures and verification). Nothing is animated as a success
   before it happens.
   - Live Agent Mode: every agent is a real LLM call made by the backend
     (/api/p32/wb/agent); ServiceNow tools are real calls; keys stay on the
     server, which also enforces the approval gates for ServiceNow writes.
   - Controlled Demo Mode: scripted, clearly labelled agent outputs built
     from the synthetic scenario data; no external calls.
   Monitoring/log evidence and SOP execution are simulated in BOTH modes
   (no monitoring connector or remediation tooling is connected) and are
   labelled as such wherever they appear.
   ===================================================================== */
const WB_DATA = __WB_DATA__;
Object.assign(ICON_PATHS, {
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  skip: '<path d="M5 4l10 8-10 8V4z"/><path d="M19 5v14"/>',
  flag: '<path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
});

const WB_STAGES = [
  { title: "Intake validation", nodes: ["intake"] },
  { title: "Triage & assignment", nodes: ["triage"] },
  { title: "Evidence review", nodes: ["evidence"] },
  { title: "AI root cause analysis", nodes: ["hypothesis", "critic", "judge", "rca", "quality"] },
  { title: "Engineer review & approval", nodes: ["approval"] },
  { title: "SOP execution", nodes: ["sop", "sop_approval", "execution"] },
  { title: "Verification", nodes: ["verification"] },
  { title: "Resolution & closure", nodes: ["closure"] },
];
const WB_NODES = {
  intake: { name: "Intake & Validation Agent", short: "Intake", kind: "agent", icon: "inbox", stage: 0, role: "Reads the report, identifies the service and symptoms, checks required fields, looks for duplicates and decides whether there is enough to investigate." },
  triage: { name: "ServiceNow Triage Agent", short: "Triage", kind: "agent", icon: "route", stage: 1, role: "Retrieves the record and recommends category, assignment group, impact, urgency and priority with reasons. Recommends only; never overwrites ServiceNow values." },
  evidence: { name: "Context & Evidence Agent", short: "Evidence", kind: "agent", icon: "search", stage: 2, role: "Gathers historical incidents, knowledge articles, recent changes, CMDB context and monitoring evidence, then correlates them and lists what is missing." },
  hypothesis: { name: "Hypothesis Agent", short: "Hypotheses", kind: "agent", icon: "sparkles", stage: 3, role: "Proposes 2-3 root-cause hypotheses, each with supporting evidence, a confidence and what would confirm or reject it." },
  critic: { name: "Critic Agent", short: "Critic", kind: "agent", icon: "alert", stage: 3, role: "Independently challenges each hypothesis: is the evidence really there, which assumptions are unsupported, what contradicts it, what else could explain it." },
  judge: { name: "Judge Agent", short: "Judge", kind: "agent", icon: "shield", stage: 3, role: "Weighs the hypotheses against the critique, selects the best supported one and decides: approved for RCA (confidence at least 0.7) or back for more evidence. The orchestrator won't accept a hypothesis the Critic hasn't retained: it asks for another round, or an engineer decision after the last round." },
  rca: { name: "RCA Writer Agent", short: "RCA writer", kind: "agent", icon: "file", stage: 3, role: "Writes the structured root cause analysis from the Judge's decision and the evidence, addressing any corrections or engineer feedback." },
  quality: { name: "Quality & Governance Agent", short: "Quality gate", kind: "agent", icon: "check", stage: 3, role: "Runs the nine-check quality gate and a governance review (consistency, plausibility, impact, remediation safety). Sends the RCA back if it fails." },
  approval: { name: "Engineer approval", short: "Approval", kind: "human", icon: "usercheck", stage: 4, role: "Human-in-the-loop gate: an engineer reviews the RCA, evidence and remediation and approves, requests changes or rejects. Nothing proceeds without a decision." },
  sop: { name: "SOP Generation Agent", short: "SOP", kind: "agent", icon: "clipboard", stage: 5, role: "Turns the approved RCA into an incident-specific SOP: preconditions, permissions, ordered steps with expected results, rollback, verification and escalation." },
  sop_approval: { name: "SOP approval", short: "SOP approval", kind: "human", icon: "hand", stage: 5, role: "Second human gate: the engineer confirms the generated SOP is safe to execute before any step runs." },
  execution: { name: "SOP Execution Agent", short: "Execution", kind: "agent", icon: "wrench", stage: 5, role: "Executes the approved steps one at a time through the execution handler (simulated, safe demo actions), records results, and handles failures with retry or manual takeover." },
  verification: { name: "Verification Agent", short: "Verification", kind: "agent", icon: "activity", stage: 6, role: "Compares before and after evidence and checks whether the symptoms persist. SOP completion alone is not accepted as proof of resolution." },
  closure: { name: "Closure Agent", short: "Closure", kind: "agent", icon: "door", stage: 7, role: "Prepares the resolution summary, writes the approved update to ServiceNow when the record exists there, reads it back and closes the run." },
};
const WB_THRESHOLD = 0.7;
const WB_MAX_ROUNDS = 2;
const WB_EMPLOYEE = { name: "Maya Thompson", dept: "Finance", id: "EMP-24817" };

/* ---------------------------------------------------------------- state */
const WB_KEY = "p32-wb-v1";
function wbFresh() { return { mode: "demo", useCase: "CLM", fPri: "", fStatus: "", submitted: [], runs: {}, snowMap: {}, myIds: [], seq: 0, epoch: Date.now() }; }
let WB;
try { WB = JSON.parse(localStorage.getItem(WB_KEY)) || wbFresh(); } catch (e) { WB = wbFresh(); }
if (!WB.epoch) WB = wbFresh();
const WBL = { checked: false, available: false, status: null, reason: "", loops: new Set(), flash: null };
const wbNow = () => new Date().toISOString();
const wbSleep = (ms) => new Promise((r) => setTimeout(r, ms));
function wbSave() { try { localStorage.setItem(WB_KEY, JSON.stringify(WB)); } catch (e) {} }
function wbCommit() { wbSave(); render(); }
Object.values(WB.runs).forEach((r) => {
  if (r.status === "running") {
    r.status = "paused";
    if (r.current && r.nodes[r.current] && r.nodes[r.current].status === "running") { r.nodes[r.current].status = "pending"; r.next = r.current; }
    wbEvent(r, "Orchestrator", "decision", "The page was reloaded during a step, so the run was paused. Resume to continue from that step.", "warn");
  }
});

function wbMode() { return WB.mode === "live" && WBL.available ? "live" : "demo"; }
async function wbCheckLive() {
  if (!/^https?:$/.test(location.protocol)) { WBL.checked = true; WBL.reason = "Opened as a file: Live Agent Mode needs the page to be served by the frontend (cd frontend; npm run dev, then http://localhost:3000/p32) with the backend running."; render(); return; }
  const r = await wbApi("status", null, "GET");
  WBL.checked = true;
  if (r.ok && r.llm && r.llm.configured) {
    WBL.available = true; WBL.status = r; WBL.reason = "";
    wbLoadServer();
  } else {
    WBL.available = false; WBL.status = r.ok ? r : null;
    WBL.reason = r.ok ? "The backend has no LLM configured (COHERE_API_KEY)." : `Backend not reachable: ${r.error || "no response"}`;
  }
  render();
}
async function wbLoadServer() {
  const m = await wbApi("snow-map", null, "GET");
  if (m.ok) { WB.snowMap = m.map || {}; wbSave(); }
  const r = await wbApi("runs", null, "GET");
  if (r.ok) {
    for (const snap of r.runs || []) {
      if (!snap || !snap.incId) continue;
      const mine = WB.runs[snap.incId];
      if (!mine || (snap.id !== mine.id && snap.updated > mine.updated) || (snap.id === mine.id && snap.updated > mine.updated)) {
        if (snap.status === "running") snap.status = "paused";
        WB.runs[snap.incId] = snap;
      }
    }
    wbSave();
  }
  render();
}
async function wbApi(path, body, method = "POST", headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 150000);
  try {
    const resp = await fetch(`/api/p32/wb/${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    try { return await resp.json(); } catch (e) { return { ok: false, kind: "api_error", error: `Backend returned HTTP ${resp.status} without JSON.` }; }
  } catch (e) {
    return { ok: false, kind: e.name === "AbortError" ? "timeout" : "network", error: e.name === "AbortError" ? "The backend did not answer within 150 s." : `Could not reach the backend: ${e.message}` };
  } finally { clearTimeout(timer); }
}
function wbPersist(run) { if (run && run.mode === "live" && WBL.available) wbApi(`runs/${encodeURIComponent(run.id)}`, run, "PUT"); }

/* ------------------------------------------------------------ incidents */
function wbReportedAt(inc) { return inc.reported_at || new Date(WB.epoch - inc.reported_min_ago * 60000).toISOString(); }
function wbIncidentsFor(uc) {
  const subs = WB.submitted.filter((s) => s.use_case === uc);
  const replaced = new Set(subs.map((s) => s.replaces));
  return [...subs, ...WB_DATA.incidents.filter((c) => c.use_case === uc && !replaced.has(c.id))];
}
function wbInc(id) { return WB.submitted.find((s) => s.id === id) || WB_DATA.incidents.find((i) => i.id === id) || null; }
function wbScenario(inc) { return inc && (inc.script ? inc : WB_DATA.incidents.find((i) => i.service === inc.service)) || null; }
function wbUseCase(id) { return WB_DATA.use_cases.find((u) => u.id === id) || WB_DATA.use_cases[0]; }
function wbSnRef(inc) {
  if (!inc) return null;
  if (inc.sn && inc.sn.url) return inc.sn;
  const run = WB.runs[inc.id];
  if (run && run.sn && run.sn.url) return run.sn;
  return WB.snowMap[inc.id] || null;
}
function wbNum(inc) { const s = wbSnRef(inc); return (s && s.number) || inc.id; }
const WB_SN_URL = /^https:\/\/[a-z0-9-]+\.service-now\.com\/[a-z_]+\.do\?sys_id=[0-9a-f]{32}$/;
function wbLink(inc, cls = "") {
  const s = wbSnRef(inc);
  if (s && s.url && WB_SN_URL.test(s.url)) return `<a class="snlink ${cls}" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="Open ${esc(s.number)} in ServiceNow (new tab)" onclick="event.stopPropagation()">${esc(s.number)}${icon("external")}</a>`;
  return `<span class="mono" style="font-size:11.5px" title="Synthetic demo identifier: this record is not in ServiceNow">${esc(inc.id)}</span>`;
}
const WB_STATUS = {
  none: { label: "New", kind: "info" }, ready: { label: "New", kind: "info" }, running: { label: "In progress", kind: "running" },
  paused: { label: "Paused", kind: "warning" }, waiting: { label: "Awaiting approval", kind: "warning" }, attention: { label: "Needs attention", kind: "serious" },
  failed: { label: "Failed stage", kind: "critical" }, completed: { label: "Resolved", kind: "good" }, linked: { label: "Linked as duplicate", kind: "info" },
};
function wbStatusOf(inc) { const r = WB.runs[inc.id]; return WB_STATUS[r ? r.status : "none"]; }
function wbStageOf(inc) {
  const r = WB.runs[inc.id];
  if (!r || r.status === "ready") return { stage: "Not started", agent: "Waiting for Intake Agent" };
  if (r.status === "completed") return { stage: "Closed", agent: "—" };
  if (r.status === "linked") return { stage: "Intake", agent: "—" };
  const key = r.gate && r.gate.node ? r.gate.node : r.next || r.current;
  const n = WB_NODES[key] || WB_NODES.intake;
  return { stage: WB_STAGES[n.stage].title, agent: n.kind === "human" ? `${n.name} (human)` : n.name };
}

/* ------------------------------------------------------------- run core */
function wbNewRun(inc) {
  const run = {
    id: `RUN-${inc.id}-${Date.now().toString(36)}`, incId: inc.id, mode: wbMode(), status: "ready", next: "intake", current: null,
    round: 1, rcaAttempt: 0, sopVersion: 0, remRound: 1, nodes: {}, gate: null, approvals: [], exec: null, evidence: [], feedback: {}, flags: {},
    sn: inc.sn ? { ...inc.sn } : null, events: [], started: null, ended: null, updated: wbNow(), stepMode: false, pauseReq: false, snResult: null, closeNote: "",
  };
  WB.runs[inc.id] = run;
  wbEvent(run, "Orchestrator", "decision", `Run created in ${run.mode === "live" ? "Live Agent Mode" : "Controlled Demo Mode"}.`, "info");
  return run;
}
function wbEvent(run, actor, type, text, result = "ok") { run.events.push({ at: wbNow(), actor, type, text, result }); if (run.events.length > 400) run.events.splice(0, run.events.length - 400); }
function wbNodeStart(run, key) {
  const prev = run.nodes[key];
  const history = prev ? [...(prev.history || []), ...(prev.output ? [{ at: prev.ended, output: prev.output, decision: prev.decision, source: prev.source }] : [])].slice(-3) : [];
  const n = { status: "running", started: wbNow(), ended: null, ms: null, input: null, tools: [], output: null, error: null, kind: null, source: null, model: null, usage: null, attempts: (prev ? prev.attempts : 0) + 1, history, decision: "" };
  run.nodes[key] = n; run.current = key;
  wbEvent(run, WB_NODES[key].name, "agent", n.attempts > 1 ? `Started (run ${n.attempts})` : "Started", "info");
  wbCommit();
  return n;
}
function wbDone(run, key, decision, next) {
  const n = run.nodes[key];
  n.status = "done"; n.ended = wbNow(); n.decision = decision;
  wbEvent(run, WB_NODES[key].name, "result", "Completed", "ok");
  wbEvent(run, "Orchestrator", "decision", decision, "ok");
  run.next = next || null;
}
function wbGate(run, status, gate, decision) {
  run.status = status; run.gate = gate; run.next = null;
  const n = run.nodes[gate.node];
  if (n) { n.status = status === "waiting" ? "waiting" : "attention"; if (decision) n.decision = decision; if (!n.ended && n.status !== "waiting") n.ended = wbNow(); }
  wbEvent(run, "Orchestrator", status === "waiting" ? "approval" : "decision", decision || gate.type, status === "waiting" ? "wait" : "warn");
}
function wbFail(run, key, msg) {
  const n = run.nodes[key];
  n.status = "failed"; n.ended = wbNow(); n.error = n.error || msg || "Stage failed.";
  run.status = "failed"; run.gate = { type: "error", node: key }; run.next = null;
  wbEvent(run, WB_NODES[key].name, "error", n.error, "bad");
  wbEvent(run, "Orchestrator", "decision", `Run stopped at ${WB_NODES[key].name}. Earlier results are kept; retry the failed stage when ready.`, "bad");
}
async function wbPace() { await wbSleep(650); }
/* Demo pacing: each agent stays "running" for a realistic minimum time (live LLM calls count towards it),
   so the eight stages take a few minutes instead of seconds. Human gates wait for the person. */
const WB_DWELL = { intake: 12000, triage: 12000, evidence: 22000, hypothesis: 20000, critic: 16000, judge: 14000, rca: 24000, quality: 14000, sop: 20000, verification: 8000, closure: 14000 };
async function wbDwell(key, t0) { const want = WB_DWELL[key] || 0; const left = want - (performance.now() - (t0 || performance.now())); if (left > 0) await wbSleep(left); }

/* ------------------------------------------------------------- tool call */
async function wbTool(run, key, spec) {
  const node = run.nodes[key];
  const t = { name: spec.name, input: spec.input, source: spec.source, status: "running", at: wbNow(), ms: null, result: null, error: null, summary: "" };
  node.tools.push(t); wbCommit();
  const t0 = performance.now();
  try {
    if (spec.live) {
      const r = await wbApi("tool", { run_id: run.id, tool: spec.live.tool, args: spec.live.args });
      t.ms = r.duration_ms != null ? r.duration_ms : Math.round(performance.now() - t0);
      if (r.ok) { t.status = "ok"; t.result = r.result; } else { t.status = "failed"; t.error = r.error || "Tool call failed."; t.kind = r.kind; }
    } else {
      if (spec.pace) await wbSleep(spec.pace);
      t.result = spec.run(); t.status = "ok"; t.ms = spec.pace ? null : Math.round(performance.now() - t0);
    }
  } catch (e) { t.status = "failed"; t.error = String(e.message || e); }
  if (t.status === "ok" && spec.summarize) { try { t.summary = spec.summarize(t.result); } catch (e) { t.summary = "ok"; } }
  if (t.status !== "ok") t.summary = t.error;
  wbEvent(run, WB_NODES[key].name, "tool", `${t.name} [${t.source}]: ${t.status === "ok" ? t.summary : "failed: " + t.error}`, t.status === "ok" ? "ok" : "bad");
  return t;
}

/* ------------------------------------------------------------ agent call */
async function wbAgent(run, key, context, scripted) {
  const node = run.nodes[key]; const t0 = performance.now();
  node.input = context; wbCommit();
  if (run.mode === "live") {
    const r = await wbApi("agent", { run_id: run.id, agent: key, context, incident: run.incId });
    node.model = r.model || null; node.ms = r.duration_ms != null ? r.duration_ms : null; node.source = "llm";
    if (!r.ok) { node.error = r.error || "Agent call failed."; node.kind = r.kind; return null; }
    node.usage = r.usage; node.llmAttempts = r.attempts; node.output = r.output;
    wbEvent(run, WB_NODES[key].name, "result", `LLM output validated (${r.model}, ${(r.duration_ms / 1000).toFixed(1)} s${r.attempts > 1 ? `, ${r.attempts} attempts` : ""})`, "ok");
    await wbDwell(key, t0);
    return r.output;
  }
  await wbDwell(key, t0);
  node.source = "scripted"; node.output = scripted();
  return node.output;
}

/* ------------------------------------------------------- context helpers */
function wbIncCtx(inc) {
  const o = { id: inc.id, number: wbNum(inc), title: inc.title, description: inc.description, service: inc.service, configuration_item: inc.ci, reported_by: inc.reported_by, reported_at: wbReportedAt(inc), priority: inc.priority, impact: inc.impact, urgency: inc.urgency, category: inc.category, current_assignment_group: inc.group || "(not set)", channel: inc.submitted ? "Digital FrontDoor" : "Curated demo record" };
  const run = WB.runs[inc.id];
  if (run && run.extraInfo) o.additional_details_from_reporter = run.extraInfo;
  return o;
}
const wbWeight = (e) => (/knowledge|historical|ServiceNow incident/i.test(e.source) ? "background" : "direct");
function wbEvItems(run, upToRound = 9) { return run.evidence.filter((e) => e.round <= upToRound).map((e) => ({ id: e.id, weight: wbWeight(e), round: e.round, source: e.source, label: e.label, text: e.text })); }
function wbNewEvidence(run) { return run.round > 1 ? run.evidence.filter((e) => e.round === run.round).map((e) => e.id) : []; }
function wbOut(run, key) { const n = run.nodes[key]; return n && n.output; }
function wbWords(s) { return String(s || "").trim().split(/\s+/).filter(Boolean).length; }
function wbAddEvidence(run, items) {
  for (const it of items) { if (!run.evidence.some((e) => e.id === it.id)) run.evidence.push(it); }
}
function wbMetric(scen) { return scen && scen.evidence.metrics[0]; }
function wbMetricOk(m, v) { return m.better === "higher" ? v >= m.threshold : v <= m.threshold; }

/* ------------------------------------------------------- 1 · intake */
function wbIntakeChecks(inc, run) {
  const words = wbWords(inc.description) + wbWords(run.extraInfo);
  return [
    inc.title && inc.title.length >= 15 ? { label: "Short description", status: "pass", detail: `"${inc.title.slice(0, 80)}${inc.title.length > 80 ? "…" : ""}"` } : { label: "Short description", status: "fail", detail: "Missing or under 15 characters." },
    words >= 12 ? { label: "Description detail", status: "pass", detail: `${words} words of symptoms and context.` } : words >= 4 ? { label: "Description detail", status: "warn", detail: `Only ${words} words. When did it start, who is affected, what changed?` } : { label: "Description detail", status: "fail", detail: `Only ${words} words; nothing to investigate.` },
    inc.service ? { label: "Affected service", status: "pass", detail: inc.service } : { label: "Affected service", status: "fail", detail: "No service selected." },
    inc.reported_by ? { label: "Reporter", status: "pass", detail: inc.reported_by } : { label: "Reporter", status: "fail", detail: "No reporter." },
    inc.impact ? { label: "Impact", status: "pass", detail: inc.impact } : { label: "Impact", status: "warn", detail: "Not given; triage will assess." },
  ];
}
function wbScriptIntake(inc, run, checks, candidates) {
  const scen = wbScenario(inc);
  const sentences = String(inc.description).split(/(?<=\.)\s+/).filter(Boolean);
  const failed = checks.filter((c) => c.status === "fail");
  const dup = inc.submitted ? candidates.find((c) => c.source === "workbench") : null;
  return {
    summary: `${inc.service}: ${inc.title.charAt(0).toLowerCase()}${inc.title.slice(1)}.`,
    service: inc.service,
    symptoms: sentences.slice(0, 3),
    keywords: inc.title.split(/\W+/).filter((w) => w.length > 4).slice(0, 5),
    missing_info: failed.length || checks.some((c) => c.status === "warn" && c.label === "Description detail") ? ["When it started, how many people are affected, and anything that changed recently."] : [],
    possible_duplicate_of: dup ? dup.id : "",
    recommended_priority: inc.priority,
    business_impact: (scen && scen.business_impact) || "Impact to be confirmed by triage.",
    validation: failed.length ? "needs_info" : "pass",
    reasoning: failed.length ? `Failed required checks: ${failed.map((c) => c.label).join(", ")}.` : `Service, symptoms and timing are described clearly enough to investigate${dup ? `; a record on the same service (${dup.id}) may describe the same problem` : ""}.`,
  };
}
async function wbStepIntake(run) {
  const inc = wbInc(run.incId);
  wbNodeStart(run, "intake");
  const checks = wbIntakeChecks(inc, run);
  await wbTool(run, "intake", { name: "Record completeness checks", source: "rules", input: "Required fields on the report", run: () => checks, summarize: (c) => `${c.filter((x) => x.status === "pass").length} of ${c.length} checks pass` });
  const local = wbIncidentsFor(inc.use_case).filter((o) => o.id !== inc.id && o.service === inc.service && !["completed", "linked"].includes((WB.runs[o.id] || {}).status)).map((o) => ({ id: o.id, number: wbNum(o), title: o.title, state: wbStatusOf(o).label, source: "workbench" }));
  await wbTool(run, "intake", { name: "Workbench duplicate search", source: "local", input: `Open records on ${inc.service}`, run: () => local, summarize: (r) => (r.length ? `${r.length} open record(s) on the same service` : "No open record on the same service") });
  let live = [];
  if (run.mode === "live") {
    const t = await wbTool(run, "intake", { name: "ServiceNow historical incident search", source: "live", input: `Keywords from "${inc.title.slice(0, 60)}"`, live: { tool: "sn_similar", args: { text: inc.title } }, summarize: (r) => `${r.records.length} similar record(s) for "${r.query}"` });
    if (t.status === "ok") live = t.result.records.map((x) => ({ ...x, source: "ServiceNow" }));
  }
  const candidates = [...local, ...live].slice(0, 8);
  const ctx = { incident: wbIncCtx(inc), required_field_checks: checks, similar_records: candidates.map((c) => ({ id: c.id, title: c.title, state: c.state, source: c.source })) };
  const out = await wbAgent(run, "intake", ctx, () => wbScriptIntake(inc, run, checks, candidates));
  if (!out) return wbFail(run, "intake");
  const rulesFail = checks.some((c) => c.status === "fail");
  if (out.validation === "needs_info" || rulesFail) {
    const why = rulesFail && out.validation === "pass" ? "The agent passed it, but required-field checks failed" : "The Intake Agent needs more information";
    return wbGate(run, "attention", { type: "intake_info", node: "intake", missing: out.missing_info || [] }, `${why}: asking the reporter for details before investigation.`);
  }
  const dup = out.possible_duplicate_of && candidates.find((c) => c.id === out.possible_duplicate_of || c.number === out.possible_duplicate_of);
  if (dup && !run.flags.dupCleared) return wbGate(run, "attention", { type: "duplicate", node: "intake", candidate: dup }, `Possible duplicate of ${dup.number || dup.id}: flagged for review before triage.`);
  wbDone(run, "intake", "Validation passed: handed to the ServiceNow Triage Agent.", "triage");
}

/* ------------------------------------------------------- 2 · triage */
async function wbStepTriage(run) {
  const inc = wbInc(run.incId);
  const scen = wbScenario(inc);
  wbNodeStart(run, "triage");
  let record = null;
  if (run.mode === "live") {
    if (run.sn && run.sn.number) {
      const t = await wbTool(run, "triage", { name: "ServiceNow incident retrieval", source: "live", input: run.sn.number, live: { tool: "sn_readback", args: {} }, summarize: (r) => `${r.number}: ${r.state}, priority ${r.priority}, group ${r.assignment_group || "(none)"}` });
      if (t.status === "ok") record = t.result;
    } else if (/^DEMO-[A-Z]{3}-\d{3}$/.test(inc.id)) {
      const t = await wbTool(run, "triage", { name: "ServiceNow incident retrieval", source: "live", input: `Tag P32-WB:${inc.id}`, live: { tool: "sn_bind", args: { incident_id: inc.id } }, summarize: (r) => (r.bound ? `Found ${r.number} (${r.state})` : r.reason) });
      if (t.status === "ok" && t.result.bound) { run.sn = { number: t.result.number, url: t.result.url }; record = t.result; }
    }
  } else {
    await wbTool(run, "triage", { name: "ServiceNow incident retrieval", source: "simulated", input: inc.id, run: () => ({ note: "Controlled Demo Mode: synthetic record, no ServiceNow call." }), summarize: () => "Synthetic demo record (no ServiceNow call)" });
  }
  const cmdb = scen ? { ci: inc.ci, ...scen.evidence.cmdb } : null;
  await wbTool(run, "triage", { name: "CMDB lookup", source: "simulated", input: inc.ci, run: () => cmdb, summarize: (r) => (r ? `${r.class}; owner ${r.owner_group}; depends on ${r.depends_on.length} CI(s)` : "No CMDB record") });
  const ctx = { incident: wbIncCtx(inc), intake: wbOut(run, "intake"), assignment_groups: WB_DATA.groups, cmdb_record: cmdb, servicenow_record: record };
  const out = await wbAgent(run, "triage", ctx, () => ({
    category: inc.category, assignment_group: scen.evidence.cmdb.owner_group, group_rationale: `${inc.ci} is owned by ${scen.evidence.cmdb.owner_group} in the CMDB.`,
    affected_service: inc.service, configuration_item: inc.ci, impact: inc.impact, urgency: inc.urgency, priority_recommendation: inc.priority,
    priority_rationale: `Impact ${inc.impact} and urgency ${inc.urgency}: ${scen.business_impact}`, business_impact: scen.business_impact,
    related_records: scen.evidence.history.map((h) => h.id), summary: `${inc.service} incident affecting ${scen.business_impact.charAt(0).toLowerCase()}${scen.business_impact.slice(1)} Route to ${scen.evidence.cmdb.owner_group}.`,
  }));
  if (!out) return wbFail(run, "triage");
  if (run.mode === "live" && out.assignment_group) {
    await wbTool(run, "triage", { name: "ServiceNow assignment group lookup", source: "live", input: out.assignment_group, live: { tool: "sn_group", args: { group: out.assignment_group } }, summarize: (r) => (r.exists_in_servicenow ? "Group exists in ServiceNow" : "Group not found in this ServiceNow instance (POC group list); recommendation kept, not applied") });
  }
  const diff = inc.group && out.assignment_group && inc.group !== out.assignment_group ? ` Recommended group differs from the current ${inc.group}; flagged, not changed.` : "";
  wbDone(run, "triage", `Triage recommendations recorded (existing values not overwritten).${diff} Handed to the Context & Evidence Agent.`, "evidence");
}

/* ----------------------------------------------------- 3 · investigation */
async function wbStepEvidence(run) {
  const inc = wbInc(run.incId);
  const scen = wbScenario(inc);
  const r = run.round;
  wbNodeStart(run, "evidence");
  const ev = scen ? scen.evidence : { logs: [], metrics: [], changes: [], history: [], kb: [], deep: [] };
  const sim = (id, source, text) => ({ id, source, text, label: "Simulated", round: r });
  await wbTool(run, "evidence", {
    name: r === 1 ? "Monitoring & log retrieval" : "Monitoring & log retrieval (deep query)", source: "simulated", input: `${inc.ci}, last 24 h${r > 1 ? "; detailed component logs and config diffs" : ""}`,
    run: () => { const items = [...ev.logs.map((l) => sim(l.id, l.source, `${l.t ? `${l.t} min before report: ` : ""}${l.text}`)), ...ev.metrics.map((m) => sim(m.id, "Monitoring metric", `${m.name}: ${m.before} ${m.unit} (threshold ${m.better === "higher" ? "≥" : "≤"} ${m.threshold} ${m.unit})`))]; if (r > 1) items.push(...ev.deep.map((l) => sim(l.id, l.source, `${l.t ? `${l.t} min before report: ` : ""}${l.text}`))); wbAddEvidence(run, items); return items; },
    summarize: (items) => `${items.length} item(s)${r > 1 && ev.deep.length ? `, including ${ev.deep.length} new from the deep query` : ""}`, pace: run.mode === "demo" ? 3500 : 0,
  });
  await wbTool(run, "evidence", { name: "Historical incident search", source: "simulated", input: inc.service, run: () => { const items = ev.history.map((h) => sim(h.id, "Historical incident (synthetic)", `${h.title}. Resolution: ${h.resolution}`)); wbAddEvidence(run, items); return items; }, summarize: (i) => `${i.length} similar resolved incident(s)` });
  await wbTool(run, "evidence", { name: "Knowledge & runbook search", source: "simulated", input: inc.service, run: () => { const items = ev.kb.map((k) => sim(k.id, "Knowledge article (synthetic)", `${k.title}: ${k.summary}`)); wbAddEvidence(run, items); return items; }, summarize: (i) => `${i.length} article(s)` });
  await wbTool(run, "evidence", { name: "Change record search", source: "simulated", input: `${inc.ci}, last 14 days`, run: () => { const items = ev.changes.map((c) => sim(c.id, "Change record (synthetic)", `${c.title}, ${c.t_hours} h before report: ${c.detail}`)); wbAddEvidence(run, items); return items; }, summarize: (i) => (i.length ? `${i.length} recent change(s)` : "No recent changes") });
  if (run.mode === "live" && r === 1) {
    const q = `${inc.service} ${inc.title}`;
    const t1 = await wbTool(run, "evidence", { name: "ServiceNow historical incident search", source: "live", input: inc.title.slice(0, 60), live: { tool: "sn_similar", args: { text: inc.title } }, summarize: (x) => `${x.records.length} record(s)` });
    if (t1.status === "ok") wbAddEvidence(run, t1.result.records.slice(0, 3).map((x) => ({ id: x.id, source: "ServiceNow incident (live)", text: `${x.title} [${x.state}]`, label: "Live ServiceNow", url: x.url, round: r })));
    const t2 = await wbTool(run, "evidence", { name: "ServiceNow knowledge search", source: "live", input: q.slice(0, 60), live: { tool: "sn_kb", args: { text: q } }, summarize: (x) => `${x.articles.length} article(s)` });
    if (t2.status === "ok") wbAddEvidence(run, t2.result.articles.slice(0, 3).map((x) => ({ id: x.id, source: "ServiceNow knowledge (live)", text: `${x.title} [${x.state}]`, label: "Live ServiceNow", url: x.url, round: r })));
    const t3 = await wbTool(run, "evidence", { name: "ServiceNow change search", source: "live", input: q.slice(0, 60), live: { tool: "sn_changes", args: { text: q } }, summarize: (x) => `${x.changes.length} change(s) in the last 30 days` });
    if (t3.status === "ok") wbAddEvidence(run, t3.result.changes.slice(0, 3).map((x) => ({ id: x.id, source: "ServiceNow change (live)", text: `${x.title} [${x.state}]`, label: "Live ServiceNow", url: x.url, round: r })));
    await wbTool(run, "evidence", { name: "ServiceNow CMDB lookup", source: "live", input: inc.ci, live: { tool: "sn_cmdb", args: { ci: inc.ci } }, summarize: (x) => (x.items.length ? `${x.items.length} CI match(es)` : "CI not in this ServiceNow CMDB (synthetic CI)") });
  }
  const prevJudge = r > 1 ? wbOut(run, "judge") : null;
  const ctx = { incident: wbIncCtx(inc), triage: wbOut(run, "triage"), investigation_round: r, evidence_items: wbEvItems(run), judge_requested_evidence: prevJudge ? prevJudge.evidence_requests : [], critic_requested_investigation: r > 1 && wbOut(run, "critic") ? wbOut(run, "critic").additional_investigation : [] };
  const out = await wbAgent(run, "evidence", ctx, () => {
    const s = scen.script; const more = s.needs_round2 && r === 1;
    const logs = run.evidence.filter((e) => /^L\d/.test(e.id));
    return {
      summary: more ? `Monitoring shows the symptom clearly (${ev.logs.map((l) => l.id).join(", ")}) and a recent change is on record, but there is no component-level evidence yet linking the two.` : `Evidence links the symptom to a specific component and trigger${r > 1 ? ` after the deep query (${ev.deep.map((d) => d.id).join(", ")})` : ""}.`,
      key_findings: logs.map((l) => ({ finding: l.text.replace(/^\d+ min before report: /, ""), sources: [l.id] })).concat(ev.changes.map((c) => ({ finding: `${c.title} preceded the incident by ${c.t_hours} h.`, sources: [c.id] }))),
      timeline: [...ev.changes.map((c) => ({ at: `${c.t_hours} h before`, event: c.title, source: c.id })), ...logs.filter((l) => /min before/.test(l.text)).map((l) => ({ at: l.text.split(":")[0], event: l.text.split(": ").slice(1).join(": ").slice(0, 120), source: l.id }))],
      related_records: [...ev.history.map((h) => h.id), ...ev.kb.map((k) => k.id)],
      gaps: more ? ["No component-level (DEBUG or per-node) logs yet.", "Change record detail is too general to confirm the trigger."] : ["Telemetry is simulated for this POC; no live monitoring connector."],
      sufficiency: more ? "medium" : "high",
    };
  });
  if (!out) return wbFail(run, "evidence");
  wbDone(run, "evidence", `Round ${r} evidence correlated (${run.evidence.length} items, sufficiency ${out.sufficiency}). Handed to the Hypothesis Agent.`, "hypothesis");
}
async function wbStepHypothesis(run) {
  const inc = wbInc(run.incId); const scen = wbScenario(inc);
  wbNodeStart(run, "hypothesis");
  const ctx = { incident: wbIncCtx(inc), evidence_summary: wbOut(run, "evidence"), evidence_items: wbEvItems(run), new_direct_evidence_this_round: wbNewEvidence(run), investigation_round: run.round, previous_critique: run.round > 1 || run.feedback.hypothesis ? wbOut(run, "critic") : null, previous_judge_decision: run.round > 1 ? wbOut(run, "judge") : null, approver_rejection_feedback: run.feedback.hypothesis || "" };
  const out = await wbAgent(run, "hypothesis", ctx, () => {
    const s = scen.script; const r2 = run.round > 1;
    return {
      hypotheses: s.hypotheses.map((h, i) => ({ id: `H${i + 1}`, title: h.title, explanation: h.why, supporting_evidence: i === s.selected && r2 ? [...h.evidence, ...scen.evidence.deep.map((d) => d.id)] : h.evidence, confidence: i === s.selected && r2 ? 0.82 : h.confidence, confidence_reason: i === s.selected && r2 ? "Now supported by component-level evidence from the deep query." : h.evidence.length ? `Based on ${h.evidence.join(", ")}.` : "No direct evidence.", would_confirm: i === s.selected ? "Component-level logs showing the mechanism at the time of failure." : "Evidence of failure in that component during the window.", would_reject: i === s.selected ? "Healthy component metrics during the failure window." : "Normal metrics for that component." })),
      notes: run.feedback.hypothesis ? `Re-ranked after approver feedback: "${run.feedback.hypothesis}"` : r2 ? "Revised using the evidence requested by the Critic and Judge." : "",
    };
  });
  if (!out) return wbFail(run, "hypothesis");
  wbDone(run, "hypothesis", `${out.hypotheses.length} hypotheses proposed; handed to the Critic Agent for an independent challenge.`, "critic");
}
async function wbStepCritic(run) {
  const inc = wbInc(run.incId); const scen = wbScenario(inc);
  wbNodeStart(run, "critic");
  const ctx = { incident: wbIncCtx(inc), hypotheses: wbOut(run, "hypothesis").hypotheses, evidence_items: wbEvItems(run), new_direct_evidence_this_round: wbNewEvidence(run), investigation_round: run.round };
  const out = await wbAgent(run, "critic", ctx, () => {
    const s = scen.script; const r2 = run.round > 1;
    return {
      assessments: s.hypotheses.map((h, i) => {
        const sel = i === s.selected;
        const verdict = sel ? (s.needs_round2 && !r2 ? "needs_evidence" : "retain") : "reject";
        return { hypothesis_id: `H${i + 1}`, verdict, evidence_really_supports: sel && (!s.needs_round2 || r2), unsupported_assumptions: verdict === "retain" ? [] : [s.critic[i]], contradictions: sel ? [] : [s.critic[i]], alternative_explanations: [], comment: sel && r2 ? `Earlier objection answered: ${scen.evidence.deep.map((d) => `${d.id} (${d.source})`).join(", ")} show the mechanism directly.` : s.critic[i] };
      }),
      additional_investigation: s.needs_round2 && !r2 ? ["Pull component-level logs and configuration diff for the failure window.", "Confirm the mechanism on the suspected component, not just the symptom."] : [],
      overall: s.needs_round2 && !r2 ? "The leading hypothesis is plausible but rests on timing, not direct evidence." : "The leading hypothesis is now directly supported; the alternatives are contradicted.",
    };
  });
  if (!out) return wbFail(run, "critic");
  const keep = out.assessments.filter((a) => a.verdict === "retain").length; const need = out.assessments.filter((a) => a.verdict === "needs_evidence").length;
  wbDone(run, "critic", `Critique complete: ${keep} retained, ${need} need more evidence, ${out.assessments.length - keep - need} rejected. Handed to the Judge Agent.`, "judge");
}
async function wbStepJudge(run) {
  const inc = wbInc(run.incId); const scen = wbScenario(inc);
  wbNodeStart(run, "judge");
  const ctx = { incident: wbIncCtx(inc), hypotheses: wbOut(run, "hypothesis").hypotheses, critique: wbOut(run, "critic"), evidence_ids: run.evidence.map((e) => e.id), investigation_round: run.round, rounds_remaining: WB_MAX_ROUNDS - run.round, confidence_threshold: WB_THRESHOLD };
  const out = await wbAgent(run, "judge", ctx, () => {
    const s = scen.script; const more = s.needs_round2 && run.round === 1; const h = s.hypotheses[s.selected];
    return more
      ? { selected_hypothesis_id: `H${s.selected + 1}`, selected_title: h.title, decision: "further_investigation", confidence: 0.55, rationale: "Leading hypothesis fits the timing, but the Critic is right that no component-level evidence shows the mechanism yet.", supporting_evidence: h.evidence, evidence_requests: ["Component-level logs for the failure window", "Exact configuration or code diff of the related change"] }
      : { selected_hypothesis_id: `H${s.selected + 1}`, selected_title: h.title, decision: "approved_for_rca", confidence: run.round > 1 ? 0.84 : 0.88, rationale: `Direct evidence supports ${h.title.toLowerCase()}; the Critic's objections to the alternatives stand.`, supporting_evidence: [...h.evidence, ...(run.round > 1 ? scen.evidence.deep.map((d) => d.id) : [])], evidence_requests: [] };
  });
  if (!out) return wbFail(run, "judge");
  const conf = Number(out.confidence) || 0;
  // Governance rule (deterministic): while an investigation round remains, the Judge can't approve a
  // hypothesis the Critic has not retained; the Critic's open objections send the case back for evidence.
  const crit = (wbOut(run, "critic").assessments || []).find((a) => String(a.hypothesis_id).trim() === String(out.selected_hypothesis_id).trim());
  const openObjection = crit && crit.verdict !== "retain";
  const pass = out.decision === "approved_for_rca" && conf >= WB_THRESHOLD && !openObjection;
  run.judged = { id: out.selected_hypothesis_id, title: out.selected_title, confidence: conf };
  if (pass) return wbDone(run, "judge", `Approved for RCA: ${out.selected_title} (confidence ${conf.toFixed(2)} ≥ ${WB_THRESHOLD}). Handed to the RCA Writer Agent.`, "rca");
  const reason = out.decision === "approved_for_rca" && openObjection ? `The Judge approved ${out.selected_hypothesis_id}, but the Critic's verdict on it is "${crit.verdict}", so the orchestrator requires more evidence first` : out.decision === "approved_for_rca" ? `The Judge approved, but confidence ${conf.toFixed(2)} is below the ${WB_THRESHOLD} threshold, so the orchestrator treats it as not proven` : `The Judge requested more evidence (confidence ${conf.toFixed(2)})`;
  if (run.round < WB_MAX_ROUNDS) { run.round += 1; return wbDone(run, "judge", `${reason}. Investigation sent back to the Context & Evidence Agent for round ${run.round}.`, "evidence"); }
  wbGate(run, "attention", { type: "judge_low", node: "judge" }, `${reason}, and no investigation rounds remain (${WB_MAX_ROUNDS} done). An engineer must decide whether to proceed.`);
}

/* ------------------------------------------------------- 4 · RCA */
async function wbStepRca(run) {
  const inc = wbInc(run.incId); const scen = wbScenario(inc);
  run.rcaAttempt += 1;
  wbNodeStart(run, "rca");
  const judge = wbOut(run, "judge"); const hyp = wbOut(run, "hypothesis");
  const sel = hyp.hypotheses.find((h) => h.id === judge.selected_hypothesis_id) || hyp.hypotheses[0];
  // Factual record of what the agents actually did (from this run), for the "investigation performed" section.
  const investigation_log = ["intake", "triage", "evidence", "hypothesis", "critic", "judge"].flatMap((k) => { const n = run.nodes[k]; if (!n) return []; const tools = n.tools.filter((t) => t.status === "ok").map((t) => `${t.name} (${t.source}): ${t.summary}`); return [`${WB_NODES[k].name}${n.attempts > 1 ? ` (${n.attempts} runs)` : ""}: ${n.decision}`, ...tools]; }).slice(0, 24);
  const ctx = { incident: wbIncCtx(inc), triage: wbOut(run, "triage"), evidence_summary: wbOut(run, "evidence"), evidence_items: wbEvItems(run), investigation_log, judge_decision: judge, selected_hypothesis: sel, critique_overall: wbOut(run, "critic").overall, low_confidence_override: !!run.flags.lowConfidence, quality_gate_corrections: run.feedback.rca || "", engineer_change_requests: run.feedback.rcaEngineer || "" };
  const out = await wbAgent(run, "rca", ctx, () => {
    const s = scen.script; const ev = scen.evidence; const refs = [...new Set([...judge.supporting_evidence, ...ev.changes.map((c) => c.id)])];
    return {
      executive_summary: `${inc.service}: ${s.root_cause.split(";")[0].split(",")[0].slice(0, 90).trim()}. Fix proposed (${s.remediation.length} steps).`,
      incident_overview: inc.description, business_impact: scen.business_impact, technical_impact: ev.metrics.map((m) => `${m.name} at ${m.before} ${m.unit} against a threshold of ${m.threshold} ${m.unit}.`).join(" "), affected_service: inc.service,
      timeline: [...ev.changes.map((c) => ({ at: `${c.t_hours} h before report`, event: c.title })), ...ev.logs.map((l) => ({ at: `${l.t} min before report`, event: l.text.slice(0, 110) })), { at: "Report", event: `Reported by ${inc.reported_by}` }],
      investigation_performed: [`Validated the report and checked for duplicates`, `Triaged against CMDB ownership (${ev.cmdb.owner_group})`, `Correlated monitoring, change, knowledge and history evidence over ${run.round} round(s)`, `Tested ${hyp.hypotheses.length} hypotheses with an independent critique and a judged decision`],
      evidence_reviewed: refs.map((id) => { const e = run.evidence.find((x) => x.id === id); return e ? `${id}: ${e.text.slice(0, 100)}` : id; }),
      root_cause: s.root_cause, contributing_factors: s.contributing, resolution_recommendation: [...(run.feedback.rcaEngineer ? [`Engineer request addressed: ${run.feedback.rcaEngineer}`] : []), ...s.remediation.map((x) => x.step)], preventive_recommendations: s.prevention,
      confidence: judge.confidence >= 0.8 ? "high" : "medium", evidence_references: refs, assumptions: [...(run.flags.lowConfidence ? ["Proceeding below the confidence threshold by engineer decision."] : []), ...(run.feedback.rcaEngineer ? [`Revised after engineer feedback on draft ${run.rcaAttempt - 1 || 1}.`] : [])],
    };
  });
  if (!out) return wbFail(run, "rca");
  let note = "";
  const listed = wbArr(out.investigation_performed).length;
  if (listed < 3) {
    // Factual completion, not invented content: the run's own record of what the agents did.
    const fromAudit = ["evidence", "hypothesis", "critic", "judge"].filter((k) => run.nodes[k]).map((k) => `[Audit trail] ${WB_NODES[k].name}${run.nodes[k].attempts > 1 ? ` (${run.nodes[k].attempts} runs)` : ""}: ${run.nodes[k].decision}`);
    out.investigation_performed = [...wbArr(out.investigation_performed), ...fromAudit].slice(0, 6);
    note = ` The writer listed ${listed} investigation item(s); the section was completed from the run's audit trail (tagged).`;
  }
  wbDone(run, "rca", `RCA draft ${run.rcaAttempt} written.${note} Handed to the Quality & Governance Agent.`, "quality");
}
const WB_SENSITIVE = [[/\b\d{3}-\d{2}-\d{4}\b/, "a Social Security number"], [/\b[A-Z]{2,3}\d{9,11}\b/, "a member ID"], [/[\w.+-]+@[\w-]+\.[\w.]+/, "an email address"], [/(password|passwd|api[_-]?key|secret)\s*[:=]\s*\S+/i, "a credential"], [/\b(?:\d[ -]*?){13,16}\b/, "a card number"]];
function wbQualityChecks(run, rca, review) {
  const known = new Set(run.evidence.map((e) => e.id));
  const cited = (rca.evidence_references || []).filter((id) => known.has(String(id).trim()));
  const rootWords = wbWords(rca.root_cause);
  const text = JSON.stringify(rca);
  const leak = WB_SENSITIVE.find(([re]) => re.test(text));
  const conf = run.judged ? run.judged.confidence : 0;
  const sopReady = review && (review.checks || []).find((c) => /sop/i.test(c.name || ""));
  const src = run.nodes.rca.source;
  return [
    src === "llm" ? { label: "Generated by the LLM", status: "pass", detail: `${run.nodes.rca.model}, from this incident's evidence.` } : { label: "Generated by the LLM", status: "warn", detail: "Scripted demo output (Controlled Demo Mode); not LLM-generated." },
    rootWords >= 15 ? { label: "Root cause is specific", status: "pass", detail: `${rootWords} words naming the mechanism.` } : { label: "Root cause is specific", status: rootWords >= 8 ? "warn" : "fail", detail: `Only ${rootWords} words.` },
    cited.length >= 2 ? { label: "Grounded in the evidence", status: "pass", detail: `Cites ${cited.slice(0, 6).join(", ")}.` } : { label: "Grounded in the evidence", status: cited.length ? "warn" : "fail", detail: cited.length ? `Only cites ${cited[0]}.` : "Cites no evidence gathered for this incident; it may be invented." },
    (rca.investigation_performed || []).length >= 3 ? { label: "Investigation documented", status: "pass", detail: `${rca.investigation_performed.length} investigation steps recorded.` } : { label: "Investigation documented", status: "fail", detail: "Fewer than 3 investigation steps." },
    (rca.resolution_recommendation || []).length >= 2 ? { label: "Resolution steps", status: "pass", detail: `${rca.resolution_recommendation.length} corrective actions.` } : { label: "Resolution steps", status: "fail", detail: "Fewer than 2 corrective actions." },
    sopReady ? { label: "SOP readiness", status: sopReady.status === "fail" ? "fail" : sopReady.status === "warn" ? "warn" : "pass", detail: sopReady.detail || "" } : (rca.resolution_recommendation || []).length >= 3 ? { label: "SOP readiness", status: "pass", detail: "Actions are concrete enough to turn into an SOP." } : { label: "SOP readiness", status: "warn", detail: "Few actions; the SOP may need more detail." },
    (rca.preventive_recommendations || []).length ? { label: "Prevention included", status: "pass", detail: `${rca.preventive_recommendations.length} preventive measure(s).` } : { label: "Prevention included", status: "warn", detail: "No preventive measures." },
    conf >= WB_THRESHOLD && rca.confidence !== "low" ? { label: "Confidence", status: "pass", detail: `Judge ${conf.toFixed(2)}; RCA ${rca.confidence}.` } : { label: "Confidence", status: "warn", detail: `Judge ${conf.toFixed(2)}; RCA ${rca.confidence || "n/a"}. Treat as a hypothesis.` },
    leak ? { label: "No sensitive data", status: "fail", detail: `Contains what looks like ${leak[1]}.` } : { label: "No sensitive data", status: "pass", detail: "No member, personal or credential data detected." },
  ];
}
async function wbStepQuality(run) {
  const inc = wbInc(run.incId);
  wbNodeStart(run, "quality");
  const rca = wbOut(run, "rca");
  const ctx = { incident: wbIncCtx(inc), judge_decision: wbOut(run, "judge"), evidence_items: wbEvItems(run), rca };
  const review = await wbAgent(run, "quality", ctx, () => ({ checks: ["Root-cause consistency", "Technical plausibility", "Business-impact accuracy", "Remediation safety", "No contradictory recommendations", "SOP readiness"].map((n) => ({ name: n, status: "pass", detail: n === "Remediation safety" ? "Steps go through approved pipelines or need sign-off; rollback stated." : n === "Root-cause consistency" ? `Matches the Judge's selected hypothesis.` : "No issues found." })), corrections: [], decision: "pass" }));
  if (!review) return wbFail(run, "quality");
  const checks = wbQualityChecks(run, rca, review);
  run.nodes.quality.output = { ...review, nine_checks: checks };
  await wbTool(run, "quality", { name: "Nine-check quality gate", source: "rules", input: `RCA draft ${run.rcaAttempt}`, run: () => checks, summarize: (c) => `${c.filter((x) => x.status === "pass").length} pass, ${c.filter((x) => x.status === "warn").length} warn, ${c.filter((x) => x.status === "fail").length} fail` });
  const failed = checks.filter((c) => c.status === "fail");
  const reviewFail = review.decision === "fail";
  if (!failed.length && !reviewFail) {
    run.nodes.quality.status = "done";
    wbDone(run, "quality", `Quality gate passed (${checks.filter((c) => c.status === "pass").length}/9 pass${checks.some((c) => c.status === "warn") ? ", warnings to acknowledge" : ""}). Paused for engineer approval.`, null);
    const a = wbNodeStart(run, "approval"); a.input = { rca_draft: run.rcaAttempt, quality: `${checks.filter((c) => c.status === "pass").length}/9` }; a.source = "human";
    return wbGate(run, "waiting", { type: "rca", node: "approval" }, "Waiting for an engineer to review and decide on the RCA.");
  }
  const corrections = [...failed.map((c) => `${c.label}: ${c.detail}`), ...(review.corrections || [])];
  if (run.rcaAttempt < 3) {
    run.feedback.rca = corrections.join(" | ");
    return wbDone(run, "quality", `Quality gate failed (${failed.length} check(s)${reviewFail ? " and the governance review" : ""}). RCA returned to the RCA Writer with ${corrections.length} correction(s).`, "rca");
  }
  wbGate(run, "attention", { type: "quality_exhausted", node: "quality" }, `The RCA failed the quality gate ${run.rcaAttempt} times; an engineer must decide.`);
}

/* --------------------------------------------- 5 · approval decisions */
function wbRcaNote(run) {
  const rca = wbOut(run, "rca"); const q = wbOut(run, "quality");
  const pass = q.nine_checks.filter((c) => c.status === "pass").length;
  return `[AURA Workbench] ROOT CAUSE ANALYSIS (approved by engineer)\nRoot cause: ${rca.root_cause}\n\nSummary: ${rca.executive_summary}\n\nCorrective actions:\n${rca.resolution_recommendation.map((x, i) => `${i + 1}. ${x}`).join("\n")}\n\nEvidence: ${(rca.evidence_references || []).join(", ")}\nJudge confidence ${run.judged ? run.judged.confidence.toFixed(2) : "n/a"}; quality gate ${pass}/9 pass; RCA draft ${run.rcaAttempt}.`;
}
async function wbDecide(incId, gate, decision, feedback) {
  const run = WB.runs[incId];
  if (!run || run.status !== "waiting" || !run.gate || run.gate.type !== gate) return;
  const key = gate === "rca" ? "approval" : "sop_approval";
  const node = run.nodes[key];
  if (run.mode === "live") {
    const r = await wbApi("approval", { run_id: run.id, gate, decision, feedback, approver: "Engineer (POC role)" }, "POST", { "X-P32-Role": "engineer" });
    if (!r.ok) { WBL.flash = `Approval not recorded: ${r.error}`; render(); return; }
  }
  const entry = { gate, decision, feedback, approver: "Engineer (POC role)", at: wbNow(), recorded: run.mode === "live" ? "backend" : "local (demo)" };
  run.approvals.push(entry);
  node.output = entry; node.status = "done"; node.ended = wbNow();
  const label = { approve: "Approved", request_changes: "Changes requested", reject: "Rejected" }[decision];
  wbEvent(run, "Engineer (human)", "approval", `${gate === "rca" ? "RCA" : "SOP"}: ${label}${feedback ? `: "${feedback}"` : ""}`, decision === "approve" ? "ok" : "warn");
  run.gate = null; run.status = "running";
  if (gate === "rca") {
    if (decision === "approve") {
      node.decision = "Approved. RCA and remediation are now approved recommendations; handed to the SOP Generation Agent.";
      run.next = "sop";
      if (run.mode === "live" && run.sn) await wbTool(run, "approval", { name: "ServiceNow Work Notes API", source: "live", input: `${run.sn.number}: approved RCA`, live: { tool: "sn_note", args: { kind: "rca_approved", text: wbRcaNote(run) } }, summarize: (r) => `Work note posted to ${r.number}` });
    } else if (decision === "request_changes") { node.decision = "Changes requested: feedback sent to the RCA Writer Agent."; run.feedback.rcaEngineer = feedback; run.rcaAttempt = 0; run.next = "rca"; }
    else { node.decision = "Rejected: feedback sent back to the Hypothesis Agent to re-examine the root cause."; run.feedback.hypothesis = feedback; run.rcaAttempt = 0; run.next = "hypothesis"; }
  } else {
    if (decision === "approve") { node.decision = "SOP approved for execution; handed to the SOP Execution Agent."; run.next = "execution"; }
    else { node.decision = "Changes requested: feedback sent to the SOP Generation Agent."; run.feedback.sopEngineer = feedback; run.next = "sop"; }
  }
  wbEvent(run, "Orchestrator", "decision", node.decision, "ok");
  wbCommit(); wbPersist(run);
  wbDrive(incId);
}

/* ------------------------------------------------------ 6 · SOP */
async function wbStepSop(run) {
  const inc = wbInc(run.incId); const scen = wbScenario(inc);
  run.sopVersion += 1;
  wbNodeStart(run, "sop");
  const rca = wbOut(run, "rca"); const prev = run.sopVersion > 1 ? wbOut(run, "sop") : null;
  const verify = run.remRound > 1 ? wbOut(run, "verification") : null;
  const ctx = { incident: wbIncCtx(inc), approved_rca: { root_cause: rca.root_cause, resolution_recommendation: rca.resolution_recommendation, preventive_recommendations: rca.preventive_recommendations, evidence_references: rca.evidence_references }, runbooks_and_knowledge: run.evidence.filter((e) => /KB/.test(e.id) || /knowledge/i.test(e.source)).map((e) => ({ id: e.id, text: e.text })), approver_comments: run.approvals.filter((a) => a.feedback).map((a) => a.feedback), engineer_sop_change_requests: run.feedback.sopEngineer || "", verification_findings: verify ? { remaining_issues: verify.remaining_issues, additional_action: verify.additional_action } : null, previous_sop: prev };
  const out = await wbAgent(run, "sop", ctx, () => {
    const s = scen.script; const steps = s.remediation.map((x) => ({ action: x.step, expected_result: x.expected, mode: /approval|notify|ask |request|announce|hr updates|qa voids|data steward|identity team|network operations/i.test(x.step) ? "manual" : "automated", risk: /restart|cancel|rebuild|swap|deploy|flush|purge|policy/i.test(x.step) ? "medium" : "low" }));
    if (verify && s.followup) steps.push({ action: s.followup.step, expected_result: s.followup.expected, mode: "automated", risk: "medium" });
    if (run.feedback.sopEngineer) steps.unshift({ action: `Engineer request: ${run.feedback.sopEngineer}`, expected_result: "Confirmed before the remediation steps run.", mode: "manual", risk: "low" });
    return {
      sop_id: `SOP-${inc.use_case}-${String(1000 + WB_DATA.incidents.indexOf(scen) * 7 + 3).slice(-4)}`, title: `${inc.service}: ${scen.title.split(" ").slice(0, 7).join(" ").toLowerCase()} remediation`,
      purpose: `Restore ${inc.service} by correcting the confirmed root cause: ${s.root_cause.split(",")[0]}.`, scope: `${inc.ci} in the synthetic production environment. Not for use on other services without review.`,
      preconditions: ["RCA approved by the engineer", "Change window or emergency change approved where the step changes configuration", `Rollback owner available (${scen.evidence.cmdb.owner_group})`],
      permissions: [`${scen.evidence.cmdb.owner_group} operator role`, "Access to the approved deployment / configuration pipeline"],
      steps, rollback: [s.rollback], verification: [`${scen.evidence.metrics[0].name} ${scen.evidence.metrics[0].better === "higher" ? "≥" : "≤"} ${scen.evidence.metrics[0].threshold} ${scen.evidence.metrics[0].unit}`, "Original symptom no longer appears in logs for 15 minutes"],
      escalation: [`${scen.evidence.cmdb.owner_group} on-call`, "Incident manager if any step fails twice"], evidence_references: rca.evidence_references,
    };
  });
  if (!out) return wbFail(run, "sop");
  wbDone(run, "sop", `SOP ${out.sop_id || ""} v${run.sopVersion} generated (${out.steps.length} steps). Paused for SOP approval before execution.`, null);
  const a = wbNodeStart(run, "sop_approval"); a.input = { sop: out.sop_id, version: run.sopVersion, steps: out.steps.length }; a.source = "human";
  wbGate(run, "waiting", { type: "sop", node: "sop_approval" }, "Waiting for the engineer to approve the SOP for execution.");
}

/* --------------------------------------------------- 7 · execution */
async function wbStepExecution(run) {
  const inc = wbInc(run.incId); const scen = wbScenario(inc);
  const sop = wbOut(run, "sop");
  wbNodeStart(run, "execution");
  run.nodes.execution.source = "tools";
  run.nodes.execution.input = { sop: sop.sop_id, version: run.sopVersion, approved_steps: sop.steps.length };
  run.exec = { version: run.sopVersion, manual: false, steps: sop.steps.map((s) => ({ action: s.action, expected: s.expected_result, mode: s.mode, status: "approved", attempts: 0, result: "", by: "" })) };
  wbEvent(run, "SOP Execution Agent", "decision", `${sop.steps.length} approved steps queued (simulated execution handler).`, "info");
  await wbExecFrom(run, 0);
}
function wbExecFail(run, i) {
  const scen = wbScenario(wbInc(run.incId)); const f = scen && scen.script.exec_fail;
  if (!f || run.remRound > 1) return null;
  const at = Math.min(f.step, run.exec.steps.length - 1);
  if (i !== at) return null;
  const st = run.exec.steps[i];
  if (f.mode === "transient" && st.attempts > 1) return null;
  return f;
}
async function wbExecFrom(run, from) {
  for (let i = from; i < run.exec.steps.length; i++) {
    const st = run.exec.steps[i];
    if (st.status === "executed" || st.status === "manual") continue;
    st.status = "running"; st.attempts += 1; wbCommit();
    const f = wbExecFail(run, i);
    const t = await wbTool(run, "execution", { name: "Execution handler (simulated)", source: "simulated", input: `Step ${i + 1}: ${st.action}`, pace: 5000, run: () => { if (f) throw new Error(f.error); return { ok: true, observed: st.expected }; }, summarize: (r) => `Step ${i + 1} executed; observed: ${r.observed}` });
    if (t.status !== "ok") {
      st.status = "failed"; st.result = t.error;
      run.nodes.execution.status = "attention";
      return wbGate(run, "attention", { type: "exec_failed", node: "execution", step: i, mode: f ? f.mode : "transient" }, `Step ${i + 1} failed: ${t.error} Run stopped; retry, or take over manually.`);
    }
    st.status = "executed"; st.result = st.expected; st.by = "Execution Agent (simulated)";
    if (run.pauseReq) { run.pauseReq = false; run.status = "paused"; run.next = "execution_resume"; wbEvent(run, "Orchestrator", "decision", "Paused by the user between execution steps.", "info"); return; }
  }
  await wbExecFinish(run);
}
async function wbExecFinish(run) {
  const ex = run.exec; const manual = ex.steps.filter((s) => s.status === "manual").length;
  const out = { steps: ex.steps.map((s, i) => ({ step: i + 1, action: s.action, status: s.status, attempts: s.attempts, result: s.result, by: s.by })), executed: ex.steps.filter((s) => s.status === "executed").length, manual, retries: ex.steps.reduce((n, s) => n + Math.max(0, s.attempts - 1), 0), simulated: true };
  run.nodes.execution.output = out;
  if (run.mode === "live" && run.sn) await wbTool(run, "execution", { name: "ServiceNow Work Notes API", source: "live", input: `${run.sn.number}: SOP execution record`, live: { tool: "sn_note", args: { kind: "sop_executed", text: `[AURA Workbench] ${wbOut(run, "sop").sop_id} v${run.sopVersion} executed: ${out.executed} step(s) by the execution handler (simulated POC actions), ${manual} completed manually by the engineer, ${out.retries} retry(ies).` } }, summarize: (r) => `Work note posted to ${r.number}` });
  run.status = "running"; run.gate = null;
  wbDone(run, "execution", `All ${ex.steps.length} steps complete (${out.executed} executed, ${manual} manual, ${out.retries} retries). Handed to the Verification Agent; finishing the SOP is not treated as resolution.`, "verification");
}
async function wbExecAction(incId, action, idx) {
  const run = WB.runs[incId];
  if (!run || !run.exec || !run.gate || !["exec_failed", "manual"].includes(run.gate.type)) return;
  if (action === "retry" && run.gate.type === "exec_failed") {
    const i = run.gate.step; run.exec.steps[i].status = "approved";
    wbEvent(run, "Engineer (human)", "retry", `Retry of step ${i + 1} requested.`, "info");
    run.gate = null; run.status = "running"; run.nodes.execution.status = "running"; run.next = null; wbCommit();
    WBL.loops.add(incId);
    try { await wbExecFrom(run, i); } finally { WBL.loops.delete(incId); }
    wbCommit(); wbPersist(run);
    if (run.status === "running" && run.next) wbDrive(incId);
    return;
  }
  if (action === "manual" && run.gate.type === "exec_failed") {
    run.exec.manual = true; const i = run.gate.step; run.exec.steps[i].status = "approved";
    wbEvent(run, "Engineer (human)", "decision", `Manual takeover from step ${i + 1}: the engineer completes the remaining steps.`, "warn");
    run.gate = { type: "manual", node: "execution", step: i }; wbCommit(); wbPersist(run); return;
  }
  if (action === "mstep" && run.gate.type === "manual") {
    const st = run.exec.steps[idx]; if (!st || st.status === "executed") return;
    st.status = st.status === "manual" ? "approved" : "manual"; st.by = st.status === "manual" ? "Engineer (manual)" : ""; st.result = st.status === "manual" ? "Completed manually by the engineer" : "";
    wbEvent(run, "Engineer (human)", "result", `Step ${idx + 1} ${st.status === "manual" ? "marked done manually" : "unmarked"}.`, "ok");
    if (run.exec.steps.every((s) => s.status === "executed" || s.status === "manual")) {
      run.gate = null; run.status = "running"; WBL.loops.add(incId);
      try { await wbExecFinish(run); } finally { WBL.loops.delete(incId); }
      wbCommit(); wbPersist(run); wbDrive(incId); return;
    }
    wbCommit(); wbPersist(run);
  }
}

/* ------------------------------------------------- 8 · verification */
async function wbStepVerification(run) {
  const inc = wbInc(run.incId); const scen = wbScenario(inc);
  wbNodeStart(run, "verification");
  const m = wbMetric(scen);
  const value = scen.script.verify_fail_first && run.remRound === 1 ? m.after : run.remRound > 1 ? m.after2 : m.after;
  const healthy = wbMetricOk(m, value);
  await wbTool(run, "verification", { name: "Service health check", source: "simulated", input: `${m.name}, 15 min after remediation`, pace: run.mode === "demo" ? 6000 : 0, run: () => ({ metric: m.name, before: m.before, after: value, threshold: m.threshold, unit: m.unit, better: m.better, meets_threshold: healthy }), summarize: (r) => `${r.metric}: ${r.before} → ${r.after} ${r.unit} (threshold ${r.better === "higher" ? "≥" : "≤"} ${r.threshold}): ${r.meets_threshold ? "within threshold" : "still outside threshold"}` });
  const symptom = healthy ? "No new occurrences of the original symptom in the last 15 minutes." : "The original symptom still appears, at a reduced rate.";
  await wbTool(run, "verification", { name: "Symptom check (log search)", source: "simulated", input: "Original error signature, last 15 min", run: () => ({ symptom_present: !healthy, detail: symptom }), summarize: (r) => r.detail });
  let readback = null;
  if (run.mode === "live" && run.sn) { const t = await wbTool(run, "verification", { name: "ServiceNow read-back", source: "live", input: run.sn.number, live: { tool: "sn_readback", args: {} }, summarize: (r) => `${r.number}: ${r.state}, ${r.notes} journal entries` }); if (t.status === "ok") readback = t.result; }
  const ctx = { incident: wbIncCtx(inc), original_symptoms: (wbOut(run, "intake") || {}).symptoms, health_check: { metric: m.name, unit: m.unit, before: m.before, after: value, threshold: m.threshold, better: m.better }, symptom_check: symptom, execution: wbOut(run, "execution"), remediation_round: run.remRound, servicenow_record: readback, note: "Health and symptom checks are simulated demonstration evidence." };
  const out = await wbAgent(run, "verification", ctx, () => ({
    resolved: healthy, checks: [{ check: `${m.name} within threshold`, result: healthy ? "pass" : "fail", detail: `${m.before} → ${value} ${m.unit} (threshold ${m.better === "higher" ? "≥" : "≤"} ${m.threshold})` }, { check: "Original symptom gone", result: healthy ? "pass" : "fail", detail: symptom }, { check: "All approved SOP steps completed", result: "pass", detail: `${wbOut(run, "execution").executed + wbOut(run, "execution").manual} of ${run.exec.steps.length}` }],
    evidence_reviewed: ["Service health check (simulated)", "Symptom check (simulated)", "Execution record"], remaining_issues: healthy ? [] : [`${m.name} is ${value} ${m.unit}, still outside the ${m.threshold} ${m.unit} threshold.`],
    resolution_confidence: healthy ? 0.9 : 0.35, recommendation: healthy ? "close" : "reopen_remediation", additional_action: healthy ? "" : scen.script.followup ? scen.script.followup.step : "Investigate remaining symptom.",
  }));
  if (!out) return wbFail(run, "verification");
  if (out.resolved && out.recommendation === "close") return wbDone(run, "verification", `Verified resolved (confidence ${Number(out.resolution_confidence || 0).toFixed(2)}). Handed to the Closure Agent.`, "closure");
  if (run.remRound < 3) { run.remRound += 1; return wbDone(run, "verification", `Verification failed: ${(out.remaining_issues || []).join(" ") || "symptoms persist"} Remediation reopened; the SOP Generation Agent revises the procedure (needs SOP approval again).`, "sop"); }
  wbGate(run, "attention", { type: "verify_exhausted", node: "verification" }, "Verification failed after 3 remediation rounds; escalate to the engineer.");
}

/* ------------------------------------------------------ 9 · closure */
async function wbStepClosure(run) {
  const inc = wbInc(run.incId);
  wbNodeStart(run, "closure");
  const rca = wbOut(run, "rca"); const sop = wbOut(run, "sop"); const ver = wbOut(run, "verification"); const ex = wbOut(run, "execution");
  const ctx = { incident: wbIncCtx(inc), root_cause: rca.root_cause, sop: { id: sop.sop_id, title: sop.title, version: run.sopVersion }, execution: { executed: ex.executed, manual: ex.manual, retries: ex.retries, simulated: true }, verification: ver, approvals: run.approvals.map((a) => ({ gate: a.gate, decision: a.decision, at: a.at })) };
  const out = await wbAgent(run, "closure", ctx, () => ({
    resolution_summary: `Root cause: ${rca.root_cause} Fix: ${sop.sop_id} v${run.sopVersion} (${ex.executed + ex.manual} steps${ex.manual ? `, ${ex.manual} manual` : ""}). Verification: ${ver.checks.map((c) => String(c.detail).replace(/\.$/, "")).join("; ")}.`,
    close_code: "Solution provided", work_note: `[AURA Workbench] Closure: ${sop.sop_id} v${run.sopVersion} executed and verified. RCA and SOP approved by the engineer. Monitoring evidence in this POC is simulated.`,
    employee_update: `Good news: the ${inc.service} issue you reported has been fixed and we've confirmed it's working normally. Thanks for reporting it.`,
  }));
  if (!out) return wbFail(run, "closure");
  run.closeNote = out;
  if (run.mode === "live" && run.sn) {
    const t = await wbTool(run, "closure", { name: "ServiceNow resolution update + read-back", source: "live", input: `${run.sn.number}: work note, caller update, resolve`, live: { tool: "sn_resolve", args: { work_note: out.work_note, employee_update: out.employee_update, close_notes: out.resolution_summary, close_code: out.close_code } }, summarize: (r) => `Read back ${r.readback.number}: state ${r.readback.state}, close code ${r.readback.close_code || "(none)"}` });
    if (t.status !== "ok") { run.snResult = { written: false, error: t.error, pending: out }; return wbFail(run, "closure", `ServiceNow write-back failed: ${t.error} The prepared update is kept for review; nothing is shown as written.`); }
    run.snResult = { written: true, readback: t.result.readback, url: t.result.url };
  } else {
    run.snResult = { written: false, reason: run.mode === "live" ? "This curated demo incident is not in ServiceNow (not seeded), so the update was prepared but not sent." : "Controlled Demo Mode makes no ServiceNow calls; the update was prepared but not sent.", pending: out };
  }
  wbDone(run, "closure", run.snResult.written ? `Resolved in ServiceNow and confirmed by read-back (${run.snResult.readback.state}). Run complete.` : `Run complete. ${run.snResult.reason}`, null);
  run.status = "completed"; run.ended = wbNow(); run.current = null;
  wbEvent(run, "Orchestrator", "result", "Incident lifecycle complete.", "ok");
  if (typeof addExec === "function") { addExec("rca", wbNum(inc), "Success", `Workbench: ${inc.title.slice(0, 60)} resolved (${run.mode === "live" ? "live agents" : "demo"})`, Date.parse(run.ended) - Date.parse(run.started)); save(); }
}

/* ------------------------------------------------------ orchestrator */
const WB_STEPS = { intake: wbStepIntake, triage: wbStepTriage, evidence: wbStepEvidence, hypothesis: wbStepHypothesis, critic: wbStepCritic, judge: wbStepJudge, rca: wbStepRca, quality: wbStepQuality, sop: wbStepSop, execution: wbStepExecution, execution_resume: async (run) => { run.nodes.execution.status = "running"; await wbExecFrom(run, 0); }, verification: wbStepVerification, closure: wbStepClosure };
async function wbDrive(incId) {
  if (WBL.loops.has(incId)) return;
  WBL.loops.add(incId);
  try {
    for (;;) {
      const run = WB.runs[incId];
      if (!run || run.status !== "running") break;
      if (run.pauseReq) { run.pauseReq = false; run.status = "paused"; wbEvent(run, "Orchestrator", "decision", "Paused by the user.", "info"); break; }
      const key = run.next;
      if (!key || !WB_STEPS[key]) break;
      const stepMode = run.stepMode;
      await WB_STEPS[key](run);
      if (WB.runs[incId] !== run) break;
      run.updated = wbNow(); wbSave(); wbPersist(run); render();
      if (stepMode && run.status === "running") { run.stepMode = false; run.status = "paused"; wbEvent(run, "Orchestrator", "decision", "Stage complete (step mode); paused.", "info"); break; }
    }
  } catch (e) {
    const run = WB.runs[incId];
    if (run) { const key = run.current || "intake"; if (run.nodes[key]) run.nodes[key].error = `Unexpected error: ${e.message || e}`; wbFail(run, key); }
    console.error(e);
  } finally { WBL.loops.delete(incId); wbCommit(); wbPersist(WB.runs[incId]); }
}
function wbControl(incId, action) {
  let run = WB.runs[incId];
  const inc = wbInc(incId); if (!inc) return;
  if (action === "start" || action === "restart") { run = wbNewRun(inc); run.status = "running"; run.started = wbNow(); wbEvent(run, inc.submitted ? "Digital FrontDoor" : "Workbench", "decision", "Investigation started.", "info"); wbCommit(); wbDrive(incId); return; }
  if (!run) return;
  if (action === "pause" && run.status === "running") { run.pauseReq = true; wbEvent(run, "Engineer (human)", "decision", "Pause requested: the current step finishes first.", "info"); wbCommit(); return; }
  if (action === "resume" && (run.status === "paused" || run.status === "ready")) { if (!run.started) run.started = wbNow(); run.status = "running"; run.stepMode = false; wbCommit(); wbDrive(incId); return; }
  if (action === "next" && (run.status === "paused" || run.status === "ready")) { if (!run.started) run.started = wbNow(); run.status = "running"; run.stepMode = true; wbCommit(); wbDrive(incId); return; }
  if (action === "retry" && run.status === "failed" && run.gate) { const key = run.gate.node; wbEvent(run, "Engineer (human)", "retry", `Retry of ${WB_NODES[key].name} requested.`, "info"); run.gate = null; run.next = key; run.status = "running"; wbCommit(); wbDrive(incId); }
}
function wbGateAction(incId, action, text) {
  const run = WB.runs[incId]; if (!run || !run.gate) return;
  const g = run.gate;
  const go = (next, msg) => { wbEvent(run, "Engineer (human)", "decision", msg, "info"); run.gate = null; run.status = "running"; run.next = next; wbCommit(); wbDrive(incId); };
  if (g.type === "intake_info" && action === "info") { if (!text || wbWords(text) < 4) { WBL.flash = "Add at least a short sentence of detail."; render(); return; } run.extraInfo = `${run.extraInfo ? run.extraInfo + " " : ""}${text}`; return go("intake", "Reporter added details; re-running the Intake Agent."); }
  if (g.type === "duplicate" && action === "new") { run.flags.dupCleared = true; run.nodes.intake.status = "done"; run.nodes.intake.decision = "Engineer chose to investigate separately from the possible duplicate."; return go("triage", "Not a duplicate: investigate as a new incident."); }
  if (g.type === "duplicate" && action === "link") { run.status = "linked"; run.gate = null; run.ended = wbNow(); run.nodes.intake.status = "done"; run.nodes.intake.decision = `Linked as a duplicate of ${g.candidate.number || g.candidate.id}; no separate investigation.`; wbEvent(run, "Engineer (human)", "decision", run.nodes.intake.decision, "ok"); wbCommit(); wbPersist(run); return; }
  if (g.type === "judge_low" && action === "proceed") { run.flags.lowConfidence = true; run.nodes.judge.status = "done"; run.nodes.judge.decision += " Engineer chose to proceed to RCA, flagged as low confidence."; return go("rca", "Proceed to RCA below the confidence threshold (flagged)."); }
  if (g.type === "judge_low" && action === "stop") { run.gate = { type: "escalated", node: "judge" }; wbEvent(run, "Engineer (human)", "decision", "Stopped: escalated to an engineer for manual investigation.", "warn"); wbCommit(); wbPersist(run); return; }
  if (g.type === "quality_exhausted" && action === "retry") { run.rcaAttempt = 0; return go("rca", "RCA Writer retry requested after repeated quality-gate failures."); }
  if (g.type === "verify_exhausted" && action === "retry") { run.remRound = 1; return go("sop", "Remediation restarted by the engineer."); }
}

/* --------------------------------------------- FrontDoor submission */
async function wbSubmit(form) {
  const uc = form.uc, svc = form.service;
  const scen = WB_DATA.incidents.find((i) => i.service === svc);
  const impact = { many: "1 - High", team: "2 - Medium", me: "3 - Low" }[form.impact] || "2 - Medium";
  const urgency = { now: "1 - High", today: "2 - Medium", later: "3 - Low" }[form.urgency] || "2 - Medium";
  const pr = { "1 - High|1 - High": "1 - Critical", "1 - High|2 - Medium": "2 - High", "2 - Medium|1 - High": "2 - High", "2 - Medium|2 - Medium": "3 - Moderate" }[`${impact}|${urgency}`] || (impact === "3 - Low" && urgency === "3 - Low" ? "4 - Low" : "3 - Moderate");
  WB.seq += 1;
  const inc = {
    id: `${wbMode() === "live" ? "FD" : "DEMO"}-${uc}-S${String(WB.seq).padStart(2, "0")}`, use_case: uc, submitted: true, title: form.title.trim(), description: form.description.trim(), service: svc, ci: scen ? scen.ci : "",
    reported_by: `${WB_EMPLOYEE.name} (${WB_EMPLOYEE.dept}, synthetic)`, reported_at: wbNow(), priority: pr, impact, urgency, category: scen ? scen.category : "Software", group: "", sn: null,
  };
  // Five-record limit: the new report replaces the oldest record in this use case that isn't mid-run.
  const list = wbIncidentsFor(uc).filter((o) => !["running", "waiting", "attention", "paused", "failed"].includes((WB.runs[o.id] || {}).status));
  const pool = list.length ? list : wbIncidentsFor(uc);
  const victim = pool.sort((a, b) => Date.parse(wbReportedAt(a)) - Date.parse(wbReportedAt(b)))[0];
  const run0 = { id: `RUN-${inc.id}-${Date.now().toString(36)}` };
  if (wbMode() === "live") {
    const r = await wbApi("tool", { run_id: run0.id, tool: "sn_create", args: { short_description: inc.title, description: inc.description, impact, use_case: wbUseCase(uc).name, service: svc } });
    if (!r.ok) return { ok: false, error: `ServiceNow did not create the incident: ${r.error}` };
    inc.sn = { number: r.result.number, url: r.result.url };
  }
  if (victim) {
    if (victim.submitted) { inc.replaces = victim.replaces; WB.submitted = WB.submitted.filter((s) => s.id !== victim.id); } else inc.replaces = victim.id;
    delete WB.runs[victim.id];
  }
  WB.submitted.unshift(inc); WB.myIds.unshift(inc.id); WB.useCase = uc;
  const run = wbNewRun(inc); run.id = run0.id; run.status = "running"; run.started = wbNow();
  wbEvent(run, "Digital FrontDoor", "result", inc.sn ? `Incident created in ServiceNow: ${inc.sn.number}.` : `Incident ${inc.id} created (synthetic, Controlled Demo Mode).`, "ok");
  if (victim) wbEvent(run, "Workbench", "decision", `Five-record demo limit: this report replaced ${victim.id} in the ${wbUseCase(uc).short} list (Reset demo restores it).`, "info");
  wbCommit(); wbDrive(inc.id);
  return { ok: true, id: inc.id };
}
function wbResetAll() {
  const live = WBL.available;
  WB = { ...wbFresh(), mode: WB.mode, snowMap: WB.snowMap };
  wbSave();
  if (live) wbApi("runs", null, "DELETE");
}
</script>
