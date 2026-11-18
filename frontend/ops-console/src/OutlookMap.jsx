import { useState } from "react";
import { Drawer } from "./Portal.jsx";
import { ANOM, FC_AT, HEALTH, LAYERS, MAP, down, health, up } from "./outlook.js";

const W = 1000, BAND = 112, GAP = 14, NW = 214, NH = 62;
const lines = (s) => { if (s.length <= 22) return [s]; const cut = s.lastIndexOf(" ", 22); return [s.slice(0, cut), s.slice(cut + 1)]; };

/**
 * Simulated service dependency model for the Outlook / Exchange incident (not verified production dependencies).
 * mode "health": filters and the current health. mode "forecast": the predicted spread with expected times.
 */
export default function OutlookMap({ esc, rcaDone, mode = "health" }) {
  const [sel, setSel] = useState(null);
  const [flt, setFlt] = useState("all");
  const [drawer, setDrawer] = useState(null);
  const stage = esc?.stage ?? 0, fixed = !!esc?.fixed, stages = esc?.stages || [];
  const fc = mode === "forecast", filter = fc ? "all" : flt;
  const pos = {};
  [1, 2, 3, 4].forEach((L) => { const ids = Object.keys(MAP).filter((k) => MAP[k].layer === L); ids.forEach((k, j) => (pos[k] = { x: 24 + ((W - 48) * (j + 0.5)) / ids.length - NW / 2, y: (L - 1) * (BAND + GAP) + 36 })); });
  const hs = Object.fromEntries(Object.keys(MAP).map((k) => [k, health(k, stage, fixed)]));
  const keep = (k) => filter === "all" || (filter === "affected" ? hs[k] !== "healthy" : filter === "critical" ? hs[k] === "critical" : hs[k] === "healthy");
  const U = sel ? up(sel) : new Set(), D = sel ? down(sel) : new Set();
  const path = !sel && hs.exo !== "healthy" ? new Set(["exo", ...down("exo")]) : new Set();
  const edges = Object.entries(MAP).flatMap(([k, n]) => n.deps.map((d) => ({ from: d, to: k })));
  const counts = { all: 11, affected: Object.values(hs).filter((h) => h !== "healthy").length, critical: Object.values(hs).filter((h) => h === "critical").length, healthy: Object.values(hs).filter((h) => h === "healthy").length };
  const label = (k) => {
    const at = FC_AT[k];
    if (fc && at && hs[k] === "risk") return `Predicted ~${stages[at]?.time || ""}`;
    if (fc && at && fixed && stage < at) return "Averted (fixed)";
    if (fc && k === "exo" && hs[k] !== "healthy") return "Origin: Microsoft outage";
    return HEALTH[hs[k]][0];
  };
  const open = (k) => { setSel(k); setDrawer(k); };

  return (
    <section className="box">
      <div className="sec-h">
        {fc ? <h2>Dependency map · predicted spread</h2> : (
          <div className="fgrp" style={{ margin: 0 }}><span>Show</span>
            {[["all", "All"], ["affected", "Affected"], ["critical", "Critical"], ["healthy", "Healthy"]].map(([v, l]) => (
              <button key={v} className={`fchip ${flt === v ? "on" : ""}`} onClick={() => setFlt(v)}>{l} ({counts[v]})</button>))}
          </div>
        )}
        <div className="row">{sel && <button className="btn" onClick={() => setSel(null)}>Clear selection</button>}<span className="demo-tag">Simulated POC dependency model</span></div>
      </div>
      <div className="mapwrap">
        <svg viewBox={`0 0 ${W} ${4 * BAND + 3 * GAP}`} role="img" aria-label="Service dependency map">
          <defs><marker id="oxa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#9aa6b2" /></marker></defs>
          {[1, 2, 3, 4].map((L) => (
            <g key={L}><rect x="8" y={(L - 1) * (BAND + GAP)} width={W - 16} height={BAND} rx="14" fill="var(--bg)" stroke="var(--line)" />
              <text x="24" y={(L - 1) * (BAND + GAP) + 22} fontSize="11" fontWeight="700" fill="var(--muted)" letterSpacing=".06em">{LAYERS[L].toUpperCase()}</text></g>
          ))}
          {edges.map(({ from, to }) => {
            const a = pos[from], b = pos[to], x1 = a.x + NW / 2, y1 = a.y + NH, x2 = b.x + NW / 2, y2 = b.y, my = (y1 + y2) / 2;
            let c = "#c9d2dc", w = 1.5, op = keep(from) && keep(to) ? 1 : 0.15, dash = null;
            if (sel) {
              if ((U.has(from) || from === sel) && (to === sel || U.has(to))) { c = "#0a5c9e"; w = 2.5; }
              else if ((from === sel || D.has(from)) && D.has(to)) { c = "#e0620d"; w = 2.5; }
              else op = Math.min(op, 0.25);
            } else if (path.has(from) && path.has(to)) { c = hs[to] === "risk" ? "#6e4ff6" : "#c0352b"; w = 2.2; if (hs[to] === "risk") dash = "7 5"; }
            return <path key={`${from}-${to}`} d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2 - 4}`} fill="none" stroke={c} strokeWidth={w} opacity={op} strokeDasharray={dash || undefined} markerEnd="url(#oxa)" />;
          })}
          {Object.keys(MAP).map((k) => {
            const n = MAP[k], p = pos[k], [, col, bg] = HEALTH[hs[k]], ls = lines(n.label), hl = label(k);
            const dim = !keep(k) || (sel && k !== sel && !U.has(k) && !D.has(k));
            const root = k === "exo" && rcaDone && !fixed;
            return (
              <g key={k} role="button" tabIndex={0} opacity={dim ? 0.25 : 1} onClick={() => open(k)} onKeyDown={(e) => e.key === "Enter" && open(k)}>
                <title>{n.label}: {hl}</title>
                <rect x={p.x} y={p.y} width={NW} height={NH} rx="12" fill={bg} stroke={k === sel ? "#0b2c4d" : col} strokeWidth={k === sel ? 3 : 1.8} strokeDasharray={hs[k] === "risk" ? "6 4" : undefined} />
                <circle cx={p.x + 16} cy={p.y + 19} r="5" fill={col} />
                {ls.map((l, j) => <text key={j} x={p.x + 28} y={p.y + (ls.length > 1 ? 20 + j * 15 : 24)} fontSize="13" fontWeight="700" fill="#17212b">{l}</text>)}
                <text x={p.x + 28} y={p.y + (ls.length > 1 ? 52 : 44)} fontSize="11.5" fill={col}>{hl}</text>
                {root && <g><rect x={p.x + NW - 86} y={p.y - 10} width="80" height="20" rx="10" fill="#c0352b" /><text x={p.x + NW - 46} y={p.y + 4} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#fff">ROOT CAUSE</text></g>}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="map-legend">
        {Object.values(HEALTH).map(([l, c]) => <span key={l}><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: c, marginRight: 5 }} />{l}</span>)}
        {sel ? <><span><b style={{ color: "#0a5c9e" }}>━</b> Upstream of {MAP[sel].label}</span><span><b style={{ color: "#e0620d" }}>━</b> Downstream</span></>
          : <><span><b style={{ color: "#c0352b" }}>━</b> Affected now</span><span><b style={{ color: "#6e4ff6" }}>┅</b> Predicted spread</span><span className="muted">Click a service to trace it</span></>}
      </div>
      <p className="res-src">Simulated POC dependency model for this demo. These are not verified Crystal Clean production dependencies.</p>
      {drawer && <NodeDrawer k={drawer} hs={hs} fixed={fixed} rcaDone={rcaDone} stages={stages} onClose={() => setDrawer(null)} onNode={open} />}
    </section>
  );
}

function NodeDrawer({ k, hs, fixed, rcaDone, stages, onClose, onNode }) {
  const n = MAP[k], [hl, col, bg] = HEALTH[hs[k]];
  const downs = Object.keys(MAP).filter((x) => MAP[x].deps.includes(k));
  const anomalies = fixed ? (ANOM[k] ? ["Recovered after the fix"] : []) : hs[k] === "healthy" && !ANOM[k] ? [] : ANOM[k] || (hs[k] === "risk" ? ["Early warning: not affected yet"] : []);
  const rel = fixed ? (k === "exo" ? "Microsoft restored Exchange Online; the continuity workaround covered the gap." : "Recovered after Microsoft restored service.") : {
    mail: "Crystal Clean's mail gateway: healthy. The errors it sees are timeouts returned by Microsoft.",
    exo: rcaDone ? "Root cause: Microsoft Exchange Online server outage (Microsoft side, incident EX1042981). Microsoft notified." : "Primary affected service: hosted by Microsoft.", idm: "Shows symptoms only (sign-in retries from mail clients); ruled out as the cause.",
    apigw: "Upstream of Outlook and Dispatch Notifications; healthy, ruled out.", dns: "Resolves Microsoft endpoints normally, ruled out.",
    net: "Branch latency normal, ruled out.", infra: "Crystal Clean servers healthy, ruled out.",
    teams: `Potentially impacted: predicted ~${stages[2]?.time || ""}.`, dispatch: `Potentially impacted: predicted ~${stages[3]?.time || ""}.`,
    cust: `Potentially impacted: predicted ~${stages[4]?.time || ""}.`, report: "Potentially impacted: daily reports are emailed." }[k];
  const link = (x) => <button key={x} className="linkbtn" onClick={() => onNode(x)}>{MAP[x].label}</button>;
  return (
    <Drawer onClose={onClose}>
      <span className="eyebrow">Service · simulated dependency model</span>
      <h2 style={{ fontSize: 19, margin: "6px 0" }}>{n.label}</h2>
      <span className="pill" style={{ background: bg, color: col }}>{hl}</span>
      <p style={{ fontSize: 14 }}>{n.desc}</p>
      <dl className="dl">
        <dt>Related anomalies</dt><dd>{anomalies.length ? <ul>{anomalies.map((a) => <li key={a}>{a}</li>)}</ul> : "None"}</dd>
        <dt>Upstream (depends on)</dt><dd>{n.deps.length ? n.deps.map(link).reduce((a, b) => [a, ", ", b]) : "None"}</dd>
        <dt>Downstream (used by)</dt><dd>{downs.length ? downs.map(link).reduce((a, b) => [a, ", ", b]) : "None"}</dd>
        <dt>Incident relevance</dt><dd>{rel}</dd>
      </dl>
    </Drawer>
  );
}
