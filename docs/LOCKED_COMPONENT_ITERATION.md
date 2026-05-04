# Locked Component Iteration

Parity Studio already supports import, decomposition, comments, scoped edits, verification, and export. The missing workflow is a stricter mode for products where the current UI components are non-negotiable and the user wants only small deltas layered into them.

This came from the NodeBench memo/batch design pass, where the user explicitly wanted the current main-branch Chat, Reports, and Latest Public Research components to remain the design source of truth.

## Problem

A normal design iteration request can drift into a new shell:

```text
current screen
→ agent redesign
→ nicer but no longer the product
```

For production UI work, especially inside an existing app, this is wrong. The desired loop is:

```text
current component slug
→ decomposed current UI
→ proposed small delta
→ side-by-side comparison
→ approved slug delta
→ implementation handoff
```

## Locked Component Mode

A run can declare locked slugs. Locked slugs are components that must remain visually and structurally recognizable after iteration.

Example:

```json
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
```

## Required Artifact Shape

A locked-component handoff should include these files inside `ui_kits/<slug>/`:

```text
ui-slugs.json
locked-components.md
decomposed-comparison.html
runtime-architecture.md
runtime-architecture.html
parity.contract.json
api-wiring.plan.md
qa.plan.md
```

## Decomposed Comparison Page

Parity should support a first-class comparison surface:

```text
┌──────────────────────────────┬──────────────────────────────┐
│ Decomposed current UI         │ Proposed locked delta         │
│                              │                              │
│ exact current component       │ same component + highlighted  │
│ structure                     │ allowed additions only        │
└──────────────────────────────┴──────────────────────────────┘
```

The page should show:

```text
Locked slug
Current decomposition
Proposed delta
Implementation hook
```

The right side should highlight only the changed affordances. If the proposed side no longer looks like the current side, the design fails.

## NodeBench Example Slugs

```text
nb.chat.thread-shell
nb.chat.saved-report-row
nb.chat.reasoning-pill
nb.chat.action-chip
nb.chat.composer
nb.reports.composer
nb.reports.segmented-filter
nb.reports.grid-list-toggle
nb.reports.activity-card
nb.public-memory.claim-card
nb.public-memory.confidence-pill
```

## Allowed vs Forbidden

Allowed deltas:

```text
style chips
source policy chips
batch sample actions
QA badges
source/citation counters
review/export/watch states
memo seed/rubric fit labels
```

Forbidden deltas:

```text
new product shell
new top-level memo nav
replacing Chat with a setup wizard
replacing Reports with a table-only queue
large style gallery above current composer
generic SaaS redesign language
```

## Product Requirement

Parity Studio should expose this as a mode or contract option:

```text
Preserve locked components. Show current-vs-proposed by slug.
```

This can live in the app as:

```text
Run settings → Component lock mode
Files → ui-slugs.json
Preview → Current vs proposed
Parity Coach → Locked component drift checks
Export → locked-component handoff files
```

## Verification Additions

The deterministic verifier should add locked-component checks:

```text
lockedSlugPresent
lockedSlugStructurePreserved
allowedDeltaOnly
forbiddenPatternAbsent
currentProposedComparisonPresent
runtimeArchitecturePresent
implementationHookPresent
```

Verdicts should remain bounded:

```text
pass | warn | fail | unavailable
```

## Why This Matters

This mode lets Parity Studio become safer for real app iteration. It supports the common founder/builder workflow:

```text
I like the current app.
Do not redesign it.
Show me exactly how a new feature layers into the current components.
Then hand that to Codex or Claude Code.
```
