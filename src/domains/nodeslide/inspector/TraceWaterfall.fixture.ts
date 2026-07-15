import type {
  AgentTrace,
  NodeSlideAgentEvent,
  NodeSlideAgentMessage,
  NodeSlideAgentRun,
  NodeSlideAgentSpan,
  NodeSlideAgentTelemetryPage,
  SourceRecord,
  ValidationResult,
} from '../../../../shared/nodeslide';

export const TRACE_FIXTURE_STARTED_AT = Date.UTC(2026, 6, 14, 17, 0, 0);
export const TRACE_FIXTURE_TRACE_ID = '0123456789abcdef0123456789abcdef';
export const TRACE_FIXTURE_ROOT_SPAN_ID = '0000000000000001';
export const TRACE_SCALE_DOM_NODE_BUDGET = 900;
export const TRACE_SCALE_INTERACTION_BUDGET_MS = 750;

type FixtureSpanType = 'model' | 'tool' | 'retrieval' | 'validation' | 'human' | 'system';

const SPAN_TYPES: readonly FixtureSpanType[] = [
  'model',
  'tool',
  'retrieval',
  'validation',
  'human',
  'system',
];

const WEB_SOURCE_ID = 'source_fixture_web';
const DATA_SOURCE_ID = 'source_fixture_data';
const CANDIDATE_DIGEST = 'candidate_validation_0123456789abcdef0123456789abcdef';

export interface TraceWaterfallFixtureOptions {
  loadedSpanCount?: number;
}

export interface TraceWaterfallFixture {
  run: NodeSlideAgentRun;
  trace: AgentTrace;
  validation: ValidationResult;
  telemetry: NodeSlideAgentTelemetryPage;
  messages: NodeSlideAgentMessage[];
  sources: SourceRecord[];
  allSpans: NodeSlideAgentSpan[];
  allEvents: NodeSlideAgentEvent[];
}

function fixtureSpanId(index: number): string {
  return (index + 1).toString(16).padStart(16, '0');
}

function fixtureStageCount(spanCount: number): number {
  if (spanCount <= 1) return 0;
  if (spanCount <= 4) return 1;
  if (spanCount <= 10) return 2;
  return Math.min(8, Math.max(2, Math.floor((spanCount - 1) / 20)));
}

function fixtureService(type: FixtureSpanType): string {
  if (type === 'model') return 'openrouter';
  if (type === 'tool') return 'nodeslide.tools';
  if (type === 'retrieval') return 'nodeslide.retrieval';
  if (type === 'validation') return 'nodeslide.validator';
  if (type === 'human') return 'nodeslide.human';
  return 'nodeslide.agent';
}

function fixtureOperation(type: FixtureSpanType): string {
  if (type === 'model') return 'chat';
  if (type === 'tool') return 'execute_tool';
  if (type === 'retrieval') return 'retrieval.query';
  if (type === 'validation') return 'validate_candidate';
  if (type === 'human') return 'await_review';
  return 'checkpoint';
}

function fixtureDuration(type: FixtureSpanType, index: number): number {
  if (type === 'model') return 720 + (index % 5) * 90;
  if (type === 'human') return 2_400 + (index % 4) * 300;
  if (type === 'tool') return 180 + (index % 7) * 20;
  if (type === 'retrieval') return 110 + (index % 5) * 25;
  if (type === 'validation') return 85 + (index % 3) * 15;
  return 45 + (index % 4) * 10;
}

