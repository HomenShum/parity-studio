# NodeSlide Pillars launch QA matrix

Date: 2026-07-10

This matrix tests NodeSlide as a product, not a feature tour. The evaluator starts with no repository knowledge, no seeded browser storage, and no explanation from the builder. Private-preview claims are judged separately from public multi-tenant launch claims.

## Journey 1 — fresh user, first landing

User intent: “I have a deck or a brief. Help me make a credible presentation without trapping me in generated output.”

| Moment | User question | Ship gate | Failure critique |
|---|---|---|---|
| First 10 seconds | What is this, who is it for, and what can I do now? | One concrete promise, one primary action, private-preview limits visible without legal clutter | Clever brand language with no job-to-be-done; two competing CTAs; implied enterprise readiness |
| First action | Should I start from a brief or an old deck? | Both routes are legible; old-deck route explains that style is extracted while content stays reviewable | Upload appears to import/edit everything when it only extracts signature tokens |
| Source selection | What will happen to my file? | Accepted format/size, local/server handling, retention, and failure behavior are stated before upload | Silent upload, vague “AI analysis,” or unsupported fidelity promises |
| Waiting | Is it working, and what is the system doing? | Bounded progress stages; cancel/retry; no fake percentage; fallback is labeled | Spinner with no timeout, model attribution, or recovery path |
| First result | Is this real, editable, and grounded? | Visible editable objects, source/disclosure state, validation summary, and provenance for extracted signature | Beautiful static preview that hides invalid structure, illustrative data, or fallback origin |
| First decision | What should I review before accepting? | Variants remain proposals; differences and axes are understandable; original is always recoverable | Auto-apply, opaque ranking, or three cosmetically identical “variants” |
| First export | Will PowerPoint still be editable? | Exact preflight; clear native/static capability labels; downloaded artifact opens and renders cleanly | Export success toast without opening/rendering the file or explaining fallbacks |

Fresh-user activation gate: a clean-session evaluator can create or open a deck, understand one proposal, accept it deliberately, and export an artifact without builder assistance. Measure time to first trustworthy result, not merely time to first pixels.

## Journey 2 — experienced presentation professional

User intent: “Give me leverage while preserving hierarchy, evidence, brand logic, and PowerPoint editability.”

| Concern | Professional standard | Ship gate |
|---|---|---|
| Signature fidelity | Palette/font extraction distinguishes theme declarations from actual usage and unresolved aliases | Hand audit on three product-owned reference decks scores at least 90% for palette/fonts; evidence locators are inspectable |
| Narrative quality | A slide has a job and a takeaway, not just fitted text | Variants state content angle/density/layout archetype and do not invent unsupported claims |
| Layout judgment | Hierarchy, whitespace, alignment, and density are intentional | Candidate is a complete validated slide; visual review catches wrapping/collision beyond schema validity |
| Data communication | Chart choice, scale, labels, and semantic notation support the message | Finance pack rules are cited; no certification claim; chart/data values remain grounded |
| Brand enforcement | Compliance is explainable, scoped, and tolerant of incomplete evidence | `on_brand_*` issues identify property, target, allowed values, provenance, and locked-element exceptions |
| Review control | AI output is reversible and comparable | Generate never mutates; Accept uses normal CAS patch/history; Reject leaves deck untouched |
| Export craft | Native objects, notes, sources, and slide geometry survive | Render every final PPTX slide at full size, run overflow detection, and inspect object editability |

Professional-value gate: an evaluator would use the tool for a real revision because it reduces mechanical work without taking away editorial control. “It generated slides” is insufficient.

## Journey 3 — repeated user

User intent: “Remember what I choose, remain fast and predictable, and never surprise me across sessions.”

| Repeat behavior | Ship gate | Regression signal |
|---|---|---|
| Return to deck | Stable URL/session recovery within private-preview constraints; no raw-ID data leak | Blank state, duplicate seed deck, or lost capability with no explanation |
| Generate repeatedly | Quota state, fallback origin, and retry behavior stay honest | Latency grows with trace history; duplicated variants; unbounded rows |
| Select/reject over time | Decisions are idempotent and bounded; accepted sibling state is consistent | Duplicate patches/events or conflicting accepted variants |
| Human correction | Later manual edits override inferred taste; contradiction suppresses stale positive signals | Product “learns” a reverted choice or claims certainty from one click |
| Signature swap | Old version/comments remain reachable; new validation targets the active profile | Destructive theme replacement or history that cannot explain current style |
| Export again | Exact current version is exported and linked to provenance | Stale artifact from an earlier deck version |
| 50-round soak | Storage caps hold, reads remain indexed, and UI remains responsive | State accumulation, slower queries, or hidden pruning of referenced evidence |

