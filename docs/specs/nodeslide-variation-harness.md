# W3 — NodeSlide slide-variation harness

Status: **FROZEN — revision 1**
Frozen: 2026-07-10
Owner: NodeSlide product work; prompt-independent prior art
Implementation lane: `feature/nodeslide-domain`

## Outcome

Generate exactly three reviewable variants for one existing slide along declared axes, validate every candidate before display, let the user accept or reject explicitly, and retain bounded decision traces.

The default generation route is NodeSlide's existing OpenRouter free route. Invalid, unavailable, timed-out, or quota-limited model output falls back to deterministic variants with an honest origin and reason. No fake model result is presented.

Binary metric: on the golden deck, three validation-clean variants are available in under 10 seconds wall-clock. A sustained 50-round generate/decide test leaves bounded stored state.

## Frozen event names

These names are shared with W4 and may not be renamed after this revision:

```text
variation_generated
variation_selected
variation_rejected
patch_accepted
patch_modified
patch_declined
export_completed
```

W3 emits `variation_generated`, `variation_selected`, and `variation_rejected`. W4 owns the common event envelope and preference ETL. Until W4 lands, W3 decision records retain enough provenance to backfill those events exactly once.

## Public contract

Add `shared/nodeslideVariation.ts` without changing the existing 11-operation `PatchOperation` union.

```ts
export const NODESLIDE_VARIATION_SCHEMA_VERSION = 'nodeslide.variation/v1' as const;
export const NODESLIDE_VARIANT_COUNT = 3 as const;
export const NODESLIDE_VARIANT_OPERATION_LIMIT = 8 as const;

export type VariationContentAngle = 'data_led' | 'narrative_led' | 'balanced';
export type VariationDensity = 'executive' | 'detail' | 'balanced';
export type VariationLayoutArchetype = 'headline' | 'split' | 'evidence' | 'comparison';
export type VariationOrigin = 'free_route' | 'deterministic_fallback';
export type VariationStatus = 'ready' | 'accepted' | 'rejected' | 'stale';

export interface VariationAxes {
  contentAngle: VariationContentAngle;
  density: VariationDensity;
  layoutArchetype: VariationLayoutArchetype;
}

export interface SlideVariation {
  schemaVersion: typeof NODESLIDE_VARIATION_SCHEMA_VERSION;
  id: string;
  batchId: string;
  deckId: string;
  slideId: string;
  baseDeckVersion: number;
  baseSlideVersion: number;
  baseElementVersions: Record<string, number>;
  axes: VariationAxes;
  origin: VariationOrigin;
  fallbackReason?: string;
  operations: PatchOperation[]; // 1..8, existing op union only
  candidate: { slide: Slide; elements: SlideElement[] };
  validation: ValidationResult;
  status: VariationStatus;
  selectedPatchId?: string;
  createdAt: number;
  decidedAt?: number;
}

export interface VariationBatch {
  id: string;
  deckId: string;
  slideId: string;
  requestedCount: 3;
  status: 'generating' | 'ready' | 'failed';
  origin: VariationOrigin;
  fallbackReason?: string;
  variationIds: string[];
  elapsedMs: number;
  createdAt: number;
  completedAt?: number;
}
```

The candidate is materialized by applying operations to an isolated clone of the current snapshot. It is a complete slide plus all elements for that slide, not a thumbnail claim or unvalidated JSON fragment.

## Generation API

Convex exposes:

```text
nodeslideVariations.generate({ deckId, ownerAccessKey, slideId })
nodeslideVariations.list({ deckId, ownerAccessKey, slideId, limit? })
nodeslideVariations.accept({ deckId, ownerAccessKey, variationId })
nodeslideVariations.reject({ deckId, ownerAccessKey, variationId, reason? })
```

- `generate` is an action with the existing owner capability check and preview quota controls. It calls the free route once for all three variants.
- `accept` applies the selected operations through the existing patch transaction/CAS semantics. The resulting patch has source `agent`, a normal `DeckPatch`, and links back to the variation. No direct snapshot write is allowed.
- `reject` changes decision state only.
- `list` returns at most 30 recent variants by default and never more than 100.
- Every user-visible route has a deterministic fallback or a typed error boundary.

## Axes and diversity

The three default axis combinations are stable:

1. `data_led + executive + evidence`
2. `narrative_led + balanced + headline`
3. `balanced + detail + split`

The generator may use `comparison` when the source slide already contains two or more comparable series or sections. The final set must contain three distinct axis tuples and three distinct operation fingerprints. If provider output duplicates a candidate, that candidate is replaced deterministically.

Variants may use only `replace_text`, `update_style`, `move`, `resize`, and `update_slide` in revision 1. They may not add/remove slides or elements, mutate locked elements, cross the selected slide, or exceed eight operations.

## Provider and fallback behavior

The free-route prompt includes only the bounded target slide, its unlocked elements, the deck brief, allowed IDs, allowed operations, and axis tuples. It requests strict JSON. Provider output is parsed as untrusted data and then run through the existing patch validator.

