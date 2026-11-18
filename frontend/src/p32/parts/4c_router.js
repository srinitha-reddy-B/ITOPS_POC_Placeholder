/* ---------------------------------------------------------------- router */
const PAGES = { "": pageFrontDoor, "asset-management": pageAssets, "incident-management": pageIncident, "hr-services": pageHR, leadership: pageTower, "ai-control-tower": pageTower };
let lastRoute = null;
function render() {
  const r = route();
  const main = document.getElementById("main");
  const keep = r === lastRoute ? main.scrollTop : 0;
  const chat = document.getElementById("chatbox");
  const chatAtBottom = !chat || chat.scrollTop + chat.clientHeight >= chat.scrollHeight - 20;
  // Keep focus and caret in text fields across re-renders.
  const a = document.activeElement;
  const focus = a && a.id && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
  renderTopbar(); renderSidebar();
  main.innerHTML = `<div class="page">${(PAGES[r] || pageFrontDoor)()}</div>`;
  main.scrollTop = keep;
  lastRoute = r;
  const cb = document.getElementById("chatbox");
  if (cb && chatAtBottom) cb.scrollTop = cb.scrollHeight;
  if (focus) { const el = document.getElementById(focus.id); if (el) { el.focus(); try { if (focus.s != null) el.setSelectionRange(focus.s, focus.e); } catch (e) {} } }
}

const WF_ACTIONS = {
  "wf-view": (el) => wfView(+el.dataset.i),
  "wf-continue": wfContinue,
  "wf-intake": wfIntake,
  "wf-triage": wfTriage,
  "wf-collect": wfCollect,
  "wf-evrev": (el) => { W().evidence.reviewed = el.checked; commit(); },
  "wf-evconfirm": wfEvidenceConfirm,
  "wf-draft": wfDraft,
  "wf-rroot": (el) => { W().review.root = el.checked; commit(); },
  "wf-rsop": (el) => { W().review.sop = el.checked; commit(); },
  "wf-rwarn": (el) => { W().review.warnAck = el.checked; commit(); },
  "wf-approve": wfApprove,
  "wf-changes": wfChanges,
  "wf-exec": () => wfExec(false),
  "wf-retry": () => wfExec(true),
  "wf-manual": wfManual,
  "wf-mstep": (el) => wfManualStep(+el.dataset.i),
  "wf-verify": wfVerify,
  "wf-callyes": () => wfCaller(true),
  "wf-callno": () => wfCaller(false),
  "wf-resolve": wfResolve,
  "wf-tab": (el) => { UI.logTab = el.dataset.t; render(); },
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
};

document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  if (WF_ACTIONS[act]) { WF_ACTIONS[act](el); return; }
  if (act === "reset") {
    if (!UI.resetArmed) { UI.resetArmed = true; renderTopbar(); setTimeout(() => { UI.resetArmed = false; renderTopbar(); }, 3000); return; }
    S = initialState(); S.fd = freshFd(); UI.resetArmed = false; UI.assetShown = {}; UI.busy = null; UI.fdTab = "all"; UI.fdOpen = null; commit(); return;
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
document.addEventListener("input", (ev) => {
  const id = ev.target.id;
  if (id === "chatinput") UI.chatDraft = ev.target.value;
  else if (id === "assetSearch") { UI.assetQuery = ev.target.value; render(); }
  else if (id === "fd-input") UI.fdDraft = ev.target.value;
  else if (id === "wf-engnote") { W().evidence.note = ev.target.value; save(); }
  else if (id === "wf-revcomment") {
    W().review.comment = ev.target.value; save();
    const b = document.querySelector('[data-act="wf-changes"]'); if (b) b.disabled = ev.target.value.trim().length < 15 || !!UI.busy;
  } else if (id === "wf-notes") { updateClose(); }
});
document.addEventListener("change", (ev) => {
  if (ev.target.id === "wf-code") updateClose();
});
function updateClose() {
  const c = W().close;
  c.code = (document.getElementById("wf-code") || {}).value || "";
  c.notes = (document.getElementById("wf-notes") || {}).value || "";
  c.checks = closureChecks(c.notes, c.code, (S.inc.doc || draftDoc(1)).root);
  save();
  const box = document.getElementById("wf-closechecks"); if (box) box.innerHTML = checksHtml(c.checks);
  const b = document.getElementById("wf-resolvebtn"); if (b) b.disabled = !!UI.busy || hasFail(c.checks);
}
document.addEventListener("submit", (ev) => {
  if (ev.target.id === "chatform") { ev.preventDefault(); hrAsk(UI.chatDraft); }
  if (ev.target.id === "fd-form") { ev.preventDefault(); fdAsk(UI.fdDraft); }
});
window.addEventListener("hashchange", render);
render();
</script>
</body>
</html>
