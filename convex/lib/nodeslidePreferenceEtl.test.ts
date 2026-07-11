import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_PREFERENCE_ATTRIBUTE_ALLOWLIST,
  NODESLIDE_PREFERENCE_BOUNDS,
  NODESLIDE_PREFERENCE_SCHEMA_VERSION,
  type PreferenceEvent,
  type PreferenceEventType,
  type PreferenceProvenance,
  type PreferenceScope,
} from '../../shared/nodeslidePreference';
import {
  NodeSlidePreferenceExtractionError,
  type PreferenceArtifactReference,
  type PreferenceDeckVersionArtifact,
  type PreferencePatchArtifact,
  type PreferenceProvenanceArtifact,
  type PreferenceProvenanceResolver,
  type PreferenceTraceArtifact,
  type PreferenceVariationArtifact,
  type PreferenceVariationAxes,
  type PreferenceVariationBatchArtifact,
  extractPreferenceSignals,
  nodeslidePreferenceEventId,
  nodeslidePreferenceSignalId,
  stablePreferenceStringify,
} from './nodeslidePreferenceEtl';

const TENANT_ID = 'tenant-a';
const ACTOR_ID = 'actor-a';
const DECK_ID = 'deck-a';
const SLIDE_ID = 'slide-a';
const SLIDE_SCOPE: PreferenceScope = { kind: 'slide', deckId: DECK_ID, slideId: SLIDE_ID };
const ELEMENT_SCOPE: PreferenceScope = {
  kind: 'element',
  deckId: DECK_ID,
  slideId: SLIDE_ID,
  elementId: 'element-a',
};
const DEFAULT_AXES: PreferenceVariationAxes = {
  contentAngle: 'data_led',
  density: 'executive',
  layoutArchetype: 'evidence',
};

class FixtureResolver implements PreferenceProvenanceResolver {
  readonly artifacts = new Map<string, PreferenceProvenanceArtifact>();
  readonly events = new Map<string, PreferenceEvent>();

  resolveArtifact(
    reference: PreferenceArtifactReference,
  ): PreferenceProvenanceArtifact | undefined {
    return this.artifacts.get(referenceKey(reference));
  }

  resolveEvent(eventId: string): PreferenceEvent | undefined {
    return this.events.get(eventId);
  }

  put(artifact: PreferenceProvenanceArtifact): void {
    this.artifacts.set(artifactKey(artifact), artifact);
  }

  putEvent(event: PreferenceEvent): void {
    this.events.set(event.id, event);
  }
}

function referenceKey(reference: PreferenceArtifactReference): string {
  return reference.kind === 'deck_version'
    ? `deck_version:${reference.deckId}:${reference.deckVersion}`
    : `${reference.kind}:${reference.id}`;
}

function artifactKey(artifact: PreferenceProvenanceArtifact): string {
  return artifact.kind === 'deck_version'
    ? `deck_version:${artifact.deckId}:${artifact.deckVersion}`
    : `${artifact.kind}:${artifact.id}`;
}

function event(
  type: PreferenceEventType,
  options: {
    id?: string;
    tenantId?: string;
    actorId?: string;
    scope?: PreferenceScope;
    provenance?: Record<string, unknown>;
    attributes?: Record<string, string | number | boolean>;
    occurredAt?: number;
  } = {},
): PreferenceEvent {
  const occurredAt = options.occurredAt ?? 10;
  return {
    schemaVersion: NODESLIDE_PREFERENCE_SCHEMA_VERSION,
    id: options.id ?? `event-${type}-${occurredAt}`,
    tenantId: options.tenantId ?? TENANT_ID,
    actorId: options.actorId ?? ACTOR_ID,
    type,
    scope: options.scope ?? SLIDE_SCOPE,
    provenance: (options.provenance ?? { deckVersion: 2 }) as unknown as PreferenceProvenance,
    attributes: options.attributes ?? {},
    occurredAt,
    recordedAt: occurredAt + 1,
  };
}

function putDeckVersion(
  resolver: FixtureResolver,
  options: {
    deckId?: string;
    tenantId?: string;
    deckVersion?: number;
    acceptedPatchIds?: readonly string[];
  } = {},
): void {
  const deckId = options.deckId ?? DECK_ID;
  const artifact: PreferenceDeckVersionArtifact = {
    kind: 'deck_version',
    tenantId: options.tenantId ?? TENANT_ID,
    deckId,
    scope: { kind: 'deck', deckId },
    deckVersion: options.deckVersion ?? 2,
    acceptedPatchIds: options.acceptedPatchIds ?? [],
  };
  resolver.put(artifact);
}

