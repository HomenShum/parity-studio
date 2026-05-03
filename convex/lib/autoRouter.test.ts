import { describe, expect, it } from 'vitest';
import { resolveModel, sessionPick } from './autoRouter';

describe('auto router', () => {
  it('keeps fallback as recovery metadata instead of randomly selecting it', () => {
    const model = resolveModel('free', 'generate');
    const pickedIds = new Set(
      Array.from({ length: 50 }, (_, i) => sessionPick(`run-${i}`, model).modelId),
    );
    expect(pickedIds).toEqual(new Set([model.modelId]));
    expect(model.fallback?.modelId).toBe('anthropic/claude-haiku-4.5');
  });

  it('has a paid recovery model for balanced prompt generation', () => {
    const model = resolveModel('balanced', 'generate');
    expect(model.modelId).toBe('moonshotai/kimi-k2.6');
    expect(model.fallback).toEqual({
      provider: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4.6',
    });
  });
});
