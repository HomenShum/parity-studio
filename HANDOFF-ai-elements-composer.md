# Handoff — Finish the AI Elements composer port (parity live demo)

**Owner:** Codex agent (gpt-5.6-sol). **Author:** Claude (Opus 4.8), 2026-07-14.
**Worktree:** `D:/VSCode Projects/parity-studio-ai-composer` — git branch `feat/ai-elements-on-integration`, based off `codex/nodeslide-integration-all` @ `c41b077`. **pnpm** repo. **Work ONLY in this worktree.**

---

## Goal

Bring the Vercel **AI Elements `PromptInput`** composer into the parity-studio NodeSlide **AI-tab inspector**, so the live demo matches the (already-shipped) NodeSlide standalone app — **without regressing the density pass** that `integration-all` already applied. End state: `src/domains/nodeslide/inspector/AiInspector.tsx` uses the PromptInput family, all governance/state preserved, and every verify gate green. Then open a PR into `codex/nodeslide-integration-all` (do **not** self-merge).

## Why this is a 3-way merge (read before editing)

- **Reference (done, shipped):** `HomenShum/NodeSlide` repo `origin/main` (local copy `D:/VSCode Projects/nodeslide`, commits `da6cd79` + `0f32f7d`). Its `AiInspector.tsx` has the composer rewired to PromptInput. **READ-ONLY — different repo.**
- **Base (this worktree):** `integration-all`'s `AiInspector.tsx` — has a **density pass** (icon-only toolbar; removed context/welcome/policy/route sections; zero-friction consent `providerConsent = true`) that NodeSlide's version does **NOT** have. It still uses the **native** `<form><textarea>` composer.
- So neither side is a superset. You must **keep the density-pass decisions from the base** and **apply the composer rewire from the reference**. A wholesale copy of nodeslide's file REGRESSES the density pass — do not do it.

## What is already done (do NOT redo)

- Scaffold committed as **`a7e9345`**: `src/components/ui/*` (11 shadcn primitives), `src/components/ai-elements/prompt-input.tsx`, `src/lib/utils.ts` (`cn`), `src/tailwind.css` (scoped, **preflight omitted**, shadcn tokens mapped to the warm `--color-*` palette + `.ns-ai-v3-prompt` composer-fit CSS), `components.json`.
- `@/*` alias in `tsconfig.json` + `vite.config.ts`; `import './tailwind.css'` in `src/main.tsx` (kept parity's existing PostCSS tailwind — do **not** add `@tailwindcss/vite`).
- Deps installed: `radix-ui, clsx, tailwind-merge, class-variance-authority, cmdk, nanoid, ai` + dev `jsdom, @testing-library/react, @testing-library/user-event, @testing-library/dom`.
- **NodeSlide standalone already shipped** (composer + jsdom model-picker test) to its own `origin/main` — that is your working reference for both the JSX and the test retarget.

## The task (edit only these files)

1. **`src/domains/nodeslide/inspector/AiInspector.tsx`** — replace the native composer with the PromptInput family, mirroring nodeslide's structure, **preserving every density-pass decision already in this file**:
   - Add imports: the `PromptInput*` family from `@/components/ai-elements/prompt-input`, `{ SelectGroup, SelectLabel }` from `@/components/ui/select`, `{ TooltipProvider }` from `@/components/ui/tooltip` (match nodeslide's import block). Remove now-unused icons (e.g. `ArrowUp`) so `noUnusedLocals` passes.
   - Convert `<form onSubmit={submit}>` → `<div className="ns-ai-elements ns-ai-v3-prompt">` + `<TooltipProvider>` + `<PromptInput onSubmit={(_msg, event) => submit(event)}>` with `PromptInputTextarea`, `PromptInputFooter`, `PromptInputTools`, `PromptInputSubmit`.
   - Native model + effort `<select>` → `PromptInputSelect` (Radix), exactly as nodeslide does. Keep `data-testid="ai-model-select"` and `ai-effort-select` on the triggers.
   - Keep the toolbar **icon-only** (density pass). Buttons become `PromptInputButton` but stay icon-only.
   - Preserve ALL state/handlers/testids: `data-testid="ai-composer"`, submit control, `instruction`, `chooseProviderModel`, `providerEffort`, `webResearch`, scope chips, memory/attach/context buttons.
2. **Tests — retarget, never delete:**
   - Port `convex/lib/nodeslideModelPicker.test.tsx` from nodeslide (adjust import paths / prop shape to this repo). It opens the Radix model picker in jsdom and asserts every model renders.
   - Fix any SSR test broken by the portal-based Radix selects by moving option-assertions to the data layer + the interaction test, exactly as nodeslide's `convex/lib/nodeslideReviewUi.test.tsx` does.

## Verify gates — ALL green before you open the PR (run in this worktree)

```bash
pnpm typecheck                                   # tsc --noEmit, strict root
pnpm exec tsc -p convex/tsconfig.json --noEmit
pnpm test                                        # vitest
pnpm lint                                        # biome check .
VITE_CONVEX_URL=https://ci-placeholder.convex.cloud VITE_CONVEX_SITE_URL=https://ci-placeholder.convex.site pnpm build
```

## Known base issues (pre-existing — NOT caused by the composer)

- **`pnpm typecheck` currently errors in `convex/nodeslideGoogleAuth.ts`** — the fresh worktree's `convex/_generated` data model is stale and missing the `nodeslide_oauth_credentials` / `nodeslide_oauth_sessions` tables. Fix FIRST: run `npx convex codegen` (or sync `_generated` from a deployment). These errors are orthogonal to the composer; they must be cleared so the typecheck gate is meaningful.
- **biome** reported **2 errors it could not auto-fix** in `src/components` after `biome check --write` — resolve them manually (they surfaced during the scaffold commit).

## Constraints (hard)

- Edit ONLY `AiInspector.tsx`, the test files, and `src/tailwind.css` if truly needed. Scaffold/config is done.
- **Never delete a failing test** — retarget/fix it. **Never loosen tsconfig.**
- **Commit as you go** (the scaffold is already committed as `a7e9345` — build on it). Do not leave the composer merge uncommitted for long: a write-capable agent's `git checkout` wiped an earlier uncommitted version of this exact port. Commit before any review/verify step.
- Do **not** self-merge to `integration-all`. Open a PR for its owner to review (the density pass is theirs).

## Definition of done

PromptInput composer live in the AI tab (verify by `grep -c '<PromptInput' src/domains/nodeslide/inspector/AiInspector.tsx` ≥ 10 and `<textarea` = 0), density pass intact (icon-only toolbar; no re-added context/welcome/policy/route sections), all 5 gates green, model-picker interaction test present and passing, PR opened into `codex/nodeslide-integration-all`.
