# NodeSlide Product Requirements Document

- **Challenge:** Slidelang build challenge
- **Product:** NodeSlide, a domain within Parity Studio
- **Status:** Working prototype; implementation evidence is listed in [implementation-evidence.md](./implementation-evidence.md)

## Product definition

NodeSlide turns heterogeneous evidence into a sourced, editable, talk-ready presentation. Its source of truth is a structured deck specification, not a stack of generated images. A creator can inspect and change text, geometry, charts, formulas, images, sources, and speaker notes; an agent can propose changes to the same objects; and every accepted change creates a reviewable version.

The hero user is an AI startup founder preparing a roadshow. Their inputs are rarely one clean prompt: they have a product brief, customer notes, a metrics CSV, web research, a paper, and an older deck. Today they manually reconcile those sources, rebuild charts, check claims, and repeatedly repair layouts. NodeSlide should compress that work without taking final editorial control away from the founder.

## Why structured authoring wins

Prompt-to-static-slide products optimize for a fast first image. The founder's actual job continues after that image: correct a number, replace a source, restyle three slides, update a chart, preserve speaker notes, export to PowerPoint, and explain what the agent changed. A typed deck model makes those operations addressable and testable.

NodeSlide's canonical format is its own `nodeslide.slidelang/v1` DeckSpec. It is designed to be SlideLang-compatible at the workflow level - structured input, compilation, editing, validation, and multiple outputs - but it does **not** claim to use AI Fund's proprietary Slidelang implementation. The prototype preserves stable deck, slide, element, and source IDs; normalized geometry; type-specific content; export capabilities; and version clocks.

## End-to-end founder workflow

1. **Start with the job.** From the clean landing composer, the founder describes the audience and decision, selects a model, optionally enables web research, and can attach evidence before typing a prompt.
2. **Compile evidence into a deck.** NodeSlide ingests the brief and bounded attachments, records sources, plans the narrative through a selected pi-ai route or the private deterministic path, then compiles a validated DeckSpec.
3. **Review native slide objects.** The browser renders editable text, shapes, connectors, images, charts, math, and video. Data, sources, notes, comments, and versions remain inspectable.
4. **Ask for scoped changes.** The founder can target the deck, one or more slides, or selected elements. Web and external-model egress require explicit request consent. Persistent deck memory is optional and separately managed.
5. **Approve a governed proposal.** The agent returns typed operations, not a replacement image. NodeSlide shows the candidate, source bindings, model attribution, usage, validation receipt, and before/after comparison. The deck remains unchanged until Accept.
6. **Validate and deliver.** The founder resolves blocking issues, presents in the browser, publishes an immutable sanitized share, downloads canonical JSON or HTML, or imports/exports PowerPoint with an explicit fidelity report or capability warnings.

## Prototype requirements

| Area | Required behavior in the prototype |
| --- | --- |
| Intake | Accept a prompt plus bounded file evidence; support separately consented web research. |
| Structured output | Compile a multi-slide `nodeslide.slidelang/v1` snapshot with stable IDs, geometry, sources, and versions. |
| Primitives | Keep text, shape, connector, image, chart, math, and video objects editable rather than rasterizing the slide. |
| Editing | Support direct manipulation, structured JSON inspection/download, and scoped human or agent edits through the same operation vocabulary. |
| Agent governance | Propose before mutate; enforce read/write scope, locks, operation limits, source authorization, candidate digest binding, and version checks on the server. |
| Validation | Check structure, bounds, text quality, collisions, assets, source coverage, brand rules, and target export capabilities; keep repairs reviewable. |
| Interoperability | Import PowerPoint as a bounded candidate with disclosed fidelity; export editable PowerPoint where supported; expose Google OAuth and planning honestly without claiming live sync. |
| Delivery | Gate present, publish, and export on current validation; remove private notes, memory, traces, and private source metadata from public shares. |
| Operability | Persist agent runs, messages, spans, events, checkpoints, usage, cost, sources, and human decisions; provide a compact activity view and detailed waterfall. |

## Trust model

The server, not the model or browser preview, owns mutation authority. Agent output is constrained to typed operations and revalidated against the current snapshot. Factual text and chart changes based on supplied evidence must carry exact authorized source IDs; the trace stores immutable claim digests and source bindings. Stale versions, changed candidate digests, invalid layouts, unauthorized sources, or missing owner authority fail closed.

External-model, web, local-BYOK, and external-agent actions have explicit consent boundaries. Provider failures, timeouts, or invalid JSON receive one bounded repair attempt and then an attributed deterministic fallback or honest failure. A fallback is never presented as a successful model response.

## Product scope and limitations

The prototype implements the hosted editor, governed agent workflow, memory and provenance, validation, present/share, JSON/HTML export, and PowerPoint import/export. It includes an MCP server for Claude Code, Codex, Cursor, and other MCP clients; local provider keys stay in that local process. Google OAuth uses per-file `drive.file` scope, and guarded three-way planning/REST adapter code is tested, but the current product UI does not expose a Google Slides push or pull action. PowerPoint and Google features that cannot round-trip faithfully are reported rather than silently overwritten.

## Success measures

**Prototype facts, not traction claims:** the repository contains the working flows above and automated coverage for their contracts. Final deployed URLs, release-test totals, and demo results belong in the submission reply after the release candidate is verified. No customer adoption, revenue, or time-saved metric is claimed.

**Launch invariants:** every agent change remains unapplied before acceptance; stale or digest-mismatched candidates cannot mutate state; public snapshots contain no private notes or deck memory; external egress requires the correct consent; and present/publish/export use a validation receipt for the current version.

**Post-launch metrics, not yet measured:** time to first reviewable deck, time from evidence upload to publish, proposal acceptance and repair rates, source coverage for factual edits, validation issues per slide, successful import/export rate by primitive, repeat decks per creator, and validated human-approved decks published per active team. Initial design-partner use will establish baselines before numeric product targets are set.

## Wedge and expansion

The wedge is recurring evidence-heavy founder, operating, and technical decks, where editable data and provenance are more valuable than a one-off visual. The same contract can later support scheduled data refresh, reusable team templates, collaborative approvals, production Google Slides synchronization, richer PowerPoint round-tripping, organization design systems, and external agents operating through the governed MCP boundary.
