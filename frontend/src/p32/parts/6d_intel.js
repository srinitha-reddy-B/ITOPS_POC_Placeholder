<style>
.in-bar{height:7px;border-radius:99px;background:var(--hover);overflow:hidden;min-width:70px}
.in-bar i{display:block;height:100%;background:var(--brand)}
.in-bar.w i{background:#f5b544}.in-bar.c i{background:#e5484d}.in-bar.g i{background:#22c55e}
.in-sel{background:var(--brand-soft)!important}
.ent-health{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.ent-ring{width:92px;height:92px;border-radius:50%;display:grid;place-items:center;font-size:26px;font-weight:600}
</style>
<script>
"use strict";
/* =====================================================================
   Domain intelligence (simulated): incident similarity and change
   correlation for engineers, asset failure forecasting for the asset
   manager, onboarding and approval-flow forecasting for the HR partner,
   and the cross-domain leadership overview. All figures are computed
   locally from synthetic demo data and are labelled as such.
   ===================================================================== */
const inTag = `<span class="wb-src simulated">Simulated intelligence</span>`;
const inBar = (v, cls) => `<div class="in-bar ${cls || ""}"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div>`;

/* ----------------------------------------- incident: intelligence tab */
const IN_STOP = new Set("the a an and or of to in on for with after during not is are was be by from at as its it this that when than".split(" "));
function inTokens(t) { return new Set(String(t || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !IN_STOP.has(w))); }
function inSim(a, b) { const A = inTokens(a), B = inTokens(b); let n = 0; A.forEach((w) => { if (B.has(w)) n++; }); return n / Math.max(1, Math.min(A.size, B.size)); }
function inCauseClass(t) {
  const s = String(t || "").toLowerCase();
  return /firewall|network|packet|uplink|dns/.test(s) ? "Network or firewall" : /certificate|credential|password|token|saml|expire/.test(s) ? "Certificate or credential" : /message lock|consumer|queue|idempot|redeliver/.test(s) ? "Messaging or integration" : /for update|blocks|deadlock|schedule/.test(s) ? "Locking or job scheduling" : /index|query|schema|migration|sequential scan/.test(s) ? "Database query or schema" : /pool|connection/.test(s) ? "Connection pool sizing" : /replica|autoscal|capacity|cpu|throttl/.test(s) ? "Capacity" : /config|setting|policy|release|deploy/.test(s) ? "Configuration or release change" : "Other";
}
function wbTabIntel(run, inc) {
  const scen = wbScenario(inc) || {}; const ev = scen.evidence || {};
  const text = `${inc.title} ${inc.service} ${inc.description}`;
  const others = WB_DATA.incidents.filter((i) => i.id !== inc.id && i.id !== (scen.id || "") && i.script).map((i) => ({ i, s: inSim(text, `${i.title} ${i.service} ${i.description}`) + (i.use_case === inc.use_case ? 0.15 : 0) })).sort((a, b) => b.s - a.s).slice(0, 3);
  const rca = run && wbOut(run, "rca"); const rcaApproved = run && run.approvals.some((a) => a.gate === "rca" && a.decision === "approve");
  const cur = rca ? rca.root_cause : scen.script && scen.script.hypotheses && scen.script.hypotheses[0] ? scen.script.hypotheses[0].title : "";
  const curCls = cur ? inCauseClass(cur) : null;
  const nodeId = (() => { const svc = inTokens(`${inc.service} ${scen.service || ""}`); let best = null, bs = 0; MS_DATA.graph.nodes.forEach((n) => { const w = [...inTokens(n.label)]; const sc = w.filter((x) => svc.has(x)).length / Math.max(1, w.length); if (sc > bs) { bs = sc; best = n.id; } }); return bs >= 0.6 ? best : MS_DATA.incident_intel.node_of_use_case[inc.use_case] || "claimsapi"; })();
  const node = MS_NODE[nodeId]; const up = [...msUp(nodeId)].map((x) => MS_NODE[x]); const down = [...msDown(nodeId)].map((x) => MS_NODE[x]);
  const hist = ev.history || []; const reps = hist.filter((h) => inSim(h.title, inc.title) > 0.45);
  const eff = MS_DATA.incident_intel.effectiveness[inc.use_case] || MS_DATA.incident_intel.effectiveness.CLM;
  const done = Object.values(WB.runs).filter((r) => r.status === "completed" && (wbInc(r.incId) || {}).use_case === inc.use_case);
  const firstTime = done.filter((r) => (r.remRound || 1) === 1).length;
  const best = others[0] && others[0].i.script;
  return `<p style="font-size:12px;color:var(--ink-soft);margin:0 0 10px">${inTag} Computed locally from the synthetic incident library and the incident's evidence. Suggestions support the engineer; they never replace the RCA, the approvals or the SOP.</p>
  <div class="grid g2" style="gap:12px;align-items:start"><div>
    ${wbSec("Similar incident suggestions", others.length ? others.map(({ i, s }) => `<div style="border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin-top:6px"><div style="display:flex;justify-content:space-between;gap:8px"><span class="mono" style="font-size:11.5px">${esc(i.id)}</span><span class="note-r">${Math.round(Math.min(1, s) * 100)}% similar</span></div><div style="font-size:12.5px;font-weight:500">${esc(i.title)}</div><div style="font-size:12px;color:var(--ink-soft)">Root cause: ${esc(i.script.root_cause)}</div></div>`).join("") : "<p style='font-size:12.5px'>None.</p>")}
    ${wbSec("Historical root cause comparison", `<div class="tbl-wrap"><table class="t" style="min-width:420px"><thead><tr><th>Incident</th><th>Root cause type</th><th>Matches this incident?</th></tr></thead><tbody>${others.map(({ i }) => { const c2 = inCauseClass(i.script.root_cause); return `<tr><td class="mono" style="font-size:11.5px">${esc(i.id)}</td><td>${esc(c2)}</td><td>${curCls ? (c2 === curCls ? badge("good", "Same type") : badge("info", "Different")) : "—"}</td></tr>`; }).join("")}</tbody></table></div><p style="font-size:11.5px;color:var(--ink-muted);margin:6px 0 0">This incident: ${curCls ? `<b>${esc(curCls)}</b> (${rca ? (rcaApproved ? "approved RCA" : "draft RCA, not yet approved") : "leading hypothesis"})` : "no hypothesis yet"}.</p>`)}
    ${wbSec("Suggested resolution from a previous scenario", best ? `<ol class="wb-steps">${best.remediation.slice(0, 4).map((r, k) => `<li><span class="n">${k + 1}</span><div>${esc(r.step)}<div class="e">${esc(r.expected)}</div></div></li>`).join("")}</ol><p style="font-size:11.5px;color:var(--warn);margin:6px 0 0">From ${esc(others[0].i.id)}. A suggestion only: the executable SOP is generated from this incident's approved RCA and needs the engineer's approval.</p>` : "<p style='font-size:12.5px'>None.</p>")}
  </div><div>
    ${wbSec("Related service dependencies", `${wbKv([["Mapped service", `${node.label} (${msNodeHealth(nodeId)})`], ["Upstream", up.map((x) => `${x.label} (${msNodeHealth(x.id)})`).join(", ") || "None"], ["Downstream", down.map((x) => x.label).join(", ") || "None"]])}`)}
    ${wbSec("Change correlation", (ev.changes || []).length ? (ev.changes || []).map((c) => { const confirmed = rcaApproved && rca && String(rca.root_cause || "").includes(c.id); return `<div style="font-size:12.5px;padding:4px 0;border-bottom:1px solid var(--line)"><b style="font-weight:500">${esc(c.id)}</b> · ${esc(c.title)} (${c.t_hours != null ? `${c.t_hours} h before` : "recent"}) ${confirmed ? badge("serious", "Confirmed by the approved RCA") : badge("warning", "Suspected contributor, not confirmed")}<div style="font-size:11.5px;color:var(--ink-muted)">${esc(c.detail || "")}</div></div>`; }).join("") : `<p style="font-size:12.5px;margin:0">No changes recorded near the incident.</p>`)}
    ${wbSec("Repeat incident detection", reps.length ? `<p style="font-size:12.5px;margin:0">${badge("warning", `Repeat: ${reps.length} earlier occurrence(s)`)} ${reps.map((h) => esc(h.id)).join(", ")}. Consider a problem record so the fix holds.</p>` : hist.length ? `<p style="font-size:12.5px;margin:0">${hist.length} related past incident(s), none with the same symptom.</p>` : `<p style="font-size:12.5px;margin:0">No earlier occurrences in the history.</p>`)}
    ${wbSec("Resolution effectiveness", `${wbKv([["Fixed first time (" + inc.use_case + ", synthetic)", `${eff.fixed_first_time}%`], ["Reopened within 30 days", `${eff.reopened}%`], ["Average time to resolve", `${eff.avg_mttr_h} h`], ["This browser", done.length ? `${done.length} closed, ${firstTime} verified on the first remediation round` : "No closed runs yet"]])}`)}
  </div></div>`;
}

/* ------------------------------------------------ asset lifecycle page */
function asEval(a) {
  const clip = (x) => Math.max(0, Math.min(1, x)); const sm = a.smart; const last = sm[sm.length - 1];
  const bat = a.battery == null ? 0 : clip((85 - a.battery) / 35) * 30;
  const smart = clip(last / 25) * 30 + clip((last - sm[0]) / 20) * 10;
  const crash = clip(a.crashes_30d / 10) * 20; const age = a.age_years == null ? 5 : clip((a.age_years - 3) / 4) * 10;
  const risk = Math.round(bat + smart + crash + age);
  const wDays = a.warranty_end ? Math.round((Date.parse(a.warranty_end) - Date.now()) / 86400000) : null;
  const warranty = wDays == null ? { k: "unknown", l: "Unknown (record incomplete)", kind: "warning" } : wDays < 0 ? { k: "expired", l: `Expired ${Math.round(-wDays / 30)} mo ago`, kind: "critical" } : wDays <= 90 ? { k: "expiring", l: `Expires in ${wDays} days`, kind: "warning" } : { k: "active", l: `Active (${Math.round(wDays / 30)} mo left)`, kind: "good" };
  const repeated = a.repairs_12m >= 2;
  const stage = a.age_years == null ? "Unknown age" : a.age_years >= 5 ? "End of life" : a.age_years >= 3 ? "Mid-life" : "New";
  const rec = risk >= 70 || (warranty.k === "expired" && repeated) || (a.age_years >= 5 && risk >= 40) ? "Replace" : risk >= 45 && warranty.k === "active" ? "Repair under warranty" : risk >= 45 ? "Repair or replace: review cost" : "Monitor";
  const maint = [];
  if (a.battery != null && a.battery < 80) maint.push(`Battery at ${a.battery}%: service or replace the battery.`);
  if (last >= 5 && last > sm[0]) maint.push(`SSD reallocated sectors rising (${sm[0]} → ${last}): back up now and plan a drive replacement.`);
  if (a.crashes_30d >= 3) maint.push(`${a.crashes_30d} crashes in 30 days: run hardware diagnostics, then reimage if no fault.`);
  if (warranty.k === "expiring") maint.push("Warranty ends soon: book any warranty repair before it expires.");
  if (warranty.k === "unknown") maint.push("Purchase and warranty dates are missing: correct the asset record.");
  if (!maint.length) maint.push("No maintenance needed.");
  const window = risk >= 70 ? "Likely within 30 days" : risk >= 45 ? "Possible within 90 days" : "Low in the next 90 days";
  const prio = Math.round(risk * 0.6 + (a.age_years >= 5 ? 15 : 0) + (repeated ? 10 : 0) + (warranty.k === "expired" ? 10 : warranty.k === "unknown" ? 5 : 0));
  return { risk, window, warranty, repeated, stage, rec, maint, prio };
}
UI.as = { sel: null };
function asRaise(tag) {
  const a = MS_DATA.assets.find((x) => x.tag === tag); if (!a || !a.scripted) return;
  const tmpl = (WB_DATA.requests || []).find((r) => r.id === a.scripted); if (!tmpl) return;
  WB.seq += 1;
  const inc = { id: `DEMO-AST-S${String(WB.seq).padStart(2, "0")}`, flow: "asset", use_case: "AST", submitted: true, title: tmpl.title, description: `${tmpl.description} (Raised by the asset manager from Asset Lifecycle Intelligence: failure risk ${asEval(a).risk}/100.)`, service: "End-user devices", reported_by: "Asset Lifecycle Intelligence (raised by the asset manager)", reported_at: wbNow(), priority: tmpl.priority, impact: tmpl.impact, urgency: tmpl.urgency, asset_tag: tmpl.asset_tag || "", sn: null };
  const list = wbRequestsFor("asset");
  if (list.length >= 5) { const idle = list.filter((o) => !["running", "waiting", "attention", "paused", "failed"].includes((WB.runs[o.id] || {}).status)); const victim = (idle.length ? idle : list).sort((x, y) => Date.parse(wbReportedAt(x)) - Date.parse(wbReportedAt(y)))[0]; if (victim.submitted) { inc.replaces = victim.replaces; WB.submitted = WB.submitted.filter((s) => s.id !== victim.id); } else inc.replaces = victim.id; delete WB.runs[victim.id]; }
  WB.submitted.unshift(inc); WB.domain = "asset";
  const run = wbNewRun(inc); run.mode = "demo"; run.status = "running"; run.started = wbNow();
  wbEvent(run, "Asset Lifecycle Intelligence", "result", `Replacement review raised for ${a.tag} (Controlled Demo Mode: no ServiceNow orders).`, "ok");
  wbCommit(); wbDrive(inc.id);
  location.hash = `#/workbench/${encodeURIComponent(inc.id)}`;
}
function pageAssetInsights() {
  const rows = MS_DATA.assets.map((a) => ({ a, e: asEval(a) })).sort((x, y) => y.e.prio - x.e.prio);
  const reqs = wbRequestsFor("asset"); const runs = reqs.map((r) => WB.runs[r.id]).filter(Boolean);
  const waiting = psQueue("asset_mgr").length; const inc = Object.values(WB.runs).filter((r) => (r.flow || "incident") === "incident" && ["running", "waiting", "attention"].includes(r.status)).length;
  const tile = (ic, label, v, sub, tone) => `<div class="card tile"><div class="h"><span style="color:${tone || "var(--ink-muted)"}">${icon(ic)}</span><span class="eyebrow">${label}</span></div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  const fa = MS_DATA.fleet_age; const eol = fa.laptops[5] + fa.desktops[5];
  const sel = rows.find((r) => r.a.tag === UI.as.sel) || rows[0];
  const a = sel.a, e = sel.e;
  const smartChart = piLineChart(["-4 mo", "-3", "-2", "-1", "now"], [{ name: "SSD reallocated sectors", color: PI_COLORS[3], values: a.smart }], { label: "SSD health trend", h: 140 });
  return `${head("Asset Lifecycle Intelligence", "Device failure forecasting, warranty alerts, repeated repairs and replacement priorities. Replacement decisions go through the asset manager approval gate in the asset workflow.", "IT asset management", `<span class="pill p-warn">Synthetic telemetry</span>`)}
  <div class="grid g6" style="gap:12px">
    ${tile("usercheck", "Waiting for your approval", waiting, "Asset gates in the workflow", "var(--brand)")}
    ${tile("inbox", "Open asset requests", runs.filter((r) => !["completed", "declined"].includes(r.status)).length, `${reqs.length} tracked`)}
    ${tile("alert", "High failure risk", rows.filter((r) => r.e.risk >= 70).length, "Likely to fail within 30 days", "var(--danger)")}
    ${tile("calendar", "Warranty alerts", rows.filter((r) => ["expiring", "unknown"].includes(r.e.warranty.k)).length, "Expiring ≤ 90 days or unknown", "var(--warn)")}
    ${tile("rotate", "Repeated repairs", rows.filter((r) => r.e.repeated).length, "2+ repairs in 12 months")}
    ${tile("siren", "Active IT incidents", inc, "IT operations snapshot (this browser)")}
  </div>
  <div class="card" style="margin-top:12px"><div class="sec-head" style="padding:12px 20px;border-bottom:1px solid var(--line)"><p class="sec-title">${icon("layers")} Replacement prioritisation</p>${inTag}</div>
  <div class="tbl-wrap"><table class="t" style="min-width:980px"><thead><tr><th>Priority</th><th>Device</th><th>Department / role</th><th>Failure forecast</th><th>Warranty</th><th>Age / stage</th><th>Repairs (12 mo)</th><th>Recommendation</th><th></th></tr></thead><tbody>
  ${rows.map(({ a: x, e: y }, i) => `<tr class="click ${x.tag === a.tag ? "in-sel" : ""}" data-act="as-sel" data-t="${esc(x.tag)}"><td><b>${i + 1}</b> <span class="note-r">${y.prio}</span></td><td><span class="mono" style="font-size:11.5px">${esc(x.tag)}</span><div style="font-size:12px">${esc(x.model)}</div>${x.real_record ? `<div style="font-size:10.5px;color:var(--brand)">Record in the POC ServiceNow instance</div>` : ""}</td><td style="font-size:12px">${esc(x.dept)}<div style="color:var(--ink-muted)">${esc(x.user_role)}</div></td><td><div style="display:flex;gap:6px;align-items:center"><b>${y.risk}</b>${inBar(y.risk, y.risk >= 70 ? "c" : y.risk >= 45 ? "w" : "g")}</div><div style="font-size:11px;color:var(--ink-muted)">${esc(y.window)}</div></td><td>${badge(y.warranty.kind, y.warranty.l)}</td><td style="font-size:12px">${x.age_years != null ? `${x.age_years} yrs` : "unknown"}<div style="color:var(--ink-muted)">${esc(y.stage)}</div></td><td>${x.repairs_12m}${y.repeated ? ` ${badge("warning", "repeat")}` : ""}</td><td>${badge(y.rec === "Replace" ? "serious" : y.rec === "Monitor" ? "good" : "warning", y.rec)}</td><td>${x.scripted && y.rec !== "Monitor" ? `<button class="btn" data-act="as-raise" data-t="${esc(x.tag)}">${icon("send")} Raise replacement review</button>` : ""}</td></tr>`).join("")}
  </tbody></table></div></div>
  <div class="grid g2" style="gap:12px;margin-top:12px;align-items:start">
    <div class="card pad"><div class="sec-head"><p class="sec-title">${icon("laptop")} ${esc(a.tag)} · ${esc(a.model)}</p>${badge(e.rec === "Replace" ? "serious" : e.rec === "Monitor" ? "good" : "warning", e.rec)}</div>
      ${wbKv([["Failure forecast", `${e.risk}/100 · ${e.window}`], ["Battery health", a.battery != null ? `${a.battery}%` : "n/a (desktop)"], ["Crashes (30 days)", a.crashes_30d], ["Repairs (12 months)", `${a.repairs_12m}${e.repeated ? " (repeated)" : ""}`], ["Repair estimate vs replacement", a.repair_cost ? `$${a.repair_cost} vs $${a.replace_cost}` : `— vs $${a.replace_cost}`], ["Warranty", e.warranty.l]])}
      <div class="pi-chart" style="margin-top:8px">${smartChart}</div>
      ${wbSec("Maintenance recommendations", wbUl(e.maint))}
      <p style="font-size:11.5px;color:var(--ink-muted);margin:6px 0 0">Failure forecast = battery wear (30) + SSD errors and their trend (40) + crashes (20) + age (10). A device-health score, not a score of the person using it.</p></div>
    <div class="card pad pi-chart"><div class="sec-head"><p class="sec-title">${icon("barchart")} Fleet age and lifecycle</p><span class="note-r">${eol} devices 5+ years old</span></div>${piBarChart(fa.labels, [{ name: "Laptops", color: PI_COLORS[0], values: fa.laptops }, { name: "Desktops", color: PI_COLORS[1], values: fa.desktops }], { label: "Fleet age", note: fa.note })}
      ${wbSec("Warranty expiry alerts", wbUl(rows.filter((r) => r.e.warranty.k !== "active").map((r) => `${r.a.tag} (${r.a.model}, ${r.a.dept}): ${r.e.warranty.l}`)))}</div>
  </div>
  ${simnote("Device telemetry, repair history, fleet figures and the failure forecast are synthetic. Three devices match real hardware records in the POC ServiceNow instance; a replacement review raised here runs the existing asset workflow in Controlled Demo Mode (no orders are placed) and stops at the asset manager approval gate.")}`;
}

/* --------------------------------------------------- HR workflow page */
function hrEval(c) {
  const H = MS_DATA.hr; const rate = H.throughput[c.owner] || 2; const remaining = c.tasks_total - c.tasks_done;
  const days = Math.round((remaining / rate + c.overdue * 0.5) * 10) / 10;
  const status = days > c.start_in_days ? "Will be late" : days > c.start_in_days * 0.75 ? "At risk" : "On track";
  return { remaining, days, status, kind: status === "Will be late" ? "critical" : status === "At risk" ? "warning" : "good" };
}
function pageHrInsights() {
  const H = MS_DATA.hr; const cases = H.onboarding.map((c) => ({ c, e: hrEval(c) }));
  const waitingMine = psQueue("hr_partner").length;
  const hrRuns = wbRequestsFor("hr").map((r) => WB.runs[r.id]).filter(Boolean);
  const tile = (ic, label, v, sub, tone) => `<div class="card tile"><div class="h"><span style="color:${tone || "var(--ink-muted)"}">${icon(ic)}</span><span class="eyebrow">${label}</span></div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  const ct = H.cycle_time_h.series.Onboarding;
  const remaining = cases.reduce((a, x) => a + x.e.remaining, 0); const cap = Object.values(H.throughput).reduce((a, b) => a + b, 0) * 0.6;
  const days = Array.from({ length: 11 }, (_, i) => (i === 0 ? "today" : `+${i}d`));
  const proj = days.map((_, i) => Math.max(0, Math.round(remaining - cap * i)));
  const need = days.map((_, i) => Math.max(0, Math.round(remaining - cases.reduce((a, x) => a + (i >= x.c.start_in_days ? x.e.remaining : (x.e.remaining * i) / x.c.start_in_days), 0))));
  const bott = H.approvals.map((x) => ({ ...x, bott: x.avg_wait_h > x.sla_h }));
  return `${head("HR Workflow Intelligence", "Onboarding delay prediction, approval bottlenecks, task-completion forecasts and repeated request patterns. HR plans are approved by the HR partner in the HR workflow.", "HR services", `<span class="pill p-warn">Synthetic workflow data</span>`)}
  <div class="grid g6" style="gap:12px">
    ${tile("usercheck", "Waiting for your approval", waitingMine, "HR plan gates in the workflow", "var(--brand)")}
    ${tile("users", "Onboarding cases", cases.length, "Starting in the next 2 weeks")}
    ${tile("alert", "At risk of delay", cases.filter((x) => x.e.status !== "On track").length, "Process forecast, not a person score", "var(--danger)")}
    ${tile("hourglass", "Approval bottlenecks", bott.filter((x) => x.bott).length, "Average wait above SLA", "var(--warn)")}
    ${tile("clock", "Onboarding cycle time", `${ct[ct.length - 1]} h`, `was ${ct[0]} h eight weeks ago`)}
    ${tile("inbox", "HR requests (this browser)", hrRuns.length, `${hrRuns.filter((r) => r.status === "completed").length} completed`)}
  </div>
  <div class="card" style="margin-top:12px"><div class="sec-head" style="padding:12px 20px;border-bottom:1px solid var(--line)"><p class="sec-title">${icon("calendar")} Onboarding delay prediction</p>${inTag}</div>
  <div class="tbl-wrap"><table class="t" style="min-width:900px"><thead><tr><th>Case</th><th>Role / department</th><th>Starts in</th><th>Progress</th><th>Waiting on</th><th>Projected days to finish</th><th>Forecast</th></tr></thead><tbody>
  ${cases.map(({ c, e }) => `<tr><td class="mono" style="font-size:11.5px">${esc(c.id)}</td><td>${esc(c.role)}<div style="font-size:11.5px;color:var(--ink-muted)">${esc(c.dept)}</div></td><td>${c.start_in_days} days</td><td><div style="display:flex;gap:6px;align-items:center">${inBar((c.tasks_done / c.tasks_total) * 100)}<span style="font-size:11.5px">${c.tasks_done}/${c.tasks_total}</span></div>${c.overdue ? `<div style="font-size:11px;color:var(--danger)">${c.overdue} overdue</div>` : ""}</td><td style="font-size:12px">${esc(c.waiting_on)}</td><td>${e.days} <span style="font-size:11px;color:var(--ink-muted)">at ${MS_DATA.hr.throughput[c.owner]} tasks/day (${esc(c.owner)})</span></td><td>${badge(e.kind, e.status)}</td></tr>`).join("")}
  </tbody></table></div><p style="font-size:11.5px;color:var(--ink-muted);margin:0;padding:8px 20px">Projected days = remaining tasks ÷ the owning team's synthetic throughput, plus half a day per overdue task. It forecasts the process, never the new hire.</p></div>
  <div class="pi-charts">
    <div class="card pad pi-chart"><p class="sec-title">${icon("trend")} Task completion forecast (all onboarding cases)</p>${piLineChart(days, [{ name: "Projected open tasks", color: PI_COLORS[0], values: proj }, { name: "Needed to meet start dates", color: PI_COLORS[3], values: need, dash: true }], { label: "Task completion forecast", note: "Deterministic projection" })}</div>
    <div class="card pad"><div class="sec-head"><p class="sec-title">${icon("hourglass")} Approval bottleneck detection</p>${inTag}</div><div class="tbl-wrap"><table class="t" style="min-width:460px"><thead><tr><th>Approval step</th><th>Pending</th><th>Average wait</th><th>SLA</th><th></th></tr></thead><tbody>${bott.map((x) => `<tr><td>${esc(x.step)}</td><td>${x.pending}</td><td>${x.avg_wait_h} h</td><td>${x.sla_h} h</td><td>${x.bott ? badge("critical", "Bottleneck") : badge("good", "Within SLA")}</td></tr>`).join("")}</tbody></table></div></div>
    <div class="card pad pi-chart"><p class="sec-title">${icon("barchart")} HR request patterns (8 weeks)</p>${piLineChart(H.requests_weekly.weeks, Object.entries(H.requests_weekly.series).map(([k, v], i) => ({ name: k, color: PI_COLORS[i % 6], values: v })), { label: "HR requests per week", note: "Synthetic" })}</div>
    <div class="card pad pi-chart"><p class="sec-title">${icon("clock")} Workflow performance: cycle time (hours)</p>${piLineChart(H.cycle_time_h.weeks, Object.entries(H.cycle_time_h.series).map(([k, v], i) => ({ name: k, color: PI_COLORS[i % 6], values: v })), { label: "Cycle time", note: "Synthetic" })}</div>
  </div>
  <div class="card pad" style="margin-top:12px"><p class="sec-title">${icon("sparkles")} Repeated request patterns and suggestions</p>${H.patterns.map((p) => `<div style="padding:8px 0;border-bottom:1px solid var(--line);font-size:12.5px"><b style="font-weight:500">${esc(p.type)}:</b> ${esc(p.pattern)}<div style="color:var(--ink-soft)">Suggestion: ${esc(p.suggestion)}</div></div>`).join("")}<a class="btn" style="margin-top:10px" href="#/workbench">${icon("arrow")} Open HR requests</a></div>
  ${simnote(H.note)}`;
}

/* ------------------------------------------- leadership: enterprise view */
function entOverview() {
  piSync();
  const act = piActive(); const runs = Object.values(WB.runs);
  const pen = act.reduce((a, p) => a + ({ Critical: 15, High: 8, Moderate: 3 }[p.cls] || 0), 0) + runs.filter((r) => ["attention", "failed"].includes(r.status)).length * 5 + runs.filter((r) => r.status === "waiting").length * 1;
  const health = Math.max(0, Math.min(100, 100 - pen)); const hl = health >= 80 ? ["Healthy", "var(--ok)", "#e8f6ec"] : health >= 60 ? ["Watch", "var(--warn)", "#fdf3e3"] : ["At risk", "var(--danger)", "#fdecec"];
  const hi = act.filter((p) => ["High", "Critical"].includes(p.cls));
  const byDept = {}; act.forEach((p) => (p.groups || []).forEach((g) => { byDept[g.department] = Math.max(byDept[g.department] || 0, g.count); }));
  const depts = Object.entries(byDept).sort((a, b) => b[1] - a[1]);
  const active = runs.filter((r) => ["running", "waiting", "attention", "paused", "failed"].includes(r.status));
  const byFlow = (f) => active.filter((r) => (r.flow || "incident") === f).length;
  const q = { engineer: psQueue("engineer").length, asset_mgr: psQueue("asset_mgr").length, hr_partner: psQueue("hr_partner").length, it_admin: psQueue("it_admin").length };
  const dec = psDecisions(); const dcount = (d) => dec.filter((x) => x.decision === d).length;
  const assets = MS_DATA.assets.map(asEval); const hr = MS_DATA.hr.onboarding.map(hrEval);
  const H = MS_DATA.accuracy.records; const hcnt = (o) => H.filter((h) => h.outcome === o).length;
  const days = piDays(14); const inc = days.map((d) => PI.ledger.filter((e) => e.type === "incident" && e.at.slice(0, 10) === d).length); const prd = days.map((d) => PI.ledger.filter((e) => e.type === "prediction" && e.at.slice(0, 10) === d).length);
  const tile = (ic, label, v, sub, tone) => `<div class="card tile"><div class="h"><span style="color:${tone || "var(--ink-muted)"}">${icon(ic)}</span><span class="eyebrow">${label}</span></div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  return `<div class="card pad" style="margin-bottom:16px"><div class="sec-head"><p class="sec-title">${icon("radar")} Enterprise overview</p><span class="note-r">Read-only · calculated from this browser's demo state and synthetic datasets</span></div>
    <div class="split" style="gap:16px;margin-top:10px;grid-template-columns:minmax(0,1fr) minmax(0,2.2fr)">
      <div class="ent-health"><div class="ent-ring" style="background:${hl[2]};color:${hl[1]}">${health}</div><div><div style="font-size:15px;font-weight:600;color:${hl[1]}">${hl[0]}</div><div style="font-size:12px;color:var(--ink-soft);max-width:240px">Overall operational health: 100 minus penalties for active predicted risks (Critical 15, High 8, Moderate 3) and workflows needing attention.</div></div></div>
      <div class="grid g3" style="gap:10px">
        ${tile("trend", "Current predictive risks", act.length, `${act.filter((p) => p.cls === "Critical").length} critical · ${act.filter((p) => p.cls === "High").length} high`, "var(--brand)")}
        ${tile("users", "Potentially affected employees", Object.values(byDept).reduce((a, b) => a + b, 0).toLocaleString(), `${depts.length} department(s)`)}
        ${tile("siren", "Active workflows", active.length, `${byFlow("incident")} incident · ${byFlow("asset")} asset · ${byFlow("hr")} HR`)}
        ${tile("usercheck", "Pending approvals", q.engineer + q.asset_mgr + q.hr_partner + q.it_admin, `Eng ${q.engineer} · Asset ${q.asset_mgr} · HR ${q.hr_partner} · IT admin ${q.it_admin}`, "var(--warn)")}
        ${tile("shield", "Prediction outcomes", `${Math.round(((hcnt("mitigated") + hcnt("incident")) / H.length) * 100)}%`, `confirmed-risk rate · ${hcnt("mitigated")} mitigated (synthetic)`, "var(--ok)")}
        ${tile("check", "Approval decisions", dec.length, `${dcount("approve")} approved · ${dcount("request_changes")} changes · ${dcount("reject")} declined`)}
      </div></div>
    <div class="pi-charts">
      <div class="card pad"><p class="sec-title">${icon("alert")} High-risk services and business impact</p>${hi.length ? hi.map((p) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:13px;font-weight:500">${esc(piTarget(p).service)}</b><span>${p.score} ${piClsBadge(p.cls)}</span></div><div style="font-size:12px;color:var(--ink-soft)">${esc(p.ms ? p.ms.business_text : PI_SCEN[p.sid].impact_reason)}</div><div style="font-size:11.5px;color:var(--ink-muted)">${esc(p.status)} · ${p.affected.toLocaleString()} employees potentially affected</div></div>`).join("") : `<p style="font-size:12.5px;color:var(--ink-muted);margin:8px 0 0">No high or critical risks right now.</p>`}</div>
      <div class="card pad pi-chart"><p class="sec-title">${icon("users")} Affected employees by department</p>${depts.length ? piBarChart(depts.map(([d]) => d.split(" ")[0]), [{ name: "Potentially affected", color: PI_COLORS[0], values: depts.map(([, n]) => n) }], { label: "Affected departments", note: "Synthetic directory, department level" }) : `<p style="font-size:12.5px;color:var(--ink-muted)">None.</p>`}</div>
      <div class="card pad pi-chart"><p class="sec-title">${icon("barchart")} Incident and prediction trend (14 days)</p>${piBarChart(days.map((d) => d.slice(5)), [{ name: "Predictions", color: PI_COLORS[0], values: prd }, { name: "Incidents raised", color: PI_COLORS[3], values: inc }], { label: "Trend", note: "Includes the synthetic baseline" })}</div>
      <div class="card pad"><p class="sec-title">${icon("laptop")} Asset lifecycle and ${icon("users")} HR workflow</p>
        ${wbKv([["Devices at high failure risk", `${assets.filter((e) => e.risk >= 70).length} of ${assets.length} watched`], ["Warranty alerts", assets.filter((e) => e.warranty.k !== "active").length], ["Devices 5+ years old (fleet)", MS_DATA.fleet_age.laptops[5] + MS_DATA.fleet_age.desktops[5]], ["Onboarding cases at risk of delay", `${hr.filter((e) => e.status !== "On track").length} of ${hr.length}`], ["Onboarding cycle time", `${MS_DATA.hr.cycle_time_h.series.Onboarding.slice(-1)[0]} h (up from ${MS_DATA.hr.cycle_time_h.series.Onboarding[0]} h)`], ["HR approval bottlenecks", MS_DATA.hr.approvals.filter((x) => x.avg_wait_h > x.sla_h).map((x) => x.step).join("; ")]])}</div>
    </div></div>`;
}
const _pageTowerPS = pageTower;
pageTower = function () {
  let html = _pageTowerPS();
  if (!psCan("legacy.approve")) html = html.replace(/<div style="display:flex;gap:6px"><button class="btn danger" data-act="decide"[\s\S]*?<\/div>/g, `<span class="pill p-info">${icon("lock")} Awaiting approver</span>`);
  if (!psCanRoute("workbench")) html = html.replace(/<a class="btn" href="#\/workbench">[\s\S]*?<\/a>/g, "");
  if (!psCanRoute("predictive")) html = html.replace(/<a class="btn" href="#\/predictive">[\s\S]*?<\/a>/g, "").replace(/<a href="#\/(incident-management|asset-management|hr-services)"[^>]*>[\s\S]*?<\/a>/g, "");
  const i = html.indexOf('<div class="grid g6"');
  return i < 0 ? html : html.slice(0, i) + entOverview() + html.slice(i);
};
const IN_ACTIONS = {
  "as-sel": (el) => { UI.as.sel = el.dataset.t; render(); },
  "as-raise": (el) => asRaise(el.dataset.t),
  "ps-switch": (el) => { psSet(el.dataset.p); if (el.dataset.r && psCanRoute(el.dataset.r)) location.hash = `#/${el.dataset.r}`; },
};
</script>
