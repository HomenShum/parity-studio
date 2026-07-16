import { describe, expect, it } from 'vitest';
import {
  type DeckSnapshot,
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
  type PatchOperation,
  type PatchScope,
  type Slide,
  type SlideElement,
  type SourceRecord,
} from '../../shared/nodeslide';
import {
  evaluateNodeSlideSemanticCoverage,
  materializeNodeSlideCandidate,
} from './nodeslideCandidate';
import { evaluateNodeSlideDeckCi, nodeSlideDeckCiAllowsAutoCommit } from './nodeslideDeckCi';

const NOW = 1_800_000_000_000;
const STALE_AFTER_MS = 10_000;

describe('NodeSlide Deck CI', () => {
  it('passes a validation-clean deck with fresh, ready, source-bound evidence', () => {
    const result = evaluateNodeSlideDeckCi(snapshot(), options());

    expect(result.status).toBe('pass');
    expect(result.checks).toEqual([]);
    expect(result.blockerCount).toBe(0);
    expect(result.severityCounts).toEqual({ critical: 0, error: 0, warning: 0, info: 0 });
    expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.validation).toMatchObject({ ok: true, publishOk: true, cleanOk: true });
    expect(nodeSlideDeckCiAllowsAutoCommit(result)).toBe(true);
  });

  it('fails closed on stale, failed, unsupported, and missing evidence plus hook blockers', () => {
    const candidate = snapshot();
    const secondary = requiredSource(candidate, 'source-secondary');
    secondary.status = 'failed';
    secondary.retrievedAt = NOW - STALE_AFTER_MS - 1;
    const claim = requiredElement(candidate, 'opening-copy');
    claim.content = 'Revenue reached 10 million in 2025.';
    claim.role = 'metric';
    claim.sourceIds = [];
    const chart = requiredElement(candidate, 'evidence-chart');
    if (!chart.chart) throw new Error('Expected chart fixture.');
    chart.sourceIds = ['source-missing'];
    chart.chart.sourceId = 'source-missing';

    const result = evaluateNodeSlideDeckCi(candidate, {
      ...options(),
      layoutStructureChecks: [
        {
          code: 'render_overlap',
          status: 'fail',
          message: 'Rendered labels overlap.',
          slideIds: ['slide-evidence'],
          elementIds: ['evidence-chart'],
        },
      ],
      exportReadinessChecks: [
        {
          code: 'pptx_fallback_missing',
          status: 'fail',
          message: 'The PPTX renderer has no editable fallback.',
          slideIds: ['slide-close'],
        },
      ],
    });

    expect(result.status).toBe('fail');
    expect(result.blockerCount).toBeGreaterThanOrEqual(5);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        'source_stale',
        'source_failed',
        'unsupported_consequential_claim',
        'source_reference_missing',
        'render_overlap',
        'pptx_fallback_missing',
      ]),
    );
    expect(result.affectedSlideIds).toEqual(
      expect.arrayContaining(['slide-opening', 'slide-evidence', 'slide-proof', 'slide-close']),
    );
    expect(result.affectedElementIds).toEqual(
      expect.arrayContaining(['opening-copy', 'evidence-chart', 'proof-formula']),
    );
    expect(result.affectedSourceIds).toEqual(
      expect.arrayContaining(['source-secondary', 'source-missing']),
    );
    expect(nodeSlideDeckCiAllowsAutoCommit(result)).toBe(false);
  });

  it('returns warnings without blockers for refreshing evidence and advisory hooks', () => {
    const candidate = snapshot();
    requiredSource(candidate, 'source-primary').status = 'refreshing';

    const result = evaluateNodeSlideDeckCi(candidate, {
      ...options(),
      exportReadinessChecks: [
        {
          code: 'pdf_font_substitution',
          status: 'warning',
          message: 'The PDF renderer substituted one font.',
          slideIds: ['slide-evidence'],
        },
      ],
    });

    expect(result.status).toBe('warn');
    expect(result.blockerCount).toBe(0);
    expect(result.severityCounts.warning).toBe(2);
    expect(codes(result)).toEqual(
      expect.arrayContaining(['source_refreshing', 'pdf_font_substitution']),
    );
    expect(nodeSlideDeckCiAllowsAutoCommit(result)).toBe(false);
  });

  it('fails the Turbo gate closed when a receipt is internally inconsistent', () => {
    const clean = evaluateNodeSlideDeckCi(snapshot(), options());

    expect(nodeSlideDeckCiAllowsAutoCommit({ ...clean, blockerCount: 1 })).toBe(false);
    expect(
      nodeSlideDeckCiAllowsAutoCommit({
        ...clean,
        validation: { ...clean.validation, cleanOk: false },
      }),
    ).toBe(false);
  });

  it('fails Deck CI and Turbo for an under-covered candidate bound to an exact receipt', () => {
    const base = snapshot();
    const target = requiredElement(base, 'opening-copy');
    const scope: PatchScope = {
      kind: 'slide',
      deckId: base.deck.id,
      slideIds: ['slide-opening'],
      operationMode: 'unrestricted',
    };
    const operations: PatchOperation[] = [
      {
        op: 'move',
        slideId: target.slideId,
        elementId: target.id,
        x: target.bbox.x + 0.01,
        y: target.bbox.y,
      },
    ];
    const semanticCoverage = evaluateNodeSlideSemanticCoverage({
      snapshot: base,
      instruction: 'Rewrite the headline and body copy on slide 1.',
      scope,
      operations,
      focusSlideId: 'slide-opening',
    });
    const candidate = materializeNodeSlideCandidate(base, { scope, operations }, NOW);

    const result = evaluateNodeSlideDeckCi(candidate, {
      ...options(),
      semanticCoverage,
    });

    expect(semanticCoverage.status).toBe('blocked');
    expect(result.status).toBe('fail');
    expect(codes(result)).toContain('semantic_coverage_undercovered');
    expect(nodeSlideDeckCiAllowsAutoCommit(result)).toBe(false);
  });

  it('fails Deck CI closed when semantic coverage belongs to a different candidate', () => {
    const base = snapshot();
    const target = requiredElement(base, 'opening-copy');
    const scope: PatchScope = {
      kind: 'elements',
      deckId: base.deck.id,
      slideIds: [target.slideId],
      elementIds: [target.id],
      operationMode: 'copy',
    };
    const operations: PatchOperation[] = [
      {
        op: 'replace_text',
        slideId: target.slideId,
        elementId: target.id,
        text: 'Updated opening copy.',
      },
    ];
    const receipt = evaluateNodeSlideSemanticCoverage({
      snapshot: base,
      instruction: 'Rewrite the selected text.',
      scope,
      operations,
    });

    const result = evaluateNodeSlideDeckCi(base, { ...options(), semanticCoverage: receipt });

    expect(result.status).toBe('fail');
    expect(codes(result)).toContain('semantic_coverage_receipt_mismatch');
    expect(nodeSlideDeckCiAllowsAutoCommit(result)).toBe(false);
  });

  it('produces a deterministic digest and does not mutate its inputs', () => {
    const candidate = snapshot();
    const before = structuredClone(candidate);
    const first = evaluateNodeSlideDeckCi(candidate, options());
    const second = evaluateNodeSlideDeckCi(structuredClone(candidate), options());

    expect(first).toEqual(second);
    expect(first.digest).toBe(second.digest);
    expect(candidate).toEqual(before);
  });

  it('scopes a changed source to only the slides and elements bound to that source', () => {
    const result = evaluateNodeSlideDeckCi(snapshot(), {
      ...options(),
      changedSourceIds: ['source-primary'],
    });

    expect(result.status).toBe('pass');
    expect(result.changedSourceImpact).toEqual({
      changedSourceIds: ['source-primary'],
      boundSourceIds: ['source-primary'],
      unboundSourceIds: [],
      missingSourceIds: [],
      slideIds: ['slide-evidence'],
      elementIds: ['evidence-chart'],
    });
    expect(result.changedSourceImpact.slideIds).not.toContain('slide-proof');
    expect(result.changedSourceImpact.slideIds).not.toContain('slide-close');
  });
});