function putVariationChain(
  resolver: FixtureResolver,
  options: {
    variationId: string;
    batchId: string;
    traceId: string;
    patchId?: string;
    scope?: PreferenceScope;
    axes?: PreferenceVariationAxes;
    batchVariationIds?: readonly string[];
    tenantId?: string;
    deckId?: string;
    patchResultingDeckVersion?: number;
  },
): void {
  const scope = options.scope ?? SLIDE_SCOPE;
  const tenantId = options.tenantId ?? TENANT_ID;
  const deckId = options.deckId ?? DECK_ID;
  const variation: PreferenceVariationArtifact = {
    kind: 'variation',
    id: options.variationId,
    tenantId,
    deckId,
    scope,
    batchId: options.batchId,
    axes: options.axes ?? DEFAULT_AXES,
    status: 'accepted',
  };
  const batch: PreferenceVariationBatchArtifact = {
    kind: 'variation_batch',
    id: options.batchId,
    tenantId,
    deckId,
    scope,
    variationIds: options.batchVariationIds ?? [options.variationId],
  };
  const trace: PreferenceTraceArtifact = {
    kind: 'trace',
    id: options.traceId,
    tenantId,
    deckId,
    scope,
    variationId: options.variationId,
    variationBatchId: options.batchId,
    ...(options.patchId ? { patchId: options.patchId } : {}),
  };
  resolver.put(variation);
  resolver.put(batch);
  resolver.put(trace);
  if (options.patchId) {
    putPatch(resolver, {
      id: options.patchId,
      scope,
      tenantId,
      deckId,
      source: 'agent',
      traceId: options.traceId,
      variationId: options.variationId,
      resultingDeckVersion: options.patchResultingDeckVersion ?? 2,
    });
  }
}

function putPatch(
  resolver: FixtureResolver,
  options: {
    id: string;
    scope?: PreferenceScope;
    tenantId?: string;
    deckId?: string;
    source?: PreferencePatchArtifact['source'];
    status?: PreferencePatchArtifact['status'];
    traceId?: string;
    variationId?: string;
    supersedesPatchId?: string;
    resultingDeckVersion?: number;
    styleChanges?: PreferencePatchArtifact['styleChanges'];
  },
): void {
  resolver.put({
    kind: 'patch',
    id: options.id,
    tenantId: options.tenantId ?? TENANT_ID,
    deckId: options.deckId ?? DECK_ID,
    scope: options.scope ?? SLIDE_SCOPE,
    source: options.source ?? 'human',
    status: options.status ?? 'accepted',
    styleChanges: options.styleChanges ?? [],
    ...(options.traceId ? { traceId: options.traceId } : {}),
    ...(options.variationId ? { variationId: options.variationId } : {}),
    ...(options.supersedesPatchId ? { supersedesPatchId: options.supersedesPatchId } : {}),
    ...(options.resultingDeckVersion !== undefined
      ? { resultingDeckVersion: options.resultingDeckVersion }
      : {}),
  });
}

function putReadyExport(resolver: FixtureResolver, exportId: string, deckVersion = 2): void {
  resolver.put({
    kind: 'export',
    id: exportId,
    tenantId: TENANT_ID,
    deckId: DECK_ID,
    scope: { kind: 'deck', deckId: DECK_ID },
    deckVersion,
    status: 'ready',
    format: 'pptx',
  });
}

function withoutProvenance(eventValue: PreferenceEvent, ...keys: string[]): PreferenceEvent {
  const provenance = Object.fromEntries(
    Object.entries(eventValue.provenance).filter(([key]) => !keys.includes(key)),
  );
  return { ...eventValue, provenance: provenance as unknown as PreferenceProvenance };
}

