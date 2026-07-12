# NodeSlide agentic-authoring contract

Status: implementation baseline
Date: 2026-07-11
Applies to: controlled private preview
Public multi-tenant launch: blocked until the gates in this document pass

## Product contract

NodeSlide may use models and isolated analysis runtimes to inspect evidence, plan a deck, propose semantic changes, render candidates, and diagnose quality. None of those systems may directly mutate canonical deck state.

Canonical writes remain NodeSlide-owned, authorized, version-bound, deterministically validated, reviewable, and reversible.

### Goals

- Turn briefs and evidence into audience-specific, editable deck candidates.
- Let an agent inspect a deck through stable semantic objects instead of raw pixels alone.
- Support bounded data analysis without coupling the deck model to one provider's container lifecycle.
- Close the render–observe–repair loop with deterministic stop conditions.
- Preserve source, artifact, model, tool, patch, validation, and human-decision provenance.
- Compare adapters through one license-aware evaluation contract.
- Keep a complete zero-provider, no-egress path for testing and fallback.

### Non-goals

- Arbitrary JavaScript, Python, shell, filesystem, or network access inside the Deck REPL.
- Autonomous acceptance or publication of material changes during private preview.
- Treating provider conversation/container state as the project database.
- Claiming deterministic model output; determinism is enforced at NodeSlide's command, validation, trace, and commit boundaries.
- Training on or redistributing benchmark/source material without exact rights.
- Public anonymous multi-tenant collaboration before identity, membership, lifecycle, and audit gates pass.

## Authority model

```text
brief/evidence
    |
    v
provider planner ---- optional managed analysis kernel
    |                           |
    +------ typed evidence -----+
                 |
                 v
        NodeSlide Deck REPL
                 |
          proposed patch only
                 |
                 v
 deterministic scope + lock + lineage + CAS + quality validation
                 |
          human review/accept
                 |
                 v
       canonical Convex commit
```

The provider may choose commands. The kernel may calculate data. The renderer may produce pixels. The observer may report issues. NodeSlide alone decides whether a proposal is structurally admissible, and an authorized human remains the private-preview acceptance authority.

## Implemented reference contracts

| Contract | Implementation | Current proof |
| --- | --- | --- |
| Provider-neutral Deck REPL | `convex/lib/nodeslideDeckRepl.ts` | Pure semantic executor; immutable snapshot; exact clocks; bounded inspect/find/measure/propose commands; no raw execution or I/O. |
| StoryBench | `convex/lib/nodeslideStoryBench.ts` | Tier A/B/C provenance gates; finite weighted scoring; hard safety/budget gates; matched-case promotion comparison; redacted deterministic reports. |
| Analysis kernel boundary | `convex/lib/nodeslideAnalysisKernel.ts` | Ephemeral session lifecycle; default no egress; consented allowlist contract; resource budgets; cleanup; artifact digests; deterministic local adapter and conformance suite. |
| Provider-managed kernel seam | `convex/lib/nodeslideManagedKernel.ts` | Async injected transport; named OpenAI Code Interpreter adapter; independent kernel/egress authorization; public-host allowlists; budgets, cancellation, cleanup, and collapsed provider errors. No live provider transport is enabled. |
| Render–observe–repair loop | `convex/lib/nodeslideRenderRepairLoop.ts` | Immutable in-memory candidates; injected callbacks; validated exact-clock patches; cycle/no-progress detection; deterministic budgets and terminal reasons. |
| Execution traces and telemetry | `convex/lib/nodeslideExecutionTrace.ts`, `convex/lib/nodeslideAgenticTelemetry.ts` | Explicit mutation validator; digest binding; redaction; TTL/history cap; cohort/adapter aggregation; owner-scoped query. |
| Paired edit-shadow evidence | `convex/lib/nodeslideEditPlanner.ts`, `convex/lib/nodeslideEditShadowPlanner.ts`, `convex/lib/nodeslideShadowComparison.ts` | Existing single-shot behavior extracted from persistence; independent deterministic candidate on the same captured snapshot; input/snapshot/control digests recorded atomically with the baseline trace; canonical operation digests; scheduled two-lane receipt; no candidate operation disclosure or write authority. |
| Operational controls | `convex/lib/nodeslideAgenticControls.ts` | Default-closed global/cohort/provider/kernel/egress/repair/continuation/full-trace/publication switches and exact allowlists. |
| Taste mismatch | `convex/lib/nodeslideTasteMismatch.ts` | Profile/snapshot/render-bound violations, soft-signal provenance, bounded repair candidate, blockers, and human decision receipt. |
| Existing patch/commit boundary | `convex/lib/nodeslidePatches.ts`, `shared/nodeslidePatch.ts`, `convex/nodeslide.ts` | Scope and operation validation, locks, normalized geometry, source closure, element/slide/deck clocks, atomic persistence, immutable versions. |

