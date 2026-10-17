import { getModels } from '@earendil-works/pi-ai/compat';
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_HAIKU,
  FREE_FALLBACK_MODEL,
  OUTPUT_CAPS,
  PHASE_EFFORT,
  type Phase,
  VERIFIED_FREE_MODEL,
  effortFor,
  resolveModel,
  sessionPick,
} from './autoRouter';
import { FREE_LOOKING } from './modelBoundary';

// Exact-id assertions read the exported constants (SPEC A.2.7 "tests moved to constants"). Superseded by the
// 5.5 refresh: anthropic/claude-haiku-4.5 and anthropic/claude-sonnet-4.6 (migration guide rename table; SPEC 1.1
// still lists both Active legacy). The
// SPEC 1.2 spelling of each constant is pinned independently in piAi.requestShape.test.ts.

describe('auto router', () => {
  it('keeps fallback as recovery metadata instead of randomly selecting it', () => {
    const model = resolveModel('free', 'generate');
    const pickedIds = new Set(
      Array.from({ length: 50 }, (_, i) => sessionPick(`run-${i}`, model).modelId),
    );
    expect(pickedIds).toEqual(new Set([model.modelId]));
    expect(model.fallback?.modelId).toBe(FREE_FALLBACK_MODEL);
  });

  it('never gives a FREE cell a paid fallback (SPEC A.0.10)', () => {
    const phases: Phase[] = [
      'enhance',
      'advise',
      'execute',
      'generate',
      'decompose',
      'iterate',
      'judge',
    ];
    for (const phase of phases) {
      const model = resolveModel('free', phase);
      expect(model.isFree, phase).toBe(true);
      expect(model.fallback?.modelId, phase).toMatch(FREE_LOOKING);
    }
  });

  it('recovers balanced prompt generation on the free image-capable model, not a paid one (SPEC D2/D2a)', () => {
    const model = resolveModel('balanced', 'generate');
    expect(model.modelId).toBe('moonshotai/kimi-k2.6');
    expect(model.fallback).toEqual({ provider: 'openrouter', modelId: FREE_FALLBACK_MODEL });
    for (const phase of ['generate', 'decompose', 'iterate'] as const) {
      expect(resolveModel('balanced', phase).fallback?.modelId, phase).toBe(FREE_FALLBACK_MODEL);
    }
  });

  // The parts of the SPEC D2 eligibility filter (VERIFIED_FREE_MODEL) the pi-ai 1.1.0 catalog can state; `tools`,
  // `expiration_date` and recency come from the public OpenRouter list and are recorded in the PR.
  it('the FREE picks meet the catalog side of the D2 filter (output cap fits, fallback takes images)', () => {
    const catalog = new Map(getModels('openrouter').map((m) => [m.id, m]));
    for (const id of [VERIFIED_FREE_MODEL, FREE_FALLBACK_MODEL]) {
      const m = catalog.get(id);
      expect(m, id).toBeDefined();
      expect(m?.contextWindow, id).toBeGreaterThanOrEqual(262_144);
      expect(m?.maxTokens, id).toBeGreaterThanOrEqual(OUTPUT_CAPS.agentLoop);
    }
    expect(catalog.get(FREE_FALLBACK_MODEL)?.input).toContain('image');
  });

  it('Haiku 5.5 takes medium effort outside enhance under both SPEC 1.2 spellings', () => {
    for (const id of [CLAUDE_HAIKU, 'anthropic/claude-haiku-5.5']) {
      expect(effortFor('execute', id), id).toBe('medium');
      expect(effortFor('enhance', id), id).toBe(PHASE_EFFORT.enhance);
    }
    expect(effortFor('execute', 'claude-sonnet-5-5')).toBe(PHASE_EFFORT.execute);
  });
});
