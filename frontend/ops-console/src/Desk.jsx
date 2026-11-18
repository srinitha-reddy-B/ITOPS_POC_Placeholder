import { useEffect, useState } from "react";
import { api, usePoll } from "./api.js";
import AgentFlow from "./AgentFlow.jsx";
import InvestigationGraph from "./Graph.jsx";
import { Confidence, Empty, ErrorBox, Pill, USECASES, ago, fmtTime } from "./ui.jsx";

const STEPS = [
  ["Reported", (d) => true],
  ["Investigating", (d) => d.agents.some((a) => a.key === "evidence" && a.status === "done")],
  ["Root cause", (d) => d.agents.some((a) => a.key === "rca" && a.status === "done")],
  ["Approval", (d) => d.approvals?.some((g) => g.decision)],
  ["Fix applied", (d) => d.agents.some((a) => a.key === "remediation" && a.status === "done")],
  ["Verified", (d) => d.verification?.passed],
  ["Resolved", (d) => d.status === "resolved"],
];
const TONE = { new: "info", resolved: "good", awaiting_approval: "warning", escalated: "serious", failed: "critical", closed: "neutral", cancelled: "neutral", interrupted: "neutral" };
const LABEL = { new: "New: not started", investigating: "Investigating", awaiting_approval: "Needs approval", remediating: "Fixing", verifying: "Verifying", resolved: "Resolved",
  closed: "Closed", escalated: "Engineer", failed: "Failed", interrupted: "Interrupted", cancelled: "Cancelled" };

export default function Desk({ me, sel, onSelect }) {
  const { data, error } = usePoll("/tickets", 3000);
  const list = data?.tickets || [];
  useEffect(() => { if (!sel && list.length) onSelect(list[0].id); }, [sel, list.length]);
  return (
    <div className="desk">
      <aside className="tlist">
        <div className="tlist-h">Tickets {data && !data.servicenow && <Pill tone="warning">ServiceNow not configured</Pill>}</div>
        <ErrorBox error={error} />
        {!list.length && <Empty>No tickets yet. They appear when an employee asks the bot or monitoring spots a problem.</Empty>}
        {list.map((t) => (
          <button key={t.id} className={`titem ${sel === t.id ? "on" : ""}`} onClick={() => onSelect(t.id)}>
            <div className="row small">
              <span className="mono">{t.ticket?.number || t.id}</span><span className="spacer" />
              <Pill tone={TONE[t.status] || "info"} icon={false}>{LABEL[t.status] || t.status}</Pill>
            </div>
            <div className="tt">{USECASES[t.usecase]?.icon} {t.title}</div>
            <div className="small muted">{t.reporter ? `Reported by ${t.reporter}` : "Detected by monitoring"} · {ago(t.created)}</div>
          </button>
        ))}
      </aside>
      <section>{sel ? <Ticket id={sel} me={me} /> : <Empty>Select a ticket.</Empty>}</section>
    </div>
  );
}

