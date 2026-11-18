import { useCallback } from "react";
import { api, usePoll } from "./api.js";
import AppsPanel from "./AppsPanel.jsx";
import Chat from "./Chat.jsx";
import Shell, { go, useRoute } from "./Portal.jsx";
import { SAMPLE_APPS, SAMPLE_REQUESTS } from "./samples.js";
import { ErrorBox, Pill } from "./ui.jsx";

const NAV = [["home", "Home"], ["help", "Assistant", "help"]];

/** Employees (Marcus Reed, Dana Whitfield and other staff): Home and Assistant (the IT help bot that raises ServiceNow tickets). */
export default function EmployeePortal({ me, personas }) {
  const { page } = useRoute("home");
  const cur = NAV.some(([k]) => k === page) ? page : "home";
  const loadChat = useCallback(() => api("/chat"), []);
  const sendChat = useCallback((text) => api("/chat", { method: "POST", body: { text } }), []);
  const loadApps = useCallback(() => api("/apps"), []);
  return (
    <Shell me={me} personas={personas} product="Employee Portal" group="Employee" nav={NAV} page={cur}>
      {cur === "help" ? (<>
        <div className="pt-head"><div><h1>Assistant</h1><p className="pt-sub">Tell the IT assistant what's wrong. It raises a ServiceNow ticket and gets it fixed with IT.</p></div></div>
        <div className="help-grid" style={{ maxWidth: "none" }}>
          <Chat load={loadChat} send={sendChat} greeting={`Hi ${me.name.split(" ")[0]}, I'm the Crystal Clean IT assistant. Tell me what's wrong and I'll raise a ticket and start fixing it.`} />
          <AppsPanel load={loadApps} />
        </div>
      </>) : <Home me={me} />}
    </Shell>
  );
}

function Home({ me }) {
  const { data, error } = usePoll("/chat", 4000);
  const { data: esc } = usePoll("/escalation", 5000);
  const live = Object.values(data?.progress || {});
  const reqs = [...live.map((r) => ({ ...r, id: r.investigation })), ...SAMPLE_REQUESTS];
  const mailDown = esc && esc.stage > 0 && !esc.fixed;
  return (<>
    <div className="pt-head"><div><h1>Good Morning, {me.name.split(" ")[0]}</h1><p className="pt-sub">{me.persona?.title}{me.persona?.facility ? ` · ${me.persona.facility}` : ""}</p></div></div>
    <div className="cards4" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
      <button className="kcard click" onClick={() => go("help")}><small>Open requests <span>›</span></small><b>{reqs.filter((r) => r.status !== "resolved").length}</b><span>Being handled by IT</span></button>
      <div className="kcard"><small>Resolved this week</small><b>{reqs.filter((r) => r.status === "resolved").length}</b><span>Fixed and checked</span></div>
      <div className={`kcard ${mailDown ? "attn" : ""}`}><small>Service notices</small><b>{mailDown ? 2 : 1}</b><span>{mailDown ? "Email is slow right now: IT is on it" : "RouteOps maintenance Saturday 22:00–23:00"}</span></div>
    </div>
    <div className="g2">
      <section className="box"><div className="sec-h"><h2>My requests</h2><button className="btn btn-primary" onClick={() => go("help")}>Open the Assistant</button></div>
        <ErrorBox error={error} />
        {reqs.map((r) => (
          <div key={r.id} className="row-btn">
            <span><b>{r.title}{r.sample && <span className="sample-tag">Sample</span>}</b><small>{r.text}</small></span>
            <span className="r">{r.ticket?.url ? <a className="mono" href={r.ticket.url} target="_blank" rel="noreferrer">{r.ticket.number} ↗</a> : <span className="mono small">{r.number || r.ticket?.number}</span>}
              <Pill tone={r.status === "resolved" ? "good" : "info"} icon={false}>{r.status === "resolved" ? "Resolved" : (r.steps || ["Received", "Investigating", "Fix ready", "Fixing", "Resolved"])[r.step]}</Pill></span>
          </div>))}
      </section>
      <section className="box"><h2 className="pt-h2">My apps</h2>
        {SAMPLE_APPS.map(([n, d, st, label]) => {
          const s = st || (mailDown ? "slow" : "ok"), l = label || (mailDown ? "Slow: IT is fixing it" : "Working");
          return <div key={n} className="row-btn"><span><b>{n}</b><small>{d}</small></span><Pill tone={s === "ok" ? "good" : "warning"} icon={false}>{l}</Pill></div>;
        })}
        <p className="foot-note">Live app checks run on the Assistant page.</p>
      </section>
    </div>
  </>);
}
