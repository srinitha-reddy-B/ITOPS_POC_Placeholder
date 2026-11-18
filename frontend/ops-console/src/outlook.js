// Display text for the Outlook / Exchange Online escalation (use case 6). The live stage, metrics and the incident
// come from the backend (/api/ops/escalation); everything here is the wording around them. Simulated data.

export const STAGE_UI = [
  { color: "#2e9a46", bg: "#e9f6ec", desc: "Outlook and Exchange Online were working normally.", impact: "No business impact." },
  { color: "#b8860b", bg: "#fbf1d6", desc: "Email connection failures and response delays started rising well above normal. This is where the incident started.",
    impact: "Slow email and delayed delivery for about 1,240 employees. Dispatch, customer service and scheduling teams feel it first." },
  { color: "#e0620d", bg: "#fde9dc", desc: "Failures spread to Teams and Calendar, which use the same mail service.", impact: "Meetings and scheduling disrupted for about 2,150 employees." },
  { color: "#c0352b", bg: "#fdecea", desc: "Mail flow slows further and dispatch notifications to drivers are delayed.", impact: "Drivers receive route and schedule changes late. About 3,100 employees affected." },
  { color: "#8f1d14", bg: "#f8dedb", desc: "Email becomes largely unavailable and customer communications slow down.", impact: "Customer replies, service confirmations and invoices delayed. About 3,600 employees affected." },
];

const sec = (ms) => `${(ms / 1000).toFixed(1).replace(/\.0$/, "")} s`;
export const SIGNALS = [
  { key: "error_rate_pct", name: "Email connection failures", short: "Increasing email connection failures", fmt: (v) => `${v}%`, normal: "under 0.5%" },
  { key: "latency_ms", name: "Service response delay", short: "Growing service response delays", fmt: sec, normal: "under 0.5 s" },
  { key: "m365_warnings", name: "Related Microsoft 365 services with early warnings", short: "Related Microsoft 365 services showing early warning signs", fmt: (v) => `${v} of 5`, normal: "none" },
];

export const NEXT = [
  { key: "teams", name: "Teams and Calendar Access", short: "Meeting and scheduling activities may be affected.", risk: "High", at: 2,
    why: "Teams meetings and calendars use the same Exchange Online mailboxes that are failing to connect.",
    rel: "Direct dependency: calendars and meeting invites are stored in Exchange Online.",
    conseq: "Branch stand-ups, customer visit bookings and shift handovers could be missed or rescheduled." },
  { key: "dispatch", name: "Dispatch Notifications", short: "Route and schedule updates may be delayed.", risk: "Medium", at: 3,
    why: "Route changes and schedule updates reach drivers through the email relay.",
    rel: "Indirect dependency: dispatch messages travel through Exchange Online mail flow.",
    conseq: "Drivers may work from outdated routes, causing late or missed pickups." },
  { key: "customer", name: "Customer Communications", short: "Customer email responses may be slower.", risk: "Medium", at: 4,
    why: "Customer service works from shared mailboxes hosted in Exchange Online.",
    rel: "Direct dependency: shared mailboxes and outbound customer email run on Exchange Online.",
    conseq: "Slower replies to customers and delayed service confirmations and invoices." },
];

export const OPS = [
  { name: "Route dispatch coordination", from: 1, effect: "Dispatchers use email and Teams to send route changes to drivers." },
  { name: "Customer service communications", from: 1, effect: "Customer emails and service confirmations are slower to send and receive." },
  { name: "Collection scheduling", from: 1, effect: "Pickup confirmations and calendar bookings may be delayed." },
  { name: "Branch reporting to head office", from: 2, effect: "Daily branch reports sent by email may arrive late." },
  { name: "Waste manifest paperwork", from: 3, effect: "Manifest copies emailed to customers and facilities may be delayed." },
];
export const opsAt = (s) => OPS.filter((o) => s >= 1 && o.from <= s);

