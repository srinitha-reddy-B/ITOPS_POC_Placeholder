/* ------------------------------------------------------ digital frontdoor */
/*
 * One place for the employee to ask about IT Assets, IT Incidents and HR.
 * Each message is routed to a domain and answered in the same conversation.
 * Offline build: routing uses keyword rules (the live app classifies with Cohere
 * in the backend), and every record is simulated.
 */
const fdSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FD_SUGGESTIONS = ["Which laptop is assigned to me?", "My laptop is not working.", "How many leaves do I have remaining?", "What should I complete before joining?"];
const LAPTOP_SYMPTOMS = ["It won't turn on or start up", "It's very slow or freezes", "The screen stays black", "Something else"];
const DOMAINS = {
  assets: { label: "IT Assets", ic: "laptop" },
  incidents: { label: "IT Incidents", ic: "siren" },
  hr: { label: "HR", ic: "users" },
  general: { label: "General", ic: "info" },
};
const PERIPHERALS = [
  { id: "AST002214", type: "Monitor", model: 'Dell P2723DE 27"', serial: "CN-0P27-4XK8", warranty: "Active until Nov 2029" },
  { id: "AST003108", type: "Headset", model: "Jabra Evolve2 65", serial: "JB-E265-90T1", warranty: "Active until Nov 2028" },
];
const DEVICE_HISTORY = [
  { at: "2022-11-15", text: "AST001025 Dell Latitude 7440 purchased (Finance device pool)" },
  { at: "2025-11-15", text: "AST001025 manufacturer warranty ended" },
  { at: "2026-11-04", text: "Docking station requested (RITM0010412)" },
  { at: "2026-11-05", text: "AST001025 laptop, monitor and headset assigned to you for onboarding" },
];
const LEAVE = { year: 2027, note: "Leave starts accruing on your start date, 30 November 2026.", rows: [["Paid time off", 20, 0], ["Sick time", 5, 0], ["Floating holidays", 2, 0]] };
const CASE_STEPS = [
  { id: "logged", it: "Incident logged and routed to the Asset Management workflow", auto: true },
  { id: "checked", it: "Asset record checked (CMDB / alm_hardware, warranty, refresh policy)", auto: true },
  { id: "diagnosed", it: "Remote diagnostics (device management telemetry)", auto: true },
  { id: "reserved", it: "Replacement reserved from depot stock", auto: true },
  { id: "prepared", it: "Replacement prepared: enrolment, Finance app bundle, profile restore", auto: true },
  { id: "handover", it: "Handover arranged and employee notified", auto: true },
  { id: "confirm", it: "Employee confirms the issue is resolved", auto: false },
];
const FD_STAGES = [["received", "Received"], ["in_progress", "Being fixed"], ["ready", "Ready for you"], ["resolved", "Resolved"]];
const INTENT_LABEL = {
  my_assets: "Assigned devices", asset_requests: "Equipment request status", asset_history: "Device history", request_asset: "New equipment request",
  report_issue: "Reported a problem", incident_status: "Incident status", incident_history: "Incident history", troubleshoot: "Setup and troubleshooting",
  leave_balance: "Leave balance", my_profile: "Employee details", onboarding: "Onboarding", hr_policy: "HR policy question", hr_request: "HR request",
  hr_request_status: "HR request status", sensitive: "Private HR matter",
};

function freshFd() {
  const act = (id, group, label, detail, done, failsFirst) => ({ id, group, label, detail, status: done ? "done" : "pending", attempts: done ? 1 : 0, failsFirst: !!failsFirst });
  return {
    started: false, seq: 1, pending: null, cases: [], interactions: [],
    chat: [{ id: "m0", from: "aura", text: "Hi Maya, I'm AURA. Ask me anything about your IT equipment, something that isn't working, or HR, in your own words. I'll work out what you need and get it to the right team.", card: { type: "options", options: FD_SUGGESTIONS } }],
    // Maya's earlier laptop incidents: real records in the POC ServiceNow instance (linked).
    pastIncidents: [
      { number: "INC0010065", title: "Laptop not working: it's very slow or freezes (AST001025)", state: "Resolved", opened: "2026-11-10" },
      { number: "INC0010064", title: "Laptop not working: it won't turn on or start up (AST001025)", state: "Resolved", opened: "2026-11-10" },
    ],
    assetReqs: [{ id: "AR0", number: "RITM0010412", item: "Docking station (Dell WD19S)", status: "Delivered", createdAt: "2026-11-04T15:10:00.000Z", updatedAt: "2026-11-06T10:30:00.000Z", sample: true }],
    hrReqs: [{ id: "HR0", number: "HRC0004512", topic: "New hire onboarding", status: "In progress", createdAt: "2026-10-28T14:00:00.000Z", updatedAt: "2026-11-09T09:00:00.000Z", sample: true }],
    actions: [
      act("acct", "onboarding", "Your Crystal Clean account and email", "Entra ID account + Exchange Online mailbox provisioned", true),
      act("teams", "onboarding", "Microsoft Teams and Outlook", "M365 E5 licence assigned; Teams policy applied", true),
      act("laptop", "onboarding", "Your laptop", "AST001025 (Dell Latitude 7440) assigned in alm_hardware", true),
      act("finance", "onboarding", "Access to Finance applications", "Access request: Workday Financials + SAP Concur (role FIN-ANALYST)", false, true),
      act("badge", "onboarding", "Building badge for Canton office", "Badge request to Facilities (Lenel OnGuard)", false),
      act("mdm", "setup", "Laptop registered with Crystal Clean", "Intune enrolment and compliance policy", false),
      act("mfa", "setup", "Sign-in security (Microsoft Authenticator)", "Entra ID MFA registration check", false),
      act("vpn", "setup", "Remote access (VPN)", "GlobalProtect VPN profile push", false, true),
      act("apps", "setup", "Finance apps installed", "Company Portal app bundle: Excel add-ins, Concur, Workday", false),
    ],
  };
}
if (!S.fd) S.fd = freshFd();
// Work interrupted by a reload goes back to pending and is resumed.
S.fd.actions.forEach((a) => { if (a.status === "running") a.status = "pending"; });
S.fd.cases.forEach((c) => c.steps.forEach((s) => { if (s.status === "running") s.status = "pending"; }));
UI.fdTab = UI.fdTab || "all";
UI.fdDraft = UI.fdDraft || "";

const FD = () => S.fd || (S.fd = freshFd());
const fdNow = () => new Date().toISOString();
const fdCase = (id) => FD().cases.find((c) => c.id === id);
function fdSay(from, text, card) { const m = { id: "m" + FD().seq++, from, text, card }; FD().chat.push(m); return m; }
const an = (w) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);

/* ------------------------------------------------------------- routing */
const DEVICE = /\b(laptop|computer|pc|notebook|device|machine|dell|latitude)\b/i;
const BROKEN = /not working|isn'?t working|broken|won'?t|doesn'?t|dead|slow|crash|freez|black|blue screen|stopped|fail|issue|problem|can'?t|cannot|unable|error/i;

