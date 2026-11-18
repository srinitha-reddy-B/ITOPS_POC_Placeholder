<script>
"use strict";
/* ---------------------------------------------------------------- router */
const PAGES = { "": pageDigitalFrontDoor, "my-alerts": pageMyAlerts, workbench: pageWorkbench, leadership: pageTower, predictive: pagePredictive, accuracy: pageAccuracy, approvals: pageApprovals, "asset-insights": pageAssetInsights, "hr-insights": pageHrInsights, "command-center": pageCommandCenter, "sso-investigation": pageSsoInvestigation, "dependency-graph": pageDependencyGraph, "agent-execution": pageAgentExecution, observability: pageObservability, "sign-in": pageAccess, "risk-alerts": pageManagerAlerts };
let lastRoute = null;
function render() {
  let r = route();
  if (PS_ALIAS[r.split("/")[0]]) { location.replace(`#/${PS_ALIAS[r.split("/")[0]]}`); return; }
  const base = r.split("/")[0];
  const main = document.getElementById("main");
  const keep = r === lastRoute ? main.scrollTop : 0;
  const chat = document.getElementById("chatbox");
  const chatAtBottom = !chat || chat.scrollTop + chat.clientHeight >= chat.scrollHeight - 20;
  const a = document.activeElement;
  const focus = a && a.id && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
  renderTopbar(); renderSidebar();
  // Persona access is checked on every route, so a typed URL can't open another persona's page.
  main.innerHTML = `<div class="page">${PAGES[base] && psCanRoute(base) ? ccHero(base) : ""}${!PAGES[base] ? psRestricted(base, "This page doesn't exist.") : psCanRoute(base) ? PAGES[base]() : psRestricted(base)}</div>`;
  main.scrollTop = keep;
  lastRoute = r;
  const cb = document.getElementById("chatbox");
  if (cb && chatAtBottom) cb.scrollTop = cb.scrollHeight;
  if (focus) { const el = document.getElementById(focus.id); if (el) { el.focus(); try { if (focus.s != null) el.setSelectionRange(focus.s, focus.e); } catch (e) {} } }
}
const curIncId = () => decodeURIComponent((route().split("/")[1] || ""));

const ACTIONS = {
  "wb-mode": (el) => { if (el.dataset.m === "live" && !WBL.available) return; WB.mode = el.dataset.m; wbCommit(); },
  "wb-uc": (el) => { WB.useCase = el.dataset.uc; WB.fPri = ""; WB.fStatus = ""; wbCommit(); },
  "wb-open": (el) => { location.hash = `#/workbench/${encodeURIComponent(el.dataset.id)}`; },
  "wb-sel": (el) => { UI.wbSel = el.dataset.k; render(); },
  "wb-tab": (el) => { UI.wbTab = el.dataset.t; render(); },
  "wb-ctl": (el) => { WBL.flash = null; if (el.dataset.c === "start" || el.dataset.c === "restart") { UI.wbSel = null; UI.wbDraft = {}; } wbControl(curIncId(), el.dataset.c); },
  "wb-decide": (el) => { const fb = (UI.wbDraft.fb || "").trim(); WBL.flash = null; const id = curIncId(); UI.wbDraft = {}; UI.wbSel = null; wbDecide(id, el.dataset.g, el.dataset.d, fb); },
  "wb-exec": (el) => wbExecAction(curIncId(), el.dataset.a),
  "wb-mstep": (el) => wbExecAction(curIncId(), "mstep", +el.dataset.i),
  "wb-gate": (el) => { const txt = (UI.wbDraft.info || "").trim(); WBL.flash = null; if (el.dataset.a === "info") UI.wbDraft.info = ""; wbGateAction(curIncId(), el.dataset.a, txt); },
  "fd2-uc": (el) => { UI.fd.uc = el.dataset.uc; UI.fd.service = ""; render(); },
  "fd2-example": wbFdExample,
  "fd2-ex": (el) => wbFdLoadExample(el.dataset.k),
  "fd2-area": (el) => { UI.fd.area = el.dataset.a; UI.fd.err = ""; render(); },
  "wb-dom": (el) => { WB.domain = el.dataset.d; wbCommit(); },
  "fd2-info": (el) => { const id = el.dataset.id; const txt = ((UI.fdInfo || {})[id] || "").trim(); WBL.flash = null; if (wbWords(txt) >= 4) UI.fdInfo[id] = ""; wbGateAction(id, "info", txt); },
  "fd2-submit": wbFdSubmit,
  // Asset Management and HR pages (kept, not in the menu) still use these.
  "fd-send": (el) => fdAsk(el.dataset.q),
  "fd-opt": (el) => { const m = FD().chat.find((x) => x.id === el.dataset.m); if (m) m.answered = true; fdAsk(el.dataset.q); },
  "fd-yes": (el) => fdAnswer(el.dataset.m, true),
  "fd-no": (el) => fdAnswer(el.dataset.m, false),
  "fd-tab": (el) => { UI.fdTab = el.dataset.t; render(); },
  "fd-open": (el) => { UI.fdOpen = el.dataset.c; render(); },
  "fd-confirm": (el) => fdConfirm(el.dataset.c, el.dataset.v === "1"),
  "fd-retry": (el) => fdRetryStep(el.dataset.c, el.dataset.s),
  "fd-manual": (el) => fdManualStep(el.dataset.c, el.dataset.s),
  "fd-mdone": (el) => fdDoneStep(el.dataset.c, el.dataset.s),
  "fd-act-retry": (el) => fdActRetry(el.dataset.a),
  "fd-act-manual": (el) => fdActManual(el.dataset.a),
  "fd-act-done": (el) => fdActDone(el.dataset.a),
  "fd-adv-asset": (el) => fdAdvance("assetReqs", el.dataset.r, ["Submitted", "Approved", "Ready for pickup", "Delivered"]),
  "fd-adv-hr": (el) => fdAdvance("hrReqs", el.dataset.r, ["Submitted", "In progress", "Completed"]),
  ...PI_ACTIONS,
  ...MS_ACTIONS,
  ...IN_ACTIONS,
  ...SSO_ACTIONS,
  ...GR_ACTIONS,
  ...AG_ACTIONS,
  ...ACC_ACTIONS,
};

