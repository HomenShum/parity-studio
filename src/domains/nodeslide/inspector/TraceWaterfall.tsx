import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SpanByIndexProvider, SpanPrimitive, SpanResource } from '@assistant-ui/react-o11y';
import { AuiProvider, useAui, useAuiState } from '@assistant-ui/store';
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
  Image as ImageIcon,
  Maximize2,
  ScanSearch,
  Search,
  Wrench,
} from 'lucide-react';
import {
  type CSSProperties,
  type ComponentType,
  type KeyboardEvent,
  type UIEvent,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  AgentTrace,
  NodeSlideAgentEvent,
  NodeSlideAgentMessage,
  NodeSlideAgentRun,
  NodeSlideAgentSpan,
  NodeSlideAgentTelemetryPage,
  NodeSlideEvidenceBox,
  NodeSlideEvidenceCaptureDetail,
  NodeSlideEvidenceCaptureSummary,
  NodeSlideEvidenceStepDetail,
  SourceRecord,
} from '../../../../shared/nodeslide';
import type { PdfEvidencePageProps } from './PdfEvidencePage';
import {
  numericAttribute,
  spanDurationMs,
  spanEndTime,
  spanTimingState,
  spanType,
  toO11ySpans,
  traceProofSummary,
  traceWindowMetrics,
} from './traceTelemetry';
import './TraceWaterfall.css';

type WaterfallFilter = 'all' | 'errors' | 'sources' | 'models';
export type WaterfallGrouping = 'trace' | 'service' | 'type' | 'status';

export interface TraceWaterfallRow {
  span: NodeSlideAgentSpan;
  depth: number;
  childCount: number;
  groupKey?: string;
  groupLabel?: string;
}

export interface TraceWaterfallGroup {
  key: string;
  label: string;
  spanCount: number;
  errorCount: number;
  durationMs: number;
  costMicroUsd: number;
}

interface TraceWaterfallProps {
  run: NodeSlideAgentRun;
  trace?: AgentTrace;
  telemetry: NodeSlideAgentTelemetryPage;
  messages: readonly NodeSlideAgentMessage[];
  sources: readonly SourceRecord[];
  evidenceCaptures?: readonly NodeSlideEvidenceCaptureSummary[];
  loadingMore?: boolean;
  loadError?: string;
  compact?: boolean;
  onExpand?: () => void;
  onLoadMore?: (runId: string, beforeSequence: number) => void | Promise<void>;
  onLoadEvidenceCapture?: (captureId: string) => Promise<NodeSlideEvidenceCaptureDetail | null>;
}

const ROW_HEIGHT = 38;
const OVERSCAN = 8;
const MINIMAP_BUCKET_COUNT = 48;
const MAX_EVENT_MARKERS = 8;
const MAX_VISIBLE_EVENTS = 40;
const MAX_VISIBLE_ATTRIBUTES = 24;
const MAX_VISIBLE_EVIDENCE = 12;
const MAX_VISIBLE_GROUPS = 12;
const MAX_RECURSIVE_O11Y_SPANS = 64;
const MAX_COMPACT_SPANS = 6;

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
  return Math.max(0, Math.floor(numericAttribute(span, 'nodeslide.memory.count')));
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
  const structurallyAnchored = new Set<string>();
  const markAnchored = (span: NodeSlideAgentSpan) => {
    if (structurallyAnchored.has(span.spanId)) return;
    structurallyAnchored.add(span.spanId);
    for (const child of children.get(span.spanId) ?? []) markAnchored(child);
  };
  for (const root of children.get('') ?? []) markAnchored(root);
  const visit = (span: NodeSlideAgentSpan, depth: number) => {
    if (visited.has(span.spanId) || (included && !included.has(span.spanId))) return;
    visited.add(span.spanId);
    const descendants = children.get(span.spanId) ?? [];
    rows.push({ span, depth, childCount: descendants.length });
    // Search/filter is an explicit reveal action: matching descendants must not remain
    // silently hidden behind an earlier collapse choice.
    if (!included && collapsed.has(span.spanId)) return;
    for (const child of descendants) visit(child, depth + 1);
  };
  for (const root of children.get('') ?? []) visit(root, 0);
  // Only malformed cyclic islands need a fallback root. Descendants hidden by collapse
  // remain structurally anchored and must not reappear as fake top-level rows.
  for (const span of spans) {
    if (!structurallyAnchored.has(span.spanId)) visit(span, 0);
  }
  return rows;
}

