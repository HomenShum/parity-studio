import { describe, expect, it } from 'vitest';
import type { PatchOperation } from '../../shared/nodeslide';
import { traceFromRow } from './nodeslideData';
import { validateNodeSlidePatch } from './nodeslidePatches';
import { buildGoldenNodeSlide } from './nodeslideSeed';
import { buildNodeSlideSourceLineage, nodeSlideOperationSourceIds } from './nodeslideSourceLineage';

const textOperation: PatchOperation = {
  op: 'replace_text',
  slideId: 'slide-1',
  elementId: 'headline-1',
  text: 'Attendance reached 3.4 million.',
  sourceIds: ['source-fifa'],
};

const unboundTextOperation: PatchOperation = {
  op: 'replace_text',
  slideId: 'slide-1',
  elementId: 'headline-1',
  text: 'Attendance reached 3.4 million.',
};

const chartOperation: PatchOperation = {
  op: 'update_chart',
  slideId: 'slide-2',
  elementId: 'chart-1',
  chart: {
    chartType: 'bar',
    labels: ['2018', '2022'],
    series: [{ name: 'Attendance', values: [3_031_768, 3_404_252] }],
    sourceId: 'source-fifa',
  },
};

describe('NodeSlide claim-level source lineage', () => {
  it('materializes deterministic element-level bindings for factual text and charts', () => {
    const first = buildNodeSlideSourceLineage({
      operations: [
        textOperation,
        { op: 'move', slideId: 'slide-1', elementId: 'headline-1', x: 0.1, y: 0.2 },
        chartOperation,
      ],
      authorizedSourceIds: ['source-fifa'],
      policy: 'required_external_evidence',
    });
    const second = buildNodeSlideSourceLineage({
      operations: [
        textOperation,
        { op: 'move', slideId: 'slide-1', elementId: 'headline-1', x: 0.1, y: 0.2 },
        chartOperation,
      ],
      authorizedSourceIds: ['source-fifa'],
      policy: 'required_external_evidence',
    });

    expect(first).toEqual(second);
    expect(first.sourceBindingStatus).toBe('bound');
    expect(first.claimSourceBindings).toEqual([
      expect.objectContaining({
        operationIndex: 0,
        operation: 'replace_text',
        slideId: 'slide-1',
        elementId: 'headline-1',
        sourceIds: ['source-fifa'],
        claimDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
      expect.objectContaining({
        operationIndex: 2,
        operation: 'update_chart',
        slideId: 'slide-2',
        elementId: 'chart-1',
        sourceIds: ['source-fifa'],
        claimDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);
    expect(nodeSlideOperationSourceIds([textOperation, chartOperation])).toEqual(['source-fifa']);
  });

  it('rejects missing, unauthorized, and duplicate factual bindings', () => {
    expect(() =>
      buildNodeSlideSourceLineage({
        operations: [unboundTextOperation],
        authorizedSourceIds: ['source-fifa'],
        policy: 'required_external_evidence',
      }),
    ).toThrow('missing a required source binding');
    expect(() =>
      buildNodeSlideSourceLineage({
        operations: [{ ...textOperation, sourceIds: ['source-other'] }],
        authorizedSourceIds: ['source-fifa'],
        policy: 'required_external_evidence',
      }),
    ).toThrow('invalid or unauthorized');
    expect(() =>
      buildNodeSlideSourceLineage({
        operations: [{ ...textOperation, sourceIds: ['source-fifa', 'source-fifa'] }],
        authorizedSourceIds: ['source-fifa'],
        policy: 'required_external_evidence',
      }),
    ).toThrow('invalid or unauthorized');
    expect(() =>
      buildNodeSlideSourceLineage({
        operations: [
          {
            op: 'update_slide',
            slideId: 'slide-1',
            properties: { notes: 'A new factual assertion.' },
          },
        ],
        authorizedSourceIds: ['source-fifa'],
        policy: 'required_external_evidence',
      }),
    ).toThrow('missing a required source binding');
  });

  it('keeps deterministic and editorial copy/style/layout operations backward compatible', () => {
    const lineage = buildNodeSlideSourceLineage({
      operations: [
        unboundTextOperation,
        {
          op: 'update_style',
          slideId: 'slide-1',
          elementId: 'headline-1',
          properties: { fontWeight: 700 },
        },
      ],
      authorizedSourceIds: [],
      policy: 'not_applicable',
    });

    expect(lineage).toEqual({
      sourceBindingStatus: 'not_applicable',
      claimSourceBindings: [],
    });
  });

  it('revalidates source existence inside the exact server-side patch candidate', () => {
    const snapshot = buildGoldenNodeSlide('source-lineage-candidate', 1_700_000_000_000).snapshot;
    const element = snapshot.elements.find(
      (candidate) => candidate.kind === 'text' && !candidate.locked,
    );
    const slide = snapshot.slides.find((candidate) => candidate.id === element?.slideId);
    const source = snapshot.sources[0];
    if (!element || !slide || !source) throw new Error('Expected bounded source-lineage fixtures.');
    const basePatch = {
      deckId: snapshot.deck.id,
      baseDeckVersion: snapshot.deck.version,
      baseSlideVersions: { [slide.id]: slide.version },
      baseElementVersions: { [element.id]: element.version },
      scope: {
        kind: 'elements' as const,
        deckId: snapshot.deck.id,
        slideIds: [slide.id],
        elementIds: [element.id],
        operationMode: 'copy' as const,
      },
    };

    expect(
      validateNodeSlidePatch(snapshot, {
        ...basePatch,
        operations: [
          {
            op: 'replace_text',
            slideId: slide.id,
            elementId: element.id,
            text: 'A source-bound factual replacement.',
            sourceIds: ['source-outside-deck'],
          },
        ],
      }),
    ).toContain(`replace_text on ${element.id} has an invalid source binding.`);
    expect(
      validateNodeSlidePatch(snapshot, {
        ...basePatch,
        operations: [
          {
            op: 'replace_text',
            slideId: slide.id,
            elementId: element.id,
            text: 'A source-bound factual replacement.',
            sourceIds: [source.id],
          },
        ],
      }),
    ).toEqual([]);
  });

  it('hydrates legacy trace evidence as unavailable instead of fabricating a binding', () => {
    const trace = traceFromRow({
      id: 'trace-legacy',
      deckId: 'deck-1',
      status: 'completed',
      summary: 'Legacy trace',
      plan: [],
      context: [],
      toolCalls: [],
      guardrails: [],
      createdAt: 1,
    } as never);

    expect(trace.sourceBindingStatus).toBe('legacy_unavailable');
    expect(trace.claimSourceBindings).toEqual([]);
  });
});
