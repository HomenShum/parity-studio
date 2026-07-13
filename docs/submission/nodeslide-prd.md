# NodeSlide — Product Requirements Document

**Build challenge:** Slidelang

**Prototype:** [parity-studio.vercel.app](https://parity-studio.vercel.app/)

**Product thesis:** A presentation should be a trustworthy, editable program—not an opaque image returned by a prompt.

## Problem and user

Creating a credible deck still involves a costly loop: research, outline, layout, review, correction, export, and presentation. Prompt-to-image slide tools shorten the first draft but usually discard the structure that professionals need afterward. Numbers cannot be inspected, charts cannot be rebound to data, layout defects are hard to repair, and every revision becomes another generation request.

NodeSlide is for founders, analysts, operators, researchers, and technical teams who create recurring decks and need both AI speed and human control. The initial wedge is repeatable, evidence-heavy work—market updates, operating reviews, technical explainers, and data narratives—where provenance and safe revision matter more than a one-off visual.

## Core workflow

1. A creator lands on a clean, intent-first composer ("What presentation should we build?") and enters a prompt, structured spec, or evidence—choosing the model, effort, web-research, and any uploaded data inside the composer. The navigator, canvas, inspector, validation, and trace are revealed only after creation begins.
2. NodeSlide plans and compiles a multi-slide `nodeslide.slidelang/v1` deck specification.
3. The browser editor renders native structured elements: text, shape, image, chart, math, video, and connector primitives. Speaker notes live on the slide as the private `notes` field.
4. The creator directly edits copy and styling or asks the agent for a scoped change.
5. Agent changes arrive as proposals. NodeSlide shows the exact operations, model attribution, cost and token usage, candidate digest, validation receipt, and human decision boundary.
6. The creator previews, accepts, or rejects. The canonical deck is unchanged until acceptance.
7. Validation gates presentation, publishing, and export. A successful deck can be presented in the app, published as an immutable share version, or exported to HTML and PowerPoint.

The product supports a deterministic generation path for reliable demos and an explicitly consented external-model path. A model selector offers private-deterministic plus named models (GLM 5.2, Claude, Gemini, GPT); the recommended route is managed **Nebius GLM 5.2** through the pi-ai orchestration library at native reasoning efforts (low / medium / high), and creators may bring their own provider key (BYOK). Consent names the exact provider, model, and effort before any egress. Every failure mode—timeout, unavailability, invalid JSON after one repair attempt, or exception—converges on a labeled deterministic fallback that is still a reviewable proposal, never a fabricated AI success or a raw error.

Two capabilities ground the agent in evidence. **Consented web research** (Linkup) runs bounded searches and URL reads, persists source snapshots, and attaches citations to the claims they support. **Data ingestion** accepts CSV/JSON/TXT uploads as typed source records (digest, columns, row count, size) that bind to chart and formula primitives, with per-source retention and deletion controls. Agent runs are **durable**: long jobs persist server-side with live progress, cancellation, idempotency, and reload recovery, and multi-turn conversations carry memory across turns.

## Why structured authoring wins

The deck specification is the source of truth. Every slide and element has a stable ID, normalized geometry, type-specific data, style, sources, export capabilities, and version clocks. That enables capabilities a static slide image cannot provide:

- direct editing without regeneration;
- data-bound charts and preserved math expressions;
- source and speaker-note management;
- element- and slide-scoped AI operations;
- deterministic validation and repair suggestions;
- reviewable diffs, comments, versions, and stale-work rejection;
- multiple render targets from one canonical deck;
- immutable public publishing while private notes and internal source metadata remain private.

Math remains editable by preserving the expression and syntax. Browser video is native; PowerPoint receives a clearly labeled linked-media placeholder rather than pretending to create a native embedded video. These fallbacks are visible in capability and validation receipts.

## Trust and validation

Trust is a product surface, not a hidden backend step. NodeSlide checks schema integrity, element bounds, overlap, text fit, missing assets, source coverage, export capability, and publication readiness. Repairs are explicit proposals. Candidate operations are revalidated on the server and bound to a digest before acceptance. Scope limits, expected version clocks, and stale-candidate checks prevent a delayed agent result from overwriting newer human work.

The Trace inspector is a compact run-metrics card (run time, tokens, cost, validation) above an auditable-events chain—authorization → context → plan → actions → validation → approval—closing on a validation seal that is honestly labeled by run type (countersigned for a live run, provisional/"machine only, not signable" for a deterministic one). Three densities control depth:

- **Overview:** the chain-of-custody summary from context read through human decision, with the seal;
- **Evidence:** plan, tools, guardrails, operations, tokens, cost, and validation status;
- **Raw:** model/provider, digests, toolchain version, shadow controls, and raw trace/patch JSON.

Published snapshots are immutable and omit speaker notes. Owner credentials and private source metadata are not included in public payloads.

## Launch requirements

- A new user can generate a coherent multi-slide deck from a prompt without setup.
- The generated deck includes editable text plus chart, math, and image primitives; video is supported when supplied.
- Direct browser edits and agent proposals update the same canonical schema.
- Invalid or stale proposals cannot mutate the deck.
- Validation blocks unsafe present, publish, or export actions.
- Public links open without owner credentials and do not expose private notes.
- HTML and PowerPoint exports preserve editable structure where the target supports it and label fallbacks where it does not.
- Web claims carry a source with URL, retrieval time, and excerpt; uploaded data is deletable and its retention is disclosed.
- Long agent runs are cancellable and resume after reload without duplicating work.
- Creators can bring their own provider key (BYOK) and connect their own coding agents over a governed MCP surface that enforces the same consent, write-scope, proposal-before-mutate, and receipt gates as the UI.
- The core workflow is usable on the hosted deployment and demonstrated end to end.

## Success metrics

For the challenge prototype, success means: 95% of seeded prompt runs produce a schema-valid deck; 100% of agent mutations remain gated until acceptance; 100% of stale or digest-mismatched candidates are rejected; no speaker notes appear in public snapshots; and the core prompt → edit → validate → publish/present flow completes without manual database intervention.

For an early product cohort, measure time to first publishable deck, proposal acceptance rate, validation issues per slide, successful repair rate, export success, repeat decks per creator, and the percentage of revisions completed as scoped edits instead of full regeneration. The north-star metric is **validated, human-approved decks published per active team**.

## Product wedge and expansion

NodeSlide starts with recurring analytical and technical decks because their structure, data, and evidence make the value of deck-as-code obvious. The same compiler can expand into reusable team templates, scheduled data refresh, CLI and plugin authoring, collaborative approval workflows, organization design systems, and agent-to-agent deck production. The durable asset is not a generated picture; it is an inspectable presentation program that humans and agents can safely evolve together.