function stringAttribute(span: NodeSlideAgentSpan, pattern: RegExp): string | undefined {
  const value = span.attributes.find(
    (attribute) => pattern.test(attribute.key) && typeof attribute.value === 'string',
  )?.value;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function spanGroupIdentity(
  span: NodeSlideAgentSpan,
  grouping: Exclude<WaterfallGrouping, 'trace'>,
): { key: string; label: string } {
  if (grouping === 'service') {
    const service =
      stringAttribute(span, /^(?:service\.name|resource\.service\.name)$/i) ??
      span.provider ??
      (span.toolName ? 'nodeslide.tools' : 'nodeslide.agent');
    return { key: service.toLocaleLowerCase(), label: service };
  }
  if (grouping === 'type') {
    const type = spanType(span);
    return { key: type, label: humanize(type) };
  }
  return { key: span.status, label: humanize(span.status) };
}

export function buildGroupedWaterfallRows(
  spans: readonly NodeSlideAgentSpan[],
  grouping: WaterfallGrouping,
  collapsed: ReadonlySet<string> = new Set(),
  filter: WaterfallFilter = 'all',
  query = '',
): TraceWaterfallRow[] {
  if (grouping === 'trace') return buildWaterfallRows(spans, collapsed, filter, query);

  return spans
    .filter((span) => spanMatches(span, filter, query.trim()))
    .map((span) => ({ span, group: spanGroupIdentity(span, grouping) }))
    .sort(
      (left, right) =>
        left.group.label.localeCompare(right.group.label) ||
        left.span.startTime - right.span.startTime ||
        left.span.sequence - right.span.sequence,
    )
    .map(({ span, group }) => ({
      span,
      depth: 0,
      childCount: 0,
      groupKey: group.key,
      groupLabel: group.label,
    }));
}

export function buildWaterfallGroups(
  spans: readonly NodeSlideAgentSpan[],
  grouping: Exclude<WaterfallGrouping, 'trace'>,
): TraceWaterfallGroup[] {
  const groups = new Map<string, TraceWaterfallGroup>();
  for (const span of spans) {
    const identity = spanGroupIdentity(span, grouping);
    const current = groups.get(identity.key) ?? {
      key: identity.key,
      label: identity.label,
      spanCount: 0,
      errorCount: 0,
      durationMs: 0,
      costMicroUsd: 0,
    };
    current.spanCount += 1;
    current.errorCount += span.status === 'error' ? 1 : 0;
    current.durationMs += spanDurationMs(span) ?? 0;
    current.costMicroUsd += span.costMicroUsd ?? 0;
    groups.set(identity.key, current);
  }
  return [...groups.values()].sort(
    (left, right) => right.spanCount - left.spanCount || left.label.localeCompare(right.label),
  );
}

export function collapsibleSpanIds(spans: readonly NodeSlideAgentSpan[]): Set<string> {
  const parents = new Set(spans.flatMap((span) => (span.parentSpanId ? [span.parentSpanId] : [])));
  return new Set(spans.filter((span) => parents.has(span.spanId)).map((span) => span.spanId));
}

export function defaultCollapsedSpanIds(
  spans: readonly NodeSlideAgentSpan[],
  threshold = 101,
): Set<string> {
  if (spans.length < threshold) return new Set();
  const bySpanId = new Set(spans.map((span) => span.spanId));
  const roots = spans.filter((span) => !span.parentSpanId || !bySpanId.has(span.parentSpanId));
  const rootIds = new Set(roots.map((span) => span.spanId));
  const collapsible = collapsibleSpanIds(spans);
  const groupedChildren = spans.filter(
    (span) => span.parentSpanId && rootIds.has(span.parentSpanId) && collapsible.has(span.spanId),
  );
  if (groupedChildren.length > 0) {
    return new Set(groupedChildren.map((span) => span.spanId));
  }
  return new Set(roots.filter((span) => collapsible.has(span.spanId)).map((span) => span.spanId));
}

function formatDuration(ms: number): string {
  if (ms === 0) return '0 ms';
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(value);
}

function formatSpanDuration(span: NodeSlideAgentSpan): string {
  const timing = spanTimingState(span);
  if (timing === 'open') return 'open at last checkpoint';
  if (timing === 'unknown') return 'duration unknown';
  return formatDuration(spanDurationMs(span) ?? 0);
}

function spanTone(span: NodeSlideAgentSpan): string {
  return spanType(span);
}

function spanIcon(span: NodeSlideAgentSpan) {
  const tone = spanTone(span);
  if (tone === 'error') return AlertTriangle;
  if (tone === 'retrieval') return Database;
  if (tone === 'model') return Bot;
  if (tone === 'tool') return Wrench;
  return CircleDot;
}

export interface TraceMiniMapBucket {
  id: string;
  count: number;
  error: boolean;
}

export function buildMiniMapBuckets(
  spans: readonly NodeSlideAgentSpan[],
  rangeStart: number,
  rangeEnd: number,
  bucketCount = MINIMAP_BUCKET_COUNT,
): TraceMiniMapBucket[] {
  const safeBucketCount = Math.max(1, Math.floor(bucketCount));
  const result = Array.from({ length: safeBucketCount }, (_, index) => ({
    id: `trace-bucket-${index}`,
    count: 0,
    error: false,
  }));
  const duration = Math.max(1, rangeEnd - rangeStart);
  for (const span of spans) {
    const start = Math.max(
      0,
      Math.min(
        safeBucketCount - 1,
        Math.floor(((span.startTime - rangeStart) / duration) * safeBucketCount),
      ),
    );
    const observedEnd =
      spanEndTime(span) ?? (spanTimingState(span) === 'open' ? rangeEnd : span.startTime);
    const end = Math.max(
      start,
      Math.min(
        safeBucketCount - 1,
        Math.floor(((observedEnd - rangeStart) / duration) * safeBucketCount),
      ),
    );
    for (let index = start; index <= end; index += 1) {
      const bucket = result[index];
      if (!bucket) continue;
      bucket.count += 1;
      if (span.status === 'error') bucket.error = true;
    }
  }
  return result;
}

function MiniMap({
  spans,
  rangeStart,
  rangeEnd,
  partial,
}: {
  spans: readonly NodeSlideAgentSpan[];
  rangeStart: number;
  rangeEnd: number;
  partial: boolean;
}) {
  const buckets = useMemo(
    () => buildMiniMapBuckets(spans, rangeStart, rangeEnd),
    [rangeEnd, rangeStart, spans],
  );
  const maximum = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return (
    <div
      className="ns-waterfall-minimap"
      role="img"
      aria-label={`Trace activity overview for ${spans.length} loaded spans${partial ? '; older records are not loaded' : ''}`}
      data-testid="trace-minimap"
      data-partial={partial ? 'true' : 'false'}
    >
      {buckets.map((bucket) => (
        <span
          key={bucket.id}
          className={bucket.error ? 'has-error' : ''}
          data-testid="trace-minimap-bucket"
          data-count={bucket.count}
          data-error={bucket.error ? 'true' : 'false'}
          aria-hidden="true"
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

function GroupSummary({ groups }: { groups: readonly TraceWaterfallGroup[] }) {
  const visible = groups.slice(0, MAX_VISIBLE_GROUPS);
  return (
    <section className="ns-waterfall-groups" aria-label="Loaded span group aggregates">
      {visible.map((group) => (
        <article key={group.key} data-testid="trace-group-summary" data-group={group.key}>
          <strong>{group.label}</strong>
          <span>
            {group.spanCount} span{group.spanCount === 1 ? '' : 's'} · {group.errorCount} error
            {group.errorCount === 1 ? '' : 's'}
          </span>
          <small>
            {formatDuration(group.durationMs)} span time · {formatCost(group.costMicroUsd)}
          </small>
        </article>
      ))}
      {groups.length > visible.length ? (
        <p>{groups.length - visible.length} additional loaded groups omitted from this summary.</p>
      ) : null}
    </section>
  );
}

export type TraceTreeKeyboardAction =
  | { type: 'select'; spanId: string; index: number }
  | { type: 'toggle'; spanId: string }
  | { type: 'none' };

export function traceTreeKeyboardAction(
  rows: readonly TraceWaterfallRow[],
  selectedSpanId: string | null,
  key: string,
  collapsed: ReadonlySet<string>,
): TraceTreeKeyboardAction {
  if (rows.length === 0) return { type: 'none' };
  const currentIndex = Math.max(
    0,
    rows.findIndex((row) => row.span.spanId === selectedSpanId),
  );
  const current = rows[currentIndex] ?? rows[0];
  if (!current) return { type: 'none' };
  const first = rows.at(0) ?? current;

  if (key === 'ArrowDown') {
    const index = Math.min(rows.length - 1, currentIndex + 1);
    return { type: 'select', spanId: rows[index]?.span.spanId ?? current.span.spanId, index };
  }
  if (key === 'ArrowUp') {
    const index = Math.max(0, currentIndex - 1);
    return { type: 'select', spanId: rows[index]?.span.spanId ?? current.span.spanId, index };
  }
  if (key === 'Home') return { type: 'select', spanId: first.span.spanId, index: 0 };
  if (key === 'End') {
    const index = rows.length - 1;
    const last = rows.at(-1) ?? current;
    return { type: 'select', spanId: last.span.spanId, index };
  }
  if (key === 'ArrowRight') {
    if (current.childCount > 0 && collapsed.has(current.span.spanId)) {
      return { type: 'toggle', spanId: current.span.spanId };
    }
    const child = rows[currentIndex + 1];
    if (child && child.depth > current.depth) {
      return { type: 'select', spanId: child.span.spanId, index: currentIndex + 1 };
    }
  }
  if (key === 'ArrowLeft') {
    if (current.childCount > 0 && !collapsed.has(current.span.spanId)) {
      return { type: 'toggle', spanId: current.span.spanId };
    }
    if (current.span.parentSpanId) {
      const index = rows.findIndex((row) => row.span.spanId === current.span.parentSpanId);
      const parent = rows[index];
      if (index >= 0 && parent) {
        return { type: 'select', spanId: parent.span.spanId, index };
      }
    }
  }
  return { type: 'none' };
}

function traceRowDomId(spanId: string): string {
  return `trace-span-${spanId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

interface O11yRowProps {
  index: number;
  mode?: 'virtualized' | 'tree';
  rowBySpanId: ReadonlyMap<string, TraceWaterfallRow>;
  eventsBySpan: ReadonlyMap<string, readonly NodeSlideAgentEvent[]>;
  selectedSpanId: string | null;
  collapsed: ReadonlySet<string>;
  rangeStart: number;
  rangeEnd: number;
  onSelect: (spanId: string) => void;
  onToggle: (spanId: string) => void;
}

function O11ySpanRow({
  index,
  mode = 'virtualized',
  rowBySpanId,
  eventsBySpan,
  selectedSpanId,
  collapsed,
  rangeStart,
  rangeEnd,
  onSelect,
  onToggle,
}: O11yRowProps) {
  const o11ySpan = useAuiState((state) => state.span);
  const row = rowBySpanId.get(o11ySpan.id);
  if (!row) return null;
  const sourceSpan = row.span;
  const Icon = spanIcon(sourceSpan);
  const allEvents = [...(eventsBySpan.get(sourceSpan.spanId) ?? [])].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
  const visibleEvents = allEvents.slice(-MAX_EVENT_MARKERS);
  const hiddenEventCount = allEvents.length - visibleEvents.length;
  const rangeDuration = Math.max(1, rangeEnd - rangeStart);
  const isCollapsed = mode === 'tree' ? o11ySpan.isCollapsed : collapsed.has(sourceSpan.spanId);
  const timing = spanTimingState(sourceSpan);
  const tickLeft = Math.max(
    0,
    Math.min(100, ((sourceSpan.startTime - rangeStart) / rangeDuration) * 100),
  );

  return (
    <SpanPrimitive.Root
      id={traceRowDomId(sourceSpan.spanId)}
      className={`ns-waterfall-row is-${spanTone(sourceSpan)} ${mode === 'tree' ? 'is-o11y-tree' : 'is-virtualized'} ${selectedSpanId === sourceSpan.spanId ? 'is-selected' : ''}`}
      {...(mode === 'virtualized' ? { style: { top: index * ROW_HEIGHT } } : {})}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selectedSpanId === sourceSpan.spanId}
      aria-label={`${sourceSpan.name}, ${row.groupLabel ? `${row.groupLabel} group, ` : ''}${humanize(sourceSpan.status)}, ${formatSpanDuration(sourceSpan)}`}
      {...(row.childCount > 0 ? { 'aria-expanded': !isCollapsed } : {})}
      {...(row.groupKey ? { 'data-group': row.groupKey } : {})}
      data-tree-collapsed={isCollapsed ? 'true' : 'false'}
      data-testid="trace-waterfall-row"
      data-source-count={sourceSpan.sourceIds?.length ?? 0}
      onClick={() => onSelect(sourceSpan.spanId)}
    >
      <SpanPrimitive.Indent className="ns-waterfall-label" baseIndent={8} indentPerLevel={13}>
        {o11ySpan.hasChildren ? (
          mode === 'tree' ? (
            <SpanPrimitive.CollapseToggle
              tabIndex={-1}
              className="ns-waterfall-disclosure"
              aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${sourceSpan.name}`}
              aria-expanded={!isCollapsed}
              onClick={() => onSelect(sourceSpan.spanId)}
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </SpanPrimitive.CollapseToggle>
          ) : (
            <button
              type="button"
              tabIndex={-1}
              className="ns-waterfall-disclosure"
              aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${sourceSpan.name}`}
              aria-expanded={!isCollapsed}
              data-collapsed={isCollapsed ? 'true' : 'false'}
              onClick={(event) => {
                event.stopPropagation();
                onToggle(sourceSpan.spanId);
              }}
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
          )
        ) : (
          <span className="ns-waterfall-disclosure" />
        )}
        <button
          type="button"
          tabIndex={-1}
          className="ns-waterfall-label-main"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(sourceSpan.spanId);
          }}
        >
          <SpanPrimitive.StatusIndicator className="ns-o11y-status" />
          <SpanPrimitive.TypeBadge
            className="ns-o11y-type"
            aria-label={`${spanTone(sourceSpan)} span`}
          >
            <Icon size={12} />
          </SpanPrimitive.TypeBadge>
          <span>
            <SpanPrimitive.Name className="ns-o11y-name" />
            <small>
              {row.groupLabel ? `${row.groupLabel} · ` : ''}
              {sourceSpan.toolName ?? sourceSpan.operationName}
            </small>
          </span>
        </button>
      </SpanPrimitive.Indent>
      <button
        type="button"
        tabIndex={-1}
        className="ns-waterfall-track"
        onClick={(event) => {
          event.stopPropagation();
          onSelect(sourceSpan.spanId);
        }}
        aria-label={`${sourceSpan.name}, ${formatSpanDuration(sourceSpan)}`}
      >
        {timing === 'unknown' ? (
          <span
            className="ns-waterfall-bar"
            data-timing="unknown"
            data-span-type={spanTone(sourceSpan)}
            style={{ left: `${tickLeft}%` }}
            title="Completed span; duration was not recorded"
          />
        ) : (
          <SpanPrimitive.TimelineBar
            className="ns-waterfall-bar"
            now={rangeEnd}
            data-timing={timing}
          />
        )}
        {visibleEvents.map((event) => (
          <i
            key={event.id}
            className={`ns-waterfall-event is-${event.severity}`}
            title={`${event.name}: ${event.body}`}
            style={{
              left: `${Math.max(0, Math.min(100, ((event.timestamp - rangeStart) / rangeDuration) * 100))}%`,
            }}
          />
        ))}
        {hiddenEventCount > 0 ? (
          <i
            className="ns-waterfall-event is-overflow"
            title={`${hiddenEventCount} additional events are available in span details`}
            style={{ left: '100%' }}
          />
        ) : null}
      </button>
      <time dateTime={new Date(sourceSpan.startTime).toISOString()}>
        {formatSpanDuration(sourceSpan)}
      </time>
    </SpanPrimitive.Root>
  );
}

interface O11yTreeContextValue {
  rowBySpanId: ReadonlyMap<string, TraceWaterfallRow>;
  eventsBySpan: ReadonlyMap<string, readonly NodeSlideAgentEvent[]>;
  selectedSpanId: string | null;
  rangeStart: number;
  rangeEnd: number;
  onSelect: (spanId: string) => void;
}

const O11yTreeContext = createContext<O11yTreeContextValue | null>(null);
const NO_COLLAPSED_SPANS = new Set<string>();

function RecursiveO11ySpanRow() {
  const context = useContext(O11yTreeContext);
  if (!context) throw new Error('Recursive trace row requires an observability tree context.');
  return (
    <>
      <O11ySpanRow
        index={0}
        mode="tree"
        rowBySpanId={context.rowBySpanId}
        eventsBySpan={context.eventsBySpan}
        selectedSpanId={context.selectedSpanId}
        collapsed={NO_COLLAPSED_SPANS}
        rangeStart={context.rangeStart}
        rangeEnd={context.rangeEnd}
        onSelect={context.onSelect}
        onToggle={context.onSelect}
      />
      <SpanPrimitive.Children components={RECURSIVE_O11Y_COMPONENTS} />
    </>
  );
}

const RECURSIVE_O11Y_COMPONENTS = { Span: RecursiveO11ySpanRow } as const;

function VirtualizedO11yRows({
  rows,
  scrollTop,
  viewportHeight,
  ...rowProps
}: Omit<O11yRowProps, 'index' | 'rowBySpanId'> & {
  rows: readonly TraceWaterfallRow[];
  scrollTop: number;
  viewportHeight: number;
}) {
  const visibleCount = useAuiState((state) => state.span.children.length);
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    visibleCount,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const rowBySpanId = useMemo(() => new Map(rows.map((row) => [row.span.spanId, row])), [rows]);
  return (
    <div className="ns-waterfall-rows" style={{ height: visibleCount * ROW_HEIGHT }}>
      {Array.from({ length: Math.max(0, endIndex - startIndex) }, (_, offset) => {
        const index = startIndex + offset;
        const row = rows[index];
        return (
          <SpanByIndexProvider key={row?.span.spanId ?? index} index={index}>
            <O11ySpanRow index={index} rowBySpanId={rowBySpanId} {...rowProps} />
          </SpanByIndexProvider>
        );
      })}
    </div>
  );
}

interface O11ySpanTimelineProps {
  rows: readonly TraceWaterfallRow[];
  rangeStart: number;
  rangeEnd: number;
  scrollTop: number;
  viewportHeight: number;
  eventsBySpan: ReadonlyMap<string, readonly NodeSlideAgentEvent[]>;
  selectedSpanId: string | null;
  collapsed: ReadonlySet<string>;
  onSelect: (spanId: string) => void;
  onToggle: (spanId: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  flatten: boolean;
}

function spanResourceKey(spans: readonly { id: string }[]): string {
  return spans.map((span) => span.id).join('\u001f');
}

function O11ySpanTimeline(props: O11ySpanTimelineProps) {
  const resourceKey = spanResourceKey(props.rows.map((row) => row.span));
  return <O11ySpanTimelineResource key={resourceKey} {...props} />;
}

function O11ySpanTimelineResource({
  rows,
  rangeStart,
  rangeEnd,
  scrollTop,
  viewportHeight,
  eventsBySpan,
  selectedSpanId,
  collapsed,
  onSelect,
  onToggle,
  onKeyDown,
  flatten,
}: O11ySpanTimelineProps) {
  const useRecursiveTree = !flatten && rows.length <= MAX_RECURSIVE_O11Y_SPANS;
  const o11ySpans = useMemo(() => {
    const adapted = toO11ySpans(rows.map((row) => row.span));
    return flatten || !useRecursiveTree
      ? adapted.map((span) => ({ ...span, parentSpanId: null }))
      : adapted;
  }, [flatten, rows, useRecursiveTree]);
  const aui = useAui({ span: SpanResource({ spans: o11ySpans }) }, { parent: null });
  const rowBySpanId = useMemo(
    () => new Map(rows.map((row) => [row.span.spanId, row] as const)),
    [rows],
  );

  return (
    <AuiProvider value={aui}>
      <SpanPrimitive.Timeline
        className="ns-o11y-timeline"
        timeRange={{ min: rangeStart, max: rangeEnd }}
        role="tree"
        tabIndex={0}
        aria-label="Trace span waterfall. Use Up and Down to move; Left and Right to collapse or expand."
        {...(selectedSpanId ? { 'aria-activedescendant': traceRowDomId(selectedSpanId) } : {})}
        data-observability-primitives="assistant-ui-react-o11y"
        onKeyDown={onKeyDown}
      >
        {useRecursiveTree ? (
          <O11yTreeContext.Provider
            value={{
              rowBySpanId,
              eventsBySpan,
              selectedSpanId,
              rangeStart,
              rangeEnd,
              onSelect,
            }}
          >
            <div className="ns-waterfall-rows is-o11y-tree" data-testid="trace-o11y-tree">
              <SpanPrimitive.Children components={RECURSIVE_O11Y_COMPONENTS} />
            </div>
          </O11yTreeContext.Provider>
        ) : (
          <VirtualizedO11yRows
            rows={rows}
            scrollTop={scrollTop}
            viewportHeight={viewportHeight}
            eventsBySpan={eventsBySpan}
            selectedSpanId={selectedSpanId}
            collapsed={collapsed}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        )}
      </SpanPrimitive.Timeline>
    </AuiProvider>
  );
}

function CompactO11yActivity({ spans }: { spans: readonly NodeSlideAgentSpan[] }) {
  return <CompactO11yActivityResource key={spanResourceKey(spans)} spans={spans} />;
}

function CompactO11yActivityResource({ spans }: { spans: readonly NodeSlideAgentSpan[] }) {
  const o11ySpans = useMemo(
    () => toO11ySpans(spans).map((span) => ({ ...span, parentSpanId: null })),
    [spans],
  );
  const aui = useAui({ span: SpanResource({ spans: o11ySpans }) }, { parent: null });

  return (
    <AuiProvider value={aui}>
      <ol
        aria-label="Latest trace activity"
        data-observability-primitives="assistant-ui-react-o11y"
      >
        {spans.map((span, index) => {
          const Icon = spanIcon(span);
          const memoryCount = spanMemoryCount(span);
          return (
            <li
              key={span.id}
              className={`is-${spanTone(span)}`}
              data-testid="trace-activity-row"
              aria-label={`${span.name}, ${humanize(span.status)}, ${formatSpanDuration(span)}`}
            >
              <SpanByIndexProvider index={index}>
                <SpanPrimitive.Root className="ns-trace-o11y-compact-row">
                  <SpanPrimitive.TypeBadge className="ns-trace-activity-icon">
                    <SpanPrimitive.StatusIndicator className="ns-o11y-status" />
                    <Icon size={12} />
                  </SpanPrimitive.TypeBadge>
                  <div>
                    <SpanPrimitive.Name className="ns-o11y-name" />
                    <small>{span.toolName ?? span.operationName}</small>
                  </div>
                  <time dateTime={new Date(span.startTime).toISOString()}>
                    {formatSpanDuration(span)}
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
                </SpanPrimitive.Root>
              </SpanByIndexProvider>
            </li>
          );
        })}
      </ol>
    </AuiProvider>
  );
}

function formatInteger(value: number | undefined): string {
  return value === undefined ? 'not recorded' : new Intl.NumberFormat().format(value);
}

function formatCost(value: number | undefined): string {
  if (value === undefined) return 'not recorded';
  if (value === 0) return '$0.0000';
  const exactDollars = (value / 1_000_000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `$${exactDollars}`;
}

function shortDigest(value: string): string {
  return value.length <= 24 ? value : `${value.slice(0, 14)}…${value.slice(-7)}`;
}

function TraceProofStrip({
  proof,
  compact = false,
}: {
  proof: ReturnType<typeof traceProofSummary>;
  compact?: boolean;
}) {
  return (
    <dl
      className={`ns-waterfall-proof ${compact ? 'is-compact' : ''}`}
      aria-label="Model and receipt accounting"
      data-testid="trace-proof-summary"
    >
      <div>
        <dt>Route</dt>
        <dd title={`${proof.provider} · ${proof.model}`}>
          {proof.provider} · {proof.model}
        </dd>
      </div>
      {!compact ? (
        <div>
          <dt>Effort</dt>
          <dd>{proof.effort ?? 'not recorded'}</dd>
        </div>
      ) : null}
      <div>
        <dt>Tokens</dt>
        <dd>
          {formatInteger(proof.inputTokens)} in · {formatInteger(proof.outputTokens)} out
          {proof.accountingScope === 'loaded spans' ? <small>loaded spans</small> : null}
        </dd>
      </div>
      <div>
        <dt>Cost</dt>
        <dd>
          {formatCost(proof.costMicroUsd)}
          {proof.accountingScope === 'loaded spans' ? <small>loaded spans</small> : null}
        </dd>
      </div>
      <div>
        <dt>{proof.digestLabel ? `${proof.digestLabel} digest` : 'Digest'}</dt>
        <dd>
          {proof.digest ? (
            <code title={proof.digest}>{shortDigest(proof.digest)}</code>
          ) : (
            'not recorded'
          )}
        </dd>
      </div>
    </dl>
  );
}

export function TraceWaterfall(props: TraceWaterfallProps) {
  return <TraceWaterfallRun key={props.run.id} {...props} />;
}

function TraceWaterfallRun({
  run,
  trace,
  telemetry,
  messages,
  sources,
  evidenceCaptures = [],
  loadingMore = false,
  loadError,
  compact = false,
  onExpand,
  onLoadMore,
  onLoadEvidenceCapture,
}: TraceWaterfallProps) {
  const [filter, setFilter] = useState<WaterfallFilter>('all');
  const [query, setQuery] = useState('');
  const [grouping, setGrouping] = useState<WaterfallGrouping>('trace');
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    defaultCollapsedSpanIds(telemetry.spans),
  );
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(430);
  const [expandedEventsFor, setExpandedEventsFor] = useState<string | null>(null);
  const [expandedAttributesFor, setExpandedAttributesFor] = useState<string | null>(null);
  const [expandedEvidenceFor, setExpandedEvidenceFor] = useState<string | null>(null);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [captureDetail, setCaptureDetail] = useState<NodeSlideEvidenceCaptureDetail | null>(null);
  const [captureLoading, setCaptureLoading] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const captureRequestSequence = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const spans = useMemo(
    () => [...telemetry.spans].sort((left, right) => left.startTime - right.startTime),
    [telemetry.spans],
  );
  const hasActiveFilter = filter !== 'all' || Boolean(query.trim());
  const usesRecursiveO11yTree =
    !hasActiveFilter && grouping === 'trace' && spans.length <= MAX_RECURSIVE_O11Y_SPANS;
  const effectiveCollapsed = useMemo(
    () =>
      hasActiveFilter || grouping !== 'trace' || usesRecursiveO11yTree
        ? new Set<string>()
        : collapsed,
    [collapsed, grouping, hasActiveFilter, usesRecursiveO11yTree],
  );
  const rows = useMemo(
    () => buildGroupedWaterfallRows(spans, grouping, effectiveCollapsed, filter, query),
    [effectiveCollapsed, filter, grouping, query, spans],
  );
  const matchingSpans = useMemo(
    () => spans.filter((span) => spanMatches(span, filter, query.trim())),
    [filter, query, spans],
  );
  const groups = useMemo(
    () => (grouping === 'trace' ? [] : buildWaterfallGroups(matchingSpans, grouping)),
    [grouping, matchingSpans],
  );
  const collapsibleIds = useMemo(() => collapsibleSpanIds(spans), [spans]);
  const metrics = useMemo(
    () =>
      traceWindowMetrics(run, spans, telemetry.events, telemetry.totalRecorded, telemetry.hasMore),
    [run, spans, telemetry.events, telemetry.hasMore, telemetry.totalRecorded],
  );
  const proof = useMemo(() => traceProofSummary(run, spans, trace), [run, spans, trace]);
  const rangeStart = metrics.rangeStart;
  const rangeEnd = metrics.rangeEnd;
  const rangeDuration = Math.max(1, rangeEnd - rangeStart);
  const selected = rows.find((row) => row.span.spanId === selectedSpanId)?.span ?? rows[0]?.span;
  const persistedSelected = selectedSpanId
    ? spans.find((span) => span.spanId === selectedSpanId)
    : undefined;
  const selectedEnd = selected ? spanEndTime(selected) : undefined;
  const eventsBySpan = useMemo(() => {
    const map = new Map<string, NodeSlideAgentEvent[]>();
    for (const event of telemetry.events) {
      const bucket = map.get(event.spanId) ?? [];
      bucket.push(event);
      map.set(event.spanId, bucket);
    }
    return map;
  }, [telemetry.events]);

  useEffect(() => {
    if (compact) return;
    const element = scrollRef.current;
    if (!element) return;
    const maximum = Math.max(0, rows.length * ROW_HEIGHT - element.clientHeight);
    const restored = Math.min(scrollTop, maximum);
    if (Math.abs(element.scrollTop - restored) > 1) element.scrollTop = restored;
    if (restored !== scrollTop) setScrollTop(restored);
    setViewportHeight(element.clientHeight || 430);
  }, [compact, rows.length, scrollTop]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
    setViewportHeight(event.currentTarget.clientHeight);
  };
  const toggleSpan = (spanId: string) => {
    if (hasActiveFilter || grouping !== 'trace') return;
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
    setSelectedSpanId(spanId);
  };
  const ensureRowVisible = (index: number) => {
    const element = scrollRef.current;
    if (!element) return;
    const top = index * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (bottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = Math.max(0, bottom - element.clientHeight);
    }
  };
  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (grouping !== 'trace' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return;
    const action = traceTreeKeyboardAction(
      rows,
      selected?.spanId ?? null,
      event.key,
      effectiveCollapsed,
    );
    if (action.type === 'none' || (action.type === 'toggle' && hasActiveFilter)) return;
    event.preventDefault();
    if (action.type === 'toggle') toggleSpan(action.spanId);
    else {
      setSelectedSpanId(action.spanId);
      ensureRowVisible(action.index);
    }
  };

  const runMessages = messages.filter((message) => message.runId === run.id);
  const exactSourceIds = selected?.sourceIds ?? [];
  const legacySourceIds = exactSourceIds.length
    ? []
    : [...new Set(runMessages.flatMap((message) => message.sourceIds ?? []))];
  const evidenceMode = exactSourceIds.length ? 'span' : legacySourceIds.length ? 'run' : 'none';
  const evidenceIds = exactSourceIds.length ? exactSourceIds : legacySourceIds;
  const showAllEvidence = expandedEvidenceFor === selected?.spanId;
  const visibleEvidenceIds = showAllEvidence
    ? evidenceIds
    : evidenceIds.slice(0, MAX_VISIBLE_EVIDENCE);
  const evidence = visibleEvidenceIds
    .map((id) => sources.find((source) => source.id === id))
    .filter((source): source is SourceRecord => Boolean(source));
  const resolvedEvidenceIds = new Set(evidence.map((source) => source.id));
  const missingEvidenceIds = visibleEvidenceIds.filter((id) => !resolvedEvidenceIds.has(id));
  const hiddenEvidenceCount = Math.max(0, evidenceIds.length - visibleEvidenceIds.length);
  const selectedCaptures = selected
    ? evidenceCaptures.filter(
        (capture) =>
          capture.runId === run.id &&
          (capture.spanId === selected.spanId || capture.parentSpanId === selected.spanId),
      )
    : [];
  const claimBindingsBySource = useMemo(() => {
    const bindings = new Map<
      string,
      Array<NonNullable<AgentTrace['claimSourceBindings']>[number]>
    >();
    for (const binding of trace?.claimSourceBindings ?? []) {
      for (const sourceId of binding.sourceIds) {
        const bucket = bindings.get(sourceId) ?? [];
        bucket.push(binding);
        bindings.set(sourceId, bucket);
      }
    }
    return bindings;
  }, [trace?.claimSourceBindings]);
  const selectedEvents = selected ? (eventsBySpan.get(selected.spanId) ?? []) : [];
  const showAllEvents = expandedEventsFor === selected?.spanId;
  const showAllAttributes = expandedAttributesFor === selected?.spanId;
  const visibleSelectedEvents = showAllEvents
    ? selectedEvents
    : selectedEvents.slice(0, MAX_VISIBLE_EVENTS);
  const visibleSelectedAttributes = showAllAttributes
    ? (selected?.attributes ?? [])
    : (selected?.attributes.slice(0, MAX_VISIBLE_ATTRIBUTES) ?? []);
  const selectedEffort = selected?.attributes.find((attribute) =>
    /reasoning[._-]?effort/i.test(attribute.key),
  )?.value;
  const selectedDigestAttributes =
    selected?.attributes.filter((attribute) => /digest|receipt/i.test(attribute.key)) ?? [];
  const activeSelectedSpanId = selected?.spanId;

  useEffect(() => {
    // Reset lazy evidence whenever the active waterfall row changes.
    void activeSelectedSpanId;
    captureRequestSequence.current += 1;
    setSelectedCaptureId(null);
    setCaptureDetail(null);
    setCaptureError(null);
    setCaptureLoading(false);
    return () => {
      captureRequestSequence.current += 1;
    };
  }, [activeSelectedSpanId]);

  const openEvidenceCapture = async (capture: NodeSlideEvidenceCaptureSummary) => {
    const requestSequence = ++captureRequestSequence.current;
    setSelectedCaptureId(capture.id);
    setCaptureDetail(null);
    setCaptureError(null);
    if (!onLoadEvidenceCapture) {
      setCaptureError('Visual evidence detail loading is unavailable.');
      return;
    }
    setCaptureLoading(true);
    try {
      const detail = await onLoadEvidenceCapture(capture.id);
      if (requestSequence !== captureRequestSequence.current) return;
      if (!detail) setCaptureError('This visual evidence record is no longer available.');
      else setCaptureDetail(detail);
    } catch (error) {
      if (requestSequence !== captureRequestSequence.current) return;
      setCaptureError(
        error instanceof Error ? error.message : 'Visual evidence could not be loaded.',
      );
    } finally {
      if (requestSequence === captureRequestSequence.current) setCaptureLoading(false);
    }
  };

  if (compact) {
    const orderedSpans = [...spans].sort((left, right) => left.sequence - right.sequence);
    const compactSpans = (
      orderedSpans.length <= MAX_COMPACT_SPANS
        ? orderedSpans
        : [orderedSpans[0], ...orderedSpans.slice(-(MAX_COMPACT_SPANS - 1))].filter(
            (span): span is NodeSlideAgentSpan => Boolean(span),
          )
    ).sort((left, right) => left.startTime - right.startTime || left.sequence - right.sequence);
    const hiddenCount = Math.max(0, orderedSpans.length - compactSpans.length);
    const errorCount = spans.filter((span) => span.status === 'error').length;
    const citedCount = spans.filter((span) => span.sourceIds?.length).length;

    return (
      <section
        className="ns-trace-activity-compact"
        data-testid="trace-waterfall"
        data-bounded="true"
        data-rendered-spans={compactSpans.length}
        data-total-spans={spans.length}
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
            <b>{metrics.loadedRecordCount}</b> loaded
          </span>
          <span className={errorCount ? 'has-error' : ''}>
            <b>{errorCount}</b> errors
          </span>
          <span>
            <b>{citedCount}</b> cited
          </span>
        </div>

        <TraceProofStrip proof={proof} compact />
        {compactSpans.length > 0 ? (
          <CompactO11yActivity spans={compactSpans} />
        ) : (
          <p className="ns-trace-activity-empty">
            No recorded spans. NodeSlide does not synthesize activity or timing.
          </p>
        )}

        {persistedSelected ? (
          <div className="ns-trace-compact-selection" data-testid="trace-compact-selection">
            <span>Selected span</span>
            <strong>{persistedSelected.name}</strong>
            <code>{persistedSelected.spanId}</code>
            <small>
              {formatSpanDuration(persistedSelected)} · started{' '}
              <time dateTime={new Date(persistedSelected.startTime).toISOString()}>
                {formatDateTime(persistedSelected.startTime)}
              </time>
            </small>
          </div>
        ) : null}

        {hiddenCount ? (
          <p className="ns-trace-activity-more">
            {hiddenCount} earlier loaded step{hiddenCount === 1 ? '' : 's'} hidden here; open the
            full timeline to inspect them.
          </p>
        ) : null}
        {telemetry.hasMore ? (
          <p className="ns-trace-activity-more" data-testid="trace-partial-notice">
            {metrics.omittedRecordCount} older record
            {metrics.omittedRecordCount === 1 ? '' : 's'} not loaded. Counts and search cover the
            loaded window only.
          </p>
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
          <span className={`ns-waterfall-status is-${run.status}`} aria-hidden="true" />
          <div>
            <strong>{run.instruction}</strong>
            <small>
              {humanize(run.status)} · {proof.provider} · {proof.model}
            </small>
          </div>
        </div>
        <dl>
          <div>
            <dt>Started</dt>
            <dd>
              <time dateTime={new Date(run.createdAt).toISOString()}>
                {formatDateTime(run.createdAt)}
              </time>
            </dd>
          </div>
          <div>
            <dt>Wall</dt>
            <dd>{formatDuration(metrics.wallDurationMs)}</dd>
          </div>
          <div>
            <dt>Active observed</dt>
            <dd>{formatDuration(metrics.activeDurationMs)}</dd>
          </div>
          <div>
            <dt>Human wait</dt>
            <dd>
              {metrics.humanWaitDurationMs > 0
                ? formatDuration(metrics.humanWaitDurationMs)
                : 'none recorded'}
            </dd>
          </div>
          <div>
            <dt>Records</dt>
            <dd>
              {metrics.loadedRecordCount} of {telemetry.totalRecorded}
            </dd>
          </div>
        </dl>
        <div className="ns-waterfall-run-ids">
          <span>
            Observed through{' '}
            <time dateTime={new Date(metrics.rangeEnd).toISOString()}>
              {formatDateTime(metrics.rangeEnd)}
            </time>
          </span>
          <code title={run.otelTraceId ?? spans[0]?.traceId ?? 'Trace ID not recorded'}>
            {run.otelTraceId ?? spans[0]?.traceId ?? 'trace id not recorded'}
          </code>
        </div>
      </header>

      <TraceProofStrip proof={proof} />

      {!metrics.isComplete ? (
        <p className="ns-waterfall-partial" data-testid="trace-partial-notice">
          Partial loaded window: {metrics.loadedRecordCount} of {telemetry.totalRecorded} records.
          Search, filters, metrics, and the minimap cover loaded records only;{' '}
          {metrics.omittedRecordCount} older record
          {metrics.omittedRecordCount === 1 ? '' : 's'} remain available by cursor.
        </p>
      ) : (
        <p className="ns-waterfall-complete" data-testid="trace-complete-notice">
          Complete loaded trace · {metrics.loadedRecordCount} records
        </p>
      )}

      <div className="ns-waterfall-toolbar">
        <label>
          <Search size={13} />
          <input
            type="search"
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
        <div className="ns-waterfall-grouping">
          <span id="ns-waterfall-grouping-label">Group</span>
          <Select
            value={grouping}
            onValueChange={(value) => setGrouping(value as WaterfallGrouping)}
          >
            <SelectTrigger aria-label="Group trace spans" data-value={grouping}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="trace">Trace hierarchy</SelectItem>
              <SelectItem value="service">Service</SelectItem>
              <SelectItem value="type">Span type</SelectItem>
              <SelectItem value="status">Status</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="ns-waterfall-tree-actions" aria-label="Trace tree controls">
          <button
            type="button"
            disabled={grouping !== 'trace' || hasActiveFilter || collapsibleIds.size === 0}
            onClick={() => {
              setCollapsed(new Set(collapsibleIds));
              setSelectedSpanId(rows[0]?.span.spanId ?? null);
              setScrollTop(0);
              if (scrollRef.current) scrollRef.current.scrollTop = 0;
            }}
          >
            Collapse all
          </button>
          <button
            type="button"
            disabled={grouping !== 'trace' || hasActiveFilter || collapsed.size === 0}
            title="Rows remain virtualized while loaded subtrees expand"
            onClick={() => setCollapsed(new Set())}
          >
            Expand loaded
          </button>
        </div>
        <output aria-live="polite">
          {rows.length} of {spans.length} loaded spans visible
          {grouping !== 'trace' ? ` · grouped by ${grouping}` : ''}
          {hasActiveFilter ? ' · matching branches temporarily expanded' : ''}
        </output>
      </div>

      {grouping !== 'trace' ? <GroupSummary groups={groups} /> : null}
      <MiniMap
        spans={spans}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        partial={!metrics.isComplete}
      />
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
        ref={scrollRef}
        className="ns-waterfall-scroll"
        onScroll={onScroll}
        style={{ height: rows.length === 0 ? 0 : Math.min(430, rows.length * ROW_HEIGHT) }}
      >
        <O11ySpanTimeline
          rows={rows}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          scrollTop={scrollTop}
          viewportHeight={viewportHeight}
          eventsBySpan={eventsBySpan}
          selectedSpanId={selected?.spanId ?? null}
          collapsed={effectiveCollapsed}
          onSelect={setSelectedSpanId}
          onToggle={toggleSpan}
          onKeyDown={onTreeKeyDown}
          flatten={grouping !== 'trace' || hasActiveFilter}
        />
      </div>

      {rows.length === 0 ? (
        <div className="ns-waterfall-empty">
          {spans.length === 0
            ? 'No recorded spans. Timing is not synthesized.'
            : 'No spans match this loaded-window filter.'}
        </div>
      ) : null}

      {telemetry.hasMore ? (
        <button
          type="button"
          className="ns-waterfall-load"
          data-testid="trace-load-more"
          disabled={loadingMore || !telemetry.nextBeforeSequence || !onLoadMore}
          onClick={() => {
            if (telemetry.nextBeforeSequence && onLoadMore) {
              void onLoadMore(run.id, telemetry.nextBeforeSequence);
            }
          }}
        >
          {loadingMore
            ? 'Loading older spans…'
            : !telemetry.nextBeforeSequence
              ? 'Older records exist, but the server cursor was not recorded'
              : !onLoadMore
                ? 'Older records exist, but loading is unavailable'
                : `Load older records · ${metrics.loadedRecordCount} of ${telemetry.totalRecorded}`}
        </button>
      ) : null}
      {loadError ? (
        <p className="ns-waterfall-error">Could not load older telemetry: {loadError}</p>
      ) : null}

      {selected ? (
        <aside
          className="ns-waterfall-detail"
          aria-label={`Selected span: ${selected.name}`}
          data-testid="trace-selected-span"
        >
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
            <code title={`trace ${selected.traceId}`}>{selected.spanId}</code>
          </header>
          <div className="ns-waterfall-detail-grid">
            <section>
              <h3>Span</h3>
              <dl>
                <div>
                  <dt>Started</dt>
                  <dd>
                    <time dateTime={new Date(selected.startTime).toISOString()}>
                      {formatDateTime(selected.startTime)}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt>Ended</dt>
                  <dd>
                    {selectedEnd !== undefined ? (
                      <time dateTime={new Date(selectedEnd).toISOString()}>
                        {formatDateTime(selectedEnd)}
                      </time>
                    ) : spanTimingState(selected) === 'open' ? (
                      'open at last server checkpoint'
                    ) : (
                      'not recorded'
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{formatSpanDuration(selected)}</dd>
                </div>
                <div>
                  <dt>Provider</dt>
                  <dd>{selected.provider ?? 'not recorded'}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{selected.model ?? 'not recorded'}</dd>
                </div>
                <div>
                  <dt>Effort</dt>
                  <dd>{selectedEffort === undefined ? 'not recorded' : String(selectedEffort)}</dd>
                </div>
                {selected.toolName ? (
                  <div>
                    <dt>Tool</dt>
                    <dd>{selected.toolName}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Cost</dt>
                  <dd>{formatCost(selected.costMicroUsd)}</dd>
                </div>
                <div>
                  <dt>Tokens</dt>
                  <dd>
                    {formatInteger(selected.inputTokens)} in ·{' '}
                    {formatInteger(selected.outputTokens)} out
                  </dd>
                </div>
                <div>
                  <dt>Digest / receipt</dt>
                  <dd>
                    {selectedDigestAttributes.length > 0
                      ? selectedDigestAttributes
                          .map((attribute) => `${attribute.key}=${String(attribute.value)}`)
                          .join(' · ')
                      : 'not recorded on span'}
                  </dd>
                </div>
                <div>
                  <dt>Trace / parent</dt>
                  <dd>
                    <code>{selected.traceId}</code>
                    {' · '}
                    <code>{selected.parentSpanId ?? 'root'}</code>
                  </dd>
                </div>
              </dl>
            </section>
            <section>
              <h3>Events & attributes</h3>
              {selectedEvents.length ? (
                <ul>
                  {visibleSelectedEvents.map((event) => (
                    <li key={event.id}>
                      <b>{event.name}</b>
                      <span>{event.body}</span>
                    </li>
                  ))}
                  {selectedEvents.length > visibleSelectedEvents.length ? (
                    <li>
                      <b>Bounded view</b>
                      <button type="button" onClick={() => setExpandedEventsFor(selected.spanId)}>
                        Show {selectedEvents.length - visibleSelectedEvents.length} more loaded
                        events
                      </button>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p>No events on this span.</p>
              )}
              {selected.attributes.length ? (
                <Collapsible>
                  <CollapsibleTrigger>{selected.attributes.length} attributes</CollapsibleTrigger>
                  <CollapsibleContent>
                    <dl>
                      {visibleSelectedAttributes.map((attribute) => (
                        <div key={attribute.key}>
                          <dt>{attribute.key}</dt>
                          <dd>{String(attribute.value)}</dd>
                        </div>
                      ))}
                    </dl>
                    {selected.attributes.length > visibleSelectedAttributes.length ? (
                      <button
                        type="button"
                        onClick={() => setExpandedAttributesFor(selected.spanId)}
                      >
                        Show {selected.attributes.length - visibleSelectedAttributes.length} more
                        loaded attributes
                      </button>
                    ) : null}
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
            </section>
            <section
              className="ns-waterfall-evidence"
              data-testid="trace-span-evidence"
              data-span-id={selected.spanId}
            >
              <h3>
                {evidenceMode === 'span'
                  ? 'Span evidence'
                  : evidenceMode === 'run'
                    ? 'Run evidence'
                    : 'Evidence'}
                {evidenceMode === 'span' ? <span>{evidenceIds.length} bound</span> : null}
              </h3>
              {evidenceMode === 'span' ? (
                <p className="ns-waterfall-evidence-note">
                  Bound directly to OTel span <code>{selected.spanId}</code>.
                </p>
              ) : null}
              {evidenceMode === 'run' ? (
                <p className="ns-waterfall-evidence-note">
                  Run-level evidence; not span-bound. This span has no stored source binding.
                </p>
              ) : null}
              {missingEvidenceIds.length > 0 ? (
                <p className="ns-waterfall-evidence-missing">
                  {missingEvidenceIds.length} bound source record
                  {missingEvidenceIds.length === 1 ? ' is' : 's are'} unavailable:{' '}
                  <code>{missingEvidenceIds.join(', ')}</code>
                </p>
              ) : null}
              {evidence.length ? (
                evidence.map((source) => (
                  <article
                    key={source.id}
                    data-testid="trace-source-citation"
                    data-source-id={source.id}
                  >
                    <div>
                      <span>{source.url ? <Globe2 size={13} /> : <FileText size={13} />}</span>
                      <div>
                        <strong>{source.title}</strong>
                        <small>
                          {source.sourceType}
                          {source.format ? ` · ${source.format}` : ''} · retrieved{' '}
                          <time dateTime={new Date(source.retrievedAt).toISOString()}>
                            {formatDateTime(source.retrievedAt)}
                          </time>
                        </small>
                        <code>{source.id}</code>
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
                    {source.url ? <p className="ns-waterfall-source-url">{source.url}</p> : null}
                    <p>
                      {source.citation.slice(0, 320)}
                      {source.citation.length > 320 ? '…' : ''}
                    </p>
                    {source.citation.length > 320 ? (
                      <Collapsible className="ns-waterfall-citation-more">
                        <CollapsibleTrigger>
                          Show full citation · {source.citation.length} characters
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <p>{source.citation}</p>
                        </CollapsibleContent>
                      </Collapsible>
                    ) : null}
                    <footer>
                      {source.contentDigest ? (
                        <code title={source.contentDigest}>
                          {shortDigest(source.contentDigest)}
                        </code>
                      ) : (
                        <span>digest not recorded</span>
                      )}
                      {source.rowCount !== undefined ? <span>{source.rowCount} rows</span> : null}
                      {source.columns?.length ? <span>{source.columns.length} columns</span> : null}
                      <ClaimBindingSummary bindings={claimBindingsBySource.get(source.id) ?? []} />
                    </footer>
                  </article>
                ))
              ) : evidenceIds.length === 0 ? (
                <p>No source citation is bound to this span.</p>
              ) : null}
              {hiddenEvidenceCount > 0 ? (
                <button
                  type="button"
                  className="ns-waterfall-evidence-more"
                  onClick={() => setExpandedEvidenceFor(selected.spanId)}
                >
                  Show {hiddenEvidenceCount} more loaded source record
                  {hiddenEvidenceCount === 1 ? '' : 's'}
                </button>
              ) : null}
            </section>
            <EvidenceCapturePanel
              captures={selectedCaptures}
              selectedCaptureId={selectedCaptureId}
              detail={captureDetail}
              loading={captureLoading}
              error={captureError}
              onOpen={openEvidenceCapture}
            />
          </div>
        </aside>
      ) : null}
    </section>
  );
}

function ClaimBindingSummary({
  bindings,
}: {
  bindings: NonNullable<AgentTrace['claimSourceBindings']>;
}) {
  if (bindings.length === 0) return <span>source record only / no claim-output binding</span>;
  return (
    <Collapsible className="ns-waterfall-claim-bindings">
      <CollapsibleTrigger>
        {bindings.length} claim/output binding{bindings.length === 1 ? '' : 's'}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul>
          {bindings.map((binding) => (
            <li key={`${binding.operationIndex}:${binding.elementId}:${binding.claimDigest}`}>
              <span>
                Slide <code>{binding.slideId}</code> / element <code>{binding.elementId}</code>
              </span>
              <code title={binding.claimDigest}>{shortDigest(binding.claimDigest)}</code>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function EvidenceCapturePanel({
  captures,
  selectedCaptureId,
  detail,
  loading,
  error,
  onOpen,
}: {
  captures: readonly NodeSlideEvidenceCaptureSummary[];
  selectedCaptureId: string | null;
  detail: NodeSlideEvidenceCaptureDetail | null;
  loading: boolean;
  error: string | null;
  onOpen: (capture: NodeSlideEvidenceCaptureSummary) => void | Promise<void>;
}) {
  return (
    <section className="ns-waterfall-captures" data-testid="trace-visual-evidence">
      <h3>
        Visual evidence <span>{captures.length}</span>
      </h3>
      {captures.length === 0 ? (
        <p>No screenshot or PDF capture is bound to this span.</p>
      ) : (
        <div className="ns-waterfall-capture-list">
          {captures.map((capture) => (
            <button
              key={capture.id}
              type="button"
              className={selectedCaptureId === capture.id ? 'is-selected' : ''}
              data-status={capture.status}
              aria-pressed={selectedCaptureId === capture.id}
              onClick={() => void onOpen(capture)}
            >
              <span>
                {capture.screenshotCount > 0 ? <ImageIcon size={13} /> : <ScanSearch size={13} />}
              </span>
              <span>
                <strong>{capture.sourceTitle}</strong>
                <small>
                  {capture.status === 'failed'
                    ? 'Capture failed'
                    : capture.status === 'expired'
                      ? 'Attachment expired'
                      : `${capture.screenshotCount} screenshot${capture.screenshotCount === 1 ? '' : 's'} / ${capture.pdfCount} PDF`}
                </small>
              </span>
              <ChevronRight size={13} />
            </button>
          ))}
        </div>
      )}
      {loading ? (
        <p className="ns-waterfall-capture-state">Resolving selected attachment...</p>
      ) : null}
      {error ? <p className="ns-waterfall-capture-error">{error}</p> : null}
      {detail ? <EvidenceCaptureDetail detail={detail} /> : null}
    </section>
  );
}

function EvidenceCaptureDetail({ detail }: { detail: NodeSlideEvidenceCaptureDetail }) {
  return (
    <article className="ns-waterfall-capture-detail" data-testid="trace-evidence-detail">
      <header>
        <div>
          <strong>{detail.sourceTitle}</strong>
          <small>
            {detail.provider} / captured{' '}
            <time dateTime={new Date(detail.createdAt).toISOString()}>
              {formatDateTime(detail.createdAt)}
            </time>
          </small>
        </div>
        <a href={detail.url} target="_blank" rel="noreferrer">
          Open source <ExternalLink size={12} />
        </a>
      </header>
      {detail.status === 'expired' ? (
        <p className="ns-waterfall-capture-error">
          The attachment expired under the evidence retention policy. Its digest and trace binding
          remain available.
        </p>
      ) : null}
      {detail.status === 'failed' ? (
        <p className="ns-waterfall-capture-error">
          {detail.error ?? 'The visual capture failed; the text citation remains available.'}
        </p>
      ) : null}
      {detail.steps.length > 0 ? (
        <div className="ns-waterfall-capture-steps">
          {detail.steps.map((step) => (
            <EvidenceCaptureStep key={step.id} step={step} provider={detail.provider} />
          ))}
        </div>
      ) : (
        <p className="ns-waterfall-capture-state" data-testid="trace-evidence-empty">
          No visual steps were stored. The capture status, digest, and trace binding remain
          available.
        </p>
      )}
      <footer>
        <code title={detail.traceId}>{detail.spanId}</code>
        {detail.contentDigest ? (
          <code title={detail.contentDigest}>{shortDigest(detail.contentDigest)}</code>
        ) : (
          <span>digest not recorded</span>
        )}
      </footer>
    </article>
  );
}

function EvidenceCaptureStep({
  step,
  provider,
}: {
  step: NodeSlideEvidenceStepDetail;
  provider: string;
}) {
  const attachment = step.attachment;
  const screenshotBox =
    attachment?.kind === 'screenshot' && attachment.box && isNormalizedEvidenceBox(attachment.box)
      ? attachment.box
      : null;
  const pdfPage =
    attachment?.kind === 'pdf' ? (attachment.page ?? attachment.box?.page) : undefined;
  const pdfBox =
    attachment?.kind === 'pdf' &&
    attachment.box &&
    isNormalizedEvidenceBox(attachment.box) &&
    Number.isInteger(pdfPage) &&
    Number(pdfPage) > 0 &&
    (attachment.box.page === undefined || attachment.box.page === pdfPage)
      ? attachment.box
      : null;
  const sourceSnapshot = provider === 'nodeslide-source-snapshot/v1';
  const sourceLevelRegion = step.regionScope !== 'claim';
  return (
    <section className="ns-waterfall-capture-step" data-status={step.status}>
      <header>
        <span>{step.sequence}</span>
        <div>
          <strong>{step.label}</strong>
          <small>
            {step.phase} / span <code>{step.spanId}</code>
          </small>
        </div>
      </header>
      {step.detail ? <p>{step.detail}</p> : null}
      {attachment?.kind === 'screenshot' ? (
        <>
          <a
            className="ns-waterfall-shot-link"
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
          >
            <span className="ns-waterfall-shot-frame">
              <img src={attachment.url} alt={`Captured evidence: ${step.label}`} loading="lazy" />
              {screenshotBox ? <EvidenceBoxOverlay box={screenshotBox} /> : null}
            </span>
          </a>
          {screenshotBox ? (
            <p
              className="ns-waterfall-geometry-state"
              data-testid="trace-screenshot-geometry-state"
            >
              {isWholeEvidenceBox(screenshotBox)
                ? sourceLevelRegion
                  ? 'Whole captured screenshot; exact source-level geometry, not a claim-level box.'
                  : 'Whole captured screenshot recorded as claim-level geometry.'
                : sourceLevelRegion
                  ? 'Exact source-level screenshot region; claim-level precision requires a separate claim receipt.'
                  : 'Exact claim-level screenshot region recorded by the capture.'}
            </p>
          ) : null}
        </>
      ) : attachment?.kind === 'pdf' ? (
        <>
          {pdfBox && pdfPage ? (
            <PdfEvidencePreview
              url={attachment.url}
              page={pdfPage}
              box={pdfBox}
              label={`PDF evidence: ${step.label}`}
            />
          ) : (
            <div className="ns-waterfall-pdf-frame" data-region-precision="unavailable">
              <p className="ns-waterfall-capture-state">
                PDF page geometry is unavailable. No region overlay is shown.
              </p>
            </div>
          )}
          <a
            className="ns-waterfall-pdf-link"
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
          >
            Open PDF attachment <ExternalLink size={12} />
          </a>
          <p
            className={`ns-waterfall-geometry-state${pdfBox ? '' : ' is-degraded'}`}
            data-testid="trace-pdf-geometry-state"
          >
            {pdfBox
              ? isWholeEvidenceBox(pdfBox)
                ? sourceLevelRegion
                  ? `Whole rendered PDF page ${pdfPage}; exact source-level geometry, not a claim-level box.`
                  : `Whole rendered PDF page ${pdfPage} recorded as claim-level geometry.`
                : sourceLevelRegion && sourceSnapshot
                  ? `Exact source-snapshot excerpt region on rendered page ${pdfPage}; this is source-level evidence, not a claim-level box.`
                  : sourceLevelRegion
                    ? `Exact source-level region on rendered PDF page ${pdfPage}; claim-level precision requires a separate claim receipt.`
                    : `Exact claim-level region on rendered PDF page ${pdfPage}.`
              : attachment.box
                ? 'Stored PDF coordinates or page metadata are invalid. No region overlay is shown.'
                : 'No exact PDF region was recorded. No region overlay is shown.'}
          </p>
        </>
      ) : (
        <p className="ns-waterfall-capture-state">No visual attachment was stored for this step.</p>
      )}
      {attachment?.kind === 'screenshot' && attachment.box && !screenshotBox ? (
        <p
          className="ns-waterfall-geometry-state is-degraded"
          data-testid="trace-screenshot-geometry-state"
        >
          Stored screenshot coordinates fall outside the normalized image bounds. No region overlay
          is shown.
        </p>
      ) : null}
      {step.quote ? <blockquote>{step.quote}</blockquote> : null}
      {step.selector ? (
        <p>
          Selector <code>{step.selector}</code>
        </p>
      ) : null}
      {step.box ? (
        <small className="ns-waterfall-box-coordinates">
          {sourceLevelRegion ? 'Source region' : 'Claim region'} x {formatDecimal(step.box.x)} / y{' '}
          {formatDecimal(step.box.y)} / w {formatDecimal(step.box.w)} / h{' '}
          {formatDecimal(step.box.h)}
          {step.box.page ? ` / page ${step.box.page}` : ''}
        </small>
      ) : (
        <small className="ns-waterfall-box-coordinates">Exact region not recorded.</small>
      )}
    </section>
  );
}

function EvidenceBoxOverlay({ box }: { box: NodeSlideEvidenceBox }) {
  return (
    <span
      className="ns-waterfall-evidence-box"
      data-testid="trace-screenshot-evidence-box"
      data-region-precision="normalized-image"
      aria-hidden="true"
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
      }}
    />
  );
}

function PdfEvidencePreview(props: PdfEvidencePageProps) {
  const [Renderer, setRenderer] = useState<ComponentType<PdfEvidencePageProps> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setRenderer(null);
    setLoadFailed(false);
    void import('./PdfEvidencePage')
      .then((module) => {
        if (active) setRenderer(() => module.PdfEvidencePage);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);
  if (loadFailed) {
    return (
      <div className="ns-waterfall-pdf-frame" data-region-precision="unavailable">
        <p className="ns-waterfall-geometry-state is-degraded">
          The PDF renderer could not be loaded. No region overlay is shown.
        </p>
      </div>
    );
  }
  if (!Renderer) {
    return (
      <div className="ns-waterfall-pdf-frame" data-region-precision="unavailable">
        <p className="ns-waterfall-capture-state">Loading geometry-controlled PDF renderer...</p>
      </div>
    );
  }
  return <Renderer {...props} />;
}

function isWholeEvidenceBox(box: NodeSlideEvidenceBox): boolean {
  return box.x === 0 && box.y === 0 && box.w === 1 && box.h === 1;
}

export function isNormalizedEvidenceBox(box: NodeSlideEvidenceBox): boolean {
  const coordinates = [box.x, box.y, box.w, box.h];
  return (
    coordinates.every(Number.isFinite) &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.w > 0 &&
    box.h > 0 &&
    box.x + box.w <= 1 &&
    box.y + box.h <= 1
  );
}

function formatDecimal(value: number): string {
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
