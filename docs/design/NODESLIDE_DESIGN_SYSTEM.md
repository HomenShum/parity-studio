# The NodeSlide Design System — canon v1

One system, three rings. **Ring 0** is the meta-design: the semantics and governance
every pixel obeys. **Ring 1** renders those semantics as the app chrome. **Ring 2**
renders the same semantics as the decks the agent generates. The app and its output
are two renderings of one doctrine — that is the system's signature idea, and it is
what lets NodeSlide credibly sell taste: the product wears the same system it ships.

Precedence when documents disagree: this canon → frozen UI contracts
(`docs/specs/ui/*`) → component code. Every rule below names its **enforcement
point** or is explicitly marked *advisory*; a rule with no enforcement plan is an
opinion, not a rule (HONEST_SCORES applied to design).

---

## Ring 0 — Meta-design (the semantics)

### 0.1 The core duality: provisional → settled

Everything in NodeSlide is either **drafting** (provisional, agent-proposed,
unvalidated) or **settled** (validated, sealed, human-authoritative). This duality
is the brand. It is rendered identically everywhere:

| Gesture | Token | Feel | Used for |
|---|---|---|---|
| **draft** | `--ns-draft-ms: 240ms` · `--ns-draft-ease: cubic-bezier(0.2,0.7,0.2,1)` | eager rise-in | content arriving: reveals, proposals appearing, thumbnails, streaming |
| **settle** | `--ns-settle-ms: 420ms` · `--ns-settle-ease: cubic-bezier(0.16,1,0.3,1)` | precise deceleration snap | validation landing: seals, Apply, Deck CI pass, version stamps |

Rules: nothing settles that has not visibly drafted; nothing may *look* settled
(sealed, stamped, green) unless the underlying receipt exists — motion is subject to
capability-honest labeling like any label. `prefers-reduced-motion` collapses both
gestures to their final state, never to a different design.
*Enforcement: tokens + keyframes in `nodeslideV3.css` ("Landing signature motion"
section); reduced-motion block same section. Semantic honesty: advisory, reviewed.*

### 0.2 One hue, one meaning

Color is classification, never decoration. The meaning layer is fixed; both rings
must render it:

