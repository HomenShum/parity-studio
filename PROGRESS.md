# PROGRESS — autonomous long-running loop

Handoff notes, maintained by the agent. Pattern: `anthropics/cwc-long-running-agents`
(default-FAIL contract · fresh-context evaluator · agent-maintained handoff).

**Contract:** `qa/goal/longrun.criteria.json`. Every criterion starts `false`. A criterion may only
be flipped by a fresh-context evaluator with **no Write/Edit tools** that did not see the build.
Self-assessment counts as FAIL — this session produced 27 confirmed holes in work that passed its
own author's tests, which is why grading is never done by the builder.

## Why this harness exists

Independent checks have caught, in this session alone:

- a genuine 1×1in chart off-canvas + 49 autoshapes scoring `1 passed / 100% decided`
- every evidence link shipping as the bare anchor `"source"`
- motion check D grading the compiler against the compiler's own manifest
- a `trace.zip` forged in ~40 lines with no browser, passing as `CORROBORATED`
- Check I written as one-role-per-advance when the rule is one state *boundary*
- a design thread turn mislabeled as "latest" when a later turn existed
- thread proposals reported without checking whether they exist in the repo

Every one was found by an outside look, none by self-review. That is the whole argument for the
fresh-context evaluator.

## State

| | |
|---|---|
| parity-studio | `main` — Stage-0 occlusion + knockout logic merged (#78); knockout runner in #79 |
| nodeslide | `main` — brand override (#59) + type/devices (#60) merged |

## Criteria status (all default-FAIL until an evaluator opens evidence)

- **C1 knockout-merged** — #79 open, checks running
- **C2 concept-map** — `docs/design/thread-concept-map.md` written; needs fresh-context verification
- **C3 council-hop** — NOT started. Both threads, and the turn-17 vs turn-19 ownership contradiction
- **C4 storyspec-extension** — NOT started. Must extend `NodeSlideStorySpec`, not add a schema owner
- **C5 trace-provenance** — NOT started. Forged trace still passes; premise corrected on main (#77)
- **C6 no-regression** — not yet graded

## Known-good baselines (so a regression is recognisable)

- Atlas deck: topology 36 passed / 2 declared fallback / 0 violated / 100% decided
- distinctness: 24 distinct / 0 collapse / 0 placeholder / 0 degenerate
- knockout, real renders: clean chart → `causally-primary` (causal 100%); + flattened cover →
  `flattened-duplicate` (causal 0%)
- Known pre-existing failures, not regressions: GitHub Actions runtime policy test; untracked
  `scripts/tests/github-actions-runtime.test.mjs`

## Standing rules

- Absence is `not-run`, never a pass.
- Never grade a producer against its own manifest.
- Re-anchor with the design thread via graph-hop **before** merging a new gate, not after.
- The museum deck (`benchmarks/artifact-atlas/v2`) is frozen — human-attested; never repaint it.
