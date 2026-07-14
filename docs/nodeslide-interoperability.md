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
| Google Slides | Tested REST adapter, stable local/remote mapping, revision-aware three-way planning, durable owner-gated sync metadata, and an OAuth connection flow using `drive.file` | OAuth activates only when deployment credentials, encryption material, and allowed origins are configured; otherwise it fails closed. Refresh credentials are encrypted outside the sync table. The current UI authorizes the adapter; full user-facing push/pull controls remain a separate release gate. |
| MCP / coding agents | The v0.5.0 source adds owner-gated snapshots, pagination, element listing, canonical JSON export, and exact patch proposal tools | Proposals remain unapplied until review. External-agent traces identify the external agent and do not fabricate NodeSlide model tokens or cost. Publish v0.5.0 separately before using these additions from a package registry. |

## JSON re-open and source editing

Open **Inspector → JSON** to inspect the current snapshot, latest patch, or selected element.
The source panel can copy complete valid JSON, download the full-fidelity envelope, re-open a
matching Deck JSON file as a structural proposal, or convert a bounded PPTX file into a proposal.
Selected-element JSON changes are compiled to existing typed operations and use the normal
server-authoritative CAS write path.

Open **Inspector → Evidence** for uploaded tables, images, web captures, and citations. Evidence
is material the deck can cite or bind to; JSON is the canonical editable deck state. The labels are
deliberately separate so data provenance is not confused with the document model.

Whole-deck import is bounded by the same per-patch operation cap used everywhere else. Files that
cannot be expressed safely within that contract are rejected with an interface-level explanation;
they are not partially or silently imported.

## Google Slides deployment contract

The Google adapter deliberately accepts an injected access-token provider and `fetch`
implementation. Production uses an external Google consent screen and the narrow `drive.file`
scope. Authorization uses state and PKCE, tokens are encrypted server-side and omitted from logs,
and remote `batchUpdate` must execute only after the user confirms the generated plan. Inbound
remote changes become `nodeslide.proposePatch` candidates and remain unapplied until acceptance.

The OAuth backend requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, a 32-byte base64url
`NODESLIDE_OAUTH_TOKEN_ENCRYPTION_KEY`, and `NODESLIDE_GOOGLE_REDIRECT_URI`. Set
`NODESLIDE_APP_ORIGINS` to the comma-separated application origins allowed to receive the bounded
result redirect (production defaults to `https://parity-studio.vercel.app`; local development must
be configured explicitly). The redirect URI must be HTTPS except for loopback development. Missing
or malformed configuration fails before a session or credential is created. Disconnect always
revokes the local credential even when Google or the deployment configuration is unavailable.

The durable `nodeslide_sync_connections` record stores only opaque remote revision data,
versioned object mappings, connection state, idempotency fingerprints, and timestamps. It is
owner-gated and CAS-protected.
