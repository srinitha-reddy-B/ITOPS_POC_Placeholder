<style>
.ps-box{display:flex;align-items:center;gap:8px;min-width:0}
.ps-box .avatar{flex:none}
.ps-who{display:flex;flex-direction:column;line-height:1.15;min-width:0}
.ps-who b{font-size:12.5px;font-weight:600;white-space:nowrap}
.ps-who span{font-size:10.5px;color:var(--ink-muted);white-space:nowrap}
.ps-sel{height:30px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface);font:inherit;font-size:12px;padding:0 6px;color:var(--ink);max-width:190px}
.ps-demo{font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#8a5a00;background:#fff4dc;border:1px solid #f0d49a;border-radius:6px;padding:2px 6px;white-space:nowrap}
.ps-toast{position:fixed;right:18px;bottom:18px;z-index:80;max-width:420px;background:#1d1d27;color:#fff;border-radius:10px;padding:10px 14px;font-size:12.5px;line-height:1.5;box-shadow:0 8px 28px rgba(0,0,0,.25);display:flex;gap:8px;align-items:flex-start}
.ps-toast svg{width:16px;height:16px;flex:none;margin-top:2px;color:#f5b544}
.ps-lock{max-width:640px;margin:40px auto;text-align:center}
.ps-lock .ic{width:46px;height:46px;border-radius:12px;display:grid;place-items:center;margin:0 auto 10px;background:var(--hover)}
.ps-lock .ic svg{width:22px;height:22px}
.ps-ro{display:flex;gap:8px;align-items:flex-start;border:1px dashed var(--line-strong);border-radius:10px;padding:10px 12px;font-size:12.5px;color:var(--ink-soft);background:var(--surface)}
.ps-ro svg{width:16px;height:16px;flex:none;margin-top:1px}
.ps-q{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.ps-q:last-child{border-bottom:0}
@media (max-width:1180px){.tb-left .hide-sm,.tb-left .tb-sep{display:none!important}}
@media (max-width:900px){.ps-who{display:none}.ps-demo{display:none}}
.tb-right{flex:none}.tb-left a>span>span{overflow:hidden;text-overflow:ellipsis}
</style>
<script>
"use strict";
/* =====================================================================
   Persona switcher (demo only). There is no sign-in in this POC: the
   selected persona decides navigation, visible data, available actions
   and approval authority. The same rules are enforced in three places:
   the sidebar (what is offered), the router (what a URL can open) and the
   click handler (what an action can do). In Live Agent Mode the persona's
   role is also sent to the backend, which checks it per approval gate.
   ===================================================================== */
Object.assign(ICON_PATHS, {
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  wifi: '<path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><path d="M2 9a15 15 0 0 1 20 0"/><path d="M12 19.5h.01"/>',
  network: '<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-3h14v3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  flask: '<path d="M9 3h6M10 3v6L4 20h16L14 9V3"/>',
});

const PERSONAS = {
  employee: { name: "Maya Thompson", role: "Employee · Finance", initials: "MT", api: "employee", home: "", app: "Digital FrontDoor", appSub: "Employee self-service",
    routes: ["", "my-alerts", "sign-in"], caps: ["fd.submit", "fd.ack", "fd.info"], domains: [],
    blurb: "Raises IT, asset and HR requests, follows their progress and sees early-warning alerts for Finance." },
  it_admin: { name: "Jordan Patel", role: "IT Administrator", initials: "JP", api: "it_admin", home: "ops-console", app: "Control Tower", appSub: "Predictive operations",
    routes: [], caps: [], domains: [],
    blurb: "Opens the Ops Console: Command Center, Incident Workbench, Predictive Intelligence, Dependency Map, Observability, Approvals and Reports." },
  engineer: { name: "Arya Hajarha", role: "IT Engineer · Claims Platform", initials: "AH", api: "engineer", home: "workbench", app: "Control Tower", appSub: "Agentic ITOPS",
    routes: ["command-center", "workbench", "agent-execution", "sso-investigation", "dependency-graph", "observability", "approvals", "risk-alerts"], caps: ["wb.incident", "wb.asset", "wb.hr", "access.decide"], domains: ["incident", "asset", "hr"],
    blurb: "Investigates incidents, reviews evidence and RCA, approves or rejects RCA and SOPs, and runs simulated remediation after approval." },
  asset_mgr: { name: "Chris Morgan", role: "IT Manager / Asset Manager", initials: "CM", api: "asset_manager", home: "approvals", app: "Control Tower", appSub: "IT asset management",
    routes: ["asset-insights", "workbench", "approvals", "risk-alerts"], caps: ["wb.asset", "asset.raise", "access.decide"], domains: ["asset"],
    blurb: "Owns asset lifecycle decisions: the only persona that can approve or decline asset replacements." },
  hr_partner: { name: "Renee Alvarez", role: "HR Business Partner", initials: "RA", api: "hr_partner", home: "hr-insights", app: "Control Tower", appSub: "HR services",
    routes: ["hr-insights", "workbench", "approvals"], caps: ["wb.hr"], domains: ["hr"],
    blurb: "Reviews HR requests and onboarding progress: the only persona that can approve or decline HR plans." },
  leadership: { name: "Crystal Clean Leadership", role: "CIO / Leadership · read-only", initials: "LD", api: "leadership", home: "leadership", app: "Control Tower", appSub: "Leadership view",
    routes: ["leadership", "accuracy", "observability", "sso-investigation"], caps: [], domains: [], readOnly: true,
    blurb: "Sees enterprise-wide health, risk, business impact and outcomes. Read-only: no approvals or remediation." },
};
const PS_KEY = "p32-persona-v1";
// Personas offered in the switcher. The others stay defined (approval gates refer to them) but cannot be selected.
const PS_OFFERED = ["employee", "engineer", "it_admin"]; // also the order of the persona dropdown
const PS = (() => { try { const s = JSON.parse(localStorage.getItem(PS_KEY)); if (s && PERSONAS[s.id] && PS_OFFERED.includes(s.id)) return s; } catch (e) {} return { id: "employee", empDept: null }; })();
function psSave() { try { localStorage.setItem(PS_KEY, JSON.stringify(PS)); } catch (e) {} }
const psCur = () => PERSONAS[PS.id];
const psCan = (cap) => psCur().caps.includes(cap);
// Legacy route names from the earlier POC pages map onto their owner's page.
const PS_ALIAS = { "ai-control-tower": "leadership", "asset-management": "asset-insights", "hr-services": "hr-insights", "incident-management": "workbench" };
function psCanRoute(base) { return psCur().routes.includes(PS_ALIAS[base] || base); }
function psHome() { return `#/${psCur().home}`; }
function psSet(id) {
  if (!PERSONAS[id] || PS.id === id) return;
  PS.id = id; psSave();
  UI.wbSel = null; UI.wbDraft = {}; if (UI.pi) { UI.pi.confirm = null; UI.pi.err = ""; }
  const d = psCur().domains; if (d.length && !d.includes(WB.domain || "incident")) WB.domain = d[0];
  psToast(`Now viewing as ${psCur().name} (${psCur().role}). Navigation, data and actions changed to match this persona.`, "info");
  if (location.hash === psHome() || (location.hash === "" && psCur().home === "")) render(); else location.hash = psHome();
}
// Demo employees for the department filter on employee alerts (synthetic people).
const PS_EMPLOYEES = [{ name: "Maya Thompson", dept: "Finance" }, { name: "Daniel Brooks", dept: "Claims Operations" }, { name: "Grace Kim", dept: "Member Services" }, { name: "Sam Ortiz", dept: "Pharmacy Operations" }];
function psEmployee() { return PS_EMPLOYEES.find((e) => e.dept === PS.empDept) || PS_EMPLOYEES[0]; }

/* ------------------------------------------------- backend role header */
const _wbApiPS = wbApi;
wbApi = function (path, body, method, headers) {
  const h = headers || {};
  return _wbApiPS(path, body, method, h["X-P32-Role"] ? { ...h, "X-P32-Role": psCur().api } : h);
};

/* --------------------------------------------------------- toast */
let psToastTimer = null;
function psToast(text, kind) {
  let el = document.getElementById("ps-toast");
  if (!el) { el = document.createElement("div"); el.id = "ps-toast"; el.className = "ps-toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.innerHTML = `${icon(kind === "info" ? "info" : "lock")}<span>${esc(text)}</span>`; el.style.display = "flex";
  clearTimeout(psToastTimer); psToastTimer = setTimeout(() => { el.style.display = "none"; }, 4200);
}

/* ------------------------------------------------- header and navigation */
function psHeader() {
  const p = psCur();
  return `    <select class="ps-sel" id="ps-persona" aria-label="Switch demo persona (not real sign-in)">${PS_OFFERED.map((k) => [k, PERSONAS[k]]).map(([k, x]) => `<option value="${k}" ${k === PS.id ? "selected" : ""}>${esc(x.role.split(" · ")[0])}: ${esc(x.name)}</option>`).join("")}</select>
    <span class="ps-box"><span class="avatar" title="${esc(p.name)}">${esc(p.initials)}</span><span class="ps-who"><b>${esc(p.name)}</b><span>${esc(p.role)}</span></span></span>
    <button class="ghostbtn" data-act="cc-signout" aria-label="Sign out" title="Sign out" style="padding:0 9px">${icon("logout")}</button>`;
}
function psApprovalCount() { return psQueue(PS.id).length; }
function psNav() {
  const ap = { label: "Approval inbox", route: "approvals", icon: "usercheck", badge: "myapprovals" };
  switch (PS.id) {
    case "employee": return [{ group: "Employee self-service", items: [{ label: "Digital FrontDoor", route: "", icon: "door" }, { label: "Sign-in help", route: "sign-in", icon: "lock" }] }];
    case "it_admin": return []; // the IT Administrator uses the Ops Console
    case "engineer": return [{ group: "Agentic ITOPS", items: [{ label: "Agentic Incident Workbench", route: "workbench", icon: "siren", badge: "workbench" }, { label: "Risk alerts", route: "risk-alerts", icon: "bell" }, ap] }];
    case "asset_mgr": return [{ group: "IT asset management", items: [ap, { label: "Risk alerts", route: "risk-alerts", icon: "bell" }, { label: "Asset Lifecycle Intelligence", route: "asset-insights", icon: "laptop" }] }];
    case "hr_partner": return [{ group: "HR services", items: [{ label: "HR Workflow Intelligence", route: "hr-insights", icon: "users" }, { label: "HR requests", route: "workbench", icon: "inbox" }, ap] }];
    default: return [{ group: "Leadership view", items: [{ label: "Crystal Clean Control Tower", route: "leadership", icon: "radar" }, { label: "Prediction Accuracy", route: "accuracy", icon: "target" }, { label: "Observability", route: "observability", icon: "activity" }, { label: "SSO Investigation", route: "sso-investigation", icon: "play" }] }];
  }
}

/* ------------------------------------------------------- authorisation */
const PS_ROUTE_ACTS = { "wb-open": "workbench", "pi-open": "predictive" };
function psFlowCap(flow) { return { incident: "wb.incident", asset: "wb.asset", hr: "wb.hr" }[flow] || "wb.incident"; }
function psCurFlow() { const inc = typeof curIncId === "function" ? wbInc(curIncId()) : null; return inc ? wbFlowOf(inc) : WB.domain || "incident"; }
const PS_OWNER = { "access.decide": "the IT engineer", "wb.incident": "the IT engineer", "wb.asset": "the IT/asset manager", "wb.hr": "the HR partner", "pi.run": "the IT administrator", "pi.ack": "the IT administrator", "pi.dismiss": "the IT administrator", "pi.investigate": "the IT administrator", "pi.recheck": "the IT administrator", "pi.mitigate": "the IT administrator", "pi.settings": "the IT administrator", "ms.whatif": "the IT administrator", "fd.submit": "an employee", "fd.ack": "an employee", "fd.info": "the employee who raised it", "asset.raise": "the IT/asset manager", "legacy.approve": "the approver" };
function psActCap(act, el) {
  if (/^wb-(decide|ctl|gate|exec|mstep)$/.test(act)) return psFlowCap(psCurFlow());
  if (act === "decide") return "legacy.approve";
  if (["pi-run", "pi-cycle", "pi-sim", "pi-retry", "pi-drill", "ms-spike", "ms-recover", "ms-reset", "ms-run", "ms-recheck"].includes(act)) return "pi.run";
  if (act === "pi-ack") return "pi.ack";
  if (act === "pi-dismiss") return "pi.dismiss";
  if (["pi-inv-ask", "pi-inv-go", "pi-assoc", "ms-assoc"].includes(act)) return "pi.investigate";
  if (act === "pi-recheck") return "pi.recheck";
  if (act === "pi-mitigate") return "pi.mitigate";
  if (act === "pi-cfg-save" || act === "pi-cfg-reset") return "pi.settings";
  if (/^ms-wi/.test(act)) return "ms.whatif";
  if (act === "pi-fd-ack") return "fd.ack";
  if (["fd2-submit", "fd2-example", "fd2-ex"].includes(act)) return "fd.submit";
  if (act === "fd2-info") return "fd.info";
  if (act === "as-raise") return "asset.raise";
  if (act === "sso-approve") return "wb.incident";
  if (act === "acc-decide") return "access.decide";
  return null;
}
function psGuard(act, el) {
  if (PS_ROUTE_ACTS[act] && !psCanRoute(PS_ROUTE_ACTS[act])) return { ok: false, why: `${psCur().role} can't open ${PS_ROUTE_ACTS[act] === "workbench" ? "the Incident Workbench" : "prediction details"}: ${psCur().readOnly ? "the leadership view is a read-only summary" : "it is outside this persona's access"}.` };
  const cap = psActCap(act, el);
  if (!cap || psCan(cap)) return { ok: true };
  if (cap === "wb.incident" && psCan("wb.view")) return { ok: false, why: "View only: approvals and remediation in the RCA workflow belong to the IT engineer. The IT administrator can start an investigation but cannot bypass the engineer's approval gates." };
  return { ok: false, why: `${psCur().role} can't do this. It belongs to ${PS_OWNER[cap] || "another persona"}. Switch persona in the header to continue the demo.` };
}
function psReadOnlyNote(owner) { return `<div class="ps-ro">${icon("lock")}<span><b>View only for ${esc(psCur().role)}.</b> This decision belongs to ${esc(owner)}. Switch the demo persona in the header to act on it.</span></div>`; }

/* --------------------------------------------- read-only workbench views */
const _wbGateCardPS = wbGateCard;
wbGateCard = function (run, inc) {
  const html = _wbGateCardPS(run, inc);
  if (!html || !run || !run.gate) return html;
  const cap = psFlowCap(wbFlowOf(inc));
  if (psCan(cap)) return html;
  if (run.gate.type === "intake_info") return psReadOnlyNote("the requester (on the Digital FrontDoor)");
  return `<div class="card pad">${psReadOnlyNote(PS_OWNER[cap])}<p style="font-size:12px;color:var(--ink-muted);margin:8px 0 0">Waiting for: ${esc(psGateLabel(run.gate.type))}.</p></div>`;
};
const _wbControlsPS = wbControls;
wbControls = function (run) {
  const inc = wbInc(curIncId());
  if (inc && !psCan(psFlowCap(wbFlowOf(inc)))) return `<span class="pill p-info" title="Only the owning persona can start, pause or retry this workflow">${icon("lock")} View only</span>`;
  return _wbControlsPS(run);
};
const _wbDomainTabsPS = wbDomainTabs;
wbDomainTabs = function () {
  const allowed = psCur().domains; const html = _wbDomainTabsPS();
  if (allowed.length >= 3) return html;
  return html.replace(/<button class="wb-dom[^"]*" data-act="wb-dom" data-d="(\w+)">[\s\S]*?<\/button>/g, (m, d) => (allowed.includes(d) ? m : ""));
};
const _pageWorkbenchPS = pageWorkbench;
pageWorkbench = function () {
  const allowed = psCur().domains;
  if (allowed.length && !allowed.includes(WB.domain || "incident")) WB.domain = allowed[0];
  const id = route().split("/")[1];
  if (id) { const inc = wbInc(decodeURIComponent(id)); if (inc && !allowed.includes(wbFlowOf(inc))) return psRestricted("workbench", `This record belongs to the ${WB_FLOWS[wbFlowOf(inc)].label} workflow, which ${psCur().role} can't open.`); }
  const ro = (psCur().viewOnly || []).includes(WB.domain || "incident") ? `<div style="margin-bottom:12px">${psReadOnlyNote("the IT engineer")}</div>` : "";
  return ro + _pageWorkbenchPS();
};

/* -------------------------------------------------- restricted page */
function psRestricted(base, why) {
  const owners = Object.values(PERSONAS).filter((p) => p.routes.includes(PS_ALIAS[base] || base)).map((p) => p.role.split(" · ")[0]);
  return `<div class="card pad ps-lock"><div class="ic">${icon("lock")}</div><h1 style="font-size:18px;margin:0 0 6px">Not available for ${esc(psCur().role)}</h1>
  <p style="font-size:13px;color:var(--ink-soft);margin:0 0 10px">${esc(why || `This page is outside the ${psCur().role} persona's access.`)}${owners.length ? ` It is available to: ${esc(owners.join(", "))}.` : ""}</p>
  <a class="btn primary" href="${psHome()}">${icon("arrow")} Go to my home page</a>
  <p style="font-size:11.5px;color:var(--ink-muted);margin:14px 0 0">Demo persona switcher: access rules are applied in the menu, on every route and on every action. This is not production authentication.</p></div>`;
}

/* ------------------------------------------------------ approval inbox */
const PS_GATE = {
  duplicate: ["engineer", "Possible duplicate: link it or investigate separately"], rca: ["engineer", "RCA approval"], sop: ["engineer", "SOP approval"], judge_low: ["engineer", "Low-confidence hypothesis: proceed or stop"], quality_exhausted: ["engineer", "RCA failed the quality gate"], verify_exhausted: ["engineer", "Verification failed after remediation"], escalated: ["engineer", "Escalated for manual investigation"],
  asset: ["engineer", "Asset replacement approval"], hr: ["engineer", "HR plan approval"], intake_info: ["employee", "More details needed from the requester"],
};
function psGateLabel(t) { return (PS_GATE[t] || [null, String(t || "").replace(/_/g, " ")])[1]; }
function psGateOwner(run) {
  const t = run.gate && run.gate.type; if (!t) return null;
  if (t === "policy_exhausted") return "engineer";
  if (PS_GATE[t]) return PS_GATE[t][0];
  return "engineer";
}
function psQueue(pid) {
  const out = [];
  Object.values(WB.runs).forEach((run) => {
    const inc = wbInc(run.incId); if (!inc) return;
    if (run.gate && ["waiting", "attention", "failed"].includes(run.status) && psGateOwner(run) === pid) out.push({ kind: "wb", id: inc.id, title: inc.title, what: run.status === "failed" ? `Step failed: ${WB_NODES[run.gate.node] ? WB_NODES[run.gate.node].name : "agent"}` : psGateLabel(run.gate.type), since: run.updated, pri: inc.priority, flow: wbFlowOf(inc), href: `#/workbench/${encodeURIComponent(inc.id)}` });
    else if (run.status === "failed" && !run.gate && pid === "engineer") out.push({ kind: "wb", id: inc.id, title: inc.title, what: "Agent step failed", since: run.updated, pri: inc.priority, flow: wbFlowOf(inc), href: `#/workbench/${encodeURIComponent(inc.id)}` });
  });
  if (pid === "it_admin" && typeof PI !== "undefined") PI.preds.filter((p) => ["Alert generated", "Investigation required", "Early warning"].includes(p.status) && !p.ack.admin && !PIL.loops.has(p.id)).forEach((p) => out.push({ kind: "pi", id: p.id, title: `${PI_SCEN[p.sid].title}: ${piTarget(p).short}`, what: `${p.status} · risk ${p.score} (${p.cls}): acknowledge, investigate or dismiss`, since: p.updated || p.created, pri: piPriority(p.cls), flow: "predictive", href: `#/predictive/p/${encodeURIComponent(p.id)}` }));
  return out.sort((a, b) => String(a.pri).localeCompare(String(b.pri)) || Date.parse(a.since) - Date.parse(b.since));
}
function psDecisions() {
  const out = [];
  Object.values(WB.runs).forEach((run) => { const inc = wbInc(run.incId); (run.approvals || []).forEach((a) => out.push({ ...a, id: inc ? inc.id : run.incId, title: inc ? inc.title : "", flow: run.flow || "incident" })); });
  if (typeof PI !== "undefined") PI.preds.forEach((p) => { if (p.incident) out.push({ gate: "pi", decision: "approve", approver: "IT administrator (POC role)", at: p.incident.at, id: p.id, title: `Investigation raised from ${PI_SCEN[p.sid].title}`, flow: "predictive" }); if (p.dismissed) out.push({ gate: "pi", decision: "reject", approver: "IT administrator (POC role)", at: p.dismissed.at, feedback: p.dismissed.reason, id: p.id, title: `Prediction dismissed: ${PI_SCEN[p.sid].title}`, flow: "predictive" }); });
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
const PS_GATE_PERSONA = { rca: "engineer", sop: "engineer", asset: "engineer", hr: "engineer", pi: "it_admin" };
function pageApprovals() {
  const mine = psQueue(PS.id);
  const others = Object.keys(PERSONAS).filter((k) => k !== PS.id && k !== "leadership" && PS_OFFERED.includes(k)).map((k) => ({ k, n: psQueue(k).length }));
  const dec = psDecisions().filter((d) => PS_GATE_PERSONA[d.gate] === PS.id).slice(0, 20);
  const dl = { approve: "Approved", request_changes: "Changes requested", reject: "Declined / dismissed" };
  return `${head("Approval inbox", `Human decisions waiting for ${psCur().name} (${psCur().role}). Only the gates this persona owns appear here; nothing in a workflow moves past a gate without its owner's decision.`, "Human-in-the-loop", "")}
  <div class="split" style="gap:12px;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
    <div class="card pad"><div class="sec-head"><p class="sec-title">${icon("usercheck")} Waiting for you</p><span class="note-r">${mine.length} item(s)</span></div>
      ${mine.length ? mine.map((q) => `<div class="ps-q"><div style="min-width:0"><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center"><span class="mono" style="font-size:11.5px">${esc(q.id)}</span>${badge(String(q.pri).startsWith("1") ? "critical" : String(q.pri).startsWith("2") ? "serious" : "warning", q.pri)}<span class="note-r">${esc(q.flow === "predictive" ? "Predictive Intelligence" : WB_FLOWS[q.flow].label)} · waiting ${rel(q.since)}</span></div><div style="font-size:13px;font-weight:500;margin-top:3px">${esc(q.title)}</div><div style="font-size:12px;color:var(--ink-soft)">${esc(q.what)}</div></div><a class="btn primary" href="${q.href}">${icon("arrow")} Review</a></div>`).join("") : `<p style="font-size:12.5px;color:var(--ink-muted);margin:8px 0 0">Nothing waiting. ${PS.id === "asset_mgr" ? "Raise a replacement request from Asset Lifecycle Intelligence, or wait for an employee's asset request to reach your gate." : PS.id === "hr_partner" ? "HR requests from the Digital FrontDoor stop here for your approval." : PS.id === "engineer" ? "Incidents stop here when the RCA or SOP needs your approval." : "Predictions that need a decision appear here."}</p>`}</div>
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="card pad"><p class="sec-title">${icon("layers")} Other approval queues</p><p style="font-size:12px;color:var(--ink-muted);margin:2px 0 6px">Counts only; each queue is visible to its owner.</p>${others.map((o) => `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0;border-bottom:1px solid var(--line)"><span>${esc(PERSONAS[o.k].role.split(" · ")[0])}</span><b>${o.n}</b></div>`).join("")}</div>
      <div class="card pad"><p class="sec-title">${icon("history")} Your recent decisions</p>${dec.length ? `<ul class="wb-ul">${dec.map((d) => `<li><span class="mono" style="font-size:11px;color:var(--ink-muted)">${stamp(d.at).slice(5, 16)}</span> <b style="font-weight:500">${esc(dl[d.decision] || d.decision)}</b> · ${esc(d.id)}${d.feedback ? ` · "${esc(String(d.feedback).slice(0, 80))}"` : ""}</li>`).join("")}</ul>` : `<p style="font-size:12.5px;color:var(--ink-muted);margin:6px 0 0">No decisions recorded in this browser yet.</p>`}</div>
    </div>
  </div>
  ${simnote("Demo persona switcher, not production authentication. Approvals are recorded in this browser (Controlled Demo Mode) or by the backend with the persona's role (Live Agent Mode), which accepts each gate only from its owner.")}`;
}
</script>
