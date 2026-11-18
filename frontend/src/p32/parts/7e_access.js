<style>
.cc-chat{border-radius:18px;padding:26px 22px 22px;min-height:calc(100vh - 150px);display:flex;flex-direction:column;justify-content:center;background:radial-gradient(900px 420px at 15% 0,#bfe0f7 0,transparent 62%),linear-gradient(135deg,#d7ebfa 0%,#eef7fd 55%,#ffffff 100%)}
.cc-chat.talk{justify-content:flex-end}
.cc-welcome{text-align:center;margin:0 auto 26px;max-width:620px}
.cc-welcome h1{font-size:44px;line-height:1.05;letter-spacing:-.03em;margin:0 0 10px;color:#0b2c4d;font-weight:600}
.cc-welcome p{margin:0;color:#3f5a73;font-size:15px}
.cc-in{position:relative;background:#fff;border-radius:16px;box-shadow:0 8px 30px rgba(11,44,77,.12);border:1px solid #d3e6f4;width:100%;max-width:760px;margin:0 auto}
.cc-in textarea{width:100%;border:0;outline:0;resize:none;background:transparent;font:inherit;font-size:15px;color:var(--ink);padding:18px 64px 18px 20px;min-height:84px;border-radius:16px}
.cc-send{position:absolute;right:14px;bottom:14px;width:38px;height:38px;border-radius:50%;border:0;background:#0a5c9e;color:#fff;display:grid;place-items:center;cursor:pointer}
.cc-send:disabled{opacity:.45;cursor:default}.cc-send svg{width:18px;height:18px}
.cc-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:16px auto 0;max-width:760px}
.cc-chip{border:1px solid #b4d2e8;background:rgba(255,255,255,.75);color:#0b2c4d;border-radius:999px;padding:7px 14px;font:inherit;font-size:12.5px;cursor:pointer}.cc-chip:hover{background:#fff}
.cc-prev{max-width:760px;width:100%;margin:22px auto 0}
.cc-thread{width:100%;max-width:760px;margin:0 auto 14px;max-height:calc(100vh - 330px);overflow:auto;display:flex;flex-direction:column;gap:12px;padding:4px 2px}
.cc-m{display:flex;gap:10px;align-items:flex-start;max-width:88%}.cc-m.you{align-self:flex-end;flex-direction:row-reverse}
.cc-m .av{width:30px;height:30px;border-radius:50%;background:#0a5c9e;color:#fff;display:grid;place-items:center;flex:none}.cc-m .av svg{width:16px;height:16px}
.cc-m .b{background:#fff;border:1px solid #d3e6f4;border-radius:14px;padding:10px 14px;font-size:14px;line-height:1.55;color:var(--ink);box-shadow:0 2px 8px rgba(11,44,77,.05)}
.cc-m.you .b{background:#0a5c9e;border-color:#0a5c9e;color:#fff}
.cc-dots{display:inline-flex;gap:4px;padding:4px 2px}.cc-dots i{width:7px;height:7px;border-radius:50%;background:#7fa6c4;animation:ccdot 1s infinite}.cc-dots i:nth-child(2){animation-delay:.15s}.cc-dots i:nth-child(3){animation-delay:.3s}
@keyframes ccdot{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
.cc-card{margin-top:10px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:#f7fbfe;min-width:300px}
.cc-card .top{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.cc-card .ttl{font-size:13px;font-weight:600;margin-top:5px}.cc-card .st{font-size:12.5px;color:var(--ink-soft);margin-top:2px}
.cc-bell{position:relative;display:inline-flex}
.cc-bellbadge{position:absolute;top:-5px;right:-5px;background:#2e9a46;color:#fff;border-radius:999px;font-size:10px;font-weight:700;min-width:16px;height:16px;line-height:16px;padding:0 4px;text-align:center}
.cc-bellpanel{position:absolute;right:0;top:calc(100% + 8px);width:340px;max-width:86vw;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 34px rgba(11,44,77,.18);z-index:70;overflow:hidden}
.cc-bellhd{padding:10px 14px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-muted);border-bottom:1px solid var(--line)}
.cc-note{display:flex;gap:10px;padding:11px 14px;border-bottom:1px solid var(--line);font-size:12.5px;line-height:1.45}.cc-note:last-child{border-bottom:0}
.cc-note b{display:block;font-size:13px}.cc-note .t{display:block;color:var(--ink-soft)}
.cc-note .dot{width:8px;height:8px;border-radius:50%;background:#f5b544;flex:none;margin-top:5px}.cc-note .dot.hi{background:#d4443b}
.acc-code{margin-top:8px;font-family:var(--mono);font-size:11px;line-height:1.5;background:rgba(0,0,0,.05);border-radius:8px;padding:8px 10px;word-break:break-word}
.rca-hd{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:14px 0 6px}
.rca-hd h2{font-size:16px;font-weight:600;margin:0}.rca-bar{flex:1;min-width:140px;height:8px;border-radius:99px;background:var(--hover);overflow:hidden}
.rca-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#0a5c9e,#2e9a46);transition:width .5s}
.rca-now{margin-top:12px;border:1px solid #b4d2e8;background:#f2f8fc;border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.6}
.rca-now.wait{background:#fff7e6;border-color:#f0d49a}.rca-now.done{background:#eaf7ee;border-color:#a8dfbd}.rca-now.bad{background:#fdecec;border-color:#f3b4b4}
.rca-now .who{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:4px;font-weight:600}
.rca-now .lbl{display:inline-block;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:#0a5c9e;margin-right:6px;min-width:64px}
.rca-now .row{margin-top:2px}.rca-now .pulse{width:8px;height:8px;border-radius:50%;background:#0a5c9e;animation:rcap 1.1s infinite}
@keyframes rcap{0%,100%{opacity:1}50%{opacity:.25}}
.cc-hero{border-radius:16px;padding:30px 32px 56px;color:#fff;background:radial-gradient(900px 300px at 90% 0,#0a5c9e 0,transparent 60%),linear-gradient(135deg,#0b2c4d 0,#0f4c81 100%);position:relative;overflow:hidden}
.cc-hero.solo{padding-bottom:30px}
.cc-hero:after{content:"";position:absolute;right:-60px;top:-60px;width:260px;height:260px;border-radius:50%;border:34px solid rgba(63,191,90,.18)}
.cc-hero .tg{display:inline-block;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:#3fbf5a;border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:4px 11px}
.cc-hero h1{font-size:30px;line-height:1.1;letter-spacing:-.025em;margin:14px 0 6px;font-weight:700}.cc-hero h1 em{font-style:normal;color:#3fbf5a}
.cc-hero p{margin:0;color:#cfe3f3;font-size:14px;max-width:640px}
.cc-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin:-34px 14px 20px;position:relative;z-index:1}
.cc-tile{display:flex;gap:12px;align-items:flex-start;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px;box-shadow:0 6px 22px rgba(11,44,77,.09);color:var(--ink);text-decoration:none;transition:transform .15s,box-shadow .15s,border-color .15s}
.cc-tile:hover{transform:translateY(-2px);border-color:#b4d2e8;box-shadow:0 10px 28px rgba(11,44,77,.14)}
.cc-tile .ic{width:38px;height:38px;border-radius:10px;background:var(--brand-soft);color:var(--brand);display:grid;place-items:center;flex:none}
.cc-tile .ic svg{width:18px;height:18px}.cc-tile b{display:block;font-size:14px}.cc-tile span.d{display:block;font-size:12px;color:var(--ink-soft);margin-top:2px}
.cc-tile .n{margin-left:auto;background:#2e9a46;color:#fff;border-radius:999px;font-size:11px;font-weight:700;padding:1px 8px;flex:none}
.page{animation:ccfade .35s ease}@keyframes ccfade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.acc-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}
@media (max-width:1000px){.acc-grid{grid-template-columns:minmax(0,1fr)}}
.acc-f{display:flex;flex-direction:column;gap:4px;margin:0 0 12px}
.acc-f label{font-size:12px;font-weight:600;color:var(--ink-soft)}
.acc-f input,.acc-f textarea{font:inherit;font-size:13.5px;border:1px solid var(--line-strong);border-radius:8px;padding:9px 10px;background:var(--surface);color:var(--ink)}
.acc-f textarea{min-height:96px;resize:vertical}
.acc-banner{display:flex;gap:8px;align-items:flex-start;border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.5;margin:0 0 12px}
.acc-banner svg{flex:none;margin-top:2px}
.acc-banner.bad{background:#fdecec;border:1px solid #f3b4b4;color:#8a1f1f}
.acc-banner.ok{background:#e8f7ee;border:1px solid #a8dfbd;color:#14653a}
.acc-banner.wait{background:#fff4dc;border:1px solid #f0d49a;color:#7a4d00}
.acc-steps{list-style:none;margin:0;padding:0}
.acc-steps li{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:12.5px}
.acc-steps li:last-child{border-bottom:0}
.acc-steps .n{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:600;background:var(--hover);flex:none}
.acc-steps li.done .n{background:#22c55e;color:#fff}.acc-steps li.now .n{background:var(--brand);color:#fff}
.acc-req{border:1px solid var(--line);border-radius:12px;padding:14px;margin:0 0 12px;background:var(--surface)}
</style>
<script>
"use strict";
/* =====================================================================
   Sign-in help (Live): the employee can't sign in because of a network
   problem. They tell the helpdesk, a ServiceNow incident is raised, and the
   IT engineer approves restoring access. Approval clears the fault, so the
   same username and password then work against Keycloak.
   ===================================================================== */
const ACC = { user: "maya.thompson", pass: "", text: "", status: null, login: null, busy: "", err: "", reqs: [], note: {}, loaded: false };

// The Controlled Demo / Live Agent switch was removed from the UI, so the app always runs the scripted demo.
if (typeof WB !== "undefined" && WB.mode !== "demo") { WB.mode = "demo"; try { wbSave(); } catch (e) {} }

async function accApi(op, payload = {}) {
  try {
    const r = await fetch("/api/p32/access", { method: "POST", headers: { "Content-Type": "application/json", "X-P32-Role": psCur().api }, body: JSON.stringify({ op, payload }) });
    return await r.json();
  } catch (e) { return { ok: false, error: "The server can't be reached. Is the backend running?" }; }
}
async function accRefresh(quiet) {
  const before = JSON.stringify([ACC.status, ACC.reqs]);
  const [s, l] = await Promise.all([accApi("status"), accApi("list_requests")]);
  if (s.ok) ACC.status = s;
  if (l.ok) ACC.reqs = l.requests;
  ACC.loaded = true;
  accSyncWb();
  if (!quiet || before !== JSON.stringify([ACC.status, ACC.reqs])) { if (/^(sign-in|approvals|risk-alerts)$/.test(route().split("/")[0]) || (PS.id === "engineer" && before !== JSON.stringify([ACC.status, ACC.reqs]))) render(); }
}
setInterval(() => { if ((/^(sign-in|approvals)$/.test(route().split("/")[0]) || PS.id === "engineer" || (PS.id === "employee" && accReq())) && !ACC.busy && !(document.activeElement && /^acc-/.test(document.activeElement.id))) accRefresh(true); }, 4000);
accRefresh(true);

function accReq() { const r = ACC.status && ACC.status.request; return r && r.id !== ACC.hide ? r : null; }

function pageAccess() {
  if (!ACC.loaded) { accRefresh(); }
  const req = accReq();
  const out = ACC.status && ACC.status.outage;
  const lg = ACC.login;
  const banner = lg && lg.signed_in ? `<div class="acc-banner ok">${icon("check")}<span><b>Signed in as ${esc(lg.name || lg.username)}.</b> Your access is working.</span></div>`
    : lg ? `<div class="acc-banner bad">${icon("xcircle")}<span><b>${lg.kind === "network" ? "Can't reach the sign-in service" : "Sign-in failed"}.</b> ${esc(lg.error)}${lg.kind === "network" ? " You can ask the helpdesk for help on the right." : ""}${accDetail(lg.detail)}</span></div>` : "";
  const approved = req && req.status === "approved", declined = req && req.status === "declined", pending = req && req.status === "pending_approval";
  const step = (n, done, now, t, s) => `<li class="${done ? "done" : now ? "now" : ""}"><span class="n">${done ? icon("check") : n}</span><span><b>${t}</b><br><span style="color:var(--ink-muted)">${s}</span></span></li>`;
  const helpdesk = req ? `
    <div class="acc-banner ${approved ? "ok" : declined ? "bad" : "wait"}">${icon(approved ? "check" : declined ? "xcircle" : "clock")}<span>${approved ? "<b>Your access has been restored.</b> Go back to the sign-in form and try again with the same username and password." : declined ? "<b>The IT engineer needs a closer look.</b> The service desk will contact you." : "<b>Waiting for the IT engineer to approve.</b> This page updates by itself."}</span></div>
    <ul class="acc-steps">
      ${step(1, true, false, "Request sent to the helpdesk", esc(req.created) + (req.error_id ? ` · error ${esc(req.error_id)}` : ""))}
      ${step(2, true, false, `Ticket ${esc(req.incident)} created in ServiceNow`, `<a href="${esc(req.url)}" target="_blank" rel="noopener">Open in ServiceNow ${icon("external")}</a>`)}
      ${step(3, approved || declined, pending, "IT engineering investigation", approved ? "Fixed " + esc(req.decided || "") : declined ? "Declined " + esc(req.decided || "") : "Arya Hajarha (IT engineer) investigates with the 8-stage workflow")}
      ${step(4, approved, false, "You can sign in again", approved ? "Ticket resolved in ServiceNow" : "After the fix")}
    </ul>
    ${approved || declined ? `<div style="margin-top:12px"><button class="btn" data-act="acc-new">Ask the helpdesk about something else</button></div>` : ""}`
    : `<div class="acc-f"><label for="acc-text">Tell the helpdesk what is happening</label>
      <textarea id="acc-text" placeholder="e.g. I am unable to sign in to my account">${esc(ACC.text)}</textarea></div>
      ${ACC.err ? `<div class="acc-banner bad">${icon("xcircle")}<span>${esc(ACC.err)}</span></div>` : ""}
      ${ACC.busy === "ticket" ? accProg() : `<button class="btn primary" data-act="acc-ticket" ${ACC.busy ? "disabled" : ""}>${icon("inbox")} Send to helpdesk</button>`}
      <p style="font-size:12px;color:var(--ink-muted);margin:10px 0 0">This creates a ServiceNow incident and sends it to IT Engineering.</p>`;
  return `${head("Sign-in help", "Can't sign in? Tell the helpdesk. They raise a ServiceNow ticket and an IT engineer investigates and restores your access.", "Employee self-service")}
  <div class="acc-grid">
    <div class="card pad"><p class="sec-title">${icon("lock")} Sign in to Crystal Clean</p>
      ${banner}
      <div class="acc-f"><label for="acc-user">Username</label><input id="acc-user" autocomplete="username" value="${esc(ACC.user)}"></div>
      <div class="acc-f"><label for="acc-pass">Password</label><input id="acc-pass" type="password" autocomplete="current-password" value="${esc(ACC.pass)}"></div>
      <button class="btn primary" data-act="acc-login" ${ACC.busy ? "disabled" : ""}>${ACC.busy === "login" ? "Signing in…" : "Sign in"}</button>
      <p style="font-size:11.5px;color:var(--ink-muted);margin:12px 0 0">Checked against the Keycloak identity provider. ${out ? "Demo status: a network fault is affecting this account." : "Demo status: no network fault is affecting this account."}
        ${!out ? ` <a href="javascript:void 0" data-act="acc-outage">Simulate the network fault again</a>` : ""}</p></div>
    <div class="card pad"><p class="sec-title">${icon("door")} Helpdesk</p>${ACC.loaded ? helpdesk : `<p style="font-size:12.5px;color:var(--ink-muted)">Loading…</p>`}</div>
  </div>`;
}


/* ---------------------------------------------- persona home banner (matches the landing page) */
function ccCount(f) { try { return f() || 0; } catch (e) { return 0; } }
function ccHero(base) {
  const p = psCur();
  if (base !== p.home) return "";
  if (PS.id === "employee") return "";
  const first = p.name.split(" ")[0];
  const tile = (href, ic, t, d, n) => `<a class="cc-tile" href="${href}"><span class="ic">${icon(ic)}</span><span style="min-width:0"><b>${esc(t)}</b><span class="d">${esc(d)}</span></span>${n ? `<span class="n">${n}</span>` : ""}</a>`;
  const open = (x) => !["Mitigated", "Dismissed", "False positive"].includes(x.status);
  let tag, title, sub, tiles;
  if (PS.id === "employee") {
    tag = "Employee self-service"; title = `Hi ${esc(first)}, how can we <em>help you?</em>`;
    sub = "Describe a problem or request in your own words. AI routes it, and a person approves before anything changes.";
    tiles = ""; // the menu already has Digital FrontDoor, Alerts for you and Sign-in help
  } else if (PS.id === "engineer") {
    tag = "IT engineer"; title = `Hi ${esc(first)}, here is what <em>needs you</em>`;
    sub = "Investigate incidents, approve RCA, SOPs and sign-in access requests, and watch the risk alerts raised from the predictive score.";
    tiles = "";
  } else return "";
  return `<div class="cc-hero${tiles ? "" : " solo"}"><span class="tg">${esc(tag)}</span><h1>${title}</h1><p>${esc(sub)}</p></div>${tiles ? `<div class="cc-tiles">${tiles}</div>` : `<div style="height:18px"></div>`}`;
}

/* ----------------------------------- RCA workflow header + "what is happening now" (IT engineer incident view) */
const CC_NARR = {
  intake: { takes: "the incident record raised in ServiceNow (short description, service, impact)", does: "checks the record is complete and looks for a duplicate", gives: "a validated incident", next: "Triage" },
  triage: { takes: "the validated incident and its service and CI from the CMDB", does: "recommends category, assignment group, impact, urgency and priority", gives: "a triaged incident (ServiceNow is updated only after confirmation)", next: "Context & Evidence" },
  evidence: { takes: "the triaged incident", does: "pulls similar past incidents, service dependencies, recent changes and logs", gives: "one evidence pack", next: "Hypothesis" },
  hypothesis: { takes: "the evidence pack", does: "proposes 2 or 3 possible root causes, each with supporting evidence", gives: "ranked hypotheses", next: "Critic" },
  critic: { takes: "the hypotheses and their evidence", does: "challenges each one: what is unproven, what contradicts it", gives: "the hypotheses that survive", next: "Judge" },
  judge: { takes: "the hypotheses and the critique", does: "scores confidence against the 0.7 threshold and picks the best supported cause", gives: "one chosen root cause (or back to Evidence for more)", next: "RCA Writer" },
  rca: { takes: "the chosen root cause and the evidence", does: "writes the structured root cause analysis", gives: "a draft RCA", next: "Quality gate" },
  quality: { takes: "the draft RCA", does: "runs the nine-point quality and governance check", gives: "a checked RCA (or back to the writer)", next: "Engineer approval" },
  approval: { takes: "the RCA, the evidence and the proposed fix", does: "waits for the engineer to approve, ask for changes or reject", gives: "the engineer's decision", next: "SOP Generation" },
  sop: { takes: "the approved RCA", does: "drafts a step-by-step SOP with checks, rollback and escalation", gives: "a draft SOP", next: "SOP approval" },
  sop_approval: { takes: "the draft SOP", does: "waits for the engineer to confirm it is safe to run", gives: "permission to execute", next: "SOP Execution" },
  execution: { takes: "the approved SOP steps", does: "runs them one at a time and records each result", gives: "an execution record", next: "Verification" },
  verification: { takes: "health readings before and after the fix", does: "checks the symptoms are really gone (finishing the SOP alone is not proof)", gives: "a verified result", next: "Closure" },
  closure: { takes: "the verified result and the full audit trail", does: "writes the resolution to ServiceNow, reads it back and closes the incident", gives: "a closed incident", next: "nothing, this is the last step" },
};
function ccRcaHeader(run, inc) {
  const ST = WB_FLOWS.incident.stages;
  const doneN = run ? ST.filter((s) => s.nodes.every((k) => wbNodeState(run, k) === "done")).length : 0;
  const mode = run ? run.mode : wbMode();
  return `<div class="rca-hd"><h2>RCA workflow</h2><span class="mono" style="font-size:12px;color:var(--ink-muted)">${esc(wbNum(inc))}</span>
    <span class="pill p-info">${mode === "live" ? "Live agents" : "Simulated telemetry"}</span>
    <span class="rca-bar"><i style="width:${Math.round((doneN / ST.length) * 100)}%"></i></span><b style="font-size:13px">${doneN} / ${ST.length} stages</b></div>`;
}
function ccNowLine(run, inc) {
  const ST = WB_FLOWS.incident.stages;
  const stageOf = (k) => ST.findIndex((s) => s.nodes.includes(k));
  const num = esc(wbNum(inc));
  if (!run || run.status === "ready") return `<div class="rca-now"><div class="who">Not started</div><div class="row">Press <b>Start investigation</b>. The Intake agent will take ${num} from ServiceNow, check it is complete and pass it to Triage.</div></div>`;
  if (run.status === "completed") return `<div class="rca-now done"><div class="who">All 8 stages complete</div><div class="row">${num} was investigated, approved by the engineer, fixed, verified and closed. The resolution is written back to ServiceNow.</div></div>`;
  if (run.status === "linked") return `<div class="rca-now done"><div class="who">Linked to an existing incident</div><div class="row">${num} describes a problem that is already being handled, so no separate investigation was needed.</div></div>`;
  const key = run.gate ? run.gate.node : run.status === "running" ? run.current : run.next || run.current;
  const nr = CC_NARR[key]; if (!nr) return "";
  const meta = WB_NODES[key]; const si = stageOf(key);
  const head = `Stage ${si + 1} of ${ST.length} · ${esc(ST[si].title)} · ${esc(meta.name)}`;
  const body = `<div class="row"><span class="lbl">Takes</span>${esc(nr.takes)}.</div><div class="row"><span class="lbl">Does</span>${esc(nr.does)}.</div><div class="row"><span class="lbl">Passes on</span>${esc(nr.gives)} to ${esc(nr.next)}.</div>`;
  if (run.status === "failed" || (run.gate && (run.gate.type === "error" || run.gate.type === "exec_failed"))) return `<div class="rca-now bad"><div class="who">${head} · stopped</div>${body}<div class="row">It stopped here. Use the controls above to retry or take over.</div></div>`;
  if (run.status === "waiting" || run.status === "attention" || (meta.kind === "human" && run.status !== "running")) return `<div class="rca-now wait"><div class="who">${head} · waiting for you</div>${body}</div>`;
  const t0 = run.nodes[key] && run.nodes[key].started ? Date.parse(run.nodes[key].started) : Date.now();
  return `<div class="rca-now"><div class="who"><span class="pulse"></span>${head} · working for <span id="cc-elapsed" data-t0="${t0}">0s</span></div>${body}</div>`;
}
const _wbStepperCC = wbStepper;
wbStepper = function (run, inc) {
  if (wbFlowOf(inc) !== "incident") return _wbStepperCC(run, inc);
  return ccRcaHeader(run, inc) + _wbStepperCC(run, inc) + ccNowLine(run, inc);
};
setInterval(() => { const el = document.getElementById("cc-elapsed"); if (el) el.textContent = Math.max(0, Math.round((Date.now() - +el.dataset.t0) / 1000)) + "s"; }, 1000);

/* ------------------------------------------------------------------------------------------------
   Sign-in ticket -> IT engineer workbench. The helpdesk ticket (a real ServiceNow incident) shows up in
   the engineer's Agentic Incident Workbench under Identity & access and runs the same 8-stage RCA
   workflow. When the SOP execution stage finishes, it restores the employee's sign-in route and
   resolves the ServiceNow ticket (server side, engineer role only).
   ------------------------------------------------------------------------------------------------ */
function accScenario(r) {
  const e = r.error_id || "KC-000000";
  const when = new Date(String(r.created || "").replace(" ", "T")); const at = isNaN(when) ? wbNow() : when.toISOString();
  return {
    id: r.incident, use_case: "IAM", submitted: true, accessId: r.id,
    title: "Employee cannot sign in: Keycloak identity provider unreachable",
    description: `${r.employee} (${r.username}) cannot sign in although the username and password are correct. The Keycloak token endpoint returns 504 Gateway Timeout (error ${e}) before the credentials are checked. Employee's words: "${r.message}".`,
    service: "Employee Sign-in (Keycloak SSO)", ci: "keycloak-sso-prod", reported_by: `${r.employee} (via the helpdesk)`, reported_at: at,
    priority: "2 - High", impact: "2 - Medium", urgency: "2 - Medium", category: "Access", group: "", sn: { number: r.incident, url: r.url },
    business_impact: "An employee cannot start work, and others on the same network path may follow.", complexity: "Single round: the evidence points to one cause",
    evidence: {
      logs: [
        { id: "L1", t: 14, source: "Keycloak sign-in gateway", text: `POST /realms/crystal-clean/protocol/openid-connect/token returned 504 (upstream connect timeout, 10 s) for ${r.username}; error ${e}.` },
        { id: "L2", t: 13, source: "Keycloak server log", text: `Realm crystal-clean is up and healthy. No failed-credential or lockout events for ${r.username} in the last 60 minutes: the request never reached the identity provider.` },
        { id: "L3", t: 12, source: "Network monitoring", text: "Packet loss 38% and rising latency on the route from the employee's branch edge to the sign-in gateway." },
      ],
      metrics: [{ id: "M1", name: "Sign-in success rate (employee's network)", unit: "%", before: 12, threshold: 95, after: 99.4, after2: 99.4, better: "higher" }],
      changes: [{ id: "CHG-DEMO-6140", t_hours: 20, title: "Edge routing update", detail: "Branch edge route table updated to send sign-in traffic over the secondary link." }],
      history: [{ id: "SYN-SSO-07", title: "Sign-in timeouts for one branch after an edge routing change", resolution: "Primary route restored; sign-in gateway health check tightened." }],
      kb: [{ id: "KB-DEMO-1601", title: "Sign-in fails with a gateway timeout", summary: "A 504 from the token endpoint means the request never reached Keycloak. Check the network path first, then confirm the account is enabled and not locked." }],
      cmdb: { class: "Identity provider", depends_on: ["sign-in gateway", "branch edge network"], owner_group: "IT Engineering", environment: "Production (synthetic)" },
      deep: [],
    },
    script: {
      hypotheses: [
        { title: "The network path to the identity provider is dropping sign-in requests", why: "The gateway times out before Keycloak is reached, and packet loss is high on the route.", evidence: ["L1", "L2", "L3"], confidence: 0.86 },
        { title: "The employee's account is locked or disabled", why: "Sign-in fails for this employee.", evidence: [], confidence: 0.1 },
        { title: "The password was typed wrongly", why: "Most sign-in failures are credential errors.", evidence: [], confidence: 0.04 },
      ],
      critic: [
        "Supported by three independent sources: gateway timeout, a healthy Keycloak with no credential events, and packet loss on the route.",
        "Contradicted: Keycloak shows no lockout or disabled-account event for this user.",
        "Contradicted: a wrong password would be rejected by Keycloak with a 401, not time out at the gateway.",
      ],
      selected: 0, needs_round2: false,
      root_cause: "The network path to the Keycloak identity provider is dropping sign-in requests; the employee's account is healthy.",
      contributing: ["The branch edge route change was not tested against the sign-in gateway.", "The gateway health check did not alert on rising packet loss."],
      remediation: [
        { step: "Confirm the timeout on the path from the employee's network to the sign-in gateway.", expected: "Timeout reproduced and the failing hop identified." },
        { step: "Verify the employee's Keycloak account is enabled and not locked (read-only check).", expected: "Account healthy, no failed-credential events." },
        { step: "Restore the sign-in route for the employee and clear the network fault.", expected: "The token endpoint answers from the employee's network." },
        { step: "Ask the employee to sign in again to confirm.", expected: "Sign-in succeeds." },
      ],
      rollback: "Re-apply the previous route configuration if sign-in degrades for other users.",
      prevention: ["Test edge routing changes against the sign-in gateway before release.", "Alert on packet loss above 5% on the route to the identity provider."],
      exec_fail: null, verify_fail_first: false,
    },
  };
}
function accSyncWb() {
  if (PS.id !== "engineer" || typeof WB === "undefined") return;
  const added = [];
  for (const r of ACC.reqs) {
    const have = WB.submitted.find((i) => i.id === r.incident);
    if (have && !have.sn && r.url) { have.sn = { number: r.incident, url: r.url }; wbSave(); } // older incidents get their ServiceNow link
    if (r.status !== "pending_approval" || !r.incident) continue;
    if (WB.submitted.some((i) => i.id === r.incident) || WB_DATA.incidents.some((i) => i.id === r.incident)) continue;
    const inc = accScenario(r);
    // Keep the "five tracked incidents" list: the oldest idle record in this use case makes room.
    const idle = wbIncidentsFor("IAM").filter((o) => !["running", "waiting", "attention", "paused", "failed"].includes((WB.runs[o.id] || {}).status));
    const pool = idle.length ? idle : wbIncidentsFor("IAM");
    const victim = pool.sort((a, b) => Date.parse(wbReportedAt(a)) - Date.parse(wbReportedAt(b)))[0];
    if (victim) { if (victim.submitted) { inc.replaces = victim.replaces; WB.submitted = WB.submitted.filter((s) => s.id !== victim.id); } else inc.replaces = victim.id; delete WB.runs[victim.id]; }
    WB.submitted.unshift(inc); WB.useCase = "IAM";
    added.push(inc);
  }
  if (added.length) {
    wbCommit();
    psToast(`New incident from the helpdesk: ${added[0].id}, an employee cannot sign in. Open it in the Agentic Incident Workbench (Identity & access).`, "info");
  }
}
const _wbExecFinishCC = wbExecFinish;
wbExecFinish = async function (run) {
  const inc = wbInc(run.incId);
  const rq = inc && ACC.reqs.find((x) => x.incident === inc.id && x.status === "pending_approval");
  if (inc && inc.accessId && rq) {
    const r = await accApi("decide", { id: rq.id, decision: "approve", note: `Restored by the SOP run after the engineer approved the RCA and the SOP (${run.id}).` });
    const already = !r.ok && /already/i.test(r.error || "");
    wbEvent(run, "Sign-in restore (Keycloak)", "tool", r.ok ? `Sign-in route restored and the Keycloak account verified (enabled, not locked). ServiceNow ${r.request.incident} resolved.` : already ? "Sign-in access was already restored." : `Restore failed: ${r.error}`, r.ok || already ? "ok" : "bad");
    await accRefresh(true);
  }
  return _wbExecFinishCC(run);
};
const _wbResetAllCC = wbResetAll;
wbResetAll = function () {
  _wbResetAllCC();
  accApi("reset_demo").then(() => { ACC.reqs = []; ACC.status = null; ACC.login = null; ACC.hide = null; ACC.loaded = false; ACC.err = ""; render(); });
};
function accDetail(d) {
  return d ? `<div class="acc-code">HTTP ${esc(d.status)} ${esc(d.title)} · ${esc(d.endpoint)}<br>${esc(d.reason)}<br>Error ID ${esc(d.error_id)} · ${esc(d.at)}</div>` : "";
}
const ACC_PROG = ["Collecting diagnostics (realm, client, error ID)", "Creating the ServiceNow incident", "Routing it to IT Engineering"];
function accProg() {
  return `<ul class="acc-steps">${ACC_PROG.map((t, i) => `<li class="${i < ACC.prog ? "done" : i === ACC.prog ? "now" : ""}"><span class="n">${i < ACC.prog ? icon("check") : i + 1}</span><span><b>${t}</b></span></li>`).join("")}</ul>`;
}

/* ------------------------------------------------ notification bell (employee, top right) */
function ccNotes() {
  const open = (x) => !["Mitigated", "Dismissed", "False positive"].includes(x.status);
  const out = [];
  try {
    piMyAlerts().filter(open).forEach((p) => { const a = p.alerts.employee; out.push({ hi: a.cls === "High" || a.cls === "Critical", title: a.title, text: wbShort(a.message), at: a.at }); });
  } catch (e) {}
  const r = typeof accReq === "function" ? accReq() : null;
  if (r) out.unshift({ hi: false, title: r.status === "approved" ? `Sign-in fixed: ${r.incident}` : `Sign-in ticket ${r.incident}`, text: r.status === "approved" ? "Your access is restored. You can sign in again." : "IT Engineering is looking into it.", at: r.created });
  return out;
}
function ccBell() {
  if (PS.id !== "employee") return "";
  const n = ccNotes();
  const panel = UI.ccBell ? `<div class="cc-bellpanel" role="dialog" aria-label="Notifications"><div class="cc-bellhd">Notifications</div>${n.length ? n.map((x) => `<div class="cc-note"><span class="dot ${x.hi ? "hi" : ""}"></span><span><b>${esc(x.title)}</b><span class="t">${esc(x.text)}</span></span></div>`).join("") : `<div class="cc-note" style="color:var(--ink-muted)">No new notifications.</div>`}</div>` : "";
  return `<span class="cc-bell"><button class="ghostbtn" data-act="cc-bell" aria-label="Notifications" title="Notifications" style="padding:0 9px;position:relative">${icon("bell")}${n.length ? `<span class="cc-bellbadge">${n.length}</span>` : ""}</button>${panel}</span>`;
}
document.addEventListener("click", (ev) => { if (UI.ccBell && !ev.target.closest(".cc-bell")) { UI.ccBell = false; renderTopbar(); } });

/* ------------------------------------------------------------------------------------------------
   Employee chat (Digital FrontDoor). One message box instead of the form: the assistant works out whether
   it is an IT incident, a device request or an HR request, opens it through the same pipeline as before,
   asks follow-up questions in the conversation, and shows live progress cards.
   ------------------------------------------------------------------------------------------------ */
const CC_CHAT_KEY = "p32-chat-v1";
UI.cc = UI.cc || { msgs: (() => { try { return JSON.parse(localStorage.getItem(CC_CHAT_KEY)) || []; } catch (e) { return []; } })(), draft: "", typing: false, prog: -1 };
function ccSaveChat() { try { localStorage.setItem(CC_CHAT_KEY, JSON.stringify(UI.cc.msgs.slice(-60))); } catch (e) {} }
function ccSay(from, text, card) { UI.cc.msgs.push({ from, text, card: card || null, at: Date.now() }); ccSaveChat(); }
const ccWait = (ms) => new Promise((r) => setTimeout(r, ms));
const CC_SIGNIN = /(sign.?in|log.?in|login|password|locked out|account.{0,12}lock)/i;
const CC_CHIPS = ["I'm unable to connect to the office Wi-Fi", "My laptop is not working", "I can't sign in to my account"];

function ccWaitingInfo() { return WB.myIds.map((id) => ({ id, run: WB.runs[id] })).find((x) => x.run && x.run.gate && x.run.gate.type === "intake_info") || null; }

async function ccSend(raw) {
  const text = String(raw == null ? UI.cc.draft : raw).trim();
  if (!text || UI.cc.typing || UI.cc.prog >= 0) return;
  UI.cc.draft = ""; ccSay("you", text); UI.cc.typing = true; render();
  try {
    const wait = ccWaitingInfo();
    if (wait) {
      await ccWait(900);
      if (wbWords(text) < 4) ccSay("bot", "Could you add a little more detail? A short sentence is enough.");
      else { ccSay("bot", "Thank you. I've added that to your request and the team is carrying on."); UI.cc.typing = false; render(); wbGateAction(wait.id, "info", text); return; }
    } else if (CC_SIGNIN.test(text)) await ccSignin(text);
    else await ccRequest(text);
  } catch (e) { ccSay("bot", "Sorry, something went wrong on my side. Please try again."); console.error(e); }
  UI.cc.typing = false; render();
}

async function ccRequest(text) {
  const first = WB_EMPLOYEE.name.split(" ")[0];
  if (text.length < 10) { await ccWait(700); ccSay("bot", "Tell me a little more about what's happening so I can send it to the right team."); return; }
  const route = await wbRoute(text);
  if (wbMode() !== "live") await ccWait(1500);
  const title = text.length <= 90 ? text : text.slice(0, 87).replace(/\s+\S*$/, "") + "…";
  const form = { title, description: text, impact: "team", urgency: "today", assetTag: "" };
  let r;
  if (route.domain === "incident") {
    let uc = "", service = "";
    const match = WB_DATA.incidents.find((i) => i.service === route.service);
    if (match) { uc = match.use_case; service = match.service; } else { const rr = wbRouteRules(text); if (rr.service) { uc = rr.use_case; service = rr.service; } }
    if (!service) { uc = "IAM"; service = "Workforce Identity Policies"; }
    r = await wbSubmit({ uc, service, title: form.title, description: form.description, impact: form.impact, urgency: form.urgency });
    if (r.ok) { const inc = wbInc(r.id); inc.route = route; const run = WB.runs[r.id]; if (run) wbEvent(run, "FrontDoor Router Agent", "decision", `Routed to IT Incidents → ${service} (${route.engine === "ai" ? `AI, ${route.model}` : route.engine}): ${route.reason || ""}`, "ok"); wbSave(); }
  } else {
    r = await wbSubmitRequest(route.domain, form, route);
    const run = r.ok && WB.runs[r.id];
    if (run) { run.events.splice(1, 0, { at: wbNow(), actor: "FrontDoor Router Agent", type: "decision", text: `Routed to ${WB_FLOWS[route.domain].label} (${route.engine === "ai" ? `AI, ${route.model}` : route.engine}): ${route.reason || ""}`, result: "ok" }); wbSave(); }
  }
  if (!r.ok) { ccSay("bot", `I couldn't open that request: ${r.error}`); return; }
  const what = { incident: "an IT incident", asset: "a device request for IT Assets", hr: "an HR request" }[route.domain];
  ccSay("bot", `Thanks ${first}. This looks like ${what}, so I've opened ${r.id} and sent it to the team. You'll see updates right here.`, { kind: "req", id: r.id });
}

async function ccSignin(text) {
  const existing = accReq();
  if (existing && existing.status === "pending_approval") { await ccWait(700); ccSay("bot", `You already have an open sign-in ticket, ${existing.incident}. IT Engineering is on it.`, { kind: "ticket", id: existing.id }); return; }
  await ccWait(800);
  ccSay("bot", "I'm sorry about that. I'll raise a ticket with IT Engineering and attach the sign-in diagnostics.");
  UI.cc.typing = false; UI.cc.prog = 0; render();
  const tick = setInterval(() => { if (UI.cc.prog < ACC_PROG.length - 1) { UI.cc.prog += 1; render(); } }, 1800);
  const t0 = Date.now();
  const r = await accApi("raise_ticket", { text, error_id: "" });
  const left = 5400 - (Date.now() - t0); if (left > 0) await ccWait(left);
  clearInterval(tick); UI.cc.prog = -1;
  if (!r.ok) { ccSay("bot", `I couldn't create the ticket: ${r.error}`); return; }
  await accRefresh(true);
  ccSay("bot", `Done. Ticket ${r.request.incident} is open and assigned to IT Engineering with priority ${r.request.priority}. I'll show updates here.`, { kind: "ticket", id: r.request.id });
}

function ccReqCard(id) {
  const i = wbInc(id); if (!i) return "";
  const s = wbFdStatus(i); const run = WB.runs[id]; const c = run && run.closeNote; const flow = wbFlowOf(i);
  return `<div class="cc-card"><div class="top"><span class="mono">${esc(i.id)}</span><span class="pill p-brand">${esc(WB_FLOWS[flow].label)}</span>${badge(wbStatusOf(i).kind, wbStatusOf(i).label)}</div>
    <div class="ttl">${esc(i.title)}</div><div class="st">${esc(s.text)}</div>
    <div class="wb-prog" style="grid-template-columns:repeat(${s.total},1fr)">${Array.from({ length: s.total }, (_, k) => `<i class="${k < s.stage ? "d" : k === s.stage && s.stage < s.total ? "c" : ""}"></i>`).join("")}</div>
    ${c && c.employee_update ? `<div class="st" style="margin-top:8px;color:var(--ink)">${esc(c.employee_update)}</div>` : ""}</div>`;
}
function ccTicketCard(id) {
  const r = ACC.reqs.find((x) => x.id === id); if (!r) return "";
  const done = r.status === "approved", dec = r.status === "declined";
  return `<div class="cc-card"><div class="top"><span class="mono">${esc(r.incident)}</span><span class="pill p-brand">Sign-in</span>${badge(done ? "good" : dec ? "warning" : "info", done ? "Fixed" : dec ? "Declined" : "In progress")}</div>
    <div class="ttl">Sign-in problem${r.error_id ? ` · error ${esc(r.error_id)}` : ""}</div>
    <div class="st">${done ? "Your access is restored. You can sign in again." : dec ? "The service desk will contact you." : "IT Engineering (Arya Hajarha) is investigating."} <a href="${esc(r.url)}" target="_blank" rel="noopener">Open in ServiceNow ${icon("external")}</a></div></div>`;
}
function ccThreadHtml() {
  const bubble = (m) => m.from === "you"
    ? `<div class="cc-m you"><div class="b">${esc(m.text)}</div></div>`
    : `<div class="cc-m"><span class="av">${icon("bot")}</span><div class="b">${esc(m.text)}${m.card ? (m.card.kind === "ticket" ? ccTicketCard(m.card.id) : ccReqCard(m.card.id)) : ""}</div></div>`;
  let h = UI.cc.msgs.map(bubble).join("");
  if (UI.cc.prog >= 0) h += `<div class="cc-m"><span class="av">${icon("bot")}</span><div class="b">${accProgChat()}</div></div>`;
  if (UI.cc.typing) h += `<div class="cc-m"><span class="av">${icon("bot")}</span><div class="b"><span class="cc-dots"><i></i><i></i><i></i></span></div></div>`;
  const w = ccWaitingInfo();
  if (w) { const qs = w.run.gate.missing && w.run.gate.missing.length ? w.run.gate.missing : ["What happens, since when and who is affected?"]; h += `<div class="cc-m"><span class="av">${icon("bot")}</span><div class="b">To look into ${esc(w.id)} I need a little more detail. Just reply here:<ul style="margin:6px 0 0;padding-left:18px">${qs.map((q) => `<li>${esc(wbTxt(q))}</li>`).join("")}</ul></div></div>`; }
  return h;
}
function accProgChat() {
  return `<b>Raising your ticket</b><ul class="acc-steps" style="margin-top:6px">${ACC_PROG.map((t, i) => `<li class="${i < UI.cc.prog ? "done" : i === UI.cc.prog ? "now" : ""}"><span class="n">${i < UI.cc.prog ? icon("check") : i + 1}</span><span>${t}</span></li>`).join("")}</ul>`;
}
function ccChatPage() {
  const first = WB_EMPLOYEE.name.split(" ")[0];
  const talking = UI.cc.msgs.length > 0 || UI.cc.typing || UI.cc.prog >= 0 || !!ccWaitingInfo();
  const mine = WB.myIds.map(wbInc).filter(Boolean);
  const box = `<div class="cc-in"><textarea id="cc-input" rows="2" placeholder="${talking ? "Type your reply…" : "Tell me what's wrong, or what you need…"}" ${UI.cc.typing || UI.cc.prog >= 0 ? "" : ""}>${esc(UI.cc.draft)}</textarea>
    <button class="cc-send" data-act="cc-send" aria-label="Send" ${UI.cc.typing || UI.cc.prog >= 0 ? "disabled" : ""}>${icon("send")}</button></div>`;
  return `<div class="cc-chat ${talking ? "talk" : ""}">
    ${talking ? `<div class="cc-thread" id="chatbox">${ccThreadHtml()}</div>${box}`
      : `<div class="cc-welcome"><h1>Welcome, ${esc(first)}</h1><p>Tell me what's wrong or what you need, in your own words. I'll route it and keep you updated here.</p></div>${box}
         <div class="cc-chips">${CC_CHIPS.map((q) => `<button class="cc-chip" data-act="cc-chip" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>
         ${mine.length ? `<div class="cc-prev"><p class="eyebrow">Your requests</p>${mine.map((i) => ccReqCard(i.id)).join("")}</div>` : ""}`}
  </div>`;
}
pageDigitalFrontDoor = function () { return ccChatPage(); };
document.addEventListener("input", (ev) => { if (ev.target.id === "cc-input") UI.cc.draft = ev.target.value; });
document.addEventListener("keydown", (ev) => { if (ev.target.id === "cc-input" && ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); ccSend(); } });
const _wbResetAllChat = wbResetAll;
wbResetAll = function () { _wbResetAllChat(); UI.cc.msgs = []; UI.cc.typing = false; UI.cc.prog = -1; UI.cc.draft = ""; ccSaveChat(); };

/* Sign-in access requests live inside the IT engineer's Approval inbox (no separate page). */
const accPending = () => ACC.reqs.filter((r) => r.status === "pending_approval");
function accReqCard(r) {
  const inWb = typeof wbInc === "function" && !!wbInc(r.incident);
  return `<div class="ps-q" style="display:block"><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center"><span class="mono" style="font-size:11.5px">${esc(r.incident)}</span>
      ${badge(r.status === "approved" ? "good" : r.status === "declined" ? "warning" : "serious", r.status === "pending_approval" ? "Sign-in access" : r.status === "approved" ? "Fixed" : "Declined")}
      <span class="note-r">Account access · raised ${esc(r.created)}${r.error_id ? ` · error ${esc(r.error_id)}` : ""}</span></div>
    <div style="font-size:13px;font-weight:500;margin-top:3px">${esc(r.employee)} (${esc(r.username)}) can't sign in</div>
    <div style="font-size:12px;color:var(--ink-soft)">“${esc(r.message)}” · <a href="${esc(r.url)}" target="_blank" rel="noopener">Open in ServiceNow ${icon("external")}</a>${r.decided ? ` · ${esc(r.status === "approved" ? "fixed" : r.status)} ${esc(r.decided)}` : ""}</div>
    ${r.status === "pending_approval" ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center">
      ${inWb ? `<a class="btn primary" href="#/workbench/${encodeURIComponent(r.incident)}">${icon("arrow")} Open the 8-stage investigation</a>` : `<span class="note-r">Preparing the investigation…</span>`}
      <button class="btn ghost" data-act="acc-decide" data-id="${esc(r.id)}" data-d="approve" ${ACC.busy ? "disabled" : ""} title="Skip the investigation and restore access now">Restore access directly</button></div>
      <div class="note-r" style="margin-top:8px">The investigation takes a few minutes. The RCA and SOP approvals appear here, under Waiting for you, when they are ready.</div>` : ""}</div>`;
}
function accInboxBlock() {
  if (!ACC.loaded) accRefresh();
  const pend = accPending(), done = ACC.reqs.filter((r) => r.status !== "pending_approval").slice(0, 5);
  return `<div class="card pad" style="margin-bottom:12px"><div class="sec-head"><p class="sec-title">${icon("lock")} Sign-in access requests</p><span class="note-r">${pend.length} waiting for you</span></div>
    ${ACC.err ? `<div class="acc-banner bad">${icon("xcircle")}<span>${esc(ACC.err)}</span></div>` : ""}
    ${pend.length ? pend.map(accReqCard).join("") : `<p style="font-size:12.5px;color:var(--ink-muted);margin:8px 0 0">No sign-in requests waiting. When an employee can't sign in and asks the helpdesk, the request appears here.</p>`}
    ${done.length ? `<p class="eyebrow" style="margin:12px 0 4px">Recently decided</p>${done.map(accReqCard).join("")}` : ""}</div>`;
}
const _pageApprovalsAcc = pageApprovals;
pageApprovals = function () {
  const html = _pageApprovalsAcc();
  return PS.id === "engineer" ? html.replace('<div class="split"', accInboxBlock() + '<div class="split"') : html;
};
const _psApprovalCountAcc = psApprovalCount;
psApprovalCount = function () { return _psApprovalCountAcc() + (PS.id === "engineer" ? accPending().length : 0); };

/* Risk alerts for the IT engineer: the same threshold rules that alert employees also raise the IT alert. */
function accPlainAlert(p) {
  let svc = "A service"; try { svc = piTarget(p).short || svc; } catch (e) {}
  const likely = p.cls === "Critical" || p.cls === "High";
  const people = p.affected ? ` About ${Number(p.affected).toLocaleString()} people could be affected.` : "";
  return `${svc} ${likely ? "is likely to have problems soon." : "may have problems soon."}${people}`;
}
function pageManagerAlerts() {
  piSync();
  const list = PI.preds.filter((p) => p.alerts && p.alerts.it && p.status !== "Superseded");
  const fin = (p) => ["Mitigated", "Dismissed", "False positive"].includes(p.status);
  const open = list.filter((p) => !fin(p)), done = list.filter(fin);
  const waiting = accPending().length;
  const line = (p) => { const hi = p.cls === "Critical" || p.cls === "High"; return `<div style="display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid var(--line)">
      <span style="width:10px;height:10px;border-radius:50%;flex:none;background:${fin(p) ? "#22c55e" : hi ? "#d4443b" : "#f5b544"}"></span>
      <span style="flex:1;min-width:0;font-size:14px;font-weight:500">${esc(accPlainAlert(p))}</span>
      <span class="pill ${fin(p) ? "p-ok" : hi ? "p-warn" : "p-info"}" style="flex:none">${fin(p) ? "Fixed" : hi ? "Urgent" : "Keep an eye on it"}</span>
      <span class="note-r" style="flex:none">${rel(p.alerts.it.at)}</span></div>`; };
  return `${head("Risk alerts", "Early warnings about services that may have problems soon.", "IT engineer", `<a class="btn" href="#/approvals">${icon("usercheck")} Approval inbox${waiting ? ` (${waiting} sign-in request${waiting > 1 ? "s" : ""} waiting)` : ""}</a>`)}
    <div class="card pad"><p class="sec-title">${icon("bell")} Active alerts (${open.length})</p>${open.length ? open.map(line).join("") : `<p style="font-size:13px;color:var(--ink-muted);margin:8px 0 0">No alerts right now. Everything looks fine.</p>`}</div>
    ${done.length ? `<div class="card pad" style="margin-top:12px"><p class="sec-title">${icon("check")} Fixed (${done.length})</p>${done.map(line).join("")}</div>` : ""}`;
}

Object.assign(ICON_PATHS, { logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>' });
const CC_CONSOLE = "/crystal-clean/ops/";
function ccToConsole() { document.body.style.transition = "opacity .3s"; document.body.style.opacity = "0"; setTimeout(() => location.assign(CC_CONSOLE), 300); }
const _psSetConsole = psSet;
psSet = function (id) { if (id === "it_admin") { PS.id = "it_admin"; psSave(); ccToConsole(); return; } return _psSetConsole(id); };
if (PS.id === "it_admin") { document.documentElement.style.visibility = "hidden"; location.replace(CC_CONSOLE); }
const ACC_ACTIONS = {
  "cc-signout": () => { try { localStorage.removeItem("cc-session"); } catch (e) {} document.body.style.transition = "opacity .3s"; document.body.style.opacity = "0"; setTimeout(() => location.replace("/portal"), 300); },
  "cc-send": () => ccSend(),
  "cc-chip": (el) => ccSend(el.dataset.q),
  "cc-bell": () => { UI.ccBell = !UI.ccBell; renderTopbar(); },
  "acc-login": async () => {
    ACC.busy = "login"; ACC.login = null; render();
    const r = await accApi("login", { username: ACC.user, password: ACC.pass });
    ACC.busy = ""; ACC.login = r.ok ? r : { signed_in: false, kind: "network", error: r.error }; await accRefresh(true); render();
  },
  "acc-ticket": async () => {
    if ((ACC.text || "").trim().length < 6) { ACC.err = "Tell us briefly what is happening."; render(); return; }
    ACC.busy = "ticket"; ACC.err = ""; ACC.prog = 0; render();
    const tick = setInterval(() => { if (ACC.prog < ACC_PROG.length - 1) { ACC.prog += 1; render(); } }, 1800);
    const t0 = Date.now();
    const r = await accApi("raise_ticket", { text: ACC.text, error_id: (ACC.login && ACC.login.detail && ACC.login.detail.error_id) || "" });
    const left = 5400 - (Date.now() - t0); if (left > 0) await new Promise((x) => setTimeout(x, left));
    clearInterval(tick); ACC.prog = ACC_PROG.length;
    ACC.busy = ""; if (!r.ok) ACC.err = r.error; else ACC.text = "";
    await accRefresh(true); render();
  },
  "acc-decide": async (el) => {
    ACC.busy = "decide"; ACC.err = ""; render();
    const r = await accApi("decide", { id: el.dataset.id, decision: el.dataset.d, note: ACC.note[el.dataset.id] || "" });
    ACC.busy = ""; if (!r.ok) ACC.err = r.error;
    await accRefresh(true); render();
  },
  "acc-new": () => { ACC.hide = (ACC.status.request || {}).id; ACC.login = null; render(); },
  "acc-outage": async () => { await accApi("simulate_outage"); ACC.login = null; await accRefresh(true); render(); },
};
document.addEventListener("input", (ev) => {
  const id = ev.target.id || "";
  if (id === "acc-user") ACC.user = ev.target.value;
  else if (id === "acc-pass") ACC.pass = ev.target.value;
  else if (id === "acc-text") ACC.text = ev.target.value;
  else if (id.startsWith("acc-note-")) ACC.note[id.slice(9)] = ev.target.value;
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && (ev.target.id === "acc-pass" || ev.target.id === "acc-user") && !ACC.busy) ACC_ACTIONS["acc-login"](); });
</script>
