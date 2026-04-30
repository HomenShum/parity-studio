# Demo recorder — 3-scene trilogy

**Date:** 2026-04-29
**Goal:** capture the full parity-studio story in ~4 min, post the v0.1.0
features that the existing single-take recorder doesn't cover.

## Why three scenes, not one

The existing `scripts/record-end-to-end.mjs` is one continuous 5-8 min
Playwright take. It works but has two problems:

1. **Fragile** — if step 11 hangs, you re-shoot the whole thing.
2. **Missing the post-2026-04-29 features** — Kilo-style ✨ enhance,
   tier-cycle pill, advisor-executor "save + auto-fix", and the v0.1.0
   hosted-Convex MCP tools.

Splitting into 3 scenes makes each one independently re-recordable
and reusable on the landing page.

## The trilogy

### Scene 1 — "create" (~90s)

Existing `scripts/record-end-to-end.mjs`. Already works. No changes.

Captures: upload source image → type prompt → generate → watch parity
rail climb → artifact rendered in iframe → toggle code/preview tabs →
export ZIP.

```bash
node scripts/record-end-to-end.mjs
```

### Scene 2 — "iterate" (~60s)

New `scripts/record-scene-iterate.mjs`. Requires an existing populated
run (a generated kit with files + a rendered preview).

Captures the v0.1.0 features:

1. Open chat tab
2. Type a deliberately-rough draft prompt
3. Click ✨ enhance → small-tier rewrites the prompt in place
4. Cycle the tier pill (Balanced → Frontier → Free)
5. Send the chat turn → assistant reply streams
6. Switch to preview, toggle Comment mode
7. Drag a bbox on the rendered artifact, type a comment
8. Click ✨ save + auto-fix → advisor-executor runs (advise → execute → verify → close)
9. Canvas auto-flips to chat tab, advisor-executor turns stream

```bash
RUN_ID=<convex_run_id> node scripts/record-scene-iterate.mjs
```

To grab a runId quickly: open the prod app, run any pipeline, copy
the `?run=<id>` query param from the URL bar. Or hit the MCP tool
`parity_run_listRecent` from Claude Code.

### Scene 3 — "MCP" (~25s)

New `scripts/record-scene-mcp.mjs`. Self-contained — no Convex / no
runId required.

Browser can't capture a real terminal, so we render a Codex-/Claude-
Code-style **fake terminal** in HTML and drive it with Playwright:
type each MCP tool name, append a styled response, scroll. Snapshots
of the response shapes live in `scripts/record-scene-mcp.snapshots.json`
(committed if generated). Default snapshots in the script are
representative; refresh with `FETCH_LIVE=1 RUN_ID=<id>`.

Captures:

1. `parity_run_listRecent { limit: 2 }` → 2 recent runs with tier badges
2. `parity_enhance_prompt { text: 'soften the radius' }` → small-tier rewrite
3. `parity_chat_send { runId, text }` → turn 4 created · agent loop running
4. `parity_chat_history { runId }` → last 6 turns (user / tool / assistant)
5. `parity_export { runId, format: 'markdown' }` → 8.4 KB markdown handoff

```bash
node scripts/record-scene-mcp.mjs
```

### Stitch

`scripts/stitch-demo.mjs` picks the latest recording from each scene's
output folder under `runs/` and concatenates them with a 600ms
crossfade between cuts.

```bash
node scripts/stitch-demo.mjs
# → runs/demo-2026-04-29.mp4
```

Override picks via env: `SHELL_MP4=… ITERATE_MP4=… MCP_MP4=…`. Use
`NO_CROSSFADE=1` for hard cuts (faster ffmpeg pass).

## Smoke-test status

| Scene | Smoke-tested | Output |
|---|---|---|
| Scene 1 | already shipped | unchanged |
| Scene 2 | not tested in this PR | requires a live RUN_ID + costs a chat turn |
| Scene 3 | ✓ | `runs/recording-mcp-2026-04-30T06-06-14-130Z/recording.mp4` (23.8s, 720KB) |

Scene 2 selectors were derived by grepping the actual components for
`aria-label` matches, but a live smoke test requires a populated run
ID and would burn a real chat turn + advise loop. Verify on first
real-record by passing a known-good `RUN_ID`.

## Recording requirements

- Chromium via Playwright (`npx playwright install chromium` once)
- ffmpeg on PATH for MP4 transcode (webm fallback if missing)
- ffprobe on PATH for stitch crossfade durations (use `NO_CROSSFADE=1` if missing)

## Aspect / cuts not yet covered

- 1080×1920 vertical cut for LinkedIn/Twitter — not implemented; would
  require a second pass through ffmpeg with `crop=iw*0.36:ih:iw*0.32:0`
  or scene-specific recompositions
- Voiceover — silent demo with on-screen captions only; narration is
  out of scope for the recorder

## Anti-patterns

- Don't bake voiceover into the recording itself — keep audio as a
  separate track laid in post so it can be re-translated/re-cut
- Don't run scene 2 without a populated RUN_ID — the chat tab depends
  on the run having artifact files + a rendered preview
- Don't commit raw `runs/recording-*` artifacts — `.gitignore` already
  excludes `runs/`
