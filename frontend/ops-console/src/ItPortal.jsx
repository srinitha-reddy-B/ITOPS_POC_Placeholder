import { useState } from "react";
import { api, usePoll } from "./api.js";
import DemoDrawer from "./DemoDrawer.jsx";
import Desk from "./Desk.jsx";
import OutlookMap from "./OutlookMap.jsx";
import Shell, { DemoTag, Drawer, go, useRoute } from "./Portal.jsx";
import ResetButton from "./ResetButton.jsx";
import { FC_AT, MAP, NEXT, SIGNALS, STAGE_UI, health, num } from "./outlook.js";
import { SAMPLE_TICKETS } from "./samples.js";
import { Confidence, ErrorBox, LineChart, Pill, USECASES, ago, eta, fmtTime } from "./ui.jsx";

const NAV = [["home", "Home"], ["command", "Command Center"], ["queue", "Incident Queue"], ["workbench", "Incident Workbench"],
  ["predictive", "Predictive Intelligence"], ["observability", "Observability"],
  ["recs", "Recommendations & Approvals"], ["reports", "Reports"]];
const OPEN = ["new", "investigating", "awaiting_approval", "remediating", "verifying"];
const LABEL = { new: "New – Awaiting Investigation", investigating: "Under Investigation", awaiting_approval: "Awaiting Approval", remediating: "Remediation in Progress", verifying: "Validating Fix",
  resolved: "Resolved", closed: "Closed", escalated: "With an engineer", failed: "Failed", interrupted: "Interrupted", cancelled: "Cancelled" };
const TONE = { new: "info", resolved: "good", awaiting_approval: "warning", investigating: "info", remediating: "info", verifying: "info", escalated: "serious", failed: "critical" };
const TEAM = { sso: "Service Desk", storage: "Server Operations", api: "Application Support", network: "Network Operations", backup: "Database Operations", mail: "IT Admin · Application Support" };
const prio = (sev) => ({ critical: "Critical", high: "High", warning: "Medium", medium: "Medium" }[sev] || "Low");
const source = (t) => (t.via ? "Predictive Escalation – Manager Portal" : t.origin === "employee" ? "Employee – IT help bot" : "Monitoring (predictive alert)");
const bucket = (s) => (s === "new" ? "new" : s === "awaiting_approval" ? "approval" : ["investigating", "remediating", "verifying"].includes(s) ? "investigating" : ["resolved", "closed"].includes(s) ? "resolved" : "other");
const today = (ts) => new Date(ts * 1000).toDateString() === new Date().toDateString();
const Status = ({ s }) => <Pill tone={TONE[s] || "neutral"} icon={false}>{LABEL[s] || s}</Pill>;
/** ServiceNow number: a link to the incident in ServiceNow when it is a live one; sample incidents are tagged. */
const IncLink = ({ t }) => (t.ticket?.url
  ? <a className="mono" href={t.ticket.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><b>{t.ticket.number} ↗</b></a>
  : <span><b className="mono">{t.ticket?.number || t.number || t.id}</b>{t.sample && <span className="sample-tag">Sample</span>}</span>);
const Row = ({ className, onClick, children }) => <div role="button" tabIndex={0} className={className} onClick={onClick} onKeyDown={(e) => e.key === "Enter" && onClick()}>{children}</div>;
async function beginInvestigation(id) { await api(`/investigations/${id}/begin`, { method: "POST" }); go("workbench", id); }
const Prio = ({ sev }) => { const p = prio(sev); return <Pill tone={p === "Critical" || p === "High" ? "critical" : p === "Medium" ? "warning" : "neutral"} icon={false}>{p}</Pill>; };

/** Mark Wood (and other IT staff with ops-engineer): the IT Admin Portal. */
export default function ItPortal({ me, personas }) {
  const { page, arg } = useRoute("home");
  const [demo, setDemo] = useState(false);
  const tk = usePoll("/tickets", 3000);
  const esc = usePoll("/escalation", 3000);
  const apr = usePoll("/approvals", 3000);
  const [sampleDone, setSampleDone] = useState({});
  const [sampleSel, setSampleSel] = useState(null);
  const cur = NAV.some(([k]) => k === page) ? page : "home";
  const live = tk.data?.tickets || [];
  const samples = SAMPLE_TICKETS.map((x) => ({ ...x, status: sampleDone[x.id] || x.status, ticket: { number: x.number } }));
  const tickets = [...live, ...samples];
  const openTicket = (t) => (t.sample ? setSampleSel(t) : go("workbench", t.id));
  const ctx = { me, tickets, tk, esc: esc.data, apr: apr.data, reloadApr: apr.reload, openTicket, samples, sampleDone, setSampleDone };
  const pending = (apr.data?.pending?.length || 0) + samples.filter((x) => x.status === "awaiting_approval").length;
  const selT = cur === "workbench" && arg ? live.find((x) => x.id === arg) : null;
  const extra = me.can_engineer && <><button className="btn btn-sm" onClick={() => setDemo(true)}>Demo controls</button><ResetButton onDone={() => go("home")} /></>;
  const body = { home: <Home {...ctx} />, command: <Command {...ctx} />, queue: <Queue {...ctx} />, workbench: <Desk me={me} sel={arg} onSelect={(id) => go("workbench", id)} />,
    predictive: <Predictive {...ctx} />, observability: <Observability {...ctx} />, recs: <Recs {...ctx} />, reports: <Reports {...ctx} /> }[cur];
  return (
    <Shell me={me} personas={personas} product="IT Admin Portal" group="IT Admin Portal" nav={NAV} page={cur} badges={{ recs: pending }} extra={extra}>
      {cur === "workbench" && <div className="pt-head"><div><h1>Incident Workbench</h1><p className="pt-sub">Follow an incident through the 14 agents, stage by stage.</p></div></div>}
      {selT?.status === "new" && <StartBanner t={selT} />}
      {body}
      {sampleSel && <SampleDrawer t={sampleSel} onClose={() => setSampleSel(null)} />}
      {demo && <DemoDrawer onClose={() => setDemo(false)} />}
    </Shell>
  );
}

function mailIncident(tickets) { return tickets.find((t) => t.via && t.usecase === "mail"); }

function StartBanner({ t }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  return (
    <div className="box notif row wrap" style={{ marginBottom: 16 }}>
      <Pill tone="info" icon={false}>New – Awaiting Investigation</Pill>
      <b>{t.ticket?.number || t.id}: the agents have not started. Review the incident, then start the investigation.</b><span className="spacer" />
      <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { await beginInvestigation(t.id); } catch (e) { setErr(e); setBusy(false); } }}>{busy ? "Starting…" : "Start Investigation"}</button>
      <ErrorBox error={err} />
    </div>);
}

