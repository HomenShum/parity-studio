# Inspector revamp — measured against Linear

The owner's critique was that the Design tab is "confusing, too much to read, too technical" and that
he would not bother opening it. That is a taste judgement, and taste judgements are unarguable until
someone puts a reference next to them. This is that reference.

Source: Mobbin, Linear Web (448 screens), the initiative detail screen with its right-hand
Properties panel — the direct analogue of our inspector column. Studied at zoom on 2026-07-24.

## What Linear does that we do not

**It differentiates by colour and weight, never by shrinking text.** Its Properties panel renders
`Status`/`Active`, `Owner`/`Alex Smith`, `Target date`/`Q2 2026` at *one* size. The label is muted,
the value is full contrast. Nothing is made smaller to say "this matters less".

Our Design tab renders **eight distinct sizes between 8px and 19px** inside a 344px column
(`scripts/ui-section-sweep.mjs`). Eight sizes is not a hierarchy; it is what happens when every
addition brings its own `font-size`.

**It shows values, not sentences.** Every row in Linear's panel is a fact with a control attached.
There is no paragraph explaining what the panel is for. Our panel opens with prose, explains what
importing does, and then explains what applying does.

**It states the thing, not metadata about the thing.** Nothing in Linear's panel reads "high
confidence · 0 warnings". Our signature cards did exactly that on every row — announcing the absence
of a problem, which trains people to skip the row where a real warning would appear. Fixed in
nodeslide #65; the principle generalises to the rest of the column.

**Cards group; whitespace separates.** Properties, Progress and Activity are three bordered cards
with real padding. Our inspector is one continuous scroll of headings.

## The scale to adopt

Three sizes for the whole inspector, not eight:

| Role | Size | Colour |
|---|---|---|
| Section title | 15px | full contrast |
| Row label and row value | 13px | label muted, value full contrast |
| Caption — only where something is genuinely secondary | 11px | muted |

That deletes 8px, 9px, 10px, 10.5px, 11.5px, 18.72px and 19px from the column. The floor moves from
8px to 11px.

**Row shape:** fixed-width muted label on the left, value right of it, one row height. This is what
makes a panel scannable — the eye follows a single column of values rather than re-parsing each row.

## Why this is a proposal and not a commit

The global token `--ns-chrome-min-font: 9px` clamps a long list of chrome selectors across the whole
product, and the measured body size on the landing page is **10px used 181 times**. Linear and Cursor
run 14–15px body and treat 12px as a caption. So the product is three to four pixels under its
reference *everywhere*, not only in the inspector.

Raising that token changes every screen at once. It is the correct fix and it is not a change to make
while the owner is asleep, so it is written down here rather than shipped. Two routes:

1. **Inspector only.** Adopt the three-size scale in the inspector column; leave the global clamp.
   Contained, reversible, fixes the tab that prompted the critique.
2. **Product-wide.** Raise the floor to 11px and the body to 13px, then re-run the sweep and fix what
   reflows. Larger, and the thing that would actually close the gap with the references.

## What this document does not cover

Only Linear was studied, and only its Properties panel and screen list. The AI composer and command
palette were fixed against measured causes rather than against a Mobbin reference — the palette now
matches Linear's conventions (centred, scrim, 13px labels, quiet group tags) but that was arrived at
independently, and it has not been checked against a Linear command-menu capture. Sections not yet
compared to any reference: Comments, Versions, Evidence, JSON, Trace, the left rail, Present mode,
and the export and share dialogs.
