# Port-or-delete triage — NodeSlide code stranded in parity-studio

| | |
|---|---|
| Status | ANALYSIS ONLY. No code moved, ported, or deleted. Neither repository modified. |
| Task | Phase 1's "real first task" per `docs/DECOUPLING_PLAN.md` §5 |
| Author | Claude (session 47c22c0d), 2026-07-27 |
| Input | `scripts/port-audit.mjs` → `artifacts/port-audit/port-audit.json` (re-run for this document) |
| Source HEAD | parity `d67baec` |
| Destination | nodeslide `db7857f` (worktree `feat/public-share-projection`, dirty); `origin/main` used for all rename checks |

## 0. What the audit actually says, re-measured

Re-running `node scripts/port-audit.mjs` after nodeslide PR #73 merged:

```
total 780 · ported 371 · renamed 0 · missing 409 · symbols 746 · scripts 34
verdict FAIL
```

The 409 decomposes as **376 exported symbols across 51 files + 33 gate scripts**. The plan's §5
table rounds this and its script line ("37 `nodeslide-*` scripts") is wrong: there are 34, of which
33 are missing and one (`nodeslide-variation-proof.mjs`) is already in the destination.

### Method

1. Built an import graph over parity `src/`, `convex/`, `scripts/`, `tools/` (472 files), resolving
   relative, `@/`, and `~/` specifiers.
2. Ran two BFS reachability passes: from the **app entry** (`src/main.tsx`, `src/App.tsx`) and from
   **every Convex module** (`convex/**`, excluding `_generated` and tests).
3. Grepped nodeslide `origin/main` for each missing symbol name and for plausible renames, then
   diffed file line counts where a same-named file exists in both repos.
4. Cross-checked both `nodekit.yaml` files and parity `package.json` / `.github/workflows`.

**A false-dead verdict was caught and corrected during this work.** The first graph used a regex
whose optional `(?:[\s\S]*?from\s*)?` group is greedy, so a side-effect import
(`import './nodeslide.css';`) swallowed the following `lazy(() => import('./inspector/NodeSlideInspectorPanel'))`.
That single miss made the *entire* inspector subtree — InspectorPanel, TraceInspector,
TraceWaterfall, traceTelemetry, DataInspector, ExportMyDataAction, PdfEvidencePage,
overlayPrimitives, ~40 symbols — report as dead code with zero reachable importers. It is all live.
Any triage that does not resolve dynamic `import()` will delete the Trace tab and the
export-my-data button. **The dynamic-import edge at `NodeSlideStudio.tsx:152` is the single most
dangerous line in this triage.**

---

## 1. `session/**` — the agent-session layer

**Verdict: PORT** · **79 symbols** (`session/index.ts` 35, `session/types.ts` 21,
`session/agentSessionState.ts` 18, `session/AgentSessionProvider.tsx` 5)

Evidence — reachable from a rendered component:

```
src/App.tsx:16                          -> src/domains/nodeslide/NodeSlideStudio.tsx
src/domains/nodeslide/NodeSlideStudio.tsx:140  -> src/domains/nodeslide/session/index.ts
src/domains/nodeslide/session/index.ts:23      -> src/domains/nodeslide/session/agentSessionState.ts
```

and rendered, not merely imported:

- `NodeSlideStudio.tsx:660` — `<AgentSessionProvider clientSessionId={clientSessionId}>` wraps the
  workspace; `NodeSlideStudio.tsx:683` consumes `useAgentSession()`.
- `components/NodeSlideLanding.tsx:91` — `useAgentSession()`.
- `composer/nodeSlideComposerSession.ts:2` and `composer/NodeSlidePromptComposer.tsx:64` —
  `useOptionalAgentSession()`.

No equivalent in nodeslide under any name: `git grep -l "approvalMode\|AgentSession\|editAuthority\|useAgentSession" origin/main -- src convex`
returns **zero files**. `session/` was last touched 2026-07-17 (`71d2e2f`), 4 commits total — recent,
not abandoned.

**Size:** 4 source files, ~40 KB source + ~21 KB of tests (`AgentSessionProvider.test.tsx`,
`agentSessionState.test.ts`).
**Depends on:** React only. **No Convex references** (`grep "api\." session/*` = 0 hits) — this is
pure client state, which makes it the cheapest large cluster to port.
**Blocked by:** nodeslide's `NodeSlideStudio.tsx` (4,285 lines) has no provider mount point. The
port is a merge into that file, not a file copy.

---

## 2. Google Slides integration + the sync-contract layer

This is **one** cluster, not two. `integrations/syncContracts.ts` and
`integrations/externalChangeSet.ts` are described in the plan as a generic "sync-contract layer",
but every importer is a Google Slides module or the Google Slides Convex runtime. There is no second
provider.

### 2a. The implementation — **Verdict: DECIDE** · **100 symbols**

`googleSlides/types.ts` 27, `googleSlides.ts` 16, `adapter.ts` 6, `normalization.ts` 4,
`planning.ts` 3, `externalChangeSet.ts` 22, `syncContracts.ts` 22.

It is unambiguously **live in parity**, on both sides of the wire:

```
convex/nodeslideGoogleSlidesRuntime.ts:3      -> integrations/googleSlides/adapter.ts
convex/lib/nodeslideGoogleSlidesRuntime.ts:8  -> integrations/googleSlides/googleSlides.ts
convex/lib/nodeslideGoogleSlidesRuntime.ts:9  -> integrations/googleSlides/planning.ts
convex/lib/nodeslideGoogleSlidesRuntime.ts:15 -> integrations/googleSlides/types.ts
convex/lib/nodeslideGoogleSlidesRuntime.ts:23 -> integrations/syncContracts.ts
integrations/googleSlides/googleSlides.ts:10  -> integrations/externalChangeSet.ts
```

`convex/nodeslideGoogleSlidesRuntime.ts` exports 21 registered Convex functions
(`getState`, `attachPresentation`, `createPresentation`, `planPull`, `finalizePull`, `planPush`,
`executePush`, `cancelPending`, `resetAttachment`, plus internals). The UI is rendered:
`components/NodeSlideConnectionsDialog.tsx:115–128` binds `useAction`/`useQuery` to eight of them,
and that dialog is rendered at `components/NodeSlideLanding.tsx:519` and
`components/shell/EditorProjectDialogs.tsx:97`.

