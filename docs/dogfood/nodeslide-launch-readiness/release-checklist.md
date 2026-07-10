# NodeSlide release checklist

## Controlled private preview — GO

- [x] Branch baseline matched `origin/main` before implementation (`0 behind / 0 ahead`).
- [x] Fresh origin shows an understandable first-run dialog and one primary action.
- [x] First deck can be created from title + outcome prompt on the free route.
- [x] Free-route failure produces an honest deterministic, scoped, reviewable fallback.
- [x] Generated illustrative content carries a visible or notes-based disclosure and passes exact preflight.
- [x] Direct title/body/notes editing, deck rename, slide add/duplicate/delete/reorder, and keyboard element duplication work.
- [x] Undo and Redo both restore monotonic server versions and preserve a valid history chain.
- [x] AI proposal can be expanded, reviewed, accepted, and remains scope constrained.
- [x] Present is blocked only by the exact current validation result; keyboard navigation and notes work.
- [x] HTML and editable PPTX exports download only after exact preflight.
- [x] HTML includes parallel semantic content, presenter notes, source records, and provenance metadata.
- [x] PPTX contains native text/shape objects and source/disclosure notes; rendered slides have no overflow.
- [x] Read-only share URL contains only a random share capability, never a deck editor parameter.
- [x] A clean browser opening only a raw deck ID receives safe recovery and no editor data.
- [x] Welcome, project, and command dialogs support initial focus, Escape, and focus return.
- [x] Desktop, 1024×768 tablet, and 390×844 phone layouts have usable storyboard/canvas/inspector surfaces and no horizontal overflow.
- [x] Browser error/warning logs are empty on the final generation and experienced-author journeys.
- [x] App typecheck, Convex typecheck, lint, unit tests, production build, proof script, and app/MCP dependency audits pass.

## Public multi-tenant launch — NO-GO until complete

- [ ] Account authentication and verified identity.
- [ ] Tenant/workspace membership and authorization policy.
- [ ] Share capability rotation, revocation, expiration, and access logs.
- [ ] Anonymous-deck claim/migration and lost-browser recovery.
- [ ] User-facing deck archive/delete and retention policy.
- [ ] Formal privacy, threat-model, abuse, and data-deletion review.
- [ ] Monitoring for generation, mutation, validation, share, and export success rates.

## P1 product expansion after preview

- Source upload/connectors and an explicit evidence replacement flow.
- Curated slide layouts, image workflow, richer charts, masters, and presentation console.
- Account-backed deck library, folders/search, cross-device continuity, and named collaborators.
- Full screen-reader/forced-colors/200%-zoom matrix and published keyboard reference.
- Share/comment roles and reviewer identity.
- Migrate from the deprecated pi-ai package name to its maintained successor after API-compatibility work.
- Remove the non-failing circular Vite chunk warning and add bundle budgets.
- Reconcile or republish the historical hosted SlideLang deck so external and repository proof revisions do not drift.

## Release owner decision

Ship only behind private-preview language and controlled distribution. Do not market account security, verified factual research, enterprise collaboration, universal PowerPoint fidelity, or a native Google Slides editor.
