---
description: Revise copy, style, or layout on one existing NodeSlide slide while preserving scope, locks, version clocks, and source lineage.
---

1. Call `inspect_deck` for the requested deck and slide.
2. Record the current deck version, target slide ID, element IDs, locks, and source bindings.
3. Choose the narrowest scope:
   - `elements` when the user identified exact elements;
   - `slide` when several elements on one slide may change;
   - `deck` only for an explicitly deck-wide request.
4. Choose the narrowest operation mode: `copy`, `style`, `layout`, or `unrestricted`.
5. Call `propose_edit`. Prefer deterministic execution unless the user explicitly approves hosted
   model egress.
6. Verify the response has `applied: false` and identical before/after deck versions.
7. Show the proposal summary, candidate validation, candidate digest, and base deck version.
8. Stop for human review.
9. After explicit approval, call `accept_proposal` with the exact reviewed patch ID, digest, and
   base deck version. If rejected, call `reject_proposal` with the same binding.
10. Report the resulting canonical receipt. Never infer success from the model's prose.
