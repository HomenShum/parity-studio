# Founder-roadshow demo evidence pack

This folder is the controlled input pack for the final NodeSlide dogfood recording.

- `brief.md` is the canonical editorial contract; the recorder types its concise, semantically complete founder brief while the supporting evidence stays attached.
- `customer-notes.md` contains anonymized internal feedback, not market traction.
- `design-reference.md` contains reusable visual direction.
- `storyboard.json` is the machine-checked 17-scene recording contract.
- `captions.json` supplies one caption and minimum readable duration per required scene.
- `recorder-hooks.md` records live selector readiness and intentional blockers.
- `prototype-metrics.csv` is generated only after the final release gates complete; every row must name its measurement source and timestamp.
- At runtime the recorder losslessly bundles the five sources into three visible files, matching NodeSlide's creation limit: product definition, metrics CSV, and customer/design notes.
- The PRD and TDD are uploaded from `docs/submission/`.

The background-safe harness lives at `scripts/record-nodeslide-founder-roadshow.mjs`.
It records a fresh incognito Playwright session, renders browser chrome and a visible
cursor without taking over the foreground desktop, then uses ffmpeg to create one
continuous 1920×1080 MP4 with burned captions and a companion SRT/evidence JSON. Run
`--dry-run` first: required product hooks and evidence inputs fail closed rather than
being skipped or replaced with seeded state.

The completed production take, public links, scene-by-scene verification, runtime identity,
and export hashes are recorded in [`final-recording-receipt.md`](./final-recording-receipt.md).

If live provider latency would push the submission beyond five minutes, finalization applies
one uniform, evidence-recorded playback rate to the uninterrupted product capture and scales
all caption timestamps by the same factor. It never cuts, splices, or fabricates product state.

For local selector QA only, `--metrics-path` may replace the not-yet-final metrics file and
`--probe-through-scene <scene-id>` runs the real browser journey without assembling a final
video. A final recording rejects the temporary metrics override.

External research source: AutoPresent, https://arxiv.org/abs/2501.00912. Its reported result that programmatic generation can produce user-interactable slide formats is a research finding, not a NodeSlide benchmark result.
