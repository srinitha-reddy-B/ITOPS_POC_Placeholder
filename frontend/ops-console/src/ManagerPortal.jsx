import { useEffect, useState } from "react";
import { api, usePoll } from "./api.js";
import Shell, { DemoTag, Drawer, Modal, go, useRoute } from "./Portal.jsx";
import { NEXT, OPS, SIGNALS, STAGE_UI, managerStatus, num, opsAt } from "./outlook.js";
import { SAMPLE_MANAGER_INCIDENTS } from "./samples.js";
import { ErrorBox, Pill, fmtTime } from "./ui.jsx";

const NAV = [["home", "Home"], ["insights", "Operational Insights", "insights"], ["incidents", "Incidents"], ["reports", "Reports"]];
const GROUPS = [["Drivers & field service", 0.42, "#0a5c9e"], ["Branch operations", 0.25, "#5b3fb5"], ["Customer service", 0.21, "#b8860b"], ["Corporate staff", 0.12, "#5d6b78"]];
const riskTone = (r) => (r === "High" || r === "Critical" ? "critical" : r === "Medium" ? "warning" : "good");

/** Jordan Patel, Operations Manager: Home, Operational Insights (the predicted escalation), Incidents, Reports. */
export default function ManagerPortal({ me, personas }) {
  const { page } = useRoute("home");
  const { data: esc, error, reload } = usePoll("/escalation", 2500);
  const cur = NAV.some(([k]) => k === page) ? page : "home";
  const body = !esc ? <><ErrorBox error={error} />{!error && <p className="muted">Loading…</p>}</>
    : { home: <Home me={me} esc={esc} />, insights: <Insights esc={esc} reload={reload} />, incidents: <Incidents />, reports: <Reports esc={esc} /> }[cur];
  return <Shell me={me} personas={personas} product="Service Hub" group="Operations Manager" nav={NAV} page={cur}>{body}</Shell>;
}

function useEsc(esc) {
  const s = esc.stage, inc = esc.incident, resolved = inc?.status === "resolved";
  const kind = (i) => (i < s ? "obs" : i === s ? (resolved ? "obs" : "cur") : s === 0 ? "idle" : resolved ? "avert" : "pred");
  return { s, st: esc.stages[s], ui: STAGE_UI[s], inc, resolved, kind, next: s >= 1 && s < 4 && !resolved ? esc.stages[s + 1] : null };
}

/* ------------------------------------------------------------------ Home */
function Home({ me, esc }) {
  const { s, st, inc, resolved } = useEsc(esc);
  const active = s && !resolved;
  return (<>
    <div className="pt-head"><div><h1>Good Morning, {me.name.split(" ")[0]}</h1><p className="pt-sub">Your operations at a glance.</p></div><DemoTag /></div>
    <div className="cards4" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
      <button className="kcard click" onClick={() => go("insights")}><small>Active escalations <span>›</span></small><b>{active ? 1 : resolved ? "1 resolved" : 0}</b>
        <span>{active ? `Outlook / Exchange Online · ${st.name}` : resolved ? "Outlook incident resolved" : "All services normal"}</span></button>
      <button className="kcard click" onClick={() => go("incidents")}><small>My incidents <span>›</span></small><b>{(inc ? 1 : 0) + SAMPLE_MANAGER_INCIDENTS.length}</b>
        <span>{inc ? `${inc.ticket?.number || "Raising…"} · ${managerStatus(inc)}` : `${SAMPLE_MANAGER_INCIDENTS.length} resolved this week`}</span></button>
      <button className="kcard click" onClick={() => go("reports")}><small>Reports <span>›</span></small><b>1</b><span>Escalation summary available</span></button>
    </div>
    {active ? (
      <button className="box esc click" onClick={() => go("insights")}>
        <span className="ic" style={{ background: STAGE_UI[s].bg, color: STAGE_UI[s].color }}>!</span>
        <span className="main"><span className="tags"><Pill tone="critical" icon={false}>Needs attention</Pill><Pill tone="neutral" icon={false}>Simulated POC data</Pill></span>
          <span className="ttl">Microsoft Outlook / Exchange Online Disruption</span>
          <span className="desc">{inc ? `${inc.ticket?.number || "Incident"} raised · IT Admin is handling it.` : "Recommended: raise an incident for IT Admin."} Open Operational Insights for details.</span></span>
        <span className="chev">›</span>
      </button>) : null}
  </>);
}

