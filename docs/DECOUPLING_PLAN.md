# NodeSlide / parity-studio decoupling — engineering plan

| | |
|---|---|
| Status | IN EXECUTION — Phase 0 landing, Phase 2 gate built and red. D1/D2/D3 decided by the agent (§8) because execution was authorised with the owner out of the loop; all three are reversible and each records what would change if reversed. |
| Owner | Homen Shum |
| Author | Claude (session 47c22c0d), from measured state, 2026-07-27 |
| Repos | `HomenShum/parity-studio` (dev monorepo) · `HomenShum/NodeSlide` (live product) · `node-platform` (registry) |
| Reviewers | node-platform session owns registry edits; NodeSlide session owns product-repo review |

## 1. Problem statement

parity-studio began as a UI-parity/design-run tool (`ParityApp`: AgentRail, CanvasPanel,
ParityPanel, Convex `runs`/`parityReports`). NodeSlide grew inside it as `?domain=nodeslide`, then
graduated to its own repo and deployment (`nodeslide.vercel.app`) — but development never fully
moved. The result is a two-home product with unmanaged drift, and the drift is measured, not
suspected:

- Three Notion P1 rows asserted the PPTX importer, `deleteDeck`, and export-my-data **did not
  exist** while all three sat in parity-studio, unported (`pptxImport.ts` alone is 2,330 lines).
- Convex schemas have diverged: 43 tables (parity) vs 32 (nodeslide); parity has a workspace layer
  the product repo never grew.
- 37 `nodeslide-*` verification scripts live in parity/scripts and gate a product that ships from a
  different repo.
- Both test suites were green for months while the repos diverged, because both are repo-local.
  Green in parity says nothing about `nodeslide.vercel.app`.

Every false-absence incident this week traces to this split. The cost is not hypothetical; it is
misallocated roadmap rank, rediscovered work, and a board that lies in both directions.

## 2. Goals

1. `HomenShum/NodeSlide` is the **only** home of NodeSlide code, tests, and gates.
2. parity-studio returns to its original product, deployed with the parity domain as default.
3. Nothing is deleted from parity until a **derived** audit proves the port is complete.
4. The regression net spans the seam: behavior is asserted against **live URLs**, not just suites.

## 3. Non-goals

