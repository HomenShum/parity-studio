// @vitest-environment node
/**
 * runVisualJudge must not turn a reply that never finished into a verdict. Persona: a designer runs parity_verify
 * with a source mockup; the judge model (default google/gemini-3.1-pro-preview, cap 4,000 tokens) runs out of
 * tokens halfway through its JSON rubric. Parsing the half-reply gives no checks, which used to score 0/12 'fail'
 * and read as "the candidate does not match the mockup". The truth is "the judge did not finish", so the call
 * reports a judge failure and no score. Real call() through a fake Google transport (no spend).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./render.js', () => ({
  renderHtmlToPng: async () => ({ base64: 'cG5n', latencyMs: 1 }),
  shutdownRenderer: async () => undefined,
}));

import { IncompleteCompletionError } from './llmClient';
import { runVisualJudge } from './visualJudge';

vi.setConfig({ testTimeout: 30_000 });

function sse(chunk: unknown): Response {
  return new Response(`data: ${JSON.stringify(chunk)}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const ARGS = {
  sourceImageBase64: 'cG5n',
  sourceImageMimeType: 'image/png' as const,
  indexHtml: '<html></html>',
  judgeModel: 'google/gemini-3.1-pro-preview',
};

const usage = { promptTokenCount: 10, candidatesTokenCount: 4000, totalTokenCount: 4010 };
const reply = (text: string, finishReason: string) => ({
  candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }],
  usageMetadata: usage,
});

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'test-key-not-real');
  vi.stubEnv('GOOGLE_API_KEY', 'test-key-not-real');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('runVisualJudge honest status', () => {
  it('a complete rubric is scored (control)', async () => {
    const rubric = JSON.stringify({
      summary: 'close',
      checks: [
        { dimension: 'layout', id: 'a', passed: true, note: '' },
        { dimension: 'color', id: 'b', passed: false, note: 'off' },
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse(reply(rubric, 'STOP'))),
    );
    const out = await runVisualJudge(ARGS);
    expect(out.passCount).toBe(1);
    expect(out.totalChecks).toBe(2);
  });

  it('a reply cut off at the cap (MAX_TOKENS) is a judge failure, not a 0/12 fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse(reply('{"summary":"close","checks":[{"dimension":"layout"', 'MAX_TOKENS')),
      ),
    );
    await expect(runVisualJudge(ARGS)).rejects.toThrow(
      /truncated at its output cap.*no score reported/,
    );
  });

  it('the unfinished reply was billed, and the failure carries that cost for the pipeline to record', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse(reply('{"summary":"close","checks":[{"dimension":"layout"', 'MAX_TOKENS')),
      ),
    );
    const err = await runVisualJudge(ARGS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IncompleteCompletionError);
    expect((err as IncompleteCompletionError).costUsd).toBeGreaterThan(0);
  });

  it('a failed judge request is a judge failure, not a 0/12 fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 400, message: 'fake transport' } }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    await expect(runVisualJudge(ARGS)).rejects.toThrow(/visual judge error.*no score reported/);
  });
});
