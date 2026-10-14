import { describe, expect, it } from 'vitest';
import {
  OPENROUTER_CLAUDE_HAIKU,
  OPENROUTER_CLAUDE_SONNET,
  resolveModel,
  sessionPick,
} from './autoRouter';

// Exact-id assertions read the exported constants (SPEC A.2.7 "tests moved to constants"). Retired by the 5.5
// refresh: anthropic/claude-haiku-4.5 and anthropic/claude-sonnet-4.6 (migration guide rename table). The
// SPEC 1.2 spelling of each constant is pinned independently in piAi.requestShape.test.ts.

describe('auto router', () => {
  it('keeps fallback as recovery metadata instead of randomly selecting it', () => {
    const model = resolveModel('free', 'generate');
    const pickedIds = new Set(
      Array.from({ length: 50 }, (_, i) => sessionPick(`run-${i}`, model).modelId),
    );
    expect(pickedIds).toEqual(new Set([model.modelId]));
    expect(model.fallback?.modelId).toBe(OPENROUTER_CLAUDE_HAIKU);
  });

  it('has a paid recovery model for balanced prompt generation', () => {
    const model = resolveModel('balanced', 'generate');
    expect(model.modelId).toBe('moonshotai/kimi-k2.6');
    expect(model.fallback).toEqual({
      provider: 'openrouter',
      modelId: OPENROUTER_CLAUDE_SONNET,
    });
  });
});
