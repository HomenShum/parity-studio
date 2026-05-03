# Walkthrough scripts — admin, interviewer, end-user

**Date:** 2026-05-02
**Use:** when demoing the parity-studio + open-codesign #241 work to one of
three audiences. Each script is sequenced (talking beats + what to show +
what to avoid), timed for ~5 min, with Q&A prep at the end.

---

## Pre-flight (do once before any walkthrough)

Have these tabs / files open and ready:

- **Demo MP4** — `runs/demo-2026-04-29-fast.mp4` (2:54, gif-style fast play)
  - Or `runs/demo-2026-04-29-fast-720.gif` for embedded play
- **PR #241** — https://github.com/OpenCoworkAI/open-codesign/pull/241
- **Issue #225** — https://github.com/OpenCoworkAI/open-codesign/issues/225
- **parity-studio repo** — https://github.com/HomenShum/parity-studio
- **Live web app** — https://parity-studio.vercel.app/
- **Eval write-up** — `parity-studio/docs/plans/2026-04-29-free-model-eval.md`
- **autoRouter source of truth** — `parity-studio/convex/lib/autoRouter.ts`
- **Source image** — any UI screenshot (the composer dogfood PNG works fine)
- **A populated RUN_ID** from the prod backend (grab via `parity_run_listRecent`)

The demo MP4 is the single most efficient artifact — if a session is
short, play that first then narrate over it.

---

## 1. Admin walkthrough — for an OpenCoworkAI maintainer (~5 min)

### Goal

They walk away **comfortable approving PR #241** because they understand:
(a) what it ships, (b) what its blast radius is, (c) what review history
the bot already validated, and (d) why it's safe to merge today.

### Sequence

**Beat 1 (0:00–0:30) — Frame the ask**
> "PR #241 is Phase 1 of issue #225 — image → componentized `ui_kits/<slug>/`
> bundle for coding-agent handoff. It's been through three rounds of
> automated review. The latest bot review says 'no new issues, all
> previous findings resolved, mergeable.' Mergeable + clean. I'd like
> 5 minutes to walk you through what's in it and what's not, then you
> can decide."

What to show: the PR header card on GitHub. Highlight `Mergeable`, `Clean`, `13 commits`, `+2626/-3`.

**Beat 2 (0:30–1:30) — What it actually does**

