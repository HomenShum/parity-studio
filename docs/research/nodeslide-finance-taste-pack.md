# NodeSlide finance taste pack — W5 research

Status: research proposal for the finance half of W5
Research cutoff: 2026-07-10
Frozen target ID: `finance-ibcs`
Scope: sourced behavioral principles, licensing boundaries, and an independently authored token/rule proposal. No pack implementation is included here.

## Research conclusion

The finance direction in `docs/specs/nodeslide-sector-taste-packs.md` is supportable from the allowed maintainer sources, with two qualifications:

1. IBCS Association now identifies Version 1.2 as outdated. The current source is IBCS Standards Version 2.0, approved and released on 2026-06-11; the public PDF is dated 2026-07-02.
2. IBCS 2.0 distinguishes an explanatory key message from a descriptive title. W5's “message-led titles” should therefore be implemented as a message-first header plus subordinate reporting context, not as a claim that IBCS recommends putting conclusions inside descriptive titles.

The Financial Times Visual Vocabulary supports selecting a chart by the analytical relationship in the data. It does not supply a reusable visual identity. Its text and poster content remain FT copyright even though software in the repository is MIT-licensed.

## Non-affiliation, certification, and trademark note

This research and the proposed NodeSlide pack are independently authored. NodeSlide is not affiliated with, endorsed by, certified by, or approved by the IBCS Association, IBCS Institute, the Financial Times, the Design Tokens Community Group, W3C, or ISO. The pack must not be presented as IBCS-certified software, as an FT style, or as conforming to ISO 24896. `finance-ibcs` is the frozen internal W5 identifier; the proposed user-facing name is **Finance reporting**.

IBCS® is a registered trademark of IBCS Institute. No IBCS or FT logo, template, poster, brand asset, or trade dress is used or proposed.

## Source ledger

All sources below are official publisher, association, or maintainer sources. Retrieval/check date is 2026-07-10 unless a publication date is stated. Secondary links embedded in a source were not used as evidence.

### 1. IBCS Standards Version 2.0

