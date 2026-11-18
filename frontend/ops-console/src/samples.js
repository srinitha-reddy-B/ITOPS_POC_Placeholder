// Illustrative sample data so every portal has a realistic day's worth of activity. Always shown with a
// "Sample" tag and never linked to ServiceNow; the live incidents (with real ServiceNow numbers) come from the backend.
const now = Date.now() / 1000;
const min = (m) => now - m * 60;

export const SAMPLE_TICKETS = [
  { id: "S-1", sample: true, number: "INC0010690", usecase: "api", title: "RouteOps Dispatch API returning 5xx for Chicago North drivers", status: "investigating",
    severity: "critical", origin: "monitoring", reporter: null, created: min(18), cause: null,
    summary: "Error rate on the dispatch API rose to 7% at 07:42. Drivers see route lists fail to load intermittently.",
    timeline: [["07:42", "Monitoring raised a predictive alert (5xx 7%)"], ["07:44", "Agents started the investigation"], ["07:51", "Evidence: DB connection pool at 92%"]] },
  { id: "S-2", sample: true, number: "INC0010688", usecase: "network", title: "VPN connections dropping at the Indianapolis branch", status: "investigating",
    severity: "high", origin: "employee", reporter: "Marcus Reed", created: min(41), cause: null,
    summary: "Three employees report VPN drops every 10–15 minutes. Probe loss on the branch link is 6%.",
    timeline: [["07:19", "Marcus Reed reported it to the IT help bot"], ["07:21", "Linked to the branch link alert"], ["07:30", "Network Operations reviewing the WAN provider status"]] },
  { id: "S-3", sample: true, number: "INC0010684", usecase: "storage", title: "Branch scan server disk at 86% and growing", status: "awaiting_approval",
    severity: "warning", origin: "monitoring", reporter: null, created: min(64), cause: "Manifest scans older than 90 days were never archived",
    summary: "Disk usage grows about 3% a day; it reaches 90% in about 30 hours.",
    recommendation: { action: "Archive manifest scans older than 90 days to the archive tier (kept, not deleted)", outcome: "Disk usage back under 60%",
      risk: "Low", side: ["Old scans open from the archive tier (a few seconds slower)"] },
    timeline: [["06:56", "Predictive alert: 90% in about 30 hours"], ["07:05", "Root cause found: no archiving of old scans"], ["07:06", "Fix proposed, waiting for approval"]] },
  { id: "S-4", sample: true, number: "INC0010679", usecase: "sso", title: "Marcus Reed locked out after a password change", status: "resolved",
    severity: "warning", origin: "employee", reporter: "Marcus Reed", created: min(150), cause: "Handheld kept signing in with the old password",
    summary: "Account unlocked and the stale handheld session signed out. Marcus signed in again.",
    timeline: [["05:30", "Reported by Marcus Reed"], ["05:34", "Account unlocked (self-service policy)"], ["05:36", "Verified: Marcus signed in"]] },
  { id: "S-5", sample: true, number: "INC0010675", usecase: "backup", title: "Nightly manifest database backup failed", status: "resolved",
    severity: "high", origin: "monitoring", reporter: null, created: min(330), cause: "Backup job used an outdated repository credential",
    summary: "Credential re-synchronised from the vault; a new backup succeeded and a restore test passed.",
    timeline: [["02:30", "Backup failed"], ["02:41", "Root cause: outdated credential"], ["02:52", "Approved by Mark Wood; backup and restore test passed"]] },
];

export const SAMPLE_MANAGER_INCIDENTS = [
  { id: "SM-1", sample: true, number: "INC0010641", title: "Branch reporting emails delayed (Chicago North)", status: "resolved", severity: "warning", created: now - 3 * 86400,
    statusText: "Resolved: closed by IT Admin" },
  { id: "SM-2", sample: true, number: "INC0010612", title: "Dispatch notifications arriving late", status: "resolved", severity: "high", created: now - 6 * 86400,
    statusText: "Resolved: closed by IT Admin" },
];

export const SAMPLE_REQUESTS = [
  { id: "SR-1", sample: true, number: "INC0010688", title: "VPN keeps disconnecting on my laptop", text: "IT is checking the branch network link.", status: "investigating", step: 1 },
  { id: "SR-2", sample: true, number: "INC0010679", title: "Handheld says my account is locked", text: "Fixed: you can sign in again.", status: "resolved", step: 4 },
];

export const SAMPLE_APPS = [
  ["RouteOps Mobile", "Routes and stops for today", "ok", "Working"],
  ["Outlook", "Email and calendar", null, null],
  ["Branch file share", "Scanned manifests", "ok", "Working"],
  ["Crystal Clean sign-in", "Your work account", "ok", "Working"],
];
