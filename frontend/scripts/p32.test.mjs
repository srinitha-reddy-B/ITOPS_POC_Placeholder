// Tests for the /p32 page. No dependencies: Node's built-in test runner.
//   npm test      (from frontend/)
//
// The built page is loaded into a Node VM with a minimal DOM stub, then every
// persona and route is rendered, the rule engines are checked against known
// values, and the documented INC0010048 scenario is run end to end in
// Controlled Demo Mode (scripted agents, no backend, no ServiceNow).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { buildP32 } from "./build-p32.mjs";

function stubElement() {
  return {
    innerHTML: "", textContent: "", value: "", style: {}, dataset: {}, scrollTop: 0, scrollHeight: 0, clientHeight: 0,
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    querySelector: () => null, querySelectorAll: () => [], insertAdjacentHTML() {}, appendChild() {}, setAttribute() {},
    addEventListener() {}, focus() {}, closest: () => null,
  };
}
function loadPage() {
  const html = fs.readFileSync(buildP32({ quiet: true }), "utf8");
  const els = {};
  const store = new Map();
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, performance, Promise, URL, Date, Math, JSON, AbortController,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    location: { hash: "", protocol: "http:", replace(h) { this.hash = h; } },
    matchMedia: () => ({ matches: true }),
    fetch: async () => { throw new Error("no backend in tests"); },
    document: {
      readyState: "complete", activeElement: null, body: stubElement(),
      getElementById: (id) => (els[id] = els[id] || stubElement()),
      querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => stubElement(),
    },
  };
  ctx.window = ctx; ctx.addEventListener = () => {};
  vm.createContext(ctx);
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(m[1], ctx);
  const run = (code) => vm.runInContext(code, ctx);
  const page = (persona, path) => { run(`PS.id = ${JSON.stringify(persona)}`); ctx.location.hash = `#/${path}`; run("render()"); return els.main.innerHTML; };
  return { ctx, run, page, els };
}

test("page builds and every inline script parses", () => {
  assert.ok(fs.existsSync(buildP32({ quiet: true })));
});

test("every persona sees exactly its own pages", () => {
  const { page } = loadPage();
  const routes = ["", "my-alerts", "command-center", "predictive", "predictive/signals", "predictive/map", "predictive/whatif", "predictive/settings", "sso-investigation", "dependency-graph", "agent-execution", "observability", "accuracy", "approvals", "workbench", "workbench/DEMO-PAY-048", "asset-insights", "hr-insights", "leadership"];
  const allowed = {
    employee: ["", "my-alerts"],
    it_admin: ["command-center", "predictive", "predictive/signals", "predictive/map", "predictive/whatif", "predictive/settings", "sso-investigation", "dependency-graph", "agent-execution", "observability", "accuracy", "approvals", "workbench", "workbench/DEMO-PAY-048"],
    engineer: ["command-center", "sso-investigation", "dependency-graph", "agent-execution", "observability", "approvals", "workbench", "workbench/DEMO-PAY-048"],
    asset_mgr: ["approvals", "workbench", "asset-insights"],
    hr_partner: ["approvals", "workbench", "hr-insights"],
    leadership: ["sso-investigation", "observability", "accuracy", "leadership"],
  };
  for (const [persona, ok] of Object.entries(allowed)) {
    for (const r of routes) {
      const html = page(persona, r);
      const restricted = html.includes("Not available for");
      // asset/HR managers can open the workbench but not an incident record from another lane
      const expectOk = ok.includes(r) && !(r === "workbench/DEMO-PAY-048" && !["it_admin", "engineer"].includes(persona));
      assert.equal(!restricted, expectOk, `${persona} → /${r}`);
    }
  }
});

test("the action guard blocks approvals outside a persona's authority", () => {
  const { run } = loadPage();
  run(`PS.id = "it_admin"; location.hash = "#/workbench/DEMO-PAY-048"`);
  assert.equal(run(`psGuard("wb-decide").ok`), false);
  assert.equal(run(`psGuard("sso-approve").ok`), false);
  run(`PS.id = "engineer"`);
  assert.equal(run(`psGuard("wb-decide").ok`), true);
  assert.equal(run(`psGuard("pi-ack").ok`), false);
  run(`PS.id = "leadership"`);
  assert.equal(run(`psGuard("pi-open").ok`), false);
});

