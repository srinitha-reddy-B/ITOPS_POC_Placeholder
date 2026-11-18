<script>
"use strict";
/* =====================================================================
   Crystal Clean ServiceNow AI POC: standalone HTML version.
   Everything runs in the browser on simulated data (no ServiceNow or LLM
   connection). State is kept in localStorage so a refresh keeps the demo.
   ===================================================================== */

/* ---------------------------------------------------------------- icons */
const ICON_PATHS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
  siren: '<path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M5 21h14a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v1a1 1 0 0 0 1 1Z"/><path d="M21 12h1M18.5 4.5 18 5M2 12h1M12 2v1M4.9 4.9l.7.7M12 12v6"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  radar: '<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34M4 6h.01M2.29 9.62A10 10 0 1 0 21.31 8.35M16.24 7.76A6 6 0 1 0 8.23 16.67M12 18h.01M17.99 11.66A6 6 0 0 1 15.77 16.67"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  chevdown: '<path d="m6 9 6 6 6-6"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M16 15l-3-3 3-3"/>',
  bot: '<path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
  sparkles: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  circle: '<circle cx="12" cy="12" r="10"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.22-8.56"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  usercheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"/>',
  down: '<path d="M12 17V3M6 11l6 6 6-6M19 21H5"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M12 11h4M12 16h4M8 11h.01M8 16h.01"/>',
  wand: '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72M14 7l3 3M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  send: '<path d="M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.64l-19 6.5a.5.5 0 0 0-.03.94l7.93 3.18a2 2 0 0 1 1.11 1.11z"/><path d="m21.85 2.15-10.94 10.94"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  barchart: '<path d="M3 3v16a2 2 0 0 0 2 2h16M18 17V9M13 17V5M8 17v-3"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  xcircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  usercircle: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.66V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.66"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  door: '<path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3M13 20h9M10 12v.01"/><path d="M13 4.56v16.01a.5.5 0 0 1-.6.49l-6.8-1.36A2 2 0 0 1 4 17.74V5.4a2 2 0 0 1 1.6-1.96l6-1.2A1 1 0 0 1 13 3.26z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  thumbup: '<path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
  thumbdown: '<path d="M17 14V2M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
};
function icon(name, cls = "") {
  return `<svg class="${cls}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ------------------------------------------------------------------- data */
const AGENTS = [
  { id: "asset", name: "Asset Lifecycle Assistant", fn: "Analyses IT assets and recommends replacement actions", module: "Asset Management", href: "#/asset-management", owner: "IT Asset Management", scope: "Read alm_hardware · draft replacement requests", writes: "Replacement requests need manager approval", color: "#2e90fa", icon: "laptop" },
  { id: "rca", name: "ServiceNow RCA Agent", fn: "Analyses incidents and generates RCA/SOP work notes", module: "Incident Management", href: "#/incident-management", owner: "Application Development", scope: "Read incident, CI and change data · post work notes", writes: "Resolution is applied only after engineer approval", color: "#0a5c9e", icon: "siren" },
  { id: "hr", name: "HR Onboarding Assistant", fn: "Provides onboarding guidance", module: "HR Services", href: "#/hr-services", owner: "People & Culture (HRSD)", scope: "Read onboarding tasks and HR knowledge · answer questions", writes: "Sensitive topics are routed to a private HR case", color: "#15b79e", icon: "users" },
];
const agentName = (id) => (AGENTS.find((a) => a.id === id) || {}).name || id;

const ASSETS = [
  { id: "AST001025", type: "Laptop", model: "Dell Latitude 7440", serial: "DL7440-8KQ2M3", assignedTo: "Maya Thompson", department: "Finance", status: "In Use", purchased: "2022-11-15", warranty: "Expired", warrantyEnd: "2025-11-15", condition: "Fair", location: "Canton, MA" },
  { id: "AST001031", type: "Laptop", model: "Dell Latitude 5450", serial: "DL5450-2PX7R1", assignedTo: "Daniel Brooks", department: "Claims", status: "In Use", purchased: "2024-03-04", warranty: "Active", warrantyEnd: "2027-03-04", condition: "Good", location: "Boston, MA" },
  { id: "AST001044", type: "Laptop", model: "Lenovo ThinkPad T14 Gen 3", serial: "LN-T14G3-77Q4", assignedTo: "Priya Raman", department: "Member Services", status: "In Use", purchased: "2023-01-20", warranty: "Expiring", warrantyEnd: "2026-01-20", condition: "Good", location: "Canton, MA" },
  { id: "AST001052", type: "Laptop", model: "Dell Latitude 7430", serial: "DL7430-5HT9K2", assignedTo: "Ethan Reed", department: "Clinical Operations", status: "In Use", purchased: "2021-09-10", warranty: "Expired", warrantyEnd: "2024-09-10", condition: "Poor", location: "Boston, MA" },
  { id: "AST001060", type: "Laptop", model: "Microsoft Surface Laptop 6", serial: "MS-SL6-30PZ", assignedTo: "Grace Kim", department: "Marketing", status: "In Use", purchased: "2025-02-12", warranty: "Active", warrantyEnd: "2028-02-12", condition: "Excellent", location: "Remote" },
  { id: "AST001067", type: "Laptop", model: "Dell Latitude 7440", serial: "DL7440-9WM4B6", assignedTo: "—", department: "IT", status: "In Stock", purchased: "2025-06-01", warranty: "Active", warrantyEnd: "2028-06-01", condition: "Excellent", location: "Canton, MA · Depot" },
  { id: "AST001073", type: "Laptop", model: "Lenovo ThinkPad X1 Carbon", serial: "LN-X1C-14RT", assignedTo: "Marcus Lee", department: "Engineering", status: "In Repair", purchased: "2022-05-18", warranty: "Expired", warrantyEnd: "2025-05-18", condition: "Fair", location: "Boston, MA" },
];

function monthsBetween(fromIso, to) {
  const f = new Date(fromIso + "T00:00:00");
  let m = (to.getFullYear() - f.getFullYear()) * 12 + (to.getMonth() - f.getMonth());
  if (to.getDate() < f.getDate()) m -= 1;
  return Math.max(0, m);
}
function ageLabel(m) {
  const y = Math.floor(m / 12), r = m % 12;
  return [y ? `${y} yr${y === 1 ? "" : "s"}` : "", r ? `${r} mo` : ""].filter(Boolean).join(" ") || "< 1 mo";
}
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];
function analyseAsset(a, now) {
  const months = monthsBetween(a.purchased, now);
  const yrs = Math.round(months / 12);
  const out = a.warranty === "Expired";
  const weak = a.condition === "Fair" || a.condition === "Poor";
  const replace = months >= 48 || (out && weak) || a.condition === "Poor";
  const monitor = !replace && (a.warranty === "Expiring" || months >= 36 || weak);
  const reasons = [];
  if (months >= 42) reasons.push(`Asset age of ${ageLabel(months)} is at or near the 48-month laptop refresh policy.`);
  if (out) reasons.push(`Manufacturer warranty ended on ${a.warrantyEnd}; repairs would be billed out of contract.`);
  if (a.warranty === "Expiring") reasons.push(`Warranty ends on ${a.warrantyEnd}; plan before coverage lapses.`);
  if (weak) reasons.push(`Condition is recorded as ${a.condition}, which raises the risk of hardware faults.`);
  if (!reasons.length) reasons.push("Asset is within policy age, under warranty and in good condition.");
  const rec = replace ? "Replace" : monitor ? "Monitor" : "Keep";
  const who = a.assignedTo === "—" ? "the depot" : a.assignedTo;
  return {
    rec,
    reasons,
    headline: replace
      ? `This ${a.type.toLowerCase()} is approximately ${yrs === 1 ? "one year" : (WORDS[yrs] || yrs) + " years"} old${out ? " and its warranty has expired" : ""}. Its condition is marked as ${a.condition}. Consider initiating a replacement assessment.`
      : monitor
        ? `This ${a.type.toLowerCase()} is ${ageLabel(months)} old with ${a.warranty.toLowerCase()} warranty and ${a.condition} condition. Keep it in service and review it at the next refresh cycle.`
        : `This ${a.type.toLowerCase()} is ${ageLabel(months)} old, under warranty and in ${a.condition} condition. No action is needed.`,
    condition: `${a.condition}: ${a.condition === "Poor" ? "frequent faults expected" : a.condition === "Fair" ? "serviceable, visible wear and slower performance likely" : "operating normally"}.`,
    warranty: out ? `Expired on ${a.warrantyEnd}.` : a.warranty === "Expiring" ? `Expiring on ${a.warrantyEnd}.` : `Active until ${a.warrantyEnd}.`,
    age: `${ageLabel(months)} since purchase on ${a.purchased} (refresh policy: 48 months).`,
    next: replace
      ? `Raise a replacement assessment request for ${a.id}, reserve a Dell Latitude 7440 from depot stock, and schedule data migration with ${who}.`
      : monitor ? `Add ${a.id} to the next quarterly refresh review and confirm warranty extension options.` : `No action. Re-evaluate ${a.id} at the next lifecycle review.`,
  };
}

const INC = {
  number: "INC0010048", short: "Payment API returning HTTP 504 after idle period",
  description: "Production Payment API is intermittently returning HTTP 504 Gateway Timeout on the first request after an idle period. The issue appears after the Container App scales from zero to one replica. Subsequent requests succeed after the application becomes warm. Initial investigation indicates the application startup may take longer than the APIM timeout. Please investigate the production incident and determine the root cause.",
  caller: "Abel Tuter", category: "Software", subcategory: "Application", service: "IT Services", ci: "Payment API (Production)", environment: "Production",
  impact: "1 - High", urgency: "2 - Medium", priority: "2 - High", group: "Application Development", channel: "Monitoring alert",
};
/*
 * ServiceNow links. This file has no backend, so it cannot look records up. These are the only
 * incidents in this demo that exist in the Crystal Clean POC ServiceNow instance with the same story,
 * listed with their real sys_id. Only they become links; every other number is simulated and shows
 * as plain text, so no link is ever made up. ServiceNow's own login applies when a link is opened.
 */
const SNOW_INSTANCE = "https://dev394020.service-now.com";
const SNOW_RECORDS = {
  INC0010048: "51a1730547e34b10299f9df4316d43b2",
  INC0010064: "d48f159447a85750299f9df4316d43a9",
  INC0010065: "2536f598476c5750299f9df4316d4385",
};
const snowUrl = (n) => (SNOW_RECORDS[n] ? `${SNOW_INSTANCE}/incident.do?sys_id=${SNOW_RECORDS[n]}` : "");
function snowLink(n, plainStyle = "") {
  const u = snowUrl(n);
  if (!u) return `<span class="mono" style="font-size:11.5px;${plainStyle}">${esc(n)}</span>`;
  return `<a class="snlink" href="${u}" target="_blank" rel="noopener noreferrer" title="Open ${esc(n)} in ServiceNow (new tab)" onclick="event.stopPropagation()">${esc(n)}${icon("external")}</a>`;
}
const OTHER_INCIDENTS = [
  { number: "INC0010047", short: "Employee Center search returns no knowledge results", caller: "Grace Kim", priority: "3 - Moderate", state: "In Progress", group: "ServiceNow Platform", assignee: "Ravi Menon" },
  { number: "INC0010046", short: "VPN disconnects after password change", caller: "Daniel Brooks", priority: "4 - Low", state: "In Progress", group: "Service Desk", assignee: "Noah Brooks" },
  { number: "INC0010045", short: "Shared mailbox access denied for Claims team", caller: "Priya Raman", priority: "4 - Low", state: "New", group: "Messaging", assignee: "" },
  { number: "INC0010043", short: "Docking station not detecting external monitors", caller: "Marcus Lee", priority: "5 - Planning", state: "On Hold", group: "Desktop Support", assignee: "Ethan Reed" },
  { number: "INC0010041", short: "Claims portal login slow during morning peak", caller: "Ava Johnson", priority: "3 - Moderate", state: "Resolved", group: "Application Development", assignee: "Arya Hajarha" },
];
const ASSIGNEE = "Arya Hajarha";
const RCA_STEPS = [
  "Reading INC0010048 and the Payment API configuration item",
  "Correlating Container App scale events with the 504 timestamps",
  "Comparing APIM backend timeout with measured cold-start time",
  "Reviewing request traces before and after warm-up",
  "Drafting root cause analysis and matching SOP",
  "Posting RCA and SOP to INC0010048 work notes",
];
const RCA = {
  summary: "Production Payment API intermittently returns HTTP 504 Gateway Timeout, only on the first request after an idle period. Subsequent requests succeed once the service is warm. Impact: payment calls after quiet periods fail and must be retried.",
  root: "A cold-start timeout is exceeding the API gateway timeout limit when the Payment API receives its first request after an idle period.",
  explanation: [
    "The Payment API container app is configured with a minimum replica count of 0, so it scales to zero when idle.",
    "The next request triggers a cold start: image pull, runtime start and dependency warm-up take about 38–44 seconds (simulated trace data).",
    "The API gateway (APIM) backend timeout is 30 seconds, so the gateway gives up and returns HTTP 504 before the replica becomes ready.",
    "Once the replica is warm, responses return in about 180 ms, which is why only the first request after idle fails.",
  ],
  diagnosis: [
    "Checked container app autoscale history for the incident window: replicas dropped to 0 before each failing request.",
    "Compared the APIM backend timeout (30 s) with the measured container startup time for the first request after idle (38–44 s).",
    "Reviewed request traces: each 504 occurs on the first request after idle; subsequent requests succeed once the service is warm.",
    "Checked platform metrics for cold-start duration and readiness time around the incident timestamps.",
  ],
  resolution: [
    "Confirm the service replica count and APIM timeout settings for the affected API.",
    "Set a minimum replica count of 1 so the service stays warm for production traffic.",
    "Increase the APIM backend timeout so it exceeds the observed worst-case cold-start duration.",
    "Verify the next request after an idle period completes successfully without a 504.",
  ],
  prevention: [
    "Keep a minimum replica of 1 for latency-sensitive production APIs.",
    "Ensure the gateway timeout exceeds the worst-case cold-start time, and alert when startup time approaches it.",
    "Add a readiness probe and a synthetic health check that calls the API after idle periods.",
  ],
  sopId: "SOP-APP-0142",
  sopTitle: "Payment API cold-start HTTP 504 remediation",
  sop: [
    "Open the Payment API container app and record the current min/max replica settings in the incident.",
    "Set min replicas to 1 for the production revision (standard change template 'Scale settings').",
    "In APIM, raise the Payment API backend timeout from 30 s to 60 s for the production product.",
    "Let the service idle for 15 minutes, then send a test payment request and confirm HTTP 200.",
    "Attach before/after metrics to the incident and note the verification result in work notes.",
    "Resolve the incident with code 'Solution provided' and link this SOP.",
  ],
};
function rcaWorkNote() {
  const bar = "=".repeat(46);
  const L = [bar, "AURA RCA AGENT · ROOT CAUSE ANALYSIS", bar, "", "INCIDENT SUMMARY", RCA.summary, "", "PROBABLE ROOT CAUSE", RCA.root, "", "TECHNICAL EXPLANATION"];
  RCA.explanation.forEach((x) => L.push("• " + x));
  L.push("", "DIAGNOSIS PERFORMED");
  RCA.diagnosis.forEach((x, i) => L.push(`${i + 1}. ${x}`));
  L.push("", "RECOMMENDED RESOLUTION");
  RCA.resolution.forEach((x, i) => L.push(`${i + 1}. ${x}`));
  L.push("", "PREVENTIVE MEASURES");
  RCA.prevention.forEach((x) => L.push("• " + x));
  L.push("", `SOP: ${RCA.sopId} · ${RCA.sopTitle}`);
  RCA.sop.forEach((x, i) => L.push(`${i + 1}. ${x}`));
  L.push("", "Generated by AURA RCA Agent (simulated POC content). Resolution requires engineer approval.");
  return L.join("\n");
}
const APPROVAL_NOTE = "Approved the AURA RCA Agent recommendation. Applied SOP-APP-0142 steps 1–5 (min replicas = 1, APIM backend timeout = 60 s). Verified first request after idle returns HTTP 200.";
const RESOLUTION_NOTES = "Root cause: cold-start timeout exceeded the APIM gateway timeout on the first request after idle. Applied SOP-APP-0142: min replicas set to 1 and APIM backend timeout raised to 60 s. Verified the first request after a 15-minute idle returns HTTP 200 (simulated). No further 504s observed.";

const EMPLOYEE = { name: "Maya Thompson", id: "EMP-24817", title: "Senior Financial Analyst", department: "Finance", manager: "Priya Raman", location: "Canton, MA (hybrid)", startDate: "2026-11-30", status: "Onboarding in Progress", hrCase: "HRC0004512", buddy: "Daniel Brooks" };
const TASKS = [
  { id: "offer", title: "Accept offer letter", detail: "Signed offer received by People & Culture.", step: 0, due: "2026-10-28", owner: "Employee", done: true },
  { id: "info", title: "Complete employee information", detail: "Personal details, emergency contact and direct deposit form in the Employee Center.", step: 1, due: "2026-11-12", owner: "Employee", done: true },
  { id: "docs", title: "Submit required onboarding documents", detail: "Form I-9 identity documents and W-4 tax withholding form.", step: 2, due: "2026-11-20", owner: "Employee", done: false },
  { id: "policies", title: "Review company policies", detail: "Acknowledge the Code of Conduct, Acceptable Use and Privacy policies.", step: 3, due: "2026-11-24", owner: "Employee", done: false },
  { id: "training", title: "Complete mandatory training", detail: "Security awareness and privacy & compliance training modules (about 90 minutes).", step: 4, due: "2026-12-04", owner: "Employee", done: false },
  { id: "equipment", title: "Confirm equipment and system access requirements", detail: "Laptop AST001025 is assigned; confirm Finance application access with your manager.", step: 5, due: "2026-11-25", owner: "Employee", done: false },
  { id: "welcome", title: "Schedule first-day welcome session", detail: "Manager books the day-one welcome and team introductions.", step: 0, due: "2026-11-26", owner: "Manager", done: true },
];
const ASSIST_STEPS = [
  { step: 1, title: "Complete employee information", hint: "Update your personal details, emergency contact and direct deposit in the Employee Center." },
  { step: 2, title: "Submit required onboarding documents", hint: "Upload your I-9 identity documents and W-4 form. Originals are checked on day one." },
  { step: 3, title: "Review company policies", hint: "Read and acknowledge the Code of Conduct, Acceptable Use and Privacy policies." },
  { step: 4, title: "Complete mandatory training", hint: "Finish the security awareness and privacy & compliance modules before your first week ends." },
  { step: 5, title: "Confirm equipment and system access requirements", hint: "Your laptop is assigned. Confirm which Finance applications you need with Priya Raman." },
];
const HR_QUESTION = "What are the steps I need to complete before joining?";
const HR_SUGGESTIONS = [HR_QUESTION, "Which documents do I need to submit?", "What training is mandatory?", "When will my laptop be ready?"];

const BASELINE = { total: 128, success: 119, failed: 5 };
const WEEKLY = [
  { day: "Mon", asset: 6, rca: 7, hr: 10 }, { day: "Tue", asset: 5, rca: 8, hr: 11 }, { day: "Wed", asset: 7, rca: 6, hr: 9 },
  { day: "Thu", asset: 4, rca: 9, hr: 12 }, { day: "Fri", asset: 6, rca: 7, hr: 10 }, { day: "Sat", asset: 1, rca: 3, hr: 2 }, { day: "Sun", asset: 1, rca: 2, hr: 2 },
];
const GOVERNANCE = [
  { label: "Authentication", value: "Enabled", note: "SSO with MFA (simulated)" },
  { label: "Role-based access", value: "Enabled", note: "Agents inherit the user's ServiceNow roles" },
  { label: "Human approval", value: "Required", note: "Resolutions, replacements and HR letters" },
  { label: "Audit logging", value: "Enabled", note: "Every agent action is recorded" },
  { label: "Sensitive data protection", value: "Enabled", note: "No member or PHI data in scope; masking on" },
  { label: "Agent monitoring", value: "Active", note: "Health, accuracy and failures tracked" },
];

/* ------------------------------------------------------------------ state */
const KEY = "p32-poc-static-v2";
const nowIso = () => new Date().toISOString();
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
function initialState() {
  const opened = ago(18);
  return {
    inc: {
      state: "New", assignee: "", opened, rca: "idle", rcaStep: 0, resolution: null, doc: null, wf: freshWf(),
      activity: [{ id: "a0", at: opened, author: INC.caller, kind: "created", fields: [["State", "", "New"], ["Priority", "", INC.priority], ["Assignment group", "", INC.group]], text: "Incident created from a Payment API monitoring alert." }],
    },
    assets: { analysed: {}, requests: {} },
    hr: { done: Object.fromEntries(TASKS.map((t) => [t.id, t.done])), chat: [] },
    approvals: [
      { id: "APR-0311", agent: "asset", record: "AST001052", action: "Replace Dell Latitude 7430 (Poor condition, out of warranty)", approver: "IT Asset Manager", at: ago(75), status: "Pending" },
      { id: "APR-0309", agent: "rca", record: "INC0010047", action: "Rebuild Employee Center search index (production write)", approver: "ServiceNow Platform lead", at: ago(130), status: "Pending" },
      { id: "APR-0306", agent: "hr", record: "HRC0004501", action: "Share benefits summary letter with employee", approver: "HR Case Manager", at: ago(210), status: "Pending" },
      { id: "APR-0302", agent: "asset", record: "AST001073", action: "Retire Lenovo ThinkPad X1 Carbon after repair assessment", approver: "IT Asset Manager", at: ago(330), status: "Pending" },
    ],
    executions: [
      { id: "EXE-20419", agent: "hr", record: "HRC0004498", at: ago(42), ms: 2100, status: "Success", action: "Answered onboarding question: benefits enrolment window" },
      { id: "EXE-20417", agent: "asset", record: "AST001052", at: ago(75), ms: 1800, status: "Awaiting approval", action: "Recommended replacement; request awaiting manager approval" },
      { id: "EXE-20412", agent: "rca", record: "INC0010041", at: ago(190), ms: 41000, status: "Success", action: "Posted RCA and SOP work note (login latency)" },
      { id: "EXE-20408", agent: "hr", record: "HRC0004490", at: ago(260), ms: 1600, status: "Success", action: "Routed payroll question to private HR case" },
      { id: "EXE-20401", agent: "asset", record: "AST001044", at: ago(380), ms: 1700, status: "Success", action: "Flagged expiring warranty for refresh review" },
      { id: "EXE-20396", agent: "rca", record: "INC0010039", at: ago(520), ms: 52000, status: "Failed", action: "RCA stopped: CI has no monitoring data (escalated to engineer)" },
    ],
    seq: 1,
  };
}
const SEED_EXEC = 6;
function freshWf() {
  return {
    stage: 0, view: 0, started: nowIso(),
    intake: { checks: [], ack: false, done: false },
    triage: { checks: [], done: false },
    evidence: { items: [], collected: false, reviewed: false, note: "", done: false },
    rca: { running: false, step: 0, gate: [], attempts: 0, feedback: "", done: false },
    review: { root: false, sop: false, warnAck: false, comment: "", history: [], done: false },
    exec: { steps: [], log: [], failedOnce: false, retries: 0, manual: false, running: false, done: false },
    verify: { checks: [], running: false, shown: 0, confirmed: null, done: false },
    close: { code: "", notes: "", checks: [], done: false },
    log: [],
  };
}
let S;
try { S = JSON.parse(localStorage.getItem(KEY)) || initialState(); } catch (e) { S = initialState(); }
if (!S.inc.wf) S = initialState();
if (S.inc.rca === "running") S.inc.rca = "idle";
(function settle(w) { w.rca.running = false; w.exec.running = false; w.verify.running = false; w.exec.steps = w.exec.steps.map((x) => (x === "running" ? "pending" : x)); })(S.inc.wf);
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
function commit() { save(); render(); }
function addExec(agent, record, status, action, ms) {
  S.executions.unshift({ id: "EXE-" + (20420 + S.seq), agent, record, at: nowIso(), ms, status, action });
  S.seq++;
}

/* ----------------------------------------------------------------- format */
const p2 = (n) => String(n).padStart(2, "0");
function stamp(iso) { const d = new Date(iso); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; }
function rel(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}
function dmy(iso) { const [y, m, d] = iso.split("-"); return `${d}-${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1]}-${y}`; }
function badge(kind, label) {
  const ic = { good: "check", warning: "clock", serious: "alert", critical: "xcircle", info: "clock", running: "loader" }[kind];
  return `<span class="badge b-${kind}">${icon(ic, kind === "running" ? "spin" : "")} ${esc(label)}</span>`;
}
</script>
