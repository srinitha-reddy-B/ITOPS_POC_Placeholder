# Agentic Incident Workbench page (source)

The workbench is one self-contained HTML file built from these parts:

| Part | Contents |
|---|---|
| `1_head.html` | Page shell and shared styles |
| `2_data.js` | Icons, shared helpers, Control Tower demo state |
| `3_pages.js` | Top bar (with the demo persona selector), persona sidebar navigation, older Asset/HR pages (no longer routed) |
| `3a_frontdoor.js` | Helpers the Asset/HR pages still use |
| `4b_tower.js` | Point32Health Control Tower |
| `5a_wb_engine.js` | Orchestrator, agent steps and branching, demo scripted agents, live API client |
| `5c_wb_ui.js` | Incident Command Center, incident workflow view, Digital FrontDoor |
| `5e_wb_domains.js` | IT Asset and HR flows (agents, policy rules, approvals, Service Catalog fulfilment), FrontDoor AI routing, ServiceNow progress notes |
| `5f_wb_domains_ui.js` | Domain tabs, asset/HR request lists and views, the three-domain Digital FrontDoor |
| `5g_pi_engine.js` | Predictive Intelligence: simulated monitoring feed, rule-based risk engine (extended to rules-v2 in `6b`), the five predictive agents, admin decisions, hand-off to the RCA workflow |
| `5h_pi_ui.js` | Predictive Intelligence pages and charts, prediction detail, FrontDoor alert centre, Control Tower predictive section |
| `6a_persona.js` | Demo persona switcher: six personas, role-based navigation, route and action guards, read-only workflow views, approval inbox, backend role header |
| `6b_ms_engine.js` | Multi-signal engine: step-based signal simulation, correlation engine, rules-v2 risk score (12 factors), capacity forecasts, what-if sandbox |
| `6c_ms_ui.js` | Multi-signal monitoring, consolidated prediction and "Why" panel, dependency map, what-if, notification centre, Prediction Accuracy, employee Alerts page |
| `6d_intel.js` | Incident intelligence tab, Asset Lifecycle Intelligence, HR Workflow Intelligence, leadership enterprise overview |
| `7a_command_center.js` | ITOps Command Center dashboard, plus shared components (metric card, incident card, health dot, activity timeline, evidence panel) |
| `7b_sso_investigation.js` | Animated SSO investigation: telemetry → history → pattern → root cause → remediation (human approval) → verification. Demo: deterministic walkthrough; Live: built only from real execution events |
| `7c_dependency_graph.js` | Service dependency graph (SSO path and enterprise services) with animated flows and a detail panel |
| `7d_agents_observability.js` | Agent execution view (sequential handover), Observability dashboard, incident Timeline and ServiceNow work-notes tabs |
| `5d_router.js` | Routes (persona-checked) and event handlers (persona-guarded) |

The curated incident dataset (`backend/app/p32_workbench_data.json`, 25 synthetic incidents plus DEMO-PAY-048, the documented INC0010048 scenario), the predictive scenarios (`backend/app/p32_predictive_data.json`) and the multi-signal demo data (`backend/app/p32_multisignal_data.json`, adds three demo-only scenarios and the rules-v2 configuration on the page only) are embedded at build time.

Build output: `frontend/dist/p32/index.html`, served at http://localhost:3000/p32 by `frontend/server.mjs`.
`npm run dev` (in `frontend/`) rebuilds it whenever a part or one of those datasets changes; refresh the browser.
`npm run build` builds it on its own (`scripts/build-p32.mjs`, which also checks every inline script parses).
`4_incident_tower.js`, `4a_incident.js` and `4c_router.js` are older parts that are not included in the build.

Tests: `npm test` (in `frontend/`) builds the page, loads it in a Node VM with a minimal DOM stub, renders every persona and route, checks the rule engines and runs the INC0010048 scenario end to end in Controlled Demo Mode. No dependencies.
