// @vitest-environment node
/**
 * LIVE receipt for the model-defaults refresh (SPEC A.0.3, A.2.7). Gated: skipped unless PARITY_LIVE_RECEIPT=1,
 * so `pnpm test` and CI never spend. It makes one keyed call per changed phase through this repo's own resolver and
 * `call()`, asserts the provider accepted the request, the resolver chose the SPEC 1.2 id, and the production cap
 * did not truncate the answer (stopReason != 'length', the check that guards the BALANCED -> paid-fallback path),
 * and writes a SPEC A.0.3 receipt.
 *
 *   PARITY_LIVE_RECEIPT=1 PARITY_LIVE_MAX_USD=3 ANTHROPIC_API_KEY=... OPENROUTER_API_KEY=... GEMINI_API_KEY=... \
 *     pnpm exec vitest run convex/lib/modelRefresh.live.test.ts
 *
 * Run it on a clean checkout of the PR head (a dirty tree is refused). It then writes
 * evidence/model-refresh/receipt-<headSha>.json: commit that file alone on top of the tested commit (SPEC A.0.3 (a)).
 *
 * Spend is bounded per dispatch, not just up front. `call()` soft-retries OpenRouter up to `maxAttempts` times and
 * sums every attempt's cost, so before each cell the harness requires spentUsd + (attempts x single-attempt worst
 * case) <= PARITY_LIVE_MAX_USD (default 1, which fails closed: the one-attempt worst case is
 * about $2.6, dominated by the 64,000-token agent-loop cap on Opus and Sonnet, so a real run passes 3); a cell that cannot fit stops the run with `budget.stoppedBy` set, which
 * review treats as an incomplete run, never a pass. The all-attempts worst case is printed before any call.
 * `budget.requests` and each row's `transportRequests` are counted at the transport (a wrapper around the global
 * `fetch` pi-ai sends through), so they include pi-ai's own HTTP retries of a 429/5xx. `completionAttempts` is the
 * number of completions `call()` asked pi-ai for and is lower whenever pi-ai retried inside one.
 * The Convex `verifyVisual` phase issues no model request, but the MCP server does, and the `maxOutputTokens` ->
 * `maxTokens` fix in mcp/src/lib/llmClient.ts turned every MCP caller's cap into a real cap. The last three cells
 * cover them: the visual judge (mcp/src/lib/visualJudge.ts, cap 4,000, default google/gemini-3.1-pro-preview, run
 * with a 12-check rubric-shaped prompt so the cell shows the rubric fits the cap; runVisualJudge reports a judge
 * failure rather than a score when the reply is cut off, but a cap that is too tight would still make every
 * verification fail), decompose/generate (index.ts:238, 724, 1742, 1835 at 24,000 and :1271 at 16,000, default
 * kimi-k2.6; the 24,000 cap stands for both), and the frozen NodeSlide BYOK planner (nodeslideTools.ts:1060, cap
 * 3,000, default z-ai/glm-5.2; measured, not edited). Their routes are literals mirroring the MCP defaults (the MCP
 * package is not importable from here), so for them `resolvedModel` equals `requestedModel` by construction. A
 * cell proves the provider accepts the cap and effort and that this prompt fits; it does not bound a real artifact's
 * output, so a cap that proves too tight on real traffic is still an MCP-side finding.
 *
 * What a row proves. The Convex rows (enhance through iterate, the FREE rows) go through the repo's own resolver and
 * `call()`, so they exercise the real caller path. The last four rows (the Gemini video verifiers, the MCP visual
 * judge, MCP decompose/generate, the NodeSlide BYOK planner) are id/cap ACCEPTANCE SMOKE checks: they send through the
 * Convex `piAi.call` with the caller's id, cap and effort, not through scripts/verify-*-demo-gemini.mjs (a raw
 * generateContent fetch) or mcp/src/lib/llmClient.call. They show the provider accepts that id, key, cap and effort;
 * the callers' own request shapes rest on the fake-transport tests (piAi.requestShape.test.ts for the verifier
 * defaults, mcp/src/lib/llmClient.requestShape.test.ts for the MCP client).
 *
 * Row fields: `requestedModel` is the SPEC 1.2 id the cell claims to test (a literal below, independent of the
 * code); `resolvedModel` is what `resolveRunModel` returned for that cell's tier and phase (asserted equal BEFORE
 * any spend); `echoedModel` is `CallResult.echoedModel`, the model string read off the provider's own reply (null
 * when none came, which rejects the row). `effortOnWire` is the effort the dispatched Anthropic request carried,
 * read at the transport: the top-level `output_config.effort` (which governs the turn) and the trailing system
 * message's (applied only from the next user turn). A row is accepted only when `rowFailure` finds nothing: the
 * call finished with stopReason 'stop' (an aborted, errored or truncated call is not evidence), at least one
 * request reached the transport, the provider returned a model, and the top-level effort equals the cell's.
 * `effortOnWire` shows what was SENT; the provider does not report the effort it applied.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel } from '@earendil-works/pi-ai/compat';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
const fallback = (tier: 'balanced' | 'free', phase: Phase) => (): Route => {
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
// The three video verifiers (scripts/verify-*-demo-gemini.mjs) default GEMINI_VIDEO_MODEL to this id; the cell
// calls whatever they ship (all three must agree), so editing a script's default changes what the receipt tests.
const GEMINI_VIDEO_SCRIPTS = [
  'verify-demo-video-gemini.mjs',
  'verify-current-workflows-demo-gemini.mjs',
  'verify-readme-proof-demo-gemini.mjs',
];
function videoVerifierDefaultModel(): string {
  const ids = new Set(
    GEMINI_VIDEO_SCRIPTS.map((file) => {
      const src = readFileSync(
        fileURLToPath(new URL(`../../scripts/${file}`, import.meta.url)),
        'utf8',
      );
      const m = /GEMINI_VIDEO_MODEL \?\? '([^']+)'/.exec(src);
      if (m?.[1] === undefined) throw new Error(`${file}: no GEMINI_VIDEO_MODEL default found`);
      return m[1];
    }),
  );
  if (ids.size !== 1) throw new Error(`video verifiers disagree on the default: ${[...ids]}`);
  return [...ids][0] as string;
}

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
    // Production sends the generate cap to this fallback on a generate truncation or error.
    phase: 'generate-fallback',
    expected: 'openrouter:anthropic/claude-sonnet-5.5',
    resolve: fallback('balanced', 'generate'),
    cap: OUTPUT_CAPS.generate,
    effort: PHASE_EFFORT.generate,
  },
  {
    // The same fallback model under the larger cap decompose and iterate send it (both 24,000).
    phase: 'decompose/iterate-fallback',
    expected: 'openrouter:anthropic/claude-sonnet-5.5',
    resolve: fallback('balanced', 'iterate'),
    cap: OUTPUT_CAPS.iterate,
    effort: PHASE_EFFORT.iterate,
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
    // The FREE recovery hop (SPEC A.0.10): free, so it adds no spend, and it is the only model that takes an image.
    phase: 'generate-fallback (FREE)',
    expected: 'openrouter:google/gemma-4-26b-a4b-it:free',
    resolve: fallback('free', 'generate'),
    cap: OUTPUT_CAPS.generate,
    effort: PHASE_EFFORT.generate,
  },
  {
    // Smoke check (SPEC section D: one keyed call per repo confirms the migrated gemini-3.8-flash). It sends through
    // piAi.call (pi-ai's Google adapter), not the verifiers' own raw generateContent builder, and is text-only: it
    // proves the id and key are accepted, not the verifiers' request shape or video understanding.
    phase: 'smoke: video verifiers default id (scripts/verify-*-demo-gemini.mjs)',
    expected: 'google:gemini-3.8-flash',
    resolve: () => ({ provider: 'google', modelId: videoVerifierDefaultModel() }),
    cap: 4_000,
    effort: 'high', // ignored by the Google API
  },
  {
    phase: 'smoke: MCP visual judge id/cap (lib/visualJudge.ts, frozen default)',
    expected: 'google:gemini-3.1-pro-preview',
    resolve: () => ({ provider: 'google', modelId: 'gemini-3.1-pro-preview' }),
    cap: 4_000,
    effort: 'high', // mcp DEFAULT_EFFORT
    prompt: JUDGE_PROMPT,
  },
  {
    phase: 'smoke: MCP decompose/generate id/cap (index.ts:238, kimi-k2.6, frozen default)',
    expected: 'openrouter:moonshotai/kimi-k2.6',
    resolve: () => ({ provider: 'openrouter', modelId: 'moonshotai/kimi-k2.6' }),
    cap: 24_000,
    effort: 'high',
  },
  {
    phase: 'smoke: NodeSlide BYOK planner id/cap (nodeslideTools.ts:1060, frozen default)',
    expected: 'openrouter:z-ai/glm-5.2',
    resolve: () => ({ provider: 'openrouter', modelId: 'z-ai/glm-5.2' }),
    cap: 3_000,
    effort: 'high',
  },
];

const INPUT_TOKENS_UPPER = 200;
/** The budget the header command passes. The estimate must fit it, or the documented command fails closed. */
const DOCUMENTED_MAX_USD = 3;
/** The command as run, with the budget it ran under: re-running it as recorded must reproduce the same gate. */
const receiptCommand = (maxUsd: number): string =>
  `PARITY_LIVE_RECEIPT=1 PARITY_LIVE_MAX_USD=${maxUsd} pnpm exec vitest run convex/lib/modelRefresh.live.test.ts`;

