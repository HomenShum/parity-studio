# Post-submission program — CD-inspired upgrades, MDX lens, evidence graph, NodeSlideBench

Written 2026-07-12 (pre-submission). Rule zero: slidelang-challenge FREEZES at the submission tag
(panel-demo bug fixes only). Everything below builds in NodeSlide/parity-studio under owned IP,
porting the challenge repo's proven primitives (EditOp union / applyPatch CAS / storyboard fan-out /
contracts / receipts). References: docs/references/claude-design-observations.md (challenge repo),
docs/specs/{storyboard,communication-contracts,scale-and-media}.md, the launch-readiness report's
StoryBench/Deck-REPL sections.

## Dependency spine
```
A1 timeline_eras archetype ─┐
A2 elicitation chips ───────┼─ independent of each other, all on existing primitives
A3 tweaks toggles ──────────┘
A4 MDX lens ──────────── depends: storyboard (done). Feeds: CLI push, plan-review surface
A5 Bench v0 ──────────── extract proof runner → case files. Feeds: EVERYTHING after (regression gate)
B1 evidence graph ────── the research path IS evidence-graph v1 (they are one workstream)
B2 Bench v1 ──────────── depends: A5 + B1 (source-grounded cases) → one-shot vs storyboard A/B
B3 taste dashboard ───── depends: B2 (mismatch classification needs cases + references)
```

## Phase A — week of Jul 13 (≈3 build days)
A1. `timeline_eras` layout (~4h): phase columns (number/name/date-range header) × milestone blocks
    (icon-slot, date, title, one-liner) + takeaway strip + sources line as first-class blocks.
    Validator gains column-fit/collision checks — the exact failure class Claude Design shipped.
    Contract-aware density: ballroom splits per-phase, boardroom densifies to one slide.
A2. Storyboard elicitation chips (~3h): slide-count slider → slideBudget; layout thumbnails →
    visualIntent defaults; audience chip → contract. All chips are storyboard edits (ops) and
    preference events. No pre-form wall — chips live ON the review screen.
A3. Tweaks toggles (~2h): show/hide derived elements (takeaway, sources, image slots, reveals) as
    inspector toggles compiling to ops — traced, review-consistent, unlike CD's silent mutation.
A4. MDX lens (~5h storyboard, +4h deck+CLI): render storyboard/deck → constrained MDX (allowlisted
    components = primitives; NodeRoom AGENT_ARTIFACTS doctrine: structured data is truth, MDX is a
    renderer). Parse the subset back → diff → ops. Never execute JSX. `slidelang push deck.mdx`.
A5. NodeSlideBench v0 (~6h): promote the 17-stage proof runner into a case-file benchmark —
    categories: generation, scoped editing, visual repair, collaboration/CAS, export, fault
    injection, hardening. Scorecard JSON per run; wired as the regression gate for Phase B.

## Phase B — weeks of Jul 20 + 27
B1. Evidence graph (≈2d): research action (search API + bounded fetches, SSRF-allowlisted) →
    evidence records {claim, url, date, quote-hash} → storyboard evidenceIntent references evidence
    ids → slides render cited source lines; validator: `claim_uncited` for quantitative claims
    (extends the existing `source` code). Tenant-scoped, provenance-chained (harness4visuals
    evaluator discipline: nothing enters memory without passing checks).
B2. Bench v1 (≈2-3d): 20-case rights-tiered pilot (per the StoryBench A/B/C tiers) including
    source-grounded cases; run one-shot planner vs storyboard fan-out on identical cases; measure
    completion, edit locality, citation correctness, receipt cleanliness, cost, latency, human
    acceptance. THE deliverable: a measured claim that the storyboard architecture beats one-shot.
B3. Taste dashboard (≈1-2d): per-case reference vs output vs receipts, mismatch classified to the
    layer that owns the fix (semantic/narrative/visual-mapping/composition/brand/tool/renderer) —
    the loop-engineering surface for taste.

## Fork conditions
- AI Fund offer accepted → B1/B2 become residency milestones under their thesis; NodeSlide stays
  the owned prior-art substrate (carve-out exhibit already drafted).
- No offer / declined → this IS the NodeSlide roadmap; Bench v1's A/B result is the launch-post
  headline and the private-preview cohort (8-12 users) runs on Phase A's build.

## Standing gates (unchanged)
Scenario tests per slice · typecheck+suite green before commit · receipts for every capability ·
adversarial review before ship · prod moves only on ALL_PASS proof · design cards for new UI
(Claude Design project stays in sync).
