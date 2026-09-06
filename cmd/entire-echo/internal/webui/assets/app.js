(() => {
  "use strict";

  const sections = [
    ["Requested", "requested", "What the stored checkpoint says the user asked for."],
    ["Implemented", "implemented", "What the available evidence shows was changed or completed."],
    ["Missing or uncertain", "missing_or_uncertain", "What could not be established from the available evidence."],
    ["Potentially affected", "potentially_affected", "Possible static impact. This is not proof of runtime behavior."]
  ];
  const $ = (id) => document.getElementById(id);
  const state = {
    bundle: null, cards: [], active: 0, rate: 1, speaking: false, paused: false,
    supported: "speechSynthesis" in window && "SpeechSynthesisUtterance" in window, voices: []
  };
  const kindNames = {
    checkpoint_metadata: "Checkpoint metadata", checkpoint_transcript: "Checkpoint transcript",
    git_diff: "Git diff", graph_impact: "Graph impact", graph_warning: "Graph limitation", warning: "Limitation"
  };

  function el(name, text, className) {
    const node = document.createElement(name);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(label, onClick, className) {
    const node = el("button", label, className);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }
  function setStatus(message) { $("short-status").textContent = message; }

  // Keep this browser-side guard aligned with the Go ReviewBundle validator.
  function validateBundle(bundle) {
    if (!bundle || typeof bundle !== "object") throw new Error("Review data is not an object.");
    if (bundle.schema_version !== "entire-echo.review-bundle/v1") throw new Error("Review data has an unsupported or missing schema version.");
    if (!bundle.target || !bundle.target.checkpoint_id || !bundle.target.session_id) throw new Error("Review data is missing checkpoint or session identifiers.");
    if (!bundle.context || !["complete", "partial", "redacted", "unavailable"].includes(bundle.context.status)) throw new Error("Review data has an invalid context completeness status.");
    if (bundle.context.status !== "complete" && (!Array.isArray(bundle.context.reasons) || bundle.context.reasons.length === 0)) throw new Error("Incomplete review data must explain why it is incomplete.");
    if (!Array.isArray(bundle.evidence)) throw new Error("Review data is missing evidence.");
    const ids = new Set(bundle.evidence.map((item) => item && item.id));
    if (ids.has(undefined) || ids.has("")) throw new Error("Review data has evidence without an ID.");
    const claims = [bundle.overview].concat(...sections.map(([, key]) => bundle[key] || []), bundle.continuation || []);
    for (const claim of claims) {
      if (!claim || typeof claim.text !== "string" || !Array.isArray(claim.evidence_ids) || claim.evidence_ids.length === 0 || claim.evidence_ids.some((id) => !ids.has(id))) throw new Error("Review data has a claim without valid evidence IDs.");
    }
    for (const warning of bundle.warnings || []) {
      if (!warning || typeof warning.text !== "string" || !Array.isArray(warning.evidence_ids) || warning.evidence_ids.length === 0 || warning.evidence_ids.some((id) => !ids.has(id))) throw new Error("Review data has a warning without valid evidence IDs.");
    }
  }
  function evidenceMap() { return new Map((state.bundle.evidence || []).map((evidence) => [evidence.id, evidence])); }
  function sourceControl(ids) {
    return button("View supporting evidence", () => {
      ids.forEach((id) => { const detail = $("evidence-" + id); if (detail) detail.open = true; });
      setStatus(`Opened supporting evidence ${ids.join(", ")}.`);
    });
  }
  function contextLabel(status) { return status[0].toUpperCase() + status.slice(1); }
  function renderContext(context) {
    const incomplete = context.status !== "complete";
    $("header-context").textContent = contextLabel(context.status);
    $("header-context").dataset.status = context.status;
    $("context-banner").hidden = !incomplete;
    if (!incomplete) return;
    $("context-title").textContent = `This review has ${context.status} context`;
    $("context-summary").textContent = "Some checkpoint information was unavailable or redacted. Findings below are limited to the evidence that could be verified.";
    const reasons = $("context-reasons");
    reasons.replaceChildren();
    (context.reasons || []).forEach((reason) => reasons.append(el("li", reason)));
  }
  function renderTarget(target) {
    const box = $("target");
    box.replaceChildren();
    [["Checkpoint", target.checkpoint_id], ["Session", target.session_id], ["Commit", target.commit || "Unavailable"]].forEach(([label, value]) => {
      const row = el("div"); const code = el("code", value); code.title = value;
      row.append(el("b", label), code); box.append(row);
    });
  }
  function findingState(claims) { return claims.length ? `${claims.length} ${claims.length === 1 ? "finding" : "findings"}` : "Unavailable"; }
  function renderNav() {
    const nav = $("review-nav"); nav.replaceChildren();
    state.cards.forEach((card, index) => {
      const control = button("", () => setActive(index, true));
      control.setAttribute("aria-current", index === state.active ? "step" : "false");
      control.append(el("span", String(index + 1), "step-number"), el("span", card.title, "step-name"), el("span", findingState(card.claims), "step-state"));
      nav.append(control);
    });
  }
  function claimList(claims, emptyText) {
    if (!claims.length) return el("p", emptyText, "empty-note");
    const list = el("ul", undefined, "claim-list");
    claims.forEach((claim) => {
      const item = el("li"); const row = el("div", undefined, "claim-row");
      row.append(el("span", claim.text), el("span", claim.confidence || "unlabelled", `claim-meta confidence-${claim.confidence || "unknown"}`));
      const actions = el("div", undefined, "claim-actions"); actions.append(sourceControl(claim.evidence_ids));
      item.append(row, actions); list.append(item);
    });
    return list;
  }
  function renderActive() {
    const card = state.cards[state.active]; if (!card) return;
    $("active-card").textContent = `Step ${state.active + 1} of ${state.cards.length}`;
    $("review-heading").textContent = card.title; $("section-explanation").textContent = card.explanation;
    $("cards").replaceChildren(claimList(card.claims, card.empty));
    $("voice-card").textContent = `Step ${state.active + 1} of ${state.cards.length} · ${card.title}`;
    const technical = $("technical-content"); technical.replaceChildren();
    const linked = [...new Set(card.claims.flatMap((claim) => claim.evidence_ids))];
    if (!linked.length) technical.append(el("p", "No technical evidence is linked to this section."));
    else linked.forEach((id) => {
      const evidence = evidenceMap().get(id); if (!evidence) return;
      technical.append(el("p", `${id} · ${kindNames[evidence.kind] || evidence.kind} · ${evidence.locator || "Unavailable"}`), el("pre", Array.isArray(evidence.command) ? evidence.command.join(" ") : "Unavailable"));
    });
    updateSpeechControls();
  }
  function setActive(index, announce) {
    if (!state.cards.length) return;
    state.active = Math.max(0, Math.min(index, state.cards.length - 1));
    renderNav(); renderActive();
    if (announce) setStatus(`Step ${state.active + 1}: ${state.cards[state.active].title}.`);
  }
  function renderEvidence(bundle) {
    const box = $("evidence"); box.replaceChildren(); $("evidence-count").textContent = `${bundle.evidence.length} sources`;
    bundle.evidence.forEach((evidence) => {
      const detail = el("details"); detail.id = "evidence-" + evidence.id;
      detail.append(el("summary", `${evidence.id} · ${kindNames[evidence.kind] || evidence.kind || "Evidence"}`));
      const metadata = el("dl", undefined, "evidence-meta");
      [["Confidence", evidence.confidence || "Unavailable"], ["Locator", evidence.locator || "Unavailable"], ["Command", Array.isArray(evidence.command) ? evidence.command.join(" ") : "Unavailable"]].forEach(([label, value]) => metadata.append(el("dt", label), el("dd", value)));
      detail.append(metadata, el("pre", evidence.excerpt || "No excerpt was available.", "evidence-excerpt")); box.append(detail);
    });
  }
  function renderBundle(bundle, source) {
    validateBundle(bundle); state.bundle = bundle;
    state.cards = sections.map(([title, key, explanation]) => ({ title, claims: Array.isArray(bundle[key]) ? bundle[key] : [], explanation, empty: key === "potentially_affected" ? "No potential impact was established. This does not mean there is no impact." : "No claim was established from the available evidence." }));
    $("load-state").textContent = source === "fixture" ? "Showing the development fixture." : "Showing review data from the local review API.";
    $("fixture-indicator").hidden = source !== "fixture"; renderContext(bundle.context); renderTarget(bundle.target);
    $("overview").replaceChildren(el("p", bundle.overview.text), sourceControl(bundle.overview.evidence_ids));
    $("continuation").replaceChildren(claimList(bundle.continuation || [], "No continuation claim was supplied."));
    renderEvidence(bundle); setActive(0, false); setStatus(source === "fixture" ? "Development fixture loaded." : "Review loaded.");
  }
  function showUnavailable(message) {
    state.bundle = null; state.cards = [];
    $("load-state").textContent = `Review data is unavailable: ${message}`;
    $("header-context").textContent = "Unavailable"; $("header-context").dataset.status = "unavailable"; $("context-banner").hidden = false;
    $("context-title").textContent = "This review is unavailable";
    $("context-summary").textContent = "The review could not be loaded. Text and recovery options remain available.";
    $("context-reasons").replaceChildren(el("li", message));
    $("cards").replaceChildren(el("p", "Use the development fixture only to inspect the local interface.", "empty-note"));
    $("review-nav").replaceChildren(button("Use development fixture", () => load("fixture")));
    updateSpeechControls(); setStatus("Review data is unavailable.");
  }
  async function load(mode) {
    $("load-state").textContent = mode === "fixture" ? "Loading development fixture…" : "Loading review data…";
    try {
      const response = await fetch(mode === "fixture" ? "review.fixture.json" : "/api/review", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Request returned ${response.status}.`);
      renderBundle(await response.json(), mode);
    } catch (error) { showUnavailable(error instanceof Error ? error.message : "Unknown loading error."); }
  }
  function speechText(card) {
    if (!card) return "No review card is available.";
    const context = state.bundle?.context;
    const qualification = context?.status !== "complete" ? `Context ${context.status}. ${(context.reasons || []).join(" ")} ` : "";
    const claims = card.claims.length ? card.claims.map((claim) => claim.text).join(" ") : card.empty;
    return `${qualification}${card.title}. ${claims}`;
  }
  function localVoices(voices) { return (voices || []).filter((voice) => voice && voice.localService === true); }
  function refreshVoices() { state.voices = localVoices(window.speechSynthesis.getVoices()); updateSpeechControls(); }
  function updateSpeechControls() {
    const card = state.cards[state.active]; const available = state.supported && Boolean(card);
    ["read-card", "repeat", "previous-card", "next-card", "slower", "faster", "read-evidence"].forEach((id) => { $(id).disabled = !available; });
    $("stop").disabled = !state.speaking; $("read-card").textContent = state.paused ? "Resume" : state.speaking ? "Pause" : "Play";
    $("speech-rate").textContent = `${state.rate.toFixed(1)}×`;
    $("speech-state").textContent = state.supported ? (state.voices.length ? "Local voice ready" : "Local voice unavailable; text remains available.") : "Local voice unavailable; text remains available.";
    $("speech-preview").textContent = `What will be spoken: ${speechText(card)}`;
  }
  function speak(text, label) {
    if (!state.supported || !text) return;
    const voice = state.voices[0];
    if (!voice) { setStatus("No local browser voice is available. Text remains available."); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text); utterance.voice = voice; utterance.rate = state.rate;
    utterance.onstart = () => { state.speaking = true; state.paused = false; updateSpeechControls(); setStatus(`Reading ${label}.`); };
    utterance.onend = utterance.onerror = () => { state.speaking = false; state.paused = false; updateSpeechControls(); setStatus("Reading finished."); };
    window.speechSynthesis.speak(utterance);
  }
  function readOrPause() {
    if (state.speaking && !state.paused) { window.speechSynthesis.pause(); state.paused = true; updateSpeechControls(); return; }
    if (state.speaking && state.paused) { window.speechSynthesis.resume(); state.paused = false; updateSpeechControls(); return; }
    speak(speechText(state.cards[state.active]), "current step");
  }
  function readEvidence() {
    const ids = [...new Set((state.cards[state.active]?.claims || []).flatMap((claim) => claim.evidence_ids))]; const evidence = evidenceMap();
    const text = ids.map((id) => { const item = evidence.get(id); return item ? `Source ${id}. ${kindNames[item.kind] || item.kind}. ${item.locator}. ${item.excerpt || ""}` : `Source ${id} is unavailable.`; }).join(" ") || "No evidence is linked to this step.";
    speak(text, "evidence");
  }
  function bind() {
    document.querySelectorAll('input[name="density"]').forEach((input) => input.addEventListener("change", () => { document.body.dataset.density = input.value; setStatus(`${input.value} reading mode selected.`); }));
    $("read-card").addEventListener("click", readOrPause);
    $("repeat").addEventListener("click", () => speak(speechText(state.cards[state.active]), "current step again"));
    $("previous-card").addEventListener("click", () => setActive(state.active - 1, true)); $("next-card").addEventListener("click", () => setActive(state.active + 1, true));
    $("stop").addEventListener("click", () => { window.speechSynthesis.cancel(); state.speaking = false; state.paused = false; updateSpeechControls(); setStatus("Speech stopped."); });
    $("read-evidence").addEventListener("click", readEvidence);
    $("slower").addEventListener("click", () => { state.rate = Math.max(0.5, +(state.rate - 0.1).toFixed(1)); updateSpeechControls(); });
    $("faster").addEventListener("click", () => { state.rate = Math.min(2, +(state.rate + 0.1).toFixed(1)); updateSpeechControls(); });
  }

  window.EchoUI = { load, renderBundle, showUnavailable, state, localVoices };
  bind(); updateSpeechControls();
  if (state.supported) { refreshVoices(); window.speechSynthesis.addEventListener("voiceschanged", refreshVoices); }
  load(new URLSearchParams(location.search).get("mode") === "fixture" ? "fixture" : "production");
})();