Fallback behavior is deterministic from the current slide and axes:

- data-led: promote an existing sourced metric/chart and tighten supporting copy;
- narrative-led: promote a takeaway/headline and simplify secondary copy;
- balanced/detail: preserve evidence while changing hierarchy, density, and safe layout within existing boxes.

When the source slide lacks the elements needed for an axis, fallback uses bounded copy/style changes and records `insufficient_source_structure`. It does not invent data, sources, elements, or claims.

All candidates must pass `validation.ok === true` and contain no error-severity issue before persistence/display. Warnings remain visible. If a provider candidate cannot be repaired within one deterministic pass, replace it with fallback. If fallback cannot produce three valid distinct candidates, `generate` returns a typed failure and persists no ready batch.

## Concurrency and decisions

Each variation stores deck/slide/element clocks from generation. Acceptance uses those clocks:

- unrelated later edits may rebase under existing patch rules;
- overlapping edits make the variation `stale` and leave the deck unchanged;
- exactly one variation in a batch may be accepted;
- accepting one marks ready siblings rejected with reason `sibling_selected`;
- repeated accept/reject calls are idempotent and return the existing decision;
- rejection never mutates the deck.

## Bounded persistence

Add dedicated variation batch/record tables or an equivalent indexed representation. Per deck:

- retain at most 50 batches and 150 variants;
- retain at most 100 variation decision traces;
- prune oldest completed/rejected records after each generation, never an active generating batch;
- strings are capped: reason 240, summary 500, provider/fallback diagnostic 500;
- operations remain capped at eight and candidate elements at the source slide's element count;
- no raw provider response is stored.

## Scenario tests

1. **Happy / free route** — three distinct valid provider variants are parsed, materialized, validated, stored, and returned under 10 seconds.
2. **Review before accept** — generation does not mutate deck/version; acceptance creates a normal accepted patch and only then changes the deck.
3. **Garbage JSON** — malformed/partial/extra-ID provider data is rejected; deterministic fallbacks return with origin and reason.
4. **Provider timeout/down** — one bounded provider attempt, then fallback; status never claims model generation.
5. **Duplicate provider variants** — duplicates are replaced so all three fingerprints and axes are distinct.
6. **Locked/cross-slide operations** — invalid operations never reach persistence or preview.
7. **Validation gate** — an overflowing or schema-invalid candidate is repaired once or replaced; no error-invalid candidate is displayed.
8. **All rejected** — all three can be rejected, no patch is created, and decision traces persist.
9. **Accept one** — selected variant becomes accepted, siblings become rejected, selected patch ID is recorded.
10. **Concurrent non-overlap** — a human edit on another slide can coexist through existing CAS rebase.
11. **Concurrent overlap** — a human edit on a targeted element makes acceptance stale without overwrite.
12. **Sustained 50 rounds** — generate plus select/reject for 50 rounds keeps no more than 50 batches, 150 variants, and 100 decision traces.
13. **Quota burst** — repeated parallel generate calls respect per-owner and global preview quotas.
14. **Authorization** — missing/wrong owner capability reveals no deck or variation existence.
15. **Idempotency** — repeated accept/reject does not duplicate patches or decisions.

## Reliability review

| Check | Required proof |
|---|---|
| BOUND | op, candidate, prompt, result, table, list, and sustained-state caps |
| HONEST_STATUS | origin/fallback reason and no false model attribution |
| HONEST_SCORES | validation results are computed, never provider-supplied |
| TIMEOUT | provider deadline plus total elapsed metric under 10 seconds |
| SSRF | no URL fetching; provider sees bounded stored text only |
| BOUND_READ | one slide only, bounded element count/text lengths |
| ERROR_BOUNDARY | parser/provider/storage failures become typed UI-safe states |
| DETERMINISTIC | fallback axes, fingerprints, IDs, and duplicate replacement are stable |

## UI acceptance

The AI inspector gains a “Generate 3 directions” control for the active slide. It shows axis labels, origin, validation state, concise changed-field summary, and Preview / Accept / Reject actions. A user must be able to return to the original slide before accepting. Keyboard focus, loading, empty, fallback, error, stale, and all-rejected states are required.

## Verification and dogfood

Required gates:

```text
pnpm exec tsc --noEmit
pnpm test -- --run <W3 test files>
pnpm exec biome check <W3 files>
```

Dogfood on the golden deck and write `docs/dogfood/nodeslide-pillars/w3-variation-proof.json` containing batch/variant IDs, elapsed time, origins, axis tuples, operation fingerprints, validation booleans, pre/post deck versions, selected patch ID, all-rejected proof, sustained-state counts, and the reliability checklist.

## Non-goals

- No new patch operation or mutation path.
- No automatic acceptance, ranking presented as objective truth, or hidden preference inference.
- No invented facts, data, sources, images, or elements.
- No cross-slide/deck variants, whole-deck generation, or collaborative voting in revision 1.
- No W4 taste-profile writes; W3 only freezes event names and records decision provenance.
- No challenge-specific prompt or material.

Any contract change requires revision 2 of this document before implementation changes.
