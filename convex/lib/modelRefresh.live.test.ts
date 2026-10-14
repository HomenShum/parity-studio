// @vitest-environment node
/**
 * LIVE receipt for the model-defaults refresh (SPEC A.0.3, A.2.7). Gated: skipped unless PARITY_LIVE_RECEIPT=1,
 * so `pnpm test` and CI never spend. It makes one keyed call per changed phase through this repo's own resolver and
 * `call()`, asserts the provider accepted the request, the resolver chose the SPEC 1.2 id, and the production cap
 * did not truncate the answer (stopReason != 'length', the check that guards the BALANCED -> paid-fallback path),
 * and writes a SPEC A.0.3 receipt.
 *
 *   PARITY_LIVE_RECEIPT=1 PARITY_LIVE_MAX_USD=1 ANTHROPIC_API_KEY=... OPENROUTER_API_KEY=... GEMINI_API_KEY=... \
 *     pnpm exec vitest run convex/lib/modelRefresh.live.test.ts
 *
 * Run it on a clean checkout of the PR head (a dirty tree is refused). It then writes
 * evidence/model-refresh/receipt-<headSha>.json: commit that file alone on top of the tested commit (SPEC A.0.3 (a)).
 *
 * Spend is bounded per dispatch, not just up front. `call()` soft-retries OpenRouter up to `maxAttempts` times and
 * sums every attempt's cost, so before each cell the harness requires spentUsd + (attempts x single-attempt worst
 * case) <= PARITY_LIVE_MAX_USD (default 1); a cell that cannot fit stops the run with `budget.stoppedBy` set, which
 * review treats as an incomplete run, never a pass. The all-attempts worst case is printed before any call.
 * `budget.requests` and each row's `transportRequests` are counted at the transport (a wrapper around the global
 * `fetch` pi-ai sends through), so they include pi-ai's own HTTP retries of a 429/5xx. `completionAttempts` is the
 * number of completions `call()` asked pi-ai for and is lower whenever pi-ai retried inside one.
 * The Convex `verifyVisual` phase issues no model request, but the MCP server does, and the `maxOutputTokens` ->
 * `maxTokens` fix in mcp/src/lib/llmClient.ts turned every MCP caller's cap into a real cap. The last three cells
 * cover them: the visual judge (mcp/src/index.ts:365, cap 4,000, default google/gemini-3.1-pro-preview, run with a
 * 12-check rubric-shaped prompt because runVisualJudge does not check stopReason 'length' and a cut-off reply scores
 * 0/12 with no error), decompose/generate (index.ts:238, 724, 1742, 1835 at 24,000 and :1271 at 16,000, default
 * kimi-k2.6; the 24,000 cap stands for both), and the frozen NodeSlide BYOK planner (nodeslideTools.ts:1060, cap
 * 3,000, default z-ai/glm-5.2; measured, not edited). Their routes are literals mirroring the MCP defaults (the MCP
 * package is not importable from here), so for them `resolvedModel` equals `requestedModel` by construction. A
 * cell proves the provider accepts the cap and effort and that this prompt fits; it does not bound a real artifact's
 * output, so a cap that proves too tight on real traffic is still an MCP-side finding.
 *
 * Row fields: `requestedModel` is the SPEC 1.2 id the cell claims to test (a literal below, independent of the
 * code); `resolvedModel` is what `resolveRunModel` returned for that cell's tier and phase (asserted equal BEFORE
 * any spend); `echoedModel` is `CallResult.echoedModel` (pi-ai's `responseModel` when the provider echoed a
 * different id, else the requested id).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel } from '@earendil-works/pi-ai/compat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OUTPUT_CAPS, PHASE_EFFORT, type Phase, resolveRunModel } from './autoRouter';
import { type Effort, call, maxAttempts } from './piAi';

type Provider = 'anthropic' | 'openrouter' | 'google';
interface Route {
  provider: Provider;
  modelId: string;
}
interface Cell {
  phase: string;
  /** The SPEC 1.2 id this cell claims to test, as `provider:id`. */
  expected: string;
  /** What the repo's resolver chooses for the cell. */
  resolve: () => Route;
  cap: number;
  effort: Effort;
  /** Defaults to PROMPT. */
  prompt?: string;
}

const RUN = 'live-receipt';
const primary = (tier: 'frontier' | 'balanced' | 'free', phase: Phase) => (): Route =>
  resolveRunModel({ tier }, phase, RUN) as Route;
