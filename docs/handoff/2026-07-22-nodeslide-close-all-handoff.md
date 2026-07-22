# 2026-07-22 — NodeSlide close-all handoff

This is the parity-studio pointer, not a second source of truth. Before changing
NodeSlide behavior or release claims, read the canonical NodeSlide `README.md`,
`docs/NEXT_SESSION.md`, `docs/CAPABILITY_PLAN.md`,
`docs/GAP_CLOSURE_2026-07-22.md`, `docs/JSON_TO_HTML_EVOLUTION.md`,
`docs/ops/PRODUCTION_RUNBOOK.md`, and `docs/SUBMISSION_REPLY.md`.

## Repository state and preservation

- parity-studio baseline before this docs-only handoff:
  `d46a5e5df3775e69d796ff084378007fa57b3fbd`; local `main` and `origin/main`
  matched at the audit.
- The primary worktree deliberately retains an untracked, zero-byte `NUL`
  entry. Preserve it during staging and merge; never describe the tree as clean.
- There is one parity-studio worktree and a ten-entry pre-existing stash stack.
  Preserve every stash.
- parity-studio had zero open PRs before this handoff branch.
- Five divergent remote WIP branches contain unique commits and require
  deliberate triage. Do not delete or merge them as housekeeping:
  - `codex/archive-ai-elements-composer-wip-20260716` at `7a0082e`;
  - `codex/nodeslide-integration-all` at `d638d6d`;
  - `codex/nodeslide-openui-quality-v2` at `9d293c5`;
  - `docs/nodeslide-readme` at `f826d4b`;
  - `feat/ai-elements-on-integration` at `56cb708`.

## Canonical NodeSlide closure evidence

- Final NodeSlide `main`:
  `2ea6da37fe8769e8d904926741a0909efc205fe1`.