/* ---------------------------------------------------- Operational Insights */
function Insights({ esc, reload }) {
  const E = useEsc(esc);
  const { s, st, ui, inc, resolved, next } = E;
  const [drawer, setDrawer] = useState(null);
  const [modal, setModal] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState(null);
  const step = async (action) => { setErr(null); try { await api("/escalation/step", { method: "POST", body: { action } }); reload(); } catch (e) { setErr(e); setPlaying(false); } };
  useEffect(() => {
    if (!playing) return;
    if (s >= 4 || resolved) { setPlaying(false); return; }
    const t = setTimeout(() => step("next"), 3500);
    return () => clearTimeout(t);
  }, [playing, s, resolved]);
  const raise = () => (inc ? setDrawer({ k: "inc" }) : setModal("raise"));

  return (<>
    <div className="pt-head">
      <div><h1>Operational Insights</h1><p className="pt-sub">{resolved ? "All clear: the Outlook incident is resolved." : "Here's what needs your attention today."}</p></div>
      <div className="row wrap"><DemoTag />
        {resolved || esc.fixed ? <div className="sim"><button className="btn" onClick={() => step("restart")}>↺ Replay demo</button></div> : (
          <div className="sim" aria-label="Simulation controls">
            <button className="btn" disabled={s <= 0} onClick={() => { setPlaying(false); step("back"); }}>◀</button>
            <button className="btn" disabled={s >= 4} onClick={() => setPlaying(!playing)}>{playing ? "❚❚ Pause" : "▶ Play simulation"}</button>
            <button className="btn" disabled={s >= 4} onClick={() => { setPlaying(false); step("next"); }}>▶</button>
            <button className="btn" onClick={() => { setPlaying(false); step("restart"); }}>Restart</button>
          </div>)}
      </div>
    </div>
    <ErrorBox error={err} />
    <EscCard E={E} open={() => setDrawer({ k: "overview" })} />
    <Kpis E={E} esc={esc} open={(k) => setDrawer({ k })} raise={raise} />
    <section className="box" style={{ marginBottom: 16 }}>
      <div className="sec-h"><h2>Incident progression</h2>
        {resolved ? <Pill tone="good">Resolved by IT Admin · later stages averted</Pill> : (
          <div className="legend5"><span><i style={{ background: "#5d6b78" }} />Observed</span><span><i style={{ background: "#fff", boxShadow: "0 0 0 3px #d7dde4" }} />Now</span><span><i style={{ borderStyle: "dashed", background: "#fff" }} />Predicted, not confirmed</span></div>)}
      </div>
      <div className="tl">{esc.stages.map((x, i) => <Stage key={i} i={i} x={x} E={E} onClick={() => setDrawer({ k: "stage", a: i })} />)}</div>
    </section>
    <div className="g3">
      <section className="box"><h2 className="pt-h2">{resolved ? "What was prevented" : "What could happen next?"}</h2>
        {s === 0 ? <p className="muted">Nothing predicted. All services are normal.</p> : NEXT.map((n) => {
          const on = s >= n.at;
          return (
            <button key={n.key} className="row-btn click" onClick={() => setDrawer({ k: "next", a: n.key })}>
              <span><b>{n.name}</b><small>{n.short}</small></span>
              <span className="r">{resolved ? <Pill tone="good" icon={false}>{on ? "Recovered" : "Averted"}</Pill> : <Pill tone={riskTone(n.risk)} icon={false}>{n.risk}</Pill>}
                <small style={resolved ? { color: "var(--green)", fontWeight: 700 } : on ? { color: "var(--red)", fontWeight: 700 } : {}}>
                  {resolved ? (on ? "Back to normal" : "Did not happen") : on ? "Now affected (simulated)" : `Predicted ~${esc.stages[n.at].time}`}</small></span>
            </button>);
        })}
        <p className="foot-note">{resolved ? "No further impact expected." : "Illustrative predictions based on service dependencies."}</p>
      </section>
      <section className="box"><h2 className="pt-h2">{resolved ? "Signals back to normal" : "Why are we predicting this?"}</h2>
        {s === 0 ? <p className="muted">No warning signals.</p> : (
          <ul className="sig">{SIGNALS.map((g) => (
            <li key={g.key}><span className="up" style={resolved ? { background: "var(--green-bg)", color: "var(--green)" } : {}}>{resolved ? "✓" : "↑"}</span>
              <span>{resolved ? g.name : g.short}<small>{resolved ? `Was ${g.fmt(esc.series[g.key][s])} · now ${g.fmt(esc.metrics[g.key])}` : `Now ${g.fmt(esc.metrics[g.key])} · normal ${g.normal}`}</small></span></li>))}
          </ul>)}
        <button className="linkbtn" style={{ marginTop: "auto" }} onClick={() => setModal("analysis")}>{resolved ? "View the original analysis →" : "View detailed analysis →"}</button>
      </section>
      <section className="box rec-panel" style={resolved ? { borderTopColor: "var(--green)" } : {}}><h2 className="pt-h2">Recommended Action</h2>
        {resolved ? <p style={{ fontSize: 14, margin: "0 0 12px" }}><b>No action needed.</b> IT Admin fixed the cause ({inc.cause || "a Microsoft Exchange Online outage"}): Microsoft was notified, email ran through the continuity service, and service is back.</p>
          : <ol><li>Raise an incident for IT Admin to investigate and coordinate the response.</li><li>Notify relevant business teams if the impact continues to grow.</li></ol>}
        {inc ? (
          <div className="okbox"><b>✓ {managerStatus(inc)}</b>
            <TicketLine inc={inc} />
            <div style={{ marginTop: 8 }}><button className="btn" onClick={() => setDrawer({ k: "inc" })}>View handover status</button></div></div>
        ) : <button className="btn btn-primary big" disabled={!s} onClick={() => setModal("raise")}>{s ? "Raise Incident for IT Admin" : "No action needed"}</button>}
      </section>
    </div>
    {drawer && <Drawer onClose={() => setDrawer(null)}><DrawerBody d={drawer} E={E} esc={esc} raise={() => { setDrawer(null); raise(); }} openStage={(i) => setDrawer({ k: "stage", a: i })} /></Drawer>}
    {modal === "raise" && <RaiseModal E={E} esc={esc} onClose={() => setModal(null)} onRaised={() => { reload(); setModal("raised"); }} />}
    {modal === "raised" && <RaisedModal inc={inc} onClose={() => setModal(null)} />}
    {modal === "analysis" && <Modal wide onClose={() => setModal(null)}><Analysis E={E} esc={esc} /></Modal>}
  </>);
}

