import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  AgentTrace,
  NodeSlideAgentEvent,
  NodeSlideAgentMessage,
  NodeSlideAgentRun,
  NodeSlideAgentSpan,
  NodeSlideAgentTelemetryPage,
  SourceRecord,
} from '../../../../shared/nodeslide';
import {
  TraceWaterfall,
  buildMiniMapBuckets,
  buildWaterfallRows,
  collapsibleSpanIds,
  defaultCollapsedSpanIds,
  traceTreeKeyboardAction,
} from './TraceWaterfall';
import { spanTimingState, toO11ySpans, traceWindowMetrics } from './traceTelemetry';

const startedAt = 1_720_000_000_000;
const traceId = '0123456789abcdef0123456789abcdef';
const rootSpanId = '0000000000000000';

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
  otelTraceId: traceId,
  rootSpanId,
  telemetryVersion: 'nodeslide.otel.v1',
  createdAt: startedAt,
  updatedAt: startedAt + 30_000,
};

const trace: AgentTrace = {
  id: 'trace_many',
  deckId: run.deckId,
  status: 'awaiting_review',
  summary: 'Prepared a source-grounded World Cup proposal',
  plan: ['Read evidence', 'Draft', 'Validate'],
  context: ['FIFA source'],
  toolCalls: ['web_search', 'validate_candidate'],
  guardrails: ['Human review required'],
  provider: run.provider,
  model: run.model,
  reasoningEffort: 'high',
  inputTokens: 2_400,
  outputTokens: 600,
  costMicroUsd: 4_200,
  candidateDigest: 'candidate_validation_0123456789abcdef0123456789abcdef',
  createdAt: startedAt,
};

function span(index: number): NodeSlideAgentSpan {
  const root = index === 0;
  const modelSpan = !root && index % 5 === 0;
  return {
    id: `span_${index}`,
    deckId: run.deckId,
    runId: run.id,
    traceId,
    spanId: index.toString(16).padStart(16, '0'),
    ...(root ? {} : { parentSpanId: rootSpanId }),
    name: root ? 'World Cup research run' : `Tool call ${index}`,
    operationName: root ? 'invoke_agent' : modelSpan ? 'chat' : 'execute_tool',
    kind: modelSpan ? 'client' : 'internal',
    status: index === 88 ? 'error' : 'ok',
    startTime: startedAt + index * 80,
    endTime: startedAt + index * 80 + 45,
    durationMs: 45,
    ...(root ? { sourceIds: ['source_fifa'] } : {}),
    ...(modelSpan
      ? {
          provider: run.provider,
          model: run.model,
          inputTokens: 24,
          outputTokens: 6,
          costMicroUsd: 42,
        }
      : {}),
    attributes: root
      ? [
          { key: 'gen_ai.request.reasoning_effort', value: 'high' },
          { key: 'nodeslide.candidate.digest', value: trace.candidateDigest as string },
        ]
      : [],
    sequence: index + 1,
    createdAt: startedAt + index * 80 + 45,
    updatedAt: startedAt + index * 80 + 45,
  };
}

function telemetryFor(count: number): NodeSlideAgentTelemetryPage {
  return {
    spans: Array.from({ length: count }, (_, index) => span(index)),
    events: [],
    hasMore: false,
    totalRecorded: count,
  };
}

const source: SourceRecord = {
  id: 'source_fifa',
  deckId: run.deckId,
  title: 'FIFA World Cup data',
  url: 'https://www.fifa.com/tournaments/mens/worldcup',
  sourceType: 'url',
  format: 'web',
  retrievedAt: startedAt,
  citation: `Official tournament source snapshot used by this run. ${'Evidence '.repeat(55)}`,
  contentDigest: 'sha256:1234567890abcdef1234567890abcdef',
};

