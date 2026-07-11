# NodeSlide startup-narrative taste-pack research

Status: research proposal for the startup/narrative half of W5
Research cut: 2026-07-10 (America/Los_Angeles)
Contract reviewed: `docs/specs/nodeslide-sector-taste-packs.md` and `docs/specs/nodeslide-signature-extractor.md`

This research uses only publicly available, first-party Duarte articles and terms, the dated DTCG 2025.10 Final Community Group Reports, and WCAG 2.2 for an accessibility preflight. It does not use challenge material, paid or gated course content, copied templates, downloadable worksheets, third-party blogs, template marketplaces, or source-deck trade dress.

> **Non-affiliation:** NodeSlide and the proposed `startup-narrative` taste pack are independent and are not affiliated with, approved by, certified by, sponsored by, or endorsed by Duarte, Inc. or the Design Tokens Community Group. Duarte names and article titles appear only as source attribution. The product-facing pack name should be **Startup narrative**, never “Duarte style,” “Duarte method,” or similar.

## Recommendation

W5's six startup behaviors are supportable as high-level narrative and slide-design principles: center the audience's transformation, keep one main idea per slide, contrast present reality with a possible future, remove non-meaningful decoration, preserve whitespace for focus, and close with a clear action.

Those sources do **not** support a Duarte palette, Duarte font stack, Duarte spacing scale, Duarte slide template, or a precise Duarte-authored layout. All literal values and measurable enforcement below are therefore original NodeSlide defaults. Source citations belong in the behavioral `rules` extension; they must not be attached as evidence that Duarte supplied any token value.

## Duarte-grounded narrative principles

The following is the proposed citation payload for W5. Whether the implementation serializes `rules` as an array or keyed record is a schema decision; each rule should retain the exact `title`, `url`, and `supports` text below. A suitable common `license` value is: `No permissive content license identified; citation and idea-level paraphrase only. Do not reproduce source prose, images, diagrams, templates, course materials, trade dress, or marks; no affiliation or endorsement.`

| Rule key | `title` | Direct `url` | Exact paraphrased `supports` text |
|---|---|---|---|
| `audience-centered-arc` | Center the audience's transformation | https://www.duarte.com/blog/presentation-storytelling-audience-is-hero/ | Frame the audience, rather than the speaker, company, or product, as the main actor; focus the message on what the audience needs and the change in what they think, feel, believe, or do. |
| `single-takeaway` | Keep one clear takeaway per slide | https://www.duarte.com/blog/presenting/ | Limit a slide to one main idea so the visual supports the spoken message instead of competing with it. |
| `current-future-contrast` | Contrast current reality with a possible future | https://www.duarte.com/blog/move-presentation-audience-with-story-techniques-in-presentations/ | Establish a shared current reality, introduce a credible possible future, and keep presentation content aligned to the audience's intended transformation. |
| `purposeful-simplicity` | Make every visual element earn its place | https://www.duarte.com/blog/presenting/ | Use design to carry meaning, not as decoration; remove superfluous details and keep the slide as simple as the message allows. |
| `whitespace-for-focus` | Preserve whitespace for focus | https://www.duarte.com/blog/techniques-for-using-critique-language-for-more-powerful-and-effective-presentations/ | Use open space to direct focus; when a slide feels cluttered, reduce or split its content so the essential message remains clear. |
| `decisive-next-action` | End with a clear next action | https://www.duarte.com/blog/audience-engagement-strategies-presentations/ | At the end, state clearly what the audience can do to move from the current state toward the possible future, using concrete tasks. |

These citations support only the principles in `supports`. They do not support the NodeSlide word limits, field names, colors, typography, geometry, validation thresholds, or layout budgets proposed below.

## NodeSlide-authored token and rule proposal

Everything in this section is **NodeSlide-authored**. None of these values is attributed to Duarte.

### Accessible color tokens

