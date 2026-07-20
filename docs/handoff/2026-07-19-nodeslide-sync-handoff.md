# 2026-07-19 — NodeSlide sync handoff (parity-studio side)

Short pointer handoff. **Canonical next-session instructions live in the
product repo**: `HomenShum/nodeslide` → `docs/NEXT_SESSION.md` (updated this
session) + `docs/CAPABILITY_PLAN.md`. Read those first if you're touching
NodeSlide capability/product work.

## State at this handoff

- **parity-studio** `main` = `96c6e45` — clean, level with origin. This is the
  **dev monorepo**; the NodeSlide product runs from the `nodeslide` repo
  (prod: https://nodeslide.vercel.app, Convex `agile-stoat-411`).
- **nodeslide** `main` = `0f3726a` — clean, level with origin, prod verified live.

## Mirror rule (do not drop)

Every change under `src/domains/nodeslide/` or `convex/` lands in **both** repos
in the same session. Both repos' governance/D9/D8 code is currently in sync.

## What this session landed here

- **Project-dialog centering + body-collapse fix** (`src/domains/nodeslide/nodeslide.css`,
  `.ns-project-dialog`): native `<dialog>` resolves to `position:absolute` so the
  backdrop's flex centering never applied (pinned top-left), and a content-sized
  dialog collapsed its `minmax(0,1fr)` body row to 0 (clipped list). Fixed with
  `inset:0; margin:auto` + definite `height`. Mirror of the nodeslide fix, which
  was deployed to prod and live-verified (computed geometry `centeredX/Y:true`).
  Reuse this pattern for any future modal.
- Earlier this session: the DEPTH-finish D9 approver / D8 image-ingest / D1
  apply-repairs work + 4 latent-defect backports merged to main (PR #54).

## Open PRs to triage (do not blind-merge)

- parity-studio: draft PR #18 "external interoperability" (Codex), PR #17
  nodeslide README docs (OPEN since 07-14 — review or close).
- nodeslide: draft PR #5 "injectable core boundary" (Codex).

## House rules (unchanged)

Analyst root-cause before fixing · live-DOM verify prod after deploy (assert a
concrete signal, never claim by log) · loop adversarial-verify until clean ·
honest checkmarks only · gates green per commit
(`npx tsc --noEmit`, `npx tsc -p convex --noEmit`, `npx vitest run`, `npx biome check`).
