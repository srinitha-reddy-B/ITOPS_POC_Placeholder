<style>
.sso-stages{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}
@media (max-width:1000px){.sso-stages{grid-template-columns:repeat(3,minmax(0,1fr))}}
.sso-stage{border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--surface);text-align:left;font:inherit;cursor:pointer;display:flex;gap:8px;align-items:flex-start;color:var(--ink)}
.sso-stage:disabled{cursor:default;opacity:.55}
.sso-stage .n{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:600;background:var(--hover);flex:none}
.sso-stage.done .n{background:#22c55e;color:#fff}.sso-stage.active .n{background:var(--brand);color:#fff}
.sso-stage.active{border-color:var(--brand);box-shadow:0 0 0 2px var(--brand-soft)}
.sso-stage.sel{outline:2px solid var(--ink);outline-offset:1px}
.sso-stage .t{font-size:12px;font-weight:600;line-height:1.25}.sso-stage .s{font-size:10.5px;color:var(--ink-muted)}
.sso-stage .n svg{width:12px;height:12px}
.sso-canvas svg{width:100%;height:auto;display:block}
.sso-canvas .lbl{font:600 11.5px var(--sans);fill:#1d1d27}.sso-canvas .sub{font:400 10px var(--sans);fill:#6b7280}
.sso-split{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:12px;margin-top:12px;align-items:start}
@media (max-width:1100px){.sso-split{grid-template-columns:1fr}}
.sso-new{animation:ssoin .45s ease-out}
@keyframes ssoin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.sso-new{animation:none}}
.sso-banner{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:12.5px;background:var(--surface)}
.sso-banner.demo{border-color:#f0d49a;background:#fffaf0}.sso-banner.live{border-color:#bfe5c9;background:#f3fbf5}
.sso-approve{border:1px solid #f0d49a;background:#fffaf0;border-radius:10px;padding:10px 12px;margin-top:10px}
.sso-approve.ok{border-color:#bfe5c9;background:#f3fbf5}
</style>
<script>
"use strict";
/* =====================================================================
   SSO investigation: telemetry -> history -> pattern -> root cause ->
   remediation -> verification, with the data flow animated.
   - Demo mode: a deterministic walkthrough built from the SSO scenario's
     own scripted evidence (the same data the scripted agents use). It is
     labelled Demo / simulated everywhere and never touches ServiceNow.
   - Live mode: built only from real execution events: the latest live SSO
     prediction (real sign-in signal, real agent calls) and, when IT raised
     an investigation, its RCA workflow run. Missing stages stay empty.
   ===================================================================== */
const SSO_STAGES = [
  { key: "telemetry", title: "Telemetry collection", sub: "Sign-in signals", icon: "activity" },
  { key: "history", title: "Historical evidence", sub: "Incidents, changes, logs", icon: "history" },
  { key: "pattern", title: "Pattern identification", sub: "Spikes and correlation", icon: "search" },
  { key: "rca", title: "Root cause analysis", sub: "Hypotheses and evidence", icon: "sparkles" },
  { key: "remediation", title: "Remediation", sub: "Fix plan and approval", icon: "wrench" },
  { key: "verification", title: "Verification", sub: "Before and after", icon: "shield" },
];
UI.sso = UI.sso || { stage: 0, shown: {}, playing: false, approved: false, view: null };
let ssoTimer = null;

// ------------------------------------------------------- demo fixture
// Built from the SSO scenario's scripted RCA data, so the walkthrough and the
// scripted agents tell the same story.
function ssoDemoData() {
  const sc = PI_SCEN.sso.rca; const ev = sc.evidence; const s = sc.script; const h = PI_SCEN.sso.demo_history;
  const sig = msSignals("sso", {}, 4); const base = msSignals("sso", {}, 0);
  const g = (k, arr = sig) => arr.find((x) => x.key === k) || {};
  const chg = ev.changes[0]; const log = (id) => (ev.logs.concat(ev.deep).find((l) => l.id === id) || {}).text || "";
  const m = ev.metrics[0];
  return {
    sig, base, chg, m,
    nodes: [{ id: "idp-node-1", fail: 0 }, { id: "idp-node-2", fail: 1 }, { id: "idp-node-3", fail: 44 }, { id: "idp-node-4", fail: 0 }],
    stages: [
      [
        { t: "Authentication failure rate", d: `Login success ${piFmt(g("login_success").current, "%")} against a normal ${piFmt(g("login_success").baseline, "%")}; failed sign-ins ${piFmt(g("login_failures").current, "/hour")} (normal ${piFmt(g("login_failures").baseline, "/hour")}).`, src: "Login telemetry" },
        { t: "Login latency", d: `Login completion time ${piFmt(g("login_time").current, "s")} (normal ${piFmt(g("login_time").baseline, "s")}); token service response ${piFmt(g("auth_latency").current, "ms")}.`, src: "Login telemetry" },
        { t: "Authentication server health", d: `Identity provider CPU ${piFmt(g("idp_cpu").current, "%")} and memory ${piFmt(g("idp_mem").current, "%")}: normal. ${log("L2")}`, src: "Auth servers" },
        { t: "Gateway errors", d: `Token service error rate ${piFmt(g("error_rate").current, "%")} against a normal ${piFmt(g("error_rate").baseline, "%")}.`, src: "API gateway" },
        { t: "System availability", d: `SSO availability ${piFmt(g("availability").current, "%")} (warning below ${piFmt(g("availability").warn, "%")}); synthetic login checks passing: ${piFmt(g("synth_login").current, "%")}.`, src: "Synthetic checks" },
      ],
      [
        { t: "Previous SSO incidents", d: `${h.similar} similar incidents in 90 days, ${h.disruptive} caused a disruption. Most recent: ${h.records.slice(0, 3).map((r) => `${r.id} ${r.title.replace(/^Identity & SSO: /, "")}`).join("; ")}.`, src: "Incident history" },
        { t: "Certificate rotation event", d: `${chg.id}: ${chg.title}, ${chg.t_hours} h before the alert. ${chg.detail}`, src: "Change records" },
        { t: "Error signature in the logs", d: log("L1"), src: "System logs" },
        { t: "Runbook on certificate rotation", d: `${ev.kb[0].id}: ${ev.kb[0].summary}`, src: "Knowledge base" },
        { t: "Historical pattern", d: `Repeat incidents on the SSO path: the same problem repeated up to ${h.max_cluster} times; average time to resolve ${h.mttr_hours} h.`, src: "Incident history" },
      ],
      [
        { t: "Abnormal failure spike", d: `Failed sign-ins rose from about ${piFmt(g("login_failures", base).current)} to ${piFmt(g("login_failures").current)} per hour while infrastructure stayed healthy.`, src: "Correlation" },
        { t: "Timestamps correlated", d: `The failures began after ${chg.id} (certificate rotation) completed, not after a traffic change.`, src: "Correlation" },
        { t: "Affected server identified", d: log("L3"), src: "Per-node split" },
        { t: "Why only some sign-ins fail", d: "One node in four is affected, which matches roughly one sign-in in four failing with a signature error.", src: "Correlation" },
      ],
      [
        { t: "Hypotheses proposed", d: s.hypotheses.map((x, i) => `H${i + 1}: ${x.title}`).join(" · "), src: "Hypothesis Agent" },
        { t: "Critic challenge", d: s.critic.join(" "), src: "Critic Agent" },
        { t: "Certificate inventory checked", d: log("L4"), src: "Evidence (round 2)" },
        { t: "Root cause", d: s.root_cause, src: "Judge + RCA Writer", strong: true },
      ],
      [
        { t: "Diagnostic steps", d: "Confirm the signing-certificate thumbprint served by each node; compare with the thumbprint published in the rotation change.", src: "SOP Agent" },
        ...s.remediation.map((r, i) => ({ t: `Step ${i + 1}`, d: r.step, src: "SOP Agent" })),
        { t: "Rollback", d: s.rollback, src: "SOP Agent" },
      ],
      [
        { t: "Post-fix failure rate", d: `${m.name}: ${m.before} → ${m.after}${m.unit} (threshold ${m.threshold}${m.unit}).`, src: "Verification Agent" },
        { t: "Service health", d: "All four identity provider nodes sign tokens with the new certificate; synthetic login checks pass again.", src: "Verification Agent" },
        { t: "Prevention", d: s.prevention.join(" "), src: "Closure Agent" },
        { t: "Final status", d: "Resolved. In Controlled Demo Mode nothing is written to ServiceNow.", src: "Closure Agent", strong: true },
      ],
    ],
  };
}

// ------------------------------------------------------- live builder
function ssoLivePred() { return PI.preds.find((p) => p.sid === "sso" && p.mode === "live" && p.status !== "Superseded") || null; }
function ssoLiveData() {
  const p = ssoLivePred(); if (!p) return null;
  const run = p.incident && WB.runs[p.incident.incId];
  const N = (o, k) => (o && o.nodes && o.nodes[k]) || null;
  const st = (...ns) => { const list = ns.filter(Boolean); if (!list.length) return "pending"; if (list.some((n) => n.status === "failed")) return "failed"; if (list.some((n) => n.status === "running")) return "running"; return list.every((n) => n.status === "done") ? "done" : "running"; };
  const tools = (n, srcName) => (n ? n.tools.map((t) => ({ t: t.name, d: t.summary || t.error || "", src: t.source === "live" ? "Live ServiceNow" : t.source === "rules" ? "Rules" : t.source === "simulated" ? "Simulated" : t.source, ok: t.status === "ok" })) : []);
  const agentOut = (n, label, f) => (n && n.output ? [{ t: label, d: f(n.output), src: n.source === "llm" ? `AI agent (${n.model || "live"})` : n.source === "scripted" ? "Scripted" : "Rules" }] : []);
  const mon = N(p, "monitor"), his = N(p, "history"), pre = N(p, "predict");
  const ev = N(run, "evidence"), hyp = N(run, "hypothesis"), cri = N(run, "critic"), jud = N(run, "judge"), rca = N(run, "rca"), sop = N(run, "sop"), exe = N(run, "execution"), ver = N(run, "verification"), clo = N(run, "closure");
  const stages = [
    { status: st(mon), events: [...tools(mon), ...(p.readings || []).map((m) => ({ t: m.name, d: `${piFmt(m.current, m.unit)} now; 7-day normal ${piFmt(m.baseline, m.unit)}; ${m.status}.`, src: m.source === "live" ? "Live ServiceNow" : "Simulated" })), ...agentOut(mon, "Monitoring Agent", (o) => o.summary)] },
    { status: st(his, ev), events: [...tools(his), ...agentOut(his, "Historical Incident Analysis Agent", (o) => `${o.summary} ${wbArr(o.patterns).join("; ")}`), ...tools(ev), ...(run ? run.evidence.filter((e) => /Live/.test(e.label || "")).slice(0, 6).map((e) => ({ t: e.id, d: e.text, src: "Live ServiceNow" })) : [])] },
    { status: st(pre), events: [...tools(pre), ...(p.risk ? [...p.risk.contributions].filter((c) => !c.na).sort((a, b) => b.points - a.points).slice(0, 4).map((c) => ({ t: `${c.label}: ${c.points} points`, d: c.value, src: "Rules" })) : []), ...agentOut(pre, "Predictive Intelligence Agent", (o) => o.explanation)] },
    { status: run ? st(hyp, cri, jud, rca) : "pending", events: run ? [...agentOut(hyp, "Hypotheses", (o) => wbArr(o.hypotheses).map((h) => `${h.id}: ${h.title} (${Number(h.confidence).toFixed(2)})`).join(" · ")), ...agentOut(cri, "Critic", (o) => o.overall || ""), ...agentOut(jud, "Judge decision", (o) => `${o.decision} · ${o.selected_title || ""} · confidence ${Number(o.confidence || 0).toFixed(2)}`), ...agentOut(rca, "Root cause", (o) => o.root_cause)] : [] },
    { status: run ? st(sop, N(run, "sop_approval"), exe) : "pending", events: run ? [...agentOut(sop, "SOP", (o) => wbArr(o.steps).map((x, i) => `${i + 1}. ${x.action}`).join(" ")), ...run.approvals.map((a) => ({ t: `${a.gate.toUpperCase()} ${a.decision.replace("_", " ")}`, d: `${a.approver} · ${stamp(a.at)}${a.feedback ? ` · "${a.feedback}"` : ""} · recorded ${a.recorded}`, src: "Human" })), ...agentOut(exe, "Execution", (o) => `${o.executed} executed, ${o.manual} manual, ${o.retries} retries (simulated execution handler)`)] : [] },
    { status: run ? st(ver, clo) : "pending", events: run ? [...tools(ver), ...agentOut(clo, "Closure", (o) => o.resolution_summary), ...(run.snResult ? [{ t: "ServiceNow", d: run.snResult.written ? `Resolved and read back: ${run.snResult.readback.state}` : run.snResult.reason || run.snResult.error || "", src: run.snResult.written ? "Live ServiceNow" : "Not written" }] : [])] : [] },
  ];
  return { p, run, stages };
}

// ------------------------------------------------------- playback (demo)
function ssoStopTimer() { clearTimeout(ssoTimer); ssoTimer = null; }
function ssoTick(manual) {
  const S = UI.sso; const d = ssoDemoData();
  if (!manual && (!S.playing || route().split("/")[0] !== "sso-investigation")) { S.playing = false; ssoStopTimer(); return; }
  let delay = 900;
  if (S.stage === 0) { S.stage = 1; S.shown = { 1: 0 }; }
  const evs = d.stages[S.stage - 1];
  if ((S.shown[S.stage] || 0) < evs.length) S.shown[S.stage] = (S.shown[S.stage] || 0) + 1;
  else if (S.stage === 5 && !S.approved) { S.playing = false; }
  else if (S.stage < 6) { S.stage += 1; S.shown[S.stage] = 0; S.view = null; delay = 1300; }
  else S.playing = false;
  render();
  ssoStopTimer();
  if (S.playing && !manual) ssoTimer = setTimeout(() => ssoTick(false), delay);
}
function ssoPlay() { const S = UI.sso; if (S.stage === 6 && (S.shown[6] || 0) >= ssoDemoData().stages[5].length) ssoReset(); S.playing = true; ssoTick(false); }
function ssoReset() { ssoStopTimer(); UI.sso = { stage: 0, shown: {}, playing: false, approved: false, view: null }; render(); }

// ------------------------------------------------------- data-flow canvas
const SSO_SRC = [{ k: "auth", l: "Auth servers", s: "idp-node-1 … 4", st: 1 }, { k: "gw", l: "API gateway", s: "Token service errors", st: 1 }, { k: "tele", l: "Login telemetry", s: "Success, latency, checks", st: 1 }, { k: "inc", l: "Incident history", s: "Past SSO incidents", st: 2 }, { k: "chg", l: "Change records", s: "Certificate rotation", st: 2 }, { k: "log", l: "System logs", s: "Error signatures", st: 2 }];
const SSO_OUT = [{ k: "pattern", l: "Pattern", s: "Spike on one node", st: 3 }, { k: "rca", l: "Root cause", s: "Old signing certificate", st: 4 }, { k: "fix", l: "Remediation", s: "Drain, restart, return", st: 5 }, { k: "ver", l: "Verification", s: "Before vs after", st: 6 }];
function ssoCanvas(stage, nodeState, status) {
  const motion = !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const sy = (i) => 14 + i * 48; const oy = (i) => 30 + i * 66;
  const edge = (d, active, done, col) => `<path d="${d}" fill="none" stroke="${active ? col : done ? col : "#d4d4dc"}" stroke-width="${active ? 2.2 : 1.4}" ${active || done ? "" : 'stroke-dasharray="4 4"'} opacity="${done && !active ? 0.55 : 1}"/>${active && motion ? [0, 0.6, 1.2].map((b) => `<circle r="3.6" fill="${col}"><animateMotion dur="1.8s" begin="${b}s" repeatCount="indefinite" path="${d}"/></circle>`).join("") : ""}`;
  const stageOf = (s) => (status ? status[s - 1] : stage > s ? "done" : stage === s ? "running" : "pending");
  const srcEdges = SSO_SRC.map((x, i) => { const y = sy(i) + 17; const ss = stageOf(x.st); return edge(`M190 ${y} C 280 ${y}, 270 150, 360 150`, ss === "running", ss === "done", x.st === 1 ? "#0a5c9e" : "#0e9f8e"); }).join("");
  const outEdges = SSO_OUT.map((x, i) => { const y = oy(i) + 17; const ss = stageOf(x.st); return edge(`M540 150 C 620 150, 620 ${y}, 710 ${y}`, ss === "running", ss === "done", x.st === 4 ? "#e5484d" : x.st === 6 ? "#22c55e" : "#d08a1e"); }).join("");
  const box = (x, y, w, h, l, s, fill, stroke) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/><text class="lbl" x="${x + 12}" y="${y + 16}">${esc(l)}</text><text class="sub" x="${x + 12}" y="${y + 28}">${esc(s)}</text>`;
  const srcs = SSO_SRC.map((x, i) => { const ss = stageOf(x.st); return box(20, sy(i), 170, 34, x.l, x.s, ss === "running" ? "#e8f3fb" : "#fff", ss === "pending" ? "#dededf" : "#0a5c9e"); }).join("");
  const dots = nodeState.map((st, i) => `<circle cx="${130 + i * 13}" cy="${sy(0) + 9}" r="4.5" fill="${{ critical: "#e5484d", healthy: "#22c55e", degraded: "#f5b544", unknown: "#c4c4cc" }[st]}"><title>idp-node-${i + 1}: ${st}</title></circle>`).join("");
  const outs = SSO_OUT.map((x, i) => { const ss = stageOf(x.st); return box(710, oy(i), 170, 34, x.l, x.s, ss === "done" ? "#f3fbf5" : ss === "running" ? "#fffaf0" : "#fff", ss === "pending" ? "#dededf" : ss === "done" ? "#22c55e" : "#d08a1e"); }).join("");
  const cur = SSO_STAGES[Math.max(0, stage - 1)];
  return `<svg viewBox="0 0 900 304" role="img" aria-label="Data flowing from source systems into the intelligence engine and on to its findings">${srcEdges}${outEdges}${srcs}${dots}
    <rect x="360" y="105" width="180" height="90" rx="12" fill="${stage ? "#1d1d27" : "#f6f6f8"}" stroke="#1d1d27" stroke-width="1.4"/><text x="450" y="135" text-anchor="middle" style="font:600 12.5px var(--sans);fill:${stage ? "#fff" : "#1d1d27"}">AURA intelligence engine</text><text x="450" y="155" text-anchor="middle" style="font:400 11px var(--sans);fill:${stage ? "#c9c9f3" : "#6b7280"}">${stage ? esc(cur.title) : "Waiting to start"}</text><text x="450" y="174" text-anchor="middle" style="font:400 10px var(--sans);fill:${stage ? "#a3a3ad" : "#8e8e9a"}">Rules + sequential agents</text>
    ${outs}</svg>`;
}

// ------------------------------------------------------- page
function ssoCharts(stageIdx, d) {
  if (stageIdx === 1) { const f = d.sig.find((x) => x.key === "login_failures"); const t = d.sig.find((x) => x.key === "login_time"); return `<div class="pi-charts" style="margin-top:8px"><div class="card pad pi-chart"><p class="sec-title">${icon("activity")} Failed sign-ins, last 2 hours</p>${piLineChart(f.series.map((_, i) => `${-115 + i * 5}m`), [{ name: "Failed sign-ins/hour", color: "#e5484d", values: f.series }], { label: "Failed sign-ins", h: 150, note: "Demo / simulated" })}</div><div class="card pad pi-chart"><p class="sec-title">${icon("clock")} Login completion time (s)</p>${piLineChart(t.series.map((_, i) => `${-115 + i * 5}m`), [{ name: "Seconds", color: "#0a5c9e", values: t.series }], { label: "Login time", h: 150, note: "Demo / simulated" })}</div></div>`; }
  if (stageIdx === 3) return `<div class="card pad pi-chart" style="margin-top:8px"><p class="sec-title">${icon("server")} Failed sign-ins by identity provider node (last hour)</p>${piBarChart(d.nodes.map((n) => n.id), [{ name: "Failed sign-ins", color: "#e5484d", values: d.nodes.map((n) => n.fail) }], { label: "Per-node failures", h: 150, note: "Demo / simulated per-node split" })}</div>`;
  if (stageIdx === 6) return `<div class="card pad pi-chart" style="margin-top:8px"><p class="sec-title">${icon("shield")} Before and after remediation</p>${piBarChart(["Failed sign-ins/hour", "Login success %"], [{ name: "Before", color: "#e5484d", values: [d.m.before, d.sig.find((x) => x.key === "login_success").current] }, { name: "After", color: "#22c55e", values: [d.m.after, d.base.find((x) => x.key === "login_success").current] }], { label: "Before and after", h: 150, note: "Demo / simulated" })}</div>`;
  return "";
}
function ssoEventCards(list, newest, srcKind) {
  if (!list.length) return `<p style="font-size:12.5px;color:var(--ink-muted);margin:8px 0 0">${srcKind === "live" ? "No real events for this stage yet." : "Press Play to start."}</p>`;
  return list.map((e, i) => `<div class="${i === newest ? "sso-new" : ""}">${ccEvidence(`<b style="font-weight:${e.strong ? 600 : 500}">${esc(e.t)}</b>`, esc(e.d), { open: e.strong || i === newest, tag: `<span class="note-r" style="margin-left:6px">${esc(e.src)}</span>` })}</div>`).join("");
}
function pageSsoInvestigation() {
  const live = wbMode() === "live";
  return live ? ssoLivePage() : ssoDemoPage();
}
function ssoHeader(kind) {
  return `${head("SSO investigation", "How the intelligence layer detects a Workforce SSO disruption: it collects telemetry, retrieves history, finds the pattern, identifies the root cause, plans the fix for human approval, and verifies the result.", "Predictive Intelligence", wbModePill())}
  <div class="sso-banner ${kind}">${kind === "demo" ? `${ccSrc("demo")} <span><b>Demo walkthrough.</b> Deterministic sample data from the SSO scenario. Nothing is read from or written to real systems. Switch to Live Agent mode to see real execution events.</span>` : `${ccSrc("live")} <span><b>Live.</b> Built only from real execution events: the live SSO sign-in signal, real agent calls and, once IT raises an investigation, the RCA workflow run. Stages without real events stay empty.</span>`}</div>`;
}
function ssoStageBar(statuses, sel, clickable) {
  return `<div class="sso-stages" style="margin-top:12px">${SSO_STAGES.map((s, i) => { const st = statuses[i]; const cls = st === "done" ? "done" : st === "running" ? "active" : ""; return `<button class="sso-stage ${cls} ${sel === i + 1 ? "sel" : ""}" data-act="sso-view" data-s="${i + 1}" ${clickable(i + 1) ? "" : "disabled"}><span class="n">${st === "done" ? icon("check") : i + 1}</span><span><span class="t">${esc(s.title)}</span><br><span class="s">${esc(s.sub)}</span></span></button>`; }).join("")}</div>`;
}
function ssoDemoPage() {
  const S = UI.sso; const d = ssoDemoData();
  const statuses = SSO_STAGES.map((_, i) => (S.stage > i + 1 || (S.stage === i + 1 && (S.shown[i + 1] || 0) >= d.stages[i].length && !(i === 4 && !S.approved)) ? "done" : S.stage === i + 1 ? "running" : "pending"));
  const sel = S.view || S.stage || 1;
  const shown = sel < S.stage ? d.stages[sel - 1].length : S.shown[sel] || 0;
  const evs = d.stages[sel - 1].slice(0, shown);
  const verified = S.stage === 6 && (S.shown[6] || 0) >= 2;
  const nodeState = [0, 1, 2, 3].map((i) => (i === 2 && S.stage >= 3 && !verified ? "critical" : "healthy"));
  const timeline = SSO_STAGES.flatMap((s, i) => d.stages[i].slice(0, i + 1 < S.stage ? 99 : S.stage === i + 1 ? S.shown[i + 1] || 0 : 0).map((e) => ({ at: null, stage: s.title, ...e })));
  const done = S.stage === 6 && (S.shown[6] || 0) >= d.stages[5].length;
  const canApprove = psCan("wb.incident");
  return `${ssoHeader("demo")}
  <div class="card pad" style="margin-top:12px"><div class="sec-head"><p class="sec-title">${icon("network")} Data flow</p>
    <div class="wb-ctrl">${S.playing ? `<button class="btn" data-act="sso-pause">${icon("pause")} Pause</button>` : `<button class="btn primary" data-act="sso-play" ${S.stage === 5 && !S.approved && (S.shown[5] || 0) >= d.stages[4].length ? "disabled" : ""}>${icon("play")} ${S.stage === 0 ? "Play investigation" : done ? "Replay" : "Resume"}</button>`}<button class="btn" data-act="sso-step" ${S.playing || done || (S.stage === 5 && !S.approved && (S.shown[5] || 0) >= d.stages[4].length) ? "disabled" : ""}>${icon("skip")} Step</button><button class="btn ghost" data-act="sso-reset">${icon("rotate")} Reset</button></div></div>
    ${ssoStageBar(statuses, sel, (n) => n <= Math.max(1, S.stage))}
    <div class="sso-canvas" style="margin-top:12px">${ssoCanvas(S.stage, nodeState, null)}</div>
    <div class="pi-legend"><span><i style="background:#0a5c9e"></i>Telemetry flowing in</span><span><i style="background:#0e9f8e"></i>Historical evidence retrieved</span><span><i style="background:#e5484d"></i>Root cause / affected node</span><span><i style="background:#22c55e"></i>Verified</span><span style="color:var(--ink-muted)">Dots on the auth servers box: idp-node-1 to 4</span></div></div>
  <div class="sso-split">
    <div class="card pad"><div class="sec-head"><p class="sec-title">${icon(SSO_STAGES[sel - 1].icon)} Stage ${sel}: ${esc(SSO_STAGES[sel - 1].title)}</p>${ccSrc("demo")}</div>
      ${ssoEventCards(evs, S.view ? -1 : evs.length - 1, "demo")}
      ${sel === 5 && shown >= d.stages[4].length ? `<div class="sso-approve ${S.approved ? "ok" : ""}"><b style="font-size:13px">${icon("usercheck")} Human approval before production remediation</b><p style="font-size:12.5px;margin:4px 0 8px;color:var(--ink-soft)">${S.approved ? "Approved by the IT engineer (demo). Remediation runs, then verification." : "The investigation stops here until the IT engineer approves. In the real workflow this is the RCA and SOP approval gates, checked by role on the backend."}</p>${S.approved ? "" : canApprove ? `<button class="btn primary" data-act="sso-approve">${icon("check")} Approve remediation (demo)</button>` : `<button class="btn" data-act="ps-switch" data-p="engineer" data-r="sso-investigation">${icon("user")} Continue as the IT engineer</button>`}</div>` : ""}
      ${ssoCharts(sel, d)}</div>
    <div class="card pad"><div class="sec-head"><p class="sec-title">${icon("history")} Investigation timeline</p><span class="note-r">${timeline.length} event(s)</span></div>
      ${timeline.length ? `<ul class="cc-act">${timeline.map((e) => `<li><span class="dt ${e.strong ? "bad" : "info"}"></span><div><b style="font-weight:500">${esc(e.t)}</b><div style="font-size:11.5px;color:var(--ink-muted)">${esc(e.stage)} · ${esc(e.src)}</div></div><span class="w"></span></li>`).join("")}</ul>` : `<p style="font-size:12.5px;color:var(--ink-muted);margin:8px 0 0">Press <b>Play investigation</b> to watch the agents work through the six stages.</p>`}
      ${done ? `<div class="sso-approve ok"><b style="font-size:13px">${icon("check")} Resolved (demo)</b><p style="font-size:12.5px;margin:4px 0 0;color:var(--ink-soft)">To run the same investigation for real, switch to Live Agent mode: send failed sign-ins, run the predictive agents and initiate an investigation.</p></div>` : ""}</div>
  </div>
  ${simnote("Demo walkthrough built from the synthetic SSO scenario (the same evidence the scripted agents use). Per-node figures, telemetry and the remediation are simulated; no system is changed.")}`;
}
function ssoLivePage() {
  const L = ssoLiveData();
  if (!L) return `${ssoHeader("live")}<div class="card pad" style="margin-top:12px"><p class="sec-title">${icon("info")} No live SSO investigation yet</p><p style="font-size:12.5px;color:var(--ink-soft);margin:6px 0 10px">Live mode only shows real events. To create them: send real failed sign-ins (a made-up account, nobody is locked out), wait about a minute for ServiceNow to log them, then run the predictive agents.</p><div class="wb-ctrl">${psCan("pi.run") ? `<button class="btn" data-act="pi-drill">${icon("zap")} Send ${PI_LIVE_SSO.drill_count} failed sign-ins</button><button class="btn primary" data-act="pi-run" data-s="sso">${icon("bot")} Run predictive agents</button>` : `<span class="note-r">Running the predictive agents belongs to the IT administrator.</span>`}</div>${UI.pi.drill && UI.pi.drill !== "busy" ? `<p style="font-size:12px;color:var(--ink-soft);margin:8px 0 0">${esc(UI.pi.drill)}</p>` : ""}</div>${simnote("Live mode never fabricates missing events.")}`;
  const statuses = L.stages.map((s) => s.status);
  const cur = statuses.findIndex((s) => s !== "done"); const stage = cur < 0 ? 6 : cur + 1;
  const sel = UI.sso.view || stage;
  const st = L.stages[sel - 1];
  const nodeState = [0, 1, 2, 3].map(() => "unknown");
  const p = L.p; const run = L.run;
  return `${ssoHeader("live")}
  <div class="card pad" style="margin-top:12px"><div class="sec-head"><p class="sec-title">${icon("network")} Data flow · <a href="#/predictive/p/${encodeURIComponent(p.id)}" style="color:var(--brand)">${esc(p.id)}</a></p><span class="note-r">${p.score != null ? `Risk ${p.score}/100 ${esc(p.cls)} · ` : ""}${esc(p.status)}${run ? ` · incident ${esc(run.sn && run.sn.number ? run.sn.number : run.incId)}` : " · no investigation raised yet"}</span></div>
    ${ssoStageBar(statuses, sel, () => true)}
    <div class="sso-canvas" style="margin-top:12px">${ssoCanvas(stage, nodeState, statuses)}</div>
    <div class="pi-legend"><span><i style="background:#c4c4cc"></i>Per-node health: no per-node telemetry in live mode (only instance-wide sign-in counts)</span></div></div>
  <div class="sso-split">
    <div class="card pad"><div class="sec-head"><p class="sec-title">${icon(SSO_STAGES[sel - 1].icon)} Stage ${sel}: ${esc(SSO_STAGES[sel - 1].title)}</p>${badge(st.status === "done" ? "good" : st.status === "running" ? "running" : st.status === "failed" ? "critical" : "info", st.status)}</div>
      ${ssoEventCards(st.events, -1, "live")}
      ${sel >= 4 && !run ? `<p style="font-size:12.5px;color:var(--ink-soft);margin:10px 0 0">Stages 4 to 6 start when IT raises an investigation from the prediction (<b>Initiate investigation</b>). The RCA workflow then runs with its engineer approval gates.</p>${psCanRoute("predictive") ? `<a class="btn" style="margin-top:8px" href="#/predictive/p/${encodeURIComponent(p.id)}">${icon("arrow")} Open prediction</a>` : ""}` : ""}
      ${sel === 5 && run ? `<div class="sso-approve ${run.approvals.some((a) => a.gate === "sop" && a.decision === "approve") ? "ok" : ""}"><b style="font-size:13px">${icon("usercheck")} Human approval</b><p style="font-size:12.5px;margin:4px 0 8px;color:var(--ink-soft)">${run.gate ? `Waiting at: ${esc(psGateLabel(run.gate.type))}.` : `${run.approvals.length} decision(s) recorded.`}</p>${psCanRoute("workbench") ? `<a class="btn" href="#/workbench/${encodeURIComponent(run.incId)}">${icon("arrow")} Open the RCA workflow</a>` : ""}</div>` : ""}</div>
    <div class="card pad"><div class="sec-head"><p class="sec-title">${icon("history")} Execution events</p><span class="note-r">Real events only</span></div>
      ${ccActivity([...(p.events || []).map((e) => ({ ...e, ref: p.id })), ...(run ? run.events.map((e) => ({ ...e, ref: run.incId })) : [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 18))}</div>
  </div>
  ${simnote("Live view: sign-in counts come from the POC ServiceNow instance; agent outputs are real LLM calls; SOP execution is simulated in this POC. Stages appear only when the corresponding real step has run.")}`;
}
const SSO_ACTIONS = {
  "sso-play": () => ssoPlay(),
  "sso-pause": () => { UI.sso.playing = false; ssoStopTimer(); render(); },
  "sso-step": () => { UI.sso.view = null; ssoTick(true); },
  "sso-reset": () => ssoReset(),
  "sso-view": (el) => { UI.sso.view = +el.dataset.s; render(); },
  "sso-approve": () => { UI.sso.approved = true; UI.sso.playing = true; render(); ssoTimer = setTimeout(() => ssoTick(false), 700); },
};
</script>