Use explicit DTCG `color` values with `colorSpace: "srgb"`, normalized components, and the W1-required canonical uppercase six-digit `hex`. Ratios were calculated on 2026-07-10 with the WCAG 2.2 sRGB relative-luminance formula. Every approved text pairing is at least 4.5:1; the implementation must still run NodeSlide's validator against the exported golden deck because transparency, imagery, and actual element stacking can change the effective background.

| Stable key | Hex and normalized sRGB components | NodeSlide-authored role | Approved foreground/background pair |
|---|---|---|---|
| `canvas` | `#FFFFFF`; `[1, 1, 1]` | Primary light canvas and inverse text | `ink` on `canvas`: **17.74:1** |
| `canvas-alt` | `#F4F7FB`; `[0.956863, 0.968627, 0.984314]` | Quiet section or card surface | `ink` on `canvas-alt`: **16.51:1** |
| `ink` | `#111827`; `[0.066667, 0.094118, 0.152941]` | Primary text and dark marks | On `canvas`: **17.74:1** |
| `muted` | `#475569`; `[0.278431, 0.333333, 0.411765]` | Secondary text; never disabled-looking body copy | On `canvas`: **7.58:1** |
| `accent` | `#0057B8`; `[0, 0.341176, 0.721569]` | Primary emphasis and action fill | `canvas` text on `accent`: **6.87:1** |
| `accent-soft` | `#DCEBFA`; `[0.862745, 0.921569, 0.980392]` | Low-emphasis callout surface | `ink` on `accent-soft`: **14.62:1** |
| `insight` | `#F7C948`; `[0.968627, 0.788235, 0.282353]` | Highlight surface; not a text color on white | `insight-ink` on `insight`: **10.68:1** |
| `insight-ink` | `#2A1B00`; `[0.164706, 0.105882, 0]` | Text and marks on `insight` | On `insight`: **10.68:1** |
| `current` | `#5B4B8A`; `[0.356863, 0.294118, 0.541176]` | Current-state marker without assuming “current” means failure | `canvas` text on `current`: **7.45:1** |
| `future` | `#0F766E`; `[0.058824, 0.462745, 0.431373]` | Possible-future or progress marker | `canvas` text on `future`: **5.47:1** |
| `border` | `#64748B`; `[0.392157, 0.454902, 0.545098]` | Essential dividers and object boundaries | Against `canvas`: **4.76:1** |
| `inverse-canvas` | `#0B1020`; `[0.043137, 0.062745, 0.12549]` | Optional dark cover or closing canvas | `inverse-ink` on `inverse-canvas`: **18.93:1** |
| `inverse-ink` | `#FFFFFF`; `[1, 1, 1]` | Text on approved dark fills | On `inverse-canvas`: **18.93:1** |

Pairing rules:

- Use only the approved pairs above for generated text by default. In particular, do not put white text on `insight` or dark `ink` text on `current`/`future`.
- Never communicate current/future, risk/opportunity, or selected/unselected state by hue alone. Add literal labels, position, and a shape or connector distinction.
- `border` is dark enough for an essential object boundary on `canvas`; lighter decorative separators may be used only when they carry no information.
- Treat the ratios as preflight calculations, not a claim that a deck is fully WCAG-conformant or accessible in every presentation environment.

### Font-family and font-size tokens

Use DTCG `fontFamily` arrays so adapters can select the first locally available family. Do not download, bundle, or embed a font on the pack's behalf, and do not imply that any family is present on every system.

| Stable key | DTCG `$value` | Use |
|---|---|---|
| `display` | `["Aptos Display", "Aptos", "Segoe UI", "Arial", "sans-serif"]` | Covers, slide titles, large takeaway statements |
| `body` | `["Aptos", "Segoe UI", "Arial", "sans-serif"]` | Body, labels, annotations |
| `data` | `["Aptos Mono", "Cascadia Mono", "Consolas", "Courier New", "monospace"]` | Optional aligned figures or compact technical labels |

