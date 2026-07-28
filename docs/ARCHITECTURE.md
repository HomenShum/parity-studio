# Parity Studio — Architecture

## North star
Image (or sketch / prompt) → componentized `ui_kits/<slug>/` bundle, self-judged with a 12-check boolean rubric, exported as a coding-agent-ready ZIP. Honest score drift on every iteration. No hallucinated floating-point confidence.

## Stack decisions

| Concern | Choice | Why |
|---|---|---|
| **LLM client** | `@mariozechner/pi-ai` 0.73.1 | Unified provider abstraction, vision support, and streaming. Patched transitive versions are locked; migration to its maintained successor remains a deliberate follow-up rather than an untested launch-day API change. |
| **Backend** | Convex Cloud | Real-time queries, durable actions, schema-first, free tier covers MVP |
| **Multi-step orchestration** | `@convex-dev/workflow` | Durable, retryable, deterministic step chains for `generate -> decompose -> verify -> iterate -> done` |
| **Token streaming to browser** | `@convex-dev/persistent-text-streaming` | Independent of any LLM SDK — `appendChunk(token)` writes to DB and HTTP stream simultaneously; pi-ai output flows through unchanged |
| **NOT used: `@convex-dev/agent`** | — | Locks to Vercel AI SDK (`LanguageModelV2` interface). Would require a pi-ai → AI SDK adapter that adds a layer with no benefit at this scale. Revisit if multi-agent orchestration emerges |
| **Frontend** | Vite + React 19 + TypeScript + Tailwind 4 | Matches NodeBench's existing skill set, fastest dev loop, tightest bundle |
| **Auth** | Anonymous capability ownership for private preview | 256-bit editor capabilities and separate unguessable read-only share capabilities prevent raw-ID access. Real account auth, tenant policy, and share revocation are required before public multi-tenant launch. |
| **Storage** | Convex Storage | Image uploads + zip exports; same auth surface |
| **Hosting** | Vercel (web) + Convex Cloud (backend) | Both have generous free tiers; deploys on git push |

## Why we skip the Convex Agent component (decision record)

`@convex-dev/agent` is a great component — thread persistence, conversation history, tool call wiring, vector memory all out of box. But its `languageModel` field accepts an `LanguageModelV2` from Vercel AI SDK (`@ai-sdk/openai`, `@ai-sdk/anthropic`, etc.). pi-ai uses its own client wrappers around `@anthropic-ai/sdk`, `openai`, `@google/genai`, `@aws-sdk/client-bedrock-runtime`, `@mistralai/mistralai`.

