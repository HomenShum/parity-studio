# NodeSlide P0 proof packet

This packet records the completed NodeSlide P0 proof on `feature/nodeslide-domain`.

## What was exercised

- The local app loaded a clean seven-slide Convex workspace in the strict three-column editor.
- The 1280px desktop canvas was visually inspected and adjusted to open fitted at 55%, without horizontal cropping.
- A real headline element was selected and scoped to `copy only`.
- The server attempted `openrouter/free`; its response was invalid, so the deterministic bounded fallback produced one `replace_text` operation. The proposal was visible before acceptance, was based on deck v1, and changed the headline from “editable” to “reviewable” only after acceptance.
- An element-anchored comment was posted, replied to, resolved, and reopened.
- Presenter mode advanced from slide 1 to slide 2 and exposed speaker notes.
- Share copied a stable deck URL. HTML and PPTX export controls both completed successfully.
- Two independent Convex clients started from deck v1. Client A committed one slide; Client B safely rebased a stale edit on another slide; Client B's stale overlapping write was persisted as `stale` and did not overwrite either accepted value.
- The generated PowerPoint was rendered slide by slide. All seven slides were inspected at full size, the workflow-numbering defect found during inspection was fixed, and the final deck passed the presentation overflow test.
- The separate official eight-slide SlideLang project completed the hosted check/repair/budget/publish loop and its public presenter advanced from slide 1 to slide 2.

## Durable artifacts

- [`artifact-proof.json`](./artifact-proof.json): clean validation plus HTML/PPTX byte, ID, and capability counts.
- [`conflict-proof.json`](./conflict-proof.json): accepted, rebased, and stale CAS outcomes with final-content preservation.
- [`slidelang-hosted-proof.json`](./slidelang-hosted-proof.json): official hosted check, budget, publish revision, and browser verification.
- [`browser-qa.json`](./browser-qa.json): the local guarded-edit, comments, presenter, share, and export observations.
- [`nodeslide-golden.html`](./nodeslide-golden.html): semantic local presenter with stable slide and element IDs.
- [`nodeslide-golden.pptx`](./nodeslide-golden.pptx): editable local PowerPoint artifact with native text, shapes, and charts.

## Reproduce

Start Convex/Vite, open or seed a NodeSlide deck, then run:

```bash
pnpm proof:nodeslide -- --deck <deck-id>
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm exec tsc -p convex/tsconfig.json
```

Final observed results: 19 test files / 61 tests passed; both TypeScript checks passed; Biome was clean; the production build completed; Convex functions reached ready state; the PowerPoint overflow test reported no overflow; and the official SlideLang project completed check and publish with all three success flags true.

For the official SlideLang source project, use the upstream CLI with `DECKS_DATA_ROOT` pointed at `slidelang-projects` and run `check`, `budget`, then `publish` for `nodeslide-golden slidemaker`.

## Honest boundaries

- The free model route is opportunistic; deterministic fallback keeps testing and authoring usable without credits while preserving scope and validation.
- Unsupported image/media behavior is labelled as a static fallback rather than claimed editable parity.
- Google Slides has a tested, revision-aware adapter and durable sync metadata, but live push/pull remains disabled until an approved OAuth client is configured. PPTX import is bounded and fidelity-labelled; universal PowerPoint fidelity, native Google Slides editing, and full animation parity are not claimed.
