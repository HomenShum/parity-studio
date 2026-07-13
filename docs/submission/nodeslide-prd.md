# NodeSlide — Product Requirements Document

**Build challenge:** Slidelang

**Prototype:** [parity-studio.vercel.app/?domain=nodeslide](https://parity-studio.vercel.app/?domain=nodeslide)

**Product thesis:** A presentation should be a trustworthy, editable program—not an opaque image returned by a prompt.

## Problem and user

Creating a credible deck still involves a costly loop: research, outline, layout, review, correction, export, and presentation. Prompt-to-image slide tools shorten the first draft but usually discard the structure that professionals need afterward. Numbers cannot be inspected, charts cannot be rebound to data, layout defects are hard to repair, and every revision becomes another generation request.

NodeSlide is for founders, analysts, operators, researchers, and technical teams who create recurring decks and need both AI speed and human control. The initial wedge is repeatable, evidence-heavy work—market updates, operating reviews, technical explainers, and data narratives—where provenance and safe revision matter more than a one-off visual.

## Core workflow

1. A creator enters a prompt or structured brief, audience, tone, and goals.
2. NodeSlide plans and compiles a multi-slide `nodeslide.slidelang/v1` deck specification.
3. The browser editor renders native structured elements: text, shape, image, chart, math, video, and connector primitives. Speaker notes live on the slide as the private `notes` field.
4. The creator directly edits copy and styling or asks the agent for a scoped change.
5. Agent changes arrive as proposals. NodeSlide shows the exact operations, model attribution, cost and token usage, candidate digest, validation receipt, and human decision boundary.
6. The creator previews, accepts, or rejects. The canonical deck is unchanged until acceptance.
7. Validation gates presentation, publishing, and export. A successful deck can be presented in the app, published as an immutable share version, or exported to HTML and PowerPoint.

The product supports a deterministic generation path for reliable demos and an explicitly consented OpenRouter path using `z-ai/glm-5.2` through the pi-ai orchestration library. If the model times out, is unavailable, or produces invalid JSON after one repair attempt, NodeSlide returns a labeled deterministic fallback—not a fabricated AI success.

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

The Trace inspector has three densities:

- **Human:** a chain-of-custody receipt from context read through human decision;
- **Pro:** plan, tools, guardrails, operations, tokens, cost, and validation status;
- **Tech:** model/provider, digests, toolchain version, shadow controls, and raw trace/patch JSON.

Published snapshots are immutable and omit speaker notes. Owner credentials and private source metadata are not included in public payloads.

## Launch requirements

- A new user can generate a coherent multi-slide deck from a prompt without setup.
- The generated deck includes editable text plus chart, math, and image primitives; video is supported when supplied.
- Direct browser edits and agent proposals update the same canonical schema.
- Invalid or stale proposals cannot mutate the deck.
- Validation blocks unsafe present, publish, or export actions.
- Public links open without owner credentials and do not expose private notes.
- HTML and PowerPoint exports preserve editable structure where the target supports it and label fallbacks where it does not.
- The core workflow is usable on the hosted deployment and demonstrated end to end.

## Success metrics

For the challenge prototype, success means: 95% of seeded prompt runs produce a schema-valid deck; 100% of agent mutations remain gated until acceptance; 100% of stale or digest-mismatched candidates are rejected; no speaker notes appear in public snapshots; and the core prompt → edit → validate → publish/present flow completes without manual database intervention.

For an early product cohort, measure time to first publishable deck, proposal acceptance rate, validation issues per slide, successful repair rate, export success, repeat decks per creator, and the percentage of revisions completed as scoped edits instead of full regeneration. The north-star metric is **validated, human-approved decks published per active team**.

## Product wedge and expansion

NodeSlide starts with recurring analytical and technical decks because their structure, data, and evidence make the value of deck-as-code obvious. The same compiler can expand into reusable team templates, scheduled data refresh, CLI and plugin authoring, collaborative approval workflows, organization design systems, and agent-to-agent deck production. The durable asset is not a generated picture; it is an inspectable presentation program that humans and agents can safely evolve together.
