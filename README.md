# Parity Studio

> Image to verified, componentized `ui_kit/`. Self-judged with a 16-check deterministic rubric. Honest score drift on every iteration. Coding-agent-ready handoff.

## The 6-step user flow

1. **Drop a gpt-image-2 image** — or generate one on the spot from a prompt.
2. **Break it down** into individual UI components — exact parity, not approximations.
3. **Select a component** in the file tree.
4. **Comment** on it (a pinned bbox or a free-form note, scoped to that file).
5. **Iterate / edit** that scoped slice — not the whole artifact.
6. **Export as a ui design kit zip** — guided handoff to a coding agent that drops it into a real codebase.

That is the entire product. Every surface is in service of one of those six steps.

[**Try it live →**](https://parity-studio.vercel.app)

---

**Status**: pre-alpha · LIVE

- **Web app**: https://parity-studio.vercel.app
- **MCP server (npm)**: [`parity-studio-mcp`](https://www.npmjs.com/package/parity-studio-mcp) · `npx parity-studio-mcp`
- **Convex prod**: `blissful-pig-998` · HTTP routes at https://blissful-pig-998.convex.site
- Stack: single-page web · Convex Cloud + pi-ai · stdio MCP for Claude Code / Cursor / Windsurf

## Use it from your coding agent (MCP)

The fastest way to try the pipeline today is via the [`parity-studio-mcp`](./mcp/) package — a stdio MCP server with 4 tools: `parity_pipeline`, `parity_decompose`, `parity_verify`, `parity_export_zip`.

```jsonc
// .claude/settings.json (Claude Code), settings.json (Cursor / Windsurf)
{
  "mcpServers": {
    "parity-studio": {
      "command": "npx",
      "args": ["-y", "parity-studio-mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "PARITY_DECOMPOSE_MODEL": "claude-opus-4-1",
        "PARITY_JUDGE_MODEL": "claude-sonnet-4-5"
      }
    }
  }
}
```

Then in Claude Code: *"use parity_pipeline to turn this sketch into a ui_kit"* and it returns the `ui_kit/<slug>/` files inline in the chat.

**The MCP server also auto-opens a local dashboard** on first invocation (port 6280 by default). Live view of the pipeline running: source ↔ rendered split, file tree as it streams, parity score with bounded enum status, cost meter, ZIP export. Set `PARITY_DASHBOARD=server-only` to disable auto-open in the env block above. See [mcp/README.md](./mcp/) for full tool docs + env flags.

## What it does

```
   sketch.png             ui_kits/saas-dashboard/
   prompt text     -->    ├── index.html
   image upload           ├── components/
                          │   ├── Sidebar.tsx
                          │   ├── MetricCard.tsx
                          │   └── ChartPanel.tsx
                          ├── tokens.css
                          ├── manifest.json
                          └── README.md   <-- handoff to Claude Code / Cursor
```

Pipeline: **generate → decompose → verify (deterministic) → verify (visual judge) → iterate (max 2) → done**, all durable, all live-streamed to the browser.

Verifier returns a **bounded enum** — `verified | needs_review | needs_iteration | failed | unavailable` — derived from a 16-row deterministic rubric. Each row carries its own honest verdict (`pass | warn | fail | unavailable`) plus 1–2 evidence lines. No floating-point hallucination scores; rows that the deterministic layer genuinely cannot evaluate (color delta, visual regression) are honestly marked `unavailable` rather than collapsed into a fake pass.

## Stack

- **`@mariozechner/pi-ai`** for LLM calls (Anthropic + OpenAI + Google + Mistral + Bedrock under one client)
- **Convex Cloud** for schema, real-time queries, durable actions, storage, auth
- **`@convex-dev/workflow`** for durable multi-step orchestration
- **`@convex-dev/persistent-text-streaming`** for live agent output to the browser
- **Vite + React 19 + TypeScript** for the frontend
- **Vercel** + **Convex Cloud** for hosting

We do **not** use `@convex-dev/agent` because it locks to Vercel AI SDK and we want pi-ai's full provider abstraction. See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the decision record.

## Quick start

```bash
pnpm install
pnpm convex dev      # one-time: links to a Convex project
pnpm dev             # starts vite + convex together
```

Visit http://localhost:5180

## Self-dogfood

The shell on this repo is itself decomposable. See [docs/plans/2026-04-28-shell-revamp-from-reference.md](./docs/plans/2026-04-28-shell-revamp-from-reference.md) for the four-sprint rebuild that took the shell from a 4-pane dark layout to the current 3-column cream-light shell driven by 16 honest parity checks.

## Honest non-claims

- This is not a Figma replacement. It does not produce vector designs, component variants, or design system documentation.
- The 16-row rubric is opinionated. Other rubrics exist; we picked this one because every row is individually auditable and every cell is either real evidence or honestly marked `unavailable`.
- Source HTML matters. Garbage in, garbage out. The deterministic verifier catches text-coverage drops; the visual judge catches semantic misses; nothing catches "the input itself was bad."

## Provenance

Pipeline shape ported from work on `feat/decompose-to-ui-kit` of [HomenShum/open-codesign](https://github.com/HomenShum/open-codesign/tree/feat/decompose-to-ui-kit), opened upstream as [OpenCoworkAI/open-codesign#241](https://github.com/OpenCoworkAI/open-codesign/pull/241). Visual language adopted from [OpenCoworkAI/open-codesign](https://github.com/OpenCoworkAI/open-codesign)'s tokens.css under MIT (oklch palette, Fraunces serif display, terracotta accent). This repo is the standalone reference implementation of the same loop, untethered from any host product's mental model.

## License

MIT