const fallback = (tier: 'balanced', phase: Phase) => (): Route => {
  const route = resolveRunModel({ tier }, phase, RUN).fallback;
  if (route === undefined) throw new Error(`${tier}/${phase} has no fallback`);
  return route as Route;
};

// The shape of the MCP visual judge's answer: twelve checks, each with a one-sentence note, plus a summary.
const JUDGE_PROMPT =
  'Return only a JSON object {"checks":[{"dimension":string,"id":string,"passed":boolean,"note":string}],"summary":string} ' +
  'with exactly 12 checks that compare a rendered landing page against a reference screenshot (layout, typography, ' +
  'color, spacing, imagery, hierarchy, contrast, alignment, responsiveness, copy, iconography, polish). ' +
  'Give each note a full sentence and the summary three sentences.';

const PROMPT =
  'In about 300 words, explain how a design-token pipeline turns brand colors into CSS custom properties.';
// One call per changed phase, plus the kimi-k2.6 phases whose caps became real (they were ignored before the
// maxTokens fix) and the FREE-tier replacement. Opus decompose differs from Opus advise only in cap (24000 vs
// 16000, both far below the model max), so it is not repeated.
const CELLS: Cell[] = [
  {
    phase: 'enhance',
    expected: 'anthropic:claude-haiku-5-5',
    resolve: primary('frontier', 'enhance'),
    cap: OUTPUT_CAPS.enhance,
    effort: PHASE_EFFORT.enhance,
  },
  {
    phase: 'advise',
    expected: 'anthropic:claude-opus-5-5',
    resolve: primary('frontier', 'advise'),
    cap: OUTPUT_CAPS.agentLoop,
    effort: PHASE_EFFORT.advise,
  },
  {
    phase: 'execute',
    expected: 'anthropic:claude-sonnet-5-5',
    resolve: primary('frontier', 'execute'),
    cap: OUTPUT_CAPS.agentLoop,
    effort: PHASE_EFFORT.execute,
  },
  {
    phase: 'generate-fallback',
    expected: 'openrouter:anthropic/claude-sonnet-5.5',
    resolve: fallback('balanced', 'generate'),
    cap: OUTPUT_CAPS.iterate,
    effort: PHASE_EFFORT.generate,
  },
  ...(['generate', 'decompose', 'iterate'] as const).map((phase) => ({
    phase: `${phase} (kimi-k2.6, BALANCED)`,
    expected: 'openrouter:moonshotai/kimi-k2.6',
    resolve: primary('balanced', phase),
    cap: OUTPUT_CAPS[phase],
    effort: PHASE_EFFORT[phase],
  })),
  {
    phase: 'generate (FREE)',
    expected: 'openrouter:nvidia/nemotron-3-super-120b-a12b:free',
    resolve: primary('free', 'generate'),
    cap: OUTPUT_CAPS.generate,
    effort: PHASE_EFFORT.generate,
  },
  {
    phase: 'MCP visual judge (index.ts:365, frozen default)',
    expected: 'google:gemini-3.1-pro-preview',
    resolve: () => ({ provider: 'google', modelId: 'gemini-3.1-pro-preview' }),
    cap: 4_000,
    effort: 'high', // mcp DEFAULT_EFFORT
    prompt: JUDGE_PROMPT,
  },
  {
    phase: 'MCP decompose/generate (index.ts:238, kimi-k2.6, frozen default)',
    expected: 'openrouter:moonshotai/kimi-k2.6',
    resolve: () => ({ provider: 'openrouter', modelId: 'moonshotai/kimi-k2.6' }),
    cap: 24_000,
    effort: 'high',
  },
  {
    phase: 'NodeSlide BYOK planner (nodeslideTools.ts:1060, frozen default)',
    expected: 'openrouter:z-ai/glm-5.2',
    resolve: () => ({ provider: 'openrouter', modelId: 'z-ai/glm-5.2' }),
    cap: 3_000,
    effort: 'high',
  },
];

const INPUT_TOKENS_UPPER = 200;