function options() {
  return {
    referenceTime: NOW,
    semantic: { sourceStaleAfterMs: STALE_AFTER_MS },
  } as const;
}

function snapshot(): DeckSnapshot {
  const slides: Slide[] = [
    slide('slide-opening', 'Opening decision', 'Opening / 01', 'Narrative opening.'),
    slide('slide-evidence', 'Measured evidence', 'Evidence / 02', 'Source: official dataset.'),
    slide('slide-proof', 'Transparent proof', 'Proof / 03', 'Source: calculation inputs.'),
    slide('slide-close', 'Reviewable close', 'Close / 04', 'Narrative close.'),
  ];
  const elements: SlideElement[] = [
    text('opening-copy', 'slide-opening', 'A reversible decision opens the story.'),
    chart('evidence-chart', 'slide-evidence'),
    math('proof-formula', 'slide-proof'),
    text('close-copy', 'slide-close', 'The audience retains an editable next step.'),
  ];
  for (const item of slides) {
    item.elementOrder = elements
      .filter((element) => element.slideId === item.id)
      .map((element) => element.id);
  }
  return {
    deck: {
      schemaVersion: NODESLIDE_SCHEMA_VERSION,
      toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
      id: 'deck-ci-test',
      projectId: 'project-ci-test',
      title: 'Deck CI proof',
      brief: {
        prompt: 'Build a reviewable evidence story.',
        audience: 'Reviewers',
        purpose: 'Exercise Deck CI',
        successCriteria: ['Keep evidence source-bound'],
      },
      theme: {
        id: 'ci-theme',
        name: 'CI theme',
        mode: 'light',
        colors: {
          canvas: '#ffffff',
          ink: '#111111',
          muted: '#555555',
          accent: '#3355aa',
          accentSoft: '#eef2ff',
          insight: '#eef8f1',
          insightInk: '#16442d',
          trace: '#6655cc',
          border: '#dddddd',
        },
        typography: { display: 'serif', body: 'sans-serif', data: 'monospace' },
        defaultRadius: 8,
        spacingUnit: 8,
      },
      slideOrder: slides.map((item) => item.id),
      version: 1,
      status: 'draft',
      createdAt: NOW - 1_000,
      updatedAt: NOW - 100,
    },
    slides,
    elements,
    sources: [
      source('source-primary', 'Official dataset'),
      source('source-secondary', 'Calculation inputs'),
    ],
  };
}

