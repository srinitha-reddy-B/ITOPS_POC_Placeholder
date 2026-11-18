import { useMemo, useState } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow } from "@xyflow/react";
import { Card, Json, Mode } from "./ui.jsx";

const TYPE_ICON = { server: "🖥", metric: "📈", risk: "⚠", log: "📄", config: "⚙", change: "✎", data: "🗃", application: "▣", users: "👥",
  database: "🛢", job: "⏱", endpoint: "⇢", facility: "🏢", network: "🛰", identity: "🔐", user: "👤", account: "🪪", status: "●",
  event: "⚡", storage: "💾", verification: "✓" };

function GNode({ data }) {
  return (
    <div className={`gnode st-${data.status} ${data.visible ? "" : "hidden"} ${data.selected ? "sel" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="ty">{TYPE_ICON[data.type] || "•"} {data.type}</div>
      <div className="lb">{data.label}</div>
      {data.detail && <div className="small muted">{data.detail}</div>}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}
const nodeTypes = { g: GNode };

/** Layered left-to-right layout: each node sits one column after the deepest node pointing to it. */
function layout(nodes, edges) {
  const ids = nodes.map((n) => n.id);
  const incoming = Object.fromEntries(ids.map((i) => [i, []]));
  edges.forEach((e) => incoming[e.target] && incoming[e.target].push(e.source));
  const depth = {};
  const visit = (id, seen = new Set()) => {
    if (depth[id] != null) return depth[id];
    if (seen.has(id)) return 0;
    seen.add(id);
    const ins = incoming[id].filter((s) => ids.includes(s));
    depth[id] = ins.length ? Math.max(...ins.map((s) => visit(s, seen))) + 1 : 0;
    return depth[id];
  };
  ids.forEach((i) => visit(i));
  const cols = {};
  ids.forEach((i) => (cols[depth[i]] = [...(cols[depth[i]] || []), i]));
  const pos = {};
  Object.entries(cols).forEach(([d, list]) => list.forEach((id, k) => (pos[id] = { x: Number(d) * 250, y: (k - (list.length - 1) / 2) * 105 })));
  return pos;
}

/**
 * The investigation's knowledge graph. Nodes appear when the agent that discovers them completes (revealed_by);
 * colours follow status (warning / critical / root cause / resolved). Selecting a node shows its evidence.
 */
export default function InvestigationGraph({ inv, height = 520 }) {
  const [sel, setSel] = useState(null);
  const done = useMemo(() => new Set((inv?.agents || []).filter((a) => ["done", "waiting", "failed"].includes(a.status)).map((a) => a.key)), [inv]);
  const g = inv?.graph || { nodes: [], edges: [] };
  const pos = useMemo(() => layout(g.nodes, g.edges), [JSON.stringify(g.nodes.map((n) => n.id)), JSON.stringify(g.edges.map((e) => e.id))]);
  const visible = (n) => done.has(n.revealed_by || "monitoring");
  const nodes = g.nodes.map((n) => ({ id: n.id, type: "g", position: pos[n.id] || { x: 0, y: 0 },
    data: { ...n, visible: visible(n), selected: sel === n.id } }));
  const shown = new Set(g.nodes.filter(visible).map((n) => n.id));
  const edges = g.edges.filter((e) => shown.has(e.source) && shown.has(e.target)).map((e) => ({
    id: e.id, source: e.source, target: e.target, label: e.label, animated: e.status === "cause",
    style: { stroke: e.status === "cause" ? "var(--critical)" : "var(--muted)", strokeWidth: e.status === "cause" ? 2.5 : 1.4 },
    labelStyle: { fontSize: 11, fill: "var(--ink-2)" }, labelBgStyle: { fill: "var(--card)" },
    markerEnd: { type: MarkerType.ArrowClosed, color: e.status === "cause" ? "#d03b3b" : "#8a96a3" } }));
  const evById = Object.fromEntries((inv?.evidence || []).map((e) => [e.id, e]));
  const node = g.nodes.find((n) => n.id === sel);
  if (!g.nodes.length) return <div className="empty">The graph builds as the agents collect evidence.</div>;
  return (
    <div>
      <div className="graph-wrap" style={{ height }}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.25 }} minZoom={0.3}
          nodesDraggable proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => setSel(n.id === sel ? null : n.id)} onPaneClick={() => setSel(null)}>
          <Background gap={22} size={1} color="var(--line)" />
          <Controls showInteractive={false} />
        </ReactFlow>
        {node && (
          <div className="graph-side">
            <Card title={node.label} subtitle={`${node.type} · discovered by the ${node.revealed_by} agent · ${node.status}`}
              extra={<button className="btn btn-sm" onClick={() => setSel(null)}>✕</button>}>
              {node.detail && <p className="small">{node.detail}</p>}
              {(node.evidence || []).length === 0 && <p className="small muted">No evidence item attached.</p>}
              {(node.evidence || []).map((id) => evById[id] && (
                <div key={id} style={{ marginBottom: 10 }}>
                  <div className="row small"><b className="mono">{id}</b><span>{evById[id].title}</span><Mode mode={evById[id].mode} /></div>
                  <div className="small muted">Source: {evById[id].source}</div>
                  <Json value={evById[id].data} />
                </div>
              ))}
              {inv?.rca?.cause && node.status === "cause" && <div className="note small">Linked to the root cause: {inv.rca.cause}</div>}
            </Card>
          </div>
        )}
      </div>
      <div className="glegend"><span>normal</span><span className="l-warning">warning</span><span className="l-critical">critical</span>
        <span className="l-cause">root cause</span><span className="l-resolved">resolved</span><span>— red animated edge: causal path</span></div>
    </div>
  );
}