These pure modules are intentionally usable in CI without Convex deployment, browser automation, a model key, or paid compute.

## Deck REPL protocol

Schema: `nodeslide.deck-repl/v1`

### Inputs

- already-authorized immutable `DeckSnapshot`;
- caller-owned `sessionId` and `traceId`;
- optional expected snapshot digest;
- ordered allowlisted commands;
- requested budget that may only narrow hard limits;
- optional monotonic clock injection for deterministic tests.

### Initial command set

| Command | Purpose | Write authority |
| --- | --- | --- |
| `inspect_deck` | Read bounded deck identity, counts, status, and order. | None |
| `inspect_slide` | Read bounded slide and element summaries. | None |
| `find_elements` | Query stable objects by slide, kind, role, or text. | None |
| `measure_slide` | Calculate deterministic density, lock, source, overlap, and geometry signals. | None |
| `propose_patch` | Validate a typed patch against exact clocks and explicit scope. | Proposal only |

No command accepts source code, a file path, a URL, a process command, SQL, or an unconstrained expression.

### Result

Every command emits a bounded receipt containing command identity, sanitized summary/output, output digest, elapsed time, and byte count. A proposal adds its operation digest and complete clock/scope binding. The session ends with one explicit terminal reason and aggregate usage.

### Budgets

Hard ceilings currently include steps, input bytes, output bytes, operations, and wall time. Requests above a ceiling are rejected instead of silently widened. Production callers may configure lower cohort-specific limits.

## Analysis-kernel adapter protocol

Schema: `nodeslide.analysis-kernel/v1`

### Supported reference jobs

- summarize numeric columns in a bounded table;
- derive delta, cumulative, or percent-change series;
- validate chart labels and series arrays.

The reference adapter performs no eval, shell, filesystem, process, package installation, or network access.

### Managed-adapter boundary

A future provider adapter must implement:

- explicit capability declaration;
- ephemeral `open`, typed `execute`, cooperative `cancel`, and mandatory `cleanup`;
- opaque provider session/container metadata only;
- typed output and artifact metadata;
- no direct database credential or write path;
- the common conformance suite.

OpenAI Code Interpreter or hosted shell can satisfy the execution side of this adapter, but not the Deck REPL, persistence, provenance, validation, or commit side.

### Egress

Network mode defaults to `deny`. An allowlist requires all of:

- an explicit consent receipt;
- one to sixteen normalized public hostnames;
- an adapter that declares network capability;
- workflow-level source and licensing policy;
- telemetry that records destinations but never credentials.

Localhost, `.local`, `.internal`, wildcards, raw IPs, URLs with paths, and duplicate/invalid hosts are rejected by the contract.

### Resource and lifecycle safety

Each session is bounded by wall time, steps, input/output/artifact bytes, and memory tier. Input and output are digest-bound. Artifacts are represented in traces by sanitized names, MIME types, byte sizes, and digests; raw content is not copied into telemetry. Cleanup runs after success, cancellation, budget failure, or adapter exception. Cleanup failure changes the terminal result and blocks promotion.

## Render–observe–repair protocol

Schema: `nodeslide.render-repair/v1`

