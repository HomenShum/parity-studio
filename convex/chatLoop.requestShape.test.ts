import { getModel } from '@earendil-works/pi-ai/compat';
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
    // Haiku 4.5 ran enhance with no thinking, so Haiku 5.5 takes 'low' (HAIKU_EFFORT), not the Opus/Sonnet table value.
    expect(activeEffort(body)).toBe('low');
    assertNoForbiddenKeys(body);
  });

  // MCP parity_enhance_prompt and the ChatPanel without a runId call enhance with no run, so the model is the env
  // chain's end (CHAT_MODEL, Sonnet 5.5), not Haiku. It ran on Sonnet 4.6 at the API default 'high', so the phase
  // table's 'high' applies; 'low' here would be an unmeasured drop.
  it('no run -> claude-sonnet-5-5 keeps the Sonnet/Opus phase effort (high), not the Haiku enhance effort', async () => {
    expect(ORIGINAL_EFFORT.enhance).toBe('high');
    await settle(enhanceHandler(fakeCtx({}, []), { text: 'make it nicer' }));
    expect(bodies).toHaveLength(1);
    const body = bodies[0] as Body;
    expect(body['model']).toBe('claude-sonnet-5-5');
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

// Persona: a user (or ops, via CHAT_EXECUTOR_MODEL) picks the free model google/gemma-4-26b-a4b-it:free
// for the chat agent. Its catalog maximum output is 32,768, but OUTPUT_CAPS.agentLoop (64,000) is sized for the
// 128K Claude 5.5 models and pi-ai copies maxTokens into the request unclamped, so the request asked for more than
// the model can emit. The phase cap must be bounded by the selected model's own maximum.
describe('the phase cap never exceeds the selected model maximum output', () => {
  const catalogMax = (provider: string, id: string): number =>
    // biome-ignore lint/suspicious/noExplicitAny: pi-ai's getModel surface
    (getModel as any)(provider, id).maxTokens;
  const GEMMA = 'google/gemma-4-26b-a4b-it:free';

  it('the fixture really is below the cap (otherwise the test proves nothing)', () => {
    expect(catalogMax('openrouter', GEMMA)).toBeLessThan(OUTPUT_CAPS.agentLoop);
  });

  it('agent loop on gemma sends the catalog maximum, not OUTPUT_CAPS.agentLoop', async () => {
    vi.stubEnv('CHAT_EXECUTOR_PROVIDER', 'openrouter');
    vi.stubEnv('CHAT_EXECUTOR_MODEL', GEMMA);
    await agentLoopHandler(fakeCtx({ tier: 'frontier' }, [{ role: 'user', content: 'go' }]), {
      runId: RUN_ID,
    });
    expect(bodies).toHaveLength(1);
    const body = bodies[0] as Body;
    expect(body['model']).toBe(GEMMA);
    const sent = (body['max_completion_tokens'] ?? body['max_tokens']) as number;
    expect(sent).toBe(catalogMax('openrouter', GEMMA));
    expect(sent).toBeLessThan(OUTPUT_CAPS.agentLoop);
  });

  it('a model whose maximum is above the cap still gets the phase cap (claude-sonnet-5-5 keeps 64,000)', async () => {
    await agentLoopHandler(fakeCtx({ tier: 'frontier' }, [{ role: 'user', content: 'go' }]), {
      runId: RUN_ID,
    });
    expect((bodies[0] as Body)['max_tokens']).toBe(OUTPUT_CAPS.agentLoop);
  });
});

// The SMALL tier's advise and execute cells moved Haiku 4.5 -> Haiku 5.5. Haiku 4.5 ran with no thinking and no effort
// parameter, so PHASE_EFFORT's 'high' (a statement about Opus 4.7 / Sonnet 4.6) has no baseline there: those cells
// take Haiku 5.5's own default, 'medium', whatever the phase table says.
describe('SMALL tier (Haiku 5.5) does not inherit the Opus/Sonnet phase effort', () => {
  it('execute hop: claude-haiku-5-5 sends medium although the phase table says high', async () => {
    Object.assign(PHASE_EFFORT, { execute: 'high' });
    await agentLoopHandler(fakeCtx({ tier: 'small' }, [{ role: 'user', content: 'tweak it' }]), {
      runId: RUN_ID,
    });
    const body = bodies[0] as Body;
    expect(body['model']).toBe('claude-haiku-5-5');
    expect(activeEffort(body)).toBe('medium');
  });

  it('advise hop (Auto-fix): claude-haiku-5-5 sends medium although the phase table says low', async () => {
    await agentLoopHandler(
      fakeCtx({ tier: 'small' }, [{ role: 'user', content: 'Auto-fix triggered: fix header' }]),
      { runId: RUN_ID },
    );
    const body = bodies[0] as Body;
    expect(body['model']).toBe('claude-haiku-5-5');
    expect(PHASE_EFFORT.advise).toBe('low');
    expect(activeEffort(body)).toBe('medium');
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

  // A.0.10: an unknown non-free id throws at the first resolver and again at the public action boundary; it is not
  // swallowed into the rule-based text (which reported success, provider 'local', $0).
  it('explainParity with an unknown stored override throws at the action boundary, zero requests', async () => {
    await expect(explainHandler(fakeCtx(badRun, []), { runId: RUN_ID })).rejects.toThrow(
      /Unknown model/,
    );
    expect(bodies).toHaveLength(0);
  });

  it('explainParity with an unknown non-free PARITY_EXPLAIN_MODEL throws, zero requests', async () => {
    vi.stubEnv('PARITY_EXPLAIN_MODEL', 'made-up/other-paid-model');
    await expect(
      explainHandler(fakeCtx({ tier: 'balanced' }, []), { runId: RUN_ID }),
    ).rejects.toThrow(/Unknown model "made-up\/other-paid-model"/);
    expect(bodies).toHaveLength(0);
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

  const truncatedUpsertStream = (stopReason: 'max_tokens' | 'tool_use' | 'refusal') =>
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

  const stubStream = (stopReason: 'max_tokens' | 'tool_use' | 'refusal') =>
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

  // Claude 5.5 models can end a reply with stop_reason 'refusal'. pi-ai maps it to stopReason 'error' and keeps the
  // partial tool_use block, so a guard that only knew 'length' still wrote the half file (12 writes, no error turn).
  it('stop_reason refusal: the partial upsert_file is never run and the user sees why', async () => {
    stubStream('refusal');
    await agentLoopHandler(fakeCtx({ tier: 'frontier' }, [{ role: 'user', content: 'write it' }]), {
      runId: RUN_ID,
    });
    expect(bodies).toHaveLength(1);
    expect(mutations).not.toContain('uiKits:upsertFileInternal');
    const turns = mutationCalls.filter((c) => c.name === 'chat:insertTurn').map((c) => c.args);
    expect(turns.some((t) => t['toolCalls'] !== undefined)).toBe(false);
    expect(turns.at(-1)?.['content']).toMatch(
      /agent error: the model ended the reply early \(error.*writing upsert_file/,
    );
  });

  it('control: the same stream ending in tool_use runs the call, so the guard is what stops the write', async () => {
    stubStream('tool_use');
    await agentLoopHandler(fakeCtx({ tier: 'frontier' }, [{ role: 'user', content: 'write it' }]), {
      runId: RUN_ID,
    });
    expect(mutations).toContain('uiKits:upsertFileInternal');
  });
});

// Persona: an operator runs the chat agent on an OpenAI-compatible route (the frozen kimi-k2.6, or a :free nemotron
// through OpenRouter). Those providers answer a tool call with finish_reason 'tool_calls' or, often, 'stop', and pi-ai
// 1.1.0 maps 'stop' to stopReason 'stop' even when tool_calls came with it. On main those calls ran; a guard that
// accepted only 'toolUse' refused every one of them with an '(agent error ...)' turn.
describe('tool calls on an OpenAI-compatible route (finish_reason stop / tool_calls / length)', () => {
  const chunk = (delta: unknown, finish: string | null) =>
    `data: ${JSON.stringify({
      id: 'c1',
      object: 'chat.completion.chunk',
      model: 'moonshotai/kimi-k2.6',
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;

  const toolStream = (finish: 'stop' | 'tool_calls' | 'length') =>
    [
      chunk({ role: 'assistant', content: null }, null),
      chunk(
        {
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: {
                name: 'upsert_file',
                arguments: '{"path":"index.html","content":"<html><body>done</body></html>"}',
              },
            },
          ],
        },
        null,
      ),
      chunk({}, finish),
      'data: [DONE]\n\n',
    ].join('');

  const textStream = [
    chunk({ role: 'assistant', content: 'all set' }, null),
    chunk({}, 'stop'),
    'data: [DONE]\n\n',
  ].join('');

  /** First request gets the tool-call reply, every later one a plain finished text reply. */
  const stubOpenAi = (finish: 'stop' | 'tool_calls' | 'length') => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')));
        n += 1;
        return new Response(n === 1 ? toolStream(finish) : textStream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }),
    );
  };

  const runKimi = async () => {
    vi.stubEnv('CHAT_EXECUTOR_PROVIDER', 'openrouter');
    vi.stubEnv('CHAT_EXECUTOR_MODEL', 'moonshotai/kimi-k2.6');
    await agentLoopHandler(fakeCtx({ tier: 'frontier' }, [{ role: 'user', content: 'write it' }]), {
      runId: RUN_ID,
    });
  };

  const lastTurn = () =>
    String(mutationCalls.filter((c) => c.name === 'chat:insertTurn').at(-1)?.args['content']);

  it("finish_reason 'stop' together with tool_calls: the call runs (as on main) and the loop continues", async () => {
    stubOpenAi('stop');
    await runKimi();
    expect(mutations).toContain('uiKits:upsertFileInternal');
    expect(lastTurn()).not.toMatch(/agent error/);
    expect(bodies).toHaveLength(2);
  });

  it("finish_reason 'tool_calls': the call runs", async () => {
    stubOpenAi('tool_calls');
    await runKimi();
    expect(mutations).toContain('uiKits:upsertFileInternal');
    expect(lastTurn()).not.toMatch(/agent error/);
  });

  it("finish_reason 'length' with partial tool_calls: nothing runs and the user sees why", async () => {
    stubOpenAi('length');
    await runKimi();
    expect(mutations).not.toContain('uiKits:upsertFileInternal');
    expect(lastTurn()).toMatch(/output cap while writing upsert_file/);
    expect(bodies).toHaveLength(1);
  });
});

// Persona: a builder clicks the sparkle button on a half-written prompt, asks for the parity explanation, or chats
// with the agent. The reply is plain text (no tool call) and stops mid-sentence: it hit the output cap (adaptive
// thinking counts toward it, so 4,000 tokens can be used up before the answer is done) or the model refused. Before
// this fix enhance dropped the half sentence into the composer as a finished rewrite, explainParity showed it as the
// parity readout, and the agent loop stored it as an ordinary turn. All three must say the reply is unfinished.
describe('a text-only reply that did not finish is never presented as a finished one', () => {
  const sse = (type: string, data: unknown) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...(data as object) })}\n\n`;
  const CUT_OFF = 'Redesign the hero with a soft 12px rad';
  const OUT_TOKENS = 4_000;

  const textStream = (model: string, stopReason: 'end_turn' | 'max_tokens' | 'refusal') =>
    [
      sse('message_start', {
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      }),
      sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: CUT_OFF } }),
      sse('content_block_stop', { index: 0 }),
      sse('message_delta', {
        delta: { stop_reason: stopReason },
        usage: { output_tokens: OUT_TOKENS },
      }),
      sse('message_stop', {}),
    ].join('');

  const stubText = (model: string, stopReason: 'end_turn' | 'max_tokens' | 'refusal') =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response(textStream(model, stopReason), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }),
    );

  const turns = () => mutationCalls.filter((c) => c.name === 'chat:insertTurn').map((c) => c.args);
  const unfinished = ['max_tokens', 'refusal'] as const;

  for (const stop of unfinished) {
    it(`enhance, stop_reason ${stop}: throws, so the UI shows "couldn't enhance"`, async () => {
      stubText('claude-haiku-5-5', stop);
      await expect(
        enhanceHandler(fakeCtx({ tier: 'frontier' }, []), { text: 'make it nicer', runId: RUN_ID }),
      ).rejects.toThrow(/chat:enhance reply unfinished/);
      expect(bodies).toHaveLength(1);
    });

    it(`explainParity, stop_reason ${stop}: the rule-based text, and the billed cost is kept`, async () => {
      stubText('claude-opus-5-5', stop);
      const out = await explainHandler(fakeCtx({ tier: 'frontier' }, []), { runId: RUN_ID });
      expect(bodies).toHaveLength(1);
      expect(out.modelUsed).toBe('rule-based');
      expect(out.text).not.toContain(CUT_OFF);
      // 10 input + 4,000 output tokens at the catalog price of the model that answered.
      // biome-ignore lint/suspicious/noExplicitAny: pi-ai's getModel surface
      const price = (getModel as any)('anthropic', 'claude-opus-5-5').cost as {
        input: number;
        output: number;
      };
      const expected = Math.round(((10 * price.input + OUT_TOKENS * price.output) / 1e6) * 1e6);
      expect(expected).toBeGreaterThan(0);
      expect(out.costMicroUsd).toBe(expected);
    });

    it(`agent loop, stop_reason ${stop}: the user sees an agent error turn, not a plain reply`, async () => {
      stubText('claude-sonnet-5-5', stop);
      await agentLoopHandler(fakeCtx({ tier: 'frontier' }, [{ role: 'user', content: 'go' }]), {
        runId: RUN_ID,
      });
      expect(bodies).toHaveLength(1);
      expect(mutations).not.toContain('uiKits:upsertFileInternal');
      const last = String(turns().at(-1)?.['content']);
      expect(last).toMatch(/^\(agent error: /);
      expect(last).toMatch(stop === 'max_tokens' ? /output cap/ : /ended the reply early/);
    });
  }

  it('control: the same text ending in end_turn is a finished reply on all three paths', async () => {
    stubText('claude-haiku-5-5', 'end_turn');
    const enhanced = await enhanceHandler(fakeCtx({ tier: 'frontier' }, []), {
      text: 'make it nicer',
      runId: RUN_ID,
    });
    expect(enhanced.text).toBe(CUT_OFF);
    stubText('claude-opus-5-5', 'end_turn');
    const explained = await explainHandler(fakeCtx({ tier: 'frontier' }, []), { runId: RUN_ID });
    expect(explained.text).toBe(CUT_OFF);
    expect(explained.modelUsed).not.toBe('rule-based');
    stubText('claude-sonnet-5-5', 'end_turn');
    await agentLoopHandler(fakeCtx({ tier: 'frontier' }, [{ role: 'user', content: 'go' }]), {
      runId: RUN_ID,
    });
    const last = String(turns().at(-1)?.['content']);
    expect(last).toBe(CUT_OFF);
  });
});

describe('runAgentLoop keeps the request append-only across hops (Claude 5.5 preserved thinking)', () => {
  const sse = (type: string, data: unknown) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...(data as object) })}\n\n`;
  const start = sse('message_start', {
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [],
      stop_reason: null,
      usage: { input_tokens: 10, output_tokens: 1 },
    },
  });
  // Hop 1: a signed thinking block, then a tool call. Hop 2: plain text, which ends the loop.
  const hop1 = [
    start,
    sse('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } }),
    sse('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'plan' } }),
    sse('content_block_delta', {
      index: 0,
      delta: { type: 'signature_delta', signature: 'sig-1' },
    }),
    sse('content_block_stop', { index: 0 }),
    sse('content_block_start', {
      index: 1,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'list_files', input: {} },
    }),
    sse('content_block_delta', {
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{}' },
    }),
    sse('content_block_stop', { index: 1 }),
    sse('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }),
    sse('message_stop', {}),
  ].join('');
  const hop2 = [
    start,
    sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'done' } }),
    sse('content_block_stop', { index: 0 }),
    sse('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }),
    sse('message_stop', {}),
  ].join('');

  it('hop 2 sends every hop-1 message unchanged, then the new ones', async () => {
    let hop = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')));
        hop += 1;
        return new Response(hop === 1 ? hop1 : hop2, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }),
    );
    await agentLoopHandler(fakeCtx({ tier: 'frontier' }, [{ role: 'user', content: 'list' }]), {
      runId: RUN_ID,
    });
    expect(bodies).toHaveLength(2);
    expect(bodies.map((b) => b['model'])).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5-5']);
    type Msg = { role: string; content: unknown };
    const normalise = (body: Body) =>
      (body['messages'] as Msg[]).map((m) => ({
        ...m,
        // cache_control breakpoints move with the tail by design; they are not part of the cached prefix's content.
        content: (typeof m.content === 'string'
          ? [{ type: 'text', text: m.content }]
          : (m.content as Array<Record<string, unknown>>)
        ).map(({ cache_control: _cacheControl, ...block }) => block),
      }));
    const first = normalise(bodies[0] as Body);
    const second = normalise(bodies[1] as Body);
    // The effort system message is replayed where pi-ai sent it. Dropping it (the loop used to rebuild the reply
    // without providerThinkingLevel) shortens the prefix, so the API drops the signed thinking block and misses cache.
    expect(second.slice(0, first.length)).toEqual(first);
    expect(second.length).toBeGreaterThan(first.length);
    // The signed thinking block itself was replayed, not stripped.
    expect(JSON.stringify(second)).toContain('sig-1');
  });
});
