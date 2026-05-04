# Easier-to-read submission

Feature: `parity-mcp-post-decompose-process-v1`

Surface: Parity Studio MCP design mission output

## User-visible outcome

Agents no longer stop at "decomposed ui_kit exists." A generated design mission now includes the process, design-system, and skill-routing files needed to continue safely:

- `DESIGN.md`
- `design-system.rules.json`
- `design-system.method.md`
- `skill-routing.json`
- `skills.parity.md`
- `post-decompose.process.json`
- `post-decompose.method.md`
- `direction-cards.json`
- `p0-checklist.md`
- `five-d-critique.json`

This makes the after-decomposition workflow explicit: source-first design system, selected direction, exact baseline, P0 checks, 5D critique, QA proof, and approval-gated production apply.

## End-to-end visual aid

Use this GIF in the PR body so reviewers and future readers can understand the product loop before reading the MCP internals:

[![Parity Studio current workflows tour](https://github.com/HomenShum/parity-studio/releases/download/v0.3.1/demo-current-workflows-720.gif)](https://github.com/HomenShum/parity-studio/releases/download/v0.3.1/demo-current-workflows.mp4)

MP4: https://github.com/HomenShum/parity-studio/releases/download/v0.3.1/demo-current-workflows.mp4

## What changed

| Lane | Files | Reviewer check |
|---|---|---|
| MCP generated artifacts | `mcp/src/lib/designMission.ts`, `mcp/src/lib/designWorkflowCatalog.ts` | `parity_design_mission` emits post-decompose, design-system, and skill-routing files |
| MCP contract tests | `mcp/src/lib/designMission.test.ts`, `mcp/src/lib/designWorkflowCatalog.test.ts` | Tests assert the new generated files and catalog sections exist |
| Reader docs | `README.md`, `mcp/README.md`, `docs/CANONICAL_KIT.md`, `docs/OPEN_DESIGN_TAKEAWAYS.md` | Docs describe the new workflow without replacing the old opener/core flow |

## Workflow lanes covered

- Existing app route or imported handoff becomes canonical `ui_kit`.
- Agent reads source-first `DESIGN.md` before applying references.
- Agent uses `skill-routing.json` to pick capture, locked repair, inspiration, QA relay, Figma bridge, or approved apply.
- Agent runs post-decompose method: discovery lock, direction card, exact baseline, P0 checklist, 5D critique.
- Production writes stay blocked until proof and user approval exist.

## Snapshot snippets

- `mcp.src.lib.designWorkflowCatalog`: adds design-system/skill contracts and post-decompose process payloads.
- `mcp.src.lib.designMission`: emits the new kit files and updates mission prompt rules.
- `docs.CANONICAL_KIT`: documents the new files as canonical optional mission artifacts.
- `README`: makes the new flow discoverable from the coding-agent workflow section.

## Verification

Run before PR:

```bash
npm run lint
npm run typecheck
npm run build
cd mcp && npm run build
cd mcp && npm run test
cd mcp && node scripts/smoke-test.mjs
```

Current local result: all passed on 2026-05-04.

## PR body block

```md
## Visual walkthrough

[![Parity Studio current workflows tour](https://github.com/HomenShum/parity-studio/releases/download/v0.3.1/demo-current-workflows-720.gif)](https://github.com/HomenShum/parity-studio/releases/download/v0.3.1/demo-current-workflows.mp4)

## What this changes

- Adds source-first design-system output to `parity_design_mission`.
- Adds explicit skill-routing output for capture, repair, inspiration, QA proof, Figma bridge, and approved apply.
- Adds post-decomposition process output: discovery lock, direction cards, exact baseline, P0 checklist, 5D critique, approval handoff.
- Updates docs and canonical kit contract.

## Verification

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `cd mcp && npm run build`
- `cd mcp && npm run test`
- `cd mcp && node scripts/smoke-test.mjs`
```

## Known limits

- This PR changes generated MCP artifacts and docs, not the hosted web UI.
- The GIF is the current product workflow tour used as visual context; no new UI recording was needed for this generator/doc change.