1. Clone and digest the exact base snapshot.
2. Run deterministic safety/quality validation.
3. If clean, stop without rendering.
4. Render the current candidate through an injected adapter.
5. Bound and digest the artifact; never place raw render data in a receipt.
6. Observe through an injected visual or deterministic adapter.
7. Sanitize, bound, and digest observations.
8. If observation is clean, return the candidate.
9. Request a typed repair proposal against the current snapshot.
10. Enforce exact clocks, scope, locks, operation limits, geometry, lineage, and patch validity.
11. Apply the patch in memory only and record the resulting digest.
12. Stop on clean validation, safety failure, stale state, cycle, repeated observation/no progress, budget exhaustion, malformed proposal, or adapter failure.

The loop returns a candidate and proposal receipts for review. It never calls the persistence layer.

## Trace and provenance contract

A persisted agentic execution trace must contain only bounded, redacted data:

- schema and harness version;
- tenant/deck authorization subject, represented by an internal stable ID rather than a secret;
- session, trace, and optional patch IDs;
- base and candidate snapshot digests;
- exact deck/slide/element clocks;
- provider and resolved model identity;
- kernel/renderer/observer adapter identity and version;
- plan steps and typed command names;
- consent/egress mode and allowed hosts, never headers or tokens;
- input/output/artifact/proposal/validation digests;
- resource usage and budget ceilings;
- deterministic validation issues;
- human decision and resulting committed version, if any;
- cleanup confirmation and terminal reason.

Never persist raw API keys, authorization headers, owner capability values, provider error bodies, unrestricted prompts containing private source material, raw kernel files, or unbounded model reasoning.

### Trace bounds

Production persistence must reject, not truncate ambiguously, records that exceed the contract. Human-readable summaries may be clipped with an explicit `truncated` flag and digest of the full in-memory value. Whole traces have a retention ceiling and deterministic oldest-first eviction only after any required audit/export window.

## Version and commit semantics

- Every tool session reads one immutable snapshot digest.
- Deck-level operations require the exact deck version.
- Touched slides/elements require exact independent clocks.
- A stale candidate stops; the model does not silently regenerate against new state inside the same trace.
- Non-overlapping rebase is allowed only through the existing CAS evaluator and must be recorded.
- Accepted operations create one atomic patch, trace binding, version snapshot, and validation receipt.
- Rejected, failed, cancelled, or budget-exhausted proposals never create a canonical version.
- Publication remains a separate explicit action over a clean, immutable snapshot.

## Threat model

| Threat | Required control |
| --- | --- |
| Prompt injection in source files or web content | Treat all source content as data; no instruction inheritance; typed tools only; no implicit egress; source provenance and isolation. |
| Provider emits out-of-scope or destructive operations | Runtime parsing, explicit scope, lock checks, operation allowlist/limit, exact clocks, deterministic validator. |
| Kernel exfiltrates data | Default no network, consented hostname allowlist, no credentials in job payload, adapter isolation, bounded artifacts, cleanup. |
| Cross-tenant/deck access | Server-side identity/membership and owner capability verification before loading a snapshot; never authorize from client-supplied deck IDs alone. |
| Secret/error leakage | Collapse upstream errors; redact receipts/telemetry; prohibit headers/tokens/raw exception payloads. |
| Infinite or expensive loops | Hard attempts, steps, wall time, bytes, operations, token/cost quotas; cancel and clean every terminal path. |
| Visual repair oscillation | Semantic snapshot digest, cycle set, repeated-observation no-progress threshold. |
| Unlicensed benchmark/source use | Tier registry, exact-file manifests, quarantined-material block, by-reference mode, no training/redistribution inference. |
| Fake evaluation improvement | Matched cases, complete dimensions, hard gates, finite scores, explicit minimum effect, no statistical-significance claim, frozen harness/adapter versions. |
| Autonomous unsafe publication | Human review for material changes, deterministic publish gate, immutable publication snapshot, explicit revoke/republish lifecycle. |