document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const g = psGuard(act, el);
  if (!g.ok) { psToast(g.why); return; }
  if (ACTIONS[act]) { ACTIONS[act](el); return; }
  if (act === "reset") {
    if (!UI.resetArmed) { UI.resetArmed = true; renderTopbar(); setTimeout(() => { UI.resetArmed = false; renderTopbar(); }, 3000); return; }
    S = initialState(); S.fd = freshFd(); UI.resetArmed = false; UI.assetShown = {}; UI.busy = null; UI.fdTab = "all"; UI.fdOpen = null;
    wbResetAll(); UI.wbSel = null; UI.wbDraft = {}; UI.fd = { ...UI.fd, title: "", description: "", err: "", busy: false };
    commit(); return;
  }
  if (act === "collapse") { UI.collapsed = !UI.collapsed; renderSidebar(); return; }
  if (act === "asset") { UI.selAsset = el.dataset.id; render(); return; }
  if (act === "analyse") { runAssetAnalysis(); return; }
  if (act === "replace") { draftReplacement(); return; }
  if (act === "task") { S.hr.done[el.dataset.id] = !S.hr.done[el.dataset.id]; commit(); return; }
  if (act === "ask") { hrAsk(el.dataset.q); return; }
  if (act === "clearchat") { S.hr.chat = []; commit(); return; }
  if (act === "decide") { const a = S.approvals.find((x) => x.id === el.dataset.id); if (a) a.status = el.dataset.d; commit(); return; }
});
function wbSyncButtons() {
  const fb = (UI.wbDraft.fb || "").trim().length >= 10;
  document.querySelectorAll('[data-act="wb-decide"]').forEach((b) => {
    if (b.dataset.d !== "approve") b.disabled = !fb;
    else b.disabled = b.dataset.g === "rca" ? !(UI.wbDraft.ackRoot && (!document.getElementById("wb-ack-warn") || UI.wbDraft.ackWarn)) : !UI.wbDraft.ackSop;
  });
  const s = document.querySelector('[data-act="fd2-submit"]');
  if (s) s.disabled = UI.fd.busy || !!wbFdMissing();
  const h = document.getElementById("fd2-hint");
  if (h) { const m = wbFdMissing(); h.textContent = m; h.style.display = m && !UI.fd.busy ? "" : "none"; }
}
document.addEventListener("input", (ev) => {
  const id = ev.target.id;
  if (id === "chatinput") UI.chatDraft = ev.target.value;
  else if (id === "assetSearch") { UI.assetQuery = ev.target.value; render(); }
  else if (id === "fd-input") UI.fdDraft = ev.target.value;
  else if (id === "wb-fb") { UI.wbDraft.fb = ev.target.value; wbSyncButtons(); }
  else if (id === "wb-info") UI.wbDraft.info = ev.target.value;
  else if (id === "fd2-title") { UI.fd.title = ev.target.value; wbSyncButtons(); }
  else if (id === "fd2-desc") { UI.fd.description = ev.target.value; wbSyncButtons(); }
  else if (id === "fd2-asset") UI.fd.assetTag = ev.target.value;
  else if (id && id.startsWith("fd2-info-")) { UI.fdInfo = UI.fdInfo || {}; UI.fdInfo[id.slice(9)] = ev.target.value; }
  else if (id && id.startsWith("pi-")) piInput(ev.target);
  else if (id && id.startsWith("ms-wi-")) { if (psCan("ms.whatif")) msInput(ev.target); }
});
document.addEventListener("change", (ev) => {
  const t = ev.target; const id = t.id;
  if (id === "wb-fpri") { WB.fPri = t.value; wbCommit(); }
  else if (id === "wb-fstatus") { WB.fStatus = t.value; wbCommit(); }
  else if (id === "fd2-service") { UI.fd.service = t.value; }
  else if (id === "fd2-impact") { UI.fd.impact = t.value; }
  else if (id === "fd2-urg") { UI.fd.urgency = t.value; }
  else if (id === "wb-ack-root") { UI.wbDraft.ackRoot = t.checked; wbSyncButtons(); }
  else if (id === "wb-ack-warn") { UI.wbDraft.ackWarn = t.checked; wbSyncButtons(); }
  else if (id === "wb-ack-sop") { UI.wbDraft.ackSop = t.checked; wbSyncButtons(); }
  else if (id === "ps-persona") psSet(t.value);
  else if (id === "ps-empdept") { PS.empDept = t.value; psSave(); render(); }
  else if (id === "ms-mappred") { UI.ms.mapPred = t.value; render(); }
  else if (id === "ms-assoc-sel") { UI.ms.assoc = t.value; render(); }
  else if (id === "pi-dis-kind") { UI.ms.disKind = t.value; }
  else if (id && id.startsWith("ms-wi-")) render();
  else if (id && id.startsWith("x-")) xChange(t);
});
document.addEventListener("submit", (ev) => {
  if (ev.target.id === "chatform") { ev.preventDefault(); hrAsk(UI.chatDraft); }
  if (ev.target.id === "fd-form") { ev.preventDefault(); fdAsk(UI.fdDraft); }
});
window.addEventListener("hashchange", () => { WBL.flash = null; render(); });
render();
wbCheckLive();
</script>
</body>
</html>