So why DECIDE and not PORT: **this capability has never existed in the shipped product.**
`nodeslide/nodekit.yaml` declares `canonicalFor: [nodeslide.deck, nodeslide.deck-patch]` and
`consumes:` — no Google Slides concept, no external-provider concept. The only `googleSlides`
identifier in nodeslide `origin/main` is an export-fidelity enum field in
`slidelang/capabilities.ts:24`, which is about whether a chart survives a `.gslides` export — a
different thing entirely. Two-way Google Slides sync is a product surface with an OAuth
dependency (`convex/nodeslideGoogleAuth.ts`), a token store, and a three-way merge planner.

**Question the owner must answer:** *Does NodeSlide ship two-way Google Slides sync?* If yes, this
is the largest single port in Phase 1 (8 src files + 2 top-level Convex modules + `convex/lib/`
runtime + `nodeslideGoogleAuth`, plus a `nodekit.yaml` contract declaration and OAuth secrets in a
second Vercel project). If no, it is ~100 symbols and ~4 Convex modules of deletion, and
`NodeSlideConnectionsDialog.tsx` shrinks by roughly 700 lines.

### 2b. The barrels — **Verdict: DELETE** · **22 symbols**

`integrations/googleSlides/index.ts` (21) + `integrations/googleSlides/capabilities.ts` (1).

- `integrations/index.ts` (`export * from './syncContracts'; export * from './googleSlides';`) has
  **zero importers anywhere in the repo** — `grep -rn "from '.*integrations'" src/ convex/` is empty.
- `googleSlides/index.ts`'s only importer is that dead barrel. Every symbol it re-exports is
  imported directly from its defining module by the real consumers, so deleting the barrel loses
  nothing.
- `capabilities.ts` exports exactly one symbol, `GOOGLE_SLIDES_SYNC_CAPABILITIES`, whose only
  non-test importer is the dead barrel. **A declared capability table that nothing reads** — worth
  noting on its own terms, because it is the shape of claim that this repo's own claim-gate exists
  to refuse.

This DELETE holds regardless of how 2a is decided; if 2a is PORT, the barrels are still dead weight.

---

## 3. `slidelang/jsonSpec.ts` + `jsonEdit.ts`

**Verdict: PORT — confirmed and DONE (nodeslide #82), with two divergences left open.** · **30 symbols**

The verdict held, but the reason was wrong in an instructive way. The destination was not missing a
JSON tab; it ships the whole thing — testid, "Deck as code" eyebrow, the `nodeslide.slidelang/v1`
view, four view modes, its own element diff. What it lacked was a **versioned envelope, schema
validation of a snapshot, and snapshot-to-snapshot diff**. The destination covers *displaying* deck
as code; these modules cover *validating and re-ingesting* it. Same noun, different verb.

Two divergences were deliberately NOT resolved by the port, and both are product calls:

- **`exportNodeSlideJson` vs `downloadDeckJson`.** These overlap and look like a rename. They are
  not one, and the audit's `RENAMES` table must stay empty of them: the destination's symbol is the
  **weaker** of the two — no envelope, no validation — while carrying an
  `assertNodeSlideArtifactCompilation` gate parity's version lacks. Neither supersedes the other.
  Recording it as a rename would mark the item PORTED and silence a real capability gap. Swapping
  the shipped export to the envelope would also be a wire-format break for anyone holding an
  exported file, in exchange for a re-import path this repo does not yet have.
- **`diffSelectedElementJson` vs `synthesizeElementOps`.** Two independent solutions to the same
  problem with different rules. Both now exist in the destination. Picking one is a product call;
  `diffSelectedElementJson` has no non-test consumer in either repo.

Two incidental findings from the port: `zod` was being imported by `src/` while resolved only
transitively, so it is now declared; and parity's `slidelang/index.ts` star-exports `jsonSpec`,
which pulls zod into the eager chunk and defeats the `await import('./slidelang/jsonSpec')`
code-split its own consumer is written for. That barrel export was deliberately not carried over —
it is a latent bug here, not a feature to replicate.

Evidence:

```
src/App.tsx:16 -> NodeSlideStudio.tsx
NodeSlideStudio.tsx:3356 -> slidelang/download.ts -> slidelang/jsonSpec.ts:3
NodeSlideStudio.tsx:2674 (dynamic) await import('./slidelang/jsonSpec')  // JSON deck import path
NodeSlideStudio.tsx:128 -> inspector/JsonInspector.tsx:15 -> slidelang/jsonEdit.ts
```

**Rename check — there is a partial superseding symbol, and it is the weaker one.** nodeslide has
`slidelang/download.ts:50 downloadDeckJson`, which is `JSON.stringify(snapshot, null, 2)`. Parity's
`jsonSpec.ts` is a versioned envelope (`NODESLIDE_JSON_FORMAT`, `NODESLIDE_JSON_VERSION`,
`NodeSlideJsonEnvelopeV1`) with `parseNodeSlideJson`, `exportNodeSlideJson`,
`diffNodeSlideSnapshots`, and a fidelity report. Porting means **replacing** nodeslide's naive
`downloadDeckJson` output shape, which is a wire-format change for anyone holding an exported file.

**Size:** 2 files, jsonSpec is the larger; both have tests.
**Depends on:** `slidelang/types.ts`, `slidelang/validation.ts`, `slidelang/importBounds.ts` — all
present in nodeslide.
Last touched 2026-07-16 / 2026-07-14.

---

## 4. Trace + PDF-evidence cluster

**Verdict: PORT — DONE (nodeslide #83). The "design conflict" was not one.** · **37 symbols**

The size gap was read as evidence that the destination might hold a deliberate redesign, and the
Agent Prism rail plus the Countersigned seal seemed to confirm it. Both readings were wrong, and
only commit ancestry settled it — file size and feature-spotting both pointed the wrong way:

- nodeslide's `TraceWaterfall.tsx` has **exactly one commit ever**, `ac66f88`, the 2026-07-13
  extraction. Its blob is **byte-identical** to parity's file on that date (`8f3ba7cde558…`).
- Parity then continued the same file: 743 → 1,363 → 1,592 → 1,674 → 2,115 → 2,138 across five
  commits between 07-14 and 07-16.
- The Agent Prism rail and Countersigned seal live in `TraceInspector.tsx`, a different file, and
  **predate the fork** — the shared 07-13 ancestor already contains them. Both repos have them.
  Nothing was redesigned at the destination.

So the destination was a frozen snapshot, not a rewrite, and the direction is parity → nodeslide.

**The one thing a naive copy would have destroyed:** nodeslide's only post-fork change to
`TraceInspector.tsx` is `d53f1dc`, a 7-line fix to `isFallbackTrace` / `hasProviderAttemptTelemetry`
covering free-model and patch-receipt semantics, which parity does **not** have. Preserved.

Two further traps the port caught: a destination-only delegated planner/executor test added in
`39a9ebf` that parity's rewritten fixture-matrix suite has no equivalent of (carried forward rather
than overwritten), and a stale assertion in `TraceInspector.test.tsx` matching a string that no
longer exists in parity — raised to the shipped contract and strengthened to assert a derived count.

**Left deliberately unwired:** the optional `trace` prop is not passed at the call site, because
nodeslide's Convex layer never emits `claimSourceBindings`. Passing it would render "no
claim-output binding" on every citation — true, and indistinguishable from a feature that was never
wired. Flagged rather than faked.

**Original verdict, retained for the record:**

**Verdict: PORT (as a merge, not a copy)** · **37 symbols**
(`traceTelemetry.ts` 12, `TraceWaterfall.tsx` 11, `TraceWaterfall.fixture.ts` 8,
`TraceInspector.tsx` 2, `PdfEvidencePage.tsx` 2, `pdfEvidenceRuntime.ts` 2)

Evidence — reachable only through the dynamic import:

```
src/App.tsx:16 -> NodeSlideStudio.tsx
NodeSlideStudio.tsx:152  lazy(() => import('./inspector/NodeSlideInspectorPanel'))
NodeSlideInspectorPanel.tsx:2 -> inspector/InspectorPanel.tsx
InspectorPanel.tsx:74 -> inspector/TraceInspector.tsx
TraceInspector.tsx:58 -> inspector/TraceWaterfall.tsx -> :53 PdfEvidencePage.tsx -> :4 pdfEvidenceRuntime.ts
TraceInspector.tsx:60 -> inspector/traceTelemetry.ts
```

**Both repos have these files. They have diverged, in both directions.**

| File | nodeslide `origin/main` | parity |
|---|---|---|
| `inspector/TraceWaterfall.tsx` | 743 lines, exports `TraceWaterfallRow`, `buildWaterfallRows`, `TraceWaterfall` | 2,138 lines, exports minimap buckets, grouping, keyboard nav, evidence boxes |
| `inspector/TraceInspector.tsx` | 1,580 lines | 1,704 lines |
| `inspector/traceTelemetry.ts` | **absent** | 12 symbols incl. `toO11ySpans`, `traceProofSummary`, `spanTimingState` |
| `inspector/PdfEvidencePage.tsx` / `pdfEvidenceRuntime.ts` | **absent** | present |

So the audit's per-symbol MISSING is honest but the file-level picture is a merge: parity's
`buildGroupedWaterfallRows` supersedes nodeslide's `buildWaterfallRows` (near-rename, different
signature), and `traceTelemetry.ts` is a genuinely new extraction. nodeslide's `nodekit.yaml`
declares `consumes: nodetrace.trace-ui-store` and `nodeagent.trace-workpaper` — **the product
declares a trace surface, so this cannot be deleted quietly.**

