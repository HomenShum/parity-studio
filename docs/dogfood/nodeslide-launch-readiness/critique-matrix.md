# NodeSlide cross-functional critique

## User-state critique

| Perspective | What now works | Remaining critique |
|---|---|---|
| Fresh visitor | The first screen explains the private-preview contract, shows the workflow in three steps, and offers one clear primary action. A title plus one outcome prompt is sufficient; audience and purpose have useful defaults. Generation shows honest progress and normally reaches a clean deck in seconds. | The product still asks users to understand “brief,” “scope,” and evidence discipline earlier than mass-market slide tools. Keep the preview audience to people already motivated by reviewability and structured authoring. |
| First serious-use author | Direct copy editing, notes, slide lifecycle actions, presenter mode, validation, capability-safe sharing, HTML, and editable PPTX form a coherent end-to-end job. The free route degrades to a reviewable deterministic proposal instead of silently failing. | The generated narrative is intentionally conservative and can feel generic. There is no source upload/connectors flow, arbitrary media/shape insertion, or PowerPoint-level master/layout system yet. |
| Experienced presentation professional | Stable object IDs, normalized geometry, notes, explicit sources, native Office objects, scoped AI changes, versions, validation, and visible illustrative labels are materially stronger than a raster-first generator. Three design profiles produce distinct usable systems. | Visual vocabulary remains sparse: mostly editorial text, rails, metrics, and basic charts. A manually added blank slide is deliberately simple and requires styling work. No master slides, advanced charts, motion, image workflow, presenter console, or fine typography controls. |
| Repeat user | Browser-owned recents survive restarts, the active deck returns from its URL, version restore is monotonic, Undo/Redo works within the session, and stale edits remain visible instead of overwriting newer work. | Recents are browser-local capabilities rather than an account library. There are no folders, search, archive/delete deck workflow, cross-device continuity, or capability rotation/recovery if browser storage is lost. |
| Reviewer/viewer | Shared links open directly in a clean presenter with no editor surface or raw deck ID. Notes remain author-only in the editor unless toggled in presenter mode. | Share links cannot yet be revoked or time-limited, and there is no viewer identity, access log, comment-only share role, or tenant policy. |

## Senior professional critique

### Senior product leader

The wedge is now clear: NodeSlide is not “AI makes pretty slides”; it is “a brief becomes an editable, reviewable, source-aware deck whose changes remain controlled.” The strongest activation moment is a clean first deck followed by a safe Present or Export. The preview should optimize time-to-clean-first-deck and accepted first edit, not raw generations.

Public positioning must not imply verified truth, enterprise collaboration, or PowerPoint replacement. The correct launch claim is a structured private preview for evidence-conscious authors.

### Senior UX researcher / interaction designer

The first-run and project dialogs now have clear focus, Escape behavior, focus return, and minimal required input. Direct editing is discoverable after element selection, while AI remains explicitly proposal-first. The command palette and inspector tabs support experienced navigation.

The main learning burden is the distinction among deck title, slide metadata title, visual headline, scope, and operation mode. Progressive education and lightweight inline explanations should be tested with users unfamiliar with structured editing.

### Senior visual and presentation designer

The studio has strong information hierarchy and the generated decks have restrained density, readable contrast, consistent footers, and usable dark/light systems. Native PPTX rendering is visually faithful and overflow-free in the tested decks.

The current composition system is a strong editorial baseline, not a broad presentation language. Next design investment should add a curated layout library, image treatment, richer evidence/chart compositions, and intentional blank-slide templates before adding dozens of granular controls.

### Senior accessibility specialist

Native modal dialogs, initial focus, focus containment/return, keyboard Escape, named toolbar actions, named canvas elements, keyboard-selectable objects, non-hijacking global shortcuts, live slide announcements, and responsive drawers materially improve operability. Tablet/phone drawers now have real measured width rather than only accessibility-tree presence.

Remaining work should include a formal screen-reader matrix, 200% browser zoom, forced-colors/high-contrast mode, reduced-motion verification, and a fully documented keyboard map.

### Senior security / privacy engineer

The private-preview boundary is defensible: raw IDs do not disclose editor data; editor and viewer capabilities are separate; owner checks cover reads and writes; share routes return presenter snapshots only; quotas constrain anonymous abuse; production dependency audits are clean.

This is still bearer-capability security. Treat URLs and local owner storage as secrets. Do not call it authentication. Public launch requires accounts, tenant membership, revocation/rotation, access logs, retention/deletion policy, CSRF/origin review, and explicit migration for anonymous decks.

### Senior staff engineer / reliability engineer

The canonical snapshot, immutable patch application, explicit clocks, compare-and-set behavior, stale proposal preservation, version snapshots, deterministic validation, and reproducible exports form a sound P0. The browser pass found and closed real contract gaps: restore success without a workspace receipt, validator drift, disclosure drift, stale page numbering, and collapsed responsive overlays.

The free provider can still fail; the bounded deterministic fallback is the correct preview behavior and is honestly surfaced. Next reliability work is telemetry, synthetic generation/export probes, idempotent retry analysis, cleanup of rate-limit rows, and documented recovery objectives.

### Senior growth / lifecycle lead

The product now has a credible activation funnel: land → create from brief → reach clean validation → make/accept one edit → present/share/export → return via recents. Instrument these milestones only after privacy and account posture is decided.

Growth should not precede access administration. Invitations, templates, use-case onboarding, and lifecycle messaging will compound value only after users can safely recover decks across devices and control shared access.