function SampleDrawer({ t, onClose }) {
  return (
    <Drawer onClose={onClose}>
      <span className="eyebrow">Sample incident · illustrative</span><h2 style={{ fontSize: 19, margin: "6px 0" }}>{t.number}</h2>
      <div className="tags"><Status s={t.status} /><Prio sev={t.severity} /></div>
      <dl className="dl"><dt>Incident</dt><dd>{t.title}</dd><dt>Summary</dt><dd>{t.summary}</dd><dt>Service</dt><dd>{USECASES[t.usecase]?.label}</dd>
        <dt>Source</dt><dd>{source(t)}{t.reporter ? ` (${t.reporter})` : ""}</dd><dt>Assigned team</dt><dd>{TEAM[t.usecase]}</dd>{t.cause && <><dt>Root cause</dt><dd>{t.cause}</dd></>}
        <dt>Timeline</dt><dd><ul>{t.timeline.map(([h, x]) => <li key={h + x}><b>{h}</b> {x}</li>)}</ul></dd></dl>
      <div className="callout">Illustrative sample data so the portal shows a realistic day. Live incidents carry real ServiceNow numbers.</div>
    </Drawer>);
}

/* ------------------------------------------------------------------ Home */
function Home({ me, tickets, esc, apr }) {
  const open = tickets.filter((t) => OPEN.includes(t.status)).length;
  const pending = [...(apr?.pending || []), ...tickets.filter((t) => t.sample && t.status === "awaiting_approval").map((t) => ({ title: t.title, sample: true }))];
  const mi = mailIncident(tickets);
  const s = esc?.stage || 0, fixed = !!esc?.fixed;
  const healthy = Object.keys(MAP).filter((k) => health(k, s, fixed) === "healthy").length;
  const next = s && !fixed && s < 4 ? esc.stages[s + 1] : null;
  const att = mi?.status === "new" ? [`New: ${mi.ticket?.number || "incident"} raised by ${mi.reporter} (Manager Portal)`, "Review and start", () => go("workbench", mi.id)]
    : pending.length ? [`${pending[0].title}: a fix is waiting for your approval`, "Review", () => go("recs")]
    : mi && OPEN.includes(mi.status) ? [`${mi.ticket?.number || "New incident"} raised by ${mi.reporter} (Manager Portal)`, "View incident", () => go("workbench", mi.id)]
    : s && !fixed ? ["The predictive engine forecasts an Outlook / Exchange disruption", "View forecast", () => go("predictive")] : null;
  return (<>
    <div className="pt-head"><div><h1>Good morning, {me.name.split(" ")[0]}</h1><p className="pt-sub">IT Admin Portal · your day at a glance.</p></div></div>
    {att ? <div className="box notif row wrap"><Pill tone="info" icon={false}>Needs your attention</Pill><b>{att[0]}</b><span className="spacer" /><button className="btn btn-primary" onClick={att[2]}>{att[1]}</button></div>
      : <div className="box notif" style={{ borderLeftColor: "var(--green)" }}><Pill tone="good" icon={false}>All clear</Pill> <b>Nothing needs your attention right now.</b></div>}
    <div className="cards4">
      <button className="kcard click" onClick={() => go("queue")}><small>Open incidents <span>›</span></small><b>{open}</b><span>In the Incident Queue</span></button>
      <button className={`kcard click ${pending.length ? "attn" : ""}`} onClick={() => go("recs")}><small>Awaiting your approval <span>›</span></small><b>{pending.length}</b><span>{pending.length ? "Decisions waiting" : "Nothing waiting"}</span></button>
      <button className="kcard click" onClick={() => go("predictive")}><small>Next predicted impact <span>›</span></small><b>{next ? `~${next.time}` : fixed ? "Averted" : "~09:10"}</b><span>{next ? `${next.name} (predicted)` : fixed ? "Outlook escalation fixed in time" : "Teams and Calendar, if it starts"}</span></button>
      <button className="kcard click" onClick={() => go("predictive")}><small>Services healthy <span>›</span></small><b>{healthy}/{Object.keys(MAP).length}</b><span>Outlook dependency model</span></button>
    </div>
    <section className="box"><h2 className="pt-h2">Go to</h2><div className="home-links">
      {[["command", "Command Center", "Incidents, approvals and activity"], ["workbench", "Incident Workbench", "The agent pipeline, stage by stage"], ["predictive", "Predictive Intelligence", "What might happen next"], ["observability", "Observability", "Telemetry and integrations"]]
        .map(([k, l, d]) => <button key={k} className="row-btn click" onClick={() => go(k)}><span><b>{l}</b><small>{d}</small></span><span>›</span></button>)}
    </div></section>
  </>);
}