Open `packages/core/src/tools/`. Three new tools:
- `decompose-to-ui-kit.ts` — orchestrator, single atomic call, emits the kit
- `verify-ui-kit-parity.ts` — deterministic verifier, no LLM, no cost (element-count parity, visible-text coverage, token coverage, returns `passCount/totalChecks` with no fabricated floats)
- `verify-ui-kit-visual-parity.ts` — vision-LLM judge wrapper, 12-check boolean rubric across 5 dimensions, optional (returns `unavailable` when host doesn't wire the callback)

> "Pattern mirrors `generate-image-asset.ts` exactly. Host injects
> callbacks for the heavy stuff, the core stays pure. No new prod deps,
> no SQLite schema change. Output is in-memory via the Files panel — same
> primitive you already maintain."

**Beat 3 (1:30–2:30) — Honest scoring (their differentiation point)**

Open `verify-ui-kit-parity.ts` and show the `ParityReport` interface.
> "Every check returns `{passed: boolean}`. The score is `passCount /
> totalChecks` — a derivation, not an LLM-fabricated float. A check failed
> = the score drops by exactly `1/totalChecks`. No fudging, no rounding,
> no 'looked good overall' rubber-stamping. Same primitive your repo
> already uses; this PR just extends it to UI parity."

This is the language the maintainer will recognize as theirs.

**Beat 4 (2:30–3:30) — Review trail + safety**

Open the PR's Files Changed → review tab. Walk:
> "Three rounds of bot review. Round 1 (commit 8cf6797) flagged 4 Major
> findings — loop logic bug, missing source.png in FS, no judge fallback,
> 'Closes #225' too aggressive. Round 2 (fe42888) flagged 3 Minor + 1
> stale-diff false alarm — fork image URLs, 3 changesets where one is
> convention, case-sensitive base64. Round 3 (e10ef3b) flagged 2 Minor
> + 1 nit — abort listener leak, duplicate STANDARD_CHECKS, maxTokens=8000.
> All addressed. Latest bot review on e10ef3b says 'no new issues.'"

Show the `e10ef3b` review body — the ✅ ✅ ✅ list speaks for itself.

**Beat 5 (3:30–4:30) — Blast radius if you merge today**

> "If something breaks in production: the entire feature is gated behind
> a single sidebar button ('Decompose to UI Kit') that's disabled when
> there's no artifact. Deleting the button removes the entire surface in
> one revert. The three new tools live in their own files in
> `packages/core/src/tools/` — no edits to existing tools. Host wiring
> in `apps/desktop/src/main/render-ui-kit.ts` and `judge-visual-parity.ts`
> are new files. Nothing on the hot path is touched."

> "Cost: zero unless the user clicks the button. When they do: one
> decompose call (depends on model), then two verifiers. Deterministic
> verifier is free (no LLM). Visual verifier is opt-in via host callback;
> if not wired, it returns `unavailable` and the agent proceeds with the
> deterministic report alone."

**Beat 6 (4:30–5:00) — Close**

> "Phase 2 (component → prototype workflow) is intentionally NOT in this
> PR — that's why the changeset says `Refs #225`, not `Closes #225`. Phase 2
> needs cross-page flows + state machines, separate sprint. This PR ships
> a clean primitive that Phase 2 can build on."

> "I've also stood up a productized standalone at parity-studio.vercel.app
> using the same primitive — happy to walk you through that next, or you
> can just merge this and I'll keep the upstream + standalone in lockstep."

### Q&A prep (admin)

| Q | A |
|---|---|
| "Why three changesets originally?" | Author oversight on the first cut; consolidated to one in `fe42888` per project convention. |
| "Why merge upstream/main vs rebase?" | Branch was 25 behind / 11 ahead. Merge preserves the 11 PR commits' history and resolves only 2 README conflicts. Rebase risked 20+ file conflicts on shared `.github/` infra. Maintainer can squash on accept if preferred. |
| "Can you split the README image asset commits out?" | Yes if you want — they're commits `9fc585a`, `2f6f850`. They demonstrate the feature visually but aren't required for merge. |
| "Cost when visual verifier IS wired?" | Per `BENCHMARKS.md`: ~$0.02–0.05 per visual judge call with Gemini 3.1 Pro Preview. Surfaced as a toast each time so users see the cost. |

### Anti-patterns (don't say to admin)

- Don't pitch parity-studio as a competitor — it's the productized standalone, frame as complementary
- Don't apologize for review iterations; bot review found real bugs and that's the system working
- Don't lean on "the bot says it's good" as the only argument — they want to understand the code

---

## 2. Interviewer walkthrough — for a senior AI agent engineer role (~5–7 min)

### Goal

They walk away **convinced you can ship agentic systems end-to-end**: spot
the right primitive, ship a Phase 1 cleanly, take review seriously, and
productize the result. The story IS the answer.

### Sequence

**Beat 1 (0:00–0:30) — The arc in one sentence**

> "Someone opened issue #225 in OpenCoworkAI/open-codesign asking 'image
> generation is great, but what we actually need is image → componentized
> → prototype.' I shipped Phase 1 as PR #241, took three rounds of bot
> review to land cleanly, then spun out the same primitive as a
> standalone web app called parity-studio with a v0.1.0 MCP server so
> Claude Code / Cursor / Windsurf can drive it. Today: PR mergeable,
> standalone live, MCP published."

**Beat 2 (0:30–1:30) — Spot the primitive**

> "The mistake to avoid here is generating a *score* — LLM-judged 0.87 means
> nothing because the LLM picked the number. So the primitive I shipped is
> a **boolean rubric**: 12 yes/no checks across 5 dimensions (layout, color,
> typography, content, components). The aggregate score is `passCount /
> totalChecks` — a derivation, not a generation. A failed check drops the
> score by exactly `1/totalChecks`. Same shape OpenCoworkAI uses internally,
> just extended to UI parity. Boolean-per-dimension is the only way to make
> a self-verifying loop honest."

What to show: `verify-ui-kit-visual-parity.ts:80–175` with the 12 checks
and the derivation logic.

**Beat 3 (1:30–2:30) — Verify-and-iterate loop**

> "Once you have a boolean rubric, the loop builds itself. Decompose →
> verify (deterministic + visual) → reconcile gaps → iterate at most twice
> → done with HONEST cost summary. The agent is told: don't hide cost,
> don't inflate scores, failed checks count as failed."

> "Originally the loop had a bug — the prompt told the agent to succeed
> when both verifiers returned `verified|needs_review`, but the
> deterministic verifier only emits `ok|needs_iteration`. So success
> could never trigger on the first pass. The bot caught it. Fix was
> updating the prompt to use each verifier's actual vocabulary. This is
> exactly the kind of vocabulary drift that LLM-driven loops fail on
> silently."

**Beat 4 (2:30–3:30) — Productize alongside upstream**

> "Two things I learned about open-source contribution from this:
> (1) when you fix the upstream PR, also stand up a standalone — it's the
> demo for the upstream. (2) the standalone's job isn't to compete; it's
> to remove every blocker between 'someone reads the issue thread' and
> 'someone has the working tool in their hands.' open-codesign requires
> a desktop install. parity-studio is a browser tab. Same primitive,
> different friction profile."

What to show: `parity-studio/convex/lib/autoRouter.ts` — the 4-tier ×
7-phase routing matrix.

> "The standalone added two things the upstream doesn't have yet: a
> Kilo-style ✨ enhance prompt button, and a 4-tier auto router
> (frontier / balanced / free / small). Each tier × phase cell picks a
> different model. Free tier converges on `inclusionai/ling-2.6-1t:free`
> for everything. **Free model outscored paid haiku-4-5 and sonnet-4-5
> on parity-studio's actual tool surface — 15/15 vs 14/15.** Same eval
> harness, same 5 queries, real measurement. The headline is in the
> commit `76b5f06`."

This is the moment that reads as "this person actually measures."

**Beat 5 (3:30–4:30) — Agentic reliability discipline**

> "Three reliability lessons I baked in:
> (1) **OpenRouter rate-limit hardening** — pi-ai's wrapper now sends
> attribution headers + retries the 200-with-error-body case OR uses
> for upstream 429s. Lifted gemma-4-26b free pass rate from 20% → 60%
> with zero changes to the routing table.
> (2) **Honest status** — visual verifier returns structured `unavailable`
> on render/judge failures instead of throwing. The original PR had this
> bug; bot caught it; fix wraps both awaits in try/catch.
> (3) **Resource cleanup** — abort listener was registered once but
> removed only on the success path. Centralized cleanup in `finish()`
> so every exit path (success, fail, catch, timeout, abort) drops the
> timeout AND removes the listener. Single source of truth, no path
> can forget."

**Beat 6 (4:30–5:30) — MCP-first distribution**

> "v0.1.0 of the MCP server ships 6 hosted-Convex tools so Claude Code
> can drive the entire pipeline over MCP — `parity_chat_send`,
> `parity_chat_advise`, `parity_enhance_prompt`, `parity_run_listRecent`,
> `parity_chat_history`, `parity_export`. No local API keys; all calls
> go to a hosted Convex deployment. The dashboard auto-opens in the
> browser the first time the agent calls a tool — you watch the pipeline
> run live with parity score climbing, cost meter, file tree streaming."

What to show: scene 3 of the demo MP4 (or `runs/recording-mcp-...`).

**Beat 7 (5:30–6:30) — End-to-end demo (90 seconds)**

Play the demo MP4 (2:54 sped up). Narrate over it:
> "Scene 1 — upload a UI screenshot, watch the pipeline. Scene 2 — the
> v0.1.0 chat features: rough draft, ✨ enhance rewrites it via the small
> model, tier cycle Balanced → Frontier → Free, send, agent replies with
> a multi-bullet plan. Scene 3 — the MCP tools running from Claude Code's
> perspective, with the FREE tier showing $0.0000 cost."

### Q&A prep (interviewer)

| Q | A |
|---|---|
| "Why is `ling-2.6-1t:free` outperforming paid models?" | On OUR specific tool surface (5 queries that REQUIRE tool calls). Not a general statement. The eval harness is in `scripts/eval-free-models.mjs` — reproducible. The paid models occasionally reached for the wrong tool first; ling followed the instruction literally. Could be over-fit to literal instructions, could be a real win for tool calling. Either way: measured, not asserted. |
| "What's the failure mode when the free model rate-limits?" | Fallback chain in `sessionPick()` — 88% of sessions stay on primary, 12% degrade to paid haiku ($0.001/call). Better to spend a fraction of a cent than serve a broken empty response. The previous attempt used another `:free` model as fallback; that model was deprecated to paid silently. Lesson: don't chain free fallbacks; degrade to paid. |
| "How do you verify your changes when working on someone else's repo?" | Three layers. (1) The bot review — actually surprisingly good, caught real bugs across all 3 rounds. (2) Pre-push hook — typecheck (node + web tsconfig under `exactOptionalPropertyTypes: true`), tests, biome lint. (3) The conflict-handling discipline — verified file overlap before deciding rebase vs merge. Chose merge to preserve PR commit history; resolved 2 README conflicts where I had to keep both upstream AND PR-branch entries. |
| "What would you build next?" | Phase 2 of #225 — multi-page flows + state machines + prototype orchestration. The bot called out a residual risk: `source.png` is seeded once on initial generate, so if the agent FS is reused across separate generations the image goes stale. Phase 2 should re-seed on each decompose trigger. Also worth: vertical (1080×1920) cut of the demo for social distribution, and self-dogfooding the parity-studio landing page generation. |

### Anti-patterns (don't say to interviewer)

- Don't lead with the demo video — earn it with the storyline first
- Don't recite the autoRouter file's contents; show + paraphrase
- Don't say "I built parity-studio because the upstream PR was stuck" — true but reads as bitter; instead say "I shipped the upstream PR + the productized standalone in parallel"
- Don't bury the headline; "free model beat paid sonnet" should land in the first 3 minutes

---

## 3. End-user walkthrough — for someone like chenjunyu-1990 (~3–4 min)

### Goal

They walk away **with a working `ui_kit/` exported and handed to Claude
Code**, having done it themselves on a real screenshot.

### Sequence

**Beat 1 (0:00–0:20) — Show the live URL**

Open https://parity-studio.vercel.app/.

> "No install. Upload a screenshot, get a `ui_kit/` folder structured for
> Claude Code, Cursor, or Windsurf. Free tier doesn't need an API key."

**Beat 2 (0:20–1:00) — Upload + prompt**

Drag a UI screenshot into the composer. Type a brief: e.g., *"decompose
into a clean ui_kit with terracotta CTA and dark surface tokens."*

> "The composer takes either an image, a prompt, or both. Image only =
> reverse-engineer the existing UI. Prompt only = generate from scratch.
> Both = match the image with the prompt's constraints."

> "See the ✨ button? That's an enhance prompt — small-tier model rewrites
> your draft into a clearer, more specific version. Costs basically
> nothing, makes a big difference downstream."

Click ✨. Watch the prompt get rewritten in place (~5–10s).

**Beat 3 (1:00–1:30) — Tier picker + send**

Click the tier pill (Balanced / Frontier / Free).
> "Three tiers. Balanced is the default — Sonnet for the smart work,
> Kimi K2.6 for generation. Frontier is Opus for the planning step.
> Free is a model called `ling-2.6-1t:free` that on our eval beats
> paid Haiku and Sonnet for tool calling. If you're just trying it
> out, pick Free — costs zero."

Click Send.

**Beat 4 (1:30–2:30) — Watch the pipeline**

> "Right rail is the deterministic parity rubric — 16 checks. Cost
> telemetry at the bottom. File tree on the left fills as the agent
> writes files. Source image stays pinned for visual reference. The
> iframe in the middle renders the kit as it gets built."

When the artifact appears, switch to Code tab.
> "Every component, every token, every line — yours. Schema versioned
> at v1 so when v2 ships you can migrate cleanly."

**Beat 5 (2:30–3:00) — Iterate via comments**

Toggle Comment mode (top-right pill). Click somewhere on the rendered
preview. A bubble appears.
> "Comment mode lets you scope feedback to a region. Quick actions are
> shortcuts for common asks (+ space, + contrast, + radius). Or write
> your own. Click ✨ save+auto-fix and the agent kicks off the
> advisor-executor loop — plans, edits, self-verifies, summarizes."

Type a comment. Hit ✨ save+auto-fix. Wait for the chat panel to flip on
and the advisor reply to stream.

**Beat 6 (3:00–3:30) — Export + handoff**

Click Export → ZIP (or Markdown).
> "ZIP includes the full `ui_kit/<slug>/` folder + a `HANDOFF.md` with
> integration instructions. Drop it into Claude Code's working directory,
> say 'integrate this kit', and the agent takes over."

> "If you're already in Claude Code, you don't even need to come here —
> install the MCP server (`npx -y parity-studio-mcp`) and you can drive
> this whole flow from your editor with `parity_chat_send`,
> `parity_enhance_prompt`, etc. Same backend, same kit, no browser
> context-switching."

### Q&A prep (end-user)

| Q | A |
|---|---|
| "Is it really free?" | The Free tier is, yes — uses `ling-2.6-1t:free` via OpenRouter for everything. If that model rate-limits, your session gracefully degrades to paid haiku-4-5 (~$0.001/call). 88% of sessions stay on primary. Worst-case for an entire kit decompose: ~$0.40–0.65 with default models, ~$0.05–0.10 with cheaper-tier setups. |
| "What's the difference between this and open-codesign?" | open-codesign is a desktop app with a full design ↔ editor ↔ decompose loop. parity-studio is a browser tab focused on the "I have a screenshot, I want a `ui_kit/` for Claude Code" slice. Same boolean parity primitive, different friction profile. |
| "What if the kit is wrong?" | Use Comment mode to point at the wrong part, type what should change, hit ✨ save+auto-fix. The agent will iterate. There's also a manual iterate button in the right rail that re-runs decompose with the current comments as feedback. |
| "Can I use it without giving you my API keys?" | The hosted backend covers Anthropic + OpenRouter calls — you don't supply keys. If you want to self-host, clone the repo and set your own Convex deployment with your keys. |

### Anti-patterns (don't say to end-user)

- Don't explain the boolean rubric in technical depth — they want to use the tool, not learn its theory
- Don't open the autoRouter source code; the tier picker UI is the right level of detail
- Don't show the bot review history; it'll seem like you're apologizing
- Don't pitch the MCP server first — show the web flow, mention MCP at the end as "if you're a power user"

---

## Cross-audience cheat sheet — what changes per audience

| Slide | Admin | Interviewer | End-user |
|---|---|---|---|
| **Open with** | "PR is mergeable, bot signed off, 5 min walkthrough" | "Issue → PR → standalone, today: all live" | "Live URL, upload a screenshot, watch this" |
| **Show first** | PR #241 header card | The arc from issue thread to today | The composer at parity-studio.vercel.app |
| **Killer line** | "Boolean rubric, no fabricated floats — same primitive your repo already uses" | "Free model outscored paid sonnet on our eval — 15/15 vs 14/15" | "✨ enhance + Free tier = zero cost, real output" |
| **Deepest tech** | Loop logic bug + the 3 rounds of bot review | OpenRouter rate-limit hardening + sessionPick fallback chain | Comment mode → ✨ save+auto-fix → advisor reply |
| **Close with** | "Phase 2 is separate; ready to merge when you are" | "MCP-first distribution + the eval harness is reproducible" | "Export ZIP → drop into Claude Code → done" |
| **DO NOT** | apologize for review iterations | lead with the demo video | open the autoRouter source |

---

## Adaptations for time-boxed slots

**60 seconds:** play the demo MP4. Narrate audience-specific killer line over it. Hand them the URL.

**3 minutes:** drop beats 2 + 4 + 6 of the appropriate script.

**15 minutes:** all 6 beats + the Q&A. Run the live demo for the section the audience cares most about (admin = the code; interviewer = the eval; user = the comment-mode loop).

**45 minutes:** full script + walk them through the parity-studio repo structure + open one MCP tool's source so they can see the abstraction. Have them try the live app themselves on a screenshot they bring.

---

## Related

- Eval write-up: [docs/plans/2026-04-29-free-model-eval.md](../plans/2026-04-29-free-model-eval.md)
- Recorder plan: [docs/plans/2026-04-29-demo-recorder.md](../plans/2026-04-29-demo-recorder.md)
- v0.1.0 handoff: [docs/handoff/2026-04-30-v0.1.0-eval-recorder-handoff.md](2026-04-30-v0.1.0-eval-recorder-handoff.md)
- PR #241: https://github.com/OpenCoworkAI/open-codesign/pull/241
- Issue #225: https://github.com/OpenCoworkAI/open-codesign/issues/225
- Live app: https://parity-studio.vercel.app/
