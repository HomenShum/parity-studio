import { describe, expect, it } from 'vitest';
import type {
  NodeSlideAgentEvent,
  NodeSlideAgentRun,
  NodeSlideAgentSpan,
} from '../../shared/nodeslide';
import {
  nodeSlideOtlpEndpoint,
  nodeSlideOtlpTracePayload,
  parseOtlpHeaders,
} from './nodeslideOtlp';

const run: NodeSlideAgentRun = {
  id: 'run_1',
  deckId: 'deck_1',
  idempotencyKey: 'request_1',
  instruction: 'Private content must not be exported',
  status: 'completed',
  provider: 'openrouter',
  model: 'z-ai/glm-5.2',
  webResearch: false,
  attempt: 1,
  telemetryVersion: 'nodeslide-otel/v1',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
  completedAt: 1_700_000_001_000,
};

const span: NodeSlideAgentSpan = {
  id: 'span_1',
  deckId: run.deckId,
  runId: run.id,
  traceId: '0123456789abcdef0123456789abcdef',
  spanId: '0123456789abcdef',
  name: 'Invoke NodeSlide agent',
  operationName: 'invoke_agent',
  kind: 'internal',
  status: 'ok',
  startTime: run.createdAt,
  endTime: run.completedAt,
  durationMs: 1000,
  attributes: [{ key: 'gen_ai.operation.name', value: 'invoke_agent' }],
  sequence: 1,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
};

const event: NodeSlideAgentEvent = {
  id: 'event_1',
  deckId: run.deckId,
  runId: run.id,
  traceId: span.traceId,
  spanId: span.spanId,
  name: 'agent.status.completed',
  severity: 'info',
  timestamp: run.completedAt as number,
  body: 'Run completed.',
  attributes: [],
  sequence: 2,
};

describe('NodeSlide OTLP export', () => {
  it('builds collector-ready trace JSON with nanosecond timestamps and attached events', () => {
    const payload = nodeSlideOtlpTracePayload({ run, spans: [span], events: [event] });
    const exported = payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(exported?.traceId).toBe(span.traceId);
    expect(exported?.spanId).toBe(span.spanId);
    expect(exported?.startTimeUnixNano).toBe('1700000000000000000');
    expect(exported?.events[0]?.name).toBe(event.name);
    expect(JSON.stringify(payload)).not.toContain(run.instruction);
  });

  it('normalizes endpoints and parses standard OTLP header syntax', () => {
    expect(nodeSlideOtlpEndpoint('https://collector.example')).toBe(
      'https://collector.example/v1/traces',
    );
    expect(nodeSlideOtlpEndpoint('https://collector.example/v1/traces')).toBe(
      'https://collector.example/v1/traces',
    );
    expect(parseOtlpHeaders('Authorization=Bearer abc,x-tenant=demo')).toEqual({
      Authorization: 'Bearer abc',
      'x-tenant': 'demo',
    });
  });
});
