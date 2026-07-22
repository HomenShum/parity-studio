# NodeSlide Atlas — open-source primitive survey

Research date: 2026-07-22. Feeds Artifact Atlas v3.

The question that started this: for trace/span slides, should NodeSlide use
[`@assistant-ui/react-o11y`](https://www.assistant-ui.com/docs/utilities/react-o11y) and export an
image, rather than hand-building shapes?

## Decision

**Adopt react-o11y for the web renderer. Do not export trace slides as JPG.**

Rasterising is the wrong end of the trade. A trace waterfall is positioned rectangles plus text —
it maps one-to-one onto native PowerPoint shapes, so it can stay fully editable. Flattening it to
an image throws away editability for no gain, and JPG specifically is the worst available choice:
it is lossy on exactly the thin lines and small text a span chart is made of. If a raster is ever
required, it is PNG.

The real reason to adopt react-o11y is not that it is prettier. It is that it consumes **real span
data**. Atlas v2 slide 31 currently has to disclose `not observed timing` and
`Example repair span · no trace ID claimed`. Wiring a live OTel span source is what lets that
slide drop the disclaimer and pass the evidence gate instead of failing it honestly.

## Capability tiering

The Atlas records capability per target, not as a boolean (`shared/nodeslideAtlas.ts`).
Every artifact should be built to the highest tier it can honestly reach.

| Tier | Meaning | Use when |
| --- | --- | --- |
| `native` | The target renders it as a first-class object | Web: react-o11y primitives, live and collapsible |
| `editable` | Real shapes/values a user can select and change | PPTX: deterministic builder emits rects, connectors, chart data |
| `rendered-image` | Vector or raster embed | Only when no shape mapping exists |
| `poster-frame` | A still standing in for motion | Video and scroll scenes |
| `unsupported` | Honestly absent | Must declare `fallbackBehavior` |

`rendered-image` and below require a declared `fallbackBehavior` — the recipe validator enforces
this, so a degraded export cannot be listed silently.

## The rendering bridge

For artifacts that genuinely cannot map to PPTX shapes, the path is
**React → SVG → PPTX**, not React → PNG/JPG:

- [Satori](https://github.com/vercel/satori) (Vercel, MIT) converts HTML/CSS/JSX to SVG with no
  browser. It uses the React Native Flexbox engine, so it is a subset of CSS, and `useState` /
  `useEffect` / `dangerouslySetInnerHTML` do not work. Deterministic and headless, which suits a
  build step.
- [PptxGenJS](https://github.com/gitbrent/PptxGenJS) emits standards-compliant OOXML and supports
  SVG images. Office 2016+ renders embedded SVG; older readers need the PNG fallback, so both
  should be written.

This keeps degraded artifacts vector and scalable rather than a fixed-resolution bitmap.

## Candidate primitives

Grouped by the Atlas artifact kind they serve. Licences must be re-verified per package at
ingestion time — `nodeslide atlas explain-license` is the gate, and nothing enters the Atlas
without a reviewed `AtlasSourcePolicy`.

### Trace and span (`technical.trace-waterfall`)

| Library | Role | Notes |
| --- | --- | --- |
| `@assistant-ui/react-o11y` | Headless span primitives | Radix-style parts; automatic depth, parent/child collapse and time-range computation; reactive so spans stream in. **Marked experimental — the API may change without notice.** |

Because it is experimental, take it at `reuseMode: 'wrap'`: our own adapter owns the surface, the
version is pinned, and the deterministic PPTX builder never imports it.

### Charts (`data.*`)

| Library | Role | Notes |
| --- | --- | --- |
| [visx](https://airbnb.io/visx/) | Low-level React + D3 primitives | Component-first, ~15 kB per package, surgical imports. Best fit for building our own chart recipes rather than adopting someone's chart. |
| [Observable Plot](https://observablehq.com/plot/) | Grammar of graphics | Concise specs from D3's maintainers; good for generated charts where the model emits a spec, not code. |
| [Vega-Lite](https://vega.github.io/vega-lite/) | JSON chart spec | One JSON blob per chart — the most agent-friendly target, since a model emits data not drawing calls. |
| TanStack Charts | Headless core | Manages scales/axes/interactions and leaves rendering to us. |
| [Nivo](https://nivo.rocks/) | SVG/Canvas/HTML with SSR API | Isomorphic rendering is useful for the build step. |
| [Apache ECharts](https://echarts.apache.org/) | Large catalogue, Canvas + SVG | Widest chart coverage when a recipe needs something exotic. |

For PPTX these should still compile to **native chart objects** where the chart type exists in
OOXML. A bar chart rendered as an image fails `data.bar-comparison`'s `chart-as-flat-image`
substitute check.

### Diagrams and graphs (`systems.*`)

| Library | Role | Notes |
| --- | --- | --- |
| [elkjs](https://github.com/kieler/elkjs) | Layout engine only | Eclipse Layout Kernel compiled to JS. Computes positions; renders nothing — exactly the split we want, since we then emit either SVG or PPTX shapes from the same coordinates. Layer-based algorithm suits directed node-link diagrams with ports. |
| [dagre](https://github.com/dagrejs/dagre) | Directed graph layout, MIT | Simpler than ELK and widely used, but **no longer actively maintained** — prefer ELK for new work. |

Layout-only libraries are the right shape for the Atlas: one layout pass feeds both the web
renderer and the editable PPTX builder, so the two cannot drift.

### Code and maths (`technical.*`)

| Library | Role | Notes |
| --- | --- | --- |
| [Shiki](https://shiki.style/) | Syntax highlighting | Uses VS Code's TextMate grammars, so highlighting matches the editor exactly. Renders at build time with no client JS. |
| KaTeX | Maths | Server-side SVG/PNG output available; already the Atlas target for `technical.equation`, which forbids `equation-as-flat-image`. |

### Scroll and motion (`progression.scrollytelling`)

Scroll-driven scenes are web-only by nature. They must declare
`capability.pptx: 'poster-frame'` with a `fallbackBehavior` describing the storyboard panels the
export produces.

## What this changes for v3

1. Add `technical.trace-waterfall` to the archetype registry — done, with
   `illustrative-timing-presented-as-observed` as a named forbidden substitute so an unsourced
   waterfall fails the topology gate rather than passing as evidence.
2. Wire a real OTel span source so trace slides can pass `evidencePassed` instead of disclosing
   illustrative timing.
3. Compile per target from one specification — see the council correction below. Do **not** build a
   single shared final layout and emit both surfaces from it.
4. Register each adopted library as an `AtlasSourcePolicy` before use. Nothing is ingested on the
   strength of "it's open source" — licence, redistribution, retrieval-indexing and training
   rights are separate questions and are asked separately.

## Council review (2026-07-22, `graph-hop` → Slide AI Collaboration thread)

Two answers from the design thread corrected this plan. Recorded here so the corrections do not
live only in a chat log.

### Q2 — Honest V3 PowerPoint capability tier

The measured Atlas v3 deck is **`editable-geometry` (`vector-flattened`), not `editable`**. All 43
slides are native autoshapes and text boxes, so they are shape-editable and not rasterised — but
they preserve **no chart, table, equation, or connector semantics**: no Edit Data, no series, no
axis, no OMML, no round-trip from structured input. A recipe backing a v3 slide must therefore
either declare `capability.pptx: 'vector-flattened'` honestly, or its required-native artifact
resolves to `violation` (see `resolveRequirementVerdict`). Claiming `editable` for these slides is
the exact rationalization the gate now blocks.

### Q3 — "Layout once, emit twice" does not survive as a universal architecture

The rejected shape was: run one shared ELK layout pass and emit both web SVG and PPTX shapes from
that single final geometry. The flaw: web and PowerPoint have different text metrics, wrapping,
DPI, and shape models, so one frozen layout is correct on at most one surface. The replacement
principle:

> **Specify once. Share constraints where appropriate. Compile per target. Validate per target.**

So: one semantic spec + shared constraints (reading order, node set, hierarchy) → a **separate**
compile+layout per surface → the topology/fidelity gate runs **per rendered target**. Shared layout
remains valid only where the geometry is genuinely surface-independent (e.g. a fixed grid of KPI
tiles), not for text-driven diagrams or charts.

## Sources

- [vercel/satori](https://github.com/vercel/satori)
- [gitbrent/PptxGenJS](https://github.com/gitbrent/PptxGenJS)
- [PptxGenJS SVG support issue #401](https://github.com/gitbrent/PptxGenJS/issues/401)
- [kieler/elkjs](https://github.com/kieler/elkjs)
- [dagrejs/dagre](https://github.com/dagrejs/dagre)
- [Web data visualization libraries 2026 comparison](https://www.youngju.dev/blog/culture/2026-05-14-data-visualization-libraries-2026-d3-plot-visx-recharts-echarts-vega-comparison-deep-dive-2026.en)
- [Best React chart libraries 2026 — LogRocket](https://blog.logrocket.com/best-react-chart-libraries-2026/)
- [Shiki vs Prism vs highlight.js 2026](https://www.pkgpulse.com/guides/shiki-vs-prismjs-vs-highlightjs-syntax-highlighting-2026)
- [assistant-ui react-o11y docs](https://www.assistant-ui.com/docs/utilities/react-o11y)
