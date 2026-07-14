# Founder-roadshow demo evidence pack

This folder is the controlled input pack for the final NodeSlide dogfood recording.

- `brief.md` is the exact creation prompt.
- `customer-notes.md` contains anonymized internal feedback, not market traction.
- `design-reference.md` contains reusable visual direction.
- `storyboard.json` is the machine-checked 17-scene recording contract.
- `captions.json` supplies one caption and minimum readable duration per required scene.
- `recorder-hooks.md` records live selector readiness and intentional blockers.
- `prototype-metrics.csv` is generated only after the final release gates complete; every row must name its measurement source and timestamp.
- The PRD and TDD are uploaded from `docs/submission/`.

The background-safe harness lives at `scripts/record-nodeslide-founder-roadshow.mjs`.
It records a fresh incognito Playwright session, renders browser chrome and a visible
cursor without taking over the foreground desktop, then uses ffmpeg to create one
continuous 1920×1080 MP4 with burned captions and a companion SRT/evidence JSON. Run
`--dry-run` first: required product hooks and evidence inputs fail closed rather than
being skipped or replaced with seeded state.

External research source: AutoPresent, https://arxiv.org/abs/2501.00912. Its reported result that programmatic generation can produce user-interactable slide formats is a research finding, not a NodeSlide benchmark result.
