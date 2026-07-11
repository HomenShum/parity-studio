# TasteProfileCard — UI contract (frozen 2026-07-10)

Pillar 6 (taste memory made visible). Card: `design-system/components/taste-profile-card.html`. Types: `shared/nodeslidePreference.ts`.

## 1. Purpose
Show a tenant's learned taste as inspectable evidence, not a black box: each PreferenceSignal with its polarity, dimension, confidence, and evaluator receipt. The user can see exactly what NodeSlide believes about their taste and why — and evict beliefs they reject.

## 2. Anatomy
Inspector-panel card: [header: actor + updatedAt + signal count] [signal rows grouped by dimension] [row detail: evaluator receipt + evidence chain] [footer: tenant-scope notice].

## 3. Props contract (verbatim)
```ts
import type { TasteProfile, PreferenceSignal, PreferenceDimension } from '@shared/nodeslidePreference';

export interface TasteProfileCardProps {
  profile: TasteProfile;                    // signals: PreferenceSignal[]
  groupBy?: PreferenceDimension | 'none';   // default: dimension
  onInspectSignal: (signalId: string) => void;   // expands evaluator receipt + evidence
  onEvictSignal: (signalId: string) => void;     // user removes a learned belief
  onOpenEvidence: (eventId: string) => void;     // deep link to source event/trace
}
```

## 4. States (all must render)
- **empty** — no signals yet: "NodeSlide hasn't learned your taste yet — it learns from what you select, accept, and decline." No fake seeding.
- **populated** — rows: polarity glyph (＋/－ with text), dimension chip (`density`, `color`…), value, confidence as number (0.00–1.00, mono), evidence count.
- **inspecting** — expanded row shows the `PreferenceEvaluatorReceipt`: three named checks (schema / provenance / hallucination) each with pass mark, evaluator version, and clickable evidence event IDs. Failed-check signals CANNOT exist here (evaluator-gated upstream); the receipt is always all-green — the point is showing it.
- **evicting** — confirm inline, then row leaves with a record ("belief removed").
- **stale-actor** — profile older than 30 days: gentle "last learned" notice, no auto-decay theatrics.

## 5. Emits
- Evict → profile mutation through the standard flow; eviction is itself a negative `workflow` signal candidate.
- Inspect/evidence navigation only; no other mutation. Card never writes signals — only the evaluator-gated ETL does.

## 6. Data dependencies
Tenant-scoped TasteProfile live query. Evidence deep links resolve via event/trace queries on demand.

## 7. A11y
Rows expandable via button semantics (`aria-expanded`). Polarity never color-only (glyph + label). Confidence read as text. Evidence links are real links.

## 8. Perf budget
Render < 200ms for NODESLIDE_PREFERENCE_BOUNDS-capped signal lists. Expansion lazy-loads evidence.

## 9. Non-goals
No cross-tenant or pooled taste display. No editable confidence sliders (confidence comes from the evaluator, not the user). No "AI personality" framing — this is a ledger of evidence-backed beliefs, styled with the receipt idiom.

## 10. Preview variants (card must show)
empty · populated (4 signals, mixed polarity/dimensions) · inspecting (receipt with 3 checks + evidence chain) · evict confirm.
