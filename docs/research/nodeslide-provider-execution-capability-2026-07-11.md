# NodeSlide provider execution capability register

Date: 2026-07-11
Decision owner: NodeSlide
Status: evidence freeze for agentic-authoring implementation

## Executive answer

Yes, some provider platforms already expose hosted code execution that can accelerate NodeSlide's analysis workflows. No, the provider path NodeSlide uses today does not give the product a persistent, deck-aware REPL.

The durable architecture is therefore:

1. NodeSlide owns a provider-neutral **Deck REPL protocol**: bounded commands over a versioned deck snapshot, deterministic validation, provenance, review, and compare-and-swap commit.
2. The initial free path executes only NodeSlide's own deterministic, no-network deck operations and remains useful without any paid provider.
3. Optional **analysis-kernel adapters** can use a NodeSlide-managed sandbox or a provider-managed container for Python/shell work. Kernel output is evidence or an artifact, never an authoritative deck mutation.
4. Every proposed deck change still crosses NodeSlide's existing patch validator and human-review boundary.

This preserves portability and auditability while letting managed kernels add value where they are genuinely stronger: data cleaning, calculations, chart data, document parsing, and artifact generation.

## What is wired today

| Layer | Current behavior | Execution consequence |
| --- | --- | --- |
| Brief generation | `convex/lib/nodeslideProvider.ts` routes one completion through `openrouter/openrouter/free`, parses a JSON envelope, and collapses upstream errors. | Text/JSON planning only; no tool definitions or tool loop. |
| Bounded edits | `convex/nodeslideAgent.ts` asks for at most eight scoped operations, validates them, and falls back deterministically. | The model proposes JSON; NodeSlide performs and validates the mutation. |
| Variations | `convex/nodeslideVariationProvider.ts` makes one strict-JSON completion with no tools and a seven-second total deadline. | No persistent session and no code execution. |
| SDK abstraction | `@mariozechner/pi-ai@0.73.1` supports model tool-call messages and argument validation, but its own README explicitly demonstrates application-side execution and continuation. | The library can carry a Deck REPL tool schema, but it is not the REPL or sandbox. |
| Persistence | Decks, patches, versions, traces, and publication snapshots are NodeSlide-owned Convex records. | This is the correct authority boundary for agentic execution. |

The locked package version is also marked deprecated in `pnpm-lock.yaml` in favor of `@earendil-works/pi-ai`. Migration is a separately testable dependency-maintenance item; it is not required to define the Deck REPL contract.

## Primary-source capability matrix

