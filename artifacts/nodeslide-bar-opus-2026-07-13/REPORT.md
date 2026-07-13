# NodeSlide — Agentic UI Bar score (Opus-driven pass)

**Target:** `https://parity-studio.vercel.app/?domain=nodeslide` (prod, deployed build)
**Executor:** Opus 4.8 (per directive: "use opus instead of haiku on our latest nodeslide")
**Date:** 2026-07-13 · **Protocol:** `agentic-ui-qa` + `parity-studio-nodeslide` profile
**Ground rule honored:** no artifact → no claim. Every score below maps to a PNG/JSON in `evidence/` captured this session.

---

## TL;DR

**Bar: 14/16 — B1 B2 B3 B4 B5 B7 = 2 · B6 = 1 · B8 = 1.** Same total as the 2026-07-12 baseline, now re-verified with fresh atomic artifacts by Opus. Revamp targets unchanged: **B6 (status/latency)** and **B8 (agent operability)**.

**The one material NEW finding:** the **live GLM-5.2 edit hero path is currently degraded on prod** — 0 of 3 attempts produced a clean live-validated edit (1 graceful fallback, 2 raw Convex `Server Error` after 70–120s). **Honesty held in every case** (no fake success, real cost shown on fallback, deck verified unchanged on failure). So this is a **reliability P1, not a dishonesty P0** — the distinction is the whole point of the app and it passed the honesty test under failure.

---

## Journeys

| Journey | Verdict | Evidence |
|---|---|---|
| J0 Smoke | **PASS** | `j0-firstrun/-home-light/-home-dark.png` — modal + consent copy, full shell, Trace tab, receipt, dark verified, mojibake:0 |
| J1 Deterministic create | **PASS** | `hero-3-created.png` — toast "Deck created deterministically. Your brief stayed inside NodeSlide", 7 slides, honest trace, no egress |
| J2 Live GLM edit (HERO) | **DEGRADED** (honest) | `h6-3-trace-live-FALLBACK.png`, `h6-2-proposal-FAILED.png`, `hero6-result-run1/2.json` — see finding F1 |
| J2b Deterministic edit cycle | **PASS** | `j7-2-det-trace.png`, `j7-4-versions.png`, `hero7-result.json` — propose→compare→accept→v2, egress=0 |
| J3 Trace audit | **PASS** | trace classifies LIVE-attempt/FALLBACK/FAILED honestly; no run claims live attribution at $0 |
| J4 Export & present | **PASS** | `j4-1-export.png` — "Interactive HTML" + "PPTX with fallbacks"; present counter 1/7 → 3/7 |
| J5 Themes / responsive | **PASS** | `j5-mobile.png`, `j5-tablet.png` — no h-overflow @375/768/1512, light+dark, mojibake:0 |
| J6 Adversarial | **PASS** | consent-OFF = **0 network requests to openrouter.ai** (network-monitored); empty submit disabled; failures leave deck unchanged |

---

## The Bar (0 absent/dishonest · 1 present-but-weak · 2 strong)