- Provider qualification hardening landed in
  [PR #46](https://github.com/HomenShum/NodeSlide/pull/46) at
  `5674552ac9bb6905e23d2f7e9e18a1feff2b8645`.
- The first bounded public-Convex retry window landed in
  [PR #47](https://github.com/HomenShum/NodeSlide/pull/47) at
  `4f0155c021719074d33a3c299fef34ee120fc2f4`.
- The longer retry experiment landed in
  [PR #48](https://github.com/HomenShum/NodeSlide/pull/48). Its edge-propagation
  diagnosis was superseded by the transport root cause below.
- [PR #49](https://github.com/HomenShum/NodeSlide/pull/49) fixed every production
  proof client to pass the Convex URL origin, canonicalized retention-receipt
  digests across wire key reordering, restored a four-attempt/one-second bounded
  identity retry, and routed the deterministic fallback chart through typed
  ArtifactSpec authorship. It produced the final main SHA above.
- Exact-main [CI](https://github.com/HomenShum/NodeSlide/actions/runs/29943204880),
  [node-platform conformance](https://github.com/HomenShum/NodeSlide/actions/runs/29943205271),
  and [production deployment](https://github.com/HomenShum/NodeSlide/actions/runs/29943695512)
  passed for that final SHA.
- Final deterministic production receipt: `passed` for exact frontend and
  Convex backend SHA `2ea6da37fe8769e8d904926741a0909efc205fe1`.
- The live journey passed deployment identity, landing, deterministic creation,
  edit/commit, persisted reload, ArtifactSpec/NodeGym shadow, editable PPTX
  export, and final exact-main recheck.
- The shadow observed one canonical chart and two authored bindings without a
  user-visible mutation or auto-apply; the PPTX retained one editable chart.
- Cleanup proved `retentionSafe: true`, `remainingDeckRows: 0`,
  `remainingSourceRows: 0`, and `deletedRowCount: 96`; sanitized receipt digest:
  `sha256:ac4f80a12c326c8a039a25de2a3650859e582f12f24b58f39a46a529e35db34c`.

## Honest production-matrix state

The bounded manual evidence matrix at workflow run `29933154429` remains red:

- the deterministic lane stopped at deployment identity before creation, with
  a retention-safe no-op cleanup;
- offered routes returned usable text for 7 of 8 routes;
- zero-priced routes returned usable text for 4 of 5 text probes;
- zero-priced routes passed 3 of 5 structured probes;
- viewport/theme UI QA passed 6 of 6 captures;
- sanitized log evidence passed 50 of 50 retained events.

The two-attempt external fleet budget was exhausted. Do not run a third fleet
matrix merely to turn the ledger green. The final deterministic proof closes
deployment-edge verification only; it cannot qualify failed model routes.
NodeSlide issue #42 therefore remains open for bounded route-specific follow-up.

## Closed implementation boundaries

- The failed identity runs were not public-edge propagation. `URL.href` retained
  a trailing slash and ConvexHttpClient appended `/api/query` or `/api/mutation`,
  producing an invalid double-slash path. Production probe and NodeGym shadow,
  evidence, and cleanup clients now pass `URL.origin`; static regressions forbid
  `.href` at those boundaries.
- Identity retry is again four attempts at one-second intervals. A long retry
  window would hide endpoint or transport defects rather than strengthen proof.
- Retention receipts hash recursively key-sorted canonical JSON, so Convex wire
  key ordering cannot invalidate an otherwise authentic zero-retention receipt.
- Kimi uses current provider metadata, a route-appropriate low reasoning budget,
  and no unsupported temperature parameter.
- Structured OpenRouter qualification requires parameter support and allows
  exactly one prompt-only fallback. Provider diagnostics are narrowed,
  allowlisted, and sanitized.
- Typed ArtifactSpec boundaries, executable Gym harnesses, assistant-stream
  monotonicity and nested-handoff closure, stale-redeploy UX, production-log
  observability, isolated Convex component proof, mounted NodeRoom authorization,
  the full consumer journey, and immutable install/upgrade proof are recorded in
  the canonical NodeSlide ledgers. This pointer does not duplicate their claim
  details or widen them.
- NodeSlide now auto-deletes merged branches. `main` is admin-enforced and
  strict, requires the five proven CI/MCP/NodeRoom/conformance/security checks,
  requires the PR path and resolved conversations with zero mandatory approvals
  for the solo repository, requires linear history, and forbids force pushes or
  deletion. The production environment remains restricted to `main`.

## Immutable package and NodeRoom adoption

- `@nodekit/gym-core` has an exact packed `0.0.1 -> 0.1.0` install/upgrade proof
  in isolated NodeSlide and NodeRoom-domain consumers.
- Candidate SHA-256:
  `b8c14013a54fc7419ebfda806553573c4b6e3d1dde2a17f11a61f5ddd88fc0c2`.
- Candidate npm integrity:
  `sha512-jzQ7eapfnmwnBJZyh0SfOJkXhGFHDRQo30uU3rpRAWwp7T8QcP6OwloLTciTsvr4ICEHDMmNM+JoouELSHMa1Q==`.
- Direct NodeRoom adoption landed in
  [PR #242](https://github.com/HomenShum/NodeRoom/pull/242) at
  `c9b699f416a68dfe29298d62b6559690c7ccaa6a`.
- The warning-free action-runtime follow-up landed in
  [PR #243](https://github.com/HomenShum/NodeRoom/pull/243); current NodeRoom
  `main` is `83f9b7442065652208f3a641e65bfed2752d5d13`. Exact-main CI,
  conformance, ProofLoop, and mounted-consumer coordinates remain in the
  canonical NodeSlide docs.

## Atlas and release truth

The expanded Artifact Atlas V3 is NodeSlide-owned at
`outputs/artifact-atlas-v3/nodeslide-artifact-atlas-v3.pptx`, with SHA-256
`AEB63576335EB26A95C4D408877B6E17AEED48F2FCFB0F7ADF83302067065053`.

Its literal decision state remains:

- `publicReleaseApproved: false`;
- `promotionEligible: false`;
- `autoApply: false`.

Artifact existence, automated inspection, or one deterministic control pair is
not human taste approval, fleet qualification, routing approval, or a public
release decision.

## Human and external gates

The remaining gates require authority or evidence that code cannot fabricate:

1. Authorized protected fixtures, an explicit spend cap, and a
   coverage-balanced live matrix with at least three stable matched repetitions.
2. Real blind comprehension and preference judgments for eligible pairs.
3. Stable challenger and ceiling evidence before champion/challenger use.
4. Separate approval for any production-routing change or public Atlas release.
5. Separately authorized licensed and consented data, privacy/deletion controls,
   clean holdouts, contamination checks, budget, and experiment approval before
   any fine-tuning.

These are intentionally open human/external gates, not hidden implementation
gaps and not permission to auto-promote.

## Mirror disposition

Mirror shared product behavior in `shared/`, `src/domains/nodeslide/`, and the
relevant application Convex seams. Do not mechanically copy NodeSlide-owned
packages, Gym or Atlas material, MCP, production workflows/probes, registry and
installer assets, isolated component-install material, or deployment-identity
configuration.

Behavior parity is the contract. The two repositories may retain different
module seams where their application shells differ; every future port still
needs the smallest equivalent regression and the full relevant parity gate.

## Communication truth

This closeout created or sent no new Mike message. The canonical NodeSlide
ledger records the prior human confirmation that the existing repository draft
was already sent; `docs/SUBMISSION_REPLY.md` remains the repository record.

## House rules

Root-cause before fixing; verify the live DOM after every deployment; assert a
concrete signal rather than trusting a caption or log; keep checkmarks literal;
and preserve failed evidence instead of rewriting history. The standalone
NodeSlide deployment is the canonical product. parity-studio remains the
dev-monorepo behavior mirror, not a second production truth source.