| Platform/capability | Verified fact | What it does **not** prove | NodeSlide use |
| --- | --- | --- | --- |
| OpenAI Code Interpreter | The Responses API can let models write and run Python in a sandboxed container. Explicit containers can be created with a memory limit and supplied to later responses. Containers are ephemeral and expire after inactivity; OpenAI recommends storing required data in the application's own systems. [Official guide](https://developers.openai.com/api/docs/guides/tools-code-interpreter) | It is not a durable NodeSlide project store, deck transaction system, lineage model, or brand/quality validator. | Optional managed Python adapter for analysis and artifact production. Always import outputs back into NodeSlide-owned evidence records. |
| OpenAI hosted shell | The Responses API can run commands in OpenAI-managed hosted containers or request commands for an application-hosted local runtime. Hosted shell has no interactive TTY or `sudo`; artifacts can be retrieved from `/mnt/data`. [Official guide](https://developers.openai.com/api/docs/guides/tools-shell) | It does not make arbitrary execution safe by default and does not know NodeSlide's semantic patch rules. | Optional managed shell adapter for deterministic transforms that need installed tooling. Keep it feature-gated and task-specific. |
| OpenAI hosted-shell network policy | Hosted containers have no outbound network access by default. Enabling access requires an organization allowlist and an explicit request policy; the official guide calls out security and data-governance risk. [Official guide, network access](https://developers.openai.com/api/docs/guides/tools-shell#network-access) | An allowlist is not user consent, tenant authorization, source licensing, or proof that returned content is trustworthy. | Match NodeSlide's default-no-egress policy. Require explicit consent plus a narrow destination allowlist before an adapter enables network access. |
| OpenAI conversation state | The Conversations API can persist messages, tool calls, and tool outputs under a durable identifier across sessions, devices, or jobs. Responses can also be chained with `previous_response_id`. [Official guide](https://developers.openai.com/api/docs/guides/conversation-state) | Provider conversation state is not the canonical deck, execution ledger, or retention policy. Stored provider context also creates lifecycle and governance obligations. | Useful adapter state, never canonical state. NodeSlide records the provider conversation/container reference and its lifecycle status without depending on it for recovery. |
| OpenAI function calling | Function tools are JSON-schema-described requests. The application executes its own function and returns the output; built-in tools are separate platform capabilities. [Official guide](https://developers.openai.com/api/docs/guides/function-calling) | A valid tool call is not successful execution, authorization, validation, or commit. | Natural transport for Deck REPL commands when an OpenAI model is selected. NodeSlide validates arguments and results independently. |
| OpenRouter user-defined tools | OpenRouter standardizes tool calling across supported models, but the model suggests a tool and the application executes it. Tool support varies by model/provider and is filterable. [Official guide](https://openrouter.ai/docs/guides/features/tool-calling) | It does not supply a general REPL or execution environment. The zero-cost router is not documented as a stable tool-capable model contract. | Can transport Deck REPL tool calls after NodeSlide requires tool-capable routes and validates every call. Do not assume `openrouter/free` supports the contract. |
| OpenRouter provider routing | `require_parameters` can restrict routing to providers that support all requested parameters; fallbacks and data-collection/ZDR preferences are configurable. [Official guide](https://openrouter.ai/docs/guides/routing/provider-selection) | Parameter support does not guarantee semantic correctness or execution safety. | If the free route is later allowed to call tools, require tool parameters and record the resolved model/provider. Keep deterministic fallback. |
| OpenRouter server tools | OpenRouter currently documents server-side web search/fetch, datetime, image generation, apply patch, fusion, advisor, and subagent tools. The server executes these tools transparently. The feature is beta. [Official guide](https://openrouter.ai/docs/guides/features/server-tools/overview) | The published catalog does not list a general shell or code-interpreter server tool. `apply_patch` proposes file changes; it is not arbitrary code execution and is Responses-API-only. | Potential future research/subagent adapters, separately consented and provenance-tagged. Not the foundation for Deck REPL execution. |
| OpenRouter tool reliability | OpenRouter says tool-call success influences provider ordering and publishes a tool-call error-rate signal. [Official guide](https://openrouter.ai/docs/guides/routing/auto-exacto) | Schema-valid calls are not necessarily correct, safe, or consistent enough for deck commits. | Useful routing telemetry only. StoryBench must score semantic outcomes and NodeSlide validation independently. |
| `pi-ai` in this repository | The installed README defines `Context.tools`, emits tool calls, validates arguments, and demonstrates that application code executes the tool and sends a `toolResult` in a continuation. | The SDK does not implement sandboxing, authorization, budgets, persistence, or NodeSlide semantics. | Reusable transport for the first provider-neutral tool loop, subject to the package migration decision. |

## Architecture decision

### Authority boundaries

- **Provider model:** proposes a plan or a typed Deck REPL command.
- **Kernel adapter:** performs bounded analysis in an isolated session and returns typed evidence/artifacts.
- **Deck REPL executor:** reads an immutable snapshot, executes only allowlisted semantic commands, enforces budgets, and emits a proposed patch plus trace.
- **NodeSlide validator:** verifies scope, IDs, locks, geometry, lineage closure, brand/quality policy, and version clocks.
- **Human reviewer:** accepts or rejects material changes during private preview.
- **Convex:** remains the canonical persistence and compare-and-swap boundary.

Provider conversation IDs and container IDs are adapter metadata. They are never stable deck identifiers and never substitute for NodeSlide trace IDs.

### Free-first execution ladder

| Stage | Runtime | Egress | Cost expectation | Launch posture |
| --- | --- | --- | --- | --- |
| F0 | Pure deterministic Deck REPL over an in-memory snapshot | None | Zero provider cost | Default and required fallback. |
| F1 | `openrouter/free` planner with application-executed Deck REPL tools | None from the executor | Zero inference route when available | Experiment only until tool-capable routing and reliability pass StoryBench. |
| K1 | NodeSlide-managed isolated analysis kernel | Denied by default | Infrastructure cost | Private-preview flag after isolation, quotas, cleanup, and abuse tests pass. |
| K2 | OpenAI Code Interpreter or hosted shell adapter | Denied by default; explicit narrow allowlist if needed | Provider tool/container cost | Opt-in private-preview cohort with explicit disclosure and telemetry. |
| K3 | Other provider-managed kernels | Provider-specific | Provider-specific | Add only through the same conformance suite; never branch deck semantics per provider. |

### Why the Deck REPL is not raw JavaScript or Python

The core REPL is a typed command language over deck objects, not arbitrary code. Initial commands should be semantic and bounded, for example:

- inspect deck/slide/element summaries;
- query elements by stable ID and role;
- calculate deterministic layout or text-density metrics;
- propose text, style, chart-data, and geometry operations already accepted by the patch validator;
- render a candidate and request machine observations;
- compare candidate metrics to the base snapshot;
- submit a proposed patch against exact deck/slide/element clocks.

Python or shell may generate data and artifacts, but it cannot write Convex or bypass the semantic command layer.

## Implementation implications

1. Add a provider-neutral command/result schema and a deterministic executor before adding any managed kernel.
2. Persist a bounded execution trace with redacted arguments, snapshot digest, budgets, adapter identity, resolved provider/model, artifact digests, observation results, and terminal reason.
3. Make session termination deterministic: step, time, output-byte, artifact-byte, and repair-attempt ceilings; cancel on stale version; cleanup on every terminal path.
4. Keep network disabled unless the user explicitly selects a source-enabled workflow. Record consent, allowed destinations, source URLs, retrieval time, and license tier.
5. Treat kernel output as untrusted input. Parse, size-check, malware-scan where applicable, hash, and validate before it reaches deck semantics.
6. Maintain a no-provider acceptance test: all core Deck REPL conformance and repair-loop tests must pass with deterministic fixtures and no API key.
7. Measure optional adapters against the same StoryBench cases. Promote an adapter only when it improves task success without regressing safety, reproducibility, latency, or cost ceilings.

## Claim discipline

- **Verified:** the linked primary documentation or current repository code directly supports the statement.
- **Inferred:** a plausible integration path, explicitly labeled as design rather than current capability.
- **Not claimed:** that any provider's hosted execution already understands NodeSlide, guarantees persistent state, offers deterministic PPTX fidelity, preserves source lineage, enforces brand policy, or implements element-level compare-and-swap semantics.

## Decision record

Adopt the provider-neutral Deck REPL and adapter boundary. Implement F0 first, then evaluate F1. Build K1/K2 adapters behind one conformance contract. Do not couple NodeSlide's canonical state or launch safety to OpenRouter, OpenAI, `pi-ai`, or any provider-managed container lifecycle.
