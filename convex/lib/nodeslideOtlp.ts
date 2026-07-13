import type {
  NodeSlideAgentEvent,
  NodeSlideAgentRun,
  NodeSlideAgentSpan,
  NodeSlideAgentTelemetryAttribute,
} from '../../shared/nodeslide';

function timeUnixNano(timeMs: number): string {
  return (BigInt(Math.max(0, Math.round(timeMs))) * 1_000_000n).toString();
}

function otlpAttributes(attributes: readonly NodeSlideAgentTelemetryAttribute[]) {
  return attributes.map(({ key, value }) => ({
    key,
    value:
      typeof value === 'boolean'
        ? { boolValue: value }
        : typeof value === 'number'
          ? { doubleValue: value }
          : { stringValue: value },
  }));
}

export function nodeSlideOtlpTracePayload(args: {
  run: NodeSlideAgentRun;
  spans: readonly NodeSlideAgentSpan[];
  events: readonly NodeSlideAgentEvent[];
}) {
  const eventsBySpan = new Map<string, NodeSlideAgentEvent[]>();
  for (const event of args.events) {
    const list = eventsBySpan.get(event.spanId) ?? [];
    list.push(event);
    eventsBySpan.set(event.spanId, list);
  }
  return {
    resourceSpans: [
      {
        resource: {
          attributes: otlpAttributes([
            { key: 'service.name', value: 'nodeslide-agent' },
            { key: 'service.namespace', value: 'parity-studio' },
            {
              key: 'deployment.environment.name',
              value: process.env['CONVEX_CLOUD_URL'] ? 'production' : 'development',
            },
          ]),
        },
        scopeSpans: [
          {
            scope: {
              name: 'nodeslide.agent',
              version: args.run.telemetryVersion ?? 'nodeslide-otel/v1',
            },
            spans: args.spans
              .filter((span) => span.endTime !== undefined)
              .map((span) => ({
                traceId: span.traceId,
                spanId: span.spanId,
                ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
                name: span.name,
                kind: span.kind === 'client' ? 3 : 1,
                startTimeUnixNano: timeUnixNano(span.startTime),
                endTimeUnixNano: timeUnixNano(span.endTime as number),
                attributes: otlpAttributes(span.attributes),
                events: (eventsBySpan.get(span.spanId) ?? []).map((event) => ({
                  timeUnixNano: timeUnixNano(event.timestamp),
                  name: event.name,
                  attributes: otlpAttributes([
                    { key: 'event.severity', value: event.severity },
                    { key: 'event.body', value: event.body },
                    ...event.attributes,
                  ]),
                })),
                status: { code: span.status === 'error' ? 2 : span.status === 'ok' ? 1 : 0 },
              })),
          },
        ],
      },
    ],
  };
}

export function nodeSlideOtlpEndpoint(base: string): string {
  const clean = base.trim().replace(/\/+$/, '');
  return clean.endsWith('/v1/traces') ? clean : `${clean}/v1/traces`;
}

export function parseOtlpHeaders(value: string | undefined): Record<string, string> {
  if (!value) return {};
  return Object.fromEntries(
    value
      .split(',')
      .map((entry) => entry.split('='))
      .filter((parts): parts is [string, string] => parts.length >= 2 && Boolean(parts[0]?.trim()))
      .map(([key, ...rest]) => [key.trim(), rest.join('=').trim()]),
  );
}
