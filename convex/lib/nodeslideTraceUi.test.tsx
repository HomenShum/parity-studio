import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentTrace, ValidationResult } from '../../shared/nodeslide';
import { CustodyRail, TraceInspector } from '../../src/domains/nodeslide/inspector/TraceInspector';
import { NODESLIDE_EDIT_MODEL, NODESLIDE_EDIT_PROVIDER } from './nodeslideProvider';

describe('NodeSlide trace validation receipts', () => {
  it('uses the compact agent-activity hierarchy instead of the legacy trace framing', () => {
    const current = validation('validation-v2', 2, 2_000);
    const trace: AgentTrace = {
      id: 'trace-modern-ui',
      deckId: 'deck-a',
      status: 'awaiting_review',
      summary: 'Proposed a scoped headline edit',
      plan: ['Read context', 'Draft bounded operation', 'Validate candidate'],
      context: ['Read context: 1 slide'],
      toolCalls: ['Validated candidate'],
      guardrails: ['Human approval required'],
      provider: 'nebius',
      model: 'zai-org/GLM-5.2',
      reasoningEffort: 'high',
      inputTokens: 120,
      outputTokens: 30,
      costMicroUsd: 1_250,
      validation: current,
      createdAt: 1_000,
    };

    const markup = renderToStaticMarkup(
      <TraceInspector traces={[trace]} validations={[current]} />,
    );

    expect(markup).toContain('Agent activity');
    expect(markup).toContain('Run details');
    expect(markup).toContain('Execution');
    expect(markup).toContain('6 auditable records');
    expect(markup).toContain('nebius · zai-org/GLM-5.2 · High effort');
    expect(markup).not.toContain('What happened');
    expect(markup).not.toContain('Chain of custody');
  });

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

  it('shows authoritative uploaded-source identity and digest without raw file contents', () => {
    const current = validation('validation-v3', 3, 3_000);
    const trace: AgentTrace = {
      id: 'trace-uploaded-data',
      deckId: 'deck-a',
      patchId: 'patch-uploaded-data',
      status: 'awaiting_review',
      summary: 'Updated the metric from uploaded data.',
      plan: ['Read scoped deck context'],
      context: [
        'Read context: 1 slide, 8 elements, 1 source, 0 comments',
        'Source: world-cup.csv [source_123] · spreadsheet · sha256:0123456789abcdef',
      ],
      toolCalls: ['Validated patch'],
      guardrails: ['Explicit scope'],
      validation: current,
      createdAt: 2_500,
    };

    const markup = renderToStaticMarkup(
      <CustodyRail
        trace={trace}
        patch={undefined}
        validation={current}
        density="human"
        openNode="read"
        onToggle={() => {}}
      />,
    );

    expect(markup).toContain('world-cup.csv');
    expect(markup).toContain('source_123');
    expect(markup).toContain('sha256:0123456789abcdef');
    expect(markup).not.toContain('total_goals,172');
  });

  it('renders the durable run journal and persisted web tool evidence', () => {
    const markup = renderToStaticMarkup(
      <TraceInspector
        traces={[]}
        validations={[]}
        agentRuns={[
          {
            id: 'run-web',
            deckId: 'deck-a',
            idempotencyKey: 'request-1',
            instruction: 'Research current World Cup data and update this chart.',
            status: 'researching',
            provider: 'openrouter',
            model: 'z-ai/glm-5.2',
            webResearch: true,
            attempt: 1,
            createdAt: 1_000,
            updatedAt: 2_000,
          },
        ]}
        agentMessages={[
          {
            id: 'message-tool',
            deckId: 'deck-a',
            runId: 'run-web',
            role: 'tool',
            toolName: 'web_search',
            content: 'Retained 4 web sources from brave and tavily.',
            sourceIds: ['source-1', 'source-2', 'source-3', 'source-4'],
            createdAt: 1_500,
          },
        ]}
      />,
    );

    expect(markup).toContain('Run journal');
    expect(markup).toContain('server persisted');
    expect(markup).toContain('Web consented');
    expect(markup).toContain('web_search');
    expect(markup).toContain('z-ai/glm-5.2');
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
