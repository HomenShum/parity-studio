# NodeSlide Design System + UI Component Contracts — Claude Design Plan

Date: 2026-07-10. Companion to docs/plans/2026-07-10-pillars-prebuild-orchestration.md. Purpose: produce the look-and-feel direction and per-component contracts BEFORE Codex implements any UI, so design is a frozen input to the build loop, not an afterthought.

## 0. Principle: the app is themed by the system it sells

NodeSlide's pitch is signature/identity transposition via design tokens (W1). So the app chrome itself uses the exact same token format: one `SignatureProfile`-shaped tokens file drives the studio UI. Dogfooding at the foundation level — switching the app's own theme exercises the same code path a customer's uploaded deck signature does.

## D0 — Aesthetic direction (2-3 variants, never one)

Method: frontend-design skill for direction discipline, then three candidate directions, each delivered as (a) a tokens JSON and (b) one self-contained HTML specimen card (type scale, palette, spacing, surfaces, one composed component).

- **Direction A — "Instrument"** (expected winner): dark-first, glass cards, Manrope display + JetBrains Mono data, high-contrast receipts. Matches existing taste and the trust/verification brand of validation receipts.
- **Direction B — "Editorial"**: light-first, serif display, print-like density. Tests whether the deck-authoring context reads better as a writing tool.
- **Direction C — "Terminal"**: max density, mono-dominant, receipt-aesthetic everywhere. Tests the agent-trace/provenance identity taken to the limit.

Decision gate (Homen, taste call): pick one direction, possibly with grafts from the others. Tokens frozen as `src/domains/nodeslide/theme/app-tokens.json`. Every later component card renders against these tokens only — no ad-hoc colors.

## D1 — Component inventory (the contract surface)

Derived from the real studio (src/domains/nodeslide/NodeSlideStudio.tsx) plus the pillar additions. Ceiling: 14. Anything new goes to the later-list.

| # | Component | Pillar | Key contract facts |
|---|---|---|---|
| 1 | StudioShell | — | three-pane grid, responsive collapse order (navigator → inspector), no horizontal page scroll |
| 2 | SlideNavigator | — | thumbnails, drag-reorder emits `reorder_slide`, add/remove emit slide ops |
| 3 | SlideCanvas | — | normalized-bbox rendering, drag/resize emit `move`/`resize` patches, locked-element affordance, selection model |
| 4 | InspectorPanel | — | tab host: AI / Design / Comments / Versions / Data / Trace |
| 5 | VariationStrip | P2 | N validated variants, select emits patch, reject emits trace event, all variants pre-validated before display |
| 6 | SignatureSwitcher | P1 | profile picker + live preview, apply emits patch batch via existing patch system only |
| 7 | PatchReviewCard | P6 | agent proposal diff, accept/modify/decline, never auto-applies |
| 8 | ValidationReceiptBadge | — | {ok, publishOk, cleanOk} tri-state + typed issue drill-down, no fake green |
| 9 | ProvenanceChip | P4 | per-element source link, hover reveals source excerpt, absent = visibly unlabeled |
| 10 | TasteProfileCard | P1/P6 | extracted signature visualization: tokens, confidence scores, provenance per token |
| 11 | BriefComposer | — | DeckBrief form (prompt, audience, purpose, successCriteria[]) |
| 12 | ExportDialog | — | per-element capability labels (web_native/pptx_editable/fallback), honest by construction |
| 13 | PresenterView | — | full-screen, keyboard nav, zero-chrome |
| 14 | CommandPalette | — | fuzzy actions, every action maps to a patch op or navigation |

## D2 — Contract template (one per component, frozen before delegation)

Each contract lives at `docs/specs/ui/<component>.md` and is the SPEC input to the Codex orchestration loop. Template:

1. **Purpose** — one sentence, the user job.
2. **Anatomy** — named regions (maps to preview card sections).
3. **Props contract** — TypeScript interface, verbatim (becomes the actual exported interface; drift = review failure).
4. **States** — required renderings: empty, loading, error, degraded (LLM route down → deterministic fallback visible), locked, offline/stale (CAS rebase pending).
5. **Emits** — exhaustive list of patch operations and trace/preference events this component may produce. Components NEVER mutate outside the patch system.
6. **Data dependencies** — Convex queries/subscriptions consumed; real-time invalidation expectations.
7. **A11y** — keyboard path, focus order, ARIA roles, WCAG contrast (validator-checked).
8. **Perf budget** — perceived action < 200ms; anything slower needs optimistic patch + pending state.
9. **Non-goals** — explicit, to stop Codex scope drift.
10. **Preview variants** — the exact variant list the D3 card must render.

## D3 — Claude Design sync (the shared visual source of truth)

Flow per DesignSync contract: `list_projects` → `create_project` ("NodeSlide Design System") → build local bundle → `finalize_plan` → `write_files`, incremental, one component at a time — never wholesale replace.

Bundle layout:
```
design-system/
  foundations/tokens.html        (@dsCard group="Foundations")
  foundations/type.html          (@dsCard group="Foundations")
  foundations/color.html         (@dsCard group="Foundations")
  components/<name>/index.html   (@dsCard group="Components" | "Pillars")
```
Each card: self-contained HTML, all variants + all required states side by side, rendered from app-tokens.json values inlined at build time. Cards are the visual contract; the .md is the behavioral contract. A card without its .md (or vice versa) fails the phase gate.

Review loop: Homen reviews cards on claude.ai/design, comments/rejects; edits land as new card versions synced incrementally. Direction changes ripple through tokens, not through per-card edits.

## D4 — Design → build → verify loop (closing it with Parity Studio)

1. Contract + card frozen → Codex implements the React component against the interface in the contract.
2. Implemented component rendered in the dev app → screenshot + DOM check against the card's variant list (every required state actually reachable).
3. **Dogfood the flagship**: run Parity Studio's own pipeline (image → component parity, 16-row deterministic rubric) with the design card as reference and the implemented component as candidate. NodeSlide's UI gets verified by the other product in this repo. The receipt goes in docs/dogfood/.
4. Rubric verdict `verified` → component ships; `needs_iteration` → back to Codex with the rubric rows that failed. Binary gate, no taste arguments at implementation time — taste was settled at D0/D3.

## Sequencing against the pre-build plan

```
D0 directions ──► Homen picks ──► D1 inventory + D2 contracts for W2/W3-adjacent
components first (VariationStrip, SignatureSwitcher, TasteProfileCard,
PatchReviewCard) ──► D3 sync ──► D4 loop runs per component as W1-W4 land.
```
D0-D2 for the four pillar components can complete before W1 finishes — contracts don't need the extractor working, only its output type (SignatureProfile, frozen in the W1 spec).

## Failure modes & guards

- **Card/implementation drift**: D4 parity check is the guard; a card edit without a re-verified component reopens the component.
- **Token leakage**: any hex value in a component card or implementation that isn't a token reference fails review (grep-able rule).
- **Contract-as-suggestion**: props interface in the .md is copied, not paraphrased, into code; diff must match.
- **Design-system scope gravity**: 14 components is the ceiling for pre-build; the pane is not a playground.

## Definition of done

1. One chosen direction, tokens frozen and committed.
2. 14 contracts in docs/specs/ui/, each with a synced card on claude.ai/design.
3. Pillar-critical four (VariationStrip, SignatureSwitcher, TasteProfileCard, PatchReviewCard) implemented and parity-verified with receipts.
4. Design project shareable — it doubles as a demo artifact for the AI Fund panel: "here is my design system, verified by my own verification product."
