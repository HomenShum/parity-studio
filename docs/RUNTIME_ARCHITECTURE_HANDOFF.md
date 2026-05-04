# Runtime Architecture Handoff

Parity Studio currently focuses on visual decomposition and UI kit handoff. For larger product changes, the design handoff also needs to explain frontend, backend, database, and agent/runtime implications in a readable visual form.

This document proposes a canonical runtime handoff artifact that can sit next to `parity.contract.json`, `api-wiring.plan.md`, and `qa.plan.md`.

## Why

A visual UI handoff answers:

```text
What should the screen look like?
```

A runtime handoff answers:

```text
What has to change behind the screen?
```

For agentic products, this matters because a UI delta may imply:

```text
new frontend state
new backend actions
new database objects
new agent pipeline steps
new permissions
new QA gates
new monitoring loops
```

## Recommended Files

```text
runtime-architecture.md
runtime-architecture.html
runtime-architecture.json
```

`runtime-architecture.md` should be human-readable and coding-agent-friendly.

`runtime-architecture.html` should be visually readable in Parity Studio preview.

`runtime-architecture.json` can be optional structured data for tooling.

## Required Sections

```text
1. Current runtime shape
2. Proposed runtime layer
3. User flow sequence
4. Frontend change map
5. Backend change map
6. Database object map
7. Agent/runtime pipeline
8. Permission diagram
9. Implementation phases
10. Verification plan
```

## Example: Current Runtime

```text
+-----------------------------------------------------------------------------+
| Browser: Vite + React                                                       |
|                                                                             |
|  Home        Reports        Chat        Inbox        Me        Workspace     |
|   |             |            |           |          |            |           |
|   +-------------+------------+-----------+----------+------------+           |
|                         Existing app components                             |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
| Backend/API layer                                                           |
|                                                                             |
|  queries                mutations                actions/workflows           |
+-----------------------------------------------------------------------------+
```

## Example: Proposed Layer

```text
+-----------------------------------------------------------------------------+
| Existing locked UI slugs                                                    |
|                                                                             |
| nb.chat.thread-shell             nb.reports.composer                        |
| nb.chat.reasoning-pill           nb.reports.segmented-filter                |
| nb.chat.composer                 nb.reports.activity-card                   |
|                                  nb.public-memory.claim-card                |
+-----------------------------------------------------------------------------+
                                      |
                                      | render small additive state only
                                      v
+-----------------------------------------------------------------------------+
| Frontend feature state                                                      |
|                                                                             |
| styleContext     rubricContext       sourcePolicyContext                    |
| batchIntent      entityUniverseRef   qaSummary                              |
| reviewStatus     exportStatus        monitoringSignals                      |
+-----------------------------------------------------------------------------+
```

## Example: Agent Pipeline

```text
+--------------------+  simple answer | single report | batch workflow
| Intent Router      |
+---------+----------+
          |
          v
+--------------------+  names -> entities | URLs -> entities | ambiguity flags
| Entity Resolver    |
+---------+----------+
          |
          v
+--------------------+  public style | private style | permission gate
| Style/Rubric Select|
+---------+----------+
          |
          v
+--------------------+  required sources | section outline | claims to verify
| Research Planner   |
+---------+----------+
          |
          v
+--------------------+  search/fetch | public memory | source hashes
| Source + Claim Lane|
+---------+----------+
          |
          v
+--------------------+  sections | voice/style pass | recommendation | risks
| Draft Lane         |
+---------+----------+
          |
          v
+--------------------+  citations | rubric completion | style match | unsupported claims
| QA Lane            |
+---------+----------+
          |
          v
+--------------------+  report card | review status | evidence drawer | export row
| Materialize        |
+--------------------+
```

## Example JSON Shape

```json
{
  "schemaVersion": 1,
  "surface": "nodebench-locked-memo-layer",
  "frontend": [
    {
      "area": "src/features/chat",
      "change": "Add batch proposal card using existing message/action-chip components",
      "lockedSlugs": ["nb.chat.thread-shell", "nb.chat.reasoning-pill"]
    }
  ],
  "backend": [
    {
      "area": "convex/domains/research",
      "change": "Add sample/full batch run state and report materialization"
    }
  ],
  "database": [
    {
      "object": "memoBatchRuns",
      "purpose": "Sample or full batch job",
      "keyFields": ["universeId", "styleProfileId", "rubricId", "sourcePolicyId", "mode", "status"]
    }
  ],
  "agents": [
    "Intent Router",
    "Entity Resolver",
    "Style/Rubric Selector",
    "Research Planner",
    "Source + Claim Lane",
    "Draft Lane",
    "QA Lane",
    "Materialize"
  ]
}
```

## Parity Studio Product Requirement

Parity should support runtime handoff as a first-class export concern:

```text
Preview -> Runtime Architecture
Files -> runtime-architecture.md/html/json
Parity Coach -> runtime implications and missing handoff sections
Export ZIP -> include runtime architecture artifacts
MCP -> optional flag to generate runtime architecture handoff
```

Suggested MCP flags:

```text
includeRuntimeArchitecture: true
includeLockedSlugComparison: true
includeImplementationMap: true
```

## Verification Checks

```text
runtimeArchitecturePresent
frontendChangeMapPresent
backendChangeMapPresent
databaseObjectMapPresent
agentPipelinePresent
permissionDiagramPresent
phasePlanPresent
```

These checks should not assert implementation correctness. They assert handoff completeness.