Repeat-value gate: the fiftieth decision is as understandable and reversible as the first, with bounded state and no cross-tenant learning.

## Senior review lenses

### Product lead

- Can the user explain NodeSlide’s unique value after one result: signature transposition + bounded alternatives + reviewable edits + verified export?
- Does the first-run path reach that value before exposing implementation vocabulary?
- Are private-preview limitations explicit enough to prevent the wrong customer expectation?
- Kill launch if the signature/variation flow is merely a demo hidden outside the primary journey.

### Presentation design director

- Judge title/message hierarchy, rhythm across slides, whitespace, density, alignment, chart integrity, and whether alternatives are meaningfully different.
- Require side-by-side old-signature/new-signature evidence and full-size rendered PPTX inspection.
- Kill launch for “valid but mediocre” output presented as expert quality; warnings and human review must remain visible.

### Staff product designer

- Test empty/loading/degraded/error/stale/all-rejected/already-applied states, not just the golden path.
- Verify preview/original comparison, focus management, keyboard operation, responsive inspector hierarchy, and clear destructive versus reversible actions.
- Kill launch if acceptance is visually easier than inspection or rejection.

### Staff engineer / distributed-systems reviewer

- Verify deterministic IDs/serialization, CAS overlap behavior, idempotency, timeout boundaries, bounded persistence, indexed reads, and exact version-to-export linkage.
- Run concurrent generate/accept/edit calls and 50-round sustained tests.
- Kill launch for direct snapshot writes, silent truncation, duplicate decision events, or unbounded trace/provider payload storage.

### AI reliability reviewer

- Apply `BOUND`, `HONEST_STATUS`, `HONEST_SCORES`, `TIMEOUT`, `SSRF`, `BOUND_READ`, `ERROR_BOUNDARY`, and `DETERMINISTIC` to every workstream.
- Inject garbage JSON, provider timeout, duplicated variants, missing evidence, and malformed profiles.
- Kill launch if deterministic fallback is attributed to a model or an invalid candidate reaches display.

### Security/privacy lead

- Treat deck files, owner capabilities, model prompts, source URLs, preference events, and exports as sensitive.
- Verify file/archive limits, no path traversal, no SSRF, capability redaction, tenant-derived IDs, cross-tenant query denial, and deletion/retention claims.
- Public launch remains NO-GO without account identity, membership authorization, capability rotation/revocation, abuse controls, and data-deletion policy.

### Accessibility lead

- Test keyboard-only creation/review/export, focus return, dialog semantics, status announcements, error association, 200% zoom, forced colors, reduced motion, and non-color-only variant/validation cues.
- Inspect exported reading order, notes, image alt text, text contrast, and minimum type sizes.
- Kill launch if the canvas is mouse-only or validation state is color-only.

### Data-visualization / finance reviewer

- Check message-led titles, honest scales, direct labels, appropriate chart forms, semantic consistency, and visible source/disclosure state.
- Verify cited pack principles are distinguishable from NodeSlide-authored palette/font choices.
- Kill launch for IBCS/FT certification or affiliation language, copied trade dress, truncated axes, or invented financial data.

### Growth / activation reviewer

- Instrument only meaningful milestones: route chosen, trustworthy result shown, proposal inspected, proposal accepted/rejected, exact export completed.
- Separate provider success from user success and deterministic fallback from model success.
- Kill launch metrics that count a generated preview as activation before review/export.

### Support / operations reviewer

- Every failure needs a user-safe code, actionable retry/fallback, trace correlation ID, and bounded diagnostic suitable for support without secrets.
- Dashboards need generation, validation, mutation, export, fallback, timeout, and stale-conflict rates by version—not raw user content.
- Kill public launch without alerting and a tested rollback/feature-disable path.

## Integrated E2E proof

Run from a clean browser profile and a product-owned PPTX:

