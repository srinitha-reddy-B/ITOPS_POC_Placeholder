import { useState } from "react";
import { api, usePoll } from "./api.js";
import { Pill, USECASES } from "./ui.jsx";

/** Presenter controls: create a real fault on an integration, and see which integrations are connected. */
export default function DemoDrawer({ onClose }) {
  const { data: scn, reload } = usePoll("/scenarios", 3000);
  const { data: ints } = usePoll("/integrations", 10000);
  const [err, setErr] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState("");
  async function resetAll() {
    setResetting(true); setErr(null); setResetMsg("Resetting all five systems…");
    try {
      await api("/demo/reset", { method: "POST" });
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const j = await api("/demo/reset");
        if (j.status !== "running") {
          const bad = (j.steps || []).filter((x) => x.ok === false);
          setResetMsg(bad.length ? `Done, with problems: ${bad.map((x) => x.label).join(", ")}` : "Done: every system is back to its starting state.");
          break;
        }
      }
      reload();
      location.hash = "#/desk";
    } catch (e) { setErr(e); setResetMsg(""); } finally { setResetting(false); }
  }
  async function run(k, a) {
    setErr(null);
    try { await api(`/scenarios/${k}/${a}`, { method: "POST" }); reload(); } catch (e) { setErr(e); }
  }
  return (
    <div className="drawer-bg" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="row"><h2>Demo controls</h2><span className="spacer" /><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        <div className="drow reset-all">
          <div className="row"><b>↻ Reset everything</b><span className="spacer" />
            <button className="btn btn-sm btn-primary" disabled={resetting} onClick={resetAll}>{resetting ? "Resetting…" : "Reset demo"}</button></div>
          <div className="small muted" style={{ marginTop: 4 }}>{resetMsg || "All five systems back to their starting state, open tickets cancelled, empty desk and chat."}</div>
        </div>
        <p className="small muted">Each button creates a real fault. Then ask the bot as an employee, or wait for monitoring to raise the ticket.</p>
        {err && <div className="errbox">{err.message}</div>}
        {(scn || []).sort((a, b) => a.order - b.order).map((s) => (
          <div key={s.key} className="drow">
            <div className="row"><b>{USECASES[s.key]?.icon} {s.title}</b><span className="spacer" />
              {s.busy ? <Pill tone="info">working…</Pill> : s.job?.status === "failed" ? <Pill tone="critical" title={s.job.error}>failed</Pill> : null}</div>
            <div className="row wrap" style={{ marginTop: 6 }}>
              {s.actions.map((a) => <button key={a.id} className={`btn btn-sm ${a.id === "reset" ? "" : "btn-primary"}`} disabled={s.busy} onClick={() => run(s.key, a.id)}>{a.id === "reset" ? `↻ ${a.label}` : a.label}</button>)}
            </div>
            {s.job?.status === "failed" && <div className="small" style={{ color: "var(--critical-ink)", marginTop: 4 }}>{s.job.error}</div>}
          </div>
        ))}
        <h3 style={{ marginTop: 18 }}>Integrations</h3>
        <div className="ints">{(ints || []).map((i) => (
          <span key={i.key} title={i.detail}><i className={i.ok ? "up" : "down"} />{i.name}</span>
        ))}</div>
      </div>
    </div>
  );
}
