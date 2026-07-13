# NodeSlide — Technical Design Document

**Schema:** `nodeslide.slidelang/v1`

**Toolchain:** `local-slidelang-adapter/1.1.0`

**Runtime:** React + TypeScript + Vite, Convex, PptxGenJS, pi-ai (managed Nebius / OpenRouter / BYOK), Linkup web research, governed MCP access

## Architecture

NodeSlide is a domain inside the existing Parity Studio application. Convex is the authoritative state and job layer; the React editor is an optimistic projection that always reconciles with server receipts. A single canonical deck snapshot feeds the browser renderer, validation pipeline, present mode, immutable publisher, HTML compiler, and PowerPoint compiler.

```text
prompt / JSON brief
        ↓
bounded planner → nodeslide.slidelang/v1 snapshot
        ↓
Convex canonical state + version clocks
        ↓
browser editor ── proposed patch ── server validation/digest gate
        ↓                              ↓
present / publish / HTML / PPTX   accept or reject by human
```

This is NodeSlide’s own compact SlideLang-compatible intermediate representation, not the upstream `sl0` runtime. An earlier hosted `sl0` adapter remains prior-art/prototyping context; the live product uses `nodeslide.slidelang/v1` consistently end to end.

## Canonical schema and storage

The shared TypeScript contract defines the wire shape and is mirrored by Convex validators and normalized tables.

- **Deck:** ID, title, brief, theme, schema/toolchain versions, status, dimensions, version and timestamps.
- **Slide:** stable ID, deck ID, order, title, private speaker `notes`, background, element order, source IDs, and version clocks.
- **Element:** stable ID, deck/slide IDs, kind, role, normalized bounding box, z-order, lock state, style, content, source IDs, tags, export capabilities, and element version.
- **Kinds:** `text`, `shape`, `image`, `chart`, `math`, `video`, and `connector`.
- **Chart:** chart type, categories, named series, values, labels, legend, and source ID.
- **Math:** machine-readable expression, presentation display, typed variables (`label`, `value`, optional `unit`), optional source ID, `plain` or `latex` syntax, inline/block display mode, and description.
- **Image:** optional embedded/HTTPS asset, alt text, and structured placeholder, credit, and source metadata so missing licensed media remains an honest editable object.
- **Video:** HTTPS or embedded media URL, optional poster/title/caption track, language, and bounded start/end times.
- **Review records:** comments, sources, patches, candidate validation receipts, agent traces, deck versions, exports, and publications.

Normalized geometry makes the same specification portable across browser and 16:9 PowerPoint coordinates. Additive optional math/video fields preserve existing `v1` decks while completing the challenge primitive surface. Public snapshot types intentionally omit `Slide.notes`; only explicitly public citations cross the publish boundary.

## AI planning and agent execution

Prompt generation produces a bounded JSON plan, coerces it into known primitive contracts, and validates the compiled snapshot. The deterministic path creates a complete, reproducible deck with image, chart, and math examples. The network path requires explicit external-model consent that names the exact provider, model, and reasoning effort before egress; a model selector offers private-deterministic plus named models, and creators may bring their own key (BYOK).

The edit planner uses the maintained `@earendil-works/pi-ai` package with model constant `NODESLIDE_EDIT_MODEL = 'z-ai/glm-5.2'`, routed by default through **managed Nebius** at native reasoning efforts (low / medium / high), with OpenRouter and BYOK as alternate routes. Provider, model, and effort attribution flow from the selected route into the proposal and trace. Requests have an abort deadline, a bounded response read, zero library retries, and one explicit strict-JSON repair attempt. Usage tokens and cost are recorded. Every failure mode—invalid output, timeout, network, or exception—converges on the same labeled deterministic fallback (a reviewable proposal); the exception/timeout path is caught at the provider boundary so a raw Convex server error never surfaces.

**Grounding tools.** Consented web research (Linkup) runs bounded searches and URL reads, persists source snapshots, and emits claim-level citations (`{url, retrievedAt, excerpt}`) bound to the elements they support. Data ingestion stores CSV/JSON/TXT uploads as typed source records (digest, columns, row count, size) with per-source retention and deletion, which bind to chart and formula primitives.

The orchestration follows patterns adapted from my NodeRoom/NodeAgent work: authoritative shared state, **durable jobs** (server-persisted runs with live progress, cancellation, idempotency keys, and reload recovery), **multi-turn conversations with persisted deck memory**, bounded context reads, stale-work guards, explicit human steering, and reviewable execution receipts persisted as trace journals. NodeSlide adds domain-specific tools and gates rather than exposing an unrestricted code-execution REPL to the model.

## Editor state and mutation protocol