`TraceWaterfall.fixture.ts` (8 symbols) is test-only — its sole importer is `TraceWaterfall.test.tsx`
— and ports with the test rather than standing on its own.

**Size:** ~2,100 lines of divergence in TraceWaterfall alone, plus a PDF runtime that lazy-loads a
worker. This is the highest-risk merge in the list.
**Depends on:** `inspector/types.ts` (present in nodeslide), `convex/lib/nodeslideExecutionTrace.ts`
(present in nodeslide), `TraceWaterfall.css` (parity only).

---

## 5. Inspector shell / tab model

**Verdict: DECIDE** · **10 symbols**
(`InspectorPanel.tsx` 6, `NodeSlideInspectorPanel.tsx` 2, `components/overlayPrimitives.tsx` 2)

Both repos solved the same problem — "seven inspector tabs do not fit" — **independently and
incompatibly, within the last two weeks.**

- parity `inspector/InspectorPanel.tsx:184–210` exports `INSPECTOR_TABS`, then derives
  `PRIMARY_INSPECTOR_TABS` and `MORE_INSPECTOR_TABS` — a primary row plus an overflow menu, with
  `rememberInspectorTab`, `primaryInspectorTabAfterKey`, `inspectorTabAfterKey` for keyboard
  traversal, and `overlayPrimitives.tsx` (`getRovingFocusIndex`, `useViewportMatch`) underneath.
  Evidence artifact `docs/design/evidence/tabs-grouped.png` is untracked in the working tree.
- nodeslide `origin/main` PR **#70** ("group the seven tabs into authoring and review", 2026-07-25)
  put a `group: 'author' | 'review'` discriminator directly on each tab definition. It exports
  none of parity's six symbols.

Neither is a rename of the other. Porting parity's symbols on top of nodeslide's model produces two
grouping mechanisms in one component.