The renderer should record the resolved family, fall back without a network call, and warn when it reaches a generic family. No font file or font license is included with this proposal.

Use DTCG `dimension` values in `px`, matching W1's `px = pt * 4 / 3` contract:

| Stable key | DTCG `$value` | Presentation equivalent | Intended role |
|---|---:|---:|---|
| `hero` | `{ "value": 64, "unit": "px" }` | 48 pt | Cover claim or singular closing statement |
| `title` | `{ "value": 48, "unit": "px" }` | 36 pt | Slide title |
| `takeaway` | `{ "value": 36, "unit": "px" }` | 27 pt | Dominant evidence-backed takeaway |
| `body` | `{ "value": 24, "unit": "px" }` | 18 pt | Main explanatory text |
| `label` | `{ "value": 20, "unit": "px" }` | 15 pt | Smallest non-footer text |
| `footer` | `{ "value": 16, "unit": "px" }` | 12 pt | Source, footer, or page-number roles only |

As of this research cut, NodeSlide warns on non-footer text below 12 pt and applies 4.5:1 or 3:1 contrast thresholds according to rendered size/weight. The authored 15 pt non-footer floor and approved 4.5:1-or-better pairs provide a safety margin; they are not substitutes for the W5 golden-deck gate.

### Authored narrative and layout rules

These mechanics operationalize the cited principles but are not claims about Duarte's exact method.

| Authored rule | Proposed deterministic behavior |
|---|---|
| Brief contract | Require `audience`, `currentState`, `desiredState`, `stakes`, and `ask` inputs or emit a bounded `narrative_incomplete` warning. Never invent an audience commitment, owner, date, metric, or consequence. |
| Takeaway contract | Give every substantive slide one evidence-backed takeaway of at most 12 words. The title may carry the takeaway. Every body element must support it; split the slide when two independent claims remain. The 12-word limit is a NodeSlide choice. |
| Narrative progression | Allow a deck to move from current context through evidence and transition to a credible possible future and action. Do not impose a copied pitch-deck sequence or reproduce a proprietary story diagram. |
| Current/future encoding | Use explicit “Current” and “Possible” labels (or brief-specific equivalents), plus position/shape differences. `current` and `future` colors are optional redundant cues, never the only distinction. |
| Visual budget | Default to one focal visual and at most two supporting content groups. Cap non-background, non-footer elements at 12; split rather than shrink when the cap is exceeded. |
| Whitespace target | On non-full-bleed slides, keep at least 30% of the slide outside the union of foreground bounding boxes. Exclude the background, footer, page number, and decorative non-informational lines from the measure. The 30% threshold is authored and should be tuned only with checked-in proof. |
| Safe area | For a 13.333 x 7.5 inch, 16:9 slide, reserve 0.67 inch left/right and 0.50 inch top/bottom by default. Full-bleed media may cross the safe area; readable text may not. |
| Density | Mark the layout tendency as intended `sparse`, with the values above explicitly sourced as `authored`, never `observed` or `inferred`. |
| Next action | Put the ask on the final substantive slide as `verb + object`; add owner and timing only when supplied by the brief. A contact/resources appendix may follow without displacing the ask. |
| Simplicity repair | Remove decoration first, then shorten or split content, then increase whitespace. Do not solve overflow by reducing non-footer type below 15 pt. |

### `SignatureProfile` mapping

