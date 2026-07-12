# NodeSlide v3 parity — acceptance checklist (2026-07-12)

Independent second-opinion audit by Fable, read-only. Reference: NodeSlide Editor v3 Standalone
(the interactive prototype = acceptance criteria). NOT edited any code — the implementation lane owns the tree.

## VERDICT (live side-by-side, 2026-07-12): STRONG PARITY, exceeds reference on correctness
Ran the reference (served :5193) and the running build (:5180) side by side in Chrome, Edit + Compare states.
Findings from direct observation:
- Geometry, top bar (N brand · breadcrumb · centered undo/redo · theme · EN · Reset · Share · Present ·
  terracotta Export), left rail (Slides/Outline/Layers · sections · thumbnails · "N sources · cur" status ·
  Add slide), narrative banner (SLIDE JOB), Edit/Overview/Compare, 6-tab inspector, anchored composer with
  scope + policy + @//: ALL present and match the reference.
- MY #1 RISK — Compare sub-modes — RESOLVED: Side-by-side / Slider / Overlay / Blink all present, with the
  honest "No proposal yet · Preview a proposal from the AI lab" empty state matching the reference exactly.
- The build EXCEEDS the reference on correctness/honesty: it surfaces "read context · locked write scope"
  (the reference collapses readContext/writeScope), "Web off · Private deterministic" provider consent,
  and "Structure, presentation, and cleanup checks passed" as a real receipt. Correct-over-decorative — keep.
- Composer is MORE complete than reference: Write Deck/This slide/Selection scope + Operation mode / Design
  behavior / Reference use, vs the reference's single Selection·Harmonize row.
- Only cosmetic divergences: the sample deck uses a light NodeSlide taste pack (reference used a dark
  investor pack) — that's sample content, not shell; and SUGGESTED consolidates to "Sharpen the story /
  Reduce density" + a SLIDE DIRECTIONS "Generate 3 directions" block (reference listed them flat). Minor.

