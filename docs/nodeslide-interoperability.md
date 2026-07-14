# NodeSlide interoperability

NodeSlide keeps one authoritative deck model. Browser edits, agent edits, JSON re-open, PPTX
conversion, MCP proposals, and future Google Slides pulls all converge on typed
`PatchOperation[]`, candidate validation, version clocks, and human acceptance. External files
never replace persisted state directly.

## Capability matrix

| Surface | Current behavior | Round-trip boundary |
| --- | --- | --- |
| NodeSlide Deck JSON | Versioned `nodeslide.deck-snapshot` export, bounded parse, structural diff, selected-element editing | Lossless for the canonical snapshot. Runtime clocks and timestamps are regenerated after accepted changes. A deck-identity mismatch or an unsupported structural difference fails closed. |
| PowerPoint export | Editable text, shapes, connectors, images, and supported native charts; explicit fallbacks for math and media | One-way for arbitrary PPTX. NodeSlide object names are embedded as stable identity hints. |
| PowerPoint import | Bounded OOXML parser for text, basic shapes/connectors, embedded images, cached simple charts, slide order/dimensions/backgrounds, and notes | Best effort. A per-object fidelity ledger labels native, approximated, and dropped features. SmartArt, animation, grouped transforms, OMML, tables, media, OLE, macros, and unknown objects are never silently claimed as exact. Import is an unapplied proposal. |
| Google Slides | Tested REST adapter, stable local/remote mapping, revision-aware three-way planning, and durable owner-gated sync metadata | The repository does not ship a Google OAuth client credential. Live push/pull is unavailable until the deployment supplies an approved OAuth client and user consent. Tokens are not stored in the sync table. |
| MCP / coding agents | Owner-gated snapshot, pagination, element listing, canonical JSON export, and exact patch proposal tools | Proposals remain unapplied until review. External-agent traces identify the external agent and do not fabricate NodeSlide model tokens or cost. |

## JSON re-open and source editing

Open **Inspector → Source** to inspect the current snapshot, latest patch, or selected element.
The source panel can copy complete valid JSON, download the full-fidelity envelope, re-open a
matching Deck JSON file as a structural proposal, or convert a bounded PPTX file into a proposal.
Selected-element JSON changes are compiled to existing typed operations and use the normal
server-authoritative CAS write path.

Whole-deck import is bounded by the same per-patch operation cap used everywhere else. Files that
cannot be expressed safely within that contract are rejected with an interface-level explanation;
they are not partially or silently imported.

## Google Slides deployment contract

The Google adapter deliberately accepts an injected access-token provider and `fetch`
implementation. A production deployment must add an approved Google OAuth consent screen using
the narrowest viable scope (prefer `drive.file`), keep access tokens out of Convex rows and logs,
and execute remote `batchUpdate` only after the user confirms the generated plan. Inbound remote
changes become `nodeslide.proposePatch` candidates and remain unapplied until acceptance.

The durable `nodeslide_sync_connections` record stores only opaque remote revision data,
versioned object mappings, connection state, idempotency fingerprints, and timestamps. It is
owner-gated and CAS-protected.