1. Land and identify the old-deck route without explanation.
2. Upload PPTX; inspect extracted palette/fonts/layout evidence and warnings.
3. Create/open the golden brief under the extracted signature.
4. Generate three variants for one slide on the free route; separately force fallback.
5. Preview original and each candidate; reject two and accept one.
6. Apply finance pack, inspect `on_brand_*` validation, then swap to startup pack and confirm visibly distinct output/history.
7. Make a human edit that conflicts with an older proposal; confirm stale protection.
8. Export current HTML and editable PPTX after exact preflight.
9. Open/render every PPTX slide and run overflow checks.
10. Replay the decision events; inspect at least one evaluator-passed preference signal and one rejected no-provenance signal.
11. Repeat generate/decide 50 times through the soak harness; verify retention bounds and responsiveness.

The integrated receipt must link each step to stable deck/version/patch/trace/variation/event/export/profile IDs while redacting capabilities and secrets.

## Executed launch QA — 2026-07-10

Environment: clean Chrome origin at `127.0.0.1:5190`, production Convex deployment `blissful-pig-998`, free route first, disposable deck `deck_mrfo38dp_15zde23`. The pre-existing user deck at `launch-release.nodeslide.localhost` was not modified.

| Persona / lens | Executed evidence | Result |
|---|---|---|
| Fresh user | First-run promise and private-preview disclosure; structured brief; seven-slide creation; free-route fallback labels; no builder explanation | Pass |
| Presentation professional | Finance signature preview, Escape rollback, versioned 53-operation apply, role-specific on-brand checks, three materialized directions, original recovery, exact validation | Pass after fixes |
| Repeat user | Stable deck URL across reload; durable active profile; 13 inspectable taste signals; evaluator evidence; export workflow memory; version restore and undo-as-new-write | Pass |
| Export reviewer | Interactive HTML `71,601` bytes; editable PPTX `137,685` bytes; ZIP contains `ppt/presentation.xml` and seven native slide XML parts | Pass |
| Presenter / sharing | Presenter navigation and notes; capability-backed read-only share URL opened without editor controls | Pass |
| Accessibility | Keyboard first run, preview rollback, command palette, presenter controls; no unnamed visible controls, duplicate IDs, missing image alt, or document horizontal overflow in the tested states | Pass critical path; follow-up below |
| Responsive | Fresh 390×844 load at 35% fit and 1024×768 load at 62% fit; inspector becomes a full-width phone overlay; no page-level horizontal overflow | Pass |
| Reliability | Malformed provider JSON was labeled and replaced by deterministic fallbacks; active-profile generation preserved role-specific colors; acceptance remained CAS/versioned | Pass |
| Browser health | No application-origin console errors or warnings; observed warnings came from an unrelated installed wallet extension | Pass |

Defects discovered and fixed during the executed journey:

1. DTCG `$value` / `$type` / `$extensions` keys could not cross Convex object encoding. Profiles now use bounded, semantically validated JSON wire/storage values.
2. The snapshot validator omitted active-signature fields, causing atomic signature commits to roll back. Snapshot/version validators now preserve both active profile identifiers.
3. Escape ignored focused preview buttons. Preview rollback now precedes interactive-target keyboard filtering.
4. W3 validated structurally but not against W2’s active signature, so a “clean” direction could block export after acceptance. Generation prompts, candidate validation, deterministic fallbacks, and atomic acceptance now honor the active profile.
5. The validation footer opened a creation-trace receipt for deck v1 while the current deck was v7. Trace now separates the latest current-deck receipt from the selected trace receipt.

Residual launch boundaries:

- W1 has adversarial fixtures, the product-owned golden deck, bounded 200-slide proof, and deterministic evidence receipts. The planned hand audit on three independently licensed real-world reference decks is still an evidence gap; do not market a three-deck fidelity score yet.
- At reduced canvas zoom, slide objects can have visual bounds smaller than 24×24 CSS pixels. They retain accessible names and keyboard focus, but touch-target expansion remains an accessibility hardening item before a public mobile-editor claim.
- The free route returned malformed JSON in this run. The product behaved correctly by labeling and materializing deterministic fallbacks; this is not evidence of provider-route quality.
- Public multi-tenant launch remains blocked on account identity/membership authorization, capability rotation/revocation, deletion policy, abuse controls, monitoring, and an independent threat review.

## Launch verdicts

- **Controlled private preview GO** when the integrated journey, artifact QA, accessibility critical path, reliability matrix, and all code gates are green; limitations remain explicit.
- **Public multi-tenant NO-GO** until identity/membership authorization, capability lifecycle, retention/deletion, abuse/threat review, and monitoring are implemented and independently tested.
- **No-go regardless of label** for data leakage, false provenance/model attribution, silent overwrites, invalid candidates displayed as ready, or exports that do not open/render as claimed.
