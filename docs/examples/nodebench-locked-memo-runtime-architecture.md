# NodeBench Locked Memo Runtime Architecture Example

This is the concrete handoff pattern for adding memo style and batch research while preserving the existing NodeBench UI components.

Implementation rule:

```text
No new app shell.
No new memo nav.
Add memo/batch as runtime objects under current Home, Reports, Chat, Inbox, Me, and Workspace surfaces.
```

## 1. Current Runtime Shape

```text
+-----------------------------------------------------------------------------+
| Browser: Vite + React                                                       |
|                                                                             |
|  Home        Reports        Chat        Inbox        Me        Workspace     |
|   |             |            |           |          |            |           |
|   +-------------+------------+-----------+----------+------------+           |
|                         Existing NodeBench UI components                    |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
| Convex client calls                                                         |
|                                                                             |
|  queries                mutations                actions/workflows           |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
| Existing domains                                                            |
|                                                                             |
| product     research     publicResearch     entities     search             |
| reports     agents       operations         monitoring   verification        |
+-----------------------------------------------------------------------------+
```

## 2. Proposed Runtime Layer

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
| Frontend memo state                                                         |
|                                                                             |
| memoStyleContext     rubricContext       sourcePolicyContext                |
| batchIntent          entityUniverseRef   qaSummary                          |
| reviewStatus         exportStatus        monitoringSignals                  |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
| Convex memo/batch layer                                                     |
|                                                                             |
| product/memoStyles        research/batchMemoRuns                            |
| research/memoRubrics      research/memoEvidence                             |
| entities/universes        verification/memoQa                               |
| monitoring/memoSignals    artifacts/memoExports                             |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
| Agent execution layer                                                       |
|                                                                             |
| Intent Router -> Entity Resolver -> Style/Rubric Selector                   |
| Research Planner -> Source Gatherer -> Claim Extractor                      |
| Memo Drafter -> Evidence Mapper -> QA/Style Judge                           |
| Report Saver -> Review Queue -> Export                                      |
+-----------------------------------------------------------------------------+
```

## 3. Chat To Batch Flow

```text
User prompt: "Analyze these 100 AI infra companies..."
        |
        v
Existing Chat composer detects many entities + ranking/research language
        |
        v
Intent Router chooses batch memo workflow
        |
        v
Existing Chat thread renders Batch Proposal Card
        |
        +-- Style: Banking coverage
        +-- Sources: Primary-first
        +-- Action: Run 5 samples
        |
        v
User clicks Run 5 samples
        |
        v
Create memoBatchRun + sample memoBatchItems
        |
        v
Agent pipeline resolves, researches, drafts, cites, and scores
        |
        v
Existing Reports cards show QA/source/style pills
        |
        v
Review filter shows weak outputs; export-ready filter shows approved memos
```

## 4. Data Objects

```text
memoStyleProfiles
  ownerId
  displayName
  source: public | uploaded
  permissionLevel
  toneProfile
  sectionPattern
  evidenceCadence
  recommendationPattern

memoRubrics
  ownerId
  displayName
  sections[]
  requiredFields[]
  citationRequirements[]
  scoringDimensions[]

entityUniverses
  ownerId
  name
  entityType
  defaultStyleProfileId
  defaultRubricId
  monitoringEnabled

entityUniverseMembers
  universeId
  entityId
  inputLabel
  resolutionStatus
  priority
  lastAnalyzedAt

memoBatchRuns
  ownerId
  universeId
  styleProfileId
  rubricId
  sourcePolicyId
  mode: sample | full
  requestedCount
  status
  createdFromThreadId

memoBatchItems
  batchRunId
  entityId
  reportId
  status
  qaStatus
  sourceCoverage
  styleMatch
  reviewReason

memoClaimEvidence
  reportId
  claimId
  sourceRefId
  sourceType
  quoteOrExtractHash
  confidence
  accessedAt

memoQaResults
  reportId
  rubricCompletion
  citationCoverage
  styleMatch
  entityConfidence
  unsupportedClaims[]
  needsReview
```

## 5. Frontend Change Map

```text
src/features/chat
  - add batch proposal card using existing message/action-chip components

src/features/reports
  - add batch/report filters: Batch, Needs Review, Export Ready
  - add QA/source/style metadata to existing report cards
  - keep existing composer and visual card grid

src/features/home
  - keep ask-first shape
  - add batch detection chips only when relevant

src/features/me
  - add style profile permissions and uploaded golden-set controls

src/features/workspace
  - add deep batch QA/source review only in separate workspace surface
```

## 6. Backend Change Map

```text
convex/domains/product
  - memo style profile CRUD and permission settings

convex/domains/research
  - memo rubric templates
  - batch run creation
  - sample/full run state
  - report materialization

convex/domains/entities
  - universe + member resolution and disambiguation

convex/domains/publicResearch
  - claim/source memory reuse for memo evidence

convex/domains/verification
  - rubric completion, citation coverage, style match, unsupported claims

convex/domains/monitoring
  - stale report and new signal detection

convex/domains/artifacts
  - CSV/Markdown/PDF export packages
```

## 7. Permission Diagram

```text
Public style pack
  - allowed by default
  - used for structure/rubric/evidence standards only

Uploaded user memo
  - infer for current report only
  - save private style profile only after explicit approval
  - user can review, edit, and delete the profile

Conversation history
  - no persistent inference by default
  - current chat inference is allowed for current report only
  - team style profile requires separate team-level approval
```

## 8. Implementation Phases

```text
Phase 0: Design-only
  - locked slug manifest
  - current vs proposed comparison
  - runtime diagram

Phase 1: Static metadata MVP
  - add chips and badges using mocked/dev metadata
  - no batch execution yet

Phase 2: Sample batch MVP
  - entity list detection
  - create sample batch run
  - run 5 entities
  - save outputs to Reports

Phase 3: Review/export MVP
  - QA score
  - source coverage
  - review filters
  - CSV/Markdown export

Phase 4: Private style profile
  - upload golden set
  - infer style
  - permissioned save/edit/delete

Phase 5: Monitoring
  - saved universes
  - new signal detection
  - Inbox nudges
```
