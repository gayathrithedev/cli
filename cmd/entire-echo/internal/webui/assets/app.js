(() => {
  "use strict";

  const sections = [
    ["Requested", "requested"],
    ["Implemented", "implemented"],
    ["Missing or uncertain", "missing_or_uncertain"],
    ["Potentially affected", "potentially_affected"]
  ];
  const $ = (id) => document.getElementById(id);
  const state = { bundle: null, cards: [], active: 0, rate: 1, speaking: false, paused: false, supported: "speechSynthesis" in window && "SpeechSynthesisUtterance" in window };

  function element(name, text, className) {
    const node = document.createElement(name);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(label, onClick, className) {
    const node = element("button", label, className);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }
  function setStatus(message) { $("short-status").textContent = message; }
  function evidenceMap() { return new Map((state.bundle.evidence || []).map((item) => [item.id, item])); }

  function validateBundle(bundle) {
    if (!bundle || typeof bundle !== "object") throw new Error("Review data is not an object.");
    if (bundle.schema_version !== "entire-echo.review-bundle/v1") throw new Error("Review data has an unsupported or missing schema version.");
    if (!bundle.target || !bundle.target.checkpoint_id || !bundle.target.session_id) throw new Error("Review data is missing checkpoint or session identifiers.");
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

  function sourceControl(ids) {
    const label = ids.length === 1 ? `Show source ${ids[0]}` : `Show sources ${ids.join(", ")}`;
    return button(label, () => {
      ids.forEach((id) => {
        const detail = $("evidence-" + id);
        if (detail) detail.open = true;
      });
      setStatus(`Opened source details for ${ids.join(", ")}.`);
    }, "source-control");
  }
  function claimList(claims, emptyText) {
    if (!claims.length) return element("p", emptyText, "empty-note");
    const list = element("ul", undefined, "claim-list");
    claims.forEach((claim) => {
      const item = element("li");
      item.append(element("span", claim.text));
      item.append(element("span", ` (${claim.confidence || "unlabelled"})`, "claim-meta"));
      item.append(sourceControl(claim.evidence_ids));
      list.append(item);
    });
    return list;
  }
  function renderTarget(target) {
    const node = $("target"); node.replaceChildren();
    [["Checkpoint", target.checkpoint_id], ["Session", target.session_id], ["Commit", target.commit || "Unavailable"]].forEach(([name, value]) => {
      node.append(element("dt", name), element("dd", value));
    });
  }
  function activeCard() { return state.cards[state.active]; }
  function updateActiveCard(announce) {
    state.cards.forEach((card, index) => card.article.dataset.active = String(index === state.active));
    const card = activeCard();
    $("active-card").textContent = card ? `Active card: ${state.active + 1} of ${state.cards.length}, ${card.title}.` : "No card is active.";
    updateSpeechPreview();
    if (announce && card) setStatus(`Card ${state.active + 1}: ${card.title}.`);
  }
  function setActive(index, announce) {
    if (!state.cards.length) return;
    state.active = Math.max(0, Math.min(index, state.cards.length - 1));
    updateActiveCard(announce);
  }
  function renderCards(bundle) {
    const list = $("cards"); list.replaceChildren(); state.cards = [];
    sections.forEach(([title, key]) => {
      const claims = Array.isArray(bundle[key]) ? bundle[key] : [];
      const article = element("article", undefined, "review-card");
      const header = element("header");
      header.append(element("h3", title));
      header.append(button("Make current card", () => setActive(state.cards.findIndex((card) => card.article === article), true)));
      article.append(header);
      const empty = key === "potentially_affected"
        ? "No potential impact claim was established from the available evidence. This does not mean there is no impact."
        : "No claim was established from the available evidence.";
      article.append(claimList(claims, empty));
      list.append(article);
      state.cards.push({ title, claims, article });
    });
    setActive(0, false);
  }
  function renderEvidence(bundle) {
    const box = $("evidence"); box.replaceChildren();
    if (!bundle.evidence.length) { box.append(element("p", "Evidence is unavailable in this review data.", "empty-note")); return; }
    bundle.evidence.forEach((evidence) => {
      const detail = element("details"); detail.id = "evidence-" + evidence.id;
      detail.append(element("summary", `${evidence.id}: ${evidence.kind || "unlabelled evidence"}`));
      const list = element("dl", "", "target detailed-only");
      [["Locator", evidence.locator || "Unavailable"], ["Confidence", evidence.confidence || "Unavailable"], ["Command", Array.isArray(evidence.command) ? evidence.command.join(" ") : "Unavailable"]].forEach(([name, value]) => list.append(element("dt", name), element("dd", value)));
      detail.append(list);
      detail.append(element("p", "Excerpt", "detailed-only"));
      detail.append(element("pre", evidence.excerpt || "No excerpt was available.", "detailed-only"));
      box.append(detail);
    });
  }
  function renderWarnings(bundle) {
    const box = $("warnings"); box.replaceChildren();
    const warnings = Array.isArray(bundle.warnings) ? bundle.warnings : [];
    if (!warnings.length) { box.append(element("p", "No warnings were supplied with this review.", "empty-note")); return; }
    warnings.forEach((warning) => {
      const note = element("div", undefined, "warning");
      note.append(element("p", warning.text));
      note.append(sourceControl(warning.evidence_ids));
      box.append(note);
    });
  }
  function renderBundle(bundle, source) {
    validateBundle(bundle);
    state.bundle = bundle;
    $("load-state").textContent = source === "fixture" ? "Showing the included development fixture." : "Showing review data from /api/review.";
    renderTarget(bundle.target);
    const overview = $("overview"); overview.replaceChildren(element("p", bundle.overview.text), sourceControl(bundle.overview.evidence_ids));
    renderCards(bundle);
    const continuation = $("continuation"); continuation.replaceChildren(claimList(bundle.continuation || [], "No continuation claim was supplied."));
    renderEvidence(bundle); renderWarnings(bundle); updateSpeechControls();
    setStatus(source === "fixture" ? "Fixture review loaded." : "Review loaded.");
  }
  function showUnavailable(message) {
    state.bundle = null; state.cards = [];
    $("load-state").textContent = `Review data is unavailable: ${message}`;
    ["target", "overview", "cards", "continuation", "evidence", "warnings"].forEach((id) => $(id).replaceChildren());
    $("active-card").textContent = "No card is active.";
    $("warnings").append(element("p", "The text interface remains available. Select “Use included fixture” to inspect the interface with local example data.", "warning"));
    updateSpeechControls(); setStatus("Review data is unavailable.");
  }
  async function load(mode) {
    $("load-state").textContent = mode === "fixture" ? "Loading included fixture…" : "Loading review data…";
    try {
      const response = await fetch(mode === "fixture" ? "review.fixture.json" : "/api/review", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Request returned ${response.status}.`);
      renderBundle(await response.json(), mode);
    } catch (error) { showUnavailable(error instanceof Error ? error.message : "Unknown loading error."); }
  }

  function speechText(card) {
    if (!card) return "No review card is available.";
    const claims = card.claims.length ? card.claims.map((claim) => claim.text).join(" ") : "No claim was established from the available evidence.";
    return `${card.title}. ${claims}`;
  }
  function updateSpeechPreview() { $("speech-preview").textContent = `What will be spoken: ${speechText(activeCard())}`; }
  function updateSpeechControls() {
    const available = state.supported && Boolean(activeCard());
    ["read-card", "repeat", "previous-card", "next-card", "slower", "faster", "read-evidence"].forEach((id) => { $(id).disabled = !available; });
    $("pause-resume").disabled = !state.supported || !state.speaking;
    $("stop").disabled = !state.supported || !state.speaking;
    $("pause-resume").textContent = state.paused ? "Resume" : "Pause";
    $("speech-rate").textContent = `Rate: ${state.rate.toFixed(1)}×`;
    $("speech-state").textContent = state.supported ? "Speech is available. It starts only when you select a reading control." : "Speech synthesis is unavailable in this browser. The complete review remains available as text.";
    updateSpeechPreview();
  }
  function speak(text, label) {
    if (!state.supported || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = state.rate;
    utterance.onstart = () => { state.speaking = true; state.paused = false; updateSpeechControls(); setStatus(`Reading ${label}.`); };
    utterance.onend = () => { state.speaking = false; state.paused = false; updateSpeechControls(); setStatus("Reading finished."); };
    utterance.onerror = () => { state.speaking = false; state.paused = false; updateSpeechControls(); setStatus("Speech could not be played. The review is still available as text."); };
    window.speechSynthesis.speak(utterance);
  }
  function speakEvidence() {
    const card = activeCard(); if (!card) return;
    const map = evidenceMap(); const ids = [...new Set(card.claims.flatMap((claim) => claim.evidence_ids))];
    const text = ids.map((id) => { const evidence = map.get(id); return evidence ? `Source ${id}. ${evidence.kind}. ${evidence.locator}. ${evidence.excerpt || "No excerpt was available."}` : `Source ${id} is unavailable.`; }).join(" ");
    speak(text || "No evidence is linked to this card.", "evidence");
  }
  function bindControls() {
    document.querySelectorAll('input[name="density"]').forEach((input) => input.addEventListener("change", () => { document.body.dataset.density = input.value; setStatus(`${input.value} reading density selected.`); }));
    $("fixture-mode").addEventListener("click", () => load("fixture"));
    $("read-card").addEventListener("click", () => speak(speechText(activeCard()), "current card"));
    $("repeat").addEventListener("click", () => speak(speechText(activeCard()), "current card again"));
    $("previous-card").addEventListener("click", () => setActive(state.active - 1, true));
    $("next-card").addEventListener("click", () => setActive(state.active + 1, true));
    $("slower").addEventListener("click", () => { state.rate = Math.max(0.5, +(state.rate - 0.1).toFixed(1)); updateSpeechControls(); setStatus(`Speech rate ${state.rate.toFixed(1)} times.`); });
    $("faster").addEventListener("click", () => { state.rate = Math.min(2, +(state.rate + 0.1).toFixed(1)); updateSpeechControls(); setStatus(`Speech rate ${state.rate.toFixed(1)} times.`); });
    $("read-evidence").addEventListener("click", speakEvidence);
    $("pause-resume").addEventListener("click", () => { if (state.paused) { window.speechSynthesis.resume(); state.paused = false; setStatus("Speech resumed."); } else { window.speechSynthesis.pause(); state.paused = true; setStatus("Speech paused."); } updateSpeechControls(); });
    $("stop").addEventListener("click", () => { window.speechSynthesis.cancel(); state.speaking = false; state.paused = false; updateSpeechControls(); setStatus("Speech stopped."); });
  }
  window.EchoUI = { load, renderBundle, showUnavailable, state };
  bindControls(); updateSpeechControls();
  load(new URLSearchParams(window.location.search).get("mode") === "fixture" ? "fixture" : "production");
})();