/* -------------------------------------------------------- Command Center */
function Command({ tickets, esc, apr, tk, openTicket }) {
  const n = { open: tickets.filter((t) => OPEN.includes(t.status)).length, critical: tickets.filter((t) => OPEN.includes(t.status) && t.severity === "critical").length,
    investigating: tickets.filter((t) => bucket(t.status) === "investigating").length, approval: tickets.filter((t) => t.status === "awaiting_approval").length,
    resolved: tickets.filter((t) => bucket(t.status) === "resolved" && today(t.created)).length };
  const mi = mailIncident(tickets);
  const { data: ev } = usePoll("/events", 5000);
  const acts = (ev || []).filter((e) => ["investigation", "approval", "escalation", "alert", "demo"].includes(e.kind)).slice(0, 8);
  const kpi = (k, label, v, attn) => <button className={`kcard click ${attn && v ? "attn" : ""}`} onClick={() => go("queue", k)}><small>{label} <span>›</span></small><b>{v}</b></button>;
  return (<>
    <div className="pt-head"><div><h1>Command Center</h1><p className="pt-sub">Here's what needs IT attention.</p></div></div>
    <ErrorBox error={tk.error} />
    {mi && OPEN.includes(mi.status) && (
      <div className="box notif">
        <div className="row wrap"><Pill tone="info" icon={false}>New incident</Pill><span className="demo-tag">Simulated mail telemetry · real ServiceNow incident</span><span className="spacer" /><span className="small muted">From the Manager Portal · {ago(mi.created)}</span></div>
        <dl className="notif-dl">
          <div><dt>Incident ID</dt><dd><IncLink t={mi} /></dd></div><div style={{ gridColumn: "span 2" }}><dt>Title</dt><dd><b>{mi.title}</b></dd></div>
          <div><dt>Source</dt><dd>{source(mi)}</dd></div><div><dt>Raised by</dt><dd>{mi.reporter} – Manager</dd></div><div><dt>Priority</dt><dd><Prio sev={mi.severity} /></dd></div>
          <div><dt>Affected employees</dt><dd>{num(esc?.stages?.[esc.stage]?.employees || 1240)}</dd></div><div><dt>Status</dt><dd><Status s={mi.status} /></dd></div></dl>
        <div className="row"><button className={`btn ${mi.status === "new" ? "" : "btn-primary"}`} onClick={() => go("workbench", mi.id)}>View Incident</button>
          {mi.status === "new" && <button className="btn btn-primary" onClick={() => beginInvestigation(mi.id)}>Start Investigation</button>}
          {mi.ticket?.url && <a className="btn" href={mi.ticket.url} target="_blank" rel="noreferrer">Open in ServiceNow ↗</a>}</div>
      </div>)}
    <div className="cards5">{kpi("open", "Open Incidents", n.open)}{kpi("critical", "Critical Incidents", n.critical, true)}{kpi("investigating", "Under Investigation", n.investigating)}{kpi("approval", "Awaiting Approval", n.approval, true)}{kpi("resolved", "Resolved Today", n.resolved)}</div>
    <div className="g2">
      <section className="box"><div className="sec-h"><h2>Recent incidents</h2><button className="linkbtn" onClick={() => go("queue")}>View queue →</button></div>
        {tickets.slice(0, 6).map((t) => <Row key={t.id} className="row-btn click" onClick={() => openTicket(t)}><span><IncLink t={t} /><small>{t.title}</small></span><span className="r"><Status s={t.status} /><small>{ago(t.created)}</small></span></Row>)}
        {!tickets.length && <p className="muted">No incidents yet.</p>}</section>
      <div className="stack" style={{ alignContent: "start" }}>
        <section className="box"><h2 className="pt-h2">Pending approvals</h2>
          {(apr?.pending || []).map((p) => <button key={p.investigation} className="row-btn click" onClick={() => go("recs")}><span><b>{p.title}</b><small>{p.request?.recommended_action || "Confirm hand-over"}</small></span><span className="r"><Pill tone="warning" icon={false}>Needs approval</Pill><small>Review ›</small></span></button>)}
          {tickets.filter((x) => x.sample && x.status === "awaiting_approval").map((x) => <button key={x.id} className="row-btn click" onClick={() => go("recs")}><span><b>{x.title}<span className="sample-tag">Sample</span></b><small>{x.recommendation.action}</small></span><span className="r"><Pill tone="warning" icon={false}>Needs approval</Pill><small>Review ›</small></span></button>)}
          {!apr?.pending?.length && !tickets.some((x) => x.sample && x.status === "awaiting_approval") && <p className="muted">Nothing waiting for approval.</p>}</section>
        <section className="box"><h2 className="pt-h2">Incident activity</h2>
          {acts.length ? <ul className="tl-list">{acts.map((e) => <li key={e.id}><time>{fmtTime(e.ts)}</time><span>{e.summary}</span><em>{e.source}</em></li>)}</ul> : <p className="muted">No activity yet.</p>}</section>
      </div>
    </div>
  </>);
}

