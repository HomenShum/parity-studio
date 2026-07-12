# NodeSlide agentic-authoring independent launch audit

Date: 2026-07-11
Branch: `codex/nodeslide-agentic-authoring`
Base: `origin/main` at `59e8c88e0e4d7c586dd2193637d07878a166208b` (0 commits behind at final audit)
Production changed by this audit: **no**

## Verdict

| Boundary | Verdict | Audit disposition |
| --- | --- | --- |
| R0 local/CI reference implementation | **GO** | Pure Deck REPL, deterministic kernel, managed-kernel seam, paired shadow evidence, repair loop, StoryBench, taste receipts, controls, traces, and telemetry are reproducible without provider or network access. |
| R1 controlled private-preview shadow | **CONDITIONAL GO** | Code and isolated-local switch evidence have no open P0/P1/P2 blocker. Merge and deploy the exact reviewed commit with every flag absent, then pass the runbook's production-like staging enable/observe/rollback exercise before cohort enablement. |
| R2 reviewed agentic candidate experience | **HOLD** | Safety infrastructure is ready for evaluation, but three internal cases show no quality gain and do not support a professional-authoring promotion. |
| R3 deterministic analysis in user workflows | **HOLD** | The pure adapter is proven; server workflow integration and data-grounded cases are not. |
| R4 provider-managed analysis kernels | **NO-GO** | The injected boundary is bounded and tested, but no live transport, provider operational review, isolation proof, DNS/SSRF defense, artifact-malware path, or retention approval is enabled. |
| R5 render–observe–repair cohort | **NO-GO** | The pure loop is proven, but no server integration or user-review surface is launched. |
| Public multi-tenant NodeSlide | **NO-GO** | Identity, tenancy, revocation, lifecycle/privacy, sharing governance, billing, abuse, accessibility, SLO, legal, and incident gates remain open. |

## Evidence reviewed

- `343/343` automated tests passed across 54 files.
- Convex TypeScript and repository TypeScript checks passed with no errors.
- Biome passed on the full repository.
- Production Vite build passed. Existing non-blocking warnings remain for the `vendor → zip → react → vendor` circular chunk and a main chunk above 500 kB.
- `pnpm audit --prod` reported no known vulnerabilities.
- Convex code generation passed against the isolated local deployment; production was not deployed or mutated.
- `git diff --check` passed and the branch was confirmed 0 commits behind current `origin/main`.
- Isolated Convex proof passed disabled → enabled → disabled, owner authorization, one no-egress execution trace, telemetry aggregation, one same-input/same-snapshot paired edit receipt, candidate non-disclosure/non-commit, and rollback.
- Three audience-specific decks produced 21 native slides. Every slide was inspected at original 1920×1080 render resolution; all three PPTX files passed padded-canvas overflow checks and their recorded SHA-256 hashes match the final files.
- StoryBench's three matched internal cases are safety-clean and score-identical to baseline. The recorded decision remains **HOLD** and makes no statistical-significance or benchmark-leadership claim.

## Security and reliability findings resolved

1. Shadow execution requires exact global and cohort admission, while provider planning, kernels, egress, repair, continuation, full traces, and publication remain independently closed.
2. Public shadow requests reject malformed owner capabilities, oversized command envelopes, and noncanonical snapshot digests before deck access; owner quota partitioning uses SHA-256.
3. Candidate operations stay in process memory only. Public receipts, persisted execution traces, paired comparisons, and local proof artifacts contain counts/digests but no candidate operations or candidate text.
4. Same-turn comparisons bind one immutable snapshot and turn digest to an already-persisted baseline patch; persistence independently re-verifies deck, trace, source, version, operation count, and operation digest.
5. Execution traces and paired comparisons have explicit validators, full SHA-256 bindings, owner-scoped reads, 30-day expiry, 100-per-deck caps, indexed hourly physical deletion, and bounded backlog draining.
6. Managed-provider calls now propagate abort signals, enforce wall-time return, bound cancel/cleanup grace, account for raw output before sanitization, collapse synchronous/asynchronous adapter errors, deny egress by default, and require canonical consent/public-host policy for future egress traces.
7. Native rendering caught duplicate sequence labels and weak lowercase outcome headlines; both were fixed, regression-tested, regenerated, and re-inspected.

## Residual risks and holds

- Owner/share bearer capabilities are appropriate only for the current private preview; they are not account identity or tenant authorization.
- The enabled R1 lane still awaits an exact-commit production-like staging switch exercise and operational ownership. Local proof is necessary but not a substitute.
- Three first-party cases validate harness behavior, not general quality. Human presentation-craft review, audience-diverse cases, charts/tables from real evidence, and repeat-user outcome metrics remain required.
- The deterministic fallback is readable and editable but visibly templated, with repeated two-column silhouettes and generic middle-act copy.
- Users do not yet have a plain-language trace/taste surface answering what happened, what data left, what would change, and how to undo it.
- Future allowlisted network execution requires resolution-time private-address blocking, redirect controls, DNS-rebinding defenses, request/response limits, and incident testing in addition to hostname syntax checks.
- Bundle-size/circular-chunk warnings are not private-preview blockers but should be owned before broader traffic.

## Controlled launch sequence

1. Merge only after review of this exact diff; record the resulting commit.
2. Deploy with every `NODESLIDE_AGENTIC_*` variable absent and verify existing baseline creation/edit/export paths.
3. Run the staging section of `docs/handoff/nodeslide-agentic-private-preview-runbook.md` on a disposable owner-authorized deck.
4. Confirm zero candidate disclosure/commit, zero egress, bounded retention, one baseline-bound comparison, telemetry, and successful disable rollback.
5. Enable only `NODESLIDE_AGENTIC_GLOBAL_ENABLED=true`, then `NODESLIDE_AGENTIC_SHADOW_ENABLED=true`, for the named internal cohort.
6. Monitor daily and remove cohort then global immediately on any unauthorized read, canonical mutation, secret exposure, nonzero egress, digest/binding failure, retention escape, unexpected provider cost, or cleanup failure.

No evidence in this audit authorizes R2, managed execution, automatic repair, agentic publication, or public multi-tenant launch.
