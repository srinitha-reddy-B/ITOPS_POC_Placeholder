<script>
"use strict";
/* -------------------------------------------------------------- incident */
const FLOW = ["Incident created", "Triage · In Progress", "AI root cause analysis", "SOP in work notes", "Resolved"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startTriage() {
  if (S.inc.state !== "New") return;
  S.inc.state = "In Progress"; S.inc.assignee = ASSIGNEE;
  S.inc.activity.unshift({ id: "a" + S.seq++, at: nowIso(), author: ASSIGNEE, kind: "field", fields: [["State", "New", "In Progress"], ["Assigned to", "", ASSIGNEE]], text: "Triage started. Assigning AURA RCA Agent to investigate." });
  flashState(); commit();
}
async function runRca() {
  if (S.inc.rca !== "idle" || S.inc.state === "Resolved") return;
  if (S.inc.state === "New") startTriage();
  S.inc.rca = "running"; S.inc.rcaStep = 0; commit();
  for (let i = 1; i < RCA_STEPS.length; i++) { await sleep(750); S.inc.rcaStep = i; commit(); }
  await sleep(600);
  const note = { id: "a" + S.seq++, at: nowIso(), author: "AURA RCA Agent", kind: "work_note", text: rcaWorkNote(), ai: true };
  S.inc.activity.unshift(note);
  S.inc.rca = "done"; S.inc.rcaStep = RCA_STEPS.length;
  addExec("rca", "INC0010048", "Success", "Generated RCA and SOP; posted to incident work notes", 4250);
  UI.snTab = "notes"; UI.freshNote = note.id; commit();
  setTimeout(() => { const el = document.getElementById("activities"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 300);
}
function resolveIncident() {
  if (S.inc.rca !== "done" || S.inc.state === "Resolved") return;
  const at = nowIso();
  S.inc.activity.unshift({ id: "a" + S.seq++, at, author: ASSIGNEE, kind: "work_note", text: APPROVAL_NOTE });
  S.inc.activity.unshift({ id: "a" + S.seq++, at, author: ASSIGNEE, kind: "field", fields: [["State", "In Progress", "Resolved"], ["Resolution code", "", "Solution provided"]] });
  S.inc.state = "Resolved";
  S.inc.resolution = { code: "Solution provided", notes: RESOLUTION_NOTES, by: ASSIGNEE, at };
  UI.snTab = "resolution"; flashState(); commit();
}
function flashState() { UI.flash = true; setTimeout(() => { UI.flash = false; if (route() === "incident-management") render(); }, 1600); }

function snField(label, value, cls = "", flash = false) {
  return `<div class="snf ${cls}"><label>${label}</label><div class="box ${flash ? "flash" : ""}">${value}</div></div>`;
}
function actItem(a) {
  const initials = a.author.split(" ").map((p) => p[0]).join("").slice(0, 2);
  const kind = a.kind === "work_note" ? "Work notes" : a.kind === "created" ? "Incident created" : "Field changes";
  return `<li class="${a.kind === "work_note" ? "wn" : ""} ${a.id === UI.freshNote ? "fresh rise" : ""}">
    <div class="ah"><span class="who"><span class="av ${a.ai ? "ai" : ""}">${a.ai ? icon("sparkles") : initials}</span>${esc(a.author)}${a.ai ? `<span class="aitag">AI agent</span>` : ""}</span><span class="when">${kind} • ${stamp(a.at)}</span></div>
    ${a.fields ? `<table><tbody>${a.fields.map(([l, f, t]) => `<tr><td style="color:#61707e">${l}</td><td style="font-weight:600">${esc(t)}</td><td style="color:#9aa5b1">${f ? "was: " + esc(f) : ""}</td></tr>`).join("")}</tbody></table>` : ""}
    ${a.text ? `<div class="txt">${esc(a.text)}</div>` : ""}</li>`;
}
function arow(n, done, title, sub, action = "") {
  return `<div class="arow ${done ? "done" : ""}"><span class="c">${done ? "✓" : n}</span><div style="min-width:0;flex:1"><div class="tt">${title}</div><div class="ss">${sub}</div></div>${action}</div>`;
}
function rcaOutput() {
  const list = (items, ol) => ol ? `<ol class="num">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : `<ul class="dots">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  const sec = (t, body) => `<div style="margin-top:12px"><div class="eyebrow" style="margin-bottom:4px">${t}</div>${body}</div>`;
  return `<div class="card pad rise">
    <div class="sec-head"><h2 class="sec-title"><span style="color:var(--accent)">${icon("sparkles")}</span> RCA output</h2>${badge("info", "Scripted POC content")}</div>
    <div style="margin-top:12px;border:1px solid #f3d3d3;background:var(--danger-soft);border-radius:10px;padding:12px 14px"><div class="eyebrow" style="color:var(--danger);margin-bottom:4px">Probable root cause</div><p style="margin:0;font-size:13px;font-weight:500;line-height:1.6">${RCA.root}</p></div>
    ${sec("Incident summary", `<p style="margin:0;font-size:12.5px;line-height:1.6;color:var(--ink-soft)">${RCA.summary}</p>`)}
    ${sec("Technical explanation", list(RCA.explanation))}
    ${sec("Diagnosis performed", list(RCA.diagnosis, true))}
    ${sec("Recommended resolution", list(RCA.resolution, true))}
    ${sec("Preventive measures", list(RCA.prevention))}
    <div style="margin-top:12px;border:1px solid #cfcff3;background:#f5f5fd;border-radius:10px;padding:12px 14px"><div class="eyebrow" style="color:var(--brand);display:flex;gap:6px;align-items:center">${icon("file")} SOP · ${RCA.sopTitle}</div><div class="mono" style="font-size:11px;color:var(--ink-muted);margin:2px 0 6px">${RCA.sopId}</div>${list(RCA.sop, true)}</div>
  </div>`;
}

function pageIncident() {
  const inc = S.inc;
  const primary = { ...INC, state: inc.state, assignee: inc.assignee };
  const list = [primary, ...OTHER_INCIDENTS];
  const selNum = UI.snSelected || INC.number;
  const cur = list.find((x) => x.number === selNum) || primary;
  const isPrimary = cur.number === INC.number;
  const step = inc.state === "Resolved" ? 5 : inc.rca === "done" ? 4 : inc.state === "In Progress" ? 2 : 1;
  const activity = isPrimary ? inc.activity : [{ id: cur.number, at: inc.opened, author: cur.caller, kind: "created", fields: [["State", "", "New"]], text: "Incident created." }];
  const tab = UI.snTab;
  const res = isPrimary ? inc.resolution : null;
  const curFull = isPrimary ? primary : { ...INC, ...cur, description: "Background incident in the queue (read-only in this POC).", ci: "—", environment: "—", channel: "Self-service", category: "—", subcategory: "—", impact: "—", urgency: "—" };

  const flowHtml = `<ol class="flow">${FLOW.map((f, i) => `<li><span class="st ${i < step ? "done" : i === step ? "cur" : ""}"><span class="c">${i < step ? "✓" : i + 1}</span>${f}</span>${i < FLOW.length - 1 ? `<span class="bar"></span>` : ""}</li>`).join("")}</ol>`;

  const tabBody = tab === "notes"
    ? `<div class="snf top"><label>Work notes</label><div class="area" style="background:#fffbe6;color:#9aa5b1;min-height:48px">Work notes (internal)</div></div>
       <div style="display:flex;gap:12px;margin-top:16px"><div style="width:130px;flex:none;text-align:right;padding-top:8px;font-size:12.5px;font-weight:600;color:#61707e">Activities: ${activity.length}</div><ul class="act">${activity.map(actItem).join("")}</ul></div>`
    : tab === "related"
      ? `<table style="width:100%;font-size:12.5px;border-collapse:collapse">${[["Knowledge / SOP", isPrimary && inc.rca === "done" ? `${RCA.sopId} · ${RCA.sopTitle} (in work notes)` : "(none)"], ["Configuration item", curFull.ci], ["Problem", "(none)"], ["Change request", "(none)"]].map(([k, v]) => `<tr style="border-bottom:1px solid #eceff1"><td style="width:180px;padding:8px 0;color:#61707e">${k}</td><td style="padding:8px 0;${v !== "(none)" ? "color:#1f6fbd" : ""}">${esc(v)}</td></tr>`).join("")}</table>`
      : res
        ? `<div class="snform" style="padding:0">${snField("Resolution code", res.code)}${snField("Resolved by", res.by)}${snField("Resolved", stamp(res.at))}<div></div><div class="snf top wide"><label>Resolution notes</label><div class="area">${esc(res.notes)}</div></div></div>`
        : `<p style="margin:0;font-size:12.5px;color:#9aa5b1">Not resolved yet.</p>`;

  const sn = `<div class="sn">
    <div class="sn-bar"><div style="display:flex;align-items:center;gap:16px;min-width:0"><span class="sn-logo">service<b>now</b></span><span class="sn-chip hide-sm">Incident - ${cur.number}</span></div>
      <div style="display:flex;align-items:center;gap:12px;color:rgba(255,255,255,.85)"><span class="sn-inst hide-sm">point32health-poc · mock instance</span>${icon("search")}${icon("bell")}${icon("usercircle")}</div></div>
    <div class="sn-head"><div style="display:flex;align-items:center;gap:12px"><span class="ttl">Incidents</span><span class="crumb hide-sm">All &gt; Active = true &gt; Company = Crystal Clean</span></div><button class="sn-btn">New</button></div>
    <div style="overflow-x:auto"><table class="snt"><thead><tr>${["Number", "Short description", "Caller", "Priority", "State", "Assignment group", "Assigned to"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>
      ${list.map((r) => `<tr class="${r.number === cur.number ? "sel" : ""}"><td><button class="snlink" data-act="snopen" data-n="${r.number}">${r.number}</button></td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">${esc(r.short)}</td><td>${r.caller}</td><td>${r.priority}</td><td><span class="sdot s-${r.state.replace(" ", "")}"></span>${r.state}</td><td>${r.group}</td><td>${r.assignee || '<span style="color:#9aa5b1">(empty)</span>'}</td></tr>`).join("")}
    </tbody></table></div>
    <div style="border-top:6px solid #eef0f2">
      <div class="sn-head" style="padding:8px 12px"><div style="display:flex;align-items:center;gap:8px"><span style="color:#61707e">${icon("back")}</span><span style="line-height:1.2"><span style="display:block;font-size:12px;color:#61707e">Incident</span><span style="display:block;font-size:14px;font-weight:600">${cur.number}</span></span></div>
        <div style="display:flex;align-items:center;gap:6px"><span style="color:#61707e">${icon("clip")}</span><button class="sn-btn">Follow</button><button class="sn-btn blue">Update</button><button class="sn-btn" data-act="resolve" ${isPrimary && inc.rca === "done" && inc.state !== "Resolved" ? "" : "disabled"}>Resolve</button></div></div>
      <div class="snform">
        ${snField("Number", cur.number)}${snField("Channel", curFull.channel)}
        ${snField("Caller", curFull.caller)}${snField("State", `<span class="sdot s-${cur.state.replace(" ", "")}"></span><b>${cur.state}</b>`, "", isPrimary && UI.flash)}
        ${snField("Category", curFull.category)}${snField("Impact", curFull.impact)}
        ${snField("Subcategory", curFull.subcategory)}${snField("Urgency", curFull.urgency)}
        ${snField("Service", curFull.service)}${snField("Priority", `<b style="color:#b42318">${cur.priority}</b>`)}
        ${snField("Configuration item", curFull.ci)}${snField("Assignment group", cur.group)}
        ${snField("Environment", curFull.environment)}${snField("Assigned to", cur.assignee || '<span style="color:#9aa5b1">(empty)</span>', "", isPrimary && UI.flash)}
        ${snField("Opened", stamp(inc.opened))}<div></div>
        ${snField("Short description", esc(cur.short), "wide")}
        <div class="snf top wide"><label>Description</label><div class="area">${esc(curFull.description)}</div></div>
      </div>
      <div id="activities" style="border-top:1px solid #d5d9dd;scroll-margin-top:16px">
        <div class="sntabs">${[["notes", "Notes"], ["related", "Related Records"], ["resolution", "Resolution Information"]].map(([k, l]) => `<button class="sntab ${tab === k ? "on" : ""}" data-act="sntab" data-t="${k}">${l}${k === "resolution" && res ? ' <span class="sdot s-Resolved" style="margin:0 0 0 4px"></span>' : ""}</button>`).join("")}</div>
        <div style="padding:16px 20px">${tabBody}</div>
      </div>
    </div></div>`;

  let panel;
  if (!isPrimary) {
    panel = `<div style="margin-top:16px;border:1px solid var(--line);background:var(--sunken);border-radius:10px;padding:12px 14px;font-size:12.5px;line-height:1.6;color:var(--ink-soft)">This POC scopes the RCA Agent to <span class="mono-chip">INC0010048</span> (Payment API, Production).<div style="margin-top:10px"><button class="btn" data-act="snopen" data-n="INC0010048">Open INC0010048</button></div></div>`;
  } else {
    const steps = inc.rca !== "idle" ? `<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--line)"><div class="eyebrow" style="margin-bottom:6px">Agent activity</div><ol class="agent-steps">${RCA_STEPS.map((s, i) => { const d = inc.rca === "done" || i < inc.rcaStep; const a = inc.rca === "running" && i === inc.rcaStep; return `<li class="${d ? "done" : a ? "act" : ""}">${icon(d ? "check" : a ? "loader" : "circle", a ? "spin" : "")}${s}</li>`; }).join("")}</ol></div>` : "";
    const posted = inc.rca === "done" ? (() => { const n = inc.activity.find((x) => x.ai); return `<button data-act="toacts" style="margin-top:12px;width:100%;display:flex;justify-content:space-between;gap:8px;border:1px solid #cde9d5;background:var(--ok-soft);color:var(--ok);border-radius:9px;padding:8px 12px;font-size:12px;text-align:left"><span style="display:flex;align-items:center;gap:6px">${icon("down")} Posted to INC0010048 · Activities → Work notes</span><span class="mono" style="font-size:11px">${n ? stamp(n.at) : ""}</span></button>`; })() : "";
    panel = `<div style="margin-top:16px">
      ${arow(1, inc.state !== "New", "Triage: move to In Progress", inc.state === "New" ? "Assign to Application Development · Arya Hajarha" : "Assigned to " + (inc.assignee || ASSIGNEE), inc.state === "New" ? `<button class="btn" data-act="triage">Start triage</button>` : "")}
      ${arow(2, inc.rca === "done", "Run RCA Agent", inc.rca === "done" ? "RCA and SOP posted to work notes" : "Analyse incident, CI, scale events and traces", inc.rca === "idle" && inc.state !== "Resolved" ? `<button class="btn primary" data-act="rca">${icon("play")} Run RCA Agent</button>` : inc.rca === "running" ? `<span style="color:var(--brand)">${icon("loader", "spin")}</span>` : "")}
      ${arow(3, inc.state === "Resolved", "Approve resolution and resolve", inc.state === "Resolved" ? "Resolved by " + ASSIGNEE : "Engineer approval required for production changes", inc.rca === "done" && inc.state !== "Resolved" ? `<button class="btn primary" data-act="resolve">${icon("usercheck")} Approve &amp; resolve</button>` : "")}
    </div>${steps}${posted}`;
  }
  const agentBadge = !isPrimary ? badge("info", "Not in scope") : inc.rca === "running" ? badge("running", "Analysing") : inc.rca === "done" ? badge("good", "RCA posted") : badge("info", "Ready");

  return `${head("Incident Management", "Automated root cause analysis and SOP generation. The AURA RCA Agent investigates the ServiceNow incident, posts its RCA and SOP to the incident work notes, and the engineer approves the resolution.", "AI use case · RCA Agent")}
  ${strip("When an incident occurs, engineers investigate, find the root cause, document their findings and look up the right procedure. For a production API this is hours of manual effort.", "The RCA Agent analyses the incident, identifies the probable root cause, and writes the diagnosis, resolution, prevention guidance and SOP straight into the ServiceNow work notes.")}
  <div class="card" style="margin-bottom:16px;padding:12px 20px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px">
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;min-width:0"><span class="eyebrow">Workflow · INC0010048</span>${flowHtml}</div>
    ${inc.state === "Resolved" ? badge("good", "New → In Progress → Resolved complete") : ""}
  </div>
  <div class="split">
    <div style="min-width:0">${sn}</div>
    <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
      <div class="card pad"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div style="display:flex;gap:10px;align-items:center"><span class="agentico">${icon("bot")}</span><div><h2 style="margin:0;font-size:14px">AURA RCA Agent</h2><p style="margin:0;font-size:11.5px;color:var(--ink-muted)">ServiceNow RCA Agent · simulated</p></div></div>${agentBadge}</div>${panel}</div>
      ${isPrimary && inc.rca === "done" ? rcaOutput() : ""}
      ${isPrimary && res ? `<div class="card pad rise"><h2 class="sec-title"><span style="color:var(--ok)">${icon("shield")}</span> Resolution</h2><dl class="kv" style="margin-top:6px">${[["State", "Resolved"], ["Resolution code", res.code], ["Approved & resolved by", res.by], ["Resolved at", stamp(res.at)]].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl><p style="margin:8px 0 0;font-size:12.5px;line-height:1.6;color:var(--ink-soft)">${res.notes}</p></div>` : ""}
    </div>
  </div>
  ${simnote("This standalone HTML version runs the INC0010048 scenario on simulated data. The full POC app (localhost) connects to a live ServiceNow developer instance and generates the RCA with an LLM; here nothing is sent anywhere.")}`;
}

/* ----------------------------------------------------------- control tower */
function pageTower() {
  const session = S.executions.slice(0, Math.max(0, S.executions.length - SEED_EXEC));
  const approved = S.approvals.filter((a) => a.status === "Approved").length;
  const pending = S.approvals.filter((a) => a.status === "Pending");
  const total = BASELINE.total + session.length;
  const success = BASELINE.success + session.filter((e) => e.status === "Success").length + approved;
  const failed = BASELINE.failed + session.filter((e) => e.status === "Failed").length;
  const rcaRan = S.executions.some((e) => e.record === "INC0010048");
  const history = (rcaRan ? [] : [{ id: "—", agent: "rca", record: "INC0010048", at: S.inc.opened, ms: 0, status: S.inc.rca === "running" ? "Running" : "Queued", action: S.inc.rca === "running" ? "Analysing Payment API HTTP 504 incident" : "Waiting for triage; RCA starts when the incident is In Progress" }]).concat(S.executions).slice(0, 12);
  const color = Object.fromEntries(AGENTS.map((a) => [a.id, a.color]));
  const maxDay = Math.max(...WEEKLY.map((d) => d.asset + d.rca + d.hr));
  const execKind = (s) => (s === "Success" ? "good" : s === "Failed" ? "critical" : s === "Running" ? "running" : s === "Queued" ? "info" : "warning");
  const tile = (ic, label, v, sub, tone) => `<div class="card tile"><div class="h"><span style="color:${tone || "var(--ink-muted)"}">${icon(ic)}</span><span class="eyebrow">${label}</span></div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  const pct = (n) => Math.round((n / total) * 1000) / 10;

  return `${head("AI Control Tower", "One place to monitor the three POC agents: what they did, whether it worked, which actions are waiting for a human, and which governance controls apply.", "Mock monitoring dashboard", badge("warning", "Illustrative demo values"))}
  <div class="grid g6" style="gap:12px">
    ${tile("bot", "Total AI agents", AGENTS.length, "Registered in this POC", "var(--brand)")}
    ${tile("radar", "Active agents", AGENTS.length, "All monitored", "var(--ok)")}
    ${tile("activity", "Total executions", total, "Last 7 days")}
    ${tile("check", "Successful", success, `${Math.round((success / total) * 100)}% success rate`, "var(--ok)")}
    ${tile("hourglass", "Pending human reviews", pending.length, "Awaiting approval", "var(--warn)")}
    ${tile("xcircle", "Failed executions", failed, "Escalated to engineers", "var(--danger)")}
  </div>
  <div class="grid g3" style="gap:12px;margin-top:16px">${AGENTS.map((a) => {
    const runs = WEEKLY.reduce((n, d) => n + d[a.id], 0) + session.filter((e) => e.agent === a.id).length;
    const fails = S.executions.filter((e) => e.agent === a.id && e.status === "Failed").length;
    const last = (S.executions.find((e) => e.agent === a.id) || {}).at;
    return `<div class="card agentcard">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div style="display:flex;gap:10px;align-items:center"><span class="ico" style="background:${a.color}">${icon(a.icon)}</span><div><h3 style="margin:0;font-size:13.5px">${a.name}</h3><p style="margin:0;font-size:11.5px;color:var(--ink-muted)">${a.module}</p></div></div>${badge("good", "Active")}</div>
      <p style="margin:12px 0 0;font-size:12.5px;line-height:1.6;color:var(--ink-soft)">${a.fn}</p>
      <dl><div><dt>Runs · 7d</dt><dd>${runs}</dd></div><div><dt>Success</dt><dd>${Math.round(((runs - fails) / Math.max(1, runs)) * 1000) / 10}%</dd></div><div><dt>Last run</dt><dd style="font-size:12.5px;font-weight:500">${last ? rel(last) : "—"}</dd></div></dl>
      <div class="meta"><div><b>Owner:</b> ${a.owner}</div><div><b>Scope:</b> ${a.scope}</div><div><b>Control:</b> ${a.writes}</div></div>
      <a href="${a.href}" style="margin-top:12px;display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:500;color:var(--brand)">Open use case ${icon("arrow")}</a>
    </div>`; }).join("")}</div>
  <div class="split" style="gap:12px;margin-top:16px;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)">
    <div class="card pad"><div class="sec-head"><h2 class="sec-title">${icon("barchart")} Executions · last 7 days</h2><span class="note-r">By agent</span></div>
      <div class="bars">${WEEKLY.map((d) => { const sum = d.asset + d.rca + d.hr; return `<div class="col"><span style="font-size:10.5px;color:var(--ink-muted)">${sum}</span><div class="stack" style="height:${(sum / maxDay) * 110}px" title="${d.day}: ${sum} executions">${["asset", "rca", "hr"].map((k) => `<div style="height:${(d[k] / sum) * 100}%;background:${color[k]}"></div>`).join("")}</div><span style="font-size:11px;color:var(--ink-muted)">${d.day}</span></div>`; }).join("")}</div>
      <div class="legend">${AGENTS.map((a) => `<span><i style="background:${a.color}"></i>${a.name}</span>`).join("")}</div>
    </div>
    <div class="card pad"><div class="sec-head"><h2 class="sec-title">${icon("activity")} Execution outcomes</h2><span class="note-r">${total} executions</span></div>
      <div style="display:flex;height:12px;border-radius:999px;overflow:hidden;margin-top:16px"><div style="width:${(success / total) * 100}%;background:var(--ok-dot)"></div><div style="width:${(pending.length / total) * 100}%;background:#f5b544"></div><div style="width:${(failed / total) * 100}%;background:#f04438"></div></div>
      <ul style="list-style:none;margin:16px 0 0;padding:0;font-size:12.5px">${[["Successful", success, "var(--ok-dot)"], ["Pending human review", pending.length, "#f5b544"], ["Failed", failed, "#f04438"]].map(([l, n, c]) => `<li style="display:flex;justify-content:space-between;margin:8px 0"><span style="display:flex;align-items:center;gap:8px;color:var(--ink-soft)"><i style="width:9px;height:9px;border-radius:50%;background:${c};display:inline-block"></i>${l}</span><b>${n} <span style="font-weight:400;color:var(--ink-muted)">· ${pct(n)}%</span></b></li>`).join("")}</ul>
    </div>
  </div>
  <div class="card pad" style="margin-top:16px"><div class="sec-head"><h2 class="sec-title">${icon("history")} Execution history</h2><span class="note-r">Newest first · includes this session's demo activity</span></div>
    <div class="tbl-wrap" style="margin:12px -20px 0"><table class="t" style="min-width:820px"><thead><tr>${["Agent", "Execution ID", "Related record", "Execution time", "Status", "Action performed"].map((h) => `<th style="padding-left:20px">${h}</th>`).join("")}</tr></thead><tbody>
      ${history.map((e) => `<tr style="${e.record === "INC0010048" ? "background:#f5f5fd" : ""}"><td style="padding-left:20px;white-space:nowrap"><span style="display:inline-flex;align-items:center;gap:8px"><i style="width:8px;height:8px;border-radius:50%;background:${color[e.agent]};display:inline-block"></i>${agentName(e.agent)}</span></td><td style="padding-left:20px"><span class="mono-chip">${e.id}</span></td><td class="mono" style="padding-left:20px;font-size:11.5px;color:var(--brand)">${e.record}</td><td style="padding-left:20px;white-space:nowrap;color:var(--ink-soft)">${rel(e.at)}${e.ms ? `<span style="color:var(--ink-faint)"> · ${(e.ms / 1000).toFixed(1)} s</span>` : ""}</td><td style="padding-left:20px">${badge(execKind(e.status), e.status)}</td><td style="padding-left:20px;color:var(--ink-soft)">${e.action}</td></tr>`).join("")}
    </tbody></table></div>
  </div>
  <div class="split" style="gap:12px;margin-top:16px;grid-template-columns:minmax(0,1fr) minmax(0,1.5fr)">
    <div class="card pad"><h2 class="sec-title">${icon("shield")} Security &amp; governance</h2>
      <ul style="list-style:none;margin:12px 0 0;padding:0">${GOVERNANCE.map((g) => `<li style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)"><div><div style="font-size:13px;font-weight:500">${g.label}</div><div style="font-size:11.5px;color:var(--ink-muted)">${g.note}</div></div>${badge(g.label === "Human approval" ? "warning" : "good", g.value)}</li>`).join("")}</ul>
    </div>
    <div class="card pad"><div class="sec-head"><h2 class="sec-title">${icon("usercheck")} Human approval tracking</h2><span class="note-r">${pending.length} pending</span></div>
      <ul style="list-style:none;margin:12px 0 0;padding:0">${S.approvals.map((a) => `<li style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)">
        <div style="flex:1;min-width:0"><div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12.5px"><span class="mono-chip">${a.id}</span><span class="mono" style="font-size:11.5px;color:var(--brand)">${a.record}</span><span style="color:var(--ink-muted)">· ${agentName(a.agent)}</span></div><p style="margin:2px 0 0;font-size:13px">${a.action}</p><p style="margin:2px 0 0;font-size:11px;color:var(--ink-muted)">${rel(a.at)} · approver: ${a.approver}</p></div>
        ${a.status === "Pending" ? `<div style="display:flex;gap:6px"><button class="btn danger" data-act="decide" data-id="${a.id}" data-d="Rejected">Reject</button><button class="btn primary" data-act="decide" data-id="${a.id}" data-d="Approved">Approve</button></div>` : badge(a.status === "Approved" ? "good" : "critical", a.status)}
      </li>`).join("")}</ul>
    </div>
  </div>
  ${simnote("All metrics, executions and approvals on this page are simulated for the Crystal Clean proof of concept. They are illustrative demo values, not Crystal Clean operational data, and the dashboard is not connected to any monitoring service.")}`;
}

/* ---------------------------------------------------------------- router */
const PAGES = { "": pageOverview, "asset-management": pageAssets, "incident-management": pageIncident, "hr-services": pageHR, "ai-control-tower": pageTower };
let lastRoute = null;
function render() {
  const r = route();
  const main = document.getElementById("main");
  const keep = r === lastRoute ? main.scrollTop : 0;
  const chatScroll = document.getElementById("chatbox");
  const chatAtBottom = !chatScroll || chatScroll.scrollTop + chatScroll.clientHeight >= chatScroll.scrollHeight - 20;
  const focusedChat = document.activeElement && document.activeElement.id === "chatinput";
  const focusedSearch = document.activeElement && document.activeElement.id === "assetSearch";
  renderTopbar(); renderSidebar();
  main.innerHTML = `<div class="page">${(PAGES[r] || pageOverview)()}</div>`;
  main.scrollTop = keep;
  lastRoute = r;
  const cb = document.getElementById("chatbox");
  if (cb && chatAtBottom) cb.scrollTop = cb.scrollHeight;
  if (focusedChat) { const i = document.getElementById("chatinput"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  if (focusedSearch) { const i = document.getElementById("assetSearch"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
}

document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  if (act === "reset") {
    if (!UI.resetArmed) { UI.resetArmed = true; renderTopbar(); setTimeout(() => { UI.resetArmed = false; renderTopbar(); }, 3000); return; }
    S = initialState(); UI.resetArmed = false; UI.assetShown = {}; UI.snSelected = null; UI.snTab = "notes"; UI.freshNote = null; commit(); return;
  }
  if (act === "collapse") { UI.collapsed = !UI.collapsed; renderSidebar(); return; }
  if (act === "asset") { UI.selAsset = el.dataset.id; render(); return; }
  if (act === "analyse") { runAssetAnalysis(); return; }
  if (act === "replace") { draftReplacement(); return; }
  if (act === "task") { S.hr.done[el.dataset.id] = !S.hr.done[el.dataset.id]; commit(); return; }
  if (act === "ask") { hrAsk(el.dataset.q); return; }
  if (act === "clearchat") { S.hr.chat = []; commit(); return; }
  if (act === "snopen") { UI.snSelected = el.dataset.n === "INC0010048" ? null : el.dataset.n; UI.snTab = "notes"; render(); return; }
  if (act === "sntab") { UI.snTab = el.dataset.t; render(); return; }
  if (act === "triage") { startTriage(); return; }
  if (act === "rca") { runRca(); return; }
  if (act === "resolve") { resolveIncident(); return; }
  if (act === "toacts") { UI.snTab = "notes"; render(); const a = document.getElementById("activities"); if (a) a.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (act === "decide") { const a = S.approvals.find((x) => x.id === el.dataset.id); if (a) a.status = el.dataset.d; commit(); return; }
});
document.addEventListener("input", (ev) => {
  if (ev.target.id === "chatinput") UI.chatDraft = ev.target.value;
  if (ev.target.id === "assetSearch") { UI.assetQuery = ev.target.value; render(); }
});
document.addEventListener("submit", (ev) => {
  if (ev.target.id === "chatform") { ev.preventDefault(); hrAsk(UI.chatDraft); }
});
window.addEventListener("hashchange", render);
render();
</script>
</body>
</html>
