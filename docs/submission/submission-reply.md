# AI Fund Slidelang submission reply

Hi Mike,

Thanks again for the Slidelang session and for the extra time. Here is my completed submission:

- **Demo video (2–5 min, core workflow):** https://www.youtube.com/watch?v=FuXXO-1fnZU
- **PRD:** https://github.com/HomenShum/parity-studio/blob/codex/nodeslide-agentic-authoring/docs/submission/nodeslide-prd.md
- **TDD:** https://github.com/HomenShum/parity-studio/blob/codex/nodeslide-agentic-authoring/docs/submission/nodeslide-tdd.md
- **Prototype:** https://parity-studio.vercel.app/
- **Public example:** https://parity-studio.vercel.app/?share=share-199954660609aeed58c8203cc624753964b0&present=1&slide=slide_ff0bffbd41623c4b139ab1cd56ae4266
- **Source code:** https://github.com/HomenShum/parity-studio/tree/codex/nodeslide-agentic-authoring
**Access notes / credentials:** The published example needs no login. I will send the private editor preview access code separately rather than placing a credential in the repository.

**What I personally built:** I built the NodeSlide `nodeslide.slidelang/v1` schema and normalized storage, deck compiler and renderers, prompt-to-deck and scoped edit-planning flows, browser editor, comments and versions, validation/repair pipeline, chart/math/image/video primitives, HTML and PowerPoint export, immutable publishing/present mode, agent trace receipts, and the challenge-specific tests and demo decks.

**What I reused:** I built NodeSlide inside my existing Parity Studio React/Vite/Convex application and reused its app shell, deployment/provider plumbing, design tokens, and editor foundations. I also adapted orchestration patterns from my NodeRoom/NodeAgent work—authoritative shared state, durable jobs, bounded context, stale-work protection, human steering, and traceable receipts. Third-party libraries include React, Convex, PptxGenJS, JSZip, Lucide, Vitest, and the maintained pi-ai package. The live deck runtime is NodeSlide’s own structured JSON IR; it does not claim to run the upstream `sl0` implementation.

**What broke and how I debugged it:** Model responses sometimes returned invalid or slow JSON, so I added a strict schema, a 30-second abort, a bounded response, one repair attempt, recorded usage, and a visibly labeled deterministic fallback. Concurrent edits could make proposals stale, so I added expected version clocks, request tokens, write serialization, server-side candidate reconstruction, and digest binding before acceptance. Browser, HTML, and PowerPoint targets differed, so I added per-element export capabilities and honest fallbacks—math source stays editable and video becomes a linked-media placeholder in PowerPoint. I also separated immutable public snapshots from owner workspaces so speaker notes and private source metadata cannot leak through share links.

Best,

Homen