// Transport-level request counter and request-body capture: every pi-ai request goes through the global fetch.
let transportRequests = 0;
const sentBodies: Array<Record<string, unknown> | null> = [];
const realFetch = globalThis.fetch;
beforeAll(() => {
  if (process.env['PARITY_LIVE_RECEIPT'] !== '1') return;
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    transportRequests += 1;
    const body = args[1]?.body;
    try {
      sentBodies.push(typeof body === 'string' ? JSON.parse(body) : null);
    } catch {
      sentBodies.push(null);
    }
    return realFetch(...args);
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

const routeKey = (route: Route): string => `${route.provider}:${route.modelId}`;

/**
 * Effort rides in `output_config.effort` on every Anthropic Messages request, so it is checked by the model's wire api
 * and not the provider name: OpenRouter's Claude 5.5 rows are 'anthropic-messages' too.
 */
function usesAnthropicMessages(route: Route): boolean {
  // biome-ignore lint/suspicious/noExplicitAny: pi-ai getModel is typed against its compile-time registry
  return (getModel as any)(route.provider, route.modelId).api === 'anthropic-messages';
}

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

/** What a cell's call left behind, as seen at the provider and the transport. */
interface RowEvidence {
  stopReason: string;
  errorMessage?: string;
  echoedModel: string | null;
  transportRequests: number;
  /** Anthropic Messages API rows only, direct or via OpenRouter (effort is ignored elsewhere): the requested effort and what the request carried. */
  effort: { requested: Effort; topLevel?: string; trailing?: string } | null;
}

/** Why a row is NOT receipt evidence, or null when it is (SPEC A.0.3, A.2.7: one real keyed call per phase). */
function rowFailure(e: RowEvidence): string | null {
  if (e.stopReason !== 'stop') {
    return `call did not complete: stopReason '${e.stopReason}' (need 'stop')${e.errorMessage ? `: ${e.errorMessage}` : ''}`;
  }
  if (e.transportRequests < 1) return 'no request reached the transport';
  if (e.echoedModel === null || e.echoedModel === '') return 'the provider returned no model';
  if (e.effort !== null) {
    const { requested, topLevel, trailing } = e.effort;
    if (topLevel !== requested || trailing !== requested) {
      return `effort on the wire (top level ${topLevel}, trailing ${trailing}) is not the requested ${requested}`;
    }
  }
  return null;
}

/** The effort the last Anthropic-shaped request since `from` carried, top-level and in the trailing message. */
function effortOnWire(
  from: number,
  requested: Effort,
): { requested: Effort; topLevel?: string; trailing?: string } {
  const body = sentBodies
    .slice(from)
    .reverse()
    .find((b) => b?.['output_config'] !== undefined);
  const messages = (body?.['messages'] ?? []) as Array<{ output_config?: { effort?: string } }>;
  const topLevel = (body?.['output_config'] as { effort?: string } | undefined)?.effort;
  const trailing = messages.at(-1)?.output_config?.effort;
  return {
    requested,
    ...(topLevel !== undefined ? { topLevel } : {}),
    ...(trailing !== undefined ? { trailing } : {}),
  };
}

describe('receipt harness bookkeeping (SPEC A.0.3), no spend', () => {
  it('the generate fallback is exercised at the generate cap, the decompose/iterate fallback at theirs', () => {
    const byPhase = Object.fromEntries(CELLS.map((c) => [c.phase, c.cap]));
    expect(byPhase['generate-fallback']).toBe(OUTPUT_CAPS.generate);
    expect(byPhase['decompose/iterate-fallback']).toBe(OUTPUT_CAPS.iterate);
    expect(OUTPUT_CAPS.decompose).toBe(OUTPUT_CAPS.iterate);
    expect(byPhase['advise']).toBe(OUTPUT_CAPS.agentLoop);
    expect(byPhase['execute']).toBe(OUTPUT_CAPS.agentLoop);
  });
  it('the recorded command carries the budget it ran under, and the documented budget admits the estimate', () => {
    expect(receiptCommand(DOCUMENTED_MAX_USD)).toContain(
      `PARITY_LIVE_MAX_USD=${DOCUMENTED_MAX_USD} `,
    );
    expect(estimateUsd).toBeLessThanOrEqual(DOCUMENTED_MAX_USD);
  });
});

describe('receipt row acceptance (SPEC A.0.3), no spend', () => {
  const good: RowEvidence = {
    stopReason: 'stop',
    echoedModel: 'claude-haiku-5-5',
    transportRequests: 1,
    effort: { requested: 'low', topLevel: 'low', trailing: 'low' },
  };
  it('accepts a completed, echoed, correctly-effort call', () => {
    expect(rowFailure(good)).toBeNull();
    expect(rowFailure({ ...good, effort: null })).toBeNull();
  });
  it.each(['error', 'length', 'aborted', 'pending', 'toolUse'])(
    'rejects stopReason %s',
    (stopReason) => {
      expect(rowFailure({ ...good, stopReason })).toMatch(/did not complete/);
    },
  );
  it('rejects a row with no transport request, no provider echo, or the wrong effort on the wire', () => {
    expect(rowFailure({ ...good, transportRequests: 0 })).toMatch(/transport/);
    expect(rowFailure({ ...good, echoedModel: null })).toMatch(/no model/);
    expect(
      rowFailure({ ...good, effort: { requested: 'low', topLevel: 'high', trailing: 'low' } }),
    ).toMatch(/effort on the wire/);
    expect(
      rowFailure({ ...good, effort: { requested: 'low', topLevel: 'low', trailing: 'high' } }),
    ).toMatch(/effort on the wire/);
  });
  it('effort is checked on every Anthropic Messages request, OpenRouter Claude included', () => {
    for (const [provider, modelId, expected] of [
      ['anthropic', 'claude-sonnet-5-5', true],
      ['openrouter', 'anthropic/claude-sonnet-5.5', true],
      ['openrouter', 'moonshotai/kimi-k2.6', false],
      ['openrouter', 'google/gemma-4-26b-a4b-it:free', false],
      ['google', 'gemini-3.8-flash', false],
    ] as const) {
      expect(usesAnthropicMessages({ provider, modelId }), `${provider}:${modelId}`).toBe(expected);
    }
  });
  it('a call() cut off by an already-aborted signal (the 180 s timeout case) is rejected', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('the aborted call must not reach the transport');
      }),
    );
    try {
      const result = await call({
        provider: 'anthropic',
        modelId: 'claude-haiku-5-5',
        systemPrompt: 's',
        userText: 'u',
        maxTokens: 10,
        effort: 'low',
        signal: AbortSignal.abort(),
      });
      expect(result.stopReason).toBe('aborted');
      expect(result.echoedModel).toBeNull();
      expect(
        rowFailure({
          stopReason: result.stopReason,
          echoedModel: result.echoedModel,
          transportRequests: 0,
          effort: null,
        }),
      ).toMatch(/did not complete/);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});

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
        const transportCount = transportRequests - requestsBefore;
        const effort = usesAnthropicMessages(route)
          ? effortOnWire(requestsBefore, cell.effort)
          : null;
        rows.push({
          phase: cell.phase,
          requestedModel: cell.expected,
          resolvedModel: routeKey(route),
          echoedModel: result.echoedModel,
          usage: { input: result.inputTokens, output: result.outputTokens, cap: cell.cap },
          stopReason: result.stopReason,
          completionAttempts: result.completionAttempts,
          transportRequests: transportCount,
          effortOnWire: effort,
          costUsd: result.costMicroUsd / 1_000_000,
          // call() dispatches exactly the id it is given; there is no fallback hop in this path.
          fallbackUsed: false,
        });
        expect(
          rowFailure({
            stopReason: result.stopReason,
            ...(result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {}),
            echoedModel: result.echoedModel,
            transportRequests: transportCount,
            effort,
          }),
          `${cell.phase} (cap ${cell.cap})`,
        ).toBeNull();
      }

      const receipt = {
        command: receiptCommand(maxUsd),
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
