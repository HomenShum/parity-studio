# W6 — NodeSlide reference-trained taste and artifact-contract system

One sentence: NodeSlide must not merely generate slide data; it must autonomously
engineer, render, critique, repair, verify, and export a world-class presentation —
using concrete references and visible proof, never self-declared quality.

The core correction this spec enforces: **"the agent changed some files" is not an
outcome.** Success means the intended story is visibly expressed through the right
slides, charts, graphs, images, sources, and interactions, proven by screenshots and
export — or the agent keeps engineering until it is, or reports honest failure.

## What already exists — extend, do not rebuild

| Capability | Where | Status |
| --- | --- | --- |
| Pixel-bound independent taste judging (UNSCORED without pixels + judge) | `scripts/nodeslide-tastebench.mjs`, `scripts/tests/nodeslide-tastebench.test.mjs` | shipped |
| Sector taste packs (finance, startup) | `docs/specs/nodeslide-sector-taste-packs.md`, `scripts/nodeslide-taste-pack-proof.mjs` | shipped |
| PPTX signature extraction (style tendencies from real decks) | `docs/specs/nodeslide-signature-extractor.md` | shipped |
| Slide-variation harness with axes/diversity | `convex/lib/nodeslideVariationHarness.ts` | shipped |
| Fixed 20-fixture P0 request corpus | TasteBench corpus tests | shipped |
| Deck CI, Turbo authority, multi-agent handoffs, OTel trace spine | PR #39 (`6df8953`) | shipped |
| Journey proof with digest binding | `scripts/nodeslide-journey-proof.mjs`, `shared/nodeslideJourneyProof.ts` | shipped |
| Deterministic checks (overflow, collisions, text fit) | `validateSnapshot`, `estimateTextFit` | shipped |

The delta is everything below.

## Delta 1 — End-to-end artifact contract

Every artifact the user (or story plan) requests must be traced through the complete
chain, and success may only be declared when every link holds:

```
canonical state changed
+ renderer consumed it
+ artifact appeared visually (screenshot proof)
+ data/source binding is correct
+ export still works (PPTX + JSON)
```

Model the proof as a discriminated union — no optional-field soup:

```ts
type ArtifactProof =
  | { status: 'unproven'; artifactId: string }
  | { status: 'state_only'; artifactId: string; version: number }        // schema changed, nothing rendered
  | { status: 'rendered'; artifactId: string; screenshotPath: string }   // visible, bindings unverified
  | { status: 'bound'; artifactId: string; screenshotPath: string; sourceIds: string[] }
  | { status: 'export_verified'; artifactId: string; screenshotPath: string;
      sourceIds: string[]; pptxMediaRef: string }                        // survives PowerPoint
  | { status: 'failed'; artifactId: string; failedLink: 'state' | 'render' | 'binding' | 'export';
      evidence: string };
```

