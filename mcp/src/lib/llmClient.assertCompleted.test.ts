// @vitest-environment node
/**
 * assertCompleted is the one place that decides a reply is safe to parse. Persona: a designer runs parity_decompose
 * or parity_pipeline; the decompose reply (cap 24,000 tokens) is cut off mid tokens.css, or Claude 5.5 ends it with
 * stop_reason 'refusal' (pi-ai: stopReason 'error'). Parsing either gave a "successful" kit with warnings [], or in
 * the iterate loop replaced the complete stored kit with the partial one. The error carries the billed cost so the
 * pipeline can still record it.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CallResult, IncompleteCompletionError, assertCompleted, call } from './llmClient';

vi.setConfig({ testTimeout: 30_000 });

const reply = (over: Partial<CallResult>): CallResult => ({
  text: '```html\n<html>',
  costUsd: 0.0123,
  inputTokens: 100,
  outputTokens: 24_000,
  modelUsed: 'claude-opus-5-5',
  provider: 'anthropic',
  stopReason: 'stop',
  ...over,
});

describe('assertCompleted', () => {
  it('a finished reply passes (control)', () => {
    expect(() =>
      assertCompleted(reply({}), 'decompose stage', 'no kit was returned'),
    ).not.toThrow();
  });

  it('a reply cut off at the output cap is rejected and says what happened to the output', () => {
    expect(() =>
      assertCompleted(reply({ stopReason: 'length' }), 'decompose stage', 'no kit was returned'),
    ).toThrow(
      /decompose stage truncated at its output cap from model claude-opus-5-5; no kit was returned \(billed \$0\.0123\)/,
    );
  });

  it('a refusal or provider failure (stopReason error) is rejected with the provider message', () => {
    expect(() =>
      assertCompleted(
        reply({ stopReason: 'error', errorMessage: 'The model refused to complete the request' }),
        'iterate stage',
        'the previous kit was kept',
      ),
    ).toThrow(
      /iterate stage error from model claude-opus-5-5: The model refused.*previous kit was kept/,
    );
  });

  it('an aborted reply is rejected', () => {
    expect(() => assertCompleted(reply({ stopReason: 'aborted' }), 'generate stage', 'x')).toThrow(
      /ended with stopReason aborted/,
    );
  });

  it('the error carries the billed cost of the unfinished reply', () => {
    try {
      assertCompleted(reply({ stopReason: 'length', costUsd: 0.5 }), 's', 'c');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IncompleteCompletionError);
      expect((err as IncompleteCompletionError).costUsd).toBe(0.5);
    }
  });
});

// SPEC A.2.7: the vendored NodeSlide planner (frozen, not edited) calls callByModel without `requireComplete` and
// parses whatever text comes back, rejecting only stopReason 'error'. The completion guard is therefore opt-in per
// call, so that planner behaves exactly as on main, while every Parity caller opts in.
describe('call() completion guard is opt-in (frozen NodeSlide planner path unchanged)', () => {
  const proposal = JSON.stringify({
    summary: 'Replace headline',
    operations: [{ op: 'replace_text' }],
  });
  const transport = (finishReason: string) =>
    vi.fn(
      async () =>
        new Response(
          `data: ${JSON.stringify({
            candidates: [{ content: { role: 'model', parts: [{ text: proposal }] }, finishReason }],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 3000,
              totalTokenCount: 3010,
            },
          })}

`,
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    );
  const base = {
    provider: 'google',
    modelId: 'gemini-3.1-pro-preview',
    systemPrompt: 's',
    userText: 'u',
    maxTokens: 3000,
  } as const;

  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key-not-real');
    vi.stubEnv('GOOGLE_API_KEY', 'test-key-not-real');
    vi.stubGlobal('fetch', transport('MAX_TOKENS'));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('without requireComplete a reply cut off at the cap is returned with its stopReason, as before', async () => {
    const result = await call({ ...base });
    expect(result.stopReason).toBe('length');
    expect(result.text).toBe(proposal);
  });

  it('with requireComplete the same reply throws, carrying the billed cost', async () => {
    const err = await call({
      ...base,
      requireComplete: { stage: 'iterate stage', consequence: 'x' },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IncompleteCompletionError);
    expect((err as Error).message).toMatch(/iterate stage truncated at its output cap/);
    expect((err as IncompleteCompletionError).costUsd).toBeGreaterThan(0);
  });

  it('a finished reply passes with requireComplete (control)', async () => {
    vi.stubGlobal('fetch', transport('STOP'));
    const result = await call({
      ...base,
      requireComplete: { stage: 'iterate stage', consequence: 'x' },
    });
    expect(result.stopReason).toBe('stop');
  });

  // Wired, not just available: every Parity call site opts in; the frozen NodeSlide planner is not edited.
  it('every callByModel site in index.ts and visualJudge.ts sets requireComplete; nodeslideTools.ts does not', () => {
    const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
    for (const file of ['../index.ts', './visualJudge.ts']) {
      const text = read(file);
      const sites = [...text.matchAll(/callByModel\(\{/g)];
      expect(sites.length, file).toBeGreaterThan(0);
      for (const site of sites) {
        const block = text.slice(site.index, text.indexOf('});', site.index));
        expect(block, `${file} @${site.index}`).toContain('requireComplete:');
      }
    }
    expect(read('./nodeslideTools.ts')).not.toContain('requireComplete');
  });
});
