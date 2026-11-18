import { useEffect, useState } from "react";
import { decode, getSession, signOut } from "./auth.js";
import { fmtTime } from "./ui.jsx";

const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><path d="M12 17h.01"/>',
  insights: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  predictive: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  incidents: '<path d="M12 3l9 16H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  reports: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7M9 8h3"/>',
  command: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  queue: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  workbench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  depmap: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M6.5 7.5l4.5 9M17.5 7.5l-4.5 9M7 6h10"/>',
  observability: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  recs: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
};
const Icon = ({ k }) => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: ICONS[k] || ICONS.home }} />;

/** Current page from the URL hash (#/page/arg), so Back and reload keep the page. */
export function useRoute(fallback) {
  const read = () => { const [v, a] = location.hash.replace(/^#\/?/, "").split("/"); return { page: v || fallback, arg: a ? decodeURIComponent(a) : null }; };
  const [r, setR] = useState(read);
  useEffect(() => { const f = () => setR(read()); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  return r;
}
export const go = (page, arg) => { location.hash = `#/${page}${arg ? `/${encodeURIComponent(arg)}` : ""}`; scrollTo(0, 0); };

/** The portal frame every persona shares: header with the logo over the sidebar, the persona's own pages, Powered by Tachyon. */
export default function Shell({ me, product, group, nav, page, badges = {}, extra, children, personas }) {
  return (
    <div className="pt-app">
      <header className="pt-top">
        <div className="pt-brand"><img src="/crystal-clean/logo.webp" alt="Crystal Clean" /><span>{product}</span></div>
        <span className="spacer" />
        {extra}
        {personas ? <PersonaSwitch me={me} p={personas} /> : <UserChip me={me} />}
      </header>
      <div className="pt-body">
        <aside className="pt-side">
          <nav className="pt-nav">
            <div className="pt-grp">{group}</div>
            {nav.map(([k, label, icon]) => (
              <button key={k} className={`pt-link ${page === k ? "on" : ""}`} onClick={() => go(k)} aria-current={page === k ? "page" : undefined}>
                <Icon k={icon || k} />{label}{badges[k] ? <span className="badge">{badges[k]}</span> : null}
              </button>
            ))}
          </nav>
          <div className="pt-foot"><span>Powered by</span><img src="/tachyon-logo.jpg" alt="Tachyon" /></div>
        </aside>
        <main className="pt-main">{children}</main>
      </div>
    </div>
  );
}

const ROLE_LABEL = { "marcus.reed": "Employee", "john.taylor": "IT Administrator", "mark.wood": "IT Admin", "maya.thompson": "Employee", "arya.hajarha": "IT Engineer" };
/** Demo persona switch ("Viewing as"): Employee, Manager, IT Admin. No sign-in while it is on. */
function PersonaSwitch({ me, p }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const f = (e) => { if (!e.target.closest(".pt-user")) setOpen(false); };
    addEventListener("click", f); return () => removeEventListener("click", f);
  }, [open]);
  return (
    <div className="pt-user" style={{ position: "relative" }}>
      <button className="who" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true">
        <span style={{ textAlign: "left" }}><div className="rl">Viewing as · {ROLE_LABEL[me.username] || "Persona"}</div><div className="nm">{me.name}</div></span>
        <span className="avatar">{me.name.split(" ").map((x) => x[0]).join("").slice(0, 2)}</span><span className="muted" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="card pop persona-menu" role="menu" style={{ zIndex: 30 }}>
          {p.list.map((x) => (
            <button key={x.username} role="menuitem" className={x.username === p.current ? "on" : ""} onClick={() => { setOpen(false); p.onSwitch(x.username); }}>
              <b>{ROLE_LABEL[x.username]}</b><span>{x.name} · {x.title}</span>
            </button>))}
          {p.onSignOut && <button role="menuitem" onClick={() => { setOpen(false); p.onSignOut(); }}><b>Sign out</b><span>Back to the Crystal Clean landing page</span></button>}
        </div>
      )}
    </div>
  );
}

function UserChip({ me }) {
  const [open, setOpen] = useState(false);
  const c = decode(getSession()?.access_token || "");
  useEffect(() => {
    if (!open) return;
    const f = (e) => { if (!e.target.closest(".pt-user")) setOpen(false); };
    addEventListener("click", f); return () => removeEventListener("click", f);
  }, [open]);
  return (
    <div className="pt-user" style={{ position: "relative" }}>
      <button className="who" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span style={{ textAlign: "left" }}><div className="nm">{me.name}</div><div className="rl">{me.persona?.title || me.roles.join(", ")}</div></span>
        <span className="avatar">{me.name.split(" ").map((x) => x[0]).join("").slice(0, 2)}</span>
      </button>
      {open && (
        <div className="card pop" style={{ zIndex: 30 }}>
          <div className="small muted">Signed in with Crystal Clean SSO (Keycloak)</div>
          <dl className="kv" style={{ marginTop: 8, gridTemplateColumns: "96px 1fr" }}>
            <dt>User</dt><dd className="mono">{me.username}</dd>
            {me.persona?.facility && <><dt>Location</dt><dd>{me.persona.facility}</dd></>}
            <dt>Roles</dt><dd>{me.roles.join(", ")}</dd>
            <dt>Signed in</dt><dd>{fmtTime(c.auth_time)}</dd>
          </dl>
          <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} onClick={signOut}>Sign out / switch user</button>
        </div>
      )}
    </div>
  );
}

/** Side panel for details; closes on the backdrop, the X or Escape. */
export function Drawer({ onClose, children }) {
  useEffect(() => { const f = (e) => e.key === "Escape" && onClose(); addEventListener("keydown", f); return () => removeEventListener("keydown", f); }, [onClose]);
  return <><div className="pt-backdrop" onClick={onClose} /><aside className="pt-drawer" role="dialog" aria-modal="true"><button className="pt-x" onClick={onClose} aria-label="Close">✕</button>{children}</aside></>;
}
export function Modal({ onClose, wide, children }) {
  useEffect(() => { const f = (e) => e.key === "Escape" && onClose(); addEventListener("keydown", f); return () => removeEventListener("keydown", f); }, [onClose]);
  return <><div className="pt-backdrop" onClick={onClose} /><div className={`pt-modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true"><button className="pt-x" onClick={onClose} aria-label="Close">✕</button>{children}</div></>;
}
export const DemoTag = ({ children = "Controlled Demo Mode · Simulated Data" }) => <span className="demo-tag">● {children}</span>;
