# W5 — NodeSlide sector taste packs research contract

Status: **FROZEN — revision 1**
Frozen: 2026-07-10
Owner: NodeSlide product work; prompt-independent prior art

## Outcome

Produce two authored, cited `SignatureProfile` JSON packs that are interchangeable with W1 extraction output:

- `finance-ibcs`
- `startup-narrative`

Each pack is an opinionated NodeSlide default, not a claim of certification, endorsement, or a pixel copy of any source. Every behavioral rule carries a direct citation to a primary/authoritative source and a short statement of what the source supports.

## Allowed sources

Prefer these primary/maintainer sources:

- IBCS Association standards and official summaries;
- Financial Times `chart-doctor` / Visual Vocabulary maintained repositories;
- Duarte's own published presentation/narrative guidance;
- official Material Design, Carbon Design System, and Adobe Leonardo documentation for token/ramp architecture only;
- W3C/DTCG 2025.10 design-token reports for file format.

Do not use scraped template marketplaces, unattributed “best practices,” copied proprietary templates, or challenge material. A source can support a rule; it cannot donate copyrighted expression or brand identity.

## Pack contract

Each JSON file validates against `SignatureProfile` and uses:

- `source.kind: 'taste_pack'`;
- authored evidence with confidence `1` only for literal pack values chosen by NodeSlide;
- citations in a `rules` extension with `title`, `url`, `supports`, and optional license;
- accessible colors that pass existing NodeSlide contrast validation;
- system-safe font-family fallback stacks; no font download or license assumption;
- a layout-tendency block describing intended defaults, marked authored rather than observed;
- no uncited assertion that a precise color, font, or spacing value comes from IBCS, FT, or Duarte unless the source actually specifies it.

## Finance pack direction

Research and encode rules for message-led titles, semantic consistency, high information density without decoration, integrity of axes/scales, direct labels, horizontal time series, vertical structural comparisons, and restrained highlighting. Palette and fonts are NodeSlide-authored accessible defaults. Chart conventions may cite IBCS and FT, but the pack must not use FT trade dress or claim IBCS certification.

## Startup pack direction

Research and encode rules for audience-centered narrative, a clear takeaway per slide, contrast between current and possible future, visual simplicity, whitespace, and a decisive next action. Palette, fonts, and layout values are NodeSlide-authored defaults. Cite Duarte for narrative/design principles without reproducing proprietary diagrams, course content, or templates.

## Validation and metric

1. Parse both JSON files as `SignatureProfile`.
2. Every rule has at least one reachable citation URL and non-empty `supports` text.
3. Finance pack applied to the golden deck yields zero contrast or font-size issues.
4. Startup pack applied to the golden deck yields zero contrast or font-size issues.
5. Pack IDs, token order, and stable serialization are deterministic.
6. A proof receipt records sources, validation results, and a non-affiliation disclaimer.

## Research deliverable

Write a concise source ledger to `docs/research/nodeslide-sector-taste-packs.md`, then the packs under `src/domains/nodeslide/signature/packs/`. Research agents may propose evidence and rules but may not modify W1/W2 contracts. Final synthesis is reviewed for source support and licensing boundaries before commit.

## Non-goals

- No external publication, certification, endorsement claim, copied template, or paid-content extraction.
- No “Duarte style,” “FT style,” or “IBCS certified” label in the product UI.
- No sector pack beyond the two named packs.
- No model-generated citations.
