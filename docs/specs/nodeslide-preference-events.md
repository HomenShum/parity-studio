# W4 — NodeSlide preference events and taste ETL stub

Status: **FROZEN — revision 1**
Frozen: 2026-07-10
Depends on: W3 frozen event names and existing patch/export provenance
Owner: NodeSlide product work; prompt-independent prior art

## Outcome

Persist tenant-scoped, provenance-complete interaction events and deterministically extract a small set of preference signals behind an evaluator gate.

Binary metric: replay one real dogfood editing session and write at least one evaluator-passed signal with a complete event → artifact → deck/slide/element provenance chain. Zero signals may pass without provenance.

## Frozen event names

```text
variation_generated
variation_selected
variation_rejected
patch_accepted
patch_modified
patch_declined
export_completed
```

No arbitrary client event name is accepted. New names require a later spec revision.

## Public contract

Add `shared/nodeslidePreference.ts`:

```ts
export const NODESLIDE_PREFERENCE_SCHEMA_VERSION = 'nodeslide.preference/v1' as const;

export type PreferenceEventType =
  | 'variation_generated'
  | 'variation_selected'
  | 'variation_rejected'
  | 'patch_accepted'
  | 'patch_modified'
  | 'patch_declined'
  | 'export_completed';

export type PreferenceScope =
  | { kind: 'deck'; deckId: string }
  | { kind: 'slide'; deckId: string; slideId: string }
  | { kind: 'element'; deckId: string; slideId: string; elementId: string };

export interface PreferenceProvenance {
  deckVersion: number;
  sourceEventId?: string;
  variationId?: string;
  variationBatchId?: string;
  patchId?: string;
  traceId?: string;
  exportId?: string;
  profileId?: string;
}

export interface PreferenceEvent {
  schemaVersion: typeof NODESLIDE_PREFERENCE_SCHEMA_VERSION;
  id: string;
  tenantId: string; // derived server-side from the deck/project, never trusted from client
  actorId: string; // stable tenant-local pseudonymous identity
  type: PreferenceEventType;
  scope: PreferenceScope;
  provenance: PreferenceProvenance;
  attributes: Record<string, string | number | boolean>;
  occurredAt: number;
  recordedAt: number;
}

export interface PreferenceSignal {
  id: string;
  tenantId: string;
  actorId: string;
  polarity: 'positive' | 'negative';
  scope: PreferenceScope;
  dimension: 'content_angle' | 'density' | 'layout_archetype' | 'color' | 'font' | 'workflow';
  value: string;
  confidence: number;
  evidenceEventIds: string[];
  evaluator: PreferenceEvaluatorReceipt;
  createdAt: number;
}

export interface TasteProfile {
  schemaVersion: typeof NODESLIDE_PREFERENCE_SCHEMA_VERSION;
  id: string;
  tenantId: string;
  actorId: string;
  signals: PreferenceSignal[];
  updatedAt: number;
}
```

## Recording rules

- Events are written server-side from successful NodeSlide mutations/actions. A public client may request a decision, but may not choose `tenantId`, raw actor ID, deck version, or artifact ownership.
- `tenantId` is the deck's stored `projectId` in revision 1. Cross-project queries are impossible through indexes/API arguments.
- `actorId` is a stable hash of the owner/session capability plus tenant salt; raw capability/session values are never stored.
- IDs are deterministic from tenant, actor, event type, source artifact, and idempotency key. Retries do not duplicate events.
- Event attributes are allow-listed by event type; no arbitrary text blob or raw model response is stored.
- `variation_generated` is context, not a positive/negative preference by itself.

## Provenance gate

Required provenance by type:

| Event | Required links |
|---|---|
| variation_generated | deckVersion + variationId + variationBatchId + traceId |
| variation_selected | deckVersion + variationId + variationBatchId + patchId + traceId |
| variation_rejected | deckVersion + variationId + variationBatchId + traceId |
| patch_accepted | deckVersion + patchId; traceId when agent sourced |
| patch_modified | deckVersion + accepted patchId + sourceEventId for the prior proposal |
| patch_declined | deckVersion + patchId or traceId |
| export_completed | deckVersion + exportId |

The recorder verifies every linked row belongs to the same tenant/deck/scope. Missing, forged, cross-deck, or cross-tenant links are rejected and never enter ETL.

