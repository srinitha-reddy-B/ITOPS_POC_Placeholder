<style>
.wb-mode{display:inline-flex;border:1px solid var(--line-strong);border-radius:9px;overflow:hidden;background:var(--surface)}
.wb-mode button{border:0;background:none;padding:5px 10px;font:inherit;font-size:11.5px;color:var(--ink-soft);cursor:pointer;white-space:nowrap}
.wb-mode button.on{background:var(--ink);color:#fff}
.wb-mode button:disabled{color:var(--ink-faint);cursor:not-allowed}
@media (max-width:760px){.wb-mode{display:none}}
.wb-ucs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
@media (max-width:1180px){.wb-ucs{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:620px){.wb-ucs{grid-template-columns:1fr}}
.wb-uc{display:flex;flex-direction:column;gap:4px;text-align:left;border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:10px 12px;font:inherit;cursor:pointer;color:inherit;min-width:0}
.wb-uc:hover{border-color:var(--line-strong)} .wb-uc.on{border-color:var(--brand);background:var(--brand-soft)}
.wb-uc .n{font-size:12.5px;font-weight:600;line-height:1.3} .wb-uc .c{font-size:11px;color:var(--ink-muted)}
.wb-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.wb-filters .sel{width:auto;min-width:150px;height:32px;font-size:12.5px}
.wb-split{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:16px;align-items:start}
@media (max-width:1180px){.wb-split{grid-template-columns:1fr}}
.wb-flow{display:flex;flex-direction:column;gap:6px}
.wb-stage{display:grid;grid-template-columns:150px minmax(0,1fr);gap:10px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--surface)}
@media (max-width:620px){.wb-stage{grid-template-columns:1fr}}
.wb-stage.cur{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)} .wb-stage.done{background:#fbfefc}
.wb-sh{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;min-width:0}
.wb-sh .num{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:10.5px;background:var(--hover);color:var(--ink-soft);flex:none}
.wb-stage.done .wb-sh .num{background:var(--ok);color:#fff} .wb-stage.cur .wb-sh .num{background:var(--brand);color:#fff}
.wb-sh .loop{font-size:10px;font-weight:500;color:var(--brand);background:var(--brand-soft);border-radius:99px;padding:1px 6px;white-space:nowrap}
.wb-nodes{display:flex;flex-wrap:wrap;align-items:center;gap:4px}
.wb-arrow{color:var(--ink-faint);font-size:12px}
.wb-node{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface);padding:5px 8px;font:inherit;font-size:11.5px;cursor:pointer;color:var(--ink);max-width:100%;transition:border-color .2s,background .2s}
.wb-node svg{width:13px;height:13px;flex:none}
.wb-node .st{width:7px;height:7px;border-radius:50%;background:var(--ink-faint);flex:none}
.wb-node.s-done .st{background:var(--ok-dot)} .wb-node.s-running{border-color:var(--brand);background:var(--brand-soft)} .wb-node.s-running .st{background:var(--brand);animation:wbpulse 1s infinite}
.wb-node.s-waiting{border-color:#f0c78a;background:var(--warn-soft)} .wb-node.s-waiting .st{background:var(--warn)}
.wb-node.s-attention{border-color:#f0c78a;background:var(--warn-soft)} .wb-node.s-attention .st{background:var(--warn)}
.wb-node.s-failed{border-color:#f3c4c4;background:var(--danger-soft)} .wb-node.s-failed .st{background:var(--danger)}
.wb-node.s-pending{color:var(--ink-muted);border-style:dashed}
.wb-node.sel{outline:2px solid var(--ink);outline-offset:1px}
.wb-node.human{border-radius:99px}
.wb-node .x{font-size:10px;color:var(--ink-muted)}
@keyframes wbpulse{50%{opacity:.3}}
.wb-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:11px;color:var(--ink-muted)}
.wb-legend span{display:inline-flex;align-items:center;gap:5px} .wb-legend i{width:7px;height:7px;border-radius:50%;display:inline-block}
.wb-det h3{margin:0;font-size:14px;font-weight:600}
.wb-sect{margin-top:14px} .wb-sect>.eyebrow{display:block;margin-bottom:6px}
.wb-tool{border:1px solid var(--line);border-radius:9px;padding:8px 10px;margin-bottom:6px;font-size:12px}
.wb-tool .h{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-weight:500}
.wb-tool .d{color:var(--ink-soft);margin-top:3px;line-height:1.5}
.wb-src{font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;border-radius:4px;padding:1px 5px}
.wb-src.live{background:var(--ok-soft);color:var(--ok)} .wb-src.simulated{background:var(--warn-soft);color:var(--warn)} .wb-src.rules,.wb-src.local{background:var(--hover);color:var(--ink-soft)}
.wb-src.llm{background:var(--brand-soft);color:var(--brand)} .wb-src.scripted{background:var(--warn-soft);color:var(--warn)} .wb-src.human{background:var(--info-soft);color:var(--info)} .wb-src.tools{background:var(--hover);color:var(--ink-soft)}
.wb-ul{margin:0;padding-left:18px;font-size:12.5px;line-height:1.6} .wb-ul li{margin:2px 0}
.wb-pre{white-space:pre-wrap;word-break:break-word;background:var(--sunken);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-family:var(--mono);font-size:11px;line-height:1.5;max-height:280px;overflow:auto;margin:6px 0 0}
details.wb-raw summary{cursor:pointer;font-size:11.5px;color:var(--ink-muted);margin-top:8px}
.wb-hyp{border:1px solid var(--line);border-radius:9px;padding:8px 10px;margin-bottom:6px}
.wb-hyp .t{font-size:12.5px;font-weight:600} .wb-hyp .d{font-size:12px;color:var(--ink-soft);line-height:1.55;margin-top:2px}
.wb-bar{height:6px;border-radius:99px;background:var(--hover);overflow:hidden;margin-top:6px} .wb-bar i{display:block;height:100%;background:var(--brand)}
.wb-chip{display:inline-block;font-family:var(--mono);font-size:10.5px;background:var(--sunken);border:1px solid var(--line);border-radius:4px;padding:0 4px;margin:1px 2px 1px 0}
.wb-gate{border-color:#f0c78a;background:#fffdf8}
.wb-gate.err{border-color:#f3c4c4;background:#fffafa} .wb-gate.ok{border-color:#cde9d5;background:#fbfefc}
.wb-ctrl{display:flex;flex-wrap:wrap;gap:6px}
.wb-doc{border:1px solid var(--line);border-radius:10px;padding:18px 22px;background:#fff}
.wb-doc h4{margin:14px 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-muted)} .wb-doc h4:first-child{margin-top:0}
.wb-doc p{margin:0;font-size:13px;line-height:1.6}
.wb-steps{list-style:none;margin:0;padding:0;counter-reset:s}
.wb-steps li{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:8px;align-items:start;padding:8px 0;border-bottom:1px solid var(--line);font-size:12.5px}
.wb-steps li:last-child{border-bottom:0}
.wb-steps .n{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:600;background:var(--hover)}
.wb-steps .e{color:var(--ink-muted);font-size:11.5px;margin-top:2px}
.wb-x-approved .n{background:var(--info-soft);color:var(--info)} .wb-x-executed .n{background:var(--ok);color:#fff} .wb-x-manual .n{background:var(--info);color:#fff} .wb-x-failed .n{background:var(--danger);color:#fff} .wb-x-running .n{background:var(--brand);color:#fff}
.wb-ev{display:grid;grid-template-columns:110px minmax(0,1fr);gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:12px} .wb-ev:last-child{border-bottom:0}
.wb-flash{border:1px solid #f3c4c4;background:var(--danger-soft);color:var(--danger);border-radius:9px;padding:8px 12px;font-size:12.5px;margin-bottom:12px}
.wb-prog{display:grid;grid-template-columns:repeat(8,1fr);gap:3px;margin-top:8px} .wb-prog i{height:5px;border-radius:99px;background:var(--hover)} .wb-prog i.d{background:var(--ok-dot)} .wb-prog i.c{background:var(--brand)}
.wb-metric{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;font-size:13px}
.wb-metric b{font-size:22px;font-variant-numeric:tabular-nums}
@media (max-width:1100px){.wb-pill-top{display:none!important}}
.wb-fdform label{display:block;font-size:12px;font-weight:500;margin:12px 0 5px}
</style>
<script>
"use strict";
/* ------------------------------------------------------- UI helpers */
Object.assign(UI, { wbSel: null, wbTab: "inv", wbDraft: {}, fd: { uc: "CLM", service: "", title: "", description: "", impact: "team", urgency: "today", busy: false, err: "" } });
const wbArr = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);
const wbTxt = (x) => (typeof x === "string" ? x : x == null ? "" : typeof x === "object" ? Object.values(x).filter((v) => typeof v !== "object").join(" · ") : String(x));
const wbUl = (arr) => (wbArr(arr).length ? `<ul class="wb-ul">${wbArr(arr).map((x) => `<li>${esc(wbTxt(x))}</li>`).join("")}</ul>` : `<p class="muted" style="margin:0;font-size:12px;color:var(--ink-muted)">None.</p>`);
const wbKv = (pairs) => `<dl class="kv">${pairs.filter((p) => p[1] !== undefined && p[1] !== null && p[1] !== "").map(([k, v, raw]) => `<div><dt>${esc(k)}</dt><dd>${raw ? v : esc(wbTxt(v))}</dd></div>`).join("")}</dl>`;
const wbChips = (ids) => wbArr(ids).map((i) => `<span class="wb-chip">${esc(wbTxt(i))}</span>`).join("");
const wbRaw = (o, label = "Raw JSON") => (o ? `<details class="wb-raw"><summary>${label}</summary><pre class="wb-pre">${esc(JSON.stringify(o, null, 2))}</pre></details>` : "");
const wbSec = (title, body) => `<div class="wb-sect"><span class="eyebrow">${title}</span>${body}</div>`;
function wbChecksHtml(checks) {
  const ic = { pass: "check", warn: "alert", fail: "xcircle" };
  return `<ul class="checks">${wbArr(checks).map((c) => { const st = c.status || c.result || "pass"; return `<li><span class="ck-${st}">${icon(ic[st] || "info")}</span><div><div class="t">${esc(c.label || c.name || c.check)}</div><div class="d">${esc(c.detail || "")}</div></div></li>`; }).join("")}</ul>`;
}
const wbSrcTag = (s) => `<span class="wb-src ${esc(s)}">${esc({ llm: "Live LLM", scripted: "Scripted demo", human: "Human", tools: "Tools", live: "Live", simulated: "Simulated", rules: "Rules", local: "Local" }[s] || s)}</span>`;
const wbDur = (ms) => (ms == null ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const wbT = (iso) => (iso ? stamp(iso).slice(11) : "");

function wbModeSwitch() {
  const m = wbMode();
  const why = WBL.available ? "Real LLM calls and ServiceNow tools through the POC backend" : WBL.reason || "Checking the backend…";
  return `<span class="wb-mode hide-sm" role="group" aria-label="Operating mode"><button data-act="wb-mode" data-m="demo" class="${m === "demo" ? "on" : ""}" title="Scripted, labelled outputs; no external calls">Controlled Demo</button><button data-act="wb-mode" data-m="live" class="${m === "live" ? "on" : ""}" ${WBL.available ? "" : "disabled"} title="${esc(why)}">Live Agent</button></span>`;
}
function wbModePill() {
  return ""; // the mode tag was removed from the UI (the app always runs the scripted demo)
  if (wbMode() === "live") { const s = WBL.status; return `<span class="pill p-ok hide-sm wb-pill-top" title="${esc(`LLM: ${s.llm.provider} ${s.llm.model}. ServiceNow: ${s.servicenow.configured ? s.servicenow.instance : "not configured"}`)}"><span class="d"></span>Live Agent Mode</span>`; }
  return `<span class="pill p-warn hide-sm wb-pill-top" title="Scripted agent outputs from synthetic data; no LLM or ServiceNow calls"><span class="d"></span>Controlled Demo Mode</span>`;
}
function wbFootText() {
  if (wbMode() === "live") { const s = WBL.status; return `Live Agent Mode · ${esc(s.llm.provider)} ${esc(s.llm.model)} · ServiceNow ${s.servicenow.configured ? "POC instance" : "not configured"} · telemetry & execution simulated`; }
  return "Controlled Demo Mode · synthetic data, scripted agents · no live systems";
}
function wbRunBadge(run) { return run ? (run.mode === "live" ? `<span class="pill p-ok"><span class="d"></span>Live agents</span>` : `<span class="pill p-warn"><span class="d"></span>Demo run (scripted)</span>`) : ""; }

/* ---------------------------------------------------- command center */
function pageWorkbench() {
  const parts = route().split("/");
  if (parts[1]) return pageWbIncident(decodeURIComponent(parts[1]));
  if ((WB.domain || "incident") !== "incident") return wbPageRequests(WB.domain);
  const uc = wbUseCase(WB.useCase);
  let list = wbIncidentsFor(uc.id);
  if (WB.fPri) list = list.filter((i) => i.priority === WB.fPri);
  if (WB.fStatus) list = list.filter((i) => wbStatusOf(i).label === WB.fStatus);
  const all = wbIncidentsFor(uc.id);
  const pri = ["1 - Critical", "2 - High", "3 - Moderate", "4 - Low"];
  const sts = [...new Set(Object.values(WB_STATUS).map((s) => s.label))];
  const priKind = (p) => (p.startsWith("1") ? "critical" : p.startsWith("2") ? "serious" : p.startsWith("3") ? "warning" : "info");
  return `${head("Agentic Incident Workbench", "Incident Command Center: five tracked incidents per use case. Open one to watch the agents work it from intake to verified resolution, with human approval gates and a full audit trail.", "Incident Command Center", wbModePill())}
  ${wbDomainTabs()}
  <div class="wb-ucs">${WB_DATA.use_cases.map((u) => { const l = wbIncidentsFor(u.id); const act = l.filter((i) => ["running", "waiting", "attention", "failed", "paused"].includes((WB.runs[i.id] || {}).status)).length; return `<button class="wb-uc ${u.id === uc.id ? "on" : ""}" data-act="wb-uc" data-uc="${u.id}"><span class="n">${esc(u.name)}</span><span class="c">${l.length} tracked${act ? ` · ${act} active` : ""}</span></button>`; }).join("")}</div>
  <div class="card" style="margin-top:16px">
    <div class="sec-head" style="padding:12px 16px;border-bottom:1px solid var(--line)">
      <div><p class="sec-title">${icon("siren")} ${esc(uc.name)}</p><p style="margin:2px 0 0;font-size:12px;color:var(--ink-muted)">Tracked incidents: <b style="color:var(--ink)">${all.length}</b> (demo limit 5; a new FrontDoor report replaces the oldest idle record)</p></div>
      <div class="wb-filters">
        <select class="sel" id="wb-fpri" aria-label="Filter by priority"><option value="">All priorities</option>${pri.map((p) => `<option ${WB.fPri === p ? "selected" : ""}>${p}</option>`).join("")}</select>
        <select class="sel" id="wb-fstatus" aria-label="Filter by status"><option value="">All statuses</option>${sts.map((s) => `<option ${WB.fStatus === s ? "selected" : ""}>${s}</option>`).join("")}</select>
      </div>
    </div>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Incident</th><th>Short description</th><th>Priority</th><th>Affected service</th><th>Reported</th><th>Current stage</th><th>Agent working</th><th>Status</th></tr></thead><tbody>
    ${list.map((i) => { const st = wbStatusOf(i); const sg = wbStageOf(i); return `<tr class="click" data-act="wb-open" data-id="${esc(i.id)}"><td style="white-space:nowrap">${wbLink(i)}${i.submitted ? `<div style="font-size:10.5px;color:var(--brand)">FrontDoor</div>` : ""}</td><td style="min-width:260px">${esc(i.title)}</td><td>${badge(priKind(i.priority), i.priority)}</td><td style="white-space:nowrap">${esc(i.service)}</td><td style="white-space:nowrap">${rel(wbReportedAt(i))}</td><td style="white-space:nowrap">${esc(sg.stage)}</td><td style="white-space:nowrap;color:var(--ink-soft)">${esc(sg.agent)}</td><td>${badge(st.kind, st.label)}</td></tr>`; }).join("") || `<tr><td colspan="8" style="color:var(--ink-muted)">No incidents match the filters.</td></tr>`}
    </tbody></table></div>
  </div>
  ${simnote("The curated incidents are synthetic demonstration scenarios, not real Crystal Clean incidents, members, providers or employees; DEMO-PAY-048 replays the documented ITOPS demo and is bound to the real ServiceNow record INC0010048 in Live Agent Mode. Identifiers starting DEMO- are synthetic; incident numbers shown as links open the real record in the POC ServiceNow instance. Monitoring evidence and SOP execution are simulated in both modes.")}`;
}

/* ------------------------------------------------------ incident view */
function wbNodeState(run, key) { const n = run && run.nodes[key]; return n ? n.status : "pending"; }
function wbFlow(run, sel, inc) {
  const STAGES = WB_FLOWS[wbFlowOf(inc)].stages;
  const curNode = run && (run.gate ? run.gate.node : run.status === "running" ? run.current : null);
  return `<div class="wb-flow">${STAGES.map((s, si) => {
    const states = s.nodes.map((k) => wbNodeState(run, k));
    const done = states.every((x) => x === "done");
    const cur = s.nodes.includes(curNode);
    const loop = wbFlowOf(inc) !== "incident" ? "" : si === 2 && run && run.round > 1 ? `Round ${run.round}` : si === 3 && run && run.rcaAttempt > 1 ? `Draft ${run.rcaAttempt}` : si === 5 && run && run.sopVersion > 1 ? `SOP v${run.sopVersion}` : si === 6 && run && run.remRound > 1 ? `Remediation ${run.remRound}` : "";
    return `<div class="wb-stage ${done ? "done" : ""} ${cur ? "cur" : ""}"><div class="wb-sh"><span class="num">${done ? "✓" : si + 1}</span><span>${s.title}</span>${loop ? `<span class="loop">↺ ${loop}</span>` : ""}</div>
      <div class="wb-nodes">${s.nodes.map((k, ni) => { const n = run && run.nodes[k]; const st = wbNodeState(run, k); const meta = WB_NODES[k];
        return `${ni ? `<span class="wb-arrow">→</span>` : ""}<button class="wb-node s-${st} ${meta.kind === "human" ? "human" : ""} ${sel === k ? "sel" : ""}" data-act="wb-sel" data-k="${k}" title="${esc(meta.role)}"><span class="st"></span>${icon(meta.icon)}<span>${esc(meta.short)}</span>${n && n.attempts > 1 ? `<span class="x">×${n.attempts}</span>` : ""}</button>`; }).join("")}</div></div>`;
  }).join("")}</div>
  <div class="wb-legend" style="margin-top:8px"><span><i style="background:var(--ink-faint)"></i>Pending</span><span><i style="background:var(--brand)"></i>Running</span><span><i style="background:var(--ok-dot)"></i>Completed</span><span><i style="background:var(--warn)"></i>Waiting / needs attention</span><span><i style="background:var(--danger)"></i>Failed</span><span>Rounded = human gate · ×n = times run</span></div>`;
}
function wbNodeOutput(run, key, o) {
  if (!o) return "";
  switch (key) {
    case "intake": return `${wbKv([["Summary", o.summary], ["Service", o.service], ["Validation", o.validation], ["Recommended priority", o.recommended_priority], ["Business impact", o.business_impact], ["Possible duplicate", o.possible_duplicate_of || "None"]])}${wbSec("Symptoms", wbUl(o.symptoms))}${wbSec("Missing information", wbUl(o.missing_info))}${wbSec("Reasoning", `<p style="margin:0;font-size:12.5px">${esc(o.reasoning)}</p>`)}`;
    case "triage": return `${wbKv([["Assessment", o.summary], ["Category", o.category], ["Assignment group", o.assignment_group], ["Why this group", o.group_rationale], ["Affected service", o.affected_service], ["Configuration item", o.configuration_item], ["Impact / urgency", `${wbTxt(o.impact)} / ${wbTxt(o.urgency)}`], ["Priority", o.priority_recommendation], ["Why this priority", o.priority_rationale], ["Business impact", o.business_impact]])}${wbSec("Related records", wbChips(o.related_records) || "None")}<p style="font-size:11.5px;color:var(--ink-muted);margin:8px 0 0">Recommendations only: existing ServiceNow values are not overwritten.</p>`;
    case "evidence": return `<p style="margin:0;font-size:12.5px;line-height:1.6">${esc(o.summary)}</p>${wbKv([["Sufficiency", o.sufficiency]])}${wbSec("Key findings", `<ul class="wb-ul">${wbArr(o.key_findings).map((f) => `<li>${esc(wbTxt(f.finding || f))} ${wbChips(f.sources)}</li>`).join("")}</ul>`)}${wbSec("Timeline", `<ul class="wb-ul">${wbArr(o.timeline).map((t) => `<li><b>${esc(wbTxt(t.at))}</b>: ${esc(wbTxt(t.event))} ${wbChips(t.source)}</li>`).join("")}</ul>`)}${wbSec("Gaps", wbUl(o.gaps))}`;
    case "hypothesis": return `${wbArr(o.hypotheses).map((h) => `<div class="wb-hyp"><div class="t">${esc(h.id)} · ${esc(h.title)}</div><div class="d">${esc(h.explanation)}</div><div class="d">Evidence: ${wbChips(h.supporting_evidence) || "none"} · ${esc(h.confidence_reason || "")}</div><div class="wb-bar"><i style="width:${Math.round((h.confidence || 0) * 100)}%"></i></div><div class="d" style="font-size:11px">Confidence ${Math.round((h.confidence || 0) * 100)}% · Confirm: ${esc(h.would_confirm || "")} · Reject: ${esc(h.would_reject || "")}</div></div>`).join("")}${o.notes ? `<p style="font-size:12px;color:var(--ink-soft)">${esc(o.notes)}</p>` : ""}`;
    case "critic": return `${wbArr(o.assessments).map((a) => `<div class="wb-hyp"><div class="t">${esc(a.hypothesis_id)} · ${badge(a.verdict === "retain" ? "good" : a.verdict === "reject" ? "critical" : "warning", a.verdict)}</div><div class="d">${esc(a.comment)}</div>${wbArr(a.unsupported_assumptions).length ? `<div class="d"><b>Unsupported:</b> ${esc(wbArr(a.unsupported_assumptions).map(wbTxt).join("; "))}</div>` : ""}${wbArr(a.contradictions).length ? `<div class="d"><b>Contradicted by:</b> ${esc(wbArr(a.contradictions).map(wbTxt).join("; "))}</div>` : ""}${wbArr(a.alternative_explanations).length ? `<div class="d"><b>Alternatives:</b> ${esc(wbArr(a.alternative_explanations).map(wbTxt).join("; "))}</div>` : ""}</div>`).join("")}${wbSec("Overall", `<p style="margin:0;font-size:12.5px">${esc(o.overall)}</p>`)}${wbSec("Additional investigation requested", wbUl(o.additional_investigation))}`;
    case "judge": return `${wbKv([["Selected", `${wbTxt(o.selected_hypothesis_id)} · ${wbTxt(o.selected_title)}`], ["Decision", o.decision === "approved_for_rca" ? "Approved for RCA" : "Further investigation required"], ["Confidence", `${Math.round((o.confidence || 0) * 100)}% (threshold ${WB_THRESHOLD * 100}%)`], ["Rationale", o.rationale]])}${wbSec("Supporting evidence", wbChips(o.supporting_evidence) || "None")}${wbSec("Evidence requested", wbUl(o.evidence_requests))}`;
    case "rca": return wbRcaDoc(o, true);
    case "quality": return `${wbSec("Nine-check quality gate", wbChecksHtml(o.nine_checks))}${wbSec("Governance review", wbChecksHtml(o.checks))}${wbSec("Corrections", wbUl(o.corrections))}${wbKv([["Governance decision", o.decision]])}`;
    case "approval": case "sop_approval": return wbKv([["Decision", { approve: "Approved", request_changes: "Changes requested", reject: "Rejected" }[o.decision] || o.decision], ["Feedback", o.feedback || "—"], ["Approver", o.approver], ["Recorded", o.recorded], ["At", stamp(o.at)]]);
    case "sop": return wbSopDoc(o, run);
    case "execution": return `${wbKv([["Executed", o.executed], ["Manual", o.manual], ["Retries", o.retries], ["Mode", "Simulated execution handler (safe demo actions)"]])}${wbExecList(run, false)}`;
    case "verification": return `${wbKv([["Resolved", o.resolved ? "Yes" : "No"], ["Recommendation", o.recommendation === "close" ? "Close" : "Reopen remediation"], ["Resolution confidence", `${Math.round((o.resolution_confidence || 0) * 100)}%`], ["Additional action", o.additional_action || "—"]])}${wbSec("Checks", wbChecksHtml(o.checks))}${wbSec("Remaining issues", wbUl(o.remaining_issues))}`;
    case "closure": return `${wbKv([["Resolution summary", o.resolution_summary], ["Close code", o.close_code], ["Engineer work note", o.work_note], ["Update for the reporter", o.employee_update]])}`;
  }
  return wbRaw(o, "Output");
}
function wbNodeDetail(run, key) {
  const meta = WB_NODES[key]; const n = run && run.nodes[key];
  const st = n ? n.status : "pending";
  const stBadge = { pending: ["info", "Pending"], running: ["running", "Running"], done: ["good", "Completed"], waiting: ["warning", "Waiting for approval"], attention: ["serious", "Needs attention"], failed: ["critical", "Failed"] }[st];
  const STG = wbStagesOfNode(key);
  return `<div class="card pad wb-det" style="position:sticky;top:12px">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px"><div><span class="eyebrow">Stage ${meta.stage + 1} · ${STG[meta.stage].title}${meta.kind === "human" ? " · human gate" : ""}</span><h3 style="display:flex;align-items:center;gap:6px;margin-top:2px">${icon(meta.icon)} ${esc(meta.name)}</h3></div>${badge(stBadge[0], stBadge[1])}</div>
    <p style="font-size:12.5px;line-height:1.55;color:var(--ink-soft);margin:8px 0 0">${esc(meta.role)}</p>
    ${n ? wbKv([["Started", n.started ? stamp(n.started) : ""], ["Completed", n.ended ? stamp(n.ended) : ""], ["Execution", n.source ? `${wbSrcTag(n.source)} ${esc(n.model || "")} ${n.ms != null ? `· ${wbDur(n.ms)}` : ""}${n.usage ? ` · ${n.usage.input_tokens} in / ${n.usage.output_tokens} out tokens (provider-billed)` : ""}${n.source === "scripted" ? " · scripted output, paced for viewing" : ""}` : "", true], ["Times run", n.attempts > 1 ? `${n.attempts} (earlier outputs kept below)` : ""]]) : `<p style="font-size:12px;color:var(--ink-muted)">Not run yet.</p>`}
    ${n && n.error ? `<div class="wb-flash" style="margin-top:10px">${icon("xcircle")} ${esc(n.error)}${n.kind ? ` <span class="mono">(${esc(n.kind)})</span>` : ""}</div>` : ""}
    ${n && n.input ? wbSec("Input received", `<p style="margin:0;font-size:12px;color:var(--ink-soft)">${Object.keys(n.input).map((k) => `<span class="wb-chip">${esc(k)}</span>`).join("")}</p>${wbRaw(n.input, "Context passed to this agent")}`) : ""}
    ${n && n.tools.length ? wbSec(`Tools invoked (${n.tools.length})`, n.tools.map((t) => `<div class="wb-tool"><div class="h">${icon("tool")} ${esc(t.name)} ${wbSrcTag(t.source)} ${t.status === "ok" ? badge("good", "ok") : t.status === "running" ? badge("running", "running") : badge("critical", "failed")}<span style="margin-left:auto;color:var(--ink-muted);font-weight:400">${wbDur(t.ms)}</span></div><div class="d"><b>Input:</b> ${esc(wbTxt(t.input))}</div><div class="d"><b>Result:</b> ${esc(t.summary || "")}</div>${t.result && typeof t.result === "object" ? wbRaw(t.result, "Tool result") : ""}</div>`).join("")) : ""}
    ${n && n.output ? wbSec("Output produced", wbNodeOutput(run, key, n.output) + (["rca", "sop"].includes(key) ? "" : wbRaw(n.output))) : ""}
    ${n && n.decision ? wbSec("Next agent / decision", `<p style="margin:0;font-size:12.5px;line-height:1.55">${icon("arrow")} ${esc(n.decision)}</p>`) : ""}
    ${n && n.history && n.history.length ? wbSec("Earlier runs of this agent", n.history.map((h, i) => `<details class="wb-raw"><summary>Run ${i + 1}${h.at ? ` · ${stamp(h.at)}` : ""}: ${esc(h.decision || "")}</summary><pre class="wb-pre">${esc(JSON.stringify(h.output, null, 2))}</pre></details>`).join("")) : ""}
  </div>`;
}
// Executive summary: keep it to one short sentence (first sentence, at most ~150 characters).
function wbShort(t) { const x = String(t || "").replace(/\s+/g, " ").trim(); const first = (x.match(/^.*?[.!?](?=\s|$)/) || [x])[0]; return first.length > 150 ? first.slice(0, 147).replace(/\s+\S*$/, "") + "…" : first; }
function wbRcaDoc(o, compact) {
  if (!o) return "";
  return `<div class="wb-doc">
    <h4>Executive summary</h4><p>${esc(wbShort(o.executive_summary))}</p>
    <h4>Root cause <span class="wb-src ${compact ? "llm" : "llm"}">Generated conclusion</span></h4><p><b>${esc(o.root_cause)}</b></p>
    ${compact ? "" : `<h4>Incident overview</h4><p>${esc(o.incident_overview)}</p><h4>Business impact</h4><p>${esc(o.business_impact)}</p><h4>Technical impact</h4><p>${esc(o.technical_impact)}</p><h4>Affected service</h4><p>${esc(o.affected_service)}</p>
    <h4>Timeline</h4><ul class="wb-ul">${wbArr(o.timeline).map((t) => `<li><b>${esc(wbTxt(t.at))}</b>: ${esc(wbTxt(t.event))}</li>`).join("")}</ul>
    <h4>Investigation performed</h4>${wbUl(o.investigation_performed)}<h4>Evidence reviewed <span class="wb-src simulated">Facts from tools</span></h4>${wbUl(o.evidence_reviewed)}`}
    <h4>Contributing factors</h4>${wbUl(o.contributing_factors)}
    <h4>Resolution recommendation</h4>${wbUl(o.resolution_recommendation)}
    <h4>Preventive recommendations</h4>${wbUl(o.preventive_recommendations)}
    <h4>Confidence and evidence</h4><p>${esc(o.confidence)} · ${wbChips(o.evidence_references)}</p>
    ${wbArr(o.assumptions).length ? `<h4>Assumptions</h4>${wbUl(o.assumptions)}` : ""}
  </div>${wbRaw(o)}`;
}
function wbSopDoc(o, run) {
  if (!o) return "";
  return `<div class="wb-doc">
    <p class="eyebrow" style="margin:0 0 4px">${esc(o.sop_id || "SOP")} · v${run ? run.sopVersion : 1} · ${run && run.approvals.some((a) => a.gate === "sop" && a.decision === "approve") ? "approved for execution" : "proposed"}</p>
    <p style="font-size:15px;font-weight:600;margin:0 0 6px">${esc(o.title)}</p>
    <h4>Purpose</h4><p>${esc(o.purpose)}</p><h4>Scope</h4><p>${esc(o.scope)}</p>
    <h4>Preconditions</h4>${wbUl(o.preconditions)}<h4>Required permissions</h4>${wbUl(o.permissions)}
    <h4>Steps</h4><ol class="wb-steps">${wbArr(o.steps).map((s, i) => `<li><span class="n">${i + 1}</span><div>${esc(wbTxt(s.action))}<div class="e">Expected: ${esc(wbTxt(s.expected_result))}</div></div><span style="font-size:11px;color:var(--ink-muted);white-space:nowrap">${esc(wbTxt(s.mode))} · risk ${esc(wbTxt(s.risk))}</span></li>`).join("")}</ol>
    <h4>Rollback</h4>${wbUl(o.rollback)}<h4>Verification</h4>${wbUl(o.verification)}<h4>Escalation</h4>${wbUl(o.escalation)}
    <h4>Evidence references</h4><p>${wbChips(o.evidence_references) || "—"}</p>
  </div>${wbRaw(o)}`;
}
function wbExecList(run, interactive) {
  if (!run || !run.exec) return `<p style="font-size:12px;color:var(--ink-muted)">No execution yet.</p>`;
  const lab = { approved: "Approved, not run", running: "Running", executed: "Executed (simulated)", failed: "Failed", manual: "Manually completed" };
  const manual = interactive && run.gate && run.gate.type === "manual";
  return `<ol class="wb-steps" style="margin-top:6px">${run.exec.steps.map((s, i) => `<li class="wb-x-${s.status}"><span class="n">${i + 1}</span><div>${esc(s.action)}<div class="e">Expected: ${esc(s.expected)}${s.result && s.status !== "executed" ? ` · <span style="color:${s.status === "failed" ? "var(--danger)" : "inherit"}">${esc(s.result)}</span>` : ""}${s.attempts > 1 ? ` · ${s.attempts} attempts` : ""}</div></div><span style="font-size:11px;white-space:nowrap">${manual && s.status !== "executed" ? `<label style="display:inline-flex;gap:5px;align-items:center;cursor:pointer"><input type="checkbox" data-act="wb-mstep" data-i="${i}" ${s.status === "manual" ? "checked" : ""}> Done manually</label>` : badge(s.status === "executed" ? "good" : s.status === "failed" ? "critical" : s.status === "manual" ? "info" : s.status === "running" ? "running" : "info", lab[s.status] || s.status)}</span></li>`).join("")}</ol>`;
}
function wbGateCard(run, inc) {
  if (!run) return "";
  const g = run.gate;
  const d = UI.wbDraft;
  const flash = WBL.flash ? `<div class="wb-flash">${esc(WBL.flash)}</div>` : "";
  if (run.status === "completed") return `<div class="card pad wb-gate ok">${icon("check")} <b>Resolved.</b> ${esc(run.nodes.closure ? run.nodes.closure.decision : "")}</div>`;
  if (run.status === "linked") return `<div class="card pad wb-gate">${icon("link")} <b>Linked as a duplicate.</b> ${esc(run.nodes.intake.decision)}</div>`;
  if (!g) return run.status === "paused" ? `<div class="card pad wb-gate">${icon("pause")} <b>Paused.</b> Next: ${esc(WB_NODES[run.next] ? WB_NODES[run.next].name : run.next === "execution_resume" ? "resume SOP execution" : "—")}. Use Resume or Run next stage.</div>` : flash;
  const nodeName = WB_NODES[g.node] ? WB_NODES[g.node].name : "";
  if (g.type === "asset" || g.type === "hr" || g.type === "policy_exhausted") return wbDomainGateCard(run, flash);
  if (g.type === "rca") {
    const rca = wbOut(run, "rca"); const q = wbOut(run, "quality");
    const warns = q.nine_checks.filter((c) => c.status === "warn").concat(wbArr(q.checks).filter((c) => c.status === "warn"));
    const ok = d.ackRoot && (!warns.length || d.ackWarn);
    const fb = (d.fb || "").trim();
    return `<div class="card pad wb-gate">${flash}<p class="sec-title">${icon("usercheck")} Engineer approval required: RCA and remediation</p>
      <p style="font-size:12.5px;color:var(--ink-soft);margin:4px 0 10px">The workflow is paused. Nothing is posted to ServiceNow and no remediation runs until an engineer decides. These are recommendations, not approved actions.</p>
      <div class="grid g2" style="gap:12px">
        <div>${wbKv([["Root cause", rca.root_cause], ["Judge confidence", run.judged ? `${Math.round(run.judged.confidence * 100)}%${run.flags.lowConfidence ? " (below threshold, engineer override)" : ""}` : ""], ["Evidence", wbChips(rca.evidence_references), true], ["Quality gate", `${q.nine_checks.filter((c) => c.status === "pass").length}/9 pass, ${warns.length} warning(s)`]])}</div>
        <div><span class="eyebrow">Recommended remediation</span>${wbUl(rca.resolution_recommendation)}${warns.length ? `<span class="eyebrow" style="display:block;margin-top:8px">Risk considerations</span>${wbUl(warns.map((w) => `${w.label || w.name}: ${w.detail}`))}` : ""}</div>
      </div>
      <div style="margin-top:12px;display:flex;flex-direction:column;gap:6px;font-size:12.5px">
        <label style="display:flex;gap:8px"><input type="checkbox" id="wb-ack-root" ${d.ackRoot ? "checked" : ""}> I reviewed the root cause and the evidence it cites.</label>
        ${warns.length ? `<label style="display:flex;gap:8px"><input type="checkbox" id="wb-ack-warn" ${d.ackWarn ? "checked" : ""}> I acknowledge the ${warns.length} warning(s) above.</label>` : ""}
      </div>
      <textarea class="ta" id="wb-fb" rows="2" style="margin-top:8px" placeholder="Feedback for the agents (required to request changes or reject; optional comment when approving)">${esc(d.fb || "")}</textarea>
      <div class="wb-ctrl" style="margin-top:10px"><button class="btn primary" data-act="wb-decide" data-g="rca" data-d="approve" ${ok ? "" : "disabled"}>${icon("check")} Approve</button><button class="btn" data-act="wb-decide" data-g="rca" data-d="request_changes" ${fb.length >= 10 ? "" : "disabled"}>${icon("rotate")} Request changes</button><button class="btn danger" data-act="wb-decide" data-g="rca" data-d="reject" ${fb.length >= 10 ? "" : "disabled"}>${icon("xcircle")} Reject root cause</button></div>
      <p style="font-size:11.5px;color:var(--ink-muted);margin:8px 0 0">Request changes → RCA Writer redrafts with your feedback. Reject → the Hypothesis Agent re-examines the root cause with your feedback. ${run.mode === "live" ? "Your decision is recorded by the backend, which enforces it for ServiceNow writes (POC engineer role, no sign-in)." : "Demo: decision recorded locally."}</p></div>`;
  }
  if (g.type === "sop") {
    const fb = (d.fb || "").trim();
    return `<div class="card pad wb-gate">${flash}<p class="sec-title">${icon("hand")} SOP approval required before execution</p>
      <p style="font-size:12.5px;color:var(--ink-soft);margin:4px 0 10px">The SOP Generation Agent produced v${run.sopVersion}${run.remRound > 1 ? " (revised after verification failed)" : ""}. Review the steps; nothing executes until you approve.</p>
      ${wbSopDoc(wbOut(run, "sop"), run)}
      <label style="display:flex;gap:8px;margin-top:10px;font-size:12.5px"><input type="checkbox" id="wb-ack-sop" ${d.ackSop ? "checked" : ""}> The steps are safe to execute in this order, and rollback is clear.</label>
      <textarea class="ta" id="wb-fb" rows="2" style="margin-top:8px" placeholder="Feedback for the SOP Generation Agent (required to request changes)">${esc(d.fb || "")}</textarea>
      <div class="wb-ctrl" style="margin-top:10px"><button class="btn primary" data-act="wb-decide" data-g="sop" data-d="approve" ${d.ackSop ? "" : "disabled"}>${icon("play")} Approve and execute</button><button class="btn" data-act="wb-decide" data-g="sop" data-d="request_changes" ${fb.length >= 10 ? "" : "disabled"}>${icon("rotate")} Request changes</button></div></div>`;
  }
  if (g.type === "exec_failed" || g.type === "manual") {
    const st = run.exec.steps[g.step];
    return `<div class="card pad wb-gate err">${flash}<p class="sec-title" style="color:var(--danger)">${icon("xcircle")} ${g.type === "manual" ? "Manual takeover in progress" : `SOP step ${g.step + 1} failed`}</p>
      <p style="font-size:12.5px;margin:4px 0 8px">${g.type === "manual" ? "Tick each remaining step as you complete it. When all are done, the run continues to verification." : `${esc(st.action)}<br><span style="color:var(--danger)">${esc(st.result)}</span>`}</p>
      ${g.type === "manual" ? wbExecList(run, true) : `<div class="wb-ctrl"><button class="btn primary" data-act="wb-exec" data-a="retry">${icon("rotate")} Retry step</button><button class="btn" data-act="wb-exec" data-a="manual">${icon("hand")} Manual takeover</button></div><p style="font-size:11.5px;color:var(--ink-muted);margin:8px 0 0">${g.mode === "manual" ? "This step needs a team the automation can't act for; a retry will fail again." : "Looks transient; a retry may succeed."} Steps already executed are kept.</p>`}</div>`;
  }
  if (g.type === "intake_info") return `<div class="card pad wb-gate">${flash}<p class="sec-title">${icon("message")} More information needed from the reporter</p>${wbUl(g.missing && g.missing.length ? g.missing : ["Describe when it started, who is affected and what changed."])}<textarea class="ta" id="wb-info" rows="2" style="margin-top:8px" placeholder="Additional details from the reporter">${esc(d.info || "")}</textarea><div class="wb-ctrl" style="margin-top:8px"><button class="btn primary" data-act="wb-gate" data-a="info">${icon("send")} Add details and re-validate</button></div></div>`;
  if (g.type === "duplicate") return `<div class="card pad wb-gate">${flash}<p class="sec-title">${icon("link")} Possible duplicate flagged by the Intake Agent</p><p style="font-size:12.5px;margin:4px 0 8px">${esc(g.candidate.number || g.candidate.id)}: ${esc(g.candidate.title)} (${esc(g.candidate.state || "")}, ${esc(g.candidate.source)})</p><div class="wb-ctrl"><button class="btn primary" data-act="wb-gate" data-a="new">Investigate as a new incident</button><button class="btn" data-act="wb-gate" data-a="link">${icon("link")} Link as duplicate</button></div></div>`;
  if (g.type === "judge_low") return `<div class="card pad wb-gate">${flash}<p class="sec-title">${icon("shield")} Evidence still insufficient after ${run.round} rounds</p><p style="font-size:12.5px;margin:4px 0 8px">${esc(run.nodes.judge.decision)}</p><div class="wb-ctrl"><button class="btn" data-act="wb-gate" data-a="proceed">Proceed to RCA, flagged low confidence</button><button class="btn danger" data-act="wb-gate" data-a="stop">Stop and escalate</button></div></div>`;
  if (g.type === "escalated") return `<div class="card pad wb-gate err">${icon("flag")} <b>Escalated.</b> The agents could not reach a supported root cause; an engineer investigates manually. Restart the run to try again.</div>`;
  if (g.type === "quality_exhausted") return `<div class="card pad wb-gate">${flash}<p class="sec-title">${icon("alert")} RCA failed the quality gate ${run.rcaAttempt} times</p><p style="font-size:12.5px;margin:4px 0 8px">See the Quality & Governance Agent for the failed checks.</p><div class="wb-ctrl"><button class="btn primary" data-act="wb-gate" data-a="retry">${icon("rotate")} Retry RCA Writer</button></div></div>`;
  if (g.type === "verify_exhausted") return `<div class="card pad wb-gate err">${flash}<p class="sec-title">${icon("alert")} Verification failed after 3 remediation rounds</p><div class="wb-ctrl"><button class="btn" data-act="wb-gate" data-a="retry">${icon("rotate")} Restart remediation</button></div></div>`;
  if (g.type === "error") { const n = run.nodes[g.node] || {}; return `<div class="card pad wb-gate err">${flash}<p class="sec-title" style="color:var(--danger)">${icon("xcircle")} ${esc(nodeName)} failed</p><p style="font-size:12.5px;margin:4px 0 8px">${esc(n.error || "")}${n.kind ? ` <span class="mono">(${esc(n.kind)})</span>` : ""}</p><p style="font-size:11.5px;color:var(--ink-muted);margin:0 0 8px">Earlier results are kept. The run is not marked complete.${run.snResult && run.snResult.pending ? " The prepared ServiceNow update is kept for review in Verification & closure." : ""}</p><div class="wb-ctrl"><button class="btn primary" data-act="wb-ctl" data-c="retry">${icon("rotate")} Retry failed stage</button></div></div>`; }
  return flash;
}
function wbControls(run) {
  const s = run ? run.status : "none";
  const b = (c, label, ic, primary, show) => (show ? `<button class="btn ${primary ? "primary" : ""}" data-act="wb-ctl" data-c="${c}">${icon(ic)} ${label}</button>` : "");
  return `<div class="wb-ctrl">${b("start", "Start investigation", "play", true, s === "none")}${b("resume", s === "ready" ? "Run all stages" : "Resume", "play", true, s === "paused" || s === "ready")}${b("next", "Run next stage", "skip", false, s === "paused" || s === "ready" || s === "none")}${b("pause", "Pause", "pause", false, s === "running")}${b("retry", "Retry failed stage", "rotate", false, s === "failed")}${b("restart", "Restart run", "rotate", false, ["completed", "linked", "attention", "failed", "paused", "waiting"].includes(s))}</div>`;
}
function wbStepper(run, inc) {
  const STAGES = WB_FLOWS[wbFlowOf(inc)].stages;
  return `<div class="stepper" style="margin-top:12px;${STAGES.length !== 8 ? `grid-template-columns:repeat(auto-fit,minmax(130px,1fr))` : ""}">${STAGES.map((s, i) => { const states = s.nodes.map((k) => wbNodeState(run, k)); const done = states.every((x) => x === "done"); const cur = run && (s.nodes.includes(run.gate ? run.gate.node : run.current) && run.status !== "completed"); return `<button class="stp ${done ? "done" : cur ? "cur" : ""}" data-act="wb-sel" data-k="${s.nodes[0]}" ${!run || (!done && !cur && states.every((x) => x === "pending")) ? "disabled" : ""}><span class="c">${done ? "✓" : i + 1}</span><span>${s.title}</span></button>`; }).join("")}</div>`;
}
function pageWbIncident(id) {
  const inc = wbInc(id);
  if (!inc) return `${head("Incident not found", "This incident is no longer tracked (it may have been replaced by a newer FrontDoor report, or the demo was reset).", "")}<a class="btn" href="#/workbench">${icon("back")} Back to the Command Center</a>`;
  if (UI.wbOpenFor !== id) { UI.wbOpenFor = id; UI.wbSel = null; UI.wbDraft = {}; }
  const run = WB.runs[id];
  const flow = wbFlowOf(inc); const first = WB_FLOWS[flow].first;
  const autoSel = run ? (run.gate ? run.gate.node : run.current || first) : first;
  const sel = UI.wbSel && WB_NODES[UI.wbSel] ? UI.wbSel : autoSel;
  const st = wbStatusOf(inc);
  const uc = wbUseCase(inc.use_case);
  const tabs = flow === "incident" ? [["timeline", "Timeline"], ["notes", "ServiceNow work notes"]] : [["req", flow === "asset" ? "Asset & decision" : "Answer & plan"], ["timeline", "Timeline"], ["audit", "Audit trail"]];
  if (!tabs.some((t) => t[0] === UI.wbTab)) UI.wbTab = tabs[0][0];
  return `<div style="margin-bottom:10px"><a href="#/workbench" class="btn ghost" style="padding-left:0">${icon("back")} Incident Workbench · ${esc(flow === "incident" ? uc.short : WB_FLOWS[flow].label)}</a></div>
  <div class="card pad">
    <div style="display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px">
      <div style="min-width:0;flex:1">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">${wbLink(inc)} ${badge(st.kind, st.label)} ${badge(inc.priority.startsWith("1") ? "critical" : inc.priority.startsWith("2") ? "serious" : "warning", inc.priority)} ${wbRunBadge(run)}${inc.submitted ? `<span class="pill p-brand">Digital FrontDoor</span>` : ""}</div>
        <h1 style="font-size:18px;font-weight:600;margin:8px 0 4px;letter-spacing:-.01em">${esc(inc.title)}</h1>
        <p style="margin:0;font-size:12.5px;color:var(--ink-soft)">${esc(WB_FLOWS[flow].label)} · ${esc(inc.service)}${inc.ci ? ` · ${esc(inc.ci)}` : ""}${inc.asset_tag ? ` · asset ${esc(inc.asset_tag)}` : ""} · reported by ${esc(inc.reported_by)} · ${rel(wbReportedAt(inc))}${run && run.sn && run.sn.number && !inc.sn ? ` · ServiceNow ${esc(run.sn.number)}` : ""}</p>
        <p style="margin:8px 0 0;font-size:12.5px;line-height:1.6;max-width:900px">${esc(inc.description)}${run && run.extraInfo ? ` <i>Added: ${esc(run.extraInfo)}</i>` : ""}</p>
      </div>
      ${wbControls(run)}
    </div>
    ${run && run.mode !== wbMode() && run.status !== "completed" ? `<p style="font-size:11.5px;color:var(--warn);margin:10px 0 0">${icon("info")} This run uses ${run.mode === "live" ? "Live Agent Mode" : "Controlled Demo Mode"}; the page is now in the other mode. Restart the run to switch.</p>` : ""}
    ${wbStepper(run, inc)}
  </div>
  <div style="margin-top:12px">${wbGateCard(run, inc)}</div>
  <div class="wb-split" style="margin-top:12px">
    <div class="card pad"><div class="sec-head" style="margin-bottom:10px"><p class="sec-title">${icon("bot")} Agent collaboration</p><span style="font-size:11.5px;color:var(--ink-muted)">Click an agent for its input, tools, output and decision</span></div>${wbFlow(run, sel, inc)}</div>
    ${wbNodeDetail(run, sel)}
  </div>
  <div class="card" style="margin-top:16px">
    <div class="subtabs">${tabs.map(([k, l]) => `<button class="subtab ${UI.wbTab === k ? "on" : ""}" data-act="wb-tab" data-t="${k}">${l}</button>`).join("")}</div>
    <div class="pad">${{ timeline: wbTabTimeline, inv: wbTabInv, intel: wbTabIntel, sop: wbTabSop, ver: wbTabVer, notes: wbTabNotes, audit: wbTabAudit, req: wbTabRequest }[UI.wbTab](run, inc)}</div>
  </div>
  ${flow !== "incident" ? simnote("Synthetic demonstration request. Agent outputs are labelled Live LLM or Scripted demo. In Live Agent Mode, asset records, device history and Service Catalog orders are real ServiceNow data; device health readings and the HR policy library are synthetic.") : simnote("Synthetic demonstration incident. Agent outputs are labelled Live LLM or Scripted demo. Monitoring and log evidence and SOP execution are simulated in both modes; ServiceNow calls are live only in Live Agent Mode and only for records that exist in the POC instance.")}`;
}
function wbTabInv(run, inc) {
  if (!run || !run.nodes.intake) return `<p style="font-size:12.5px;color:var(--ink-muted)">Start the investigation to see the agents' findings here.</p>`;
  const ev = run.evidence;
  const intake = wbOut(run, "intake"); const j = wbOut(run, "judge"); const rca = wbOut(run, "rca");
  return `<div class="grid g2">
    <div>${wbSec("Incident summary (Intake Agent)", intake ? `<p style="margin:0;font-size:12.5px">${esc(intake.summary)}</p>` : "—")}
      ${wbSec(`Evidence gathered (${ev.length}) <span class="wb-src simulated">Simulated</span> = synthetic telemetry/records · <span class="wb-src live">Live</span> = read from ServiceNow`, ev.length ? ev.map((e) => `<div class="wb-ev"><div><span class="wb-chip">${esc(e.id)}</span><br>${wbSrcTag(e.label === "Live ServiceNow" ? "live" : "simulated")}${e.round > 1 ? `<div style="font-size:10.5px;color:var(--brand)">round ${e.round}</div>` : ""}</div><div><b style="font-weight:500">${esc(e.source)}</b><br>${e.url && WB_SN_URL.test(e.url) ? `<a class="snlink" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.text)}${icon("external")}</a>` : esc(e.text)}</div></div>`).join("") : "—")}</div>
    <div>${wbSec("Hypotheses → critique → decision", run.nodes.hypothesis ? wbNodeOutput(run, "hypothesis", wbOut(run, "hypothesis")) : "—")}
      ${j ? wbSec("Judge decision", wbNodeOutput(run, "judge", j)) : ""}</div>
  </div>
  ${rca ? wbSec(`Root cause analysis (draft ${run.rcaAttempt}) · generated conclusions, grounded in the evidence ids cited`, wbRcaDoc(rca, false)) : ""}`;
}
function wbTabSop(run) {
  if (!run || !run.nodes.sop) return `<p style="font-size:12.5px;color:var(--ink-muted)">The SOP is generated after the engineer approves the RCA.</p>`;
  const appr = run.approvals.filter((a) => a.gate === "sop");
  return `<div class="grid g2"><div>${wbSec("Standard operating procedure", wbSopDoc(wbOut(run, "sop"), run))}</div>
  <div>${wbSec("Execution", `<div class="wb-legend" style="margin-bottom:6px"><span>${badge("info", "Approved, not run")}</span><span>${badge("good", "Executed")}</span><span>${badge("critical", "Failed")}</span><span>${badge("info", "Manually completed")}</span></div>${wbExecList(run, false)}<p style="font-size:11.5px;color:var(--ink-muted)">Execution uses a simulated, safe execution handler: no production systems are changed in this POC.</p>`)}
  ${wbSec("SOP approvals", appr.length ? wbUl(appr.map((a) => `${stamp(a.at)} · ${a.decision}${a.feedback ? `: ${a.feedback}` : ""}`)) : "None yet")}</div></div>`;
}
function wbTabVer(run, inc) {
  if (!run || !run.nodes.verification) return `<p style="font-size:12.5px;color:var(--ink-muted)">Verification runs after the approved SOP has been executed.</p>`;
  const health = (run.nodes.verification.tools.find((t) => t.name === "Service health check") || {}).result;
  const v = wbOut(run, "verification"); const c = run.closeNote;
  const snS = run.snResult;
  const ap = (g) => { const a = run.approvals.filter((x) => x.gate === g).pop(); return a ? `${a.decision === "approve" ? "Approved" : a.decision} · ${stamp(a.at)}` : "Not yet"; };
  return `<div class="grid g2"><div>
    ${health ? wbSec("Before and after <span class='wb-src simulated'>Simulated monitoring</span>", `<div class="wb-metric"><span>${esc(health.metric)}</span><b style="color:var(--danger)">${health.before}</b><span>→</span><b style="color:${health.meets_threshold ? "var(--ok)" : "var(--danger)"}">${health.after}</b><span>${esc(health.unit)} · threshold ${health.better === "higher" ? "≥" : "≤"} ${health.threshold}</span></div>`) : ""}
    ${v ? wbSec("Verification checks", wbChecksHtml(v.checks)) : ""}
    ${run.remRound > 1 ? `<p style="font-size:12px;color:var(--brand)">${icon("rotate")} Verification failed on the first remediation round; the SOP was revised and re-executed (round ${run.remRound}).</p>` : ""}
  </div><div>
    ${wbSec("Final outcome", wbKv([["Incident", wbNum(inc)], ["Resolution summary", c ? c.resolution_summary : "—"], ["RCA status", run.approvals.some((a) => a.gate === "rca" && a.decision === "approve") ? `Approved (draft ${run.rcaAttempt})` : "Not approved"], ["SOP status", run.nodes.sop ? `${wbOut(run, "sop").sop_id} v${run.sopVersion}: ${ap("sop")}` : "—"], ["Approvals", `RCA: ${ap("rca")} · SOP: ${ap("sop")}`], ["Verification", v ? (v.resolved ? "Passed" : "Failed") : "—"], ["ServiceNow update", snS ? (snS.written ? `Written and read back: ${snS.readback.number} is ${snS.readback.state}` : snS.error ? `FAILED: ${snS.error}` : `Not written: ${snS.reason}`) : "—"], ["Final status", wbStatusOf(inc).label]]))}
    ${snS && !snS.written && snS.pending ? wbSec("Prepared ServiceNow update (retained for review)", `<pre class="wb-pre">${esc(`Work note:\n${snS.pending.work_note}\n\nClose notes:\n${snS.pending.resolution_summary}\n\nUpdate for the reporter:\n${snS.pending.employee_update}`)}</pre>`) : ""}
    ${snS && snS.written && snS.url && WB_SN_URL.test(snS.url) ? `<a class="btn" href="${esc(snS.url)}" target="_blank" rel="noopener noreferrer">${icon("external")} Open in ServiceNow</a>` : ""}
  </div></div>`;
}
function wbTabAudit(run) {
  if (!run) return `<p style="font-size:12.5px;color:var(--ink-muted)">No activity yet.</p>`;
  const kind = { agent: "info", tool: "info", result: "good", decision: "info", approval: "warning", retry: "warning", error: "critical" };
  const res = { ok: ["good", "Completed"], info: ["info", "Info"], warn: ["warning", "Attention"], bad: ["critical", "Error"], wait: ["warning", "Waiting"] };
  return `<p style="font-size:12px;color:var(--ink-muted);margin:0 0 8px">Run ${esc(run.id)} · ${run.mode === "live" ? "Live Agent Mode" : "Controlled Demo Mode"} · ${run.events.length} events, oldest first. Live runs are also recorded by the backend (agent, tool and approval calls; no incident text).</p>
  <div class="tbl-wrap"><table class="t"><thead><tr><th>Time</th><th>Agent / component</th><th>Type</th><th>Activity</th><th>Result</th></tr></thead><tbody>${run.events.map((e) => `<tr><td class="mono" style="font-size:11.5px;white-space:nowrap">${wbT(e.at)}</td><td style="white-space:nowrap">${esc(e.actor)}</td><td>${badge(kind[e.type] || "info", e.type)}</td><td style="min-width:300px">${esc(e.text)}</td><td>${badge(...(res[e.result] || res.info))}</td></tr>`).join("")}</tbody></table></div>`;
}

/* ------------------------------------------------------- FrontDoor */
const WB_FD_STAGE = ["We've received your report and are checking it", "Routed to the right team", "Investigating the cause", "Investigating the cause", "Waiting for an engineer to approve the fix", "Applying the fix", "Checking the fix worked", "Resolved"];
function wbFdStatus(inc) {
  const run = WB.runs[inc.id];
  if (!run) return { text: "Received", stage: 0 };
  if (run.status === "completed") return { text: "Resolved", stage: 8 };
  if (run.status === "linked") return { text: "Linked to an existing report of the same problem", stage: 1 };
  if (run.gate && run.gate.type === "intake_info") return { text: "We need a few more details from you", stage: 0 };
  const key = run.gate ? run.gate.node : run.next || run.current || "intake";
  const s = WB_NODES[key] ? WB_NODES[key].stage : 0;
  return { text: run.status === "failed" || run.status === "attention" ? "An engineer is looking at it" : WB_FD_STAGE[s], stage: s };
}
function pageDigitalFrontDoor() {
  const f = UI.fd; const uc = wbUseCase(f.uc);
  const svcs = WB_DATA.incidents.filter((i) => i.use_case === uc.id).map((i) => i.service);
  if (!svcs.includes(f.service)) f.service = svcs[0];
  const live = wbMode() === "live";
  const mine = WB.myIds.map(wbInc).filter(Boolean);
  const ready = !wbFdMissing() && !f.busy;
  return `${head("Digital FrontDoor", `Hi ${WB_EMPLOYEE.name.split(" ")[0]}. Report an IT or business-technology problem in your own words. A team of AI agents investigates it, an engineer approves the fix, and you can follow progress here.`, "Employee experience", wbModePill())}
  <div class="wb-split">
    <div class="card pad wb-fdform">
      <p class="sec-title">${icon("message")} Report an issue</p>
      <label>What area is affected?</label>
      <div class="wb-ucs" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${WB_DATA.use_cases.map((u) => `<button class="wb-uc ${u.id === uc.id ? "on" : ""}" data-act="fd2-uc" data-uc="${u.id}"><span class="n">${esc(u.name)}</span></button>`).join("")}</div>
      <label for="fd2-service">Which application or service?</label>
      <select class="sel" id="fd2-service">${svcs.map((s) => `<option ${s === f.service ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
      <label for="fd2-title">Short summary</label>
      <input class="input" id="fd2-title" maxlength="160" placeholder="e.g. Claims screen keeps timing out" value="${esc(f.title)}">
      <label for="fd2-desc">What's happening? <span style="font-weight:400;color:var(--ink-muted)">When did it start, who is affected, what have you tried?</span></label>
      <textarea class="ta" id="fd2-desc" rows="4" maxlength="3000" placeholder="Describe the problem in your own words">${esc(f.description)}</textarea>
      <div class="grid g2" style="gap:12px">
        <div><label for="fd2-impact">Who is affected?</label><select class="sel" id="fd2-impact">${[["many", "Many people or a whole department"], ["team", "My team"], ["me", "Just me"]].map(([v, l]) => `<option value="${v}" ${f.impact === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label for="fd2-urg">How urgent is it?</label><select class="sel" id="fd2-urg">${[["now", "Work is blocked now"], ["today", "Needs fixing today"], ["later", "Can wait"]].map(([v, l]) => `<option value="${v}" ${f.urgency === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      </div>
      ${f.err ? `<div class="wb-flash" style="margin-top:12px">${esc(f.err)}</div>` : ""}
      <div class="wb-ctrl" style="margin-top:14px;align-items:center"><button class="btn primary lg" data-act="fd2-submit" ${ready ? "" : "disabled"}>${f.busy ? icon("loader", "spin") : icon("send")} ${f.busy ? "Submitting…" : "Submit incident"}</button><button class="btn ghost" data-act="fd2-example">Use the example for this service</button></div>
      <p id="fd2-hint" style="font-size:12px;color:var(--warn);margin:8px 0 0;${ready || f.busy ? "display:none" : ""}">${esc(wbFdMissing())}</p>
      <p style="font-size:11.5px;color:var(--ink-muted);margin:10px 0 0">${live ? "Live Agent Mode: this creates a real incident in the POC ServiceNow instance, tagged to you." : "Controlled Demo Mode: this creates a synthetic demo incident; nothing is sent to ServiceNow."} The ${esc(uc.short)} list tracks five incidents; your report replaces the oldest idle one until the demo is reset.</p>
    </div>
    <div class="card pad">
      <p class="sec-title">${icon("history")} Your reported incidents</p>
      ${mine.length ? mine.map((i) => { const s = wbFdStatus(i); const run = WB.runs[i.id]; const c = run && run.closeNote; return `<div style="border-top:1px solid var(--line);padding:12px 0">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${wbLink(i)} ${badge(wbStatusOf(i).kind, wbStatusOf(i).label)}<span style="font-size:11.5px;color:var(--ink-muted)">${rel(wbReportedAt(i))}</span></div>
        <div style="font-size:13px;font-weight:500;margin-top:4px">${esc(i.title)}</div>
        <div style="font-size:12.5px;color:var(--ink-soft);margin-top:2px">${esc(s.text)}</div>
        <div class="wb-prog">${WB_STAGES.map((_, k) => `<i class="${k < s.stage ? "d" : k === s.stage && s.stage < 8 ? "c" : ""}"></i>`).join("")}</div>
        ${run && run.gate && run.gate.type === "intake_info" ? `<div class="card" style="padding:10px 12px;margin-top:10px;background:var(--warn-soft);border-color:#f0c78a">
          <div style="font-size:12.5px;font-weight:500">${icon("message")} Please tell us a bit more</div>
          ${wbUl(run.gate.missing && run.gate.missing.length ? run.gate.missing : ["When did it start, who is affected, and has anything changed?"])}
          <textarea class="ta" id="fd2-info-${esc(i.id)}" rows="2" style="margin-top:6px;background:#fff" placeholder="e.g. Since 9am, my whole team gets an error on the SSO page">${esc((UI.fdInfo || {})[i.id] || "")}</textarea>
          ${WBL.flash ? `<div class="wb-flash" style="margin:6px 0 0">${esc(WBL.flash)}</div>` : ""}
          <button class="btn primary" style="margin-top:8px" data-act="fd2-info" data-id="${esc(i.id)}">${icon("send")} Send details</button></div>` : ""}
        ${c ? `<p style="font-size:12.5px;margin:8px 0 0;line-height:1.55">${esc(c.employee_update)}</p>` : ""}
        ${psCanRoute("workbench") ? `<a class="btn ghost" style="padding-left:0;margin-top:4px" href="#/workbench/${encodeURIComponent(i.id)}">${icon("eye")} View the agent workflow</a>` : ""}</div>`; }).join("") : `<p style="font-size:12.5px;color:var(--ink-muted)">Nothing reported yet. Reports you submit appear here with their progress.</p>`}
    </div>
  </div>
  ${simnote("Proof of concept with synthetic data. The employee view shows plain-language progress; the agent workflow (an IT view) shows each agent's work.")}`;
}
function wbFdMissing() {
  const f = UI.fd; const need = [];
  if (f.title.trim().length < 10) need.push("a short summary (at least 10 characters)");
  if (!wbWords(f.description)) need.push("a description of what's happening");
  return need.length ? `To submit, add ${need.join(" and ")}.` : "";
}
function wbFdExample() {
  const scen = WB_DATA.incidents.find((i) => i.service === UI.fd.service);
  if (!scen) return;
  UI.fd.title = scen.title.length > 90 ? scen.title.slice(0, 90) : scen.title;
  UI.fd.description = scen.description;
  UI.fd.impact = scen.impact.startsWith("1") ? "many" : scen.impact.startsWith("2") ? "team" : "me";
  UI.fd.urgency = scen.urgency.startsWith("1") ? "now" : scen.urgency.startsWith("2") ? "today" : "later";
  render();
}
async function wbFdSubmit() {
  const f = UI.fd;
  if (f.busy) return;
  f.busy = true; f.err = ""; render();
  const r = await wbSubmit({ uc: f.uc, service: f.service, title: f.title, description: f.description, impact: f.impact, urgency: f.urgency });
  f.busy = false;
  if (!r.ok) { f.err = r.error; render(); return; }
  f.title = ""; f.description = "";
  location.hash = `#/workbench/${encodeURIComponent(r.id)}`;
}

/* ------------------------------------------------- Control Tower */
function wbTowerSection() {
  const runs = Object.values(WB.runs);
  const by = (s) => runs.filter((r) => r.status === s).length;
  const nodes = runs.flatMap((r) => Object.values(r.nodes));
  const llm = nodes.filter((n) => n.source === "llm" && n.output);
  const llmFail = nodes.filter((n) => n.source === "llm" && n.error && !n.output).length;
  const avg = llm.length ? llm.reduce((a, n) => a + (n.ms || 0), 0) / llm.length / 1000 : 0;
  const tile = (label, v, sub) => `<div class="card tile"><div class="h"><span class="eyebrow">${label}</span></div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  return `<div class="card pad" style="margin-top:16px"><div class="sec-head"><p class="sec-title">${icon("bot")} Agentic Incident Workbench (this browser)</p>${psCanRoute("workbench") ? `<a class="btn" href="#/workbench">${icon("arrow")} Open the Command Center</a>` : ""}</div>
  <div class="grid g6" style="gap:12px;margin-top:12px">${tile("Runs", runs.length, "Incidents investigated")}${tile("Resolved", by("completed"), "Verified and closed")}${tile("Awaiting approval", by("waiting"), "Human gates open")}${tile("Needs attention", by("attention") + by("failed"), "Failed or escalated stages")}${tile("Live LLM agent calls", llm.length, llmFail ? `${llmFail} failed` : "Real calls in Live Agent Mode")}${tile("Avg agent latency", llm.length ? `${avg.toFixed(1)} s` : "—", "Live LLM calls only")}</div>
  <p style="font-size:11.5px;color:var(--ink-muted);margin:10px 0 0">Counts come from this browser's workbench runs (actual). Scripted demo runs are counted as runs but never as LLM calls; provider-billed token usage is on the live app's Control Tower ledger.</p></div>`;
}
</script>
