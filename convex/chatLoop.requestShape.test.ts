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
let mutationCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

// pi-ai's own default effort is 'high', and most phases are 'high' too, so a call that forgot to pass the phase's
// effort would be invisible. Distinct sentinels make the pass-through observable: the request must carry exactly
// what PHASE_EFFORT says for the phase, whatever that is.
const ORIGINAL_EFFORT = { ...PHASE_EFFORT };

beforeEach(() => {
  Object.assign(PHASE_EFFORT, { enhance: 'medium', advise: 'low', execute: 'medium' });
  bodies = [];
  mutations = [];
  mutationCalls = [];
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
  Object.assign(PHASE_EFFORT, ORIGINAL_EFFORT);
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
    runMutation: async (
      ref: Parameters<typeof getFunctionName>[0],
      args: Record<string, unknown>,
    ) => {
      const name = getFunctionName(ref);
      mutations.push(name);
      mutationCalls.push({ name, args });
      return name === 'uiKits:upsertFileInternal' ? { created: true, sizeBytes: 1 } : null;
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

/** The effort that governs the turn on a managed-effort 5.5 model: the top-level `output_config.effort`. */
function activeEffort(body: Body): unknown {
  const messages = body['messages'] as Array<{ role: string; output_config?: { effort?: string } }>;
  expect(messages.at(-1)?.role, 'trailing effort message').toBe('system');
  const topLevel = (body['output_config'] as { effort?: string } | undefined)?.effort;
  // The API applies a per-message effort from the NEXT user turn and none follows, so the top-level value is the
  // one that governs this turn: it must carry the phase effort, and the trailing message must agree with it.
  expect(messages.at(-1)?.output_config?.effort, 'trailing effort agrees with top level').toBe(
    topLevel,
  );
  return topLevel;
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
  // SPEC 1.3: assistant prefill is a 400. runAgentLoop is the only path that replays assistant history; the last
  // non-system message (pi-ai appends a trailing effort `system` message on the 5.5 models) must not be assistant.
  const messages = (body['messages'] ?? []) as Array<{ role: string }>;
  expect(messages.filter((m) => m.role !== 'system').at(-1)?.role).not.toBe('assistant');
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

  it('execute hop: claude-sonnet-5-5, agent-loop cap, high effort, all tools, no forced tool_choice', async () => {
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

  // Review round 6: these two used to assert `.rejects` (the throw escaped the scheduled action, so the user got no
  // reply at all). On main an unknown id reached piComplete(undefined), which rejected inside the try and left a
  // visible '(agent error: ...)' turn; that is the contract kept here, and still with zero requests.
  const errorTurns = () =>
    mutationCalls
      .filter((c) => c.name === 'chat:insertTurn')
      .map((c) => String(c.args['content']))
      .filter((content) => content.startsWith('(agent error:'));

  it('without an env override the unknown persisted override fails closed: zero requests and a visible error turn', async () => {
    await agentLoopHandler(fakeCtx(badRun, [{ role: 'user', content: 'go' }]), { runId: RUN_ID });
    expect(bodies).toHaveLength(0);
    expect(errorTurns()).toHaveLength(1);
    expect(errorTurns()[0]).toMatch(/Unknown model "made-up\/paid-model"/);
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

  // Review round 3: this used to assert a throw ("a half-set env still resolves the run pick ... still throws"). A.0.4
  // says an env override wins over the run's pick, and main sent the env model (provider from the stored row), so the
  // throw was a regression. The pair that will actually be sent is what gets validated.
  it('CHAT_EXECUTOR_MODEL alone replaces the obsolete stored model: the stored provider, the env model', async () => {
    vi.stubEnv('CHAT_EXECUTOR_MODEL', 'moonshotai/kimi-k2.6');
    await agentLoopHandler(fakeCtx(badRun, [{ role: 'user', content: 'go' }]), { runId: RUN_ID });
    expect(bodies[0]?.['model']).toBe('moonshotai/kimi-k2.6');
  });

  it('CHAT_ENHANCE_MODEL alone replaces it for enhance, and PARITY_EXPLAIN_MODEL for explainParity', async () => {
    vi.stubEnv('CHAT_ENHANCE_MODEL', 'moonshotai/kimi-k2.6');
    await settle(enhanceHandler(fakeCtx(badRun, []), { text: 'hi', runId: RUN_ID }));
    expect(bodies[0]?.['model']).toBe('moonshotai/kimi-k2.6');
    vi.stubEnv('PARITY_EXPLAIN_MODEL', 'moonshotai/kimi-k2.6');
    await explainHandler(fakeCtx(badRun, []), { runId: RUN_ID });
    expect(bodies[1]?.['model']).toBe('moonshotai/kimi-k2.6');
  });

  it('an env model the catalog does not know still fails closed with zero requests, whatever the stored row says', async () => {
    vi.stubEnv('CHAT_EXECUTOR_MODEL', 'made-up/other-paid-model');
    await agentLoopHandler(fakeCtx({ tier: 'balanced' }, [{ role: 'user', content: 'go' }]), {
      runId: RUN_ID,
    });
    expect(bodies).toHaveLength(0);
    expect(errorTurns()[0]).toMatch(/Unknown model "made-up\/other-paid-model"/);
  });

  it('explainParity with an unknown stored override falls back to the rule-based explanation, zero requests', async () => {
    const out = await explainHandler(fakeCtx(badRun, []), { runId: RUN_ID });
    expect(bodies).toHaveLength(0);
    expect(out).toMatchObject({ modelUsed: 'rule-based', provider: 'local', costMicroUsd: 0 });
  });
});

describe('an unknown free-looking env id resolves to the verified free constant (A.0.10)', () => {
  it('CHAT_ENHANCE_* with an unknown :free id sends the verified free model, not a TypeError', async () => {
    vi.stubEnv('CHAT_ENHANCE_PROVIDER', 'openrouter');
    vi.stubEnv('CHAT_ENHANCE_MODEL', 'nonexistent/model:free');
    await settle(enhanceHandler(fakeCtx({}, []), { text: 'hi' }));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.['model']).toBe(VERIFIED_FREE_MODEL);
  });

  it('CHAT_EXECUTOR_* with an unknown -free id sends the verified free model', async () => {
    vi.stubEnv('CHAT_EXECUTOR_PROVIDER', 'openrouter');
    vi.stubEnv('CHAT_EXECUTOR_MODEL', 'obsolete/model-free');
    await agentLoopHandler(fakeCtx({}, [{ role: 'user', content: 'go' }]), { runId: RUN_ID });
    expect(bodies[0]?.['model']).toBe(VERIFIED_FREE_MODEL);
  });
});

// Persona: a builder asks the chat agent to write a large index.html. The reply runs into the output cap partway
// through the upsert_file arguments. pi-ai still hands back a tool call with the partial content, and before this fix
// the loop saved it as if complete, leaving a cut-off file in the kit.
describe('a reply cut off by the output cap never runs its tool calls', () => {
  const sseEvent = (type: string, data: unknown) =>
    `event: ${type}
data: ${JSON.stringify({ type, ...(data as object) })}

`;

  const truncatedUpsertStream = (stopReason: 'max_tokens' | 'tool_use') =>
    [
      sseEvent('message_start', {
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-5-5',
          content: [],
          stop_reason: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      }),
      sseEvent('content_block_start', {
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'upsert_file', input: {} },
      }),
      sseEvent('content_block_delta', {
        index: 0,
        delta: {
          type: 'input_json_delta',
          partial_json: '{"path":"index.html","content":"<html><body><main>half a fi',
        },
      }),
      sseEvent('content_block_stop', { index: 0 }),
      sseEvent('message_delta', {
        delta: { stop_reason: stopReason },
        usage: { output_tokens: OUTPUT_CAPS.agentLoop },
      }),
      sseEvent('message_stop', {}),
    ].join('');

  const stubStream = (stopReason: 'max_tokens' | 'tool_use') =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response(truncatedUpsertStream(stopReason), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }),
    );

  it('stop_reason max_tokens: upsertFileInternal is never called, no tool call is recorded, the user sees why', async () => {
    stubStream('max_tokens');
    await agentLoopHandler(fakeCtx({ tier: 'frontier' }, [{ role: 'user', content: 'write it' }]), {
      runId: RUN_ID,
    });
    expect(bodies).toHaveLength(1);
    expect(mutations).not.toContain('uiKits:upsertFileInternal');
    const turns = mutationCalls.filter((c) => c.name === 'chat:insertTurn').map((c) => c.args);
    expect(turns.some((t) => t['toolCalls'] !== undefined)).toBe(false);
    expect(turns.at(-1)?.['content']).toMatch(/output cap while writing upsert_file/);
  });

  it('control: the same stream ending in tool_use runs the call, so the guard is what stops the write', async () => {
    stubStream('tool_use');
    await agentLoopHandler(fakeCtx({ tier: 'frontier' }, [{ role: 'user', content: 'write it' }]), {
      runId: RUN_ID,
    });
    expect(mutations).toContain('uiKits:upsertFileInternal');
  });
});
