# NodeBench Locked Memo Layer Plan

Date: 2026-05-04

## Context

During a NodeBench design pass, the user clarified that the current main-branch UI components should remain the visual source of truth. The desired memo/batch feature should not become a separate memo builder or new app shell.

The locked current components were:

```text
Chat thread shell
Reports composer and Activity cards
Latest Public Research claim cards
```

The user wanted to see:

```text
1. Current full UI vs proposed UI.
2. Then a stricter version preserving current design.
3. Then exact locked component slugs.
4. Then a decomposed current-vs-proposed comparison.
5. Then ASCII/runtime architecture covering frontend, backend, database, and agent layers.
```

Parity Studio supports much of the loop already, but the workflow exposed missing first-class product affordances.

## Missing Parity Studio Capabilities

### 1. Locked Component Mode

The app should let a user declare:

```text
These components are locked. Do not visually or structurally drift away.
```

This should be captured as `ui-slugs.json` and surfaced in Parity Coach.

### 2. Decomposed Current vs Proposed View

Parity should generate a side-by-side comparison:

```text
Locked slug
-> decomposed current UI
-> proposed allowed delta
-> implementation hook
```

The proposed side should highlight only the changed affordances.

### 3. Runtime Architecture Handoff

Parity should generate a readable architecture handoff:

```text
frontend changes
backend/API changes
database objects
agent pipeline
permission gates
implementation phases
```

This should be available as `runtime-architecture.md`, `runtime-architecture.html`, and optionally `runtime-architecture.json`.

### 4. Better Agent Handoff Contract

The exported kit should tell Codex/Claude Code not just what the screen should look like, but what must not change.

Example:

```text
Do not replace Reports cards with tables.
Do not replace Chat with a wizard.
Add only style/source/QA chips to existing components.
```

## NodeBench Example Contract

```json
{
  "schemaVersion": 1,
  "surface": "nodebench-locked-memo-layer",
  "lockedSlugs": [
    {
      "slug": "nb.chat.thread-shell",
      "status": "locked",
      "preserve": [
        "thread title header",
        "entity/source/turn metadata",
        "open report/share/grid actions",
        "saved report row",
        "scrollable message body",
        "large bottom composer"
      ],
      "allowedDelta": [
        "style metadata token",
        "batch sample action",
        "source/QA reasoning pill"
      ]
    }
  ]
}
```

Concrete example artifacts live in:

```text
docs/examples/nodebench-locked-memo-ui-slugs.json
docs/examples/nodebench-locked-memo-runtime-architecture.md
docs/examples/nodebench-locked-memo-runtime-architecture.json
```

## Proposed UI Changes To Parity Studio

### Files View

Add recognition for:

```text
ui-slugs.json
runtime-architecture.md
runtime-architecture.html
runtime-architecture.json
```

### Preview View

Add tabs or modes:

```text
Rendered
Current vs Proposed
Runtime Architecture
```

### Comment Mode

Allow comments to target a locked slug, not only a raw file or bbox.

```text
comment.target = {
  type: "lockedSlug",
  slug: "nb.reports.activity-card"
}
```

### Parity Coach

Add a locked-component section:

```text
Locked components preserved: pass/warn/fail
Forbidden shell drift: pass/warn/fail
Allowed deltas only: pass/warn/fail
Runtime handoff completeness: pass/warn/fail
```

### Export

Include the new artifacts in canonical exports when present:

```text
ui_kits/<slug>/ui-slugs.json
ui_kits/<slug>/locked-components.md
ui_kits/<slug>/decomposed-comparison.html
ui_kits/<slug>/runtime-architecture.md
ui_kits/<slug>/runtime-architecture.html
ui_kits/<slug>/runtime-architecture.json
```

## Proposed MCP Additions

Add options to `parity_platform_to_ui_kit`, `parity_decompose`, and/or high-level `parity_studio`:

```json
{
  "lockedComponentMode": true,
  "lockedSlugsPath": "ui-slugs.json",
  "includeCurrentProposedComparison": true,
  "includeRuntimeArchitecture": true,
  "includeImplementationMap": true
}
```

Natural language prompt support:

```text
Use Parity Studio with our app. Preserve the current components, create locked UI slugs, show current vs proposed, and include a runtime architecture handoff.
```

## Suggested Deterministic Checks

```text
lockedSlugManifestPresent
lockedSlugCoveragePresent
currentProposedComparisonPresent
runtimeArchitecturePresent
forbiddenPatternAbsent
allowedDeltaOnly
implementationHookPresent
permissionGateDocumented
```

## Why This Belongs In Parity Studio

This is the difference between:

```text
AI redesigns a page
```

and:

```text
AI safely iterates a real product without breaking its design language or implementation contract.
```

That is exactly Parity Studio's job.

## Initial Implementation Sequence

1. Add documentation and canonical artifact expectations.
2. Teach exporter/importer to preserve `ui-slugs.json` and runtime architecture files.
3. Add Preview link detection for `decomposed-comparison.html` and `runtime-architecture.html`.
4. Add Parity Coach checks for locked-component drift.
5. Add MCP options for locked component mode and runtime architecture generation.
6. Dogfood on the NodeBench memo/batch kit.
