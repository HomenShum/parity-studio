# NodeSlide agentic-authoring dogfood

Date: 2026-07-12

## Decision

| Boundary | Decision | Evidence |
| --- | --- | --- |
| R0 local/CI reference path | **GO** | Deck REPL, deterministic analysis kernel, render–observe–repair, taste mismatch, trace, telemetry, controls, and StoryBench fixtures pass without a provider or network. |
| R1 private-preview shadow traces | **GO** | The isolated staging switch exercise proves disabled → enabled → disabled rollback, owner authorization, one bounded trace, deny egress, paired comparison persistence, and zero candidate exposure or commit. |
| R2 reviewed agentic proposals | **HOLD** | Three matched internal cases are safety-clean but evidence-identical to baseline; StoryBench correctly reports a zero-delta hold with insufficient confidence. |
| Public multi-tenant launch | **NO-GO** | Identity, tenant authorization, account lifecycle, share governance, managed-kernel operations, privacy, billing, and incident controls remain explicit blockers. |

No production deployment was changed by this proof.

## What was exercised

- Three audience-specific seven-slide decks: founder, investor, and technical-strategy.
- Native editable PPTX and semantic HTML export for every deck.
- Provider-neutral Deck REPL core inspection and validated, uncommitted local proposals; the R1 server action exposes only opaque proposal metadata.
- Injected no-provider managed-kernel seam exercise with deny egress and confirmed cleanup; live provider execution remains disabled.
- Thirty-day/100-per-deck bounded, digest-bound, redacted execution traces.
- Owner-scoped telemetry grouped by cohort and adapter.
- Default-closed global/cohort/provider/kernel/egress/repair/continuation/trace/publication controls.
- Deterministic no-egress analysis-kernel conformance and cleanup.
- One-attempt render–observe–repair proof over an immutable candidate.
- Target-profile/candidate/render-bound taste-mismatch receipts.
- Matched-case StoryBench comparison with finite scoring, hard safety/budget gates, and no significance claim.

## Native artifact QA

All 21 slides were rendered and inspected individually at full resolution. All three PPTX files pass the presentation overflow checker; all three HTML files contain the expected seven slide regions; every PPTX is a valid OOXML ZIP.

The first render exposed duplicate sequence labels on approach slides (`01 01`, `02 02`, `03 03`) and lowercase outcome headlines. The deterministic fallback was fixed, regression-tested, regenerated, and re-rendered. The final artifacts have no observed clipping, unintended overlap, broken wrapping, duplicate numbering, or footer/page-marker drift.

The fallback remains intentionally conservative and readable, but its repeated two-column composition and generic middle-act copy are not strong enough to promote professional agentic authoring beyond R1 shadow mode. That limitation is recorded rather than hidden behind a perfect mechanical score.

## Proof index

- `agentic-proof.json` — reproducible local/CI core, artifact, StoryBench, kernel, repair, controls, telemetry, and taste receipts.
- `local-switch-proof.json` — isolated Convex disabled/enabled/rollback exercise plus one paired baseline/candidate shadow receipt; owner capability and candidate content omitted.
- `native-artifact-qa.json` — final PPTX/HTML checksums, 21-slide render/overflow results, and resolved visual defects.
- `independent-audit.md` — security/product/reliability verdict, resolved findings, residual holds, and controlled launch sequence.
- `qa-critique.md` — fresh, expert, repeat-user, and senior cross-functional critique.
- `release-checklist.md` — controlled-preview launch boundary and remaining gates.
- `founder.pptx` / `founder.html` — founder/private-preview narrative.
- `investor.pptx` / `investor.html` — investor/strategy narrative.
- `technical.pptx` / `technical.html` — architecture/safety narrative.

## Reproduce

```powershell
pnpm proof:nodeslide:agentic
```

The switch proof defaults to an isolated local Convex backend and refuses remote use unless the caller explicitly confirms isolated staging. It must never be pointed at production:

```powershell
pnpm proof:nodeslide:agentic:local

$env:NODESLIDE_SWITCH_PROOF_DEPLOYMENT='your-isolated-dev-deployment'
$env:NODESLIDE_SWITCH_PROOF_CONVEX_URL='https://your-isolated-dev-deployment.convex.cloud'
node scripts/nodeslide-agentic-local-switch-proof.mjs --isolated-staging
```