function slide(id: string, title: string, section: string, notes: string): Slide {
  return {
    id,
    deckId: 'deck-ci-test',
    title,
    section,
    notes,
    background: '#ffffff',
    elementOrder: [],
    version: 1,
  };
}

function baseElement(id: string, slideId: string): Omit<SlideElement, 'kind'> {
  return {
    id,
    slideId,
    name: id,
    bbox: { x: 0.1, y: 0.15, width: 0.8, height: 0.6 },
    rotation: 0,
    style: { color: '#111111', fontSize: 20 },
    sourceIds: [],
    locked: false,
    exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
    version: 1,
  };
}

function text(id: string, slideId: string, content: string): SlideElement {
  return { ...baseElement(id, slideId), kind: 'text', content };
}

function chart(id: string, slideId: string): SlideElement {
  return {
    ...baseElement(id, slideId),
    kind: 'chart',
    sourceIds: ['source-primary'],
    chart: {
      chartType: 'bar',
      labels: ['2024', '2025'],
      series: [{ name: 'Revenue', values: [8, 10] }],
      unit: 'million USD',
      sourceId: 'source-primary',
    },
  };
}

function math(id: string, slideId: string): SlideElement {
  return {
    ...baseElement(id, slideId),
    kind: 'math',
    content: '10 / 2 = 5',
    sourceIds: ['source-secondary'],
    math: {
      expression: 'revenue / customers',
      display: '10 / 2 = 5',
      variables: [
        { label: 'revenue', value: 10 },
        { label: 'customers', value: 2 },
      ],
      sourceId: 'source-secondary',
    },
  };
}

function source(id: string, title: string): SourceRecord {
  return {
    id,
    deckId: 'deck-ci-test',
    title,
    url: `https://example.test/${id}`,
    sourceType: 'url',
    retrievedAt: NOW - 100,
    citation: `${title}, official publication.`,
    status: 'ready',
  };
}

function requiredSource(candidate: DeckSnapshot, id: string): SourceRecord {
  const item = candidate.sources.find((source) => source.id === id);
  if (!item) throw new Error(`Expected source ${id}.`);
  return item;
}

function requiredElement(candidate: DeckSnapshot, id: string): SlideElement {
  const item = candidate.elements.find((element) => element.id === id);
  if (!item) throw new Error(`Expected element ${id}.`);
  return item;
}

function codes(result: ReturnType<typeof evaluateNodeSlideDeckCi>): string[] {
  return result.checks.map((check) => check.code);
}