function TicketLine({ inc }) {
  if (inc.ticket?.number) return <div className="small" style={{ marginTop: 4 }}>ServiceNow <a href={inc.ticket.url} target="_blank" rel="noreferrer"><b>{inc.ticket.number} ↗</b></a>{inc.ticket.state ? ` · ${inc.ticket.state}` : ""} · raised {fmtTime(inc.created)}</div>;
  if (inc.ticket_errors?.length) return <div className="small" style={{ marginTop: 4, color: "var(--red)" }}>ServiceNow: {inc.ticket_errors[0].error}</div>;
  return <div className="small muted" style={{ marginTop: 4 }}>Creating the ServiceNow incident…</div>;
}

function EscCard({ E, open }) {
  const { s, st, ui, inc, resolved } = E;
  if (resolved) return (
    <button className="box esc calm click" onClick={open}>
      <span className="ic" style={{ background: "var(--green-bg)", color: "var(--green)" }}>✓</span>
      <span className="main"><span className="tags"><Pill tone="good" icon={false}>Resolved</Pill><Pill tone="good" icon={false}>No active escalation</Pill><Pill tone="neutral" icon={false}>Simulated POC data</Pill></span>
        <span className="ttl">Microsoft Outlook / Exchange Online Disruption</span>
        <span className="desc">Email access and delivery are restored. Fixed and closed by IT Admin ({inc.approval?.by || "IT"}).</span></span>
      <span className="facts"><span><small>Current status</small><b style={{ color: "var(--green)" }}>Resolved</b></span><span><small>Affected service</small><b>Outlook / Exchange Online</b></span>
        <span><small>Incident</small><b style={{ color: "var(--green)" }}>{inc.ticket?.number || inc.id} · Closed</b></span></span>
      <span className="chev">›</span>
    </button>);
  if (s === 0) return (
    <div className="box esc calm"><span className="ic" style={{ background: "var(--green-bg)", color: "var(--green)" }}>✓</span>
      <span className="main"><span className="tags"><Pill tone="good" icon={false}>No active escalation</Pill><Pill tone="neutral" icon={false}>Simulated POC data</Pill></span>
        <span className="ttl">All monitored services are operating normally</span><span className="desc">Use ▶ to play the simulated Outlook escalation.</span></span></div>);
  return (
    <button className="box esc click" onClick={open}>
      <span className="ic" style={{ background: ui.bg, color: ui.color }}>!</span>
      <span className="main"><span className="tags"><Pill tone="critical" icon={false}>Active Escalation</Pill><Pill tone="critical" icon={false}>{st.risk} Risk</Pill><Pill tone="neutral" icon={false}>Simulated POC data</Pill></span>
        <span className="ttl">Microsoft Outlook / Exchange Online Disruption</span><span className="desc">Email access and delivery are experiencing issues.</span></span>
      <span className="facts"><span><small>Current status</small><b style={{ color: ui.color }}>{st.name}</b></span><span><small>Affected service</small><b>Outlook / Exchange Online</b></span>
        <span><small>Incident</small><b style={{ color: inc ? "var(--green)" : "var(--muted)" }}>{inc ? inc.ticket?.number || "Raising…" : "Not raised"}</b></span></span>
      <span className="chev">›</span>
    </button>);
}

