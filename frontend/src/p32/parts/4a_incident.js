<script>
"use strict";
/* ===================================================== incident workflow
   Eight gated stages, each validated before the engineer can continue.
   This offline file runs the simulated path: the live app reads and
   writes ServiceNow and drafts the RCA with an LLM.                     */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WF_STAGES = [
  { t: "Intake validation", s: "Is the record complete enough to investigate?", i: "inbox" },
  { t: "Triage & assignment", s: "State and assignee set, then confirmed", i: "route" },
  { t: "Evidence review", s: "What the agent will reason from, reviewed by the engineer", i: "search" },
  { t: "AI root cause analysis", s: "Draft checked by an automated quality gate", i: "sparkles" },
  { t: "Engineer review & approval", s: "Nothing is posted without approval", i: "shield" },
  { t: "SOP execution", s: "Approved steps run one by one; failures stop the run", i: "wrench" },
  { t: "Verification", s: "Technical checks plus confirmation from the caller", i: "check" },
  { t: "Resolution & closure", s: "Validated notes and code, then resolved", i: "file" },
];
const DRAFT_STEPS = ["Reading the incident and the reviewed evidence", "Correlating symptoms with the evidence timeline", "Generating root-cause hypotheses", "Writing diagnosis, resolution, prevention and SOP", "Running the automated quality gate"];
const CLOSE_CODES = ["Solution provided", "Workaround provided", "Resolved by change", "Resolved by problem"];
const TELEMETRY = [
  ["Autoscale history", "Container App 'payment-api-prod': replicas dropped from 1 to 0 after ~20 minutes idle before each failing request."],
  ["Cold-start duration", "Container startup for the first request after idle measured at 38–44 s across 6 occurrences."],
  ["Gateway (APIM) timeout", "API Management backend timeout for the Payment API product is 30 s."],
  ["Request traces", "Every HTTP 504 is the first request after an idle window; subsequent requests return HTTP 200 in ~180 ms."],
  ["Change history", "No deployments or configuration changes in the 7 days before the incident."],
];
UI.logTab = UI.logTab || "audit";
UI.busy = null;

const W = () => S.inc.wf;
const done = (w, i) => [w.intake.done, w.triage.done, w.evidence.done, w.rca.done, w.review.done, w.exec.done, w.verify.done, w.close.done][i];
const hasFail = (c) => c.some((x) => x.status === "fail");
const hasWarn = (c) => c.some((x) => x.status === "warn");
const summary = (c) => `${c.filter((x) => x.status === "pass").length} passed, ${c.filter((x) => x.status === "warn").length} warning(s), ${c.filter((x) => x.status === "fail").length} failed`;
function wlog(who, text, kind = "ok") { W().log.push({ at: nowIso(), who, text, kind }); }
function note(text, author, ai = false) { S.inc.activity.unshift({ id: "a" + S.seq++, at: nowIso(), author, kind: "work_note", text, ai }); }
const ck = (label, detail, status) => ({ label, detail, status });

