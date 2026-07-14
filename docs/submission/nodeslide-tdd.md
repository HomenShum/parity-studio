# NodeSlide Technical Design Document

- **Canonical schema:** `nodeslide.slidelang/v1`
- **Toolchain marker:** `local-slidelang-adapter/1.1.0`
- **Runtime:** React/TypeScript/Vite, Convex, pi-ai, PptxGenJS, JSZip, assistant-ui observability primitives

## Architecture and source of truth

NodeSlide is a domain inside the existing Parity Studio application. React owns interaction and local preview state; Convex owns deck records, access checks, durable agent jobs, candidates, validation receipts, versions, and publications. One canonical DeckSpec feeds every renderer and export path.

```text
prompt + files + consented web evidence
                  |
         bounded planner through pi-ai
                  |
       nodeslide.slidelang/v1 DeckSpec
                  |
   React editor <-> typed PatchOperation[] <-> Convex authority
                         |                    |
                    candidate             CAS + digest +
                    comparison            validation gate
                         |                    |
                    human Accept --------> new version
                  |
       present / share / JSON / HTML / PPTX
```

This is NodeSlide's own SlideLang-compatible intermediate representation, not AI Fund's proprietary Slidelang runtime.

## Schema, compiler, and rendering

The shared TypeScript contract and Convex validators define:

- a deck with title, brief, theme, schema/toolchain versions, ordered slide IDs, status, and version;
- slides with stable IDs, order, background, private speaker notes, element order, and version;
- elements with normalized `0..1` geometry, z-order, visibility/lock/group state, style, content, source IDs, export capabilities, and element version;
- native `text`, `shape`, `connector`, `image`, `chart`, `math`, and `video` payloads;
- sources, comments, patches, candidate receipts, versions, publications, runs, messages, spans, events, and deck-scoped memories.

The brief compiler creates a complete bounded snapshot and validates it before persistence. Browser and HTML rendering preserve semantic element IDs and source IDs. Charts retain labels and numeric series; math retains expression, syntax, display mode, variables, and optional source; images retain URL/placeholder, alt text, credit, and provenance. The browser editor, presenter, publisher, JSON surface, HTML compiler, PowerPoint compiler, and PowerPoint importer all operate on this contract.

## Agent planning and provider routing

The browser exposes a catalog of named routes and only the reasoning-effort values supported by each route. The recommended default is Nebius-hosted GLM-5.2; OpenRouter routes are also available. The backend calls the maintained `@earendil-works/pi-ai` package through provider adapters and records the resolved provider, model, effort, tokens, cost, latency, retries, and fallback state.

External planning requires an exact per-request consent token. A provider request has a 30-second deadline, a bounded 200 KB response, no library retries, and at most one explicit JSON-repair call. The planner constrains IDs, scope, operation kind, geometry, locks, and an eight-operation cap. Invalid output or provider failure becomes an attributed deterministic fallback when a safe deterministic edit can be inferred; otherwise the run fails without a deck mutation.

BYOK is local-first rather than hosted key custody. The Connections UI stores values only in browser-session storage to build a Claude Code/Cursor `.mcp.json` or Codex `config.toml` snippet. Provider calls execute in the user's local MCP process through pi-ai, including optional OpenAI-compatible endpoints. Keys are not uploaded to Convex or returned in traces. MCP tools read decks/versions/traces, export the canonical spec, upload sources, perform consented web search, create decks, and create/accept/reject proposals. Server-side authority, validation, source checks, and version clocks are unchanged for MCP callers.

## Evidence, provenance, and memory

Uploaded files and consented web results become bounded `SourceRecord` entries. For evidence-grounded runs, factual `replace_text` and `update_chart` operations must bind exact source IDs from the authorized read context. Persistence rechecks ownership and records per-element claim digests; legacy traces are marked `legacy_unavailable` rather than receiving invented lineage.

Deck memory is owner-only, bounded, editable, archivable, and opt-in per run. Ordinary memories require deterministic lexical relevance; explicit standing instructions are labeled and handled separately. Memory never enters a public snapshot. When memory is used with an external model, the user consents to that request; trace records memory IDs and content digests, not the memory text.

## Mutation, concurrency, and long-running work

