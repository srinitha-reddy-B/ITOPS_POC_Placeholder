<script>
"use strict";
/* ------------------------------------------------------------------ shell */
const UI = { collapsed: false, resetArmed: false, selAsset: "AST001025", assetQuery: "", assetRunning: false, assetShown: {}, chatDraft: "", typing: false, snSelected: null, snTab: "notes", flash: false };

const NAV = [
  { group: "Employee experience", items: [{ label: "Digital FrontDoor", route: "", icon: "door", badge: "frontdoor" }] },
  { group: "Agentic ITOPS", items: [
    { label: "Agentic Incident Workbench", route: "workbench", icon: "siren", badge: "workbench" },
  ] },
  { group: "Leadership view", items: [{ label: "Crystal Clean Control Tower", route: "leadership", icon: "radar", badge: "approvals" }] },
];
const route = () => (location.hash.replace(/^#\/?/, "") || "").split("?")[0];

function renderTopbar() {
  document.getElementById("topbar").innerHTML = `
    <div class="tb-left">
      <a href="${psHome()}" style="display:flex;align-items:center;gap:10px;min-width:0"><img src="/crystal-clean/logo.webp" alt="Crystal Clean" style="height:28px;width:auto;flex:none"><span style="border-left:1px solid var(--line);padding-left:10px;font-size:15px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;flex:none" title="${esc(psCur().appSub)}">${esc(psCur().app)}</span></a>
    </div>
    <div class="tb-right">
      ${typeof ccBell === "function" ? ccBell() : ""}
      <button class="ghostbtn ${UI.resetArmed ? "confirm" : ""}" data-act="reset" aria-label="Reset" title="${UI.resetArmed ? "Click again to confirm the reset" : "Reset"}" style="padding:0 9px">${icon("rotate")}</button>
      <span class="tb-sep"></span>
      ${psHeader()}
    </div>`;
}

function renderSidebar() {
  const r = route();
  const pending = S.approvals.filter((a) => a.status === "Pending").length;
  const fdS = S.fd || { cases: [], actions: [] };
  const openCases = fdS.cases.filter((c) => c.kind === "laptop" && c.stage !== "resolved");
  const needsIt = openCases.filter((c) => c.steps.some((s) => s.status === "failed" || s.status === "manual") || c.stage === "with_it").length;
  const manualOb = fdS.actions.filter((a) => a.status === "manual").length;
  const wbRuns = Object.values(WB.runs);
  const wbWait = wbRuns.filter((x) => x.status === "waiting").length;
  const wbInfo = WB.myIds.filter((id) => { const x = WB.runs[id]; return x && x.gate && x.gate.type === "intake_info"; }).length;
  const badges = {
    workbench: wbWait ? `${wbWait} to approve` : "",
    incident: S.inc.state === "Resolved" ? "" : S.inc.state, approvals: pending ? String(pending) : "",
    cases: needsIt ? `${needsIt} needs IT` : openCases.length ? `${openCases.length} open` : "",
    onboarding: manualOb ? `${manualOb} to do` : "",
    frontdoor: wbInfo ? `${wbInfo} for you` : "",
    myapprovals: (() => { const n = psApprovalCount(); return n ? String(n) : ""; })(),
  };
  const sb = document.getElementById("sidebar");
  sb.classList.toggle("collapsed", UI.collapsed);
  sb.innerHTML = `
    <div class="client">
      <span></span>
      <button class="iconbtn" data-act="collapse" aria-label="Toggle sidebar">${icon("panel")}</button>
    </div>
    <nav class="nav">
      ${psNav().map((g) => `<div><p class="grp eyebrow" style="margin:0">${g.group}</p>
        ${g.items.map((it) => `<a href="#/${it.route}" class="navlink ${r.split("/")[0] === it.route ? "active" : ""}" title="${it.label}">${icon(it.icon)}<span class="lbl">${it.label}</span>${it.badge && badges[it.badge] ? `<span class="badge">${badges[it.badge]}</span>` : ""}</a>`).join("")}
      </div>`).join("")}
    </nav>
    <div class="foot" style="border-top:0"><span style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--brand);font-weight:500;white-space:nowrap">Powered by <img src="__LOGO__" alt="Tachyon" style="height:17px;width:auto"></span></div>`;
}

function head(title, sub, useCase, actions = "") {
  return `<div class="phead"><div style="min-width:0"><div class="t"><h1>${title}</h1><span class="pill p-info">Crystal Clean · ServiceNow</span>${useCase ? `<span class="pill p-brand">${useCase}</span>` : ""}</div><p>${sub}</p></div>${actions}</div>`;
}
function strip(problem, solution) {
  return `<div class="strip"><div class="card"><div class="eyebrow">Business problem</div><p>${problem}</p></div><div class="card"><div class="eyebrow" style="display:flex;gap:6px;align-items:center">${icon("bot")} AI solution</div><p>${solution}</p></div></div>`;
}
const simnote = (t) => `<p class="simnote">${icon("info")}<span>${t || "Proof-of-concept demonstration with simulated ServiceNow records. No connection to Crystal Clean systems; no production data is read or changed."}</span></p>`;

/* --------------------------------------------------------------- overview */
function pageOverview() {
  const a = ASSETS[0];
  const done = TASKS.filter((t) => S.hr.done[t.id]).length;
  const pending = S.approvals.filter((x) => x.status === "Pending").length;
  const incStatus = S.inc.state === "Resolved" ? badge("good", "Resolved") : S.inc.rca === "done" ? badge("warning", "RCA posted · awaiting resolution") : S.inc.rca === "running" ? badge("running", "RCA running") : badge("info", S.inc.state);
  const assetStatus = S.assets.requests[a.id] ? badge("warning", "Replacement awaiting approval") : S.assets.analysed[a.id] ? badge("good", "Analysed") : badge("info", "Ready to analyse");
  const cases = [
    { r: "incident-management", ic: "siren", mod: "Incident Management", t: "AI RCA Agent", b: "Investigates a production Payment API incident, finds the root cause and posts the RCA and SOP into the ServiceNow work notes, then the engineer approves the resolution.", rec: "INC0010048 · Payment API HTTP 504", st: incStatus, main: true },
    { r: "asset-management", ic: "laptop", mod: "Asset Management", t: "IT Asset Lifecycle Assistant", b: "Analyses a hardware asset record for age, warranty and condition, and recommends whether to replace it, with the next action ready for approval.", rec: `${a.id} · ${a.model} · ${a.assignedTo}`, st: assetStatus },
    { r: "hr-services", ic: "users", mod: "HR Services", t: "HR Onboarding Assistant", b: "Answers a new hire's onboarding questions from approved HR knowledge and her own checklist, and routes sensitive topics to a private HR case.", rec: "Maya Thompson · Finance · onboarding", st: badge(done === TASKS.length ? "good" : "warning", `${done} of ${TASKS.length} tasks complete`) },
  ];
  const flow = [
    ["Incident Management", "Open INC0010048, start triage (New → In Progress) and run the RCA Agent. Show the RCA and SOP in Activities → Work notes, then approve and resolve.", "incident-management"],
    ["Asset Management", "Select AST001025 (Maya Thompson's laptop), run the AI analysis and draft the replacement request.", "asset-management"],
    ["HR Services", "Ask the assistant: “What are the steps I need to complete before joining?” and show the checklist progress.", "hr-services"],
    ["AI Control Tower", "Show the three agents, the INC0010048 execution and the approvals waiting for a human.", "ai-control-tower"],
  ];
  return `${head("Overview", "Three practical AI use cases on the ServiceNow platform Crystal Clean already owns, plus a Control Tower to monitor and govern them. Every record is simulated for this proof of concept.", "", `<a class="btn primary lg" href="#/incident-management">${icon("siren")} Start with the RCA demo</a>`)}
  <div class="grid g3">${cases.map((c) => `
    <a href="#/${c.r}" class="card" style="display:flex;flex-direction:column;padding:16px 20px;${c.main ? "box-shadow:0 0 0 1px #c9c9f1" : ""}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><span class="agentico">${icon(c.ic)}</span>${c.main ? badge("info", "Main use case") : ""}</div>
      <div class="eyebrow" style="margin-top:12px">${c.mod}</div>
      <h2 style="margin:2px 0 0;font-size:15px;font-weight:600">${c.t}</h2>
      <p style="flex:1;margin:6px 0 0;font-size:12.5px;line-height:1.6;color:var(--ink-soft)">${c.b}</p>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
        <div class="mono" style="font-size:11.5px;color:var(--ink-muted)">${c.rec}</div>
        <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;gap:8px">${c.st}<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:500;color:var(--brand)">Open ${icon("arrow")}</span></div>
      </div>
    </a>`).join("")}</div>
  <div class="split" style="margin-top:16px;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)">
    <div class="card pad"><h2 class="sec-title">${icon("bot")} Suggested demo flow</h2>
      <ol style="list-style:none;margin:12px 0 0;padding:0">${flow.map((f, i) => `<li style="display:flex;gap:12px;margin-bottom:10px"><span class="avatar" style="width:22px;height:22px;font-size:11px;flex:none">${i + 1}</span><div><a href="#/${f[2]}" style="font-size:13px;font-weight:500">${f[0]}</a><p style="margin:0;font-size:12.5px;line-height:1.6;color:var(--ink-soft)">${f[1]}</p></div></li>`).join("")}</ol>
    </div>
    <div class="card pad" style="display:flex;flex-direction:column"><h2 class="sec-title">${icon("radar")} AI Control Tower</h2>
      <div class="grid g3" style="gap:8px;margin-top:12px;text-align:center">${[["Agents", 3], ["Active", 3], ["Pending reviews", pending]].map(([k, v]) => `<div style="border:1px solid var(--line);border-radius:10px;padding:10px 8px"><div style="font-size:20px;font-weight:600">${v}</div><div style="font-size:11px;color:var(--ink-muted)">${k}</div></div>`).join("")}</div>
      <ul style="list-style:none;margin:12px 0 0;padding:0;flex:1">${["ServiceNow is the system of record for every action", "Agents are read-only by default; writes need human approval", "No member data or PHI in scope; every action is audited"].map((t) => `<li style="display:flex;gap:8px;margin:6px 0;font-size:12.5px;color:var(--ink-soft)"><span style="color:var(--ok)">${icon("shield")}</span>${t}</li>`).join("")}</ul>
      <a class="btn" href="#/ai-control-tower" style="align-self:flex-start;margin-top:12px">Open Control Tower</a>
    </div>
  </div>
  <div class="card" style="margin-top:16px;padding:12px 20px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 24px;font-size:12.5px;color:var(--ink-soft)"><span class="eyebrow">Scope</span>${["ServiceNow ITSM", "ServiceNow HAM", "ServiceNow HRSD", "AI Control Tower (mock)"].map((t) => `<span style="display:flex;align-items:center;gap:6px"><span style="color:var(--ok)">${icon("check")}</span>${t}</span>`).join("")}</div>
  ${simnote()}`;
}

/* ---------------------------------------------------------------- assets */
const warrantyKind = (w) => (w === "Active" ? "good" : w === "Expiring" ? "warning" : "critical");
const condKind = (c) => (c === "Excellent" || c === "Good" ? "good" : c === "Fair" ? "warning" : "critical");
const recKind = (r) => (r === "Replace" ? "serious" : r === "Monitor" ? "warning" : "good");

function pageAssets() {
  const now = new Date();
  const a = ASSETS.find((x) => x.id === UI.selAsset) || ASSETS[0];
  const q = UI.assetQuery.toLowerCase();
  const rows = ASSETS.filter((x) => [x.id, x.model, x.assignedTo, x.department].join(" ").toLowerCase().includes(q));
  const an = UI.assetShown[a.id] || (S.assets.analysed[a.id] ? analyseAsset(a, now) : null);
  const ritm = S.assets.requests[a.id];
  let rec;
  if (UI.assetRunning) {
    rec = `<div style="margin-top:12px">${["Reading alm_hardware record", "Checking warranty contract", "Applying 48-month refresh policy"].map((t) => `<div style="display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--ink-soft);margin:6px 0"><span style="color:var(--brand)">${icon("loader", "spin")}</span>${t}</div>`).join("")}</div>`;
  } else if (an) {
    rec = `<div class="rise" style="margin-top:12px">
      <div style="border:1px solid #cfcff3;background:#f5f5fd;border-radius:10px;padding:12px 14px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px"><span class="eyebrow" style="color:var(--brand)">AI summary</span>${badge(recKind(an.rec), an.rec === "Replace" ? "Replacement recommended" : an.rec)}</div>
        <p style="margin:0;font-size:13px;line-height:1.6">${an.headline}</p>
      </div>
      <dl class="kv" style="margin-top:8px">${[["Condition", an.condition], ["Warranty", an.warranty], ["Asset age", an.age]].map(([k, v]) => `<div style="grid-template-columns:110px 1fr"><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
      <div class="eyebrow" style="margin-top:8px">Why</div><ul class="dots">${an.reasons.map((r) => `<li>${r}</li>`).join("")}</ul>
      <div style="margin-top:12px;border:1px solid var(--line);background:var(--sunken);border-radius:10px;padding:12px 14px">
        <div class="eyebrow">Suggested next action</div><p style="margin:4px 0 0;font-size:12.5px;line-height:1.6">${an.next}</p>
        ${an.rec === "Replace" ? (ritm
          ? `<p style="margin:10px 0 0;display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ok)">${icon("check")} Request <span class="mono-chip">${ritm}</span> drafted · awaiting IT Asset Manager approval</p>`
          : `<div style="margin-top:10px;display:flex;flex-wrap:wrap;align-items:center;gap:8px"><button class="btn primary" data-act="replace">Draft replacement request</button><span style="font-size:11.5px;color:var(--ink-muted)">Human approval required before anything is ordered.</span></div>`) : ""}
      </div></div>`;
  } else {
    rec = `<p style="margin:12px 0 0;font-size:12.5px;line-height:1.6;color:var(--ink-muted)">Select an asset and choose <b style="color:var(--ink)">Run AI analysis</b>. The assistant summarises condition, warranty and age, and recommends what to do next.</p>`;
  }
  return `${head("Asset Management", "The Asset Lifecycle Assistant reviews ServiceNow hardware asset records, checks age, warranty and condition against the laptop refresh policy, and recommends the next action.", "AI use case · IT Asset Lifecycle Assistant")}
  ${strip("IT teams track thousands of assigned laptops. Reviewing warranty status, asset age, ownership and condition record by record to plan replacements takes time and is easy to miss.", "The assistant analyses the selected asset record, explains its condition, warranty and age, recommends whether to replace it, and drafts the next action for approval.")}
  <div class="card">
    <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-bottom:1px solid var(--line)">
      <div><h2 class="sec-title">${icon("laptop")} Hardware asset inventory</h2><p style="margin:0;font-size:11.5px;color:var(--ink-muted)">ServiceNow · alm_hardware · Model category = Computer</p></div>
      <div class="search" style="width:230px">${icon("search")}<input class="input" id="assetSearch" placeholder="Search assets or people" value="${esc(UI.assetQuery)}"></div>
    </div>
    <div class="tbl-wrap"><table class="t" style="min-width:760px"><thead><tr>${["Asset tag", "Model", "Assigned to", "Department", "Status", "Age", "Warranty", "Condition"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>
      ${rows.map((x) => `<tr class="click ${x.id === a.id ? "sel" : ""}" data-act="asset" data-id="${x.id}">
        <td><span class="mono" style="font-size:11.5px;color:var(--brand)">${x.id}</span>${S.assets.analysed[x.id] ? ` <span style="color:var(--accent)">✦</span>` : ""}</td>
        <td>${x.model}</td><td>${x.assignedTo}</td><td style="color:var(--ink-soft)">${x.department}</td><td style="color:var(--ink-soft)">${x.status}</td>
        <td style="color:var(--ink-soft)">${ageLabel(monthsBetween(x.purchased, now))}</td><td>${badge(warrantyKind(x.warranty), x.warranty)}</td><td>${badge(condKind(x.condition), x.condition)}</td></tr>`).join("")}
    </tbody></table></div>
    <p style="margin:0;padding:10px 20px;border-top:1px solid var(--line);font-size:11.5px;color:var(--ink-muted)">${rows.length} of ${ASSETS.length} mock records · select a row to view details</p>
  </div>
  <div class="grid g2" style="margin-top:16px;align-items:start">
    <div class="card pad"><div class="sec-head"><h2 class="sec-title">${icon("clipboard")} Asset details · ${a.id}</h2>
      <button class="btn primary" data-act="analyse" ${UI.assetRunning ? "disabled" : ""}>${icon(UI.assetRunning ? "loader" : "wand", UI.assetRunning ? "spin" : "")} ${UI.assetRunning ? "Analysing…" : an ? "Re-run AI analysis" : "Run AI analysis"}</button></div>
      <dl class="kv" style="margin-top:8px">${[["Asset type", a.type], ["Model", a.model], ["Serial number", `<span class="mono-chip">${a.serial}</span>`], ["Assigned employee", a.assignedTo], ["Department", a.department], ["Asset status", a.status], ["Purchase date", dmy(a.purchased)], ["Warranty status", badge(warrantyKind(a.warranty), `${a.warranty} · ${dmy(a.warrantyEnd)}`)], ["Condition", badge(condKind(a.condition), a.condition)], ["Location", a.location]].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    </div>
    <div class="card pad"><div class="sec-head"><h2 class="sec-title">${icon("bot")} AI recommendation</h2><span class="note-r">Asset Lifecycle Assistant</span></div>${rec}</div>
  </div>
  ${fdDevicePanel()}
  ${simnote("Asset records, warranty dates and the 48-month refresh policy are mock values for this proof of concept. Replacement requests are simulated and wait for human approval in the Crystal Clean Control Tower.")}`;
}
function runAssetAnalysis() {
  const a = ASSETS.find((x) => x.id === UI.selAsset);
  UI.assetRunning = true; render();
  setTimeout(() => {
    const r = analyseAsset(a, new Date());
    UI.assetShown[a.id] = r; UI.assetRunning = false;
    S.assets.analysed[a.id] = nowIso();
    addExec("asset", a.id, "Success", `Lifecycle analysis: ${r.rec.toLowerCase()} recommendation`, 1400);
    commit();
  }, 1100);
}
function draftReplacement() {
  const a = ASSETS.find((x) => x.id === UI.selAsset);
  if (S.assets.requests[a.id]) return;
  const ritm = "RITM00" + (41200 + S.seq);
  S.assets.requests[a.id] = ritm;
  S.approvals.unshift({ id: "APR-0" + (312 + S.seq), agent: "asset", record: a.id, action: `Replacement assessment for ${a.model} (${ritm})`, approver: "IT Asset Manager", at: nowIso(), status: "Pending" });
  S.seq++;
  addExec("asset", a.id, "Awaiting approval", `Drafted replacement request ${ritm}; awaiting approval`, 900);
  commit();
}

/* -------------------------------------------------------------------- HR */
function hrAnswer(q) {
  const s = q.toLowerCase(), d = S.hr.done;
  const flagged = S.assets.requests.AST001025 || S.assets.analysed.AST001025;
  if (/salary|pay\b|payroll|compensation|medical|health|disab|pregnan|grievance/.test(s)) return { private: true, text: `This looks like a personal or sensitive HR topic, so I won't handle it in chat. I've added it to your private HR case ${EMPLOYEE.hrCase}, and an HR specialist from People & Culture will contact you directly.`, action: "Routed sensitive question to private HR case" };
  if (/document|i-9|i9|w-4|w4|tax|paperwork/.test(s)) return { text: `You need to submit two documents before ${dmy(EMPLOYEE.startDate)}:\n• Form I-9 with identity and work-authorization documents (originals are checked on your first day)\n• Form W-4 federal tax withholding\n\nUpload them in the Employee Center under My Onboarding. ${d.docs ? "Our records show these are already submitted." : "This task is still pending, due 20-Nov-2026."}`, action: "Answered onboarding question: required documents" };
  if (/training|course|module|learn/.test(s)) return { text: `Mandatory training for Finance new hires:\n• Security awareness (about 45 minutes)\n• Privacy & compliance essentials (about 45 minutes)\n\nComplete both by 04-Dec-2026. ${d.training ? "You've already completed them." : "They're assigned and still pending."}`, action: "Answered onboarding question: mandatory training" };
  if (/laptop|equipment|device|computer|access|system/.test(s)) return { text: `Laptop AST001025 (Dell Latitude 7440) is assigned to you and will be at the Canton, MA service desk on your first day.${flagged ? " IT's Asset Lifecycle Assistant has flagged this laptop for a replacement assessment, so you may receive a newer device instead." : ""}\n\nFor system access, confirm with ${EMPLOYEE.manager} which Finance applications you need so access requests can be raised before you start.`, action: "Answered onboarding question: equipment and access" };
  if (/polic|code of conduct|handbook/.test(s)) return { text: "Please read and acknowledge three policies in the Employee Center: the Code of Conduct, the Acceptable Use policy and the Privacy policy. Acknowledging each takes a minute once you've read it.", action: "Answered onboarding question: company policies" };
  if (/step|before (i )?join|what do i need|checklist|to do|todo|complete/.test(s)) return { steps: true, text: `Here are the steps to complete before you join on ${dmy(EMPLOYEE.startDate)}:`, action: "Answered onboarding question: steps before joining" };
  return { text: "I can help with your onboarding steps, required documents, mandatory training, company policies, and equipment or system access. For anything else, I can open an HR case for you.", action: "Answered general onboarding question" };
}
function hrAsk(q) {
  const text = (q || "").trim();
  if (!text || UI.typing) return;
  UI.chatDraft = "";
  S.hr.chat.push({ from: "user", text });
  UI.typing = true; commit();
  setTimeout(() => {
    const a = hrAnswer(text);
    S.hr.chat.push({ from: "assistant", text: a.text, steps: a.steps, private: a.private });
    addExec("hr", EMPLOYEE.hrCase, "Success", a.action, 1200);
    UI.typing = false; commit();
  }, 750);
}
function bubble(m) {
  const me = m.from === "user";
  const steps = m.steps ? `<ol style="list-style:none;margin:8px 0 0;padding:0">${ASSIST_STEPS.map((s) => {
    const t = TASKS.find((x) => x.step === s.step); const dn = t && S.hr.done[t.id];
    return `<li style="display:flex;gap:8px;margin:6px 0;white-space:normal"><span class="mono" style="width:16px;text-align:right;font-size:11.5px;color:var(--ink-muted)">${s.step}.</span><div><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center"><b style="font-weight:500">${s.title}</b>${badge(dn ? "good" : "warning", dn ? "Done" : "Pending")}</div><div style="font-size:12px;color:var(--ink-soft)">${s.hint}</div></div></li>`;
  }).join("")}</ol><p style="margin:8px 0 0;font-size:12px;color:var(--ink-muted);white-space:normal">Start with the pending items due soonest. I can explain any of them.</p>` : "";
  return `<div class="bub rise ${me ? "me" : ""}"><span class="ic">${icon(me ? "user" : "message")}</span><div class="b">${m.private ? `<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;font-size:11px;font-weight:600;color:var(--warn)">${icon("lock")} Routed privately</div>` : ""}${esc(m.text)}${steps}</div></div>`;
}
function pageHR() {
  const done = TASKS.filter((t) => S.hr.done[t.id]).length;
  const pct = Math.round((done / TASKS.length) * 100);
  const pending = TASKS.filter((t) => !S.hr.done[t.id] && t.step > 0).sort((a, b) => a.due.localeCompare(b.due));
  return `${head("HR Services / Employee Onboarding", "ServiceNow HR Service Delivery. The HR Onboarding Assistant answers new-hire questions from approved HR knowledge and the employee's own onboarding checklist.", "AI use case · Onboarding Assistant")}
  ${strip("New employees need help with onboarding steps, documents, account setup and company procedures, and HR teams answer the same questions again and again.", "The assistant explains onboarding requirements, checks the employee's checklist to say what's done and what's pending, and routes sensitive topics to a private HR case.")}
  ${fdHrPanel()}
  <div class="split hr">
    <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
      <div class="card pad">
        <div style="display:flex;gap:12px;align-items:flex-start"><span class="avatar" style="width:44px;height:44px;font-size:14px">MT</span><div><div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px"><h2 style="margin:0;font-size:15px">${EMPLOYEE.name}</h2>${badge("warning", EMPLOYEE.status)}</div><p style="margin:2px 0 0;font-size:12.5px;color:var(--ink-soft)">${EMPLOYEE.title} · ${EMPLOYEE.department}</p></div></div>
        <dl style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin:12px 0 0;font-size:12.5px">${[["Employee ID", `<span class="mono-chip">${EMPLOYEE.id}</span>`], ["Start date", dmy(EMPLOYEE.startDate)], ["Manager", EMPLOYEE.manager], ["Onboarding buddy", EMPLOYEE.buddy], ["Location", EMPLOYEE.location], ["HR case", `<span class="mono-chip">${EMPLOYEE.hrCase}</span>`]].map(([k, v]) => `<div><dt style="font-size:11px;color:var(--ink-muted)">${k}</dt><dd style="margin:2px 0 0">${v}</dd></div>`).join("")}</dl>
      </div>
      <div class="card pad"><div class="sec-head"><h2 class="sec-title">${icon("check")} Onboarding checklist</h2><span class="note-r">${done} of ${TASKS.length} complete</span></div>
        <div style="display:flex;align-items:center;gap:12px;margin-top:12px"><div class="progress" style="flex:1"><div style="width:${pct}%"></div></div><b style="font-size:13px">${pct}%</b></div>
        <ul style="list-style:none;margin:12px 0 0;padding:0">${TASKS.map((t) => { const dn = S.hr.done[t.id]; return `<li style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)">
          <button data-act="task" data-id="${t.id}" style="border:0;background:none;padding:0;color:${dn ? "var(--ok)" : "var(--ink-faint)"};height:18px" aria-label="Toggle ${esc(t.title)}">${icon(dn ? "check" : "circle")}</button>
          <div style="min-width:0;flex:1"><div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px"><span style="font-size:13px;font-weight:500;${dn ? "color:var(--ink-soft)" : ""}">${t.title}</span>${badge(dn ? "good" : "warning", dn ? "Completed" : "Pending")}</div>
          <p style="margin:2px 0 0;font-size:12px;line-height:1.5;color:var(--ink-muted)">${t.detail}</p><p style="margin:2px 0 0;font-size:11px;color:var(--ink-faint)">Due ${dmy(t.due)} · ${t.owner}</p></div></li>`; }).join("")}</ul>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
      <div class="card" style="display:flex;flex-direction:column;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 20px;border-bottom:1px solid var(--line)">
          <div style="display:flex;gap:10px;align-items:center"><span class="agentico">${icon("bot")}</span><div><h2 style="margin:0;font-size:14px">HR Onboarding Assistant</h2><p style="margin:0;font-size:11.5px;color:var(--ink-muted)">Employee Center · answers from approved HR knowledge</p></div></div>
          ${S.hr.chat.length ? `<button class="btn ghost" data-act="clearchat">Clear</button>` : ""}
        </div>
        <div class="chat scroll" id="chatbox">
          ${bubble({ from: "assistant", text: `Hi Maya, welcome to Crystal Clean! I can help you get ready for your start date on ${dmy(EMPLOYEE.startDate)}. What would you like to know?` })}
          ${S.hr.chat.map(bubble).join("")}
          ${UI.typing ? `<div style="font-size:12px;color:var(--ink-muted)"><span class="pulse">●●●</span> Assistant is typing</div>` : ""}
        </div>
        <div style="border-top:1px solid var(--line);padding:12px 16px">
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${HR_SUGGESTIONS.map((s) => `<button class="chip ${s === HR_QUESTION ? "hl" : ""}" data-act="ask" data-q="${esc(s)}" ${UI.typing ? "disabled" : ""}>${esc(s)}</button>`).join("")}</div>
          <form id="chatform" style="display:flex;gap:8px"><input class="input" id="chatinput" placeholder="Ask about onboarding…" value="${esc(UI.chatDraft)}" autocomplete="off"><button class="btn primary lg" type="submit" ${UI.typing ? "disabled" : ""}>${icon("send")} Send</button></form>
        </div>
      </div>
      <div class="card pad"><div class="sec-head"><h2 class="sec-title">${icon("sparkles")} Recommended next steps</h2><span class="note-r">AI-generated from your checklist</span></div>
        ${pending.length ? `<ol style="list-style:none;margin:12px 0 0;padding:0">${pending.slice(0, 3).map((t, i) => `<li style="display:flex;gap:12px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px"><span style="width:22px;height:22px;border-radius:50%;background:var(--brand-soft);color:var(--brand);display:grid;place-items:center;font-size:11px;font-weight:600;flex:none">${i + 1}</span><div><div style="font-size:13px;font-weight:500">${t.title} <span style="font-weight:400;color:var(--ink-muted)">· due ${dmy(t.due)}</span></div><p style="margin:2px 0 0;font-size:12px;line-height:1.5;color:var(--ink-soft)">${(ASSIST_STEPS.find((s) => s.step === t.step) || {}).hint || t.detail}</p></div></li>`).join("")}</ol>`
          : `<p style="margin:12px 0 0;color:var(--ok);font-size:12.5px">All pre-joining steps are complete. See you on ${dmy(EMPLOYEE.startDate)}!</p>`}
      </div>
    </div>
  </div>
  ${simnote("Maya Thompson is a fictional employee. HR policies, documents and training shown here are mock content for this proof of concept, not Crystal Clean policies. No real employee records or sensitive HR data are used.")}`;
}
</script>
