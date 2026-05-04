# Agent-Native Parity Workflow

**Date:** 2026-05-03

**Goal:** make Parity Studio natively usable by a coding agent as the design-first staging layer before a large repo revamp. The user should be able to say:

> Use Parity Studio on this repo, redesign the settings flow, verify it, make proof videos, and show me the side-by-side before touching production code.

The agent should then complete the loop without asking the user to keep typing `continue`.

## Product Principle

Parity Studio should become a pre-code design operating system:

1. Capture or generate candidate UI surfaces as canonical `ui_kit` slugs.
2. Improve those slugs through comment/edit/inspiration/refactor loops.
3. Browser-verify the result with screenshots, console checks, viewport checks, and parity checks.
4. Compose proof media: GIF/MP4 walkthroughs plus source/preview side-by-side.
5. Verify the proof media with a vision model.
6. Export the kit, apply to the repo only when the user accepts it, and keep a rollback/version trail.

This supplements Figma, Claude Design, and normal coding-agent edits. It creates a safe staging layer where the agent can make design changes visible before committing to a full repo rewrite.

## Open Design Patterns To Adapt

Open Design's README describes a local-first agent runtime where existing coding-agent CLIs on the user's `PATH` become the design engine, with BYOK, skills, design systems, a prompt stack, sandboxed iframe preview, exports, media generation, and a local `.od` SQLite/project workspace. Source: https://github.com/nexu-io/open-design

Adapt these patterns:

- **Local daemon / MCP as privileged runtime:** Parity's MCP server should own local browser capture, filesystem writes, media rendering, and provider-key access. Hosted Parity should receive generated artifacts and proof metadata, not user secrets.
- **Skill catalog, not one-off prompts:** Keep per-kit `.claude/skills/<slug>/SKILL.md`, but add reusable Parity skill modes: `route-redesign`, `dashboard`, `mobile-flow`, `component-library`, `demo-video`, `figma-bridge`.
- **Direction picker:** Before generation, the agent locks surface, audience, workflow, fidelity, brand source, and visual direction. No freestyle first draft.
- **Durable checklist culture:** Chat `set_todos` is not enough. Every run should maintain durable design/proof files in the kit.
- **Media as proof:** Video/GIF creation and verification should be first-class MCP tools, not release-only scripts.

## Canonical Run Contract

Add these files to every serious run:

```txt
ui_kits/<slug>/
  design.plan.md
  proof.checklist.md
  browser-qa.proof.json
  media.plan.json
  figma.bridge.json
```

### `design.plan.md`

Purpose, target users, surfaces, visual direction, constraints, and acceptance criteria.

### `proof.checklist.md`

Agent-owned checklist with these sections:

- Design intent
- Source capture
- UI kit generation/decomposition
- Comment/edit or reimagination loop
- Browser QA
- Parity Coach interpretation
- Video/GIF proof
- Video verification
- Export/import handoff
- Repo-apply readiness

### `browser-qa.proof.json`

Replayable proof:

```json
{
  "routes": [],
  "viewports": ["desktop", "tablet", "phone"],
  "screenshots": [],
  "consoleErrors": [],
  "overflowFindings": [],
  "clickTargets": [],
  "sourceHash": "",
  "previewHash": "",
  "status": "pass | warn | fail"
}
```

### `media.plan.json`

Which flows to record, expected moments, output paths, and video-verification rubric.

### `figma.bridge.json`

Optional bridge metadata:

```json
{
  "mode": "none | import | export | sync",
  "sourceFileKey": null,
  "frames": [],
  "tokens": [],
  "assets": [],
  "limitations": []
}
```

## MCP Tool Surface

Add high-level tools so users do not need to memorize low-level calls:

### `parity_design_mission`

One natural-language command:

```txt
Use Parity Studio on this repo. Redesign the settings flow, show side-by-side, verify, record proof, and export the kit.
```

Internally:

1. Detect running local app.
2. Capture target route(s).
3. Create or import `ui_kit` slugs.
4. Generate `design.plan.md` and `proof.checklist.md`.
5. Run inspiration/search if requested.
6. Iterate with the hosted run or local kit.
7. Browser-verify.
8. Record proof media.
9. Verify proof media.
10. Export ZIP and hosted run URL.

### `parity_browser_verify`

Returns screenshots, console errors, responsive overflow findings, and clickable-target checks. Writes `browser-qa.proof.json`.

### `parity_record_demo`

Uses existing Playwright recorder scripts as a library. Inputs are run URL, scenes, viewport, output path. Outputs MP4 and optional GIF.

### `parity_verify_video`

Uses Gemini/video-capable model configured in local MCP env. Checks whether the video demonstrates the intended flow, not just whether a file exists.

### `parity_figma_import`

Initial scope: import exported Figma JSON/SVG/PNG assets and token metadata into `ui_kit` assets plus `figma.bridge.json`.

### `parity_figma_export`

Initial scope: export tokens, SVG/PNG assets, HTML preview screenshots, and frame metadata. Do not promise full vector component variants until the contract can represent Figma variants safely.

## Hosted UI Changes

- Replace any "send continue" dead-end with bounded automatic continuation.
- Add a "Mission checklist" card in the Agent stream that mirrors `proof.checklist.md`.
- Add a "Proof" tab next to Preview/Inspiration for browser QA screenshots and video clips.
- Add a "Design mission" launcher in New run with:
  - existing app route
  - target flow
  - desired visual direction
  - whether to record proof media
  - whether to prepare Figma bridge files
- Keep `Sync` and `Tokens` compact in the toolbar, but expose full labels via aria-label/title/tooltips.

## Safety / Privacy

- Local MCP BYOK stays local. Provider keys are read from MCP process env only.
- Hosted Parity receives redacted source HTML, kit files, screenshots, and proof outputs only after explicit import/upload.
- Figma tokens/assets are user-provided artifacts; do not fetch private Figma data from hosted Parity without auth and consent.
- Video proof may contain private source UI. Default output path should be local; hosted upload is opt-in.

## Implementation Order

1. Ship bounded auto-continue in `convex/chatLoop.ts`.
2. Add canonical `design.plan.md`, `proof.checklist.md`, `browser-qa.proof.json`, `media.plan.json`, and `figma.bridge.json` scaffolds in canonical export/import.
3. Add `parity_browser_verify` to MCP using existing Playwright/render helpers.
4. Wrap demo recorder and Gemini video verification as `parity_record_demo` and `parity_verify_video`.
5. Add hosted Proof tab and checklist UI.
6. Add `parity_design_mission` high-level MCP wrapper.
7. Add Figma import/export bridge at token/asset/frame-metadata level.

## Success Criteria

- A coding agent can run a design mission on a large repo without manually typing `continue`.
- The user gets a hosted run URL, ZIP export, browser QA proof, and MP4/GIF proof.
- The agent can show design side-by-side before editing production app code.
- The exported kit includes enough instructions for Claude Code, Codex, Cursor, and Figma-adjacent workflows.
- No provider keys or private credentials are uploaded to hosted Parity.