| # | Dimension | Score | Evidence |
|---|---|:--:|---|
| **B1** | Consent & egress honesty | **2** | Deterministic/private default (`det:true, or:false`); consent off by default; egress named ("OpenRouter · GLM 5.2 — external") before it happens; "versioned consent token attached to propose callbacks"; access code "Checked by the server… NodeSlide does not save it". **Network-verified: 0 requests to openrouter.ai with consent off** (`hero7-result.json` `egressWithConsentOff:[]`). |
| **B2** | Attribution & provenance | **2** | Trace shows model id `z-ai/glm-5.2`, cost `$0.002` (shown even on fallback), the exact pipeline ("Called GLM 5.2 through the maintained pi-ai OpenRouter provider after exact edit consent"), Plan, Guardrails, expandable Raw JSON. `h6-3-trace-live-FALLBACK.png`. |
| **B3** | Propose-before-mutate | **2** | Edits land as a reviewable Compare diff (Side by side / Slider / Overlay / Blink), Accept/Decline + per-op Accept/Reject. Canvas **verified unchanged until accept** (`mutatedBeforeAccept:false`), and **changes on accept** (`mutatedAfterAccept:true`). Category-leading. |
| **B4** | Scope boundaries | **2** | "Read context · locked write scope"; write-scope pills Deck/This slide/Selection; "Explicit scope only", "Locked elements are immutable", "Fine-grained CAS before commit". **Ownership is session-bound** — raw deck URLs hit a "Safe Recovery: this is an editor link, not a share link" gate (`h6-*`, discovered when a fresh context couldn't open a created deck). |
| **B5** | Honest degrade | **2** | GLM invalid → "Deterministic fallback proposed 6 scoped operations because the GLM 5.2 response was invalid", labeled `z-ai/glm-5.2 (deterministic fallback)` with real $0.002. Hard error → "Failed. No proposal was created or applied. Your deck remains unchanged" (canvas verified unchanged). **Never a fake success.** |
| **B6** | Status & latency feel | **1** | Immediate echo of the ask; honest "Drafting proposal — preparing a bounded, reviewable patch" progress. BUT live-edit latency is wildly variable (11s / 73s / >120s across 3 runs) and the slow-failure surfaces a **raw Convex error string** after a long wait; the 30s model timeout doesn't visibly bound the UI drafting state. **Top revamp target.** |
| **B7** | Recoverability | **2** | Accept → deck v1→v2 (toast "Validated proposal accepted as a new deck version"); Versions tab lists both revisions ("replace text · Body copy · v2 · Agent" and "Initial deck · v1 · System") each with **Compare + Restore**; undo/redo in toolbar. `j7-4-versions.png`. |
| **B8** | Agent operability | **1** | Huge positives: stable aria-labels + testids everywhere (the entire suite was driven headlessly through them), mobile-responsive, keyboard-complete. Friction: (a) **duplicate `data-testid="deck-title"`** on dialog input AND editor header — ambiguous selector; (b) **create flow non-deterministic** (first-run modal vs. golden deck auto-loading — my scripts flaked on this repeatedly); (c) provider radios live inside a collapsed disclosure. **Second revamp target.** |

---

## Findings

**F1 · P1 · live-edit reliability (B6/B2) — the hero path is degraded on prod.**
- *Symptom:* 3 live GLM-5.2 edit attempts on prod: run1 = GLM response invalid → deterministic fallback (11.6s, reviewable proposal, $0.002); run2 = Convex `proposeEdit` Server Error after >120s; run3 = same after ~73s. **0/3 clean live-validated edits.**
- *Root cause (mechanism):* `proposeEdit` ([convex/nodeslideAgent.ts:78](../../convex/nodeslideAgent.ts:78)) handles the *invalid-response* path gracefully (`origin === 'deterministic_fallback'`, line 195) but an async failure on the *slow/exception* path (pi-ai OpenRouter throwing after retries, or action-level timeout) **escapes the error boundary** — "Server Error Called by client" is Convex's signature for an uncaught non-`ConvexError` exception. Upstream GLM-5.2/OpenRouter also appears unstable right now (invalid + erroring responses).
- *Evidence:* `hero6-result-run1.json` (fallback), `hero6-result-run2.json` (server error), `h6-2-proposal-FAILED.png`.
- *Fix (PROPOSED, not applied — prod ≠ local tree, concurrent Codex writers):* wrap the provider call so ALL failure modes (timeout/network/exception) converge on the same graceful deterministic-fallback proposal the invalid path already uses, or at minimum surface a clean user-facing `ConvexError` instead of the raw string. Consider a hard client-visible cap well under the observed 70–120s.

**F2 · P2 · raw error string leaks to users (B5/B6).**
- *Symptom:* failure card shows `[CONVEX A(nodeslideAgent:proposeEdit)] [Request ID: …] Server Error Called by client`.
- *Note:* the accompanying copy ("No proposal was created or applied. Your deck remains unchanged.") is honest and correct — only the raw prefix is the problem. Bundled with F1's fix.

**F3 · P2 · duplicate `data-testid="deck-title"` (B8).**
- *Symptom:* the testid exists on both the create-dialog input and the editor header; `document.querySelector` returns the wrong one, and Playwright strict-mode selectors are ambiguous. Costs any agent (cheap or not) a disambiguation step.
- *Fix (PROPOSED):* rename one (e.g. `deck-title-input` vs `deck-title-header`).

**F4 · P2 · non-deterministic first-run (B8).** Fresh sessions sometimes show the first-run modal (no `deck=` param) and sometimes auto-load a `deck_golden_*` deck straight into the URL. An agent scripting "create a deck" can't rely on a stable entry state.

*(Housekeeping, out of scope: a stray `NUL` file sits in the repo root — pre-existing, untracked.)*

---

## Gates (current local tree, U7 — concurrent Codex changes present)

- `pnpm typecheck` → **exit 0** (`tsc --noEmit` clean)
- `pnpm exec vitest run src/domains/nodeslide …` → **exit 0**, 13 files / **115 tests passed** (incl. adversarial signature-bounds + 200-slide budget / 201st-rejection scenarios)

---

## Next revamp loop (lowest dimensions first)

1. **B6** — bound and smooth the live-edit path: converge every failure mode on the graceful fallback (F1), replace the raw error string (F2), add an honest hard timeout. This also de-risks the demo hero.
2. **B8** — deduplicate `deck-title` (F3), stabilize the first-run entry (F4), consider surfacing the provider radios without the collapsed disclosure.

Both are code changes; deferred pending your go-ahead because prod is deployed from an earlier commit and the local tree has concurrent Codex edits.