function createFixtureSources(): SourceRecord[] {
  return [
    {
      id: WEB_SOURCE_ID,
      deckId: 'deck_trace_scale_fixture',
      title: 'Official tournament research snapshot',
      url: 'https://example.test/tournament/research?fixture=trace-scale',
      sourceType: 'url',
      format: 'web',
      retrievedAt: TRACE_FIXTURE_STARTED_AT + 1_200,
      citation:
        'Canonical tournament research retrieved for the exact cited span. The fixture preserves the retrieval timestamp, stable source ID, canonical URL, excerpt boundary, and SHA-256 content digest. '.repeat(
          3,
        ),
      contentDigest: 'sha256:web0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      provider: 'fixture-retriever',
      retention: 'until_deleted',
      status: 'ready',
    },
    {
      id: DATA_SOURCE_ID,
      deckId: 'deck_trace_scale_fixture',
      title: 'Tournament metrics workbook · Metrics!A2:D14',
      sourceType: 'spreadsheet',
      format: 'csv',
      retrievedAt: TRACE_FIXTURE_STARTED_AT + 1_420,
      citation:
        'Workbook fixture.xlsx, sheet Metrics, exact range A2:D14, rows 2–14 and columns Team through WinRate. This range supports the selected chart claim and is bound to the retrieval span.',
      contentDigest: 'sha256:data0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      byteSize: 4_096,
      rowCount: 13,
      columns: ['Team', 'Matches', 'Wins', 'WinRate'],
      provider: 'fixture-upload',
      retention: 'until_deleted',
      status: 'ready',
    },
  ];
}

function createFixtureSpans(spanCount: number): NodeSlideAgentSpan[] {
  if (spanCount === 0) return [];
  const stageCount = fixtureStageCount(spanCount);
  const leafCount = Math.max(0, spanCount - stageCount - 1);
  const leafRounds = stageCount > 0 ? Math.ceil(leafCount / stageCount) : 0;
  const runDuration = Math.max(5_000, leafRounds * 140 + 4_000);
  const runEnd = TRACE_FIXTURE_STARTED_AT + runDuration;
  const spans: NodeSlideAgentSpan[] = [
    {
      id: 'fixture_span_0',
      deckId: 'deck_trace_scale_fixture',
      runId: 'run_trace_scale_fixture',
      traceId: TRACE_FIXTURE_TRACE_ID,
      spanId: TRACE_FIXTURE_ROOT_SPAN_ID,
      name: 'Source-grounded deck run',
      operationName: 'invoke_agent',
      kind: 'internal',
      status: 'ok',
      startTime: TRACE_FIXTURE_STARTED_AT,
      endTime: runEnd,
      durationMs: runDuration,
      provider: 'openrouter',
      model: 'z-ai/glm-5.2',
      sourceIds: [WEB_SOURCE_ID, DATA_SOURCE_ID],
      attributes: [
        { key: 'service.name', value: 'nodeslide.agent' },
        { key: 'otel.scope.name', value: 'nodeslide.agentic.fixture' },
        { key: 'otel.semconv.version', value: '1.37.0' },
        { key: 'gen_ai.request.reasoning_effort', value: 'high' },
        { key: 'nodeslide.candidate.digest', value: CANDIDATE_DIGEST },
      ],
      sequence: 1,
      createdAt: runEnd,
      updatedAt: runEnd,
    },
  ];

  for (let stageIndex = 0; stageIndex < stageCount; stageIndex += 1) {
    const index = stageIndex + 1;
    const startTime = TRACE_FIXTURE_STARTED_AT + 40 + stageIndex * 25;
    const endTime = runEnd - (stageCount - stageIndex) * 10;
    spans.push({
      id: `fixture_span_${index}`,
      deckId: 'deck_trace_scale_fixture',
      runId: 'run_trace_scale_fixture',
      traceId: TRACE_FIXTURE_TRACE_ID,
      spanId: fixtureSpanId(index),
      parentSpanId: TRACE_FIXTURE_ROOT_SPAN_ID,
      name: `Stage ${String(stageIndex + 1).padStart(2, '0')} · agent work group`,
      operationName: 'agent.stage',
      kind: 'internal',
      status: 'ok',
      startTime,
      endTime,
      durationMs: endTime - startTime,
      attributes: [
        { key: 'service.name', value: 'nodeslide.agent' },
        { key: 'nodeslide.stage.index', value: stageIndex + 1 },
      ],
      sequence: index + 1,
      createdAt: endTime,
      updatedAt: endTime,
    });
  }

  for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
    const index = stageCount + 1 + leafIndex;
    const stageIndex = leafIndex % Math.max(1, stageCount);
    const ordinal = Math.floor(leafIndex / Math.max(1, stageCount));
    const type = SPAN_TYPES[ordinal % SPAN_TYPES.length] ?? 'system';
    const cyclePosition = ordinal % SPAN_TYPES.length;
    const chained = cyclePosition >= 1 && cyclePosition <= 3;
    const parentSpanId = chained
      ? fixtureSpanId(index - stageCount)
      : fixtureSpanId(stageIndex + 1);
    const startTime = TRACE_FIXTURE_STARTED_AT + 180 + ordinal * 140 + stageIndex * 17;
    const durationMs = fixtureDuration(type, index);
    const endTime = Math.min(runEnd, startTime + durationMs);
    const sourceIds =
      type === 'retrieval' ? [ordinal % 2 === 0 ? WEB_SOURCE_ID : DATA_SOURCE_ID] : undefined;
    const status = index > 0 && index % 89 === 0 ? 'error' : 'ok';
    const service = fixtureService(type);
    spans.push({
      id: `fixture_span_${index}`,
      deckId: 'deck_trace_scale_fixture',
      runId: 'run_trace_scale_fixture',
      traceId: TRACE_FIXTURE_TRACE_ID,
      spanId: fixtureSpanId(index),
      parentSpanId,
      name: `Span ${String(index).padStart(4, '0')} · ${type}`,
      operationName: fixtureOperation(type),
      kind: type === 'model' || type === 'retrieval' ? 'client' : 'internal',
      status,
      startTime,
      endTime,
      durationMs: endTime - startTime,
      ...(type === 'model'
        ? {
            provider: 'openrouter',
            model: 'z-ai/glm-5.2',
            inputTokens: 80 + (index % 11),
            outputTokens: 24 + (index % 7),
            costMicroUsd: 120 + (index % 13),
          }
        : {}),
      ...(type === 'tool' || type === 'retrieval' || type === 'validation'
        ? { toolName: fixtureOperation(type) }
        : {}),
      ...(sourceIds ? { sourceIds } : {}),
      attributes: [
        { key: 'service.name', value: service },
        { key: 'otel.scope.name', value: 'nodeslide.agentic.fixture' },
        { key: 'nodeslide.fixture.index', value: index },
        ...(type === 'human' ? [{ key: 'nodeslide.wait.kind', value: 'human' as const }] : []),
        ...(type === 'system' && index % 5 === 0
          ? [{ key: 'nodeslide.memory.count', value: 2 }]
          : []),
        ...(type === 'validation'
          ? [{ key: 'nodeslide.validation.receipt', value: CANDIDATE_DIGEST }]
          : []),
      ],
      sequence: index + 1,
      createdAt: endTime,
      updatedAt: endTime,
    });
  }

  return spans;
}

