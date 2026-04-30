# parity-studio-mcp

> MCP server for Parity Studio. Lets coding agents (Claude Code, Codex, Cursor, Windsurf, any MCP client) capture an existing app route, decompose it into a canonical `ui_kit/`, import it into Parity Studio, and keep iterating without leaving the editor.

**Status**: v0.2.0 - stdio transport - 11 tools

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
        "PARITY_DECOMPOSE_MODEL": "claude-opus-4-1",
        "PARITY_JUDGE_MODEL": "claude-sonnet-4-5",
        "PARITY_CONVEX_URL": "https://blissful-pig-998.convex.cloud",
        "PARITY_CONVEX_HTTP_URL": "https://blissful-pig-998.convex.site"
      }
    }
  }
}
```

You need at least one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY` depending on the model ids you use for local tools such as `parity_platform_to_ui_kit`, `parity_pipeline`, `parity_decompose`, and `parity_verify`.

The hosted tools (`parity_enhance_prompt`, `parity_chat_*`, `parity_run_*`, `parity_export`) call the hosted Parity Studio Convex deployment at `PARITY_CONVEX_URL` by default. Override the URLs to point at your own deployment.

## Local Dashboard

The MCP server starts a tiny local HTTP server on port `6280` (overridable via `PARITY_DASHBOARD_PORT`) and opens it in your browser the first time your agent calls a parity tool. You can watch the pipeline run live: source/rendered split, file tree, parity score, cost meter, log feed, and ZIP export.

`PARITY_DASHBOARD` env values:

- `auto-open` (default): start server, open browser on first tool call
- `server-only`: start server, never open browser
- `disabled`: do not start the dashboard

## Tools

### `parity_platform_to_ui_kit` - existing product route to Parity Studio

Use this when you already have a built app/platform and want a coding agent to break a route down into a canonical `ui_kit` for Parity Studio iteration.

What it does:

- Opens a running URL with Playwright, e.g. `http://localhost:3000/dashboard`.
- Captures standalone HTML/CSS from the rendered route.
- Optionally reads local source context from `projectRoot` so component names, tokens, and product vocabulary survive.
- Reuses the existing decompose prompt/model pipeline to emit `ui_kits/<slug>/{index.html, components/*.tsx, tokens.css, manifest.json, README.md}`.
- Runs deterministic parity against the captured platform HTML.
- Writes a canonical ZIP if `outputZipPath` is provided.
- Imports the kit into hosted Parity Studio by default and returns a `runUrl` for continued scoped iteration.

Example agent request:

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

Takes a complete HTML artifact and emits `ui_kits/<slug>/{index.html, components/*.tsx, tokens.css, manifest.json, README.md}`.

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

## Why a Boolean Rubric?

Every check returns a boolean or bounded verdict. The score is derived from `passCount / totalChecks`; it is not an LLM-fabricated float.

## Install Playwright Browser Binary

The first run of `parity_platform_to_ui_kit`, `parity_verify` with a source image, or `parity_pipeline` needs Chromium. If it is missing:

```bash
npx playwright install chromium
```

## License

MIT. See the parent repo license.