function fdRoute(text) {
  const t = text.toLowerCase();
  const num = (text.match(/\b((?:INC|RITM|REQ|HRC)\d{7})\b/i) || [])[1];
  const n = num ? num.toUpperCase() : undefined;
  const r = (domain, intent, device) => ({ domain, intent, number: n, device: !!device });
  if (/salary|payroll|\bpay\b|compensation|medical|disab|pregnan|grievance|harass|leave of absence/.test(t)) return r("hr", "sensitive");
  if (n && n.startsWith("HRC")) return r("hr", "hr_request_status");
  if (n && (n.startsWith("RITM") || n.startsWith("REQ"))) return r("assets", "asset_requests");
  if (n || /(incident|ticket).*(status|update)|(status|update).*(incident|ticket)/.test(t)) return r("incidents", "incident_status");
  if (/\b(leaves?|pto|vacation|holiday|time off|sick days?)\b/.test(t)) return r("hr", "leave_balance");
  if (DEVICE.test(t) && BROKEN.test(t)) return r("incidents", "report_issue", true);
  if (/my (incidents|tickets)|incident history/.test(t)) return r("incidents", "incident_history");
  if (/set ?(it |my |me )?up|setting up|install|configure|mfa|authenticator|vpn|remote access/.test(t)) return r("incidents", "troubleshoot");
  if (BROKEN.test(t)) return r("incidents", "report_issue");
  if (/(asset|device|equipment|monitor|headset).*(request|order)/.test(t) && /status|where|track/.test(t)) return r("assets", "asset_requests");
  if (/\b(need|want|request|order|get) (a |an |another |new )?(second )?(monitor|headset|keyboard|mouse|dock|docking|webcam|laptop|charger)/.test(t)) return r("assets", "request_asset");
  if (/history/.test(t) && /laptop|device|asset/.test(t)) return r("assets", "asset_history");
  if (/(assigned|my) (laptop|device|computer|assets?|equipment)|serial|warranty|asset tag/.test(t) || (DEVICE.test(t) && /which|who|what/.test(t))) return r("assets", "my_assets");
  if (/hr (request|case)|my (hr )?requests?/.test(t)) return r("hr", "hr_request_status");
  if (/letter|verification|change (my )?address|update (my )?(address|bank|details)|benefits? (enrol|change)/.test(t)) return r("hr", "hr_request");
  if (/manager|employee id|job title|department|start date|buddy|my profile|who am i/.test(t)) return r("hr", "my_profile");
  if (/before (i )?join|onboard|first day|checklist|documents?|i-9|w-4|training|to ?do|complete/.test(t)) return r("hr", "onboarding");
  if (/polic|benefit|dress code|working hours|hybrid|401k|insurance/.test(t)) return r("hr", "hr_policy");
  if (/^(thanks|thank you|great|ok|okay|cool)\b/.test(t)) return r("general", "thanks");
  return r("general", "unclear");
}

async function fdAsk(text) {
  const t = (text || "").trim();
  if (!t || UI.fdThinking) return;
  UI.fdDraft = "";
  const m = fdSay("employee", t);
  UI.fdThinking = true; commit();
  await fdSleep(450);
  UI.fdThinking = false;
  if (FD().pending === "laptop-symptom") {
    FD().pending = null;
    const other = fdRoute(t);
    if (LAPTOP_SYMPTOMS.includes(t) || other.domain === "general" || other.intent === "report_issue") {
      fdSay("aura", `Thanks. I'll raise this with IT for your ${ASSETS.find((a) => a.id === "AST001025").model}. Shall I go ahead?`, { type: "confirm-laptop", symptom: t });
      commit(); return;
    }
  }
  const route = fdRoute(t);
  m.route = { domain: route.domain, intent: route.intent };
  FD().interactions.unshift({ id: m.id, at: fdNow(), text: t, domain: route.domain, intent: route.intent });
  if (route.domain === "assets") fdAssets(route, t);
  else if (route.domain === "incidents") fdIncidents(route, t);
  else if (route.domain === "hr") fdHr(route, t);
  else if (route.intent === "thanks") fdSay("aura", "You're welcome. I'm here if you need anything else.");
  else fdSay("aura", "I can help with your IT equipment, anything that isn't working, and HR questions. Just ask in your own words, for example:", { type: "options", options: FD_SUGGESTIONS });
  commit();
}

/* IT Assets */
const ITEMS = [[/second monitor|another monitor/i, "Second monitor"], [/monitor|screen/i, "Monitor"], [/headset|headphone/i, "Headset"], [/keyboard/i, "Keyboard"], [/mouse/i, "Mouse"], [/dock/i, "Docking station"], [/webcam|camera/i, "Webcam"], [/charger/i, "Laptop charger"], [/laptop/i, "Laptop"]];
function fdDevices() {
  const c = FD().cases.find((x) => x.replacement);
  const lap = ASSETS.find((a) => a.id === (c && c.stage === "resolved" ? c.replacement : "AST001025"));
  return [{ id: lap.id, type: "Laptop", model: lap.model, serial: lap.serial, warranty: lap.warranty === "Expired" ? `Expired ${lap.warrantyEnd}` : `${lap.warranty} until ${lap.warrantyEnd}` }, ...PERIPHERALS];
}
function fdAssetReqs() {
  const derived = FD().cases.filter((c) => c.replacement).map((c) => ({ id: "rep-" + c.id, number: c.number, item: `Replacement laptop (${c.replacement})`, status: c.stage === "resolved" ? "Delivered" : c.stage === "ready" ? "Ready for pickup" : "Approved", createdAt: c.createdAt, updatedAt: c.createdAt }));
  return derived.concat(FD().assetReqs);
}
function fdAssets(route, text) {
  if (route.intent === "asset_requests") { const open = fdAssetReqs().filter((r) => r.status !== "Delivered").length; fdSay("aura", open ? `You have ${open} equipment request${open === 1 ? "" : "s"} in progress:` : "All your equipment requests have been delivered:", { type: "asset-requests" }); }
  else if (route.intent === "asset_history") fdSay("aura", "Here's the history of the equipment assigned to you:", { type: "asset-history" });
  else if (route.intent === "request_asset") { const item = (ITEMS.find(([re]) => re.test(text)) || [0, "Equipment"])[1]; fdSay("aura", `I can request that for you. Equipment requests are approved by your manager, ${EMPLOYEE.manager}. Shall I go ahead?`, { type: "confirm-asset", item }); }
  else { const l = fdDevices()[0]; fdSay("aura", `Your laptop is a ${l.model}, asset tag ${l.id}. Here's everything assigned to you:`, { type: "assets" }); }
}

/* IT Incidents */
function fdIncidents(route, text) {
  if (route.intent === "report_issue") {
    if (route.device || (DEVICE.test(text) && BROKEN.test(text))) { FD().pending = "laptop-symptom"; fdSay("aura", "Sorry about that. I can get IT working on it straight away. What's happening with your laptop?", { type: "options", options: LAPTOP_SYMPTOMS }); }
    else fdSay("aura", "That sounds like an IT problem. I can raise an incident with the IT service desk for you.", { type: "confirm-it", text });
  } else if (route.intent === "troubleshoot") {
    fdSay("aura", "I'll check your setup now and fix what I can automatically. You can follow along here:", { type: "setup" });
    setTimeout(() => fdRunActions("setup"), 50);
  } else if (route.intent === "incident_status" && route.number && route.number.startsWith("INC")) {
    const mine = fdIncidentRows().find((r) => r.number === route.number);
    if (!mine) fdSay("aura", `I couldn't find ${route.number} among your incidents. For privacy, I can only show incidents you raised yourself. Here are yours:`, { type: "incidents" });
    else if (mine.caseId) fdSay("aura", `Here's the latest on ${route.number}:`, { type: "case", caseId: mine.caseId });
    else fdSay("aura", `Here's ${route.number}:`, { type: "incidents", only: route.number });
  } else if (route.intent === "incident_status") {
    const active = FD().cases.find((c) => c.stage !== "resolved");
    if (active) fdSay("aura", "Here's your open request:", { type: "case", caseId: active.id });
    else fdSay("aura", "You have no open incidents. Here are your recent ones:", { type: "incidents" });
  } else fdSay("aura", "Here are the incidents you've raised:", { type: "incidents" });
}