/* -------------------------------------------------------- Incident Queue */
function Queue({ tickets, tk, openTicket }) {
  const { arg } = useRoute("queue");
  const [f, setF] = useState({ priority: "all", status: ["open", "critical", "investigating", "approval", "resolved"].includes(arg) ? (arg === "critical" ? "open" : arg) : "all", service: "all", source: "all" });
  const pri = arg === "critical" && f.priority === "all" ? "Critical" : f.priority;
  const rows = tickets.filter((t) => (pri === "all" || prio(t.severity) === pri) && (f.service === "all" || t.usecase === f.service) && (f.source === "all" || source(t) === f.source)
    && (f.status === "all" || (f.status === "open" ? OPEN.includes(t.status) : f.status === "resolved" ? bucket(t.status) === "resolved" && (arg !== "resolved" || today(t.created)) : bucket(t.status) === f.status)));
  const grp = (k, label, opts) => <div className="fgrp"><span>{label}</span>{[["all", "All"], ...opts].map(([v, l]) => <button key={v} className={`fchip ${(k === "priority" ? pri : f[k]) === v ? "on" : ""}`} onClick={() => setF({ ...f, [k]: v })}>{l}</button>)}</div>;
  return (<>
    <div className="pt-head"><div><h1>Incident Queue</h1><p className="pt-sub">Every incident for IT, with its ServiceNow number.</p></div></div>
    <ErrorBox error={tk.error} />
    <section className="box" style={{ marginBottom: 12 }}>
      {grp("priority", "Priority", ["Critical", "High", "Medium", "Low"].map((p) => [p, p]))}
      {grp("status", "Status", [["open", "Open"], ["new", "New"], ["investigating", "Under Investigation"], ["approval", "Awaiting Approval"], ["resolved", "Resolved / Closed"]])}
      {grp("service", "Service", [...new Set(tickets.map((t) => t.usecase))].map((u) => [u, USECASES[u]?.label || u]))}
      {grp("source", "Source", [...new Set(tickets.map(source))].map((s) => [s, s]))}
      <div className="small muted">Showing {rows.length} of {tickets.length}</div>
    </section>
    <div className="qhead"><span>Incident ID</span><span>Title</span><span>Priority</span><span>Source</span><span>Affected service</span><span>Status</span><span>Assigned team</span><span>Created</span></div>
    {rows.map((t) => (
      <Row key={t.id} className="qrow click" onClick={() => openTicket(t)}>
        <IncLink t={t} /><span>{t.title}</span><span><Prio sev={t.severity} /></span><span>{source(t)}</span>
        <span>{USECASES[t.usecase]?.label || t.usecase}</span><span><Status s={t.status} /></span><span>{TEAM[t.usecase] || "Service Desk"}</span><span>{fmtTime(t.created)}</span>
      </Row>))}
    {!rows.length && <div className="box"><p className="muted">No incidents match these filters.</p></div>}
  </>);
}