describe('NodeSlide preference ETL contract', () => {
  it('freezes the revision-one bounds and event attribute allow-lists', () => {
    expect(NODESLIDE_PREFERENCE_BOUNDS).toMatchObject({
      maxRetainedEvents: 1_000,
      maxProfileSignals: 100,
      maxEventsPerExtraction: 100,
      maxSignalProposals: 20,
      maxAttributesPerEvent: 32,
      maxAttributeKeyLength: 64,
      maxAttributeStringLength: 240,
      maxEvidenceEventIds: 16,
      defaultListLimit: 50,
      maxListLimit: 200,
    });
    expect(NODESLIDE_PREFERENCE_ATTRIBUTE_ALLOWLIST.patch_declined).toEqual([]);
    expect(NODESLIDE_PREFERENCE_ATTRIBUTE_ALLOWLIST.patch_accepted).toEqual(['color', 'font']);
  });

  it('derives deterministic event and semantic signal IDs', () => {
    const input = {
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      type: 'variation_selected' as const,
      sourceArtifactId: 'variation-a',
      idempotencyKey: 'decision-a',
    };
    expect(nodeslidePreferenceEventId(input)).toBe(nodeslidePreferenceEventId({ ...input }));
    expect(nodeslidePreferenceEventId({ ...input, idempotencyKey: 'decision-b' })).not.toBe(
      nodeslidePreferenceEventId(input),
    );
    expect(
      nodeslidePreferenceSignalId({
        tenantId: TENANT_ID,
        actorId: ACTOR_ID,
        polarity: 'positive',
        scope: SLIDE_SCOPE,
        dimension: 'color',
        value: '#ABC',
      }),
    ).toBe(
      nodeslidePreferenceSignalId({
        tenantId: TENANT_ID,
        actorId: ACTOR_ID,
        polarity: 'positive',
        scope: SLIDE_SCOPE,
        dimension: 'color',
        value: '#aabbcc',
      }),
    );
  });

  it('canonicalizes nested object insertion order for idempotent storage comparisons', () => {
    const beforeStorage = {
      kind: 'slide',
      deckId: DECK_ID,
      slideId: SLIDE_ID,
      nested: { traceId: 'trace-a', patchId: 'patch-a' },
    };
    const afterStorage = {
      deckId: DECK_ID,
      kind: 'slide',
      nested: { patchId: 'patch-a', traceId: 'trace-a' },
      slideId: SLIDE_ID,
    };

    expect(stablePreferenceStringify(beforeStorage)).toBe(stablePreferenceStringify(afterStorage));
  });
});

