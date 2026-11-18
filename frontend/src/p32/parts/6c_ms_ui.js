<style>
.ms-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.ms-chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line-strong);border-radius:999px;background:var(--surface);padding:5px 12px;font:inherit;font-size:12.5px;cursor:pointer;color:var(--ink)}
.ms-chip.on{background:var(--ink);border-color:var(--ink);color:#fff}
.ms-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none;background:#22c55e}
.ms-dot.warning{background:#f5b544}.ms-dot.critical{background:#e5484d}.ms-dot.impacted{background:#a78bfa}
.ms-steps{display:flex;gap:4px;margin:10px 0 2px}
.ms-steps span{flex:1;height:6px;border-radius:99px;background:var(--hover)}
.ms-steps span.on{background:#22c55e}.ms-steps span.on.s2{background:#f5b544}.ms-steps span.on.s3{background:#f08a3c}.ms-steps span.on.s4{background:#e5484d}
.ms-steplab{display:flex;justify-content:space-between;font-size:10.5px;color:var(--ink-muted)}
.ms-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.ms-card{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--surface);display:flex;flex-direction:column;gap:4px;border-top:3px solid #22c55e}
.ms-card.warning{border-top-color:#f5b544}.ms-card.critical{border-top-color:#e5484d}
.ms-card .nm{font-size:12px;font-weight:500;line-height:1.3}
.ms-card .cur{font-size:22px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.ms-card .meta{font-size:11px;color:var(--ink-muted);display:flex;flex-wrap:wrap;gap:2px 8px}
.ms-card .act{font-size:11.5px;color:var(--ink-soft);border-top:1px solid var(--line);padding-top:5px;margin-top:2px}
.ms-cat{margin-top:14px}
.ms-cat>.h{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.ms-cat>.h svg{width:15px;height:15px}
.ms-corr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px}
@media (max-width:900px){.ms-corr{grid-template-columns:1fr}}
.ms-kv{border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:12.5px;line-height:1.5}
.ms-kv .eyebrow{display:block;margin-bottom:2px}
.ms-meas{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
@media (max-width:1000px){.ms-meas{grid-template-columns:repeat(2,minmax(0,1fr))}}
.ms-meas>div{border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.ms-meas b{display:block;font-size:15px;margin-top:2px}
.ms-meas span{font-size:11px;color:var(--ink-muted)}
.ms-why{border:1px solid #c9c9f3;background:var(--brand-soft);border-radius:12px;padding:12px 14px}
.ms-ev{display:grid;grid-template-columns:88px minmax(0,1fr) auto;gap:8px;align-items:start;padding:7px 0;border-bottom:1px solid var(--line);font-size:12.5px}
.ms-ev:last-child{border-bottom:0}
.ms-map>svg{width:100%;height:auto;display:block}
.ms-map .nd{cursor:pointer}
.ms-map .nd rect{stroke-width:1.5}
.ms-map .nd.sel rect{stroke:#1d1d27;stroke-width:3}
.ms-wi{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:12px;align-items:start}
@media (max-width:1000px){.ms-wi{grid-template-columns:1fr}}
.ms-sl{padding:9px 0;border-bottom:1px solid var(--line)}
.ms-sl:last-child{border-bottom:0}
.ms-sl .top{display:flex;justify-content:space-between;gap:8px;font-size:12.5px}
.ms-sl input[type=range]{width:100%;accent-color:var(--brand)}
.ms-sl .lim{display:flex;justify-content:space-between;font-size:10.5px;color:var(--ink-muted)}
.ms-life{display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:11.5px}
.ms-life span{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:2px 8px;background:var(--hover);color:var(--ink-muted)}
.ms-life span.d{background:var(--ok-soft);color:var(--ok)}
.ms-life span.x{background:var(--danger-soft);color:var(--danger)}
.ms-life i{color:var(--ink-faint);font-style:normal}
.ms-funnel{display:flex;flex-wrap:wrap;gap:6px;align-items:stretch}
.ms-funnel>div{flex:1;min-width:110px;border:1px solid var(--line);border-radius:10px;padding:8px 10px;text-align:center}
.ms-funnel b{display:block;font-size:20px}
.ms-funnel span{font-size:11px;color:var(--ink-muted)}
.subtabs{overflow-x:auto;scrollbar-width:thin}
</style>
<script>
"use strict";
/* ------------------------------------------- multi-signal UI helpers */
UI.ms = { mapNode: null, mapPred: "", assoc: "", disKind: "not_real" };
const msSt = (st) => ({ critical: "critical", warning: "warning", normal: "good", impacted: "info" }[st] || "info");
const msStepBar = (step) => `<div class="ms-steps">${[0, 1, 2, 3, 4].map((i) => `<span class="${i <= step ? `on s${step}` : ""}"></span>`).join("")}</div><div class="ms-steplab">${MS_STEPS.map((l) => `<span>${l}</span>`).join("")}</div>`;
const msCalcTag = `<span class="wb-src rules">Calculated</span>`;
function msTrendChart(m, h = 70) {
  const W = 220, H = h, P = 4; const vals = m.series || [m.current];
  const lo = Math.min(...vals, m.baseline, m.better === "higher" ? m.crit : m.baseline), hi = Math.max(...vals, m.baseline, m.better === "higher" ? m.baseline : m.crit);
  const y = (v) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P); const x = (i) => (i * W) / Math.max(1, vals.length - 1);
  const col = { critical: "#e5484d", warning: "#d08a1e" }[m.status] || "#0e9f8e";
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="${esc(m.name)} trend, last 2 hours"><line x1="0" x2="${W}" y1="${y(m.warn)}" y2="${y(m.warn)}" stroke="#d08a1e" stroke-dasharray="3 3"/><line x1="0" x2="${W}" y1="${y(m.crit)}" y2="${y(m.crit)}" stroke="#e5484d" stroke-dasharray="3 3"/><line x1="0" x2="${W}" y1="${y(m.baseline)}" y2="${y(m.baseline)}" stroke="#c4c4cc"/><polyline fill="none" stroke="${col}" stroke-width="2" points="${vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/><circle cx="${x(vals.length - 1)}" cy="${y(vals[vals.length - 1])}" r="3" fill="${col}"/></svg>`;
}
function msLabel(m) { return `${piFmt(m.current, m.unit)}`; }
function msShare(c, risk) {
  // Each abnormal signal's share of the deviation + correlated-signals points.
  const pts = (risk.contributions.find((x) => x.factor === "deviation") || {}).points + (risk.contributions.find((x) => x.factor === "correlated") || {}).points || 0;
  const abn = c.sigs.filter((x) => x.status !== "normal"); const sum = abn.reduce((a, x) => a + x.dev, 0) || 1;
  return Object.fromEntries(abn.map((x) => [x.key, Math.round((x.dev / sum) * pts * 10) / 10]));
}
function msMeasures(score, cls, c, p) {
  const s = PI_SCEN[(c && c.sid) || p.sid];
  const sev = c ? c.severity : s.criticality >= 5 ? "Sev 1 (enterprise-wide)" : "Sev 2 (major business service)";
  const conf = c ? c.confidence : p && p.signal ? "Medium (one live source)" : "—";
  return `<div class="ms-meas">
    <div><span>Risk score ${msCalcTag}</span><b>${score != null ? `${score}/100` : "—"}</b><span>${esc(cls || "")}</span></div>
    <div><span>Probability estimate</span><b>Not calculated</b><span>No validated statistical model in this POC</span></div>
    <div><span>Potential severity</span><b>${esc(sev.split(" (")[0])}</b><span>${esc((sev.split(" (")[1] || "").replace(")", ""))}</span></div>
    <div><span>Business impact</span><b>Level ${c ? c.business_level : s.criticality}/5</b><span>${c ? (msAbn(c).some((x) => x.cat === "business") ? "Transactions already affected" : "Transactions not yet affected") : "From service criticality"}</span></div>
    <div><span>Confidence (evidence strength)</span><b>${esc(String(conf).split(" (")[0])}</b><span>${c ? `${c.cats.length} categories agree · reliability ${Math.round(c.reliability * 100)}%` : esc((String(conf).split(" (")[1] || "").replace(")", ""))}</span></div></div>`;
}
function msChangeBadge(ch, sid) {
  if (ch.hours_ago < 0) return badge("info", "Scheduled");
  if (msConfirmed(ch, sid)) return badge("serious", "Confirmed root cause (approved RCA)");
  return ch.related ? badge("warning", "Suspected contributor, not confirmed") : badge("good", "Not related to the abnormal signals");
}
function msConfirmed(ch, sid) {
  return PI.preds.some((p) => p.sid === sid && p.incident && (() => { const run = WB.runs[p.incident.incId]; const rca = run && wbOut(run, "rca"); return rca && run.approvals.some((a) => a.gate === "rca" && a.decision === "approve") && String(rca.root_cause || "").includes(ch.id); })());
}
function msHours(h) { return h < 0 ? `in ${Math.abs(h) >= 48 ? `${Math.round(Math.abs(h) / 24)} days` : `${Math.abs(h)} h`}` : h >= 48 ? `${Math.round(h / 24)} days ago` : `${h} h ago`; }

/* --------------------------------- consolidated view + "why" explanation */
function msCorrPanel(c, risk, opt = {}) {
  const s = PI_SCEN[c.sid]; const abn = msAbn(c);
  const share = risk ? msShare(c, risk) : {};
  const byCat = {}; abn.forEach((x) => { (byCat[x.cat] = byCat[x.cat] || []).push(x); });
  const affected = c.affected.map((id) => MS_NODE[id].label);
  const top = risk ? [...risk.contributions].sort((a, b) => b.points - a.points).slice(0, 4) : [];
  const action = abn.length ? (abn.reduce((a, b) => (b.dev > a.dev ? b : a)).action || s.actions[0]) : "No action needed.";
  if (!abn.length) return `<div class="card pad"><p class="sec-title">${icon("layers")} Correlation engine ${msCalcTag}</p><p style="font-size:12.5px;color:var(--ink-soft);margin:6px 0 0">All ${c.sigs.length} signals for ${esc(s.short)} are within their normal thresholds, so there is nothing to correlate and no prediction would be raised.</p></div>`;
  return `<div class="card pad"><div class="sec-head"><p class="sec-title">${icon("layers")} ${opt.title || "Consolidated prediction"}: ${esc(s.short)}</p><span class="note-r">One view for ${abn.length} abnormal signals, not ${abn.length} separate alerts · ${msCalcTag} <span class="wb-src simulated">Simulated signals</span></span></div>
  ${risk ? `<div style="margin-top:10px">${msMeasures(risk.score, risk.cls, c)}</div>` : ""}
  <div class="tbl-wrap" style="margin:10px 0 0"><table class="t" style="min-width:760px"><thead><tr><th>1. Detected signal</th><th>Category</th><th>2. Normal baseline</th><th>3. Current reading</th><th>4. Trend</th><th>Status</th><th>Risk contribution</th></tr></thead><tbody>
  ${abn.sort((a, b) => b.dev - a.dev).slice(0, opt.all ? 99 : 8).map((x) => `<tr><td>${esc(x.name)}</td><td style="font-size:12px;color:var(--ink-soft)">${esc(MS_CAT[x.cat].label)}</td><td>${piFmt(x.baseline, x.unit)}</td><td><b>${piFmt(x.current, x.unit)}</b></td><td style="font-size:12px">${x.trend === "worsening" ? "↗ worsening" : x.trend === "improving" ? "↘ improving" : "→ stable"}</td><td>${badge(piMetricKind(x.status), x.status)}</td><td>${share[x.key] != null ? `≈ ${share[x.key]} pts` : "—"}</td></tr>`).join("")}
  </tbody></table></div>${abn.length > 8 && !opt.all ? `<p style="font-size:11.5px;color:var(--ink-muted);margin:6px 0 0">Showing the 8 most deviated of ${abn.length} abnormal signals; every signal is listed in the signal cards on the Multi-signal monitoring tab.</p>` : ""}
  <div class="ms-corr" style="margin-top:10px">
    <div class="ms-kv"><span class="eyebrow">5. Related abnormal signals</span>${Object.entries(byCat).map(([k, v]) => `<div><b style="font-weight:500">${esc(MS_CAT[k].label)}:</b> ${v.map((x) => esc(x.name)).join(", ")}</div>`).join("")}${c.healthy.length ? `<div style="color:var(--ok)">Healthy: ${c.healthy.map((k) => esc(MS_CAT[k].label)).join(", ")}</div>` : ""}</div>
    <div class="ms-kv"><span class="eyebrow">6. Possible underlying issue</span>${esc(c.hyp ? c.hyp.text : `${s.prediction}. No single pattern matches yet; the signals are reported together for investigation.`)}${c.recent ? `<div style="margin-top:4px">${msChangeBadge(c.recent, c.sid)} <span style="font-size:12px">${esc(c.recent.id)}: ${esc(c.recent.title)} (${msHours(c.recent.hours_ago)})</span></div>` : ""}</div>
    <div class="ms-kv"><span class="eyebrow">7. Affected services</span>${affected.map((a) => `<span class="wb-chip">${esc(a)}</span>`).join("")}</div>
    <div class="ms-kv"><span class="eyebrow">8. Business impact</span>${esc(c.business_text)}</div>
    <div class="ms-kv"><span class="eyebrow">9. Calculated risk score</span>${risk ? `<b>${risk.score}/100</b> ${piClsBadge(risk.cls)} <span style="font-size:11.5px;color:var(--ink-muted)">${esc(PI_DATA.config.engine)}</span>${c.eta != null ? `<div style="font-size:12px;color:var(--ink-soft)">${c.eta === 0 ? `${esc(c.top.name)} is already past its critical threshold.` : `At the current pace ${esc(c.top.name)} reaches its critical threshold in about ${c.eta} h.`}</div>` : ""}` : "—"}</div>
    <div class="ms-kv"><span class="eyebrow">10. Prediction confidence</span><b>${esc(c.confidence)}</b>: ${c.cats.length} independent categor${c.cats.length === 1 ? "y" : "ies"} agree, source reliability ${Math.round(c.reliability * 100)}% (synthetic quality ratings). Evidence strength, not a probability.</div>
    <div class="ms-kv" style="grid-column:1/-1"><span class="eyebrow">11. Recommended action</span>${esc(action)}</div>
  </div>
  ${risk ? `<div class="ms-why" style="margin-top:12px"><p class="sec-title" style="margin:0 0 6px">${icon("info")} Why did the system predict this?</p>
    <p style="font-size:12.5px;margin:0 0 6px;line-height:1.6">${esc(s.short)} scored <b>${risk.score}/100 (${risk.cls})</b> because ${top.map((t) => `${t.label.toLowerCase()} added ${t.points} points (${t.value})`).join("; ")}. ${abn.length} signals in ${c.cats.length} categories moved together, which is why they are reported as one prediction${c.recent ? `, and ${c.recent.id} happened ${msHours(c.recent.hours_ago)} on the same signals, so it is listed as a suspected contributing change. Only an approved RCA can confirm a root cause` : ""}.</p>
    <ul class="wb-ul" style="margin:0">${abn.sort((a, b) => b.dev - a.dev).slice(0, 6).map((x) => `<li><b style="font-weight:500">${esc(x.name)}</b> is ${piFmt(x.current, x.unit)} against a normal ${piFmt(x.baseline, x.unit)} (${x.status} past ${piFmt(x.status === "critical" ? x.crit : x.warn, x.unit)}), ${Math.round(x.dev * 100)}% of the way to critical${share[x.key] != null ? `: about ${share[x.key]} risk points` : ""}.</li>`).join("")}</ul>
    <p style="font-size:11.5px;color:var(--ink-muted);margin:6px 0 0">Deterministic rules (${esc(PI_DATA.config.engine)}) on simulated demo signals: the same inputs always give the same score. It is not machine learning and not a validated probability.</p></div>` : ""}
  </div>`;
}

/* ------------------------------------------------------- signals tab */
function msTabSignals() {
  const sel = PI_SCEN[MS.sel] ? MS.sel : "claims"; const s = PI_SCEN[sel]; const d = MS_DATA.scenarios[sel];
  const step = msStep(sel); const anim = !!MSL.anim[sel]; const fixed = !!d.fixed;
  const c = msCorrelate(sel);
  const preview = c.abn.length ? piScore({ metrics: c.sigs.filter((x) => x.primary), n90: piDemoHistory(sel).n90, similar: piDemoHistory(sel).similar, disruptive: piDemoHistory(sel).disruptive, criticality: s.criticality, max_cluster: piDemoHistory(sel).max_cluster, minutes: piSimAbnMinutes(sel), ms: c, business_level: d.business_level }, PI.config) : null;
  const share = preview ? msShare(c, preview) : {};
  const latest = piLatest(sel); const busy = PIL.loops.size > 0;
  const live = sel === "sso" && piLiveSso();
  const chips = [...PI_DATA.scenarios].sort((a, b) => a.order - b.order).map((x) => `<button class="ms-chip ${x.id === sel ? "on" : ""}" data-act="ms-sel" data-s="${x.id}"><span class="ms-dot ${msScenarioHealth(x.id)}"></span>${esc(x.short)}</button>`).join("");
  const cats = MS_DATA.categories.filter((k) => c.sigs.some((x) => x.cat === k.id));
  const evs = [...c.changes].sort((a, b) => b.hours_ago - a.hours_ago);
  const topSig = c.top;
  return `<div class="ms-chips">${chips}</div>
  <div class="card pad"><div class="sec-head" style="flex-wrap:wrap;gap:8px"><div><p class="sec-title">${icon("activity")} ${esc(s.title)} · ${esc(s.service)}</p><p style="margin:2px 0 0;font-size:12px;color:var(--ink-muted)">${c.sigs.length} signals in ${c.allCats.length} categories · ${d.changes.length} change event(s) · criticality ${s.criticality}/5 · owner ${esc(s.owner_group)} · <span class="wb-src simulated">Simulated demo data</span>${s.demo_only ? ` · demo-only scenario (never writes to ServiceNow)` : ""}</p></div>
    <div class="wb-ctrl">${fixed ? `<span class="note-r">Pattern-based scenario: no spike to simulate</span>` : `<button class="btn ${step < 4 ? "primary" : ""}" data-act="ms-spike" data-s="${sel}" ${anim || step === 4 ? "disabled" : ""}>${icon(anim ? "loader" : "zap", anim ? "spin" : "")} ${anim ? "Simulating…" : "Simulate spike"}</button>`}
      <button class="btn ${step >= 2 && (!latest || PI_ACTIVE.has(latest.status) === false) ? "primary" : ""}" data-act="ms-run" data-s="${sel}" ${busy || anim ? "disabled" : ""}>${icon("bot")} Run predictive analysis</button>
      ${fixed ? "" : `<button class="btn" data-act="ms-recover" data-s="${sel}" ${anim || step === 0 ? "disabled" : ""}>${icon("check")} Simulate recovery</button>`}
      <button class="btn" data-act="ms-recheck" data-s="${sel}">${icon("activity")} Re-check metrics</button>
      <button class="btn ghost" data-act="ms-reset" data-s="${sel}">${icon("rotate")} Reset scenario</button></div></div>
    ${msStepBar(step)}
    <p style="font-size:12px;color:var(--ink-soft);margin:8px 0 0">State: <b>${MS_STEPS[step]}</b>${anim ? " · signals are moving (each step is a new set of readings)" : ""}. ${latest ? `Latest prediction <a href="#/predictive/p/${encodeURIComponent(latest.id)}" style="color:var(--brand)">${esc(latest.id)}</a>: ${latest.score != null ? `${latest.score}/100 ${latest.cls}` : esc(latest.status)}, ${esc(latest.status)}${latest.recheck ? `, re-checked ${rel(latest.recheck.at)} (${latest.recheck.normal ? "back to normal" : "still abnormal"})` : ""}.` : "Not analysed yet: run the predictive analysis to raise a prediction."}</p>
    ${live ? `<p style="font-size:12px;color:var(--warn);margin:6px 0 0">${icon("info")} Live Agent Mode: the SSO prediction uses the real ServiceNow sign-in signal. These simulated signals are shown for the demo only and are not mixed into the live prediction.</p>` : ""}
    ${UI.ms.note ? `<p style="font-size:12px;color:var(--ink-soft);margin:6px 0 0">${esc(UI.ms.note)}</p>` : ""}
  </div>
  <div style="margin-top:12px">${msCorrPanel(c, preview, { title: "Live correlation preview" })}</div>
  ${cats.map((k) => { const list = c.sigs.filter((x) => x.cat === k.id); const bad = list.filter((x) => x.status !== "normal").length; return `<div class="ms-cat"><div class="h">${icon(k.icon)}<b style="font-size:13.5px">${esc(k.label)}</b><span class="note-r">${bad ? `${bad} of ${list.length} abnormal` : `all ${list.length} normal`}</span></div><div class="ms-grid">${list.map((m) => `<div class="ms-card ${m.status}"><div style="display:flex;justify-content:space-between;gap:6px"><span class="nm">${esc(m.name)}</span>${badge(piMetricKind(m.status), m.status)}</div>
    <div class="cur">${msLabel(m)}</div>
    <div class="meta"><span>Normal ${piFmt(m.baseline, m.unit)}</span><span>Warn ${piFmt(m.warn, m.unit)}</span><span>Crit ${piFmt(m.crit, m.unit)}</span></div>
    ${msTrendChart(m)}
    <div class="meta"><span>${m.trend === "worsening" ? "↗ Worsening" : m.trend === "improving" ? "↘ Improving" : "→ Stable"}</span><span>Risk contribution: ${share[m.key] != null ? `≈ ${share[m.key]} pts` : "0 pts"}</span>${m.primary ? `<span title="Also used by the Monitoring Agent">core metric</span>` : ""}</div>
    <div class="act">${icon("wrench")} ${esc(m.status === "normal" ? "Keep monitoring." : m.action || "Investigate this signal with the related ones.")}</div></div>`).join("")}</div></div>`; }).join("")}
  <div class="pi-charts">
    <div class="card pad"><div class="sec-head"><p class="sec-title">${icon("calendar")} Change and deployment intelligence</p><span class="wb-src simulated">Simulated events</span></div>
      ${topSig ? `<div style="margin-top:8px"><span class="eyebrow">${esc(topSig.name)}, last 2 hours</span>${msEventChart(topSig, evs)}</div>` : ""}
      <div style="margin-top:8px">${evs.map((e) => `<div class="ms-ev"><span class="mono" style="font-size:11px;color:var(--ink-muted)">${esc(msHours(e.hours_ago))}</span><div><b style="font-weight:500">${esc(e.id)}</b> · ${esc(e.title)} <span class="wb-chip">${esc(e.type)}</span><div style="font-size:11.5px;color:var(--ink-muted)">${esc(e.detail)}${e.related ? ` Touches: ${e.correlates.filter((k) => c.abn.some((a) => a.key === k)).map((k) => esc((c.sigs.find((x) => x.key === k) || {}).name || k)).join(", ")}.` : ""}</div></div><div>${msChangeBadge(e, sel)}</div></div>`).join("")}</div>
      <p style="font-size:11.5px;color:var(--ink-muted);margin:8px 0 0">A change is marked suspected when it happened in the last 48 hours and touches an abnormal signal. It becomes a confirmed root cause only if the engineer approves an RCA that cites it.</p></div>
    ${msForecastCard()}
  </div>`;
}
function msEventChart(m, evs) {
  const W = 520, H = 120, L = 6, R = 6, T = 8, B = 18; const vals = m.series; const n = vals.length;
  const lo = Math.min(...vals, m.baseline), hi = Math.max(...vals, m.crit);
  const x = (i) => L + (i * (W - L - R)) / (n - 1); const y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const col = { critical: "#e5484d", warning: "#d08a1e" }[m.status] || "#0e9f8e";
  const marks = evs.filter((e) => e.hours_ago >= 0).map((e) => { const inWin = e.hours_ago <= 2; const xi = inWin ? x((1 - e.hours_ago / 2) * (n - 1)) : L; return `<line x1="${xi}" x2="${xi}" y1="${T}" y2="${H - B}" stroke="${e.related ? "#b45309" : "#9ca3af"}" stroke-dasharray="${inWin ? "0" : "2 3"}" stroke-width="${e.related ? 2 : 1}"/><text x="${xi + 3}" y="${T + 9}" font-size="9.5" fill="${e.related ? "#b45309" : "#6b7280"}">${inWin ? "" : "← "}${esc(e.id)} (${esc(msHours(e.hours_ago))})</text>`; }).slice(0, 2).join("");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="Signal with change events"><line x1="${L}" x2="${W - R}" y1="${y(m.warn)}" y2="${y(m.warn)}" stroke="#d08a1e" stroke-dasharray="3 3"/><line x1="${L}" x2="${W - R}" y1="${y(m.crit)}" y2="${y(m.crit)}" stroke="#e5484d" stroke-dasharray="3 3"/>${marks}<polyline fill="none" stroke="${col}" stroke-width="2" points="${vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/><text x="${L}" y="${H - 4}" font-size="9.5" fill="#8e8e9a">-2 h</text><text x="${W - R}" y="${H - 4}" font-size="9.5" fill="#8e8e9a" text-anchor="end">now</text></svg>`;
}
function msForecastCard() {
  const f = msForecast(MS.demand);
  const W = 520, H = 170, L = 30, R = 8, T = 10, B = 22; const pts = [...f.past, ...f.exp]; const n = pts.length;
  const hi = Math.max(110, ...pts); const x = (i) => L + (i * (W - L - R)) / (n - 1); const y = (v) => T + (1 - v / hi) * (H - T - B);
  const pastLine = f.past.map((v, i) => `${x(i)},${y(v)}`).join(" "); const expLine = [f.past[f.past.length - 1], ...f.exp].map((v, i) => `${x(i + f.past.length - 1)},${y(v)}`).join(" ");
  const chart = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="Capacity forecast"><line x1="${L}" x2="${W - R}" y1="${y(f.limit)}" y2="${y(f.limit)}" stroke="#e5484d" stroke-dasharray="4 3"/><text x="${W - R}" y="${y(f.limit) - 3}" font-size="9.5" fill="#b91c1c" text-anchor="end">capacity limit ${f.limit}%</text><line x1="${L}" x2="${W - R}" y1="${y(f.threshold)}" y2="${y(f.threshold)}" stroke="#d08a1e" stroke-dasharray="3 3"/><text x="${W - R}" y="${y(f.threshold) - 3}" font-size="9.5" fill="#b45309" text-anchor="end">threshold ${f.threshold}%</text><line x1="${x(f.past.length - 1)}" x2="${x(f.past.length - 1)}" y1="${T}" y2="${H - B}" stroke="#c4c4cc"/><text x="${x(f.past.length - 1) + 3}" y="${H - 6}" font-size="9.5" fill="#8e8e9a">today</text><polyline fill="none" stroke="#0a5c9e" stroke-width="2" points="${pastLine}"/><polyline fill="none" stroke="#0a5c9e" stroke-width="2" stroke-dasharray="5 4" points="${expLine}"/>${[0, 50, 100].map((v) => `<text x="${L - 4}" y="${y(v) + 3}" font-size="9.5" fill="#8e8e9a" text-anchor="end">${v}</text>`).join("")}<text x="${L}" y="${H - 6}" font-size="9.5" fill="#8e8e9a">-7 d</text><text x="${W - R}" y="${H - 6}" font-size="9.5" fill="#8e8e9a" text-anchor="end">+${f.exp.length - 1} d</text></svg>`;
  return `<div class="card pad"><div class="sec-head"><p class="sec-title">${icon("gauge")} Capacity and demand forecasting</p>${msCalcTag}</div>
    <div class="ms-chips" style="margin:8px 0">${MS_DATA.demand.map((p) => `<button class="ms-chip ${p.id === f.id ? "on" : ""}" data-act="ms-demand" data-d="${p.id}">${esc(p.label)}</button>`).join("")}</div>
    ${chart}<div class="pi-legend"><span><i style="background:#0a5c9e"></i>Utilisation (solid: last 7 days, dashed: expected)</span></div>
    <div class="grid g3" style="gap:8px;margin-top:8px"><div class="ms-kv"><span class="eyebrow">Current</span><b>${f.current}%</b> · ${esc(f.service)}</div><div class="ms-kv"><span class="eyebrow">Expected peak</span><b>${piRound(f.peak, "%")}%</b> ${f.peak >= f.limit ? badge("critical", "over capacity") : f.peak >= f.threshold ? badge("warning", "over threshold") : badge("good", "within capacity")}</div><div class="ms-kv"><span class="eyebrow">Time until threshold</span><b>${f.crossDay == null ? "Not reached in 14 days" : f.crossDay === 0 ? "Now" : `${f.crossDay} day${f.crossDay > 1 ? "s" : ""}`}</b>${f.limitDay != null ? ` · limit in ${f.limitDay} d` : ""}</div></div>
    <p style="font-size:11.5px;color:var(--ink-muted);margin:8px 0 0">${esc(f.note)} Illustrative deterministic forecast (current utilisation × a predefined demand curve), not a statistical model.</p></div>`;
}

/* -------------------------------------------------- dependency map tab */
function msTabMap() {
  const preds = piActive(); const hp = piPred(UI.ms.mapPred);
  const hiSet = new Set(hp && hp.ms ? hp.ms.affected : hp && MS_DATA.scenarios[hp.sid] ? [MS_DATA.scenarios[hp.sid].node, ...msDown(MS_DATA.scenarios[hp.sid].node)] : []);
  const fill = { critical: "#fdecec", warning: "#fdf3e3", impacted: "#f1edff", normal: "#eef9f1" }; const stroke = { critical: "#e5484d", warning: "#f5b544", impacted: "#a78bfa", normal: "#86d39c" };
  const box = (n) => ({ cx: n.x + 75, cy: n.y + 20 });
  const edges = MS_DATA.graph.edges.map(([a, b]) => { const A = MS_NODE[a], Bn = MS_NODE[b]; const p = box(A), q = box(Bn); const hi = hiSet.has(a) && hiSet.has(b); const x1 = A.x + (q.cx > p.cx + 20 ? 150 : 75), y1 = q.cx > p.cx + 20 ? p.cy : A.y + (q.cy > p.cy ? 40 : 0); const x2 = q.cx > p.cx + 20 ? Bn.x : Bn.x + 75, y2 = q.cx > p.cx + 20 ? q.cy : Bn.y + (q.cy > p.cy ? 0 : 40); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${hi ? "#0a5c9e" : "#c4c4cc"}" stroke-width="${hi ? 2.5 : 1.4}" marker-end="url(#ms-arr${hi ? "h" : ""})"/>`; }).join("");
  const nodes = MS_DATA.graph.nodes.map((n) => { const h = msNodeHealth(n.id); const hi = hiSet.has(n.id); return `<g class="nd ${UI.ms.mapNode === n.id ? "sel" : ""}" data-act="ms-node" data-n="${n.id}" tabindex="0" role="button" aria-label="${esc(n.label)}: ${h}"><rect x="${n.x}" y="${n.y}" width="150" height="40" rx="9" fill="${fill[h]}" stroke="${hi ? "#0a5c9e" : stroke[h]}" ${hi ? 'stroke-width="3"' : ""}/><circle cx="${n.x + 13}" cy="${n.y + 20}" r="4.5" fill="${stroke[h]}"/><text x="${n.x + 24}" y="${n.y + 18}" font-size="11.5" font-weight="600" fill="#1d1d27">${esc(n.label)}</text><text x="${n.x + 24}" y="${n.y + 31}" font-size="9.5" fill="#6b7280">${h === "normal" ? "healthy" : h}</text></g>`; }).join("");
  const svg = `<svg viewBox="0 0 860 420" role="img" aria-label="Service dependency map"><defs><marker id="ms-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#c4c4cc"/></marker><marker id="ms-arrh" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#0a5c9e"/></marker></defs>${edges}${nodes}</svg>`;
  const n = MS_NODE[UI.ms.mapNode];
  let side = `<p style="font-size:12.5px;color:var(--ink-muted);margin:6px 0 0">Click a service to see its upstream and downstream dependencies, health, abnormal metrics, affected departments and predictions.</p>`;
  if (n) {
    const up = [...msUp(n.id)].map((x) => MS_NODE[x].label); const down = [...msDown(n.id)].map((x) => MS_NODE[x].label);
    const h = msNodeHealth(n.id); const sigs = n.scenario ? msSignals(n.scenario).filter((x) => x.status !== "normal") : [];
    const upBad = [...msUp(n.id)].filter((u) => MS_NODE[u].scenario && msScenarioHealth(MS_NODE[u].scenario) !== "normal").map((u) => MS_NODE[u].label);
    const depts = msDeptsFor(msNodeApps(n.id));
    const preds2 = PI.preds.filter((p) => p.status !== "Superseded" && MS_DATA.scenarios[p.sid] && (MS_DATA.scenarios[p.sid].node === n.id || (p.ms ? p.ms.affected.includes(n.id) : false))).slice(0, 5);
    side = `<p class="sec-title" style="margin:0">${esc(n.label)} ${badge(msSt(h), h === "normal" ? "healthy" : h)}</p>
      ${wbKv([["Upstream (depends on)", up.join(", ") || "None"], ["Downstream (depends on it)", down.join(", ") || "None"]])}
      ${wbSec("Related metric abnormalities", sigs.length ? wbUl(sigs.map((x) => `${x.name}: ${piFmt(x.current, x.unit)} (${x.status})`)) : upBad.length ? `<p style="font-size:12.5px;margin:0">No abnormal metrics of its own; impacted through ${esc(upBad.join(", "))}.</p>` : `<p style="font-size:12.5px;margin:0;color:var(--ok)">All signals normal.</p>`)}
      ${wbSec(`Potentially affected departments (${depts.reduce((a, g) => a + g.count, 0).toLocaleString()} employees)`, depts.length ? wbUl(depts.map((g) => `${g.department}: ${g.count.toLocaleString()}`)) : `<p style="font-size:12.5px;margin:0;color:var(--ink-muted)">Shared platform: departments depend on it through the services downstream.</p>`)}
      ${wbSec("Associated predictions", preds2.length ? preds2.map((p) => `<div style="font-size:12.5px;padding:3px 0"><a href="#/predictive/p/${encodeURIComponent(p.id)}" style="color:var(--brand)">${esc(p.id)}</a> · ${p.score != null ? `${p.score} ${piClsBadge(p.cls)}` : ""} ${piStBadge(p.status)}</div>`).join("") : `<p style="font-size:12.5px;margin:0;color:var(--ink-muted)">None.</p>`)}`;
  }
  return `<div class="wb-split"><div class="card pad ms-map"><div class="sec-head" style="flex-wrap:wrap;gap:8px"><p class="sec-title">${icon("network")} Service dependency map</p><label style="font-size:12px;display:flex;gap:6px;align-items:center">Highlight prediction <select class="sel" id="ms-mappred" style="height:30px;font-size:12px"><option value="">None</option>${preds.map((p) => `<option value="${esc(p.id)}" ${p.id === UI.ms.mapPred ? "selected" : ""}>${esc(PI_SCEN[p.sid].short)} · ${p.score != null ? p.score : "—"} ${esc(p.cls || "")}</option>`).join("")}</select></label></div>${svg}
    <div class="pi-legend"><span><i style="background:#86d39c"></i>Healthy</span><span><i style="background:#f5b544"></i>Warning</span><span><i style="background:#e5484d"></i>Critical</span><span><i style="background:#a78bfa"></i>Impacted by an upstream service</span><span><i style="background:#0a5c9e"></i>Affected by the highlighted prediction</span><span style="color:var(--ink-muted)">${esc(MS_DATA.graph.note)}</span></div></div>
    <div class="card pad">${side}</div></div>`;
}

/* ------------------------------------------------------- what-if tab */
function msTabWhatIf() {
  const sid = PI_SCEN[MS.wi.sid] ? MS.wi.sid : "claims"; if (MS.wi.sid !== sid) { MS.wi = { sid, ov: {} }; }
  const sl = msWhatIfSignals(sid); const ov = MS.wi.ov;
  return `<div class="ms-chips">${[...PI_DATA.scenarios].filter((x) => !MS_DATA.scenarios[x.id].fixed).sort((a, b) => a.order - b.order).map((x) => `<button class="ms-chip ${x.id === sid ? "on" : ""}" data-act="ms-wi-sid" data-s="${x.id}">${esc(x.short)}</button>`).join("")}</div>
  <div class="ms-wi"><div class="card pad"><div class="sec-head"><p class="sec-title">${icon("sliders")} What-if conditions: ${esc(PI_SCEN[sid].short)}</p><button class="btn ghost" data-act="ms-wi-reset">${icon("rotate")} Reset simulation</button></div>
    <p style="font-size:12px;color:var(--ink-soft);margin:4px 0 6px">Start: the current simulated readings (${MS_STEPS[msStep(sid)]}). Move a slider to see the risk, affected services and departments update immediately. Sandbox only: it changes no monitoring data, no prediction and no real system.</p>
    ${sl.map((x) => { const v = ov[x.key] != null ? +ov[x.key] : x.current; const st = piStatus(x, v); return `<div class="ms-sl"><div class="top"><span>${esc(x.name)} <span style="color:var(--ink-muted);font-size:11px">${esc(MS_CAT[x.cat].label)}</span></span><span id="ms-wv-${x.key}"><b>${piFmt(v, x.unit)}</b> ${badge(piMetricKind(st), st)}</span></div><input type="range" id="ms-wi-${x.key}" min="${x.lo}" max="${x.hi}" step="${x.stepv}" value="${v}" aria-label="${esc(x.name)}"><div class="lim"><span>${piFmt(x.lo, x.unit)}</span><span>normal ${piFmt(x.baseline, x.unit)} · warn ${piFmt(x.warn, x.unit)} · crit ${piFmt(x.crit, x.unit)}</span><span>${piFmt(x.hi, x.unit)}</span></div></div>`; }).join("")}
  </div>
  <div id="ms-wi-out">${msWhatIfOut(sid)}</div></div>`;
}
function msWhatIfOut(sid) {
  const r = msWhatIf(sid); const c = r.c;
  return `<div class="card pad"><div class="sec-head"><p class="sec-title">${icon("gauge")} Simulated outcome</p>${msCalcTag}</div>
    <div style="display:flex;align-items:baseline;gap:10px;margin-top:8px"><span class="pi-score" style="font-size:40px">${r.risk.score}</span><span style="color:var(--ink-muted)">/100</span>${piClsBadge(r.risk.cls)}<span class="note-r">${r.empAlert ? "Employee + IT alert" : r.itAlert ? "IT alert only" : "No alert"}</span></div>${piGauge(r.risk.score)}
    <div class="ms-corr" style="margin-top:10px">
      <div class="ms-kv" style="grid-column:1/-1"><span class="eyebrow">Predicted disruption</span>${esc(r.disruption)}</div>
      <div class="ms-kv"><span class="eyebrow">Affected services</span>${c.affected.length ? c.affected.map((id) => `<span class="wb-chip">${esc(MS_NODE[id].label)}</span>`).join("") : "None"}</div>
      <div class="ms-kv"><span class="eyebrow">Affected departments (${r.affected.toLocaleString()} employees)</span>${r.groups.length ? r.groups.map((g) => `<span class="wb-chip">${esc(g.department)} ${g.count.toLocaleString()}</span>`).join("") : "None"}</div>
      <div class="ms-kv" style="grid-column:1/-1"><span class="eyebrow">Recommended preventive action</span>${esc(r.action)}</div>
    </div>
    <p class="eyebrow" style="margin:12px 0 4px">Factor contributions</p>${r.risk.contributions.filter((x) => x.points > 0).sort((a, b) => b.points - a.points).map((x) => `<div class="pi-contrib"><div><b style="font-weight:500">${esc(x.label)}</b></div><div class="v" style="color:var(--ink-soft)">${esc(x.value)}</div><div class="bar"><i style="width:${Math.min(100, (x.points / Math.max(0.1, (x.weight / r.risk.weights_total) * 100)) * 100)}%"></i></div><b style="text-align:right">${x.points}</b></div>`).join("")}
    <p style="font-size:11.5px;color:var(--ink-muted);margin:8px 0 0">Calculated with the current weights (${esc(PI_DATA.config.engine)})${r.risk.na_weight ? `; ${r.risk.contributions.filter((x) => x.na).map((x) => x.label.toLowerCase()).join(" and ")} not applicable (no data), weight redistributed` : ""}. ${c.abn.length} abnormal signal(s) in ${c.cats.length} categor${c.cats.length === 1 ? "y" : "ies"}; confidence ${esc(c.confidence)}.</p></div>`;
}
function msInput(el) {
  const id = el.id;
  if (id.startsWith("ms-wi-")) {
    const key = id.slice(6); MS.wi.ov[key] = el.value; msSave();
    const x = msWhatIfSignals(MS.wi.sid).find((y) => y.key === key); const lab = document.getElementById(`ms-wv-${key}`);
    if (x && lab) { const st = piStatus(x, +el.value); lab.innerHTML = `<b>${piFmt(+el.value, x.unit)}</b> ${badge(piMetricKind(st), st)}`; }
    const out = document.getElementById("ms-wi-out"); if (out) out.innerHTML = msWhatIfOut(MS.wi.sid);
  }
}

/* ------------------------------------------ alert lifecycle + notifications */
function msLifecycle(p) {
  const a = p.alerts || {}; const done = p.status === "Mitigated"; const closed = ["Dismissed", "False positive"].includes(p.status);
  return [["Prediction detected", true, p.created], ["Alert generated", !!(a.it || a.employee), (a.it || a.employee || {}).at], ["Employee notified", !!a.employee, a.employee && a.employee.at], ["Acknowledged", !!(p.ack.admin || p.ack.employee), (p.ack.admin || p.ack.employee || {}).at], ["Investigation initiated", !!p.incident, p.incident && p.incident.at], [closed ? (p.status === "False positive" ? "Closed: false positive" : "Closed: dismissed") : "Resolved", done || closed, (p.mitigation || p.dismissed || {}).at]];
}
function msLifeHtml(p) { return `<div class="ms-life">${msLifecycle(p).map(([l, d], i) => `${i ? "<i>→</i>" : ""}<span class="${d ? (l.startsWith("Closed") ? "x" : "d") : ""}">${d ? icon("check") : ""}${esc(l)}</span>`).join("")}</div>`; }
function msTabAlerts() {
  const list = PI.preds.filter((p) => p.alerts && (p.alerts.it || p.alerts.employee) && p.status !== "Superseded");
  return `<div class="card pad"><div class="sec-head"><p class="sec-title">${icon("bell")} Notification centre</p><span class="note-r">${list.length} alert(s) · shown inside the POC only: no email, Teams, SMS or push delivery</span></div>
  ${list.length ? list.map((p) => { const it = p.alerts.it; const em = p.alerts.employee; return `<div class="pi-alert ${p.cls === "Critical" ? "crit" : p.cls === "High" ? "high" : ""} ${["Mitigated", "Dismissed", "False positive"].includes(p.status) ? "done" : ""}"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span class="eyebrow">${it ? `IT alert · ${esc(it.team)} · ${esc(it.priority)}` : "Employee alert"}</span><span>${piStBadge(p.status)} <span class="note-r">${rel((it || em).at)}</span></span></div>
    <h4>${esc(it ? it.title : em.title)}</h4><div class="row"><span>Risk <b>${p.score}/100</b> (${esc(p.cls)})</span><span>${em ? `Employees notified: <b>${p.affected.toLocaleString()}</b> in ${em.departments.length} department(s)` : "Employees not notified (below the employee threshold)"}</span>${p.ack.employee ? `<span>Acknowledged by an employee (demo)</span>` : ""}</div>
    <div style="margin-top:8px">${msLifeHtml(p)}</div><div class="acts"><a class="btn" href="#/predictive/p/${encodeURIComponent(p.id)}">${icon("arrow")} Open prediction</a></div></div>`; }).join("") : `<p style="font-size:12.5px;color:var(--ink-muted);margin:8px 0 0">No alerts yet. Run a predictive analysis on an abnormal scenario.</p>`}</div>`;
}

/* ------------------------------------------- prediction accuracy page */
function pageAccuracy() {
  piSync();
  const H = MS_DATA.accuracy.records; const cnt = (o) => H.filter((h) => h.outcome === o).length;
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  const adv = avg(H.filter((h) => h.advance_min != null).map((h) => h.advance_min)); const ack = avg(H.filter((h) => h.ack_min != null).map((h) => h.ack_min));
  const res = H.filter((h) => h.resolve_h != null); const resAvg = res.length ? Math.round((res.reduce((a, h) => a + h.resolve_h, 0) / res.length) * 10) / 10 : null;
  const closed = H.length; const confirmed = cnt("mitigated") + cnt("incident");
  const S = PI.preds.filter((p) => p.score != null && !["Superseded", "No anomaly", "Failed", "Interrupted"].includes(p.status));
  const sc = (f) => S.filter(f).length;
  const tile = (ic, label, v, sub, tone) => `<div class="card tile"><div class="h"><span style="color:${tone || "var(--ink-muted)"}">${icon(ic)}</span><span class="eyebrow">${label}</span></div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  const months = [3, 2, 1, 0].map((m) => ({ lab: m === 0 ? "Last 30 d" : `${m * 30}-${m * 30 + 30} d ago`, f: (h) => h.days_ago >= m * 30 && h.days_ago < m * 30 + 30 }));
  const outs = [["mitigated", "Mitigated", PI_COLORS[1]], ["incident", "Became an incident", PI_COLORS[3]], ["false_positive", "False positive", PI_COLORS[2]], ["dismissed", "Dismissed", PI_COLORS[4]], ["expired", "Expired", "#a3a3ad"]];
  const sids = [...PI_DATA.scenarios].sort((a, b) => a.order - b.order);
  const advBy = sids.map((s) => avg(H.filter((h) => h.sid === s.id && h.advance_min != null).map((h) => h.advance_min)) || 0);
  const funnel = [["Monitoring", "every 5 min", "All services"], ["Early warning", H.length, "Risk above 30"], ["Alert generated", H.filter((h) => h.score >= 61).length, "Risk 61+"], ["Acknowledged", H.filter((h) => h.ack_min != null).length, "By IT"], ["Investigation", H.filter((h) => ["mitigated", "incident"].includes(h.outcome)).length, "Incident raised"], ["Mitigated", cnt("mitigated"), "Confirmed"], ["Dismissed / false positive", cnt("dismissed") + cnt("false_positive"), "Not counted as success"]];
  const oc = { mitigated: badge("good", "Mitigated"), incident: badge("critical", "Became an incident"), false_positive: badge("warning", "False positive"), dismissed: badge("info", "Dismissed"), expired: badge("info", "Expired") };
  return `${head("Prediction Accuracy", "Outcomes of predictions over time: how many were mitigated, how many still became incidents, how many were false positives, and how early the warnings came.", "Prediction outcomes", `<span class="pill p-warn">Synthetic history + this session</span>`)}
  <div class="grid g6" style="gap:12px">
    ${tile("target", "Total predictions", H.length, "Synthetic history, ~4 months", "var(--brand)")}
    ${tile("siren", "Became incidents", cnt("incident"), "Predicted, then happened", "var(--danger)")}
    ${tile("shield", "Mitigated", cnt("mitigated"), "Confirmed by re-check or closure", "var(--ok)")}
    ${tile("alert", "False positives", cnt("false_positive"), "Marked by IT", "var(--warn)")}
    ${tile("xcircle", "Dismissed", cnt("dismissed"), "Not counted as mitigated")}
    ${tile("hourglass", "Expired", cnt("expired"), "Signals recovered unaided")}
  </div>
  <div class="grid g3" style="gap:12px;margin-top:12px">
    ${tile("clock", "Average advance warning", adv != null ? `${adv} min` : "—", "Before the predicted impact (mitigated or became incident)")}
    ${tile("check", "Average time to acknowledge", ack != null ? `${ack} min` : "—", "From alert to IT acknowledgement")}
    ${tile("wrench", "Average time to resolve", resAvg != null ? `${resAvg} h` : "—", "From alert to confirmed mitigation or closure")}
  </div>
  <div class="card pad" style="margin-top:12px"><div class="sec-head"><p class="sec-title">${icon("route")} Prediction lifecycle</p><span class="note-r">Monitoring → Early warning → Alert generated → Acknowledged → Investigation → Mitigated / Dismissed / False positive</span></div>
    <div class="ms-funnel" style="margin-top:10px">${funnel.map(([l, n, s2]) => `<div><span>${esc(l)}</span><b>${n}</b><span>${esc(s2)}</span></div>`).join("")}</div>
    <p style="font-size:12px;color:var(--ink-soft);margin:10px 0 0">Confirmed-risk rate (synthetic): <b>${Math.round((confirmed / closed) * 100)}%</b> of closed predictions were real risks (mitigated or became an incident). Dismissed predictions are never counted as successful mitigation. This is outcome tracking on demo data, not a claim of statistical accuracy.</p></div>
  <div class="pi-charts">
    <div class="card pad pi-chart"><p class="sec-title">${icon("barchart")} Outcomes by period</p>${piBarChart(months.map((m) => m.lab), outs.map(([o, l, col]) => ({ name: l, color: col, values: months.map((m) => H.filter((h) => m.f(h) && h.outcome === o).length) })), { label: "Outcomes by period", note: "Synthetic history" })}</div>
    <div class="card pad pi-chart"><p class="sec-title">${icon("clock")} Average advance warning by scenario (minutes)</p>${piBarChart(sids.map((s) => s.short.split(" ")[0]), [{ name: "Minutes of warning", color: PI_COLORS[0], values: advBy }], { label: "Advance warning", note: "Synthetic history" })}</div>
  </div>
  <div class="card pad" style="margin-top:12px"><div class="sec-head"><p class="sec-title">${icon("activity")} This session (actual, this browser)</p><span class="note-r">${S.length} prediction(s)</span></div>
    <div class="ms-funnel" style="margin-top:8px">${[["Active", sc((p) => PI_ACTIVE.has(p.status) && p.status !== "Investigating")], ["Investigating", sc((p) => p.status === "Investigating")], ["Mitigated", sc((p) => p.status === "Mitigated")], ["Dismissed", sc((p) => p.status === "Dismissed")], ["False positive", sc((p) => p.status === "False positive")], ["Incident raised", sc((p) => !!p.incident)]].map(([l, n]) => `<div><span>${l}</span><b>${n}</b></div>`).join("")}</div>
    <p style="font-size:11.5px;color:var(--ink-muted);margin:8px 0 0">A linked incident that the RCA workflow verifies and closes turns its prediction to Mitigated automatically.</p></div>
  <div class="card pad" style="margin-top:12px"><p class="sec-title">${icon("history")} Prediction history (synthetic)</p><div class="tbl-wrap" style="margin:8px -20px 0"><table class="t" style="min-width:760px"><thead><tr><th style="padding-left:20px">Prediction</th><th>Scenario</th><th>Risk</th><th>Outcome</th><th>Advance warning</th><th>Time to acknowledge</th><th>Time to resolve</th><th>When</th></tr></thead><tbody>
    ${H.slice(0, 16).map((h) => `<tr><td style="padding-left:20px"><span class="mono" style="font-size:11.5px">${esc(h.id)}</span></td><td>${esc(PI_SCEN[h.sid].short)}</td><td>${h.score} ${piClsBadge(h.cls)}</td><td>${oc[h.outcome]}</td><td>${h.advance_min != null ? `${h.advance_min} min` : "—"}</td><td>${h.ack_min != null ? `${h.ack_min} min` : "—"}</td><td>${h.resolve_h != null ? `${h.resolve_h} h` : "—"}</td><td>${Math.round(h.days_ago)} d ago</td></tr>`).join("")}
  </tbody></table></div></div>
  ${simnote(MS_DATA.accuracy.note + " Session figures come from this browser's predictions.")}`;
}

/* --------------------------------------------- employee: alerts page */
function pageMyAlerts() {
  piSync();
  const e = psEmployee();
  const list = piMyAlerts();
  const open = list.filter((p) => !["Mitigated", "Dismissed", "False positive"].includes(p.status)); const done = list.filter((p) => !open.includes(p));
  const card = (p) => { const a = p.alerts.employee; const fin = !open.includes(p); return `<div class="pi-alert ${fin ? "done" : a.cls === "Critical" ? "crit" : a.cls === "High" ? "high" : ""}"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span class="eyebrow" style="color:${fin ? "var(--ok)" : "var(--danger)"}">${fin ? "Resolved alert" : "Predictive alert"}</span><span class="note-r">${rel(a.at)}</span></div><h4>${esc(a.title)}</h4><div class="row"><span>Affected service: <b>${esc(a.service)}</b></span><span>Status: <b>${esc(piEmpStatus(p))}</b></span></div><p style="font-size:12.5px;margin:8px 0 0"><b>What's happening:</b> ${esc(a.message)}</p><p style="font-size:12.5px;margin:6px 0 0"><b>What you can do:</b> ${esc(a.action)}</p><div style="margin-top:8px">${msLifeHtml(p)}</div>${fin || p.ack.employee ? "" : `<div class="acts"><button class="btn primary" data-act="pi-fd-ack" data-id="${esc(p.id)}">${icon("check")} Acknowledge</button></div>`}</div>`; };
  return `${head("Alerts for you", `Early warnings about IT services ${esc(e.dept)} relies on, sent before anyone reports a problem. You only see alerts for your department.`, "Employee experience", "")}
  <div class="card pad" style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between"><span style="font-size:12.5px">Viewing as <b>${esc(e.name)}</b> · ${esc(e.dept)}</span><label style="font-size:12px;display:flex;gap:6px;align-items:center"><span class="ps-demo">Demo</span> See the filter for another department <select class="sel" id="ps-empdept" style="height:30px;font-size:12px">${PS_EMPLOYEES.map((x) => `<option value="${esc(x.dept)}" ${x.dept === e.dept ? "selected" : ""}>${esc(x.name)} · ${esc(x.dept)}</option>`).join("")}</select></label></div>
  <div class="card pad"><p class="sec-title">${icon("bell")} Active alerts (${open.length})</p>${open.length ? open.map(card).join("") : `<p style="font-size:12.5px;color:var(--ink-muted);margin:8px 0 0">No active alerts for ${esc(e.dept)}.</p>`}</div>
  <div class="card pad" style="margin-top:12px"><p class="sec-title">${icon("check")} Resolved alerts (${done.length})</p>${done.length ? done.map(card).join("") : `<p style="font-size:12.5px;color:var(--ink-muted);margin:8px 0 0">None yet.</p>`}</div>
  ${simnote("Alerts are shown inside this POC only (no email, Teams or SMS). Department mapping is a synthetic directory; no individual employee data is used.")}`;
}

/* ---------------------------------------------------------- actions */
const MS_ACTIONS = {
  "ms-sel": (el) => { MS.sel = el.dataset.s; UI.ms.note = ""; msSave(); render(); },
  "ms-spike": (el) => { UI.ms.note = ""; msSpike(el.dataset.s); },
  "ms-recover": (el) => { UI.ms.note = ""; msRecover(el.dataset.s); },
  "ms-reset": (el) => { UI.ms.note = ""; msReset(el.dataset.s); },
  "ms-run": async (el) => { const sid = el.dataset.s; UI.pi.sel = null; UI.pi.dtab = "risk"; UI.pi.err = ""; UI.pi.draft = {}; const pr = piRunScenario(sid); await wbSleep(50); const p = piLatest(sid); if (p) location.hash = `#/predictive/p/${encodeURIComponent(p.id)}`; await pr; },
  "ms-recheck": async (el) => { const sid = el.dataset.s; const p = piLatest(sid); if (p && PI_ACTIVE.has(p.status)) { await piRecheck(p.id); UI.ms.note = `Re-checked ${p.id}: ${p.recheck && p.recheck.normal ? "every metric is back within normal thresholds; mitigation can now be confirmed on the prediction." : "metrics are still abnormal."}`; } else { const c = msCorrelate(sid); UI.ms.note = `Metrics re-read at ${stamp(wbNow()).slice(11)}: ${c.abn.length ? `${c.abn.length} abnormal signal(s).` : "all signals normal."} No active prediction to update.`; } render(); },
  "ms-demand": (el) => { MS.demand = el.dataset.d; msSave(); render(); },
  "ms-node": (el) => { UI.ms.mapNode = UI.ms.mapNode === el.dataset.n ? null : el.dataset.n; render(); },
  "ms-wi-sid": (el) => { MS.wi = { sid: el.dataset.s, ov: {} }; msSave(); render(); },
  "ms-wi-reset": () => { MS.wi.ov = {}; msSave(); render(); },
  "ms-assoc": (el) => { const r = msAssociateDemo(el.dataset.id, UI.ms.assoc); if (!r.ok) { UI.pi.err = r.error; UI.pi.errFor = el.dataset.id; } else UI.ms.assoc = ""; render(); },
};
</script>
