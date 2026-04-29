# Kilo-Adapt + MCP Expand — adaptation plan

**Date:** 2026-04-29
**Status:** drafting → implementing
**Triggers:** user asked to research Kilo Code's enhance-prompt + auto/free router and (separately) wrap all parity-studio services via MCP.

---

## Findings — Kilo Code (`Kilo-Org/kilocode`, 18.7k★)

### Enhance Prompt
`packages/opencode/src/kilocode/enhance-prompt.ts`

```ts
const INSTRUCTION =
  "Generate an enhanced version of this prompt (reply with only the enhanced prompt - no conversation, explanations, lead-in, bullet points, placeholders, or surrounding quotes):"

export async function enhancePrompt(text: string): Promise<string> {
  const defaultModel = await Provider.defaultModel()
  const model =
    (await Provider.getSmallModel(defaultModel.providerID)) ??
    (await Provider.getModel(defaultModel.providerID, defaultModel.modelID))
  const result = await generateText({
    model: ..., temperature: 0.7,
    system: INSTRUCTION,
    messages: [{ role: "user", content: text }],
    maxRetries: 3,
  })
  return clean(result.text) // strips ```fences``` + outer quotes
}
```

Properties:
- **Single instruction**, no system identity, no tools, no plugins.
- Calls `getSmallModel(providerID)` first; falls back to default. The small-model preference is the entire optimization.
- Temperature 0.7 (when supported).
- HTTP route `POST /enhance-prompt` with body `{ text }` returns `{ text }`.
- UI: `✨ sparkle` icon in chat input. Click → enhanced prompt **replaces draft inline**. User can edit further before sending. Doesn't auto-send.
- Custom template + custom provider profile both supported (user can override the INSTRUCTION).

### Auto Model Tiers (`auto-model-tiers.md`)

Four tiers, three user-facing:

| Tier ID | Audience | Pricing | Notes |
|---|---|---|---|
| `kilo-auto/frontier` | best paid models | paid | mode-aware (architect → opus, code → sonnet) |
| `kilo-auto/balanced` | strong @ low cost | paid | API-aware (chat → qwen, responses → gpt-5.5, messages → sonnet-4.6) |
| `kilo-auto/free` | hobbyists / unauth | free | session-deterministic pick from server-curated free pool |
| `kilo-auto/small` | internal — bg tasks | varies | titles, commit msgs, **enhance-prompt** |

Architecture (relevant bits):
- **Server defines mode → model mapping**, fetched via Kilo Gateway with 5-minute TTL cache. Lets them update routing without a client release. Absorbs free-tier churn.
- `getSmallModel(providerID)` prioritizes `kilo-auto/small` when the Kilo provider is active.
- Free tier picks are **session-deterministic** (same model across a session) so context doesn't whiplash.
- **Cross-family thinking blocks are stripped** when models switch between turns to prevent compatibility errors.
- Model objects carry an `isFree: boolean` flag.
- `recommendedIndex: number` for ranking inside a tier.
- Server returns an `opencode.variants` map per model: `{ architect: { model: ..., options: ... }, code: { model: ..., options: ... } }`.

### Risks called out by Kilo
- Free model disappears mid-session → fallback chain primary→secondary→tertiary.
- Cross-family model switching breaks context → strip thinking blocks at boundary.
- Quality variance → curate, don't just pick the cheapest.

---

## Findings — parity-studio `mcp/` (existing package, v0.0.2)

