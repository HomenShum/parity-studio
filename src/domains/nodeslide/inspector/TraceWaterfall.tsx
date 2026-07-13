import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Database,
  ExternalLink,
  FileText,
  Globe2,
  Maximize2,
  Search,
  Wrench,
} from 'lucide-react';
import { type CSSProperties, type UIEvent, useMemo, useState } from 'react';
import type {
  NodeSlideAgentEvent,
  NodeSlideAgentMessage,
  NodeSlideAgentRun,
  NodeSlideAgentSpan,
  NodeSlideAgentTelemetryPage,
  SourceRecord,
} from '../../../../shared/nodeslide';

type WaterfallFilter = 'all' | 'errors' | 'sources' | 'models';

export interface TraceWaterfallRow {
  span: NodeSlideAgentSpan;
  depth: number;
  childCount: number;
}

interface TraceWaterfallProps {
  run: NodeSlideAgentRun;
  telemetry: NodeSlideAgentTelemetryPage;
  messages: readonly NodeSlideAgentMessage[];
  sources: readonly SourceRecord[];
  loadingMore?: boolean;
  loadError?: string;
  compact?: boolean;
  onExpand?: () => void;
  onLoadMore?: (runId: string, beforeSequence: number) => void | Promise<void>;
}

const ROW_HEIGHT = 38;
const OVERSCAN = 8;

