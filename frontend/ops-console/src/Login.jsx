import { useEffect, useState } from "react";
import { config, signIn } from "./auth.js";
import HelpWidget from "./HelpWidget.jsx";

/**
 * The employee portal's sign-in page. The person types their work email or username and continues to Crystal Clean
 * single sign-on (Keycloak), which asks for the password and decides. If Keycloak refused the last attempt, the page
 * says so on return (read from Keycloak's event log) and offers the IT Help Desk.
 */
export default function Login({ notice }) {
  const [user, setUser] = useState(() => { try { return localStorage.getItem("cc-last-user") || ""; } catch { return ""; } });
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [refused, setRefused] = useState(null);
  const [down, setDown] = useState(false);

  useEffect(() => { config().catch(setErr); }, []);

  // Back from the sign-in page: did Keycloak refuse the last attempt?
  useEffect(() => {
    const ticket = sessionStorage.getItem("cc-attempt");
    if (!ticket) return;
    let tries = 0;
    const t = setInterval(async () => {
      tries += 1;
      try {
        const r = await fetch(`/api/ops/auth/attempt/${ticket}`);
        if (r.ok) {
          const s = await r.json();
          if (s.state === "denied") { setRefused(s); clearInterval(t); }
          if (s.state !== "pending") { sessionStorage.removeItem("cc-attempt"); clearInterval(t); }
        } else { sessionStorage.removeItem("cc-attempt"); clearInterval(t); }
      } catch { /* try again */ }
      if (tries > 4) clearInterval(t);
    }, 1200);
    return () => clearInterval(t);
  }, []);

  // Arrived from the sign-in page's "Contact the IT Help Desk" link
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.has("help")) {
      const u = q.get("user") || "";
      history.replaceState(null, "", location.pathname);
      setTimeout(() => dispatchEvent(new CustomEvent("cc-open-help", { detail: { username: u.split("@")[0] } })), 50);
    }
  }, []);

  async function submit(e) {
    e.preventDefault();
    const u = user.trim();
    if (!u) return;
    setBusy(true); setErr(null); setRefused(null); setDown(false);
    try {
      const st = await (await fetch("/api/ops/auth/sso-status")).json();
      if (!st.up) { setDown(true); setBusy(false); return; }
    } catch { /* if the check itself fails, try signing in anyway */ }
    try { remember ? localStorage.setItem("cc-last-user", u) : localStorage.removeItem("cc-last-user"); } catch { /* private mode */ }
    try {
      const r = await fetch("/api/ops/auth/attempt", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u.split("@")[0].toLowerCase() }) });
      if (r.ok) sessionStorage.setItem("cc-attempt", (await r.json()).ticket);
    } catch { /* the sign-in itself does not depend on this */ }
    try { await signIn(u); } catch (e2) { setErr(e2); setBusy(false); }
  }

  const help = (u) => dispatchEvent(new CustomEvent("cc-open-help", { detail: { username: (u || user).split("@")[0].toLowerCase() } }));

  return (
    <div className="portal">
      <header className="p-top">
        <img src="/crystal-clean/logo.webp" alt="Crystal Clean" />
        <span className="p-div" />
        <span className="p-name">Employee Portal</span>
        <span className="spacer" />
        <button className="p-link" onClick={() => help()}>IT Help Desk</button>
      </header>

      <main className="p-main">
        <section className="p-brand">
          <div className="p-brand-in">
            <div className="p-eyebrow">Crystal Clean Employee Portal</div>
            <h1>Everything you need for the day, in one place.</h1>
            <p>Routes, manifests, branch systems and IT support for every Crystal Clean location.</p>
            <ul className="p-points">
              <li><b>IT support that fixes things</b><span>Tell the assistant what's wrong. It raises a ticket and gets it fixed with IT.</span></li>
              <li><b>One sign-in</b><span>Your work account opens every Crystal Clean application.</span></li>
            </ul>
          </div>
        </section>

        <section className="p-card-wrap">
          <form className="p-card" onSubmit={submit}>
            <h2>Sign in</h2>
            <p className="p-sub">Use your Crystal Clean work account</p>

            {notice && <div className="p-note">{notice}</div>}
            {refused && (
              <div className="p-alert" role="alert">
                <b>We couldn't sign you in</b>
                <div>{refused.error === "user_disabled" ? "Your account has been disabled. The IT Help Desk can look into it for you."
                  : refused.error === "user_temporarily_disabled" ? "Your account is locked after too many attempts. The IT Help Desk can unlock it."
                  : refused.reason || "Your sign-in was refused."}</div>
                <button type="button" className="p-alert-btn" onClick={() => help(refused.username)}>Get help from the IT Help Desk</button>
              </div>
            )}
            {down && (
              <div className="p-alert" role="alert">
                <b>Single sign-on isn't responding</b>
                <div>Crystal Clean single sign-on is not answering right now, so nobody can sign in. This isn't your password or your account.</div>
                <button type="button" className="p-alert-btn" onClick={() => help()}>Report it to the IT Help Desk</button>
              </div>
            )}
            {err && <div className="p-alert" role="alert">{String(err.message || err)}</div>}

            <label htmlFor="p-user">Work email or username</label>
            <input id="p-user" type="text" autoComplete="username" autoFocus value={user} onChange={(e) => setUser(e.target.value)}
              placeholder="name@crystal-clean.com" />
            <label className="p-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember me</label>
            <button className="p-btn" disabled={busy || !user.trim()}>{busy ? "Redirecting…" : "Continue"}</button>
            <div className="p-or"><button type="button" className="p-link small" onClick={() => help()}>Trouble signing in? Contact the IT Help Desk</button></div>
            <div className="p-secure">🔒 You'll enter your password on Crystal Clean single sign-on.</div>
          </form>
        </section>
      </main>

      <footer className="p-foot">
        <span>© 2026 Crystal Clean</span>
        <a href="#" onClick={(e) => e.preventDefault()}>Privacy</a>
        <a href="#" onClick={(e) => e.preventDefault()}>Terms of use</a>
        <button className="p-link" onClick={() => help()}>IT Help Desk</button>
      </footer>
      <HelpWidget />
    </div>
  );
}
