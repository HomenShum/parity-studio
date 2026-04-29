# Parity Studio Shell Revamp — from Reference

**Status:** DRAFT (awaiting greenlight — no code changes yet)
**Date:** 2026-04-28
**Author:** hshum + Claude
**Reference:** screenshot shared 2026-04-28 ("Parity Studio · PRE-ALPHA · Reimagine recording demo into parity UI kit")

---

## 1. What the reference asks for

A complete reimagine of the parity-studio shell into a 3-column desktop-class layout that:

1. Adopts Open CoDesign's visual language (warm cream surface, terracotta accent, Fraunces serif display, Geist sans, JetBrains Mono, oklch tokens).
2. Promotes **Pipeline Activity** to a left-rail chat-with-tool-cards pattern.
3. Promotes **Deterministic Parity** to a full first-class right rail with the 16-row rubric, expandable failure detail, and a donut score visual.
4. Surfaces **Cost Telemetry** as a clean 4-cell grid under parity, not as scattered numbers.
5. Adds a proper **Header Action Cluster** (Comment mode · Zoom · Export) and brand-led **TopBar** (Wordmark · breadcrumb · star).
6. Treats the center pane as a **tabbed canvas** (Files / preview / code) with the Files tab showing FILES/SOURCE/HANDOFF groups and a *gallery-style* artifact preview to its right.

The screenshot's artifact (a "Terracotta UI" design system gallery with color tokens + component previews) is itself a generated ui_kit *example* — the chrome around it is what we're cloning.

---

## 2. Decomposition into ui_kit slugs

Per parity-studio's own `parseUiKitResponse` convention. Two slug families are visible in the reference:

### 2a. `ui_kits/parity-studio-shell/` — the app chrome (this is what we build)

```
ui_kits/parity-studio-shell/
├── index.html                        # mounts <App />
├── tokens.css                        # oklch palette + type scale + spacing
├── styles.css                        # globals + resets + font imports
├── manifest.json
├── README.md
└── components/
    ├── App.tsx                       # 3-col CSS grid root
    ├── TopBar.tsx                    # full top bar
    ├── Wordmark.tsx                  # P-square + "Parity Studio" + PRE-ALPHA badge
    ├── Breadcrumb.tsx                # Projects / Title / chevron / star
    ├── HeaderActions.tsx             # Comment mode | 100% | Export pill cluster
    ├── pipeline/
    │   ├── PipelinePanel.tsx         # left-rail container
    │   ├── PipelineHeader.tsx        # "PIPELINE ACTIVITY · Convex source"
    │   ├── ThreadsCounter.tsx        # "4 active threads" + "+"
    │   ├── PipelineActivityCard.tsx  # one stage card
    │   ├── PipelineStageIcon.tsx     # sparkles | cube | shield | rotate-cw
    │   ├── PipelineStatusDot.tsx     # green | amber | red | grey
    │   └── ViewAllRunsButton.tsx
    ├── composer/
    │   ├── ComposerCard.tsx          # cream surface, border, focus ring
    │   ├── ComposerInput.tsx         # auto-grow textarea
    │   ├── ComposerActions.tsx       # 📎 attach + ↑ submit (terracotta circle)
    │   └── ModelPicker.tsx           # bottom-left "gpt-5.4 ▼"
    ├── canvas/
    │   ├── CanvasPanel.tsx           # center container
    │   ├── CanvasTabBar.tsx          # Files (active red underline) / preview / code
    │   ├── FilesView.tsx             # 2-col: file groups | artifact preview
    │   ├── FileGroupHeader.tsx       # "FILES" / "SOURCE" / "HANDOFF" small-caps
    │   ├── FileEntry.tsx             # icon + label + meta line
    │   ├── ExportZipButton.tsx       # download row
    │   ├── ArtifactPreview.tsx       # rendered ui_kit shell
    │   ├── PreviewHeader.tsx         # "↗ ARTIFACT PREVIEW v0" + "v2.1.0"
    │   └── PreviewTitle.tsx          # serif display + subtitle
    └── parity/
        ├── ParityPanel.tsx           # right-rail container
        ├── ParityHeader.tsx          # "🛡 DETERMINISTIC PARITY"
        ├── ParityScoreCard.tsx       # big "12 / 16" + donut + status pill
        ├── ParityDonut.tsx           # SVG ring with pass/warn/fail wedges
        ├── ParityStatusPill.tsx      # "Status: Decomposing & verifying"
        ├── ParityCheckRow.tsx        # numbered row + name + verdict + chevron
        ├── ParityCheckDetail.tsx     # expanded card under failing rows
        ├── ParityVerdictPill.tsx     # Pass | Warn | Fail (color + dot)
        ├── CostTelemetry.tsx         # "🪙 COST TELEMETRY" + 4-cell grid
        ├── CostCell.tsx              # label + amount
        └── CostFooter.tsx            # est range + info icon
```

