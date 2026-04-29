# parity-studio-mcp

> MCP server for [Parity Studio](../). Lets coding agents (Claude Code, Cursor, Windsurf, any MCP client) generate, decompose, verify, and now also **chat** with `ui_kit/` bundles directly from a sketch or prompt — without leaving the editor.

**Status**: v0.1.0 · stdio transport · 10 tools

## Install

In Claude Code, Cursor, Windsurf, or any MCP client config:

```json
{
  "mcpServers": {
    "parity-studio": {
      "command": "npx",
      "args": ["-y", "parity-studio-mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "PARITY_DECOMPOSE_MODEL": "claude-opus-4-1",
        "PARITY_JUDGE_MODEL": "claude-sonnet-4-5",
        "PARITY_CONVEX_URL": "https://blissful-pig-998.convex.cloud",
        "PARITY_CONVEX_HTTP_URL": "https://blissful-pig-998.convex.site"
      }
    }
  }
}
```

You need at least one of: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` — depending on the model ids you use for the local pipeline (`parity_pipeline`, `parity_decompose`, `parity_verify`).

The new v0.1.0 tools (`parity_enhance_prompt`, `parity_chat_*`, `parity_run_*`, `parity_export`) call the **hosted parity-studio Convex deployment** at `PARITY_CONVEX_URL` (default `blissful-pig-998.convex.cloud`) — no local LLM keys required for those. Override the URLs to point at your own self-hosted deployment.

## Local dashboard (auto-opens)

The MCP server starts a tiny local HTTP server on port `6280` (overridable via `PARITY_DASHBOARD_PORT`) and opens it in your browser the first time your agent calls a parity tool. You watch the pipeline run live: source ↔ rendered side-by-side, file tree as it streams, parity score with bounded enum status, cost meter, log feed, ZIP export button.

`PARITY_DASHBOARD` env values:
- `auto-open` (default) — start server, open browser on first tool call
- `server-only` — start server, never open browser (useful in headless / CI)
- `disabled` — don't start server at all

The dashboard reuses an open tab on subsequent runs — no spam.

## Tools

### `parity_pipeline` — end-to-end

Generate, decompose, and verify in one call. Returns the `ui_kit/<slug>/` bundle plus a `ParityReport` with bounded enum status (`verified | needs_review | needs_iteration | failed | unavailable`) derived from `passCount / totalChecks`. No floating-point hallucination scores.

```jsonc
{
  "prompt": "Premium SaaS dashboard with sidebar nav, 4 metric cards, and a 30-day trend chart",
  // OR (or BOTH):
  "sourceImageBase64": "iVBORw0KG...",
  "sourceImageMimeType": "image/png",

  // Optional model overrides (env defaults are used otherwise)
  "generateModel": "claude-sonnet-4-5",
  "decomposeModel": "claude-opus-4-1",
  "judgeModel": "claude-sonnet-4-5",

  // Optional: skip stage-1 generation if the source image is already polished
  "skipGenerate": false
}
```

Returns:

```jsonc
{
  "uiKit": { "slug": "saas-dashboard", "files": { /* path -> content */ }, "warnings": [] },
  "deterministic": { "passCount": 14, "totalChecks": 16, "parityScore": 0.875, "status": "needs_review", ... },
  "visual": { "passCount": 11, "totalChecks": 12, "parityScore": 0.92, "status": "needs_review", "checks": [...] },
  "combined": { "passCount": 25, "totalChecks": 28, "parityScore": 0.893, "status": "needs_review", "basis": "deterministic+visual" },
  "costs": { "totalUsd": 0.42, "decompose": 0.37, "visualJudge": 0.025 },
  "latencies": { "generateMs": 5000, "decomposeMs": 84000, "renderMs": 1300 },
  "modelsUsed": { "generate": "claude-sonnet-4-5", "decompose": "claude-opus-4-1", "judge": "claude-sonnet-4-5" }
}
```

### `parity_decompose` — HTML → ui_kit only

Takes a complete HTML artifact and emits `ui_kits/<slug>/{index.html, components/*.tsx, tokens.css, manifest.json, README.md}`. Use when you already have a generated artifact and want it shaped for handoff.

### `parity_verify` — score an existing ui_kit

Runs deterministic parity checks (element count, visible text coverage, token fidelity, expected file presence). If `sourceImageBase64` is provided, additionally runs the visual judge on a Playwright-rendered snapshot. Returns `parityScore = passCount / totalChecks` with bounded enum status.

### `parity_export_zip` — pack for handoff

Bundles the `ui_kit` files into a ZIP and returns it as base64. Optionally appends a `HANDOFF.md` with integration instructions for Claude Code / Cursor / Windsurf.

---

### v0.1.0 hosted-Convex tools

These call the hosted parity-studio deployment over HTTP. No local LLM keys required.

### `parity_enhance_prompt` — Kilo-style ✨ rewrite

Stateless. Takes a rough draft prompt and returns a clearer, more specific rewrite using the deployment's `chatLoop:enhance` action (small/cheap tier, no system identity, no tools — bare instruction). Use before sending to any model. Mirrors Kilo Code's enhance feature.

### `parity_chat_send` — send a message to the agent

Persists a user turn on the chat for a `runId`, then schedules the agent loop. The agent has full tool access (list_files, read_file, read_design_system, upsert_file, set_todos, done) and writes back assistant + tool turns. Use `parity_chat_history` to read the response.

### `parity_chat_advise` — advisor-executor auto-fix

Triggers the 4-phase advisor-executor protocol (advise → execute → verify → close) on a comment, file, or manual prompt. The agent autonomously plans + edits + self-verifies + summarizes. `kind: "comment"` resolves the comment's `targetFile` + text + bbox; `kind: "file"` opens a file for review; `kind: "manual"` accepts a verbatim instruction.

### `parity_chat_history` — read the conversation

Returns the chat_messages array for a run, sorted by turn. Use to see the agent's plan + tool calls + final summary after `parity_chat_send` or `parity_chat_advise`.

### `parity_run_listRecent` — list recent runs

Returns the most recent runs (most-recent first), each with status, prompt, cost, iteration count. Useful to find a `runId` for chat / export / verify.

### `parity_export` — multi-format download

Fetches the run as `zip` (canonical NodeBench skill-pack), `html` (single file with tokens.css inlined), or `markdown` (prose handoff for coding agents).

## Why a boolean rubric?

Every check returns `{passed: boolean}`. The score is `passCount / totalChecks` — a derivation, not an LLM-fabricated float. A check failed = the score drops by exactly `1 / totalChecks`. No fudging, no rounding, no "looked good overall" rubber-stamping.

This is the same primitive the [main parity-studio repo](../) uses internally and that the [open-codesign PR #241](https://github.com/OpenCoworkAI/open-codesign/pull/241) shipped upstream.

## Why split deterministic + visual checks?

- **Deterministic** (no LLM, no cost): catches dropped text, missing expected files, fabricated hardcoded values not present in source/tokens.css. Runs in milliseconds.
- **Visual** (vision LLM): catches semantic drift the deterministic checks can't see — "the chart looks janky", "the header lost its hierarchy", etc.

Either alone misses things. The deterministic check missed a layout regression in our self-dogfood ([DOGFOOD.md](../DOGFOOD.md)); the visual judge missed a text tokenization artifact (`Code` rendered as `C&b`). Combined, you get honest coverage.

## Cost reference

Per `parity_pipeline` call with default models (kimi-k2.6 decompose + gemini-3.1-pro-preview judge), high-quality gpt-image-2 generate:

| Stage | Latency | Cost |
|---|---:|---:|
| Generate | ~80 s | $0.05–0.20 |
| Decompose | ~75 s | $0.30–0.40 |
| Render (Playwright) | ~1 s | $0 |
| Visual judge | ~18 s | $0.02–0.05 |
| **Total** | **~3 min** | **$0.40–$0.65** |

Cheaper-tier setups (Kimi K2.6 + Gemini Flash via OpenRouter) come in at $0.05–0.10 with a ~10–15% parity hit. See the cross-tier benchmarks in [open-codesign PR #241 BENCHMARKS.md](https://github.com/HomenShum/open-codesign/blob/feat/decompose-to-ui-kit/BENCHMARKS.md).

## Honest non-claims

- Visual judges drift across providers and runs. Re-run if a single number swings ±5%.
- The decompose model occasionally tokenizes text incorrectly (e.g. `Code` → `C&b`). The deterministic text-coverage check catches this; that's why we have both.
- This is pre-alpha. The `parity_pipeline` tool burns ~$0.40-$0.65 per call with default models. Override to cheaper tiers if iterating heavily.

## Install Playwright browser binary

The first run of `parity_verify` (with a source image) or `parity_pipeline` will need Chromium. If `npx parity-studio-mcp` doesn't auto-install it on first call:

```bash
npx playwright install chromium
```

## License

MIT. See [parent repo LICENSE](../LICENSE).