## StoryBench promotion contract

Schema: `nodeslide.storybench/v1`

Dimensions:

- task completion;
- narrative coherence;
- evidence/lineage;
- native editability;
- visual integrity/overflow;
- version safety;
- latency efficiency;
- cost efficiency.

Hard safety gates:

- scope safe;
- version safe;
- no secret leak;
- no unauthorized egress;
- artifact safe;
- cleanup confirmed.

An adapter cannot be promoted when any case is quarantined or lacks provenance, any matched case is incomplete, safety/cleanup fails, a budget is exceeded, required scores/evidence are absent, the mean regresses, or a gated dimension regresses beyond tolerance. A small positive difference below the declared threshold is a hold, not a win. Results are directional matched-case evidence and never presented as statistical significance without a separately designed study.

## Taste-mismatch tooling contract

Taste should be treated as an inspectable mismatch between a versioned target profile and a candidate—not as an unexplained model preference.

A taste-mismatch receipt must identify:

- target signature profile ID and full immutable digest;
- candidate snapshot and render digests;
- deterministic violations (colors, fonts, type scale, background, spacing, density, export capability);
- observed but non-enforced soft preferences with confidence and provenance;
- the smallest bounded repair proposal;
- whether the repair is blocked by source, scope, lock, readability, or accessibility policy;
- human accept/reject/choose decision for preference learning.

No taste signal may override factual accuracy, source lineage, accessibility, or explicit brand constraints.

## Telemetry and operational controls

Required counters/histograms by cohort and adapter:

- requests, completions, terminal reasons, cancellations, and cleanup failures;
- step/attempt/operation/input/output/artifact usage;
- provider tokens, cost, latency, resolved model, retries/fallbacks;
- patch validation rejection categories and stale-conflict rates;
- render/observation issue categories, cycles, and no-progress stops;
- human accept/reject/edit-after-accept decisions;
- export validation and publication-gate outcomes;
- StoryBench score and hard-gate deltas by frozen harness version.

Required kill switches:

- global agentic execution;
- per-provider planning;
- per-kernel adapter;
- all network egress;
- render/observe/repair loop;
- automatic multi-step continuation;
- trace persistence beyond minimal safety receipts;
- cohort admission;
- publication.

Every kill switch defaults closed when configuration is absent or malformed.

Implemented environment mapping:

| Capability | Environment control |
| --- | --- |
| Global agentic execution | `NODESLIDE_AGENTIC_GLOBAL_ENABLED` |
| R1 cohort admission | `NODESLIDE_AGENTIC_SHADOW_ENABLED` |
| Provider planning | `NODESLIDE_AGENTIC_PROVIDER_PLANNING_ENABLED` plus `NODESLIDE_AGENTIC_PROVIDER_ALLOWLIST` |
| Analysis kernels | `NODESLIDE_AGENTIC_KERNEL_ENABLED` plus `NODESLIDE_AGENTIC_KERNEL_ALLOWLIST` |
| All network egress | `NODESLIDE_AGENTIC_NETWORK_EGRESS_ENABLED` |
| Render–observe–repair | `NODESLIDE_AGENTIC_RENDER_REPAIR_ENABLED` |
| Automatic continuation | `NODESLIDE_AGENTIC_AUTO_CONTINUATION_ENABLED` |
| Persistence beyond minimal safety receipts | `NODESLIDE_AGENTIC_FULL_TRACE_ENABLED` |
| Agentic publication | `NODESLIDE_AGENTIC_PUBLICATION_ENABLED` |

Only the exact lowercase string `true` enables a boolean control. Provider/kernel allowlists are bounded, normalized, exact-match lists; a malformed entry closes the entire list. R1 requires both global execution and cohort admission. In this milestone, cohort admission is deployment-wide: enabling both flags shadows every successful baseline edit in that isolated private-preview deployment. Per-actor/deck bucketing is a later rollout control and must exist before a shared deployment is treated as cohort-safe. Minimal bounded safety receipts remain mandatory; disabling full trace persistence never disables the safety receipt.

