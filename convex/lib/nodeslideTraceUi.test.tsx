import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentTrace, ValidationResult } from '../../shared/nodeslide';
import { TraceInspector } from '../../src/domains/nodeslide/inspector/TraceInspector';

describe('NodeSlide trace validation receipts', () => {
  it('separates the current deck receipt from an older selected trace receipt', () => {
    const initial = validation('validation-v1', 1, 1_000);
    const current = validation('validation-v7', 7, 7_000);
    const trace: AgentTrace = {
      id: 'trace-creation',
      deckId: 'deck-a',
      status: 'completed',
      summary: 'Created initial deck',
      plan: ['Create the first draft'],
      context: [],
      toolCalls: ['Validated snapshot'],
      guardrails: ['Deterministic validation'],
      validation: initial,
      createdAt: 1_000,
      completedAt: 1_100,
    };

    const markup = renderToStaticMarkup(
      <TraceInspector traces={[trace]} validations={[initial, current]} />,
    );

    expect(markup).toContain('Current deck validation: passed');
    expect(markup).toContain('Deck v7');
    expect(markup).toContain('Selected trace validation: passed');
    expect(markup).toContain('Deck v1');
  });
});

function validation(id: string, deckVersion: number, checkedAt: number): ValidationResult {
  return {
    id,
    deckId: 'deck-a',
    deckVersion,
    ok: true,
    publishOk: true,
    cleanOk: true,
    issues: [],
    checkedAt,
    toolchainVersion: 'nodeslide-test',
  };
}
