# Parity Studio

> Image to verified, componentized `ui_kit/`. Self-judged with a 16-check deterministic rubric. Honest score drift on every iteration. Coding-agent-ready handoff.

## The 6-step user flow

1. **Drop a gpt-image-2 image, drop a canonical `ui_kit` zip, or generate one on the spot** from a prompt.
2. **Break it down** into individual UI components - exact parity, not approximations.
3. **Select a component** in the file tree.
4. **Comment** on it (a pinned bbox or a free-form note, scoped to that file).
5. **Iterate / edit** that scoped slice - not the whole artifact.
6. **Export as a `ui_kit` zip** - same shape on the way in as on the way out, guided handoff to a coding agent that drops it into a real codebase.

That is the entire product. Every surface is in service of one of those six steps. The canonical zip shape (NodeBench AI Skill-pack format, see [docs/CANONICAL_KIT.md](./docs/CANONICAL_KIT.md)) is symmetric: drop one in, get one out.

[**Try it live ->**](https://parity-studio.vercel.app)

---

## See it run

From prompt/image to verified `ui_kit`, scoped comments, MCP tooling, and ZIP export:

[![Parity Studio v0.1.0 demo](https://github.com/HomenShum/parity-studio/releases/download/v0.1.0/demo-six-step-720.gif)](https://github.com/HomenShum/parity-studio/releases/download/v0.1.0/demo-six-step.mp4)

<sub>GIF preview from the `v0.1.0` release. Click it for the MP4.</sub>

---

**Status**: v0.1.0 - LIVE

- **Web app**: https://parity-studio.vercel.app
- **Release demo run**: https://parity-studio.vercel.app/?run=jh798qfj782qem79rkechhyxxs85tprk
- **MCP server (npm)**: [`parity-studio-mcp`](https://www.npmjs.com/package/parity-studio-mcp) - `npx parity-studio-mcp` - includes `parity_studio` and `parity_platform_to_ui_kit` for Claude Code / Codex / Cursor to capture an existing app route into a Parity-ready `ui_kit` ZIP/run
- **Convex prod**: `blissful-pig-998` - HTTP routes at https://blissful-pig-998.convex.site
- Stack: single-page web - Convex Cloud + pi-ai - stdio MCP for Claude Code / Codex / Cursor / Windsurf

## Workflows available now

### Web app workflows

- **Start a new run from a prompt**: describe the surface and let the pipeline generate, decompose, verify, and stream the result.
- **Start from a source image**: attach a screenshot or generated image, then decompose it into a componentized `ui_kit`.
- **Import an existing `ui_kit` ZIP**: drop a canonical kit back into the app, inspect it, comment on it, edit files, and export it again.
- **Choose the model route**: use Balanced AI, Best Quality AI, Free AI route, a preset model, or a custom provider/model id from Anthropic, OpenAI, Google Gemini, OpenRouter, Groq, Cerebras, xAI, or Mistral.
- **Session privacy + BYOK setup**: store browser-tab-only provider-key placeholders for the session, copy local MCP env setup, clear keys, or start a fresh session. Hosted Parity does not receive browser-entered BYOK secrets for model calls.
- **Manage projects and run history**: use the left rail to start runs, revisit recent runs, see run status, and keep a session-level project list.
- **Browse, create, edit, save, and revert kit files**: the Files view exposes the generated `ui_kits/<slug>/` files, source image preview, selected-file scope, inline editing, and ZIP export.
- **Preview and comment on the generated UI**: use comment mode to pin a bbox to the preview or leave a free-form note scoped to the selected file.
- **Ask the agent to make scoped edits**: chat with the agent stream, enhance prompts, or trigger an advisor/executor fix from a comment, file, or manual request.
- **Use Parity Coach**: read the end-user impact readout, parity score, top recommendations, and quality-gate status instead of raw low-level check rows.
- **Run the Inspiration workflow**: search curated or live references, review product patterns, apply a safe inspiration brief to the agent, and improve the kit without copying source assets.
- **Sync stale source snapshots**: use the version-control modal to patch the current run or copy MCP recapture instructions when the original app route changed.
- **Switch language**: use English or Simplified Chinese UI text and localized Parity Coach readouts.

### Coding-agent and MCP workflows

- **Natural existing-app capture**: ask Claude Code, Codex, Cursor, or Windsurf: "Use Parity Studio with our app, get me the zip export, upload it to Parity Studio, and use my own env keys."
- **Direct route capture**: call `parity_platform_to_ui_kit` on a running localhost or hosted route with `projectRoot=.` to capture rendered HTML/CSS, include code context, redact secrets, create a canonical ZIP, and optionally import it into hosted Parity Studio.
- **End-to-end local pipeline**: call `parity_pipeline` to generate, decompose, verify, optionally visually judge, and export a kit from a prompt or image.
- **Decompose-only workflow**: call `parity_decompose` to turn a complete HTML artifact into canonical `ui_kit` files plus `parity.contract.json`, `performance.budget.json`, `api-wiring.plan.md`, and `qa.plan.md`.
- **Verify-only workflow**: call `parity_verify` to score an existing kit against source HTML and, when a source image is provided, run the visual judge.
- **Export-only workflow**: call `parity_export_zip` or hosted `parity_export` to package a run as ZIP, HTML, or Markdown for handoff.
- **Hosted run/chat workflow**: use `parity_chat_send`, `parity_chat_advise`, `parity_chat_history`, and `parity_run_listRecent` to keep working against a hosted run from the agent.
- **Prompt/resource workflow**: load the MCP `use-parity-studio` prompt and `parity://agent-rules` resource so users can ask naturally instead of memorizing tool names.
- **Local dashboard workflow**: watch MCP runs on the auto-opened local dashboard with source/rendered split, file tree, parity score, cost meter, log feed, and ZIP export.
- **Self-dogfood workflow**: capture Parity Studio itself through the MCP path, import it as a run, then use Inspiration, comments, scoped edits, and export against the app's own UI.

## Use it from your coding agent (MCP)

The fastest way to try the pipeline today is via the [`parity-studio-mcp`](./mcp/) package - a stdio MCP server with 13 tools, a `use-parity-studio` prompt, and `parity://agent-rules`. It includes a high-level `parity_studio` wrapper for natural requests, plus `parity_platform_to_ui_kit`, `parity_pipeline`, `parity_decompose`, `parity_verify`, and `parity_export_zip` for direct pipeline work.

```jsonc
// MCP client config for Claude Code, Codex, Cursor, Windsurf, etc.
{
  "mcpServers": {
    "parity-studio": {
      "command": "npx",
      "args": ["-y", "parity-studio-mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "PARITY_DECOMPOSE_MODEL": "claude-opus-4-7",
        "PARITY_JUDGE_MODEL": "claude-sonnet-4-6"
      }
    }
  }
}
```

Then in your coding agent:

- Existing app, recommended: *"Use Parity Studio with our app, get me the zip export, upload it to Parity Studio, and use my own env keys."*
- Existing app, explicit: *"use parity_platform_to_ui_kit on http://localhost:3000/settings with projectRoot=. and write ./settings-ui-kit.zip"*
- New sketch/prompt: *"use parity_pipeline to turn this sketch into a ui_kit"*

Local MCP BYOK keeps provider keys in the local agent/MCP env. Keys are never returned, written into kit files, logged, or uploaded to hosted Parity Studio.

**The MCP server also auto-opens a local dashboard** on first invocation (port 6280 by default). Live view of the pipeline running: source/rendered split, file tree as it streams, parity score with bounded enum status, cost meter, ZIP export. Set `PARITY_DASHBOARD=server-only` to disable auto-open in the env block above. See [mcp/README.md](./mcp/) for full tool docs + env flags.

## What it does

```
   sketch.png             ui_kits/saas-dashboard/
   prompt text     -->    |-- index.html
   image upload           |-- components/
                          |   |-- Sidebar.tsx
                          |   |-- MetricCard.tsx
                          |   `-- ChartPanel.tsx
                          |-- tokens.css
                          |-- manifest.json
                          |-- parity.contract.json
                          |-- performance.budget.json
                          |-- api-wiring.plan.md
                          |-- qa.plan.md
                          `-- README.md   <-- handoff to Claude Code / Cursor
```

Pipeline: **generate -> decompose -> verify (deterministic) -> verify (visual judge) -> iterate (max 2) -> done**, all durable, all live-streamed to the browser.

Verifier returns a **bounded enum** - `verified | needs_review | needs_iteration | failed | unavailable` - derived from a 16-row deterministic rubric. Each row carries its own honest verdict (`pass | warn | fail | unavailable`) plus 1-2 evidence lines. No floating-point hallucination scores; rows that the deterministic layer genuinely cannot evaluate (color delta, visual regression) are honestly marked `unavailable` rather than collapsed into a fake pass.

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