/* ------------------------------------------------- Predictive Intelligence */
function Predictive({ esc, tickets }) {
  const [tab, setTab] = useState("forecast");
  const { data: alerts } = usePoll("/alerts", 6000);
  const mi = mailIncident(tickets);
  const tabs = [["forecast", "Outlook / Exchange forecast"], ["alerts", "Predictive alerts"], ["model", "Integration services model"]];
  return (<>
    <div className="pt-head"><div><h1>Predictive Intelligence</h1><p className="pt-sub">What is likely to happen next, when, and which services it reaches.</p></div></div>
    <div className="fgrp" style={{ marginBottom: 16 }}>{tabs.map(([k, l]) => <button key={k} className={`fchip ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === "model" ? <iframe className="frame" title="Integration services model" src="/crystal-clean/pi-model.html" />
      : tab === "alerts" ? <Alerts alerts={alerts || []} />
      : esc ? <Forecast esc={esc} mi={mi} /> : <p className="muted">Loading…</p>}
  </>);
}

function Forecast({ esc, mi }) {
  const [sel, setSel] = useState(null);
  const s = esc.stage, fixed = esc.fixed, st = esc.stages[s], next = !fixed && s && s < 4 ? esc.stages[s + 1] : null;
  if (!s) return <><div className="box" style={{ marginBottom: 16 }}><Pill tone="good">No active prediction</Pill><p className="muted">All Outlook / Exchange signals are within normal ranges.</p></div><OutlookMap esc={esc} mode="forecast" /></>;
  const rows = [2, 3, 4].map((i) => {
    const x = esc.stages[i], svcs = Object.keys(FC_AT).filter((k) => FC_AT[k] === i).map((k) => MAP[k].label), n = NEXT.find((m) => m.at === i);
    const status = i <= s ? (fixed ? ["Happened · recovered", "good"] : ["Happening now", "critical"]) : fixed ? ["Averted", "good"] : ["Predicted", "info"];
    return { i, x, svcs, risk: n?.risk || "Medium", status, when: i > s && !fixed ? `in ~${(i - s) * 30} min` : "" };
  });
  const r = sel != null ? rows.find((x) => x.i === sel) : null;
  return (<>
    {fixed && <div className="box notif" style={{ borderLeftColor: "var(--green)" }}><Pill tone="good" icon={false}>Forecast closed</Pill> <b>The fix was applied{esc.fixed_by ? ` (approved by ${esc.fixed_by})` : ""}; the remaining predicted impacts were averted.</b></div>}
    <div className="cards4">
      <div className="kcard"><small>Current state</small><b style={{ color: fixed ? "var(--green)" : STAGE_UI[s].color }}>{fixed ? "Recovered" : st.name}</b><span>Started {esc.stages[1].time} · {st.risk} risk</span></div>
      <div className="kcard"><small>Next predicted</small><b>{next ? `~${next.time}` : "None"}</b><span>{next ? `${next.name} · in ~30 min` : fixed ? "Escalation stopped" : "Final stage reached"}</span></div>
      <div className="kcard"><small>Confidence</small><b>{s === 1 ? "Medium–High" : "High"}</b><span>Rule-based, illustrative</span></div>
      <button className="kcard click" disabled={!mi} onClick={() => mi && go("workbench", mi.id)}><small>Incident {mi && <span>›</span>}</small><b style={{ fontSize: 19 }}>{mi?.ticket?.number || (mi ? "Creating…" : "Not raised")}</b><span>{mi ? LABEL[mi.status] : "The manager raises it from Operational Insights"}</span></button>
    </div>
    <section className="box" style={{ marginBottom: 16 }}><div className="sec-h"><h2>What might happen</h2><span className="demo-tag">Simulated</span></div>
      {rows.map((r) => (
        <button key={r.i} className="fc-row click" onClick={() => setSel(r.i)}>
          <span className="t"><b>~{r.x.time}</b><small>{r.when}</small></span>
          <span><b style={{ color: STAGE_UI[r.i].color }}>{r.x.name}</b><small>{STAGE_UI[r.i].desc}</small><small>Services: {r.svcs.join(", ")} · about {num(r.x.employees)} employees</small></span>
          <span className="r"><Pill tone={r.risk === "High" ? "critical" : "warning"} icon={false}>{r.risk}</Pill><Pill tone={r.status[1]} icon={false}>{r.status[0]}</Pill></span>
        </button>))}
    </section>
    <section className="box" style={{ marginBottom: 16 }}><h2 className="pt-h2">Signal forecast</h2>
      <table className="tbl"><thead><tr><th>Signal</th><th>Normal</th>{esc.stages.slice(1).map((x, j) => <th key={x.name}>{j + 1 > s ? "~" : ""}{x.time}{j + 1 === s ? " (now)" : ""}</th>)}</tr></thead>
        <tbody>{SIGNALS.map((g) => <tr key={g.key}><td>{g.name}</td><td>{g.normal}</td>{esc.series[g.key].slice(1).map((v, j) => <td key={j} style={j + 1 > s ? { color: "var(--purple)", fontStyle: "italic" } : { fontWeight: 700 }}>{fixed && j + 1 > s ? "averted" : g.fmt(v)}</td>)}</tr>)}</tbody></table>
      <p className="res-src">Bold = observed. Purple italic = projected if nothing is done. Simulated values.</p></section>
    <OutlookMap esc={esc} mode="forecast" />
    {r && <Drawer onClose={() => setSel(null)}>
      <span className="eyebrow">Forecast · simulated</span><h2 style={{ fontSize: 19, margin: "6px 0", color: STAGE_UI[r.i].color }}>{r.x.name} · ~{r.x.time}</h2>
      <div className="tags"><Pill tone={r.status[1]} icon={false}>{r.status[0]}</Pill></div>
      <dl className="dl"><dt>What would happen</dt><dd>{STAGE_UI[r.i].desc}</dd><dt>Services hit</dt><dd>{r.svcs.join(", ")}</dd>
        <dt>Why it is predicted</dt><dd>Dependency path: Microsoft Exchange Online (outage) → Outlook → {r.svcs.join(" / ")}.</dd>
        <dt>Signals at that point</dt><dd><ul>{SIGNALS.map((g) => <li key={g.key}>{g.name}: <b>{g.fmt(esc.series[g.key][r.i])}</b></li>)}</ul></dd>
        <dt>Business impact</dt><dd>{STAGE_UI[r.i].impact}</dd><dt>How to prevent it</dt><dd>Before {r.x.time}: notify Microsoft and switch to the email continuity workaround (Recommendations &amp; Approvals).</dd></dl>
      <button className="btn btn-primary" onClick={() => go("recs")}>Recommendations &amp; Approvals</button>
    </Drawer>}
  </>);
}

function Alerts({ alerts }) {
  const live = alerts.filter((a) => ["open", "investigating"].includes(a.status));
  return (
    <section className="box"><h2 className="pt-h2">Predictive alerts from monitoring</h2>
      {!live.length && <p className="muted">No open predictive alerts. They appear when a monitored signal is heading for its threshold.</p>}
      {live.map((a) => (
        <button key={a.id} className="row-btn click" onClick={() => a.investigation_id && go("workbench", a.investigation_id)}>
          <span><b>{USECASES[a.usecase]?.icon} {a.title}</b><small>{a.source} · {a.metric}: {String(a.current)} (threshold {String(a.threshold)}) · first seen {ago(a.first_seen)}</small></span>
          <span className="r"><Pill tone={a.severity === "critical" ? "critical" : "warning"} icon={false}>Risk {a.risk_score}</Pill><small>{a.eta_s ? `Threshold in ${eta(a.eta_s)}` : "At threshold"}</small></span>
        </button>))}
    </section>);
}

/* ---------------------------------------------------------- Observability */
function Observability({ esc }) {
  const [tab, setTab] = useState("outlook");
  const { data: ints, error } = usePoll("/integrations", 15000);
  const base = new Date(); base.setHours(8, 0, 0, 0);
  const at = (t) => { const [h, m] = t.split(":").map(Number); const d = new Date(base); d.setHours(h, m); return d.getTime() / 1000; };
  const series = (k) => (esc ? esc.stages.slice(0, esc.stage + 1).map((x, i) => [at(x.time), esc.series[k][i]]).concat(esc.fixed ? [[at(esc.stages[esc.stage].time) + 900, esc.metrics[k]]] : []) : []);
  return (<>
    <div className="pt-head"><div><h1>Observability</h1><p className="pt-sub">Telemetry and evidence behind each incident, and the state of every integration.</p></div></div>
    <div className="fgrp" style={{ marginBottom: 16 }}>{[["outlook", "Outlook incident (simulated)"], ["integrations", "Integrations & live data"]].map(([k, l]) => <button key={k} className={`fchip ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === "outlook" ? (esc && <>
      <div className="row wrap" style={{ marginBottom: 12 }}>{[["availability_pct", "Availability", "%"], ["latency_ms", "Response latency", " ms"], ["failed_per_min", "Failed requests", " /min"], ["auth_errors_per_min", "Authentication errors", " /min"], ["error_rate_pct", "Error rate", "%"]].map(([k, l, u]) => (
        <div key={k} className="kcard" style={{ width: "auto", minWidth: 150 }}><small>{l}</small><b style={{ fontSize: 20, color: esc.fixed || !esc.stage ? "var(--green)" : "var(--red)" }}>{esc.metrics[k]}{u}</b></div>))}<DemoTag>Simulated telemetry</DemoTag></div>
      <div className="g2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {[["availability_pct", "Service availability over time", "%", 99.5], ["latency_ms", "Response latency over time", " ms", 300], ["failed_per_min", "Failed requests over time", " /min", 10], ["auth_errors_per_min", "Authentication errors over time", " /min", 20]].map(([k, l, u, thr]) => (
          <section key={k} className="box"><h2 className="pt-h2">{l}</h2><LineChart series={[{ name: l, points: series(k) }]} unit={u} thresholds={[{ value: thr, label: "normal" }]} min={k === "availability_pct" ? 70 : 0} max={k === "availability_pct" ? 100 : undefined} /></section>))}
      </div>
      <p className="res-src">Simulated mail telemetry for this POC: there is no Microsoft tenant in the lab. Points follow the escalation stages; the last point after a fix is the post-fix reading.</p>
    </>) : (<>
      <ErrorBox error={error} />
      <section className="box"><table className="tbl"><thead><tr><th>Integration</th><th>Status</th><th>Collecting</th><th>Detail</th></tr></thead>
        <tbody>{(ints || []).map((i) => <tr key={i.key}><td><b>{i.name}</b></td><td><Pill tone={i.ok ? "good" : "warning"} icon={false}>{i.status}</Pill></td><td className="small">{i.collecting}</td><td className="small muted">{i.detail}{i.console && <> · <a href={i.console} target="_blank" rel="noreferrer">open ↗</a></>}</td></tr>)}</tbody></table>
        <p className="res-src">Each tool shows Connected only when a real health check passes.</p></section>
    </>)}
  </>);
}