/* --------------------------------------------------------- validation */
function intakeChecks() {
  const words = INC.description.split(/\s+/).length;
  return [
    ck("Short description", `"${INC.short}"`, "pass"),
    ck("Description detail", `${words} words: symptoms and context available to the agent.`, "pass"),
    ck("Caller", INC.caller, "pass"),
    ck("Priority", INC.priority, "pass"),
    ck("Category", INC.category, "pass"),
    ck("Assignment group", INC.group, "pass"),
    ck("Configuration item / service", INC.ci, "pass"),
    S.inc.state === "Resolved" ? ck("Incident state", "Resolved. Nothing to investigate.", "fail") : ck("Incident state", `${S.inc.state}: open for investigation.`, "pass"),
  ];
}
const STOP = new Set("about after again against because before being below between could during first further having other should their there these those through under until which while would where incident issue users error errors request requests".split(" "));
const terms = (t) => new Set(t.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length >= 5 && !STOP.has(w)));
function qualityGate(doc) {
  const ctx = terms([INC.short, INC.description, INC.ci, ...W().evidence.items.map((x) => x.detail), W().evidence.note].join(" "));
  const overlap = [...terms(doc.root)].filter((t) => ctx.has(t));
  const words = doc.root.split(/\s+/).length;
  const all = [doc.summary, doc.root, ...doc.explanation, ...doc.diagnosis, ...doc.resolution, ...doc.prevention, ...doc.sop].join("\n");
  const leak = /\b\d{3}-\d{2}-\d{4}\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|password\s*[:=]/i.test(all);
  return [
    ck("Draft source", "Scripted demo content: this offline file has no LLM. The live app drafts the RCA with Cohere from the ServiceNow record.", "warn"),
    words >= 12 ? ck("Root cause is specific", `${words} words; names the mechanism, not just the symptom.`, "pass") : ck("Root cause is specific", `Only ${words} words.`, "fail"),
    overlap.length >= 2 ? ck("Grounded in the evidence", `Root cause refers to: ${overlap.slice(0, 5).join(", ")}.`, "pass") : ck("Grounded in the evidence", "Root cause shares no key terms with the evidence.", "fail"),
    doc.diagnosis.length >= 3 ? ck("Diagnosis steps", `${doc.diagnosis.length} steps to confirm the cause.`, "pass") : ck("Diagnosis steps", "Fewer than 3 steps.", "fail"),
    doc.resolution.length >= 2 ? ck("Resolution steps", `${doc.resolution.length} steps.`, "pass") : ck("Resolution steps", "Fewer than 2 steps.", "fail"),
    doc.sop.length >= 4 ? ck("SOP is executable", `${doc.sopId}: ${doc.sop.length} ordered steps.`, "pass") : ck("SOP is executable", "Fewer than 4 steps.", "fail"),
    doc.prevention.length ? ck("Prevention included", `${doc.prevention.length} preventive measure(s).`, "pass") : ck("Prevention included", "None.", "warn"),
    ck("Model confidence", `High${doc.assumptions.length ? `, with ${doc.assumptions.length} stated assumption(s)` : ""}.`, "pass"),
    leak ? ck("No sensitive data", "Draft contains personal or credential data.", "fail") : ck("No sensitive data", "No personal, member or credential data detected.", "pass"),
  ];
}
function closureChecks(notes, code, root) {
  const mention = [...terms(root)].some((t) => terms(notes).has(t));
  return [
    code ? ck("Resolution code", code, "pass") : ck("Resolution code", "Choose how the incident was resolved.", "fail"),
    notes.trim().length >= 40 ? ck("Resolution notes", `${notes.trim().length} characters.`, "pass") : ck("Resolution notes", "At least 40 characters: what was wrong and what was done.", "fail"),
    mention ? ck("Notes state the root cause", "Future engineers can find this fix by its cause.", "pass") : ck("Notes state the root cause", "Recommended for knowledge reuse.", "warn"),
  ];
}
function draftDoc(attempt, feedback) {
  const d = { summary: RCA.summary, root: RCA.root, explanation: [...RCA.explanation], diagnosis: [...RCA.diagnosis], resolution: [...RCA.resolution], prevention: [...RCA.prevention], sopId: RCA.sopId, sopTitle: RCA.sopTitle, sop: [...RCA.sop], assumptions: [] };
  if (attempt > 1) {
    d.explanation.push("The APIM backend timeout is 30 s and the measured cold start is 38–44 s, so the new timeout must exceed 44 s; 60 s leaves headroom.");
    d.sop.splice(5, 0, "Rollback: if 504s continue 30 minutes after the change, revert min replicas and the APIM timeout to their previous values and escalate to the platform team.");
    d.assumptions = [`Revised per engineer feedback: "${feedback}"`];
  }
  return d;
}
function workNote(doc) {
  const bar = "=".repeat(46);
  const L = [bar, "AURA RCA AGENT · ROOT CAUSE ANALYSIS", bar, "", "INCIDENT SUMMARY", doc.summary, "", "PROBABLE ROOT CAUSE", doc.root, "", "TECHNICAL EXPLANATION", ...doc.explanation.map((x) => "• " + x), "", "DIAGNOSIS PERFORMED", ...doc.diagnosis.map((x, i) => `${i + 1}. ${x}`), "", "RECOMMENDED RESOLUTION", ...doc.resolution.map((x, i) => `${i + 1}. ${x}`), "", "PREVENTIVE MEASURES", ...doc.prevention.map((x) => "• " + x)];
  if (doc.assumptions.length) L.push("", "ASSUMPTIONS", ...doc.assumptions.map((x) => "• " + x));
  L.push("", `SOP: ${doc.sopId} · ${doc.sopTitle}`, ...doc.sop.map((x, i) => `${i + 1}. ${x}`));
  return L.join("\n");
}

