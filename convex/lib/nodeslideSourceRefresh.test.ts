import { describe, expect, it } from 'vitest';
import type {
  DeckSnapshot,
  NodeSlideClaimSourceBinding,
  Slide,
  SlideElement,
  SourceRecord,
} from '../../shared/nodeslide';
import {
  NODESLIDE_SOURCE_REFRESH_BATCH_LIMIT,
  detectNodeSlideSourceChange,
  nodeSlideSourceLogicalRevision,
  planNodeSlideSourceRefresh,
} from './nodeslideSourceRefresh';

const SOURCE_A = 'source-a';
const SOURCE_B = 'source-b';

describe('NodeSlide source refresh planning', () => {
  it('models immutable logical revisions and deterministic no-change descriptors', () => {
    const before = source(SOURCE_A);
    const after = { ...before, columns: [...(before.columns ?? [])] };
    const beforeCopy = structuredClone(before);
    const afterCopy = structuredClone(after);

    const first = detectNodeSlideSourceChange({ before, after });
    const second = detectNodeSlideSourceChange({ before: after, after: before });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      kind: 'unchanged',
      logicalSourceId: SOURCE_A,
      changedFields: [],
      material: false,
      affectedSourceIds: [],
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(nodeSlideSourceLogicalRevision(before)).toMatchObject({
      sourceId: SOURCE_A,
      revisionId: expect.stringMatching(/^source-revision:sha256:[0-9a-f]{64}$/),
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(before).toEqual(beforeCopy);
    expect(after).toEqual(afterCopy);
  });

  it('isolates exact slide, element, primitive, and claim bindings from unrelated sources', () => {
    const snapshot = deckSnapshot([
      element('b-direct', 'slide-b', [SOURCE_A]),
      element('b-unrelated', 'slide-b', [SOURCE_B]),
      element('a-claim-only', 'slide-a'),
      element('a-chart', 'slide-a', [], {
        chart: {
          chartType: 'bar',
          labels: ['Q1'],
          series: [{ name: 'Revenue', values: [10] }],
          sourceId: SOURCE_A,
        },
      }),
      element('c-unrelated', 'slide-c', [SOURCE_B]),
    ]);
    const claims: NodeSlideClaimSourceBinding[] = [
      claim('a-claim-only', 'slide-a', SOURCE_A, 'sha256:claim-a', 4),
      claim('b-unrelated', 'slide-b', SOURCE_B, 'sha256:claim-b', 2),
    ];

    const plan = planNodeSlideSourceRefresh({
      snapshot,
      before: source(SOURCE_A),
      after: source(SOURCE_A, { contentDigest: 'sha256:new-content', rowCount: 20 }),
      claimSourceBindings: claims,
    });

    expect(plan.change).toMatchObject({
      kind: 'updated',
      changedFields: ['contentDigest', 'rowCount'],
      material: true,
      affectedSourceIds: [SOURCE_A],
    });
    expect(plan.affectedSlides.map((slide) => slide.slideId)).toEqual(['slide-b', 'slide-a']);
    expect(plan.affectedElements.map((affected) => affected.elementId)).toEqual([
      'b-direct',
      'a-claim-only',
      'a-chart',
    ]);
    expect(plan.affectedClaims).toEqual([
      expect.objectContaining({
        slideId: 'slide-a',
        elementId: 'a-claim-only',
        matchedSourceIds: [SOURCE_A],
        claimDigest: 'sha256:claim-a',
      }),
    ]);
    expect(plan.affectedElements.find((item) => item.elementId === 'a-claim-only')).toMatchObject({
      sourceIds: [SOURCE_A],
      claimDigests: ['sha256:claim-a'],
      reasons: ['claim_source_binding'],
    });
    expect(plan.affectedElements.find((item) => item.elementId === 'a-chart')).toMatchObject({
      sourceIds: [SOURCE_A],
      reasons: ['element_source_binding'],
    });
    expect(plan.affectedElements.map((affected) => affected.elementId)).not.toContain(
      'b-unrelated',
    );
    expect(plan.affectedSlides.map((affected) => affected.slideId)).not.toContain('slide-c');
  });

  it('emits deterministic batches with no more than eight proposal operations', () => {
    const elements = Array.from({ length: 19 }, (_, index) =>
      element(`element-${index.toString().padStart(2, '0')}`, 'slide-a', [SOURCE_A]),
    );
    const snapshot = deckSnapshot(elements);
    const input = {
      snapshot,
      before: source(SOURCE_A),
      after: source(SOURCE_A, { citation: 'Updated citation' }),
    };

    const first = planNodeSlideSourceRefresh(input);
    const second = planNodeSlideSourceRefresh({
      ...input,
      snapshot: { ...snapshot, elements: [...snapshot.elements].reverse() },
    });

    expect(first.operationCount).toBe(19);
    expect(first.batches.map((batch) => batch.operations.length)).toEqual([8, 8, 3]);
    expect(
      first.batches.every(
        (batch) => batch.operations.length <= NODESLIDE_SOURCE_REFRESH_BATCH_LIMIT,
      ),
    ).toBe(true);
    expect(first.digest).toBe(second.digest);
    expect(first.batches).toEqual(second.batches);
    expect(
      first.batches.flatMap((batch) => batch.operations).map((item) => item.elementId),
    ).toEqual(elements.map((item) => item.id));
  });

  it('supports explicit replacement and supersession while rejecting ambiguous source pairs', () => {
    const snapshot = deckSnapshot([
      element('old-binding', 'slide-a', [SOURCE_A]),
      element('new-binding', 'slide-a', [SOURCE_B]),
    ]);
    const replacement = planNodeSlideSourceRefresh({
      snapshot,
      before: source(SOURCE_A),
      after: source(SOURCE_B, { title: 'Replacement source' }),
      transitionHint: {
        kind: 'replacement',
        beforeSourceId: SOURCE_A,
        afterSourceId: SOURCE_B,
        reason: 'Publisher moved the canonical dataset',
      },
    });

    expect(replacement.change).toMatchObject({
      kind: 'replaced',
      affectedSourceIds: [SOURCE_A, SOURCE_B],
      reason: 'Replacement: Publisher moved the canonical dataset.',
    });
    expect(replacement.affectedElements.map((item) => item.elementId)).toEqual([
      'old-binding',
      'new-binding',
    ]);
    expect(
      replacement.batches
        .flatMap((batch) => batch.operations)
        .every((operation) => operation.replacementSourceId === SOURCE_B),
    ).toBe(true);

    const supersession = detectNodeSlideSourceChange({
      before: source(SOURCE_A),
      after: source(SOURCE_B),
      transitionHint: {
        kind: 'supersession',
        beforeSourceId: SOURCE_A,
        afterSourceId: SOURCE_B,
      },
    });
    expect(supersession.kind).toBe('superseded');

    expect(() =>
      detectNodeSlideSourceChange({ before: source(SOURCE_A), after: source(SOURCE_B) }),
    ).toThrow('explicit replacement or supersession hint');
    expect(() =>
      detectNodeSlideSourceChange({
        before: source(SOURCE_A),
        after: source(SOURCE_B),
        transitionHint: {
          kind: 'replacement',
          beforeSourceId: SOURCE_B,
          afterSourceId: SOURCE_A,
        },
      }),
    ).toThrow('must exactly match');
  });

  it('records timestamp-only revisions without scheduling stale-content work', () => {
    const before = source(SOURCE_A);
    const plan = planNodeSlideSourceRefresh({
      snapshot: deckSnapshot([element('bound', 'slide-a', [SOURCE_A])]),
      before,
      after: {
        ...before,
        retrievedAt: before.retrievedAt + 1_000,
        lastRefreshedAt: (before.lastRefreshedAt ?? before.retrievedAt) + 1_000,
      },
    });

    expect(plan.change).toMatchObject({
      kind: 'updated',
      changedFields: ['retrievedAt', 'lastRefreshedAt'],
      material: false,
      affectedSourceIds: [],
    });
    expect(plan.affectedSlides).toEqual([]);
    expect(plan.affectedElements).toEqual([]);
    expect(plan.affectedClaims).toEqual([]);
    expect(plan.batches).toEqual([]);
    expect(plan.operationCount).toBe(0);
    expect(plan.reason).toContain('No refresh operations were planned');
  });

  it('plans creation/removal only for bound sources and rejects cross-deck planning', () => {
    const snapshot = deckSnapshot([element('bound', 'slide-a', [SOURCE_A])]);
    const removed = planNodeSlideSourceRefresh({
      snapshot,
      before: source(SOURCE_A),
      after: null,
    });
    const unrelatedCreation = planNodeSlideSourceRefresh({
      snapshot,
      before: null,
      after: source(SOURCE_B),
    });

    expect(removed.change.kind).toBe('removed');
    expect(removed.affectedElements.map((item) => item.elementId)).toEqual(['bound']);
    expect(unrelatedCreation.change.kind).toBe('created');
    expect(unrelatedCreation.affectedElements).toEqual([]);
    expect(unrelatedCreation.batches).toEqual([]);

    expect(() =>
      planNodeSlideSourceRefresh({
        snapshot,
        before: source(SOURCE_A, { deckId: 'another-deck' }),
        after: null,
      }),
    ).toThrow('restricted to the snapshot deck');
  });

  it('ignores duplicate and stale claim bindings deterministically', () => {
    const snapshot = deckSnapshot([element('bound', 'slide-a')]);
    const validClaim = claim('bound', 'slide-a', SOURCE_A, 'sha256:claim', 1);
    const plan = planNodeSlideSourceRefresh({
      snapshot,
      before: source(SOURCE_A),
      after: source(SOURCE_A, { status: 'failed' }),
      claimSourceBindings: [
        validClaim,
        { ...validClaim },
        claim('missing-element', 'slide-a', SOURCE_A, 'sha256:stale', 2),
        claim('bound', 'missing-slide', SOURCE_A, 'sha256:stale-slide', 3),
      ],
    });

    expect(plan.affectedClaims).toHaveLength(1);
    expect(plan.affectedClaims[0]?.claimDigest).toBe('sha256:claim');
    expect(plan.affectedElements).toHaveLength(1);
    expect(plan.affectedElements[0]?.claimDigests).toEqual(['sha256:claim']);
  });
});

function source(id: string, overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id,
    deckId: 'deck-1',
    title: 'Quarterly dataset',
    url: 'https://example.com/data.csv',
    sourceType: 'spreadsheet',
    retrievedAt: 1_700_000_000_000,
    citation: 'Example Data (2026)',
    format: 'csv',
    contentDigest: 'sha256:old-content',
    byteSize: 100,
    rowCount: 10,
    columns: ['quarter', 'revenue'],
    provider: 'example',
    retention: 'until_deleted',
    status: 'ready',
    lastRefreshedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function claim(
  elementId: string,
  slideId: string,
  sourceId: string,
  claimDigest: string,
  operationIndex: number,
): NodeSlideClaimSourceBinding {
  return {
    operationIndex,
    operation: 'replace_text',
    slideId,
    elementId,
    sourceIds: [sourceId],
    claimDigest,
  };
}

function deckSnapshot(elements: SlideElement[]): DeckSnapshot {
  const slides = ['slide-b', 'slide-a', 'slide-c'].map((id) =>
    slide(
      id,
      elements.filter((candidate) => candidate.slideId === id).map((candidate) => candidate.id),
    ),
  );
  return {
    deck: {
      id: 'deck-1',
      slideOrder: slides.map((candidate) => candidate.id),
    } as DeckSnapshot['deck'],
    slides,
    elements,
    sources: [source(SOURCE_A), source(SOURCE_B)],
  };
}

function slide(id: string, elementOrder: string[]): Slide {
  return {
    id,
    deckId: 'deck-1',
    title: id,
    background: '#ffffff',
    elementOrder,
    version: 1,
  };
}

function element(
  id: string,
  slideId: string,
  sourceIds: string[] = [],
  extra: Partial<SlideElement> = {},
): SlideElement {
  return {
    id,
    slideId,
    name: id,
    kind: extra.chart ? 'chart' : 'text',
    bbox: { x: 0, y: 0, width: 0.5, height: 0.2 },
    rotation: 0,
    content: id,
    style: {},
    sourceIds,
    locked: false,
    exportCapabilities: ['web_native'],
    version: 1,
    ...extra,
  };
}
