# NodeSlide R1 agentic shadow runbook

Date: 2026-07-11

## Scope

This runbook covers only R1 private-preview shadow traces and paired edit comparisons. The Deck REPL executes semantic commands against a cloned, owner-authorized snapshot, returns only opaque non-committing receipts, persists bounded digest-only evidence, and has no candidate-operation disclosure or accept/commit/publish authority. The normal single-shot edit proposal remains the only user-visible lane.

Do not use this runbook to enable provider planning, managed kernels, network egress, automatic continuation, repair loops, full trace payloads, agentic publication, or public multi-tenant access.

## Preflight

1. Confirm the exact reviewed commit and clean CI result.
2. Run `pnpm proof:nodeslide:agentic`.
3. On an isolated local/staging deployment, run `pnpm proof:nodeslide:agentic:local` and inspect `docs/dogfood/nodeslide-agentic-authoring/local-switch-proof.json`.
4. Confirm provider/kernel/egress/repair/continuation/full-trace/publication variables are absent.
5. Confirm production owner/share capabilities and provider keys are not present in logs or proof artifacts.
6. Record deployment owner, start time, cohort, rollback owner, and incident channel.

## Enable R1

Set only:

```powershell
pnpm exec convex env set NODESLIDE_AGENTIC_GLOBAL_ENABLED true
pnpm exec convex env set NODESLIDE_AGENTIC_SHADOW_ENABLED true
```

Enable global first and cohort second. Until both are exactly the lowercase string `true`, shadow execution remains disabled. Missing, malformed, uppercase, numeric, or partial values fail closed.

The current cohort switch is deployment-wide, not an actor/deck bucket. Use a dedicated isolated private-preview deployment: once both flags are enabled, every successful baseline edit in that deployment is eligible for shadow comparison.

## Verify

For a disposable owner-authorized deck:

1. Execute one `inspect_deck` shadow session.
2. Confirm terminal reason `completed`, zero proposals for inspect-only input, and no canonical deck-version change.
3. Confirm one trace with cohort `private-preview-shadow`, adapter `nodeslide/deck-repl-shadow-probe`, egress `deny`, empty hosts, and cleanup confirmed.
4. Confirm owner-scoped telemetry increments one request/completion and zero egress/cleanup failures.
5. Probe a stale snapshot digest and confirm a stopped trace with no proposal or commit.
6. Probe a wrong owner capability and confirm no deck existence or trace is disclosed.
7. Run one ordinary baseline edit and confirm exactly one same-input/same-snapshot comparison is bound to its persisted baseline patch; candidate operations and content must be absent and `candidateExposed`/`candidateCommitted` must both be false.
7. Submit one ordinary `proposeEdit` request with an exact quoted copy replacement. Confirm the normal baseline proposal is returned unchanged and remains awaiting review.
8. Confirm the atomic baseline trace records `shadowComparisonExpected: true` plus the same input/snapshot/control digests. Then confirm one linked scheduled `nodeslide_shadow_comparisons` row with baseline and candidate adapter versions, bounded outcomes/counts, `candidateExposed: false`, and `candidateCommitted: false`.
9. Confirm the comparison contains no instruction, provider prose, raw operation, owner capability, or candidate text; only canonical `turn_sha256:`, `snap_sha256:`, `controls_sha256:`, `ops_sha256:`, and `comparison_sha256:` bindings.
10. Force comparison persistence to fail in an isolated test deployment and confirm the already-persisted baseline proposal is still returned and no candidate patch/deck version exists.

## Monitor

Minimum R1 review cadence is daily while enabled:

- requests/completions/stops by terminal reason;
- stale and invalid-command rates;
- step/input/output/operation/elapsed budgets;
- cleanup failures (expected zero);
- egress sessions (must remain zero);
- trace retention count and expiration behavior;
- paired-comparison outcomes by baseline/candidate adapter and terminal reason;
- baseline traces where `shadowComparisonExpected` is true but the scheduled comparison row is missing;
- comparison retention count and expiration behavior (30 days and 100 rows per deck);
- exact-match and different-digest rates derived from paired operation digests;
- hourly expiration-job health and bounded backlog drain;
- any secret-like content in logs or support reports;
- user-reported confusion between proposal and committed change.

Pause immediately on any unauthorized read, canonical-state mutation, secret exposure, nonzero egress, digest failure, trace-retention escape, cleanup failure, or unexplained cost/provider activity.

## Roll back

Remove cohort first and global second:

```powershell
pnpm exec convex env remove NODESLIDE_AGENTIC_SHADOW_ENABLED
pnpm exec convex env remove NODESLIDE_AGENTIC_GLOBAL_ENABLED
```

Then verify a standalone shadow request returns `feature_disabled` before validation or data access, while ordinary `proposeEdit` still returns its baseline proposal without writing a comparison row. Do not delete safety traces or comparisons during incident triage; preserve the bounded receipts under the normal 30-day/100-per-deck policies unless legal/privacy response requires a documented deletion.

## Incident triage

1. Disable both switches.
2. Record deployment, commit, cohort, time window, terminal reasons, adapter versions, and trace digests—never owner capabilities or provider credentials.
3. Separate confidentiality, integrity, availability, cost, and quality incidents.
4. Preserve bounded traces and relevant deployment audit logs.
5. Rotate affected owner/share capabilities or provider keys if exposure is suspected.
6. Require a regression test, local switch proof, full gates, and independent review before re-enable.

## Public boundary

R1 does not waive account identity, tenant membership, authorization revocation, lifecycle/privacy, share governance, billing, managed-kernel isolation, source-ingestion, accessibility, SLO, legal, or incident-ownership requirements. Public multi-tenant launch remains NO-GO.
