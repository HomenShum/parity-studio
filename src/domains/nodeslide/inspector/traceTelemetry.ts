import type { SpanData } from '@assistant-ui/react-o11y';
import type {
  AgentTrace,
  NodeSlideAgentEvent,
  NodeSlideAgentRun,
  NodeSlideAgentSpan,
} from '../../../../shared/nodeslide';

export type TraceTimingState = 'recorded' | 'open' | 'unknown';

export interface TraceWindowMetrics {
  rangeStart: number;
  rangeEnd: number;
  wallDurationMs: number;
  activeDurationMs: number;
  humanWaitDurationMs: number;
  loadedRecordCount: number;
  omittedRecordCount: number;
  isComplete: boolean;
}

export interface TraceProofSummary {
  provider: string;
  model: string;
  effort?: string;
  inputTokens?: number;
  outputTokens?: number;
  costMicroUsd?: number;
  digest?: string;
  digestLabel?: 'candidate' | 'planning snapshot' | 'planning input' | 'span';
  accountingScope: 'run' | 'loaded spans' | 'not recorded';
}

function finiteNumber(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

export function spanEndTime(span: NodeSlideAgentSpan): number | undefined {
  const start = finiteNumber(span.startTime);
  const end = finiteNumber(span.endTime);
  if (start !== undefined && end !== undefined && end >= start) return end;
  const duration = finiteNumber(span.durationMs);
  if (start !== undefined && duration !== undefined && duration >= 0) return start + duration;
  return undefined;
}

export function spanDurationMs(span: NodeSlideAgentSpan): number | undefined {
  const duration = finiteNumber(span.durationMs);
  if (duration !== undefined && duration >= 0) return duration;
  const end = spanEndTime(span);
  return end === undefined ? undefined : Math.max(0, end - span.startTime);
}

export function spanTimingState(span: NodeSlideAgentSpan): TraceTimingState {
  if (spanEndTime(span) !== undefined) return 'recorded';
  return span.status === 'unset' ? 'open' : 'unknown';
}

function o11yStatus(span: NodeSlideAgentSpan): SpanData['status'] {
  if (span.status === 'error') return 'failed';
  if (spanTimingState(span) === 'open') return 'running';
  return 'completed';
}

function safeParentSpanId(
  span: NodeSlideAgentSpan,
  bySpanId: ReadonlyMap<string, NodeSlideAgentSpan>,
): string | null {
  const parent = span.parentSpanId;
  if (!parent || parent === span.spanId || !bySpanId.has(parent)) return null;

  const visited = new Set([span.spanId]);
  let cursor: string | undefined = parent;
  while (cursor) {
    if (visited.has(cursor)) return null;
    visited.add(cursor);
    const next: string | undefined = bySpanId.get(cursor)?.parentSpanId;
    if (!next || !bySpanId.has(next)) break;
    cursor = next;
  }
  return parent;
}

/** Lossless NodeSlide -> react-o11y adaptation, except malformed parents become roots. */
export function toO11ySpans(spans: readonly NodeSlideAgentSpan[]): SpanData[] {
  const bySpanId = new Map(spans.map((span) => [span.spanId, span]));
  return spans.map((span) => {
    const end = spanEndTime(span);
    return {
      id: span.spanId,
      parentSpanId: safeParentSpanId(span, bySpanId),
      name: span.name,
      type: spanType(span),
      status: o11yStatus(span),
      startedAt: span.startTime,
      endedAt: end ?? null,
      latencyMs: spanDurationMs(span) ?? null,
    };
  });
}

export function spanType(span: NodeSlideAgentSpan): string {
  if (span.status === 'error') return 'error';
  if (span.sourceIds?.length || numericAttribute(span, 'nodeslide.memory.count') > 0) {
    return 'retrieval';
  }
  if (span.operationName === 'chat' || span.model) return 'model';
  if (span.operationName === 'execute_tool' || span.toolName) return 'tool';
  if (/validat/i.test(`${span.operationName} ${span.name}`)) return 'validation';
  if (isHumanWaitSpan(span)) return 'human';
  return 'system';
}

export function numericAttribute(span: NodeSlideAgentSpan, key: string): number {
  const value = span.attributes.find((attribute) => attribute.key === key)?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function isHumanWaitSpan(span: NodeSlideAgentSpan): boolean {
  const waitKind = span.attributes.find((attribute) =>
    ['nodeslide.wait.kind', 'gen_ai.wait.kind'].includes(attribute.key),
  )?.value;
  if (waitKind === 'human') return true;
  return /approval|human[._ -]?wait|await[._ -]?review/i.test(`${span.operationName} ${span.name}`);
}

function intervalUnionDuration(intervals: readonly (readonly [number, number])[]): number {
  const ordered = [...intervals]
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
    .sort((left, right) => left[0] - right[0]);
  let total = 0;
  let cursorStart: number | undefined;
  let cursorEnd: number | undefined;
  for (const [start, end] of ordered) {
    if (cursorStart === undefined || cursorEnd === undefined) {
      cursorStart = start;
      cursorEnd = end;
    } else if (start <= cursorEnd) {
      cursorEnd = Math.max(cursorEnd, end);
    } else {
      total += cursorEnd - cursorStart;
      cursorStart = start;
      cursorEnd = end;
    }
  }
  return cursorStart === undefined || cursorEnd === undefined ? 0 : total + cursorEnd - cursorStart;
}

export function traceWindowMetrics(
  run: NodeSlideAgentRun,
  spans: readonly NodeSlideAgentSpan[],
  events: readonly NodeSlideAgentEvent[],
  totalRecorded: number,
  hasMore: boolean,
): TraceWindowMetrics {
  const starts = spans.map((span) => span.startTime).filter(Number.isFinite);
  const observedEnds = spans
    .map((span) => spanEndTime(span) ?? span.startTime)
    .filter(Number.isFinite);
  const eventTimes = events.map((event) => event.timestamp).filter(Number.isFinite);
  const rangeStart = Math.min(run.createdAt, ...starts, ...eventTimes);
  const rangeEnd = Math.max(
    rangeStart,
    run.completedAt ?? run.updatedAt,
    run.updatedAt,
    ...observedEnds,
    ...eventTimes,
  );

  const parentIds = new Set(
    spans.flatMap((span) => (span.parentSpanId ? [span.parentSpanId] : [])),
  );
  const timedLeaves = spans.filter(
    (span) => !parentIds.has(span.spanId) && spanEndTime(span) !== undefined,
  );
  const timed = timedLeaves.length > 0 ? timedLeaves : spans.filter((span) => spanEndTime(span));
  const intervals = (predicate: (span: NodeSlideAgentSpan) => boolean) =>
    timed.filter(predicate).map((span) => [span.startTime, spanEndTime(span) as number] as const);
  const loadedRecordCount = spans.length + events.length;

  return {
    rangeStart,
    rangeEnd,
    wallDurationMs: Math.max(0, (run.completedAt ?? rangeEnd) - run.createdAt),
    activeDurationMs: intervalUnionDuration(intervals((span) => !isHumanWaitSpan(span))),
    humanWaitDurationMs: intervalUnionDuration(intervals(isHumanWaitSpan)),
    loadedRecordCount,
    omittedRecordCount: Math.max(0, totalRecorded - loadedRecordCount),
    isComplete: !hasMore,
  };
}

function firstStringAttribute(
  spans: readonly NodeSlideAgentSpan[],
  pattern: RegExp,
): string | undefined {
  for (const span of spans) {
    for (const attribute of span.attributes) {
      if (pattern.test(attribute.key) && typeof attribute.value === 'string' && attribute.value) {
        return attribute.value;
      }
    }
  }
  return undefined;
}

function sumRecorded(
  spans: readonly NodeSlideAgentSpan[],
  field: 'inputTokens' | 'outputTokens' | 'costMicroUsd',
): number | undefined {
  const values = spans
    .map((span) => span[field])
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : undefined;
}

export function traceProofSummary(
  run: NodeSlideAgentRun,
  spans: readonly NodeSlideAgentSpan[],
  trace?: AgentTrace,
): TraceProofSummary {
  const inputTokens = trace?.inputTokens ?? sumRecorded(spans, 'inputTokens');
  const outputTokens = trace?.outputTokens ?? sumRecorded(spans, 'outputTokens');
  const costMicroUsd = trace?.costMicroUsd ?? sumRecorded(spans, 'costMicroUsd');
  const hasRunAccounting =
    trace?.inputTokens !== undefined ||
    trace?.outputTokens !== undefined ||
    trace?.costMicroUsd !== undefined;
  const hasLoadedAccounting =
    inputTokens !== undefined || outputTokens !== undefined || costMicroUsd !== undefined;

  const digest =
    trace?.candidateDigest ??
    trace?.planningSnapshotDigest ??
    trace?.planningInputDigest ??
    firstStringAttribute(spans, /(?:^|[._])(?:candidate_?)?digest$/i);
  const digestLabel = trace?.candidateDigest
    ? 'candidate'
    : trace?.planningSnapshotDigest
      ? 'planning snapshot'
      : trace?.planningInputDigest
        ? 'planning input'
        : digest
          ? 'span'
          : undefined;

  return {
    provider: trace?.provider ?? run.provider,
    model: trace?.model ?? run.model,
    ...(trace?.reasoningEffort
      ? { effort: trace.reasoningEffort }
      : firstStringAttribute(spans, /reasoning[._-]?effort/i)
        ? { effort: firstStringAttribute(spans, /reasoning[._-]?effort/i) as string }
        : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(costMicroUsd !== undefined ? { costMicroUsd } : {}),
    ...(digest ? { digest } : {}),
    ...(digestLabel ? { digestLabel } : {}),
    accountingScope: hasRunAccounting
      ? 'run'
      : hasLoadedAccounting
        ? 'loaded spans'
        : 'not recorded',
  };
}