Path: `mcp/src/index.ts`. Tools today:
- `parity_pipeline` — full e2e prompt|image → ui_kit + ParityReport
- `parity_decompose` — HTML artifact → ui_kit/<slug>/* files
- `parity_verify` — ui_kit + sourceHtml → ParityReport
- `parity_export_zip` — ui_kit files → base64 ZIP

Stack: `@modelcontextprotocol/sdk` v1.29, stdio transport, pi-ai for LLM, JSZip for export, Playwright for headless render.

**Gap vs the web app today:** none of the new chat-agent / advisor-executor / atomic-edit / canonical-import / parity-rubric-v2 services are exposed via MCP. The MCP package is stuck at the v0.0.1 mental model.

---

## Adaptation plan (this PR)

### 1. Enhance Prompt — pi-ai chat composer (`✨` button)

- **Backend**: new mutation `chat.enhance({ runId, text })` (V8) → schedules `chatLoop.runEnhanceLoop` (Node action). The enhance loop:
  - Calls pi-ai with `system = INSTRUCTION` (Kilo's verbatim — credit the source)
  - User content = user's draft text, single turn, no tools
  - Returns the cleaned text via the action's return value
  - Model: `CHAT_ENHANCE_MODEL` env (default = `CHAT_ADVISOR_MODEL` since that's the cheap tier)
- **Frontend**: ChatPanel composer gets a sparkle button. Click → calls `chat.enhance` → replaces draft text. Loading spinner during call. Undo via the existing textarea history.
- **No auto-send**: matches Kilo's UX — user reviews + edits before send.

### 2. Auto Router — 4 tiers in `convex/lib/autoRouter.ts`

Server-defined tier mapping (no remote gateway — we're not fetching from a live API like Kilo does, simpler approach: hardcode the curated map and update it via deploys). Live in code, version-controlled, easy to update.

```ts
export type ModelTier = 'frontier' | 'balanced' | 'free' | 'small';
export type Phase = 'enhance' | 'advise' | 'execute' | 'decompose' | 'iterate' | 'judge';

export function resolveModel(tier: ModelTier, phase: Phase): { provider: SupportedProvider; modelId: string } {
  // frontier:
  //   advise/execute   → anthropic / claude-opus-4-1
  //   decompose/iter   → anthropic / claude-sonnet-4-5
  //   judge            → openrouter / google/gemini-3.1-pro-preview
  // balanced:
  //   advise/execute   → anthropic / claude-sonnet-4-5
  //   decompose/iter   → openrouter / moonshotai/kimi-k2.6
  //   judge            → openrouter / google/gemini-3.1-pro-preview
  // free:
  //   advise/execute   → openrouter / deepseek/deepseek-chat-v3.1:free  (curated)
  //   decompose/iter   → openrouter / google/gemini-2.0-flash-exp:free  (curated)
  //   judge            → openrouter / google/gemini-2.0-flash-exp:free
  // small (enhance, titles):
  //   any phase        → anthropic / claude-haiku-4-5    (when authed)
  //                   ↓ fallback openrouter / openai/gpt-oss-20b:free
}
```

Key properties (cribbed from Kilo):
- **Session-deterministic free picks**: a runId hashes to the same free model across the whole conversation so context doesn't whiplash.
- **isFree** flag on each entry — UI surfaces "$0" badge.
- **Fallback chain** per tier: if primary errors, hop to secondary.
- **Cross-family thinking-block stripping**: when an executor turn flips between Claude and OpenAI families, strip extended-thinking content blocks before sending the next request (we don't currently emit thinking blocks, but the guardrail is cheap).

Wired into `chatLoop.ts`:
- `CHAT_TIER` env (default `balanced`) sets default tier.
- `CHAT_ADVISOR_MODEL` / `CHAT_EXECUTOR_MODEL` envs still override the tier-derived choice (existing knobs survive).
- Convex env can flip the whole deployment to `free` for a demo without code changes.

Frontend: ModelPicker pill in ChatPanel composer cycles `Frontier · Balanced · Free` (small is internal). Click → updates a session pref (URL param or localStorage). The next `chat.send` carries the tier.

### 3. MCP wrapping — expose every new service

`mcp/src/index.ts` extended with these tools (drop-in next to the existing 4):

| Tool | Wraps | Args |
|---|---|---|
| `parity_chat_send` | `chat.send` | `runId, text` |
| `parity_chat_advise` | `chat.startAdviseLoop` | `runId, kind: 'comment'|'file'|'manual', commentId?, filePath?, prompt?` |
| `parity_chat_history` | `chat.list` | `runId` |
| `parity_enhance_prompt` | `chat.enhance` | `text` (no runId — pure stateless enhance) |
| `parity_upsert_file` | `uiKits.upsertFile` | `runId, path, content` |
| `parity_lint` | `lintKit` from `staticLint.ts` | `runId, paths?` (returns done-style report) |
| `parity_import_kit_zip` | `runs.startFromKit` | `slug, files: Record<string, string>, sourceImageBase64?, sourceImageMimeType?, prompt?` |
| `parity_run_listRecent` | `runs.listRecent` | `limit?` |
| `parity_run_get` | `runs.get` | `runId` |
| `parity_export_html` | GET `/api/runs/:id/html` | `runId` (returns inlined HTML string) |
| `parity_export_markdown` | GET `/api/runs/:id/markdown` | `runId` (returns .md string) |
| `parity_canonical_kit` (existing `parity_export_zip`) | unchanged but bumped to use `/api/runs/:id/zip` route | — |
| `parity_set_tier` | session-only override | `tier: 'frontier' | 'balanced' | 'free'` |

**Auth**: MCP env block adds `PARITY_CONVEX_URL` (default `https://blissful-pig-998.convex.cloud`) + `PARITY_CONVEX_HTTP_URL` (default `https://blissful-pig-998.convex.site`). Optional `PARITY_DEPLOY_KEY` for write-mutations on a private deployment.

**Transport**: stdio (existing) + a new `--http` mode that mounts on a port (uses `@hono/node-server` already a dep) so remote agents over a tunnel can call too.

**Convex client**: use `@convex-dev/sdk` HTTP client (no websocket persistence needed for one-shot tool calls).

### Sequencing

1. Enhance backend (`chat.enhance` mutation + Node action loop)
2. Enhance frontend (sparkle button in composer)
3. Auto router lib (`convex/lib/autoRouter.ts`)
4. Wire router into `chatLoop.ts` + `generation.ts`
5. ModelPicker pill in composer
6. MCP package: add tools, bump version, README, publish prep (don't auto-publish; user runs `pnpm publish` when ready)
7. Live test each surface
8. Commit + push

### Non-goals for this PR
- No remote Kilo Gateway-style API: tier maps live in our repo, update via PRs.
- No actual session-sticky free model picking implemented from a remote pool — we hardcode the curated free list. Enhancement: future remote config.
- No thinking-block stripping yet (we don't emit them today).
- No LSP/diff-aware enhance (Kilo doesn't either; it's just a single-shot rewrite).

---

## Risks / gotchas

- **Free model availability churn**: OpenRouter free slugs come and go. Hardcoded fallbacks WILL go stale. Mitigation: comment the slugs with a "verified on YYYY-MM-DD" date and document the manual update cadence.
- **Tier flip mid-conversation**: if user flips Frontier → Free between turns, executor loop sees inconsistent capabilities. Solution: snapshot the tier at `runAgentLoop` start; ignore mid-loop changes.
- **Enhance-prompt + agent identity collision**: Kilo's enhance uses NO system prompt. Our chat agent has a long system prompt with tool definitions. Important to call enhance with the BARE INSTRUCTION (not the chat system prompt) or the rewrite will be biased toward tool-call shape.
- **MCP stdio vs HTTP**: stdio works inside Claude Code/Cursor today; HTTP is a "nice to have" for remote agents but adds attack surface. Ship stdio in this PR; HTTP later.
- **MCP version bump**: package.json says `0.0.2`, README says `parity-studio-mcp`. Bump to `0.1.0` when these tools land — semver minor for the tool surface expansion.

---

## Acceptance

- ✅ `✨ enhance` button in ChatPanel composer rewrites text inline; user can review before sending
- ✅ ModelPicker pill cycles 3 user-facing tiers; tier persists via URL param
- ✅ `chat.send` and `chat.startAdviseLoop` honor the tier when no explicit model is set
- ✅ MCP package exposes all 13 tools listed above; existing 4 still work
- ✅ Live e2e: chat enhances + sends + agent runs in `free` tier without consuming anthropic credits
- ✅ tsc clean, build clean, MCP `npm pack --dry-run` clean