// Transport-level request counter: every pi-ai request goes through the global fetch.
let transportRequests = 0;
const realFetch = globalThis.fetch;
beforeAll(() => {
  if (process.env['PARITY_LIVE_RECEIPT'] !== '1') return;
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    transportRequests += 1;
    return realFetch(...args);
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

const routeKey = (route: Route): string => `${route.provider}:${route.modelId}`;

/** Single-attempt worst case: 200 input tokens plus the full cap as output, at the catalog price. */
function singleAttemptUsd(route: Route, cap: number): number {
  // biome-ignore lint/suspicious/noExplicitAny: pi-ai getModel is typed against its compile-time registry
  const model = (getModel as any)(route.provider, route.modelId);
  return (INPUT_TOKENS_UPPER * model.cost.input + cap * model.cost.output) / 1_000_000;
}

const estimateUsd = CELLS.reduce((sum, c) => sum + singleAttemptUsd(c.resolve(), c.cap), 0);
const worstCaseUsd = CELLS.reduce((sum, c) => {
  const route = c.resolve();
  return sum + maxAttempts(route.provider) * singleAttemptUsd(route, c.cap);
}, 0);

const git = (...args: string[]): string =>
  execFileSync('git', args, {
    encoding: 'utf8',
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
  }).trim();

describe.skipIf(process.env['PARITY_LIVE_RECEIPT'] !== '1')(
  'live receipt: model-defaults refresh',
  () => {
    it(`one keyed call per changed phase (single-attempt worst case ~$${estimateUsd.toFixed(2)}, all attempts ~$${worstCaseUsd.toFixed(2)}), no truncation, no fallback`, async () => {
      const maxUsd = Number(process.env['PARITY_LIVE_MAX_USD'] ?? '1');
      expect(estimateUsd, `worst case exceeds PARITY_LIVE_MAX_USD=${maxUsd}`).toBeLessThanOrEqual(
        maxUsd,
      );
      const testedCommit = git('rev-parse', 'HEAD');
      expect(git('status', '--porcelain', '--', '.', ':(exclude)evidence'), 'gitDirty').toBe('');

      const startedAt = new Date().toISOString();
      const rows: Array<Record<string, unknown>> = [];
      let spentUsd = 0;
      let stoppedBy: string | null = null;
      for (const cell of CELLS) {
        const route = cell.resolve();
        // A.0.3: review rejects resolvedModel != requestedModel, so refuse before any spend.
        expect(routeKey(route), `${cell.phase}: the resolver chose another id`).toBe(cell.expected);
        const worstUsd = maxAttempts(route.provider) * singleAttemptUsd(route, cell.cap);
        if (spentUsd + worstUsd > maxUsd) {
          stoppedBy = `budget before ${cell.phase}: spent $${spentUsd.toFixed(4)} + worst case $${worstUsd.toFixed(4)} > $${maxUsd}`;
          break;
        }
        const requestsBefore = transportRequests;
        const result = await call({
          provider: route.provider,
          modelId: route.modelId,
          systemPrompt: 'You are a concise technical writer.',
          userText: cell.prompt ?? PROMPT,
          maxTokens: cell.cap,
          effort: cell.effort,
          signal: AbortSignal.timeout(180_000),
        });
        spentUsd += result.costMicroUsd / 1_000_000;
        rows.push({
          phase: cell.phase,
          requestedModel: cell.expected,
          resolvedModel: routeKey(route),
          echoedModel: result.echoedModel,
          usage: { input: result.inputTokens, output: result.outputTokens, cap: cell.cap },
          stopReason: result.stopReason,
          completionAttempts: result.completionAttempts,
          transportRequests: transportRequests - requestsBefore,
          costUsd: result.costMicroUsd / 1_000_000,
          // call() dispatches exactly the id it is given; there is no fallback hop in this path.
          fallbackUsed: false,
        });
        expect(result.stopReason, `${cell.phase}: ${result.errorMessage ?? ''}`).not.toBe('error');
        expect(result.stopReason, `${cell.phase} truncated at its ${cell.cap} cap`).not.toBe(
          'length',
        );
        expect(result.echoedModel, `${cell.phase} echoed model`).toBeTruthy();
      }

      const receipt = {
        command: 'PARITY_LIVE_RECEIPT=1 pnpm exec vitest run convex/lib/modelRefresh.live.test.ts',
        candidateIds: CELLS.map((c) => c.expected),
        echoedModels: rows.map((r) => r['echoedModel']),
        rows,
        testedCommit,
        constantSha256: createHash('sha256')
          .update(readFileSync(fileURLToPath(new URL('./autoRouter.ts', import.meta.url))))
          .digest('hex'),
        budget: {
          maxUsd,
          estimateUsd,
          worstCaseUsd,
          spentUsd,
          requests: transportRequests,
          stoppedBy,
        },
        startedAt,
        environment: { node: process.version, piAi: '1.1.0' },
      };
      const dir = fileURLToPath(new URL('../../evidence/model-refresh/', import.meta.url));
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}receipt-${testedCommit}.json`, `${JSON.stringify(receipt, null, 2)}\n`);
      expect(stoppedBy, 'a budget stop is an incomplete run, never a pass').toBeNull();
    }, 900_000);
  },
);
