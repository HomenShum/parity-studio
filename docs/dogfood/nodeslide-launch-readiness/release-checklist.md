# NodeSlide release checklist

## Controlled private preview — GO

- [x] Branch baseline matched `origin/main` before implementation (`0 behind / 0 ahead`).
- [x] Fresh origin shows an understandable first-run dialog and one primary action.
- [x] Private-preview deck creation requires the server-held access-code gate and bounded inputs.
- [x] Deterministic creation is the no-egress default; OpenRouter receives the full brief only after explicit, per-deck consent.
- [x] OpenRouter failure produces an honest deterministic, scoped, reviewable fallback and trace receipt.
- [x] Generated illustrative content carries a visible or notes-based disclosure and passes exact preflight.
- [x] Direct title/body/notes editing, deck rename, slide add/duplicate/delete/reorder, and keyboard element duplication work.
- [x] Undo and Redo both restore monotonic server versions and preserve a valid history chain; a live two-tab race proves stale Undo reports conflict without consuming either stack.
- [x] AI proposal can be expanded, reviewed, accepted, and remains scope constrained.
- [x] Present is blocked only by the exact current validation result; keyboard navigation and notes work.
- [x] HTML and editable PPTX exports download only after exact preflight.
- [x] HTML includes parallel semantic content, presenter notes, source records, and provenance metadata.
- [x] PPTX contains native text/shape objects and source/disclosure notes; rendered slides have no overflow.
- [x] Sharing requires current server validation and stores a detached, sanitized publication snapshot without notes, brief/project context, signature policy, or non-public sources.
- [x] Republish is explicit, revoke immediately kills the old URL, post-revoke publish rotates the capability, and the old URL remains unavailable.
- [x] Read-only share URL contains only a random share capability, never a deck editor parameter.
- [x] A clean browser opening only a raw deck ID receives safe recovery and no editor data.
- [x] Failed browser persistence is detected by readback; the user receives a masked owner recovery key and editor links accept that key for recovery.
- [x] Welcome, project, and command dialogs support initial focus, Escape, and focus return.
- [x] Desktop, 1024×768 tablet, and 390×844 phone layouts have usable storyboard/canvas/inspector surfaces and no horizontal overflow.
- [x] Browser error/warning logs are empty on the final generation and experienced-author journeys.
- [x] Production Convex admission variables are configured and the hardened schema/functions are deployed to `blissful-pig-998`.
- [x] App typecheck, Convex typecheck, 245 unit tests, lint across 258 files, production build, canonical proof, W2 production proof, and dependency audit pass.
- [x] A fresh detached checkout at release HEAD installs from the frozen lockfile and repeats tests, both typechecks, lint, build, and production dependency audit.

## Public multi-tenant launch — NO-GO until complete

- [ ] Account authentication and verified identity.
- [ ] Tenant/workspace membership and authorization policy.
- [ ] Share expiration and access logs. Rotation and revocation are complete for private preview.
- [ ] Account-backed anonymous-deck claim/migration. One-time owner-key recovery is complete for private preview.
- [ ] User-facing deck archive/delete and retention policy.
- [ ] Formal privacy, threat-model, abuse, and data-deletion review.
- [ ] Monitoring for generation, mutation, validation, share, and export success rates.

## P1 product expansion after preview

- Source upload/connectors and an explicit evidence replacement flow.
- Replace generic/repetitive deterministic first-draft copy with audience-faithful narrative planning, StoryBench coverage, and measurable thesis/claim/ask retention.
- Curated slide layouts, image workflow, richer charts, masters, and presentation console.
- Account-backed deck library, folders/search, cross-device continuity, and named collaborators.
- Full screen-reader/forced-colors/200%-zoom matrix and published keyboard reference.
- Share/comment roles and reviewer identity.
- Migrate from the deprecated pi-ai package name to its maintained successor after API-compatibility work.
- Remove the non-failing circular Vite chunk warning and add bundle budgets.
- Reconcile or republish the historical hosted SlideLang deck so external and repository proof revisions do not drift.

## Release owner decision

Ship only behind private-preview language and controlled distribution. Do not market account security, verified factual research, enterprise collaboration, universal PowerPoint fidelity, or a native Google Slides editor.
