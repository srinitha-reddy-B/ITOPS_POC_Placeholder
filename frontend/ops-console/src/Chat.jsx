import { useEffect, useRef, useState } from "react";

/**
 * The employee help bot. `load()` returns {messages, progress, suggestions}; `send(text)` posts a message.
 * Each request the bot opens shows its ServiceNow incident and a five-step progress bar.
 */
export default function Chat({ load, send, greeting, placeholder = "Describe the problem…" }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const end = useRef(null);
  const count = useRef(0);

  async function refresh() {
    try { setData(await load()); } catch (e) { if (e.status !== 404) setErr(e); }
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 2500); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    const n = data?.messages?.length || 0;
    if (n !== count.current) { count.current = n; end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }
  }, [data]);

  async function submit(t) {
    const msg = (t ?? text).trim();
    if (!msg || busy) return;
    setBusy(true); setErr(null); setText("");
    try { await send(msg); await refresh(); } catch (e) { setErr(e); setText(msg); } finally { setBusy(false); }
  }

  const msgs = data?.messages || [];
  const seen = new Set();
  return (
    <div className="chat">
      <div className="chat-scroll">
        <div className="bubble bot">{greeting}</div>
        {msgs.map((m) => {
          const showCard = m.inv && !seen.has(m.inv) && data.progress[m.inv];
          if (showCard) seen.add(m.inv);
          return (
            <div key={m.id} className={`row-msg ${m.role}`}>
              <div className={`bubble ${m.role === "employee" ? "me" : "bot"}`}>{m.text}
                {m.ticket?.number && !m.inv && <div className="small" style={{ marginTop: 6 }}>
                  <a href={m.ticket.url} target="_blank" rel="noreferrer">{m.ticket.number} in ServiceNow ↗</a></div>}
              </div>
              {showCard && <TicketCard p={data.progress[m.inv]} />}
            </div>
          );
        })}
        {busy && <div className="bubble bot typing"><span /><span /><span /></div>}
        {!msgs.length && data?.suggestions && (
          <div className="chips">{data.suggestions.map((s) => <button key={s} onClick={() => submit(s)}>{s}</button>)}</div>
        )}
        <div ref={end} />
      </div>
      {err && <div className="errbox" style={{ margin: "0 0 8px" }}>{err.message}</div>}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input type="text" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} disabled={busy} autoFocus />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  );
}

function TicketCard({ p }) {
  const done = p.status === "resolved";
  const stopped = ["escalated", "closed", "failed", "cancelled", "interrupted"].includes(p.status);
  return (
    <div className={`ticket ${done ? "ok" : stopped ? "stop" : ""}`}>
      <div className="row">
        {p.ticket?.number
          ? <a className="inc" href={p.ticket.url} target="_blank" rel="noreferrer">{p.ticket.number} ↗</a>
          : <span className="inc muted">Raising incident…</span>}
        <span className="muted small">ServiceNow{p.ticket?.state ? ` · ${p.ticket.state}` : ""}</span>
      </div>
      <div className="track">
        {p.steps.map((s, i) => (
          <div key={s} className={`tstep ${i < p.step || done ? "done" : i === p.step && !stopped ? "now" : ""}`}>
            <i>{i < p.step || done ? "✓" : i + 1}</i><span>{s}</span>
          </div>
        ))}
      </div>
      <div className="ttext">{p.text}</div>
      {p.cause && <div className="small muted">Cause: {p.cause}</div>}
    </div>
  );
}
