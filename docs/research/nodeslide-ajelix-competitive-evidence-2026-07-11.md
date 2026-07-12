# Ajelix competitive evidence register

Date checked: 2026-07-11
Purpose: constrain NodeSlide positioning and roadmap claims to public, primary evidence
Evidence policy: vendor-authored statements verify what Ajelix publicly claims, not independent performance, reliability, or implementation quality

## Bottom line

Ajelix is credible evidence that users value an outcome-oriented agent which can analyze source material, execute code, and hand back editable business deliverables including PowerPoint files. NodeSlide should not position itself as merely “AI that makes slides”; that category promise is already occupied.

NodeSlide's defensible product thesis is narrower and deeper: a living, auditable deck system with stable objects, source lineage, deterministic validation, scoped and conflict-safe edits, immutable review receipts, brand compilation, reversible versions, and verified multi-format output.

## Evidence table

| Capability or claim | Public primary evidence | Evidence strength | What is not proven | NodeSlide implication |
| --- | --- | --- | --- | --- |
| Outcome-oriented agentic workspace | Ajelix's launch article says users describe an outcome, after which the system analyzes requirements, plans, executes code, and delivers a working artifact. [Ajelix-authored launch article](https://www.linkedin.com/pulse/ajelix-launches-agentic-ai-chat-executes-business-workflows-just-1pssf) | Direct vendor claim | Independent task-success rate, reproducibility, recovery behavior, or human-review semantics | Compete on trustworthy completion, not on the generic word “agentic.” |
| Persistent projects/context | The launch article says its persistent workspace maintains state across sessions and stores data, context, templates, files, and workflows. [Ajelix-authored launch article](https://www.linkedin.com/pulse/ajelix-launches-agentic-ai-chat-executes-business-workflows-just-1pssf) | Direct vendor claim | Retention limits, version semantics, tenant isolation, deletion, export, or conflict behavior | NodeSlide needs explicit, inspectable project state and lifecycle controls rather than a vague memory claim. |
| Plan before execute | The launch article describes autonomous requirements analysis, execution planning, and a “Thinking mode” that breaks down tasks and explains decisions. [Ajelix-authored launch article](https://www.linkedin.com/pulse/ajelix-launches-agentic-ai-chat-executes-business-workflows-just-1pssf) | Direct vendor claim | Whether plans are immutable, complete, causally tied to tool calls, or reviewable before execution | NodeSlide traces must bind plan, tools, snapshot digest, patch, validation, and terminal reason. |
| Sandboxed code execution | Ajelix says it executes Python, VBA, and other scripts in a secure sandbox and tests/validates outputs. [Ajelix-authored launch article](https://www.linkedin.com/pulse/ajelix-launches-agentic-ai-chat-executes-business-workflows-just-1pssf) | Direct technical vendor claim | Isolation model, network policy, resource ceilings, cleanup, vulnerability handling, or validation method | Provider/kernel execution is table stakes. NodeSlide's value is the typed Deck REPL and commit boundary around it. |
| Spreadsheet and data analysis | Ajelix says it creates financial reports, forecasts, dashboards, and Google Sheets artifacts; a later company post says its Sheets agent executes Apps Script, data cleaning, enrichment, analyses, charts, and live-data workflows. [Launch article](https://www.linkedin.com/pulse/ajelix-launches-agentic-ai-chat-executes-business-workflows-just-1pssf), [Ajelix Sheets post](https://www.linkedin.com/posts/ajelix_your-spreadsheet-isnt-the-problem-the-activity-7458153826437496832-kGz2) | Direct vendor claim and product demonstration copy | Accuracy, numerical auditability, data-source licensing, or repeatable calculation lineage | NodeSlide should integrate typed analysis kernels but record input/output digests and source lineage independently. |
| PowerPoint generation | Ajelix says it produces professional PowerPoint presentations and shows a CSV-to-deck flow with charts, tables, executive summary, and recommendations. [Launch article](https://www.linkedin.com/pulse/ajelix-launches-agentic-ai-chat-executes-business-workflows-just-1pssf), [Ajelix CSV-to-PowerPoint post](https://www.linkedin.com/posts/ajelix_your-sales-data-can-build-its-own-powerpoint-activity-7443326417792270336-G0Ce) | Direct vendor claim and demonstration copy | Structural editability at the object level, master/layout quality, round-trip fidelity, accessibility, or edge-case reliability | “Exports PPTX” is not differentiation. NodeSlide must prove native editability and fidelity through artifact inspection. |
| Editable PowerPoint from documents, URLs, and data | Ajelix says PDFs, URLs, and sales data can become narrative decks with speaker notes and that outputs are real editable PowerPoint files. [Ajelix presentation post](https://www.linkedin.com/posts/ajelix_most-people-still-spend-two-to-three-hours-activity-7447645083958648832-cuM-) | Direct vendor claim | Citation completeness, source-to-claim mapping, rights checks, deterministic layout repair, or what “editable” means in complex slides | NodeSlide should show source-linked claims and native object editability, not just state them. |
| Google Slides surface | Ajelix says the same “AI Agent for Work” is available in Sheets, Docs, and Slides. [Ajelix Google Workspace post](https://www.linkedin.com/posts/ajelix_ajelix-ai-agent-now-lives-inside-google-forms-activity-7461053249148608512-Cr92) | Direct vendor claim | Native Slides object support, import/export fidelity, or parity with the web workspace | NodeSlide's Google path should be treated as a tested portability target with explicit capability receipts. |
| Large-file and multi-source ingestion | Ajelix claims support for 1GB+ uploads and live data sources. [Ajelix-authored launch article](https://www.linkedin.com/pulse/ajelix-launches-agentic-ai-chat-executes-business-workflows-just-1pssf) | Direct vendor claim | File-type matrix, actual limits per plan, malware controls, data residency, or source licensing | Avoid a file-size arms race. Lead with bounded, provenance-aware ingestion and clear retention. |
| Multi-model routing | Ajelix says it routes tasks among multiple models. [Ajelix-authored launch article](https://www.linkedin.com/pulse/ajelix-launches-agentic-ai-chat-executes-business-workflows-just-1pssf) | Direct vendor claim | Model identities, routing policy, cost controls, reproducibility, or zero-retention support | NodeSlide should expose resolved provider/model and compare adapters in StoryBench; “multi-model” alone has little moat. |
| Reusable skills | No public primary page reviewed in this pass explicitly documents a reusable, user-installable skill contract. | Not verified | Skill format, versioning, trust, permissions, or reuse semantics | Do not claim Ajelix has a Codex-style skill system without new evidence. NodeSlide may still build reusable deck workflows as its own IP. |
| Brand/template reuse | Persistent templates are claimed, and generated decks are described as formatted, but the reviewed sources do not document a brand-policy compiler or enforcement behavior. | Partial vendor evidence | Token extraction, constraint enforcement, immutable profile revisions, or off-brand blocking | Position NodeSlide signatures/taste packs as explicit, versioned, enforceable policy—not generic template support. |
| Deterministic export fidelity | No reviewed primary source publishes a deterministic fidelity contract or reproducible export benchmark. | Not proven | Stable output across runs, renderer parity, clipping/overflow rates, or round-trip guarantees | Keep NodeSlide's render and artifact proof as a core launch differentiator. |
| Source lineage | Ajelix demonstrates source ingestion, but the reviewed material does not document object/claim-level lineage receipts. | Not proven | Citation closure, retrieval timestamps, license tiers, source digests, or hallucination gates | NodeSlide should preserve claim-to-source lineage through analysis, authoring, export, and publication. |
| Conflict-safe collaboration/version semantics | No reviewed primary source documents element-level clocks, compare-and-swap patches, stale conflict recovery, or immutable publication snapshots. | Not proven | Concurrent edit guarantees and rollback semantics | This remains a strong NodeSlide systems differentiator once identity/membership gates are complete. |

## Positioning decision

Avoid:

- “the first agent that creates complete PowerPoints”;
- “the only AI that runs code for presentations”;
- generic claims that Ajelix cannot analyze data, plan, retain context, or export editable decks;
- unverified claims about Ajelix's internal models, security, quality, or failure rate.

Prefer:

- “The deck remains a typed, source-aware system after generation.”
- “Every automated change is a bounded proposal against exact object versions.”
- “Analysis artifacts become evidence; they never bypass deck validation.”
- “Brand intent is a versioned compiler input, not a one-time theme.”
- “Render, observe, repair, and export are measured against deterministic gates.”
- “Publication is an immutable snapshot with an explicit lifecycle.”

## Re-check triggers

Re-run this register before public launch or whenever Ajelix publishes technical documentation for skills, version history, collaboration, brand enforcement, citations, export fidelity, API contracts, security controls, or benchmark results. Marketing demonstrations should remain labeled as vendor claims until independently reproduced.