describe('NodeSlide preference provenance gate', () => {
  it('fails closed for every event type when a required provenance link is missing', () => {
    const resolver = new FixtureResolver();
    putDeckVersion(resolver, { acceptedPatchIds: ['patch-export'] });
    putVariationChain(resolver, {
      variationId: 'variation-generated',
      batchId: 'batch-generated',
      traceId: 'trace-generated',
    });
    putVariationChain(resolver, {
      variationId: 'variation-selected',
      batchId: 'batch-selected',
      traceId: 'trace-selected',
      patchId: 'patch-selected',
    });
    putVariationChain(resolver, {
      variationId: 'variation-rejected',
      batchId: 'batch-rejected',
      traceId: 'trace-rejected',
    });
    putPatch(resolver, {
      id: 'patch-accepted',
      resultingDeckVersion: 2,
      styleChanges: [{ dimension: 'color', after: '#123456' }],
    });
    putPatch(resolver, {
      id: 'patch-declined',
      status: 'rejected',
    });
    putPatch(resolver, { id: 'patch-export', resultingDeckVersion: 2 });
    putReadyExport(resolver, 'export-a');

    const sourceAccepted = event('patch_accepted', {
      id: 'event-source-accepted',
      provenance: { deckVersion: 2, patchId: 'patch-accepted' },
      attributes: { color: '#123456' },
      occurredAt: 1,
    });
    resolver.putEvent(sourceAccepted);

    const cases: Array<{ event: PreferenceEvent; missing: string[] }> = [
      {
        event: event('variation_generated', {
          id: 'missing-generated',
          provenance: {
            deckVersion: 2,
            variationId: 'variation-generated',
            variationBatchId: 'batch-generated',
            traceId: 'trace-generated',
          },
        }),
        missing: ['traceId'],
      },
      {
        event: event('variation_selected', {
          id: 'missing-selected',
          provenance: {
            deckVersion: 2,
            variationId: 'variation-selected',
            variationBatchId: 'batch-selected',
            patchId: 'patch-selected',
            traceId: 'trace-selected',
          },
        }),
        missing: ['patchId'],
      },
      {
        event: event('variation_rejected', {
          id: 'missing-rejected',
          provenance: {
            deckVersion: 2,
            variationId: 'variation-rejected',
            variationBatchId: 'batch-rejected',
            traceId: 'trace-rejected',
          },
        }),
        missing: ['variationBatchId'],
      },
      {
        event: event('patch_accepted', {
          id: 'missing-accepted',
          provenance: { deckVersion: 2, patchId: 'patch-accepted' },
          attributes: { color: '#123456' },
        }),
        missing: ['patchId'],
      },
      {
        event: event('patch_modified', {
          id: 'missing-modified',
          provenance: {
            deckVersion: 2,
            patchId: 'patch-accepted',
            sourceEventId: sourceAccepted.id,
          },
          attributes: { supersededColor: '#123456' },
        }),
        missing: ['sourceEventId'],
      },
      {
        event: event('patch_declined', {
          id: 'missing-declined',
          provenance: { deckVersion: 2, patchId: 'patch-declined' },
        }),
        missing: ['patchId'],
      },
      {
        event: event('export_completed', {
          id: 'missing-export',
          scope: { kind: 'deck', deckId: DECK_ID },
          provenance: { deckVersion: 2, exportId: 'export-a' },
          attributes: { exportFormat: 'pptx' },
        }),
        missing: ['exportId'],
      },
    ];

    for (const testCase of cases) {
      const malformed = withoutProvenance(testCase.event, ...testCase.missing);
      const result = extractPreferenceSignals([malformed], { resolver });
      expect(result.signals, malformed.type).toEqual([]);
      expect(result.inputRejections[0]?.rejectionCodes, malformed.type).toContain(
        'missing_provenance',
      );
    }
  });

  it('requires a trace for an agent-sourced accepted patch', () => {
    const resolver = new FixtureResolver();
    putDeckVersion(resolver);
    putPatch(resolver, {
      id: 'agent-patch',
      source: 'agent',
      traceId: 'agent-trace',
      resultingDeckVersion: 2,
      styleChanges: [{ dimension: 'font', after: 'Inter' }],
    });
    const accepted = event('patch_accepted', {
      provenance: { deckVersion: 2, patchId: 'agent-patch' },
      attributes: { font: 'Inter' },
    });
    const result = extractPreferenceSignals([accepted], { resolver });
    expect(result.signals).toEqual([]);
    expect(result.inputRejections[0]?.rejectionCodes).toContain('agent_trace_missing');
  });

  it('accepts the frozen patch-declined patch-or-trace alternative without proposing a signal', () => {
    const resolver = new FixtureResolver();
    putDeckVersion(resolver);
    resolver.put({
      kind: 'trace',
      id: 'declined-trace',
      tenantId: TENANT_ID,
      deckId: DECK_ID,
      scope: SLIDE_SCOPE,
      patchId: 'declined-proposal',
    });
    const declined = event('patch_declined', {
      id: 'event-declined-by-trace',
      provenance: { deckVersion: 2, traceId: 'declined-trace' },
    });
    const result = extractPreferenceSignals([declined], { resolver });
    expect(result.signals).toEqual([]);
    expect(result.inputRejections).toEqual([]);
  });

  it.each([
    ['cross-tenant', { tenantId: 'tenant-forged' }],
    ['cross-deck', { deckId: 'deck-forged' }],
  ])('rejects %s artifact chains without leaking which link exists', (_name, forged) => {
    const resolver = new FixtureResolver();
    putDeckVersion(resolver);
    putVariationChain(resolver, {
      variationId: 'variation-forged',
      batchId: 'batch-forged',
      traceId: 'trace-forged',
      patchId: 'patch-forged',
    });
    const original = resolver.artifacts.get('variation:variation-forged');
    expect(original?.kind).toBe('variation');
    if (original?.kind === 'variation') {
      resolver.put({
        ...original,
        ...forged,
        scope: !('deckId' in forged)
          ? original.scope
          : { kind: 'slide', deckId: forged.deckId, slideId: SLIDE_ID },
      });
    }
    const selected = event('variation_selected', {
      id: `event-${_name}`,
      provenance: {
        deckVersion: 2,
        variationId: 'variation-forged',
        variationBatchId: 'batch-forged',
        patchId: 'patch-forged',
        traceId: 'trace-forged',
      },
    });
    const result = extractPreferenceSignals([selected], { resolver });
    expect(result.signals).toEqual([]);
    expect(result.inputRejections[0]?.rejectionCodes).toContain('provenance_chain_invalid');
    expect(result.inputRejections[0]?.rejectionCodes.join(' ')).not.toMatch(/tenant|deck/);
  });

  it('rejects a same-tenant selected variation whose accepted patch produced a stale version', () => {
    const resolver = new FixtureResolver();
    putDeckVersion(resolver, { deckVersion: 5 });
    putVariationChain(resolver, {
      variationId: 'variation-stale-version',
      batchId: 'batch-stale-version',
      traceId: 'trace-stale-version',
      patchId: 'patch-stale-version',
      patchResultingDeckVersion: 4,
    });
    const selected = event('variation_selected', {
      id: 'event-stale-version-selection',
      provenance: {
        deckVersion: 5,
        variationId: 'variation-stale-version',
        variationBatchId: 'batch-stale-version',
        patchId: 'patch-stale-version',
        traceId: 'trace-stale-version',
      },
    });

    const result = extractPreferenceSignals([selected], { resolver });
    expect(result.signals).toEqual([]);
    expect(result.inputRejections[0]?.rejectionCodes).toContain('provenance_chain_invalid');
  });

  it('rejects an unrelated same-tenant accepted patch and permits version membership fallback', () => {
    const unrelatedResolver = new FixtureResolver();
    putDeckVersion(unrelatedResolver, { deckVersion: 5, acceptedPatchIds: [] });
    putPatch(unrelatedResolver, {
      id: 'patch-unrelated-version',
      styleChanges: [{ dimension: 'color', after: '#123456' }],
    });
    const unrelated = event('patch_accepted', {
      id: 'event-unrelated-version',
      provenance: { deckVersion: 5, patchId: 'patch-unrelated-version' },
      attributes: { color: '#123456' },
    });

    const rejected = extractPreferenceSignals([unrelated], { resolver: unrelatedResolver });
    expect(rejected.signals).toEqual([]);
    expect(rejected.inputRejections[0]?.rejectionCodes).toContain('provenance_chain_invalid');

    const memberResolver = new FixtureResolver();
    putDeckVersion(memberResolver, {
      deckVersion: 5,
      acceptedPatchIds: ['patch-version-member'],
    });
    putPatch(memberResolver, {
      id: 'patch-version-member',
      styleChanges: [{ dimension: 'color', after: '#123456' }],
    });
    const member = event('patch_accepted', {
      id: 'event-version-member',
      provenance: { deckVersion: 5, patchId: 'patch-version-member' },
      attributes: { color: '#123456' },
    });

    const accepted = extractPreferenceSignals([member], { resolver: memberResolver });
    expect(accepted.inputRejections).toEqual([]);
    expect(accepted.signals.map((signal) => [signal.dimension, signal.value])).toEqual([
      ['color', '#123456'],
    ]);
  });
});

