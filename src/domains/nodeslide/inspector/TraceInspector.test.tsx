import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  AgentTrace,
  DeckPatch,
  NodeSlideAgentRun,
  NodeSlideAgentTelemetryPage,
  ValidationIssue,
  ValidationResult,
} from '../../../../shared/nodeslide';
import {
  CountersignSeal,
  CustodyRail,
  TraceInspector,
  buildSealModel,
  consentSentence,
  copyDigest,
  isFallbackTrace,
  isSelfToggleKey,
  modelAttribution,
  nodeSummary,
  persistDensity,
  readDensity,
} from './TraceInspector';

/*
 * Scenario-based truth table for the Trace tab (spec §8). Each block adopts a
 * reviewer persona whose only defence against a bad AI edit is this panel:
 * the values must bind to real fields, and a degraded run must never render as
 * a live success. Tests run in Vitest's default node env (no DOM) via
 * react-dom/server renderToStaticMarkup + the exported pure model builders.
 */

const LIVE_DIGEST = 'candidate_validation_6a3f10ac3145d30da955728f7093d204';
const FAILED_DIGEST = 'candidate_validation_1b8e42fa77c0d9e3aa41027f5c6b3d90';

const validationLive: ValidationResult = {
  id: 'val_a',
  deckId: 'deck_wc',
  deckVersion: 2,
  ok: true,
  publishOk: true,
  cleanOk: true,
  issues: [],
  checkedAt: 100,
  toolchainVersion: 'nodeslide.slidelang/v1',
};

const validationFallback: ValidationResult = {
  ...validationLive,
  id: 'val_b',
  deckVersion: 1,
  checkedAt: 50,
};

const failedIssues: ValidationIssue[] = [
  {
    id: 'iss_scope',
    severity: 'error',
    code: 'scope',
    message: 'Operation 4 writes outside the locked writeScope for slide 02',
    slideId: 'slide_02',
  },
  {
    id: 'iss_overflow',
    severity: 'error',
    code: 'overflow',
    message: 'Body text box exceeds slide bounds after replace-text',
    slideId: 'slide_02',
  },
];

const validationFailed: ValidationResult = {
  id: 'val_c',
  deckId: 'deck_wc',
  deckVersion: 1,
  ok: false,
  publishOk: false,
  cleanOk: true,
  issues: failedIssues,
  checkedAt: 80,
  toolchainVersion: 'nodeslide.slidelang/v1',
};

// Trace A — a live GLM 5.2 edit awaiting the human's review.
const traceLive: AgentTrace = {
  id: 'trace_a1',
  deckId: 'deck_wc',
  patchId: 'patch_7f2e19',
  status: 'awaiting_review',
  summary: 'OpenRouter GLM 5.2 proposed 5 scoped operations for review.',
  provider: 'openrouter',
  model: 'z-ai/glm-5.2',
  reasoningEffort: 'xhigh',
  costMicroUsd: 2000,
  inputTokens: 2650,
  outputTokens: 150,
  createdAt: 0,
  completedAt: 6000,
  context: [
    'Slide 02 — The moment to solve',
    'Source: FIFA World Cup overview (1 source, current)',
  ],
  plan: [
    'Read locked write scope for slide 02',
    'Read slide context and its 1 source',
    'Draft 5 scoped replace-text ops',
    'Validate clocks, scope, locks, and geometry',
    'Return candidate for human review',
  ],
  toolCalls: [
    'Called GLM 5.2 through the maintained pi-ai OpenRouter provider after exact edit consent',
    'Parsed and validated GLM 5.2 JSON',
  ],
  guardrails: ['Scope / writeScope enforced', 'Operation cap <= 8', 'Deterministic validation'],
  planningInputDigest: 'a41f8e2bc90d7f1345aa02e9b76c4d18',
  planningSnapshotDigest: '0b7c15da934e6f28ac31d0057be49a6f',
  candidateDigest: LIVE_DIGEST,
  shadowComparisonExpected: true,
  shadowControlsDigest: 'shadow_controls_5f2e19b7c0a41d38',
  validation: validationLive,
};