- Use `source.kind: "taste_pack"`, authored evidence with `method: "authored"`, and a content-derived digest. The stable pack slug/filename is `startup-narrative`; the W1 `id` remains content-derived.
- Every literal color, font-family, font-size, and authored layout value may carry confidence `1` because the pack itself chose that value. This confidence means “faithfully records the authored default,” not “Duarte specifies it” or “it is objectively optimal.”
- Token evidence should use `sourceRole: "authored"`, `occurrences: 0`, a token-path locator, and the literal value in `observedValue`. Duarte URLs belong only in the `rules` citation extension, not in token evidence.
- Do not manufacture observed usage frequencies. Prefer empty observed `usage` arrays; if W2 needs authored priority, encode it as clearly authored W5 metadata rather than as occurrences.
- Deck-fact layout fields such as slide/master/layout counts and embedded-font observations should remain neutral/empty for a taste pack. Do not imply that authored targets were measured from a deck.
- Use explicit `$type`, `$value`, `$description`, and `$extensions["com.nodeslide.signature"]` on each token. DTCG permits vendor extensions, but extension data should remain optional metadata rather than redefining the token value.
- Preserve deterministic order as listed here: colors, then `display`/`body`/`data`, then sizes from `hero` through `footer`, then behavioral rules in W5 order. Recompute the digest/ID after final serialization; include no generation timestamp in the pack.

There is one contract-integration issue for final synthesis: the frozen W1 `SignatureProfile` excerpt does not expose a pack-level `rules`/`$extensions` field, while W5 requires a `rules` extension. Resolve that in the W5 implementation's already-authorized extension location or parser policy without changing W1/W2 contracts and without duplicating narrative citations onto unrelated tokens.

## Source ledger

All URLs below were reachable when checked on 2026-07-10.

### Duarte narrative and IP sources

