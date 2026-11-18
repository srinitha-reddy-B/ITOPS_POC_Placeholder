<style>
.gr-wrap{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(300px,1fr);gap:12px;align-items:start}
@media (max-width:1150px){.gr-wrap{grid-template-columns:1fr}}
.gr-svg>svg{width:100%;height:auto;display:block}
.gr-svg .nd{cursor:pointer}
.gr-svg .nd:focus{outline:none}
.gr-svg .nd:focus rect,.gr-svg .nd.sel rect{stroke:#1d1d27;stroke-width:2.6}
.gr-svg .nm{font:600 11.5px var(--sans);fill:#1d1d27}.gr-svg .st{font:400 10px var(--sans);fill:#6b7280}
</style>
<script>
"use strict";
/* =====================================================================
   Service dependency graph (frontend visualisation, no graph database).
   Two views:
   - SSO path: workforce users -> identity provider -> authentication
     servers -> API gateway -> enterprise applications and ServiceNow.
     Relationships are a labelled demo fixture; health comes from the SSO
     demo walkthrough / simulation, or from the live sign-in signal (live
     mode has no per-node telemetry, so nodes show "No telemetry").
   - Enterprise services: the 13-service map used by Predictive
     Intelligence, with health from the multi-signal simulation.
   ===================================================================== */
UI.gr = UI.gr || { view: "sso", sel: "n3" };
const GR_SSO = {
  nodes: [
    { id: "users", label: "Workforce users", sub: "Employees signing in", x: 20, y: 178, kind: "Users", owner: "All departments" },
    { id: "idp", label: "Identity provider (SSO)", sub: "Workforce SSO", x: 200, y: 178, kind: "Identity provider", owner: "Identity & Access Management" },
    { id: "n1", label: "idp-node-1", sub: "Auth server", x: 380, y: 30, kind: "Authentication server", owner: "Identity & Access Management" },
    { id: "n2", label: "idp-node-2", sub: "Auth server", x: 380, y: 128, kind: "Authentication server", owner: "Identity & Access Management" },
    { id: "n3", label: "idp-node-3", sub: "Auth server", x: 380, y: 228, kind: "Authentication server", owner: "Identity & Access Management" },
    { id: "n4", label: "idp-node-4", sub: "Auth server", x: 380, y: 326, kind: "Authentication server", owner: "Identity & Access Management" },
    { id: "gw", label: "API gateway", sub: "Token validation", x: 560, y: 178, kind: "API gateway", owner: "Cloud Platform Operations" },
    { id: "ec", label: "Employee Center", sub: "Enterprise app", x: 740, y: 30, kind: "Enterprise application", owner: "Cloud Platform Operations", uc: "IAM" },
    { id: "cw", label: "Claims Workbench", sub: "Enterprise app", x: 740, y: 128, kind: "Enterprise application", owner: "Claims Platform Engineering", uc: "CLM" },
    { id: "cm", label: "Care Management", sub: "Enterprise app", x: 740, y: 228, kind: "Enterprise application", owner: "Identity & Access Management", uc: "IAM" },
    { id: "sn", label: "ServiceNow", sub: "ITSM platform", x: 740, y: 326, kind: "IT service management", owner: "Service Desk" },
  ],
  edges: [["users", "idp"], ["idp", "n1"], ["idp", "n2"], ["idp", "n3"], ["idp", "n4"], ["n1", "gw"], ["n2", "gw"], ["n3", "gw"], ["n4", "gw"], ["gw", "ec"], ["gw", "cw"], ["gw", "cm"], ["gw", "sn"]],
};
const grNode = (g, id) => g.nodes.find((n) => n.id === id);
const grUp = (g, id, seen = new Set()) => { g.edges.filter((e) => e[1] === id).forEach((e) => { if (!seen.has(e[0])) { seen.add(e[0]); grUp(g, e[0], seen); } }); return seen; };
const grDown = (g, id, seen = new Set()) => { g.edges.filter((e) => e[0] === id).forEach((e) => { if (!seen.has(e[1])) { seen.add(e[1]); grDown(g, e[1], seen); } }); return seen; };

// ----------------------------------------------------------- SSO health
function grSsoState() {
  const live = wbMode() === "live";
  if (live) {
    const r = piReadings("sso"); const abn = r.some((m) => m.status === "warning" || m.status === "critical");
    const crit = r.some((m) => m.status === "critical");
    return { source: "live", abnormal: abn, readings: r, health: (id) => (/^n\d$/.test(id) ? "unknown" : id === "idp" ? (crit ? "critical" : abn ? "degraded" : "healthy") : ["gw", "ec", "cw", "cm", "sn"].includes(id) && abn ? "impacted" : "healthy") };
  }
  const S = UI.sso || { stage: 0, shown: {} };
  const story = S.stage >= 3 && !(S.stage === 6 && (S.shown[6] || 0) >= 2);
  const sim = msStep("sso") >= 2;
  const bad = story || (S.stage === 0 && sim);
  return { source: story ? "story" : "simulation", abnormal: bad, readings: msSignals("sso"), health: (id) => (!bad ? "healthy" : id === "n3" ? "critical" : id === "idp" ? "degraded" : ["gw", "ec", "cw", "cm", "sn", "users"].includes(id) ? "impacted" : "healthy") };
}

// ----------------------------------------------------------- renderer
function grRender(g, health, sel, hiSet) {
  const motion = !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const W = 160, H = 44;
  const col = { healthy: "#22c55e", normal: "#22c55e", degraded: "#f5b544", warning: "#f5b544", critical: "#e5484d", impacted: "#a78bfa", unknown: "#c4c4cc" };
  const fill = { healthy: "#f3fbf5", normal: "#f3fbf5", degraded: "#fffaf0", warning: "#fffaf0", critical: "#fdecec", impacted: "#f5f2ff", unknown: "#f6f6f8" };
  const anchor = (a, b) => {
    if (b.x > a.x + 20) { const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, m = (x1 + x2) / 2; return `M${x1} ${y1} C ${m} ${y1}, ${m} ${y2}, ${x2} ${y2}`; }
    const down = b.y > a.y; const x1 = a.x + W / 2, y1 = down ? a.y + H : a.y, x2 = b.x + W / 2, y2 = down ? b.y : b.y + H;
    return `M${x1} ${y1} L ${x2} ${y2}`;
  };
  const edges = g.edges.map(([s, t]) => {
    const a = grNode(g, s), b = grNode(g, t); const d = anchor(a, b); const hb = health(t); const ha = health(s);
    const bad = ["critical", "degraded", "warning"].includes(hb) || ["critical"].includes(ha);
    const c = ha === "critical" || hb === "critical" ? "#e5484d" : bad ? "#d08a1e" : "#0a5c9e";
    const hi = hiSet && hiSet.has(s) && hiSet.has(t);
    return `<path d="${d}" fill="none" stroke="${hi ? "#0a5c9e" : "#cfcfd8"}" stroke-width="${hi ? 2.6 : 1.4}"/>${motion && hb !== "unknown" ? [0, 0.9].map((bg) => `<circle r="3.2" fill="${c}" opacity=".9"><animateMotion dur="${ha === "critical" || hb === "critical" ? 1.1 : 2.6}s" begin="${bg}s" repeatCount="indefinite" path="${d}"/></circle>`).join("") : ""}`;
  }).join("");
  const nodes = g.nodes.map((n) => { const h = health(n.id); const hi = hiSet && hiSet.has(n.id); return `<g class="nd ${sel === n.id ? "sel" : ""}" data-act="gr-node" data-n="${n.id}" tabindex="0" role="button" aria-label="${esc(n.label)}: ${esc(ccHealthLabel(h))}"><rect x="${n.x}" y="${n.y}" width="${W}" height="${H}" rx="10" fill="${fill[h] || "#fff"}" stroke="${hi ? "#0a5c9e" : col[h] || "#dededf"}" stroke-width="${hi ? 2.6 : 1.4}"/><circle cx="${n.x + 14}" cy="${n.y + H / 2}" r="5" fill="${col[h] || "#c4c4cc"}">${h === "critical" && motion ? `<animate attributeName="r" values="5;7;5" dur="1.2s" repeatCount="indefinite"/>` : ""}</circle><text class="nm" x="${n.x + 26}" y="${n.y + 19}">${esc(n.label)}</text><text class="st" x="${n.x + 26}" y="${n.y + 33}">${esc(ccHealthLabel(h))}</text></g>`; }).join("");
  const maxX = Math.max(...g.nodes.map((n) => n.x)) + W + 20, maxY = Math.max(...g.nodes.map((n) => n.y)) + H + 20;
  return `<svg viewBox="0 0 ${maxX} ${maxY}" role="img" aria-label="Service dependency graph">${edges}${nodes}</svg>`;
}

// ----------------------------------------------------------- detail panels
function grIncidentsFor(words, uc) {
  const re = new RegExp(words.join("|"), "i");
  return ccIncidents().filter((i) => re.test(`${i.service} ${i.title}`) || (uc && i.use_case === uc && re.test(i.title))).slice(0, 4);
}
function grSsoDetail(id, S) {
  const g = GR_SSO; const n = grNode(g, id); const h = S.health(id);
  const sc = PI_SCEN.sso.rca; const ev = sc.evidence; const log = (x) => (ev.logs.concat(ev.deep).find((l) => l.id === x) || {}).text;
  const up = [...grUp(g, id)].map((x) => grNode(g, x).label); const down = [...grDown(g, id)].map((x) => grNode(g, x).label);
  const isNode = /^n\d$/.test(id);
  const metrics = id === "idp" ? S.readings.slice(0, 6).map((m) => `${m.name}: ${piFmt(m.current, m.unit)} (normal ${piFmt(m.baseline, m.unit)}) · ${m.status}`)
    : isNode ? (S.source === "live" ? ["No per-node telemetry in live mode: ServiceNow sign-in events are instance-wide counts."] : [`Failed sign-ins served (last hour, simulated): ${S.abnormal ? ({ n1: 0, n2: 1, n3: 44, n4: 0 })[id] : 0}`, "Health check: passing (simulated)"])
    : id === "gw" ? [`Token validation errors: ${S.abnormal ? "rising, signature failures from one upstream node" : "normal"} (simulated)`] : [];
  const incs = isNode || id === "idp" || id === "users" ? grIncidentsFor(["SSO", "sign", "identity", "authentic"], "IAM") : id === "sn" ? [] : grIncidentsFor([n.label.split(" ")[0]], n.uc);
  const preds = PI.preds.filter((p) => p.sid === "sso" && p.status !== "Superseded").slice(0, 3);
  const evidence = S.abnormal ? (id === "n3" ? [log("L3"), log("L4")] : id === "idp" ? [log("L1"), `${ev.changes[0].id}: ${ev.changes[0].title}`] : id === "gw" ? [log("L2")] : []) : [];
  const fix = S.abnormal && id === "n3" ? sc.script.remediation.map((r) => r.step) : S.abnormal && id === "idp" ? sc.script.prevention : [];
  return `<p class="sec-title" style="margin:0">${ccHealthDot(h, true)} ${esc(n.label)}</p><p style="font-size:12px;color:var(--ink-muted);margin:2px 0 0">${esc(n.kind)} · owner ${esc(n.owner)} · ${esc(ccHealthLabel(h))}</p>
    ${wbKv([["Depends on (upstream)", up.join(", ") || "None"], ["Used by (downstream)", down.join(", ") || "None"]])}
    ${metrics.length ? wbSec(`Health and metrics ${S.source === "live" ? ccSrc("live") : ccSrc("demo")}`, wbUl(metrics)) : ""}
    ${evidence.length ? wbSec("Collected evidence", wbUl(evidence)) : ""}
    ${fix.length ? wbSec(id === "n3" ? "Recommended remediation (needs engineer approval)" : "Recommended prevention", `<ol class="wb-ul" style="padding-left:18px">${fix.map((f) => `<li>${esc(f)}</li>`).join("")}</ol>`) : ""}
    ${wbSec("Related incidents", incs.length ? incs.map((i) => ccIncidentCard(i, { age: false })).join("") : `<p style="font-size:12.5px;margin:0;color:var(--ink-muted)">None tracked.</p>`)}
    ${preds.length && ["idp", "n1", "n2", "n3", "n4", "users"].includes(id) ? wbSec("Predictions", preds.map((p) => `<div style="font-size:12.5px;padding:3px 0">${psCanRoute("predictive") ? `<a href="#/predictive/p/${encodeURIComponent(p.id)}" style="color:var(--brand)">${esc(p.id)}</a>` : esc(p.id)} · ${p.score != null ? `${p.score} ${piClsBadge(p.cls)}` : ""} ${piStBadge(p.status)} · ${p.mode === "live" ? "live" : "demo"}</div>`).join("")) : ""}`;
}
function grEntDetail(id) {
  const n = MS_NODE[id]; const h = msNodeHealth(id);
  const up = [...msUp(id)].map((x) => MS_NODE[x].label); const down = [...msDown(id)].map((x) => MS_NODE[x].label);
  const sigs = n.scenario ? msSignals(n.scenario).filter((x) => x.status !== "normal") : [];
  const c = n.scenario ? msCorrelate(n.scenario) : null;
  const depts = msDeptsFor(msNodeApps(id));
  const preds = PI.preds.filter((p) => p.status !== "Superseded" && MS_DATA.scenarios[p.sid] && (MS_DATA.scenarios[p.sid].node === id || (p.ms ? p.ms.affected.includes(id) : false))).slice(0, 4);
  const incs = grIncidentsFor([n.label.split(" ")[0]], null);
  return `<p class="sec-title" style="margin:0">${ccHealthDot(h, true)} ${esc(n.label)}</p><p style="font-size:12px;color:var(--ink-muted);margin:2px 0 0">${esc(ccHealthLabel(h))} ${ccSrc("demo", "Simulated telemetry")}</p>
    ${wbKv([["Depends on (upstream)", up.join(", ") || "None"], ["Used by (downstream)", down.join(", ") || "None"], ["Departments", depts.length ? `${depts.reduce((a, g) => a + g.count, 0).toLocaleString()} employees in ${depts.length}` : "Shared platform"]])}
    ${sigs.length ? wbSec("Abnormal metrics", wbUl(sigs.slice(0, 6).map((x) => `${x.name}: ${piFmt(x.current, x.unit)} (normal ${piFmt(x.baseline, x.unit)}) · ${x.status}`))) : ""}
    ${c && c.hyp && sigs.length ? wbSec("Possible underlying issue", `<p style="font-size:12.5px;margin:0">${esc(c.hyp.text)}</p>`) : ""}
    ${c && c.recent && sigs.length ? wbSec("Suspected change (not confirmed)", `<p style="font-size:12.5px;margin:0">${esc(c.recent.id)}: ${esc(c.recent.title)}</p>`) : ""}
    ${sigs.length && c ? wbSec("Recommended action", `<p style="font-size:12.5px;margin:0">${esc((c.abn.reduce((a, b) => (b.dev > a.dev ? b : a)) || {}).action || PI_SCEN[n.scenario].actions[0])}</p>`) : ""}
    ${wbSec("Predictions", preds.length ? preds.map((p) => `<div style="font-size:12.5px;padding:3px 0">${psCanRoute("predictive") ? `<a href="#/predictive/p/${encodeURIComponent(p.id)}" style="color:var(--brand)">${esc(p.id)}</a>` : esc(p.id)} · ${p.score != null ? `${p.score} ${piClsBadge(p.cls)}` : ""} ${piStBadge(p.status)}</div>`).join("") : `<p style="font-size:12.5px;margin:0;color:var(--ink-muted)">None.</p>`)}
    ${wbSec("Related incidents", incs.length ? incs.map((i) => ccIncidentCard(i, { age: false })).join("") : `<p style="font-size:12.5px;margin:0;color:var(--ink-muted)">None tracked.</p>`)}`;
}

// ----------------------------------------------------------- page
function pageDependencyGraph() {
  const view = UI.gr.view;
  let graph, detail, legendNote;
  if (view === "sso") {
    const S = grSsoState(); if (!grNode(GR_SSO, UI.gr.sel)) UI.gr.sel = "n3";
    graph = grRender(GR_SSO, S.health, UI.gr.sel, null);
    detail = grSsoDetail(UI.gr.sel, S);
    legendNote = S.source === "live" ? `${ccSrc("live")} Health from the live ServiceNow sign-in signal; no per-node telemetry` : S.source === "story" ? `${ccSrc("demo")} Health follows the SSO demo walkthrough` : `${ccSrc("demo")} Health follows the simulated SSO signals (Multi-signal monitoring)`;
  } else {
    if (!MS_NODE[UI.gr.sel]) UI.gr.sel = "claimsapi";
    const hp = piPred(UI.ms.mapPred);
    const hi = hp ? new Set(hp.ms ? hp.ms.affected : MS_DATA.scenarios[hp.sid] ? [MS_DATA.scenarios[hp.sid].node, ...msDown(MS_DATA.scenarios[hp.sid].node)] : []) : null;
    const g = { nodes: MS_DATA.graph.nodes.map((n) => ({ ...n, x: n.x + 10, y: n.y })), edges: MS_DATA.graph.edges };
    graph = grRender(g, msNodeHealth, UI.gr.sel, hi);
    detail = grEntDetail(UI.gr.sel);
    legendNote = `${ccSrc("demo")} ${esc(MS_DATA.graph.note)}`;
  }
  return `${head("Service dependency graph", "How services depend on each other, where a problem starts and what it affects. Click a service for its health, evidence, related incidents and recommended remediation.", "AIOps", wbModePill())}
  <div class="ms-chips"><button class="ms-chip ${view === "sso" ? "on" : ""}" data-act="gr-view" data-v="sso">Workforce SSO path</button><button class="ms-chip ${view === "ent" ? "on" : ""}" data-act="gr-view" data-v="ent">Enterprise services</button>
    ${view === "ent" ? `<select class="sel" id="ms-mappred" style="height:32px;font-size:12px;margin-left:auto"><option value="">Highlight a prediction…</option>${piActive().map((p) => `<option value="${esc(p.id)}" ${p.id === UI.ms.mapPred ? "selected" : ""}>${esc(PI_SCEN[p.sid].short)} · ${p.score != null ? p.score : "—"} ${esc(p.cls || "")}</option>`).join("")}</select>` : psCanRoute("sso-investigation") ? `<a class="btn ghost" style="margin-left:auto" href="#/sso-investigation">${icon("play")} Open the SSO investigation</a>` : ""}</div>
  <div class="gr-wrap"><div class="card pad gr-svg"><div class="sec-head"><p class="sec-title">${icon("network")} ${view === "sso" ? "Workforce SSO path" : "Enterprise services"}</p><span class="note-r">Moving dots show requests flowing; red and faster means failing</span></div>${graph}
    <div class="pi-legend"><span><i style="background:#22c55e"></i>Healthy</span><span><i style="background:#f5b544"></i>Degraded</span><span><i style="background:#e5484d"></i>Critical</span><span><i style="background:#a78bfa"></i>Impacted upstream</span><span><i style="background:#c4c4cc"></i>No telemetry</span>${view === "ent" ? `<span><i style="background:#0a5c9e"></i>Highlighted prediction</span>` : ""}</div>
    <p style="font-size:11.5px;color:var(--ink-muted);margin:6px 0 0">${legendNote}</p></div>
    <div class="card pad">${detail}</div></div>
  ${simnote("Frontend visualisation of synthetic service relationships (not read from a CMDB, no graph database). Health is simulated telemetry, except the live SSO sign-in signal in Live Agent Mode.")}`;
}
const GR_ACTIONS = {
  "gr-view": (el) => { UI.gr.view = el.dataset.v; UI.gr.sel = el.dataset.v === "sso" ? "n3" : "claimsapi"; render(); },
  "gr-node": (el) => { UI.gr.sel = el.dataset.n; render(); },
};
</script>