function Kpis({ E, esc, open, raise }) {
  const { s, st, inc, resolved, next } = E;
  const ops = opsAt(s);
  if (resolved) return (
    <div className="cards4">
      <button className="kcard done click" onClick={() => open("overview")}><small>Affected Employees <span>›</span></small><b>{num(st.employees)}</b><span>Email restored for all of them</span></button>
      <button className="kcard done click" onClick={() => open("overview")}><small>Business Operations at Risk <span>›</span></small><b>{opsAt(s).length} restored</b><span>All operations back to normal</span></button>
      <button className="kcard done click" onClick={() => open("overview")}><small>Predicted Time to Next Impact <span>›</span></small><b>Averted</b><span>{NEXT.length} predicted impacts prevented</span></button>
      <button className="kcard done click" onClick={() => open("inc")}><small>Recommended Action <span>›</span></small><b>✓ Resolved</b><span>No action needed</span></button>
    </div>);
  return (
    <div className="cards4">
      <button className="kcard click" onClick={() => open("employees")}><small>Affected Employees <span>›</span></small><b>{num(st.employees)}</b><span>Illustrative estimate</span></button>
      <button className="kcard click" onClick={() => open("ops")}><small>Business Operations at Risk <span>›</span></small><b>{ops.length}</b><span>{ops.length ? "Tap to see which" : "None at risk"}</span></button>
      <button className="kcard click" onClick={() => open("tti")}><small>Predicted Time to Next Impact <span>›</span></small><b>{s === 0 ? "—" : next ? "~30 min" : "Reached"}</b><span>{s === 0 ? "Nothing predicted" : next ? `Next: ${next.name} (predicted)` : "Final predicted stage reached"}</span></button>
      {inc ? <button className="kcard done click" onClick={() => open("inc")}><small>Recommended Action <span>›</span></small><b>✓ Incident raised</b><span>{inc.ticket?.number || "ServiceNow incident being created"} · Assigned to IT Admin</span></button>
        : <button className="kcard act click" onClick={s ? raise : () => open("tti")}><small>Recommended Action <span>›</span></small><b>{s ? "Raise Incident" : "No action needed"}</b><span>{s ? "For IT Admin to investigate" : "Nothing to escalate"}</span></button>}
    </div>);
}

function Stage({ i, x, E, onClick }) {
  const k = E.kind(i), ui = STAGE_UI[i], live = k === "obs" || k === "cur", grey = k === "idle" || k === "avert", c = grey ? "#c3ccd6" : ui.color;
  const tag = k === "cur" ? (i === 1 ? "Now · started here" : "Now") : k === "obs" ? (E.resolved && i === E.s ? "Peak · fixed" : i === 1 ? "Observed · started here" : "Observed") : k === "pred" ? "Predicted" : k === "avert" ? "Averted" : "Not predicted";
  return (
    <button className={`st5 ${grey ? "idle" : k}`} onClick={onClick} style={{ "--lc": i <= E.s ? ui.color : grey ? "#dfe4ea" : ui.color + "88", "--ls": i <= E.s ? "solid" : "dashed" }}>
      <span className="d" style={live ? { background: c, borderColor: c, boxShadow: k === "cur" ? `0 0 0 6px ${ui.bg}` : undefined } : { borderColor: c, borderStyle: "dashed" }} />
      <b style={k === "cur" ? { color: ui.color } : k === "avert" ? { textDecoration: "line-through" } : undefined}>{x.name}</b>
      <time>{k === "idle" ? "—" : `${k === "pred" || k === "avert" ? "~" : ""}${x.time}`}</time>
      <em style={{ color: k === "idle" ? "var(--muted)" : k === "avert" ? "var(--green)" : c, background: k === "cur" ? ui.bg : k === "obs" ? "var(--neutral-bg)" : k === "avert" ? "var(--green-bg)" : "transparent" }}>{tag}</em>
    </button>);
}

function Handover({ inc }) {
  const p = inc.progress || { steps: ["Received", "Investigating", "Fix ready", "Fixing", "Resolved"], step: 0 };
  return (<>
    <div className="flow5">{p.steps.map((t, i) => <span key={t} style={{ display: "contents" }}>{i ? <span className="arr">→</span> : null}
      <span className={`s ${i < p.step || (i === p.step && inc.status === "resolved") ? "done" : i === p.step ? "cur" : ""}`}><i>{i < p.step || (i === p.step && inc.status === "resolved") ? "✓" : i + 1}</i>{t}</span></span>)}</div>
    <p className="res-src">{p.text}</p>
  </>);
}