Direct edits, JSON edits, imported slides, repairs, agent edits, and MCP edits converge on typed `PatchOperation[]`. A proposal includes base deck, slide, and element versions plus read/write scope. The server reconstructs the candidate, applies the shared patch semantics, checks locks and source authorization, validates the resulting snapshot, computes the candidate digest, and persists an unapplied receipt. Accept repeats the checks transactionally and creates a new canonical version; stale or mismatched work is marked stale.

Agent requests use deck-scoped idempotency keys. Durable runs persist status, checkpoint, lease, attempt count, trace ID, messages, spans, and events. Duplicate requests return the same run; eligible failures can retry from the durable request boundary. Cancellation and expired leases fail closed before deck mutation. This is durable orchestration, not arbitrary code execution or arbitrary mid-step resume.

## Validation and repair

Shared validation checks schema/references, element order, normalized bounds, minimum size, text fit and readability, collisions, required chart/math/media data, safe asset URLs, source coverage, active brand/signature rules, and target export capability. Issues carry severity and slide/element anchors. Repairs remain candidates and use the same acceptance path. Present and publish require a current publish-ready receipt; HTML/PPTX export additionally requires cleanup readiness, while canonical JSON remains downloadable for inspection and recovery.

## Interoperability and delivery

- **JSON:** the inspector exposes bounded element JSON plus full canonical copy/download. Supported JSON edits are converted into typed operations, validated, shown in Compare, and left unapplied until Accept. Unsupported fields are rejected explicitly.
- **PowerPoint:** a bounded OOXML/JSZip importer parses supported slides, text, shapes, connectors, images, charts, backgrounds, and notes into a validated candidate. It reports every native, approximated, or dropped feature; macros and animations are not executed. The candidate still requires review and acceptance. PptxGenJS export keeps supported text, shape, image, chart, connector, and formula-source objects editable; unsupported target behavior is disclosed through capability warnings or labeled placeholders.
- **Google Slides:** the repository includes per-deck OAuth with `drive.file`, encrypted server-side credentials, normalization, guarded three-way planning, revision-bound `batchUpdate`, conflict detection, and an injectable REST adapter. The current UI intentionally stops at authorization and planning: there is no shipped end-user push/pull action, so no live synchronization claim is made.
- **Publish/present:** publishing stores an immutable, versioned snapshot under a revocable share slug. Public payloads omit owner capabilities, speaker notes, memory, comments, traces, and non-public source metadata. Presenter mode reads that sanitized snapshot.

## Observability and deployment

Each agent run has W3C-shaped trace/span IDs, timestamped hierarchical spans and events, provider usage, source IDs, memory counts, checkpoints, and human decisions. The inspector uses `@assistant-ui/react-o11y` primitives for a compact activity view and a searchable, collapsible, virtualized waterfall with source evidence. Completed spans can be emitted as an OTLP-compatible trace payload when an endpoint is configured; export status and failures are persisted.

Vercel serves the frontend and Convex serves authority/state. Release checks validate the intended public or private-preview admission mode, runtime endpoint alignment, OAuth variable names, built source, tests, and browser smoke coverage. Preview mutation tests require an aligned preview Convex deployment. Production backend deployment and Vercel promotion are coordinated in one protected cutover job, but the two platforms are not a truly atomic transaction; backend changes therefore remain backward-compatible and failed cutovers follow the documented recovery path.

## Verification, reuse, and known limits

Vitest covers schema/patch semantics, provider contracts and fallback, source lineage, memory relevance, candidate admission, idempotency, privacy, PPTX/JSON/Google adapters, telemetry, and deletion safety. Playwright covers fresh landing and hosted workflow gates; TypeScript, Biome, production build, runtime-source checks, and release-manifest validation are release gates. Final test totals and live smoke results will be inserted only after the release candidate is verified.

I reused the Parity Studio React/Vite/Convex shell, deployment plumbing, design tokens, and editor lineage, and adapted orchestration patterns from my NodeRoom/NodeAgent work. I personally built the NodeSlide domain: its schema/storage, compiler/renderers, governed planning and patch protocol, evidence/memory/trace surfaces, validation, editor workflows, interoperability paths, publishing boundary, and challenge-specific tests. Third-party libraries are disclosed in `package.json`; no claim is made that the challenge's proprietary Slidelang code was reused.