// Trace B — the deterministic fallback after the model route timed out.
const traceFallback: AgentTrace = {
  id: 'trace_b1',
  deckId: 'deck_wc',
  status: 'completed',
  summary: 'Used the deterministic fallback because the GLM 5.2 route timed out.',
  provider: 'openrouter',
  model: 'z-ai/glm-5.2 (deterministic fallback)',
  costMicroUsd: 0,
  createdAt: 0,
  completedAt: 1000,
  context: [
    'Full deck brief (6-8 slide narrative request)',
    'No per-slide source binding at creation time',
  ],
  plan: ['Opening', '02', '03', '04', '05', '06', 'Close'],
  toolCalls: [
    'Planned six-to-eight slide narrative',
    'Built normalized deck',
    'Validated snapshot',
  ],
  guardrails: ['Deterministic validation'],
  planningSnapshotDigest: 'e2d40199fa7c6b3811005ac9df20e4b7',
  validation: validationFallback,
};

// Trace C — a live edit whose candidate deterministic validation rejected.
const traceFailed: AgentTrace = {
  id: 'trace_c1',
  deckId: 'deck_wc',
  patchId: 'patch_9d4c02',
  status: 'failed',
  summary: 'GLM 5.2 returned 6 operations; deterministic validation rejected the candidate.',
  provider: 'openrouter',
  model: 'z-ai/glm-5.2',
  costMicroUsd: 2400,
  inputTokens: 2710,
  outputTokens: 180,
  createdAt: 0,
  completedAt: 5200,
  context: [
    'Slide 02 — The moment to solve',
    'Source: FIFA World Cup overview (1 source, current)',
  ],
  plan: ['Read scope', 'Read source', 'Draft 6 ops', 'Validate', 'Return candidate'],
  toolCalls: [
    'Called GLM 5.2 through the maintained pi-ai OpenRouter provider after exact edit consent',
    'Parsed and validated GLM 5.2 JSON',
  ],
  guardrails: ['Scope / writeScope enforced', 'Operation cap <= 8'],
  candidateDigest: FAILED_DIGEST,
  validation: validationFailed,
};

// A live full-generation run with no review patch attached.
const { patchId: _patchId, ...traceLiveWithoutPatch } = traceLive;
const traceFullGen: AgentTrace = {
  ...traceLiveWithoutPatch,
  id: 'trace_full',
  status: 'completed',
  candidateDigest: 'candidate_full_9c1d20ea44b7f0331188aa5cdf20e4b7',
  costMicroUsd: 1500,
};

const patchLive = {
  id: 'patch_7f2e19',
  status: 'proposed',
  operations: [1, 2, 3, 4, 5],
  candidateDigest: LIVE_DIGEST,
} as unknown as DeckPatch;

const patchFailed = {
  id: 'patch_9d4c02',
  status: 'proposed',
  operations: [1, 2, 3, 4, 5, 6],
  candidateDigest: FAILED_DIGEST,
} as unknown as DeckPatch;

const acceptedPatch = { ...patchLive, status: 'accepted' } as unknown as DeckPatch;

describe('isFallbackTrace — fails closed', () => {
  // Persona: an auditor who must never mistake a degraded run for a proud one.
  it('flags the deterministic-fallback marker written into the model label', () => {
    expect(isFallbackTrace(traceFallback)).toBe(true);
  });

  it('fails closed on a $0 completed run with no candidate receipt, even without a label marker', () => {
    const { candidateDigest: _candidateDigest, ...traceLiveWithoutCandidate } = traceLive;
    const ambiguous: AgentTrace = {
      ...traceLiveWithoutCandidate,
      status: 'completed',
      costMicroUsd: 0,
      model: 'z-ai/glm-5.2',
      provider: 'openrouter',
    };
    expect(isFallbackTrace(ambiguous)).toBe(true);
  });

  it('treats a paid awaiting run carrying a candidate as genuinely live', () => {
    const live: AgentTrace = {
      ...traceLive,
      status: 'awaiting_review',
      costMicroUsd: 2000,
      candidateDigest: LIVE_DIGEST,
    };
    expect(isFallbackTrace(live)).toBe(false);
  });

  it('fails closed when an awaiting external run has a digest but no positive cost', () => {
    expect(
      isFallbackTrace({
        ...traceLive,
        costMicroUsd: 0,
      }),
    ).toBe(true);
  });
});