function createFixtureEvents(spans: readonly NodeSlideAgentSpan[]): NodeSlideAgentEvent[] {
  const events: NodeSlideAgentEvent[] = [];
  for (const [index, span] of spans.entries()) {
    const isCitation = Boolean(span.sourceIds?.length);
    const isCheckpoint = index > 0 && index % 37 === 0;
    const isFailure = span.status === 'error';
    if (!isCitation && !isCheckpoint && !isFailure) continue;
    const name = isFailure ? 'exception' : isCitation ? 'citation.bound' : 'checkpoint';
    events.push({
      id: `fixture_event_${events.length}`,
      deckId: span.deckId,
      runId: span.runId,
      traceId: span.traceId,
      spanId: span.spanId,
      name,
      severity: isFailure ? 'error' : 'info',
      timestamp: span.startTime + Math.max(1, Math.floor((span.durationMs ?? 2) / 2)),
      body: isFailure
        ? `Deterministic fixture failure at ${span.spanId}`
        : isCitation
          ? `Bound ${span.sourceIds?.join(', ') ?? 'source'} to this exact span`
          : `Durable checkpoint ${index}`,
      attributes: [{ key: 'nodeslide.fixture.event', value: true }],
      sequence: spans.length + events.length + 1,
    });
  }
  return events;
}

