# NodeSlide agentic-authoring controlled-preview checklist

Date: 2026-07-11

## Required before merge/deployment

- [x] Provider-neutral semantic Deck REPL leaves canonical state immutable.
- [x] Exact deck/slide/element clocks, scope, and locks are enforced.
- [x] Execution traces have explicit schema validation, digest binding, redaction, indexed scheduled 30-day deletion, and a 100-per-deck cap.
- [x] Owner-scoped trace list and telemetry summary expose no owner capability.
- [x] Global and cohort admission default closed.
- [x] Ordinary edit planning is separated from persistence without changing the baseline proposal contract.
- [x] Same-turn shadow candidates use an independent deterministic planner, one cloned snapshot, and a digest-only paired receipt; candidate failure cannot abort the persisted baseline.
- [x] Provider, kernel, egress, repair, continuation, full-trace, and publication switches default closed independently.
- [x] Deterministic analysis-kernel conformance and cleanup pass.
- [x] Render–observe–repair cycle/no-progress/stale/budget paths are tested.
- [x] StoryBench blocks unsafe, over-budget, incomplete, or unlicensed cases.
- [x] Taste receipts bind profile, snapshot, render, violations, proposal, blockers, and human decision provenance.
- [x] Founder, investor, and technical HTML/PPTX artifacts generated.
- [x] Twenty-one native slides individually inspected; all three PPTX files pass overflow checks.
- [ ] Re-run the isolated local disabled → enabled → disabled rollback exercise on the exact final diff; port 3210 was unavailable in this session.
- [x] Unit and deterministic proof paths show enabled baseline edits produce one same-input/same-snapshot opaque comparison while candidate operations remain unexposed and uncommitted.
- [x] Full repository gates pass on the final diff (343 tests, Biome, TypeScript/Vite build).
- [x] Independent final security/product/reliability audit records no private-preview code P0/P1/P2 blocker; R1 remains conditional on exact-commit staging exercise.
- [ ] Reviewed branch is merged and the exact commit is deployed with an audit message.

## R1 deployment posture

Only these switches may be enabled for the audited internal/private cohort:

- `NODESLIDE_AGENTIC_GLOBAL_ENABLED=true`
- `NODESLIDE_AGENTIC_SHADOW_ENABLED=true`

Every other `NODESLIDE_AGENTIC_*` control remains absent. The action can inspect and validate proposal candidates against a cloned snapshot, but returns only opaque counts and digests; it cannot expose operations, accept, commit, or publish them.

## Explicit holds

- R2 reviewed agentic proposals: **HOLD** pending quality and human-review evidence.
- R3 deterministic analysis in user workflows: **HOLD** pending server integration and case expansion.
- R4 provider-managed kernels: **NO-GO**.
- R5 render–observe–repair cohort: **NO-GO**.
- Public multi-tenant launch: **NO-GO**.