function DrawerBody({ d, E, esc, raise, openStage }) {
  const { s, st, inc, resolved, next } = E;
  if (d.k === "inc" && inc) return (<>
    <span className="eyebrow">Incident record · ServiceNow</span>
    <h2 style={{ fontSize: 19, margin: "6px 0" }}>{inc.ticket?.number || inc.id}</h2>
    <Pill tone={resolved ? "good" : "info"} icon={false}>{managerStatus(inc)}</Pill>
    <dl className="dl"><dt>Incident</dt><dd>{inc.title}</dd><dt>Reported by</dt><dd>{inc.reporter?.name} · {inc.reporter?.title}</dd>
      <dt>Raised</dt><dd>{fmtTime(inc.created)}</dd><dt>ServiceNow</dt><dd>{inc.ticket?.number ? <a href={inc.ticket.url} target="_blank" rel="noreferrer">{inc.ticket.number} ↗</a> : "Being created…"}{inc.ticket?.state ? ` · ${inc.ticket.state}` : ""}</dd>
      {inc.cause && <><dt>Root cause (IT)</dt><dd>{inc.cause}</dd></>}{inc.approval?.decision && <><dt>Fix decision</dt><dd>{inc.approval.decision} by {inc.approval.by}</dd></>}</dl>
    <div className="h-sm">Handover status</div><Handover inc={inc} />
  </>);
  if (d.k === "inc") return <p className="muted">Not raised yet.</p>;
  if (d.k === "overview") return (<>
    <span className="eyebrow">Incident overview · simulated</span><h2 style={{ fontSize: 19, margin: "6px 0" }}>Microsoft Outlook / Exchange Online Disruption</h2>
    <div className="tags">{resolved ? <Pill tone="good">Resolved</Pill> : <><Pill tone="critical" icon={false}>Active Escalation</Pill><Pill tone="critical" icon={false}>{st.risk} Risk</Pill></>}</div>
    <dl className="dl"><dt>What's happening</dt><dd>{resolved ? "Email access and delivery are restored." : "Email access and delivery are experiencing issues."}</dd>
      <dt>Affected service</dt><dd>Outlook / Exchange Online</dd><dt>Started</dt><dd>{esc.stages[1].time}</dd>
      <dt>{resolved ? "Peak" : "Current status"}</dt><dd><b style={{ color: STAGE_UI[s].color }}>{st.name}</b> (as of {st.time})</dd>
      {!resolved && <><dt>Next (predicted)</dt><dd>{next ? `${next.name} at ~${next.time}` : "Final predicted state reached"}</dd></>}
      <dt>Affected employees</dt><dd>{resolved ? `0 (restored for ${num(st.employees)})` : `${num(st.employees)} (illustrative)`}</dd>
      <dt>Incident</dt><dd>{inc ? `${inc.ticket?.number || inc.id} · ${managerStatus(inc)}` : "Not raised yet"}</dd></dl>
    <div className="actions" style={{ justifyContent: "flex-start" }}>
      {inc ? null : s ? <button className="btn btn-primary" onClick={raise}>Raise Incident for IT Admin</button> : null}
      <button className="btn" onClick={() => openStage(s)}>Current stage details</button></div>
  </>);
  if (d.k === "stage") {
    const i = d.a, x = esc.stages[i], ui = STAGE_UI[i], k = E.kind(i);
    const label = { obs: "Observed", cur: "Current state", pred: "Predicted: not confirmed", idle: "Not predicted", avert: "Averted: did not happen" }[k];
    return (<>
      <span className="eyebrow">Incident progression · stage {i + 1} of 5</span><h2 style={{ fontSize: 19, margin: "6px 0", color: ui.color }}>{x.name}</h2>
      <span className="pill" style={{ background: ui.bg, color: ui.color }}>{label}</span>
      <dl className="dl"><dt>{k === "pred" ? "Expected around" : "Time"}</dt><dd>{k === "idle" ? "—" : k === "pred" ? `~${x.time}, if the current trend continues` : x.time}</dd>
        <dt>What {k === "pred" || k === "avert" ? "would happen" : "happened"}</dt><dd>{ui.desc}</dd>
        <dt>Warning signals{k === "pred" ? " (projected)" : ""}</dt><dd><ul>{SIGNALS.map((g) => <li key={g.key}>{g.name}: <b>{g.fmt(esc.series[g.key][i])}</b></li>)}</ul></dd>
        <dt>Business impact</dt><dd>{ui.impact}</dd></dl>
      <div className="callout">{k === "avert" ? "This stage was predicted but did not happen: IT Admin fixed the incident first." : k === "pred" ? "This is a prediction, not a confirmed event. It can change if the trend changes or IT intervenes." : k === "cur" ? "This is where the incident is now." : k === "obs" ? "This stage has already happened." : "Nothing is predicted while all services are normal."} All values are simulated.</div>
    </>);
  }
  if (d.k === "next") {
    const n = NEXT.find((x) => x.key === d.a), on = s >= n.at;
    return (<>
      <span className="eyebrow">What could happen next · illustrative</span><h2 style={{ fontSize: 19, margin: "6px 0" }}>{n.name}</h2>
      <div className="tags"><Pill tone={riskTone(n.risk)} icon={false}>{n.risk}</Pill><Pill tone={resolved ? "good" : on ? "critical" : "neutral"} icon={false}>{resolved ? (on ? "Recovered" : "Averted: did not happen") : on ? "Now affected (simulated)" : "Predicted: not confirmed"}</Pill></div>
      <dl className="dl"><dt>Why it may be affected</dt><dd>{n.why}</dd><dt>Link to the Outlook incident</dt><dd>{n.rel}</dd><dt>Business consequence</dt><dd>{n.conseq}</dd>
        <dt>Prediction status</dt><dd>{on ? `Reached at ${esc.stages[n.at].time} in the simulation.` : `Expected around ~${esc.stages[n.at].time} (${esc.stages[n.at].name}) if the trend continues.`}</dd></dl>
      <div className="callout">A dependency-based prediction for this demo. It does not mean this service is actually affected.</div>
    </>);
  }
  if (d.k === "employees") {
    let left = st.employees;
    const parts = GROUPS.map(([n, f, c], j) => { const v = j === GROUPS.length - 1 ? left : Math.round(st.employees * f); left -= v; return { n, v, c }; });
    return (<>
      <span className="eyebrow">Employee impact · illustrative</span><h2 style={{ fontSize: 19, margin: "6px 0" }}>{num(st.employees)} employees affected</h2>
      <p className="muted">Employees whose email or calendar is slow or failing now ({st.name}).</p>
      {st.employees > 0 && <table className="tbl"><tbody>{parts.map((p) => <tr key={p.n}><td><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: p.c, marginRight: 6 }} />{p.n}</td><td style={{ textAlign: "right" }}><b>{num(p.v)}</b></td></tr>)}</tbody></table>}
      <div className="h-sm">If it worsens</div><p style={{ margin: 0 }}>{next ? `About ${num(next.employees)} employees at the next stage (${next.name}, ~${next.time}).` : "No further growth predicted."}</p>
      <div className="callout">Illustrative figures for this demo, not actual Crystal Clean employee data.</div>
    </>);
  }
  if (d.k === "ops") {
    const ops = opsAt(s), more = OPS.filter((o) => !ops.includes(o));
    return (<>
      <span className="eyebrow">Business operations · simulated</span><h2 style={{ fontSize: 19, margin: "6px 0" }}>{ops.length} operations at risk</h2>
      {ops.length ? ops.map((o) => <div key={o.name} className="row-btn"><span><b>{o.name}</b><small>{o.effect}</small></span><Pill tone="warning" icon={false}>At risk</Pill></div>) : <p className="muted">No operations at risk.</p>}
      {more.length > 0 && s > 0 && <><div className="h-sm">Could be added if it worsens</div><ul className="list">{more.map((o) => <li key={o.name}>{o.name} (from {esc.stages[o.from].name}, ~{esc.stages[o.from].time})</li>)}</ul></>}
    </>);
  }
  if (d.k === "tti") return (<>
    <span className="eyebrow">Prediction explained</span><h2 style={{ fontSize: 19, margin: "6px 0" }}>Predicted time to next impact: {s === 0 ? "none" : next ? "~30 minutes" : "reached"}</h2>
    {next ? <><p>If nothing changes, the incident moves from <b>{st.name}</b> to <b>{next.name}</b> at about <b>{next.time}</b>.</p>
      <ul className="list"><li>Based on how fast the warning signals are rising.</li><li>It is a forecast, not a confirmed event.</li><li>It can change if the trend changes or IT intervenes.</li></ul>
      <div className="h-sm">What it would mean</div><p style={{ margin: 0 }}>{STAGE_UI[s + 1].impact}</p></>
      : <p>{s === 0 ? "All services are normal, so nothing is predicted." : "The incident has reached the last predicted state."}</p>}
    <div className="callout">Simulated, rule-based estimate for this demo. Not a verified outage prediction.</div>
  </>);
  return null;
}

