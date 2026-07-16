import { describe, expect, it } from 'vitest';
import type { DeckSnapshot, SlideElement } from './nodeslide';
import { createDefaultNodeSlideAuthoringPolicy } from './nodeslideAuthoringPolicy';
import {
  evaluateNodeSlidePresentationQuality,
  verifyNodeSlidePresentationQualityReceipt,
} from './nodeslideAuthoringQuality';

describe('NodeSlide presentation quality', () => {
  it('fails a generic repetitive sample with decorative metrics and no journey proof', () => {
    const result = evaluateNodeSlidePresentationQuality(snapshot({ generic: true }), {
      policy: createDefaultNodeSlideAuthoringPolicy(),
    });
    expect(result.status).toBe('fail');
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['generic_slide_titles', 'decorative_chart', 'journey_proof_missing']),
    );
    expect(verifyNodeSlidePresentationQualityReceipt(result)).toBe(true);
  });

  it('keeps the quality receipt deterministic and tamper-evident', () => {
    const policy = createDefaultNodeSlideAuthoringPolicy();
    policy.requireJourneyProof = false;
    policy.requireReferenceComparison = false;
    const first = evaluateNodeSlidePresentationQuality(snapshot({ generic: false }), {
      policy: { ...policy, digest: createDefaultNodeSlideAuthoringPolicy().digest },
      requireJourneyProof: false,
    });
    const second = evaluateNodeSlidePresentationQuality(snapshot({ generic: false }), {
      policy: { ...policy, digest: createDefaultNodeSlideAuthoringPolicy().digest },
      requireJourneyProof: false,
    });
    expect(first.digest).toBe(second.digest);
    first.scores.overall = 100;
    expect(verifyNodeSlidePresentationQualityReceipt(first)).toBe(false);
  });
});

function snapshot(options: { generic: boolean }): DeckSnapshot {
  const slides = [1, 2, 3, 4, 5].map((number) => ({
    id: `slide:${number}`,
    deckId: 'deck:1',
    title: options.generic
      ? (['Overview', 'Problem', 'Workflow', 'Quality', 'Next steps'][number - 1] ?? '')
      : ([
          'Governed authoring makes the decision inspectable',
          'Static handoffs break the evidence chain',
          'Every requested change becomes a bounded proposal',
          'Live receipts prove the version boundary',
          'Adopt the governed authoring workflow now',
        ][number - 1] ?? ''),
    background: '#fff',
    elementOrder: [`headline:${number}`, `body:${number}`],
    version: 1,
  }));
  const elements: SlideElement[] = slides.flatMap((slide, index) => [
    text(slide.id, `headline:${index + 1}`, 'Headline', slide.title, 40, 0.1),
    text(
      slide.id,
      `body:${index + 1}`,
      'Body copy',
      options.generic
        ? 'A generic description of the product.'
        : 'A concrete explanation tied to the audience decision.',
      20,
      0.45,
    ),
    ...(index === 3
      ? [
          {
            id: 'chart:4',
            slideId: slide.id,
            name: 'Proof chart',
            kind: 'chart' as const,
            bbox: { x: 0.55, y: 0.35, width: 0.35, height: 0.35 },
            rotation: 0,
            style: {},
            chart: {
              chartType: 'bar' as const,
              labels: ['A', 'B', 'C'],
              series: [{ name: 'Proof', values: options.generic ? [1, 1, 1] : [1, 2, 3] }],
              ...(options.generic ? {} : { unit: 'tests', sourceId: 'source:1' }),
            },
            sourceIds: options.generic ? [] : ['source:1'],
            locked: false,
            exportCapabilities: ['pptx_editable' as const],
            version: 1,
          },
        ]
      : []),
  ]);
  return {
    deck: {
      schemaVersion: 'nodeslide.slidelang/v1',
      toolchainVersion: 'local-slidelang-adapter/1.1.0',
      id: 'deck:1',
      projectId: 'project:1',
      title: 'NodeSlide proof',
      brief: {
        prompt: 'Prove governed authoring.',
        audience: 'Product and engineering leaders',
        purpose: 'Approve the governed NodeSlide authoring workflow.',
        successCriteria: ['Approve Phase 0'],
      },
      theme: {
        id: 'theme:1',
        name: 'Proof',
        mode: 'light',
        colors: {
          canvas: '#fff',
          ink: '#111',
          muted: '#666',
          accent: '#f60',
          accentSoft: '#fee',
          insight: '#def',
          insightInk: '#123',
          trace: '#345',
          border: '#ddd',
        },
        typography: { display: 'Inter', body: 'Inter', data: 'Mono' },
        defaultRadius: 0,
        spacingUnit: 8,
      },
      slideOrder: slides.map((slide) => slide.id),
      version: 1,
      status: 'ready',
      createdAt: 1,
      updatedAt: 1,
    },
    slides,
    elements,
    sources: options.generic
      ? []
      : [
          {
            id: 'source:1',
            deckId: 'deck:1',
            title: 'Run receipt',
            sourceType: 'internal',
            retrievedAt: 1,
            citation: 'run receipt',
            status: 'ready',
          },
        ],
  };
}

function text(
  slideId: string,
  id: string,
  name: string,
  content: string,
  fontSize: number,
  y: number,
): SlideElement {
  return {
    id,
    slideId,
    name,
    kind: 'text',
    role: name.toLowerCase(),
    bbox: { x: 0.1, y, width: 0.8, height: 0.2 },
    rotation: 0,
    content,
    style: { fontSize },
    sourceIds: [],
    locked: false,
    exportCapabilities: ['pptx_editable'],
    version: 1,
  };
}
