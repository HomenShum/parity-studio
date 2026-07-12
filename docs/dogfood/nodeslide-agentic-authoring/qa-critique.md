# NodeSlide end-to-end critique — agentic-authoring delta

Date: 2026-07-11

Scope: first landing through creation, editing, review, export, repeat use, and the new R1 shadow execution path. The established private-preview baseline remains the product boundary; this document focuses on what the new agentic work changes or reveals.

## User perspectives

### Fresh first-time user

The first success is tangible: a usable deck appears quickly, the editor is legible, the deck remains editable, and export is not a dead end. The private-preview admission and owner-capability model are understandable only when the recovery copy is encountered, however; a fresh user does not naturally distinguish owner capability, share capability, and account identity.

The generated fallback is safe but feels like a polished outline rather than a finished professional story. Slides 2, 4, 5, and 6 reuse generic narrative beats across founder, investor, and technical briefs. A first user may initially read that consistency as quality, then notice that the deck has not deeply understood their situation.

Decision: acceptable for a clearly labeled private preview and fallback route; not acceptable as an unqualified “AI made the deck” promise.

### Experienced presentation professional

The strongest differentiators are structural: stable IDs, source lineage, native PPTX editability, reviewable patches, exact version clocks, and deterministic publication gates. Those are unusually credible foundations for serious work.

The weak point is authored range. The fallback uses a repeated editorial rail and mostly two-column text/list compositions. It lacks visual evidence, charts derived from real data, audience-specific argument structure, and intentional silhouette changes. Taste mismatch correctly identifies locked/off-profile objects, but a professional needs a guided explanation of what can be repaired, what remains unresolved, and why—not merely a blocked status.

Decision: strong system substrate; R2 authoring quality remains on hold.

### Repeat user

Repeat users benefit from durable recents, versions, restore, signature profiles, variation decisions, and inspectable taste signals. They will also encounter template fatigue sooner than a first user. Repeated fallback decks share the same middle act, composition, pacing, and generic action language.

The new telemetry and taste receipts create the right learning substrate without silently changing decks. The next product step should use those receipts to recommend bounded alternatives, while preserving explicit human choice and avoiding cross-tenant aggregation.

Decision: repeat workflow is safe and recoverable; variety, reuse, and speed-to-specificity need evidence before broader promotion.

## Senior professional lenses

| Lens | Critique | Severity | Launch treatment |
| --- | --- | --- | --- |
| Product strategy | NodeSlide’s durable wedge is a living, reviewable deck system—not generic one-shot slide generation. Agentic claims should center authority, lineage, and safe iteration. | High | Reflected in positioning and R1 scope. |
| Product management | R1 has a crisp job: shadow typed commands and compare to the existing edit path. Exposing acceptance UI now would outrun evidence. | High | R2 remains HOLD. |
| UX research | Fresh users can complete work, but capability-based ownership is not an account mental model. Disclosure and recovery must remain explicit. | High | Controlled cohort only; public launch blocked. |
| Interaction design | A future trace UI must answer four questions quickly: what happened, what data left, what would change, and how to undo it. Raw receipts alone are too technical. | Medium | Keep current shadow path non-user-visible. |
| Visual design | Three themes are distinct and readable, but the deterministic deck silhouette repeats heavily and contains no meaningful visual evidence. | High | Quality hold, not a safety failure. |
| Presentation craft | The opening/close resolve the requested purpose, while the middle act is generic and does not accumulate audience-specific evidence. | High | StoryBench human/aesthetic cases required for R2. |
| Accessibility | Final exports pass current contrast/font/overflow checks and full-slide inspection. Dark mode remains readable. Broader assistive-technology and device testing remains a launch gate. | Medium | Preview acceptable; public blocker retained. |
| Frontend engineering | The existing immutable deck model and patch scope make a semantic Deck REPL feasible without DOM authority. No direct commit path was added. | Low | R1 implementation accepted. |
| Backend engineering | Explicit Convex validators, digest verification, owner authorization, TTL, and deterministic pruning are sound. Live local QA caught and fixed metadata contamination in telemetry. | High | Regression proof recorded. |
| Security | Global/cohort switches default closed; provider, kernel, network, continuation, and publication remain independently disabled. Bearer owner capability is still not tenant auth. | Critical for public | R1 only; public NO-GO. |
| Reliability/SRE | Cancellation/cleanup contracts and terminal reasons exist, but managed-kernel patching, alerts, SLOs, incident ownership, and disaster recovery are not production-proven. | Critical for managed execution | Managed adapters remain disabled. |
| AI evaluation | Three internal matched cases prove harness behavior and non-regression, not general quality or statistical significance. A zero delta correctly yields HOLD. | High | No benchmark marketing claim. |
| Data/licensing | Current dogfood uses author-owned internal fixtures. External Tier B/C material is not embedded; PPT-Eval still requires exact-file intake manifests. | High | License gate enforced. |
| Growth/marketing | “Editable, reviewable, source-aware” is supportable. “Autonomous professional presentations” is not supported by the present evidence. | High | Marketing boundary documented. |
| Support/operations | Rollback is two environment-variable removals and was exercised locally. User-facing support still needs account identity and audit-log tooling. | High | Runbook ready for controlled preview only. |

## Findings resolved during this pass

1. Duplicate deterministic sequence labels were visible only after native full-slide rendering; fixed and regression-tested.
2. Lowercase user purpose text produced weak opening/closing headlines; sentence-case normalization added.
3. Convex row metadata invalidated trace digest checks inside telemetry; metadata is now stripped before aggregation and the local switch proof passes.
4. Shadow execution was initially guarded by one flag; it now requires independent global and cohort admission, while every other material capability remains separately closed.
5. Managed-provider output was counted after sanitization and provider calls could outlive their wall-time budget; raw-output accounting, abort propagation, bounded cancel/cleanup, and synchronous-error collapse were added and tested.
6. Trace expiration was query-filtered and write-triggered but not guaranteed for inactive decks; an indexed hourly deletion job now drains expired rows in bounded batches.
7. Shadow request envelopes now reject malformed owner capabilities and noncanonical snapshot digests before data access, and quota partitioning uses SHA-256 rather than the legacy non-cryptographic hash.
8. Paired shadow receipts initially trusted their action-supplied baseline digest; persistence now re-verifies it against the stored agent patch, including deck, trace, source, version, operation count, and operation digest.
9. Paired comparison expiry now uses the same indexed hourly physical deletion and bounded draining policy as execution traces.

## Remaining quality gates

- At least five independently reviewed, audience-diverse matched cases before even directional confidence is reported.
- Human presentation-craft and visual-quality review in addition to mechanical StoryBench dimensions.
- Evidence-grounded chart/table cases using the deterministic analysis kernel.
- A trace/taste explanation UI tested with non-technical users.
- Measured repeat-user acceptance, modification-after-accept, stale-conflict, latency, and abandonment rates.
- No automatic continuation, managed kernel, network egress, agentic publication, or public multi-tenant exposure until their separate gates pass.
