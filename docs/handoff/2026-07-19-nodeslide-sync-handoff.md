# 2026-07-19 — NodeSlide sync handoff (updated 2026-07-20)

This is the parity-studio pointer, not a second source of truth. Read the
canonical NodeSlide `docs/NEXT_SESSION.md`, `docs/CAPABILITY_PLAN.md`, and
`docs/EXTRACTION_BOUNDARY.md` before changing NodeSlide product behavior.

## State at this handoff

- parity-studio code baseline: `de4a67585f9040db95b2af7caeae69c92894e4e5`
  before this docs-only handoff commit. The full mirrored suite passed:
  **1,494 tests across 198 files**, plus release and UI gates.
- NodeSlide product-code baseline: `12a8527cb99adf5e80af2302a53332509ce7c283`
  (merged PR #23 and manually deployed to production Convex). Final NodeSlide
  main with the docs-only deployment proof is
  `5d5e2035944b04fcedfa43610883d0b683190167`. Production is
  https://nodeslide.vercel.app with Convex `agile-stoat-411`.
- NodeRoom product-code baseline:
  `4a4a3c259ddfa96e51b8194685a7c3b9ff56c384`; the v3 proof-contract
  checkpoint is `332149ef4ac945546479d08d328d3f43378b3831`.
  Its packed-consumer proof harness is operation-v1-only; the legacy-v0 bridge
  is removed and the fixture authorizer fails closed on invalid call shapes.
  Proof vocabulary is literal: same-instance in-memory reread and ledger, plus
  a portable snapshot JSON round-trip; durable persistence and package-reload
  proof remain false.
- The primary parity-studio worktree deliberately retains an untracked `NUL`
  entry. Preserve it while fast-forwarding main; do not describe that tree as
  clean.

## Mirror rule

Mirror shared product behavior in `shared/`, `src/domains/nodeslide/`, and
relevant application Convex code. Do not mechanically mirror NodeSlide-owned
`packages/`, `mcp/`, production workflows/probes, registry/installer assets,
isolated component-install material, or product-specific deployment adapters.

Behavior parity is the contract. The two repos can have different module seams
where their application shells differ; every port still needs the smallest
equivalent regression and the full relevant parity gate.

## Mirrored product behavior now present here

- Judged variations (B5), the dev-only B6 creation-fault seed, typeset-math/C4
  seed behavior, BYOK image generation (E2), crop/focal controls (E3), and the
  stale-redeploy reload experience.
- Portable PPTX display-font handling: Fraunces remains canonical in the deck
  model/browser, while PowerPoint export maps the display face to Georgia at
  the PPTX boundary. The exact headline-shaped regression prevents duplicate
  wrapping and snapshot mutation.
- The earlier project-dialog centering/body-collapse repair remains mirrored:
  native `<dialog>` needs `inset: 0; margin: auto` plus a definite height so its
  `minmax(0,1fr)` body row does not collapse.

## Intentionally NodeSlide-owned

NodeSlide package extraction, MCP, production workflows/probes, registry and
installer assets, isolated component-install material, repository
authorization-spine adapters, and product deployment configuration are not
mechanical parity-studio copies. Mirror only application behavior that crosses
the bounded rule above.

NodeSlide's licensed Openverse search is not present in parity-studio at this
checkpoint: there is no search handler, result contract, or remote-URL fallback
seam to patch here. The shared, actively used image-ingestion seam does mirror
the bounded multi-pass raster compression and accepted MIME envelope, so image
uploads and attached AI-read images now shrink until they fit the patch limit
or fail closed with an explicit error.

## Preserved work and PR truth

- NodeSlide has zero open PRs; parity-studio should have zero after this handoff
  PR merges.
- NodeRoom intentionally retains unrelated draft PRs #182, #190, and #219.
- Five unmerged parity-studio remote branches remain for deliberate triage:
  `codex/archive-ai-elements-composer-wip-20260716`,
  `codex/nodeslide-integration-all`, `codex/nodeslide-openui-quality-v2`,
  `docs/nodeslide-readme`, and `feat/ai-elements-on-integration`. Do not delete
  them as cleanup without reviewing their unique commits.

## House rules

Root-cause before fixing; live-DOM verify production after deploy; assert a
concrete signal rather than trusting a log or caption; keep checkmarks literal;
and run the full relevant gates per behavior-mirror commit. The standalone
NodeSlide deployment is the canonical live product. parity-studio remains the
dev-monorepo behavior mirror, not an alternate production demo.