function RaiseModal({ E, esc, onClose, onRaised }) {
  const { s, st } = E;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const confirm = async () => {
    setBusy(true); setErr(null);
    try { await api("/escalation/raise", { method: "POST", body: { note } }); onRaised(); } catch (e) { setErr(e); setBusy(false); }
  };
  return (
    <Modal onClose={onClose}>
      <span className="eyebrow">Review before raising</span><h2 style={{ fontSize: 20, margin: "6px 0 2px" }}>Raise incident for IT Admin</h2>
      <dl className="dl"><dt>Incident title</dt><dd><b>Microsoft Outlook / Exchange Online Disruption</b></dd><dt>Priority</dt><dd><Pill tone="critical" icon={false}>High</Pill></dd>
        <dt>Reported by</dt><dd>Jordan Patel · Operations</dd><dt>Affected service</dt><dd>Outlook / Exchange Online</dd>
        <dt>Current state</dt><dd><b style={{ color: STAGE_UI[s].color }}>{st.name}</b> (as of {st.time})</dd>
        <dt>Predicted consequences</dt><dd><ul>{NEXT.map((n) => <li key={n.key}>{n.name}: {n.risk} risk</li>)}</ul></dd>
        <dt>Supporting signals</dt><dd><ul>{SIGNALS.map((g) => <li key={g.key}>{g.short} ({g.fmt(esc.metrics[g.key])})</li>)}</ul></dd>
        <dt>Note for IT (optional)</dt><dd><input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Saved in the ServiceNow incident" style={{ width: "100%" }} /></dd></dl>
      <div className="callout">This raises a <b>real ServiceNow incident</b> assigned to IT. The mail telemetry behind the escalation is simulated.</div>
      <ErrorBox error={err} />
      <div className="actions"><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={confirm}>{busy ? "Raising…" : "Confirm and Raise Incident"}</button></div>
    </Modal>);
}