describe('NodeSlide preference decision extraction', () => {
  it('emits rule-derived positive selection and negative rejection axes', () => {
    const selectedResolver = new FixtureResolver();
    putDeckVersion(selectedResolver);
    putVariationChain(selectedResolver, {
      variationId: 'variation-selected',
      batchId: 'batch-selected',
      traceId: 'trace-selected',
      patchId: 'patch-selected',
    });
    const selected = event('variation_selected', {
      id: 'event-selected',
      provenance: {
        deckVersion: 2,
        variationId: 'variation-selected',
        variationBatchId: 'batch-selected',
        patchId: 'patch-selected',
        traceId: 'trace-selected',
      },
    });
    const selectedResult = extractPreferenceSignals([selected], { resolver: selectedResolver });
    expect(selectedResult.signals).toHaveLength(3);
    expect(selectedResult.signals.map((signal) => [signal.dimension, signal.value])).toEqual([
      ['content_angle', 'data_led'],
      ['density', 'executive'],
      ['layout_archetype', 'evidence'],
    ]);
    expect(selectedResult.signals.every((signal) => signal.polarity === 'positive')).toBe(true);
    expect(selectedResult.signals.every((signal) => signal.confidence === 0.9)).toBe(true);
    expect(selectedResult.signals.every((signal) => signal.evaluator.passed)).toBe(true);

    const rejectedResolver = new FixtureResolver();
    putDeckVersion(rejectedResolver);
    putVariationChain(rejectedResolver, {
      variationId: 'variation-rejected',
      batchId: 'batch-rejected',
      traceId: 'trace-rejected',
    });
    const rejected = event('variation_rejected', {
      id: 'event-rejected',
      provenance: {
        deckVersion: 2,
        variationId: 'variation-rejected',
        variationBatchId: 'batch-rejected',
        traceId: 'trace-rejected',
      },
    });
    const rejectedResult = extractPreferenceSignals([rejected], { resolver: rejectedResolver });
    expect(rejectedResult.signals).toHaveLength(3);
    expect(rejectedResult.signals.every((signal) => signal.polarity === 'negative')).toBe(true);
    expect(rejectedResult.signals.every((signal) => signal.confidence === 0.6)).toBe(true);
  });

  it('suppresses a rejected axis when a sibling with that axis was selected', () => {
    const resolver = new FixtureResolver();
    putDeckVersion(resolver);
    const variationIds = ['variation-selected-sibling', 'variation-rejected-sibling'];
    putVariationChain(resolver, {
      variationId: variationIds[0] ?? '',
      batchId: 'batch-siblings',
      traceId: 'trace-selected-sibling',
      patchId: 'patch-selected-sibling',
      batchVariationIds: variationIds,
      axes: DEFAULT_AXES,
    });
    putVariationChain(resolver, {
      variationId: variationIds[1] ?? '',
      batchId: 'batch-siblings',
      traceId: 'trace-rejected-sibling',
      batchVariationIds: variationIds,
      axes: { contentAngle: 'data_led', density: 'detail', layoutArchetype: 'split' },
    });
    const selected = event('variation_selected', {
      id: 'event-selected-sibling',
      occurredAt: 10,
      provenance: {
        deckVersion: 2,
        variationId: variationIds[0],
        variationBatchId: 'batch-siblings',
        patchId: 'patch-selected-sibling',
        traceId: 'trace-selected-sibling',
      },
    });
    const rejected = event('variation_rejected', {
      id: 'event-rejected-sibling',
      occurredAt: 20,
      provenance: {
        deckVersion: 2,
        variationId: variationIds[1],
        variationBatchId: 'batch-siblings',
        traceId: 'trace-rejected-sibling',
      },
    });
    const result = extractPreferenceSignals([rejected, selected], { resolver });
    expect(
      result.signals.some(
        (signal) =>
          signal.polarity === 'negative' &&
          signal.dimension === 'content_angle' &&
          signal.value === 'data_led',
      ),
    ).toBe(false);
    expect(
      result.evaluations.find(
        (evaluation) =>
          evaluation.sourceEventType === 'variation_rejected' &&
          evaluation.proposal.dimension === 'content_angle',
      )?.evaluator.rejectionCodes,
    ).toContain('sibling_axis_selected');
  });

  it('select-then-reject suppresses every durable positive for the reverted value', () => {
    const resolver = new FixtureResolver();
    putDeckVersion(resolver);
    putVariationChain(resolver, {
      variationId: 'variation-reverted',
      batchId: 'batch-reverted',
      traceId: 'trace-reverted',
      patchId: 'patch-reverted',
    });
    const selected = event('variation_selected', {
      id: 'event-select-before-revert',
      occurredAt: 10,
      provenance: {
        deckVersion: 2,
        variationId: 'variation-reverted',
        variationBatchId: 'batch-reverted',
        patchId: 'patch-reverted',
        traceId: 'trace-reverted',
      },
    });
    const rejected = event('variation_rejected', {
      id: 'event-revert-selection',
      occurredAt: 20,
      provenance: {
        deckVersion: 2,
        variationId: 'variation-reverted',
        variationBatchId: 'batch-reverted',
        traceId: 'trace-reverted',
      },
    });
    const result = extractPreferenceSignals([selected, rejected], { resolver });
    expect(result.signals).toHaveLength(3);
    expect(result.signals.every((signal) => signal.polarity === 'negative')).toBe(true);
    const suppressedPositive = result.evaluations.filter(
      (evaluation) => evaluation.proposal.polarity === 'positive',
    );
    expect(suppressedPositive).toHaveLength(3);
    expect(
      suppressedPositive.every((evaluation) =>
        evaluation.evaluator.rejectionCodes.includes('contradicted_by_later_event'),
      ),
    ).toBe(true);
  });

  it('extracts normalized style acceptance and lower-confidence superseded changes', () => {
    const resolver = new FixtureResolver();
    putDeckVersion(resolver, { deckVersion: 5 });
    putPatch(resolver, {
      id: 'patch-style-accepted',
      scope: ELEMENT_SCOPE,
      resultingDeckVersion: 5,
      styleChanges: [
        { dimension: 'color', before: '#fff', after: '#AABBCC' },
        { dimension: 'font', before: 'Arial', after: 'Inter' },
      ],
    });
    putPatch(resolver, {
      id: 'patch-style-superseding',
      scope: ELEMENT_SCOPE,
      supersedesPatchId: 'patch-style-accepted',
      styleChanges: [
        { dimension: 'color', before: '#aabbcc', after: '#ffffff' },
        { dimension: 'font', before: 'inter', after: 'arial' },
      ],
    });
    const accepted = event('patch_accepted', {
      id: 'event-style-accepted',
      scope: ELEMENT_SCOPE,
      occurredAt: 10,
      provenance: { deckVersion: 5, patchId: 'patch-style-accepted' },
      attributes: { color: '#ABC', font: '  INTER  ' },
    });
    const modified = event('patch_modified', {
      id: 'event-style-modified',
      scope: ELEMENT_SCOPE,
      occurredAt: 20,
      provenance: {
        deckVersion: 5,
        patchId: 'patch-style-superseding',
        sourceEventId: accepted.id,
      },
      attributes: {
        color: '#ffffff',
        font: 'Arial',
        supersededColor: '#AABBCC',
        supersededFont: 'Inter',
      },
    });
    resolver.putEvent(accepted);

    const acceptedOnly = extractPreferenceSignals([accepted], { resolver });
    expect(acceptedOnly.signals.map((signal) => [signal.dimension, signal.value])).toEqual([
      ['color', '#aabbcc'],
      ['font', 'inter'],
    ]);
    expect(acceptedOnly.signals.every((signal) => signal.confidence === 0.85)).toBe(true);

    const reverted = extractPreferenceSignals([modified, accepted], { resolver });
    expect(reverted.signals).toHaveLength(2);
    expect(reverted.signals.map((signal) => [signal.dimension, signal.value])).toEqual([
      ['color', '#aabbcc'],
      ['font', 'inter'],
    ]);
    expect(reverted.signals.every((signal) => signal.polarity === 'negative')).toBe(true);
    expect(reverted.signals.every((signal) => signal.confidence === 0.5)).toBe(true);
    expect(reverted.signals.every((signal) => signal.evidenceEventIds.length === 2)).toBe(true);
    expect(modified.provenance.patchId).toBe('patch-style-superseding');
    expect(accepted.provenance.patchId).toBe('patch-style-accepted');
  });
});

