# AI Fund Slidelang submission reply

Hi Mike,

Thanks again for the Slidelang session and for the extra time. Here is my completed submission:

- **Demo video (2-5 min, core workflow):** FINAL_DEMO_VIDEO_URL
- **PRD:** FINAL_PRD_URL
- **TDD:** FINAL_TDD_URL
- **Prototype:** FINAL_PROTOTYPE_URL
- **Public example deck:** FINAL_PUBLIC_DECK_URL
- **Source code:** FINAL_SOURCE_CODE_URL
- **Implementation evidence map:** FINAL_EVIDENCE_APPENDIX_URL

**Access notes / credentials:** FINAL_ACCESS_NOTES

The demo follows one founder-roadshow job from a fresh landing: combine a brief, customer notes, prototype metrics, web evidence, and visual references; compile a new structured deck; revise one and multiple slides; update content, chart data, math, image, and layout; inspect sources and agent trace; accept a validated proposal; present; and export. Any private preview credential will be shared out of band and will not be committed to the repository.

**What I personally built:** I built the NodeSlide domain: the `nodeslide.slidelang/v1` schema and normalized Convex storage, prompt/file/web intake, deck compiler and native renderers, scoped agent and JSON proposal flows, browser editing, memory and source lineage, validation/repair, chart/math/image/video/connector primitives, PowerPoint import/export, JSON/HTML export, immutable publishing/present mode, MCP tools, observability receipts, and the challenge-specific tests and demo experience.

**What I reused:** I built NodeSlide inside my existing Parity Studio React/Vite/Convex application and reused its shell, deployment/provider plumbing, design-token and editor lineage. I adapted durable orchestration patterns from my NodeRoom/NodeAgent work: authoritative shared state, bounded context, idempotent runs, stale-work protection, explicit human steering, and auditable receipts. Third-party libraries include React, Convex, the maintained pi-ai package, PptxGenJS, JSZip, assistant-ui observability primitives, Lucide, Vitest, and Playwright. NodeSlide uses its own SlideLang-compatible structured JSON IR; I did not use or claim access to the challenge's proprietary Slidelang implementation.

**What broke and how I debugged it:** Model providers sometimes returned slow, invalid, or unsupported structured output, so I added named routes, provider-specific controls, a 30-second deadline, bounded reads, one repair attempt, usage attribution, and an honest deterministic fallback. Concurrent human and agent work could make a candidate stale, so I converged every mutation on typed operations with base version clocks, idempotency keys, server-side reconstruction, digest binding, and acceptance-time validation. Evidence-backed edits could lose provenance, so factual text and chart changes now carry authorized source IDs and immutable claim digests. PowerPoint and Google Slides do not map perfectly to the canonical model, so imports and exports report fidelity instead of hiding loss; Google OAuth and guarded planning exist, but this release does not claim a user-facing live Google Slides sync. I also separated immutable public snapshots from owner workspaces so private notes, memory, credentials, traces, and private source metadata do not cross the share boundary.

**Release verification:** FINAL_RELEASE_VERIFICATION

Best,

Homen
