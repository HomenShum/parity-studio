# parity-studio-mcp

> MCP server for [Parity Studio](../). Lets coding agents (Claude Code, Cursor, Windsurf, any MCP client) generate, decompose, and verify `ui_kit/` bundles directly from a sketch or prompt — without leaving the editor.

**Status**: v0.0.1 · stdio transport · 4 tools

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
        "PARITY_JUDGE_MODEL": "claude-sonnet-4-5"
      }
    }
  }
}
```

You need at least one of: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` — depending on the model ids you use.

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

## Why a boolean rubric?

Every check returns `{passed: boolean}`. The score is `passCount / totalChecks` — a derivation, not an LLM-fabricated float. A check failed = the score drops by exactly `1 / totalChecks`. No fudging, no rounding, no "looked good overall" rubber-stamping.

This is the same primitive the [main parity-studio repo](../) uses internally and that the [open-codesign PR #241](https://github.com/OpenCoworkAI/open-codesign/pull/241) shipped upstream.

## Why split deterministic + visual checks?

- **Deterministic** (no LLM, no cost): catches dropped text, missing expected files, fabricated hardcoded values not present in source/tokens.css. Runs in milliseconds.
- **Visual** (vision LLM): catches semantic drift the deterministic checks can't see — "the chart looks janky", "the header lost its hierarchy", etc.

Either alone misses things. The deterministic check missed a layout regression in our self-dogfood ([DOGFOOD.md](../DOGFOOD.md)); the visual judge missed a text tokenization artifact (`Code` rendered as `C&b`). Combined, you get honest coverage.

## Cost reference

Per `parity_pipeline` call with default models (claude-opus-4-1 decompose + claude-sonnet-4-5 judge), high-quality gpt-image-1 generate:

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
