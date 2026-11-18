<script>
"use strict";
/* ----------------------------------------------------------- control tower */
function pageTower() {
  const session = S.executions.slice(0, Math.max(0, S.executions.length - SEED_EXEC));
  const approved = S.approvals.filter((a) => a.status === "Approved").length;
  const pending = S.approvals.filter((a) => a.status === "Pending");
  const total = BASELINE.total + session.length;
  const success = BASELINE.success + session.filter((e) => e.status === "Success").length + approved;
  const failed = BASELINE.failed + session.filter((e) => e.status === "Failed").length;
  const rcaRan = S.executions.some((e) => e.record === "INC0010048");
  const history = (rcaRan ? [] : [{ id: "—", agent: "rca", record: "INC0010048", at: S.inc.opened, ms: 0, status: S.inc.rca === "running" ? "Running" : "Queued", action: S.inc.rca === "running" ? "Analysing Payment API HTTP 504 incident" : "Waiting for triage; RCA starts when the incident is In Progress" }]).concat(S.executions).slice(0, 12);
  const color = Object.fromEntries(AGENTS.map((a) => [a.id, a.color]));
  const maxDay = Math.max(...WEEKLY.map((d) => d.asset + d.rca + d.hr));
  const execKind = (s) => (s === "Success" ? "good" : s === "Failed" ? "critical" : s === "Running" ? "running" : s === "Queued" ? "info" : "warning");
  const tile = (ic, label, v, sub, tone) => `<div class="card tile"><div class="h"><span style="color:${tone || "var(--ink-muted)"}">${icon(ic)}</span><span class="eyebrow">${label}</span></div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  const pct = (n) => Math.round((n / total) * 1000) / 10;

  return `${head("Crystal Clean Control Tower", "CIO and IT leadership view: what the AI agents did, whether it worked, which actions are waiting for a human, and which governance controls apply. Offline build with illustrative values; the live app reads its operations metrics from ServiceNow.", "Leadership view", badge("warning", "Illustrative demo values"))}
  <div class="grid g6" style="gap:12px">
    ${tile("bot", "Total AI agents", AGENTS.length, "Registered in this POC", "var(--brand)")}
    ${tile("radar", "Active agents", AGENTS.length, "All monitored", "var(--ok)")}
    ${tile("activity", "Total executions", total, "Last 7 days")}
    ${tile("check", "Successful", success, `${Math.round((success / total) * 100)}% success rate`, "var(--ok)")}
    ${tile("hourglass", "Pending human reviews", pending.length, "Awaiting approval", "var(--warn)")}
    ${tile("xcircle", "Failed executions", failed, "Escalated to engineers", "var(--danger)")}
  </div>
  ${wbTowerSection()}
  <div class="grid g3" style="gap:12px;margin-top:16px">${AGENTS.map((a) => {
    const runs = WEEKLY.reduce((n, d) => n + d[a.id], 0) + session.filter((e) => e.agent === a.id).length;
    const fails = S.executions.filter((e) => e.agent === a.id && e.status === "Failed").length;
    const last = (S.executions.find((e) => e.agent === a.id) || {}).at;
    return `<div class="card agentcard">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div style="display:flex;gap:10px;align-items:center"><span class="ico" style="background:${a.color}">${icon(a.icon)}</span><div><h3 style="margin:0;font-size:13.5px">${a.name}</h3><p style="margin:0;font-size:11.5px;color:var(--ink-muted)">${a.module}</p></div></div>${badge("good", "Active")}</div>
      <p style="margin:12px 0 0;font-size:12.5px;line-height:1.6;color:var(--ink-soft)">${a.fn}</p>
      <dl><div><dt>Runs · 7d</dt><dd>${runs}</dd></div><div><dt>Success</dt><dd>${Math.round(((runs - fails) / Math.max(1, runs)) * 1000) / 10}%</dd></div><div><dt>Last run</dt><dd style="font-size:12.5px;font-weight:500">${last ? rel(last) : "—"}</dd></div></dl>
      <div class="meta"><div><b>Owner:</b> ${a.owner}</div><div><b>Scope:</b> ${a.scope}</div><div><b>Control:</b> ${a.writes}</div></div>
      <a href="${a.href}" style="margin-top:12px;display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:500;color:var(--brand)">Open use case ${icon("arrow")}</a>
    </div>`; }).join("")}</div>
  <div class="split" style="gap:12px;margin-top:16px;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)">
    <div class="card pad"><div class="sec-head"><h2 class="sec-title">${icon("barchart")} Executions · last 7 days</h2><span class="note-r">By agent</span></div>
      <div class="bars">${WEEKLY.map((d) => { const sum = d.asset + d.rca + d.hr; return `<div class="col"><span style="font-size:10.5px;color:var(--ink-muted)">${sum}</span><div class="stack" style="height:${(sum / maxDay) * 110}px" title="${d.day}: ${sum} executions">${["asset", "rca", "hr"].map((k) => `<div style="height:${(d[k] / sum) * 100}%;background:${color[k]}"></div>`).join("")}</div><span style="font-size:11px;color:var(--ink-muted)">${d.day}</span></div>`; }).join("")}</div>
      <div class="legend">${AGENTS.map((a) => `<span><i style="background:${a.color}"></i>${a.name}</span>`).join("")}</div>
    </div>
    <div class="card pad"><div class="sec-head"><h2 class="sec-title">${icon("activity")} Execution outcomes</h2><span class="note-r">${total} executions</span></div>
      <div style="display:flex;height:12px;border-radius:999px;overflow:hidden;margin-top:16px"><div style="width:${(success / total) * 100}%;background:var(--ok-dot)"></div><div style="width:${(pending.length / total) * 100}%;background:#f5b544"></div><div style="width:${(failed / total) * 100}%;background:#f04438"></div></div>
      <ul style="list-style:none;margin:16px 0 0;padding:0;font-size:12.5px">${[["Successful", success, "var(--ok-dot)"], ["Pending human review", pending.length, "#f5b544"], ["Failed", failed, "#f04438"]].map(([l, n, c]) => `<li style="display:flex;justify-content:space-between;margin:8px 0"><span style="display:flex;align-items:center;gap:8px;color:var(--ink-soft)"><i style="width:9px;height:9px;border-radius:50%;background:${c};display:inline-block"></i>${l}</span><b>${n} <span style="font-weight:400;color:var(--ink-muted)">· ${pct(n)}%</span></b></li>`).join("")}</ul>
    </div>
  </div>
  <div class="card pad" style="margin-top:16px"><div class="sec-head"><h2 class="sec-title">${icon("history")} Execution history</h2><span class="note-r">Newest first · includes this session's demo activity</span></div>
    <div class="tbl-wrap" style="margin:12px -20px 0"><table class="t" style="min-width:820px"><thead><tr>${["Agent", "Execution ID", "Related record", "Execution time", "Status", "Action performed"].map((h) => `<th style="padding-left:20px">${h}</th>`).join("")}</tr></thead><tbody>
      ${history.map((e) => `<tr style="${e.record === "INC0010048" ? "background:#f5f5fd" : ""}"><td style="padding-left:20px;white-space:nowrap"><span style="display:inline-flex;align-items:center;gap:8px"><i style="width:8px;height:8px;border-radius:50%;background:${color[e.agent]};display:inline-block"></i>${agentName(e.agent)}</span></td><td style="padding-left:20px"><span class="mono-chip">${e.id}</span></td><td style="padding-left:20px">${snowLink(e.record, "color:var(--brand)")}</td><td style="padding-left:20px;white-space:nowrap;color:var(--ink-soft)">${rel(e.at)}${e.ms ? `<span style="color:var(--ink-faint)"> · ${(e.ms / 1000).toFixed(1)} s</span>` : ""}</td><td style="padding-left:20px">${badge(execKind(e.status), e.status)}</td><td style="padding-left:20px;color:var(--ink-soft)">${e.action}</td></tr>`).join("")}
    </tbody></table></div>
  </div>
  <div class="split" style="gap:12px;margin-top:16px;grid-template-columns:minmax(0,1fr) minmax(0,1.5fr)">
    <div class="card pad"><h2 class="sec-title">${icon("shield")} Security &amp; governance</h2>
      <ul style="list-style:none;margin:12px 0 0;padding:0">${GOVERNANCE.map((g) => `<li style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)"><div><div style="font-size:13px;font-weight:500">${g.label}</div><div style="font-size:11.5px;color:var(--ink-muted)">${g.note}</div></div>${badge(g.label === "Human approval" ? "warning" : "good", g.value)}</li>`).join("")}</ul>
    </div>
    <div class="card pad"><div class="sec-head"><h2 class="sec-title">${icon("usercheck")} Human approval tracking</h2><span class="note-r">${pending.length} pending</span></div>
      <ul style="list-style:none;margin:12px 0 0;padding:0">${S.approvals.map((a) => `<li style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)">
        <div style="flex:1;min-width:0"><div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12.5px"><span class="mono-chip">${a.id}</span>${snowLink(a.record, "color:var(--brand)")}<span style="color:var(--ink-muted)">· ${agentName(a.agent)}</span></div><p style="margin:2px 0 0;font-size:13px">${a.action}</p><p style="margin:2px 0 0;font-size:11px;color:var(--ink-muted)">${rel(a.at)} · approver: ${a.approver}</p></div>
        ${a.status === "Pending" ? `<div style="display:flex;gap:6px"><button class="btn danger" data-act="decide" data-id="${a.id}" data-d="Rejected">Reject</button><button class="btn primary" data-act="decide" data-id="${a.id}" data-d="Approved">Approve</button></div>` : badge(a.status === "Approved" ? "good" : "critical", a.status)}
      </li>`).join("")}</ul>
    </div>
  </div>
  ${simnote("All metrics, executions and approvals on this page are simulated for the Crystal Clean proof of concept. They are illustrative demo values, not Crystal Clean operational data, and the dashboard is not connected to any monitoring service.")}`;
}

