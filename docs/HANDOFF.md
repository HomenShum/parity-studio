# NodeSlide / parity-studio — engineer handoff

| | |
|---|---|
| Written | 2026-07-28, end of the decoupling push |
| Repos | `HomenShum/NodeSlide` (the live product) · `HomenShum/parity-studio` (dev monorepo, returning to its own product) |
| Live | `https://nodeslide.vercel.app` — serving, healthy, ~140ms |
| Audit | **8 missing of 2,349** · 2,270 ported · 22 renamed · 48 superseded · 1 stays |

Read `docs/DECOUPLING_PLAN.md` for the phase model and `docs/PORT_TRIAGE.md` for the
per-cluster verdicts. This file is the state of play and the traps.

## 1. Where the product actually is

NodeSlide **works live**. Driving the nine NodeKit-required states against production
reaches `first_arrival → loading → populated → proposal → completed → mobile` — meaning a
real model call produces a proposed edit, a human accepts it, and the deck version
advances, on the deployed site rather than a test double.

Two states remain unreached and neither is a product defect:

- `conflict` — needs two writers racing; one browser cannot stage it.
- `exception` — a claim with no evidence bound; the sample deck may simply have every
  claim sourced.

`failed_safe` **was** reported as a duplicate frame for two days. That was a sensor
defect, settled 2026-07-28 (parity PR #88): the assertion matched fallback text belonging
to the *direction* lane, so two states photographed one component. Users can tell when the
model falls back — the live DOM says `Deterministic fallback` and
`Fallback reason: provider timeout`. Coverage is now 7/9 on distinct digests.

## 2. What is genuinely blocked, and on whom

| Item | Owner | Note |
|---|---|---|
| **Exposed Google API key** | Homen only | `HomenShum/NodeBenchAI/scripts/tax-2025/tax-doc-processor.mjs`, public repo, live key, exposed since 31 March. **Rotate in Google Cloud first** — deleting the file does not invalidate it. |
| **Two prod job rows carry 4 plaintext deck capabilities** | Homen only | `nodeslide_job_7390152a7aeab1e726b2ff8cd0dc9dde` and `nodeslide_job_b880b4820373d1bddac8f9000b1eb327` — owner + execution access keys, readable since 2026-07-28 by anyone holding those two `clientSessionId`s. The write path is fixed (below); **these rows are not**. Nothing was deleted or rotated — that is deliberate. **Rotation is the real remedy**; purging alone does not un-disclose. Purge options, least destructive first: a one-shot internal mutation re-running `redactNodeSlideErrorText` in place (keeps the diagnosis), the existing derived erasure over their decks, or deleting the two rows by `_id`. |
| Google Slides sync is **inert** | Homen | Ships and fails closed. Needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NODESLIDE_OAUTH_TOKEN_ENCRYPTION_KEY`, `NODESLIDE_GOOGLE_REDIRECT_URI`, `NODESLIDE_APP_ORIGINS`. Present-and-non-functional is worse for a new user than absent. |
| parity PR #85 (Phase 4 resurface) | Homen | Blocked on `PARITY_CONVEX_DEPLOY_MODE` in the Vercel **Preview** environment. The guard fails closed and has since it landed; it was invisible while deploys were off. |
| First real metered spend | anyone | Enforcement landed (PR #109/#113) and no request has ever left the process. Reservations are real rows against the real price table; the first real user is the first real test. |

## 3. Traps that cost real time — do not rediscover these

**`npx` in a bare worktree is a fake tool.** With no `node_modules`, `npx biome` resolves
to an unrelated registry package that **exits 0 on malformed JSON** and prints nothing for
`--version`. It passed 14 files that real 1.9.4 then reformatted. Before trusting any tool's
exit code in a worktree, assert its identity (`npx biome --version` → `Version: 1.9.4`), or
run tools from a checkout that has dependencies pointed at worktree paths:

```
cd "D:/VSCode Projects/nodeslide" && npx biome check "<worktree>/path/to/file"
```

**GitGuardian scans a PR's whole commit history, not its final tree.** Fixing a flagged
value in a *new* commit leaves the old one in history and the finding stands. The tell is
the summary line: "1 secret from the scan of **N commits**". Only rewriting the carried
history clears it. Two PRs were squashed for exactly this.

**Branch protection rejects `BEHIND` branches even when every check is green.** `gh pr merge`
fails with no useful message. Run `gh pr update-branch` first.

**`git push origin main` from a checkout that is on another branch pushes an unchanged ref
and reports success.** Four commits were reported as landed on main while sitting on a
feature branch. Assert the remote moved:

```
before=$(git rev-parse origin/main); git push origin HEAD:main; git fetch -q origin
[ "$before" != "$(git rev-parse origin/main)" ] || echo "REMOTE DID NOT MOVE"
```

There is a shared gate for the read side: `scripts/unpushed-work-gate.mjs` (a resolver, not
a copy — it refuses to run rather than substitute a local reimplementation).

**A failed `cd` continues the script.** A worktree-add failed, the `cd` failed unchecked,
and the rest of a script ran against a shared checkout, sweeping another session's
uncommitted files into a stray commit. Always verify
`git rev-parse --show-toplevel` equals the worktree path before the next command.

## 4. The instruments, and what each refuses to claim

Every gate here was built because a green check once meant nothing. Each states its own
limits in its own output — that is the convention, keep it.

| Gate | Proves | Explicitly does NOT prove |
|---|---|---|
| `scripts/port-audit.mjs` (parity) | a symbol name exists in the destination | that behaviour travelled. It once scored a 1,034-line file as ported against a 309-line one |
| `nodeslide-trust-surface-census.mjs` | annotations exist; no CSS motion on decision affordances | cascade resolution, runtime state — reports `not-run` |
| `probe:trust-surfaces` | live `Element.getAnimations()`, computed colour, reduced-motion | surfaces needing a completed model run — `not-run`, never `passed` |
| `nodeslide-pptx-playback-canary.mjs` | the **file's** timing structure | that PowerPoint renders it. Needs a real PowerPoint |
| `capture-required-states.mjs` (parity) | nine states reached, on **distinct** screenshot digests | anything about states it could not stage |

**Three integrity rules worth preserving:**

- **`not-run` beats `passed`.** A surface a gate cannot reach is never green.
- **Arm the sensor.** Assert the subject is present and in the expected state *before*
  asserting the absence of a defect — "no violation found" and "nothing was there" are
  otherwise indistinguishable. A gate once filed a screenshot reading `Unsourced 0` as
  proof that state was reached.
- **Gate vs tripwire.** A gate proves a property holds today; one that cannot fail proves
  nothing. A **tripwire** guards a future change and is *supposed* to be unreachable now —
  it must say `[TRIPWIRE]` in its own comment, or the next reader deletes it as dead code.

## 5. Known open findings, filed not fixed

- **`clientSessionId` is a de-facto bearer token.** It is the sole argument to the public
  `listSessionJobs` query, with no second factor. The primary path is `crypto.randomUUID()`
  (122 bits, fine) — but `src/lib/sessionIdentity.ts` falls back to
  `session-<Date.now()>-<Math.random()>`, which is **not cryptographically random**, is
  written to `localStorage`, and never rotates. On that path a guessable string is the only
  gate on every error body in the session. Error bodies no longer carry capabilities, which
  was the urgent half; the auth shape is a **product decision** and was deliberately not
  changed by an agent.
- **`interaction-clip` has a marker now, `roundtrip-ppt.pptx` does not.** The roundtrip
  artefact was deliberately not regenerated — a fresh conversion re-measures the portability
  facts in `shared/nodeslideAtlas.ts`, which the generator itself documents as a thing not to
  do incidentally. Its A3 subject count stays 2.
- **The `origin` attribute has only been seen on a synthetic fallback.** `data-proposal-origin`
  is proven in jsdom, never on a live production fallback — the runtime probe refuses to bill
  for its own fixture, so its clause E reads `not-run` until someone runs it against a
  deployment carrying a real pending proposal.

**Closed since this document was first written** (kept because the reasoning outlives the fix):

- *Durable create/edit jobs* — settled empirically against the deployed backend, not by
  reading: both **did** fail, on `ArgumentValidationError`. Convex rejects undeclared
  arguments at the callee boundary **before the handler runs**, so the deck-id prefix mismatch
  was real but unreachable — validation always fired first. Create is now ported properly
  (validator plus identity binding as pure string comparisons, no DB read); edit is
  **deliberately still rejected**, with the refusal moved to enqueue, because `maxCostUsd` is a
  caller-supplied spend ceiling and declaring it without honouring it would accept a dollar
  limit and ignore it. The edit path has **four** undeclared fields, not one — Convex reports
  only the alphabetically first.
- *Proposal authorship was prose-only* — `origin` and `fallbackReason` now reach the client and
  publish as `data-proposal-origin`. The value is keyed off `usedFallback` rather than
  `receipt.origin`, because a provider that errors before parsing leaves the receipt reading
  `free_route` while the deterministic path wrote the operations — publishing the raw origin
  there would make the attribute contradict the visible copy.
- **`interaction-clip` (atlas slide 25)** is deliberately degraded to a poster frame, but
  the exported slide carries no trace of the decision, so an examined-and-excused slide is
  indistinguishable from one never considered.
- **185 of 187 exported decks emit no timing structure**, correctly — they are static by
  design, proven structurally (no schema field anywhere carries motion). The canary says
  `not-run` for them; work is in flight to let recipes declare that intent affirmatively.

## 6. Local state at handoff

Both shared checkouts sit on feature branches with uncommitted files belonging to
**concurrent sessions** — deliberately not cleaned, because they are not this session's to
discard. Twelve local branches whose PRs merged have been deleted; roughly 23 remain with
no PR and should be triaged by whoever owns them before deletion.

`origin/main` is the authority in both repos. Nothing described here as shipped is
unpushed — every claim in this document was verified against `origin/main` or the deployed
URL, not a working tree.
