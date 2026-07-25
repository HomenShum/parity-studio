# Design reference library

The durable record of what NodeSlide was measured against, so the next person — or the next
session — does not have to re-derive it.

**Why there are no competitor screenshots in this folder.** Mobbin's captures are their licensed
material, and copying them into a repository redistributes them. What is portable is the *rule*
extracted from each capture, plus the source URL to go and look again. Our own screenshots of our own
product live in `../evidence/` and are committed.

## Sources

| Reference | What it answers | Where |
|---|---|---|
| Linear Web — initiative detail, right Properties panel | How a properties panel differentiates label from value | Mobbin → Apps → Linear Web → Screens |
| Figma Slides — deck editor | The closest structural analogue: rail + canvas + right panel | Mobbin → Apps → Figma Web → Screens → "Mid Mod Theme" |
| Gamma — deck editor | An AI presentation maker that keeps almost no chrome | Mobbin → Apps → Gamma (AI presentation maker) → Screens |

Mobbin also ships an official MCP server — `claude mcp add mobbin --scope user --transport http
https://api.mobbin.com/mcp`, then authorise from an interactive session via `/mcp`. It is registered
at user scope already. Once authorised, the remaining uncompared sections can be swept without
driving a browser.

## The rules, extracted

### Linear — differentiate by colour, never by size

Its Properties panel renders `Status → Active`, `Owner → Alex Smith`, `Target date → Q2 2026` at
**one text size**. The label is muted; the value is full contrast. Nothing shrinks to signal "less
important". Cards group related rows; whitespace separates them.

### Figma Slides — two tabs, no prose, fonts named

```
Design | Animate                52%
Slide 1
Template style
  ▮▮▮ Mid Mod
      Syne, IBM Plex Serif        ⌄
Background
  [▣] [▩] [🖼]    ▮ Color        ⌄
Selection colors
  ▪ Color 2   ▮ Color   ▪ Color 3
```

Two tabs for the whole right-hand surface. Roughly three text sizes. **Zero explanatory sentences.**
Fonts shown as family names, not CSS fallback chains. Presenter notes live in a strip **under the
canvas**, not inside the panel about appearance.

### Gamma — panels on demand, AI in the top bar

Top bar: `Theme · Share · ✨Agent ⌄ · ▶Present ⌄ · ⋯ · avatar`. Thumbnails are a **floating panel
with a close button**, not a permanent rail. The right side is a strip of unlabelled icons that
opens nothing until chosen. AI is a **top-level action**, not a tab.

## Our measured baseline

Captured from production before any of this work, with `scripts/ui-section-sweep.mjs` and
`scripts/capture-ui.mjs --measure`.

| Metric | Value |
|---|---|
| Landing body size | **10px, used 181 times** |
| Chrome floor token | `--ns-chrome-min-font: 9px` |
| Design tab type sizes | **8 distinct**, 8px–19px, in a 344px column |
| Inspector tabs | **7**, presented as peers |
| Chrome share at 1440px | **44%** (300px rail + 340px inspector) |
| Command palette (before) | `left: 0, top: 0`, 520px, 9px labels |
| Composer (before) | ended at y=750 with chips at 750–814 **below** it |

Reference targets: body 13–14px, caption 12px, floor 11px.

## Status of the five proposals

| # | Proposal | State |
|---|---|---|
| 1 | Speaker notes strip under the canvas | **Not built.** Located and specified — task #19. |
| 2 | Inspector down to a small fixed scale | **Built** — nodeslide #66. |
| 3 | Collapsible panels to attack the 44% | **Already shipped.** See below. |
| 4 | Regroup the seven tabs | **Not built.** Needs a shape decision — task #20. |
| 5 | Global type scale | **Partly built** — nodeslide #66. See the carve-out. |

### Collapse already exists — the sixth false "absent"

Both `Collapse slide navigator` and `Collapse inspector` ship, with correct `aria-label`s. A first
probe clicked the wrong button, saw the width unchanged, and nearly filed collapse as missing. It is
not: **44% chrome is the default, not a ceiling.** Whether that default is right is a behavioural
decision, not a styling one, and is deliberately left alone.

This is the sixth time in one session that a concept was nearly reported absent because the check was
aimed at the wrong thing. The standing rule is in project memory as
`arm-the-sensor-before-reporting-absence`.

### The scale shipped once without working

nodeslide #66 added the scale and predicted the Design tab would fall from eight sizes to four. The
production sweep afterwards said otherwise — still eight, `8px×1 9px×5 10px×4 11px×16 11.5px×2
12px×2 13px×7 15px×3`. The maximum came down from 19px and 13/15 appeared, so something landed, but
the tail survived.

Cause: the block sat at `nodeslide.css:1622` under a comment asserting it would win "on source
order". Two things beat it at equal specificity and later position — the `--ns-chrome-min-font`
clamp lists at `:1963` and `:3647`, and **all of `nodeslideV3.css`**, which `NodeSlideStudio.tsx`
imports after `nodeslide.css`. Being after the section rules is not the same as being last.

nodeslide #67 moves it to the end of the last-loaded sheet. Verified in a harness loading both
sheets in the real import order before shipping: **4 distinct sizes — 11×6, 12×2, 13×5, 15×1.**

The general lesson, and the reason the sweep is worth keeping: a CSS claim is not verified by reading
the rule you wrote. Only by measuring the rendered result.

### The type-scale carve-out

nodeslide #66 adds the token scale, raises the floor from 9px to 11px, and scopes the inspector to
four steps. It deliberately does **not** touch the 21 hardcoded `font-size: 10px` and 15 `11px`
declarations elsewhere in `nodeslide.css`. A blind find-and-replace across a stylesheet is how
layouts break silently — fixed row heights, truncation, wrapping — so those need a per-surface pass
with visual checks rather than a regex.

## Reproducing any of it

```bash
node scripts/ui-section-sweep.mjs
node scripts/capture-ui.mjs --url <url> --out shot.png --measure ".ns-command-palette"
```

## Evidence is now enforced, not remembered

The `before-after-proof` skill states the rule: capture the observable BEFORE the edit, for every
change, including pure backend ones (captured command output, a timing, a log diff, a schema dump).

A skill only runs when the model reaches for it, which makes "always capture a before" a habit — and
habits lapse exactly when a change looks too small to bother with. So it is wired to a `PreToolUse`
hook on `Edit|Write|NotebookEdit|MultiEdit`:

- `~/.claude/hooks/before-after-proof.mjs`
- registered in `~/.claude/settings.json`

It injects one reminder per session per repository, at the first edit, and then stays quiet. It does
not block. A hard deny on every edit would make trivial work miserable and would get the hook
switched off, which is worse than not having it; and a reminder that fires on every edit is noise,
which is how a real warning gets missed.

Its first version called `require()` inside an `.mjs` file, threw, and exited silently on every
edit — looking exactly like a hook that had chosen to stay quiet. It was caught by piping a fake
payload through it, not by reading it. Same lesson as the CSS above: the rule you wrote is not the
behaviour you get.

## Related documents

- `../product-surface-audit.md` — what already ships, and five wrong "absent" reports
- `../reference-comparison.md` — section-by-section verdicts against these references
- `../inspector-revamp-spec.md` — the three-size scale proposal
