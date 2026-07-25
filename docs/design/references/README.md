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

## Related documents

- `../product-surface-audit.md` — what already ships, and five wrong "absent" reports
- `../reference-comparison.md` — section-by-section verdicts against these references
- `../inspector-revamp-spec.md` — the three-size scale proposal
