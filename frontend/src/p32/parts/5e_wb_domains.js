<script>
"use strict";
/* =====================================================================
   Digital FrontDoor domains: IT Incidents (5a), IT Assets and HR (here).
   Same run model, orchestrator loop, approval gates, audit trail and
   Live/Demo modes as the incident workflow.
   ===================================================================== */
const WB_FLOWS = {
  incident: { label: "IT Incidents", icon: "siren", first: "intake", stages: WB_STAGES },
  asset: { label: "IT Assets", icon: "laptop", first: "a_intake", stages: [
    { title: "Intake", nodes: ["a_intake"] }, { title: "Asset context", nodes: ["a_context"] }, { title: "Lifecycle decision", nodes: ["a_decision"] },
    { title: "Asset manager approval", nodes: ["a_approval"] }, { title: "Fulfillment", nodes: ["a_fulfil"] }, { title: "Verification & closure", nodes: ["a_verify", "a_close"] } ] },
  hr: { label: "HR", icon: "users", first: "h_intake", stages: [
    { title: "Intake", nodes: ["h_intake"] }, { title: "Policy & eligibility", nodes: ["h_policy"] }, { title: "Plan", nodes: ["h_plan"] },
    { title: "HR partner approval", nodes: ["h_approval"] }, { title: "Fulfillment", nodes: ["h_fulfil"] }, { title: "Verification & closure", nodes: ["h_verify", "h_close"] } ] },
};
Object.assign(WB_NODES, {
  a_intake: { name: "Asset Intake Agent", short: "Intake", kind: "agent", icon: "inbox", stage: 0, role: "Works out which device is affected, what is wrong with it (fault, damage, loss, upgrade) and the impact on the employee's work." },
  a_context: { name: "Asset Context Agent", short: "Asset context", kind: "agent", icon: "laptop", stage: 1, role: "Pulls the real asset record and the device's incident history from ServiceNow, adds device health readings, and summarises what matters for the decision." },
  a_decision: { name: "Lifecycle Decision Agent", short: "Decision", kind: "agent", icon: "sparkles", stage: 2, role: "Applies the lifecycle policy (warranty, age, repair cost, role) to recommend repair, replacement or a loaner, and the catalog items to order." },
  a_approval: { name: "Asset manager approval", short: "Approval", kind: "human", icon: "usercheck", stage: 3, role: "Human gate: the asset manager approves the recommendation (and its cost) before anything is ordered." },
  a_fulfil: { name: "Fulfillment Agent", short: "Fulfillment", kind: "agent", icon: "send", stage: 4, role: "Places the approved Service Catalog orders in ServiceNow and records the data-handling steps." },
  a_verify: { name: "Verification Agent", short: "Verification", kind: "agent", icon: "activity", stage: 5, role: "Reads the requests back from ServiceNow and checks each approved item became a request item with its approvals and tasks." },
  a_close: { name: "Closure Agent", short: "Closure", kind: "agent", icon: "door", stage: 5, role: "Writes the fulfilment-team note and a plain-language update for the employee." },
  h_intake: { name: "HR Intake Agent", short: "Intake", kind: "agent", icon: "inbox", stage: 0, role: "Understands the HR request (onboarding, leave, benefits, policy), who it is for and the key dates, without collecting sensitive personal data." },
  h_policy: { name: "HR Policy Agent", short: "Policy", kind: "agent", icon: "file", stage: 1, role: "Answers from the HR policy library (synthetic for this POC), states eligibility and conditions, and flags anything the policies don't cover." },
  h_plan: { name: "HR Plan Agent", short: "Plan", kind: "agent", icon: "clipboard", stage: 2, role: "Builds the action plan: tasks, owner teams, due dates and systems, plus any ServiceNow requests needed (for example New Hire)." },
  h_approval: { name: "HR partner approval", short: "Approval", kind: "human", icon: "usercheck", stage: 3, role: "Human gate: an HR partner confirms the answer and plan before anything is requested or sent." },
  h_fulfil: { name: "Fulfillment Agent", short: "Fulfillment", kind: "agent", icon: "send", stage: 4, role: "Places the approved ServiceNow requests (for example New Hire and laptop) and records the HR case actions." },
  h_verify: { name: "Verification Agent", short: "Verification", kind: "agent", icon: "activity", stage: 5, role: "Reads the requests back from ServiceNow and checks every planned task has an owner and a date." },
  h_close: { name: "Closure Agent", short: "Closure", kind: "agent", icon: "door", stage: 5, role: "Sends the requester a plain-language answer and next steps, and notes the case for the fulfilment teams." },
});
const wbFlowOf = (x) => (x && x.flow) || "incident";
function wbStagesFor(x) { return WB_FLOWS[wbFlowOf(x && x.incId ? wbInc(x.incId) || x : x)].stages; }
function wbStagesOfNode(key) { for (const f of Object.values(WB_FLOWS)) if (f.stages.some((s) => s.nodes.includes(key))) return f.stages; return WB_STAGES; }
const WB_ALLOWED = { asset: ["Standard Laptop", "Loaner Laptop", "Developer Laptop (Mac)"], hr: ["New Hire", "Standard Laptop"] };