/* ------------------------------------------------------------ actions */
async function busy(label, fn) { UI.busy = label; render(); try { await fn(); } finally { UI.busy = null; commit(); } }
function wfView(i) { if (i <= W().stage) { W().view = i; commit(); } }
function wfContinue() {
  const w = W();
  if (!done(w, w.stage) || w.stage >= 7) return;
  w.stage++; w.view = w.stage;
  if (w.stage === 7 && !w.close.notes) {
    const d = S.inc.doc || draftDoc(1);
    w.close.code = "Solution provided";
    w.close.notes = `Root cause: ${d.root.replace(/\.$/, "")}. Applied ${d.sopId}: minimum replicas set to 1 and APIM backend timeout raised to 60 s. Verified the first request after an idle period returns HTTP 200 (simulated). No further 504s observed.`;
    w.close.checks = closureChecks(w.close.notes, w.close.code, d.root);
  }
  commit();
}
async function wfIntake() {
  await busy("Validating the incident record", async () => {
    await sleep(500);
    const w = W(); w.intake.checks = intakeChecks();
    w.intake.done = !hasFail(w.intake.checks) && (!hasWarn(w.intake.checks) || w.intake.ack);
    wlog("AURA RCA Agent", `Intake validation: ${summary(w.intake.checks)}`, hasFail(w.intake.checks) ? "bad" : "ok");
  });
}
async function wfTriage() {
  await busy("Setting state and assignee", async () => {
    await sleep(700);
    S.inc.state = "In Progress"; S.inc.assignee = ASSIGNEE;
    note(`[AURA] Triage: incident moved to In Progress and assigned to ${ASSIGNEE}. AURA RCA Agent will investigate: ${INC.short}`, "AURA");
    const w = W();
    w.triage.checks = [ck("State", "In Progress (simulated record; the live app reads this back from ServiceNow)", "pass"), ck("Assigned to", ASSIGNEE, "pass"), ck("Assignment group", INC.group, "pass"), ck("Triage work note", "Present in the incident's activity.", "pass")];
    w.triage.done = true;
    wlog("AURA RCA Agent", `Triage confirmed: ${summary(w.triage.checks)}`);
  });
  flashState();
}
async function wfCollect() {
  await busy("Collecting evidence", async () => {
    await sleep(600);
    const items = [
      { source: "Incident record", title: "Incident description", detail: INC.description.slice(0, 220) + "…", kind: "record" },
      { source: "Incident record", title: "Configuration item", detail: INC.ci, kind: "record" },
      ...TELEMETRY.map(([t, d]) => ({ source: "Monitoring (simulated)", title: t, detail: d, kind: "telemetry" })),
    ];
    Object.assign(W().evidence, { items, collected: true });
    wlog("AURA RCA Agent", `Collected ${items.length} evidence items. Sufficiency: High`);
  });
}
async function wfEvidenceConfirm() {
  const e = W().evidence;
  if (!e.reviewed) return;
  await busy("Recording the evidence review", async () => {
    await sleep(300);
    note(`[AURA] Evidence reviewed by ${ASSIGNEE}: ${e.items.length} items, sufficiency High.${e.note.trim() ? ` Engineer note: ${e.note.trim()}` : ""}`, ASSIGNEE);
    e.done = true;
    wlog(ASSIGNEE, `Reviewed the evidence${e.note.trim() ? " and added a note for the agent" : ""}`);
  });
}
async function wfDraft() {
  const w = W();
  if (w.rca.running) return;
  Object.assign(w.rca, { running: true, step: 0, gate: [], done: false });
  Object.assign(w.review, { root: false, sop: false, warnAck: false });
  S.inc.rca = "running"; commit();
  for (let k = 1; k < DRAFT_STEPS.length; k++) { await sleep(700); w.rca.step = k; render(); }
  await sleep(600);
  const doc = draftDoc(w.rca.attempts + 1, w.rca.feedback);
  S.inc.doc = doc;
  w.rca.gate = qualityGate(doc);
  w.rca.attempts++; w.rca.running = false; w.rca.step = DRAFT_STEPS.length; w.rca.done = !hasFail(w.rca.gate);
  S.inc.rca = "idle";
  wlog("AURA RCA Agent", `Draft ${w.rca.attempts} generated. Quality gate: ${summary(w.rca.gate)}`, hasFail(w.rca.gate) ? "bad" : "warn");
  commit();
}
function approveBlock(w) {
  if (!w.rca.done) return "The draft didn't pass the quality gate.";
  if (!w.review.root) return "Confirm you reviewed the root cause.";
  if (!w.review.sop) return "Confirm the SOP steps are safe to execute.";
  if (hasWarn(w.rca.gate) && !w.review.warnAck) return "Acknowledge the quality-gate warnings.";
  return "";
}
async function wfApprove() {
  const w = W();
  if (approveBlock(w)) return;
  await busy("Posting the approved RCA and SOP", async () => {
    await sleep(500);
    const passed = w.rca.gate.filter((c) => c.status === "pass").length;
    note(workNote(S.inc.doc) + `\n\nREVIEW: Approved by ${ASSIGNEE} after ${w.rca.attempts} draft(s); quality gate ${passed}/${w.rca.gate.length} checks passed.${w.review.comment.trim() ? ` Comment: ${w.review.comment.trim()}` : ""}`, "AURA RCA Agent", true);
    w.review.history.push({ at: nowIso(), decision: "approved", comment: w.review.comment.trim() });
    w.review.done = true; S.inc.rca = "done";
    addExec("rca", "INC0010048", "Success", `RCA and SOP approved by engineer (draft ${w.rca.attempts}); posted to work notes`, 4250);
    wlog(ASSIGNEE, "Approved the RCA and SOP; posted to the incident work notes");
  });
}
async function wfChanges() {
  const w = W(); const c = w.review.comment.trim();
  if (c.length < 15) return;
  await busy("Recording the change request", async () => {
    await sleep(300);
    note(`[AURA] RCA draft ${w.rca.attempts} returned by ${ASSIGNEE} for changes: ${c}`, ASSIGNEE);
    w.review.history.push({ at: nowIso(), decision: "changes", comment: c });
    Object.assign(w.rca, { done: false, gate: [], feedback: c, step: 0 });
    Object.assign(w.review, { root: false, sop: false, warnAck: false, comment: "", done: false });
    w.stage = 3; w.view = 3;
    wlog(ASSIGNEE, `Requested changes to draft ${w.rca.attempts}: "${c}"`, "warn");
  });
}
async function wfExec(retry) {
  const w = W(), x = w.exec, doc = S.inc.doc;
  if (!doc || x.running || x.done) return;
  const n = doc.sop.length, failAt = Math.min(2, n - 1);
  if (!retry) { x.steps = Array.from({ length: n }, () => "pending"); x.log = []; }
  else x.retries++;
  const from = retry ? Math.max(0, x.steps.indexOf("failed")) : 0;
  x.running = true; commit();
  const t = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  for (let k = from; k < n; k++) {
    x.steps[k] = "running"; x.log.push(`[${t()}] step ${k + 1}: ${doc.sop[k]} …`); render();
    await sleep(800);
    if (k === failAt && !x.failedOnce) {
      x.steps[k] = "failed"; x.failedOnce = true; x.running = false;
      x.log.push(`[${t()}] ERROR step ${k + 1}: automation endpoint timed out after 30 s. No changes applied (simulated).`);
      wlog("Remediation automation", `Step ${k + 1} failed: automation timeout. Run stopped; retry or execute manually.`, "bad");
      commit(); return;
    }
    x.steps[k] = "done"; x.log.push(`[${t()}] OK step ${k + 1} completed`);
  }
  finishExec();
}
function finishExec() {
  const w = W(), x = w.exec, doc = S.inc.doc;
  note(`[AURA] ${doc.sopId} ${x.manual ? "executed manually by the engineer" : `executed by automation (simulated)${x.retries ? `, ${x.retries} retry` : ""}`}: ${doc.sop.length}/${doc.sop.length} steps completed.`, x.manual ? ASSIGNEE : "AURA");
  x.running = false; x.done = true;
  wlog(x.manual ? ASSIGNEE : "Remediation automation", `All ${doc.sop.length} SOP steps completed`);
  commit();
}
function wfManual() { const x = W().exec; x.manual = true; x.running = false; x.steps = x.steps.map((s) => (s === "failed" ? "pending" : s)); wlog(ASSIGNEE, "Took over SOP execution manually after the automation failure", "warn"); commit(); }
function wfManualStep(k) { const x = W().exec; if (!x.manual || x.done) return; x.steps[k] = x.steps[k] === "done" ? "pending" : "done"; if (x.steps.every((s) => s === "done")) finishExec(); else commit(); }
async function wfVerify() {
  const v = W().verify, doc = S.inc.doc;
  if (v.running) return;
  v.checks = [
    ck("SOP execution complete", `${doc.sop.length}/${doc.sop.length} steps done${W().exec.manual ? " (manual)" : ""}.`, "pass"),
    ck("Minimum replicas", "payment-api-prod keeps at least 1 warm replica (simulated config read).", "pass"),
    ck("Gateway timeout", "APIM backend timeout now exceeds the worst-case cold start of 44 s (simulated).", "pass"),
    ck("First request after idle", "Synthetic test after 15 min idle: HTTP 200 in 1.3 s (simulated).", "pass"),
    ck("No recurrence", "0 HTTP 504 responses in the last 15 minutes (simulated).", "pass"),
    ck("Related open incidents", "No similar open incidents in the queue (simulated).", "pass"),
  ];
  Object.assign(v, { running: true, shown: 0, confirmed: null, done: false }); commit();
  for (let k = 1; k <= v.checks.length; k++) { await sleep(420); v.shown = k; render(); }
  v.running = false;
  wlog("Service health checks", `Verification: ${summary(v.checks)}`);
  commit();
}
function wfCaller(ok) {
  const w = W();
  if (!ok) {
    note(`[AURA] ${INC.caller} reports the issue still occurs after the SOP. Returning to SOP execution.`, ASSIGNEE);
    Object.assign(w.exec, { done: false, running: false, steps: [], log: [], manual: false });
    Object.assign(w.verify, { checks: [], running: false, shown: 0, confirmed: false, done: false });
    w.stage = 5; w.view = 5;
    wlog(INC.caller, "Reported the issue still occurs. Workflow returned to SOP execution", "bad");
  } else {
    note(`[AURA] Verification passed (${w.verify.checks.length} checks). ${INC.caller} confirmed the issue is resolved.`, ASSIGNEE);
    w.verify.confirmed = true; w.verify.done = !hasFail(w.verify.checks);
    wlog(INC.caller, "Confirmed the issue is resolved");
  }
  commit();
}
async function wfResolve() {
  const w = W(), c = w.close;
  c.checks = closureChecks(c.notes, c.code, S.inc.doc.root);
  if (hasFail(c.checks) || c.done) { commit(); return; }
  await busy("Resolving the incident", async () => {
    await sleep(600);
    S.inc.state = "Resolved";
    S.inc.resolution = { code: c.code, notes: c.notes.trim(), by: ASSIGNEE, at: nowIso() };
    S.inc.activity.unshift({ id: "a" + S.seq++, at: nowIso(), author: ASSIGNEE, kind: "field", fields: [["State", "In Progress", "Resolved"], ["Resolution code", "", c.code]] });
    c.done = true;
    addExec("rca", "INC0010048", "Success", `Incident resolved after validated workflow (${w.review.history.length} review decision(s))`, 1800);
    wlog(ASSIGNEE, `Resolved with "${c.code}"`);
  });
  flashState();
}
function flashState() { UI.flash = true; setTimeout(() => { UI.flash = false; if (route() === "incident-management") render(); }, 1600); }

