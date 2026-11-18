<style>
.wb-doms{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.wb-dom{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line-strong);border-radius:10px;background:var(--surface);padding:8px 14px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;color:var(--ink)}
.wb-dom svg{width:15px;height:15px} .wb-dom.on{background:var(--ink);border-color:var(--ink);color:#fff} .wb-dom .c{font-size:11px;font-weight:400;opacity:.75}
.wb-route{border:1px solid #c9c9f3;background:var(--brand-soft);border-radius:10px;padding:8px 12px;font-size:12.5px;margin-top:10px}
</style>
<script>
"use strict";
/* ------------------------------------------- domain UI: lists and tabs */
UI.fd.area = UI.fd.area || "auto"; UI.fd.assetTag = UI.fd.assetTag || "";
function wbDomainTabs() {
  const cur = WB.domain || "incident";
  const count = (f) => (f === "incident" ? WB_DATA.use_cases.reduce((n, u) => n + wbIncidentsFor(u.id).length, 0) : wbRequestsFor(f).length);
  return `<div class="wb-doms">${Object.entries(WB_FLOWS).map(([k, f]) => `<button class="wb-dom ${cur === k ? "on" : ""}" data-act="wb-dom" data-d="${k}">${icon(f.icon)} ${f.label} <span class="c">${count(k)}</span></button>`).join("")}</div>`;
}
function wbPageRequests(flow) {
  const f = WB_FLOWS[flow];
  const list = wbRequestsFor(flow);
  const priKind = (p) => (p.startsWith("1") ? "critical" : p.startsWith("2") ? "serious" : p.startsWith("3") ? "warning" : "info");
  return `${head("Agentic Incident Workbench", `${f.label} requests: the agents look up real ServiceNow data, decide, ask a human to approve, then place and verify the ServiceNow requests.`, f.label, wbModePill())}
  ${wbDomainTabs()}
  <div class="card"><div class="sec-head" style="padding:12px 16px;border-bottom:1px solid var(--line)"><p class="sec-title">${icon(f.icon)} ${f.label}: ${list.length} tracked (demo limit 5)</p></div>
  <div class="tbl-wrap"><table class="t"><thead><tr><th>Request</th><th>Summary</th><th>Priority</th><th>Requested by</th><th>Reported</th><th>Current stage</th><th>Agent working</th><th>Status</th></tr></thead><tbody>
  ${list.map((i) => { const st = wbStatusOf(i); const sg = wbStageOf(i); const run = WB.runs[i.id]; const req = run && run.orders && run.orders[0]; return `<tr class="click" data-act="wb-open" data-id="${esc(i.id)}"><td style="white-space:nowrap"><span class="mono" style="font-size:11.5px">${esc(i.id)}</span>${req ? `<div>${req.url && WB_SN_URL.test(req.url) ? `<a class="snlink" href="${esc(req.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${esc(req.request)}${icon("external")}</a>` : `<span class="mono" style="font-size:11px">${esc(req.request)}</span>`}</div>` : ""}${i.submitted ? `<div style="font-size:10.5px;color:var(--brand)">FrontDoor</div>` : ""}</td><td style="min-width:260px">${esc(i.title)}</td><td>${badge(priKind(i.priority), i.priority)}</td><td style="white-space:nowrap">${esc(i.reported_by)}</td><td style="white-space:nowrap">${rel(wbReportedAt(i))}</td><td style="white-space:nowrap">${esc(sg.stage)}</td><td style="white-space:nowrap;color:var(--ink-soft)">${esc(sg.agent)}</td><td>${badge(st.kind, st.label)}</td></tr>`; }).join("")}
  </tbody></table></div></div>
  ${simnote(flow === "asset" ? "Asset scenarios use real hardware records from the POC ServiceNow instance (P1000177, P1000238, P1000486). Device health readings and the lifecycle policy are synthetic. Live orders are real Service Catalog requests in the POC instance." : "HR scenarios are synthetic. The POC ServiceNow instance has no HR case module, so HR cases are recorded in the workbench; onboarding places real New Hire and laptop requests in the POC instance in Live Agent Mode. The HR policy library is synthetic, not Crystal Clean policy.")}`;
}
function wbDomainGateCard(run, flash) {
  const g = run.gate; const d = UI.wbDraft; const fb = (d.fb || "").trim();
  if (g.type === "policy_exhausted") { const n = run.nodes[g.node]; const ch = (n.output || {}).policy_checks || (n.output || {}).plan_checks || []; return `<div class="card pad wb-gate">${flash || ""}<p class="sec-title">${icon("alert")} ${esc(WB_NODES[g.node].name)} failed the policy check 3 times</p>${wbChecksHtml(ch)}<div class="wb-ctrl" style="margin-top:10px"><button class="btn primary" data-act="wb-gate" data-a="retry">${icon("rotate")} Retry the agent</button></div></div>`; }
  if (g.type === "asset") {
    const o = wbOut(run, "a_decision"); const a = run.asset || {};
    return `<div class="card pad wb-gate">${flash || ""}<p class="sec-title">${icon("usercheck")} Asset manager approval required</p>
      <p style="font-size:12.5px;color:var(--ink-soft);margin:4px 0 10px">Nothing is ordered until you approve. ${run.mode === "live" ? "Approving places real Service Catalog orders in ServiceNow." : "Controlled Demo Mode: orders are simulated."}</p>
      <div class="grid g2" style="gap:12px"><div>${wbKv([["Device", `${a.display_name || ""} (${a.assigned_to || ""})`], ["Age / warranty", `${a.age_years != null ? `${a.age_years} years` : "age unknown"} · ${String(a.warranty_status || "").replace("_", " ")}`], ["Recommendation", String(o.recommendation).replace(/_/g, " ")], ["Estimated cost", o.estimated_cost], ["Will order", wbArr(o.catalog_items).join(", ") || "Nothing (repair only)"]])}</div>
      <div><span class="eyebrow">Why</span><p style="font-size:12.5px;margin:4px 0 8px">${esc(o.rationale)}</p><span class="eyebrow">Policy rules</span>${wbUl(o.policy_rules_applied)}</div></div>
      <textarea class="ta" id="wb-fb" rows="2" style="margin-top:10px" placeholder="Feedback (required to request changes or decline)">${esc(d.fb || "")}</textarea>
      <div class="wb-ctrl" style="margin-top:10px"><button class="btn primary" data-act="wb-decide" data-g="asset" data-d="approve">${icon("check")} Approve${wbArr(o.catalog_items).length ? " and order" : ""}</button><button class="btn" data-act="wb-decide" data-g="asset" data-d="request_changes" ${fb.length >= 10 ? "" : "disabled"}>${icon("rotate")} Request changes</button><button class="btn danger" data-act="wb-decide" data-g="asset" data-d="reject" ${fb.length >= 10 ? "" : "disabled"}>${icon("xcircle")} Decline</button></div></div>`;
  }
  const pol = wbOut(run, "h_policy"); const plan = wbOut(run, "h_plan");
  return `<div class="card pad wb-gate">${flash || ""}<p class="sec-title">${icon("usercheck")} HR partner approval required</p>
    <p style="font-size:12.5px;color:var(--ink-soft);margin:4px 0 10px">The answer isn't sent and nothing is requested until you approve.${wbArr(plan.servicenow_requests).length && run.mode === "live" ? " Approving places real ServiceNow requests." : ""}</p>
    <div class="grid g2" style="gap:12px"><div><span class="eyebrow">Answer for the requester</span><p style="font-size:12.5px;margin:4px 0 8px">${esc(pol.answer)}</p>${wbKv([["Eligibility", String(pol.eligibility).replace("_", " ")], ["Policies", wbArr(pol.policies_applied).map((p) => p.id || wbTxt(p)).join(", ")], ["ServiceNow requests", wbArr(plan.servicenow_requests).join(", ") || "None"]])}</div>
    <div><span class="eyebrow">Plan (${wbArr(plan.tasks).length} tasks)</span>${wbUl(wbArr(plan.tasks).map((t) => `${wbTxt(t.task)} · ${wbTxt(t.owner)} · ${wbTxt(t.due)}`))}</div></div>
    <textarea class="ta" id="wb-fb" rows="2" style="margin-top:10px" placeholder="Feedback (required to request changes or decline)">${esc(d.fb || "")}</textarea>
    <div class="wb-ctrl" style="margin-top:10px"><button class="btn primary" data-act="wb-decide" data-g="hr" data-d="approve">${icon("check")} Approve and send</button><button class="btn" data-act="wb-decide" data-g="hr" data-d="request_changes" ${fb.length >= 10 ? "" : "disabled"}>${icon("rotate")} Request changes</button><button class="btn danger" data-act="wb-decide" data-g="hr" data-d="reject" ${fb.length >= 10 ? "" : "disabled"}>${icon("xcircle")} Decline</button></div></div>`;
}
function wbDomainOutput(run, key, o) {
  if (!o) return "";
  switch (key) {
    case "a_intake": return wbKv([["Issue", o.issue_summary], ["Type", o.request_type], ["Asset tag mentioned", o.asset_tag_mentioned || "—"], ["Impact", o.business_impact], ["Validation", o.validation], ["Reasoning", o.reasoning]]) + wbSec("Symptoms", wbUl(o.symptoms));
    case "a_context": return wbKv([["Asset", o.asset_summary], ["Age", o.age_years ? `${o.age_years} years` : "unknown"], ["Warranty", o.warranty_status], ["History", o.history_summary]]) + wbSec("Health findings", wbUl(o.health_findings)) + wbSec("Risks", wbUl(o.risks)) + wbSec("Gaps", wbUl(o.gaps));
    case "a_decision": return (o.policy_checks ? wbSec("Policy consistency check", wbChecksHtml(o.policy_checks)) : "") + wbKv([["Recommendation", String(o.recommendation).replace(/_/g, " ")], ["Rationale", o.rationale], ["Order", wbArr(o.catalog_items).join(", ") || "Nothing"], ["Cost", o.estimated_cost], ["Employee impact", o.employee_impact], ["Confidence", o.confidence]]) + wbSec("Policy rules applied", wbUl(o.policy_rules_applied)) + wbSec("Data handling", wbUl(o.data_handling));
    case "h_intake": return wbKv([["Type", o.request_type], ["Summary", o.summary], ["For", o.person], ["Validation", o.validation], ["Reasoning", o.reasoning]]) + wbSec("Key dates", wbUl(o.key_dates)) + wbSec("Details", wbUl(o.details));
    case "h_policy": return `<p style="font-size:12.5px;line-height:1.6;margin:0">${esc(o.answer)}</p>` + wbKv([["Eligibility", o.eligibility]]) + wbSec("Policies applied (synthetic library)", wbUl(wbArr(o.policies_applied).map((p) => `${p.id || ""} ${p.title || ""}: ${p.how_it_applies || wbTxt(p)}`))) + wbSec("Conditions", wbUl(o.conditions)) + wbSec("Not covered", wbUl(o.gaps));
    case "h_plan": return (o.plan_checks ? wbSec("Plan consistency check", wbChecksHtml(o.plan_checks)) : "") + wbKv([["Plan", o.plan_title], ["ServiceNow requests", wbArr(o.servicenow_requests).join(", ") || "None"], ["Message to requester", o.employee_message], ["Notes", o.notes || "—"]]) + wbSec("Tasks", `<ol class="wb-steps">${wbArr(o.tasks).map((t, i) => `<li><span class="n">${i + 1}</span><div>${esc(wbTxt(t.task))}<div class="e">${esc(wbTxt(t.owner))} · ${esc(wbTxt(t.system))}</div></div><span style="font-size:11px;white-space:nowrap">${esc(wbTxt(t.due))}</span></li>`).join("")}</ol>`);
    case "a_approval": case "h_approval": return wbKv([["Decision", { approve: "Approved", request_changes: "Changes requested", reject: "Declined" }[o.decision]], ["Feedback", o.feedback || "—"], ["Approver", o.approver], ["Recorded", o.recorded], ["At", stamp(o.at)]]);
    case "a_fulfil": case "h_fulfil": return wbOrdersHtml(o.orders || []);
    case "a_verify": case "h_verify": return wbChecksHtml(o.checks);
    case "a_close": case "h_close": return wbKv([["Summary", o.summary], ["Fulfilment note", o.work_note], ["Update for the requester", o.employee_update]]);
  }
  return "";
}
function wbOrdersHtml(orders) {
  if (!orders.length) return `<p style="font-size:12.5px;color:var(--ink-muted);margin:0">No ServiceNow requests for this outcome.</p>`;
  return `<ul class="wb-ul">${orders.map((o) => `<li><b>${esc(o.item)}</b>: ${o.url && WB_SN_URL.test(o.url) ? `<a class="snlink" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">${esc(o.request)}${icon("external")}</a>` : `<span class="mono">${esc(o.request)}</span>`} ${wbArr(o.ritms).map((r) => (r.url && WB_SN_URL.test(r.url) ? `<a class="snlink" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.number)}${icon("external")}</a>` : `<span class="mono" style="font-size:11px">${esc(r.number)}</span>`)).join(" ")}${o.simulated ? ` <span class="wb-src simulated">Simulated</span>` : ` <span class="wb-src live">Live</span>`}</li>`).join("")}</ul>`;
}
const _wbNodeOutputBase = wbNodeOutput;
wbNodeOutput = function (run, key, o) { return /^[ah]_/.test(key) ? wbDomainOutput(run, key, o) : _wbNodeOutputBase(run, key, o); };
function wbTabRequest(run, inc) {
  if (!run || !run.nodes[WB_FLOWS[wbFlowOf(inc)].first]) return `<p style="font-size:12.5px;color:var(--ink-muted)">Start the request to see the agents' work here.</p>`;
  const done = run.closeNote;
  if (wbFlowOf(inc) === "asset") {
    const a = run.asset;
    return `<div class="grid g2"><div>${a ? wbSec(`Asset record ${a.url && WB_SN_URL.test(a.url) ? `<a class="snlink" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">open in ServiceNow${icon("external")}</a>` : `<span class="wb-src simulated">Snapshot</span>`}`, wbKv([["Asset", a.display_name], ["Assigned to", `${a.assigned_to} (${a.department || ""})`], ["Status", a.install_status], ["Purchased", a.purchase_date], ["Warranty until", a.warranty_expiration], ["Age / warranty", `${a.age_years != null ? `${a.age_years} years` : "unknown"} · ${String(a.warranty_status).replace("_", " ")}`], ["Cost", a.cost]])) + wbSec("Device incident history (ServiceNow)", wbUl(wbArr(a.history).map((h) => `${h.id}: ${h.title} (${h.state})`))) + wbSec("Device health readings <span class='wb-src simulated'>Simulated</span>", wbUl(wbArr(a.telemetry).map((t) => `${t.id}: ${t.reading}`))) : ""}</div>
    <div>${wbOut(run, "a_decision") ? wbSec("Decision", wbDomainOutput(run, "a_decision", wbOut(run, "a_decision"))) : ""}${wbSec("ServiceNow requests", wbOrdersHtml(run.orders || []))}${done ? wbSec("Outcome", wbKv([["Summary", done.summary], ["Update for the requester", done.employee_update], ["ServiceNow", run.snResult ? run.snResult.reason : ""]])) : ""}</div></div>`;
  }
  return `<div class="grid g2"><div>${wbOut(run, "h_policy") ? wbSec("Answer", wbDomainOutput(run, "h_policy", wbOut(run, "h_policy"))) : ""}</div><div>${wbOut(run, "h_plan") ? wbSec("Plan", wbDomainOutput(run, "h_plan", wbOut(run, "h_plan"))) : ""}${wbSec("ServiceNow requests", wbOrdersHtml(run.orders || []))}${done ? wbSec("Outcome", wbKv([["Summary", done.summary], ["Update for the requester", done.employee_update], ["ServiceNow", run.snResult ? run.snResult.reason : ""]])) : ""}</div></div>`;
}

/* -------------------------------------------------- Digital FrontDoor */
const WB_FD_TEXT = {
  incident: ["We've received your report and are checking it", "Routed to the right team", "Investigating the cause", "Investigating the cause", "Waiting for an engineer to approve the fix", "Applying the fix", "Checking the fix worked", "Resolved"],
  asset: ["We've received your request", "Looking up your device", "Deciding the best fix", "Waiting for approval", "Ordering what you need", "Done"],
  hr: ["We've received your request", "Checking the policy", "Preparing a plan", "Waiting for an HR partner", "Setting things up", "Done"],
};
wbFdStatus = function (inc) {
  const flow = wbFlowOf(inc); const STAGES = WB_FLOWS[flow].stages; const run = WB.runs[inc.id];
  if (!run) return { text: "Received", stage: 0, total: STAGES.length };
  if (run.status === "completed") return { text: flow === "incident" ? "Resolved" : "Done", stage: STAGES.length, total: STAGES.length };
  if (run.status === "declined") return { text: "Declined: see the update below", stage: STAGES.length, total: STAGES.length };
  if (run.status === "linked") return { text: "Linked to an existing report of the same problem", stage: 1, total: STAGES.length };
  if (run.gate && run.gate.type === "intake_info") return { text: "We need a few more details from you", stage: 0, total: STAGES.length };
  const key = run.gate ? run.gate.node : run.next || run.current || WB_FLOWS[flow].first;
  const s = WB_NODES[key] ? WB_NODES[key].stage : 0;
  return { text: run.status === "failed" || run.status === "attention" ? "Someone from the team is looking at it" : WB_FD_TEXT[flow][s], stage: s, total: STAGES.length };
};
pageDigitalFrontDoor = function () {
  const f = UI.fd; const uc = wbUseCase(f.uc);
  const svcs = WB_DATA.incidents.filter((i) => i.use_case === uc.id).map((i) => i.service);
  if (!svcs.includes(f.service)) f.service = svcs[0];
  const live = wbMode() === "live";
  const mine = WB.myIds.map(wbInc).filter(Boolean);
  const ready = !wbFdMissing() && !f.busy;
  const areas = [["auto", "Let AI decide", "sparkles"], ["incident", "IT incident", "siren"], ["asset", "IT asset / device", "laptop"], ["hr", "HR", "users"]];
  const examples = { incident: ["Claims screen keeps timing out", "Since about 9am the claims workbench shows 504 Gateway Timeout on about 1 in 6 adjudications. It's worst between 9 and 11. Examiners have to resubmit."], asset: ["My MacBook keeps freezing and the battery dies fast", "My MacBook Pro freezes several times a day and the battery goes from full to empty in under an hour, so I can't work away from my desk. Getting worse for two weeks."], hr: ["New financial analyst starts Monday", "Priya Raman joins Finance as a Financial Analyst on Monday 17 November. She needs a laptop, email, access to the finance ERP and a building badge. I'm her hiring manager."] };
  return `${head("Digital FrontDoor", `Hi ${WB_EMPLOYEE.name.split(" ")[0]}. One place for IT problems, your devices and HR. Describe what you need; an AI agent routes it, a team of agents works it, and a person approves before anything changes.`, "Employee experience", wbModePill())}
  <div class="wb-split">
    <div class="card pad wb-fdform">
      <p class="sec-title">${icon("message")} How can we help?</p>
      <label>What is it about?</label>
      <div class="wb-doms" style="margin:0">${areas.map(([k, l, ic]) => `<button class="wb-dom ${f.area === k ? "on" : ""}" data-act="fd2-area" data-a="${k}">${icon(ic)} ${l}</button>`).join("")}</div>
      ${f.area === "incident" ? `<label>Which area?</label><div class="wb-ucs" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${WB_DATA.use_cases.map((u) => `<button class="wb-uc ${u.id === uc.id ? "on" : ""}" data-act="fd2-uc" data-uc="${u.id}"><span class="n">${esc(u.name)}</span></button>`).join("")}</div>
      <label for="fd2-service">Which application or service?</label><select class="sel" id="fd2-service">${svcs.map((s) => `<option ${s === f.service ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>` : ""}
      ${f.area === "asset" ? `<label for="fd2-asset">Asset tag <span style="font-weight:400;color:var(--ink-muted)">(on the sticker; leave blank for your own computer)</span></label><input class="input" id="fd2-asset" maxlength="20" placeholder="e.g. P1000486" value="${esc(f.assetTag)}">` : ""}
      <label for="fd2-title">Short summary</label>
      <input class="input" id="fd2-title" maxlength="160" placeholder="e.g. My laptop battery dies within an hour" value="${esc(f.title)}">
      <label for="fd2-desc">Tell us more <span style="font-weight:400;color:var(--ink-muted)">What's happening, since when, who is affected?</span></label>
      <textarea class="ta" id="fd2-desc" rows="4" maxlength="3000" placeholder="Describe it in your own words">${esc(f.description)}</textarea>
      <div class="grid g2" style="gap:12px">
        <div><label for="fd2-impact">Who is affected?</label><select class="sel" id="fd2-impact">${[["many", "Many people or a whole department"], ["team", "My team"], ["me", "Just me"]].map(([v, l]) => `<option value="${v}" ${f.impact === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label for="fd2-urg">How urgent is it?</label><select class="sel" id="fd2-urg">${[["now", "Work is blocked now"], ["today", "Needs sorting today"], ["later", "Can wait"]].map(([v, l]) => `<option value="${v}" ${f.urgency === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      </div>
      ${f.err ? `<div class="wb-flash" style="margin-top:12px">${esc(f.err)}</div>` : ""}
      ${f.busy && f.area === "auto" ? `<div class="wb-route">${icon("loader", "spin")} FrontDoor Router Agent is deciding where this goes${live ? " (live LLM call)" : ""}…</div>` : ""}
      <div class="wb-ctrl" style="margin-top:14px;align-items:center"><button class="btn primary lg" data-act="fd2-submit" ${ready ? "" : "disabled"}>${f.busy ? icon("loader", "spin") : icon("send")} ${f.busy ? "Submitting…" : "Submit"}</button>
        <span style="font-size:12px;color:var(--ink-muted)">Try an example:</span>${Object.entries(examples).map(([k, [t]]) => `<button class="btn ghost" data-act="fd2-ex" data-k="${k}" title="${esc(t)}">${WB_FLOWS[k].label}</button>`).join("")}</div>
      <p id="fd2-hint" style="font-size:12px;color:var(--warn);margin:8px 0 0;${ready || f.busy ? "display:none" : ""}">${esc(wbFdMissing())}</p>
      <p style="font-size:11.5px;color:var(--ink-muted);margin:10px 0 0">${live ? "Live Agent Mode: real AI agents; IT incidents become real ServiceNow incidents, and approved device or onboarding requests become real Service Catalog requests in the POC instance." : "Controlled Demo Mode: scripted agents and synthetic records; nothing is sent to ServiceNow."}</p>
    </div>
    <div class="card pad">
      <p class="sec-title">${icon("history")} Your requests</p>
      ${mine.length ? mine.map((i) => { const s = wbFdStatus(i); const run = WB.runs[i.id]; const c = run && run.closeNote; const flow = wbFlowOf(i); const route = i.route; return `<div style="border-top:1px solid var(--line);padding:12px 0">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${flow === "incident" ? wbLink(i) : `<span class="mono" style="font-size:11.5px">${esc(i.id)}</span>`} <span class="pill p-brand">${WB_FLOWS[flow].label}</span> ${badge(wbStatusOf(i).kind, wbStatusOf(i).label)}<span style="font-size:11.5px;color:var(--ink-muted)">${rel(wbReportedAt(i))}</span></div>
        <div style="font-size:13px;font-weight:500;margin-top:4px">${esc(i.title)}</div>
        ${route && route.engine && route.domain ? `<div style="font-size:11.5px;color:var(--ink-muted);margin-top:2px">${icon("route")} Routed to ${WB_FLOWS[route.domain].label}${route.engine === "ai" ? " by the AI router" : route.engine === "rules" ? " by keyword rules" : ""}</div>` : ""}
        <div style="font-size:12.5px;color:var(--ink-soft);margin-top:2px">${esc(s.text)}</div>
        <div class="wb-prog" style="grid-template-columns:repeat(${s.total},1fr)">${Array.from({ length: s.total }, (_, k) => `<i class="${k < s.stage ? "d" : k === s.stage && s.stage < s.total ? "c" : ""}"></i>`).join("")}</div>
        ${run && run.gate && run.gate.type === "intake_info" ? `<div class="card" style="padding:10px 12px;margin-top:10px;background:var(--warn-soft);border-color:#f0c78a">
          <div style="font-size:12.5px;font-weight:500">${icon("message")} Please tell us a bit more</div>
          ${wbUl(run.gate.missing && run.gate.missing.length ? run.gate.missing : ["What happens, since when and who is affected?"])}
          <textarea class="ta" id="fd2-info-${esc(i.id)}" rows="2" style="margin-top:6px;background:#fff" placeholder="Add the details here">${esc((UI.fdInfo || {})[i.id] || "")}</textarea>
          ${WBL.flash ? `<div class="wb-flash" style="margin:6px 0 0">${esc(WBL.flash)}</div>` : ""}
          <button class="btn primary" style="margin-top:8px" data-act="fd2-info" data-id="${esc(i.id)}">${icon("send")} Send details</button></div>` : ""}
        ${c ? `<p style="font-size:12.5px;margin:8px 0 0;line-height:1.55">${esc(c.employee_update)}</p>` : ""}
        ${run && run.orders && run.orders.length ? `<div style="font-size:12px;margin-top:4px">${wbOrdersHtml(run.orders)}</div>` : ""}
        ${psCanRoute("workbench") ? `<a class="btn ghost" style="padding-left:0;margin-top:4px" href="#/workbench/${encodeURIComponent(i.id)}">${icon("eye")} View the agent workflow</a>` : ""}</div>`; }).join("") : `<p style="font-size:12.5px;color:var(--ink-muted)">Nothing yet. Requests you submit appear here with their progress.</p>`}
    </div>
  </div>
  ${simnote("Proof of concept with synthetic people and scenarios. The employee view shows plain-language progress; the agent workflow (an IT view) shows each agent's work.")}`;
};
function wbFdLoadExample(k) {
  const ex = { incident: ["Claims screen keeps timing out", "Since about 9am the claims workbench shows 504 Gateway Timeout on about 1 in 6 adjudications. It's worst between 9 and 11 when volume peaks. Examiners have to resubmit. It was fine yesterday."], asset: ["My MacBook keeps freezing and the battery dies fast", "My MacBook Pro freezes several times a day and has to be restarted, and the battery goes from full to empty in under an hour, so I can't work away from my desk. It's been getting worse for two weeks."], hr: ["New financial analyst starts Monday", "Priya Raman joins Finance as a Financial Analyst on Monday 17 November. She needs a laptop, email, access to the finance ERP and a building badge. I'm her hiring manager."] }[k];
  UI.fd.area = "auto"; UI.fd.title = ex[0]; UI.fd.description = ex[1]; UI.fd.assetTag = ""; UI.fd.err = "";
  if (k === "incident") { UI.fd.uc = "CLM"; UI.fd.service = "Claims Adjudication Service"; UI.fd.impact = "team"; UI.fd.urgency = "now"; } else { UI.fd.impact = "me"; UI.fd.urgency = "today"; }
  render();
}
</script>
