# NodeSlide MCP and local BYOK

NodeSlide’s MCP server is a second front door to the same governed actions as the browser UI. It is local stdio in this release. A hosted Streamable HTTP endpoint is intentionally not exposed until it has OAuth 2.1, scoped tokens, revocation, and provenance/metering headers.

## What stays invariant

- External model and web egress require explicit consent on every task.
- Client config, environment variables, saved keys, model selection, and tool defaults never grant
  consent. External calls accept only a literal `consent: true` supplied for that exact call after
  user approval; deterministic calls omit it.
- `nodeslide.propose_edit` returns an unapplied proposal and candidate receipt. It verifies the deck version did not change.
- `nodeslide.accept_proposal` is a separate review action and revalidates candidate digest, scope, locks, and version clocks.
- Owner authority and quota are enforced in Convex, not trusted to the MCP client.
- Local BYOK keys stay in the MCP process. They are never sent to Convex, returned by a tool, written into Trace, or logged.
- Trace records the actual provider/model, cost, tokens, candidate digest, validation, and human review state.

## Claude Code and Cursor

Use the in-app **BYOK / Agents** control to configure a provider in the current tab and copy a ready `.mcp.json` snippet, or start from [`mcp/examples/nodeslide.mcp.json`](../mcp/examples/nodeslide.mcp.json).

```json
{
  "mcpServers": {
    "nodeslide": {
      "command": "npx",
      "args": [
        "-y",
        "https://parity-studio.vercel.app/downloads/parity-studio-mcp-0.4.0.tgz"
      ],
      "env": {
        "PARITY_CONVEX_URL": "https://blissful-pig-998.convex.cloud",
        "PARITY_DASHBOARD": "disabled",
        "NODESLIDE_OWNER_ACCESS_KEY": "${NODESLIDE_OWNER_ACCESS_KEY}",
        "NODESLIDE_BYOK_MODEL": "z-ai/glm-5.2",
        "OPENROUTER_API_KEY": "${OPENROUTER_API_KEY}"
      }
    }
  }
}
```

On Windows, use `npx.cmd`. Claude Code project-scoped servers live in `.mcp.json` and require project approval before use.

## Codex

Codex uses `~/.codex/config.toml` or a trusted project’s `.codex/config.toml`:

```toml
[mcp_servers.nodeslide]
command = "npx"
args = ["-y", "https://parity-studio.vercel.app/downloads/parity-studio-mcp-0.4.0.tgz"]
env_vars = ["NODESLIDE_OWNER_ACCESS_KEY", "OPENROUTER_API_KEY"]
default_tools_approval_mode = "writes"

[mcp_servers.nodeslide.env]
PARITY_CONVEX_URL = "https://blissful-pig-998.convex.cloud"
PARITY_DASHBOARD = "disabled"
NODESLIDE_BYOK_MODEL = "z-ai/glm-5.2"
```

Use `npx.cmd` as the command on Windows. In Codex, `/mcp` shows connected servers and tool state.

The in-app config remains pinned to the already-deployed v0.4.0 archive instead of using npm
`latest`; this interoperability port intentionally does not check in a new package archive. Verify
that deployed archive with
[`parity-studio-mcp-0.4.0.sha256`](../public/downloads/parity-studio-mcp-0.4.0.sha256).

The v0.5.0 source in this repository adds the snapshot, element, spec-export, and exact-patch tools
listed below. Until that version is published, build it from a trusted checkout and point the MCP
client at the absolute `mcp/dist/index.js` path:

```bash
pnpm --dir mcp install --frozen-lockfile
pnpm --dir mcp build
node /absolute/path/to/parity-studio/mcp/dist/index.js
```

For a source build, set the MCP `command` to `node` and `args` to the single absolute path above;
keep the same environment and write-approval settings. Publishing v0.5.0 is a release operation,
not part of this source port.

## Provider routing

- OpenRouter: model such as `z-ai/glm-5.2` plus `OPENROUTER_API_KEY`.
- Anthropic direct: model such as `anthropic/claude-sonnet-4-6` plus `ANTHROPIC_API_KEY`.
- OpenAI direct: model such as `openai/gpt-5.4` plus `OPENAI_API_KEY`.
- OpenAI-compatible/local endpoint: set `NODESLIDE_BYOK_BASE_URL`, an OpenAI model id, and the endpoint’s key if required.

Key presence never grants consent. Neither copied config nor a prior call stores consent. After the
user approves the exact external task, that MCP call must set literal `consent: true`; the next task
starts unconsented. Deterministic calls do not need or carry consent.

## v0.5.0 source tools

| Tool | Effect |
| --- | --- |
| `nodeslide.byok_status` | Read-only key-presence check; values never returned |
| `nodeslide.get_deck` | Read-only structured deck summary + receipt |
| `nodeslide.get_snapshot` | Read-only canonical snapshot with version clocks |
| `nodeslide.list_elements` | Bounded, paginated structured element listing |
| `nodeslide.evaluate_quality` | Read-only release preflight for story, evidence, visual craft, editability, reference quality, and recorded journey proof |
| `nodeslide.export_spec` | Versioned `nodeslide.deck-snapshot` JSON envelope |
| `nodeslide.list_slides` | Read-only slides and version clocks |
| `nodeslide.get_trace` | Read-only model/cost/token/digest/validation trace |
| `nodeslide.list_versions` | Read-only immutable version history |
| `nodeslide.propose_edit` | Local BYOK, hosted, or deterministic planning; always unapplied |
| `nodeslide.propose_patch` | Exact external-agent typed patch; validated and always unapplied |
| `nodeslide.accept_proposal` | Explicit reviewed commit to a new version |
| `nodeslide.reject_proposal` | Rejects proposal; deck unchanged |
| `nodeslide.upload_source` | Bounded private source ingestion with server digest |
| `nodeslide.search_web` | Consented web research + unapplied sourced proposal |
| `nodeslide.create_deck` | Governed deck creation; hosted path requires consent |

## Example agent turn

```text
1. Call nodeslide.get_deck with deckId.
2. Call nodeslide.list_slides and choose slide_1.
3. Show the user the provider/model and the exact task context, then obtain approval for this call.
4. Call nodeslide.propose_edit with execution="byok", scope="slide",
   slideId="slide_1", consent=true, and an explicit instruction.
5. Inspect candidateReceipt and nodeslide.get_trace.
6. Stop for human review. Do not call accept_proposal unless the user explicitly approves.
7. After acceptance and export, call nodeslide.evaluate_quality with the verified journey-proof JSON. Missing browser video, GIF, screenshot, editable PPTX, manifest, reference receipt, or an exact +1 version transition remains a release blocker.
```

The proposal response includes `applied: false` and identical before/after deck versions. A mismatch fails closed as a governance violation.
