# Advanced-controls declutter ledger

| id | selector/component | user promise | capability guard | backing field/action | observed artifact | disposition | preserve/reverify assertion |
|---|---|---|---|---|---|---|---|
| C1 | `.ns-ai-turbo-details` status | Exact session change authority | `PRESERVE_CAPABILITY` | `approvalMode`, `approvalExpiresAt`, `onApprovalModeChange` | Desktop/mobile advanced-control pixels | COMPACT | `Session change authority` and active/off state remain visible |
| C2 | authority limit paragraph | Expiry, use limit, operation limit, and exclusions | `PRESERVE_CAPABILITY` | delegation constants | Paragraph occupies most of the overlay before controls | DEFER | Named `Limits and exclusions` disclosure reveals all constants and excluded actions |
| C3 | `.ns-scope-row` | Exact write scope | `PRESERVE_CAPABILITY` | `scopeChoice` and `chooseScope` | Desktop/mobile advanced-control pixels | PRESERVE | Deck / This slide / Selection remain reachable |
| C4 | `.ns-ai-policy-grid select` | Operation, design, and reference policies | `PRESERVE_CAPABILITY` | component state included in request | Desktop/mobile advanced-control pixels | PRESERVE | All three selects remain enabled and labeled |
| C5 | `[data-testid="ai-run-spend-limit"]` | Hard run spend ceiling | `PRESERVE_CAPABILITY` | `maxCostUsd` durable request field | New capability in this pass | PRESERVE | Field remains labeled and submit binds numeric value |
| C6 | route summary consent state | Provider/model/effort/consent truth | `PRESERVE_CAPABILITY` | provider selection and session consent | Desktop/mobile advanced-control pixels | PRESERVE | Provider, model, effort, and consent-required state remain visible |
