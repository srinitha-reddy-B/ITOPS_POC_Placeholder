import { useEffect, useMemo, useRef, useState } from "react";

export const USECASES = {
  sso: { label: "SSO & identity", short: "SSO", icon: "🔐" },
  storage: { label: "Server storage", short: "Storage", icon: "💽" },
  api: { label: "Application / API", short: "API", icon: "⚙️" },
  network: { label: "Branch network", short: "Network", icon: "📡" },
  backup: { label: "Backup & DR", short: "Backup", icon: "🗄️" },
  mail: { label: "Outlook / Exchange Online", short: "Email", icon: "✉️" },
};

export const fmtTime = (ts) => (ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
export const fmtDateTime = (ts) => (ts ? new Date(ts * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
export function ago(ts) {
  if (!ts) return "never";
  const s = Math.round(Date.now() / 1000 - ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min ago`;
}
export function eta(s) {
  if (s == null) return "—";
  if (s <= 0) return "now";
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}
export const num = (v, d = 0, unit = "") => (v == null || Number.isNaN(v) ? "—" : `${Number(v).toFixed(d)}${unit}`);

const SEV = { critical: "critical", high: "serious", warning: "warning", medium: "warning", info: "neutral", healthy: "good", low: "good" };
const STATUS = {
  investigating: ["info", "Investigating"], awaiting_approval: ["warning", "Awaiting approval"], remediating: ["info", "Remediating"],
  verifying: ["info", "Verifying"], resolved: ["good", "Resolved"], closed: ["neutral", "Closed"], escalated: ["serious", "Escalated"],
  failed: ["critical", "Failed"], interrupted: ["neutral", "Interrupted"], cancelled: ["neutral", "Cancelled"], open: ["warning", "Open"],
  cleared: ["neutral", "Cleared"],
};
const ICON = { good: "✓", warning: "!", serious: "!", critical: "✕", info: "•", neutral: "•" };

export function Pill({ tone = "neutral", children, icon = true, title }) {
  return <span className={`pill pill-${tone}`} title={title}>{icon && <i aria-hidden>{ICON[tone]}</i>}{children}</span>;
}
export const SevPill = ({ sev }) => <Pill tone={SEV[sev] || "neutral"}>{sev ? sev[0].toUpperCase() + sev.slice(1) : "—"}</Pill>;
export function StatusPill({ status }) {
  const [tone, label] = STATUS[status] || ["neutral", status || "—"];
  return <Pill tone={tone}>{label}</Pill>;
}

/** Where data comes from, always visible: LIVE (real integration), LAB (real tool, demo environment), SIMULATED. */
export function Mode({ mode }) {
  const m = { live: ["mode-live", "LIVE"], lab: ["mode-lab", "LAB"], simulated: ["mode-sim", "SIMULATED"], real: ["mode-live", "REAL ACTION"],
    record: ["mode-rec", "HISTORY"], manual: ["mode-sim", "MANUAL"] }[mode] || ["mode-rec", (mode || "").toUpperCase()];
  return <span className={`mode ${m[0]}`}>{m[1]}</span>;
}

export function Card({ title, extra, children, className = "", subtitle }) {
  return (
    <section className={`card ${className}`}>
      {(title || extra) && (
        <header className="card-h">
          <div><h3>{title}</h3>{subtitle && <p className="muted small">{subtitle}</p>}</div>
          {extra && <div className="card-x">{extra}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Tile({ label, value, hint, tone }) {
  return (
    <div className={`tile ${tone ? `tile-${tone}` : ""}`}>
      <div className="tile-l">{label}</div>
      <div className="tile-v">{value}</div>
      {hint && <div className="tile-h">{hint}</div>}
    </div>
  );
}

export function Risk({ score }) {
  if (score == null) return <span className="muted">—</span>;
  const tone = score >= 85 ? "critical" : score >= 70 ? "serious" : score >= 45 ? "warning" : "good";
  return (
    <span className="risk" title={`Risk score ${score}/100`}>
      <span className="risk-bar"><span className={`risk-fill bg-${tone}`} style={{ width: `${score}%` }} /></span>
      <b>{score}</b>
    </span>
  );
}

export function Empty({ children }) { return <div className="empty">{children}</div>; }
export function ErrorBox({ error }) { return error ? <div className="errbox">{String(error.message || error)}</div> : null; }
export function Confidence({ value }) {
  if (value == null) return <span className="muted">n/a</span>;
  const pct = Math.round(value * 100);
  return <span className="conf"><span className="conf-bar"><span style={{ width: `${pct}%` }} /></span>{pct}%</span>;
}

/**
 * Line chart for live metrics: one y-axis, thin 2px lines, recessive grid, dashed threshold lines,
 * crosshair + tooltip on hover. Series colors follow the entity (fixed slots), never the rank.
 */
const SERIES = ["var(--s1)", "var(--s2)"];
export function LineChart({ series, unit = "", height = 150, thresholds = [], max, min = 0, decimals = 0 }) {
  const ref = useRef(null);
  const box = useRef(null);
  const [hover, setHover] = useState(null);
  const [w, setW] = useState(560);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const W = w, H = height, P = { l: 40, r: 10, t: 10, b: 20 };
  const pts = series.flatMap((s) => s.points || []);
  const { x0, x1, y1 } = useMemo(() => {
    if (!pts.length) return { x0: 0, x1: 1, y1: 1 };
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]).filter((v) => v != null);
    const top = max ?? Math.max(...ys, ...thresholds.map((t) => t.value), 1) * 1.1;
    return { x0: Math.min(...xs), x1: Math.max(...xs), y1: top };
  }, [series, max]);
  if (!pts.length) return <div ref={box}><Empty>No data yet from Prometheus.</Empty></div>;
  const X = (t) => P.l + ((t - x0) / Math.max(1, x1 - x0)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (v - min) / Math.max(1e-9, y1 - min)) * (H - P.t - P.b);
  const ticks = [0, 0.5, 1].map((f) => min + f * (y1 - min));
  const onMove = (e) => {
    const rect = ref.current.getBoundingClientRect();
    const t = x0 + ((((e.clientX - rect.left) / rect.width) * W - P.l) / (W - P.l - P.r)) * (x1 - x0);
    const vals = series.map((s) => {
      const p = (s.points || []).reduce((best, q) => (!best || Math.abs(q[0] - t) < Math.abs(best[0] - t) ? q : best), null);
      return p && { name: s.name, t: p[0], v: p[1] };
    }).filter(Boolean);
    if (vals.length) setHover({ t: vals[0].t, vals });
  };
  return (
    <div className="chart" ref={box}>
      {series.length > 1 && (
        <div className="legend">{series.map((s, i) => <span key={s.name}><i style={{ background: SERIES[i] }} />{s.name}</span>)}</div>
      )}
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} className="grid" />
            <text x={P.l - 6} y={Y(v) + 4} className="axis" textAnchor="end">{num(v, decimals)}</text>
          </g>
        ))}
        {thresholds.map((t) => t.value <= y1 && (
          <g key={t.label}>
            <line x1={P.l} x2={W - P.r} y1={Y(t.value)} y2={Y(t.value)} className="thr" />
            <text x={W - P.r} y={Y(t.value) - 4} textAnchor="end" className="thr-l">{t.label}</text>
          </g>
        ))}
        {series.map((s, i) => (
          <polyline key={s.name} fill="none" stroke={SERIES[i]} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round"
            points={(s.points || []).filter((p) => p[1] != null).map((p) => `${X(p[0])},${Y(Math.min(p[1], y1))}`).join(" ")} />
        ))}
        {hover && <line x1={X(hover.t)} x2={X(hover.t)} y1={P.t} y2={H - P.b} className="cross" />}
        {hover && hover.vals.map((v, i) => v.v != null && <circle key={v.name} cx={X(v.t)} cy={Y(Math.min(v.v, y1))} r="4" fill={SERIES[i]} stroke="var(--card)" strokeWidth="2" />)}
        <text x={P.l} y={H - 4} className="axis">{fmtTime(x0)}</text>
        <text x={W - P.r} y={H - 4} className="axis" textAnchor="end">{fmtTime(x1)}</text>
      </svg>
      {hover && (
        <div className="tip" style={{ left: `${(X(hover.t) / W) * 100}%` }}>
          <div className="muted small">{fmtTime(hover.t)}</div>
          {hover.vals.map((v) => <div key={v.name}><b>{num(v.v, decimals)}{unit}</b> <span className="muted">{series.length > 1 ? v.name : ""}</span></div>)}
        </div>
      )}
    </div>
  );
}

export function Json({ value }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}
