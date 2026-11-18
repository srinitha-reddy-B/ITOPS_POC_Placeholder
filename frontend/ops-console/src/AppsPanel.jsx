import { useCallback, useEffect, useState } from "react";

const ICON = { signin: "🔐", routeops: "🚚", erp: "🏢", scan: "📄", restore: "🗄️" };
const STATE = { ok: ["Working", "ok"], slow: ["Slow", "slow"], fail: ["Not working", "fail"], na: ["Not set up", "na"] };

/**
 * "My apps": the employee's own apps, checked for real every few seconds through the same path the problem affects.
 * A fault turns a tile red; after the approved fix it turns green again, which is what the employee (and the client) sees.
 */
export default function AppsPanel({ load, note, title = "My apps" }) {
  const [apps, setApps] = useState(null);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState({});
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const next = await load();
      setApps((prev) => {
        if (prev) {
          const flips = {};
          next.forEach((a) => { const p = prev.find((x) => x.key === a.key); if (p && p.state !== a.state) flips[a.key] = Date.now(); });
          if (Object.keys(flips).length) setChanged((c) => ({ ...c, ...flips }));
        }
        return next;
      });
    } catch { /* keep the last result */ } finally { setBusy(false); }
  }, [load]);
  useEffect(() => { refresh(); const t = setInterval(refresh, 8000); return () => clearInterval(t); }, [refresh]);
  return (
    <aside className="apps">
      <div className="apps-h"><b>{title}</b><span className="spacer" />
        <button className="btn btn-sm" onClick={refresh} disabled={busy}>{busy ? "Checking…" : "↻ Check now"}</button></div>
      <div className="small muted">{note || "Each app is tried for real every few seconds."}</div>
      {!apps ? <div className="small muted">Checking your apps…</div> : apps.map((a) => {
        const [label, cls] = STATE[a.state] || ["Unknown", "na"];
        const flash = changed[a.key] && Date.now() - changed[a.key] < 6000;
        return (
          <div key={a.key} className={`app-tile ${cls} ${flash ? "flash" : ""}`}>
            <div className="row"><span className="app-ic">{ICON[a.key]}</span>
              <div style={{ minWidth: 0 }}><div className="app-n">{a.name}</div><div className="small muted">{a.what}</div></div>
              <span className="spacer" /><span className={`app-st ${cls}`}>{label}</span></div>
            <div className="app-d">{a.detail}</div>
          </div>
        );
      })}
    </aside>
  );
}