describe('NodeSlide preference export and hallucination gates', () => {
  it('emits workflow preference only for an export linked to an accepted deck-version change', () => {
    const linkedResolver = new FixtureResolver();
    putDeckVersion(linkedResolver, {
      deckVersion: 7,
      acceptedPatchIds: ['patch-in-exported-version'],
    });
    putPatch(linkedResolver, {
      id: 'patch-in-exported-version',
      resultingDeckVersion: 6,
    });
    putReadyExport(linkedResolver, 'export-linked', 7);
    const completed = event('export_completed', {
      id: 'event-export-linked',
      scope: { kind: 'deck', deckId: DECK_ID },
      provenance: { deckVersion: 7, exportId: 'export-linked' },
      attributes: { exportFormat: 'pptx' },
    });
    const linked = extractPreferenceSignals([completed], { resolver: linkedResolver });
    expect(linked.signals).toHaveLength(1);
    expect(linked.signals[0]).toMatchObject({
      polarity: 'positive',
      dimension: 'workflow',
      value: 'export_completed',
      confidence: 0.7,
    });

    const unlinkedResolver = new FixtureResolver();
    putDeckVersion(unlinkedResolver, { deckVersion: 7, acceptedPatchIds: [] });
    putReadyExport(unlinkedResolver, 'export-linked', 7);
    const unlinked = extractPreferenceSignals([completed], { resolver: unlinkedResolver });
    expect(unlinked.signals).toEqual([]);
    expect(unlinked.evaluations[0]?.evaluator.rejectionCodes).toContain(
      'export_without_accepted_change',
    );
  });

  it('rejects a valid-enum value that is not derivable from the linked variation artifact', () => {
    const resolver = new FixtureResolver();
    putDeckVersion(resolver);
    putVariationChain(resolver, {
      variationId: 'variation-hallucination',
      batchId: 'batch-hallucination',
      traceId: 'trace-hallucination',
      patchId: 'patch-hallucination',
      axes: {
        contentAngle: 'narrative_led',
        density: 'executive',
        layoutArchetype: 'evidence',
      },
    });
    const selected = event('variation_selected', {
      id: 'event-hallucination',
      provenance: {
        deckVersion: 2,
        variationId: 'variation-hallucination',
        variationBatchId: 'batch-hallucination',
        patchId: 'patch-hallucination',
        traceId: 'trace-hallucination',
      },
      attributes: {
        contentAngle: 'data_led',
        density: 'executive',
        layoutArchetype: 'evidence',
      },
    });
    const result = extractPreferenceSignals([selected], { resolver });
    expect(result.signals).toHaveLength(2);
    expect(result.signals.some((signal) => signal.dimension === 'content_angle')).toBe(false);
    const hallucinated = result.evaluations.find(
      (evaluation) => evaluation.proposal.dimension === 'content_angle',
    );
    expect(hallucinated?.evaluator.checks.schema.passed).toBe(true);
    expect(hallucinated?.evaluator.checks.provenance.passed).toBe(true);
    expect(hallucinated?.evaluator.checks.hallucination).toEqual({
      passed: false,
      rejectionCodes: ['value_not_derivable'],
    });
  });
});

