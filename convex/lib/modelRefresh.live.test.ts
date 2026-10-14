// @vitest-environment node
/**
 * LIVE receipt for the model-defaults refresh (SPEC A.0.3, A.2.7). Gated: skipped unless PARITY_LIVE_RECEIPT=1,
 * so `pnpm test` and CI never spend. It makes one keyed call per changed phase through this repo's own `call()`,
 * asserts the provider accepted the request, echoed the requested model, and did not truncate at the production cap
 * (stopReason != 'length', the check that guards the BALANCED -> paid-fallback path), and writes a SPEC A.0.3 receipt.
 *
 *   PARITY_LIVE_RECEIPT=1 PARITY_LIVE_MAX_USD=1 ANTHROPIC_API_KEY=... OPENROUTER_API_KEY=... \
 *     pnpm exec vitest run convex/lib/modelRefresh.live.test.ts
 *
 * Run it on a clean checkout of the PR head (a dirty tree is refused). It then writes
 * evidence/model-refresh/receipt-<headSha>.json: commit that file alone on top of the tested commit (SPEC A.0.3 (a)).
 * Worst-case spend is the sum of cap x output price over CELLS (printed before any call; refused above
 * PARITY_LIVE_MAX_USD, default 1). The judge phase is not here: verifyVisual never issues a model request.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel } from '@earendil-works/pi-ai/compat';
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_HAIKU,
  CLAUDE_OPUS,
  CLAUDE_SONNET,
  OPENROUTER_CLAUDE_SONNET,
  OUTPUT_CAPS,
  VERIFIED_FREE_MODEL,
  resolveModel,
} from './autoRouter';
import { call } from './piAi';

type Provider = 'anthropic' | 'openrouter';
interface Cell {
  phase: string;
  provider: Provider;
  modelId: string;
  cap: number;
}

// One call per changed phase, plus the kimi-k2.6 phases whose caps became real (they were ignored before the
// maxTokens fix) and the FREE-tier replacement. Opus decompose differs from Opus advise only in cap (24000 vs
// 16000, both far below the model max), so it is not repeated.
const CELLS: Cell[] = [
  { phase: 'enhance', provider: 'anthropic', modelId: CLAUDE_HAIKU, cap: OUTPUT_CAPS.enhance },
  { phase: 'advise', provider: 'anthropic', modelId: CLAUDE_OPUS, cap: OUTPUT_CAPS.agentLoop },
  { phase: 'execute', provider: 'anthropic', modelId: CLAUDE_SONNET, cap: OUTPUT_CAPS.agentLoop },
  {
    phase: 'generate-fallback',
    provider: 'openrouter',
    modelId: OPENROUTER_CLAUDE_SONNET,
    cap: OUTPUT_CAPS.iterate,
  },
  ...(['generate', 'decompose', 'iterate'] as const).map((phase) => ({
    phase: `${phase} (kimi-k2.6, BALANCED)`,
    provider: 'openrouter' as const,
    modelId: resolveModel('balanced', phase).modelId,
    cap: OUTPUT_CAPS[phase],
  })),
  {
    phase: 'generate (FREE)',
    provider: 'openrouter',
    modelId: VERIFIED_FREE_MODEL,
    cap: OUTPUT_CAPS.generate,
  },
];

const PROMPT =
  'In about 300 words, explain how a design-token pipeline turns brand colors into CSS custom properties.';
const INPUT_TOKENS_UPPER = 200;

function priceOf(cell: Cell): { inPerM: number; outPerM: number } {
  // biome-ignore lint/suspicious/noExplicitAny: pi-ai getModel is typed against its compile-time registry
  const model = (getModel as any)(cell.provider, cell.modelId);
  return { inPerM: model.cost.input, outPerM: model.cost.output };
}

const estimateUsd = CELLS.reduce((sum, cell) => {
  const { inPerM, outPerM } = priceOf(cell);
  return sum + (INPUT_TOKENS_UPPER * inPerM + cell.cap * outPerM) / 1_000_000;
}, 0);

const git = (...args: string[]): string =>
  execFileSync('git', args, {
    encoding: 'utf8',
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
  }).trim();

describe.skipIf(process.env['PARITY_LIVE_RECEIPT'] !== '1')(
  'live receipt: model-defaults refresh',
  () => {
    it(`one keyed call per changed phase (worst case ~$${estimateUsd.toFixed(2)}), no truncation, no fallback`, async () => {
      const maxUsd = Number(process.env['PARITY_LIVE_MAX_USD'] ?? '1');
      expect(estimateUsd, `worst case exceeds PARITY_LIVE_MAX_USD=${maxUsd}`).toBeLessThanOrEqual(
        maxUsd,
      );
      const testedCommit = git('rev-parse', 'HEAD');
      expect(git('status', '--porcelain', '--', '.', ':(exclude)evidence'), 'gitDirty').toBe('');

      const startedAt = new Date().toISOString();
      const rows: Array<Record<string, unknown>> = [];
      let spentUsd = 0;
      for (const cell of CELLS) {
        const result = await call({
          provider: cell.provider,
          modelId: cell.modelId,
          systemPrompt: 'You are a concise technical writer.',
          userText: PROMPT,
          maxTokens: cell.cap,
          signal: AbortSignal.timeout(180_000),
        });
        spentUsd += result.costMicroUsd / 1_000_000;
        rows.push({
          phase: cell.phase,
          requestedModel: `${cell.provider}:${cell.modelId}`,
          resolvedModel: `${cell.provider}:${cell.modelId}`,
          echoedModel: result.echoedModel ?? null,
          usage: { input: result.inputTokens, output: result.outputTokens, cap: cell.cap },
          stopReason: result.stopReason,
          costUsd: result.costMicroUsd / 1_000_000,
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
        candidateIds: CELLS.map((c) => `${c.provider}:${c.modelId}`),
        echoedModels: rows.map((r) => r['echoedModel']),
        rows,
        testedCommit,
        constantSha256: createHash('sha256')
          .update(readFileSync(fileURLToPath(new URL('./autoRouter.ts', import.meta.url))))
          .digest('hex'),
        budget: { maxUsd, estimateUsd, spentUsd, requests: rows.length, stoppedBy: null },
        startedAt,
        environment: { node: process.version, piAi: '1.1.0' },
      };
      const dir = fileURLToPath(new URL('../../evidence/model-refresh/', import.meta.url));
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}receipt-${testedCommit}.json`, `${JSON.stringify(receipt, null, 2)}\n`);
    }, 900_000);
  },
);
