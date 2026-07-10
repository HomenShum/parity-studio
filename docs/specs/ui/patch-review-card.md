# PatchReviewCard — UI contract (frozen 2026-07-10)

Pillar 6 (approval boundary). Card: `design-system/components/patch-review-card.html`. Types: `shared/nodeslide.ts` (PatchOperation), `shared/nodeslidePreference.ts`.

## 1. Purpose
The sidecar surface where an agent proposal becomes a human decision. Renders in the copilot stream and on mobile as a bottom sheet. Voice: "NodeSlide noticed…", never "NodeSlide edited."

## 2. Anatomy
[agent-ink rail] [summary line] [op list (≤8) with per-op target links] [receipt strip] [action bridge: Accept · Modify · Decline · Receipt].

## 3. Props contract (verbatim)
```ts
import type { PatchOperation } from '@shared/nodeslide';

export type ProposalStatus = 'proposed' | 'accepted' | 'declined' | 'stale' | 'applying';

export interface PatchReviewCardProps {
  patchId: string;
  summary: string;                          // agent's one-line intent
  operations: PatchOperation[];             // length ≤ 8 (NODESLIDE agent cap)
  status: ProposalStatus;
  authorKind: 'agent' | 'user';             // rail ink; agent proposals are the normal case
  traceId?: string;                         // deep link to trace view
  validationOk?: boolean;                   // candidate validation, if precomputed
  baseDeckVersion: number;
  onAccept: (patchId: string) => void;      // emits patch_accepted
  onModify: (patchId: string) => void;      // opens ops in editor; emits patch_modified on commit
  onDecline: (patchId: string) => void;     // emits patch_declined
  onFocusTarget: (slideId: string, elementId?: string) => void; // stage focus per op
  onOpenReceipt: (patchId: string) => void; // validation + trace detail
}
```

## 4. States (all must render)
- **proposed** — full action bridge, agent-ink (indigo) rail, op count chip `2 ops · p_9a41`.
- **applying** — optimistic pending; actions disabled; receipt strip shows spinner-free "applying…" text.
- **accepted** — user-ink check, bridge collapses to Receipt link.
- **declined** — dimmed, kept in stream (history is evidence, not clutter).
- **stale** — deck moved past `baseDeckVersion` and CAS could not rebase: "deck changed since proposal" + only actions Decline / Re-propose. Never silently re-target.
- **locked-target** — an op touches a locked element: op row flagged, Accept disabled with reason.

## 5. Emits
- Accept/Modify/Decline → `patch_accepted` / `patch_modified` / `patch_declined` PreferenceEvents with `provenance.patchId` (+ `traceId` when present). These three events are the taste loop's richest signals.
- Card never applies operations itself — accept hands off to the patch commit flow (CAS outcomes: committed / rebased / stale).
- Every op row links to its target via `onFocusTarget` (the chat-drives-stage shell rule).

## 6. Data dependencies
Proposal record live query (status changes from other clients must update the card). Deck version subscription for staleness.

## 7. A11y
Card = `role="group"` labeled by summary. Bridge buttons are real buttons, tab-ordered Accept → Modify → Decline. Status changes announced via `aria-live="polite"`. Ink rails paired with text labels ("agent proposal").

## 8. Perf budget
Decision feedback < 100ms optimistic. Op target focus < 200ms.

## 9. Non-goals
No inline op editing on the card (Modify opens the editor). No auto-accept timers. No hiding declined cards. No rendering proposals that exceed the 8-op cap (upstream invariant; card asserts and refuses).

## 10. Preview variants (card must show)
proposed (2 ops) · accepted · declined · stale · locked-target row. Mobile bottom-sheet variant with grabber.