function RaisedModal({ inc, onClose }) {
  return (
    <Modal onClose={onClose}>
      <div style={{ textAlign: "center", padding: "6px 0 2px" }}>
        <div style={{ width: 54, height: 54, borderRadius: "50%", background: "var(--green-bg)", color: "var(--green)", display: "grid", placeItems: "center", fontSize: 26, fontWeight: 800, margin: "0 auto 10px" }}>✓</div>
        <h2 style={{ fontSize: 20, margin: 0 }}>Incident raised</h2>
        <p className="muted" style={{ margin: "6px 0 0" }}>{inc?.ticket?.number ? <>ServiceNow <a href={inc.ticket.url} target="_blank" rel="noreferrer"><b>{inc.ticket.number} ↗</b></a> · assigned to IT Admin</> : inc?.ticket_errors?.length ? `ServiceNow: ${inc.ticket_errors[0].error}` : "Creating the ServiceNow incident…"}</p>
      </div>
      {inc && <><div className="h-sm">Handover status</div><Handover inc={inc} /></>}
      <div className="actions"><button className="btn" onClick={onClose}>Done</button><button className="btn btn-primary" onClick={() => { onClose(); go("incidents"); }}>View in Incidents</button></div>
    </Modal>);
}

function Analysis({ E, esc }) {
  const { s, st } = E;
  const ratio = (g) => (esc.baseline[g.key] ? `${Math.round(esc.series[g.key][s] / esc.baseline[g.key])}× normal` : `${esc.series[g.key][s]} services`);
  return (<>
    <span className="eyebrow">Detailed analysis · simulated values</span><h2 style={{ fontSize: 20, margin: "6px 0 2px" }}>Why we predict further impact</h2>
    <p className="muted" style={{ margin: 0 }}>State: <b style={{ color: STAGE_UI[s].color }}>{st.name}</b> as of {st.time}</p>
    <div className="h-sm">1 · Anomaly detection</div>
    <table className="tbl"><thead><tr><th>Signal</th><th>Normal</th><th>At {st.name}</th><th>Result</th></tr></thead>
      <tbody>{SIGNALS.map((g) => <tr key={g.key}><td>{g.name}</td><td>{g.normal}</td><td><b>{g.fmt(esc.series[g.key][s])}</b></td><td>{s ? <Pill tone="critical" icon={false}>Anomalous</Pill> : <Pill tone="good" icon={false}>Normal</Pill>}</td></tr>)}</tbody></table>
    <div className="h-sm">2 · Dependency correlation</div><ul className="list">{NEXT.map((n) => <li key={n.key}><b>{n.name}</b> → {n.rel}</li>)}</ul>
    <div className="h-sm">3 · Causal analysis</div>
    <dl className="dl" style={{ marginTop: 0 }}><dt>Most likely cause</dt><dd>{s ? "Microsoft Exchange Online server outage on Microsoft's side (IT confirms and notifies Microsoft)" : "None, all signals normal"}</dd>
      <dt>Ruled out</dt><dd><ul><li>Crystal Clean network: branch connectivity is normal at every site.</li><li>Employee devices: the same symptoms appear at several sites at once.</li><li>Company sign-in: other applications sign in normally.</li></ul></dd></dl>
    <div className="h-sm">4 · Prediction confidence</div><p style={{ margin: 0 }}><b>{s === 0 ? "Not applicable" : s === 1 ? "Medium–High" : "High"}</b> <span className="muted">A rule-based, illustrative estimate, not a verified outage prediction.</span></p>
    <div className="h-sm">5 · Supporting evidence</div>
    {s ? <ul className="list">{SIGNALS.map((g) => <li key={g.key}>{g.name}: {ratio(g)}</li>)}<li>The rise started at {esc.stages[1].time} and has kept growing each step.</li></ul> : <p className="muted">No evidence of an issue.</p>}
  </>);
}