function Ticket({ id, me }) {
  const { data: d, error, reload } = usePoll(`/investigations/${id}`, 1500);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Empty>Loading…</Empty>;
  const reached = STEPS.map(([, f]) => !!f(d));
  const cur = reached.lastIndexOf(true);
  const live = d.agents.find((a) => a.status === "running");
  const winner = d.candidates?.find((c) => c.key === d.rca?.cause_key);
  return (
    <div className="stack">
      <div className="card">
        <div className="row wrap" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="row small wrap">
              {d.ticket?.number ? <a className="inc" href={d.ticket.url} target="_blank" rel="noreferrer">{d.ticket.number} ↗</a> : <span className="muted">No ServiceNow incident</span>}
              {d.ticket?.state && <Pill tone="neutral" icon={false}>ServiceNow: {d.ticket.state}</Pill>}
              <span className="muted">{USECASES[d.usecase]?.label}</span>
            </div>
            <h2 style={{ margin: "6px 0 2px" }}>{d.title}</h2>
            <div className="small muted">{d.reporter ? <>Reported by <b>{d.reporter.name}</b>: “{d.reporter.text}”</> : "Detected by monitoring before anyone reported it"} · {fmtTime(d.created)}</div>
          </div>
          <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
            <Pill tone={TONE[d.status] || "info"}>{LABEL[d.status] || d.status}</Pill>
            {d.ticket?.url && <a className="btn btn-sm" href={d.ticket.url} target="_blank" rel="noreferrer">View in ServiceNow ↗</a>}
          </div>
        </div>
        <div className="stepper">
          {STEPS.map(([label], i) => (
            <div key={label} className={`st ${reached[i] ? "done" : ""} ${i === cur + 1 && !["resolved", "closed", "escalated"].includes(d.status) ? "now" : ""}`}>
              <i>{reached[i] ? "✓" : i + 1}</i><span>{label}</span>
            </div>
          ))}
        </div>
        {live && <div className="small muted" style={{ marginTop: 8 }}>⏳ {live.name} is working…</div>}
        {d.before_after?.length > 0 && (
          <div className="ba">
            <div className="ba-h">{d.verification?.passed ? "✓ Problem solved, measured on the live system" : "Measured on the live system"}</div>
            {d.before_after.map((r) => (
              <div key={r.label} className="ba-row"><span className="ba-l">{r.label}</span>
                <span className="ba-b">{r.before}</span><span className="ba-arrow">→</span><span className="ba-a">{r.after}</span></div>
            ))}
          </div>
        )}
      </div>

      <AgentFlow inv={d} />

      <div className="grid-2">
        <div className="card">
          <h3>Root cause</h3>
          {d.rca?.cause ? (<>
            <p className="cause">{d.rca.cause}</p>
            <div className="row wrap" style={{ gap: 18 }}>
              <div><div className="small muted">Confidence</div><Confidence value={d.rca.confidence} /></div>
              {winner && <div><div className="small muted">Evidence checks</div><b>{winner.passed}/{winner.tests.length} passed</b></div>}
              <div><div className="small muted">Ruled out</div><b>{d.rca.alternatives_ruled_out?.length || 0} other causes</b></div>
            </div>
            {winner && <ul className="checks">{winner.tests.map((t, i) => <li key={i} className={t.passed ? "ok" : "no"}>{t.check} <span className="muted">({String(t.actual)})</span></li>)}</ul>}
          </>) : d.rca ? <p className="muted">No cause the evidence supports: handed to an engineer.</p> : <p className="muted">The agents are collecting evidence…</p>}
        </div>
        <Approval d={d} me={me} onDone={reload} />
      </div>

      <div className="card">
        <div className="row"><h3>How it fits together</h3><span className="spacer" /><span className="small muted">Red = root cause · green = fixed</span></div>
        <InvestigationGraph inv={d} height={360} />
      </div>

    </div>
  );
}

function Approval({ d, me, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [comment, setComment] = useState("");
  const g = d.approvals?.[d.approvals.length - 1];
  const waiting = d.status === "awaiting_approval" && g && !g.decision;
  async function decide(decision) {
    setBusy(true); setErr(null);
    try { await api(`/investigations/${d.id}/decision`, { method: "POST", body: { decision, comment } }); onDone(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <div className={`card ${waiting ? "card-attn" : ""}`}>
      <h3>Fix</h3>
      {!g ? <p className="muted">Prepared after the root cause is confirmed.</p> : (<>
        <p className="cause" style={{ fontSize: 15 }}>{g.request.recommended_action || "No automated fix: hand over to an engineer"}</p>
        {!g.request.recommended_action && !d.rca?.cause && <div className="note small">The agents found no fault in the live data. If you expected one, check the fault is switched on in Demo controls.</div>}
        {g.request.expected_outcome && <div className="small"><b>Expected:</b> {g.request.expected_outcome}</div>}
        {g.request.potential_risks?.length > 0 && <div className="small" style={{ marginTop: 4 }}><b>Risk:</b> {g.request.potential_risks[0]}</div>}
        {waiting ? (<>
          <input type="text" placeholder="Comment (saved in ServiceNow)" value={comment} onChange={(e) => setComment(e.target.value)} style={{ marginTop: 12 }} />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn-good" disabled={busy || !me.can_approve} onClick={() => decide("approve")}>{g.request.recommended_action ? "Approve" : "Confirm hand-over"}</button>
            <button className="btn btn-danger" disabled={busy || !me.can_approve} onClick={() => decide("reject")}>Reject</button>
            {!me.can_approve && <span className="small muted">Needs the Keycloak role ops-approver</span>}
          </div>
          <ErrorBox error={err} />
        </>) : (
          <div className="small" style={{ marginTop: 10 }}>
            <Pill tone={g.decision === "approve" ? "good" : "neutral"}>{g.decision === "approve" ? "Approved" : g.decision}</Pill> by {g.by} · {fmtTime(g.decided)}
            {d.verification && <div style={{ marginTop: 6 }}>{d.verification.passed ? "✓ Verified" : "✕ Not verified"}: {d.verification.source}</div>}
          </div>
        )}
      </>)}
    </div>
  );
}
