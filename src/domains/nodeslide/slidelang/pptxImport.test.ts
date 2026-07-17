import { describe, expect, it } from 'vitest';
import type { DeckSnapshot } from '../../../../shared/nodeslide';
import { createLocalSlideLangAdapter } from './localAdapter';
import { buildPptx } from './pptx';
import { createPptxImportCandidate, importPptxSnapshot } from './pptxImport';
import { createPptxImportFixture } from './pptxImportFixtures';

describe('bounded PPTX import', () => {
  it('imports supported OOXML in relationship order and reports every lossy feature honestly', async () => {
    const binary = await createPptxImportFixture();
    const result = await importPptxSnapshot(binary, {
      deckId: 'deck:roundtrip',
      projectId: 'project:fixture',
      fileName: 'fixture.pptx',
      timestamp: 42,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.validation.ok).toBe(true);
    expect(result.snapshot.deck.title).toBe('Fixture deck title');
    expect(result.source).toMatchObject({
      slideWidthEmu: 12_192_000,
      slideHeightEmu: 6_858_000,
      slideCount: 2,
    });
    expect(result.snapshot.slides.map((slide) => slide.title)).toEqual([
      'Second slide comes first',
      'Detailed fixture',
    ]);

    const detailedSlide = result.snapshot.slides[1];
    expect(detailedSlide?.background).toBe('#7C3AED');
    expect(detailedSlide?.notes).toBe('Private speaker note');
    const shape = result.snapshot.elements.find((element) => element.id === 'deck:roundtrip:shape');
    expect(shape).toMatchObject({
      kind: 'shape',
      content: 'Merged shape copy',
      bbox: { x: 0.075, width: 0.3 },
    });
    expect(result.snapshot.elements.some((element) => element.id.endsWith(':shape:text'))).toBe(
      false,
    );
    expect(
      result.snapshot.elements.find((element) => element.id === 'deck:roundtrip:title'),
    ).toBeTruthy();
    expect(
      result.snapshot.elements.find((element) => element.id === 'deck:roundtrip:connector'),
    ).toMatchObject({ kind: 'connector', bbox: { height: 0.001 } });
    expect(
      result.snapshot.elements.find((element) => element.id === 'deck:roundtrip:image')?.imageUrl,
    ).toMatch(/^data:image\/png;base64,/);
    expect(
      result.snapshot.elements.find((element) => element.id === 'deck:roundtrip:chart')?.chart,
    ).toEqual({
      chartType: 'bar',
      labels: ['Q1', 'Q2'],
      series: [{ name: 'Revenue', values: [12, 18] }],
    });

    expect(
      result.fidelity.items.find((item) => item.sourceObjectName === 'deck:roundtrip:shape:text'),
    ).toMatchObject({ fidelity: 'native', targetId: 'deck:roundtrip:shape' });
    for (const feature of [
      'macro',
      'smartart',
      'animation',
      'grouped_transform',
      'omml',
      'media',
    ] as const) {
      expect(result.fidelity.items.some((item) => item.feature === feature)).toBe(true);
    }
    expect(result.fidelity.items.find((item) => item.feature === 'macro')?.fidelity).toBe(
      'dropped',
    );
    expect(result.fidelity.hasLoss).toBe(true);
  });

  it('returns a CAS-ready PatchOperation candidate materialized through the shared patch path', async () => {
    const base = createBaseSnapshot();
    const replacedElement = base.elements[0];
    const replacedSlide = base.slides[0];
    if (!replacedElement || !replacedSlide) throw new Error('Fixture base snapshot is incomplete.');
    const replacedId = replacedElement.id;
    replacedElement.id = 'deck:roundtrip:shape';
    replacedSlide.elementOrder = replacedSlide.elementOrder.map((id) =>
      id === replacedId ? 'deck:roundtrip:shape' : id,
    );
    const before = structuredClone(base);
    const result = await createPptxImportCandidate(base, await createPptxImportFixture(), {
      fileName: 'fixture.pptx',
      timestamp: 99,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(base).toEqual(before);
    expect(result.candidate.deckId).toBe(base.deck.id);
    expect(result.candidate.summary).toBe('Import fixture.pptx: 2 slides and 6 supported objects');
    expect(result.candidate.baseDeckVersion).toBe(base.deck.version);
    expect(result.candidate.baseSlideVersions).toEqual({
      [base.slides[0]?.id ?? 'missing']: base.slides[0]?.version,
    });
    expect(result.candidate.scope).toEqual({
      kind: 'deck',
      deckId: base.deck.id,
      operationMode: 'unrestricted',
    });
    expect(result.candidate.operations.map((operation) => operation.op)).toEqual([
      'update_deck',
      'add_slide',
      'remove_slide',
      'add_slide',
      'add_slide',
      'remove_slide',
    ]);
    expect(result.candidate.snapshot.deck.version).toBe(base.deck.version + 1);
    expect(result.candidate.snapshot.deck.theme).toEqual(base.deck.theme);
    expect(result.candidate.snapshot.deck.slideOrder).toHaveLength(2);
    expect(
      result.candidate.snapshot.elements.filter((element) =>
        element.id.startsWith('deck:roundtrip:shape'),
      ),
    ).toHaveLength(1);
    expect(
      result.candidate.snapshot.elements.some((element) => element.id === 'deck:roundtrip:shape'),
    ).toBe(true);
    expect(result.candidate.validation.ok).toBe(true);
  });

  it('round-trips current NodeSlide objectName IDs and collapses exported shape copy', async () => {
    const source = createRoundTripSnapshot();
    const binary = await buildPptx(source);
    const result = await importPptxSnapshot(binary, {
      deckId: 'deck:reimported',
      projectId: 'project:fixture',
      fileName: 'nodeslide-export.pptx',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.deck.slideOrder).toEqual(source.deck.slideOrder);
    expect(result.snapshot.slides.map((slide) => slide.id)).toEqual(
      source.slides.map((slide) => slide.id),
    );
    expect(result.snapshot.elements.map((element) => element.id)).toEqual([
      'deck:roundtrip:text',
      'deck:roundtrip:shape',
      'deck:roundtrip:connector',
      'deck:roundtrip:chart',
    ]);
    expect(
      result.snapshot.elements.find((element) => element.id === 'deck:roundtrip:text'),
    ).toMatchObject({ kind: 'text', content: 'Stable text' });
    expect(
      result.snapshot.elements.find((element) => element.id === 'deck:roundtrip:shape'),
    ).toMatchObject({ kind: 'shape', content: 'Shape copy survives' });
    expect(
      result.snapshot.elements.find((element) => element.id === 'deck:roundtrip:connector'),
    ).toMatchObject({ kind: 'connector' });
    expect(
      result.fidelity.items.find((item) => item.sourceObjectName === 'deck:roundtrip:shape:text'),
    ).toMatchObject({ fidelity: 'native', targetId: 'deck:roundtrip:shape' });
  });

  it('enforces explicit slide bounds before inflating slide parts', async () => {
    const result = await importPptxSnapshot(await createPptxImportFixture(), {
      deckId: 'deck:bounded',
      projectId: 'project:fixture',
      bounds: { maxSlides: 1 },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'too_many_slides' } });
  });
});

function createBaseSnapshot(): DeckSnapshot {
  return createLocalSlideLangAdapter().scaffold({
    deckId: 'deck:destination',
    projectId: 'project:destination',
    title: 'Destination deck',
    brief: {
      prompt: 'Destination',
      audience: 'Reviewers',
      purpose: 'Test import candidate',
      successCriteria: ['Typed operations only'],
    },
    timestamp: 7,
  });
}

function createRoundTripSnapshot(): DeckSnapshot {
  const snapshot = createLocalSlideLangAdapter().scaffold({
    deckId: 'deck:roundtrip',
    projectId: 'project:fixture',
    title: 'Round trip',
    brief: {
      prompt: 'Round trip',
      audience: 'Reviewers',
      purpose: 'Verify object names',
      successCriteria: ['Stable IDs survive'],
    },
    timestamp: 3,
  });
  const slide = snapshot.slides[0];
  if (!slide) throw new Error('Round-trip fixture slide is missing.');
  snapshot.elements = [
    {
      id: 'deck:roundtrip:text',
      slideId: slide.id,
      name: 'Text',
      kind: 'text',
      bbox: { x: 0.08, y: 0.08, width: 0.5, height: 0.12 },
      rotation: 0,
      content: 'Stable text',
      style: { color: '#172033', fontSize: 28 },
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
      version: 1,
    },
    {
      id: 'deck:roundtrip:shape',
      slideId: slide.id,
      name: 'Shape',
      kind: 'shape',
      bbox: { x: 0.08, y: 0.24, width: 0.28, height: 0.2 },
      rotation: 0,
      content: 'Shape copy survives',
      style: { fill: '#2563EB', color: '#FFFFFF', radius: 12 },
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
      version: 1,
    },
    {
      id: 'deck:roundtrip:connector',
      slideId: slide.id,
      name: 'Connector',
      kind: 'connector',
      bbox: { x: 0.38, y: 0.31, width: 0.2, height: 0.01 },
      rotation: 0,
      style: { stroke: '#0891B2', strokeWidth: 2 },
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
      version: 1,
    },
    {
      id: 'deck:roundtrip:chart',
      slideId: slide.id,
      name: 'Chart',
      kind: 'chart',
      bbox: { x: 0.08, y: 0.52, width: 0.5, height: 0.36 },
      rotation: 0,
      style: {},
      chart: {
        chartType: 'bar',
        labels: ['A', 'B'],
        series: [{ name: 'Series', values: [1, 2], color: '#2563EB' }],
      },
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
      version: 1,
    },
  ];
  slide.elementOrder = snapshot.elements.map((element) => element.id);
  return snapshot;
}
