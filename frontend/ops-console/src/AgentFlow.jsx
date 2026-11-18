import { useEffect, useState } from "react";
import { Confidence } from "./ui.jsx";

const PHASES = [
  { name: "Detect", agents: ["monitoring", "anomaly", "prediction"] },
  { name: "Investigate", agents: ["historical", "evidence", "dependency"] },
  { name: "Decide", agents: ["rca", "critic", "risk"] },
  { name: "Act", agents: ["resolution", "approval", "remediation"] },
  { name: "Close", agents: ["verification", "closure"] },
];
const ICON = { monitoring: "📡", anomaly: "📈", prediction: "🔮", historical: "🗂️", evidence: "🔎", dependency: "🕸️", rca: "🧠",
  critic: "⚖️", risk: "🎯", resolution: "🛠️", approval: "✋", remediation: "⚙️", verification: "✅", closure: "📁" };
const SHORT = { monitoring: "Monitoring", anomaly: "Anomaly", prediction: "Prediction", historical: "History", evidence: "Evidence",
  dependency: "Dependencies", rca: "Root cause", critic: "Critic", risk: "Risk", resolution: "Resolution", approval: "Approval",
  remediation: "Remediation", verification: "Verification", closure: "Closure" };
const ENGINE = { llm: ["AI", "eng-ai"], human: ["Human", "eng-hu"], rules: ["Rules", "eng-sys"], system: ["System", "eng-sys"] };

/** The agents working behind the screen: five phases, a progress line, the live agent pulsing, and what each one found. */
export default function AgentFlow({ inv }) {
  const byKey = Object.fromEntries(inv.agents.map((a) => [a.key, a]));
  const live = inv.agents.find((a) => a.status === "running" || a.status === "waiting");
  const lastDone = [...inv.agents].reverse().find((a) => a.status === "done");
  const [sel, setSel] = useState(null);
  useEffect(() => setSel(null), [inv.id]);
  const shown = byKey[sel] || live || lastDone || inv.agents[0];
  const done = inv.agents.filter((a) => ["done", "skipped"].includes(a.status)).length;
  const pct = Math.round((done / inv.agents.length) * 100);
  const evById = Object.fromEntries((inv.evidence || []).map((e) => [e.id, e]));
  const sources = [...new Set((inv.evidence || []).filter((e) => e.mode !== "record").map((e) => e.source))].slice(0, 6);

  return (
    <div className="card flow">
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <h3>Behind the scenes: 14 AI agents</h3>
        <span className="spacer" />
        <span className="small muted">{done}/{inv.agents.length} done · {inv.evidence?.length || 0} pieces of evidence</span>
      </div>
      <div className="flow-bar"><span style={{ width: `${pct}%` }} /></div>
      <div className="phases">
        {PHASES.map((ph) => {
          const st = ph.agents.map((k) => byKey[k]?.status);
          const phaseState = st.every((s) => s === "done" || s === "skipped") ? "done" : st.some((s) => s === "running" || s === "waiting") ? "live" : st.some((s) => s === "done") ? "live" : "todo";
          return (
            <div key={ph.name} className={`phase ${phaseState}`}>
              <div className="phase-n">{ph.name}</div>
              <div className="phase-agents">
                {ph.agents.map((k) => {
                  const a = byKey[k] || { status: "pending" };
                  const [eng, engCls] = ENGINE[a.engine] || ["", ""];
                  return (
                    <button key={k} className={`ag ${a.status} ${shown.key === k ? "sel" : ""}`} onClick={() => setSel(k)} title={a.name}>
                      <span className="ag-ic">{a.status === "done" ? "✓" : a.status === "skipped" ? "–" : ICON[k]}</span>
                      <span className="ag-n">{SHORT[k]}</span>
                      {a.status !== "pending" && eng && <span className={`ag-e ${engCls}`}>{eng}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className={`ag-detail ${shown.status}`}>
        <div className="row wrap">
          <span className="ag-big">{ICON[shown.key]}</span>
          <div style={{ minWidth: 0 }}>
            <div className="ag-title">{shown.name}</div>
            <div className="small muted">{shown.role}</div>
          </div>
          <span className="spacer" />
          <span className={`ag-state ${shown.status}`}>
            {{ running: "Working…", waiting: "Waiting for a person", done: "Done", skipped: "Skipped", pending: "Not started", failed: "Failed" }[shown.status] || shown.status}
          </span>
        </div>
        {shown.status === "pending" ? <p className="muted small" style={{ margin: "10px 0 0" }}>This agent starts after the ones before it.</p> : (<>
          <p className="ag-say">{shown.analysis || "…"}</p>
          {shown.findings?.length > 0 && <ul className="ag-find">{shown.findings.slice(0, 5).map((f, i) => <li key={i}>{f}</li>)}</ul>}
          <div className="row wrap" style={{ gap: 18, marginTop: 8 }}>
            {shown.confidence != null && <div><div className="small muted">Confidence</div><Confidence value={shown.confidence} /></div>}
            {shown.input_evidence?.length > 0 && (
              <div style={{ minWidth: 0 }}><div className="small muted">Looked at</div>
                <div className="ev-chips">{shown.input_evidence.slice(0, 6).map((id) => (
                  <span key={id} className="ev" title={evById[id]?.title}>{evById[id]?.source || id}</span>
                ))}</div></div>
            )}
            {shown.engine && <div><div className="small muted">Done by</div><b>{{ llm: "AI (Cohere), checked against evidence", rules: "Rules", system: "System", human: "A person" }[shown.engine]}</b></div>}
          </div>
        </>)}
      </div>
      {sources.length > 0 && <div className="small muted" style={{ marginTop: 10 }}>Live sources queried: {sources.join(" · ")}</div>}
    </div>
  );
}