describe('CountersignSeal — state-honest matrix (spec §4a)', () => {
  it('Row: live · awaiting — agent digest, green validator, human awaiting', () => {
    const model = buildSealModel(traceLive, patchLive, validationLive, 'pro');
    expect(model.variant).toBe('live');
    expect(model.stamp).toBeNull();
    expect(model.agent.digestFull).toBe(LIVE_DIGEST);
    expect(model.human.value).toBe('Awaiting your review');
    if (model.validator.kind !== 'ok') throw new Error('validator should be ok');
    expect(model.validator.publishOk).toBe(true);
    expect(model.validator.cleanOk).toBe(true);
    expect(model.validator.deckVersion).toBe(2);

    const html = renderToStaticMarkup(
      <CountersignSeal
        trace={traceLive}
        patch={patchLive}
        validation={validationLive}
        density="pro"
      />,
    );
    expect(html).toContain('is-live');
    expect(html).not.toContain('provisional');
    expect(html).not.toContain('is-failed');
    expect(html).toContain('Awaiting your review');
    expect(html).toContain('candidate_val'); // short digest prefix is shown
    expect(html).toContain(`data-copy="${LIVE_DIGEST}"`); // full digest rides the copy control
  });

  it('Row: live · signed — human line reads Applied from patch.status', () => {
    const model = buildSealModel(traceLive, acceptedPatch, validationLive, 'pro');
    expect(model.variant).toBe('live');
    expect(model.human.value).toBe('Applied');
  });

  it('Row: full-generation — no patch means no sign-off is asserted', () => {
    const model = buildSealModel(traceFullGen, undefined, validationLive, 'pro');
    expect(model.variant).toBe('live');
    expect(model.human.value).toBe('No review cycle — full generation');
    expect(model.human.sub).toBe('no human sign-off on record');
  });

  it('Row: fallback — provisional stamp, NO invented hash, honestly green validator', () => {
    const model = buildSealModel(traceFallback, undefined, validationFallback, 'tech');
    expect(model.variant).toBe('fallback');
    expect(model.stamp).toBe('provisional');
    expect(model.agent.value).toBe('deterministic fallback');
    expect(model.agent.digestFull).toBeUndefined();
    expect(model.agent.annotation).toContain('hash not invented');
    expect(model.validator.kind).toBe('ok'); // deterministic validation genuinely ran
    expect(model.human.value).toBe('Not yet signable');

    const html = renderToStaticMarkup(
      <CountersignSeal
        trace={traceFallback}
        patch={undefined}
        validation={validationFallback}
        density="tech"
      />,
    );
    expect(html).toContain('is-fallback');
    expect(html).toContain('provisional');
    expect(html).toContain('no candidate receipt');
    expect(html).toContain('Not yet signable');
    // Adversarial: a fallback seal must contain no 32/64-hex digest anywhere.
    expect(html).not.toMatch(/[0-9a-f]{32}/i);
  });

  it('Row: fallback — the invoice says no provider billing was recorded', () => {
    const html = renderToStaticMarkup(
      <CustodyRail
        trace={traceFallback}
        patch={undefined}
        validation={validationFallback}
        density="human"
        openNode="receipt"
        onToggle={() => {}}
      />,
    );
    expect(html).toContain('$0.0000 · no provider billing recorded');
  });

  it('Row: billed fallback — preserves the real provider-attempt invoice', () => {
    const html = renderToStaticMarkup(
      <CustodyRail
        trace={{
          ...traceFallback,
          costMicroUsd: 2400,
          inputTokens: 2710,
          outputTokens: 180,
        }}
        patch={undefined}
        validation={validationFallback}
        density="human"
        openNode="receipt"
        onToggle={() => {}}
      />,
    );
    expect(html).toContain('$0.0024 · provider attempt before fallback');
    expect(html).toContain('2,710 → 180');
  });

  it('Row: failed — red seal, issues listed, human blocked, agent shows NO digest', () => {
    const model = buildSealModel(traceFailed, patchFailed, validationFailed, 'tech');
    expect(model.variant).toBe('failed');
    expect(model.stamp).toBe('blocked');
    expect(model.agent.digestFull).toBeUndefined();
    expect(model.human.value).toBe('Blocked — not signable');
    if (model.validator.kind !== 'failed') throw new Error('validator should be failed');
    expect(model.validator.issueCount).toBe(2);

    const html = renderToStaticMarkup(
      <CountersignSeal
        trace={traceFailed}
        patch={patchFailed}
        validation={validationFailed}
        density="tech"
      />,
    );
    expect(html).toContain('is-failed');
    expect(html).toContain('blocked');
    expect(html).toContain('Operation 4 writes outside the locked writeScope');
    expect(html).toContain('slide_02');
    expect(html).toContain('error'); // severity chip
    expect(html).toContain('Blocked — not signable');
    // The rejected candidate hash must never surface as a sealed digest.
    expect(html).not.toContain(FAILED_DIGEST);
    expect(html).not.toMatch(/candidate_validation_[0-9a-f]{32}/i);
  });
});