/* -------------------------------------------------------- items & runs */
function wbRequestsFor(flow) {
  const subs = WB.submitted.filter((s) => s.flow === flow);
  const replaced = new Set(subs.map((s) => s.replaces));
  return [...subs, ...(WB_DATA.requests || []).filter((c) => c.flow === flow && !replaced.has(c.id))];
}
const _wbIncBase = wbInc;
wbInc = function (id) { return _wbIncBase(id) || (WB_DATA.requests || []).find((r) => r.id === id) || null; };
const _wbNewRunBase = wbNewRun;
wbNewRun = function (inc) { const run = _wbNewRunBase(inc); run.flow = wbFlowOf(inc); run.next = WB_FLOWS[run.flow].first; run.orders = []; return run; };
const _wbStageOfBase = wbStageOf;
wbStageOf = function (inc) {
  if (wbFlowOf(inc) === "incident") return _wbStageOfBase(inc);
  const r = WB.runs[inc.id];
  if (!r || r.status === "ready") return { stage: "Not started", agent: `Waiting for ${WB_NODES[WB_FLOWS[wbFlowOf(inc)].first].name}` };
  if (r.status === "completed") return { stage: "Closed", agent: "—" };
  if (r.status === "declined") return { stage: "Declined", agent: "—" };
  const key = r.gate && r.gate.node ? r.gate.node : r.next || r.current;
  const n = WB_NODES[key] || WB_NODES[WB_FLOWS[wbFlowOf(inc)].first];
  return { stage: wbStagesOfNode(key)[n.stage].title, agent: n.kind === "human" ? `${n.name} (human)` : n.name };
};
WB_STATUS.declined = { label: "Declined", kind: "info" };
function wbScenarioFor(inc) {
  if (inc.script) return inc;
  const reqs = WB_DATA.requests || [];
  if (inc.flow === "asset") return reqs.find((r) => r.flow === "asset" && inc.asset_tag && r.asset_tag && r.asset_tag.toLowerCase() === inc.asset_tag.toLowerCase()) || (!inc.asset_tag ? reqs.find((r) => r.id === "DEMO-AST-001") : null);
  if (inc.flow === "hr") { const t = `${inc.title} ${inc.description}`.toLowerCase(); return reqs.find((r) => r.id === (/onboard|new hire|starts on|joins|start date/.test(t) ? "DEMO-HR-001" : /benefit|spouse|married|marriage|dependent|medical/.test(t) ? "DEMO-HR-003" : /leave|parental|maternity|paternity|baby/.test(t) ? "DEMO-HR-002" : "")) || null; }
  return null;
}
function wbYears(date) { if (!date) return null; const d = Date.parse(date); return isNaN(d) ? null : Math.round(((Date.now() - d) / (365.25 * 86400000)) * 10) / 10; }
function wbWarranty(exp) { if (!exp) return "unknown"; return Date.parse(exp) < Date.now() ? "expired" : "in_warranty"; }
function wbReqCtx(inc) { return { id: inc.id, title: inc.title, description: inc.description, requested_by: inc.reported_by, area: WB_FLOWS[wbFlowOf(inc)].label, asset_tag: inc.asset_tag || "", reported_at: wbReportedAt(inc), additional_details: (WB.runs[inc.id] || {}).extraInfo || "" }; }
async function wbIntakeChecksStep(run, key, inc) {
  const words = wbWords(inc.description) + wbWords(run.extraInfo);
  const checks = [
    inc.title && inc.title.length >= 10 ? { label: "Short summary", status: "pass", detail: inc.title } : { label: "Short summary", status: "fail", detail: "Missing or under 10 characters." },
    words >= 8 ? { label: "Request detail", status: "pass", detail: `${words} words.` } : { label: "Request detail", status: words >= 3 ? "warn" : "fail", detail: `Only ${words} words.` },
    inc.reported_by ? { label: "Requester", status: "pass", detail: inc.reported_by } : { label: "Requester", status: "fail", detail: "No requester." },
  ];
  await wbTool(run, key, { name: "Request completeness checks", source: "rules", input: "Required details", run: () => checks, summarize: (c) => `${c.filter((x) => x.status === "pass").length} of ${c.length} checks pass` });
  return checks;
}
function wbIntakeGate(run, key, out, checks) {
  const rulesFail = checks.some((c) => c.status === "fail");
  if (out.validation === "needs_info" || rulesFail) { wbGate(run, "attention", { type: "intake_info", node: key, missing: out.missing_info || [] }, "More information is needed from the requester before the agents continue."); return true; }
  return false;
}
/* Progress note to ServiceNow (incidents with a ServiceNow record, Live mode). Stage status only, never RCA content. */
function wbProgressNote(run, text) {
  if (!run || run.mode !== "live" || !run.sn || wbFlowOf(run) !== "incident") return;
  wbApi("tool", { run_id: run.id, tool: "sn_note", args: { kind: "progress", text } }).then((r) => { wbEvent(run, "ServiceNow Work Notes API", "tool", r.ok ? `Progress note posted to ${run.sn.number}: ${text}` : `Progress note not posted: ${r.error}`, r.ok ? "ok" : "warn"); wbSave(); });
}
const _wbDoneBase = wbDone;
wbDone = function (run, key, decision, next) {
  _wbDoneBase(run, key, decision, next);
  const o = (run.nodes[key] || {}).output || {};
  const msg = {
    intake: () => "Intake validated by the Intake & Validation Agent; triage started.",
    triage: () => `Triage recommendation: ${o.assignment_group || "group n/a"}, priority ${o.priority_recommendation || "n/a"} (recommendation only, fields not changed). Investigation started.`,
    judge: () => (next === "rca" ? `Investigation complete after ${run.round} round(s); root cause analysis being drafted (pending engineer approval).` : next === "evidence" ? `Investigation round ${run.round - 1}: the Judge requested more evidence; round ${run.round} started.` : ""),
    quality: () => (next === "rca" ? "RCA draft returned by the quality gate for correction." : "RCA passed the nine-check quality gate; waiting for engineer approval."),
    sop: () => `SOP v${run.sopVersion} generated; waiting for engineer approval before execution.`,
    verification: () => (next === "closure" ? "Verification passed: symptoms resolved." : "Verification failed: remediation reopened."),
  }[key];
  const text = msg && msg();
  if (text) wbProgressNote(run, text);
};

