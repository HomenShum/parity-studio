# Task spec: route NodeSlide edit-planner through pi-ai, pinned to GLM 5.2 (2026-07-12)

For the demo/panel, the core agent must run a real, NAMED model through pi-ai (matching NodeRoom's NodeAgent
orchestration and NodeSlide's own variation provider), not a raw fetch to the dynamic openrouter/free route.

## Model
- OpenRouter id: `z-ai/glm-5.2` (Zhipu GLM-5 family; 1M context; $1.40/M in, $4.40/M out; built for
  long-horizon agent workflows). Requires `OPENROUTER_API_KEY` (already on the deployment).

## Current state (verified 2026-07-12)
- `convex/lib/nodeslideProvider.ts` → `callNodeSlideFreeJson` = a raw fetch to
  `https://openrouter.ai/api/v1/chat/completions`, pinned to `openrouter/free`. NOT pi-ai.
- `convex/nodeslideVariationProvider.ts` ALREADY uses pi-ai:
  `import { complete, getModel } from '@mariozechner/pi-ai'` → `getModel('openrouter', 'openrouter/free')`.
  Use this file as the reference pattern.
- Edit planner: `convex/lib/nodeslideEditPlanner.ts` → `callProvider = callNodeSlideFreeJson`.

## Change
1. In `nodeslideProvider.ts` (or a new pi-ai-backed provider): implement the edit-planner completion via
   pi-ai `complete(getModel('openrouter', 'z-ai/glm-5.2'), context, {...})`, mirroring the variation provider.
   Keep the SAME JSON contract `callNodeSlideFreeJson` returns so the planner is untouched downstream.
2. Make the model id a single named constant (e.g. `NODESLIDE_EDIT_MODEL = 'z-ai/glm-5.2'`) — one place to
   change, and reused in the trace attribution. Do not hardcode it in multiple files.
3. Surface provider + model in BOTH the proposal card and the execution trace: replace the current
   `{ provider: 'openrouter', model: 'openrouter/free ...' }` attribution (nodeslideAgent.ts ~578) with the
   real `{ provider: 'openrouter', model: 'z-ai/glm-5.2' }` on the LLM path; the deterministic fallback keeps
   its labeled `(deterministic fallback)` attribution.
4. KEEP intact: the acceptance gate (propose-before-mutate), scope/writeScope enforcement, candidate
   validation + digest binding, version clocks, and the deterministic fallback when the model is unavailable
   or returns invalid JSON. The fallback stays labeled — never a fabricated success.
5. Consent unchanged: GLM 5.2 egress only after explicit Web/OpenRouter consent; deterministic stays default.

## Guardrails to preserve (do not regress)
- 30s AbortController timeout, bounded response read (~200KB), one repair retry then deterministic fallback,
  op-cap (≤8), server-side candidate re-validation before any green "validated" receipt.

## Version caveat
The installed `@mariozechner/pi-ai` is flagged deprecated in the lockfile. Before shipping the headline agent
on it, confirm the version is current or migrate to its maintained successor. A deprecated orchestration layer
under the demo's central agent is a panel-probe risk (Eli).

## Tests
- Planner test asserts: LLM path returns a GLM-5.2-attributed proposal; provider/model in the trace equals
  the named constant; invalid JSON → one retry → labeled deterministic fallback; acceptance still gated.
- Do not weaken existing editorStateIntegrity / shadow / admission tests.

## Verify (demo-critical)
On staging: consent Web on → send a real edit request → confirm the proposal card + Trace show
`openrouter · z-ai/glm-5.2`, token/cost recorded, candidate validated, slide unchanged until Accept.
