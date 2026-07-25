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

## Reproducing any of it

```bash
node scripts/ui-section-sweep.mjs
node scripts/capture-ui.mjs --url <url> --out shot.png --measure ".ns-command-palette"
```

## Related documents

- `../product-surface-audit.md` — what already ships, and five wrong "absent" reports
- `../reference-comparison.md` — section-by-section verdicts against these references
- `../inspector-revamp-spec.md` — the three-size scale proposal