/* ---------------------------------------------------------- asset steps */
async function wbStepAIntake(run) {
  const inc = wbInc(run.incId); const scen = wbScenarioFor(inc);
  wbNodeStart(run, "a_intake");
  const checks = await wbIntakeChecksStep(run, "a_intake", inc);
  const out = await wbAgent(run, "a_intake", { request: wbReqCtx(inc), required_field_checks: checks }, () => ({
    issue_summary: inc.title, request_type: /crack|drop|spill|damage/i.test(inc.description) ? "damage" : /lost|stolen/i.test(inc.description) ? "loss" : "fault",
    symptoms: String(inc.description).split(/(?<=\.)\s+/).slice(0, 3), asset_tag_mentioned: inc.asset_tag || "", business_impact: "The employee can't work normally on this device.",
    missing_info: checks.some((c) => c.status !== "pass") ? ["Which device, what happens and since when"] : [], validation: checks.some((c) => c.status === "fail") ? "needs_info" : "pass", reasoning: scen ? "Device and symptoms are clear enough to look up the asset." : "Request is clear enough to look up the asset.",
  }));
  if (!out) return wbFail(run, "a_intake");
  if (wbIntakeGate(run, "a_intake", out, checks)) return;
  if (out.asset_tag_mentioned && !inc.asset_tag) run.assetTag = String(out.asset_tag_mentioned).trim();
  wbDone(run, "a_intake", "Request validated; handed to the Asset Context Agent.", "a_context");
}
async function wbStepAContext(run) {
  const inc = wbInc(run.incId); const scen = wbScenarioFor(inc);
  wbNodeStart(run, "a_context");
  const tag = inc.asset_tag || run.assetTag || "";
  let asset = null, history = [];
  if (run.mode === "live") {
    const t = await wbTool(run, "a_context", { name: "ServiceNow asset lookup (alm_hardware)", source: "live", input: tag ? `Asset tag ${tag}` : "The requester's own computer", live: { tool: "sn_asset_lookup", args: tag ? { asset_tag: tag } : {} }, summarize: (r) => (r.found ? `${r.display_name}; assigned to ${r.assigned_to}; purchased ${r.purchase_date || "(no date)"}; warranty ${r.warranty_expiration || "(no date)"}` : r.reason) });
    if (t.status === "ok" && t.result.found) asset = t.result;
    if (asset) { const h = await wbTool(run, "a_context", { name: "ServiceNow incident history for the device", source: "live", input: asset.ci || asset.asset_tag, live: { tool: "sn_ci_history", args: {} }, summarize: (r) => (r.incidents.length ? `${r.incidents.length} incident(s) in 2 years` : r.note || "No incidents in 2 years") }); if (h.status === "ok") history = h.result.incidents; }
    if (!asset) { run.nodes.a_context.error = `No asset found in ServiceNow${tag ? ` for tag ${tag}` : " for the requester"}. Check the asset tag and retry.`; return wbFail(run, "a_context"); }
  } else {
    asset = scen ? { ...scen.asset_snapshot, url: "" } : null;
    await wbTool(run, "a_context", { name: "ServiceNow asset lookup (alm_hardware)", source: "simulated", input: tag || "The requester's own computer", run: () => asset || { found: false }, summarize: (r) => (r.display_name ? `${r.display_name} (snapshot of the POC ServiceNow record)` : "No snapshot for this device") });
    if (!asset) { run.nodes.a_context.error = "Controlled Demo Mode has no asset snapshot for this device; switch to Live Agent Mode to look it up."; return wbFail(run, "a_context"); }
  }
  const telemetry = scen && scen.asset_snapshot && scen.asset_snapshot.asset_tag === asset.asset_tag ? scen.telemetry : [];
  await wbTool(run, "a_context", { name: "Device health readings", source: "simulated", input: asset.asset_tag, run: () => telemetry, summarize: (r) => (r.length ? `${r.length} reading(s)` : "No device telemetry connector for this device (POC)") });
  const facts = { age_years: wbYears(asset.purchase_date), warranty_status: wbWarranty(asset.warranty_expiration), purchase_date: asset.purchase_date || "(not recorded)", warranty_expiration: asset.warranty_expiration || "(not recorded)" };
  run.asset = { ...asset, ...facts, telemetry, history };
  const out = await wbAgent(run, "a_context", { request: wbReqCtx(inc), intake: wbOut(run, "a_intake"), asset_record: asset, computed_facts: facts, incident_history: history, device_health_readings: telemetry }, () => ({
    asset_summary: `${asset.display_name}, assigned to ${asset.assigned_to} (${asset.department}), ${asset.install_status}.`, age_years: facts.age_years || 0, warranty_status: facts.warranty_status,
    history_summary: history.length ? `${history.length} incidents on this device in 2 years.` : "No incidents recorded against this device.", health_findings: telemetry.map((t) => `${t.id}: ${t.reading}`), risks: /SSD|disk/i.test(JSON.stringify(telemetry)) ? ["Rising disk errors: risk of data loss; back up first"] : [],
    gaps: scen.script.gap ? [scen.script.gap] : [],
  }));
  if (!out) return wbFail(run, "a_context");
  wbDone(run, "a_context", `Asset context ready (${asset.asset_tag}, warranty ${facts.warranty_status}${facts.age_years != null ? `, ${facts.age_years} years old` : ", age unknown"}). Handed to the Lifecycle Decision Agent.`, "a_decision");
}
async function wbStepADecision(run) {
  const inc = wbInc(run.incId); const scen = wbScenarioFor(inc);
  wbNodeStart(run, "a_decision");
  run.policyEval = wbAssetPolicyEval(run);
  await wbTool(run, "a_decision", { name: "Lifecycle policy evaluation", source: "rules", input: `${run.asset.asset_tag}: warranty, age, repair cost, role`, run: () => run.policyEval, summarize: (r) => `Allowed: ${r.allowed_recommendations.map((x) => x.replace(/_/g, " ")).join(" or ")}. ${r.notes.join(" ")}` });
  const ctx = { request: wbReqCtx(inc), policy_evaluation: run.policyEval, instruction: "Choose the recommendation from policy_evaluation.allowed_recommendations and order exactly the catalog items listed for it in policy_evaluation.catalog_items_for. Explain the choice citing the policy notes.", intake: wbOut(run, "a_intake"), asset_context: wbOut(run, "a_context"), asset_facts: { tag: run.asset.asset_tag, model: run.asset.model, department: run.asset.department, age_years: run.asset.age_years, warranty_status: run.asset.warranty_status, cost: run.asset.cost }, device_health_readings: run.asset.telemetry, lifecycle_policy: WB_DATA.asset_policy, allowed_catalog_items: WB_ALLOWED.asset, asset_manager_feedback: run.feedback.decision || "" };
  const out = await wbAgent(run, "a_decision", ctx, () => ({
    recommendation: scen.script.recommendation, rationale: `${scen.script.rules[0]}. ${run.feedback.decision ? `Revised after asset manager feedback: ${run.feedback.decision}.` : ""}`.trim(), policy_rules_applied: scen.script.rules, catalog_items: scen.script.catalog_items,
    estimated_cost: scen.script.cost, data_handling: ["Back up the user's data to OneDrive before the swap or repair (AP-4)", "Wipe the returned device to NIST 800-88 (AP-4)"], employee_impact: scen.script.recommendation === "replace" ? "A new laptop is prepared; data is moved over at hand-over." : "A loaner laptop is provided while the device is repaired.", confidence: "high",
  }));
  if (!out) return wbFail(run, "a_decision");
  const asked = wbArr(out.catalog_items).map(String);
  out.catalog_items = asked.filter((x) => WB_ALLOWED.asset.includes(x));
  const dropped = asked.filter((x) => !WB_ALLOWED.asset.includes(x));
  run.decAttempt = (run.decAttempt || 0) + 1;
  const checks = wbAssetPolicyChecks(run, out);
  await wbTool(run, "a_decision", { name: "Lifecycle policy consistency check", source: "rules", input: `${out.recommendation} · ${out.catalog_items.join(", ") || "no items"}`, run: () => checks, summarize: (c) => (c.some((x) => x.status === "fail") ? `${c.filter((x) => x.status === "fail").length} rule(s) violated` : "Consistent with the asset facts and policy") });
  run.nodes.a_decision.output.policy_checks = checks;
  const bad = checks.filter((c) => c.status === "fail");
  if (bad.length) {
    if (run.decAttempt < 3) { run.feedback.decision = `Policy check failed: ${bad.map((c) => c.detail).join(" ")} Fix the recommendation and catalog items.`; return wbDone(run, "a_decision", `Policy check failed (${bad.map((c) => c.label).join(", ")}); returned to the Lifecycle Decision Agent with the correction.`, "a_decision"); }
    return wbGate(run, "attention", { type: "policy_exhausted", node: "a_decision" }, "The decision failed the policy check 3 times; an asset manager must decide.");
  }
  wbDone(run, "a_decision", `Recommendation: ${String(out.recommendation).replace(/_/g, " ")}${out.catalog_items.length ? ` (order: ${out.catalog_items.join(", ")})` : ""}.${dropped.length ? ` Not orderable and removed: ${dropped.join(", ")}.` : ""} Paused for asset manager approval.`, null);
  const a = wbNodeStart(run, "a_approval"); a.source = "human"; a.input = { recommendation: out.recommendation, items: out.catalog_items, cost: out.estimated_cost };
  wbGate(run, "waiting", { type: "asset", node: "a_approval" }, "Waiting for the asset manager to approve the recommendation.");
}
/* Deterministic policy evaluation (the rules engine): the agent chooses and explains within what the policy allows. */
function wbAssetPolicyEval(run) {
  const a = run.asset; const intake = wbOut(run, "a_intake") || {};
  const text = wbArr(a.telemetry).map((t) => t.reading).join(" ");
  const est = (text.match(/Repair estimate[^\n]*?\$([\d,]+)(?![\s\S]*\$)/) || [])[1];
  const repairCost = est ? Number(est.replace(/,/g, "")) : null;
  const days = Number((text.match(/turnaround:\s*(\d+)/i) || [])[1] || 0) || null;
  const tech = /^(it|engineering|development|technology)/i.test(a.department || "");
  const model = tech ? "Developer Laptop (Mac)" : "Standard Laptop";
  const half = 550; const notes = [];
  let allowed = [];
  const damage = intake.request_type === "damage";
  if (a.age_years != null && a.age_years > 4) { allowed = ["replace"]; notes.push(`AP-2: ${a.age_years} years old (over 4), so replace.`); }
  else if (damage) { allowed = days && days > 2 ? ["loaner_and_repair"] : ["paid_repair", "repair_under_warranty"].filter((r) => r !== "repair_under_warranty" || a.warranty_status === "in_warranty"); notes.push(`AP-3: accidental damage${days ? `, repair takes ${days} business days` : ""}${days && days > 2 ? ", so provide a loaner" : ""}.`); }
  else if (a.warranty_status === "in_warranty") { allowed = ["repair_under_warranty"]; notes.push("AP-1: hardware fault on an in-warranty device, so vendor repair under warranty."); }
  else if (repairCost != null) { allowed = repairCost > half ? ["replace"] : ["paid_repair"]; notes.push(`AP-2: warranty ${String(a.warranty_status).replace("_", " ")}; repair $${repairCost} is ${Math.round((repairCost / 1100) * 100)}% of the $1,100 replacement (${repairCost > half ? "over" : "within"} the 50% limit).`); }
  else { allowed = ["paid_repair", "replace"]; notes.push(`AP-2: warranty ${String(a.warranty_status).replace("_", " ")} and no repair estimate; choose and explain.`); }
  const items = { replace: [model], loaner_and_repair: ["Loaner Laptop"], repair_under_warranty: [], paid_repair: [], no_action: [] };
  if (allowed.includes("replace")) notes.push(`AP-5: ${a.department || "this"} staff get the ${model}.`);
  return { repair_cost: repairCost, repair_days: days, warranty_status: a.warranty_status, age_years: a.age_years, allowed_recommendations: allowed, catalog_items_for: Object.fromEntries(allowed.map((r) => [r, items[r]])), notes };
}
function wbAssetPolicyChecks(run, d) {
  const a = run.asset; const items = wbArr(d.catalog_items); const rec = d.recommendation;
  const laptops = items.filter((x) => x !== "Loaner Laptop"); const loaner = items.includes("Loaner Laptop");
  const tech = /^(it|engineering|development|technology)/i.test(a.department || "");
  const want = tech ? "Developer Laptop (Mac)" : "Standard Laptop";
  const ws = String(a.warranty_status).replace("_", " ");
  const c = [];
  const ev = run.policyEval;
  if (ev) c.push(ev.allowed_recommendations.includes(rec) ? { label: "Allowed by policy", status: "pass", detail: `${String(rec).replace(/_/g, " ")} is allowed: ${ev.notes[0]}` } : { label: "Allowed by policy", status: "fail", detail: `The policy allows only ${ev.allowed_recommendations.map((r) => r.replace(/_/g, " ")).join(" or ")} here (${ev.notes.join(" ")}), not ${String(rec).replace(/_/g, " ")}.` });
  c.push(rec === "repair_under_warranty" && a.warranty_status !== "in_warranty" ? { label: "Warranty", status: "fail", detail: `Repair under warranty (AP-1) needs an in-warranty device, but the warranty is ${ws}.` } : { label: "Warranty", status: "pass", detail: `Warranty ${ws}; consistent with ${String(rec).replace(/_/g, " ")}.` });
  if (rec === "replace") c.push(laptops.length === 1 && !loaner ? { label: "Replacement order", status: "pass", detail: `Orders one ${laptops[0]}.` } : { label: "Replacement order", status: "fail", detail: "A replacement orders exactly one new laptop and no loaner." });
  if (rec === "replace" && laptops.length === 1) c.push(laptops[0] === want ? { label: "Model for role (AP-5)", status: "pass", detail: `${want} for ${a.department || "this"} staff.` } : { label: "Model for role (AP-5)", status: "fail", detail: `${a.department || "This"} staff get the ${want}, not the ${laptops[0]}.` });
  if (rec === "loaner_and_repair") c.push(loaner && !laptops.length ? { label: "Loaner order", status: "pass", detail: "Orders a Loaner Laptop only." } : { label: "Loaner order", status: "fail", detail: "Loaner-and-repair orders only a Loaner Laptop." });
  if (rec === "repair_under_warranty" || rec === "paid_repair") c.push(!laptops.length ? { label: "No purchase for a repair", status: "pass", detail: loaner ? "Loaner only." : "No order." } : { label: "No purchase for a repair", status: "fail", detail: "A repair doesn't buy a new laptop." });
  if (rec === "no_action") c.push(!items.length ? { label: "No action", status: "pass", detail: "Nothing ordered." } : { label: "No action", status: "fail", detail: "No action means no orders." });
  return c;
}
async function wbFulfil(run, key, domain, items, note) {
  if (!items.length) return [];
  const orders = [];
  for (const item of items) {
    if (run.mode === "live") {
      const t = await wbTool(run, key, { name: "ServiceNow Service Catalog order", source: "live", input: item, live: { tool: "sn_catalog_order", args: { domain, item, note } }, summarize: (r) => `${r.request} created (${r.ritms.map((x) => x.number).join(", ") || "no items yet"})` });
      if (t.status !== "ok") { run.nodes[key].error = `Order for ${item} failed: ${t.error}`; return null; }
      orders.push({ item, ...t.result });
    } else {
      const n = `REQ-DEMO-${String(1000 + Object.keys(WB.runs).length * 3 + orders.length).slice(-4)}`;
      await wbTool(run, key, { name: "ServiceNow Service Catalog order", source: "simulated", input: item, pace: 300, run: () => ({ request: n, ritms: [{ number: n.replace("REQ", "RITM") }] }), summarize: (r) => `${r.request} (simulated; Controlled Demo Mode makes no ServiceNow calls)` });
      orders.push({ item, request: n, ritms: [{ number: n.replace("REQ", "RITM") }], simulated: true });
    }
  }
  return orders;
}
async function wbStepAFulfil(run) {
  const inc = wbInc(run.incId);
  wbNodeStart(run, "a_fulfil"); run.nodes.a_fulfil.source = "tools";
  const d = wbOut(run, "a_decision");
  run.nodes.a_fulfil.input = { approved_items: d.catalog_items, recommendation: d.recommendation };
  const note = `${inc.title}. Asset ${run.asset.asset_tag}. Approved: ${String(d.recommendation).replace(/_/g, " ")}. ${d.rationale}`;
  const orders = await wbFulfil(run, "a_fulfil", "asset", d.catalog_items, note);
  if (orders === null) return wbFail(run, "a_fulfil");
  await wbTool(run, "a_fulfil", { name: "Data handling steps", source: "simulated", input: run.asset.asset_tag, run: () => wbArr(d.data_handling), summarize: (r) => `${r.length} step(s) scheduled with the hand-over (simulated)` });
  if (!d.catalog_items.length) await wbTool(run, "a_fulfil", { name: "Vendor repair booking", source: "simulated", input: run.asset.asset_tag, run: () => ({ booked: true }), summarize: () => "Vendor repair booked (simulated: no repair catalog item in the POC instance)" });
  run.orders = orders;
  if (run.mode === "live" && orders.length) await wbTool(run, "a_fulfil", { name: "ServiceNow request work notes", source: "live", input: orders.map((o) => o.request).join(", "), live: { tool: "sn_request_note", args: { domain: "asset", text: `[AURA Asset Agents] ${note}\nPolicy: ${wbArr(d.policy_rules_applied).join("; ")}\nData handling: ${wbArr(d.data_handling).join("; ")}\nApproved by the asset manager in the Agentic Workbench.` } }, summarize: (r) => `Note posted to ${r.posted} request item(s)` });
  run.nodes.a_fulfil.output = { orders, recommendation: d.recommendation };
  wbDone(run, "a_fulfil", orders.length ? `Ordered: ${orders.map((o) => `${o.item} → ${o.request}`).join("; ")}. Handed to the Verification Agent.` : "No catalog order needed; repair booked. Handed to the Verification Agent.", "a_verify");
}
async function wbVerifyOrders(run, key) {
  const checks = [];
  if (!run.orders.length) { checks.push({ label: "ServiceNow requests", status: "pass", detail: "None needed for this outcome." }); return checks; }
  if (run.mode === "live") {
    const t = await wbTool(run, key, { name: "ServiceNow request read-back", source: "live", input: run.orders.map((o) => o.request).join(", "), live: { tool: "sn_request_readback", args: {} }, summarize: (r) => r.orders.map((o) => `${o.request.number || "?"}: ${o.request.request_state || "?"}, ${o.items.length} item(s), ${o.approvals.length} approval(s), ${o.tasks.length} task(s)`).join("; ") });
    if (t.status !== "ok") { checks.push({ label: "Read-back", status: "fail", detail: t.error }); return checks; }
    for (const o of t.result.orders) {
      checks.push(o.request.number ? { label: `${o.item}: request`, status: "pass", detail: `${o.request.number} is ${o.request.request_state || o.request.stage}; approval ${o.request.approval || "n/a"}` } : { label: `${o.item}: request`, status: "fail", detail: "Not found in ServiceNow." });
      checks.push(o.items.length ? { label: `${o.item}: request item`, status: "pass", detail: o.items.map((i) => `${i.number} (${i.stage || i.state})`).join(", ") } : { label: `${o.item}: request item`, status: "fail", detail: "No request item created." });
      checks.push({ label: `${o.item}: approvals and tasks`, status: "pass", detail: `${o.approvals.length} approval(s), ${o.tasks.length} fulfilment task(s) so far; fulfilment continues in ServiceNow.` });
    }
  } else {
    await wbTool(run, key, { name: "ServiceNow request read-back", source: "simulated", input: run.orders.map((o) => o.request).join(", "), run: () => run.orders, summarize: () => "Simulated read-back (Controlled Demo Mode)" });
    run.orders.forEach((o) => checks.push({ label: `${o.item}: request`, status: "pass", detail: `${o.request} (simulated)` }));
  }
  return checks;
}
async function wbStepAVerify(run) {
  wbNodeStart(run, "a_verify"); run.nodes.a_verify.source = "tools";
  const checks = await wbVerifyOrders(run, "a_verify");
  checks.push({ label: "Data handling scheduled", status: "pass", detail: wbArr(wbOut(run, "a_decision").data_handling).join("; ") });
  run.nodes.a_verify.output = { checks };
  if (checks.some((c) => c.status === "fail")) { run.nodes.a_verify.error = checks.filter((c) => c.status === "fail").map((c) => `${c.label}: ${c.detail}`).join(" "); return wbFail(run, "a_verify"); }
  wbDone(run, "a_verify", "Verified against ServiceNow. Handed to the Closure Agent.", "a_close");
}
async function wbStepClose(run, key, domain) {
  const inc = wbInc(run.incId);
  wbNodeStart(run, key);
  const decided = domain === "asset" ? wbOut(run, "a_decision") : { answer: wbOut(run, "h_policy").answer, plan: wbOut(run, "h_plan") };
  const out = await wbAgent(run, key, { request: wbReqCtx(inc), decision: decided, servicenow_requests: run.orders.map((o) => ({ item: o.item, request: o.request })), verification: (run.nodes[domain === "asset" ? "a_verify" : "h_verify"].output || {}).checks }, () => ({
    summary: domain === "asset" ? `${String(decided.recommendation).replace(/_/g, " ")} for ${run.asset.asset_tag}${run.orders.length ? `; ordered ${run.orders.map((o) => `${o.item} (${o.request})`).join(", ")}` : ""}.` : `${wbOut(run, "h_intake").request_type} request answered${run.orders.length ? `; ServiceNow requests ${run.orders.map((o) => o.request).join(", ")}` : ""}.`,
    work_note: domain === "asset" ? `Fulfil per approved recommendation; ${wbArr(decided.data_handling).join("; ")}.` : `Follow the approved plan: ${wbArr(decided.plan.tasks).length} tasks.`,
    employee_update: domain === "asset" ? decided.employee_impact : decided.plan.employee_message,
  }));
  if (!out) return wbFail(run, key);
  run.closeNote = out;
  run.snResult = run.mode === "live" ? (run.orders.length ? { written: true, reason: `Requests ${run.orders.map((o) => o.request).join(", ")} placed and read back` } : { written: false, reason: domain === "hr" ? "No ServiceNow request needed; the HR case is recorded in the workbench (the HR case module isn't installed in the POC instance)." : "No catalog order needed." }) : { written: false, reason: "Controlled Demo Mode makes no ServiceNow calls." };
  wbDone(run, key, `Closed. ${run.snResult.reason}`, null);
  run.status = "completed"; run.ended = wbNow(); run.current = null;
  wbEvent(run, "Orchestrator", "result", "Request lifecycle complete.", "ok");
  if (typeof addExec === "function") { addExec(domain === "asset" ? "asset" : "hr", run.orders[0] ? run.orders[0].request : inc.id, "Success", `Workbench: ${inc.title.slice(0, 60)} (${run.mode === "live" ? "live agents" : "demo"})`, Date.parse(run.ended) - Date.parse(run.started)); save(); }
}

