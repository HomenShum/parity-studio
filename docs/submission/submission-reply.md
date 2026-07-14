# AI Fund Slidelang submission reply

Hi Mike,

Thanks again for the Slidelang session and for the extra time. Here is my completed submission:

- **Demo video (2-5 min, core workflow):** https://youtu.be/WOk0jV59oS0
- **PRD:** https://github.com/HomenShum/parity-studio/blob/main/docs/submission/nodeslide-prd.md
- **TDD:** https://github.com/HomenShum/parity-studio/blob/main/docs/submission/nodeslide-tdd.md
- **Prototype:** https://parity-studio.vercel.app/
- **Public example deck:** https://parity-studio.vercel.app/?share=share-f224c10b419373c5e9774b3c78bfee8d1131&present=1
- **Source code:** https://github.com/HomenShum/parity-studio
- **Implementation evidence map:** https://github.com/HomenShum/parity-studio/blob/main/docs/submission/implementation-evidence.md
- **Final recording receipt:** https://github.com/HomenShum/parity-studio/blob/main/docs/demo/founder-roadshow/final-recording-receipt.md

NodeSlide helps founders and researchers turn live evidence into sourced, visual, editable presentations—and lets them direct every revision through conversation.

**Access notes / credentials:** No login is required for the landing, sample workspace, or public share. External model and web-research requests require explicit per-request consent in the UI; the private deterministic path sends no brief to an external model. Owner edit capability stays in the creating browser and is not embedded in public share URLs.

The demo follows one founder-roadshow job from a fresh landing: combine a brief, customer notes, prototype metrics, web evidence, and visual references; compile a new structured deck; revise one and multiple slides; update content, chart data, math, image, and layout; inspect sources and agent trace; accept a validated proposal; present; and export. Any private preview credential will be shared out of band and will not be committed to the repository.

**What I personally built:** I built the NodeSlide domain: the `nodeslide.slidelang/v1` schema and normalized Convex storage, prompt/file/web intake, deck compiler and native renderers, scoped agent and JSON proposal flows, browser editing, memory and source lineage, validation/repair, chart/math/image/video/connector primitives, PowerPoint import/export, JSON/HTML export, immutable publishing/present mode, MCP tools, observability receipts, and the challenge-specific tests and demo experience.

**What I reused:** I built NodeSlide inside my existing Parity Studio React/Vite/Convex application and reused its shell, deployment/provider plumbing, design-token and editor lineage. I adapted durable orchestration patterns from my NodeRoom/NodeAgent work: authoritative shared state, bounded context, idempotent runs, stale-work protection, explicit human steering, and auditable receipts. Third-party libraries include React, Convex, the maintained pi-ai package, PptxGenJS, JSZip, assistant-ui observability primitives, Lucide, Vitest, and Playwright. NodeSlide uses its own SlideLang-compatible structured JSON IR; I did not use or claim access to the challenge's proprietary Slidelang implementation.

**What broke and how I debugged it:** Model providers sometimes returned slow, invalid, or unsupported structured output, so I added named routes, provider-specific controls, a 30-second deadline, bounded reads, one repair attempt, usage attribution, and an honest deterministic fallback. Concurrent human and agent work could make a candidate stale, so I converged every mutation on typed operations with base version clocks, idempotency keys, server-side reconstruction, digest binding, and acceptance-time validation. Evidence-backed edits could lose provenance, so factual text and chart changes now carry authorized source IDs and immutable claim digests. PowerPoint and Google Slides do not map perfectly to the canonical model, so imports and exports report fidelity instead of hiding loss; Google OAuth and guarded planning exist, but this release does not claim a user-facing live Google Slides sync. I also separated immutable public snapshots from owner workspaces so private notes, memory, credentials, traces, and private source metadata do not cross the share boundary.

**Release verification:** Production [release run 29352067830](https://github.com/HomenShum/parity-studio/actions/runs/29352067830) completed successfully for commit [`ae2e181a29b37de7dbc2311ff0d3c8a307634b54`](https://github.com/HomenShum/parity-studio/commit/ae2e181a29b37de7dbc2311ff0d3c8a307634b54): Quality passed 734 tests across 107 files (2026-07-14T17:01:54Z-2026-07-14T17:03:38Z), the isolated release candidate deployed and passed runtime-identity admission, and all 15 protected Playwright journeys passed (2026-07-14T17:05:11Z-2026-07-14T17:06:20Z). Staging completed at 2026-07-14T17:07:17Z, and the approved production cutover completed at 2026-07-14T17:07:59Z with frontend and backend receipts aligned to the same commit. The final 4:25 recording then passed its independent 17-scene verifier directly against that production runtime with zero console or page errors, and exported a six-slide editable PowerPoint plus a canonical JSON snapshot. Post-cutover Lighthouse measured desktop 99/100/96/100 and mobile 75/100/96/100 (performance/accessibility/best practices/SEO); the versioned JSON reports and their SHA-256 digests are included with the demo evidence pack.

Best,

Homen
