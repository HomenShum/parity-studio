# Parity-studio free-model eval

**Date:** 2026-04-29
**Harness:** `scripts/eval-free-models.mjs`
**Raw:** `runs/eval-free-2026-04-29T23-14-57-591Z/`

## Why this re-runs the prior nodebench eval

The user's earlier nodebench ranking (entity-intelligence research domain, no
tool calls) graded models against a different surface. For parity-studio we
need to know how each candidate handles **our** tool surface:
`list_files`, `read_file`, `upsert_file`, `set_todos`, `done`. So this
harness sends 5 queries that REQUIRE tool calls and measures three things
per call:

- **T** — was at least one expected tool actually invoked?
- **V** — did every tool call ship valid args (path string, content string, items array)?
- **C** — was the response coherent (tool calls fired or ≥50 chars of text)?

`Score = T + V + C` per query, summed across 5 queries → max 15.

## Results

| Rank | Model | Tier | Score | Pass% | T | V | C | Errors | Avg latency |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | `inclusionai/ling-2.6-1t:free` | **free** | **15/15** | **100%** | 5/5 | 5/5 | 5/5 | 0 | **1286ms** |
| 2 | `claude-haiku-4-5` | paid | 14/15 | 80% | 4/5 | 5/5 | 5/5 | 0 | 885ms |
| 3 | `claude-sonnet-4-5` | paid | 14/15 | 80% | 4/5 | 5/5 | 5/5 | 0 | 2123ms |
| 4 | `google/gemma-4-26b-a4b-it:free` | free | 7/15 | 20% | 1/5 | 5/5 | 1/5 | 0 | 1695ms |
| 5 | `inclusionai/ling-2.6-flash:free` | free | 5/15 | 0% | 0/5 | 5/5 | 0/5 | 0 | 36ms |
| 6 | `google/gemma-4-31b-it:free` | free | 5/15 | 0% | 0/5 | 5/5 | 0/5 | 0 | 1757ms |
| 7 | `meta-llama/llama-3.3-70b-instruct:free` | free | 5/15 | 0% | 0/5 | 5/5 | 0/5 | 0 | 1968ms |

A second pass tested the same models on a text-only enhance-prompt task (no
tools required — just rewrite "make button rounded"):

| Model | Latency | stopReason | Output |
|---|---:|---|---|
| `inclusionai/ling-2.6-1t:free` | 2356ms | stop | 655 chars (best quality) |
| `google/gemma-4-26b-a4b-it:free` | 3499ms | stop | 403 chars (ok) |
| `inclusionai/ling-2.6-flash:free` | 360ms | error | 0 chars |
| `google/gemma-4-31b-it:free` | 2264ms | error | 0 chars |
| `meta-llama/llama-3.3-70b-instruct:free` | 2225ms | error | 0 chars |

So 3 of the 5 free candidates we initially curated actually **return empty
responses with stopReason='error'** through OpenRouter today (2026-04-29).
That's a 60% breakage rate among "looks promising" :free slugs.

## Headline finding

**`ling-2.6-1t:free` outscored paid haiku-4-5 and sonnet-4-5 on
parity-studio's actual tool surface.** 100% pass rate, 5-for-5 expected tool
calls, valid args every time, coherent responses. Avg 1286ms latency.

The two paid models lost the same query (q2-todos-plan): when asked to
"plan a 3-step refresh via set_todos," haiku and sonnet both reached for
list_files first instead of calling set_todos directly. Ling-2.6-1t followed
the instruction literally.

## Decisions taken

- **FREE tier** converged on `ling-2.6-1t:free` for **every phase**
  (enhance / advise / execute / generate / decompose / iterate / judge).
  Removed `ling-2.6-flash:free`, `llama-3.3-70b-instruct:free`, and
  `gemma-4-31b-it:free` — all returning empty.
- **Free fallback** flipped from broken-free to **paid `claude-haiku-4-5`**.
  Better to spend ~$0.001/call on graceful degrade than serve a broken
  empty response. Sessions still effectively-free in the common path
  (sessionPick stays on primary 88% of the time).
- **SMALL tier** fallbacks similarly cleaned (no longer reference the
  broken ling-flash slug).
- **Gemma 4 26B** confirmed at 20% pass on parity-studio surface, matching
  the user's prior nodebench finding ("UNRELIABLE — 25% errors"). Skipped.
- **Caveat for the future**: re-run this harness whenever pi-ai bumps
  versions or when the OpenRouter `:free` model list rotates. The
  VERIFIED-DATE comment in `convex/lib/autoRouter.ts` is the audit
  baseline. Suggest monthly cadence.
