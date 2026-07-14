# NodeSlide wave QA journeys

The machine-checked coverage map is `qa/nodeslide-wave-quality.json`. `pnpm qa:manifest`
rejects missing journey files or loss of the 4/10/100 trace-fixture matrix.

- `fresh-landing.spec.ts` runs against a local Vite server or any configured preview. It covers the
  canonical root, model disclosure, attach/remove, basic keyboard/accessibility checks, and
  desktop/tablet/mobile screenshots.
- `editor-review-journey.spec.ts` runs only with `NODESLIDE_E2E_MUTATIONS=1`. CI points it at an
  isolated frontend + Convex preview and covers Enter/Shift+Enter, deterministic no-egress mode,
  proposal-before-version-change, compare, double-accept with exactly one version bump, trace
  attribution, theme switching, responsive screenshots, and reload recovery.
- `TraceWaterfall.test.tsx` owns the available 4/10/100 structured-trace fixtures and runs in the
  Quality unit-test gate.

Screenshots, traces, videos, and the HTML report stay under `test-results/` and
`playwright-report/`; CI uploads them for 14 days. They are intentionally not source-controlled.