## ETL and evaluator

`extractPreferenceSignals(events, options?)` is deterministic and pure. It proposes signals only from allow-listed patterns:

- selecting a variant → positive signals for its declared axes;
- rejecting a variant → negative signals for its axes, unless a sibling with the same axis was selected;
- accepting a style patch → positive signals for changed, normalized color/font dimensions;
- modifying/reverting an accepted patch → lower-confidence negative signal for the superseded change;
- completing export → positive workflow signal only when linked to a deck version containing an accepted change.

Every proposal passes three evaluator checks before storage:

1. **schema** — finite confidence `0..1`, bounded enums/value, valid tenant-local scope;
2. **provenance** — all evidence events and linked artifacts exist and form one tenant/deck chain;
3. **hallucination** — dimension/value is derivable from stored attributes/artifacts, not free text or model output.

Evaluator output records each check, rejection codes, input event IDs, and deterministic evaluator version. Only all-pass signals enter `nodeslide_taste_profiles`.

Contradiction rule: if the same actor selects/accepts and later reverts/rejects the same value in the same scope, retain both source events but emit no durable positive signal for that value. A later explicit decision can supersede only with its full provenance chain.

## Bounds and retention

Per tenant + actor:

- max 1,000 retained events; prune oldest processed context first;
- max 100 signals in a taste profile;
- max 100 events per ETL invocation and max 20 emitted signal proposals;
- max 32 attributes per event, key length 64, string value length 240;
- max 16 evidence event IDs per signal;
- list APIs default 50 and hard-cap 200;
- no cross-tenant pooling, aggregate model, ClickHouse, or training export.

Pruning is deterministic, indexed, and never removes an event still referenced by a retained signal.

## Scenario tests

1. **Real replay** — golden dogfood select/accept/export chain yields at least one passed signal with complete provenance.
2. **Missing provenance** — each event type missing one required link is rejected; ETL yields zero.
3. **Forged provenance** — cross-deck/tenant IDs are rejected without existence disclosure.
4. **Idempotent retry** — same event/idempotency key stores once and ETL does not duplicate signals.
5. **Variation selection** — selected axes produce positive signals tied to variation, patch, and trace.
6. **All variants rejected** — negative signals are bounded and retain batch/trace evidence.
7. **Contradiction** — select then revert/reject suppresses the durable positive signal.
8. **Patch modified** — modified proposal produces scoped evidence for accepted and superseding patches.
9. **Export** — unlinked export creates no workflow preference; linked completed export may.
10. **Hallucination gate** — invented dimension/value not present in artifacts is rejected.
11. **Flood** — 1,500 events prune to at most 1,000 while retained signal evidence remains reachable.
12. **ETL burst** — concurrent ETL runs converge to the same signal IDs/profile without duplicates.
13. **Tenant isolation** — one tenant cannot list, link, replay, or infer counts for another.
14. **Bounds** — oversized attributes, evidence lists, and batches fail before write.

## Reliability review

| Check | Required proof |
|---|---|
| BOUND | event/signal/attribute/evidence/list/ETL caps and flood test |
| HONEST_STATUS | evaluator receipts expose pass/reject reasons |
| HONEST_SCORES | confidence is rule-derived and never provider-authored |
| TIMEOUT | ETL batch bound and indexed reads complete within action deadline |
| SSRF | URLs are never fetched by recorder/ETL |
| BOUND_READ | tenant/actor indexes plus 100-event ETL cap |
| ERROR_BOUNDARY | bad/forged events fail safely without tenant leakage |
| DETERMINISTIC | event/signal IDs, contradiction handling, pruning, evaluator receipts |

## Verification and dogfood

Required gates are TypeScript, targeted Vitest, and Biome. Dogfood writes `docs/dogfood/nodeslide-pillars/w4-preference-proof.json` with sanitized event IDs/types, provenance graph links, evaluator receipts, passed/rejected signal counts, replay/idempotency result, flood-retention counts, tenant-isolation result, and reliability booleans.

## Non-goals

- No SLM training, embeddings, ClickHouse, cross-tenant aggregation, behavioral advertising, inferred demographics, or model-written preference claims.
- No raw capability/session key, raw model response, or challenge material stored.
- No automatic style change from a taste signal in revision 1.

Any contract change requires revision 2 before implementation changes.