/* HR */
function fdPolicy(t) {
  t = t.toLowerCase();
  if (/benefit|insurance|dental|vision|401k|retire/.test(t)) return "You can enrol in medical, dental, vision and the 401(k) plan within 30 days of your start date, so by 30 December 2026. The enrolment link is in the Employee Center under My Benefits.";
  if (/hybrid|remote|office|work from home|wfh|working hours/.test(t)) return "Finance works hybrid: three days a week in the Canton office (Tuesday to Thursday) and two days remote. Core hours are 10:00 AM to 3:00 PM Eastern.";
  if (/holiday/.test(t)) return "Crystal Clean observes 10 company holidays a year, plus 2 floating holidays you choose. The 2027 calendar is in the Employee Center.";
  if (/polic|code of conduct|handbook|dress/.test(t)) return "Please read and acknowledge the Code of Conduct, Acceptable Use and Privacy policies in the Employee Center. Business casual is the norm in the office.";
  return null;
}
const HR_TOPICS = [[/letter|verification/i, "Employment verification letter"], [/address/i, "Address change"], [/bank|direct deposit/i, "Direct deposit change"], [/benefit/i, "Benefits enrolment change"], [/name/i, "Name change"]];
function fdAddHr(topic, isPrivate) {
  const r = { id: "HR" + FD().seq, number: "HRC" + String(4520 + FD().seq).padStart(7, "0"), topic, status: "Submitted", createdAt: fdNow(), updatedAt: fdNow(), private: !!isPrivate };
  FD().seq++; FD().hrReqs.unshift(r); return r.number;
}
function fdHr(route, text) {
  const i = route.intent;
  if (i === "leave_balance") fdSay("aura", `For ${LEAVE.year} you have 20 days of paid time off, 5 sick days and 2 floating holidays. ${LEAVE.note}`, { type: "leave" });
  else if (i === "my_profile") fdSay("aura", /manager/i.test(text) ? `Your manager is ${EMPLOYEE.manager}. Here are your details:` : "Here are your employee details:", { type: "profile" });
  else if (i === "onboarding") {
    const left = TASKS.filter((x) => x.owner === "Employee" && !S.hr.done[x.id]).length;
    fdSay("aura", left ? `You start on 30 November. You have ${left} thing${left === 1 ? "" : "s"} left to do before then. Tick each one off as you finish it:` : "You've completed everything on your list. You're ready for your first day on 30 November.", { type: "checklist" });
  } else if (i === "hr_policy") {
    const a = fdPolicy(text);
    if (a) fdSay("aura", a); else fdSay("aura", "I don't have an approved answer for that. I can send your question to People & Culture.", { type: "confirm-hr", topic: "HR question", text });
  } else if (i === "hr_request") {
    const topic = (HR_TOPICS.find(([re]) => re.test(text)) || [0, "HR request"])[1];
    fdSay("aura", `I can raise ${an(topic.toLowerCase())} request with People & Culture. Shall I go ahead?`, { type: "confirm-hr", topic, text });
  } else if (i === "hr_request_status") {
    const open = FD().hrReqs.filter((r) => r.status !== "Completed").length;
    fdSay("aura", open ? `You have ${open} HR request${open === 1 ? "" : "s"} open:` : "All your HR requests are completed:", { type: "hr-requests" });
  } else if (i === "sensitive") {
    const n = fdAddHr("Private HR matter", true);
    fdSay("aura", `That sounds like a personal matter, so I've opened a private HR case for you (${n}). Only People & Culture can see it, and an HR specialist will contact you confidentially.`);
  } else fdSay("aura", "Here are your employee details:", { type: "profile" });
}

/* ----------------------------------------------------------- answers */
function fdAnswer(msgId, yes) {
  const m = FD().chat.find((x) => x.id === msgId);
  if (!m || m.answered) return;
  m.answered = true;
  const c = m.card;
  if (!yes) { fdSay("employee", "Not now"); fdSay("aura", "No problem. Ask me again whenever you're ready."); commit(); return; }
  if (c.type === "confirm-asset") {
    fdSay("employee", "Yes, request it");
    const r = { id: "AR" + FD().seq, number: "RITM00" + (10420 + FD().seq), item: c.item, status: "Submitted", createdAt: fdNow(), updatedAt: fdNow() };
    FD().seq++; FD().assetReqs.unshift(r);
    fdSay("aura", `Done. Request ${r.number} for ${an(c.item.toLowerCase())} is waiting for ${EMPLOYEE.manager}'s approval. You can follow it under IT Assets.`, { type: "asset-requests" });
  } else if (c.type === "confirm-hr") {
    fdSay("employee", "Yes, raise it");
    const n = fdAddHr(c.topic);
    fdSay("aura", `Done. Your request ${n} is with People & Culture. You can follow it under HR.`, { type: "hr-requests" });
  } else if (c.type === "confirm-it") {
    fdSay("employee", "Yes, raise it");
    const id = fdNewCase("it", c.text.slice(0, 120));
    fdSay("aura", `Done. Your request ${fdCase(id).number} is with the IT service desk. I'll keep you updated here.`, { type: "case", caseId: id });
  } else if (c.type === "confirm-laptop") {
    fdSay("employee", "Yes, raise it");
    const id = fdNewCase("laptop", `Laptop not working: ${c.symptom.toLowerCase()} (AST001025)`);
    fdSay("aura", `Done. Your request ${fdCase(id).number} is with IT. You don't need to do anything else; I'll keep you updated here.`, { type: "case", caseId: id });
    commit(); fdRunCase(id); return;
  }
  commit();
}

/* --------------------------------------------- device incident (simulated) */
function fdNewCase(kind, summary) {
  const id = "CASE-" + FD().seq;
  const number = "INC00" + (10070 + FD().seq);
  FD().seq++;
  const c = {
    id, kind, summary, number, createdAt: fdNow(), stage: kind === "laptop" ? "received" : "in_progress", notes: [],
    steps: kind === "laptop" ? CASE_STEPS.map((s) => ({ id: s.id, status: "pending", attempts: 0 })) : [{ id: "logged", status: "done", attempts: 1, detail: `Created ${number}; handed to the IT service desk` }],
    updates: [{ at: fdNow(), text: kind === "laptop" ? "We've received your request about your laptop." : "We've received your request. The IT service desk is looking at it." }],
  };
  FD().cases.unshift(c);
  return id;
}
function fdTell(c, text) { c.updates.push({ at: fdNow(), text }); }
function fdNote(c, text) { c.notes.push({ at: fdNow(), text: `[AURA] Asset agent · ${text}` }); }
class FdFailure extends Error { constructor(msg, employee) { super(msg); this.employee = employee; } }

