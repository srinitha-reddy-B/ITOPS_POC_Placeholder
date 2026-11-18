import { useEffect, useState } from "react";
import { api, demoPersona, setDemoPersona } from "./api.js";
import { config, getSession, onSession, resumeRedirect, signOut } from "./auth.js";
import Login from "./Login.jsx";
import ManagerPortal from "./ManagerPortal.jsx";
import PoweredBy from "./PoweredBy.jsx";

/**
 * Two ways in, chosen by the backend (CC_DEMO_PERSONAS):
 *   - demo persona switch (on for now): a "Viewing as" dropdown with three personas, no sign-in page;
 *   - Keycloak SSO (Login.jsx, auth.js) when the switch is off.
 * Either way the backend decides the roles, and the portal follows them:
 *   ops-engineer or ops-approver -> IT Admin Portal (Mark Wood) · ops-manager -> Manager portal (John Taylor) · else Employee Portal
 */
export default function App() {
  const [cfg, setCfg] = useState(null);
  const [session, setSession] = useState(getSession());
  const [persona, setPersona] = useState(demoPersona());
  const [me, setMe] = useState(null);
  const [meErr, setMeErr] = useState(null);
  const signedOut = new URLSearchParams(location.search).has("signedout");

  useEffect(() => { config().then(setCfg).catch(setMeErr); }, []);
  useEffect(() => onSession(setSession), []);
  useEffect(() => { resumeRedirect().catch(() => {}); }, []);
  const demo = cfg?.demo_personas || null;
  // The IT Administrator's portal is the Service Hub: Home, Operational Insights, Incidents and Reports.
  const active = demo && !session ? "john.taylor" : null;
  useEffect(() => {
    if (!cfg) return;
    if (active) setDemoPersona(active);
    if (!session && !active) { setMe(null); return; }
    setMe(null);
    api("/me").then((m) => { setMe(m); setMeErr(null); }).catch(setMeErr);
  }, [cfg, session?.access_token, active]);

  // The dropdown lists the personas of the Control Tower. Choosing another one leaves for that persona's home.
  const OURS = [
    { username: "maya.thompson", name: "Maya Thompson", title: "Employee", p32: "employee", to: "/p32#/" },
    { username: "arya.hajarha", name: "Arya Hajarha", title: "IT Engineer", p32: "engineer", to: "/p32#/workbench" },
    { username: "john.taylor", name: "Jordan Patel", title: "IT Administrator" },
  ];
  const switchTo = (u) => {
    const t = OURS.find((x) => x.username === u);
    if (!t || !t.p32) return;
    try { localStorage.setItem("p32-persona-v1", JSON.stringify({ id: t.p32, empDept: null })); } catch { /* private mode */ }
    document.body.style.transition = "opacity .3s"; document.body.style.opacity = "0";
    setTimeout(() => location.assign(t.to), 300);
  };
  const leave = () => {
    try { localStorage.removeItem("cc-session"); } catch { /* private mode */ }
    document.body.style.transition = "opacity .3s"; document.body.style.opacity = "0";
    setTimeout(() => location.replace("/portal"), 300);
  };
  const personas = active ? { list: OURS, current: active, onSwitch: switchTo, onSignOut: leave } : null;

  if (!cfg && !meErr) return <div className="center-msg muted">Loading…</div>;
  if (!session && !active) return <><Login notice={signedOut ? "You have been signed out." : null} /><PoweredBy /></>;
  if (meErr) return (
    <div className="center-msg"><h2>Signed in, but no access</h2><div className="errbox">{meErr.message}</div>
      {session && <button className="btn btn-primary" onClick={signOut}>Sign out</button>}</div>
  );
  if (!me) return <div className="center-msg muted">Loading your portal…</div>;
  return <ManagerPortal me={me} personas={personas} />;
}