## Rollout

### R0 — local/CI reference path

- Deterministic Deck REPL, StoryBench, local analysis kernel, and repair-loop fixtures.
- No provider key, persistence, network, or user-visible controls.
- Required before every later stage.

### R1 — private-preview shadow traces

- The existing single-shot edit planner remains the sole user-visible proposal lane.
- A separate deterministic planner generates at most one typed candidate command without consuming baseline operations or provider output.
- Both lanes receive clones of one owner-authorized snapshot and the same normalized request/clocks.
- The candidate executes only through the pure Deck REPL and never crosses a patch/commit mutation boundary.
- Record whether a comparison is expected plus its input/snapshot/control bindings atomically with the baseline trace, so missing scheduled rows are observable rather than silently excluded.
- Schedule a dedicated bounded comparison receipt containing lane identities, outcomes, counts, and canonical digests only; do not expose candidate operations or acceptance UI.
- Do not schedule a pair for a baseline that fresh persistence marks stale. Candidate planning, execution, scheduling, or later comparison-persistence failure must not change or abort the already-persisted baseline proposal.

### R2 — reviewed Deck REPL proposals

- Small internal/founder cohort.
- Human review required for every proposal.
- No managed kernel, no egress, no autonomous continuation after stale state.

### R3 — deterministic analysis kernel

- Enable typed table/chart jobs only.
- Require conformance, cleanup, quotas, artifact bounds, and StoryBench non-regression.

### R4 — provider-managed kernel cohort

- Explicit disclosure and opt-in.
- Network denied; any source-enabled workflow requires separate consent and allowlist.
- Cost ceiling and provider kill switch.
- Adapter must pass the same conformance and StoryBench gates.

### R5 — render–observe–repair cohort

- Start with one repair attempt and human review.
- Raise limits only with cycle/no-progress, latency, cost, and acceptance evidence.
- No automatic publication.

### R6 — controlled launch

- Operations runbook, dashboards, alerts, retention jobs, incident response, and rollback verified.
- Founder, investor, technical-strategy, and data-grounded dogfood decks pass artifact and live-browser QA.
- Independent security/product/reliability audit reports no P0/P1/P2 private-preview blocker.

## Explicit public multi-tenant blockers

Public launch remains **NO-GO** until all are implemented and independently verified:

- account identity, organization/tenant membership, roles, invitations, and authorization revocation;
- server-side deck ownership/membership checks on every read/write/action, not bearer capability alone;
- account-backed migration, archive, export, deletion, retention, and privacy workflows;
- share expiry, audience controls, access logs, abuse controls, and capability rotation policy;
- per-tenant quotas, billing/cost attribution, provider policy, and zero-retention/data-residency choices;
- durable bounded trace schema, retention/eviction jobs, audit export, and telemetry dashboards;
- managed-kernel isolation, patching, abuse testing, cancellation, cleanup, malware/artifact handling, and incident kill switch;
- source ingestion policy, prompt-injection defenses, license manifests, and user data deletion propagation;
- accessibility, export fidelity, browser/device support, disaster recovery, and operational SLOs;
- terms, privacy notice, subprocessors, consent copy, support escalation, and incident-response ownership.

The current access-code/owner-capability private preview is intentionally not represented as a substitute for these controls.

## Exit criteria

Agentic authoring is launchable to a controlled cohort only when:

1. the no-provider reference path is green;
2. every enabled adapter passes conformance and cleanup tests;
3. StoryBench shows no hard-gate or material quality regression;
4. trace persistence is bounded and redacted;
5. cost/latency quotas and kill switches are exercised in production-like staging;
6. stale, concurrent, cancelled, malformed, adversarial-source, and unavailable-provider paths are proven;
7. native PPTX/HTML exports and live presenter behavior are visually verified;
8. a human can understand what happened, what data left the system, what changed, and how to undo it;
9. the independent release audit is recorded;
10. any unresolved public multi-tenant blocker remains explicitly gated rather than waived.
