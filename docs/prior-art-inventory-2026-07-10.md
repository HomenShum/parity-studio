# Prior Art Inventory — Homen Shum / CafeCorner LLC

Date: 2026-07-10. Purpose: dated inventory of pre-existing intellectual property created by Homen Shum before any engagement, consulting agreement, or Build Challenge with AI Fund L.P. or any entity formed around the "SlideLang" / "Slide AI" thesis. Intended use: attach as an exhibit to any consulting or IP assignment agreement so this work is expressly excluded from assignment.

NOT LEGAL ADVICE. Have an attorney review the carve-out language and the counterparty agreement before signing.

## A. Deck-as-code / NodeSlide (this repository)

1. **NodeSlide domain** — living-deck system where structured deck/slide/element records are the canonical source of truth and HTML/SVG/PPTX are derived render targets.
   - Canonical data model: `shared/nodeslide.ts` (Deck → Slide → SlideElement, stable public IDs, normalized bounding boxes, per-record version clocks, `schemaVersion: nodeslide.slidelang/v1`)
   - Patch/edit system: `shared/nodeslidePatch.ts` (11 operation types, scope × operation-mode gating, locked-element rejection)
   - CAS / conflict resolution: `convex/lib/nodeslidePatches.ts` (clean commit / rebase / stale-proposal outcomes)
   - Deterministic validation: `convex/lib/nodeslideValidation.ts` (three-flag receipts, typed issue codes: schema, overflow, collision, contrast, font_size, source, export)
   - Agent endpoint: `convex/nodeslideAgent.ts` (`createDeckFromBrief`, `proposeEdit` with 8-op cap, review-before-accept, trace records)
   - Render adapters: `src/domains/nodeslide/slidelang/` (semantic HTML with stable element IDs; PPTX via PptxGenJS with per-element export-capability labels)
   - Studio UI: `src/domains/nodeslide/NodeSlideStudio.tsx` (navigator / canvas / inspector, presenter view, comments, versions)
   - File-based project format: `slidelang-projects/nodeslide-golden/` (manifest, theme, per-slide `.sl.json`, brief)
   - Proof artifacts: `scripts/nodeslide-proof.mjs`, `docs/dogfood/nodeslide-domain-v1/` (receipts incl. hosted revision `rev_20260710121016833_6082525f93`, dated 2026-07-10)
   - Design/plan record: `docs/plans/2026-07-10-nodeslide-domain.md`
2. **Parity Studio** — image/prompt/route/ZIP → verified componentized UI-kit pipeline with a 16-row deterministic self-judging rubric; repository history of 89 commits at HEAD `8548bf5`.
3. **parity-studio-mcp** — published npm package; stdio MCP server exposing 19 tools (design workflow catalog, QA dogfood relay, Figma import/export). npm publish timestamps are independent third-party evidence.

## B. Related public and private work

4. **harness4visuals-etl-followup** — public GitHub repository (github.com/HomenShum/harness4visuals-etl-followup): agent-harness learning layer transforming multi-turn creative session history into provenance-backed taste memory and SLM training JSONL, with schema/provenance/F1/hallucination evaluators. Directly relevant prior art for any per-tenant preference-learning or agent-trace-feedback feature in a slide product.
5. **NodeBench** — entity-context layer for agent-native businesses (separate project, pre-existing).
6. **retention.sh** — always-on workflow judge for AI coding agents (separate project, pre-existing).

## C. Evidence anchors

- Git history of this repository (local + remote), HEAD `8548bf5` on branch `feature/nodeslide-domain`.
- ACTION REQUIRED: the NodeSlide domain files are currently uncommitted working-tree changes. Commit them to timestamp the work BEFORE signing anything or submitting Build Challenge deliverables.
- npm registry publish dates for `parity-studio-mcp`.
- GitHub push history for `harness4visuals-etl-followup`.
- Dogfood receipts under `docs/dogfood/nodeslide-domain-v1/` carry embedded 2026-07-10 revision IDs.

## D. Carve-out language (starting point for counsel)

"Consultant's pre-existing works, including without limitation the software, schemas, data models, validation systems, patch/versioning systems, rendering adapters, agent-trace and preference-learning pipelines, and documentation identified in Exhibit __ (Prior Art Inventory dated 2026-07-10), and all derivatives thereof created outside the Services, are and remain Consultant's sole property and are expressly excluded from any assignment under this Agreement. To the extent any Deliverable incorporates any Prior Art, Consultant grants Company a non-exclusive license to such incorporated Prior Art solely as embedded in the Deliverables."

## E. Hygiene rules during the engagement

1. Build Challenge deliverables go in a fresh repository. Do not copy files from this repo; re-implement or license consciously.
2. Keep a dated work log separating residency work from personal-project work.
3. No parity-studio/NodeBench/retention.sh commits from AI Fund hardware or accounts, and vice versa.
