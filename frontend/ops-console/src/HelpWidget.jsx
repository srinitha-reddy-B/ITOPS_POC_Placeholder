import { useCallback, useEffect, useState } from "react";
import Chat from "./Chat.jsx";

/**
 * IT Help Desk chat widget on the sign-in page, for people who cannot sign in.
 * A button in the bottom-right corner opens a small chat window. Without signing in it only handles sign-in problems:
 * the person gives their username, the assistant checks the account in Keycloak and raises a ServiceNow ticket.
 */
export default function HelpWidget() {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState(sessionStorage.getItem("cc-help-user") || "");
  const [started, setStarted] = useState(!!sessionStorage.getItem("cc-help-token"));
  const [account, setAccount] = useState(null);

  useEffect(() => {
    const onOpen = (e) => {
      if (e.detail?.username) {
        sessionStorage.setItem("cc-help-user", e.detail.username);
        setUser(e.detail.username);
      }
      setOpen(true);
    };
    addEventListener("cc-open-help", onOpen);
    return () => removeEventListener("cc-open-help", onOpen);
  }, []);

  const load = useCallback(async () => {
    const t = sessionStorage.getItem("cc-help-token");
    if (!t) return { messages: [], progress: {}, suggestions: ["I can't sign in to my account", "It says my account is disabled"] };
    const [conv, apps] = await Promise.all([fetch(`/api/ops/help/chat/${t}`), fetch(`/api/ops/help/apps/${t}`)]);
    if (apps.ok) setAccount((await apps.json())[0]);
    if (!conv.ok) { const e = new Error("conversation expired"); e.status = conv.status; throw e; }
    const c = await conv.json();
    return { ...c, suggestions: ["I can't sign in to my account", "It says my account is disabled"] };
  }, []);

  const send = useCallback(async (text) => {
    const r = await fetch("/api/ops/help/chat", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: sessionStorage.getItem("cc-help-user") || user, text, token: sessionStorage.getItem("cc-help-token") || "" }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
    sessionStorage.setItem("cc-help-token", j.token);
  }, [user]);

  function startOver() {
    sessionStorage.removeItem("cc-help-token");
    setStarted(false);
    setAccount(null);
  }

  return (<>
    {open && (
      <div className="hw" role="dialog" aria-label="IT Help Desk">
        <div className="hw-h">
          <span className="hw-av">💬</span>
          <div style={{ minWidth: 0 }}><b>IT Help Desk</b><div className="hw-sub">Crystal Clean assistant · usually fixes it in minutes</div></div>
          <span className="spacer" />
          <button className="hw-x" onClick={() => setOpen(false)} aria-label="Close">✕</button>
        </div>
        {!started ? (
          <form className="hw-start" onSubmit={(e) => { e.preventDefault(); if (user.trim()) { sessionStorage.setItem("cc-help-user", user.trim().toLowerCase()); setStarted(true); } }}>
            <div className="bubble bot">Hi! Can't sign in? Tell me your username and I'll check your account and raise a ticket.</div>
            <input id="hw-user" type="text" placeholder="Your username, e.g. dana.whitfield" value={user} onChange={(e) => setUser(e.target.value)} autoFocus />
            <button className="btn btn-primary">Continue</button>
          </form>
        ) : (<>
          <div className="hw-acct">
            <span className="mono">{user}</span>
            {account ? <span className={`app-st ${account.state}`}>{account.state === "ok" ? "Account active" : account.state === "fail" ? "Can't sign in" : "Checking"}</span>
              : <span className="hw-sub">account status appears after your first message</span>}
            <span className="spacer" /><button className="linkbtn small" onClick={startOver}>Change user</button>
          </div>
          <div className="hw-body">
            <Chat load={load} send={send} placeholder="Describe the problem…"
              greeting={`Hi ${user.split(".")[0].replace(/^./, (c) => c.toUpperCase())}, what happens when you try to sign in?`} />
          </div>
        </>)}
      </div>
    )}
    <button className="hw-btn" onClick={() => setOpen(!open)} aria-label={open ? "Close IT Help Desk" : "IT Help Desk: need help signing in?"}
      title={open ? "Close" : "Need help signing in?"}>
      {open ? "✕" : "💬"}
    </button>
  </>);
}