describe('TraceWaterfall deterministic fixture matrix', () => {
  it.each([4, 10, 100])(
    'keeps compact and expanded %i-span layouts bounded and OTel-readable',
    (count) => {
      const fixture = telemetryFor(count);
      expect(buildWaterfallRows(fixture.spans)).toHaveLength(count);

      const compactHtml = renderToStaticMarkup(
        <TraceWaterfall
          compact
          run={run}
          trace={trace}
          telemetry={fixture}
          messages={[]}
          sources={[source]}
          onExpand={() => {}}
        />,
      );
      const compactRows = compactHtml.match(/data-testid="trace-activity-row"/g)?.length ?? 0;
      expect(compactRows).toBe(count <= 6 ? count : 6);
      expect(compactHtml).toContain('Full timeline');
      expect(compactHtml).toContain('data-observability-primitives="assistant-ui-react-o11y"');
      expect(compactHtml).toContain('openrouter · z-ai/glm-5.2');
      expect(compactHtml).toContain('2,400 in · 600 out');
      expect(compactHtml).toContain('$0.0042');
      expect(compactHtml).toContain(trace.candidateDigest as string);
      if (count > 6) expect(compactHtml).toContain(`${count - 6} earlier loaded step`);

      const expandedHtml = renderToStaticMarkup(
        <TraceWaterfall
          run={run}
          trace={trace}
          telemetry={fixture}
          messages={[]}
          sources={[source]}
        />,
      );
      const expandedRows = expandedHtml.match(/data-testid="trace-waterfall-row"/g)?.length ?? 0;
      const miniBuckets = expandedHtml.match(/data-testid="trace-minimap-bucket"/g)?.length ?? 0;
      expect(expandedRows).toBeGreaterThan(0);
      expect(expandedRows).toBeLessThanOrEqual(Math.min(count, 32));
      expect(miniBuckets).toBe(48);
      expect(expandedHtml).toContain('role="tree"');
      expect(expandedHtml).toContain('aria-activedescendant');
      expect(expandedHtml).toContain('Collapse all');
      expect(expandedHtml).toContain('Expand loaded');
      expect(expandedHtml).toContain('Search trace spans');
      expect(expandedHtml).toContain(`Complete loaded trace · ${count} records`);
      expect(expandedHtml).toContain(`dateTime="${new Date(startedAt).toISOString()}"`);
      expect(expandedHtml).toContain(`dateTime="${new Date(startedAt + 45).toISOString()}"`);
      expect(expandedHtml).toContain('data-edge="end"');
      expect(expandedHtml.length).toBeLessThan(200_000);
      if (count === 100) expect(expandedRows).toBeLessThan(40);
    },
  );

  it('keeps the minimap faithful to all loaded spans while tree subtrees collapse', () => {
    const fixture = telemetryFor(100);
    const buckets = buildMiniMapBuckets(
      fixture.spans,
      startedAt,
      startedAt + fixture.spans.length * 80,
    );
    const collapsed = buildWaterfallRows(fixture.spans, new Set([rootSpanId]));

    expect(buckets).toHaveLength(48);
    expect(buckets.reduce((total, bucket) => total + bucket.count, 0)).toBeGreaterThanOrEqual(100);
    expect(buckets.some((bucket) => bucket.error)).toBe(true);
    expect(collapsed.map((row) => row.span.spanId)).toEqual([rootSpanId]);
    expect(collapsibleSpanIds(fixture.spans)).toEqual(new Set([rootSpanId]));
    expect(defaultCollapsedSpanIds(fixture.spans)).toEqual(new Set());
    expect(defaultCollapsedSpanIds(telemetryFor(101).spans)).toEqual(new Set([rootSpanId]));

    const filtered = buildWaterfallRows(fixture.spans, new Set([rootSpanId]), 'errors');
    expect(filtered.map((row) => row.span.name)).toEqual([
      'World Cup research run',
      'Tool call 88',
    ]);
  });

  it('maps keyboard tree navigation to selection and collapse actions', () => {
    const rows = buildWaterfallRows(telemetryFor(10).spans);
    expect(traceTreeKeyboardAction(rows, rootSpanId, 'ArrowRight', new Set([rootSpanId]))).toEqual({
      type: 'toggle',
      spanId: rootSpanId,
    });
    expect(traceTreeKeyboardAction(rows, rootSpanId, 'ArrowRight', new Set())).toEqual({
      type: 'select',
      spanId: '0000000000000001',
      index: 1,
    });
    expect(traceTreeKeyboardAction(rows, '0000000000000001', 'ArrowLeft', new Set())).toEqual({
      type: 'select',
      spanId: rootSpanId,
      index: 0,
    });
    expect(traceTreeKeyboardAction(rows, rootSpanId, 'End', new Set())).toEqual({
      type: 'select',
      spanId: '0000000000000009',
      index: 9,
    });
  });

  it('renders exact span-bound citations and labels legacy run evidence as not span-bound', () => {
    const boundHtml = renderToStaticMarkup(
      <TraceWaterfall
        run={run}
        trace={trace}
        telemetry={telemetryFor(4)}
        messages={[]}
        sources={[source]}
      />,
    );
    expect(boundHtml).toContain('data-testid="trace-span-evidence"');
    expect(boundHtml).toContain(`data-span-id="${rootSpanId}"`);
    expect(boundHtml).toContain('Bound directly to OTel span');
    expect(boundHtml).toContain('data-source-id="source_fifa"');
    expect(boundHtml).toContain(source.url as string);
    expect(boundHtml).toContain(source.contentDigest as string);
    expect(boundHtml).toContain('Show full citation');
    expect(boundHtml).not.toContain('Run-level evidence; not span-bound');

    const { sourceIds: _sourceIds, ...rootWithoutEvidence } = span(0);
    const message: NodeSlideAgentMessage = {
      id: 'message_legacy_source',
      deckId: run.deckId,
      runId: run.id,
      role: 'tool',
      content: 'Legacy source record',
      sourceIds: [source.id],
      createdAt: startedAt + 1,
    };
    const legacyHtml = renderToStaticMarkup(
      <TraceWaterfall
        run={run}
        telemetry={{
          spans: [rootWithoutEvidence],
          events: [],
          hasMore: false,
          totalRecorded: 1,
        }}
        messages={[message]}
        sources={[source]}
      />,
    );
    expect(legacyHtml).toContain('Run-level evidence; not span-bound');
    expect(legacyHtml).not.toContain('Bound directly to OTel span');
  });

  it('shows missing bound source records instead of silently dropping citations', () => {
    const missing = { ...span(0), sourceIds: ['source_missing'] };
    const html = renderToStaticMarkup(
      <TraceWaterfall
        run={run}
        telemetry={{ spans: [missing], events: [], hasMore: false, totalRecorded: 1 }}
        messages={[]}
        sources={[]}
      />,
    );
    expect(html).toContain('1 bound source record is unavailable');
    expect(html).toContain('source_missing');
  });

  it('distinguishes open spans from terminal spans with unknown duration', () => {
    const { endTime: _openEnd, durationMs: _openDuration, ...openBase } = span(1);
    const { endTime: _unknownEnd, durationMs: _unknownDuration, ...unknownBase } = span(2);
    const openSpan: NodeSlideAgentSpan = { ...openBase, status: 'unset' };
    const unknownSpan: NodeSlideAgentSpan = { ...unknownBase, status: 'ok' };
    const fixture = {
      spans: [span(0), openSpan, unknownSpan],
      events: [],
      hasMore: false,
      totalRecorded: 3,
    } satisfies NodeSlideAgentTelemetryPage;

    expect(spanTimingState(openSpan)).toBe('open');
    expect(spanTimingState(unknownSpan)).toBe('unknown');
    const html = renderToStaticMarkup(
      <TraceWaterfall run={run} telemetry={fixture} messages={[]} sources={[source]} />,
    );
    expect(html).toContain('open at last checkpoint');
    expect(html).toContain('duration unknown');
    expect(html).toContain('data-span-running=""');
    expect(html).toContain('data-timing="unknown"');
  });

  it('sanitizes malformed OTel parents before handing spans to react-o11y', () => {
    const first = { ...span(1), spanId: 'span-a', parentSpanId: 'span-b' };
    const second = { ...span(2), spanId: 'span-b', parentSpanId: 'span-a' };
    const orphan = { ...span(3), spanId: 'span-c', parentSpanId: 'missing' };
    expect(toO11ySpans([first, second, orphan]).map((item) => item.parentSpanId)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('bounds loaded event and attribute detail with visible show-more affordances', () => {
    const fixture = telemetryFor(10);
    const events: NodeSlideAgentEvent[] = Array.from({ length: 50 }, (_, index) => ({
      id: `event_${index}`,
      deckId: run.deckId,
      runId: run.id,
      traceId,
      spanId: rootSpanId,
      name: `fixture.event.${index}`,
      severity: 'info',
      timestamp: startedAt + index,
      body: `bounded-event-${index}`,
      attributes: [],
      sequence: fixture.spans.length + index + 1,
    }));
    const root = fixture.spans[0];
    if (!root) throw new Error('root span fixture missing');
    const telemetry: NodeSlideAgentTelemetryPage = {
      ...fixture,
      spans: [
        {
          ...root,
          attributes: Array.from({ length: 30 }, (_, index) => ({
            key: `fixture.attribute.${index}`,
            value: `bounded-attribute-${index}`,
          })),
        },
        ...fixture.spans.slice(1),
      ],
      events,
      totalRecorded: fixture.spans.length + events.length,
    };

    const html = renderToStaticMarkup(
      <TraceWaterfall run={run} telemetry={telemetry} messages={[]} sources={[source]} />,
    );
    expect(html.match(/class="ns-waterfall-event is-info"/g)).toHaveLength(8);
    expect(html).toContain('class="ns-waterfall-event is-overflow"');
    expect(html).toContain('<span>bounded-event-39</span>');
    expect(html).not.toContain('<span>bounded-event-40</span>');
    expect(html).toContain('Show 10 more loaded events');
    expect(html).toContain('<dt>fixture.attribute.23</dt>');
    expect(html).not.toContain('<dt>fixture.attribute.24</dt>');
    expect(html).toContain('Show 6 more loaded attributes');
  });
});

describe('TraceWaterfall pagination and long-run bounds', () => {
  const spans = Array.from({ length: 260 }, (_, index) => span(index));
  const telemetry: NodeSlideAgentTelemetryPage = {
    spans,
    events: [],
    hasMore: true,
    nextBeforeSequence: 1,
    totalRecorded: 520,
  };

  it('virtualizes hundreds of rows and exposes the cursor cap visibly', () => {
    const html = renderToStaticMarkup(
      <TraceWaterfall
        run={run}
        trace={trace}
        telemetry={telemetry}
        messages={[]}
        sources={[source]}
        onLoadMore={() => {}}
      />,
    );
    const renderedRows = html.match(/data-testid="trace-waterfall-row"/g)?.length ?? 0;
    const miniBuckets = html.match(/data-testid="trace-minimap-bucket"/g)?.length ?? 0;
    expect(renderedRows).toBeGreaterThan(0);
    expect(renderedRows).toBeLessThan(40);
    expect(miniBuckets).toBe(48);
    expect(html).toContain('Partial loaded window: 260 of 520 records');
    expect(html).toContain('Search, filters, metrics, and the minimap cover loaded records only');
    expect(html).toContain('data-testid="trace-load-more"');
    expect(html).toContain('Load older records · 260 of 520');
    expect(html.length).toBeLessThan(200_000);
  });

  it('keeps the visible cap honest when a load callback is unavailable', () => {
    const html = renderToStaticMarkup(
      <TraceWaterfall run={run} telemetry={telemetry} messages={[]} sources={[source]} />,
    );
    expect(html).toContain('Older records exist, but loading is unavailable');
    expect(html).toContain('data-testid="trace-load-more" disabled=""');
  });

  it('computes loaded-window timing and accounting without calling the subset complete', () => {
    const metrics = traceWindowMetrics(run, telemetry.spans, telemetry.events, 520, true);
    expect(metrics.loadedRecordCount).toBe(260);
    expect(metrics.omittedRecordCount).toBe(260);
    expect(metrics.isComplete).toBe(false);
    expect(metrics.rangeStart).toBe(startedAt);
    expect(metrics.rangeEnd).toBe(startedAt + 30_000);
    expect(metrics.activeDurationMs).toBeGreaterThan(0);
  });
});