/* ------------------------------------------------------------- HR steps */
async function wbStepHIntake(run) {
  const inc = wbInc(run.incId); const scen = wbScenarioFor(inc);
  wbNodeStart(run, "h_intake");
  const checks = await wbIntakeChecksStep(run, "h_intake", inc);
  const out = await wbAgent(run, "h_intake", { request: wbReqCtx(inc), required_field_checks: checks }, () => ({
    request_type: scen ? scen.script.request_type : "policy_question", summary: inc.title, person: scen ? scen.script.person : "the requester", key_dates: scen ? scen.script.dates : [],
    details: String(inc.description).split(/(?<=\.)\s+/).slice(0, 3), missing_info: checks.some((c) => c.status !== "pass") ? ["What you need and by when"] : [], validation: checks.some((c) => c.status === "fail") || !scen ? "needs_info" : "pass", reasoning: scen ? "Request type and key dates are clear." : "The request type isn't clear enough yet.",
  }));
  if (!out) return wbFail(run, "h_intake");
  if (wbIntakeGate(run, "h_intake", out, checks)) return;
  wbDone(run, "h_intake", `HR request understood (${out.request_type}); handed to the HR Policy Agent.`, "h_policy");
}
async function wbStepHPolicy(run) {
  const inc = wbInc(run.incId); const scen = wbScenarioFor(inc);
  wbNodeStart(run, "h_policy");
  const lib = WB_DATA.hr_policies;
  await wbTool(run, "h_policy", { name: "HR policy library search", source: "simulated", input: wbOut(run, "h_intake").request_type, run: () => lib.map((p) => p.id), summarize: (r) => `${r.length} policies available (synthetic POC library)` });
  if (run.mode === "live") await wbTool(run, "h_policy", { name: "ServiceNow knowledge search", source: "live", input: inc.title.slice(0, 60), live: { tool: "sn_kb", args: { text: `${inc.title} ${wbOut(run, "h_intake").request_type}` } }, summarize: (r) => (r.articles.length ? `${r.articles.length} article(s)` : "No HR knowledge in the POC instance") });
  const out = await wbAgent(run, "h_policy", { request: wbReqCtx(inc), intake: wbOut(run, "h_intake"), hr_policy_library: lib, note: "Synthetic POC policies, not actual Crystal Clean policy." }, () => ({
    answer: scen.script.answer, policies_applied: scen.script.policies.map((id) => ({ id, title: (lib.find((p) => p.id === id) || {}).title, how_it_applies: "Applies to this request." })), eligibility: scen.script.eligibility, conditions: scen.script.conditions, gaps: [],
  }));
  if (!out) return wbFail(run, "h_policy");
  wbDone(run, "h_policy", `Policy answer ready (${out.eligibility.replace("_", " ")}; ${wbArr(out.policies_applied).map((p) => p.id || p).join(", ")}). Handed to the HR Plan Agent.`, "h_plan");
}
async function wbStepHPlan(run) {
  const inc = wbInc(run.incId); const scen = wbScenarioFor(inc);
  wbNodeStart(run, "h_plan");
  const intake = wbOut(run, "h_intake");
  const allowed = intake.request_type === "onboarding" ? WB_ALLOWED.hr : [];
  const out = await wbAgent(run, "h_plan", { request: wbReqCtx(inc), intake, policy_answer: wbOut(run, "h_policy"), allowed_catalog_items: allowed, hr_partner_feedback: run.feedback.plan || "" }, () => ({
    plan_title: `${inc.title}: plan`, tasks: scen.script.tasks.map(([task, owner, due, system]) => ({ task, owner, due, system })), servicenow_requests: scen.script.requests,
    employee_message: scen.script.answer, notes: run.feedback.plan ? `Revised after HR partner feedback: ${run.feedback.plan}` : "",
  }));
  if (!out) return wbFail(run, "h_plan");
  const asked = wbArr(out.servicenow_requests).map(String);
  out.servicenow_requests = asked.filter((x) => allowed.includes(x));
  run.decAttempt = (run.decAttempt || 0) + 1;
  const checks = [
    intake.request_type === "onboarding" ? (out.servicenow_requests.includes("New Hire") ? { label: "Onboarding request", status: "pass", detail: "New Hire request included (HRP-201)." } : { label: "Onboarding request", status: "fail", detail: "Onboarding needs the New Hire catalog request (HRP-201)." }) : { label: "ServiceNow requests", status: "pass", detail: "None needed for this request type." },
    wbArr(out.tasks).length >= 2 && wbArr(out.tasks).every((t) => t.owner && t.due) ? { label: "Tasks", status: "pass", detail: `${wbArr(out.tasks).length} tasks with owners and dates.` } : { label: "Tasks", status: "fail", detail: "Every task needs an owner and a due date (at least 2 tasks)." },
  ];
  await wbTool(run, "h_plan", { name: "HR plan consistency check", source: "rules", input: `${intake.request_type} · ${out.servicenow_requests.join(", ") || "no requests"}`, run: () => checks, summarize: (c) => (c.some((x) => x.status === "fail") ? `${c.filter((x) => x.status === "fail").length} check(s) failed` : "Plan consistent with policy") });
  run.nodes.h_plan.output.plan_checks = checks;
  const bad = checks.filter((c) => c.status === "fail");
  if (bad.length) {
    if (run.decAttempt < 3) { run.feedback.plan = `Plan check failed: ${bad.map((c) => c.detail).join(" ")}`; return wbDone(run, "h_plan", `Plan check failed (${bad.map((c) => c.label).join(", ")}); returned to the HR Plan Agent with the correction.`, "h_plan"); }
    return wbGate(run, "attention", { type: "policy_exhausted", node: "h_plan" }, "The plan failed the policy check 3 times; an HR partner must decide.");
  }
  wbDone(run, "h_plan", `Plan ready: ${wbArr(out.tasks).length} tasks${out.servicenow_requests.length ? `, ServiceNow requests: ${out.servicenow_requests.join(", ")}` : ", no ServiceNow requests needed"}. Paused for HR partner approval.`, null);
  const a = wbNodeStart(run, "h_approval"); a.source = "human"; a.input = { tasks: wbArr(out.tasks).length, requests: out.servicenow_requests };
  wbGate(run, "waiting", { type: "hr", node: "h_approval" }, "Waiting for the HR partner to approve the answer and plan.");
}
async function wbStepHFulfil(run) {
  const inc = wbInc(run.incId);
  wbNodeStart(run, "h_fulfil"); run.nodes.h_fulfil.source = "tools";
  const plan = wbOut(run, "h_plan");
  run.nodes.h_fulfil.input = { approved_requests: plan.servicenow_requests, tasks: wbArr(plan.tasks).length };
  const note = `${inc.title}. Requested by ${inc.reported_by}. Approved by the HR partner in the Agentic Workbench.`;
  const orders = await wbFulfil(run, "h_fulfil", "hr", plan.servicenow_requests, note);
  if (orders === null) return wbFail(run, "h_fulfil");
  run.orders = orders;
  await wbTool(run, "h_fulfil", { name: "HR case record", source: "local", input: inc.id, run: () => ({ tasks: wbArr(plan.tasks).length }), summarize: (r) => `HR case recorded in the workbench with ${r.tasks} tasks (the HR case module isn't installed in the POC instance)` });
  if (run.mode === "live" && orders.length) await wbTool(run, "h_fulfil", { name: "ServiceNow request work notes", source: "live", input: orders.map((o) => o.request).join(", "), live: { tool: "sn_request_note", args: { domain: "hr", text: `[AURA HR Agents] ${note}\nPlan:\n${wbArr(plan.tasks).map((t, i) => `${i + 1}. ${wbTxt(t.task)} (${wbTxt(t.owner)}, ${wbTxt(t.due)})`).join("\n")}` } }, summarize: (r) => `Note posted to ${r.posted} request item(s)` });
  run.nodes.h_fulfil.output = { orders, tasks: wbArr(plan.tasks).length };
  wbDone(run, "h_fulfil", orders.length ? `Requested in ServiceNow: ${orders.map((o) => `${o.item} → ${o.request}`).join("; ")}. Handed to the Verification Agent.` : "HR case recorded; no ServiceNow request needed. Handed to the Verification Agent.", "h_verify");
}
async function wbStepHVerify(run) {
  wbNodeStart(run, "h_verify"); run.nodes.h_verify.source = "tools";
  const checks = await wbVerifyOrders(run, "h_verify");
  const tasks = wbArr(wbOut(run, "h_plan").tasks);
  const missing = tasks.filter((t) => !t.owner || !t.due);
  checks.push(missing.length ? { label: "Plan tasks", status: "fail", detail: `${missing.length} task(s) without an owner or due date.` } : { label: "Plan tasks", status: "pass", detail: `${tasks.length} tasks, each with an owner and a due date.` });
  run.nodes.h_verify.output = { checks };
  if (checks.some((c) => c.status === "fail")) { run.nodes.h_verify.error = checks.filter((c) => c.status === "fail").map((c) => `${c.label}: ${c.detail}`).join(" "); return wbFail(run, "h_verify"); }
  wbDone(run, "h_verify", "Verified. Handed to the Closure Agent.", "h_close");
}
Object.assign(WB_STEPS, { a_intake: wbStepAIntake, a_context: wbStepAContext, a_decision: wbStepADecision, a_fulfil: wbStepAFulfil, a_verify: wbStepAVerify, a_close: (run) => wbStepClose(run, "a_close", "asset"), h_intake: wbStepHIntake, h_policy: wbStepHPolicy, h_plan: wbStepHPlan, h_fulfil: wbStepHFulfil, h_verify: wbStepHVerify, h_close: (run) => wbStepClose(run, "h_close", "hr") });