describe('progressive disclosure — depth gates real information', () => {
  // Persona: a PM on Human depth vs. an on-call engineer on Tech depth.
  it('hides the candidate digest at Human and reveals it at Pro', () => {
    const human = buildSealModel(traceLive, patchLive, validationLive, 'human');
    expect(human.agent.digestFull).toBeUndefined();
    expect(human.agent.annotation).toContain('raise depth to reveal');
    const pro = buildSealModel(traceLive, patchLive, validationLive, 'pro');
    expect(pro.agent.digestFull).toBe(LIVE_DIGEST);
  });

  it('adds the toolchainVersion to the validator only at Tech', () => {
    const pro = buildSealModel(traceLive, patchLive, validationLive, 'pro');
    const tech = buildSealModel(traceLive, patchLive, validationLive, 'tech');
    if (pro.validator.kind !== 'ok' || tech.validator.kind !== 'ok') throw new Error('ok expected');
    expect(pro.validator.toolchainVersion).toBeUndefined();
    expect(tech.validator.toolchainVersion).toBe('nodeslide.slidelang/v1');
  });

  it('renders the provenance drawer only at Tech', () => {
    const pro = renderToStaticMarkup(
      <CustodyRail
        trace={traceLive}
        patch={patchLive}
        validation={validationLive}
        density="pro"
        openNode="receipt"
        onToggle={() => {}}
      />,
    );
    const tech = renderToStaticMarkup(
      <CustodyRail
        trace={traceLive}
        patch={patchLive}
        validation={validationLive}
        density="tech"
        openNode="receipt"
        onToggle={() => {}}
      />,
    );
    expect(pro).not.toContain('ns-provbox');
    expect(tech).toContain('ns-provbox');
  });

  it('round-trips the density through sessionStorage and defaults new users to the timeline', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    });
    try {
      expect(readDensity()).toBe('pro'); // empty store
      persistDensity('tech');
      expect(readDensity()).toBe('tech');
      persistDensity('pro');
      expect(readDensity()).toBe('pro');
      store.set('ns-trace-density', 'bogus');
      expect(readDensity()).toBe('pro'); // invalid value ignored
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('copy interaction (spec §4b)', () => {
  it('copies the FULL digest and stops the click from toggling the node', () => {
    const stop = vi.fn();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      copyDigest({ stopPropagation: stop }, LIVE_DIGEST);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith(LIVE_DIGEST);
      expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('…'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('toggles a node on keydown only when the event targets the node itself', () => {
    const node = { id: 'node' };
    const inner = { id: 'copy-button' };
    expect(isSelfToggleKey({ key: 'Enter', target: node, currentTarget: node })).toBe(true);
    expect(isSelfToggleKey({ key: ' ', target: node, currentTarget: node })).toBe(true);
    expect(isSelfToggleKey({ key: 'Enter', target: inner, currentTarget: node })).toBe(false);
    expect(isSelfToggleKey({ key: 'a', target: node, currentTarget: node })).toBe(false);
  });
});

describe('custody rail — fixed order and honest break', () => {
  it('renders six nodes in the fixed accountability order', () => {
    const html = renderToStaticMarkup(
      <CustodyRail
        trace={traceLive}
        patch={patchLive}
        validation={validationLive}
        density="human"
        openNode="receipt"
        onToggle={() => {}}
      />,
    );
    const order = ['Authorization', 'Context', 'Plan', 'Actions', 'Validation', 'Approval'];
    let cursor = -1;
    for (const label of order) {
      const at = html.indexOf(label, cursor + 1);
      expect(at, `${label} should render after the previous node`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('breaks the segment entering Read only on a fallback run', () => {
    const live = renderToStaticMarkup(
      <CustodyRail
        trace={traceLive}
        patch={patchLive}
        validation={validationLive}
        density="human"
        openNode="receipt"
        onToggle={() => {}}
      />,
    );
    const fallback = renderToStaticMarkup(
      <CustodyRail
        trace={traceFallback}
        patch={undefined}
        validation={validationFallback}
        density="human"
        openNode="receipt"
        onToggle={() => {}}
      />,
    );
    expect(live).not.toContain('is-broken');
    expect(fallback).toContain('is-top is-broken');
  });
});

describe('node summaries + consent derivation + no mojibake', () => {
  it('shows the persisted reasoning effort beside provider and model', () => {
    expect(modelAttribution(traceLive)).toBe('openrouter · z-ai/glm-5.2 · Extra High effort');
  });

  it('binds every node summary to a real field', () => {
    expect(nodeSummary('read', traceLive, patchLive, validationLive, false)).toBe(
      '2 context references read',
    );
    expect(nodeSummary('read', traceFallback, undefined, validationFallback, true)).toContain(
      'attribution route degraded',
    );
    expect(nodeSummary('plan', traceLive, patchLive, validationLive, false)).toBe(
      '5-step plan drafted',
    );
    expect(nodeSummary('validate', traceFailed, patchFailed, validationFailed, false)).toContain(
      'candidate rejected',
    );
    expect(nodeSummary('receipt', traceFallback, undefined, validationFallback, true)).toContain(
      'Provisional seal',
    );
  });

  it('derives consent from a real toolCalls line, never a fabricated signer', () => {
    const derived = consentSentence(traceLive);
    expect(derived.verbatim).toBe(true);
    expect(derived.text).toContain('consent');
    const none = consentSentence({ ...traceLive, toolCalls: [] });
    expect(none.verbatim).toBe(false);
    expect(none.text).toBe('Consent evidence missing');
    const privateRun = consentSentence({
      ...traceFallback,
      provider: 'deterministic',
      model: 'bounded-edit-planner/v1',
      toolCalls: [],
    });
    expect(privateRun.text).toBe('Consent not required — no external egress');
  });

  it('renders the interpunct as itself and emits no replacement characters', () => {
    const html = renderToStaticMarkup(
      <CountersignSeal
        trace={traceLive}
        patch={patchLive}
        validation={validationLive}
        density="human"
      />,
    );
    expect(html).toContain('·'); // U+00B7 in "machine countersigned · human has not"
    expect(html).not.toContain('�');
  });
});

describe('compact durable telemetry projection', () => {
  const run: NodeSlideAgentRun = {
    id: 'run_otel',
    deckId: 'deck_wc',
    idempotencyKey: 'request_1',
    instruction: 'Update the title',
    status: 'awaiting_review',
    provider: 'openrouter',
    model: 'z-ai/glm-5.2',
    webResearch: false,
    attempt: 1,
    patchId: traceLive.patchId,
    traceId: traceLive.id,
    otelTraceId: '0123456789abcdef0123456789abcdef',
    rootSpanId: '0123456789abcdef',
    checkpoint: 'awaiting_review',
    nextTelemetrySequence: 205,
    telemetryVersion: 'nodeslide-otel/v1',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_006_000,
  };
  const telemetry: NodeSlideAgentTelemetryPage = {
    spans: [
      {
        id: 'span_chat',
        deckId: 'deck_wc',
        runId: run.id,
        traceId: run.otelTraceId as string,
        spanId: 'fedcba9876543210',
        parentSpanId: run.rootSpanId,
        name: 'Plan bounded slide edit',
        operationName: 'chat',
        kind: 'client',
        status: 'ok',
        startTime: run.createdAt,
        endTime: run.updatedAt,
        durationMs: 6000,
        provider: run.provider,
        model: run.model,
        attributes: [],
        sequence: 203,
        createdAt: run.updatedAt,
        updatedAt: run.updatedAt,
      },
    ],
    events: [
      {
        id: 'event_review',
        deckId: 'deck_wc',
        runId: run.id,
        traceId: run.otelTraceId as string,
        spanId: 'fedcba9876543210',
        name: 'agent.status.awaiting_review',
        severity: 'info',
        timestamp: run.updatedAt,
        body: 'Durable checkpoint advanced to awaiting_review.',
        attributes: [],
        sequence: 204,
      },
    ],
    hasMore: true,
    nextBeforeSequence: 203,
    totalRecorded: 204,
  };

  it('lands on the durable waterfall with honest pagination for a large run', () => {
    const html = renderToStaticMarkup(
      <TraceInspector
        traces={[traceLive]}
        validations={[validationLive]}
        patches={[patchLive]}
        agentRuns={[run]}
        agentMessages={[]}
        agentTelemetry={telemetry}
        onLoadMoreAgentTelemetry={() => {}}
      />,
    );
    expect(html).toContain('Started ');
    expect(html).toContain('Compact trace activity');
    expect(html).toContain('Full timeline');
    expect(html).toContain('Plan bounded slide edit');
    expect(html).toContain('204');
    expect(html).toContain('Older telemetry is available on the server');
    expect(html).toContain('Chain of custody and countersigned receipt');
  });
});
