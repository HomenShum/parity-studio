# SignatureSwitcher — UI contract (frozen 2026-07-10)

Pillar 1. Card: `design-system/components/signature-switcher.html`. Types: `shared/nodeslideSignature.ts`.

## 1. Purpose
Let a user apply an identity to the whole deck: pick an extracted SignatureProfile (from their PPTX/PDF/screenshot) or a sector taste pack, preview the retheme, apply it as a reviewable patch batch.

## 2. Anatomy
Popover from the top bar: [profile list] [selected profile detail: swatch row, font pair, confidence, warnings] [Preview / Apply row].

## 3. Props contract (verbatim)
```ts
import type { SignatureProfile, SignatureConfidence } from '@shared/nodeslideSignature';

export interface SignatureSummary {
  id: string;
  name: string;
  sourceKind: SignatureProfile['source']['kind']; // 'pptx' | 'pdf' | 'screenshot' | 'taste_pack'
  confidence: SignatureConfidence;                 // 'high' | 'medium' | 'low'
  warningCount: number;
  swatch: string[];                                // ≤6 hex, from tokens.colors
  fontPair: { display?: string; body?: string };
}

export interface SignatureSwitcherProps {
  profiles: SignatureSummary[];
  activeProfileId?: string;                        // undefined = slide.* defaults
  previewProfileId?: string;
  onPreview: (profileId: string | undefined) => void;  // live stage retheme, no mutation
  onApply: (profileId: string) => void;            // emits patch batch via applySignature flow
  onUploadSource: () => void;                       // opens extraction intake
  detail?: SignatureProfile;                        // lazy-loaded for selected row
}
```

## 4. States (all must render)
- **empty** — no profiles: upload invitation ("Upload a past deck — NodeSlide learns your look"), sector packs still listed.
- **list** — profiles grouped: "Yours" (extracted) vs "Sector packs" (`taste_pack`).
- **previewing** — stage rethemed live, switcher shows "previewing — not applied" bar with Apply / Revert.
- **low-confidence** — `confidence: 'low'`: amber confidence chip + per-token confidence visible in detail. Never hide uncertainty.
- **warnings** — warning count chip; detail lists `SignatureWarning.message` verbatim.
- **applying** — pending patch state; resolves to receipt confirmation.

## 5. Emits
- Apply → patch batch through the standard patch system (scope-gated, review-gated); records provenance `profileId`. Component never writes tokens directly.
- Preview → ephemeral, no patch, no PreferenceEvent.
- Apply outcome eventually feeds `patch_accepted` with `provenance.profileId` — the taste loop's color/font signals.

## 6. Data dependencies
Profiles list (Convex query, tenant-scoped). Detail lazy query on selection. Stage preview via theme context, not per-element mutation.

## 7. A11y
Popover focus-trapped, Esc reverts preview. Confidence conveyed by text chip + icon, not color alone. Swatches carry `aria-label` with hex.

## 8. Perf budget
Preview retheme < 200ms perceived on a 20-slide deck (token swap, not re-layout). Apply is async with pending state.

## 9. Non-goals
No token editing in the switcher (that is the profile editor's job). No cross-tenant profile sharing. No silent auto-apply of extracted profiles. No fabricated confidence — the extractor's value renders as-is.

## 10. Preview variants (card must show)
empty · list with 2 extracted + 2 sector packs · previewing bar · low-confidence detail with warnings.
