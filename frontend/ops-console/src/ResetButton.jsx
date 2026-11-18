import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";

/** ↻ in the top bar: puts every demo system back to its starting state and starts a clean desk and chat. */
export default function ResetButton({ onDone }) {
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState(null);
  const [err, setErr] = useState(null);
  const timer = useRef(null);
  const running = job?.status === "running";

  useEffect(() => () => clearInterval(timer.current), []);
  function watch() {
    clearInterval(timer.current);
    timer.current = setInterval(async () => {
      try {
        const j = await api("/demo/reset");
        setJob(j);
        if (j.status !== "running") { clearInterval(timer.current); onDone?.(); }
      } catch (e) { setErr(e); clearInterval(timer.current); }
    }, 1500);
  }
  async function start() {
    setErr(null);
    try { setJob(await api("/demo/reset", { method: "POST" })); watch(); } catch (e) { setErr(e); }
  }
  return (
    <div style={{ position: "relative" }}>
      <button className="btn btn-sm reset-btn" title={running ? "Resetting…" : "Reset"} aria-label="Reset" onClick={() => setOpen(!open)}>
        <span className={running ? "spin-ic" : ""}>↻</span>
      </button>
      {open && (
        <div className="card pop" style={{ width: 340 }}>
          {!job || job.status === "idle" ? (<>
            <h3>Reset the demo?</h3>
            <ul className="findings small" style={{ marginTop: 8 }}>
              <li>Every system goes back to its starting state (Dana disabled, network and RouteOps healthy, fresh backup, disk at 69%)</li>
              <li>Open investigations are cancelled</li>
              <li>The desk and chat start empty. Earlier tickets stay in the database and in ServiceNow.</li>
            </ul>
            {err && <div className="errbox">{err.message}</div>}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={start}>↻ Reset now</button>
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </>) : (<>
            <h3>{running ? "Resetting…" : "Demo reset"}</h3>
            <ul className="checks" style={{ marginTop: 10 }}>
              {(job.steps || []).map((s, i) => (
                <li key={i} className={s.ok === false ? "no" : s.ok ? "ok" : ""}>{s.label}{s.note && <span className="muted"> ({s.note})</span>}</li>
              ))}
              {running && <li className="muted">working…</li>}
            </ul>
            {!running && <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} onClick={() => { setOpen(false); setJob(null); }}>Done</button>}
          </>)}
        </div>
      )}
    </div>
  );
}