describe('NodeSlide preference bounds and deterministic replay', () => {
  it('rejects unknown, oversized, and over-count event attributes before emitting signals', () => {
    const resolver = new FixtureResolver();
    putDeckVersion(resolver);
    putVariationChain(resolver, {
      variationId: 'variation-attributes',
      batchId: 'batch-attributes',
      traceId: 'trace-attributes',
      patchId: 'patch-attributes',
    });
    const base = event('variation_selected', {
      provenance: {
        deckVersion: 2,
        variationId: 'variation-attributes',
        variationBatchId: 'batch-attributes',
        patchId: 'patch-attributes',
        traceId: 'trace-attributes',
      },
    });
    const cases: Array<{
      id: string;
      attributes: Record<string, string | number | boolean>;
      code: 'attribute_limit_exceeded' | 'attribute_not_allowed' | 'attribute_value_invalid';
    }> = [
      { id: 'unknown', attributes: { freeText: 'not allowed' }, code: 'attribute_not_allowed' },
      {
        id: 'too-many',
        attributes: Object.fromEntries(
          Array.from({ length: 33 }, (_, index) => [`unknown${index}`, true]),
        ),
        code: 'attribute_limit_exceeded',
      },
      {
        id: 'long-key',
        attributes: { ['x'.repeat(65)]: true },
        code: 'attribute_limit_exceeded',
      },
      {
        id: 'long-value',
        attributes: { contentAngle: 'x'.repeat(241) },
        code: 'attribute_value_invalid',
      },
    ];
    for (const testCase of cases) {
      const malformed = { ...base, id: `event-${testCase.id}`, attributes: testCase.attributes };
      const result = extractPreferenceSignals([malformed], { resolver });
      expect(result.signals, testCase.id).toEqual([]);
      expect(result.inputRejections[0]?.rejectionCodes, testCase.id).toContain(testCase.code);
    }
  });

  it('hard-rejects event floods and deterministically caps proposal output at twenty', () => {
    const resolver = new FixtureResolver();
    putDeckVersion(resolver);
    const events = Array.from({ length: 100 }, (_, index) => {
      const scope: PreferenceScope = {
        kind: 'slide',
        deckId: DECK_ID,
        slideId: `slide-flood-${index}`,
      };
      putVariationChain(resolver, {
        variationId: `variation-flood-${index}`,
        batchId: `batch-flood-${index}`,
        traceId: `trace-flood-${index}`,
        patchId: `patch-flood-${index}`,
        scope,
      });
      return event('variation_selected', {
        id: `event-flood-${index.toString().padStart(3, '0')}`,
        scope,
        occurredAt: index + 1,
        provenance: {
          deckVersion: 2,
          variationId: `variation-flood-${index}`,
          variationBatchId: `batch-flood-${index}`,
          patchId: `patch-flood-${index}`,
          traceId: `trace-flood-${index}`,
        },
      });
    });
    const bounded = extractPreferenceSignals(events, { resolver });
    expect(bounded.diagnostics).toMatchObject({
      inputEvents: 100,
      candidatePatterns: 300,
      proposalsReturned: 20,
      proposalsTruncated: 280,
      signalsEmitted: 20,
    });
    expect(bounded.evaluations).toHaveLength(20);
    expect(bounded.signals).toHaveLength(20);

    expect(() =>
      extractPreferenceSignals([...events, events[0] as PreferenceEvent], { resolver }),
    ).toThrow(NodeSlidePreferenceExtractionError);
    try {
      extractPreferenceSignals([...events, events[0] as PreferenceEvent], { resolver });
    } catch (error) {
      expect(error).toMatchObject({ code: 'event_limit_exceeded' });
    }
  });

  it('replays in any input order with identical receipts and no duplicate signals', () => {
    const resolver = new FixtureResolver();
    putDeckVersion(resolver, { acceptedPatchIds: ['patch-replay'] });
    putVariationChain(resolver, {
      variationId: 'variation-replay',
      batchId: 'batch-replay',
      traceId: 'trace-replay',
      patchId: 'patch-replay',
    });
    putReadyExport(resolver, 'export-replay');
    const selected = event('variation_selected', {
      id: 'event-replay-selected',
      occurredAt: 10,
      provenance: {
        deckVersion: 2,
        variationId: 'variation-replay',
        variationBatchId: 'batch-replay',
        patchId: 'patch-replay',
        traceId: 'trace-replay',
      },
    });
    const exported = event('export_completed', {
      id: 'event-replay-exported',
      occurredAt: 20,
      scope: { kind: 'deck', deckId: DECK_ID },
      provenance: { deckVersion: 2, exportId: 'export-replay' },
      attributes: { exportFormat: 'pptx' },
    });
    const forward = extractPreferenceSignals([selected, exported], { resolver });
    const reverse = extractPreferenceSignals([exported, selected], { resolver });
    expect(reverse).toEqual(forward);

    const withRetry = extractPreferenceSignals([selected, exported, { ...selected }], { resolver });
    expect(withRetry.signals).toEqual(forward.signals);
    expect(new Set(withRetry.signals.map((signal) => signal.id)).size).toBe(
      withRetry.signals.length,
    );
    expect(withRetry.diagnostics.duplicateEvents).toBe(1);
    expect(forward.signals.find((signal) => signal.dimension === 'content_angle')?.id).toBe(
      nodeslidePreferenceSignalId({
        tenantId: TENANT_ID,
        actorId: ACTOR_ID,
        polarity: 'positive',
        scope: SLIDE_SCOPE,
        dimension: 'content_angle',
        value: 'data_led',
      }),
    );
  });

  it('rejects conflicting payloads that reuse one deterministic event ID', () => {
    const first = event('patch_declined', {
      id: 'event-conflict',
      provenance: { deckVersion: 2, traceId: 'trace-a' },
    });
    const second = { ...first, provenance: { deckVersion: 2, traceId: 'trace-b' } };
    const result = extractPreferenceSignals([first, second]);
    expect(result.signals).toEqual([]);
    expect(result.inputRejections).toEqual([
      { eventId: 'event-conflict', rejectionCodes: ['conflicting_event_id'] },
    ]);
  });
});
