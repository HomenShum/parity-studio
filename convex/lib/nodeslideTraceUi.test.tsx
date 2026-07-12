import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentTrace, ValidationResult } from '../../shared/nodeslide';
import { TraceInspector } from '../../src/domains/nodeslide/inspector/TraceInspector';
import { NODESLIDE_EDIT_MODEL, NODESLIDE_EDIT_PROVIDER } from './nodeslideProvider';

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
    expect(markup).toContain('Run');
  });

  it('labels proposal elapsed time as a human review cycle', () => {
    const current = validation('validation-v2', 2, 2_000);
    const trace: AgentTrace = {
      id: 'trace-edit',
      deckId: 'deck-a',
      patchId: 'patch-a',
      status: 'completed',
      summary: 'replace text Body copy',
      plan: ['Propose a scoped edit'],
      context: [],
      toolCalls: ['Validated patch'],
      guardrails: ['Explicit scope'],
      provider: NODESLIDE_EDIT_PROVIDER,
      model: NODESLIDE_EDIT_MODEL,
      costMicroUsd: 1_250,
      inputTokens: 120,
      outputTokens: 30,
      validation: current,
      createdAt: 1_000,
      completedAt: 42_000,
    };

    const markup = renderToStaticMarkup(
      <TraceInspector traces={[trace]} validations={[current]} />,
    );

    expect(markup).toContain('Review cycle');
    expect(markup).toContain('41s');
    expect(markup).toContain(NODESLIDE_EDIT_MODEL);
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
