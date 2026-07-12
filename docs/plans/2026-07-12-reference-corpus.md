# Reference corpus decision — native-PPTX golden set + Taste Museum (2026-07-12)

Decision: adopt the benchmark-corpus proposal (Packs A/B/C + six-file starter + manifest schema +
Taste Museum split) with three amendments. Post-submission execution; slots into phase-a Bench work.

## Packs
- Z. FIXTURES (Tier A, in-repo): 3-4 NASA NTRS / .gov native .pptx (public domain) — the ONLY files
  allowed as committed test fixtures for the signature extractor and PPTX round-trip tests.
- A. Native PowerPoint operations: PPT-Eval, 2 cases (text/shapes; charts/tables). PENDING rights audit.
- B. Professional editing: PPTArena, 2 cases (investor deck cross-slide styling; technical deck
  object edits). Verified previously.
- C. Human storytelling/delivery: Paper2Video, 2 cases (visual academic; dense-source-to-accessible).
  Verified; item-level video/slide rights review before any redistribution.
- D. boardroom_read calibration (Tier B, evaluate-by-reference): SEC EDGAR EX-99 investor
  presentations + JPM/GS Investor Day decks — the finance persona's genre, absent from all research
  corpora. Calibrates contract text budgets + Finance/IBCS pack against reality.
- E. Taste Museum (never golden): famous pitch decks (LinkedIn-B annotated, Airbnb, Uber, Buffer,
  Front), Meeker/Evans, Netflix Culture Deck, anti-patterns (Afghanistan slide, Columbia/Boeing
  slide). Story structure + headline language study only; recreations explicitly disqualified as
  goldens (fonts/objects/notes not original).
- Tier C consented: Google BA's sanitized real deck (ask at today's session), education friend's
  materials if offered.

## Rules
1. Golden-set admission checklist and per-deck manifest exactly as proposed (id/license/audience/
   purpose/archetypes/features/goldenArtifacts) — merge into the StoryBenchCase rights model.
2. PPT-Eval (arXiv 2606.31154) and DECKBench (2602.13318) are UNVERIFIED — run the dataset-rights
   audit agent before ingestion; nothing enters manifests unaudited.
3. PPTBench + DECKBench are second-wave (scale), after the six-file pack proves the harness.
4. Extraction targets per reference: deck arc/rhythm/signature; slide job/takeaway/archetype;
   element role/geometry/binding; delivery notes/transcript alignment (Paper2Video only).

## Sequence
Six-file starter (A×2, B×2, C×2) + Pack Z fixtures + Pack D calibration set → wired as bench cases
with human-reference diffs → three independently-licensed external-deck hand audits (closes the
NodeSlide release-evidence gap) → PPTBench/DECKBench scale pass.
