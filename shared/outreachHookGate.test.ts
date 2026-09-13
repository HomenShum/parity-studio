import { describe, expect, it } from 'vitest';

import {
  OUTREACH_HOOK_MAX_AGE_DAYS,
  evaluateOutreachHookGate,
  type OutreachHook,
} from './outreachHookGate';

const NOW = Date.parse('2026-07-28T00:00:00.000Z');

const hook = (over: Partial<OutreachHook> = {}): OutreachHook => ({
  text: 'your Sauna Home demo — the ambient dashboard with the live PR ticker',
  source: 'https://x.com/bertie_ai/status/2073915273246372167',
  occurredAt: '2026-07-05T00:00:00.000Z',
  recordedAt: '2026-07-27T00:00:00.000Z',
  ...over,
});

const evaluate = (h: OutreachHook | string | undefined) =>
  evaluateOutreachHookGate({ contactId: 'lead.chandler', hook: h, evaluatedAt: NOW });

describe('evaluateOutreachHookGate', () => {
  it('allows a specific, sourced, recent hook', () => {
    const decision = evaluate(hook());
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe('allowed');
    expect(decision.explanation).toContain('x.com/bertie_ai');
  });

  it('denies when there is no hook at all', () => {
    const decision = evaluate(undefined);
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe('no_hook');
    // A denial must tell the caller what to do instead of "try again".
    expect(decision.remedy).toBeTruthy();
  });

  it('denies a legacy bare-string hook rather than trusting it', () => {
    // This is the shape that let a fabricated SEC filing date reach an outbound
    // draft: text with no source, indistinguishable from a researched finding.
    const decision = evaluate('VECTIS CAPITAL - second SEC-registered firm, reg 2026-06-08');
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe('legacy_unsourced_hook');
  });

  it('denies a hook whose source is not a resolvable URL', () => {
    expect(evaluate(hook({ source: 'a blog somewhere' })).reasonCode).toBe(
      'source_not_resolvable',
    );
    expect(evaluate(hook({ source: '' })).reasonCode).toBe('source_not_resolvable');
  });

  it('denies generic openers that name nothing checkable', () => {
    const generic = [
      'I saw your recent work',
      'saw your post',
      'your work in AI is impressive',
      'love what you are building',
      'impressive background',
    ];
    for (const text of generic) {
      const decision = evaluate(hook({ text }));
      expect(decision.allowed, `should deny: ${text}`).toBe(false);
      expect(decision.reasonCode).toBe('hook_not_specific');
    }
  });

  it('denies a hook that is too short to be specific', () => {
    expect(evaluate(hook({ text: 'the demo' })).reasonCode).toBe('hook_not_specific');
  });

  it('measures staleness from when the thing happened, not when it was recorded', () => {
    // Recording an old item today does not make it recent. The recipient knows
    // when they posted it.
    const stale = hook({
      occurredAt: '2025-01-01T00:00:00.000Z',
      recordedAt: '2026-07-27T00:00:00.000Z',
    });
    const decision = evaluate(stale);
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe('hook_stale');
    expect(decision.explanation).toContain(String(OUTREACH_HOOK_MAX_AGE_DAYS));
  });

  it('allows a hook with no occurredAt rather than inventing an age', () => {
    // Unknown is a value. It is not treated as stale, and it is not treated as
    // fresh — the gate simply does not claim to know.
    const decision = evaluate(hook({ occurredAt: undefined }));
    expect(decision.allowed).toBe(true);
  });

  it('rejects an unparsable occurredAt instead of silently ignoring it', () => {
    expect(evaluate(hook({ occurredAt: 'last tuesday' })).reasonCode).toBe('invalid_contract');
  });

  it('is pure — the same request yields the same decision', () => {
    const request = { contactId: 'lead.reiss', hook: hook(), evaluatedAt: NOW };
    expect(evaluateOutreachHookGate(request)).toEqual(evaluateOutreachHookGate(request));
  });

  it('requires a contactId and a finite clock', () => {
    expect(
      evaluateOutreachHookGate({ contactId: '', hook: hook(), evaluatedAt: NOW }).reasonCode,
    ).toBe('invalid_contract');
    expect(
      evaluateOutreachHookGate({
        contactId: 'x',
        hook: hook(),
        evaluatedAt: Number.NaN,
      }).reasonCode,
    ).toBe('invalid_contract');
  });

  it('every denial carries an explanation', () => {
    const denials = [
      evaluate(undefined),
      evaluate('legacy'),
      evaluate(hook({ source: 'nope' })),
      evaluate(hook({ text: 'saw your post' })),
      evaluate(hook({ occurredAt: '2024-01-01T00:00:00.000Z' })),
    ];
    for (const d of denials) {
      expect(d.allowed).toBe(false);
      expect(d.explanation.length).toBeGreaterThan(0);
    }
  });
});