- No Next.js migration (explicitly never decided; direction is against it). Public-surface
  rendering ships via the existing `renderDeckHtml` route work (PR #83), framework unchanged.
- No redesign of either product during the move. Mechanical relocation only.
- No npm publishing decisions (blocked on licence — owner's call, §8).

## 4. Current state (verified, with probes)

| Fact | Probe |
|---|---|
| NodeSlide has its own repo + deploy | `nodeslide.vercel.app` serves `nodeslide-build-sha` = repo main HEAD |
| ~Importer ported~ **CORRECTED** | It was on branch `docs/operate-with-coding-agent`, which nothing merged. PR #71 had been merged *into that branch*, not into main, so the conformance receipt was unshipped too. `gh pr list` showed zero open PRs the whole time. Re-opened as nodeslide #73. The row below was written from a file existing on disk, which is not the same as it shipping. |
| ParityApp alive behind flag | `src/App.tsx:44` `VITE_ENABLE_PARITY_DOMAIN`, unset in prod; components exist and wire Convex queries |
| Importer ported | nodeslide `slidelang/pptxImport*` — 4 test failures on port were the live repo's **stricter** evidence gate; fixtures raised to contract |
| deleteDeck/export NOT portable as copy | references `workspaceId`/`by_project_id`/`runs` — absent from nodeslide schema |
| Open PRs against parity | #82 (ranker guard), #83 (share-link HTML, +1236/−34) — both must land or port before any freeze |
| parity main is red | 10 fixable Biome errors in `tools/brain/*` since `1c4ce7f` |
| parity auto-deploy off | `git.deploymentEnabled: false` — resurfacing requires re-enabling deliberately |

## 5. Phased plan

Sequencing rule: **nothing is removed until the phase that proves it is elsewhere has exited.**
Each phase has a mechanical exit criterion; "looks done" does not exit a phase.

### Phase 0 — Stabilize (½ day)
- Fix red main: `pnpm exec biome check --fix tools/brain`, commit.
- Land or explicitly close #82, #83 in parity. Fix #72's welded assertion in nodeslide
  (scope to non-zero count / testid), then merge #71, #72.
- Declare feature freeze for `src/domains/nodeslide` in parity (docs + PR template note).

**Exit:** parity CI green on main; zero open parity PRs touching nodeslide domain code.

### Phase 1 — Complete the ports (revised: the hand-written list below was wrong)

**Measured 2026-07-27 by `scripts/port-audit.mjs`, which enumerates with the TypeScript compiler
rather than by hand: 780 items (746 exported symbols + 34 gate scripts), of which 409 symbols
across 51 files and 33 of the 34 scripts are absent from the destination.** The four numbered
items below were written from memory and account for a minority of the real surface. The audit's
receipt (`artifacts/port-audit/port-audit.json`) is the authority; this list is not.

Largest unported units the hand list omitted entirely:

| Area | Missing symbols |
|---|---|
| `session/**` — the whole agent-session layer | 79 |
| `integrations/googleSlides/**` | 78 |
| `integrations/` sync-contract layer | 44 |
| `slidelang/jsonSpec.ts` + `jsonEdit.ts` | 30 |
| `inspector/traceTelemetry.ts`, `TraceWaterfall*` | 31 |
| `openui/visualMaterials*` | 13 |

Each of these needs its own port decision — some may be dead code that should be deleted rather
than moved, which the audit cannot tell you. That triage is Phase 1's real first task.

**Progress, 2026-07-27 — six pull requests, all on nodeslide main and all deployed.** The PPTX
importer and conformance receipt (#73), the share-link route (#74), 31 of 34 gate scripts with
their four CI jobs (#75), the first-run gate re-pointing (#76), the share-route crash fix (#77),
and the data-rights surface (#78, main d41bf77). Three gates were deliberately left in parity with
reasons recorded.

The audit against nodeslide `origin/main` closes the day at **1,139 missing of 2,349**, down from
1,162. Twenty-three items moved. Most of the day went into building the thing that can count, and
into discovering the count had been measuring a third of the surface.

Verified on the deployed URL at sha d41bf77, not from build logs: `/s/<unknown>` returns 404 with
1,980 bytes of rendered refusal, `/s/<invalid>` returns 400, neither crashes, and the two testids
#76 added are present in the production bundle while `first-run-dialog` and `ns-first-run` are gone.

**And the lesson that cost the most.** #74 merged with five green checks, including a test that
drove the real handler over a real local socket and measured 14,930 bytes of output. The deployed
function returns HTTP 500 on every request: `Cannot find module '/var/task/convex/_generated/api'`.
The handler is correct; the deployed bundle cannot resolve its own imports, because `"type":
"module"` makes Node ESM require explicit file extensions and every test ran in-process where the
bundler resolves what the runtime will not.

So: **no port is done until its behaviour is observed on the deployed URL.** Not the build log, not
CI, not an in-process integration test — that last one is the most dangerous of the three, because
it looks like end-to-end verification. Add the live check to each port's definition of done.

The originally-listed items, which remain correct as far as they go:

1. **Share-link HTML** → port/merge #83's route into nodeslide. `html.ts` differs (651 vs 562
   lines): this is a merge with tests carried, not a copy.
2. **deleteDeck + export-my-data** → schema-migration path (owner decision D1, §8): either
   nodeslide grows the workspace layer, or the features are rewritten against its flat model.
   Migration test: seed prod-shaped data, run migration, assert the erasure contract — with the
   table list **derived from `schema.ts`**, which already caught 3 tables a hand-list missed.
3. **Gates** → move the 37 `nodeslide-*` scripts + their `scripts/tests` into nodeslide. CI jobs
   move with them (parity's Quality/E2E jobs stop exercising NodeSlide the moment scripts leave —
   green must not become decorative).
4. **tools/brain** → node-platform (second-brain concern; that repo owns it). Coordinate via the
   node-platform session; registry rules say propose, don't push.

**Exit:** carried test suites green in destination; every intentional behavior delta from stricter
gates documented in the PR that introduced it.

### Phase 2 — Port-audit gate (1 day; blocks everything after)
Build `scripts/port-audit.mjs`:
- Enumerates every export of parity `src/domains/nodeslide/**` and every `nodeslide-*` script
  **mechanically** (no hand list).
- Asserts an equivalent exists in the destination repo (same symbol or a mapped rename table that
  is itself reviewed).
- **Revert probe built in:** run against a destination commit from before Phase 1 and confirm it
  FAILS. An audit that can't fail is not a gate.

**Exit:** audit green at destination HEAD, red at pre-port commit, wired into parity CI as a
required check on any PR that deletes nodeslide files.

**Status: built, widened, wired (d231635).** 2,349 items; 1,162 missing, so red by design. Probes:
self-audit exits 0 (PASS is reachable), `--against 90dbd47` exits 1, a stale exemption exits 2.

**Known blind spot — do not treat a green audit as sufficient on its own.** Equivalence is tested
by symbol name, and that has already produced one false PORTED: `NodeSlideConnectionsDialog.tsx` is
1,034 lines with 148 Google references here and 309 lines with none in the destination. Same
exported names, scored ported. The audit proves a *name* exists at the destination, not that the
behaviour came with it. Any cluster the triage marks as a three-way merge needs a human diff before
its deletion is allowed, regardless of what the gate says.

### Phase 3 — Eviction (½ day)
- Tag parity (`pre-eviction`) for rollback.
- Delete `src/domains/nodeslide`, nodeslide scripts, nodeslide CI jobs from parity, in one PR,
  with the port-audit as the merge gate.
- Golden-master run before and after against `nodeslide.vercel.app`: nine-state capture (exit 3 on
  miss), section sweep, share-link byte count keyed to `nodeslide-build-sha`. The live product must
  be **bit-identical in behavior** across this phase — eviction touches parity only.

**Exit:** parity builds green with no nodeslide references (`grep -ri nodeslide src/` = docs only);
golden-master deltas = zero.

### Phase 4 — Resurface parity (1 day; the unknowns resolved)
- **Vitality check — done 2026-07-27, verdict ALIVE.** Every Convex function ParityApp calls still
  exists, every table it reads is still in `schema.ts` (the growth to ~60 tables was purely
  additive; the parity tables sit above the `nodeslide_*` block untouched), and read-only queries
  against production returned real data: 44 runs spanning April–May 2026, and `parityReports`
  rows with the 16-check shape `ParityPanel` expects. Props and imports all still line up.

  Two config blockers, neither of them rot:
  1. `vercel.json` sets `git.deploymentEnabled: false`. A required step, not a footnote.
  2. `.env.local` points at `dev:secret-vulture-733`, which no longer exists — it 404s. Local
     work needs `npx convex dev` or `VITE_CONVEX_URL` repointed at `blissful-pig-998`.

  Both products share the one production deployment (`blissful-pig-998`), confirmed by
  `projects.list` returning NodeSlide projects from July beside parity runs from April.

  Not established: nobody has booted the app or exercised a mutation. Queries only, deliberately —
  calling `runs.start` or `chat.send` would write to production. The smoke step below is still owed.
- Set `VITE_ENABLE_PARITY_DOMAIN=true`, make `parity` the default domain, remove the disabled
  interstitial, re-enable deployments, deploy.
- **Redirect:** `?domain=nodeslide` and `?share=` links exist in PRD, docs, and old messages —
  301 to `nodeslide.vercel.app`, kept ≥ 90 days (owner decision D3).
- Smoke: boot flag-on build, execute one real run query, screenshot the three-panel shell.

**Executed 2026-07-27 on branch `feat/phase4-resurface-parity-only` — repo side done, exit criterion
NOT yet met.** `VITE_ENABLE_PARITY_DOMAIN` inverted to a kill switch (on unless explicitly
`false`), `parity` made the default domain, `ParityDomainDisabled` deleted, `data-testid=
"parity-shell"` added as the thing the live-DOM check greps for, `git.deploymentEnabled` flipped to
`true`, and three `vercel.json` redirects added. The vitality claim above was re-checked before
relying on it: `runs.listRecent` and `parityReports.getLatest` against `blissful-pig-998` returned
real May-2026 runs and a 16-check report (`status=needs_iteration`, 8/16).

Redirect mapping, and why the slug carries across unchanged: PR #83's `vercel.json` rewrote
`/s/:shareSlug` to `/api/share?share=:shareSlug`, so the id in the old query string **is** the id
in the new path. `/?share=<slug>` → `https://nodeslide.vercel.app/s/<slug>`, 301.
`/?domain=nodeslide` → `https://nodeslide.vercel.app/`, 301, with the rest of the query string
carried. A `share` value outside `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` — the shape
`requireShareSlug` has always demanded, so a value that could never have addressed a deck — goes to
`/link-moved.html`, a page that says what happened, instead of to a guess or a bare 404. A
well-formed slug for a deck that was unpublished lands on NodeSlide's own rendered refusal, which
already explains itself in 1,980 bytes. All rules are rooted at `/` so the explainer cannot loop.

Every rule is also scoped to `host = parity-studio.vercel.app`, and that scoping is not tidiness.
Unscoped, the rules fire on preview deployments too, which would have sent parity's own NodeSlide
E2E journeys onto `nodeslide.vercel.app` — a suite that runs with `NODESLIDE_E2E_MUTATIONS=1`, so
tests written for a throwaway preview would have been writing to the live product. Old public links
only ever named the production host; nothing else needs the redirect. The one cost is that a future
custom domain must be added to the `has` conditions or its old links will not redirect.

The same CI run caught a second welded sensor. `tests/e2e/vercel-bypass.globalSetup.ts` proved the
deployment-protection bypass had worked by testing the response body for the string `nodeslide` —
which was the `<title>`. Renaming the product failed a check about authentication. It now asserts
the Vite shell (`<div id="root">` plus a module script), which is what "we got the app and not the
protection page" actually means, and which a rename cannot break.

**Exit (still owed):** `parity-studio.vercel.app` serves ParityApp by default (live-DOM check for
`parity-shell`, not build logs); redirect verified with a real old link against the deployed URL.
Both are blocked on the pull request merging, since `deploymentEnabled` was `false` until it does.

### Phase 5 — Truth reconciliation (½ day)
- `repositories.yaml`: parity's entry re-described to its real product (registry edit proposed to
  node-platform session, not pushed).
- Update PRD/TDD links, the memory note claiming "both in sync," and the Notion rows.
- Evolution draft recording the eviction (via `draftEvolutionEvent`, not hand-written status).

**Exit:** `recall.mjs "nodeslide"` returns only product-repo paths for product code; board and
registry agree with disk.

## 6. Test strategy (cross-cutting)

| Layer | Mechanism | Integrity rule |
|---|---|---|
| Function (ports) | carry source tests to destination; classify failures as contract-drift vs defect | fixtures rise to the shipped contract, never the reverse |
| Migration (schema) | seeded prod-shaped data + erasure contract | expected set **derived from schema.ts** |
| Regression (seam) | golden master vs live URLs before/after each phase | keyed to `nodeslide-build-sha`; green CI ≠ live change |
| Audit (deletion) | port-audit derived enumeration | must fail on pre-port commit (revert probe) |
| Sensors | all new assertions | non-zero counts / specific testids; cross-state screenshot digests must differ (welded-sensor lesson) |

## 7. Risks

| Risk | Sev | Mitigation |
|---|---|---|
| Delete-before-port strands work permanently | HIGH | Phase 2 gate is a required CI check; tag before eviction |
| Parity Convex is dead → resurfacing stalls | MED | Vitality check is the *first* step of Phase 4, not the last |
| deleteDeck migration corrupts prod data | MED | Migration tested on seeded copy; never run against prod by an agent |
| Gates lose meaning in transit (CI jobs left behind) | MED | Jobs move in the same PR as scripts; parity Quality job retired explicitly |
| Old links break silently | LOW | Redirect + a link-checker pass over docs/PRD |
| Audit says PORTED on a name match while the behaviour stayed behind | HIGH | Symbol-name equality is the audit's known weakness (§Phase 2). Every three-way-merge cluster in `docs/PORT_TRIAGE.md` needs a read diff before deletion |
| `atlas`/`claim-proof` evicted despite parity declaring itself canonical for them | MED | `nodekit.yaml` here names six of those gates by npm script. Phase 3's blanket removal must exclude them until the registry question in the triage is answered |
| A moved gate keeps passing while pointed at a surface that no longer exists | MED | Two moved gates were found asserting a `first-run-dialog` the product deliberately replaced. Every moved gate must be run against live production in its new home, not merely imported |

## 8. The three decisions, and how they were made

Execution was authorised with the owner out of the loop, so these were decided rather than left
blocking. Each is reversible; each records the cost of reversing it.

- **D1 — deleteDeck/export: rewrite against nodeslide's flat model.** Growing an eleven-table
  workspace layer to serve a delete button imports parity-specific complexity into a repo that
  never had it, and every table added is a table the erasure contract must then cover. Reversing
  this means the migration is larger, not that work is thrown away.
- **D2 — npm licence: out of scope.** It blocks publishing, not decoupling, and it is a legal
  choice an agent should not make. Left for the owner.
- **D3 — redirect lifetime: 90 days.** Old `?domain=nodeslide` and `?share=` links appear in the
  PRD, in docs, and in sent messages. Reversing this is editing one number.

## 9. What agents will not do in this plan

Merge to either main without review; run migrations against production; edit node-platform's
registry directly; claim any phase exited without its mechanical check passing. Every "done" in
this plan is a command output, and each phase's exit criterion names the command.
