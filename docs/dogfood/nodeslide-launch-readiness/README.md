# NodeSlide launch-readiness dogfood

Date: 2026-07-10

Branch: `feature/nodeslide-domain`

Baseline: branch and `origin/main` both at `8548bf5` before this work (`0 behind / 0 ahead`)

## Verdict

**GO for a controlled anonymous private preview. NO-GO for a public multi-tenant launch.**

The complete first-run, first serious-use, experienced-author, repeat-user, presenter, sharing, export, tablet, and phone journeys now work end to end. Automated gates, browser console checks, capability-access checks, native export inspection, full-slide rendering, and dependency audits pass.

The remaining public-launch blocker is product identity and administration, not deck mechanics: editor ownership is a strong anonymous capability stored in the creating browser, not account authentication or tenant membership. Public launch requires real auth, tenant policy, share rotation/revocation, and an anonymous-deck migration path.

## Goal executed

> Make NodeSlide launch-ready by dogfooding the complete first-run, first serious-use, experienced-user, and repeat-user journeys; synthesizing senior product, UX, visual design, presentation, accessibility, engineering, reliability, and growth critiques; fixing all launch-blocking and high-value usability defects within the NodeSlide P0 scope; and proving the result with live browser journeys, responsive/accessibility checks, automated tests, documentation, and release evidence.

Execution status:

1. Baseline repository and senior cross-functional audit — complete.
2. Fresh-user desktop/tablet/phone dogfood — complete.
3. Experienced and repeat-user authoring/share/present/export/history/recovery dogfood — complete.
4. Rank findings and set an honest launch boundary — complete.
5. Implement P0 safety, authoring, validation, accessibility, responsive, and provenance fixes — complete.
6. Run automated, browser, export, responsive, accessibility, and security regression proof — complete.
7. Write release evidence and launch checklist — complete.

## Material fixes shipped

- Replaced raw deck-ID editor access with 256-bit owner capabilities and separate unguessable read-only share capabilities.
- Added safe recovery for invalid or unauthorized editor URLs, durable browser recents, preview quotas, and capability-filtered deck listing.
- Added slide create/duplicate/delete/reorder, direct text and notes editing, deck rename, element copy/duplicate, session undo/redo, and semantic version comparison.
- Fixed restore receipts so Undo preserves a working Redo chain.
- Added exact publish/export preflight and aligned browser/server readability rules.
- Made illustrative generation publishable by attaching explicit non-verification disclosures to notes.
- Removed model-supplied duplicate bullet prefixes before layout numbering.
- Kept native page-number objects synchronized after slide insertion, deletion, and reorder.
- Synchronized an authored blank slide's storyboard title when its placeholder title is replaced.
- Added three genuinely distinct design profiles and removed fabricated quantitative product claims from the sample.
- Added semantic HTML provenance, native PPTX source notes, presenter notes, validation detail, and honest free-route fallback receipts.
- Added native modal behavior, focus trapping/return, keyboard Escape, named canvas/resize controls, focus-visible states, and control-safe global shortcuts.
- Fixed tablet inspector and storyboard drawers whose absolute grid areas previously collapsed to 1 px.
- Updated vulnerable dependencies and lockfile overrides; app and MCP production audits report zero known vulnerabilities.

## Proof index

- [`critique-matrix.md`](./critique-matrix.md) — senior-professional and user-perspective critique.
- [`release-checklist.md`](./release-checklist.md) — launch boundary, pass/fail gates, and remaining P1 work.
- [`browser-qa.json`](./browser-qa.json) — live journey and responsive measurements, with access capabilities redacted.
- [`artifact-proof.json`](./artifact-proof.json) — exact HTML/PPTX structure, render, overflow, provenance, and checksum receipts.
- [`../nodeslide-domain-v1/`](../nodeslide-domain-v1/) — reproducible isolated sample export and two-client compare-and-set proof.