**Question the owner must answer:** *Which inspector tab model is the product — the
author/review split (#70, already shipped) or the primary/overflow split (parity, not shipped)?*
Only after that is `NodeSlideInspectorPanel.tsx` (the lazy wrapper) and `overlayPrimitives.tsx`
(roving focus + viewport match, generic and reusable either way) decidable.

This one directly contradicts the plan's §3 non-goal "**mechanical relocation only**".

---

## 6. `openui/visualMaterials*`

**Verdict: ~~PORT~~ → DECIDE, corrected 2026-07-27 by attempting the port.** · **13 symbols**

The PORT verdict below was reached from reachability alone, and reachability was confirmed — the
chain crosses two dynamic `import()` edges and the Workbench is genuinely openable from a live menu
item at `AiInspector.tsx:2146`. It is not dead. It is also not portable as-is, for three reasons the
first pass did not weigh:

1. **A name collision the audit cannot see.** The destination already has a `VisualMaterial` family —
   `NodeSlideVisualMaterial`, `NodeSlideVisualMaterialKind` (11 kinds), `NodeSlideVisualMaterialStatus`,
   `NodeSlideVisualMaterialInventory` in `convex/lib/nodeslideStoryContext.ts`, consumed by
   `nodeslideDesignPlan.ts`. It models *evidence available to build a deck from*; parity's
   `VisualMaterialSpec` models *a renderable slide spec*. Different concerns, overlapping names and
   provenance vocabulary. The audit scored these MISSING because it matches exact names within scoped
   paths, so the collision is invisible to it — the same blind-spot class as the
   `NodeSlideConnectionsDialog` false-PORTED.
2. **"Self-contained" was wrong.** The real cost is `@openuidev/react-lang@0.2.8` (a 0.x third-party
   DSL renderer, pulls `@openuidev/lang-core`, peer-deps the MCP SDK) plus `@radix-ui/react-collapsible`
   — neither installed in the destination — plus 36 `ns-openui-*` CSS rules and merges into both
   `AiInspector.tsx` (2,333 lines vs 3,115) and `InspectorPanel.tsx`. Adding a 0.x dependency to the
   shipped runtime bundle is a supply-chain decision, and it contradicts §3's "mechanical relocation only".
3. **The content is a self-described unverified demo.** `VisualMaterialWorkbench` renders exactly one
   hardcoded spec, `AI2027_TRANSFORMATION_LADDER`, labelled "OpenUI Phase 0 fixture" with
   `verification: 'unverified_scenario'`. There is no authoring path for a second spec, the validator's
   chart branch is unreachable from the shipped path, and its four testids have zero consumers in
   either repo. Neither `nodekit.yaml` declares an openui concept.

A core-only port (`validateVisualMaterialSpec`, `compileVisualMaterialProposal`) is possible with zero
new dependencies, since `visualMaterials.ts` imports only `shared/nodeslide`. But that splits the
cluster across two repos without letting parity delete anything, which does not advance the plan.

**Owner decision required:** does NodeSlide ship the OpenUI lab at all, and which `VisualMaterial`
naming wins? Until answered, this cluster blocks Phase 3 for its files and should not be ported.

Evidence:

```
src/App.tsx:16 -> NodeSlideStudio.tsx
NodeSlideStudio.tsx:126 -> inspector/AiInspector.tsx
AiInspector.tsx:132 -> openui/VisualMaterialWorkbench.tsx
VisualMaterialWorkbench.tsx:13 -> openui/visualMaterials.ts
```

`AiInspector.tsx` is a top-level rendered inspector tab in both repos, so the mount point exists.
No `openui`/`VisualMaterial` symbol exists anywhere in nodeslide `origin/main`.

**Size:** 2 files + 2 test files. Self-contained: exports a spec type
(`VisualMaterialSpec`), a validator (`validateVisualMaterialSpec`), a compiler
(`compileVisualMaterialProposal`), and two constant programs (`AI2027_OPENUI_PROGRAM`,
`AI2027_TRANSFORMATION_LADDER`). Last touched 2026-07-16.
**Depends on:** `inspector/AiInspector.tsx` merge only.

**Uncertainty flagged:** the two `AI2027_*` constants read as demo/showcase content rather than
product capability. If the owner considers them demo fixtures, ~2 of the 13 belong under
`benchmarks/` rather than `src/`.

---

## 7. Agent thread

**Verdict: PORT (rename target exists)** · **5 symbols**
(`inspector/NodeSlideAgentThread.tsx`)

```
NodeSlideStudio.tsx:126 -> inspector/AiInspector.tsx:107 -> inspector/NodeSlideAgentThread.tsx
```

**The audit's empty rename table is wrong here.** nodeslide `origin/main` has
`src/domains/nodeslide/inspector/AgentThread.tsx` (430 lines) with `AgentThread.test.tsx`. Parity's
file is the same component with the `NodeSlide` prefix and a virtualisation layer nodeslide lacks
(`NodeSlideVirtualRange`, `computeNodeSlideVirtualRange`, `buildNodeSlideThreadMessages`,
`NodeSlideThreadRuntimeProvider`, `NodeSlideThreadMessages`).

**Size:** small — the delta is virtualisation plus a runtime provider.
**Depends on:** nodeslide's `AgentThread.tsx` must be renamed or parity's prefix dropped; pick one
before porting or the repo ends up with both.

---

## 8. `DeleteDeckDialog` / `ExportMyDataAction` / export

**Verdict: PORT** · **11 symbols**
(`inspector/ExportMyDataAction.tsx` 5, `components/DeleteDeckDialog.tsx` 3,
`export/nodeSlideDataExportDownload.ts` 3)

Evidence — both are rendered:

```
NodeSlideStudio.tsx:94 -> components/shell/EditorProjectDialogs.tsx:3 -> components/DeleteDeckDialog.tsx
NodeSlideStudio.tsx:152 -> NodeSlideInspectorPanel -> InspectorPanel.tsx:71 -> inspector/DataInspector.tsx:18
    -> inspector/ExportMyDataAction.tsx:9 -> export/nodeSlideDataExportDownload.ts
```

nodeslide has `inspector/DataInspector.tsx` (the mount point) but no export action and no delete
dialog. Confirms `nodekit.yaml`'s prose and the plan's §1: the Notion P1 rows claiming these do not
exist were false.

**Size:** small in the UI, large in the schema. Already covered by plan decision **D1**: rewrite
against nodeslide's flat model. Note that `shared/nodeslideDataExport.ts` and
`convex/nodeslideDataExport.ts` are **also absent from nodeslide** and are outside the audit's scope
(see §12) — the UI is 11 symbols, the feature is not.
**Depends on:** D1 resolution; `convex/nodeslide.ts:855 deleteDeck`; `shared/nodeslideDataExport.ts`.

---

## 9. `uiContract.ts`

**Verdict: PORT, but NOT as a second version constant. Corrected 2026-07-27.** · **8 symbols**

Two findings from attempting it.

**It has already been ported, on a branch nobody has pushed.** Commit `4941d4d` on local-only branch
`port/slidelang` adds `uiContract.ts` byte-identical to parity's. It is **unwired** — `git grep
publishNodeSlideUiContract` on that branch returns the file and its test and no callers. A contract
with no consumer is the unarmed-sensor failure this document warns about, shipped as a port.

**The destination did not drop this; it solved it differently, and its version is armed.** There is
no `NODESLIDE_UI_CONTRACT_VERSION` equivalent and `uiContract.ts` was never in nodeslide's history.
Instead the studio root publishes agent-readable state as DOM attributes at `NodeSlideStudio.tsx:2921`
— `data-app-id`, `data-agent-surface`, `data-screen-state`, `data-mcp-compat`, `data-ns-theme` — and
those have real consumers: `scripts/nodeslide-agent-ui-linter.mjs:35-44` gates on three of them, and
`capture-gap-closure-ui-qa.mjs:171` fails a run on a `data-ns-theme` mismatch.

**The concrete collision.** `publishNodeSlideUiContract` writes `data-ns-theme` to
`document.documentElement`; the destination writes it to `.nodeslide-studio`, keys all its theme CSS
off `.nodeslide-studio[data-ns-theme="dark"]`, and reads it there in the QA gate. Wiring the ported
file unchanged gives the product two writers of the same attribute on different nodes, free to
disagree. Note that parity carries both mechanisms already, and no CSS in either repo keys off
`html[data-ns-theme]` — so the `<html>` copy is redundant in parity too.

The contract does carry information the DOM surface lacks (phase, connection, loading stage and
elapsed, deck id and version, job status and routing), so this is not pure duplication. It should
land as **one** channel wired into the existing linter gate, not as a second unwired constant.

```
src/App.tsx:16 -> NodeSlideStudio.tsx:148 -> uiContract.ts   // publishNodeSlideUiContract
```

A versioned `window.__NODESLIDE_UI_CONTRACT__` plus mirrored `data-ns-*` attributes on `<html>`, so
QA agents and scripted drives read app state instead of inferring it from pixels. Absent from
nodeslide entirely.

**Flag — the sensor is not armed.** Nothing consumes it:
`grep -rl "data-ns-phase\|NODESLIDE_UI_CONTRACT" scripts/ tools/` in parity returns nothing, and the
same grep over nodeslide `origin/main` returns nothing. `readNodeSlideUiContract` has no importer at
all; only `publishNodeSlideUiContract` is called. It is a contract published for out-of-repo
consumers that no gate in either repo currently reads. Port it — but porting it without wiring at
least one assertion to it reproduces exactly the failure mode the file's own header docstring
warns about.

**Size:** one file, ~200 lines, zero dependencies beyond DOM.

---

## 10. Editor shell refactor

**Verdict: PORT (merge into nodeslide's `NodeSlideStudio.tsx`)** · **25 symbols**

`components/shell/editorActions.ts` 8, `components/ProjectDialog.tsx` 5,
`components/shell/EditorFeedback.tsx` 4, `components/SlideNavigator.tsx` 2,
`components/shell/EditorProjectDialogs.tsx` 2, `NodeSlideStudio.tsx` 2,
`components/shell/EditorNavigator.tsx` 1, `components/editorShellResponsive.ts` 1.

All reachable directly from `NodeSlideStudio.tsx` (lines 81, 88, 91, 92, 93, 94, 99). nodeslide has
`ProjectDialog.tsx`, `SlideNavigator.tsx`, `editorShellResponsive.ts` under the same names but **no
`components/shell/` directory at all** — parity extracted an editor shell that nodeslide's
monolithic studio still inlines. parity's `NodeSlideStudio.tsx` is 5,755 lines vs nodeslide's 4,285.

The two missing `NodeSlideStudio.tsx` symbols (`DeckDeletionAction`, `EditorProjectDialogs`) are a
re-export at `NodeSlideStudio.tsx:117`, not new code.

**Size:** the merge is the cost, not the files. Reconciling two 4–6k-line studio components is the
largest mechanical risk in Phase 1.

---

## 11. Composer, and the remaining live singletons

**Verdict: PORT** · **35 symbols**

| File | Symbols | Reached via |
|---|---|---|
| `composer/nodeSlideComposerSession.ts` | 8 | `NodeSlideStudio.tsx:103` |
| `composer/NodeSlidePromptComposer.tsx` | 7 | `NodeSlideLanding.tsx:23` |
| `externalProviderConsent.ts` | 8 | `NodeSlideLanding.tsx:32` |
| `delegationClient.ts` | 2 | `NodeSlideStudio.tsx:104` |
| `nodeslideUserError.ts` | 2 | `NodeSlideStudio.tsx:131` |
| `inspector/DeckCiStatus.tsx` | 2 | `AiInspector.tsx:102` |
| `inspector/JsonInspector.tsx` | 2 | `NodeSlideStudio.tsx:128` |
| `inspector/AiInspector.tsx` | 1 | `NodeSlideStudio.tsx:126` |
| `inspector/DesignInspector.tsx` | 1 | `NodeSlideStudio.tsx:127` |
| `inspector/scopePresentation.ts` | 1 | `NodeSlideStudio.tsx:129` |
| `editorStateIntegrity.ts` | 1 | `NodeSlideStudio.tsx:119` |

`AiInspector`, `DesignInspector`, `JsonInspector`, `editorStateIntegrity` exist in nodeslide under
the same names — these are 1–2 symbol deltas on a shared file, i.e. drift, and should ride along
with the merges in §4/§5. `composer/`, `externalProviderConsent.ts`, `delegationClient.ts`,
`nodeslideUserError.ts`, `scopePresentation.ts`, `DeckCiStatus.tsx` have **no counterpart file** in
nodeslide.

**Depends on:** `DeckCiStatus` needs `convex/lib/nodeslideDeckCi.ts`; `delegationClient` needs
`shared/nodeslideDelegation.ts` — **both absent from nodeslide** (§12).

---

## 12. `atlas/AtlasGallery.tsx` — and the Atlas/claim gate scripts

**Verdict: DECIDE** · **1 symbol** (+ 10 scripts, §13)

```
src/App.tsx:22 -> src/domains/nodeslide/atlas/AtlasGallery.tsx
```

Imported by `App.tsx` **directly**, not through `NodeSlideStudio`, and last touched 2026-07-22
(`61cf833`, PR #66) — the most recent commit in the whole domain directory.

`parity-studio/nodekit.yaml` declares:

```yaml
canonicalFor:
  - nodeslide.atlas
  - nodeslide.claim-proof
contractDeclarations:
  - { concept: nodeslide.atlas,       signature: nodeslide-atlas-registry, path: shared/nodeslideAtlas.ts,      mode: canonical }
  - { concept: nodeslide.claim-proof, signature: nodeslide-claim-proof,    path: shared/nodeslideClaimProof.ts, mode: canonical }
```

and its `noKey.disclosure` names the Atlas gallery as one of the two surfaces that render without
keys. **parity-studio is the declared canonical owner of the Atlas.** So this code is neither a
port candidate nor a deletion candidate — it is parity's own product sitting in a directory named
`domains/nodeslide` because of where it grew.

**Question the owner must answer:** *Confirm that `nodeslide.atlas` and `nodeslide.claim-proof`
stay canonical in parity-studio.* If yes, Phase 3's "Delete `src/domains/nodeslide`" must first
**relocate** `atlas/` (and `shared/nodeslideAtlas*.ts`, `shared/nodeslideClaimProof.ts`,
`mcp/src/lib/atlasTools.ts`) out of the nodeslide namespace — a rename, not a delete. If no, the
registry declaration is wrong and must be withdrawn before Phase 5.

---

## 13. The 33 gate scripts

### 13a. Product proofs and benchmarks — **Verdict: PORT** · **23 scripts**

`nodeslide-agent-operability-proof`, `nodeslide-agent-ui-linter`,
`nodeslide-agentic-local-switch-proof`, `nodeslide-agentic-proof`, `nodeslide-authoring-meta`,
`nodeslide-benchmark-gate`, `nodeslide-benchmark-producer-lib`, `nodeslide-competitive-benchmark`,
`nodeslide-founder-roadshow-lib` (+ `.test`), `nodeslide-freeze-gate`, `nodeslide-journey-gif`,
`nodeslide-journey-proof`, `nodeslide-pptx-inspect`, `nodeslide-preference-proof`,
`nodeslide-production-hero-proof`, `nodeslide-proof`, `nodeslide-signature-apply-proof`,
`nodeslide-signature-proof`, `nodeslide-taste-judge`, `nodeslide-taste-pack-proof`,
`nodeslide-tastebench`, `nodeslide-uxbench`.

These gate the shipped product and are wired into parity `package.json` (`proof:nodeslide*`,
`nodeslide:bench*`, `lint:nodeslide-agent-ui`) and into `.github/workflows` (`nodeslide-freeze-gate`
at workflow line 36, `nodeslide-bench-*` artifacts). Their `scripts/tests/nodeslide-*.test.mjs`
siblings (9 files) must move with them or the moved gates lose their own coverage.

### 13b. Atlas and claim gates — **Verdict: DECIDE** · **10 scripts**

`nodeslide-atlas.mjs`, `nodeslide-atlas-topology-gate.mjs`, `nodeslide-motion-gate.mjs`,
`nodeslide-motion-canary.mjs`, `nodeslide-motion-canary.ps1`,
`nodeslide-artifact-fidelity-gate.mjs`, `nodeslide-asset-gate.mjs`,
`nodeslide-artifact-distinctness-gate.mjs`, `nodeslide-claim-gate.mjs`,
`nodeslide-knockout-canary.mjs`.

`parity-studio/nodekit.yaml`'s `proof.disclosure` names six of these **by npm script name** as
parity's own fail-closed gates: `atlas:topology-gate`, `atlas:motion-gate`, `atlas:fidelity-gate`,
`atlas:asset-gate`, `atlas:distinctness-gate`, `claim-gate`. Moving them to nodeslide would make
parity's repo manifest assert gates that are no longer in the repo — the exact false claim that
manifest was written to stop.

**Question the owner must answer:** *Do the Atlas/claim gates stay in parity (matching the registry
declaration), or does the registry declaration move to nodeslide with them?* Both are defensible;
what is not defensible is moving the scripts and leaving the manifest. Note the name collision risk
in either direction: nodeslide already has an `artifact-atlas*` script family (24 files) that builds
Atlas decks, which is a **different concern** from parity's Atlas contract gates.

---

## 14. Summary table

| # | Cluster | Verdict | Symbols | Scripts |
|---|---|---|---|---|
| 1 | `session/**` — agent-session layer | PORT | 79 | — |
| 2a | Google Slides sync + sync-contract layer | **DECIDE** | 100 | — |
| 2b | `integrations/` barrels + `capabilities.ts` | **DELETE** | 22 | — |
| 3 | `slidelang/jsonSpec.ts` + `jsonEdit.ts` | PORT | 30 | — |
| 4 | Trace + PDF-evidence (merge) | PORT | 37 | — |
| 5 | Inspector shell / tab model | **DECIDE** | 10 | — |
| 6 | `openui/visualMaterials*` | **DECIDE** (was PORT) | 13 | 0.x dep + name collision + unverified demo |
| 7 | Agent thread (rename → `AgentThread.tsx`) | PORT | 5 | — |
| 8 | DeleteDeck / ExportMyData / export | PORT | 11 | — |
| 9 | `uiContract.ts` | PORT (one channel, wired) | 8 | already on unpushed `port/slidelang`, unwired |
| 10 | Editor shell refactor (merge) | PORT | 25 | — |
| 11 | Composer + live singletons | PORT | 35 | — |
| 12 | `atlas/AtlasGallery.tsx` | **DECIDE** | 1 | — |
| 13a | Product proof + benchmark gates | PORT | — | 23 |
| 13b | Atlas / claim gates | **DECIDE** | — | 10 |

### Totals

| Verdict | Symbols | Scripts | **Items** |
|---|---|---|---|
| **PORT** | 243 | 23 | **266** |
| **DELETE** | 22 | 0 | **22** |
| **DECIDE** | 111 | 10 | **121** |
| | 376 | 33 | **409** |

Only **5.4%** of the stranded surface is dead. The premise in `DECOUPLING_PLAN.md` §5 — "some may
be dead code that should be deleted rather than moved" — is not supported: nothing in
`src/domains/nodeslide` was last touched before 2026-07-14, and every cluster except the two dead
barrels is reachable from `App.tsx` or a registered Convex function.

---

## 15. What contradicts the decoupling plan as written

1. **§5 Phase 3, "Delete `src/domains/nodeslide`", is not a safe unit of eviction.** `atlas/`
   inside it is declared canonical to *parity* in `parity-studio/nodekit.yaml`. Deleting the
   directory deletes a capability parity's own repo manifest asserts it owns.
2. **§3 "No redesign… Mechanical relocation only" cannot hold.** The inspector tab model (§5) and
   TraceWaterfall (§4) have diverged in *both* directions within the last two weeks — nodeslide PR
   #70 and #73 land changes parity does not have while parity holds a 2,138-line TraceWaterfall
   against nodeslide's 743. At least three clusters are three-way merges with design conflicts.

   **PARTLY WRONG, corrected 2026-07-27 by doing the TraceWaterfall port.** That file was not a
   design conflict at all — the destination's copy has one commit, is byte-identical to parity's at
   fork date, and simply stopped. A size gap looks identical whether the smaller side is a
   deliberate rewrite or a frozen snapshot, and only `git log` on the file plus a blob-hash
   comparison distinguishes them. The claim above was inferred from line counts and from spotting
   features at the destination that turned out to predate the fork and exist in both repos.
   **Before treating any cluster as a design conflict, check the destination file's commit count
   and compare its fork-date blob.** The genuine conflicts are the inspector tab model (§5) and the
   two `VisualMaterial` families (§6); TraceWaterfall was never one.
3. **§5 Phase 1 item 3, "move the 37 `nodeslide-*` scripts into nodeslide."** There are 34, not 37;
   one is already ported; and 10 of the remaining 33 are the Atlas/claim gates that
   `parity-studio/nodekit.yaml` declares as parity's own. Moving them makes the manifest lie.
4. **The audit's scope is narrower than the problem, so 409 is a floor.** `port-audit.mjs` covers
   `src/domains/nodeslide/**` and `scripts/nodeslide-*` only. Not covered, and each absent from
   nodeslide `origin/main`:
   - **20 `shared/nodeslide*.ts` modules**, incl. `nodeslideDataExport`, `nodeslideDelegation`,
     `nodeslideDurableSession`, `nodeslideSessionGrant`, `nodeslideAccessPolicy`,
     `nodeslidePptxLink`, `nodeslideRunBudget`, `nodeslideSourceMonitoring`.
   - **21 top-level `convex/nodeslide*.ts` modules**, incl. `nodeslideJobs`, `nodeslideJobRunner`,
     `nodeslideJobWorkflow`, `nodeslideSessions`, `nodeslideUploads`, `nodeslideGoogleAuth`,
     `nodeslideDeckCi`, `nodeslideWorkspaceAccess`.
   - 9 `scripts/tests/nodeslide-*.test.mjs`, 4 `scripts/{record,run,verify}-nodeslide-*.mjs`,
     `mcp/src/lib/atlasTools.ts`, `tests/e2e/nodeslide-*`.

   Several PORT verdicts above depend on these (§8, §11). **Phase 2's gate cannot be a merge
   requirement until its enumeration covers `shared/`, `convex/`, `mcp/`, and `tests/e2e/`** —
   otherwise it goes green while the Convex job runner behind half the UI is still stranded.
5. **§4's current-state table is missing a coupling.** parity's
   `NodeSlideConnectionsDialog.tsx` (1,034 lines, 148 Google references) exports the *same symbol
   names* as nodeslide's 309-line version, so the audit scores it **PORTED**. It is not. Symbol-name
   equality is a weak equivalence test; the largest single UI divergence found in this triage is
   invisible to the gate.
6. **`NODESLIDE_MCP_PACKAGE = 'https://parity-studio.vercel.app/downloads/parity-studio-mcp-0.4.0.tgz'`**
   (nodeslide `origin/main`, `NodeSlideConnectionsDialog.tsx`). The shipped product hands users an
   MCP package hosted on parity's domain. Phase 4 changes what parity-studio.vercel.app serves and
   Phase 3 does not mention this path. Verify the download survives resurfacing.

---

## 16. Uncertainty register

Stated plainly, because a named DECIDE beats a guessed PORT:

- **§2a Google Slides.** High confidence it is technically live in parity; **zero** confidence about
  product intent. This is 100 symbols and 4 Convex modules riding on one owner sentence.
- **§5 inspector tabs.** High confidence both designs exist; no basis to pick. Genuinely a design
  call.
- **§6 `AI2027_*` constants.** Unclear whether product capability or demo fixture.
- **§12 Atlas.** Confident about what the manifests say; the registry (`node-platform`) was not read
  in this pass, so if `repositories.yaml` disagrees with `nodekit.yaml`, that conflict is unresolved
  here.
- **Reachability is static-only.** The graph resolves static imports, `import()`, `require()`, and
  `vi.mock`/`jest.mock` specifiers. It does **not** resolve string-keyed registries or template-literal
  import paths. A grep for template-literal dynamic imports in `src/domains/nodeslide` found none,
  but that is a grep, not a proof.
- **Destination ref.** The audit ran against a dirty worktree at `db7857f`
  (`feat/public-share-projection`). All rename and equivalence checks in this document were done
  against `origin/main` instead, which is the stricter and more honest comparison — but it means the
  audit's 409 and this document's rename findings are keyed to two different destination commits.

## §10 — Cross-session territory split, agreed 2026-07-27

Two Claude Code sessions were porting the same files into the same repository concurrently. The
collision was found by a third party auditing `git worktree list` on the destination, not by either
session noticing. Recorded here because the split is only durable if it is written down.

| territory | owner |
|---|---|
| `convex/**`, `shared/**` | node-platform session (worktrees `wt-convexlib`, `wt-convexns`, `wt-sharedns`) |
| `src/domains/nodeslide/**` — UI, slidelang, inspector, openui, session | the parallel session (`wt-session`, `wt-jsonspec`, `wt-trace`) |

**Already landed by node-platform before the split was agreed, so the other session should NOT
re-port these:** `src/domains/nodeslide/session/**` (79 items, with both carried tests) and
`src/domains/nodeslide/composer/nodeSlideComposerSession.ts`, on branch
`port/google-slides-durable-session`. `composer/NodeSlidePromptComposer.tsx` was deliberately NOT
landed — the destination's `@/components/ai-elements/prompt-input` has diverged and lacks the
`clearOnSubmit` and `portalContainer` props, so it is a MERGE.

**Branches now on origin** (all four were local-only until this was flagged, which is the same
shape of loss that stranded seven commits and a 2,330-line importer earlier the same day):
`port/convex-lib`, `port/convexns`, `port/sharedns`, `port/slidelang`.

### The defect that motivated the split

`port/slidelang` commit `4941d4d` ported `uiContract.ts` byte-identical and unwired —
`git grep publishNodeSlideUiContract` returns the file, its test, and no callers.

The destination did not drop this capability; it solved it differently and its version has live
consumers. NodeSlide publishes agent-readable state as DOM attributes on the studio root
(`NodeSlideStudio.tsx:2921`); `scripts/nodeslide-agent-ui-linter.mjs:35-44` gates on three of them,
and `capture-gap-closure-ui-qa.mjs:171` fails a run on a `data-ns-theme` mismatch.

Wiring the port as-is would create two writers of one attribute on different nodes:
`publishNodeSlideUiContract` writes `data-ns-theme` to `document.documentElement`, while the
destination writes it to `.nodeslide-studio`, keys its theme CSS off that node, and reads it there
in the QA gate. No CSS in either repository keys off `html[data-ns-theme]`, so the `<html>` copy is
redundant even in parity.

The contract does carry information the DOM surface lacks — phase, connection, loading stage and
elapsed, deck id and version, job status, routing — so it is worth landing. It must land as ONE
channel wired into the existing linter gate, never as a second unwired version constant. See §9.

## §11 — Handoff to the session owning `src/domains/nodeslide/**`

Produced by a node-platform agent before the territory split (§10) took effect. It reverted all four
of its commits — `port/slidelang` is now byte-identical to baseline `79ae98f` — but these findings
cost real compiler time and will reproduce exactly. Every verdict below was checked in the
DESTINATION, not in parity.

### A NEW VARIANT OF THE BUG CLASS: the compiler is necessary but NOT sufficient

`slidelang/jsonEdit.test.ts`, last case. **tsc passes and the test fails at runtime.** It exercises
`./download`, not `./jsonEdit`. The destination's `downloadDeckJson` gates on
`assertNodeSlideArtifactCompilation` from `shared/nodeslideArtifactSpec` — a module that **does not
exist in parity at all** — and writes the bare snapshot. Parity routes through `exportNodeSlideJson`
and writes a `{format: nodeslide.deck-snapshot, version, snapshot}` envelope.

Symbol names matched, the compiler was satisfied, only the assertion caught it. Our rule "the
compiler is the oracle, not the symbol name" was itself incomplete: the compiler is a *stronger*
oracle than the symbol name, and still not sufficient. **Run the tests, and read what they actually
exercise.** Note also that the destination is the side that moved FORWARD here.

### MERGE verdicts, each with the exact error

**`components/FirstRunDialog.tsx`**
`TS2322: Property 'overlayClassName' does not exist on type '... DialogContentProps ...'`.
The destination's `@/components/ui/dialog` lacks it; parity's has it (`dialog.tsx:46,51,56`).
Same shape as the prompt-input incident.

**`components/shell/EditorNavigator.tsx`**
`TS2305: Module "../SlideNavigator" has no exported member 'normalizeSelectedSlideIds'`.
The destination never got multi-select AND carries 224 lines parity lacks. Overwriting deletes
shipped code.

**`components/shell/EditorProjectDialogs.tsx`**
`TS2724: ... no exported member named 'removeDeckOwnerAccessKey'. Did you mean 'storeDeckOwnerAccessKey'?`
Both repositories independently solved deck-capability forgetting over the same two localStorage
keys, with different failure semantics: destination `forgetDeckOwnerAccessKey(deckId): void`,
parity `removeDeckOwnerAccessKey(deckId): boolean`. Adding parity's alongside leaves two competing
contracts.

### DEPENDENCY-BLOCKED, not diverged — do not read these as forks

The destination has **zero** references to `assistant-ui`, `openuidev` or `pdfjs` anywhere in
`src`/`convex`/`shared`/`packages`, and none are installed. Its `AgentThread.tsx` and
`TraceWaterfall.tsx` are hand-rolled, framework-free reimplementations — a deliberate divergence,
not an omission.

Blocked: `inspector/traceTelemetry.ts` (type-only `SpanData`), `inspector/TraceWaterfall.tsx`
(also needs `@assistant-ui/store` runtime values), `NodeSlideAgentThread.tsx`,
`PdfEvidencePage.tsx` / `pdfEvidenceRuntime.ts`, `openui/VisualMaterialWorkbench.tsx`.

Pins if anyone decides to install: `@assistant-ui/react-o11y@0.0.25`, `@assistant-ui/react@0.14.26`,
`@openuidev/react-lang@0.2.8`, `pdfjs-dist@^6.1.200`. Note `zod@^4.3.6` was reachable through the
lockfile as a transitive but **not declared** — resolvable is not the same as declared.

`inspector/DeckCiStatus.tsx` is blocked outside this tree, on `convex/lib/nodeslideDeckCi`.

### Additive vs two-way, measured (parity-only / destination-only lines)

Only two files are safe appends: `editorShellResponsive.ts` (1 / 0) and `editorStateIntegrity.ts`
(`candidateSlideIdForPatch` only, otherwise byte-identical).

Everything else is heavy two-way divergence: `NodeSlideStudio.tsx` 2320/939, `AiInspector.tsx`
1944/1162, `ProjectDialog.tsx` 508/391, `InspectorPanel.tsx` 491/310, `TraceInspector.tsx` 239/115,
`JsonInspector.tsx` 188/40, `DesignInspector.tsx` 105/321.

### Gate gap that affects the convex side too

`convex/tsconfig.json` excludes `**/*.test.ts`, and the root `tsconfig.json` does not include
`convex/` at all. Convex-side test files are therefore checked by **neither** oracle. A test passed
tsc and then failed at runtime with `captureWebSourcesBestEffort is not a function` for exactly this
reason.