/* ------------------------------------------- Recommendations & Approvals */
function Recs({ me, apr, reloadApr, samples, setSampleDone }) {
  const [comment, setComment] = useState({});
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const decide = async (p, decision) => {
    setBusy(p.investigation); setErr(null);
    try { await api(`/investigations/${p.investigation}/decision`, { method: "POST", body: { decision, comment: comment[p.investigation] || "" } }); reloadApr(); }
    catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const pending = apr?.pending || [], hist = apr?.history || [];
  return (<>
    <div className="pt-head"><div><h1>Recommendations &amp; Approvals</h1><p className="pt-sub">Fixes the agents propose. Nothing is changed until an IT approver decides.</p></div></div>
    <ErrorBox error={err} />
    {!pending.length && !samples.some((x) => x.recommendation) && <div className="box" style={{ marginBottom: 16 }}><p className="muted">No recommendation is waiting for a decision.</p></div>}
    {samples.filter((x) => x.recommendation).map((x) => { const r = x.recommendation, open = x.status === "awaiting_approval"; return (
      <div key={x.id} className={`apr ${open ? "pending" : ""}`}>
        <div className="row wrap" style={{ alignItems: "flex-start" }}><div style={{ flex: 1 }}><b style={{ fontSize: 15, color: "var(--head)" }}>{r.action}</b>
          <div className="row wrap small" style={{ marginTop: 6 }}><span className="mono">{x.number} · {x.title}</span><span className="sample-tag">Sample</span></div></div>
          <Pill tone={open ? "warning" : x.status === "resolved" ? "good" : "neutral"}>{open ? "Pending approval" : x.status === "resolved" ? "Approved · applied" : "Rejected"}</Pill></div>
        <dl className="dl"><dt>Reason (root cause)</dt><dd>{x.cause}</dd><dt>Expected outcome</dt><dd>{r.outcome}</dd><dt>Operational risk</dt><dd><Pill tone="good" icon={false}>{r.risk}</Pill></dd>
          <dt>Potential side effects</dt><dd><ul>{r.side.map((s) => <li key={s}>{s}</li>)}</ul></dd><dt>Approval requirement</dt><dd>Required: an IT approver</dd></dl>
        {open && <div className="row wrap"><button className="btn btn-good" disabled={!me.can_approve} onClick={() => setSampleDone((d) => ({ ...d, [x.id]: "resolved" }))}>Approve</button>
          <button className="btn btn-danger" disabled={!me.can_approve} onClick={() => setSampleDone((d) => ({ ...d, [x.id]: "closed" }))}>Reject</button></div>}
      </div>); })}
    {pending.map((p) => { const r = p.request || {}; return (
      <div key={p.investigation} className="apr pending">
        <div className="row wrap" style={{ alignItems: "flex-start" }}><div style={{ flex: 1 }}><b style={{ fontSize: 15, color: "var(--head)" }}>{r.recommended_action || "Confirm the hand-over to an engineer"}</b>
          <div className="row wrap small" style={{ marginTop: 6 }}><span className="mono">{p.title}</span><span className="eng-ai demo-tag">AI-generated, evidence-checked</span>{r.mode && <Pill tone={r.mode === "real" ? "critical" : "neutral"} icon={false}>{r.mode === "real" ? "Real action" : "Simulated action"}</Pill>}</div></div>
          <Pill tone="warning">Pending approval</Pill></div>
        <dl className="dl">
          <dt>Reason (root cause)</dt><dd>{r.root_cause || "Not established"} <span className="muted">· confidence</span> <Confidence value={r.confidence} /></dd>
          <dt>Supporting evidence</dt><dd>{(r.evidence || []).length} evidence items ({(r.evidence || []).slice(0, 6).join(", ")}) · <button className="linkbtn" onClick={() => go("workbench", p.investigation)}>open in Workbench</button></dd>
          <dt>Expected outcome</dt><dd>{r.expected_outcome || "—"}</dd>
          <dt>Operational risk</dt><dd><Pill tone={r.risk_level === "critical" ? "critical" : "warning"} icon={false}>{r.risk_level}</Pill> {r.business_impact}</dd>
          <dt>Potential side effects</dt><dd>{(r.potential_risks || []).length ? <ul>{r.potential_risks.map((x) => <li key={x}>{x}</li>)}</ul> : "—"}</dd>
          <dt>Approval requirement</dt><dd>Required: a Keycloak user with the ops-approver role</dd></dl>
        <input type="text" placeholder="Comment (saved in ServiceNow)" value={comment[p.investigation] || ""} onChange={(e) => setComment({ ...comment, [p.investigation]: e.target.value })} style={{ width: "100%" }} />
        <div className="row wrap" style={{ marginTop: 10 }}>
          <button className="btn btn-good" disabled={!me.can_approve || busy === p.investigation} onClick={() => decide(p, "approve")}>Approve</button>
          <button className="btn btn-danger" disabled={!me.can_approve || busy === p.investigation} onClick={() => decide(p, "reject")}>Reject</button>
          <button className="btn" disabled={!me.can_approve || busy === p.investigation} onClick={() => decide(p, "false_positive")}>Mark as false positive</button>
          {!me.can_approve && <span className="small muted">Needs the Keycloak role ops-approver</span>}
        </div>
      </div>); })}
    {hist.length > 0 && <section className="box"><h2 className="pt-h2">Decisions</h2><table className="tbl"><thead><tr><th>When</th><th>Incident</th><th>Action</th><th>Decision</th><th>By</th></tr></thead>
      <tbody>{hist.slice(0, 15).map((h, i) => <tr key={i} role="button" tabIndex={0} onClick={() => go("workbench", h.investigation)}><td>{fmtTime(h.decided)}</td><td>{h.title}</td><td className="small">{h.request?.recommended_action || "Hand-over"}</td><td><Pill tone={h.decision === "approve" ? "good" : "neutral"} icon={false}>{h.decision || "—"}</Pill></td><td>{h.by}</td></tr>)}</tbody></table></section>}
  </>);
}

/* ---------------------------------------------------------------- Reports */
function Reports({ tickets }) {
  const { data } = usePoll("/outcomes", 10000);
  const by = [...new Set(tickets.map((t) => t.usecase))].map((u) => ({ u, n: tickets.filter((t) => t.usecase === u).length, open: tickets.filter((t) => t.usecase === u && OPEN.includes(t.status)).length }));
  const download = () => {
    const text = ["Crystal Clean IT Admin Portal - Incident report", "", ...tickets.map((t) => `${t.ticket?.number || t.id}  ${LABEL[t.status] || t.status}  ${t.title}${t.cause ? `  | cause: ${t.cause}` : ""}`)].join("\n");
    const u = URL.createObjectURL(new Blob([text], { type: "text/plain" })), a = document.createElement("a"); a.href = u; a.download = "it-incident-report.txt"; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
  };
  const c = data?.counts || {};
  return (<>
    <div className="pt-head"><div><h1>Reports</h1><p className="pt-sub">Incident outcomes and where they happen.</p></div><button className="btn btn-primary" onClick={download}>Download report (.txt)</button></div>
    <div className="cards4">{[["mitigated", "Mitigated before impact"], ["incident", "Became incidents (fixed)"], ["false_positive", "False positives"], ["ongoing", "Ongoing"]].map(([k, l]) => <div key={k} className="kcard"><small>{l}</small><b>{c[k] ?? 0}</b></div>)}</div>
    <section className="box"><h2 className="pt-h2">Incidents by service</h2>
      <table className="tbl"><thead><tr><th>Service</th><th>Total</th><th>Open</th></tr></thead>
        <tbody>{by.map((r) => <tr key={r.u} role="button" tabIndex={0} onClick={() => go("queue")}><td>{USECASES[r.u]?.icon} {USECASES[r.u]?.label || r.u}</td><td>{r.n}</td><td>{r.open}</td></tr>)}</tbody></table>
      <p className="res-src">{data?.note || ""}</p></section>
  </>);
}
