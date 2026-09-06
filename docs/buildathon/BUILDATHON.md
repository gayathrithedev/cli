# Entire Echo

## One-sentence summary

Entire Echo is an external `entire-echo` plugin that reconstructs one checkpoint into an evidence-linked, accessible review and continuation aid.

## Problem, intended user and why it matters

The intended user is not specified more narrowly than a user who needs to understand what a checkpoint requested, implemented, left uncertain, or may affect. Echo turns checkpoint metadata, scoped transcript content, prompts, stored summary, changed files, and an associated diff into a factual review that can be continued safely.

This matters because the review remains grounded in checkpoint and code evidence, preserves provenance, and provides an accessible linear view instead of requiring users to inspect raw or unbounded transcripts.

## Selected Entire track and why Entire is essential

Selected track: Bengaluru Tech Week Buildathon, Track E1 — Checkpoint-Native Developer Experience.

Entire is essential because Echo consumes the parent CLI’s public checkpoint output and relies on Entire’s checkpoint/session model, transcript scoping, summary fields, commit linkage, plugin mechanism, and `entire graph` command. Echo is not a second checkpoint store, agent runner, or autonomous code changer.

## Architecture and main workflow

Echo is a small external plugin named `entire-echo`; it does not modify the built-in command tree.

### Original architecture, dependencies, and prior components

The original design is an external command discovered as `entire-echo` on
`PATH`, using the installed parent `entire` CLI for public checkpoint output,
local Git for commit linkage/diffs, and the local `entire graph` CLI for
bounded impact evidence. The pre-Curveball components were the deterministic
ReviewBundle/terminal renderer and accessible static HTML/CSS/JavaScript
review interface. There is no cloud processing dependency.

The initial workflow is:

1. Run `entire checkpoint explain <checkpoint-id-or-commit> --json` for machine-readable metadata.
2. Run `entire checkpoint explain <checkpoint-id-or-commit> --transcript` for the selected session’s checkpoint-scoped transcript.
3. Obtain the associated commit diff through local git when it can be resolved from the checkpoint/commit linkage.
4. Validate the metadata and retain the exact checkpoint ID, session ID, source command, and byte/line boundaries.
5. Reconstruct factual cards for the request, implementation, and continuation state.
6. Extract changed files and candidate symbols from the diff, then issue focused `entire graph impact --repo <root> --symbol <symbol> --file <file> --depth 1 --limit 10 --format json` queries.
7. Produce deterministic findings in four categories: implemented, missing/uncertain, potentially affected, and continuation.
8. Render an accessible terminal view or local web view, with optional explicit user-controlled speech.

The output also includes a versioned `--json` evidence bundle and an optional user-selected HTML/JSON export. The first demo uses the latest-session default; an explicit transcript/session selector is deferred.

## Entire Graph findings and verification

The available `entire graph` command is treated as a CLI capability, not an in-process client API. Its reported capabilities include Go call, type, and data-flow relations.

Echo should attach only returned Graph locations and relations as evidence, including the symbol, relation, file, and lines. These findings are labelled “potentially affected”; a Graph result is not treated as proof of runtime behavior. If Graph is unavailable, times out, has no result, or returns a partial result, Echo preserves warnings and either omits impact claims or downgrades them to potential.

The reconstruction and impact-analysis pass completed before the Noon Curveball
implementation edits. It established these affected paths and command
boundaries:

- `cmd/entire-echo/main.go`: local checkpoint reconstruction, deterministic
  `ReviewBundle`, terminal and JSON output, and the focused Graph invocation.
- `cmd/entire-echo/web.go` plus `cmd/entire-echo/internal/webui/assets/`: the
  optional loopback-only browser renderer and its local API.
- `cmd/entire/cli/plugin.go` and
  `docs/architecture/external-commands.md`: `entire echo` resolves the
  separately built `entire-echo` executable on `PATH`; Echo is not added to
  Cobra's built-in tree.
- `cmd/entire/cli/explain.go` and checkpoint reader paths identified in
  `initial-architecture.md`: public `checkpoint explain --json` and
  `--transcript` are the reconstruction boundary; Echo does not read storage
  directly.

The commands retained as evidence are:

```text
entire checkpoint explain <target> --json
entire checkpoint explain <target> --transcript --session-index <index>
git log --all --format=%H --fixed-strings --grep="Entire-Checkpoint: <id>"
git diff --find-renames <commit>^ <commit> --
entire graph impact --repo <root> --symbol <symbol> --file <file> --depth 1 --limit 10 --format json
```

Graph output remains static, bounded evidence only: missing, timed-out, or
partial Graph output makes the ReviewBundle context `partial` with a reason;
it is never reported as proof of runtime behavior.

## Noon Curveball: what changed and how we adapted

Echo now explicitly carries `context.status` as `complete`, `partial`,
`redacted`, or `unavailable`, with one or more reasons for every
non-complete state. The status and reasons appear in ReviewBundle JSON, the
terminal review, `/api/review`, the local browser UI, and speech-readable card
text. A missing stored transcript is `unavailable`; recognized redaction
markers are `redacted`; incomplete extraction, diff linkage, or Graph evidence
is `partial` unless a stronger missing/redacted state already applies.

The browser interface is embedded static content served only from
`127.0.0.1` by default. It has a restrictive CSP and no CDN, external API,
analytics, cloud summarizer, cloud voice, or external asset dependency. Speech
selects only browser voices where `localService === true`; it starts only from
an explicit control. Checkpoint transcript and evidence excerpts remain local
sensitive outputs: they can appear in the local terminal, localhost page, or
explicit `--json` output when available, but command-error text is reduced to
safe generic descriptions and is not sent to or reported through a new service.