/* ------------------------------------------------- gates and decisions */
const _wbDecideBase = wbDecide;
wbDecide = async function (incId, gate, decision, feedback) {
  if (gate !== "asset" && gate !== "hr") return _wbDecideBase(incId, gate, decision, feedback);
  const run = WB.runs[incId];
  if (!run || run.status !== "waiting" || !run.gate || run.gate.type !== gate) return;
  const key = gate === "asset" ? "a_approval" : "h_approval";
  if (run.mode === "live") {
    const r = await wbApi("approval", { run_id: run.id, gate, decision, feedback, approver: gate === "asset" ? "Asset manager (POC role)" : "HR partner (POC role)" }, "POST", { "X-P32-Role": "approver" });
    if (!r.ok) { WBL.flash = `Approval not recorded: ${r.error}`; render(); return; }
  }
  const entry = { gate, decision, feedback, approver: gate === "asset" ? "Asset manager (POC role)" : "HR partner (POC role)", at: wbNow(), recorded: run.mode === "live" ? "backend" : "local (demo)" };
  run.approvals.push(entry);
  const node = run.nodes[key]; node.output = entry; node.status = "done"; node.ended = wbNow();
  wbEvent(run, entry.approver, "approval", `${{ approve: "Approved", request_changes: "Changes requested", reject: "Declined" }[decision]}${feedback ? `: "${feedback}"` : ""}`, decision === "approve" ? "ok" : "warn");
  run.gate = null;
  if (decision === "approve") { node.decision = "Approved; handed to the Fulfillment Agent."; run.status = "running"; run.next = gate === "asset" ? "a_fulfil" : "h_fulfil"; }
  else if (decision === "request_changes") { node.decision = `Changes requested; feedback sent to the ${gate === "asset" ? "Lifecycle Decision" : "HR Plan"} Agent.`; run.feedback[gate === "asset" ? "decision" : "plan"] = feedback; run.decAttempt = 0; run.status = "running"; run.next = gate === "asset" ? "a_decision" : "h_plan"; }
  else { node.decision = "Declined by the approver; nothing ordered."; run.status = "declined"; run.ended = wbNow(); run.next = null; }
  wbEvent(run, "Orchestrator", "decision", node.decision, decision === "reject" ? "warn" : "ok");
  wbCommit(); wbPersist(run);
  if (run.status === "running") wbDrive(incId);
};
const _wbGateActionBase = wbGateAction;
wbGateAction = function (incId, action, text) {
  const run = WB.runs[incId];
  if (run && run.gate && run.gate.type === "intake_info" && run.gate.node !== "intake" && action === "info") {
    if (!text || wbWords(text) < 4) { WBL.flash = "Add at least a short sentence of detail."; render(); return; }
    run.extraInfo = `${run.extraInfo ? run.extraInfo + " " : ""}${text}`;
    wbEvent(run, "Requester", "decision", "Added details; re-running intake.", "info");
    run.gate = null; run.status = "running"; run.next = run.nodes[run.current] ? run.current : WB_FLOWS[wbFlowOf(run)].first; wbCommit(); wbDrive(incId); return;
  }
  if (run && run.gate && run.gate.type === "policy_exhausted" && action === "retry") {
    const node = run.gate.node; run.decAttempt = 0; run.gate = null; run.status = "running"; run.next = node;
    wbEvent(run, "Approver (human)", "retry", `Retry of ${WB_NODES[node].name} requested.`, "info"); wbCommit(); wbDrive(incId); return;
  }
  return _wbGateActionBase(incId, action, text);
};