export function createTraceWaterfallFixture(
  spanCount: number,
  options: TraceWaterfallFixtureOptions = {},
): TraceWaterfallFixture {
  if (!Number.isInteger(spanCount) || spanCount < 0) {
    throw new Error(`spanCount must be a non-negative integer; received ${spanCount}`);
  }
  const loadedSpanCount = Math.min(
    spanCount,
    Math.max(0, Math.floor(options.loadedSpanCount ?? spanCount)),
  );
  const allSpans = createFixtureSpans(spanCount);
  const allEvents = createFixtureEvents(allSpans);
  const loadedSpans = allSpans.slice(0, loadedSpanCount);
  const loadedSpanIds = new Set(loadedSpans.map((span) => span.spanId));
  const loadedEvents = allEvents.filter((event) => loadedSpanIds.has(event.spanId));
  const hasMore = loadedSpanCount < spanCount;
  const runEnd = allSpans[0]?.endTime ?? TRACE_FIXTURE_STARTED_AT + 1;
  const validation: ValidationResult = {
    id: 'validation_trace_scale_fixture',
    deckId: 'deck_trace_scale_fixture',
    deckVersion: 7,
    ok: true,
    publishOk: true,
    cleanOk: true,
    issues: [],
    checkedAt: runEnd,
    toolchainVersion: 'nodeslide.slidelang/v1',
  };
  const run: NodeSlideAgentRun = {
    id: 'run_trace_scale_fixture',
    deckId: 'deck_trace_scale_fixture',
    idempotencyKey: 'request_trace_scale_fixture',
    instruction: `Render the deterministic ${spanCount}-span observability fixture`,
    status: 'awaiting_review',
    provider: 'openrouter',
    model: 'z-ai/glm-5.2',
    webResearch: true,
    attempt: 1,
    otelTraceId: TRACE_FIXTURE_TRACE_ID,
    ...(spanCount > 0 ? { rootSpanId: TRACE_FIXTURE_ROOT_SPAN_ID } : {}),
    traceId: 'trace_trace_scale_fixture',
    checkpoint: 'candidate_validation_completed',
    telemetryVersion: 'nodeslide.otel.v1',
    createdAt: TRACE_FIXTURE_STARTED_AT,
    updatedAt: runEnd,
  };
  const trace: AgentTrace = {
    id: 'trace_trace_scale_fixture',
    deckId: run.deckId,
    status: 'awaiting_review',
    summary: `${spanCount}-span deterministic trace fixture`,
    plan: ['Read exact evidence', 'Run parallel tools', 'Validate candidate'],
    context: [WEB_SOURCE_ID, DATA_SOURCE_ID],
    toolCalls: ['retrieval.query', 'execute_tool', 'validate_candidate'],
    guardrails: ['Exact edit consent recorded', 'Human review required'],
    planningInputDigest: 'planning_input_0123456789abcdef0123456789abcdef',
    planningSnapshotDigest: 'planning_snapshot_0123456789abcdef0123456789abcdef',
    validation,
    candidateDigest: CANDIDATE_DIGEST,
    provider: run.provider,
    model: run.model,
    reasoningEffort: 'high',
    costMicroUsd: Math.max(4_200, spanCount * 18),
    inputTokens: Math.max(2_400, spanCount * 12),
    outputTokens: Math.max(600, spanCount * 3),
    sourceBindingStatus: 'bound',
    claimSourceBindings: [
      {
        operationIndex: 0,
        operation: 'update_chart',
        slideId: 'slide_fixture_metrics',
        elementId: 'chart_fixture_metrics',
        sourceIds: [DATA_SOURCE_ID],
        claimDigest: 'sha256:claim0123456789abcdef0123456789abcdef0123456789abcdef012345678',
      },
    ],
    createdAt: TRACE_FIXTURE_STARTED_AT,
  };
  const telemetry: NodeSlideAgentTelemetryPage = {
    spans: loadedSpans,
    events: loadedEvents,
    hasMore,
    ...(hasMore ? { nextBeforeSequence: Math.max(1, loadedSpans.at(-1)?.sequence ?? 1) } : {}),
    totalRecorded: allSpans.length + allEvents.length,
  };
  const messages: NodeSlideAgentMessage[] = [
    {
      id: 'message_trace_scale_fixture',
      deckId: run.deckId,
      runId: run.id,
      role: 'assistant',
      content: 'Prepared a source-bound candidate and deterministic validation receipt.',
      sourceIds: [WEB_SOURCE_ID, DATA_SOURCE_ID],
      createdAt: runEnd,
    },
  ];

  return {
    run,
    trace,
    validation,
    telemetry,
    messages,
    sources: createFixtureSources(),
    allSpans,
    allEvents,
  };
}