function spanMatches(span: NodeSlideAgentSpan, filter: WaterfallFilter, query: string): boolean {
  if (filter === 'errors' && span.status !== 'error') return false;
  if (filter === 'sources' && !span.sourceIds?.length) return false;
  if (filter === 'models' && !span.model) return false;
  if (!query) return true;
  const haystack = [
    span.name,
    span.operationName,
    span.toolName,
    span.provider,
    span.model,
    ...(span.sourceIds ?? []),
    ...span.attributes.map((attribute) => `${attribute.key} ${String(attribute.value)}`),
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
  return haystack.includes(query.toLocaleLowerCase());
}

function spanMemoryCount(span: NodeSlideAgentSpan): number {
  const value = span.attributes.find(
    (attribute) => attribute.key === 'nodeslide.memory.count',
  )?.value;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function buildWaterfallRows(
  spans: readonly NodeSlideAgentSpan[],
  collapsed: ReadonlySet<string> = new Set(),
  filter: WaterfallFilter = 'all',
  query = '',
): TraceWaterfallRow[] {
  const bySpanId = new Map(spans.map((span) => [span.spanId, span]));
  const children = new Map<string, NodeSlideAgentSpan[]>();
  for (const span of spans) {
    const parent = span.parentSpanId && bySpanId.has(span.parentSpanId) ? span.parentSpanId : '';
    const bucket = children.get(parent) ?? [];
    bucket.push(span);
    children.set(parent, bucket);
  }
  for (const bucket of children.values()) {
    bucket.sort(
      (left, right) => left.startTime - right.startTime || left.sequence - right.sequence,
    );
  }

  let included: Set<string> | null = null;
  if (filter !== 'all' || query.trim()) {
    included = new Set<string>();
    for (const span of spans) {
      if (!spanMatches(span, filter, query.trim())) continue;
      let current: NodeSlideAgentSpan | undefined = span;
      while (current && !included.has(current.spanId)) {
        included.add(current.spanId);
        current = current.parentSpanId ? bySpanId.get(current.parentSpanId) : undefined;
      }
    }
  }

  const rows: TraceWaterfallRow[] = [];
  const visited = new Set<string>();
  const visit = (span: NodeSlideAgentSpan, depth: number) => {
    if (visited.has(span.spanId) || (included && !included.has(span.spanId))) return;
    visited.add(span.spanId);
    const descendants = children.get(span.spanId) ?? [];
    rows.push({ span, depth, childCount: descendants.length });
    if (collapsed.has(span.spanId)) return;
    for (const child of descendants) visit(child, depth + 1);
  };
  for (const root of children.get('') ?? []) visit(root, 0);
  for (const span of spans) visit(span, 0);
  return rows;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return 'open';
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function formatClock(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(value);
}

function spanTone(span: NodeSlideAgentSpan): string {
  if (span.status === 'error') return 'error';
  if (span.sourceIds?.length || spanMemoryCount(span) > 0) return 'retrieval';
  if (span.operationName === 'chat' || span.model) return 'model';
  if (span.operationName === 'execute_tool' || span.toolName) return 'tool';
  if (/validat/i.test(`${span.operationName} ${span.name}`)) return 'validation';
  if (/approval|human/i.test(`${span.operationName} ${span.name}`)) return 'human';
  return 'system';
}

function spanIcon(span: NodeSlideAgentSpan) {
  const tone = spanTone(span);
  if (tone === 'error') return AlertTriangle;
  if (tone === 'retrieval') return Database;
  if (tone === 'model') return Bot;
  if (tone === 'tool') return Wrench;
  return CircleDot;
}

function intervalUnionDuration(spans: readonly NodeSlideAgentSpan[]): number {
  const intervals = spans
    .filter((span) => span.endTime !== undefined && span.parentSpanId)
    .map((span) => [span.startTime, span.endTime as number] as const)
    .filter(([start, end]) => end >= start)
    .sort((left, right) => left[0] - right[0]);
  let total = 0;
  let cursorStart = -1;
  let cursorEnd = -1;
  for (const [start, end] of intervals) {
    if (cursorStart < 0) {
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
  return cursorStart < 0 ? 0 : total + cursorEnd - cursorStart;
}

function MiniMap({
  spans,
  rangeStart,
  rangeEnd,
}: {
  spans: readonly NodeSlideAgentSpan[];
  rangeStart: number;
  rangeEnd: number;
}) {
  const buckets = useMemo(() => {
    const result = Array.from({ length: 48 }, (_, index) => ({
      id: `trace-bucket-${index}`,
      count: 0,
      error: false,
    }));
    const duration = Math.max(1, rangeEnd - rangeStart);
    for (const span of spans) {
      const start = Math.max(
        0,
        Math.min(47, Math.floor(((span.startTime - rangeStart) / duration) * 48)),
      );
      const observedEnd = span.endTime ?? Math.max(span.startTime, rangeEnd);
      const end = Math.max(
        start,
        Math.min(47, Math.floor(((observedEnd - rangeStart) / duration) * 48)),
      );
      for (let index = start; index <= end; index += 1) {
        const bucket = result[index];
        if (!bucket) continue;
        bucket.count += 1;
        if (span.status === 'error') bucket.error = true;
      }
    }
    return result;
  }, [rangeEnd, rangeStart, spans]);
  const maximum = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return (
    <div className="ns-waterfall-minimap" aria-label="Trace activity overview">
      {buckets.map((bucket) => (
        <span
          key={bucket.id}
          className={bucket.error ? 'has-error' : ''}
          style={
            {
              '--ns-mini-height': `${Math.max(8, (bucket.count / maximum) * 100)}%`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

export function TraceWaterfall({
  run,
  telemetry,
  messages,
  sources,
  loadingMore = false,
  loadError,
  compact = false,
  onExpand,
  onLoadMore,
}: TraceWaterfallProps) {
  const [filter, setFilter] = useState<WaterfallFilter>('all');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(430);

  const spans = useMemo(
    () => [...telemetry.spans].sort((left, right) => left.startTime - right.startTime),
    [telemetry.spans],
  );
  const rows = useMemo(
    () => buildWaterfallRows(spans, collapsed, filter, query),
    [collapsed, filter, query, spans],
  );
  const rangeStart = Math.min(run.createdAt, ...spans.map((span) => span.startTime));
  const rangeEnd = Math.max(
    run.updatedAt,
    ...spans.map((span) => span.endTime ?? span.startTime),
    ...telemetry.events.map((event) => event.timestamp),
  );
  const rangeDuration = Math.max(1, rangeEnd - rangeStart);
  const activeDuration = intervalUnionDuration(spans);
  const selected = spans.find((span) => span.spanId === selectedSpanId) ?? rows[0]?.span;
  const eventsBySpan = useMemo(() => {
    const map = new Map<string, NodeSlideAgentEvent[]>();
    for (const event of telemetry.events) {
      const bucket = map.get(event.spanId) ?? [];
      bucket.push(event);
      map.set(event.spanId, bucket);
    }
    return map;
  }, [telemetry.events]);

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const visibleRows = rows.slice(startIndex, endIndex);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
    setViewportHeight(event.currentTarget.clientHeight);
  };

  const runMessages = messages.filter((message) => message.runId === run.id);
  const exactSourceIds = selected?.sourceIds ?? [];
  const legacySourceIds = exactSourceIds.length
    ? []
    : [...new Set(runMessages.flatMap((message) => message.sourceIds ?? []))];
  const evidenceMode = exactSourceIds.length ? 'span' : legacySourceIds.length ? 'run' : 'none';
  const evidenceIds = exactSourceIds.length ? exactSourceIds : legacySourceIds;
  const evidence = evidenceIds
    .map((id) => sources.find((source) => source.id === id))
    .filter((source): source is SourceRecord => Boolean(source));
  const selectedEvents = selected ? (eventsBySpan.get(selected.spanId) ?? []) : [];

  if (compact) {
    const orderedSpans = [...spans].sort((left, right) => left.sequence - right.sequence);
    const compactSpans =
      orderedSpans.length <= 6
        ? orderedSpans
        : [orderedSpans[0], ...orderedSpans.slice(-5)].filter((span): span is NodeSlideAgentSpan =>
            Boolean(span),
          );
    const hiddenCount = Math.max(0, orderedSpans.length - compactSpans.length);
    const errorCount = spans.filter((span) => span.status === 'error').length;
    const citedCount = spans.filter((span) => span.sourceIds?.length).length;

    return (
      <section
        className="ns-trace-activity-compact"
        data-testid="trace-waterfall"
        aria-label="Compact trace activity"
      >
        <header>
          <div>
            <span className={`ns-waterfall-status is-${run.status}`} />
            <div>
              <strong>Activity</strong>
              <small>
                {spans.length} span{spans.length === 1 ? '' : 's'} · {formatDuration(rangeDuration)}
              </small>
            </div>
          </div>
          <button type="button" onClick={onExpand} aria-label="Open full trace timeline">
            <Maximize2 size={12} /> Full timeline
          </button>
        </header>

        <div className="ns-trace-activity-health" aria-label="Trace health summary">
          <span>
            <b>{telemetry.totalRecorded}</b> records
          </span>
          <span className={errorCount ? 'has-error' : ''}>
            <b>{errorCount}</b> errors
          </span>
          <span>
            <b>{citedCount}</b> cited
          </span>
        </div>

        <ol aria-label="Latest trace activity">
          {compactSpans.map((span) => {
            const Icon = spanIcon(span);
            const memoryCount = spanMemoryCount(span);
            return (
              <li key={span.id} className={`is-${spanTone(span)}`} data-testid="trace-activity-row">
                <span className="ns-trace-activity-icon">
                  <Icon size={12} />
                </span>
                <div>
                  <strong>{span.name}</strong>
                  <small>{span.toolName ?? span.operationName}</small>
                </div>
                <time dateTime={new Date(span.startTime).toISOString()}>
                  {formatDuration(span.durationMs)}
                </time>
                {span.sourceIds?.length ? (
                  <span className="ns-trace-activity-source" title="Span-bound sources">
                    {span.sourceIds.length} source{span.sourceIds.length === 1 ? '' : 's'}
                  </span>
                ) : null}
                {memoryCount ? (
                  <span className="ns-trace-activity-source" title="Bounded deck memories used">
                    {memoryCount} memor{memoryCount === 1 ? 'y' : 'ies'}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>

        {hiddenCount ? (
          <p className="ns-trace-activity-more">
            {hiddenCount} earlier step{hiddenCount === 1 ? '' : 's'} available in the full timeline.
          </p>
        ) : null}
        {telemetry.hasMore ? (
          <p className="ns-trace-activity-more">Older telemetry is available on the server.</p>
        ) : null}
        {loadError ? (
          <p className="ns-waterfall-error">Telemetry unavailable: {loadError}</p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="ns-waterfall" data-testid="trace-waterfall">
      <header className="ns-waterfall-runbar">
        <div>
          <span className={`ns-waterfall-status is-${run.status}`} />
          <div>
            <strong>{run.instruction}</strong>
            <small>
              {run.provider} · {run.model}
            </small>
          </div>
        </div>
        <dl>
          <div>
            <dt>Started</dt>
            <dd>{formatClock(run.createdAt)}</dd>
          </div>
          <div>
            <dt>Wall</dt>
            <dd>{formatDuration(Math.max(0, run.updatedAt - run.createdAt))}</dd>
          </div>
          <div>
            <dt>Active</dt>
            <dd>{formatDuration(activeDuration)}</dd>
          </div>
          <div>
            <dt>Records</dt>
            <dd>{telemetry.totalRecorded}</dd>
          </div>
        </dl>
      </header>

      <div className="ns-waterfall-toolbar">
        <label>
          <Search size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find span, tool, model, or source"
            aria-label="Search trace spans"
          />
        </label>
        <fieldset>
          <legend className="ns-sr-only">Filter trace spans</legend>
          {(['all', 'errors', 'sources', 'models'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={filter === value ? 'is-active' : ''}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === 'all'
                ? 'All'
                : value === 'errors'
                  ? 'Errors'
                  : value === 'sources'
                    ? 'Sources'
                    : 'Models'}
            </button>
          ))}
        </fieldset>
      </div>

      <MiniMap spans={spans} rangeStart={rangeStart} rangeEnd={rangeEnd} />
      <div className="ns-waterfall-axis" aria-hidden="true">
        <span>Operation</span>
        {[0, 25, 50, 75, 100].map((tick) => (
          <i
            key={tick}
            data-edge={tick === 0 ? 'start' : tick === 100 ? 'end' : undefined}
            style={{ left: `${42 + tick * 0.58}%` }}
          >
            {formatDuration((rangeDuration * tick) / 100)}
          </i>
        ))}
      </div>

      <div
        className="ns-waterfall-scroll"
        onScroll={onScroll}
        role="tree"
        aria-label="Trace span waterfall"
        style={{ height: Math.min(430, Math.max(152, rows.length * ROW_HEIGHT)) }}
      >
        <div className="ns-waterfall-rows" style={{ height: rows.length * ROW_HEIGHT }}>
          {visibleRows.map(({ span, depth, childCount }, index) => {
            const rowIndex = startIndex + index;
            const observedEnd = span.endTime ?? Math.max(span.startTime, rangeEnd);
            const left = ((span.startTime - rangeStart) / rangeDuration) * 100;
            const measuredWidth = ((observedEnd - span.startTime) / rangeDuration) * 100;
            const width =
              span.endTime === undefined
                ? Math.max(0.8, measuredWidth)
                : Math.max(0.5, measuredWidth);
            const Icon = spanIcon(span);
            const rowEvents = eventsBySpan.get(span.spanId) ?? [];
            const isCollapsed = collapsed.has(span.spanId);
            return (
              <div
                key={span.id}
                className={`ns-waterfall-row is-${spanTone(span)} ${selected?.spanId === span.spanId ? 'is-selected' : ''}`}
                style={{ top: rowIndex * ROW_HEIGHT } as CSSProperties}
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={selected?.spanId === span.spanId}
                data-testid="trace-waterfall-row"
              >
                <div
                  className="ns-waterfall-label"
                  style={{ '--ns-trace-depth': depth } as CSSProperties}
                >
                  {childCount ? (
                    <button
                      type="button"
                      className="ns-waterfall-disclosure"
                      aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${span.name}`}
                      onClick={() => {
                        setCollapsed((current) => {
                          const next = new Set(current);
                          if (next.has(span.spanId)) next.delete(span.spanId);
                          else next.add(span.spanId);
                          return next;
                        });
                      }}
                    >
                      {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                  ) : (
                    <span className="ns-waterfall-disclosure" />
                  )}
                  <button
                    type="button"
                    className="ns-waterfall-label-main"
                    onClick={() => setSelectedSpanId(span.spanId)}
                  >
                    <Icon size={13} />
                    <span>
                      <strong>{span.name}</strong>
                      <small>{span.toolName ?? span.operationName}</small>
                    </span>
                  </button>
                </div>
                <button
                  type="button"
                  className="ns-waterfall-track"
                  onClick={() => setSelectedSpanId(span.spanId)}
                  aria-label={`${span.name}, ${formatDuration(span.durationMs)}`}
                >
                  <span
                    className="ns-waterfall-bar"
                    data-tone={spanTone(span)}
                    data-open={span.endTime === undefined ? 'true' : 'false'}
                    style={{
                      left: `${Math.max(0, left)}%`,
                      width: `${Math.min(100 - Math.max(0, left), width)}%`,
                    }}
                  />
                  {rowEvents.map((event) => (
                    <i
                      key={event.id}
                      className={`ns-waterfall-event is-${event.severity}`}
                      title={`${event.name}: ${event.body}`}
                      style={{
                        left: `${Math.max(0, Math.min(100, ((event.timestamp - rangeStart) / rangeDuration) * 100))}%`,
                      }}
                    />
                  ))}
                </button>
                <time>{formatDuration(span.durationMs)}</time>
              </div>
            );
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="ns-waterfall-empty">No spans match this filter.</div>
      ) : null}

      {telemetry.hasMore && telemetry.nextBeforeSequence && onLoadMore ? (
        <button
          type="button"
          className="ns-waterfall-load"
          disabled={loadingMore}
          onClick={() => void onLoadMore(run.id, telemetry.nextBeforeSequence as number)}
        >
          {loadingMore
            ? 'Loading older spans…'
            : `Load older records · ${telemetry.spans.length + telemetry.events.length} of ${telemetry.totalRecorded}`}
        </button>
      ) : null}
      {loadError ? (
        <p className="ns-waterfall-error">Could not load older telemetry: {loadError}</p>
      ) : null}

      {selected ? (
        <aside className="ns-waterfall-detail" aria-label={`Selected span: ${selected.name}`}>
          <header>
            <div>
              <span className={`ns-waterfall-detail-icon is-${spanTone(selected)}`}>
                <Clock3 size={14} />
              </span>
              <div>
                <strong>{selected.name}</strong>
                <small>
                  {selected.operationName} · {selected.status}
                </small>
              </div>
            </div>
            <code>{selected.spanId}</code>
          </header>
          <div className="ns-waterfall-detail-grid">
            <section>
              <h3>Span</h3>
              <dl>
                <div>
                  <dt>Started</dt>
                  <dd>{formatClock(selected.startTime)}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{formatDuration(selected.durationMs)}</dd>
                </div>
                {selected.provider ? (
                  <div>
                    <dt>Provider</dt>
                    <dd>{selected.provider}</dd>
                  </div>
                ) : null}
                {selected.model ? (
                  <div>
                    <dt>Model</dt>
                    <dd>{selected.model}</dd>
                  </div>
                ) : null}
                {selected.toolName ? (
                  <div>
                    <dt>Tool</dt>
                    <dd>{selected.toolName}</dd>
                  </div>
                ) : null}
                {selected.costMicroUsd !== undefined ? (
                  <div>
                    <dt>Cost</dt>
                    <dd>${(selected.costMicroUsd / 1_000_000).toFixed(4)}</dd>
                  </div>
                ) : null}
                {selected.inputTokens !== undefined || selected.outputTokens !== undefined ? (
                  <div>
                    <dt>Tokens</dt>
                    <dd>
                      {selected.inputTokens ?? 0} in · {selected.outputTokens ?? 0} out
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
            <section>
              <h3>Events & attributes</h3>
              {selectedEvents.length ? (
                <ul>
                  {selectedEvents.map((event) => (
                    <li key={event.id}>
                      <b>{event.name}</b>
                      <span>{event.body}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No events on this span.</p>
              )}
              {selected.attributes.length ? (
                <details>
                  <summary>{selected.attributes.length} attributes</summary>
                  <dl>
                    {selected.attributes.map((attribute) => (
                      <div key={attribute.key}>
                        <dt>{attribute.key}</dt>
                        <dd>{String(attribute.value)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ) : null}
            </section>
            <section className="ns-waterfall-evidence">
              <h3>
                {evidenceMode === 'span'
                  ? 'Span evidence'
                  : evidenceMode === 'run'
                    ? 'Run evidence'
                    : 'Evidence'}
                {evidenceMode === 'span' ? <span>{evidence.length} cited</span> : null}
              </h3>
              {evidenceMode === 'run' ? (
                <p className="ns-waterfall-evidence-note">
                  Legacy run-level sources; this span has no stored source binding.
                </p>
              ) : null}
              {evidence.length ? (
                evidence.map((source) => (
                  <article key={source.id}>
                    <div>
                      <span>{source.url ? <Globe2 size={13} /> : <FileText size={13} />}</span>
                      <div>
                        <strong>{source.title}</strong>
                        <small>
                          {source.sourceType} · retrieved{' '}
                          {new Date(source.retrievedAt).toLocaleDateString()}
                        </small>
                      </div>
                      {source.url ? (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${source.title}`}
                        >
                          <ExternalLink size={13} />
                        </a>
                      ) : null}
                    </div>
                    <p>
                      {source.citation.length > 320
                        ? `${source.citation.slice(0, 320)}…`
                        : source.citation}
                    </p>
                    <footer>
                      {source.contentDigest ? (
                        <code>{source.contentDigest.slice(0, 18)}…</code>
                      ) : (
                        <span>digest not recorded</span>
                      )}
                      {source.rowCount !== undefined ? <span>{source.rowCount} rows</span> : null}
                      {source.columns?.length ? <span>{source.columns.length} columns</span> : null}
                    </footer>
                  </article>
                ))
              ) : (
                <p>No source citation is bound to this span.</p>
              )}
            </section>
          </div>
        </aside>
      ) : null}
    </section>
  );
}
