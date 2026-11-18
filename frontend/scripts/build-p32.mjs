// Builds the Point32Health workbench page (served at /p32) from its parts.
//
//   src/p32/parts/*            page source
//   public/tachyon-logo.png    inlined as a data: URL
//   ../backend/app/p32_*.json  demo datasets, embedded at build time (the backend
//                              reads the same files, so both sides stay in step)
//
// Output: dist/p32/index.html (generated, git-ignored). `npm run dev` and
// `npm start` run this automatically; `npm run build` runs it on its own.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PARTS = path.join(ROOT, "src", "p32", "parts");
const LOGO = path.join(ROOT, "public", "tachyon-logo.png");
const BACKEND_APP = path.resolve(ROOT, process.env.AURA_BACKEND_APP_DIR ?? path.join("..", "backend", "app"));
export const OUT = path.join(ROOT, "dist", "p32", "index.html");

// Everything the build reads -- the dev server watches these and rebuilds on change.
export const WATCH = {
  dirs: [PARTS],
  files: ["p32_workbench_data.json", "p32_predictive_data.json", "p32_multisignal_data.json"].map((f) => path.join(BACKEND_APP, f)),
};

const readText = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const readJson = (p) => JSON.parse(readText(p));
const part = (name) => readText(path.join(PARTS, name));
// Compact JSON that is safe to inline inside a <script> element.
const inlineJson = (o) => JSON.stringify(o).split("</").join("<\\/");
// Literal (non-pattern) replace of every occurrence; avoids String.replace's `$` handling.
const swap = (s, token, value) => s.split(token).join(value);

export function buildP32({ quiet = false } = {}) {
  const [wbFile, piFile, msFile] = WATCH.files;
  const logo = fs.readFileSync(LOGO).toString("base64");
  const wb = readJson(wbFile);
  const pi = readJson(piFile);
  const ms = readJson(msFile);

  // The page uses the multi-signal (rules-v2) engine and its three demo-only scenarios.
  // The backend copy keeps only the five original scenarios, so its live tools are unchanged.
  pi.scenarios = [...pi.scenarios, ...ms.extra_scenarios];
  pi.config = { ...pi.config, ...ms.config };
  pi.factors = { ...pi.factors, ...ms.factors };
  const { extra_scenarios, config, factors, ...msPage } = ms;

  const fd = '<script>\n"use strict";\n' + part("3a_frontdoor.js") + "</script>\n";
  const html = [
    part("1_head.html"),
    part("2_data.js"),
    part("3_pages.js"),
    fd,
    part("4b_tower.js") + "</script>\n",
    swap(part("5a_wb_engine.js"), "__WB_DATA__", inlineJson(wb)),
    part("5c_wb_ui.js"),
    part("5e_wb_domains.js"),
    part("5f_wb_domains_ui.js"),
    swap(part("5g_pi_engine.js"), "__PI_DATA__", inlineJson(pi)),
    part("5h_pi_ui.js"),
    part("6a_persona.js"),
    swap(part("6b_ms_engine.js"), "__MS_DATA__", inlineJson(msPage)),
    part("6c_ms_ui.js"),
    part("6d_intel.js"),
    part("7a_command_center.js"),
    part("7b_sso_investigation.js"),
    part("7c_dependency_graph.js"),
    part("7d_agents_observability.js"),
    part("7e_access.js"),
    part("5d_router.js"),
  ].join("");
  const page = swap(html, "__LOGO__", "data:image/png;base64," + logo);

  // Every inline script must at least parse, or the whole page goes blank.
  const errors = [];
  [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => {
    try { new Function(m[1]); } catch (e) { errors.push(`script ${i}: ${e.message}`); }
  });
  if (errors.length) throw new Error("p32 build: inline scripts do not parse\n  " + errors.join("\n  "));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, page, "utf8");
  if (!quiet) console.log(`[p32] built ${path.relative(ROOT, OUT)} (${page.length} chars)`);
  return OUT;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { buildP32(); } catch (e) { console.error(e.message); process.exit(1); }
}