Applies to every primitive: text, chart, graph/diagram (nodes + connectors), uploaded
image, citation, PDF region, table, formula, timeline, comparison, architecture flow,
theme. A capability is only "supported" when it has all seven layers: canonical schema,
typed operation, service method, renderer, validation rule, export implementation, and
a visual proof case. `remoteImageExport.test.ts` (PR #40) is the template for the last
layer — mutation-checked, fails against the broken implementation.

Gate: the agent's success declaration is blocked unless every requested artifact
reaches `export_verified` (or `failed` with honest evidence). Wire this into the
existing journey-proof digest so it cannot be self-reported.

## Delta 2 — Slide archetype registry and classifier

Classify every slide before evaluating it. Fixed registry (frozen enum, additive-only):

```
title | thesis | problem | solution | process_flow | architecture | evidence |
chart | market | comparison | timeline | before_after | product_screenshot |
quote | team | call_to_action | technical_appendix
```

Classifier input: the slide's StorySpec job + element composition. Deterministic
first (rule-based on primitives present), model-assisted only for ambiguity, and the
classification is recorded in the trace so misclassification is inspectable.

## Delta 3 — Reference pack, checked in and archetype-indexed

Primary deck references: **Pitch and Beautiful.ai template galleries**, plus Canva and
Gamma style flows, Apple keynotes, strong startup/research/consulting/product-launch
decks. Product-UX references: **Mobbin** (screens), **Pageflows** (flows), Landbook /
Refero for web aesthetics, plus the already-adopted Figma / Linear / assistant-ui /
Radix mappings.

**Licensing rule (hard):** do not check in scraped screenshots of third-party
templates. The pack stores *extracted decisions*, not pixels: each reference entry is
an annotation record plus a link. Locally captured screenshots may exist in a
gitignored cache for eval runs; they never ship in the repo or in NodeSlide output.
Never copy an exact design — extract reusable decisions only.

Annotation schema per reference (3–10 per archetype):

```ts
type ReferenceAnnotation = {
  id: string;
  archetype: SlideArchetype;
  sourceUrl: string;                    // canonical link, not a mirror
  whyItWorks: string;                   // one paragraph, specific
  focalPoints: number;                  // count, not adjective
  hierarchy: string[];                  // reading order, first = dominant
  density: 'sparse' | 'moderate' | 'dense';
  primitive: string;                    // e.g. 'flow-diagram', 'single-dominant-chart'
  headlineTreatment: string;            // size ratio vs body, tone
  spacingNotes: string;                 // ratios, whitespace strategy
  chartLabeling?: 'direct' | 'legend' | 'none';
  failurePatternsAvoided: string[];     // what this reference does NOT do
};
```

Retrieval: when generating or repairing a slide, fetch references for **that slide's
archetype only** — never the whole gallery. This composes with the existing sector
taste packs (pack = brand direction; references = structural excellence).

## Delta 4 — Four-level scoring

No single vague "design: 8.5". Four levels, each with named criteria scored 0–4
(0 absent, 2 acceptable, 4 exemplary), thresholds enforced per level:

1. **Element** — purpose, clarity, legibility, craft, semantic correctness, source
   integrity, editability. Threshold: no criterion below 2.
2. **Slide** — one clear message, hierarchy, composition balance, density fit,
   primitive correctness, evidence clarity, consistency, audience fit.
   Threshold: mean ≥ 2.5, no criterion below 2.
3. **Deck** — thesis clarity, sequence logic, pacing, narrative tension, evidence
   progression, slide variety, visual rhythm, memorability, decision readiness.
   Threshold: mean ≥ 2.5.
4. **Product UX** — time to first result, discoverability, interruption count,
   composer stability, visible progress, keyboard, mobile, recovery, undo/redo,
   loading states, error clarity, export completion. Gates the app, not the deck:
   a beautiful deck through a miserable interface is a failed product.

Scoring runs under the existing TasteBench evidence policy: deterministic checks are
code, reference comparison and judging are pixel-bound and independent, self-reported
UI strings are inadmissible, missing evidence = UNSCORED (never a passing default —
HONEST_SCORES rule).

## Delta 5 — Pairwise reference comparison → specific repairs

Reference-based evaluation asks three questions, never "is this a 9/10":

```
Which reference is closest to the intended outcome?
What concrete gap remains?
What exact repair would reduce that gap?
```

Repair instructions must be operational, in the existing PatchOperation vocabulary.
Canonical examples of acceptable output:

```
Headline competes with chart title → reduce chart title prominence (update_style).
Five equal focal points → make the chart dominant, demote supporting cards (resize/move).
Legend requires scanning → replace legend with direct labels (update_chart).
Citation disconnected from claim → move source beside the annotation (move).
Cards fragment the composition → remove cards, one open composition (update_slide).
```

"Make it cleaner" is a rejected output. Human pairwise (current vs new, "which better
serves this audience and slide job, and why") feeds the existing preference-events
pipeline (`docs/specs/nodeslide-preference-events.md`); model judges assist but are
not ground truth.

## Delta 6 — Bounded repair loop

```
generate → render → screenshot → evaluate (deterministic + reference) →
identify precise gaps → repair → rerender → re-evaluate
```

```ts
type RepairLoopState =
  | { status: 'evaluating'; attempt: number }
  | { status: 'repairing'; attempt: number; gaps: RepairInstruction[] }
  | { status: 'passed'; attempts: number; finalScores: LevelScores }
  | { status: 'exhausted'; attempts: number; remainingGaps: RepairInstruction[];
      honestSummary: string };  // e.g. "chart implemented and rendered, but the
                                //  slide did not meet the visual threshold after 3 attempts"
```

Max 3 attempts per slide per cycle. `exhausted` is a first-class, user-visible
outcome — false success is the one unforgivable state. Each attempt is an OTel span
on the existing trace spine with screenshot attachments; no second trace model.

## Delta 7 — StorySpec slide-job contract

The story model decides what each slide communicates; the designer decides how;
the renderer proves it exists; the reviewer checks it works. Per-slide contract:

```ts
type SlideJob = {
  slideId: string;
  job: string;                 // "Explain the NodeSlide trust architecture"
  audienceQuestion: string;    // "Why should I trust autonomous changes?"
  keyTakeaway: string;
  requiredEvidence: string[];  // source ids
  visualRelationship: string;  // "a sequential governed pipeline"
  preferredPrimitive: string;  // "flow diagram, not four equal cards"
  allowedDensity: 'sparse' | 'moderate' | 'dense';
};
```

Primitive selection is derived from the SlideJob, not thrown at slides
independently. The agent classifies the request into required primitives up front
("four nodes, three connectors, one caption, one citation, one dominant hierarchy")
and verifies each exists in the final rendered slide via the Delta 1 chain.

## Delta 8 — Fixed benchmark scenarios

Five core scenarios, each fully specified (audience, outcome, evidence pack,
expected story, required primitives, reference archetypes, forbidden claims,
expected interactions, export requirements), each requiring text + chart +
graph/diagram + uploaded image + citations + data + story + theme + export:

1. Technical founder investor deck.
2. Research paper conference talk.
3. Executive metrics update.
4. Product architecture explanation.
5. Evidence refresh after a source changes.

These extend (not replace) the frozen 20-fixture P0 corpus. Run each several times;
compare against the recorded baseline; results append to the existing hash-chained
TasteBench report.

## Delta 9 — Product-UX golden journey (extend existing gates)

Golden journey: landing → request → attach evidence → grant once → create deck →
select element → request change → observe agent activity → see result → undo/redo →
export. For every stage capture: before, immediate response, working, first useful
output, completed, failure, mobile. Blockers (fail the gate): hidden composer,
clipped dialogs, horizontal overflow, unexplained delays, repeated consent prompts,
inaccessible controls, tool-call flooding, unclear progress, dead-end errors,
missing cancellation, broken responsive layouts. Playwright screenshots and
interaction assertions — component unit tests alone are insufficient.

## Build order

Phase order respects reversibility lanes (below): each phase is a small slice that
lands behind existing flags/tests and is cheap to revert.

1. **Artifact pipeline proof** — audit every primitive against the seven layers;
   implement missing chart/graph/image/citation/theme/layout operations; add
   `ArtifactProof` gating; block success declarations without screenshots.
2. **Story-driven generation** — `SlideJob` contract, primitive derivation,
   multi-slide planning.
3. **Reference library** — archetype registry + classifier, annotation records,
   retrieval by archetype. (Research-heavy; can run parallel to Phase 2.)
4. **Evaluation and repair** — four-level scoring, pairwise reference comparison,
   bounded repair loop, honest exhaustion.
5. **Golden-journey UX gates** — extend the existing E2E/QA suite to the full
   stage-state matrix.
6. **Turbo + evidence trust hardening** — already largely shipped; close gaps found
   in Phases 1–5.
7. **Deck CI recurring refresh** — changed-evidence detection → affected claims →
   regenerate only impacted slides → validate → publish/export.

## Development doctrine (how Codex works on this)

**Reversibility lanes.** Fast lane (execute immediately, no approval): UI layout,
copy, styling, slide rendering, chart appearance, tests, covered refactors, flagged
agent behavior — change → render → screenshot → test → compare → repair → commit.
Controlled lane (prepare current/proposed schema, migration, indexes, rollback,
data-volume risk — then wait for review): Convex schema, migrations, canonical
contract changes, breaking API/MCP changes, auth, billing, deletion, publication,
sync semantics, retention/privacy.

**Discriminated unions everywhere important**: agent runs, capture status,
proposals, review policy, export status, workflow stages, tool results, Deck CI
results. Exhaustive switches enforced by lint.

**Pessimistic debugging.** Never "check whether there are bugs." Instead: "Assume
the chart operation silently loses data, the image path breaks export, and the theme
update does not reach every renderer. Trace each path end to end; prove or disprove
each with evidence." (PR #40's FileReader no-op is the canonical example of the bug
class this catches: a guard that silently skips the feature in one runtime.)

**Side quests become issues, not scope.** Unrelated bugs, duplicate schemas, weak
abstractions → structured issue (title, evidence, risk, suggested fix, files,
priority); primary task continues.

**Multi-model cross-validation only for high-impact disagreement**: canonical
architecture, DB changes, security, concurrency, evidence lineage, migrations.
Ordinary implementation = one agent + tests.

**Screenshots are mandatory UI evidence.** Every UI PR: before/after/mobile/
loading/error/long-content. A UI PR without visual evidence is incomplete.

**Post-merge reflection.** After each meaningful PR: what went wrong, what took
longer, which assumption was false, which test would have caught it earlier, which
instruction becomes permanent → update agent instructions, QA fixtures, checks,
reference gallery, dogfood corpus.

## Definition of done (the only success declaration allowed)

```
The requested story is coherent.
Every required artifact exists and reached export_verified (or honest failed).
The canonical state contains them; the renderer visibly displays them.
Each slide meets its reference-based threshold or reports exhausted honestly.
The deck has a coherent visual and narrative arc.
The golden journey is responsive and polished; no blocker defects.
Sources and numeric values are correct; Deck CI passes.
PPTX and JSON export succeed.
Screenshots, trace, citations, and versions prove the work.
The result remains editable and reversible.
```

## Non-goals

- Copying any third-party template's exact design, or redistributing reference pixels.
- A second trace model competing with the OTel spine.
- One-number vanity design scores.
- Model-judge-as-ground-truth (judges assist; deterministic checks and human
  pairwise preference govern).
- Universal "beats Gamma/Canva" claims without same-prompt competitor artifacts
  (the competitive harness exists; claims wait for its evidence).
