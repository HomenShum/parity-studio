// @vitest-environment node
/**
 * Request-shape proof for the three production builders in convex/chatLoop.ts (model-defaults SPEC A.0 rule 6):
 * `enhance`, `explainParity` and `runAgentLoop` call pi-ai's `complete()` directly, not `piAi.call()`, so they are
 * driven here through their registered Convex handlers with a fake ctx and a stubbed fetch (always 400, no spend).
 * Asserts on the JSON body that would have gone over the wire: model, `max_tokens`, the tools the agent loop sends,
 * the effort that applies, and the keys that must be absent. Also pins env-override precedence (A.0.4).
 */
import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enhance, explainParity, runAgentLoop } from './chatLoop';
import { OUTPUT_CAPS, PHASE_EFFORT, VERIFIED_FREE_MODEL } from './lib/autoRouter';

type Body = Record<string, unknown>;
let bodies: Body[] = [];
let mutations: string[] = [];

beforeEach(() => {
  bodies = [];
  mutations = [];
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key-not-real');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(
        JSON.stringify({ error: { type: 'invalid_request_error', message: 'fake transport' } }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type RunRow = { tier?: string; modelOverride?: { provider: string; modelId: string } };

function fakeCtx(run: RunRow, history: Array<{ role: string; content: string }>) {
  return {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => {
      switch (getFunctionName(ref)) {
        case 'runs:getInternal':
          return run;
        case 'uiKits:getLatestInternal':
          return { slug: 'kit', fileCount: 0, files: {} };
        case 'chat:listForLoadInternal':
          return history.map((m, i) => ({ ...m, _creationTime: i + 1 }));
        case 'chat:nextTurnNumber':
          return 1;
        case 'parityReports:getLatestInternal':
          return {
            status: 'fail',
            passCount: 0,
            totalChecks: 0,
            summary: 's',
            checks: [],
            gaps: [],
          };
        case 'artifacts:getLatestInternal':
          return null;
        default:
          throw new Error(`unexpected query ${getFunctionName(ref)}`);
      }
    },
    runMutation: async (ref: Parameters<typeof getFunctionName>[0]) => {
      mutations.push(getFunctionName(ref));
      return null;
    },
    runAction: async () => null,
    scheduler: { runAfter: async () => null },
  };
}

// biome-ignore lint/suspicious/noExplicitAny: Convex registered functions expose their handler as _handler
const handlerOf = (registered: unknown): ((ctx: any, args: any) => Promise<any>) =>
  (registered as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler;

const enhanceHandler = handlerOf(enhance);
const explainHandler = handlerOf(explainParity);
const agentLoopHandler = handlerOf(runAgentLoop);

/** The effort that applies on a managed-effort 5.5 model is the trailing system message's, not the top level. */
function activeEffort(body: Body): unknown {
  const messages = body['messages'] as Array<{ role: string; output_config?: { effort?: string } }>;
  expect(messages.at(-1)?.role, 'trailing effort message').toBe('system');
  return messages.at(-1)?.output_config?.effort;
}

function assertNoForbiddenKeys(body: Body) {
  for (const key of ['temperature', 'top_p', 'top_k', 'tool_choice']) {
    expect(body, `forbidden key ${key}`).not.toHaveProperty(key);
  }
  const thinking = body['thinking'] as Record<string, unknown> | undefined;
  if (thinking !== undefined) {
    expect(thinking['type']).toBe('adaptive');
    expect(thinking).not.toHaveProperty('budget_tokens');
  }
}

const RUN_ID = 'run_1';
const settle = (promise: Promise<unknown>) => promise.catch(() => undefined);

describe('chatLoop.enhance builds the SPEC 1.2 request', () => {
  it('FRONTIER -> claude-haiku-5-5, production cap, low effort, no forbidden keys', async () => {
    await settle(
      enhanceHandler(fakeCtx({ tier: 'frontier' }, []), { text: 'make it nicer', runId: RUN_ID }),
    );
    expect(bodies).toHaveLength(1);
    const body = bodies[0] as Body;
    expect(body['model']).toBe('claude-haiku-5-5');
    expect(body['max_tokens']).toBe(OUTPUT_CAPS.enhance);
    expect(activeEffort(body)).toBe(PHASE_EFFORT.enhance);
    assertNoForbiddenKeys(body);
  });

  it('FREE -> the verified free constant, production cap', async () => {
    await settle(
      enhanceHandler(fakeCtx({ tier: 'free' }, []), { text: 'make it nicer', runId: RUN_ID }),
    );
    const body = bodies[0] as Body;
    expect(body['model']).toBe(VERIFIED_FREE_MODEL);
    expect(body['max_tokens'] ?? body['max_completion_tokens']).toBe(OUTPUT_CAPS.enhance);
    assertNoForbiddenKeys(body);
  });
});

describe('chatLoop.runAgentLoop builds the SPEC 1.2 request with the tool surface', () => {
  const toolNames = (body: Body) =>
    // pi-ai adds its own `__pi_deferred_placeholder__` anchor tool on the managed-effort models.
    (body['tools'] as Array<{ name: string }>)
      .map((t) => t.name)
      .filter((name) => !name.startsWith('__pi_'))
      .sort();

  it('execute hop: claude-sonnet-5-5, 16k cap, high effort, all tools, no forced tool_choice', async () => {
    await agentLoopHandler(fakeCtx({ tier: 'frontier' }, [{ role: 'user', content: 'tweak it' }]), {
      runId: RUN_ID,
    });
    expect(bodies).toHaveLength(1);
    const body = bodies[0] as Body;
    expect(body['model']).toBe('claude-sonnet-5-5');
    expect(body['max_tokens']).toBe(OUTPUT_CAPS.agentLoop);
    expect(activeEffort(body)).toBe(PHASE_EFFORT.execute);
    expect(toolNames(body)).toEqual(
      [
        'done',
        'iterate_now',
        'list_files',
        'read_design_system',
        'read_file',
        'set_todos',
        'upsert_file',
      ].sort(),
    );
    assertNoForbiddenKeys(body);
  });

  it('advise hop (Auto-fix): claude-opus-5-5, same cap, high effort, tools present', async () => {
    await agentLoopHandler(
      fakeCtx({ tier: 'frontier' }, [{ role: 'user', content: 'Auto-fix triggered: fix header' }]),
      { runId: RUN_ID },
    );
    const body = bodies[0] as Body;
    expect(body['model']).toBe('claude-opus-5-5');
    expect(body['max_tokens']).toBe(OUTPUT_CAPS.agentLoop);
    expect(activeEffort(body)).toBe(PHASE_EFFORT.advise);
    expect((body['tools'] as unknown[]).length).toBeGreaterThan(0);
    assertNoForbiddenKeys(body);
  });
});

describe('chatLoop.explainParity builds the SPEC 1.2 request', () => {
  it('advise phase: claude-opus-5-5, explain cap, high effort', async () => {
    await explainHandler(fakeCtx({ tier: 'frontier' }, []), { runId: RUN_ID });
    expect(bodies).toHaveLength(1);
    const body = bodies[0] as Body;
    expect(body['model']).toBe('claude-opus-5-5');
    expect(body['max_tokens']).toBe(OUTPUT_CAPS.explain);
    expect(activeEffort(body)).toBe(PHASE_EFFORT.advise);
    assertNoForbiddenKeys(body);
  });
});

describe('env overrides still win over a run override the resolver would reject (A.0.4)', () => {
  const badRun: RunRow = {
    modelOverride: { provider: 'openrouter', modelId: 'made-up/paid-model' },
  };

  it('without an env override the unknown persisted override fails closed with zero requests', async () => {
    await expect(
      agentLoopHandler(fakeCtx(badRun, [{ role: 'user', content: 'go' }]), { runId: RUN_ID }),
    ).rejects.toThrow(/Unknown model/);
    expect(bodies).toHaveLength(0);
  });

  it('CHAT_EXECUTOR_PROVIDER + CHAT_EXECUTOR_MODEL replace it: the env model is what goes on the wire', async () => {
    vi.stubEnv('CHAT_EXECUTOR_PROVIDER', 'openrouter');
    vi.stubEnv('CHAT_EXECUTOR_MODEL', 'moonshotai/kimi-k2.6');
    await agentLoopHandler(fakeCtx(badRun, [{ role: 'user', content: 'go' }]), { runId: RUN_ID });
    expect(bodies[0]?.['model']).toBe('moonshotai/kimi-k2.6');
  });

  it('CHAT_ENHANCE_PROVIDER + CHAT_ENHANCE_MODEL replace it for enhance', async () => {
    vi.stubEnv('CHAT_ENHANCE_PROVIDER', 'openrouter');
    vi.stubEnv('CHAT_ENHANCE_MODEL', 'moonshotai/kimi-k2.6');
    await settle(enhanceHandler(fakeCtx(badRun, []), { text: 'hi', runId: RUN_ID }));
    expect(bodies[0]?.['model']).toBe('moonshotai/kimi-k2.6');
  });

  it('PARITY_EXPLAIN_* replace it for explainParity', async () => {
    vi.stubEnv('PARITY_EXPLAIN_PROVIDER', 'openrouter');
    vi.stubEnv('PARITY_EXPLAIN_MODEL', 'moonshotai/kimi-k2.6');
    await explainHandler(fakeCtx(badRun, []), { runId: RUN_ID });
    expect(bodies[0]?.['model']).toBe('moonshotai/kimi-k2.6');
  });

  it('a half-set env still resolves the run pick for the missing half, so the unknown override still throws', async () => {
    vi.stubEnv('CHAT_EXECUTOR_MODEL', 'moonshotai/kimi-k2.6');
    await expect(
      agentLoopHandler(fakeCtx(badRun, [{ role: 'user', content: 'go' }]), { runId: RUN_ID }),
    ).rejects.toThrow(/Unknown model/);
    expect(bodies).toHaveLength(0);
  });
});
