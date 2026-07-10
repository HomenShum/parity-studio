# Pillars Pre-Build — Codex Agent Orchestration Plan

Date: 2026-07-10. Phase: pre-prompt window (after EIR acceptance email, before Build Challenge prompt arrives). Everything here is Homen's own product work on NodeSlide, committed to this repo. Nothing here is a challenge deliverable.

## 0. Objective and constraint

Build the prompt-independent pillars (signature transposition, variations, taste packs, preference loop) into NodeSlide now, so that (a) the product compounds regardless of the AI Fund outcome, (b) every piece is timestamped prior art before any agreement exists, and (c) the future 48h challenge becomes assembly + wedge thinking instead of greenfield engineering.

Hard constraint: when the challenge prompt arrives, challenge deliverables are built in a FRESH repo that may depend on published packages from this work but contains no copied code. See docs/prior-art-inventory-2026-07-10.md.

## 1. Roles

| Role | Who | Does |
|---|---|---|
| Orchestrator / architect / reviewer | Claude Fable (this session lineage) | Writes specs + interface contracts + scenario tests BEFORE delegation, reviews every diff (/code-review + 8-point agentic reliability checklist), runs research fan-outs, maintains this plan, commits |
| Deep implementer | Codex (gpt-5.6-sol, current deepswe #1) via codex-rescue subagent | Implements each workstream against a frozen spec, returns diffs + passing tests + a self-report of deviations from spec |
| Decision owner | Homen | Taste calls, scope cuts, kill decisions, anything outward-facing (publish, push, email) |

Delegation is by outcome, not task: each workstream hands Codex a goal, a contract, done-criteria, and test scenarios. Codex chooses the how. Verification is by artifact only (diff, test run, receipt JSON), never by status claim.

## 2. Orchestration loop (every workstream)

```
SPEC (Fable) → DELEGATE (Codex) → VERIFY (Fable) → DOGFOOD (both) → COMMIT (Fable, Homen approves push)
```

1. **SPEC** — Fable writes `docs/specs/<workstream>.md`: interface contract (types first), done-criteria, scenario-based test list (happy, sad, adversarial, concurrent, degraded; burst AND sustained), explicit non-goals. Spec is frozen before delegation. Scope changes require a new spec revision, not silent drift.
2. **DELEGATE** — one codex-rescue invocation per workstream with: the spec verbatim, pointers to existing contracts it must not break (shared/nodeslide.ts, nodeslidePatch.ts, validator receipt shape), and the command gates it must pass (`tsc --noEmit` 0 errors, `vitest` 0 failures, biome clean).
3. **VERIFY** — Fable runs /code-review on the diff, then the 8-point checklist (BOUND, HONEST_STATUS, HONEST_SCORES, TIMEOUT, SSRF, BOUND_READ, ERROR_BOUNDARY, DETERMINISTIC). Any P0 (crash / SSRF / false data) goes back to Codex same cycle. Findings are fixed, never waived.
4. **DOGFOOD** — run the feature against the golden project (slidelang-projects/nodeslide-golden) and one hostile input (see per-workstream fixtures). Extend scripts/nodeslide-proof.mjs so the proof is reproducible, receipts land in docs/dogfood/.
5. **COMMIT** — one commit per workstream slice with receipts referenced in the message. Push only on Homen's standing or explicit approval.

Binary gate per workstream: the single metric below improves or the change reverts. No partial credit.

## 3. Workstreams

### W1 — Signature extractor: PPTX/style-source → design tokens (Pillar 1 core)
- **Goal**: `extractSignature(input) → SignatureProfile` where input is a .pptx file (parse OOXML: theme1.xml palette, fontScheme, slide masters/layouts, actual usage frequencies), a style-guide PDF (vision/LLM pass → tokens), or screenshots (vision pass → palette, type scale, spacing, density).
- **Contract**: `SignatureProfile` = W3C Design Tokens format + layout-tendency stats + provenance (which source produced each token). New file `shared/nodeslideSignature.ts`. Deterministic for the PPTX path (no LLM needed); LLM paths return confidence-scored tokens, never fabricated certainty (HONEST_SCORES).
- **Metric**: on 3 real reference decks, extracted palette/fonts match a hand-audit ≥ 90% of tokens.
- **Scenario tests**: corrupt pptx, empty deck, 200-slide deck (BOUND + TIMEOUT), pptx with embedded fonts, screenshot of a deck vs screenshot of a random photo (must degrade honestly), two decks from the same team → profiles cluster.
- **Kill criterion**: if OOXML theme parsing can't hit the metric in 2 delegation cycles, downgrade scope to palette+fonts only and ship that.
- **Packaging decision (Homen)**: after it works in-repo, optionally extract to a published npm package (`@homenshum/pptx-signature` or similar) for third-party timestamp + challenge-repo dependency.

### W2 — Signature apply layer + on-brand validation (Pillar 1 enforcement)
- **Goal**: `applySignature(deck, profile) → patch operations` using the EXISTING 11-op patch system (no new mutation path), plus validator extension: `on_brand` issue codes in the receipt ({ok, publishOk, cleanOk} shape unchanged, additive codes only).
- **Metric**: same brief rendered under two different extracted signatures produces two visibly distinct, validation-clean decks. This is the demo money-shot.
- **Scenario tests**: profile with missing tokens (fallback chain), locked elements (must respect), signature swap on a deck with comments/versions (history preserved), concurrent signature-apply vs human edit (CAS behavior).
- **Depends on**: W1.

### W3 — Variation harness (Pillar 2)
- **Goal**: per-slide generation of N variants along declared axes (content angle: data-led/narrative-led; density: executive/detail; layout archetype). Variants are full valid slide specs, selection is recorded as a normal patch (accept = replace_text/update_slide ops), rejected variants persist as trace records.
- **Contract**: extends convex/nodeslideAgent.ts patterns — 8-op cap per variant, review-before-accept, deterministic fallback variants when LLM route is down.
- **Metric**: 3 variants per slide in < 10s wall-clock on the golden deck, 100% of variants pass validation before display.
- **Scenario tests**: LLM returns garbage JSON (fallback fires, no fake variants), all-variants-rejected path, sustained loop of 50 generate-select rounds (state accumulation / BOUND check on traces).
- **Parallel with**: W1 (no shared files except trace table).

### W4 — Preference-event schema + taste ETL stub (Pillar 6)
- **Goal**: adapt the harness4visuals-etl-followup contract to slides. New events on existing tables: variation_selected / variation_rejected / patch_accepted / patch_modified / patch_declined / export_completed, each with scope (deck/slide/element) and provenance. ETL stub: events → extracted preference signals (positive/negative/scoped) with an evaluator gate (schema check, provenance check, hallucination check) before anything is written to a `taste_profiles` table.
- **Non-goals (explicit)**: no SLM training, no ClickHouse, no cross-tenant pooling. Tenant-scoped only. This ships as schema + one real extracted signal from a real dogfood session, proving the pipe.
- **Metric**: replay one real editing session → ≥ 1 evaluator-passed preference signal with full provenance chain; 0 signals pass without provenance.
- **Scenario tests**: contradictory signals (user selects then reverts), event flood (BOUND + eviction), forged event without provenance (evaluator must reject).
- **Parallel with**: W2/W3 once event names are frozen (freeze in spec first).

### W5 — Sector taste packs (Pillar 3) — Fable research fan-out, not Codex
- **Goal**: 2 packs (finance/IBCS-grounded, startup-pitch/Duarte-grounded) as data: palette + type scale + chart conventions + density norms + source citations per rule. JSON matching the SignatureProfile token format so packs and extracted signatures are interchangeable inputs to W2.
- **Method**: parallel research agents over IBCS, FT Visual Vocabulary, Storytelling with Data, Material/Carbon token architecture, Leonardo for programmatic ramps → distilled, cited, validated against the validator's contrast/font checks.
- **Metric**: golden deck re-themed with the finance pack passes validation with 0 contrast/font issues and every pack rule carries a citation.

## 4. Sequencing

```
Day 1:  W1 spec + delegate ──────────► W3 spec + delegate (parallel)
        W5 research fan-out (background, Fable)
Day 2:  W1 verify/dogfood/commit ───► W2 spec + delegate
        W3 verify/dogfood/commit
Day 3:  W2 verify/dogfood/commit ───► W4 spec + delegate (event names frozen in W3/W2 specs)
        W5 packs distilled + committed
Day 4:  W4 verify/dogfood/commit → integrated demo pass on golden project → receipts + proof script update
```

Interrupt rule: the moment Mike's challenge prompt arrives, freeze whatever workstream is mid-flight at its last green commit, run the 1-hour NotebookLM calibration (Pillar 4), and pivot to the fresh challenge repo. Pre-build resumes after submission.

## 5. Risks & mitigations

- **Codex spec drift**: Codex adds scope or "improves" contracts → spec lists explicit non-goals; verify step diffs against contract; drift = revert, not negotiate.
- **Two-agent context loss**: each delegation is self-contained (spec + file pointers), never "continue from before."
- **OOXML rabbit hole (W1)**: kill criterion at 2 cycles, scope-downgrade path pre-declared.
- **Trace/event unboundedness (W3/W4)**: BOUND is a named test in both specs, sustained-load scenario mandatory.
- **IP drift**: no AI Fund material (prompt text, their docs) enters this repo, ever. Challenge work never enters this repo. One-way membrane.
- **Scope gravity**: 5 workstreams is the ceiling. Anything new goes to a "later" list in this doc, not into a spec.

## 6. Definition of done (pre-build phase)

1. All four code workstreams: green gates (tsc 0, vitest 0, biome clean), receipts in docs/dogfood/, committed and pushed.
2. Demo path: upload old deck → signature extracted → brief → variated, validated, on-brand deck → export PPTX → preference signal extracted from the session. One continuous recording ≤ 3 min.
3. Prior-art inventory updated with the new components and commit hashes.
4. Later-list triaged: what moved to the challenge, what stays product roadmap.