- Direct URLs:
  - [IBCS Version 2.0 release page](https://www.ibcs.com/ibcs-version-2-0/)
  - [IBCS Standards Version 2.0 PDF](https://www.ibcs.com/wp-content/uploads/2026/07/IBCS_v2_final_2026-07-02_jf-with-ad.pdf)
  - [IBCS official concept and Top Ten summary](https://www.ibcs.com/IBCS/)
- Version/date: Version 2.0. The Association release page says it was approved and released on 2026-06-11. The PDF identifies IBCS Media as publisher, gives 2026 as publication year, is dated 2026-07-02, and carries ISBN 978-3-9821414-4-2. The summary page shows no publication date.
- License/usage: the standards PDF states CC BY-SA 4.0 and attributes copyright to IBCS Association. Use short attributed paraphrases and links; do not reproduce figures or expressive layouts. If adapted standards material is distributed, the CC BY-SA obligations need a separate licensing review.
- Exact paraphrased rules supported:
  - `SA 3.2`, `UN 2.1`, and `UN 2.2`: state the key message early and keep its placement consistent, commonly at the top; keep descriptive reporting context separate and identify the reporting unit, measure, and period.
  - Introduction and `UNIFY`: one business meaning should retain one visual treatment across the reporting system.
  - `SI 1–3`: remove decoration that has no analytical role; use color and emphasis for meaning; prefer neutral, broadly available, legible type; integrated labels can reduce reliance on legends, axes, ticks, and gridlines when reference cues remain adequate.
  - `CO 1–2`: seek density by making components compact while preserving legibility; reduce wasted space, but retain whitespace that improves grouping and focus.
  - `CH 1.1` and `CH 4.1`: value axes normally begin at zero; indexed-data exceptions require a clear reference; charts with the same unit on one page should share a scale or visibly disclose the difference.
  - `UN 3.3`: put time on a horizontal axis and order it left to right.
  - `UN 3.4`: put non-time structural categories on a vertical category axis in the general case, while retaining documented exceptions for other scale types.
  - `UN 2.3`: integrate series identification into the chart where practical and place line-series labels at or near their lines.
  - `UN 5.1` and `SA 4.3`: highlights and markers should point to the key message or a defined analytical meaning and should be used consistently.
- Unsupported claims to avoid:
  - Do not call NodeSlide, the pack, or an output “IBCS certified,” “IBCS compliant,” approved, or endorsed.
  - Do not infer any NodeSlide hex value, font family, font size, spacing value, or page geometry from IBCS figures.
  - Do not say every axis must start at zero; IBCS 2.0 states a general rule and describes an indexed-data exception.
  - Do not say labels always replace axes or gridlines; the source preserves cases where reference lines are useful.
  - Do not equate density with filling all whitespace; the source expressly retains useful whitespace.
  - Do not apply message-first mechanically to sensitive or culturally unsuitable presentation contexts; `SA 3.2` contains that caution.
  - Do not claim direct review of ISO 24896 or ISO conformance. This research relies only on the IBCS Association's statement that IBCS 2.0 aligns with it.

### 2. IBCS terms of use and trademark guidance

- Direct URL: [IBCS terms of use](https://www.ibcs.com/terms-of-use/)
- Version/date: no publication or revision date is visible; checked 2026-07-10.
- License/usage: the page says the IBCS Standards are under CC BY-SA 4.0, while other website material is restricted to personal use unless separately permitted. It also reserves IBCS trademarks and logos and requires permission for logo use.
- Exact paraphrased rule supported: attribute the standards and license correctly, distinguish the Association from the Institute, do not use logos, and avoid language that implies certification or authorization.
- Unsupported claims to avoid: the CC license for the standards must not be generalized to all IBCS website content, trademarks, training material, examples, or logos.

### 3. Financial Times `chart-doctor` / Visual Vocabulary repository

- Direct URLs:
  - [Maintainer repository](https://github.com/Financial-Times/chart-doctor)
  - [Visual Vocabulary README on `main`](https://github.com/Financial-Times/chart-doctor/blob/main/visual-vocabulary/README.md)
  - [README commit pin `f54ecfd`](https://github.com/Financial-Times/chart-doctor/commit/f54ecfd57b9450aad86bdbcbd19a26b0405375ce)
  - [Repository licensing boundary](https://github.com/Financial-Times/chart-doctor/blob/main/README.md#licence)
  - [MIT software license](https://github.com/Financial-Times/chart-doctor/blob/main/LICENSE)
- Version/date: the Visual Vocabulary has no release number or publication date in the README. Its latest README commit is `f54ecfd57b9450aad86bdbcbd19a26b0405375ce`, authored and committed on 2018-10-05. The commit pin is the evidence snapshot used here.
- License/usage: the root repository applies MIT to software only. The root and Visual Vocabulary READMEs exclude FT content from that grant and state that FT content is all-rights-reserved. Use only short paraphrases of maintained chart-selection guidance with links. Do not copy the poster, sample output, D3 templates, imagery, wording, palette, typography, or layout.
- Exact paraphrased rules supported:
  - The vocabulary is a chart-selection aid organized around the relationship or question in the data, not a complete chart-construction standard.
  - “Change over Time”: a line is the default for a changing time series; columns can work, usually with one series; the chosen period should provide adequate context.
  - “Magnitude”: bars or columns support size comparison and begin at zero; bars are useful for non-time categories and long category labels.
  - “Ranking”: ordered bars expose rank more clearly, and selected points of interest may be emphasized.
  - “Deviation”: a diverging bar supports values on both sides of a meaningful reference such as zero, a target, or an average.
  - “Part-to-whole”: stacked forms become difficult with many components, and pies make precise segment comparison difficult.
- Unsupported claims to avoid:
  - Do not call the result “FT style,” FT-branded, FT-approved, or an FT template.
  - Do not infer or reproduce FT colors, fonts, spacing, annotations, or trade dress.
  - Do not treat the MIT license as permission to republish Visual Vocabulary content.
  - Do not turn “line is the default” into an absolute rule; the repository offers multiple time-series forms for different questions.
  - Do not cite the README's outbound third-party readings as evidence; none were consulted for this research.

### 4. Design Tokens Community Group 2025.10 reports

- Direct URLs:
  - [Design Tokens Format Module 2025.10](https://www.designtokens.org/TR/2025.10/format/)
  - [Design Tokens Color Module 2025.10](https://www.designtokens.org/TR/2025.10/color/)
- Version/date: both are Final Community Group Reports dated 2025-10-28. The reports describe 2025.10 as stable; they also state that they are not W3C Standards and are not on the W3C Standards Track.
- License/usage: published by the Design Tokens Community Group under the W3C Community Final Specification Agreement. The format may be implemented; retain the reports' status accurately.
- Exact paraphrased rules supported:
  - A token is identified by `$value`; a usable type must be explicit, inherited, or resolved from a reference rather than guessed from the value.
  - `$description` is optional plain-text documentation.
  - `$extensions` may carry namespaced tool metadata; processors must preserve unknown extension data, and extensions should not carry information essential to interpreting the token value.
  - `fontFamily` accepts one family name or an ordered array of names.
  - `dimension` uses a numeric value with `px` or `rem`.
  - `color` uses a color-space identifier and component array; alpha and a six-digit hex fallback are optional. For sRGB, the three components are in the inclusive range 0–1.
- Unsupported claims to avoid:
  - DTCG does not prescribe this pack's palette, fonts, semantic roles, accessibility thresholds, slide layout, or chart behavior.
  - 2025.10 must not be called a W3C Standard or W3C Recommendation.
  - A NodeSlide profile-level `rules` convention is a NodeSlide extension, not a DTCG-defined feature.
  - Uppercase canonical hex is required by the frozen NodeSlide signature contract, not by DTCG.

## Sourced principles proposed for the `rules` extension

Each entry below is suitable for a W5 citation record. The `supports` text is deliberately narrow. Multiple records may attach to one NodeSlide behavior when the sources support different parts of it.

### `finance.message-first`

- Proposed behavior: lead each analytical slide with one clear takeaway; place a separate context line beneath or beside it for reporting unit, measure, period, and scenario as needed.
- Citation record:
  - `title`: `IBCS Standards 2.0 — SA 3.2 and UN 2.1–2.2`
  - `url`: `https://www.ibcs.com/wp-content/uploads/2026/07/IBCS_v2_final_2026-07-02_jf-with-ad.pdf`
  - `supports`: `Supports presenting a clear key message before its evidence, keeping message placement consistent, and keeping descriptive reporting context distinct from evaluation.`
  - `license`: `CC BY-SA 4.0; paraphrased with attribution`
- Boundary: the source does not support placing conclusions inside the descriptive title metadata, and it cautions against mechanical message-first treatment in some sensitive contexts.

### `finance.semantic-consistency`

- Proposed behavior: map each business meaning to a stable visual role across slides; do not reuse one color, marker, or line treatment for unrelated meanings.
- Citation record:
  - `title`: `IBCS Standards 2.0 — UNIFY`
  - `url`: `https://www.ibcs.com/wp-content/uploads/2026/07/IBCS_v2_final_2026-07-02_jf-with-ad.pdf`
  - `supports`: `Supports using the same visual representation for the same business meaning throughout a reporting system.`
  - `license`: `CC BY-SA 4.0; paraphrased with attribution`

### `finance.no-decoration`

- Proposed behavior: use an unfilled neutral canvas, flat two-dimensional marks, a neutral sans-serif stack, and color only for a named analytical role.
- Citation record:
  - `title`: `IBCS Standards 2.0 — SI 1–3`
  - `url`: `https://www.ibcs.com/wp-content/uploads/2026/07/IBCS_v2_final_2026-07-02_jf-with-ad.pdf`
  - `supports`: `Supports removing non-semantic backgrounds, effects, colors, and decorative type so that data and labels carry the communication.`
  - `license`: `CC BY-SA 4.0; paraphrased with attribution`
- Boundary: the exact canvas, font stack, weights, and colors below are NodeSlide choices.

### `finance.dense-but-legible`

- Proposed behavior: reduce unused margins and oversized components, but never compress labels below the NodeSlide font-size floor or remove whitespace that provides grouping and focus.
- Citation record:
  - `title`: `IBCS Standards 2.0 — CO 1–2`
  - `url`: `https://www.ibcs.com/wp-content/uploads/2026/07/IBCS_v2_final_2026-07-02_jf-with-ad.pdf`
  - `supports`: `Supports compact, legible visuals and better use of space while retaining whitespace that improves clarity and structure.`
  - `license`: `CC BY-SA 4.0; paraphrased with attribution`

### `finance.direct-labels`

- Proposed behavior: label series next to their marks or line ends when feasible; keep legends only when direct labels would collide or obscure data; remove axes and gridlines only when labels and reference cues remain sufficient.
- Citation record:
  - `title`: `IBCS Standards 2.0 — UN 2.3 and SI 3.1`
  - `url`: `https://www.ibcs.com/wp-content/uploads/2026/07/IBCS_v2_final_2026-07-02_jf-with-ad.pdf`
  - `supports`: `Supports integrating series identification into charts and using data labels to reduce external legends and redundant reference furniture when comprehension is preserved.`
  - `license`: `CC BY-SA 4.0; paraphrased with attribution`

### `finance.integrity-axes-scales`

- Proposed behavior: start magnitude bars and columns at zero; do not silently crop axes; use the same scale for same-unit comparisons on a slide; when an allowed exception is necessary, expose its reference and scale difference.
- Citation records:
  - `title`: `IBCS Standards 2.0 — CH 1.1 and CH 4.1`
  - `url`: `https://www.ibcs.com/wp-content/uploads/2026/07/IBCS_v2_final_2026-07-02_jf-with-ad.pdf`
  - `supports`: `Supports a general zero-baseline rule, a disclosed indexed-data exception, and identical scales for same-unit charts on one page unless a scale difference is clearly marked.`
  - `license`: `CC BY-SA 4.0; paraphrased with attribution`
  - `title`: `Financial Times Visual Vocabulary — Magnitude`
  - `url`: `https://github.com/Financial-Times/chart-doctor/blob/f54ecfd57b9450aad86bdbcbd19a26b0405375ce/visual-vocabulary/README.md#magnitude`
  - `supports`: `Supports zero-based standard bars and columns when the analytical task is comparing magnitude.`
  - `license`: `FT content; all rights reserved; short paraphrase and link only`

### `finance.time-horizontal`

- Proposed behavior: place time on the horizontal axis in left-to-right order; default to a line for continuous change and consider columns for a single discrete series.
- Citation records:
  - `title`: `IBCS Standards 2.0 — UN 3.3`
  - `url`: `https://www.ibcs.com/wp-content/uploads/2026/07/IBCS_v2_final_2026-07-02_jf-with-ad.pdf`
  - `supports`: `Supports horizontal left-to-right presentation of time in charts and tabular columns.`
  - `license`: `CC BY-SA 4.0; paraphrased with attribution`
  - `title`: `Financial Times Visual Vocabulary — Change over Time`
  - `url`: `https://github.com/Financial-Times/chart-doctor/blob/f54ecfd57b9450aad86bdbcbd19a26b0405375ce/visual-vocabulary/README.md#change-over-time`
  - `supports`: `Supports line charts as the default for changing time series, with columns useful mainly for a single series and with period context chosen deliberately.`
  - `license`: `FT content; all rights reserved; short paraphrase and link only`

### `finance.structure-vertical`

- Proposed behavior: put non-time categories on a vertical category axis and use horizontal bars, especially when category labels are long.
- Citation records:
  - `title`: `IBCS Standards 2.0 — UN 3.4`
  - `url`: `https://www.ibcs.com/wp-content/uploads/2026/07/IBCS_v2_final_2026-07-02_jf-with-ad.pdf`
  - `supports`: `Supports vertical category axes for structural dimensions in the general case, with explicit exceptions for other scale types.`
  - `license`: `CC BY-SA 4.0; paraphrased with attribution`
  - `title`: `Financial Times Visual Vocabulary — Magnitude`
  - `url`: `https://github.com/Financial-Times/chart-doctor/blob/f54ecfd57b9450aad86bdbcbd19a26b0405375ce/visual-vocabulary/README.md#magnitude`
  - `supports`: `Supports horizontal bars for non-time magnitude comparisons and long category labels.`
  - `license`: `FT content; all rights reserved; short paraphrase and link only`

### `finance.highlight-with-purpose`

- Proposed behavior: emphasize the data that proves the key message, reserve semantic positive/negative/reference treatments for those meanings, and keep all other series neutral.
- Citation record:
  - `title`: `IBCS Standards 2.0 — UN 5.1 and SA 4.3`
  - `url`: `https://www.ibcs.com/wp-content/uploads/2026/07/IBCS_v2_final_2026-07-02_jf-with-ad.pdf`
  - `supports`: `Supports consistent markers that connect selected values, differences, trends, or references to the key message and defined business meaning.`
  - `license`: `CC BY-SA 4.0; paraphrased with attribution`
- Boundary: the one-focal-accent default and the exact semantic colors below are NodeSlide-authored restraint and accessibility choices.

### `finance.chart-by-question`

- Proposed behavior: choose chart family from the analytical relationship before applying visual tokens: time, magnitude, rank, deviation, part-to-whole, distribution, correlation, spatial, or flow.
- Citation record:
  - `title`: `Financial Times Visual Vocabulary`
  - `url`: `https://github.com/Financial-Times/chart-doctor/blob/f54ecfd57b9450aad86bdbcbd19a26b0405375ce/visual-vocabulary/README.md`
  - `supports`: `Supports selecting chart symbology according to the relationship or question in the data rather than applying one chart type universally.`
  - `license`: `FT content; all rights reserved; short paraphrase and link only`

## NodeSlide-authored proposal — not source-derived values

Everything in this section is an original NodeSlide default chosen for W5. No precise value is attributed to IBCS, FT, or DTCG. DTCG supports the interchange syntax only. Literal authored values should carry confidence `1`, method `authored`, source role `authored`, and stable evidence IDs; source principles should remain citation metadata rather than token evidence.

### Color tokens

All colors use `$type: "color"`; the shown object is the proposed `$value`. Components are rounded to six decimals and `hex` is the NodeSlide-required uppercase convenience value.

| Token | Proposed DTCG `$value` | Authored role | Contrast against `canvas` |
|---|---|---|---:|
| `canvas` | `{ "colorSpace": "srgb", "components": [1, 1, 1], "hex": "#FFFFFF" }` | Default slide and chart background | — |
| `ink` | `{ "colorSpace": "srgb", "components": [0.090196, 0.101961, 0.121569], "hex": "#171A1F" }` | Primary text and axes | 17.44:1 |
| `muted` | `{ "colorSpace": "srgb", "components": [0.294118, 0.333333, 0.388235], "hex": "#4B5563" }` | Context, source notes, secondary labels | 7.56:1 |
| `accent` | `{ "colorSpace": "srgb", "components": [0, 0.368627, 0.658824], "hex": "#005EA8" }` | One focal series, selected value, or neutral reference | 6.63:1 |
| `accent-soft` | `{ "colorSpace": "srgb", "components": [0.862745, 0.921569, 0.980392], "hex": "#DCEBFA" }` | Small callout area only; never a full decorative background | `ink`: 14.37:1 |
| `border` | `{ "colorSpace": "srgb", "components": [0.541176, 0.580392, 0.639216], "hex": "#8A94A3" }` | Essential dividers and focus boundaries | 3.07:1 non-text |
| `data-neutral` | `{ "colorSpace": "srgb", "components": [0.2, 0.254902, 0.333333], "hex": "#334155" }` | Default comparison series | 10.35:1 |
| `data-positive` | `{ "colorSpace": "srgb", "components": [0, 0.419608, 0.368627], "hex": "#006B5E" }` | Desirable business impact only | 6.43:1 |
| `data-negative` | `{ "colorSpace": "srgb", "components": [0.643137, 0.14902, 0.172549], "hex": "#A4262C" }` | Undesirable business impact only | 7.26:1 |
| `data-comparison` | `{ "colorSpace": "srgb", "components": [0.396078, 0.254902, 0.541176], "hex": "#65418A" }` | Secondary named comparison when neutral plus accent is insufficient | 7.85:1 |
| `data-caution` | `{ "colorSpace": "srgb", "components": [0.478431, 0.309804, 0], "hex": "#7A4F00" }` | Explicit caution state, not decoration | 7.13:1 |

Proposed resolved `data` order: `data-neutral`, `accent`, `data-positive`, `data-negative`, `data-comparison`, `data-caution`. Default charts should use `data-neutral` plus at most one non-semantic `accent`; the remaining colors are opt-in semantic roles, not a categorical rainbow.

Additional authored contrast checks against `accent-soft`: `muted` 6.23:1 and `accent` 5.47:1. White on `accent` is 6.63:1. Every proposed text-bearing color on `canvas` exceeds the current NodeSlide 4.5:1 normal-text threshold; the border also exceeds 3:1 against the canvas. These calculations use the current NodeSlide sRGB contrast function and are validation targets, not a certification claim.

### Typography tokens

Use the same ordered fallback stack for display, body, and data roles to maximize semantic consistency and avoid any download or embedding assumption:

| Token | DTCG type | NodeSlide-authored value |
|---|---|---|
| `display` | `fontFamily` | `["Arial", "Helvetica Neue", "Helvetica", "Liberation Sans", "sans-serif"]` |
| `body` | `fontFamily` | `["Arial", "Helvetica Neue", "Helvetica", "Liberation Sans", "sans-serif"]` |
| `data` | `fontFamily` | `["Arial", "Helvetica Neue", "Helvetica", "Liberation Sans", "sans-serif"]` |
| `title` | `dimension` | `{ "value": 48, "unit": "px" }` (36 pt in the frozen NodeSlide conversion) |
| `context` | `dimension` | `{ "value": 28, "unit": "px" }` (21 pt) |
| `body` | `dimension` | `{ "value": 24, "unit": "px" }` (18 pt) |
| `data-label` | `dimension` | `{ "value": 20, "unit": "px" }` (15 pt) |
| `caption` | `dimension` | `{ "value": 20, "unit": "px" }` (15 pt) |

Authored usage rules:

- Use regular weight for body and labels; reserve bold for the message line, totals, and explicitly named emphasis.
- Prefer tabular numerals when the renderer supports them; do not substitute a downloaded data font.
- Do not reduce non-footer text below 15 pt in this pack, leaving three points of margin above the current 12 pt NodeSlide validation floor.
- Treat the fallback array as an ordered runtime choice, not as a guarantee that any named face is installed.

### Layout tendencies and behavioral guardrails

- `source.kind`: `taste_pack`.
- Internal ID: `finance-ibcs`, as frozen by W5. User-facing name: `Finance reporting`.
- Slide geometry: NodeSlide-authored 16:9 default, 13.333333 × 7.5 inches.
- Density: `dense`, explicitly authored rather than observed.
- Header: one message line followed by compact descriptive context; never merge the two silently.
- Main area: one primary analytical view, or two to four same-unit small multiples when shared scaling is possible.
- Labels: direct by default; legends are a fallback for collision or ambiguity.
- Highlighting: at most one non-semantic focal accent per chart. Positive, negative, and caution colors may coexist only when those meanings are explicitly present.
- Accessibility safeguard: never encode meaning by hue alone. Add a direct label, sign, marker shape, line pattern, or textual status.
- Axes: magnitude bars and columns start at zero. Any exceptional crop or indexed view must show its reference and produce a review warning.
- Scales: same-unit charts on one slide share a scale unless a visible scale marker and review warning explain the exception.
- Decoration: no pseudo-3D, decorative shadows, patterned slide backgrounds, or ornamental transitions. A transition is allowed only when it explains a data-state change.
- Space: preserve whitespace around the key message, labels, and groups even under the dense tendency.
- Provenance: do not manufacture observed slide counts, layout frequencies, average shape counts, or median font sizes. If the current schema requires such fields for a taste pack, mark their values authored and ensure consumers do not interpret them as source observations.

### Proposed extension encoding

- Keep token meaning in `$type`, `$value`, and `$description`; do not make a token depend on `$extensions` for interpretation.
- Put literal-value evidence under the frozen `com.nodeslide.signature` key with `confidence: 1`, `occurrences: 0`, and `sourceRole: "authored"`.
- Put the citation records above in a reverse-domain NodeSlide extension such as `com.nodeslide.rules`, subject to the final W5 schema name. Each record retains `title`, direct `url`, narrow `supports`, and `license`.
- Preserve unknown extension data during parse/serialize. Keep rule order and token order deterministic.

## Consolidated claims and material to exclude

- No IBCS, FT, DTCG, W3C, or ISO certification, endorsement, approval, or affiliation claim.
- No “IBCS style,” “FT style,” copied template, poster, chart sample, brand asset, palette, font, or trade dress.
- No claim that any precise NodeSlide token or layout value came from a cited source.
- No claim that DTCG validates accessibility or defines presentation semantics.
- No claim that all axes must always start at zero, that all legends must disappear, that all whitespace is waste, or that one chart family is universal.
- No use of IBCS 1.2 as current authority; the IBCS site now labels it outdated.
- No use of challenge material, paid course content, copied templates, secondary blogs, or the third-party readings linked from the FT README.

## Proof-receipt wording

> The NodeSlide Finance reporting taste pack is an independently authored default informed by attributed public principles. It is not affiliated with, endorsed by, certified by, or approved by the IBCS Association, IBCS Institute, Financial Times, DTCG, W3C, or ISO; it does not reproduce their templates, brand identity, or proprietary assets.
