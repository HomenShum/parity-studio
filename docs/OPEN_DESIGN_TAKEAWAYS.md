# Open Design Takeaways For Parity Studio

## Current Read

Open Design is a broad local-first Claude Design alternative. It emphasizes agent CLI detection, a local daemon, skills, design systems, media generation, sandboxed previews, persistence, imports, and exports.

Parity Studio should stay narrower and more production-adjacent: existing app or handoff artifact to verified `ui_kit` slugs, then scoped comments/edits, QA proof, and approval-gated production apply.

## Clarification: Existing App Decomposition

Based on the current public Open Design README, Open Design can import Claude Design exports and expose its own Open Design project files to coding agents through a read-only MCP server. It also lets local agents work in project folders and generate/edit design artifacts.

What it does not appear to provide as a first-class product workflow is Parity Studio's path:

```text
running existing app route
-> browser capture of rendered HTML/CSS
-> decomposition into canonical ui_kits/<slug>/ components/tokens/contracts
-> deterministic parity verification against source
-> scoped comment/edit repair
-> QA dogfood proof
-> approved production apply mapping
```

So the accurate phrasing is not "Open Design only generates." It is: Open Design is primarily an artifact-generation and design-project workspace, with import/export and read-only MCP access. Parity Studio's differentiator is first-class existing-product decomposition, parity verification, and approval-gated return to production code.

## Product Differences

| Area | Open Design | Parity Studio |
| --- | --- | --- |
| Primary job | Generate broad design artifacts | Decompose existing/product artifacts into verified `ui_kit` slugs |
| Best user | User wants Claude Design-like creation locally | User wants safe redesign staging before production edits |
| Source of truth | Open Design project/artifact | Existing app route, screenshot, Figma bridge, Claude/Open CoDesign export, or `ui_kit` |
| Verification | Self-critique, preview, export | Deterministic parity, Parity Coach, browser QA, QA dogfood packet |
| MCP posture | Read-only access to current Open Design project | Callable capture/decompose/verify/export/chat/apply workflow |
| Production apply | Agent/user handoff | Dry-run mappings, safe write constraints, approval gates |

## What We Are Taking

1. Workflow catalog before generation.
2. Preflight discovery questions before the model writes pixels.
3. Local-first BYOK and MCP privacy posture.
4. Currently-open-project/current-run defaults so users can ask naturally.
5. Design-package files that are both human-readable and agent-readable.
6. Multi-format proof: ZIP, screenshots, QA packet, Figma bridge, GIF/MP4 plan.

## What We Are Not Taking

- A giant general-purpose artifact studio surface.
- Free-form generation as the default for existing products.
- Self-critique as a substitute for parity verification.
- MCP tools that skip approval before production writes.

## Native Parity Changes

`parity_design_mission` now emits:

- `DESIGN.md`
- `design-system.rules.json`
- `design-system.method.md`
- `skill-routing.json`
- `skills.parity.md`
- `design-workflow.catalog.json`
- `discovery.questions.json`
- `open-design-takeaways.md`
- `post-decompose.process.json`
- `post-decompose.method.md`
- `direction-cards.json`
- `p0-checklist.md`
- `five-d-critique.json`
- `design-slug-manifest.json`
- `runtime-architecture.*`
- `qa-dogfood.packet.json`
- `snapshot-snippets.json`
- `gmail-magic-resend.html`
- `remotion.storyboard.json`
- `figma.bridge.json`

The MCP server also exposes `parity_design_workflow_catalog`, so agents can choose the right workflow before running a full design mission.

## What Happens After Decomposition

Open Design's strongest process ideas are the preflight form, deterministic direction picker, seed/template discipline, P0 checklist, and critique pass. Parity adapts those ideas after capture/decomposition:

1. **Discovery lock**: freeze source of truth, target flow, locked slugs, scope, proof, and privacy mode.
2. **Direction card**: choose a deterministic direction package such as tech utility core, card memory, report editorial, or calm command surface.
3. **Exact baseline**: keep the captured app route or imported handoff as the seed; proposed screens must be overlays/minimal deltas unless reimagination is explicitly approved.
4. **P0 checklist**: block export/apply if exactness, flow clarity, data honesty, browser QA, end-user impact, or approval proof is missing.
5. **5D critique**: score desirability, density, direction, data, and delivery.
6. **Approval handoff**: export the approved `ui_kit`, create apply mappings, then write production files only after user approval.

That gives agents a concrete method for the work after decomposition, instead of stopping at a pretty preview.

## Design Systems And Skills

Open Design's design-system and skill idea is valuable, but Parity needs it source-first:

1. **DESIGN.md is extracted from the captured product**, not chosen from a generic style catalog by default.
2. **design-system.rules.json is the machine contract** for source evidence, token rules, component grammar, layout principles, responsive behavior, and agent prompt guidance.
3. **skill-routing.json tells agents which mode they are in**: route capture, locked component repair, inspiration director, QA dogfood relay, Figma bridge, or approved production apply.
4. **References are optional direction aids**. They can shape a direction card, but cannot override source parity, locked components, data honesty, or approval gates.
5. **Skills are operational guardrails**, not hidden prompt flavor. Each route lists what to read, what it may write, what it must never do, and what proof it must return.

## Upstream Contribution Candidates

Good Open Design issues to contribute to:

- Codex CLI compatibility where deprecated flags are still referenced.
- Design package finalization from project source plus chat transcript.
- Queued follow-up messages while a run is in flight.
- Kilo/custom coding-agent adapter coverage.
- BYOK/provider selection clarity in settings.

## Strategic Rule

If the user has an existing product, Parity Studio should capture and decompose first. Generate from scratch only when there is no source route, screenshot, Figma bridge, or importable handoff.