/* ------------------------------------------------- FrontDoor routing */
const WB_ROUTE_RULES = { asset: /\b(laptop|macbook|computer|workstation|desktop|screen|battery|keyboard|monitor|device|charger|loaner|stolen|lost my|dock|headset|thinkpad|imac)\b/i, hr: /\b(onboard|new hire|joins|starts on|start date|leave|parental|maternity|paternity|benefit|payroll|salary|spouse|married|marriage|vacation|pto|holiday|hr policy|policy)\b/i };
function wbRouteRules(text) {
  const domain = WB_ROUTE_RULES.hr.test(text) ? "hr" : WB_ROUTE_RULES.asset.test(text) ? "asset" : "incident";
  let service = "", use_case = "";
  if (domain === "incident") {
    const words = new Set(text.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    let best = 0;
    for (const i of WB_DATA.incidents) { const s = `${i.service} ${i.title}`.toLowerCase().split(/\W+/).filter((w) => words.has(w)).length; if (s > best) { best = s; service = i.service; use_case = i.use_case; } }
  }
  return { domain, confidence: 0.6, reason: `Keyword rules (Controlled Demo Mode): ${domain === "incident" ? "a service is failing" : domain === "asset" ? "it's about the employee's device" : "it's an HR topic"}.`, use_case, service, summary: text.slice(0, 120), engine: "rules" };
}
async function wbRoute(text) {
  if (wbMode() !== "live") return wbRouteRules(text);
  const services = {}; WB_DATA.use_cases.forEach((u) => { services[u.id] = WB_DATA.incidents.filter((i) => i.use_case === u.id).map((i) => i.service); });
  const r = await wbApi("agent", { run_id: `RUN-ROUTE-${Date.now().toString(36)}`, agent: "router", context: { request: text, services_by_use_case: services }, incident: "frontdoor-route" });
  if (!r.ok) return { ...wbRouteRules(text), reason: `Router Agent unavailable (${r.error}); keyword rules used instead.`, engine: "rules" };
  return { ...r.output, engine: "ai", model: r.model, ms: r.duration_ms };
}
async function wbSubmitRequest(flow, form, route) {
  WB.seq += 1;
  const prefix = flow === "asset" ? "AST" : "HR";
  const inc = { id: `${wbMode() === "live" ? "FD" : "DEMO"}-${prefix}-S${String(WB.seq).padStart(2, "0")}`, flow, use_case: prefix, submitted: true, title: form.title.trim(), description: form.description.trim(), service: flow === "asset" ? "End-user devices" : "HR services", reported_by: `${WB_EMPLOYEE.name} (${WB_EMPLOYEE.dept}, synthetic)`, reported_at: wbNow(), priority: form.urgency === "now" ? "2 - High" : form.urgency === "later" ? "4 - Low" : "3 - Moderate", impact: "3 - Low", urgency: { now: "1 - High", today: "2 - Medium", later: "3 - Low" }[form.urgency] || "2 - Medium", asset_tag: (form.assetTag || "").trim(), route };
  const list = wbRequestsFor(flow);
  if (list.length >= 5) {
    const idle = list.filter((o) => !["running", "waiting", "attention", "paused", "failed"].includes((WB.runs[o.id] || {}).status));
    const victim = (idle.length ? idle : list).sort((a, b) => Date.parse(wbReportedAt(a)) - Date.parse(wbReportedAt(b)))[0];
    if (victim.submitted) { inc.replaces = victim.replaces; WB.submitted = WB.submitted.filter((s) => s.id !== victim.id); } else inc.replaces = victim.id;
    delete WB.runs[victim.id];
  }
  WB.submitted.unshift(inc); WB.myIds.unshift(inc.id); WB.domain = flow;
  const run = wbNewRun(inc); run.status = "running"; run.started = wbNow();
  wbEvent(run, "Digital FrontDoor", "result", `Request ${inc.id} received.`, "ok");
  wbCommit(); wbDrive(inc.id);
  return { ok: true, id: inc.id };
}
wbFdSubmit = async function () {
  const f = UI.fd;
  if (f.busy) return;
  f.busy = true; f.err = ""; f.route = null; render();
  const text = `${f.title}. ${f.description}`;
  let route = { domain: f.area, engine: "chosen by the requester", reason: "Area chosen on the form." };
  if (f.area === "auto") { route = await wbRoute(text); f.route = route; }
  let r;
  if (route.domain === "incident") {
    let uc = f.uc, service = f.service;
    if (f.area === "auto") {
      const match = WB_DATA.incidents.find((i) => i.service === route.service);
      if (match) { uc = match.use_case; service = match.service; } else { const rr = wbRouteRules(text); if (rr.service) { uc = rr.use_case; service = rr.service; } }
    }
    r = await wbSubmit({ uc, service, title: f.title, description: f.description, impact: f.impact, urgency: f.urgency });
    WB.domain = "incident";
    if (r.ok) { const inc = wbInc(r.id); inc.route = route; const run = WB.runs[r.id]; if (run) wbEvent(run, "FrontDoor Router Agent", "decision", `Routed to IT Incidents → ${service} (${route.engine === "ai" ? `AI, ${route.model}` : route.engine}): ${route.reason || ""}`, "ok"); wbSave(); }
  } else {
    r = await wbSubmitRequest(route.domain, f, route);
    const run = r.ok && WB.runs[r.id];
    if (run) { run.events.splice(1, 0, { at: wbNow(), actor: "FrontDoor Router Agent", type: "decision", text: `Routed to ${WB_FLOWS[route.domain].label} (${route.engine === "ai" ? `AI, ${route.model}` : route.engine}): ${route.reason || ""}`, result: "ok" }); wbSave(); }
  }
  f.busy = false;
  if (!r.ok) { f.err = r.error; render(); return; }
  f.title = ""; f.description = ""; f.assetTag = "";
  if (psCanRoute("workbench")) location.hash = `#/workbench/${encodeURIComponent(r.id)}`;
  else { psToast(`Submitted as ${r.id}. Follow its progress under "Your reported incidents".`, "info"); render(); }
};
</script>