To use Convex Agent with pi-ai, we would need either:
1. A pi-ai → `LanguageModelV2` adapter (medium-complexity, 200-400 LOC)
2. Replace pi-ai with AI SDK (loses provider support pi-ai already abstracts, breaks reuse of PR #241 patterns)

Neither is justified at v1 scale. We have ~5 LLM call sites total. Convex actions wrap each pi-ai call directly, and we manage thread/message state with 4 simple tables. If multi-agent orchestration becomes a real need (delegation, sub-agent spawning, shared memory across agent instances), revisit.

## Pipeline shape

```
User input (image | prompt)
        |
        v
[Convex action: generate.startRun]
        |
   creates `runs` row -> kicks off `generationWorkflow`
        |
        v
+-----------------------------------+
| Workflow (durable, retryable)     |
|                                   |
|  step 1: generate initial HTML    |
|     -> writes artifacts row       |
|     -> streams via streamId       |
|                                   |
|  step 2: decompose to ui_kit      |
|     -> writes ui_kits row         |
|                                   |
|  step 3: verify deterministic     |
|     -> writes parity_reports row  |
|                                   |
|  step 4: verify visual (vision)   |
|     -> updates parity_reports     |
|                                   |
|  step 5: iterate if score < bar   |
|     -> back to step 2             |
|     -> max 2 iterations           |
|                                   |
|  step 6: done                     |
|     -> updates run status         |
+-----------------------------------+
        |
        v
Browser sees real-time updates via Convex queries
```

## NodeSlide domain architecture

NodeSlide was an additive domain here, and it is now a separate product at `nodeslide.vercel.app`. Since Phase 4 of `docs/DECOUPLING_PLAN.md`, `src/App.tsx` selects **parity** by default; `?domain=nodeslide` still resolves to the NodeSlide studio inside this bundle, but production 301s those requests (and old `?share=<id>` links) to the product deployment via `vercel.json`. `VITE_ENABLE_PARITY_DOMAIN` is now a kill switch — set it to `false` to route back to NodeSlide — rather than a gate that has to be set for parity to appear. The NodeSlide sources below stay in the tree until the Phase 2 port audit is green; Phase 3 removes them.

The canonical runtime record is a `DeckSnapshot`:

```text
Deck
  -> ordered Slide records
      -> ordered SlideElement records with stable IDs and normalized bboxes
  -> Source records referenced by elements and charts
```

`NodeSlideWorkspace` adds comments, patches, versions, traces, validations, exports, and ephemeral presence. Convex owns persistence and authoritative clocks; the React client never receives provider keys.

Every write follows one path:

```text
intent + explicit scope + base clocks
  -> validate operation mode, IDs, locks, sources, and normalized geometry
  -> compare touched slide/element clocks
      -> unchanged clocks: commit atomically
      -> deck changed elsewhere: safely rebase and commit
      -> touched clock changed: persist stale proposal without mutation
  -> write accepted patch + snapshot + version + validation + trace receipt
```

Restore is a new monotonic write rather than a destructive rewind. Agent edits use the same patch contract as human drag/resize edits. The default free route is `openrouter/free` through the existing server-side pi-ai adapter; invalid or unavailable model output falls back to deterministic operations that remain constrained by the requested scope and operation mode.

Preview access follows a capability model:

```text
creating browser -> durable local owner capability -> all editor reads and writes
read-only share action -> independent random share capability -> presenter snapshot only
raw deck ID without owner capability -> safe recovery screen, never editor data
```

Capabilities are a private-preview boundary, not identity. Public launch still requires account authentication, tenant membership, capability rotation/revocation, audit administration, and a deliberate migration path for existing anonymous decks.

Rendering has two explicit boundaries:

- The repository adapter under `src/domains/nodeslide/slidelang/` provides deterministic local validation, semantic HTML/SVG, hosted SlideLang calls, and editable PPTX text/shapes/connectors/native charts.
- The official SlideLang project under `slidelang-projects/nodeslide-golden/` is checked and published with the upstream project CLI. Hosted check success requires all three independent flags: `ok`, `publish_ok`, and `clean_ok`.

Static fallbacks are capability-labelled. Complex CSS, unsupported media, and advanced animation are never represented as editable-PPTX parity.

## Schema (4 tables + 2 component tables)

```ts
// convex/schema.ts (sketch)
runs: defineTable({
  prompt: v.optional(v.string()),
  sourceImageStorageId: v.optional(v.id('_storage')),
  status: v.union(
    v.literal('queued'),
    v.literal('generating'),
    v.literal('decomposing'),
    v.literal('verifying'),
    v.literal('iterating'),
    v.literal('done'),
    v.literal('failed'),
  ),
  costUsdMillicents: v.number(),  // integer micro-cents to avoid float drift
  workflowId: v.optional(v.string()),
  streamId: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
}).index('by_status', ['status']),

artifacts: defineTable({
  runId: v.id('runs'),
  version: v.number(),  // 0=initial, 1=iter-1, ...
  html: v.string(),
}).index('by_run_version', ['runId', 'version']),

ui_kits: defineTable({
  runId: v.id('runs'),
  artifactVersion: v.number(),  // which artifacts.version this ui_kit decomposed
  slug: v.string(),
  schemaVersion: v.number(),  // bump on output-shape changes
  files: v.any(),  // {[path]: content} tree
  decomposeCostUsdMillicents: v.number(),
}).index('by_run', ['runId']),

parity_reports: defineTable({
  runId: v.id('runs'),
  uiKitId: v.id('ui_kits'),
  iterationNumber: v.number(),
  passCount: v.number(),
  totalChecks: v.number(),
  status: v.union(
    v.literal('verified'),
    v.literal('needs_review'),
    v.literal('needs_iteration'),
    v.literal('failed'),
    v.literal('unavailable'),
  ),
  gaps: v.any(),  // ParityGap[]
  judgeCostUsdMillicents: v.number(),
}).index('by_run_iter', ['runId', 'iterationNumber']),
```

Plus: `_storage` for source images + ZIP exports, `workflow` + `persistentTextStreaming` component tables (auto-created).

## Key functions

```
convex/runs.ts
  startRun(prompt?, sourceImageStorageId?) -> Id<'runs'>
  getRun(runId) -> Run | null
  listRecent(limit) -> Run[]
  updateStatus(runId, status, errorMessage?)

convex/artifacts.ts
  appendArtifact(runId, version, html)
  getLatest(runId) -> Artifact | null

convex/uiKits.ts
  saveUiKit(runId, artifactVersion, slug, files, costUsd)
  getLatest(runId) -> UiKit | null
  exportZip(uiKitId) -> Blob

convex/parityReports.ts
  saveReport(runId, uiKitId, iter, passCount, totalChecks, gaps, costUsd)
  getLatest(runId) -> ParityReport | null

convex/generation.ts (Workflow)
  generationWorkflow.define(...)
    step 1: generateInitial (action wrapping pi-ai with stream)
    step 2: decompose (action porting decompose-to-ui-kit.ts)
    step 3: verifyDeterministic (action porting verify-ui-kit-parity.ts)
    step 4: verifyVisual (action porting verify-ui-kit-visual-parity.ts)
    step 5: iterate or done
```

## Self-dogfood plan

Once the loop works end-to-end:
1. Hand-design the v0 landing page (rough HTML, intentionally ugly)
2. Run the platform on a screenshot of the hand-designed v0
3. Take the highest-scoring decomposed `ui_kit` from step 2
4. Deploy that as the v1 landing page
5. Show both side-by-side on a dedicated `/dogfood` route with the parity report visible
6. Footer line on the live landing: `this page was made by parity-studio. v=N. parityScore=0.NN. last iter: YYYY-MM-DD`

This is the strongest possible "the platform works" demo — recursive proof.

## Out of scope for v1

- Mobile (responsive web only)
- Real-time collaboration (cursors, presence, comments)
- Teams / orgs / sharing
- Multi-design library / saved-runs browser (use Convex dashboard for now)
- Auth UI (anonymous sessions only; sign-in deferred)
- Cross-design lessons (per-design only)
- Spiral detector (separate Discussion #244)
- Capability-aware failover (separate Discussion #243)
- Snapshot/rollback (separate Discussion #242)

## Cost envelope per run (target)

| Stage | Model | Approx tokens | Cost |
|---|---|---|---|
| 1 generate | claude-sonnet-4-5 or gpt-5 | ~15k out | $0.05-0.20 |
| 2 decompose | same | ~10k out | $0.04-0.15 |
| 3 verify deterministic | none (pure code) | 0 | $0 |
| 4 verify visual | gemini-3-pro or claude-opus-4 | ~5k in (image) + ~2k out | $0.02-0.08 |
| 5 iterate (if needed, max 2) | same as 2-4 | ~12k tokens | $0.06-0.20 |
| Total per run | — | — | **$0.10-0.60** |

Surfaced inline as a toast and persisted on `runs.costUsdMillicents` — never silently aggregated.
