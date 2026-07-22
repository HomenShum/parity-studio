# Arena reconciliation decision

Date: 2026-07-22. Method: two-thread ChatGPT council (Slide AI Collaboration + NodeKit), both at Pro,
grounded in grepped facts from both repos. Verdict was **convergent** across both threads.

## The situation

Two implementations of the same idea existed:

- **nodeslide (LIVE product repo)** — `scripts/lib/artifact-atlas-core.mjs` is the producer,
  consumed by 4 scripts. Owns a contract *family*: `nodeslide.artifact-showcase-receipt/v1`,
  `nodeslide.model-compare/v1`, `nodeslide.harness-compare/v1`.
- **parity-studio (DEV repo)** — `shared/nodeslideArena.ts`, schema `nodeslide.arena/v1`,
  consumed only by parity tests. Written before the nodeslide core was discovered.

Verified fact that reframed the question: in nodeslide, `comparisonKey` includes `receipt.model`,
so `compareHarnessReceipts` pairs same-model receipts only, and `buildModelCompare` varies model
within one harness run. **The two axes are never crossed. nodeslide prevents confounding by
construction; parity detected it at runtime.**

## Verdict

**1. nodeslide owns the canonical schema. Delete parity's `nodeslide.arena/v1`.**
Both threads, plainly. parity does not get to mint a new `nodeslide.*` schema over nodeslide's
outputs. nodeslide owns a contract *family*, not one umbrella — do not preserve parity's umbrella
schema merely because it looks more general. If a unified envelope is ever wanted, nodeslide
introduces it. Projection flows **nodeslide → parity**: nodeslide emits
`dist/contracts/arena-contracts.generated.ts` + a `.meta.json` carrying source commit + sha256;
parity consumes it, exactly like the MCP `atlas.json` pattern.

**2. Cut the `confounded` verdict.** It is gold-plating in this architecture — it defends against a
cross-axis comparison the design makes unreachable. Replace it with precondition guards that
throw, making the bad comparison *unrepresentable* rather than a warning category:

```ts
// model comparison preconditions
assertSingleHarnessCohort(receipts); assertSingleFixture(receipts);
// harness comparison preconditions
assertSameModel(previous, current); assertHarnessChanged(previous, current);
// on failure
throw new InvalidArenaComparisonError({
  code: 'cross_axis_comparison',
  message: 'Model and harness changed together; attribution is not identifiable.',
});
```

Retain a **negative conformance test**: changing both model and harness must not be able to produce
a harness-winner or model-winner receipt. The word "confounded" may appear in the diagnostic
message; it must never be stored as `{ verdict: "confounded" }` in the canonical workflow. A future
observational-analytics tool over arbitrary historical runs may report non-identifiable attribution
— as `invalid-comparison`, excluded from all benchmark metrics, in a separate report.

**3. Port the two genuinely load-bearing behaviors into nodeslide.** Both P0.

- **Coverage-drop accounting** — nodeslide's matrix reports emitted count but does not explain every
  omitted combination, so "9/9 completed" can be true and experimentally misleading. Port an
  `ArenaCoverage` shape: `fullMatrixCount / plannedCount / attemptedCount / completedCount`, an
  `omitted[]` with a typed reason (`fixture_filter | model_filter | direction_filter | budget_limit
  | unsupported_capability | not_scheduled`), a `failed[]`, `coverageRatio`, `complete`.
- **Null-gate scoring** — an unrun gate must score as unevaluated, never as a pass. Port the
  concept; replace booleans with explicit states rather than importing parity's schema.

The two threads disagreed only on which P0 to do first (Slide AI: coverage-drop; NodeKit:
null-gate). That is a TASTE split with no evidence to separate it — both are P0-keep, order is
immaterial.

## Migration order (deletion is last, not first)

1. Port coverage-drop + null-gate into nodeslide `artifact-atlas-core.mjs` (+ tests). Additive.
2. Convert parity's `compareArenaOutcomes` / `confounded` into guard assertions + a negative
   conformance test.
3. nodeslide emits the contract projection.
4. Delete parity's authored `nodeslide.arena/v1`; parity consumes the projection.

Deleting `shared/nodeslideArena.ts` before step 3 would break `shared/nodeslideAtlas.test.ts` and
leave the parity Arena surface with nothing — so it is sequenced last.

## What this cost / what it caught

The council told me to delete code I had just written (`compareArenaOutcomes`, the `confounded`
verdict) — the second time in one session a council cut something I built. That is the point of
running it: an agent inherits its author's framing and cannot see that the premise ("we need a
runtime confound detector") was already answered structurally in the other repo.
