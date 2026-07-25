# NodeSlide against its references

Every NodeSlide section compared to a real application doing the same job. Sources are Mobbin
captures studied at zoom on 2026-07-24: **Linear Web** (448 screens, initiative detail with its
right-hand Properties panel) and **Figma Slides** (deck editor — left thumbnail rail, canvas,
right properties panel), which is the closest structural analogue to NodeSlide that exists.

Measurements of our own surfaces come from `scripts/ui-section-sweep.mjs`.

## Figma Slides, read closely

The right panel, at zoom:

```
Design | Animate                52%
Slide 1
Template style
  ▮▮▮ Mid Mod
      Syne, IBM Plex Serif        ⌄
Background
  [▣] [▩] [🖼]
  ▮ Color                        ⌄
Selection colors
  ▪ Color 2
  ▮ Color
  ▪ Color 3
```

Three things stand out, and all three are things we do differently.

**Two tabs, not seven.** `Design` and `Animate`. That is the entire right-hand surface of a
shipping slide editor.

**Zero explanatory prose.** Not one sentence anywhere in the panel. Every line is a value with a
control on it.

**Fonts named, not stacked.** `Syne, IBM Plex Serif` — two family names. This independently
confirms the change already shipped in nodeslide #65: our cards printed the full CSS fallback chain
twice, and now print the family a person would name.

Linear's Properties panel agrees on the underlying rule: label and value render at **one size**, and
the label is distinguished by *colour*, never by being smaller.

## Gamma, the closest competitor, keeps almost no chrome

Gamma is an AI presentation maker — the same product category as NodeSlide. Its editor:

- **Top bar:** `Theme · Share · ✨Agent ⌄ · ▶ Present ⌄ · ⋯ · avatar`. Six controls, nothing else.
- **Left:** the slide thumbnails are a **floating panel with a close button**, overlaying the canvas.
  Not a permanent rail.
- **Right:** a **vertical strip of unlabelled icons** — search, text, image, layout, chart, table,
  edit. No panel is open until you choose one.
- **Canvas:** everything else.

**AI is a top-bar action, not a sidebar tab.** `✨ Agent` sits beside Share and Present. In
NodeSlide, AI is one of seven tabs inside a permanent 340px column.

### The measurement that follows from this

NodeSlide at 1440px, measured on production:

| | px | share |
|---|---|---|
| left rail | 300 | |
| inspector | 340 | |
| **chrome total** | **640** | **44%** |
| canvas | 800 | 56% |

**Forty-four per cent of the window is permanently spent on chrome**, before a user opens anything.
Gamma spends roughly an icon strip. Figma Slides keeps a fixed rail and panel, but its panel is
narrower and carries two tabs instead of seven.

This is the structural version of the same complaint about the Design tab: the cost is paid up
front, permanently, whether or not the panel is being used.

## Section by section

| Section | Reference | Verdict |
|---|---|---|
| Inspector tab count | Figma Slides: **2** tabs. Linear: one panel. | **7 tabs is the outlier.** See below. |
| Design tab | Figma: ~3 sizes, no prose | **8 sizes, 8–19px, opens with prose.** Worst offender. |
| Speaker notes | Figma: persistent strip **under the canvas** | Ours is buried in Design → Content. Wrong home. |
| Canvas tools | Figma: floating bottom toolbar (select, text, image, shape, comment, AI) | We have none; tools live in panels only. |
| Type scale | Linear/Figma body 13–14px | Ours: **10px, used 181 times** on landing. |
| Signature card fonts | Figma: `Syne, IBM Plex Serif` | Fixed in #65 — matches. |
| Command palette | Linear conventions: centred, scrim, ~13px rows | Fixed in #65 — matches, though not yet checked against a Linear command-menu capture. |
| AI composer | Chat convention: input at the bottom | Fixed in #65. |

### The seven tabs

`AI · Design · Comments · Versions · Evidence · JSON · Trace` are presented as seven peers. They are
not peers. Two of them are authoring surfaces you use while making a slide (AI, Design). Five are
review and audit surfaces you visit when checking work (Comments, Versions, Evidence, JSON, Trace).

Figma Slides gives authoring two tabs and puts review elsewhere. Presenting all seven as equals is
why the column reads as heavy before a single one is opened — the cost is paid at the tab strip,
before any content loads.

This is a structural proposal, not a fix to apply quietly. It changes navigation.

### Speaker notes are in the wrong place

Figma Slides keeps `Add presenter notes…` as a strip directly beneath the canvas, always visible
while authoring. NodeSlide puts Speaker notes inside Design → Content, which means writing what you
will *say* requires opening the panel about how the slide *looks*.

This one is cheap to fix and does not change navigation.

## What is still uncompared

Comments, Versions, Evidence, JSON and Trace have no reference yet — the natural sources are Figma
(comments), Notion or Google Docs (version history), and an observability tool such as Vercel or
Sentry (trace). The left rail, Present mode, and the export and share dialogs are also uncompared.
