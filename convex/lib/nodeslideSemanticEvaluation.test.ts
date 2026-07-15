import { describe, expect, it } from 'vitest';
import {
  type DeckSnapshot,
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
  type SlideElement,
  type SourceRecord,
} from '../../shared/nodeslide';
import type { NodeSlideDeckSpec } from './nodeslideSeed';
import {
  type NodeSlideSemanticFindingCode,
  evaluateNodeSlideSemantics,
} from './nodeslideSemanticEvaluation';

const NOW = 1_800_000_000_000;
const FRESHNESS_WINDOW = 10_000;

describe('NodeSlide deterministic semantic evaluation', () => {
  it('passes a source-bound narrative with valid text, chart, math, and image primitives', () => {
    const snapshot = completeSnapshot();

    const receipt = evaluateNodeSlideSemantics(
      { kind: 'snapshot', snapshot },
      {
        evaluatedAt: NOW,
        sourceStaleAfterMs: FRESHNESS_WINDOW,
        requiredPrimitives: ['text', 'chart', 'math', 'image'],
      },
    );

    expect(receipt.outcome).toBe('passed');
    expect(receipt.ok).toBe(true);
    expect(receipt.publishOk).toBe(true);
    expect(receipt.findings).toEqual([]);
    expect(receipt.primitiveCoverage.complete).toBe(true);
    expect(receipt.primitiveCoverage.items).toMatchObject({
      text: { count: 4, malformedCount: 0, covered: true },
      chart: { count: 1, malformedCount: 0, covered: true },
      math: { count: 1, malformedCount: 0, covered: true },
      image: { count: 1, malformedCount: 0, covered: true },
    });
    expect(receipt.sourceCoverage).toEqual({
      bindingAssessable: true,
      total: 3,
      bound: 3,
      unbound: 0,
      stale: 0,
      missingReferences: 0,
    });
    expect(receipt.inputDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(receipt.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('blocks mismatched chart dimensions and malformed numeric data without dropping either finding', () => {
    const snapshot = completeSnapshot();
    const chart = requiredElement(snapshot, 'chart');
    if (!chart.chart) throw new Error('Expected chart fixture.');
    chart.chart.labels = ['2018', '2022'];
    chart.chart.series[0] = {
      name: 'Attendance',
      values: [3_031_768, Number.NaN, 'not-a-number' as never],
    };

    const receipt = evaluateNodeSlideSemantics(
      { kind: 'snapshot', snapshot },
      { evaluatedAt: NOW, sourceStaleAfterMs: FRESHNESS_WINDOW },
    );

    expect(receipt.outcome).toBe('blocked');
    expect(codes(receipt)).toEqual(
      expect.arrayContaining(['chart_label_value_mismatch', 'chart_malformed_numeric_data']),
    );
    expect(receipt.primitiveCoverage.items.chart).toMatchObject({
      count: 1,
      validCount: 0,
      malformedCount: 1,
      covered: false,
    });
  });

  it('reports repeated claims plus numeric and polarity contradictions with related locations', () => {
    const snapshot = completeSnapshot();
    const texts = snapshot.elements.filter((element) => element.kind === 'text');
    const first = texts[0];
    const second = texts[1];
    const third = texts[2];
    if (!first || !second || !third) throw new Error('Expected text fixtures.');
    first.content = 'The launch is approved. Revenue reached 10 million in 2025.';
    second.content = 'The launch is not approved. Revenue reached 10 million in 2025.';
    third.content = 'Revenue reached 12 million in 2025.';
    for (const element of [first, second, third]) element.sourceIds = ['source-data'];

    const receipt = evaluateNodeSlideSemantics(
      { kind: 'snapshot', snapshot },
      { evaluatedAt: NOW, sourceStaleAfterMs: FRESHNESS_WINDOW },
    );

    expect(receipt.outcome).toBe('blocked');
    expect(receipt.findings.filter((finding) => finding.code === 'duplicate_claim')).toHaveLength(
      1,
    );
    expect(
      receipt.findings.filter((finding) => finding.code === 'contradictory_claim'),
    ).toHaveLength(2);
    expect(
      receipt.findings
        .filter(
          (finding) => finding.code === 'duplicate_claim' || finding.code === 'contradictory_claim',
        )
        .every((finding) => finding.related.length > 0),
    ).toBe(true);
  });

  it('detects an empty story beat, a fragmented section, and an uncovered planned narrative step', () => {
    const snapshot = completeSnapshot();
    const [firstSlide, secondSlide, thirdSlide, fourthSlide] = snapshot.slides;
    if (!firstSlide || !secondSlide || !thirdSlide || !fourthSlide) {
      throw new Error('Expected four narrative slide fixtures.');
    }
    firstSlide.section = 'Evidence / opening';
    secondSlide.section = 'Decision / middle';
    thirdSlide.section = 'Evidence / return';
    fourthSlide.section = '';
    const finalText = snapshot.elements.find(
      (element) => element.slideId === 'slide-4' && element.kind === 'text',
    );
    if (!finalText) throw new Error('Expected final text fixture.');
    finalText.content = '   ';
    const spec = plannedSpec(['International expansion readiness']);

    const receipt = evaluateNodeSlideSemantics(
      { kind: 'snapshot', snapshot, spec },
      { evaluatedAt: NOW, sourceStaleAfterMs: FRESHNESS_WINDOW },
    );

    expect(receipt.outcome).toBe('blocked');
    expect(codes(receipt)).toEqual(
      expect.arrayContaining(['narrative_gap', 'orphaned_section', 'primitive_malformed']),
    );
    expect(
      receipt.findings.some(
        (finding) =>
          finding.code === 'narrative_gap' &&
          finding.message.includes('International expansion readiness'),
      ),
    ).toBe(true);
  });

  it('reports stale, unbound, missing, and failed evidence plus missing notes and disclosure', () => {
    const snapshot = completeSnapshot();
    const dataSource = snapshot.sources.find((source) => source.id === 'source-data');
    const evidenceSlide = snapshot.slides.find((slide) => slide.id === 'slide-2');
    const chart = requiredElement(snapshot, 'chart');
    if (!dataSource || !evidenceSlide || !chart.chart)
      throw new Error('Expected evidence fixtures.');
    dataSource.title = 'Illustrative example data';
    dataSource.citation = 'Demo data; replace with measured evidence before publication.';
    dataSource.retrievedAt = NOW - FRESHNESS_WINDOW - 1;
    evidenceSlide.notes = '';
    chart.chart.sourceId = 'source-missing';
    snapshot.sources.push(source('source-unbound', 'Unused research'));
    snapshot.sources.push({
      ...source('source-failed', 'Failed research'),
      status: 'failed',
    });

    const receipt = evaluateNodeSlideSemantics(
      { kind: 'snapshot', snapshot },
      { evaluatedAt: NOW, sourceStaleAfterMs: FRESHNESS_WINDOW },
    );

    expect(receipt.outcome).toBe('blocked');
    expect(codes(receipt)).toEqual(
      expect.arrayContaining([
        'source_stale',
        'source_unbound',
        'source_missing',
        'notes_missing',
        'disclosure_missing',
      ]),
    );
    expect(receipt.sourceCoverage).toMatchObject({
      total: 5,
      stale: 1,
      missingReferences: 1,
    });
    expect(
      receipt.findings.find(
        (finding) => finding.code === 'source_missing' && finding.sourceId === 'source-missing',
      ),
    ).toBeDefined();
  });

  it('makes required structured primitive coverage explicit and blocks a missing primitive', () => {
    const snapshot = completeSnapshot();
    const image = requiredElement(snapshot, 'image');
    snapshot.elements = snapshot.elements.filter((element) => element.id !== image.id);
    const imageSlide = snapshot.slides.find((slide) => slide.id === image.slideId);
    if (!imageSlide) throw new Error('Expected image slide fixture.');
    imageSlide.elementOrder = imageSlide.elementOrder.filter((id) => id !== image.id);

    const receipt = evaluateNodeSlideSemantics(
      { kind: 'snapshot', snapshot },
      {
        evaluatedAt: NOW,
        sourceStaleAfterMs: FRESHNESS_WINDOW,
        requiredPrimitives: ['text', 'chart', 'math', 'image'],
      },
    );

    expect(receipt.outcome).toBe('blocked');
    expect(receipt.primitiveCoverage.complete).toBe(false);
    expect(receipt.primitiveCoverage.items.image).toEqual({
      kind: 'image',
      required: true,
      count: 0,
      validCount: 0,
      malformedCount: 0,
      covered: false,
    });
    expect(receipt.findings).toContainEqual(
      expect.objectContaining({ code: 'primitive_missing', severity: 'error' }),
    );
  });

  it('evaluates the existing planning-spec shape while truthfully marking source binding unavailable', () => {
    const spec: NodeSlideDeckSpec = {
      title: 'Decision brief',
      narrative: ['Evidence supports the decision'],
      slides: [
        {
          title: 'Evidence supports the decision',
          section: 'Decision',
          headline: 'Evidence supports a reversible choice.',
          body: 'The team can review the structured proposal before accepting it.',
          bullets: ['Editable output', 'Human approval'],
        },
      ],
    };

    const receipt = evaluateNodeSlideSemantics(
      { kind: 'spec', spec },
      { evaluatedAt: NOW, requiredPrimitives: ['text'] },
    );

    expect(receipt.outcome).toBe('passed');
    expect(receipt.inputKind).toBe('spec');
    expect(receipt.sourceCoverage.bindingAssessable).toBe(false);
    expect(receipt.primitiveCoverage.items.text).toMatchObject({ count: 1, covered: true });
  });

  it('fails closed with explicit unsupported and inconsistent outcomes', () => {
    const unsupported = evaluateNodeSlideSemantics({ kind: 'legacy-deck' }, { evaluatedAt: NOW });
    const inconsistent = evaluateNodeSlideSemantics(
      { kind: 'snapshot', snapshot: {} },
      { evaluatedAt: NOW },
    );
    const futureSource = completeSnapshot();
    const firstSource = futureSource.sources[0];
    if (!firstSource) throw new Error('Expected a source fixture.');
    firstSource.retrievedAt = NOW + 1;
    const timeInconsistent = evaluateNodeSlideSemantics(
      { kind: 'snapshot', snapshot: futureSource },
      { evaluatedAt: NOW },
    );

    expect(unsupported).toMatchObject({
      outcome: 'unsupported',
      ok: false,
      publishOk: false,
    });
    expect(codes(unsupported)).toContain('unsupported_input');
    expect(inconsistent).toMatchObject({
      outcome: 'inconsistent',
      ok: false,
      publishOk: false,
    });
    expect(codes(inconsistent)).toContain('inconsistent_input');
    expect(timeInconsistent.outcome).toBe('inconsistent');
    expect(timeInconsistent.findings[0]?.message).toContain('after the evaluation reference time');
  });

  it('is deterministic and leaves the evaluated snapshot byte-for-byte unchanged', () => {
    const snapshot = completeSnapshot();
    const before = structuredClone(snapshot);
    const options = {
      evaluatedAt: NOW,
      sourceStaleAfterMs: FRESHNESS_WINDOW,
      requiredPrimitives: ['text', 'chart', 'math', 'image'] as const,
    };

    const first = evaluateNodeSlideSemantics({ kind: 'snapshot', snapshot }, options);
    const second = evaluateNodeSlideSemantics({ kind: 'snapshot', snapshot }, options);

    expect(first).toEqual(second);
    expect(snapshot).toEqual(before);
  });
});

function completeSnapshot(): DeckSnapshot {
  const sources = [
    source('source-data', 'Official dataset'),
    source('source-math', 'Calculation inputs'),
    source('source-image', 'Licensed image'),
  ];
  const slides = [
    slide('slide-1', 'Opening decision', 'Intro / 01', ''),
    slide('slide-2', 'Measured evidence', 'Evidence / 02', 'Source: official dataset.'),
    slide('slide-3', 'Transparent calculation', 'Evidence / 03', 'Source: calculation inputs.'),
    slide('slide-4', 'Reviewable close', 'Close / 04', 'Image credit: licensed image.'),
  ];
  const elements = [
    textElement('text-1', 'slide-1', 'A reversible decision opens the story.', []),
    textElement('text-2', 'slide-2', 'Verified attendance reached 3.4 million in 2022.', [
      'source-data',
    ]),
    chartElement('chart-1', 'slide-2'),
    textElement('text-3', 'slide-3', 'The ratio uses two measured inputs.', ['source-math']),
    mathElement('math-1', 'slide-3'),
    textElement('text-4', 'slide-4', 'The audience retains an editable next step.', []),
    imageElement('image-1', 'slide-4'),
  ];
  for (const target of slides) {
    target.elementOrder = elements
      .filter((element) => element.slideId === target.id)
      .map((element) => element.id);
  }
  return {
    deck: {
      schemaVersion: NODESLIDE_SCHEMA_VERSION,
      toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
      id: 'deck-semantic-proof',
      projectId: 'project-semantic-proof',
      title: 'Semantic proof',
      brief: {
        prompt: 'Build an evidence-led decision story.',
        audience: 'Reviewers',
        purpose: 'Verify semantic quality',
        successCriteria: ['Keep every primitive editable'],
      },
      theme: {
        id: 'test-theme',
        name: 'Test theme',
        mode: 'light',
        colors: {
          canvas: '#ffffff',
          ink: '#111111',
          muted: '#555555',
          accent: '#aa3300',
          accentSoft: '#ffeee8',
          insight: '#e7f4ec',
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
    sources,
  };
}

function slide(id: string, title: string, section: string, notes: string) {
  return {
    id,
    deckId: 'deck-semantic-proof',
    title,
    section,
    notes,
    background: '#ffffff',
    elementOrder: [] as string[],
    version: 1,
  };
}

function baseElement(id: string, slideId: string): Omit<SlideElement, 'kind'> {
  return {
    id,
    slideId,
    name: id,
    bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
    rotation: 0,
    style: { color: '#111111', fontSize: 20 },
    sourceIds: [],
    locked: false,
    exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
    version: 1,
  };
}

function textElement(
  id: string,
  slideId: string,
  content: string,
  sourceIds: string[],
): SlideElement {
  return {
    ...baseElement(id, slideId),
    kind: 'text',
    content,
    sourceIds,
  };
}

function chartElement(id: string, slideId: string): SlideElement {
  return {
    ...baseElement(id, slideId),
    kind: 'chart',
    sourceIds: ['source-data'],
    chart: {
      chartType: 'bar',
      labels: ['2018', '2022'],
      series: [{ name: 'Attendance', values: [3_031_768, 3_404_252] }],
      unit: 'people',
      sourceId: 'source-data',
    },
  };
}

function mathElement(id: string, slideId: string): SlideElement {
  return {
    ...baseElement(id, slideId),
    kind: 'math',
    sourceIds: ['source-math'],
    math: {
      expression: 'goals / matches',
      display: '172 / 64 = 2.69',
      variables: [
        { label: 'goals', value: 172 },
        { label: 'matches', value: 64 },
      ],
      sourceId: 'source-math',
    },
  };
}

function imageElement(id: string, slideId: string): SlideElement {
  return {
    ...baseElement(id, slideId),
    kind: 'image',
    sourceIds: ['source-image'],
    image: { placeholder: false, credit: 'Licensed image', sourceId: 'source-image' },
    imageUrl: 'https://images.example.test/licensed.jpg',
    altText: 'A licensed stadium photograph',
  };
}

function source(id: string, title: string): SourceRecord {
  return {
    id,
    deckId: 'deck-semantic-proof',
    title,
    url: `https://example.test/${id}`,
    sourceType: 'url',
    retrievedAt: NOW - 100,
    citation: `${title}, official publication.`,
    license: 'Permitted for this test.',
    status: 'ready',
  };
}

function plannedSpec(narrative: string[]): NodeSlideDeckSpec {
  return {
    title: 'Semantic proof plan',
    narrative,
    slides: Array.from({ length: 4 }, (_, index) => ({
      title: `Planned slide ${index + 1}`,
      section: `Plan / ${index + 1}`,
      headline: `Planned headline ${index + 1}`,
      body: `Planned body ${index + 1}`,
      bullets: [`Planned point ${index + 1}`],
    })),
  };
}

function requiredElement(snapshot: DeckSnapshot, kind: SlideElement['kind']): SlideElement {
  const element = snapshot.elements.find((candidate) => candidate.kind === kind);
  if (!element) throw new Error(`Expected ${kind} fixture.`);
  return element;
}

function codes(
  receipt: ReturnType<typeof evaluateNodeSlideSemantics>,
): NodeSlideSemanticFindingCode[] {
  return receipt.findings.map((finding) => finding.code);
}
