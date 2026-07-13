# NodeSlide MCP and local BYOK

NodeSlide’s MCP server is a second front door to the same governed actions as the browser UI. It is local stdio in this release. A hosted Streamable HTTP endpoint is intentionally not exposed until it has OAuth 2.1, scoped tokens, revocation, and provenance/metering headers.

## What stays invariant

- External model and web egress require explicit consent on every task.
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

The production tarball is pinned instead of using npm `latest`, so a copied config cannot silently
resolve to an older MCP server. Verify it with
[`parity-studio-mcp-0.4.0.sha256`](../public/downloads/parity-studio-mcp-0.4.0.sha256).

## Provider routing

- OpenRouter: model such as `z-ai/glm-5.2` plus `OPENROUTER_API_KEY`.
- Anthropic direct: model such as `anthropic/claude-sonnet-4-6` plus `ANTHROPIC_API_KEY`.
- OpenAI direct: model such as `openai/gpt-5.4` plus `OPENAI_API_KEY`.
- OpenAI-compatible/local endpoint: set `NODESLIDE_BYOK_BASE_URL`, an OpenAI model id, and the endpoint’s key if required.

Key presence never grants consent. The MCP call must still set `consent: true` for that single external task.

## Tools

| Tool | Effect |
| --- | --- |
| `nodeslide.byok_status` | Read-only key-presence check; values never returned |
| `nodeslide.get_deck` | Read-only structured deck summary + receipt |
| `nodeslide.list_slides` | Read-only slides and version clocks |
| `nodeslide.get_trace` | Read-only model/cost/token/digest/validation trace |
| `nodeslide.list_versions` | Read-only immutable version history |
| `nodeslide.propose_edit` | Local BYOK, hosted, or deterministic planning; always unapplied |
| `nodeslide.accept_proposal` | Explicit reviewed commit to a new version |
| `nodeslide.reject_proposal` | Rejects proposal; deck unchanged |
| `nodeslide.upload_source` | Bounded private source ingestion with server digest |
| `nodeslide.search_web` | Consented web research + unapplied sourced proposal |
| `nodeslide.create_deck` | Governed deck creation; hosted path requires consent |

## Example agent turn

```text
1. Call nodeslide.get_deck with deckId.
2. Call nodeslide.list_slides and choose slide_1.
3. Call nodeslide.propose_edit with execution="byok", scope="slide",
   slideId="slide_1", consent=true, and an explicit instruction.
4. Inspect candidateReceipt and nodeslide.get_trace.
5. Stop for human review. Do not call accept_proposal unless the user explicitly approves.
```

The proposal response includes `applied: false` and identical before/after deck versions. A mismatch fails closed as a governance violation.
