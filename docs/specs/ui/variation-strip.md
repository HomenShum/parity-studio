# VariationStrip — UI contract (frozen 2026-07-10)

Pillar 2. Card: `design-system/components/variation-strip.html`. Types: `shared/nodeslideVariation.ts`.

## 1. Purpose
Replace blank-page drafting with selection: show the 3 generated variants for one slide, let the user pick, reject, or dismiss the batch.

## 2. Anatomy
Horizontal strip docked below the stage: [batch header] [variant card ×3] [dismiss]. Variant card = thumbnail render, axes label, origin badge, action row.

## 3. Props contract (verbatim)
```ts
import type { SlideVariation, VariationBatch } from '@shared/nodeslideVariation';

export interface VariationStripProps {
  batch: VariationBatch;                    // status: 'generating' | 'ready' | 'failed'
  variations: SlideVariation[];             // length ≤ NODESLIDE_VARIANT_COUNT (3)
  activeSlideId: string;
  onSelect: (variationId: string) => void;  // accept → patch via selection flow
  onReject: (variationId: string) => void;
  onDismiss: () => void;                    // closes strip, rejects nothing
  onRegenerate: () => void;                 // failed state only
}
```

## 4. States (all must render)
- **generating** — 3 skeleton cards, batch elapsed timer. No fake previews.
- **ready** — thumbnails from `candidate`, axes chips (`data_led · executive · headline`).
- **degraded** — `origin === 'deterministic_fallback'`: visible "fallback" badge + `fallbackReason` tooltip. Never styled as an error; never hidden.
- **failed** — batch failed: reason + Regenerate. No variants shown.
- **stale** — deck moved past `baseDeckVersion`: variants dimmed, select disabled, "deck changed" notice.
- **decided** — after select: accepted card gets user-ink check, siblings collapse.

## 5. Emits
- Select → selection flow records `variation_selected` PreferenceEvent and applies `operations` as a normal patch (review-gated like any patch). Component itself never mutates.
- Reject → `variation_rejected`. Dismiss emits nothing.
- Every displayed variant already passed validation (`validation.ok === true` enforced upstream); strip renders `▮ ok` receipt mark per card and MUST NOT render a variant whose receipt is missing.

## 6. Data dependencies
Convex live query: batch + variations by `batchId`. Re-render on `status`/`decidedAt` change. Stale detection via deck version subscription.

## 7. A11y
Strip = `role="listbox"`, variants = `role="option"`. Arrow-key navigation, Enter selects, Delete rejects. Focus ring: terracotta token. Axes chips have text labels, never color-only.

## 8. Perf budget
Strip appears < 200ms after batch `ready` (thumbnails may stream in). Select feedback < 100ms optimistic; patch confirmation via receipt update.

## 9. Non-goals
No inline editing of a variant. No more than 3 variants. No auto-select on timeout. No generation from inside the strip (regenerate = whole batch, failed state only).

## 10. Preview variants (card must show)
ready ×3 (distinct axes) · generating · deterministic_fallback badge · stale · failed.