/* ---------------------------------------------------------------- views */
function checksHtml(list, shown) {
  const l = typeof shown === "number" ? list.slice(0, shown) : list;
  const ic = { pass: "check", warn: "alert", fail: "xcircle" };
  return `<ul class="checks">${l.map((c) => `<li class="rise"><span class="ck-${c.status}">${icon(ic[c.status])}</span><div style="min-width:0"><div class="t">${esc(c.label)}</div><div class="d">${esc(c.detail)}</div></div></li>`).join("")}</ul>`;
}
function gateSummary(c) {
  if (!c.length) return "";
  const n = (s) => c.filter((x) => x.status === s).length;
  return `<span style="display:inline-flex;gap:6px;flex-wrap:wrap">${badge("good", n("pass") + " passed")}${n("warn") ? badge("warning", n("warn") + " warning" + (n("warn") > 1 ? "s" : "")) : ""}${n("fail") ? badge("critical", n("fail") + " failed") : ""}</span>`;
}
const tick = (act, on, text, disabled) => `<label class="tick ${on ? "on" : ""}" style="${disabled ? "opacity:.5;cursor:not-allowed" : ""}"><input type="checkbox" data-act="${act}" ${on ? "checked" : ""} ${disabled ? "disabled" : ""}><span>${text}</span></label>`;
const btn = (act, label, ic, primary, disabled, extra = "") => `<button class="btn ${primary ? "primary" : ""}" data-act="${act}" ${extra} ${disabled ? "disabled" : ""}>${ic ? icon(ic) : ""} ${label}</button>`;
const para = (t) => `<p style="margin:0 0 12px;font-size:12.5px;line-height:1.6;color:var(--ink-soft)">${t}</p>`;