Human edits and agent edits converge on the same patch operations. Operations include adding/removing/reordering slides and elements, replacing text or math expressions, setting element/slide properties, applying transforms, chart updates, and source changes. Each proposal declares read scope and write scope, has an operation cap, and carries expected deck/slide/element versions.

The client can preview a candidate locally, but acceptance is a server mutation. Before applying it, the server reconstructs the candidate, revalidates every operation, checks scope and capability policy, recomputes the digest, and compares version clocks. A mismatch marks the patch stale or invalid. Only a validated, digest-bound, current proposal can create a new canonical version. The browser serializes writes and discards late results tied to an older deck or request token.

## Validation and repair

Validation runs both in the browser for immediate feedback and on the server for authority. Checks cover:

- schema and referential integrity;
- bounds, minimum size, overlap, group membership, and text-fit estimates;
- required chart data, math expressions, image/video assets, and safe media URLs;
- source coverage for data-bound or quantitative claims;
- export capability and fallback disclosure;
- publication cleanliness and private/public boundary rules.

Issues include severity, code, slide/element anchors, and optional repair operations. Repairs remain proposals and pass through the same acceptance gate. Present, publish, and export are blocked when their corresponding validation receipt is not green.

## Rendering, export, and publishing

The React renderer uses editable DOM/SVG primitives. Charts are native SVG/data structures; math renders from the preserved expression; video uses an HTML `<video>` element with optional poster and media fragment. The HTML compiler emits a self-contained presentable document with semantic math and video markup.

The PowerPoint compiler uses PptxGenJS. Text, shapes, charts, images, connectors, and math-expression text remain editable PowerPoint objects. Math preserves LaTeX/plain source but does not claim to create an Office equation object. Video exports as an explicit linked-media placeholder because the current compiler does not embed a native PowerPoint video. Capability flags and validation warnings expose those target differences.

Publishing creates an immutable versioned snapshot plus a share slug. Republishing supersedes the previous active publication; revocation disables the link. The public query returns the sanitized published type, without owner key, private speaker notes, internal comments, traces, or non-public source metadata.

## Hosted API, CLI, and extension seams

Convex queries, mutations, and actions provide deck creation, workspace reads, patch planning/acceptance, validation, versioning, export receipts, and publication. The schema and compiler are shared TypeScript modules, so a CLI or editor plugin can submit the same deck spec and patches without reimplementing the format. Today's hosted browser workflow is complete, and the CLI/plugin seam is now realized as **governed MCP access**: a coding agent (Claude Code, Codex, Cursor) can drive NodeSlide through tools that mirror the same governed Convex actions—so every MCP write inherits the UI's consent, write-scope, proposal-before-mutate, and receipt gates. Governance parity is the invariant: the second front door has the same locks, and the connected agent submits intent while the server owns policy. Creators may also bring their own provider key (BYOK); keys are masked and never logged, and consent still gates egress independently of key presence.

## Verification and failure handling

Vitest covers schema coercion, planner attribution, one-repair fallback (every provider failure mode converging on a reviewable deterministic proposal), acceptance gating, editor-state integrity, shadow comparison, admission policy, publishing privacy, web-research/ingestion contracts, governed-MCP consent parity, and HTML/PPTX generation—currently 74 files / 500+ tests plus an agent-operability linter (9/9). TypeScript compilation and the Vite production build are release gates. Deterministic fixtures make regression tests stable; provider calls are dependency-injected in planner tests. UI quality is independently audited by the open-source `agentic-ui-qa` protocol (the Agentic UI Bar B1–B11 for surface trust/operability and a conditional Depth tier D1–D11 for agent-product maturity), with findings tracked in an append-only ledger.

Expected failure modes are visible: model unavailability becomes a disclosed fallback; invalid candidates cannot be accepted; stale work cannot overwrite newer state; missing/unsafe media blocks readiness; unsupported export behavior becomes a labeled fallback; and public payload tests protect private fields. The Trace inspector exposes the exact provider/model, plan, tool calls, operations, validation state, digests, token/cost usage, and human decision for panel inspection.

## Reuse disclosure

I reused the Parity Studio React/Vite/Convex shell, deployment setup, design tokens, provider plumbing, and general editor patterns. I adapted orchestration patterns from my NodeRoom/NodeAgent work. Third-party libraries include React, Convex, PptxGenJS, JSZip, Lucide, Vitest, and pi-ai. I personally built the NodeSlide schema and normalized storage, compiler/renderers, prompt and edit planning, scoped patch protocol, validation/repair pipeline, browser editing workflow, exports, publishing boundary, trace receipts, tests, and challenge-specific deck experiences.