| Semantic | Meaning | Ring 1 token | Ring 2 (ThemeSpec key) |
|---|---|---|---|
| **Agency / external egress / attention** | "an agent or external provider acts here; look" | `--ns-accent` (#d97757 terracotta) | `colors.accent` |
| **Validated / evidence-good** | "a receipt exists" | `--ns-positive` | `colors.insight` (+ `insightInk`) |
| **Trace / lineage / connection** | "follow this thread" | `--ns-collaboration`, trace accents | `colors.trace` |
| **Authored content** | the user's material | `--ns-ink` ramp | `colors.ink` / `muted` |
| **Ground** | surfaces content sits on | `--ns-bg/surface/raised/canvas` | `colors.canvas` |
| **Structure** | edges, separation | `--ns-line-a..f` | `colors.border` |
| **Danger / destructive** | reversible-with-care | `--ns-danger` | (decks: never; decks have no destructive controls) |

Corollaries: terracotta appears exactly where agency or egress is real (consent
pill, provider chips, agent rails, proposal accents) and nowhere else; green never
appears without a receipt behind it; a second decorative accent hue is forbidden in
chrome (deck themes may carry their own accent — that is Ring 2's `accent`, same
semantic: "where the deck wants attention").
*Enforcement: chrome — advisory + PR review; decks — `on_brand_color` validation
(`shared/nodeslide.ts:884`, escalated to blocking in Deck CI `nodeslideDeckCi.ts:507`).*

### 0.3 Three voices of type

| Voice | Face | Role |
|---|---|---|
| **Authored** (serif) | Fraunces (`--font-display`) | headlines, deck display type — the human/story voice |
| **Instrument** (sans) | Geist (`--font-sans`) | chrome, controls, body — the tool's voice |
| **Evidence** (mono) | JetBrains Mono (`--font-data`) | digests, receipts, data, kickers — the proof voice |

A string set in mono is implicitly a claim of machine truth (an id, a hash, a
number); never set marketing copy in mono, never set a receipt in serif.
*Enforcement: deck side — `on_brand_font` against theme allowlists; chrome —
advisory.*

### 0.4 Copy doctrine

Active, capability-honest, receipt-anchored. The agent "noticed / proposed /
prepared"; only the human (or Turbo, by name) "applied." Controls say exactly what
happens; errors name the actual ask ("Adding a chart needs the external model…"),
never a generic remedy. Provider labels may only claim what the runtime did
(`"GLM 5.2 (deterministic fallback)"` is the canonical honest pattern).
*Enforcement: patch-review voice frozen in `docs/specs/ui/patch-review-card.md`;
fallback labeling in `nodeslideAgent.ts`; remainder advisory.*

### 0.5 Governance

- **Frozen surfaces:** the `docs/specs/ui/*` contracts and this canon change by PR
  with a changelog line, additively; renames are breaking changes.
- **Agent-checkable chrome:** every screen keeps its `data-agent-surface` /
  `data-ns-*` contract (`uiContract.ts`, `nodeslide-agent-ui-linter.mjs` — CI-run).
- **One dark-mode mechanism:** the attribute (`data-ns-theme`) is canonical because
  agents and tests can set it deterministically. *Known debt: the landing still
  themes via `prefers-color-scheme` media query (`nodeslideV3.css` L11007) — migrate
  to the attribute; until then it is the only sanctioned exception.*
- **Known drift to retire:** `editorial-signal` exists twice with different
  palettes (`nodeslideSeed.ts` FALLBACK_LIGHT L122 vs registry L170). The registry
  entry is canonical; the fallback must be made identical.

---

## Ring 1 — The app chrome system

### 1.1 Tokens (source of truth: `nodeslide.css` `@layer nodeslide.tokens`)

Palette, line ramp, shadows, overlays, glass and topbar tokens are as defined on
`.nodeslide-studio` (light) and `.nodeslide-studio[data-ns-theme="dark"]` — the
inventory table in that file is normative; hexes are not re-pinned here to avoid a
second source of truth.

**New canon (gaps the audit found), to be introduced as tokens and migrated to
opportunistically — new code must use them, old code migrates when touched:**

```css
/* radius scale — replaces per-component literals (observed cluster 5–12px) */
--ns-radius-s: 6px;    /* chips, inputs, small cards */
--ns-radius-m: 10px;   /* cards, proposals, dialogs */
--ns-radius-l: 14px;   /* panels, sheets, stage frames */
--ns-radius-pill: 999px;

/* space scale — 4-base */
--ns-space-1: 4px;  --ns-space-2: 8px;  --ns-space-3: 12px;
--ns-space-4: 16px; --ns-space-5: 24px; --ns-space-6: 32px; --ns-space-7: 48px;
```

### 1.2 Type scale and the readability floor

Chrome floors **raise** (the 8–11px era depressed readability scores and is
retired): captions/eyebrows `11px` (caps, +0.04em tracking), controls `12px`, body
`13px`, panel titles `14–15px`, display per-surface. Nothing interactive below
`12px`; touch targets ≥ `40px` on mobile (`--ns-control-min-height` rises to 36px
desktop / 44px mobile). Numbers that align get `font-variant-numeric: tabular-nums`.
*Enforcement: advisory today; target = extend the agent-ui linter with a computed
font-size floor check. Deck side is already enforced at 14pt (`font_size`).*

### 1.3 Components

The frozen contracts in `docs/specs/ui/*` (VariationStrip, SignatureSwitcher,
PatchReviewCard, TasteProfileCard) plus the shadcn/Radix primitive layer are the
component system; new components must (a) be built from the primitive layer, (b)
carry required states — empty, loading (draft gesture), success (settle gesture),
failure (honest copy + retry), disabled-with-reason — and (c) declare their
agent-checkable attributes. A run's terminal state must visually terminate: no
spinner may coexist with a verdict (the "Still working + failed" defect class).
*Enforcement: linter for attributes; state co-display — advisory, QA-ledgered.*

### 1.4 A11y floors

WCAG contrast 4.5:1 (3:1 large), visible focus everywhere, `aria-live` for run
status, full keyboard paths for review decisions, reduced-motion respected.
*Enforcement: contrast is code-enforced deck-side; chrome via QA passes.*

---

## Ring 2 — The generative system (what the agent designs)

### 2.1 Theme grammar

`ThemeSpec` (`shared/nodeslide.ts:269`) is the entire visual authority for a deck:
9 semantic colors, 3 type roles, radius, spacing unit. The four built-in themes
(**Editorial Signal**, **Quiet Precision**, **Night Briefing**, **Midnight
Signal** — `nodeslideSeed.ts:122-246`) are the house palette families; signature
profiles and taste packs (finance-ibcs, startup-narrative) modulate within the
grammar, never around it. Agent theme edits ride `update_theme_v1` and are validated
like any patch.

### 2.2 The slide canvas

Normalized 0..1 geometry with pinned bands (from the builder's conventions, now
canon): content margin `x: 0.06–0.94`; headline band `y ≤ 0.34`; body/evidence band
`0.34–0.90`; footer band `y ≥ 0.92` (footer 10pt, page number 13pt at
`box(0.88,0.92)`); kicker = mono caps section label. Density modes (from variation
axes): `executive` ≤ 3 focal elements, `balanced` ≤ 5, `detail` ≤ 7 — one dominant
focal point regardless (W6 Delta 4's "one clear message" rendered as a count).

### 2.3 Type roles (pt)

`hero 40–48 · title 27–34 · takeaway 20–24 · body 16–17 · label 14–15 · footer
10–13`, display face for hero/title (authored voice), body face for prose, mono for
kickers/data. Floor: **no text below 14pt** except footer/page-number chrome.
*Enforcement: `font_size` (14pt floor), `on_brand_type_scale`, both blocking.*

### 2.4 Chart doctrine

Zero-baseline bars; direct labels preferred over legends (legend only >1 series);
series colors from theme (`CHART_COLORS` then `accent`); axis ink = `muted`, grid =
`border`; every chart binds a source (`primitive_source_binding_mismatch`) and its
caption numbers must match bound data (`chart_caption_value_mismatch`,
`chart_axis_*` — all deterministic, in the semantic evaluator).

### 2.5 Archetype → layout mapping

W6's 17 slide archetypes resolve to the builder's 7 layout intents (`hero |
comparison | contract | flow | split | evidence_board | decision`); the reference
pack (W6 Delta 3) attaches per-archetype excellence rules. A slide's archetype is
classified before it is scored; repairs are expressed in PatchOperation vocabulary.

### 2.6 Decks perform the duality too

Presenter entrance and proposal previews use draft/settle (the landing's signature
stage is the reference implementation); a slide seal ("validated") may render only
from a real validation receipt — the deck inherits Ring 0 honesty wholesale.
*Enforcement: Deck CI + artifact-presence gate; motion advisory.*

---

## The quality loop that closes the system

Ring 2 output is scored by the four-level rubric (element / slide / deck / product
UX — W6 Delta 4) under TasteBench evidence policy; failures become PatchOperation
repairs (bounded, reviewable); accepted repairs teach the taste profile
(PreferenceDimension ETL); the taste profile modulates the next generation. The
design system is therefore not a style guide that decays — it is the fixed grammar
inside which the agent's taste is trained, measured, and improved.

**Definition of on-system:** a surface (chrome or deck) is on-system when every
color resolves to a semantic token, every string sits in the right voice, every
transition is draft or settle, every seal has a receipt, and the relevant
enforcement point passes. Anything else is drift, and drift is a ledgered finding.