### 2b. `ui_kits/terracotta-ui/` — the *example* artifact rendered inside the canvas

This is what the previous run produced (the actual decompose output that's *being shown* in the preview). It's the **demo content**, not the chrome. We already have the latest version from the recent end-to-end test. Out of scope for this plan.

---

## 3. Mapping: existing parity-studio → new shell

| Existing component | Action | New location |
|---|---|---|
| `src/App.tsx` | **rewrite** layout to 3-col CSS grid (left 296px / center 1fr / right 432px) | `src/App.tsx` |
| `src/components/TopBar.tsx` | **expand** — add Wordmark, Breadcrumb, HeaderActions | `src/components/TopBar.tsx` |
| `src/components/InputBar.tsx` | **delete** — fold into composer at bottom of pipeline rail | n/a |
| `src/components/AgentChatSidebar.tsx` | **rewrite** as `PipelinePanel` rendering live runs as activity cards | `src/components/pipeline/PipelinePanel.tsx` |
| `src/components/FilesPanel.tsx` | **split** — file tree + handoff move into `canvas/FilesView`, no longer a sidebar | `src/components/canvas/FilesView.tsx` |
| `src/components/PreviewPane.tsx` | **rewrite** — becomes the canvas with tabs (Files/preview/code), gallery-style preview when artifact is rendered | `src/components/canvas/CanvasPanel.tsx` |
| `src/components/CommentOverlay.tsx` | **keep**, mount inside `ArtifactPreview` iframe wrapper | unchanged path |
| `src/components/FileEditor.tsx` | **keep**, mount inside `code` tab of CanvasPanel | unchanged path |
| `src/components/ActionSidebar.tsx` | **split** — PIPELINE goes to left rail cards, PARITY goes to right rail panel, COST goes to right rail under parity, TOOLS (Comment mode / Iterate / Hand off) move to HeaderActions | n/a |
| `src/styles.css` | **replace tokens** — adopt OCD oklch palette as default light theme, keep current dark as `[data-theme=dark]` override | `src/styles/tokens.css` + `src/styles/global.css` |

Net file count: -3 (delete InputBar, ActionSidebar, AgentChatSidebar moves), +20 (new sub-components).

---

## 4. Design tokens — exact parity

Adopted verbatim from Open CoDesign's `packages/ui/src/tokens.css` (MIT license, attributed in file header).

```css
/* surface */
--color-background:           oklch(0.98 0.012 80);   /* #FAF7F3 cream */
--color-background-secondary: oklch(0.96 0.015 75);
--color-surface:              oklch(0.99 0.008 80);
--color-surface-hover:        oklch(0.96 0.015 75);
--color-surface-active:       oklch(0.94 0.018 72);
/* border */
--color-border:               oklch(0.88 0.012 70);
--color-border-muted:         oklch(0.91 0.010 72);
--color-border-subtle:        oklch(0.94 0.008 74);
/* accent */
--color-accent:               oklch(0.62 0.16 35);    /* ≈ #C76D54 terracotta */
--color-accent-hover:         oklch(0.56 0.18 35);
--color-accent-soft:          oklch(0.95 0.02 40 / 0.5);
/* text */
--color-text-primary:         oklch(0.22 0.025 50);   /* warm dark brown */
--color-text-secondary:       oklch(0.50 0.020 55);
--color-text-muted:           oklch(0.65 0.015 58);
/* semantic */
--color-success:              #4F7A52;                /* parity Pass */
--color-warning:              #B8862A;                /* parity Warn */
--color-error:                #B04030;                /* parity Fail */
```

**Typography:**
- `--font-display: "Fraunces Variable", "Times New Roman", serif;` — only used for `PreviewTitle` and `ParityScoreCard` big number
- `--font-sans: "Geist Variable", system-ui, sans-serif;` — body
- `--font-mono: "JetBrains Mono Variable", ui-monospace, monospace;` — file names, hex codes, costs, timestamps, "PRE-ALPHA" badge

**Three font packages added:**
- `@fontsource-variable/fraunces`
- `@fontsource-variable/geist`
- `@fontsource-variable/jetbrains-mono`

---

## 5. Layout — exact pixel geometry

Total min-width: 1440px (matches reference frame). Below that, panels collapse to a single-pane mobile layout (deferred to follow-up).

```
┌─────────────────────────────────────────────────────────────────────────┐
│  TopBar (h: 64px)                                                       │
├──────────────┬─────────────────────────────────────┬────────────────────┤
│              │                                     │                    │
│  Pipeline    │  CanvasPanel                        │  ParityPanel       │
│  Panel       │  ├─ TabBar (h: 48px)                │  ├─ Header (h:48)  │
│  (w: 296px)  │  ├─ FilesView (2-col, gap:24)       │  ├─ ScoreCard      │
│              │  │   ├─ groups (w:240)              │  ├─ 16 CheckRow    │
│              │  │   └─ ArtifactPreview (1fr)       │  ├─ CostTelemetry  │
│              │  │                                  │  └─ CostFooter     │
│              │  └─ (preview & code tab content)    │                    │
│              │                                     │  (w: 432px)        │
│              │                                     │                    │
├──────────────┤                                     │                    │
│  Composer    │                                     │                    │
│  (sticky     │                                     │                    │
│   bottom)    │                                     │                    │
└──────────────┴─────────────────────────────────────┴────────────────────┘
```

CSS:
```css
.app-shell {
  display: grid;
  grid-template-columns: 296px 1fr 432px;
  grid-template-rows: 64px 1fr;
  grid-template-areas:
    "top top top"
    "pipeline canvas parity";
  height: 100vh;
}
```

---

## 6. Right rail — Deterministic Parity (the wedge)

The 16-check rubric needs a permanent home. Currently `convex/lib/parityChecker.ts` only emits 16 checks total but they're collapsed into 3 score buckets + file presence. The reference shows them as **16 individual named rows**. Two options:

### 6a. Render existing 16 buckets as 16 rows (no backend change)
Map current implementation to row labels:
- 1–4: element parity buckets (`bucket(elem.score)` 0–4 → "Structure parity", "Component count", "Layout grid", "Spacing system")
- 5–8: text coverage buckets ("Typography scale", "Font fidelity", "Color tokens", "Color delta")
- 9–12: token fidelity buckets ("Border radius", "Shadows & elevation", "Iconography", "Responsive breakpoints")
- 13–16: file presence (`index.html`, `tokens.css`, `manifest.json`, `README.md` → "Interaction states", "Accessibility", "Semantic HTML", "Visual regression")

⚠ This is **dishonest naming** — buckets are scoring buckets, not what those names imply. Violates `agentic_reliability` rule (HONEST_SCORES). Reject.

### 6b. Expand `parityChecker.ts` to emit 16 named, individually-evaluable checks (real backend change) ✅ recommended

Each check becomes a typed `ParityCheck { id, label, status, evidence, gap? }`. The 16 checks in the reference are well-defined and all are deterministic-derivable from `(sourceHtml, decomposedHtml, tokensCss, uiKitFiles)`:

| # | Check | Derivable from |
|---|---|---|
| 1 | Structure parity | sectioning element delta |
| 2 | Component count | `<section>` / `<article>` count |
| 3 | Layout grid | CSS `grid-template-*` extraction |
| 4 | Spacing system | `gap:`, `padding:`, `margin:` value clustering |
| 5 | Typography scale | font-size value count + ratio |
| 6 | Font fidelity | `font-family` value match against source |
| 7 | Color tokens | hex/oklch value count vs `tokens.css` |
| 8 | Color delta | ΔE between source pixels and decomposed colors (need source render) |
| 9 | Border radius | radius value clustering |
| 10 | Shadows & elevation | `box-shadow` count + depth |
| 11 | Iconography | `<svg>` count + path complexity |
| 12 | Responsive breakpoints | `@media` rule count |
| 13 | Interaction states | `:hover`, `:focus`, `:active` selector count |
| 14 | Accessibility | `aria-*`, `alt=`, semantic tag presence |
| 15 | Semantic HTML | tag distribution vs source |
| 16 | Visual regression | placeholder until headless render lands |

Each check returns `Pass | Warn | Fail` + 1-2 evidence sentences for the expand-detail card. Checks 8 and 16 honestly mark `unavailable` until headless render is wired (matches `verifyVisual` pattern that's already in the codebase).

**Backend change scope:** rewrite `convex/lib/parityChecker.ts` `checkDeterministic` to return `{ checks: ParityCheck[], summary, status, parityScore }`. Old `passCount/totalChecks` becomes `checks.filter(c => c.status === 'pass').length / checks.length`. Schema migration: `parity_reports.checks: v.array(...)` added; old `gaps` field stays for backward compat.

---

## 7. Cost Telemetry — exact 4-cell grid

Reference shows: `Total $0.0539 / Generate $0.0312 / Decompose $0.0154 / Verify $0.0073`.

Current backend already emits per-stage `costMicroUsd` in `runs.costBreakdown`. Component just needs to:
1. Sum across stages with name `generate*` → "Generate"
2. Sum across stages with name `decompose*` or `iterate*` → "Decompose" (combined per reference)
3. Sum across stages with name `verify*` → "Verify"
4. Total = sum of all

`microUsdToUsd` already exists in `ActionSidebar.tsx` line 50 — port and reuse.

---

## 8. Pipeline Activity — exact card geometry

Each card is a `Run` mapped to a stage activity card:

```
┌─ icon · ●● dot · stage_name ──────────────────┐
│  description (1-2 lines, secondary text)      │
│                                                │
│  Nm ago · N edit · N src                       │  ← mono, muted
└────────────────────────────────────────────────┘
```

**Source data:**
- `runs.listRecent` already exists, returns the last N runs. Use that.
- Each run has 4 stages (generate/decompose/verify-ui-kit-parity/iterate). Render one card per stage, ordered by `stageStartedAt`. The reference shows 4 cards = 1 run × 4 stages, so initial behavior matches.
- `N edits` ← derive from `costBreakdown[stage].outputTokens` rounded down (LLM-emitted file count is not directly tracked; output token count is a fair proxy).
- `N src` ← number of files referenced (for verify, count of checks; for decompose, file count of `ui_kits` row).
- Time-ago: existing `relativeTime` util pattern (port from OCD's `lib/relativeTime.ts` if helpful).

**"View all runs" button** opens a modal with the full run history (deferred — placeholder click-handler that just logs for now).

---

## 9. Composer — exact behavior

Single composer at the bottom of the left rail. Replaces `InputBar` entirely.

- Cream surface card, border, soft shadow.
- Auto-grow textarea (cap at ~6 lines, then scroll).
- 📎 attach button → opens file picker (reuses existing `onFile` logic from `InputBar`)
- ↑ submit button (terracotta-filled circle, white arrow) → `runs.start` mutation
- Below the card: model picker pill `gpt-5.4 ▼` — for now, hardcoded (no functional model switching yet, just visual). Track in todo for later.
- Placeholder text: `"Describe a design… try 'Pitch deck for a fintech startup'"` — verbatim from reference.
- Existing "✨ generate image" button → moves into the AddMenu under the 📎 (mirrors OCD's AddMenu pattern).

---

## 10. HeaderActions — exact 3-pill cluster

Top-right of the TopBar:

| Pill | Behavior | Source |
|---|---|---|
| `💬 Comment mode` | Toggle `commentModeActive` state, terracotta when active | existing `commentModeActive` in App state |
| `100% ▼` | Zoom dropdown for the artifact preview iframe | New — `viewport` state extends current `'desktop' \| 'tablet'` to include zoom |
| `↓ Export` | Triggers existing `/api/runs/<id>/zip` HTTP route | existing logic from `FilesPanel` |

`Iterate now` button (currently in ActionSidebar) moves into the chat composer area as a contextual button when `openComments > 0` and run is `done`.

`Hand off to Claude Code` button moves into a dropdown under Export (low priority, deferred).

---

## 11. Phased rollout

### Sprint 1 — tokens + fonts + Wordmark (1 evening, fully reversible)
- Add `@fontsource-variable/fraunces`, `@fontsource-variable/geist`, `@fontsource-variable/jetbrains-mono` to `package.json`
- Create `src/styles/tokens.css` from OCD's tokens (with attribution comment)
- Update `src/styles.css` to consume new vars; **keep** existing layout, just re-skin
- Add `src/components/Wordmark.tsx` (logo square + wordmark + PRE-ALPHA badge); slot into existing TopBar
- **Acceptance:** the *current* layout looks like a sibling of OCD. No layout change.

### Sprint 2 — layout reflow (2-3 days)
- Rewrite `App.tsx` 3-col grid
- Build `pipeline/*` components, render as left rail
- Build `composer/*` at bottom of left rail; delete `InputBar`
- Build `canvas/CanvasTabBar`, fold `FilesPanel` into `canvas/FilesView`, fold existing `PreviewPane` content into the preview tab
- Build `HeaderActions` cluster; remove old TOOLS section from ActionSidebar
- Build `parity/*` skeleton with score card, 16 placeholder rows, cost telemetry grid (still backed by current 16-bucket calculation)
- **Acceptance:** looks pixel-close to reference at 1440px, all existing functionality (run start, comment, iterate, export, monaco edit) still works.

### Sprint 3 — parity backend rewrite (3-5 days)
- Define `ParityCheck` type in `convex/lib/parityChecker.ts`
- Implement 16 named checks (5 deterministic at first; 8/16 honest `unavailable`)
- Schema migration: add `checks` field to `parity_reports`
- Wire `ParityCheckRow` + `ParityCheckDetail` to the new typed checks
- **Acceptance:** the 16-row rubric in the right rail shows real, honest, named checks with real evidence — matches reference exactly.

### Sprint 4 — cost telemetry grid + polish (1 day)
- `CostTelemetry` 4-cell aggregation from `costBreakdown`
- `CostFooter` static estimate text
- Donut chart (`ParityDonut`) — pure SVG, three wedges sized by pass/warn/fail counts
- **Acceptance:** the right rail's bottom matches the reference exactly.

---

## 12. Acceptance criteria — "exact parity"

The redesign ships when:

1. ✅ Side-by-side screenshot diff at 1680×900 against the reference shows ≤ 8px misalignment on any element.
2. ✅ Color values match reference exactly (cream `#FAF7F3` background, terracotta `#C76D54` accent, semantic Pass/Warn/Fail).
3. ✅ Typography matches: Fraunces serif for `PreviewTitle` and `12 / 16` big number; Geist for body; JetBrains Mono for hex / costs / timestamps / `PRE-ALPHA` badge.
4. ✅ All 16 parity rows show real, deterministically-derived results (no hardcoded mocks, no dishonest bucket renaming).
5. ✅ Cost telemetry sums correctly from real `runs.costBreakdown` data.
6. ✅ Pipeline activity cards reflect real `runs.listRecent` data.
7. ✅ End-to-end recording (`scripts/record-end-to-end.mjs`) produces a video that passes a fresh visual review.
8. ✅ All Phase 1 work passes existing tsc + biome + tests.

---

## 13. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Theme migration breaks dark mode | high | Keep dark as `[data-theme=dark]` override; light is default. Add `ThemeToggle` later. |
| Parity backend rewrite breaks `parity_reports` reads | medium | Schema-add (not replace) — keep `passCount/totalChecks/gaps` for read compat, add `checks` as optional |
| 16 checks aren't all derivable today | high | 5–6 checks (color delta, visual regression, accessibility, interaction states, iconography) honestly mark `unavailable` v1; ship rubric with real status not fake checks |
| Fraunces serif too heavy on small UI | low | Restrict serif to `PreviewTitle` (display 64px) and `ParityScoreCard` big number only; everything else is Geist |
| Layout breaks below 1440px | medium | Add a `@media (max-width: 1440px)` collapse rule (right rail becomes a slide-out panel) — defer to Sprint 5 |
| Existing tests reference deleted components | high | Move InputBar.tsx tests to ComposerInput.tsx; delete ActionSidebar.tsx tests; update App.test.ts |

---

## 14. Open questions for hshum (greenlight gate)

Before any code lands, please confirm:

1. **Cream-light as default theme?** Reference is light. Current app is dark. Confirm flip to light default (dark mode becomes opt-in).
2. **Right rail width 432px ok?** Wider than current sidebars but matches the reference's parity-as-hero positioning.
3. **Parity backend rewrite vs cosmetic-only?** Sprint 3 is a real rewrite of `parityChecker.ts`. Confirm appetite for that, or prefer a cosmetic-only revamp first (16 rows would all show the same 3-bucket-derived data, which violates honesty principles).
4. **Composer collapse:** delete InputBar entirely (moves to bottom-left composer)? Or keep top input bar for a transition period?
5. **Hub view:** OCD has a `Hub` for "your designs" gallery. Reference doesn't show one but the breadcrumb "Projects / …" implies multi-project. In scope for v1 or defer?
6. **Brand mark:** the "P" square logo in the reference — pick that, or design something more distinctive?

---

## 15. What I'm NOT touching

- Convex schema for `runs`, `artifacts`, `comments`, `ui_kits` (only `parity_reports` gets a non-breaking field add)
- Workflow (`workflows.ts`) — already fixed, stable
- LLM prompts and provider routing — separate concern
- Voice / mobile / offline modes — out of scope
- The `ui_kits/terracotta-ui/` artifact rendered inside the canvas — that's demo content, not chrome

---

## 16. Sequencing

1. ⏸ User reviews this plan, answers section 14 questions
2. → Sprint 1 (tokens) — single commit, fully reversible
3. → Sprint 2 (layout reflow) — feature-flagged via URL param `?shell=v2` for staged rollout
4. → Sprint 3 (parity backend) — feature-flag gates new parity panel UI, old still works
5. → Sprint 4 (polish + cutover) — flip default, drop flag

Estimated total: ~8 work-days end to end, gated by user review at end of each sprint.

---

## 17. Files this plan creates / touches (preview)

```
new:
  src/styles/tokens.css
  src/components/Wordmark.tsx
  src/components/Breadcrumb.tsx
  src/components/HeaderActions.tsx
  src/components/pipeline/{PipelinePanel,PipelineHeader,ThreadsCounter,PipelineActivityCard,PipelineStageIcon,PipelineStatusDot,ViewAllRunsButton}.tsx
  src/components/composer/{ComposerCard,ComposerInput,ComposerActions,ModelPicker}.tsx
  src/components/canvas/{CanvasPanel,CanvasTabBar,FilesView,FileGroupHeader,FileEntry,ExportZipButton,ArtifactPreview,PreviewHeader,PreviewTitle}.tsx
  src/components/parity/{ParityPanel,ParityHeader,ParityScoreCard,ParityDonut,ParityStatusPill,ParityCheckRow,ParityCheckDetail,ParityVerdictPill,CostTelemetry,CostCell,CostFooter}.tsx
  convex/lib/parityChecker.ts (rewrite — same path)

modified:
  src/App.tsx
  src/styles.css
  src/components/TopBar.tsx
  src/components/PreviewPane.tsx (becomes thin wrapper around CanvasPanel)
  src/components/FileEditor.tsx (mounted inside CanvasPanel `code` tab)
  src/components/CommentOverlay.tsx (mounted inside ArtifactPreview)
  convex/schema.ts (parity_reports.checks added)
  convex/parityReports.ts (save mutation accepts checks)
  package.json (3 fontsource-variable deps)

deleted:
  src/components/InputBar.tsx
  src/components/AgentChatSidebar.tsx
  src/components/ActionSidebar.tsx
```

Net: ~30 new component files, 6 modifications, 3 deletions. Roughly 1500 LOC of new component code, 800 LOC of CSS/tokens. Plus ~400 LOC for the parity backend rewrite.

---

**Awaiting greenlight on Section 14 before Sprint 1.**
