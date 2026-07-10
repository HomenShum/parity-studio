# NodeSlide domain proof

## Goal

Prove a deck-native Parity Studio domain in which people and agents can create,
inspect, edit, comment on, validate, present, and export an editable deck
without losing structure or control.

The P0 proof is complete only when the golden path works end to end:

```text
brief -> plan -> structured deck -> render -> select -> scoped patch
      -> review -> accepted version -> validation -> present/PPTX
```

## Architecture decisions

1. Structured deck, slide, and element records are canonical. HTML, SVG, and
   PPTX are derived render targets.
2. Every deck, slide, and element has a stable public ID independent of its
   Convex row ID.
3. Every write carries a deck base version and the touched slide/element
   clocks. Non-overlapping stale work may rebase; overlapping stale work is
   retained as a proposal.
4. Manual drag/resize and AI edits use the same semantic patch protocol.
5. Accepted patches, versions, comments, validation receipts, exports, and
   traces are durable. Presence is advisory and expires.
6. The product has exactly three primary editor columns: slide navigator,
   slide canvas, contextual inspector. AI and trace UI live in inspector tabs.
7. Parity Studio remains available behind the `parity` domain. NodeSlide is a
   domain pack selected by `VITE_STUDIO_DOMAIN` or a URL override.

## SlideLang boundary

The official `aif-projects/slidelang_skill` repository is a thin client for the
hosted SlideLang API. Its current workflow is scaffold, author project files,
budget, check, repair-plan, publish, and pull. Hosted completion requires:

```json
{ "ok": true, "publish_ok": true, "clean_ok": true }
```

The official client documents `SLIDELANG_API_BASE_URL` (with
`EDITOR_BASE_URL` fallback) and does not document an API-key environment
variable or a PPTX endpoint. NodeSlide therefore uses an adapter boundary:

- `local`: zero-cost deterministic validation, semantic HTML/SVG rendering,
  and native editable PPTX export via PptxGenJS.
- `hosted`: optional mapping to the documented SlideLang project endpoints.

Local validation does not claim to be the hosted compiler. Both modes expose
the same `ok`, `publishOk`, and `cleanOk` receipt shape with the toolchain
version recorded.

## Parallel ownership

| Lane | Owned surface |
| --- | --- |
| Contract | `shared/nodeslide*` |
| Convex | additive NodeSlide tables and `convex/nodeslide*` APIs |
| Adapter | `src/domains/nodeslide/slidelang/**` and PPTX dependency |
| Studio | `NodeSlideStudio`, deck canvas, navigator, inspector tabs, CSS |
| Proof | tests, browser receipts, screenshots, and final docs |

## Acceptance gates

### Contracts

- Shared types compile.
- Scope validation rejects out-of-scope operations.
- Locked elements reject mutation.
- Stable IDs survive accepted revisions and restore operations.

### Authoring

- A user can create a deck from a brief, audience, purpose, success criteria,
  and design profile.
- The free route is attempted first and has an honest deterministic fallback.
- The golden deck renders from canonical state.

### Human-agent editing

- Selection persists while changing inspector tabs.
- Drag and resize persist as structured patches.
- AI proposals show explicit deck/slide/element/comment and operation scope.
- Accept changes only intended elements; reject leaves canonical state intact.

### Collaboration

- Two clients observe the same accepted deck version.
- Non-overlapping concurrent edits can commit safely.
- Overlapping stale edits remain reviewable proposals.
- Comments can anchor to a deck, slide, element, or bounding box and resolve
  through accepted work.

### Validation and export

- Local SlideLang receipt reaches `ok`, `publishOk`, and `cleanOk` on the
  golden deck.
- Hosted presenter routing is shareable.
- PPTX contains editable text and native shapes/charts rather than slide
  screenshots.
- Export warnings are explicit for unsupported capabilities.

### Product quality

- Desktop uses the strict three-column model.
- Tablet and phone use contextual drawers without a permanent bottom chat bar.
- Keyboard navigation, focus states, and reduced-motion behavior work.
- Unit, Convex, build, and browser flows pass without client-side secrets.

## Completion receipt

- Branch base: `feature/nodeslide-domain` and `origin/main` both point to `8548bf5` at final audit.
- Local validation: `ok=true`, `publishOk=true`, `cleanOk=true`, zero issues.
- Automated checks: Biome clean; 19 test files and 61 tests pass; frontend and Convex typechecks pass; production build passes; final Convex functions deploy successfully.
- Browser golden path: create from brief/design profile, open by deck ID, select/drag/resize-capable canvas, scoped AI proposal and acceptance, anchored comment lifecycle, presenter notes/navigation, share, HTML export, and PPTX export all exercised.
- Concurrency: one accepted write, one safely rebased non-overlapping stale write, and one blocked overlapping stale write with both accepted contents preserved.
- Local artifacts: semantic HTML has seven slide regions and 69 stable element IDs; editable PPTX is valid OOXML with 69 editable claims and two native chart claims.
- PPTX QA: all seven slides inspected at full size and the final export passes the presentation overflow test.
- Official SlideLang: all eight source slides pass check with no blocking, repairable, editorial, or budget-overflow issues; hosted publish revision `rev_20260710121016833_6082525f93` is live.
