# NodeSlide final founder-roadshow receipt

NodeSlide was dogfooded as the product story, not as a feature checklist: a founder starts with scattered evidence, compiles it into a sourced and editable six-slide roadshow, directs precise revisions through conversation, validates every accepted change, and leaves with a presentation-ready public deck plus editable PowerPoint and JSON exports.

## Public deliverables

- Demo video (4:25): https://youtu.be/WOk0jV59oS0
- Live prototype: https://parity-studio.vercel.app/
- Frozen public deck: https://parity-studio.vercel.app/?share=share-f224c10b419373c5e9774b3c78bfee8d1131&present=1
- Source: https://github.com/HomenShum/parity-studio
- PRD: [`docs/submission/nodeslide-prd.md`](../../submission/nodeslide-prd.md)
- TDD: [`docs/submission/nodeslide-tdd.md`](../../submission/nodeslide-tdd.md)

## Production identity

- Recorded runtime commit: [`ae2e181a29b37de7dbc2311ff0d3c8a307634b54`](https://github.com/HomenShum/parity-studio/commit/ae2e181a29b37de7dbc2311ff0d3c8a307634b54)
- Successful production release: [GitHub Actions run 29352067830](https://github.com/HomenShum/parity-studio/actions/runs/29352067830)
- Frontend and Convex backend runtime receipts resolved to the same commit before recording.
- Quality passed 734 tests across 107 files; all 15 protected isolated-release Playwright journeys passed before production cutover.

## Recording integrity

- Format: one continuous 1920×1080 MP4 with full browser chrome, visible cursor, real typing, and 17 burned-in caption blocks.
- Duration: 265.533 seconds (4:25.533).
- Size: 19,421,750 bytes.
- MP4 SHA-256: `101802e45f11ff1f04deab29ae494dec163e174cdce2397f7cf9bf0c860d6b48`
- Playback rate: `1`; no cuts, splices, uniform time compression, seeded deck, or synthetic product state.
- Independent verifier: all 17 required scenes appeared exactly once and in contract order.
- Browser result: zero console errors, zero page errors, and no pending recorder hooks.
- YouTube result: HD and SD processing complete, copyright check reported no issues, visibility is unlisted.

The verified scene contract covers: fresh landing; evidence attachment; model and web consent; six-slide compilation; editable primitive inspection; one-element, one-slide, and bounded multi-slide edits; Compare and Accept; chart, math, layout, and uploaded-image changes; trace and source lineage; persistent memory; present/share; and PowerPoint/JSON export.

## Product-state proof

- Fresh deck: 6 slides, created from the landing composer during the take.
- Editable primitives observed: text, shape, connector, math, chart, and image.
- Agent trace attribution: `nebius · zai-org/GLM-5.2 · High effort`.
- Trace evidence: one visible source citation plus persisted provider, model, timing, validation, and human-review state.
- Chart demonstration changed only the source-safe label `S1` to `Prototype metric · S1`; numeric values and source binding were preserved.
- Math changed from `accepted change = proposal ∩ authorized scope` to `R = accepted_reviewed_edits / accepted_edits`.
- Layout position changed from x=`7` to x=`8.5` through the normal typed operation path.
- Uploaded-image SHA-256: `41b91f8c1b30e8539c7c890e581df36bc001eef061fb40d7e399002fb21d98a1`.
- Persistent memory category preference was enabled in the owner workspace.
- The final immutable share opened in presentation mode and remained separate from owner-only state.

## Export proof

### Editable PowerPoint

- Size: 319,114 bytes.
- SHA-256: `65fbf9e2823240a64d65d1817ce490fb6a0c1b027211f03602ae33ef1099aaae`.
- OOXML inspection: 6 slide XML entries, 1 native chart, and 2 media assets.
- Editable object counts by slide: 9; 17; 9; 10; 11 plus 1 chart frame; 10 plus 1 picture.

### Canonical JSON snapshot

- Format: `nodeslide.deck-snapshot`, version `1`; deck version `8`.
- Size: 126,804 bytes.
- SHA-256: `25b582da120c2c869a91e34b219ee9ad10e0c2320b886acaa8acdf6b893c355d`.
- Contents: 6 slides, 65 elements, and 13 sources.
- Element kinds: 9 shapes, 51 text objects, 2 connectors, 1 math object, 1 chart, and 1 image.
- Every exported element has a bounding box and integer version.
- Credential-like key/value scan found no secrets.

## Recorded evidence inputs

- PRD SHA-256: `8c472dbd48a09815f99277c78cd50981ee6b726a986eb695421655a62823be41`
- TDD SHA-256: `34a6ae7143caf1a6db618ac7e1944426d6ead30e474a81e8e7514f77c229de11`
- Prototype metrics SHA-256: `177dd3f44be57b4537da431e774635486a9b676de98a5a93b44d86a405d70c74`
- Customer notes SHA-256: `d585171413170ec49962a0159a8fa0af9876f7a933c4ee17a4a68169f02d1665`
- Design reference SHA-256: `fc6e3cde122eb303678fc036164196f43128933db0b52aebfc1cf90de1b39b34`
- Runtime-visible product-definition bundle SHA-256: `f0e5c5fe0a5c5126a4683a367f85cc7661f14475c964e4cd987f60c612f3f950`
- Runtime-visible customer/design bundle SHA-256: `ab192e8bdfb256d27bb4f7bfb4ffb2175398bc74ee351a150822cb6e8ba908d4`

The prototype metrics file is preserved byte-for-byte as the evidence actually attached during recording. Its measurements reference the preceding release run; the recorded runtime identity above captures the later presentation/export safety hotfix used for the final take.

## Measured web quality and explicit boundaries

- Lighthouse desktop: 99 performance, 100 accessibility, 96 best practices, 100 SEO.
- Lighthouse mobile: 75 performance, 100 accessibility, 96 best practices, 100 SEO.
- This release does not claim user-facing live, bidirectional Google Slides synchronization.
- Browser BYOK prepares local MCP configuration; provider keys are not uploaded to or executed by the hosted browser app.
- NodeSlide uses its own SlideLang-compatible structured JSON IR, not AI Fund's proprietary Slidelang implementation.
