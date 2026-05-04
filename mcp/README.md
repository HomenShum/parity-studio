# parity-studio-mcp

> MCP server for Parity Studio. Lets coding agents (Claude Code, Codex, Cursor, Windsurf, any MCP client) capture an existing app route, decompose it into a canonical `ui_kit/`, import it into Parity Studio, and keep iterating without leaving the editor.

**Status**: v0.3.1 - stdio transport - 14 tools + agent prompts/resource rules

## Install

In Claude Code, Codex, Cursor, Windsurf, or any MCP client config:

```json
{
  "mcpServers": {
    "parity-studio": {
      "command": "npx",
      "args": ["-y", "parity-studio-mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "OPENAI_API_KEY": "sk-...",
        "OPENROUTER_API_KEY": "sk-or-...",
        "GEMINI_API_KEY": "AI...",
        "PARITY_DECOMPOSE_MODEL": "claude-opus-4-7",
        "PARITY_JUDGE_MODEL": "claude-sonnet-4-6",
        "PARITY_CONVEX_URL": "https://blissful-pig-998.convex.cloud",
        "PARITY_CONVEX_HTTP_URL": "https://blissful-pig-998.convex.site"
      }
    }
  }
}
```

You need at least one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, or `GEMINI_API_KEY` depending on the model ids you use for local tools such as `parity_platform_to_ui_kit`, `parity_pipeline`, `parity_decompose`, and `parity_verify`.

The hosted tools (`parity_enhance_prompt`, `parity_chat_*`, `parity_run_*`, `parity_export`) call the hosted Parity Studio Convex deployment at `PARITY_CONVEX_URL` by default. Override the URLs to point at your own deployment.

Local MCP BYOK keeps provider keys in the local MCP process environment. The server only returns which key env vars are present; it never returns key values, writes them into kits, logs them, or uploads them to Parity Studio.

## Local Dashboard

The MCP server starts a tiny local HTTP server on port `6280` (overridable via `PARITY_DASHBOARD_PORT`) and opens it in your browser the first time your agent calls a parity tool. You can watch the pipeline run live: source/rendered split, file tree, parity score, cost meter, log feed, and ZIP export.

`PARITY_DASHBOARD` env values:

- `auto-open` (default): start server, open browser on first tool call
- `server-only`: start server, never open browser
- `disabled`: do not start the dashboard

## Tools

### `parity_design_mission` - design/UI slugs first, production code later

Use this when the user asks to iterate design/UI slugs first, preserve locked components, or show a Parity Studio design board before implementation.

```text
Use Parity Studio to iterate the design and UI slugs first for our reports flow.
Preserve the existing chat thread shell, report cards, and public research cards.
Do not edit production code until I approve the Parity Studio run.
```

What it does:

- Captures a running route using the same local BYOK-safe path as `parity_platform_to_ui_kit`.
- Creates a hosted Parity Studio run and canonical ZIP.
- Adds durable design-first files:
  - `design-slug-manifest.json`
  - `design.plan.md`
  - `proof.checklist.md`
  - `browser-qa.proof.json`
  - `media.plan.json`
  - `figma.bridge.json`
- Locks named slugs/components so the agent can iterate within the existing product grammar.
- Returns the ZIP path, hosted run URL, parity report, and next approval steps.

### `parity_studio` - natural-language app to zip/run wrapper

Use this for the simple user request:

```text
Use Parity Studio with our app, get me the zip export, upload it to Parity Studio,
and use my own env keys.
```

What it does:

- Uses `url` if provided, otherwise `PARITY_APP_URL`, otherwise probes common localhost dev ports.
- Defaults `projectRoot` to `.` so the agent can use the current app without verbose arguments.
- Uses local MCP BYOK env keys for model calls.
- Redacts obvious emails/API keys/tokens from captured HTML by default.
- Writes `./parity-<route>-ui-kit.zip` unless `outputZipPath` is provided.
- Imports the generated kit to hosted Parity Studio by default and returns the run URL.

### `parity_byok_status` - safe key presence check

Returns provider env-var presence for model ids without exposing values.

### `parity_platform_to_ui_kit` - existing product route to Parity Studio

Use this when you already have a built app/platform and want a coding agent to break a route down into a canonical `ui_kit` for Parity Studio iteration.

What it does:

- Opens a running URL with Playwright, e.g. `http://localhost:3000/dashboard`.
- Captures standalone HTML/CSS from the rendered route.
- Optionally reads local source context from `projectRoot` so component names, tokens, and product vocabulary survive.
- Reuses the existing decompose prompt/model pipeline to emit `ui_kits/<slug>/{index.html, components/*.tsx, tokens.css, manifest.json, README.md, parity.contract.json, performance.budget.json, api-wiring.plan.md, qa.plan.md}` plus agent rules.
- Runs deterministic parity against the captured platform HTML.
- Writes a canonical ZIP if `outputZipPath` is provided.
- Imports the kit into hosted Parity Studio by default and returns a `runUrl` for continued scoped iteration.

Explicit agent request:

```text
Use parity_platform_to_ui_kit on http://localhost:3000/settings with projectRoot=.,
write the zip to ./parity-settings-ui-kit.zip, and return the Parity Studio run URL.
```

Direct tool args:

```jsonc
{
  "url": "http://localhost:3000/settings",
  "projectRoot": ".",
  "outputZipPath": "./parity-settings-ui-kit.zip",
  "importToParityStudio": true,
  "decomposeModel": "moonshotai/kimi-k2.6"
}
```

### `parity_pipeline` - end-to-end

Generate, decompose, and verify in one call. Returns the `ui_kit/<slug>/` bundle plus a `ParityReport` with bounded enum status (`verified | needs_review | needs_iteration | failed | unavailable`) derived from `passCount / totalChecks`.

### `parity_decompose` - HTML to ui_kit only

Takes a complete HTML artifact and emits `ui_kits/<slug>/{index.html, components/*.tsx, tokens.css, manifest.json, README.md}` plus the operating contract/API/QA/performance files.

### `parity_verify` - score an existing ui_kit

Runs deterministic parity checks. If `sourceImageBase64` is provided, additionally runs the visual judge on a Playwright-rendered snapshot.

### `parity_export_zip` - pack for handoff

Bundles the `ui_kit` files into a ZIP and returns it as base64. Optionally appends a `HANDOFF.md` with integration instructions.

### Hosted Convex tools

These call the hosted Parity Studio deployment over HTTP. No local LLM keys are required for these tools.

- `parity_enhance_prompt`: rewrite a rough prompt for clarity.
- `parity_chat_send`: send a message to the agent for a run.
- `parity_chat_advise`: trigger advisor-executor auto-fix.
- `parity_chat_history`: read the conversation for a run.
- `parity_run_listRecent`: list recent hosted runs.
- `parity_export`: download a hosted run as ZIP, HTML, or Markdown.

## Agent Prompt / Rules

The server exposes:

- Prompt: `use-parity-studio`
- Prompt: `use-parity-design-mission`
- Resource: `parity://agent-rules`

MCP clients that support prompts/resources can load these so users do not need to know exact tool names or arguments.

## Why a Boolean Rubric?

Every check returns a boolean or bounded verdict. The score is derived from `passCount / totalChecks`; it is not an LLM-fabricated float.

## Install Playwright Browser Binary

The first run of `parity_platform_to_ui_kit`, `parity_verify` with a source image, or `parity_pipeline` needs Chromium. If it is missing:

```bash
npx playwright install chromium
```

## License

MIT. See the parent repo license.