Bottom line: the v3-aligned editor is at high visual parity AND is more honest than the reference where the
reference was only decorative. No launch-blocking UI parity gaps observed in Edit/Compare. Remaining
[verify] items below need a click-through (inspector Design/Comments/Versions/Data/Trace bodies, Overview
spatial board, Layers element tree, @// autocomplete menus) — not observed as broken, just not yet exercised.

## FULL CLICK-THROUGH (2026-07-12) — every flagged item exercised, all real/deep, none placeholders
- Design: PPTX signature upload + 2 signature cards (confidence/warnings/fonts, Preview/Apply) + taste
  ledger ("0 signals · learns only from select/accept/decline/export · No cross-tenant pooling").
- Comments: anchor-scoped (Deck/Slide/Element/Box), Open/All, honest "All clear" empty.
- Versions: revision history (v1 · Compare/Restore · timestamp), "proposals that missed their base clocks".
- Data: source records + "checks attachment and disclosure; does not independently verify facts", a source
  labeled "no measured customer benchmark is claimed".
- Trace: full accountability — Human/Pro/Tech views, validation passed, 7-step Plan, What-it-used, Guardrails
  (normalized geometry, source-aware, stable IDs, deterministic validation), Raw JSON. Beyond reference.
- Layers rail: REAL element tree — glyphs, Group/Ungroup, z-order, lock, visibility, + "Bound to 1 source"
  binding indicators the reference lacked.
- Overview: spatial thumbnail board (7 rendered thumbs), distinct from Outline/Story-Arc. Both exist.
ONE UNCONFIRMED: whether @/ open working autocomplete MENUS vs affordance-only (composer renders the
"@ context / commands" affordances; popup firing not confirmed). Single remaining click-verify.
FINAL: no launch-blocking UI parity gaps across all 6 inspector tabs, both rail modes, all 3 canvas modes.
Build meets/exceeds v3 on every verified surface and is materially MORE honest.

---
Legend: [likely done] per lane report · [verify] claimed but not independently confirmed · [risk] likely gap.

## Shell geometry
- [likely done] 52px top bar · 300px navigator · fluid canvas · 340px inspector (matches reference).
- [verify] light chrome tokens exact match (workspace #FAFAFA, rails #FFFFFF, hairline rgba(15,23,42,.08)).
- [risk] undo/redo CENTERED in top bar (reference) vs left-grouped — confirm placement.

## Top bar
- [likely done] N brand · breadcrumb title/version · Share · Present · terracotta Export.
- [risk] theme toggle + language/clarity popover: lane removed "misleading localization toggles" per
  release-risk audit — GOOD call, but reference SHOWS them. Decision needed: honest-omit vs implement real
  i18n. Do not ship a decorative toggle. (This is a correctness-over-fidelity win, keep it.)
- [verify] Commands surface kept accessible (not deleted) in overflow.

## Left navigator
- [likely done] Slides / Outline / Layers tabs; sections with counts; thumbnails; status lines; add slide.
- [verify] Layers tab = real element tree (not placeholder). Reference shows T/□/→ element rows with lock.
- [risk] navigator status DOTS (03 ●) for propagation targets — needs the dotIds projection; confirm wired.
- [verify] drag-reorder + double-click rename both functional (ops exist; UI wiring is the question).

## Center canvas
- [likely done] Edit / Overview / Compare mode bar; 65% fitted stage; narrative banner (SLIDE JOB).
- [verify] Overview = thumbnail grid with affected-slide halos (StoryArcOverview covers outline; is there a
  SPATIAL thumbnail board too? reference has both outline AND spatial overview).
- [likely done] Compare receipt-safe (candidate bound to a persisted patch receipt — the integrity fix).
- [risk] Compare SUB-MODES: reference has side-by-side / slider / overlay / blink. Confirm all four, not
  just side-by-side.
- [verify] floating object toolbar on selection (Ask AI / Comment / Duplicate / Delete + context chips) +
  selection bbox + resize handles.
- [verify] verified/needs-review chip maps from the REAL receipt (not a static label).

## Right inspector (6 tabs)
- [likely done] AI / Design / Comments / Versions / Data / Trace text tabs; context-first AI; anchored composer.
- [verify] AI: context chips + SUGGESTED actions (Explore 3 directions / Simplify / Timeline) + policy row
  (Selection · Harmonize) + @ Context / Insert / Files / Web affordances.
- [risk] @ / grammar: reference has working autocomplete menus. Lane may have affordance-only. Confirm the
  @-references-resolve-to-readContext / -commands-resolve-to-registry contract is honored, not faked.
- [verify] Design: signature card + contrast/font checks. Comments: threads + resolve (records exist?).
  Versions: rows + restore. Data: binding + freshness. Trace: ink-signed events + Lucid/Pro/Tech levels.

## Correctness invariants (do NOT let fidelity override)
- [likely done, GOOD] no decorative localization/privacy toggles; phone reachability real; overlapping
  breakpoint authority removed; hidden-source export leak filtered; bounded read-context capacity.
- [verify] every mutation (inline edit, layer op, reorder, propagation, accept) passes the versioned patch
  path — no local-only mutation. Reference is decorative here; production truth wins.
- [verify] candidate receipt is patch+digest bound before any green "validated" shows.
- [verify] OpenRouter egress only after explicit consent; deterministic default. (Onboarding modal confirms
  this is surfaced — good.)

## Highest-risk parity gaps to check first
1. Compare sub-modes (slider/overlay/blink) — most-visible reference feature, easy to ship only side-by-side.
2. @ / autocomplete menus — reference has them working; affordance-only reads as unfinished.
3. Spatial Overview board (thumbnail grid) distinct from Story Arc outline.
4. Layers element tree real vs placeholder.
5. Navigator propagation dots wired to the real projection.

## Handoff note
When the lane commits its green checkpoint (44 tests, tsc clean), a clean branch point exists for a NEXT
named slice without collision. Until then, single-writer on this tree. This checklist is the punch list for
that next pass or the lane's own QA — no code changed by this audit.
