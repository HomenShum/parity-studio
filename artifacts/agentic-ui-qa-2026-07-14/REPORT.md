# NodeSlide Agentic UI QA — Luna bounded verification

Date: 2026-07-14  ·  branch: `codex/nodeslide-launch-consolidation`  ·  starting commit: `c455a8f`

This lane audited the inherited 13-finding set against the current source contracts and QA artifacts. The set is the 12 fingerprints reported by `qa-memory open` plus the latest fixed consent fingerprint `8ef0554fb31a`. The compact machine-readable disposition is [.qa/agentic-ui-qa-2026-07-14-closure.json](../../.qa/agentic-ui-qa-2026-07-14-closure.json).

## Scope and coordination

Owned changes are limited to `.qa/**`, this QA report/artifact namespace, and the trace-scale E2E harness. The shared working tree also contains uncommitted application edits owned by other workers; they were not edited, staged, classified as findings, or reverted.

## Finding disposition

Closed with current-tree proof: `8ef0554fb31a` consent, `49f5a47d7d92` JSON proposal gate, `57d77d43bf12` web capability labeling, `0bd8f84d923b` Google Slides labeling, `982a14dc350c` memory relevance, `7a710ac5a3bf` claim/source binding, `c52eb8abbbcb` provider-throw test coverage, and `917fd51ccde2` bounded multi-slide scope.

Kept open: `a36cdd9af48d` live-edit reliability and `7e76440c659b` deployed error copy both need a post-deploy live artifact; `289f05a2f53b` remains open because exact-10 and 1,000-span screenshots show large black rendering regions despite passing machine checks; `de3f2ddaf973` remains a partial DEPTH baseline because several D dimensions are still not end-to-end; `c29c6c5c8d42` remains open because export-my-data is not implemented. No application-source fix was made in this lane.

## Required trace proof

The owned spec is [trace-waterfall-scale.spec.ts](../../tests/e2e/trace-waterfall-scale.spec.ts). It runs exact 4-, 10-, and 100-span compact/expanded journeys and the existing 250-loaded/1,000-total stress journey. The final command was run after the shared application tree returned to a compiling state:

```text
pnpm exec playwright test tests/e2e/trace-waterfall-scale.spec.ts
```

Expected committed proof paths after that command:

- `artifacts/agentic-ui-qa-2026-07-14/trace-scale/exact-4-compact.png`
- `artifacts/agentic-ui-qa-2026-07-14/trace-scale/exact-4-expanded.png`
- `artifacts/agentic-ui-qa-2026-07-14/trace-scale/exact-10-compact.png`
- `artifacts/agentic-ui-qa-2026-07-14/trace-scale/exact-10-expanded.png`
- `artifacts/agentic-ui-qa-2026-07-14/trace-scale/exact-100-compact.png`
- `artifacts/agentic-ui-qa-2026-07-14/trace-scale/exact-100-expanded.png`
- `artifacts/agentic-ui-qa-2026-07-14/trace-scale/high-volume-1000-expanded.png`
- `artifacts/agentic-ui-qa-2026-07-14/trace-scale/metrics.json`

An earlier pre-coordination run of the unchanged harness passed all four journeys, but it is not used as the final verdict because the shared tree changed afterward. The final verdict must use the paths above and the post-coordination exit code.

Final post-coordination result: `pnpm typecheck` passed; `pnpm exec playwright test tests/e2e/trace-waterfall-scale.spec.ts` passed 4/4 in 13.6 seconds; the focused finding suite passed 12/12 files and 145/145 tests. The full `pnpm test` gate is shared-tree blocked: 109 files ran, 768 tests passed, and 4 failures remained in other workers' changing `nodeslideEditShadowAction.test.ts` and `nodeslideConsentUi.test.tsx`; those failures were not treated as product findings or modified here.

## Memory protocol

Pass-start `qa-memory init`, `regressions`, and `open` completed. Final trace proof and focused finding checks completed; end-of-pass `add-finding` events and `add-run` are appended in `.qa/memory/` after this report update.
