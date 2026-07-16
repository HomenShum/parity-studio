# NodeSlide agent UX function ledger

Run mode: `SANDBOX DOGFOOD` against source and local proof. The production deck is read-only evidence for this run.

| Surface | User function | Preserve? | Treatment |
| --- | --- | --- | --- |
| Instruction composer | State an outcome and request a mutation | Yes | Make this the dominant, first interaction |
| Submit action | Create a proposal without applying it | Yes | Give it an explicit `Propose` label and keep Enter shortcut |
| Write scope | Bound changes to deck, slide, or selection | Yes, protected | Show the current scope in the compact bar; edit in settings |
| Operation mode | Limit work to full, copy, style, or layout | Yes, protected | Show current mode in the compact bar; edit in settings |
| Provider/model route | Choose external model or private deterministic processing | Yes, protected | Keep a visible route indicator and expose full controls in settings |
| External-model consent | Authorize per-request data transfer | Yes, protected | Keep inline immediately next to the request action when required |
| Web research + consent | Explicitly enable browsing and source persistence | Yes, protected | Keep available under tools; preserve honest labeling and consent |
| Read context and commands | Add references, commands, or data | Yes | Consolidate into a quiet tools row without removing keyboard tokens |
| Review proposal | Inspect candidate, validation, scope, and diff | Yes, protected | Keep unchanged in the review stream |
| Accept/reject/preview | Control whether a candidate mutates the deck | Yes, protected | Keep unchanged and visible on proposal cards |
| Progress/cancel/failure | Understand and stop an in-flight run | Yes, protected | Keep honest states unchanged |
| Trace and versions | Audit provenance and recover prior state | Yes, protected | Keep inspector tabs and version history unchanged |
| Context header prose | Explain scoped context redundantly | No | Collapse to one compact context row |
| Suggested-action disclaimer | Explain that suggestions only prefill | No | Remove redundant prose; buttons remain non-submitting by behavior |
| Four policy chips | Repeat settings before every ask | Partly | Reduce default summary to scope + operation; retain full controls |
| Shortcut/status sentence | Repeat model and consent state below composer | Partly | Shorten to the keyboard shortcut; route and consent remain visible elsewhere |

Primary fix mode: `DECLUTTER`. No protected safety, consent, provenance, review, recovery, or cancellation function may be removed.