| ID | First-party source and visible date | Exact paraphrased rule supported | Licensing/IP boundary |
|---|---|---|---|
| D1 | [Presentation storytelling 101: Your audience is the hero](https://www.duarte.com/blog/presentation-storytelling-audience-is-hero/) — July 15, 2024 | Treat the audience rather than the presenter/company/product as the main actor; focus on audience needs and an intended change in thought, feeling, belief, or action. | Public copyrighted article. Paraphrase the idea and cite the URL; do not reuse its prose, examples, images, journey graphic, downloadable map, or branded terminology as product assets. |
| D2 | [How to move presentation audiences with structure and story](https://www.duarte.com/blog/move-presentation-audience-with-story-techniques-in-presentations/) — September 19, 2024; Nancy Duarte | Define the audience's before/after transformation, retain content that supports it, establish shared present reality, introduce a possible future, and end on the world after adoption. | Supports a generic contrast principle only. Do not copy the displayed diagram, its shape, or proprietary/branded method names. |
| D3 | [Presenting like a pro: Guide to effective presentation skills](https://www.duarte.com/blog/presenting/) — December 8, 2023 | Keep one main idea per slide; make every element serve the message; remove decoration and excess detail; design with the audience and accessibility in mind. | Supports message alignment and simplicity, not an action-title syntax, palette, font, spacing value, or template. No source prose, screenshots, or layouts are reused. |
| D4 | [Techniques for using critique language for more powerful and effective presentations](https://www.duarte.com/blog/techniques-for-using-critique-language-for-more-powerful-and-effective-presentations/) — January 18, 2021 | Whitespace helps direct focus; pare down clutter, and use hierarchy so the most important takeaway is apparent. | Supports a qualitative whitespace rule only. The 30% target is NodeSlide-authored. Do not use the source's branded test, worksheet, images, or exact critique framework. |
| D5 | [11 audience engagement strategies for all presentations](https://www.duarte.com/blog/audience-engagement-strategies-presentations/) — August 22, 2024 | A closing call to action should clearly state what the audience can do, using concrete tasks that move the present toward the possible future. | Supports a clear-action principle only. The `verb + object + optional owner/timing` schema is NodeSlide-authored; do not copy source diagrams or branded frameworks. |
| D6 | [Terms of Use and Privacy Policy](https://www.duarte.com/privacy-and-usage-policy/) — no revision date visible; page footer says ©2008-2025; accessed 2026-07-10 | Duarte states that site content is protected, reserves ungranted rights, and lists company marks that require permission. | Treat all article expression, images, displays, designs, and marks as protected. This ledger is not legal clearance; it deliberately uses short factual paraphrases and links only. |
| D7 | [Duarte Terms & Conditions of Use](https://www.duarte.com/duarte-terms-and-conditions-of-use/) — effective August 13, 2025 | Training materials, templates, presentation slides, handouts, exercises, and LMS content are identified as Duarte content with restricted reuse. | No workshop, LMS, paid course, template, handout, exercise, or copied instructional content was accessed or used for this proposal. |

### Token-format and accessibility sources

| ID | Authoritative source and visible date | Exact paraphrased rule supported | Licensing/status boundary |
|---|---|---|---|
| T1 | [Design Tokens Format Module 2025.10](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/) — Final Community Group Report, 28 October 2025 | A token is identified by `$value`; it must have a compatible explicit or inherited `$type`; `$description` and vendor-keyed `$extensions` are available; `fontFamily` may be a string or non-empty array; dimensions use a number and `px`/`rem`. | Published under the W3C Community Final Specification Agreement. The report says it is stable and intended for implementation, but it is **not** a W3C Standard or Recommendation. Use the data model without implying W3C/DTCG endorsement. |
| T2 | [Design Tokens Color Module 2025.10](https://www.w3.org/community/reports/design-tokens/CG-FINAL-color-20251028/) — Final Community Group Report, 28 October 2025 | A color token uses `$type: "color"`; its value contains `colorSpace` and components, may contain alpha and a six-digit hex fallback, and sRGB components are numbers from 0 through 1. | Published under the W3C Community Final Specification Agreement and likewise not a W3C Standard. The uppercase hex convention is NodeSlide's W1 canonicalization, not a DTCG palette rule. |
| A1 | [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/) — W3C Recommendation, 12 December 2024 | Normal text targets at least 4.5:1, large text at least 3:1, and color is not the sole means of conveying information; the report defines the sRGB relative-luminance calculation used here. | WCAG is used as a conservative contrast and color-redundancy engineering target. A passing palette or deck does not by itself establish full WCAG conformance for a live or exported presentation. |

## Unsupported claims to avoid

- Duarte specifies, approves, or uses any exact hex value, font family, font size, spacing unit, margin, occupancy percentage, element cap, or CTA field in this proposal.
- The pack is “Duarte style,” built with the “Duarte Method,” certified by Duarte, or endorsed by Duarte.
- A one-idea principle means Duarte requires NodeSlide's 12-word takeaway, action-title syntax, or title placement.
- Present-versus-possible contrast requires reproducing a source diagram, curve, slide sequence, visual layout, or branded framework.
- Duarte's qualitative whitespace advice establishes NodeSlide's 30% free-space target.
- Public article access licenses source prose, images, diagrams, downloadable tools, templates, or course materials for product reuse.
- Any proposed font is universally installed, freely redistributable, or safe to embed. The pack supplies fallback names only and no font files.
- DTCG 2025.10 is a W3C Standard/Recommendation, defines an accessible palette, or validates narrative quality.
- Meeting the listed contrast ratios proves that the whole deck, export, live delivery, or audience experience is WCAG-conformant.
- The taste pack guarantees persuasion, fundraising success, startup quality, or audience transformation.

## Implementation handoff and proof still required

1. Place the six cited rules in the W5-authorized extension location and verify every serialized entry has non-empty `title`, direct `url`, and `supports` values.
2. Encode the literal tokens as DTCG 2025.10-compatible W1 token objects with authored evidence and deterministic ordering; do not promote citations into token provenance.
3. Resolve the authored-layout-versus-observed-layout fields without fabricating deck counts or usage frequencies.
4. Apply the pack to the golden deck and require zero NodeSlide `contrast` and `font_size` issues. Recheck effective backgrounds after export and verify that a local font resolves without download or embedding.
5. Replay stable serialization and verify identical digest/ID and byte ordering.
6. Include the non-affiliation statement in the proof receipt and keep the product-facing label `Startup narrative`.
