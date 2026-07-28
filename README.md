# Parity Studio

> Image to verified, componentized `ui_kit/`. Self-judged with a 16-check deterministic rubric. Honest score drift on every iteration. Coding-agent-ready handoff.

Parity Studio also works as a design-staging layer for real codebases. Before a coding agent rewrites your app, capture the current UI, decompose it into editable slugs, prove what changed, then apply only the approved deltas back to production.

## NodeSlide moved

**NodeSlide ships from its own repo and deployment: [`nodeslide.vercel.app`](https://nodeslide.vercel.app/) ([HomenShum/NodeSlide](https://github.com/HomenShum/NodeSlide)).** As of Phase 4 of [`docs/DECOUPLING_PLAN.md`](docs/DECOUPLING_PLAN.md), this deployment serves Parity Studio by default; old `?domain=nodeslide` and `?share=<id>` links 301 to the product deployment and stay redirected until at least 2026-10-25.

The NodeSlide code has not been deleted from this repo — that is Phase 3, gated on a port audit that is still red — so `?domain=nodeslide` remains a working route in a local build. The Atlas gallery is still served from here, at [`?domain=atlas`](https://parity-studio.vercel.app/?domain=atlas).

`VITE_ENABLE_PARITY_DOMAIN` survives as a kill switch: set it to `false` at build time to put this deployment back on NodeSlide.

NodeSlide's design notes below describe work that now lives in the product repo, and are kept here while the port completes.

**Launch posture (2026-07-10): GO for a controlled anonymous private preview; NO-GO for a public multi-tenant launch.** Editor access is protected by a 256-bit owner capability stored in the creating browser, and read-only presentation links use separate unguessable capabilities. This is a materially safer preview boundary than raw deck IDs, but it is not account authentication, tenant isolation, share revocation, or an enterprise access-control system.

NodeSlide's P0 proof includes:

- a responsive three-column studio with a storyboard, fitted slide canvas, and AI/Design/Comments/Versions/Data/Trace inspector tabs;
- canonical deck, slide, element, source, comment, patch, version, validation, trace, export, and presence records in Convex;
- fine-grained compare-and-set writes: stale non-overlapping edits can rebase, while overlapping stale work remains a visible proposal and never mutates the deck;
- direct text and speaker-note editing, slide add/duplicate/delete/reorder, element copy/duplicate, session undo/redo, and selected-element drag/resize;
- scoped copy/style/layout patches with review-before-accept AI edits, including an honest deterministic bounded fallback when `openrouter/free` is unavailable or invalid;
- anchored comment threads, revision restore as a new monotonic write, presenter mode, capability-safe read-only sharing, semantic HTML, and editable PowerPoint export;
- deterministic structure, readability, contrast, source-disclosure, capability, and export gates that inspect the exact snapshot before presenting or export;
- responsive desktop, tablet-drawer, and phone-storyboard layouts with modal focus containment, keyboard escape, named controls, and focus-visible canvas objects;
- per-session and global preview quotas plus production dependency audits with zero known vulnerabilities.

The separately hosted upstream SlideLang proof is an eight-slide historical integration artifact published at [slidelang.ai/present/nodeslide-golden/slidemaker](https://slidelang.ai/present/nodeslide-golden/slidemaker/). The repository proof script creates its own isolated seven-slide capability-owned sample; do not treat the hosted deck and the current browser dogfood deck as the same revision.

The local proof packet is in [`docs/dogfood/nodeslide-domain-v1`](./docs/dogfood/nodeslide-domain-v1/README.md). Reproduce the live HTML/PPTX and two-client CAS receipts against an isolated capability-owned sample with:

```bash
pnpm proof:nodeslide
```

To prove an existing deck, pass both `--deck <live-deck-id>` and `--owner-key <capability>` (or set `NODESLIDE_OWNER_ACCESS_KEY`). A raw deck ID never grants editor access.

NodeSlide reports export behavior per element (`web_native`, `pptx_editable`, `pptx_static_fallback`, `google_importable`, or `web_only`). Its Source inspector exposes a versioned, re-openable Deck JSON envelope and converts bounded PPTX files into reviewable typed-operation proposals with an explicit fidelity ledger. The Google Slides adapter and durable sync metadata are implemented, but live push/pull still requires deployment-owned OAuth configuration and user consent; NodeSlide does not claim universal animation support, arbitrary PPTX fidelity, or a native Google Slides editor. See [`docs/nodeslide-interoperability.md`](./docs/nodeslide-interoperability.md).

## The 6-step user flow

1. **Drop a gpt-image-2 image, drop a canonical `ui_kit` zip, drop a Figma bridge JSON/ZIP, capture a running app route, or generate one on the spot** from a prompt.
2. **Break it down** into individual UI components - exact parity, not approximations.
3. **Select a component** in the file tree.
4. **Comment** on it (a pinned bbox or a free-form note, scoped to that file).
5. **Iterate / edit** that scoped slice - not the whole artifact.
6. **Export as a `ui_kit` zip, Figma bridge, QA proof packet, or approved repo mapping** - same shape on the way in as on the way out, guided handoff to a coding agent or plugin-importable Figma frames.

That is the entire product. Every surface is in service of one of those six steps. The canonical zip shape (NodeBench AI Skill-pack format, see [docs/CANONICAL_KIT.md](./docs/CANONICAL_KIT.md)) is symmetric: drop one in, get one out.

## Existing App Flow

This is the additional wedge alongside image/prompt/zip import:

```text
existing running app route
-> browser capture
-> canonical ui_kit decomposition
-> deterministic parity verification
-> scoped comment/edit repair
-> QA proof packet
-> approved production apply mapping
```

Use this when the UI already exists and you want the agent to stage design changes before touching production code.

Open Design and Claude Design-style tools are strong at generating design artifacts. The missing first-class workflow is narrower: take an already-built product route, capture it, decompose it into a verified `ui_kit`, let humans comment on scoped pieces, let agents repair only the staged design, generate QA proof, and apply approved mappings back to the production repo.

Parity Studio now supports both paths: generate/import a new artifact, or capture/decompose an existing app route.

[**Try it live ->**](https://parity-studio.vercel.app)

---

## See it run

The README uses focused proof clips instead of one overloaded tour. Each GIF links to its MP4 in the release assets.

### Core `ui_kit` round trip

Import a canonical `ui_kit` ZIP, verify it, select a file, pin a meaningful comment on a visible preview element, trigger the agent auto-fix, and export the edited ZIP:

[![Parity Studio core ui_kit round-trip demo](https://github.com/HomenShum/parity-studio/releases/download/v0.3.1/demo-core-workflow-720.gif)](https://github.com/HomenShum/parity-studio/releases/download/v0.3.1/demo-core-workflow.mp4)

### Inspiration search -> agent brief

Search for reference patterns, review the recommended plan, apply it to the current run, and watch the agent stream start working from that brief:

[![Parity Studio inspiration workflow demo](https://github.com/HomenShum/parity-studio/releases/download/v0.3.1/demo-inspiration-workflow-720.gif)](https://github.com/HomenShum/parity-studio/releases/download/v0.3.1/demo-inspiration-workflow.mp4)

### Source sync + MCP handoff

Open the version-control modal, compare patch-current-run vs recapture-as-new-revision, copy MCP setup guidance, and trigger the sync agent:

[![Parity Studio source sync workflow demo](https://github.com/HomenShum/parity-studio/releases/download/v0.3.1/demo-sync-workflow-720.gif)](https://github.com/HomenShum/parity-studio/releases/download/v0.3.1/demo-sync-workflow.mp4)

### Product surface tour

Launch + model routing, BYOK/session privacy, run history/chat, file editing, Parity Coach, Inspiration, source sync/MCP setup, i18n, and export:

[![Parity Studio current workflows tour](https://github.com/HomenShum/parity-studio/releases/download/v0.3.1/demo-current-workflows-720.gif)](https://github.com/HomenShum/parity-studio/releases/download/v0.3.1/demo-current-workflows.mp4)

<sub>`v0.3.1` proof clips and the product tour were recorded from the live production app and checked with Gemini video analysis. The original v0.1.0 six-step demo remains archived in the `v0.1.0` release assets.</sub>

---

**Status**: LIVE - current web app + MCP v0.3.7

- **Web app**: https://parity-studio.vercel.app
- **Current workflow demo run**: https://parity-studio.vercel.app/?run=jh721fbd9rnvckyxz3p5annjjd8602x7
- **MCP server (npm)**: [`parity-studio-mcp`](https://www.npmjs.com/package/parity-studio-mcp) - `npx parity-studio-mcp` (`npx.cmd` for Windows stdio clients) - includes `parity_design_workflow_catalog`, `parity_design_mission`, `parity_agent_runtime_metadata`, `parity_apply_approved_design`, `parity_studio`, `parity_platform_to_ui_kit`, `parity_figma_export`, and `parity_figma_import` for Claude Code / Codex / Cursor to choose the right design workflow, stage design/UI slug changes, inspect safe runtime/env policy, apply approved deltas, hand off to Figma, or capture an existing app route into a Parity-ready `ui_kit` ZIP/run
- **Convex prod**: `blissful-pig-998` - HTTP routes at https://blissful-pig-998.convex.site
- Stack: single-page web - Convex Cloud + pi-ai - stdio MCP for Claude Code / Codex / Cursor / Windsurf

## Workflows available now

### Web app workflows

- **Capture or import an existing product surface**: start from a running app capture through MCP, a canonical kit, Claude Design-style skill pack, Open CoDesign-style export, plain HTML handoff ZIP, Figma bridge JSON/ZIP, or source screenshot. Parity normalizes those inputs into editable `ui_kits/<slug>/` surfaces.
- **Comment, repair, and prove before implementation**: select a file or pin a bbox on the preview, ask the agent to fix that scoped slice, read the Parity Coach impact summary, rerun verification, and export a proof packet before touching production code.
- **Start a new run from a prompt**: describe the surface and let the pipeline generate, decompose, verify, and stream the result.
- **Start from a source image**: attach a screenshot or generated image, then decompose it into a componentized `ui_kit`.
- **Import an existing `ui_kit` ZIP or design handoff**: drop a canonical kit, Claude Design-style skill pack, Open CoDesign-style export, or plain HTML handoff ZIP into the app. Parity preserves every `ui_kits/<slug>/` surface, creates `parity.project.json`, lets you switch web/mobile/workspace/CLI surfaces, then comment, edit, verify, and export again.
- **Import and export Figma bridge files**: drop a Parity Figma bridge JSON/ZIP or Figma REST file JSON into the composer. Export a Figma bridge ZIP from the header or Files handoff panel; the bundle contains `figma/manifest.json`, `code.js`, `ui.html`, token metadata, and `parity-figma-bridge.json` for round-trip import.
- **Choose the model route**: use Balanced AI, Best Quality AI, Free AI route, a preset model, or a custom provider/model id from Anthropic, OpenAI, Google Gemini, OpenRouter, Groq, Cerebras, xAI, or Mistral.
- **Session privacy + BYOK setup**: store browser-tab-only provider-key placeholders for the session, copy local MCP env setup, clear keys, or start a fresh session. Hosted Parity does not receive browser-entered BYOK secrets for model calls.
- **Manage projects and run history**: use the left rail to start runs, revisit recent runs, see run status, and keep a session-level project list.
- **Browse, create, edit, save, and revert kit files**: the Files view exposes the generated `ui_kits/<slug>/` files, design revision history, source image preview, selected-file scope, inline editing, and ZIP export.
- **Preview and comment on the generated UI**: use comment mode to pin a bbox to the preview or leave a free-form note scoped to the selected file.
- **Ask the agent to make scoped edits**: chat with the agent stream, enhance prompts, or trigger an advisor/executor fix from a comment, file, or manual request.
- **Use Parity Coach**: read the end-user impact readout, parity score, top recommendations, and quality-gate status instead of raw low-level check rows.
- **Run the Inspiration workflow**: search curated or live references, review product patterns, apply a safe inspiration brief to the agent, and improve the kit without copying source assets.
- **Sync stale source snapshots**: use the version-control modal to patch the current run or copy MCP recapture instructions when the original app route changed.
- **Switch language**: use English or Simplified Chinese UI text and localized Parity Coach readouts.

### Coding-agent and MCP workflows

- **Existing app route to staged design board**: call `parity_platform_to_ui_kit` on a running localhost or hosted route with `projectRoot=.` to capture rendered HTML/CSS, include code context, redact secrets, create a canonical ZIP, verify it, and optionally import it into hosted Parity Studio.
- **Natural existing-app capture**: ask Claude Code, Codex, Cursor, or Windsurf: "Use Parity Studio with our app, get me the zip export, upload it to Parity Studio, and use my own env keys."
- **Design workflow selection**: call `parity_design_workflow_catalog` when the user asks broadly and the agent needs to choose between existing-app capture, design mission, inspiration, comment repair, QA dogfood, Figma bridge, or approved production apply.
- **Design/UI slugs before production edits**: call `parity_design_mission` or ask: "Use Parity Studio to iterate the design and UI slugs first, preserve these locked components, and show me the hosted design board before touching production code." Design missions emit `DESIGN.md`, `design-system.rules.json`, `skill-routing.json`, `design-workflow.catalog.json`, `discovery.questions.json`, `open-design-takeaways.md`, `post-decompose.process.json`, `direction-cards.json`, `p0-checklist.md`, and `five-d-critique.json` so the agent locks source of truth, target flow, locked components, proof requirements, BYOK/privacy assumptions, source-first design-system rules, skill route, direction, exact baseline, and critique gates before patching code.
- **QA dogfood relay before merge**: design missions now emit `qa-dogfood.packet.json`, `qa-dogfood.plan.md`, `snapshot-snippets.json`, `gmail-magic-resend.html`, `remotion.storyboard.json`, and `easier-to-read-submission.md` so an agent can resend a readable proof packet with test links, GIF/MP4 plan, before/after snippets, workflow/persona/user-state lanes, and correction prompts.
- **Readable submission handoff**: use the companion [`easier-to-read-submissions`](https://github.com/HomenShum/easier-to-read-submissions) skill to turn the Parity packet into a repo-local `QA_DOGFOOD/<feature-id>/` folder and per-surface changelog lane updates. See [docs/QA_DOGFOOD_RELAY.md](./docs/QA_DOGFOOD_RELAY.md).
- **End-to-end local pipeline**: call `parity_pipeline` to generate, decompose, verify, optionally visually judge, and export a kit from a prompt or image.
- **Decompose-only workflow**: call `parity_decompose` to turn a complete HTML artifact into canonical `ui_kit` files plus `parity.contract.json`, `performance.budget.json`, `api-wiring.plan.md`, and `qa.plan.md`.
- **Verify-only workflow**: call `parity_verify` to score an existing kit against source HTML and, when a source image is provided, run the visual judge.
- **Export-only workflow**: call `parity_export_zip` or hosted `parity_export` to package a run as ZIP, HTML, or Markdown for handoff. ZIP exports include the design-system showcase and Figma bridge files.
- **Figma bridge workflow**: call `parity_figma_export` to turn a `ui_kit` into a Figma development-plugin bundle, or `parity_figma_import` to turn Parity bridge / Figma REST JSON into editable `ui_kits/<slug>/` files.
- **Approved design apply workflow**: call `parity_apply_approved_design` to dry-run exact `ui_kit` path to repo path mappings, then write only after user approval. Without explicit mappings it stages under `.parity/approved-design/<slug>/`.
- **Safe agent runtime workflow**: call `parity_agent_runtime_metadata` before child-agent work to get Claude Code/Codex/Cursor/Windsurf profiles, model-specific provider env allowlist, and OS-specific stdio launch commands.
- **Hosted run/chat workflow**: use `parity_chat_send`, `parity_chat_advise`, `parity_chat_history`, and `parity_run_listRecent` to keep working against a hosted run from the agent.
- **Prompt/resource workflow**: load the MCP `use-parity-studio` prompt and `parity://agent-rules` resource so users can ask naturally instead of memorizing tool names.
- **Local dashboard workflow**: watch MCP runs on the auto-opened local dashboard with source/rendered split, file tree, parity score, cost meter, log feed, and ZIP export.
- **Self-dogfood workflow**: capture Parity Studio itself through the MCP path, import it as a run, then use Inspiration, comments, scoped edits, and export against the app's own UI.

## Use it from your coding agent (MCP)

The [`parity-studio-mcp`](./mcp/) v0.5.0 source is a stdio MCP server with 34 tools, `use-parity-studio` / `use-parity-design-mission` prompts, and `parity://agent-rules`. It includes governed NodeSlide snapshot, element, export, and reviewable patch tools alongside `parity_design_workflow_catalog`, the high-level `parity_design_mission` wrapper, safe runtime metadata, approved-design apply, `parity_platform_to_ui_kit`, `parity_pipeline`, `parity_decompose`, `parity_verify`, `parity_export_zip`, `parity_figma_export`, and `parity_figma_import`. Build this version from the repository until the v0.5.0 package is published; the in-app copy-config path remains pinned to the deployed v0.4.0 archive.

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

- Design-first staging: *"Use Parity Studio to iterate the design and UI slugs first for our reports flow. Preserve the existing chat thread shell and report cards. Run the post-decompose method before any redesign. Do not edit production code until I approve the Parity Studio run."*
- Existing app, recommended: *"Use Parity Studio with our app, get me the zip export, upload it to Parity Studio, and use my own env keys."*
- Existing app, explicit: *"use parity_platform_to_ui_kit on http://localhost:3000/settings with projectRoot=. and write ./settings-ui-kit.zip"*
- Apply after approval: *"Dry-run applying the approved Parity design to these production files, show me the mappings, then wait for approval before writing."*
- New sketch/prompt: *"use parity_pipeline to turn this sketch into a ui_kit"*

Local MCP BYOK keeps provider keys in the local agent/MCP env. Keys are never returned, written into kit files, logged, or uploaded to hosted Parity Studio.

**The MCP server also auto-opens a local dashboard** on first invocation (port 6280 by default). Live view of the pipeline running: source/rendered split, file tree as it streams, parity score with bounded enum status, cost meter, ZIP export. Set `PARITY_DASHBOARD=server-only` to disable auto-open in the env block above. See [mcp/README.md](./mcp/) for full tool docs + env flags.

## What it does

```
   running app route       export bundle/
   localhost URL    -->    |-- ui_kits/settings/
   hosted URL              |   |-- index.html
   source screenshot       |   |-- components/
   Figma / ui_kit ZIP      |   |   |-- Sidebar.tsx
   Claude/OpenCoDesign     |   |   |-- FormPanel.tsx
   prompt fallback         |   |   `-- ActionBar.tsx
                           |   |-- tokens.css
                           |   |-- manifest.json
                           |   |-- parity.contract.json
                           |   |-- performance.budget.json
                           |   |-- api-wiring.plan.md
                           |   |-- qa.plan.md
                           |   |-- DESIGN.md
                           |   |-- design-system.rules.json
                           |   |-- design-system.method.md
                           |   |-- skill-routing.json
                           |   |-- skills.parity.md
                           |   |-- design-workflow.catalog.json
                           |   |-- discovery.questions.json
                           |   |-- open-design-takeaways.md
                           |   |-- post-decompose.process.json
                           |   |-- post-decompose.method.md
                           |   |-- direction-cards.json
                           |   |-- p0-checklist.md
                           |   |-- five-d-critique.json
                           |   |-- qa-dogfood.packet.json
                           |   |-- snapshot-snippets.json
                           |   |-- remotion.storyboard.json
                           |   |-- figma.bridge.json
                           |   `-- README.md
                           |-- design-system/     <-- showcase + token payload
                           |-- figma/              <-- plugin import bundle
                           `-- AGENTS.md           <-- coding-agent handoff
```

Primary existing-app pipeline:

```text
browser capture -> decompose -> deterministic verify -> comment/edit repair -> QA proof -> approved apply
```

Generation/import pipeline:

```text
prompt/image/zip/Figma -> generate or import -> decompose -> verify -> iterate -> export
```

The verifier returns a **bounded enum** - `verified | needs_review | needs_iteration | failed | unavailable` - derived from a 16-row deterministic rubric. Each row carries its own honest verdict (`pass | warn | fail | unavailable`) plus 1-2 evidence lines. No floating-point hallucination scores; rows that the deterministic layer genuinely cannot evaluate (color delta, visual regression) are honestly marked `unavailable` rather than collapsed into a fake pass.

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

- Figma bridge export is plugin-importable interoperability, not a claim of perfect vector reconstruction for arbitrary HTML/CSS. The bridge creates editable Figma frames, paint styles, token guides, and component guide cards; `ui_kits/<slug>/` remains the implementation source of truth.
- The 16-row rubric is opinionated. Other rubrics exist; we picked this one because every row is individually auditable and every cell is either real evidence or honestly marked `unavailable`.
- Source HTML matters. Garbage in, garbage out. The deterministic verifier catches text-coverage drops; the visual judge catches semantic misses; nothing catches "the input itself was bad."

## Provenance

Pipeline shape ported from work on `feat/decompose-to-ui-kit` of [HomenShum/open-codesign](https://github.com/HomenShum/open-codesign/tree/feat/decompose-to-ui-kit), opened upstream as [OpenCoworkAI/open-codesign#241](https://github.com/OpenCoworkAI/open-codesign/pull/241). Visual language adopted from [OpenCoworkAI/open-codesign](https://github.com/OpenCoworkAI/open-codesign)'s tokens.css under MIT (oklch palette, Fraunces serif display, terracotta accent). This repo is the standalone reference implementation of the same loop, untethered from any host product's mental model.

## License

MIT