## Checkpoint links and what each checkpoint proves

Pre-Noon stable state: checkpoint `01M1TNMR0MTEV9MY2HXBT7K54B` on commit
`86ae83643364024c64147176cda3478047d8b46a` provided the accessible
checkpoint-review and voice UI baseline. The assigned Noon Curveball required
an explicit local-only privacy boundary and honest incomplete-context handling.

The Curveball implementation is checkpoint
`01M1TRSZQWG883KZG05QH9VX7N` on commit
`872795db99e075f7de06314cdd82191cf604f48f`. Its metadata identifies the
privacy implementation files, including the ReviewBundle contract, loopback
server, local assets, synthetic fixture, tests, and this document.

For a future demo, each checkpoint entry should identify the exact checkpoint, session, and commit and state what its evidence proves. The evidence model requires:

- Requested: checkpoint-scoped user prompt or stored prompt.
- Implemented: diff hunk and/or checkpoint transcript action, plus changed file.
- Existing summary: the relevant `Metadata.Summary` field, labelled “stored summary”.
- Possibly affected: a Graph symbol/relation/file/line result, labelled “potential”.
- Missing/uncertain: an explicit open item, friction item, absent expected evidence item, or reviewer question; never an unsupported fact.
- Continue safely: exact identifiers, changed files, open items, evidence links, and safe read-only commands.

## Setup, run and test instructions

The architecture specifies the intended invocation but does not provide validated build, installation, or test commands.

Intended invocation:

```text
entire echo <checkpoint-id-or-commit>
```

The plugin is expected to be discovered as `entire-echo` on `PATH`. It should invoke the installed `entire` binary and `entire graph` command through the inherited `PATH`; this is listed as an assumption that has not yet been verified.

Implementation and verification commands:

```text
mise exec go@1.26 -- gofmt -w cmd/entire-echo/main.go cmd/entire-echo/main_test.go cmd/entire-echo/web.go cmd/entire-echo/web_test.go
mise exec go@1.26 -- go test ./cmd/entire-echo/...
mise exec go@1.26 -- go vet ./cmd/entire-echo/...
mise exec go@1.26 -- go build ./cmd/entire-echo
node --check cmd/entire-echo/internal/webui/assets/app.js
git diff --check
```

For a local browser smoke test, run the resulting `entire-echo --web <target>`
with a real locally available checkpoint and open only the printed
`http://127.0.0.1:<port>/` URL. The local API is `GET /api/review`; a failed
load is rendered as unavailable and the fixture button is explicitly
development-only.

### Final verification, 2026-09-06

This session verified the exact semantic diff command reported by the installed
Graph CLI:

```text
entire graph diff --base 86ae83643364024c64147176cda3478047d8b46a --head 872795db99e075f7de06314cdd82191cf604f48f --json --max-seconds 120 --repo /Users/gayathriperumal/buildathon/cli
```

It completed without a partial-result warning and reported the expected
ReviewBundle contract, local web server, browser context/speech controls,
fixture, tests, and documentation changes. The focused runtime `graph impact`
queries for the changed symbols did not produce a result before interruption;
Echo records that condition as question-confidence Graph warnings, not no-impact
findings.

The real checkpoint terminal, JSON, and loopback API review all returned
`context.status: "redacted"` with reasons for redacted transcript content,
unextractable request text, and unavailable Graph evidence. The API ran only on
`127.0.0.1`, accepted `GET /api/review`, rejected POST with `405 Allow: GET`,
and returned the restrictive CSP. Browser verification confirmed the visible
incomplete label, keyboard-operable source disclosure, local-voice-only speech
selection, text fallback, local assets, and no console errors. The bundled
development fixture was corrected and tested as a valid `partial` bundle.

## Databricks use, data sources and limitations (if applicable)

Databricks use is not specified and is not part of the proposed architecture.

Data sources are local or provided by the parent CLI: checkpoint JSON output, checkpoint-scoped transcript output, stored prompts and summary, changed files, an associated local git diff when available, and local `entire graph` results. Echo should not depend on ambient credentials; checkpoints and diffs are not sent to a cloud reviewer by default.

Limitations include transcript-format differences across agents, unavailable or partial Graph results, unavailable diff linkage, and the possibility that imported or unusual checkpoints are metadata/transcript-only. The organizer fixture was not supplied to this checkout. The degraded-context tests therefore use the clearly-labelled synthetic schema-only fixture at `cmd/entire-echo/testdata/review-bundle-missing-context.synthetic.json`; it is not organizer-provided. The documented insertion point for an official fixture is `cmd/entire-echo/testdata/organizer/`.

## Known limitations and next steps

Known limitations and unresolved decisions include:

- The organizer-provided fixture is still missing, so live organizer-data parity cannot yet be verified.
- The latest-session default is sufficient only for the first demo; multi-session comparison is deferred.
- Browser availability and local browser speech support vary by device; no local voice means text-only review.
- Voice interaction is only a stretch adapter and must have equivalent keyboard controls.
- The delivery form is terminal plus an optional loopback-only local web view.
- Whether an approved local model/runtime exists is undecided; deterministic template synthesis is the defined fallback.
- The policy for optional exports and browser history is undecided.
- Whether Graph queries should be user-visible and replayable in the output bundle is undecided.
- Accessibility testing resources are not yet identified.

The proposed next steps are to verify plugin and Graph invocation on supported development machines, choose the judging delivery form, implement the deterministic evidence model and renderers, verify diff linkage for ordinary committed checkpoints, and conduct accessibility testing before the demo.