function fdExec(c, step, attempt) {
  if (step === "logged") {
    c.stage = "in_progress";
    fdNote(c, `Routed: raised by ${EMPLOYEE.name} in the Digital FrontDoor; classified as IT Incidents / device issue for asset AST001025. Assigned to the Asset & Endpoint Agent.`);
    fdTell(c, "Hi Maya, we've received your request about your laptop and our IT team is working on it. We'll update you here.");
    return `${c.number} (simulated) · category Hardware · state In Progress · routed to Asset Management`;
  }
  if (step === "checked") { const d = "AST001025 Dell Latitude 7440, serial DL7440-8KQ2M3, assigned to Maya Thompson. Purchased 2022-11-15; warranty expired (2025-11-15); condition Fair. Lifecycle check: Replace."; fdNote(c, "Device checked: " + d); return d; }
  if (step === "diagnosed") {
    const d = "Repeated boot failures; storage health reports a predictive SSD failure (simulated telemetry). Out of warranty (repair not covered) and due for refresh under the laptop lifecycle policy. Decision: like-for-like replacement from depot stock (permitted without approval).";
    fdNote(c, "Diagnostics: " + d);
    fdTell(c, "We've checked your laptop. It has a hardware fault that can't be fixed remotely, so we're preparing a replacement laptop for you.");
    return d;
  }
  if (step === "reserved") { c.replacement = "AST001067"; const d = "Reserved AST001067 Dell Latitude 7440 (Canton, MA · Depot). Retirement of AST001025 sent to the IT Asset Manager for approval."; fdNote(c, "Replacement reserved: " + d); return d; }
  if (step === "prepared") {
    if (attempt === 1) throw new FdFailure("Device enrolment timed out: the replacement didn't finish pre-provisioning within 15 minutes (simulated failure).", "Setting up your replacement laptop is taking a little longer than expected. There's nothing you need to do; our IT team is on it.");
    const d = "Enrolled in device management, Finance app bundle installed, profile set to restore from OneDrive at first sign-in.";
    fdNote(c, `Replacement prepared${attempt > 1 ? " after retry" : ""}: ${d}`); return d;
  }
  if (step === "handover") {
    const d = "Desk pickup booked: Canton IT depot, today 3:00 PM. Courier available on request.";
    fdNote(c, "Handover arranged: " + d); c.stage = "ready";
    fdTell(c, "Your replacement laptop is ready. Collect it from the IT desk in Canton today at 3:00 PM, or ask for it to be couriered. Sign in as usual and your files will sync automatically. Let us know it's working.");
    return d;
  }
  return "";
}
async function fdRunCase(id) {
  for (;;) {
    const c = fdCase(id);
    if (!c || c.kind !== "laptop") return;
    const next = c.steps.find((s) => s.status !== "done" && s.status !== "manual_done");
    if (!next || next.status !== "pending" || next.id === "confirm") return;
    next.status = "running"; next.attempts++; commit();
    await fdSleep(next.id === "logged" ? 500 : 1300);
    try {
      next.detail = fdExec(c, next.id, next.attempts); next.status = "done"; next.error = null;
    } catch (e) {
      next.status = "failed"; next.error = e.message;
      fdNote(c, `Action failed: ${CASE_STEPS.find((s) => s.id === next.id).it}. ${e.message} Waiting for IT: retry or manual takeover.`);
      if (e.employee) fdTell(c, e.employee);
      addExec("asset", c.number, "Failed", "Device preparation failed; waiting for retry or manual takeover", 1300);
      commit(); return;
    }
    commit();
  }
}
function fdRetryStep(id, step) { const s = fdCase(id).steps.find((x) => x.id === step); s.status = "pending"; commit(); fdRunCase(id); }
function fdManualStep(id, step) { const c = fdCase(id); const s = c.steps.find((x) => x.id === step); s.status = "manual"; s.error = null; fdNote(c, `Manual takeover: "${CASE_STEPS.find((x) => x.id === step).it}" handed from the agent to an IT technician, Canton depot.`); commit(); }
function fdDoneStep(id, step) { const c = fdCase(id); const s = c.steps.find((x) => x.id === step); s.status = "manual_done"; s.detail = "Completed manually by an IT technician, Canton depot."; fdNote(c, "Completed manually by an IT technician; agent resumes the remaining steps."); commit(); fdRunCase(id); }
function fdConfirm(id, works) {
  const c = fdCase(id); const s = c.steps.find((x) => x.id === "confirm");
  if (works) {
    s.status = "done"; c.stage = "resolved"; c.outcome = "Your laptop was replaced and you confirmed it's working.";
    fdNote(c, `Employee confirmed the replacement laptop ${c.replacement} works. Incident resolved (Solution provided).`);
    fdTell(c, "Thanks for confirming. Your request is now resolved.");
    addExec("asset", c.number, "Success", "Replaced failing laptop; employee confirmed, incident resolved", 9000);
  } else {
    s.status = "manual"; c.stage = "with_it";
    fdNote(c, "Employee reports the replacement is still not working. Handed to the IT service desk for a technician.");
    fdTell(c, "Sorry it's still not right. An IT technician will contact you today to sort it out in person.");
  }
  commit();
}

/* ------------------------------------------------- onboarding automations */
const ACTION_ERRORS = { finance: ["Role assignment rejected: cost centre FIN-210 isn't active for this new hire yet (simulated failure).", "Setting up your access to Finance applications didn't complete."], vpn: ["VPN profile push failed: device not yet compliant (simulated failure).", "Setting up remote access didn't complete."] };
const fdRunning = {};
async function fdRunAction(a) {
  a.status = "running"; a.attempts++; a.error = null; commit();
  await fdSleep(1100);
  if (a.failsFirst && a.attempts === 1) { const e = ACTION_ERRORS[a.id]; a.status = "failed"; a.error = e[0]; a.employeeError = e[1]; a.at = fdNow(); }
  else { a.status = "done"; a.at = fdNow(); }
  commit();
}
async function fdRunActions(group) {
  if (fdRunning[group]) return; fdRunning[group] = true;
  try { for (const a of FD().actions.filter((x) => x.group === group && x.status === "pending")) await fdRunAction(a); } finally { fdRunning[group] = false; }
}
function fdActRetry(id) { const a = FD().actions.find((x) => x.id === id); if (a && a.status === "failed") fdRunAction(a); }
function fdActManual(id) { const a = FD().actions.find((x) => x.id === id); a.status = "manual"; a.ticket = "REQ00" + (31000 + FD().seq++); commit(); }
function fdActDone(id) { const a = FD().actions.find((x) => x.id === id); a.status = "manual_done"; a.at = fdNow(); commit(); }
function fdAdvance(list, id, order) { const r = FD()[list].find((x) => x.id === id); r.status = order[Math.min(order.length - 1, order.indexOf(r.status) + 1)]; r.updatedAt = fdNow(); commit(); }

