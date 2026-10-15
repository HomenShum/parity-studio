// @vitest-environment node
/**
 * assertCompleted is the one place that decides a reply is safe to parse. Persona: a designer runs parity_decompose
 * or parity_pipeline; the decompose reply (cap 24,000 tokens) is cut off mid tokens.css, or Claude 5.5 ends it with
 * stop_reason 'refusal' (pi-ai: stopReason 'error'). Parsing either gave a "successful" kit with warnings [], or in
 * the iterate loop replaced the complete stored kit with the partial one. The error carries the billed cost so the
 * pipeline can still record it.
 */
import { describe, expect, it } from 'vitest';
import { type CallResult, IncompleteCompletionError, assertCompleted } from './llmClient';

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
