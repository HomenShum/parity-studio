import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  NodeSlideAgentRun,
  NodeSlideAgentSpan,
  NodeSlideAgentTelemetryPage,
  SourceRecord,
} from '../../../../shared/nodeslide';
import { TraceWaterfall, buildWaterfallRows } from './TraceWaterfall';

const startedAt = 1_720_000_000_000;

const run: NodeSlideAgentRun = {
  id: 'run_many',
  deckId: 'deck_many',
  idempotencyKey: 'request_many',
  instruction: 'Build a source-grounded World Cup deck',
  status: 'awaiting_review',
  provider: 'openrouter',
  model: 'z-ai/glm-5.2',
  webResearch: true,
  attempt: 1,
  createdAt: startedAt,
  updatedAt: startedAt + 30_000,
};

function span(index: number): NodeSlideAgentSpan {
  const root = index === 0;
  return {
    id: `span_${index}`,
    deckId: run.deckId,
    runId: run.id,
    traceId: '0123456789abcdef0123456789abcdef',
    spanId: index.toString(16).padStart(16, '0'),
    ...(root ? {} : { parentSpanId: '0000000000000000' }),
    name: root ? 'World Cup research run' : `Tool call ${index}`,
    operationName: root ? 'invoke_agent' : index % 5 === 0 ? 'chat' : 'execute_tool',
    kind: index % 5 === 0 ? 'client' : 'internal',
    status: index === 88 ? 'error' : 'ok',
    startTime: startedAt + index * 80,
    endTime: startedAt + index * 80 + 45,
    durationMs: 45,
    ...(root ? { sourceIds: ['source_fifa'] } : {}),
    attributes: [],
    sequence: index + 1,
    createdAt: startedAt + index * 80 + 45,
    updatedAt: startedAt + index * 80 + 45,
  };
}

const spans = Array.from({ length: 260 }, (_, index) => span(index));
const telemetry: NodeSlideAgentTelemetryPage = {
  spans,
  events: [],
  hasMore: true,
  nextBeforeSequence: 1,
  totalRecorded: 520,
};
const source: SourceRecord = {
  id: 'source_fifa',
  deckId: run.deckId,
  title: 'FIFA World Cup data',
  url: 'https://www.fifa.com/tournaments/mens/worldcup',
  sourceType: 'url',
  retrievedAt: startedAt,
  citation: 'Official tournament source snapshot used by this run.',
  contentDigest: 'sha256:1234567890abcdef',
};

function telemetryFor(count: number): NodeSlideAgentTelemetryPage {
  return {
    spans: Array.from({ length: count }, (_, index) => span(index)),
    events: [],
    hasMore: false,
    totalRecorded: count,
  };
}

describe('TraceWaterfall', () => {
  it.each([4, 10, 100])(
    'adapts compact and expanded activity safely for a %i-span run',
    (count) => {
      const fixture = telemetryFor(count);
      expect(buildWaterfallRows(fixture.spans)).toHaveLength(count);

      const compactHtml = renderToStaticMarkup(
        <TraceWaterfall
          compact
          run={run}
          telemetry={fixture}
          messages={[]}
          sources={[source]}
          onExpand={() => {}}
        />,
      );
      const compactRows = compactHtml.match(/data-testid="trace-activity-row"/g)?.length ?? 0;
      expect(compactRows).toBe(count <= 6 ? count : 6);
      expect(compactHtml).toContain('Full timeline');
      if (count > 6) expect(compactHtml).toContain(`${count - 6} earlier step`);

      const expandedHtml = renderToStaticMarkup(
        <TraceWaterfall run={run} telemetry={fixture} messages={[]} sources={[source]} />,
      );
      const expandedRows = expandedHtml.match(/data-testid="trace-waterfall-row"/g)?.length ?? 0;
      expect(expandedRows).toBeGreaterThan(0);
      expect(expandedRows).toBeLessThanOrEqual(count);
      if (count === 100) expect(expandedRows).toBeLessThan(40);
    },
  );

  it('retains hierarchy and ancestors when filtering a large run', () => {
    expect(buildWaterfallRows(spans)).toHaveLength(260);
    const errors = buildWaterfallRows(spans, new Set(), 'errors');
    expect(errors.map((row) => row.span.name)).toEqual(['World Cup research run', 'Tool call 88']);
    expect(errors[1]?.depth).toBe(1);
  });

  it('virtualizes hundreds of rows and renders span-bound source evidence honestly', () => {
    const html = renderToStaticMarkup(
      <TraceWaterfall
        run={run}
        telemetry={telemetry}
        messages={[]}
        sources={[source]}
        onLoadMore={() => {}}
      />,
    );
    const renderedRows = html.match(/data-testid="trace-waterfall-row"/g)?.length ?? 0;
    expect(renderedRows).toBeGreaterThan(0);
    expect(renderedRows).toBeLessThan(40);
    expect(html).toContain('520');
    expect(html).toContain('Span evidence');
    expect(html).toContain('FIFA World Cup data');
    expect(html).toContain('Official tournament source snapshot');
    expect(html).not.toContain('Legacy run-level sources');
  });
});