/* -------------------------------------------------------------- Incidents */
function Incidents() {
  const { data, error } = usePoll("/manager/incidents", 3000);
  const [sel, setSel] = useState(null);
  const live = data || [];
  const list = [...live, ...SAMPLE_MANAGER_INCIDENTS];
  const cur = live.find((x) => x.id === sel);
  return (<>
    <div className="pt-head"><div><h1>Incidents</h1><p className="pt-sub">Incidents you have raised for IT Admin, live from ServiceNow.</p></div></div>
    <ErrorBox error={error} />
    {!list.length ? null : (
      <section className="box">
        <table className="tbl"><thead><tr><th>ServiceNow</th><th>Incident</th><th>Priority</th><th>Raised</th><th>Status</th></tr></thead>
          <tbody>{list.map((i) => (
            <tr key={i.id} role="button" tabIndex={0} onClick={() => !i.sample && setSel(i.id)}>
              <td>{i.ticket?.url ? <a className="mono" href={i.ticket.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><b>{i.ticket.number} ↗</b></a> : <b className="mono">{i.number || i.ticket?.number || "Creating…"}</b>}</td>
              <td>{i.title}{i.sample && <span className="sample-tag">Sample</span>}</td>
              <td><Pill tone={i.severity === "critical" || i.severity === "high" ? "critical" : "warning"} icon={false}>{i.severity === "critical" ? "Critical" : i.severity === "high" ? "High" : "Medium"}</Pill></td>
              <td>{i.sample ? new Date(i.created * 1000).toLocaleDateString([], { day: "numeric", month: "short" }) : fmtTime(i.created)}</td><td><Pill tone={i.status === "resolved" ? "good" : "info"} icon={false}>{i.statusText || managerStatus(i)}</Pill></td></tr>))}</tbody></table>
        {live[0] && <><div className="h-sm">Handover status · {live[0].ticket?.number || live[0].id}</div><Handover inc={live[0]} /></>}
      </section>)}
    {cur && <Drawer onClose={() => setSel(null)}>
      <span className="eyebrow">Incident record · ServiceNow</span><h2 style={{ fontSize: 19, margin: "6px 0" }}>{cur.ticket?.number || cur.id}</h2>
      <Pill tone={cur.status === "resolved" ? "good" : "info"} icon={false}>{managerStatus(cur)}</Pill>
      <dl className="dl"><dt>Incident</dt><dd>{cur.title}</dd><dt>Raised</dt><dd>{fmtTime(cur.created)}</dd>
        <dt>ServiceNow</dt><dd>{cur.ticket?.url ? <a href={cur.ticket.url} target="_blank" rel="noreferrer">{cur.ticket.number} ↗</a> : "Being created…"}{cur.ticket?.state ? ` · ${cur.ticket.state}` : ""}</dd>
        {cur.cause && <><dt>Root cause (IT)</dt><dd>{cur.cause}</dd></>}</dl>
      <div className="h-sm">Handover status</div><Handover inc={cur} />
    </Drawer>}
  </>);
}

/* ---------------------------------------------------------------- Reports */
function Reports({ esc }) {
  const { s, st, inc, resolved } = useEsc(esc);
  const text = () => ["Crystal Clean Service Hub - Escalation summary", "SIMULATED mail telemetry (POC). The ServiceNow incident is real.", "",
    "Incident: Microsoft Outlook / Exchange Online Disruption", `Current state: ${resolved ? "Resolved" : `${st.name} (${st.risk} risk)`}`,
    `Affected employees (illustrative): ${resolved ? 0 : num(st.employees)}`, `ServiceNow incident: ${inc?.ticket?.number || "not raised"}`,
    `Status: ${inc ? managerStatus(inc) : "not raised"}`, inc?.cause ? `Root cause: ${inc.cause}` : "", "", "Prepared for Jordan Patel, Operations Manager."].filter((l) => l !== null).join("\n");
  const download = () => { const u = URL.createObjectURL(new Blob([text()], { type: "text/plain" })), a = document.createElement("a"); a.href = u; a.download = "outlook-escalation-summary.txt"; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); };
  return (<>
    <div className="pt-head"><div><h1>Reports</h1><p className="pt-sub">Summaries you can share with your team.</p></div><DemoTag /></div>
    <div className="g2">
      <section className="box"><h2 className="pt-h2">Escalation summary · Outlook / Exchange Online</h2>
        <dl className="dl"><dt>Current state</dt><dd>{resolved ? <b style={{ color: "var(--green)" }}>Resolved</b> : <><b style={{ color: STAGE_UI[s].color }}>{st.name}</b> · {st.risk} risk</>}</dd>
          <dt>Started</dt><dd>{s ? `${esc.stages[1].time} (Degrading)` : "No escalation"}</dd><dt>Affected employees</dt><dd>{resolved ? 0 : num(st.employees)} (illustrative)</dd>
          <dt>ServiceNow incident</dt><dd>{inc?.ticket?.number ? <a href={inc.ticket.url} target="_blank" rel="noreferrer">{inc.ticket.number} ↗</a> : "Not raised"}</dd>
          <dt>Status</dt><dd>{inc ? managerStatus(inc) : "Not raised"}</dd></dl>
        <button className="btn btn-primary" onClick={download}>Download summary (.txt)</button></section>
      <section className="box"><h2 className="pt-h2">Predicted vs. what happened</h2>
        {s >= 2 ? <ul className="list">{esc.stages.slice(2, s + 1).map((x, j) => <li key={x.name}><b>{x.name}</b>: predicted at {esc.stages[j + 1].time} for ~{x.time}, reached at {x.time}</li>)}</ul>
          : <p className="muted">No predicted state has been reached yet.</p>}
        {resolved && <p className="foot-note">The remaining predicted stages were averted by the fix.</p>}</section>
    </div>
  </>);
}
