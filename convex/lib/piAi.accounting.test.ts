// @vitest-environment node
/**
 * Truthful receipt inputs from `call()` (model-defaults SPEC A.0.3), against a fake transport (stubbed fetch,
 * no network, no key, no spend):
 *  - `costMicroUsd` and `completionAttempts` cover every OpenRouter soft retry, not just the attempt whose text is
 *    returned (the live harness budgets its spend from them). `completionAttempts` is NOT a request count: pi-ai's own
 *    HTTP retries happen inside one completion, so the live harness counts requests at the transport instead;
 *  - `echoedModel` is the provider-returned model, which pi-ai reports as `responseModel` only when it DIFFERS from
 *    the requested id, so a matching echo must still come back non-empty.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, maxAttempts } from './piAi';

const sse = (events: Array<[string, unknown]>): Response =>
  new Response(
    events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(''),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  );

const openAiSse = (chunks: unknown[]): Response =>
  new Response(`${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

/** A Claude message stream whose provider-returned model is `returned`. */
const anthropicReply = (returned: string): Response =>
  sse([
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: returned,
          content: [],
          stop_reason: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      },
    ],
    [
      'content_block_start',
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ],
    [
      'content_block_delta',
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'message_delta',
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
    ],
    ['message_stop', { type: 'message_stop' }],
  ]);

/** One OpenRouter completion that bills 1000 in / 1000 out tokens and finishes with `finish`. */
const openRouterReply = (finish: string): Response =>
  openAiSse([
    {
      id: 'c1',
      model: 'moonshotai/kimi-k2.6',
      choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: finish }],
    },
    {
      id: 'c1',
      model: 'moonshotai/kimi-k2.6',
      choices: [],
      usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 },
    },
  ]);

let replies: Array<() => Response> = [];
let requests = 0;

beforeEach(() => {
  replies = [];
  requests = 0;
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key-not-real');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      requests += 1;
      const next = replies.shift();
      if (next === undefined) throw new Error('fake transport ran out of replies');
      return next();
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const kimi = { provider: 'openrouter', modelId: 'moonshotai/kimi-k2.6' } as const;
const base = { systemPrompt: 's', userText: 'u', maxTokens: 100 };

describe('call() accounts for every attempt (SPEC A.0.3)', () => {
  it('maxAttempts is 3 for OpenRouter and 1 for everything else', () => {
    expect(maxAttempts('openrouter')).toBe(3);
    for (const p of [
      'anthropic',
      'openai',
      'google',
      'groq',
      'cerebras',
      'xai',
      'mistral',
    ] as const) {
      expect(maxAttempts(p)).toBe(1);
    }
  });

  it('a single clean attempt is one request at the single-attempt cost', async () => {
    replies = [() => openRouterReply('stop')];
    const single = await call({ ...kimi, ...base });
    expect(single).toMatchObject({ completionAttempts: 1, stopReason: 'stop' });
    expect(single.costMicroUsd).toBeGreaterThan(0);
    expect(requests).toBe(1);
  });

  it('two usage-bearing upstream errors then success: 3 requests, cost summed across all three', async () => {
    replies = [() => openRouterReply('stop')];
    const unit = (await call({ ...kimi, ...base })).costMicroUsd;
    requests = 0;
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    replies = [
      () => openRouterReply('upstream_error'),
      () => openRouterReply('upstream_error'),
      () => openRouterReply('stop'),
    ];
    const pending = call({ ...kimi, ...base });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(requests).toBe(3);
    expect(result.completionAttempts).toBe(3);
    expect(result.stopReason).toBe('stop');
    // The returned cost is the sum of the three attempts, not the last attempt alone (+-1 micro-USD per floor).
    expect(Math.abs(result.costMicroUsd - 3 * unit)).toBeLessThanOrEqual(3);
  });

  it('a 429 that pi-ai retries inside one completion is 2 transport requests but 1 completionAttempt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    replies = [
      () => new Response('{"error":{"message":"rate limited"}}', { status: 429 }),
      () => openRouterReply('stop'),
    ];
    const pending = call({ ...kimi, ...base });
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pending;
    expect(result).toMatchObject({ completionAttempts: 1, stopReason: 'stop' });
    // Why the live receipt counts requests at the transport (budget.requests) and not from completionAttempts.
    expect(requests).toBe(2);
  });

  it('a non-retriable error is not retried', async () => {
    replies = [() => openRouterReply('content_filter')];
    const result = await call({ ...kimi, ...base });
    expect(result).toMatchObject({ completionAttempts: 1, stopReason: 'error' });
    expect(requests).toBe(1);
  });
});

describe('call() echoedModel (SPEC A.0.3)', () => {
  it('a matching provider echo (pi-ai leaves responseModel unset) is the requested id, not empty', async () => {
    replies = [() => anthropicReply('claude-haiku-5-5')];
    const result = await call({
      provider: 'anthropic',
      modelId: 'claude-haiku-5-5',
      ...base,
    });
    expect(result.stopReason).toBe('stop');
    expect(result.echoedModel).toBe('claude-haiku-5-5');
  });

  it('a different provider echo is reported as returned', async () => {
    replies = [() => anthropicReply('claude-haiku-5-5-substitute')];
    const result = await call({
      provider: 'anthropic',
      modelId: 'claude-haiku-5-5',
      ...base,
    });
    expect(result.echoedModel).toBe('claude-haiku-5-5-substitute');
  });
});