function docHtml(doc) {
  const sec = (t, body, style = "") => `<div style="margin-top:10px;${style}"><div class="eyebrow" style="margin-bottom:4px">${t}</div>${body}</div>`;
  const ul = (a) => `<ul class="dots">${a.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  const ol = (a) => `<ol class="num">${a.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`;
  return `<div style="display:flex;gap:6px;flex-wrap:wrap">${badge("warning", "Scripted demo content")}${badge("good", "Confidence: high")}</div>
    <div style="margin-top:10px;border:1px solid #f3d3d3;background:var(--danger-soft);border-radius:10px;padding:8px 12px"><div class="eyebrow" style="color:var(--danger)">Probable root cause</div><p style="margin:2px 0 0;font-size:12.5px;font-weight:500;line-height:1.6">${esc(doc.root)}</p></div>
    ${sec("Incident summary", `<p style="margin:0;font-size:12.5px;line-height:1.6;color:var(--ink-soft)">${esc(doc.summary)}</p>`)}
    ${sec("Technical explanation", ul(doc.explanation))}${sec("Diagnosis performed", ol(doc.diagnosis))}${sec("Recommended resolution", ol(doc.resolution))}${sec("Preventive measures", ul(doc.prevention))}
    ${doc.assumptions.length ? sec("Assumptions", ul(doc.assumptions)) : ""}
    <div style="margin-top:10px;border:1px solid #cfcff3;background:#f5f5fd;border-radius:10px;padding:8px 12px"><div class="eyebrow" style="color:var(--brand)">SOP · ${doc.sopId} · ${esc(doc.sopTitle)}</div>${ol(doc.sop)}</div>`;
}

const STAGE_BODY = [
  /* 0 intake */ (w) => `${para("Before the agent investigates, the record is checked for what an RCA needs: a clear symptom, enough description, a caller to confirm the fix, and an open state. In the live app this reads the incident fresh from ServiceNow.")}
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:12px">${btn("wf-intake", w.intake.checks.length ? "Re-check" : "Run intake validation", w.intake.checks.length ? "rotate" : "clipboard", !w.intake.checks.length, UI.busy)}<span class="mono-chip">INC0010048</span>${gateSummary(w.intake.checks)}</div>
    ${w.intake.checks.length ? checksHtml(w.intake.checks) : ""}`,
  /* 1 triage */ (w) => `${para(`The incident moves to <b>In Progress</b> and is assigned to <b>${ASSIGNEE}</b> with a triage work note. In the live app each change is read back from ServiceNow and the stage only completes if the instance confirms it.`)}
    ${!w.triage.done ? `<div style="margin-bottom:12px">${btn("wf-triage", "Run triage", "route", true, UI.busy)}</div>` : ""}${w.triage.checks.length ? checksHtml(w.triage.checks) : ""}`,
  /* 2 evidence */ (w) => {
    const e = w.evidence;
    if (!e.collected) return `${para("The agent gathers what it will reason from: the incident record, people's work notes, the configuration item and monitoring telemetry. You review it before any AI analysis runs.")}${btn("wf-collect", "Collect evidence", "search", true, UI.busy)}`;
    return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px;font-size:12.5px"><b style="font-weight:500">${e.items.length} evidence items</b>${badge("good", "Sufficiency: High")}<span style="color:var(--ink-muted)">5 telemetry sources plus the incident record.</span></div>
      <ul class="checks">${e.items.map((x) => `<li><span class="pill ${x.kind === "telemetry" ? "p-info" : ""}" style="${x.kind === "telemetry" ? "" : "background:var(--hover);color:var(--ink-soft)"}">${x.kind === "telemetry" ? "Telemetry" : "Record"}</span><div style="min-width:0"><div class="t">${esc(x.title)}</div><div class="d">${esc(x.detail)}</div><div style="font-size:11px;color:var(--ink-faint)">${x.source}</div></div></li>`).join("")}</ul>
      <div style="margin-top:12px"><label class="flabel" for="wf-engnote">Engineer note for the agent <span>optional, included in the analysis</span></label><textarea class="ta" id="wf-engnote" rows="2" style="margin-top:4px" placeholder="e.g. A config change was deployed to the gateway on Sunday night." ${e.done ? "disabled" : ""}>${esc(e.note)}</textarea></div>
      ${tick("wf-evrev", e.reviewed, "I reviewed the evidence. It belongs to this incident and contains no member or patient data.", e.done)}
      ${!e.done ? `<div style="margin-top:12px">${btn("wf-evconfirm", "Confirm evidence review", "usercheck", true, !e.reviewed || UI.busy)}</div>` : ""}`;
  },
  /* 3 rca */ (w) => {
    const r = w.rca, doc = S.inc.doc;
    let h = r.feedback ? `<div style="border:1px solid #f1d3a6;background:var(--warn-soft);color:var(--warn);border-radius:10px;padding:8px 12px;font-size:12px;line-height:1.55;margin-bottom:12px"><b>Change requested on draft ${r.attempts}:</b> “${esc(r.feedback)}”. The next draft must address it.</div>` : "";
    if (!r.running && !r.gate.length) h += para("The agent drafts the RCA and SOP from the reviewed evidence. An automated quality gate then checks it for completeness, grounding and sensitive data before you see it for approval. Nothing is posted yet.") + btn("wf-draft", r.attempts ? `Generate draft ${r.attempts + 1}` : "Generate RCA draft", "sparkles", true, UI.busy);
    if (r.running || r.gate.length) h += `<ol class="agent-steps">${DRAFT_STEPS.map((s, k) => { const d = !r.running || k < r.step, a = r.running && k === r.step; return `<li class="${d ? "done" : a ? "act" : ""}">${icon(d ? "check" : a ? "loader" : "circle", a ? "spin" : "")}${s}</li>`; }).join("")}</ol>`;
    if (r.gate.length && doc) h += `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin:12px 0 8px"><b style="display:flex;align-items:center;gap:6px;font-size:13px"><span style="color:var(--brand)">${icon("shield")}</span>Quality gate · draft ${r.attempts}</b>${gateSummary(r.gate)}</div>${checksHtml(r.gate)}
      <div style="margin-top:10px;border:1px solid #f3d3d3;background:var(--danger-soft);border-radius:10px;padding:8px 12px"><div class="eyebrow" style="color:var(--danger)">Draft root cause</div><p style="margin:2px 0 0;font-size:13px;font-weight:500;line-height:1.6">${esc(doc.root)}</p></div>
      ${hasFail(r.gate) ? `<div style="margin-top:10px">${btn("wf-draft", "Regenerate draft", "rotate", false, UI.busy)}</div>` : `<p style="margin:10px 0 0;font-size:12px;color:var(--ink-muted)">Draft passed the gate. Continue to the engineer review to read it in full and approve it.</p>`}`;
    return h;
  },
  /* 4 review */ (w) => {
    const rv = w.review, doc = S.inc.doc;
    if (!doc) return para("No draft yet.");
    const block = approveBlock(w);
    const hist = rv.history.length ? `<ul style="list-style:none;margin:0 0 10px;padding:0;font-size:12px">${rv.history.map((h) => `<li style="display:flex;gap:6px;align-items:center;color:${h.decision === "approved" ? "var(--ok)" : "var(--warn)"}">${icon(h.decision === "approved" ? "thumbup" : "thumbdown")}${h.decision === "approved" ? "Approved" : "Changes requested"}${h.comment ? `: “${esc(h.comment)}”` : ""}</li>`).join("")}</ul>` : "";
    const box = `<div class="scroll" style="max-height:420px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;padding:10px 14px">${docHtml(doc)}</div>`;
    if (rv.done) return hist + box + `<div class="okbar" style="margin-top:12px">${icon("check")} Approved and posted to the incident work notes with the approval record.</div>`;
    const warns = w.rca.gate.filter((c) => c.status === "warn").map((c) => c.label.toLowerCase()).join(", ");
    return `${hist}${box}
      ${tick("wf-rroot", rv.root, "I reviewed the root cause and it is consistent with the evidence.")}
      ${tick("wf-rsop", rv.sop, "The SOP steps are correct and safe to run in production.")}
      ${hasWarn(w.rca.gate) ? tick("wf-rwarn", rv.warnAck, `I accept the quality-gate warnings (${esc(warns)}).`) : ""}
      <div style="margin-top:12px"><label class="flabel" for="wf-revcomment">Comment <span>required to request changes (15+ characters)</span></label><textarea class="ta" id="wf-revcomment" rows="2" style="margin-top:4px" placeholder="e.g. Name the exact timeout values and add a rollback step to the SOP.">${esc(rv.comment)}</textarea></div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px">${btn("wf-approve", "Approve &amp; post to work notes", "thumbup", true, block || UI.busy)}<button class="btn danger" data-act="wf-changes" ${rv.comment.trim().length < 15 || UI.busy ? "disabled" : ""}>${icon("thumbdown")} Request changes</button>${block ? `<span style="font-size:11.5px;color:var(--ink-muted)">${block}</span>` : ""}</div>`;
  },
  /* 5 exec */ (w) => {
    const x = w.exec, doc = S.inc.doc;
    if (!doc) return "";
    const failed = x.steps.includes("failed");
    const icons = { done: "check", failed: "xcircle", running: "loader", pending: "circle" };
    return `${para(`The approved SOP <span class="mono-chip">${doc.sopId}</span> runs step by step. If a step fails, the run stops with nothing half-applied, and the engineer decides whether to retry or take over manually. <span style="color:var(--ink-muted)">Automation is simulated.</span>`)}
      ${doc.sop.map((s, k) => { const st = x.steps[k] || "pending"; return `<div class="sopstep ${st}">${x.manual && !x.done ? `<input type="checkbox" data-act="wf-mstep" data-i="${k}" ${st === "done" ? "checked" : ""} style="margin-top:3px;accent-color:#15803d">` : `<span class="${st === "done" ? "ck-pass" : st === "failed" ? "ck-fail" : ""}" style="${st === "running" ? "color:var(--brand)" : st === "pending" ? "color:var(--ink-faint)" : ""}">${icon(icons[st], st === "running" ? "spin" : "")}</span>`}<span class="mono" style="width:16px;text-align:right;font-size:11px;color:var(--ink-muted)">${k + 1}.</span><span>${esc(s)}</span></div>`; }).join("")}
      ${x.log.length ? `<pre class="console scroll">${x.log.map((l) => `<div class="${l.includes("ERROR") ? "e" : l.includes(" OK ") ? "o" : ""}">${esc(l)}</div>`).join("")}</pre>` : ""}
      ${!x.done ? `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px">${!x.steps.length ? btn("wf-exec", "Execute approved SOP", "play", true, UI.busy || x.running) : ""}${failed && !x.manual ? btn("wf-retry", "Retry from failed step", "rotate", true, x.running) + btn("wf-manual", "Take over manually", "hand", false, x.running) : ""}${x.manual ? `<span style="font-size:12px;color:var(--warn)">Manual mode: tick each step as you complete it.</span>` : ""}</div>` : ""}`;
  },
  /* 6 verify */ (w) => {
    const v = w.verify;
    let h = para(`Recovery is verified technically, then by the person affected. If ${INC.caller} says it still fails, the workflow returns to SOP execution.`);
    if (!v.checks.length || (!v.running && v.confirmed === false)) h += `<div style="margin-bottom:12px">${btn("wf-verify", "Run verification checks", "clipboard", true, v.running)}</div>`;
    if (v.checks.length) h += checksHtml(v.checks, v.shown);
    if (v.checks.length && !v.running && v.confirmed === null) h += `<div style="margin-top:12px;border:1px solid var(--line);background:var(--sunken);border-radius:10px;padding:12px 14px"><div style="font-size:12.5px;font-weight:500">Caller confirmation</div><p style="margin:2px 0 8px;font-size:12px;color:var(--ink-soft)">Ask ${INC.caller}: is the issue resolved for you?</p><div style="display:flex;gap:8px;flex-wrap:wrap">${btn("wf-callyes", "Yes, it's working", "thumbup", true, hasFail(v.checks))}<button class="btn danger" data-act="wf-callno">${icon("thumbdown")} No, still failing</button></div></div>`;
    if (v.confirmed) h += `<div class="okbar" style="margin-top:12px">${icon("check")} ${INC.caller} confirmed the issue is resolved.</div>`;
    return h;
  },
  /* 7 close */ (w) => {
    const c = w.close;
    return `<div style="display:grid;gap:12px;grid-template-columns:200px 1fr">
        <div><label class="flabel" for="wf-code">Resolution code</label><select class="sel" id="wf-code" style="margin-top:4px" ${c.done ? "disabled" : ""}><option value="">Choose…</option>${CLOSE_CODES.map((x) => `<option ${x === c.code ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        <div><label class="flabel" for="wf-notes">Resolution notes <span>pre-filled from the approved RCA, edit as needed</span></label><textarea class="ta" id="wf-notes" rows="4" style="margin-top:4px" ${c.done ? "disabled" : ""}>${esc(c.notes)}</textarea></div>
      </div>
      <div id="wf-closechecks" style="margin-top:12px">${c.checks.length ? checksHtml(c.checks) : ""}</div>
      <div style="margin-top:12px">${!c.done ? btn("wf-resolve", "Resolve incident", "usercheck", true, UI.busy || hasFail(c.checks) || !c.checks.length, 'id="wf-resolvebtn"') : `<div class="okbar">${icon("check")} Incident resolved. Workflow complete.</div>`}</div>`;
  },
];
function blockedReason(w, i) {
  return [
    !w.intake.checks.length ? "Run the intake validation to continue." : "Fix the failed checks, then re-check.",
    "Run triage to continue.",
    !w.evidence.collected ? "Collect the evidence to continue." : !w.evidence.reviewed ? "Review the evidence and tick the confirmation." : "Confirm the evidence review.",
    w.rca.gate.length ? "The draft failed the quality gate. Regenerate it." : "Generate the RCA draft to continue.",
    approveBlock(w) || "Approve the RCA, or request changes.",
    w.exec.steps.includes("failed") ? "A step failed. Retry or take over manually." : "Execute the approved SOP to continue.",
    !w.verify.checks.length ? "Run the verification checks." : w.verify.confirmed === null ? "Confirm with the caller." : "Verification has failing checks.",
    "",
  ][i];
}
function stagePanel() {
  const w = W(), i = w.view, st = WF_STAGES[i], d = done(w, i), cur = i === w.stage;
  return `<div class="card" style="min-width:0">
    <div style="display:flex;align-items:flex-start;gap:12px;padding:16px 20px;border-bottom:1px solid var(--line)"><span class="agentico">${icon(st.i)}</span><div style="flex:1;min-width:0"><h2 style="margin:0;font-size:14.5px">Stage ${i + 1} · ${st.t}</h2><p style="margin:0;font-size:12px;color:var(--ink-muted)">${st.s}</p></div>${d ? badge("good", "Completed") : cur ? badge("info", "In progress") : ""}</div>
    <div style="padding:16px 20px">${STAGE_BODY[i](w)}</div>
    ${cur && i < 7 ? `<div class="stagefoot"><span style="font-size:12px;color:${d ? "var(--ok)" : "var(--ink-muted)"}">${d ? "Stage complete. Validations passed." : blockedReason(w, i)}</span>${btn("wf-continue", `Continue to ${WF_STAGES[i + 1].t}`, "arrow", true, !d || UI.busy)}</div>` : ""}
  </div>`;
}

function pageIncident() {
  const w = W(), inc = S.inc;
  const doneCount = WF_STAGES.filter((_, i) => done(w, i)).length;
  const kindOf = (s) => (s === "Resolved" ? "good" : s === "In Progress" ? "running" : s === "On Hold" ? "warning" : "info");
  const rows = [{ ...INC, state: inc.state, assignee: inc.assignee, agent: true }, ...OTHER_INCIDENTS];
  const notes = inc.activity.filter((a) => a.kind === "work_note");
  const tl = { ok: "#22c55e", warn: "#f5b544", bad: "#f04438", info: "#b4b4bf" };
  return `${head("Incident Management – RCA Agent", "A validated, eight-stage RCA workflow. The AURA RCA Agent investigates, but every stage is checked, and nothing is written to the incident without the engineer's approval.", "AI use case · RCA Agent")}
  ${strip("When an incident occurs, engineers investigate, find the root cause, document their findings and look up the right procedure. For a production API this is hours of manual effort, and a wrong root cause is costly.", "The agent validates the record, gathers evidence, drafts the RCA and SOP behind a quality gate, and only posts after an engineer approves. Execution, verification and closure are each checked.")}
  <div class="card" style="margin-bottom:16px;padding:12px 20px;display:flex;flex-wrap:wrap;align-items:center;gap:10px"><span class="eyebrow">ServiceNow</span>${badge("warning", "Offline demo · simulated")}<span style="font-size:12px;color:var(--ink-muted)">This file runs without a server. The live app writes every step to ServiceNow, validates it by reading it back, and drafts the RCA with an LLM.</span></div>
  <div class="card" style="margin-bottom:16px">
    <div style="padding:12px 20px;border-bottom:1px solid var(--line)"><h2 class="sec-title">${icon("inbox")} Incident queue</h2><p style="margin:0;font-size:11.5px;color:var(--ink-muted)">Simulated queue · the RCA workflow runs on INC0010048</p></div>
    <div class="tbl-wrap scroll" style="max-height:260px;overflow:auto"><table class="t" style="min-width:760px"><thead><tr>${["Number", "Short description", "Caller", "Priority", "State", "Assigned to"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>
      ${rows.map((r) => `<tr style="${r.agent ? "background:#f3f3fd" : "color:var(--ink-muted)"}"><td style="white-space:nowrap">${snowLink(r.number, r.agent ? "color:var(--brand)" : "")}${r.agent ? ` <span style="background:var(--brand);color:#fff;border-radius:4px;padding:1px 4px;font-size:9.5px;font-weight:600">AGENT</span>` : ""}</td><td style="max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.short)}</td><td>${r.caller}</td><td>${r.priority}</td><td>${badge(kindOf(r.state), r.state)}</td><td>${r.assignee || "—"}</td></tr>`).join("")}
    </tbody></table></div>
  </div>
  <div class="card pad" style="margin-bottom:16px">
    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px"><div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px"><h2 style="margin:0;font-size:14px">RCA workflow</h2><span class="mono-chip">INC0010048</span>${badge("info", "Simulated telemetry")}</div>
      <div style="display:flex;align-items:center;gap:12px;min-width:220px"><div class="progress" style="flex:1"><div style="width:${(doneCount / 8) * 100}%"></div></div><b style="font-size:12px">${doneCount} / 8 stages</b></div></div>
    <div class="stepper">${WF_STAGES.map((s, i) => `<button class="stp ${done(w, i) ? "done" : ""} ${i === w.view ? "cur" : ""}" data-act="wf-view" data-i="${i}" ${i > w.stage ? "disabled" : ""}><span class="c">${done(w, i) ? "✓" : i + 1}</span>${s.t}</button>`).join("")}</div>
  </div>
  <div class="split" style="grid-template-columns:minmax(0,1.6fr) minmax(330px,1fr)">
    <div style="min-width:0">${UI.busy ? `<p style="margin:0 0 10px;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--brand)">${icon("loader", "spin")} ${UI.busy}…</p>` : ""}${stagePanel()}</div>
    <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
      <div class="card pad"><h2 style="margin:0;font-size:14px">Incident record</h2>
        <dl class="kv" style="margin-top:6px">${[["Number", snowLink("INC0010048")], ["Short description", esc(INC.short)], ["Caller", INC.caller], ["Priority", INC.priority], ["State", `<span style="${UI.flash ? "background:#effbea;border-radius:999px" : ""}">${badge(kindOf(inc.state), inc.state)}</span>`], ["Assigned to", inc.assignee || "—"], ["Assignment group", INC.group], ["Configuration item", INC.ci], ["Category", INC.category]].map(([k, v]) => `<div style="grid-template-columns:120px 1fr"><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
      </div>
      <div class="card" style="min-width:0">
        <div class="subtabs"><button class="subtab ${UI.logTab === "audit" ? "on" : ""}" data-act="wf-tab" data-t="audit">Workflow audit (${w.log.length})</button><button class="subtab ${UI.logTab === "notes" ? "on" : ""}" data-act="wf-tab" data-t="notes">Work notes (${notes.length})</button></div>
        <div class="scroll" style="max-height:460px;overflow-y:auto;padding:12px 16px">
          ${UI.logTab === "audit"
            ? (w.log.length ? `<ol class="tl">${w.log.slice().reverse().map((l) => `<li style="--tl:${tl[l.kind]}"><div style="font-size:12.5px;line-height:1.4">${esc(l.text)}</div><div style="font-size:11px;color:var(--ink-muted)">${esc(l.who)} · ${rel(l.at)}</div></li>`).join("")}</ol>` : `<p style="margin:0;font-size:12.5px;color:var(--ink-muted)">Every validation, decision and write is recorded here.</p>`)
            : (notes.length ? notes.map((n) => `<div style="border:1px solid ${n.ai ? "#cfcff3" : "var(--line)"};background:${n.ai ? "#f8f8fe" : "transparent"};border-radius:9px;padding:8px 12px;margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:8px;font-size:11.5px"><b>${n.ai ? `<span style="color:var(--brand)">✦</span> ` : ""}${esc(n.author)}</b><span style="color:var(--ink-muted)">${stamp(n.at)}</span></div><div class="scroll" style="margin-top:4px;max-height:180px;overflow-y:auto;white-space:pre-wrap;font-size:12px;line-height:1.55;color:var(--ink-soft)">${esc(n.text)}</div></div>`).join("") : `<p style="margin:0;font-size:12.5px;color:var(--ink-muted)">No work notes yet.</p>`)}
        </div>
      </div>
    </div>
  </div>
  ${simnote("Offline demo: the telemetry, the RCA draft and the SOP automation are simulated. INC0010048 is a link because the same incident exists in the POC ServiceNow instance; its live state there reflects the live demo, not this offline run. The live app runs the same eight stages against a real ServiceNow instance, drafts the RCA with an LLM, and validates every write by reading it back.")}`;
}
</script>