/* ------------------------------------------------------------- rendering */
const dchip = (d, title) => `<span class="dchip d-${d}" ${title ? `title="${esc(title)}"` : ""}>${icon(DOMAINS[d].ic)}${DOMAINS[d].label}</span>`;
const tn = (tone, label) => `<span class="tn tn-${tone}">${esc(label)}</span>`;
const fdDate = (iso) => { if (!iso) return ""; const d = new Date(iso.length <= 10 ? iso + "T12:00:00" : iso); return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
const fdTime = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const row = (title, sub, right, extra = "") => `<div class="fd-row"><div style="min-width:0;flex:1"><div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ""}${extra}</div>${right || ""}</div>`;
const empty = (t) => `<p style="margin:6px 0;font-size:12px;color:var(--ink-muted)">${t}</p>`;

function stageInfo(c) {
  if (c.stage === "resolved") return ["Resolved", "ok", "resolved"];
  if (c.stage === "ready") return ["Waiting for you", "warn", "pending"];
  if (c.stage === "with_it") return ["With an IT technician", "warn", "pending"];
  return [c.stage === "received" ? "Received" : "Being worked on", c.stage === "received" ? "info" : "brand", "open"];
}
function fdIncidentRows() {
  const rows = FD().cases.map((c) => { const [label, tone, group] = stageInfo(c); return { number: c.number, title: c.kind === "laptop" ? "Laptop not working" : c.summary, label, tone, group, opened: c.createdAt, latest: c.updates[c.updates.length - 1].text, caseId: c.id }; });
  FD().pastIncidents.forEach((p) => rows.push({ number: p.number, title: p.title, label: "Resolved", tone: "ok", group: "resolved", opened: p.opened }));
  return rows;
}
const incLine = (r, open) => row(esc(r.title), `${snowLink(r.number)} · raised ${fdDate(r.opened)}`, tn(r.tone, r.label), (r.latest ? `<p class="s" style="margin:2px 0 0;color:var(--ink-soft)">${esc(r.latest)}</p>` : "") + (open && r.caseId ? `<button class="linkbtn" data-act="fd-open" data-c="${r.caseId}">View progress</button>` : ""));

function caseCard(c, compact) {
  const [label, tone] = stageInfo(c);
  const idx = c.stage === "with_it" ? 1 : FD_STAGES.findIndex((s) => s[0] === c.stage);
  const latest = c.updates[c.updates.length - 1];
  return `<div class="${compact ? "fd-box" : ""}" style="${compact ? "padding:12px 14px" : "padding:10px 0"}">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div style="min-width:0"><div style="font-size:13px;font-weight:500">${esc(c.kind === "laptop" ? "Laptop not working" : c.summary)}</div><div class="s" style="font-size:11.5px;color:var(--ink-muted)">Incident ${c.number}</div></div>${tn(tone, label)}</div>
    <div class="stagebar">${FD_STAGES.map((s, i) => `<div><div class="sb ${i <= idx ? (c.stage === "resolved" ? "ok" : "on") : ""}"></div><div class="sl ${i === idx ? "cur" : ""}">${s[1]}</div></div>`).join("")}</div>
    <p style="margin:8px 0 0;font-size:12.5px;line-height:1.55;color:var(--ink-soft)">${esc(latest.text)}</p>
    ${c.stage === "ready" && c.kind === "laptop" ? `<div class="fd-ask"><b>Is your replacement laptop working?</b><div style="display:flex;gap:8px;margin-top:8px"><button class="btn primary" data-act="fd-confirm" data-c="${c.id}" data-v="1">${icon("check")} Yes, it works</button><button class="btn" data-act="fd-confirm" data-c="${c.id}" data-v="0">No, still a problem</button></div></div>` : ""}
    ${c.stage === "resolved" && c.outcome ? `<p class="fd-okline">${icon("check")} ${esc(c.outcome)}</p>` : ""}
  </div>`;
}
function deviceList() {
  const ic = { Laptop: "laptop", Monitor: "grid", Headset: "user" };
  return fdDevices().map((d) => `<div class="fd-row"><span class="fd-ic">${icon(ic[d.type] || "grid")}</span><div style="min-width:0;flex:1"><div class="t">${esc(d.model)}</div><div class="s">${d.type} · asset tag ${d.id} · serial ${d.serial}</div><div class="s">Warranty: ${d.warranty}</div></div>${tn("ok", "Assigned")}</div>`).join("");
}
const REQ_TONE = { Submitted: "info", Approved: "brand", "Ready for pickup": "warn", Delivered: "ok", "In progress": "brand", Completed: "ok" };
const assetReqList = () => fdAssetReqs().map((r) => row(esc(r.item), `${r.number} · requested ${fdDate(r.createdAt)}${r.status === "Submitted" ? ` · waiting for ${EMPLOYEE.manager}'s approval` : ""}`, tn(REQ_TONE[r.status], r.status))).join("") || empty("No equipment requests yet.");
function deviceHistory() {
  const ev = DEVICE_HISTORY.slice();
  FD().cases.filter((c) => c.kind === "laptop").forEach((c) => {
    ev.push({ at: c.createdAt.slice(0, 10), text: `Laptop problem reported (${c.number})` });
    if (c.replacement) ev.push({ at: c.createdAt.slice(0, 10), text: `Replacement laptop ${c.replacement} prepared for you` });
    if (c.stage === "resolved") ev.push({ at: c.createdAt.slice(0, 10), text: `Replacement ${c.replacement} confirmed working; old laptop returned to IT` });
  });
  FD().assetReqs.filter((r) => !r.sample).forEach((r) => ev.push({ at: r.createdAt.slice(0, 10), text: `${r.item} requested (${r.number})` }));
  ev.sort((a, b) => (a.at < b.at ? 1 : -1));
  return `<ol class="fd-tl">${ev.map((e) => `<li><span>${fdDate(e.at)} · </span>${esc(e.text)}</li>`).join("")}</ol>`;
}
const leaveTable = () => `<table class="fd-tbl"><thead><tr><th>${LEAVE.year}</th><th>Allowance</th><th>Used</th><th>Remaining</th></tr></thead><tbody>${LEAVE.rows.map(([t, a, u]) => `<tr><td>${t}</td><td>${a} days</td><td>${u}</td><td><b>${a - u}</b></td></tr>`).join("")}</tbody></table><p class="s" style="margin:6px 0 0;font-size:11.5px;color:var(--ink-muted)">${LEAVE.note}</p>`;
const profile = () => `<dl class="fd-kv">${[["Employee ID", EMPLOYEE.id], ["Job title", EMPLOYEE.title], ["Department", EMPLOYEE.department], ["Manager", EMPLOYEE.manager], ["Location", EMPLOYEE.location], ["Start date", dmy(EMPLOYEE.startDate)], ["Onboarding buddy", EMPLOYEE.buddy]].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
const hrReqList = () => FD().hrReqs.map((r) => row(`${r.private ? icon("lock") + " " : ""}${esc(r.topic)}`, `${r.number} · raised ${fdDate(r.createdAt)}${r.private ? " · private, visible to People & Culture only" : ""}`, tn(REQ_TONE[r.status], r.status))).join("") || empty("No HR requests yet.");
const taskList = () => TASKS.filter((t) => t.owner === "Employee").map((t) => { const dn = S.hr.done[t.id]; return `<div class="fd-row"><button data-act="task" data-id="${t.id}" class="fd-tick ${dn ? "on" : ""}" aria-label="Toggle ${esc(t.title)}">${dn ? icon("check") : ""}</button><div style="min-width:0;flex:1"><div class="t" style="${dn ? "color:var(--ink-muted);text-decoration:line-through;font-weight:400" : ""}">${esc(t.title)}</div>${dn ? "" : `<div class="s">${esc(t.detail)}</div>`}</div><span class="s" style="font-size:11px;color:var(--ink-muted)">${dn ? "Done" : "Due " + fdDate(t.due)}</span></div>`; }).join("");
function actionList(acts) {
  const lbl = { done: "Ready", running: "Setting up…", failed: "Didn't complete", manual: "With the IT team", manual_done: "Ready (done by IT)", pending: "Waiting" };
  const ic = { done: ["check", "var(--ok)"], manual_done: ["check", "var(--ok)"], running: ["loader", "var(--brand)"], failed: ["xcircle", "var(--danger)"], manual: ["user", "var(--warn)"], pending: ["circle", "var(--ink-faint)"] };
  return acts.map((a) => `<div class="fd-row" style="flex-direction:column;gap:4px"><div style="display:flex;gap:10px;align-items:center;width:100%"><span style="color:${ic[a.status][1]};height:16px">${icon(ic[a.status][0], a.status === "running" ? "spin" : "")}</span><span style="flex:1;font-size:12.5px">${esc(a.label)}</span><span style="font-size:11px;${a.status === "failed" ? "color:var(--danger);font-weight:500" : "color:var(--ink-muted)"}">${lbl[a.status]}</span></div>
    ${a.status === "failed" ? `<div class="fd-fail"><p>${esc(a.employeeError)}</p><div style="display:flex;gap:8px;margin-top:8px"><button class="btn" data-act="fd-act-retry" data-a="${a.id}">${icon("rotate")} Retry</button><button class="btn ghost" data-act="fd-act-manual" data-a="${a.id}">${icon("hand")} Manual takeover</button></div><p class="s" style="font-size:11px;color:var(--ink-muted);margin:6px 0 0">Manual takeover hands this to the IT team to finish for you.</p></div>` : ""}
    ${a.status === "manual" ? `<p style="margin:0 0 0 26px;font-size:11.5px;color:var(--ink-muted)">The IT team is finishing this for you (request ${a.ticket}).</p>` : ""}</div>`).join("");
}
function obProgress() {
  const mine = TASKS.filter((t) => t.owner === "Employee"); const acts = FD().actions.filter((a) => a.group === "onboarding");
  return { done: mine.filter((t) => S.hr.done[t.id]).length + acts.filter((a) => a.status === "done" || a.status === "manual_done").length, total: mine.length + acts.length };
}
const boxed = (h) => `<div class="fd-box">${h}</div>`;
const yesNo = (m, yes) => (m.answered ? "" : `<div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" data-act="fd-yes" data-m="${m.id}">${yes}</button><button class="btn ghost" data-act="fd-no" data-m="${m.id}">Not now</button></div>`);

function cardHtml(m) {
  const c = m.card;
  switch (c.type) {
    case "options": return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${c.options.map((o) => `<button class="chip fd-opt" data-act="fd-opt" data-m="${m.id}" data-q="${esc(o)}" ${m.answered ? "disabled" : ""}>${esc(o)}</button>`).join("")}</div>`;
    case "confirm-laptop": return boxed(`<div style="display:flex;gap:8px;align-items:center;font-size:12.5px;padding-top:4px"><span style="color:var(--brand);height:16px">${icon("laptop")}</span><b style="font-weight:500">Dell Latitude 7440</b><span style="color:var(--ink-muted)">· asset tag AST001025</span></div><p style="margin:4px 0;font-size:12.5px;color:var(--ink-soft)">Problem: ${esc(c.symptom)}</p>${yesNo(m, "Yes, raise it")}<div style="height:6px"></div>`);
    case "confirm-it": return yesNo(m, "Yes, raise it");
    case "confirm-asset": return boxed(`<p style="margin:4px 0;font-size:12.5px"><b style="font-weight:500">${esc(c.item)}</b> <span style="color:var(--ink-muted)">for ${EMPLOYEE.name} · approver ${EMPLOYEE.manager}</span></p>${yesNo(m, "Yes, request it")}<div style="height:6px"></div>`);
    case "confirm-hr": return boxed(`<p style="margin:4px 0 0;font-size:12.5px;font-weight:500">${esc(c.topic)}</p><p style="margin:2px 0;font-size:12px;color:var(--ink-soft)">“${esc(c.text)}”</p>${yesNo(m, "Yes, raise it")}<div style="height:6px"></div>`);
    case "checklist": return boxed(taskList());
    case "setup": { const acts = FD().actions.filter((a) => a.group === "setup"); return boxed(actionList(acts) + (acts.every((a) => a.status === "done" || a.status === "manual_done") ? `<p class="fd-okline" style="margin:8px 0">${icon("check")} Your system is set up and ready to use.</p>` : "")); }
    case "case": { const k = fdCase(c.caseId); return k ? caseCard(k, true) : ""; }
    case "assets": return boxed(deviceList());
    case "asset-requests": return boxed(assetReqList());
    case "asset-history": return boxed(`<div style="padding:6px 0">${deviceHistory()}</div>`);
    case "incidents": { const rows = fdIncidentRows().filter((r) => !c.only || r.number === c.only).slice(0, 5); return boxed(rows.map((r) => incLine(r)).join("") || empty("You haven't raised any incidents.")); }
    case "leave": return boxed(`<div style="padding:6px 0">${leaveTable()}</div>`);
    case "profile": return boxed(`<div style="padding:8px 0">${profile()}</div>`);
    case "hr-requests": return boxed(hrReqList());
  }
  return "";
}
function fdBubble(m) {
  if (m.from === "employee") return `<div class="fd-me rise">${esc(m.text)}</div>${m.route && m.route.domain !== "general" ? `<div class="fd-routed">Routed to ${dchip(m.route.domain, "Identified by keyword rules (offline demo; the live app classifies intent with Cohere)")}</div>` : ""}`;
  return `<div class="fd-ai rise"><span class="av">${icon("sparkles")}</span><div style="min-width:0;flex:1"><div class="tx">${esc(m.text)}</div>${m.card ? cardHtml(m) : ""}</div></div>`;
}

const FD_TABS = [["all", "All activity"], ["assets", "IT Assets"], ["incidents", "IT Incidents"], ["hr", "HR"], ["history", "Conversations"]];
const sub = (t, body, right = "") => `<div style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;align-items:center"><h3 class="eyebrow" style="margin:0 0 4px">${t}</h3>${right}</div>${body}</div>`;
const SAMPLE = `<p class="fd-src">Offline demo: records here are simulated, except incident numbers shown as links, which open the real record in ServiceNow. In the live app, incidents come from ServiceNow, filtered on the server to the employee; asset and HR records are sample data.</p>`;

function tabBody() {
  const t = UI.fdTab;
  if (t === "assets") return sub("Assigned to you", deviceList()) + sub("Equipment requests", assetReqList()) + sub("Device history", deviceHistory()) + SAMPLE;
  if (t === "incidents") {
    const rows = fdIncidentRows();
    return [["open", "Open", "No open incidents."], ["pending", "Pending", "Nothing waiting on you or on hold."], ["resolved", "Resolved", "No resolved incidents yet."]].map(([g, title, e]) => {
      const list = rows.filter((r) => r.group === g);
      return sub(`${title} (${list.length})`, list.map((r) => (r.caseId && (g !== "resolved" || UI.fdOpen === r.caseId) ? caseCard(fdCase(r.caseId)) : incLine(r, true))).join("") || empty(e));
    }).join("") + SAMPLE;
  }
  if (t === "hr") {
    const ob = obProgress();
    return sub("Leave balance", leaveTable()) + sub("HR requests", hrReqList()) +
      sub("Onboarding", `<div class="progress" style="margin-bottom:6px"><div style="width:${(ob.done / ob.total) * 100}%"></div></div>${ob.done === ob.total ? `<p class="fd-okline"><b>You're all set for your first day on 30 November.</b></p>` : ""}${taskList()}<h4 style="margin:10px 0 0;font-size:11.5px;font-weight:500;color:var(--ink-muted)">Being set up for you</h4>${actionList(FD().actions.filter((a) => a.group === "onboarding"))}`, `<span style="font-size:11.5px;font-weight:500">${ob.done} of ${ob.total} done</span>`) +
      sub("Your details", profile()) + SAMPLE;
  }
  if (t === "history") return FD().interactions.length ? FD().interactions.map((i) => `<div class="fd-row"><span style="color:var(--ink-faint);height:16px">${icon("message")}</span><div style="min-width:0;flex:1"><div style="font-size:12.5px">“${esc(i.intent === "sensitive" ? "Private HR question" : i.text)}”</div><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:3px;font-size:11px;color:var(--ink-muted)">${dchip(i.domain, "Identified by keyword rules (offline demo)")} ${INTENT_LABEL[i.intent] || ""} · ${fdDate(i.at)} ${fdTime(i.at)}</div></div></div>`).join("") : empty("Your questions to AURA will appear here.");
  const items = [];
  fdIncidentRows().forEach((r) => items.push({ d: "incidents", t: r.title, ref: r.number, st: tn(r.tone, r.label), at: r.opened, tab: "incidents" }));
  fdAssetReqs().forEach((r) => items.push({ d: "assets", t: r.item, ref: r.number, st: tn(REQ_TONE[r.status], r.status), at: r.updatedAt, tab: "assets" }));
  FD().hrReqs.forEach((r) => items.push({ d: "hr", t: r.topic, ref: r.number, st: tn(REQ_TONE[r.status], r.status), at: r.updatedAt, tab: "hr" }));
  FD().actions.filter((a) => a.status === "failed" || a.status === "manual").forEach((a) => items.push({ d: a.group === "setup" ? "incidents" : "hr", t: a.label, ref: a.ticket || (a.group === "setup" ? "System setup" : "Onboarding"), st: tn(a.status === "failed" ? "danger" : "warn", a.status === "failed" ? "Needs your action" : "With the IT team"), at: a.at || "", tab: "hr" }));
  const norm = (s) => (s.length <= 10 ? s + "T00:00:00" : s);
  items.sort((a, b) => (norm(a.at) < norm(b.at) ? 1 : -1));
  const ob = obProgress();
  return `<button class="fd-obar" data-act="fd-tab" data-t="hr"><div style="display:flex;justify-content:space-between;font-size:12.5px"><b style="font-weight:500">Onboarding before your first day</b><span style="color:var(--ink-muted)">${ob.done} of ${ob.total} done</span></div><div class="progress" style="margin-top:6px"><div style="width:${(ob.done / ob.total) * 100}%"></div></div></button>
    ${items.map((it) => `<button class="fd-row fd-rowbtn" data-act="fd-tab" data-t="${it.tab}">${dchip(it.d)}<span style="min-width:0;flex:1;text-align:left"><span class="t" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.t)}</span><span class="s">${it.ref}${it.at ? " · " + fdDate(it.at) : ""}</span></span>${it.st}</button>`).join("")}`;
}

function pageFrontDoor() {
  if (!FD().started) { FD().started = true; save(); setTimeout(() => fdRunActions("onboarding"), 300); }
  setTimeout(() => FD().cases.forEach((c) => { if (c.kind === "laptop" && c.stage !== "resolved" && !c.steps.some((s) => s.status === "running")) fdRunCase(c.id); }), 0);
  const h = new Date().getHours();
  const greet = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const rows = fdIncidentRows(), reqs = fdAssetReqs(), ob = obProgress();
  const hrOpen = FD().hrReqs.filter((r) => r.status !== "Completed").length;
  const reqOpen = reqs.filter((r) => r.status !== "Delivered").length;
  const tiles = [
    ["assets", `${fdDevices().length} devices assigned`, `${reqOpen} equipment request${reqOpen === 1 ? "" : "s"} in progress`],
    ["incidents", `${rows.filter((r) => r.group === "open").length} open · ${rows.filter((r) => r.group === "pending").length} pending`, `${rows.filter((r) => r.group === "resolved").length} resolved`],
    ["hr", "20 days PTO remaining", `${hrOpen} HR request${hrOpen === 1 ? "" : "s"} open · onboarding ${ob.done}/${ob.total}`],
  ];
  return `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:20px">
      <div style="min-width:0"><div class="eyebrow">Digital FrontDoor · IT Assets, IT Incidents and HR in one place</div>
        <h1 style="margin:4px 0 0;font-size:21px;font-weight:600;letter-spacing:-.015em">${greet}, Maya. How can we help?</h1>
        <p style="margin:4px 0 0;max-width:760px;font-size:13px;line-height:1.6;color:var(--ink-soft)">Ask anything in your own words. AURA works out what you need, sends it to the right team and shows the answer here. Everything you've raised is listed alongside.</p></div>
      <div class="card" style="display:flex;gap:12px;align-items:center;padding:10px 14px"><span class="avatar" style="width:36px;height:36px;font-size:12px;background:var(--brand-soft);color:var(--brand)">MT</span><div style="font-size:12px;line-height:1.4"><div style="font-size:13px;font-weight:500">${EMPLOYEE.name}</div><div style="color:var(--ink-muted)">${EMPLOYEE.id} · ${EMPLOYEE.title}, ${EMPLOYEE.department}</div><div style="display:flex;gap:4px;align-items:center;font-size:11px;color:var(--ink-muted)"><span style="height:12px;width:12px;display:inline-grid">${icon("lock")}</span> Showing your records only</div></div></div>
    </div>
    <div class="fd-tiles">${tiles.map(([d, main, s]) => `<button class="fd-tile" data-act="fd-tab" data-t="${d}"><span class="fd-tic d-${d}">${icon(DOMAINS[d].ic)}</span><span style="min-width:0;flex:1"><span style="display:block;font-size:11.5px;font-weight:500;color:var(--ink-muted)">${DOMAINS[d].label}</span><span style="display:block;font-size:14px;font-weight:600">${main}</span><span style="display:block;font-size:11.5px;color:var(--ink-muted)">${s}</span></span><span style="color:var(--ink-faint)">${icon("arrow")}</span></button>`).join("")}</div>
    <div class="fd-grid">
      <div class="card" style="display:flex;flex-direction:column;min-width:0">
        <div style="display:flex;gap:10px;align-items:center;padding:12px 20px;border-bottom:1px solid var(--line)"><span class="agentico">${icon("sparkles")}</span><div><h2 style="margin:0;font-size:14px">Ask AURA</h2><p style="margin:0;font-size:11.5px;color:var(--ink-muted)">One assistant for IT equipment, IT problems and HR</p></div></div>
        <div class="fd-chat scroll" id="chatbox">${FD().chat.map(fdBubble).join("")}${UI.fdThinking ? `<div style="font-size:12px;color:var(--ink-muted)"><span class="pulse">●●●</span> AURA is working out where this goes…</div>` : ""}</div>
        <div style="border-top:1px solid var(--line);padding:12px 16px">
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${FD_SUGGESTIONS.map((s) => `<button class="chip" data-act="fd-send" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>
          <form id="fd-form" style="display:flex;gap:8px"><input class="input" id="fd-input" placeholder="Ask about your equipment, a problem, leave, HR…" value="${esc(UI.fdDraft)}" autocomplete="off"><button class="btn primary lg" type="submit">${icon("send")}</button></form>
        </div>
      </div>
      <div class="card" style="min-width:0">
        <div style="padding:12px 20px 0;border-bottom:1px solid var(--line)"><h2 style="margin:0;font-size:14px">My requests and records</h2><div class="fd-tabs">${FD_TABS.map(([id, l]) => `<button class="fd-tab ${UI.fdTab === id ? "on" : ""}" data-act="fd-tab" data-t="${id}">${l}</button>`).join("")}</div></div>
        <div class="scroll" style="max-height:640px;overflow-y:auto;padding:12px 20px">${tabBody()}</div>
      </div>
    </div>
    ${simnote("Offline demo with simulated records. Questions are routed with keyword rules here; the live app classifies intent with Cohere in the backend, reads the employee's own incidents from ServiceNow and writes every step there.")}`;
}

/* ----------------------------------------------- IT and HR side panels */
function fdDevicePanel() {
  const cases = FD().cases.filter((c) => c.kind === "laptop");
  const reqs = FD().assetReqs.filter((r) => !r.sample);
  const NEXT = { Submitted: "Approve", Approved: "Mark ready for pickup", "Ready for pickup": "Mark delivered" };
  const stepIc = { done: ["check", "var(--ok)"], manual_done: ["check", "var(--ok)"], running: ["loader", "var(--brand)"], failed: ["xcircle", "var(--danger)"], manual: ["user", "var(--warn)"], pending: ["circle", "var(--ink-faint)"] };
  return `<div class="card" style="margin-top:16px">
    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:center;padding:12px 20px;border-bottom:1px solid var(--line)"><div><h2 class="sec-title" style="margin:0">${icon("inbox")} Employee device incidents</h2><p style="margin:2px 0 0;font-size:11.5px;color:var(--ink-muted)">Raised in the Digital FrontDoor · routed to IT Incidents · worked by the Asset &amp; Endpoint Agent</p></div><a href="#/" style="font-size:12px;font-weight:500;color:var(--brand)">Open Digital FrontDoor</a></div>
    ${cases.length ? cases.map((c) => {
      const failed = c.steps.some((s) => s.status === "failed"), manual = c.steps.some((s) => s.status === "manual" && s.id !== "confirm"), busy = c.steps.some((s) => s.status === "running");
      const b = busy ? badge("running", "Agent working") : failed ? badge("critical", "Needs IT: retry or take over") : manual ? badge("serious", "With IT technician") : c.stage === "resolved" ? badge("good", "Resolved") : c.stage === "ready" ? badge("warning", "Awaiting employee confirmation") : badge("running", "Agent working");
      return `<div style="padding:14px 20px;border-bottom:1px solid var(--line)">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><span class="mono-chip">${c.number}</span><b style="flex:1;font-size:13px;font-weight:500">${esc(c.summary)}</b>${badge("warning", "Simulated")}${b}</div>
        <p style="margin:2px 0 0;font-size:11.5px;color:var(--ink-muted)">Caller ${EMPLOYEE.name} (${EMPLOYEE.department}) · via Digital FrontDoor · category Hardware${c.replacement ? " · replacement " + c.replacement : ""}</p>
        <ol style="list-style:none;margin:10px 0 0;padding:0">${CASE_STEPS.map((d) => { const s = c.steps.find((x) => x.id === d.id); const [ic, col] = stepIc[s.status]; return `<li style="display:flex;gap:10px;margin:6px 0"><span style="color:${col};height:16px;flex:none">${icon(ic, s.status === "running" ? "spin" : "")}</span><div style="min-width:0;flex:1"><div style="font-size:12.5px;${s.status === "pending" ? "color:var(--ink-muted)" : "font-weight:500"}">${d.it}${s.attempts > 1 ? ` <span style="font-weight:400;font-size:11px;color:var(--ink-muted)">attempt ${s.attempts}</span>` : ""}${s.status === "manual_done" ? ` <span style="font-weight:400;font-size:11px;color:var(--warn)">done manually</span>` : ""}</div>${s.detail ? `<p style="margin:0;font-size:11.5px;line-height:1.5;color:var(--ink-soft)">${esc(s.detail)}</p>` : ""}${d.id === "confirm" && s.status === "pending" && c.stage === "ready" ? `<p style="margin:0;font-size:11.5px;color:var(--ink-muted)">Waiting for the employee to confirm in the Digital FrontDoor.</p>` : ""}
          ${s.status === "failed" ? `<div class="fd-fail"><p style="color:var(--danger)">${esc(s.error)}</p><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px"><button class="btn" data-act="fd-retry" data-c="${c.id}" data-s="${s.id}">${icon("rotate")} Retry</button><button class="btn ghost" data-act="fd-manual" data-c="${c.id}" data-s="${s.id}">${icon("hand")} Manual takeover</button><span style="font-size:11px;color:var(--ink-muted)">The employee only sees "taking a little longer".</span></div></div>` : ""}
          ${s.status === "manual" && s.id !== "confirm" ? `<div class="fd-warnbox"><span>Taken over by an IT technician (Canton depot). The agent waits until it's done.</span><button class="btn primary" data-act="fd-mdone" data-c="${c.id}" data-s="${s.id}">${icon("check")} Mark completed</button></div>` : ""}
          ${s.status === "manual" && s.id === "confirm" ? `<p style="margin:2px 0 0;font-size:11.5px;color:var(--warn)">Employee says it's still not working: a technician follows up in person.</p>` : ""}
        </div></li>`; }).join("")}</ol>
        <details style="margin-top:8px"><summary style="font-size:12px;font-weight:500;color:var(--brand);cursor:pointer">Work notes (${c.notes.length}) and what the employee was told (${c.updates.length})</summary>
          <ul style="margin:8px 0 0;padding-left:12px;border-left:1px solid var(--line);list-style:none;font-size:12px;line-height:1.55;color:var(--ink-soft)">${c.notes.map((n) => `<li><span style="color:var(--ink-muted)">${fdTime(n.at)} · work note · </span>${esc(n.text)}</li>`).join("")}${c.updates.map((u) => `<li><span style="color:var(--ink-muted)">${fdTime(u.at)} · to employee · </span>${esc(u.text)}</li>`).join("")}</ul></details>
      </div>`;
    }).join("") : `<p style="margin:0;padding:16px 20px;font-size:12.5px;color:var(--ink-muted)">No device incidents yet. In the Digital FrontDoor, tell AURA <i>"My laptop is not working."</i> and it appears here.</p>`}
    ${reqs.length ? `<div style="padding:12px 20px"><h3 class="eyebrow" style="margin:0 0 4px">Equipment requests from the Digital FrontDoor · simulated</h3>${reqs.map((r) => `<div class="fd-row" style="align-items:center"><span class="mono-chip">${r.number}</span><span style="flex:1;font-size:12.5px;font-weight:500">${esc(r.item)} <span style="font-weight:400;color:var(--ink-muted)">for ${EMPLOYEE.name}</span></span>${badge(r.status === "Delivered" ? "good" : r.status === "Submitted" ? "info" : "running", r.status)}${NEXT[r.status] ? `<button class="btn" data-act="fd-adv-asset" data-r="${r.id}">${NEXT[r.status]}</button>` : ""}</div>`).join("")}</div>` : ""}
  </div>`;
}
function fdHrPanel() {
  const acts = FD().actions;
  const reqs = FD().hrReqs.filter((r) => !r.sample);
  const st = { done: badge("good", "Done"), manual_done: badge("good", "Done manually"), running: badge("running", "Running"), failed: badge("critical", "Failed"), manual: badge("warning", "Handed to the team"), pending: badge("info", "Waiting") };
  return `<div class="card" style="margin-bottom:16px">
    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:center;padding:12px 20px;border-bottom:1px solid var(--line)"><div><h2 class="sec-title" style="margin:0">${icon("route")} Onboarding automations · ${EMPLOYEE.name}</h2><p style="margin:2px 0 0;font-size:11.5px;color:var(--ink-muted)">Run for the new hire from the Digital FrontDoor · simulated provisioning</p></div><a href="#/" style="font-size:12px;font-weight:500;color:var(--brand)">Open Digital FrontDoor</a></div>
    <div class="grid g2" style="gap:0 32px;padding:4px 20px 8px">${[["onboarding", "Onboarding provisioning"], ["setup", "System setup check (requested in the Digital FrontDoor)"]].map(([g, t]) => `<div><h3 class="eyebrow" style="margin:10px 0 4px">${t}</h3>${acts.filter((a) => a.group === g).map((a) => `<div class="fd-row" style="flex-direction:column;gap:2px"><div style="display:flex;gap:8px;align-items:center;width:100%"><span style="flex:1;font-size:12.5px;font-weight:500">${esc(a.detail)}${a.attempts > 1 ? ` <span style="font-weight:400;font-size:11px;color:var(--ink-muted)">attempt ${a.attempts}</span>` : ""}</span>${st[a.status]}</div>${a.status === "failed" ? `<p style="margin:0;font-size:11.5px;color:var(--danger)">${esc(a.error)}</p><div style="display:flex;gap:8px;margin-top:4px"><button class="btn" data-act="fd-act-retry" data-a="${a.id}">${icon("rotate")} Retry</button><button class="btn ghost" data-act="fd-act-manual" data-a="${a.id}">${icon("hand")} Manual takeover</button></div>` : ""}${a.status === "manual" ? `<div style="display:flex;gap:8px;align-items:center;margin-top:4px"><span style="font-size:11.5px;color:var(--warn)">Request ${a.ticket} with the team</span><button class="btn primary" data-act="fd-act-done" data-a="${a.id}">${icon("check")} Mark completed</button></div>` : ""}</div>`).join("")}</div>`).join("")}</div>
    ${reqs.length ? `<div style="padding:4px 20px 12px;border-top:1px solid var(--line)"><h3 class="eyebrow" style="margin:10px 0 4px">HR requests from the Digital FrontDoor · simulated</h3>${reqs.map((r) => `<div class="fd-row" style="align-items:center"><span class="mono-chip">${r.number}</span><span style="flex:1;font-size:12.5px;font-weight:500">${esc(r.topic)} <span style="font-weight:400;color:var(--ink-muted)">· ${EMPLOYEE.name}${r.private ? " · private case" : ""}</span></span>${badge(r.status === "Completed" ? "good" : r.status === "Submitted" ? "info" : "running", r.status)}${r.status !== "Completed" ? `<button class="btn" data-act="fd-adv-hr" data-r="${r.id}">${r.status === "Submitted" ? "Start" : "Mark completed"}</button>` : ""}</div>`).join("")}</div>` : ""}
  </div>`;
}
