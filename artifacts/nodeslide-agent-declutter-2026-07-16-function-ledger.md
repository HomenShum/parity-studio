# NodeSlide agent chat declutter — function ledger

Mode: SANDBOX DOGFOOD on the disposable local sample. Production remains read-only.

Protected contract: read/write scope, review-before-apply, per-request external-model consent, model choice, tool/context routes, operation/design/reference policies, proposal review, honest failure states, Trace provenance, and version recovery remain available.

| id | selector/component | user promise | capability guard | backing field/action | observed artifact | disposition | preserve/reverify assertion |
|---|---|---|---|---|---|---|---|
| C1 | `.ns-ai-v3-context` | Exact read/write/review boundary | `PRESERVE_CAPABILITY` | `scopeChoice`, selection, review workflow | Local DOM: Reads Slide 01; Writes Whole slide; Review before apply | PRESERVE | Context strip remains visible and named |
| C2 | `.ns-ai-v3-policy-summary` | Repeats operation and review policy | `ORDINARY_CAPABILITY` | Same `operationMode`; review already stated by C1 | Local DOM repeats Full edit and Review first immediately above settings | MERGE | Remove duplicate row; operation remains in settings and review remains in C1 |
| C3 | `.ns-ai-v3-controls-disclosure` | Provider, privacy, scope, and edit policies | `PRESERVE_CAPABILITY` | Provider/scope/policy state setters | Closed local disclosure still exposes option nodes because author CSS forces its body to grid | REPAIR + DEFER | Closed body has zero layout/focusable descendants; open body preserves every control |
| C4 | `.ns-ai-v3-composer-field` | Primary request and submit path | `PRESERVE_CAPABILITY` | `instruction`, submit, model, tools | Composer is visually nested inside a larger stacked form | COMPACT | Textarea remains the first dominant composer control; submit/model/tools remain reachable |
| C5 | `.ns-ai-inline-consent` | Per-request external egress consent | `PRESERVE_CAPABILITY` | `providerConsent` | Two-line bordered panel dominates the idle composer | COMPACT | Exact provider/model and Trace consequence remain visible before external submit |
| C6 | suggested prompts | Fast-start examples | `ORDINARY_CAPABILITY` | Fills instruction only | Existing behavior hides suggestions once conversation exists | DEFER | Suggestions render only before the first durable message |
| C7 | `VisualMaterialWorkbench` | Inspect deterministic visual material | `PRESERVE_CAPABILITY` | Existing OpenUI workbench | Persistent collapsed row competes with conversation | COMPACT | Named workbench remains reachable; collapsed row uses secondary visual weight |
| C8 | assistant transcript/tool details | Durable conversation and honest execution | `PRESERVE_CAPABILITY` | assistant-ui external runtime + durable runs | Messages wrap correctly; tool activity is collapsible | PRESERVE | User, assistant, tool, failure, and proposal states remain rendered and test-covered |
