// @vitest-environment node
/**
 * Public model-selection boundary (model-defaults SPEC A.0.10): `runs.setModelSelection` and the `modelOverride`
 * argument of the run-creating mutations must refuse an unknown paid id before persisting it, using the same rule
 * as the action-side resolver. The V8 runtime cannot import pi-ai, so the boundary reads a generated snapshot of the
 * catalog; the drift test below fails the moment that snapshot and the installed catalog disagree.
 */
import { getModels } from '@earendil-works/pi-ai/compat';
import { describe, expect, it } from 'vitest';
import { MODEL_PRESETS } from '../../src/lib/modelRouting';
import { setModelSelection } from '../runs';
import { failClosedRoute, resolveRunModel } from './autoRouter';
import { KNOWN_MODEL_IDS } from './knownModelIds.generated';
import { SPEC_FREE_MODELS, assertSelectableModel } from './modelBoundary';

const PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'groq',
  'cerebras',
  'xai',
  'mistral',
];

describe('the generated snapshot matches the installed pi-ai catalog', () => {
  for (const provider of PROVIDERS) {
    it(`${provider}: same ids (regenerate with scripts/gen-known-model-ids.mjs after a pi-ai bump)`, () => {
      const catalog = getModels(provider as never).map((m: { id: string }) => m.id);
      expect([...(KNOWN_MODEL_IDS[provider] ?? [])].sort()).toEqual([...catalog].sort());
    });
  }
});

describe('assertSelectableModel', () => {
  it('accepts every UI preset and every persisted 4.x id', () => {
    for (const preset of MODEL_PRESETS) {
      expect(
        () => assertSelectableModel(preset.provider, preset.modelId),
        preset.label,
      ).not.toThrow();
    }
    expect(() => assertSelectableModel('anthropic', 'claude-sonnet-4-6')).not.toThrow();
  });

  it('accepts an unknown free-looking id (the resolver turns it into the verified free constant)', () => {
    expect(() => assertSelectableModel('openrouter', 'made-up/model:free')).not.toThrow();
  });

  it('refuses any other unknown id, and a known id under the wrong provider', () => {
    for (const [provider, modelId] of [
      ['openrouter', 'made-up/paid-model'],
      ['anthropic', 'claude-sonnet-5.5'],
      ['anthropic', 'moonshotai/kimi-k2.6'],
    ] as const) {
      expect(() => assertSelectableModel(provider, modelId), `${provider}:${modelId}`).toThrow(
        /Unknown model/,
      );
    }
  });

  it('agrees with the action-side resolver on every case above', () => {
    for (const [provider, modelId] of [
      ['openrouter', 'made-up/paid-model'],
      ['anthropic', 'claude-sonnet-5.5'],
      ['openrouter', 'made-up/model:free'],
      ['anthropic', 'claude-sonnet-4-6'],
    ] as const) {
      const boundary = (() => {
        try {
          assertSelectableModel(provider, modelId);
          return true;
        } catch {
          return false;
        }
      })();
      const resolver = (() => {
        try {
          resolveRunModel({ modelOverride: { provider, modelId } }, 'execute', 'r');
          return true;
        } catch {
          return false;
        }
      })();
      expect(boundary, `${provider}:${modelId}`).toBe(resolver);
    }
  });

  // SPEC D1: a known id is never silently rerouted to another model.
  it('a known free id spelled under the wrong provider runs as itself on OpenRouter, not as the verified free constant', () => {
    for (const modelId of ['google/gemma-4-26b-a4b-it:free', 'google/gemma-4-31b-it:free']) {
      expect(() => assertSelectableModel('google', modelId), modelId).not.toThrow();
      expect(failClosedRoute('google', modelId), modelId).toEqual({
        provider: 'openrouter',
        modelId,
      });
    }
  });

  it('a SPEC 1.2 free id the pi-ai catalog cannot call is refused at both layers, never rerouted', () => {
    const modelId = 'nvidia/nemotron-3.5-content-safety:free';
    for (const provider of ['openrouter', 'google'] as const) {
      expect(() => assertSelectableModel(provider, modelId), `boundary ${provider}`).toThrow(
        /known free route/,
      );
      expect(() => failClosedRoute(provider, modelId), `resolver ${provider}`).toThrow(
        /known free route/,
      );
    }
  });

  it('every SPEC 1.2 free id is either callable as itself or refused: none is substituted', () => {
    const openrouter = new Set(getModels('openrouter' as never).map((m: { id: string }) => m.id));
    for (const modelId of SPEC_FREE_MODELS) {
      if (openrouter.has(modelId)) {
        expect(failClosedRoute('openrouter', modelId)).toEqual({ provider: 'openrouter', modelId });
      } else {
        expect(() => failClosedRoute('openrouter', modelId), modelId).toThrow(/known free route/);
      }
    }
  });

  // pi-ai looks ids up as MODELS[provider]?.[id], so getModel('openrouter', 'toString') returns an inherited
  // function. Both resolvers must check catalog membership, not `getModel(...) !== undefined`.
  it('refuses inherited Object.prototype names at the boundary and in failClosedRoute alike', () => {
    for (const modelId of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      for (const provider of ['openrouter', 'anthropic'] as const) {
        expect(() => assertSelectableModel(provider, modelId), `boundary ${modelId}`).toThrow(
          /Unknown model/,
        );
        expect(() => failClosedRoute(provider, modelId), `resolver ${modelId}`).toThrow(
          /Unknown model/,
        );
      }
    }
    expect(failClosedRoute('anthropic', 'claude-sonnet-5-5')).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-5-5',
    });
  });
});

describe('runs.setModelSelection handler', () => {
  const handler = (
    setModelSelection as unknown as {
      _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
    }
  )._handler;

  function fakeDb() {
    const patches: unknown[] = [];
    return {
      patches,
      ctx: {
        db: {
          get: async () => ({ _id: 'run_1' }),
          patch: async (_id: string, v: unknown) => patches.push(v),
        },
      },
    };
  }

  it('persists a catalog model', async () => {
    const { ctx, patches } = fakeDb();
    await expect(
      handler(ctx, {
        runId: 'run_1',
        modelOverride: { provider: 'anthropic', modelId: ' claude-opus-5-5 ' },
      }),
    ).resolves.toEqual({ ok: true });
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ modelOverride: { modelId: 'claude-opus-5-5' } });
  });

  it('refuses an unknown paid model: throws, nothing persisted', async () => {
    const { ctx, patches } = fakeDb();
    await expect(
      handler(ctx, {
        runId: 'run_1',
        modelOverride: { provider: 'openrouter', modelId: 'made-up/paid-model' },
      }),
    ).rejects.toThrow(/Unknown model/);
    expect(patches).toHaveLength(0);
  });

  it('still lets a tier change through', async () => {
    const { ctx, patches } = fakeDb();
    await expect(handler(ctx, { runId: 'run_1', tier: 'free' })).resolves.toEqual({ ok: true });
    expect(patches).toHaveLength(1);
  });
});