// Simulated service dependency model for this incident (not verified production dependencies)
export const MAP = {
  dns: { label: "DNS", layer: 1, deps: [], desc: "Resolves mail and Microsoft 365 endpoints." },
  net: { label: "Network / Branch Connectivity", layer: 1, deps: [], desc: "WAN links between branches, head office and the internet." },
  infra: { label: "Supporting Infrastructure", layer: 1, deps: [], desc: "Certificates, load balancers and the servers that host the mail gateway." },
  idm: { label: "Identity and Access", layer: 2, deps: ["dns", "net"], desc: "Employee sign-in (Keycloak SSO) and tokens." },
  apigw: { label: "API Gateway", layer: 2, deps: ["dns", "net"], desc: "Front door for app traffic, including dispatch notifications." },
  mail: { label: "Mail Transport", layer: 2, deps: ["dns", "net", "infra"], desc: "Mail gateway and connectors between Crystal Clean and Exchange Online." },
  exo: { label: "Outlook / Exchange Online", layer: 3, deps: ["mail", "idm", "apigw"], desc: "Mailboxes, calendars and Outlook access, hosted by Microsoft (Microsoft 365)." },
  teams: { label: "Teams and Calendar", layer: 4, deps: ["exo", "idm"], desc: "Meetings and calendars stored in Exchange Online." },
  dispatch: { label: "Dispatch Notifications", layer: 4, deps: ["exo", "apigw"], desc: "Route and schedule updates sent to drivers." },
  cust: { label: "Customer Communications", layer: 4, deps: ["exo"], desc: "Shared mailboxes and outbound customer email." },
  report: { label: "Branch Reporting", layer: 4, deps: ["exo"], desc: "Daily branch reports emailed to head office." },
};
export const LAYERS = { 1: "Foundation", 2: "Shared IT services", 3: "Affected core service", 4: "Dependent services" };
export const FC_AT = { teams: 2, dispatch: 3, report: 3, cust: 4 };
export const ANOM = {
  exo: ["Microsoft 365 Service Health: Exchange Online incident EX1042981 since 08:36", "Availability and response time far outside normal"],
  mail: ["Timeouts / HTTP 503 returned by Microsoft (Crystal Clean side healthy)"],
  idm: ["Sign-in errors from mail clients retrying: a symptom, not an identity fault"],
};
export const HEALTH = { critical: ["Critical", "#c0352b", "#fdecea"], degraded: ["Degraded", "#b26a00", "#fff4e0"], risk: ["At risk (predicted)", "#6e4ff6", "#efeafe"], healthy: ["Healthy", "#2e9a46", "#e9f6ec"] };
export function health(id, stage, fixed) {
  if (fixed || !stage) return "healthy";
  if (id === "exo") return "critical";
  if (FC_AT[id]) return stage >= FC_AT[id] ? "degraded" : "risk";
  return "healthy";
}
export const up = (id, seen = new Set()) => { MAP[id].deps.forEach((d) => { if (!seen.has(d)) { seen.add(d); up(d, seen); } }); return seen; };
export const down = (id, seen = new Set()) => { Object.keys(MAP).forEach((k) => { if (MAP[k].deps.includes(id) && !seen.has(k)) { seen.add(k); down(k, seen); } }); return seen; };

/** How the manager sees the incident, from the investigation's status in the IT Admin Portal. */
export function managerStatus(inc) {
  if (!inc) return null;
  return { new: "Raised: assigned to IT Admin", investigating: "Under investigation by IT Admin", awaiting_approval: "Fix proposed: awaiting IT approval", remediating: "Fix being applied by IT Admin",
    verifying: "Fix applied: being verified", resolved: "Resolved: closed by IT Admin", closed: "Handed to an IT engineer", escalated: "Handed to an IT engineer",
    failed: "Needs IT attention", interrupted: "Interrupted: raise it again", cancelled: "Cancelled" }[inc.status] || inc.status;
}
export const num = (n) => Number(n || 0).toLocaleString("en-US");