test("rules-v2: claims spike scores Critical, normal signals raise nothing", () => {
  const { run } = loadPage();
  const crit = run(`(() => { const c = msCorrelate("claims", {}, 4); const h = piDemoHistory("claims"); return piScore({ metrics: c.sigs.filter((x) => x.primary), n90: h.n90, similar: h.similar, disruptive: h.disruptive, criticality: 5, max_cluster: h.max_cluster, minutes: 50, ms: c, business_level: 5 }, PI.config); })()`);
  assert.equal(crit.cls, "Critical");
  assert.ok(crit.score >= 81, `score ${crit.score}`);
  assert.equal(run(`msCorrelate("claims", {}, 0).abn.length`), 0);
});

test("rules-v2: factors with no data are excluded, not scored zero", () => {
  const { run } = loadPage();
  const r = run(`piScore({ metrics: [{ key: "f", name: "Failed sign-ins", unit: "", baseline: 0.1, warn: 5, crit: 10, better: "lower", current: 12, status: "critical" }], n90: 5, similar: 4, disruptive: 2, criticality: 5, max_cluster: 2, minutes: 10, ms: null, live: true }, PI.config)`);
  const na = r.contributions.filter((c) => c.na).map((c) => c.factor).sort().join(",");
  assert.equal(na, "capacity,changes");
  assert.equal(r.weights_total, 89);
});

test("asset and HR forecasts", () => {
  const { run } = loadPage();
  assert.equal(run(`asEval(MS_DATA.assets.find((a) => a.tag === "P1000177")).rec`), "Replace");
  assert.equal(run(`asEval(MS_DATA.assets.find((a) => a.tag === "SYN-LT-2103")).rec`), "Monitor");
  assert.equal(run(`hrEval(MS_DATA.hr.onboarding.find((c) => c.id === "HRC-DEMO-4512")).status`), "Will be late");
});

test("SSO demo walkthrough steps through all six stages and waits for approval", () => {
  const { run, page } = loadPage();
  page("it_admin", "sso-investigation");
  for (let i = 0; i < 60; i++) run("ssoTick(true)");
  assert.equal(run("UI.sso.stage"), 5, "stops at remediation until approved");
  assert.equal(run("UI.sso.approved"), false);
  run("UI.sso.approved = true");
  for (let i = 0; i < 20; i++) run("ssoTick(true)");
  assert.equal(run("UI.sso.stage"), 6);
  assert.match(page("it_admin", "sso-investigation"), /Resolved \(demo\)/);
});

test("documented INC0010048 scenario runs end to end in Controlled Demo Mode", { timeout: 90000 }, async () => {
  const { run, page } = loadPage();
  const id = "DEMO-PAY-048";
  assert.equal(run(`wbInc("${id}").servicenow_number`), "INC0010048");
  run(`PS.id = "engineer"; location.hash = "#/workbench/${id}"; wbControl("${id}", "start")`);
  const waitFor = async (expr, ms = 40000) => { const t0 = Date.now(); while (!run(expr)) { if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${expr}`); await new Promise((r) => setTimeout(r, 100)); } };
  await waitFor(`WB.runs["${id}"].status === "waiting" && WB.runs["${id}"].gate.type === "rca"`);
  assert.match(run(`wbOut(WB.runs["${id}"], "rca").root_cause`), /cold start/i);
  run(`wbDecide("${id}", "rca", "approve", "")`);
  await waitFor(`WB.runs["${id}"].status === "waiting" && WB.runs["${id}"].gate.type === "sop"`);
  run(`wbDecide("${id}", "sop", "approve", "")`);
  await waitFor(`WB.runs["${id}"].status === "completed"`);
  assert.equal(run(`WB.runs["${id}"].snResult.written`), false, "demo mode never writes to ServiceNow");
  for (const tab of ["timeline", "notes"]) { run(`UI.wbTab = "${tab}"`); assert.doesNotThrow(() => page("engineer", `workbench/${id}`)); }
  assert.match(page("engineer", `agent-execution/${id}`), /Verification/);
  assert.match(page("engineer", "observability"), /DEMO-PAY-048|PAY-048/);
});
