import { describe, expect, it } from 'vitest';
import {
  clocksForNodeSlideOperations,
  deterministicAgentOperations,
  evaluateNodeSlideCas,
  summarizePatchOperations,
  touchedNodeSlideIds,
  validateNodeSlidePatch,
} from '../convex/lib/nodeslidePatches';
import {
  type DeckSnapshot,
  NODESLIDE_PATCH_OPERATION_LIMIT,
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
  type PatchOperation,
  type PatchScope,
  type Slide,
  type SlideElement,
} from './nodeslide';
import { applyDeckPatch, validatePatchScope } from './nodeslidePatch';

const now = 1_700_000_000_000;

function snapshot(): DeckSnapshot {
  return {
    deck: {
      schemaVersion: NODESLIDE_SCHEMA_VERSION,
      toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
      id: 'deck-1',
      projectId: 'project-1',
      title: 'Scoped editing',
      brief: {
        prompt: 'Explain scoped editing',
        audience: 'Product teams',
        purpose: 'Demo',
        successCriteria: ['Only selected objects change'],
      },
      theme: {
        id: 'editorial',
        name: 'Editorial',
        mode: 'light',
        colors: {
          canvas: '#fbf8f1',
          ink: '#13233f',
          muted: '#667085',
          accent: '#3155d9',
          accentSoft: '#e9edff',
          insight: '#dfe9d8',
          insightInk: '#1e3b2b',
          trace: '#10213f',
          border: '#d9d9d2',
        },
        typography: { display: 'Fraunces', body: 'Geist', data: 'JetBrains Mono' },
        defaultRadius: 0,
        spacingUnit: 8,
      },
      slideOrder: ['slide-1'],
      version: 3,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    },
    slides: [
      {
        id: 'slide-1',
        deckId: 'deck-1',
        title: 'The selected insight',
        background: '#fbf8f1',
        elementOrder: ['headline', 'chart'],
        version: 2,
      },
    ],
    elements: [
      {
        id: 'headline',
        slideId: 'slide-1',
        name: 'Headline',
        kind: 'text',
        bbox: { x: 0.08, y: 0.08, width: 0.5, height: 0.16 },
        rotation: 0,
        content: 'Before',
        style: { color: '#13233f', fontSize: 34 },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable'],
        version: 1,
      },
      {
        id: 'chart',
        slideId: 'slide-1',
        name: 'Chart',
        kind: 'chart',
        bbox: { x: 0.08, y: 0.34, width: 0.84, height: 0.5 },
        rotation: 0,
        style: {},
        chart: {
          chartType: 'bar',
          labels: ['Before', 'After'],
          series: [{ name: 'Minutes', values: [44, 8] }],
        },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable'],
        version: 1,
      },
    ],
    sources: [],
  };
}

function slideBundle(
  slideId = 'slide-2',
  elementId = `${slideId}-headline`,
): { slide: Slide; elements: SlideElement[] } {
  return {
    slide: {
      id: slideId,
      deckId: 'deck-1',
      title: 'A new chapter',
      background: '#fbf8f1',
      elementOrder: [elementId],
      version: 0,
    },
    elements: [
      {
        id: elementId,
        slideId,
        name: 'New headline',
        kind: 'text',
        bbox: { x: 0.08, y: 0.08, width: 0.6, height: 0.16 },
        rotation: 0,
        content: 'A new chapter',
        style: { color: '#13233f', fontSize: 34 },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable'],
        version: 0,
      },
    ],
  };
}

function snapshotWithSecondSlide(): DeckSnapshot {
  const current = snapshot();
  const bundle = slideBundle();
  current.deck.slideOrder.push(bundle.slide.id);
  current.slides.push({ ...bundle.slide, version: 1 });
  current.elements.push(...bundle.elements.map((element) => ({ ...element, version: 1 })));
  return current;
}

function serverPatch(
  current: DeckSnapshot,
  operations: PatchOperation[],
  scope: PatchScope = {
    kind: 'deck',
    deckId: current.deck.id,
    operationMode: 'unrestricted',
  },
) {
  return {
    deckId: current.deck.id,
    baseDeckVersion: current.deck.version,
    ...clocksForNodeSlideOperations(current, operations),
    scope,
    operations,
  };
}

describe('NodeSlide patch protocol', () => {
  it('keeps the production patch boundary aligned with signature application', () => {
    expect(NODESLIDE_PATCH_OPERATION_LIMIT).toBe(512);
  });

  it('changes only the explicitly selected element', () => {
    const scope: PatchScope = {
      kind: 'elements',
      deckId: 'deck-1',
      slideIds: ['slide-1'],
      elementIds: ['headline'],
      operationMode: 'copy',
    };
    const result = applyDeckPatch(snapshot(), {
      baseDeckVersion: 3,
      scope,
      operations: [
        { op: 'replace_text', slideId: 'slide-1', elementId: 'headline', text: 'After' },
      ],
    });

    expect(result.snapshot.deck.version).toBe(4);
    expect(result.snapshot.elements.find((element) => element.id === 'headline')?.content).toBe(
      'After',
    );
    expect(result.snapshot.elements.find((element) => element.id === 'chart')).toEqual(
      snapshot().elements[1],
    );
    expect(result.affectedElementIds).toEqual(['headline']);
  });

  it('applies source-grounded copy and provenance atomically', () => {
    const current = snapshot();
    current.sources.push({
      id: 'source-csv',
      deckId: current.deck.id,
      title: 'World Cup data.csv',
      sourceType: 'spreadsheet',
      retrievedAt: now,
      citation: 'Uploaded World Cup data',
    });
    const scope: PatchScope = {
      kind: 'elements',
      deckId: current.deck.id,
      slideIds: ['slide-1'],
      elementIds: ['headline'],
      operationMode: 'copy',
    };
    const operations: PatchOperation[] = [
      {
        op: 'replace_text',
        slideId: 'slide-1',
        elementId: 'headline',
        text: 'Argentina won after a 3–3 final and penalties.',
        sourceIds: ['source-csv'],
      },
    ];

    expect(validateNodeSlidePatch(current, serverPatch(current, operations, scope))).toEqual([]);
    const result = applyDeckPatch(current, {
      baseDeckVersion: current.deck.version,
      scope,
      operations,
    });
    expect(result.snapshot.elements.find((element) => element.id === 'headline')).toMatchObject({
      content: 'Argentina won after a 3–3 final and penalties.',
      sourceIds: ['source-csv'],
    });
  });

  it('updates a typed chart while preserving editable structure', () => {
    const current = snapshot();
    const operations: PatchOperation[] = [
      {
        op: 'update_chart',
        slideId: 'slide-1',
        elementId: 'chart',
        chart: {
          chartType: 'line',
          labels: ['2022', '2026', '2030'],
          series: [{ name: 'Teams', values: [32, 48, 48], color: '#3155d9' }],
          unit: 'teams',
        },
      },
    ];

    expect(validateNodeSlidePatch(current, serverPatch(current, operations))).toEqual([]);
    const result = applyDeckPatch(current, {
      baseDeckVersion: current.deck.version,
      scope: { kind: 'deck', deckId: current.deck.id, operationMode: 'unrestricted' },
      operations,
    });

    expect(result.snapshot.elements.find((element) => element.id === 'chart')).toMatchObject({
      kind: 'chart',
      chart: {
        chartType: 'line',
        labels: ['2022', '2026', '2030'],
        series: [{ name: 'Teams', values: [32, 48, 48], color: '#3155d9' }],
        unit: 'teams',
      },
      version: 2,
    });
  });

  it('embeds a bounded image asset with alt text and credit', () => {
    const current = snapshot();
    current.slides[0]?.elementOrder.push('portrait');
    current.elements.push({
      id: 'portrait',
      slideId: 'slide-1',
      name: 'Portrait',
      kind: 'image',
      bbox: { x: 0.08, y: 0.34, width: 0.84, height: 0.5 },
      rotation: 0,
      style: {},
      altText: 'Portrait placeholder',
      image: { placeholder: true },
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_editable'],
      version: 1,
    });
    const imageUrl = 'data:image/webp;base64,UklGRgAAAAA=';
    const operations: PatchOperation[] = [
      {
        op: 'update_image',
        slideId: 'slide-1',
        elementId: 'portrait',
        imageUrl,
        altText: 'Mike Rubino, Head of Talent at AI Fund',
        credit: 'AI Fund team page',
      },
    ];

    expect(validateNodeSlidePatch(current, serverPatch(current, operations))).toEqual([]);
    const result = applyDeckPatch(current, {
      baseDeckVersion: current.deck.version,
      scope: { kind: 'deck', deckId: current.deck.id, operationMode: 'unrestricted' },
      operations,
    });

    expect(result.snapshot.elements.find((element) => element.id === 'portrait')).toMatchObject({
      kind: 'image',
      imageUrl,
      altText: 'Mike Rubino, Head of Talent at AI Fund',
      image: { placeholder: false, credit: 'AI Fund team page' },
      version: 2,
    });
  });

  it('rejects malformed chart data, remote image URLs, and wrong primitive kinds', () => {
    const current = snapshot();
    expect(
      validateNodeSlidePatch(
        current,
        serverPatch(current, [
          {
            op: 'update_chart',
            slideId: 'slide-1',
            elementId: 'chart',
            chart: {
              chartType: 'bar',
              labels: ['A', 'B'],
              series: [{ name: 'Mismatched', values: [1] }],
            },
          },
        ]),
      ),
    ).toContain('update_chart requires 1-24 labels and 1-6 finite series aligned to those labels.');
    expect(
      validateNodeSlidePatch(
        current,
        serverPatch(current, [
          {
            op: 'update_image',
            slideId: 'slide-1',
            elementId: 'chart',
            imageUrl: 'https://example.com/remote.jpg',
            altText: 'Remote image',
          },
        ]),
      ),
    ).toContain('update_image requires an image element; chart is chart.');
  });

  it('edits a structured math primitive without dropping its canonical payload', () => {
    const current = snapshot();
    const math: SlideElement = {
      id: 'formula',
      slideId: 'slide-1',
      name: 'Goals per match',
      kind: 'math',
      role: 'formula',
      bbox: { x: 0.08, y: 0.34, width: 0.84, height: 0.28 },
      rotation: 0,
      content: '172 ÷ 64 = 2.69',
      style: { color: '#13233f', fontSize: 34 },
      math: {
        expression: '172 / 64',
        display: '172 ÷ 64 = 2.69',
        variables: [
          { label: 'Goals', value: 172 },
          { label: 'Matches', value: 64 },
        ],
      },
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_editable'],
      version: 1,
    };
    current.elements.push(math);
    current.slides[0]?.elementOrder.push(math.id);

    const scope: PatchScope = {
      kind: 'elements',
      deckId: current.deck.id,
      slideIds: ['slide-1'],
      elementIds: [math.id],
      operationMode: 'copy',
    };
    const operations: PatchOperation[] = [
      {
        op: 'replace_text',
        slideId: 'slide-1',
        elementId: math.id,
        text: '172 goals ÷ 64 matches = 2.69',
      },
    ];

    expect(validateNodeSlidePatch(current, serverPatch(current, operations, scope))).toEqual([]);
    const result = applyDeckPatch(current, {
      baseDeckVersion: current.deck.version,
      scope,
      operations,
    });
    const updated = result.snapshot.elements.find((element) => element.id === math.id);
    expect(updated?.content).toBe('172 goals ÷ 64 matches = 2.69');
    expect(updated?.math).toMatchObject({
      expression: '172 goals ÷ 64 matches = 2.69',
      display: '172 goals ÷ 64 matches = 2.69',
      variables: math.math?.variables,
    });
  });

  it('rejects stale patches before mutation', () => {
    expect(() =>
      applyDeckPatch(snapshot(), {
        baseDeckVersion: 2,
        scope: {
          kind: 'deck',
          deckId: 'deck-1',
          operationMode: 'unrestricted',
        },
        operations: [
          { op: 'replace_text', slideId: 'slide-1', elementId: 'headline', text: 'Stale' },
        ],
      }),
    ).toThrow('Stale patch');
  });

  it('rejects out-of-scope and wrong-mode operations', () => {
    const errors = validatePatchScope(
      {
        kind: 'elements',
        deckId: 'deck-1',
        slideIds: ['slide-1'],
        elementIds: ['headline'],
        operationMode: 'copy',
      },
      [
        {
          op: 'update_style',
          slideId: 'slide-1',
          elementId: 'chart',
          properties: { fill: '#fff' },
        },
      ],
    );

    expect(errors).toContain('Operation update_style targets element chart outside scope.');
    expect(errors).toContain('Copy-only scope does not permit update_style.');

    const candidate = snapshot().elements[0];
    if (!candidate) throw new Error('Missing element fixture');
    const addErrors = validatePatchScope(
      {
        kind: 'elements',
        deckId: 'deck-1',
        slideIds: ['slide-1'],
        elementIds: ['headline'],
        operationMode: 'unrestricted',
      },
      [
        {
          op: 'add_element',
          slideId: 'slide-1',
          element: { ...candidate, id: 'unsolicited' },
        },
      ],
    );
    expect(addErrors).toContain('Operation add_element targets element unsolicited outside scope.');
  });

  it('rejects empty, cross-deck, unknown, and locked mutations', () => {
    const current = snapshot();
    const selectedScope: PatchScope = {
      kind: 'elements',
      deckId: 'deck-1',
      slideIds: ['slide-1'],
      elementIds: ['headline'],
      operationMode: 'unrestricted',
    };

    expect(() =>
      applyDeckPatch(current, {
        baseDeckVersion: 3,
        scope: selectedScope,
        operations: [],
      }),
    ).toThrow('at least one operation');

    expect(() =>
      applyDeckPatch(current, {
        baseDeckVersion: 3,
        scope: { ...selectedScope, deckId: 'another-deck' },
        operations: [
          { op: 'replace_text', slideId: 'slide-1', elementId: 'headline', text: 'Nope' },
        ],
      }),
    ).toThrow('does not match current deck');

    expect(() =>
      applyDeckPatch(current, {
        baseDeckVersion: 3,
        scope: { ...selectedScope, elementIds: ['missing'] },
        operations: [
          { op: 'replace_text', slideId: 'slide-1', elementId: 'missing', text: 'Nope' },
        ],
      }),
    ).toThrow('Unknown element missing');

    const locked = snapshot();
    const headline = locked.elements.find((element) => element.id === 'headline');
    if (!headline) throw new Error('Missing headline fixture');
    headline.locked = true;
    expect(() =>
      applyDeckPatch(locked, {
        baseDeckVersion: 3,
        scope: selectedScope,
        operations: [
          { op: 'replace_text', slideId: 'slide-1', elementId: 'headline', text: 'Nope' },
        ],
      }),
    ).toThrow('is locked');
  });

  it('keeps its input immutable and records an injected commit timestamp', () => {
    const current = snapshot();
    const before = structuredClone(current);
    const result = applyDeckPatch(
      current,
      {
        baseDeckVersion: 3,
        scope: {
          kind: 'elements',
          deckId: 'deck-1',
          slideIds: ['slide-1'],
          elementIds: ['headline'],
          operationMode: 'copy',
        },
        operations: [
          { op: 'replace_text', slideId: 'slide-1', elementId: 'headline', text: 'Committed' },
        ],
      },
      now + 42,
    );

    expect(current).toEqual(before);
    expect(result.snapshot.deck.updatedAt).toBe(now + 42);
  });

  it('adds, removes, and reorders canonical objects', () => {
    const current = snapshot();
    current.deck.slideOrder.push('slide-2');
    current.slides.push({
      id: 'slide-2',
      deckId: 'deck-1',
      title: 'Second slide',
      background: '#fbf8f1',
      elementOrder: [],
      version: 1,
    });
    const added = {
      id: 'takeaway',
      slideId: 'slide-1',
      name: 'Takeaway',
      kind: 'text' as const,
      bbox: { x: 0.7, y: 0.04, width: 0.4, height: 0.1 },
      rotation: 0,
      content: 'Small, reviewable changes',
      style: { fontSize: 18 },
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_editable'] as const,
      version: 0,
    };
    const result = applyDeckPatch(current, {
      baseDeckVersion: 3,
      scope: { kind: 'deck', deckId: 'deck-1', operationMode: 'unrestricted' },
      operations: [
        {
          op: 'add_element',
          slideId: 'slide-1',
          element: { ...added, exportCapabilities: [...added.exportCapabilities] },
        },
        { op: 'remove_element', slideId: 'slide-1', elementId: 'headline' },
        { op: 'reorder_slide', slideId: 'slide-2', index: 0 },
      ],
    });

    expect(result.snapshot.deck.slideOrder).toEqual(['slide-2', 'slide-1']);
    expect(result.snapshot.elements.some((element) => element.id === 'headline')).toBe(false);
    expect(result.snapshot.elements.find((element) => element.id === 'takeaway')?.version).toBe(1);
    expect(result.snapshot.slides[0]?.elementOrder).toEqual(['chart', 'takeaway']);
  });

  it('clamps drag and resize geometry inside the slide', () => {
    const result = applyDeckPatch(snapshot(), {
      baseDeckVersion: 3,
      scope: {
        kind: 'elements',
        deckId: 'deck-1',
        slideIds: ['slide-1'],
        elementIds: ['headline'],
        operationMode: 'layout',
      },
      operations: [
        { op: 'move', slideId: 'slide-1', elementId: 'headline', x: 0.9, y: -1 },
        {
          op: 'resize',
          slideId: 'slide-1',
          elementId: 'headline',
          width: 0.4,
          height: 0.2,
        },
      ],
    });
    const headline = result.snapshot.elements.find((element) => element.id === 'headline');

    expect(headline?.bbox).toEqual({ x: 0.5, y: 0, width: 0.4, height: 0.2 });
  });

  it('rejects non-finite geometry', () => {
    expect(() =>
      applyDeckPatch(snapshot(), {
        baseDeckVersion: 3,
        scope: {
          kind: 'elements',
          deckId: 'deck-1',
          slideIds: ['slide-1'],
          elementIds: ['headline'],
          operationMode: 'layout',
        },
        operations: [
          { op: 'move', slideId: 'slide-1', elementId: 'headline', x: Number.NaN, y: 0 },
        ],
      }),
    ).toThrow('must be a finite number');
  });
});

describe('NodeSlide canonical slide lifecycle', () => {
  it('keeps native page-number elements synchronized after insertion and reordering', () => {
    const current = snapshotWithSecondSlide();
    for (const [index, slideId] of current.deck.slideOrder.entries()) {
      const slide = current.slides.find((candidate) => candidate.id === slideId);
      if (!slide) throw new Error(`Missing slide ${slideId}`);
      const id = `${slideId}-page-number`;
      slide.elementOrder.push(id);
      current.elements.push({
        id,
        slideId,
        name: 'Page number',
        kind: 'text',
        role: 'page_number',
        bbox: { x: 0.88, y: 0.92, width: 0.06, height: 0.05 },
        rotation: 0,
        content: String(index + 1).padStart(2, '0'),
        style: { fontSize: 13 },
        sourceIds: [],
        locked: true,
        exportCapabilities: ['web_native', 'pptx_editable'],
        version: 1,
      });
    }

    const result = applyDeckPatch(current, {
      baseDeckVersion: current.deck.version,
      scope: { kind: 'deck', deckId: current.deck.id, operationMode: 'unrestricted' },
      operations: [{ op: 'reorder_slide', slideId: 'slide-2', index: 0 }],
    });

    expect(
      result.snapshot.elements
        .filter((element) => element.role === 'page_number')
        .map((element) => [element.slideId, element.content]),
    ).toEqual([
      ['slide-1', '02'],
      ['slide-2', '01'],
    ]);
    expect(result.affectedElementIds).toEqual(
      expect.arrayContaining(['slide-1-page-number', 'slide-2-page-number']),
    );
  });

  it('adds a bundled canonical slide at the requested index without mutating its inputs', () => {
    const current = snapshot();
    const bundle = slideBundle();
    const operation: PatchOperation = { op: 'add_slide', ...bundle, index: 0 };
    const beforeSnapshot = structuredClone(current);
    const beforeOperation = structuredClone(operation);

    const result = applyDeckPatch(current, {
      baseDeckVersion: current.deck.version,
      scope: { kind: 'deck', deckId: current.deck.id, operationMode: 'unrestricted' },
      operations: [operation],
    });

    expect(result.snapshot.deck.slideOrder).toEqual(['slide-2', 'slide-1']);
    expect(result.snapshot.slides.find((slide) => slide.id === 'slide-2')).toMatchObject({
      title: 'A new chapter',
      version: 1,
      elementOrder: ['slide-2-headline'],
    });
    expect(
      result.snapshot.elements.find((element) => element.id === 'slide-2-headline'),
    ).toMatchObject({ slideId: 'slide-2', version: 1 });
    expect(result.affectedSlideIds).toEqual(['slide-2']);
    expect(result.affectedElementIds).toEqual(['slide-2-headline']);
    expect(current).toEqual(beforeSnapshot);
    expect(operation).toEqual(beforeOperation);
  });

  it('supports duplicate-style adds with remapped canonical element IDs', () => {
    const current = snapshot();
    const sourceSlide = current.slides[0];
    if (!sourceSlide) throw new Error('Missing source slide fixture');
    const sourceElements = current.elements.filter((element) => element.slideId === sourceSlide.id);
    const idMap = new Map(sourceElements.map((element) => [element.id, `${element.id}-copy`]));
    const elements = sourceElements.map((element) => ({
      ...structuredClone(element),
      id: idMap.get(element.id) ?? `${element.id}-copy`,
      slideId: 'slide-copy',
      version: 0,
    }));
    const slide: Slide = {
      ...structuredClone(sourceSlide),
      id: 'slide-copy',
      title: `${sourceSlide.title} copy`,
      elementOrder: sourceSlide.elementOrder.map((id) => idMap.get(id) ?? `${id}-copy`),
      version: 0,
    };

    const result = applyDeckPatch(current, {
      baseDeckVersion: current.deck.version,
      scope: { kind: 'deck', deckId: current.deck.id, operationMode: 'unrestricted' },
      operations: [{ op: 'add_slide', slide, elements, index: 1 }],
    });

    expect(result.snapshot.deck.slideOrder).toEqual(['slide-1', 'slide-copy']);
    expect(
      result.snapshot.slides.find((candidate) => candidate.id === 'slide-copy')?.elementOrder,
    ).toEqual(['headline-copy', 'chart-copy']);
    expect(
      result.snapshot.elements.find((element) => element.id === 'headline-copy'),
    ).toMatchObject({
      slideId: 'slide-copy',
      content: 'Before',
      style: { color: '#13233f', fontSize: 34 },
      version: 1,
    });
    expect(result.snapshot.elements.find((element) => element.id === 'chart-copy')?.chart).toEqual(
      current.elements.find((element) => element.id === 'chart')?.chart,
    );
  });

  it('removes a slide and all of its elements, including locked children', () => {
    const current = snapshotWithSecondSlide();
    const headline = current.elements.find((element) => element.id === 'headline');
    if (!headline) throw new Error('Missing headline fixture');
    headline.locked = true;
    const before = structuredClone(current);

    const result = applyDeckPatch(current, {
      baseDeckVersion: current.deck.version,
      scope: {
        kind: 'slide',
        deckId: current.deck.id,
        slideIds: ['slide-1'],
        operationMode: 'unrestricted',
      },
      operations: [{ op: 'remove_slide', slideId: 'slide-1' }],
    });

    expect(result.snapshot.deck.slideOrder).toEqual(['slide-2']);
    expect(result.snapshot.slides.map((slide) => slide.id)).toEqual(['slide-2']);
    expect(result.snapshot.elements.map((element) => element.id)).toEqual(['slide-2-headline']);
    expect(result.affectedSlideIds).toEqual(['slide-1']);
    expect(result.affectedElementIds).toEqual(['headline', 'chart']);
    expect(current).toEqual(before);
  });

  it('cannot remove the final slide', () => {
    const current = snapshot();
    const operation: PatchOperation = { op: 'remove_slide', slideId: 'slide-1' };

    expect(() =>
      applyDeckPatch(current, {
        baseDeckVersion: current.deck.version,
        scope: { kind: 'deck', deckId: current.deck.id, operationMode: 'unrestricted' },
        operations: [operation],
      }),
    ).toThrow('Cannot remove the final slide');
    expect(validateNodeSlidePatch(current, serverPatch(current, [operation]))).toContain(
      'Cannot remove the final slide from a deck.',
    );
  });

  it('rejects duplicate slide and element IDs in canonical add bundles', () => {
    const current = snapshot();
    const existingSlide = slideBundle('slide-1', 'fresh-element');
    expect(() =>
      applyDeckPatch(current, {
        baseDeckVersion: current.deck.version,
        scope: { kind: 'deck', deckId: current.deck.id, operationMode: 'unrestricted' },
        operations: [{ op: 'add_slide', ...existingSlide, index: 1 }],
      }),
    ).toThrow('Slide slide-1 already exists');

    const collidingElement = slideBundle('slide-2', 'headline');
    expect(() =>
      applyDeckPatch(current, {
        baseDeckVersion: current.deck.version,
        scope: { kind: 'deck', deckId: current.deck.id, operationMode: 'unrestricted' },
        operations: [{ op: 'add_slide', ...collidingElement, index: 1 }],
      }),
    ).toThrow('Element headline already exists');

    const duplicateElements = slideBundle();
    const duplicateElement = duplicateElements.elements[0];
    if (!duplicateElement) throw new Error('Missing bundled element fixture');
    duplicateElements.elements.push(structuredClone(duplicateElement));
    duplicateElements.slide.elementOrder.push(duplicateElement.id);
    const duplicateOperation: PatchOperation = {
      op: 'add_slide',
      ...duplicateElements,
      index: 1,
    };
    expect(() =>
      applyDeckPatch(current, {
        baseDeckVersion: current.deck.version,
        scope: { kind: 'deck', deckId: current.deck.id, operationMode: 'unrestricted' },
        operations: [duplicateOperation],
      }),
    ).toThrow('contains duplicate element slide-2-headline');
    expect(validateNodeSlidePatch(current, serverPatch(current, [duplicateOperation]))).toEqual(
      expect.arrayContaining([
        'Added slide slide-2 contains duplicate element slide-2-headline.',
        'Added slide slide-2 has duplicate IDs in elementOrder.',
      ]),
    );
  });

  it('rejects non-integer and out-of-bounds slide insertion indexes', () => {
    const current = snapshot();
    for (const index of [-1, 0.5, 2]) {
      const operation: PatchOperation = { op: 'add_slide', ...slideBundle(), index };
      expect(() =>
        applyDeckPatch(current, {
          baseDeckVersion: current.deck.version,
          scope: { kind: 'deck', deckId: current.deck.id, operationMode: 'unrestricted' },
          operations: [operation],
        }),
      ).toThrow(`Slide insertion index ${index} is outside deck bounds.`);
      expect(validateNodeSlidePatch(current, serverPatch(current, [operation]))).toContain(
        `Slide insertion index ${index} is outside deck bounds.`,
      );
    }
  });

  it('enforces slide and element scope while allowing an explicitly scoped new slide', () => {
    const addOperation: PatchOperation = { op: 'add_slide', ...slideBundle(), index: 1 };
    const removeOperation: PatchOperation = { op: 'remove_slide', slideId: 'slide-1' };

    expect(
      validatePatchScope(
        {
          kind: 'slide',
          deckId: 'deck-1',
          slideIds: ['slide-1'],
          operationMode: 'unrestricted',
        },
        [addOperation],
      ),
    ).toContain('Operation add_slide targets slide slide-2 outside scope.');
    expect(
      validatePatchScope(
        {
          kind: 'slide',
          deckId: 'deck-1',
          slideIds: ['slide-2'],
          operationMode: 'unrestricted',
        },
        [removeOperation],
      ),
    ).toContain('Operation remove_slide targets slide slide-1 outside scope.');
    const elementScope: PatchScope = {
      kind: 'elements',
      deckId: 'deck-1',
      slideIds: ['slide-1'],
      elementIds: ['headline'],
      operationMode: 'unrestricted',
    };
    const wholeSlideOperations: PatchOperation[] = [
      { op: 'add_slide', ...slideBundle(), index: 1 },
      removeOperation,
      { op: 'update_slide', slideId: 'slide-1', properties: { title: 'Escaped' } },
      { op: 'reorder_slide', slideId: 'slide-1', index: 0 },
    ];
    for (const operation of wholeSlideOperations) {
      expect(validatePatchScope(elementScope, [operation])).toContain(
        `Operation ${operation.op} targets a whole slide outside element-scoped authority.`,
      );
    }

    expect(
      validatePatchScope(
        {
          kind: 'bounding_box',
          deckId: 'deck-1',
          slideIds: ['slide-1'],
          elementIds: ['headline'],
          bbox: { x: 0, y: 0, width: 0.5, height: 0.5 },
          operationMode: 'unrestricted',
        },
        [{ op: 'update_slide', slideId: 'slide-1', properties: { title: 'Escaped' } }],
      ),
    ).toContain('Operation update_slide targets a whole slide outside element-scoped authority.');

    expect(
      validatePatchScope(
        {
          kind: 'comment',
          deckId: 'deck-1',
          commentId: 'comment-1',
          slideIds: ['slide-1'],
          elementIds: ['headline'],
          operationMode: 'unrestricted',
        },
        [{ op: 'reorder_slide', slideId: 'slide-1', index: 0 }],
      ),
    ).toContain('Operation reorder_slide targets a whole slide outside element-scoped authority.');

    const current = snapshot();
    const scopedNewSlide: PatchScope = {
      kind: 'slide',
      deckId: current.deck.id,
      slideIds: ['slide-2'],
      operationMode: 'unrestricted',
    };
    expect(
      validateNodeSlidePatch(current, serverPatch(current, [addOperation], scopedNewSlide)),
    ).toEqual([]);
  });
});

describe('NodeSlide deck-level operations and clocks', () => {
  it('updates only the bounded deck title through an immutable versioned patch', () => {
    const current = snapshot();
    const before = structuredClone(current);
    const result = applyDeckPatch(current, {
      baseDeckVersion: current.deck.version,
      scope: { kind: 'deck', deckId: current.deck.id, operationMode: 'unrestricted' },
      operations: [{ op: 'update_deck', properties: { title: '  Renamed deck  ' } }],
    });

    expect(result.snapshot.deck.title).toBe('Renamed deck');
    expect(result.snapshot.deck.version).toBe(current.deck.version + 1);
    expect(result.affectedSlideIds).toEqual([]);
    expect(result.affectedElementIds).toEqual([]);
    expect(current).toEqual(before);
  });

  it('restricts update_deck to deck/unrestricted scope and validates title bounds', () => {
    const operation: PatchOperation = {
      op: 'update_deck',
      properties: { title: 'Renamed deck' },
    };
    expect(
      validatePatchScope(
        {
          kind: 'slide',
          deckId: 'deck-1',
          slideIds: ['slide-1'],
          operationMode: 'unrestricted',
        },
        [operation],
      ),
    ).toContain('update_deck requires deck scope with unrestricted mode.');
    expect(
      validatePatchScope({ kind: 'deck', deckId: 'deck-1', operationMode: 'copy' }, [operation]),
    ).toContain('update_deck requires deck scope with unrestricted mode.');

    const current = snapshot();
    const missingTitle: PatchOperation = { op: 'update_deck', properties: {} };
    const blankTitle: PatchOperation = { op: 'update_deck', properties: { title: '   ' } };
    const longTitle: PatchOperation = {
      op: 'update_deck',
      properties: { title: 'x'.repeat(161) },
    };
    expect(validateNodeSlidePatch(current, serverPatch(current, [missingTitle]))).toContain(
      'update_deck requires a title.',
    );
    expect(validateNodeSlidePatch(current, serverPatch(current, [blankTitle]))).toContain(
      'Deck title cannot be empty.',
    );
    expect(validateNodeSlidePatch(current, serverPatch(current, [longTitle]))).toContain(
      'Deck title cannot exceed 160 characters.',
    );
    expect(() =>
      applyDeckPatch(current, {
        baseDeckVersion: current.deck.version,
        scope: { kind: 'deck', deckId: current.deck.id, operationMode: 'unrestricted' },
        operations: [blankTitle],
      }),
    ).toThrow('Deck title cannot be empty.');
    const bounded: PatchOperation = {
      op: 'update_deck',
      properties: { title: 'x'.repeat(160) },
    };
    expect(validateNodeSlidePatch(current, serverPatch(current, [bounded]))).toEqual([]);
  });

  it('tracks removed child clocks and requires exact deck CAS for structural and title writes', () => {
    const current = snapshotWithSecondSlide();
    const removeOperation: PatchOperation = { op: 'remove_slide', slideId: 'slide-1' };
    expect(touchedNodeSlideIds(current, [removeOperation])).toEqual({
      slideIds: ['slide-1'],
      elementIds: ['headline', 'chart'],
    });
    expect(clocksForNodeSlideOperations(current, [removeOperation])).toEqual({
      baseSlideVersions: { 'slide-1': 2 },
      baseElementVersions: { headline: 1, chart: 1 },
    });

    const removePatch = serverPatch(current, [removeOperation]);
    expect(evaluateNodeSlideCas(current, removePatch)).toMatchObject({
      canCommit: true,
      rebased: false,
    });
    expect(
      evaluateNodeSlideCas(current, { ...removePatch, baseDeckVersion: current.deck.version - 1 }),
    ).toMatchObject({ canCommit: false, rebased: false });

    const addOperation: PatchOperation = { op: 'add_slide', ...slideBundle('slide-3'), index: 2 };
    const addPatch = serverPatch(current, [addOperation]);
    expect(touchedNodeSlideIds(current, [addOperation])).toEqual({ slideIds: [], elementIds: [] });
    expect(evaluateNodeSlideCas(current, addPatch).canCommit).toBe(true);
    expect(
      evaluateNodeSlideCas(current, { ...addPatch, baseDeckVersion: current.deck.version - 1 })
        .canCommit,
    ).toBe(false);

    const titleOperation: PatchOperation = {
      op: 'update_deck',
      properties: { title: 'CAS title' },
    };
    const titlePatch = serverPatch(current, [titleOperation]);
    expect(
      evaluateNodeSlideCas(current, { ...titlePatch, baseDeckVersion: current.deck.version - 1 })
        .reasons,
    ).toEqual([expect.stringContaining('deck-level operations cannot be rebased')]);
  });

  it('summarizes canonical slide and deck lifecycle operations', () => {
    expect(
      summarizePatchOperations([
        { op: 'add_slide', ...slideBundle(), index: 1 },
        { op: 'remove_slide', slideId: 'slide-1' },
        { op: 'update_deck', properties: { title: 'Renamed' } },
      ]),
    ).toBe('add slide A new chapter; remove slide slide-1; update deck title');
    expect(
      summarizePatchOperations(
        [
          {
            op: 'replace_text',
            slideId: 'slide-1',
            elementId: 'headline',
            text: 'After',
          },
        ],
        snapshot(),
      ),
    ).toBe('replace text Headline');
    const copySummarySnapshot = snapshot();
    const copyTemplate = copySummarySnapshot.elements[0];
    if (!copyTemplate) throw new Error('Expected a copy summary fixture.');
    copySummarySnapshot.elements.push(
      { ...copyTemplate, id: 'section', name: 'Section label', role: 'section' },
      { ...copyTemplate, id: 'body', name: 'Body copy', role: 'body' },
    );
    expect(
      summarizePatchOperations(
        [
          { op: 'replace_text', slideId: 'slide-1', elementId: 'section', text: 'AI AGENTS' },
          { op: 'replace_text', slideId: 'slide-1', elementId: 'headline', text: 'AI agents' },
          { op: 'replace_text', slideId: 'slide-1', elementId: 'body', text: 'Reviewable' },
        ],
        copySummarySnapshot,
      ),
    ).toBe('Rewrite editable copy on The selected insight · 3 changes');
  });

  it('rejects operations that claim a change but materialize as a no-op', () => {
    const current = snapshot();
    expect(
      validateNodeSlidePatch(
        current,
        serverPatch(
          current,
          [
            {
              op: 'replace_text',
              slideId: 'slide-1',
              elementId: 'headline',
              text: 'Before',
            },
          ],
          {
            kind: 'elements',
            deckId: current.deck.id,
            slideIds: ['slide-1'],
            elementIds: ['headline'],
            operationMode: 'copy',
          },
        ),
      ),
    ).toContain('replace_text must change element headline.');
    expect(
      validateNodeSlidePatch(
        current,
        serverPatch(current, [
          {
            op: 'update_style',
            slideId: 'slide-1',
            elementId: 'headline',
            properties: { color: '#13233f' },
          },
        ]),
      ),
    ).toContain('update_style must change element headline.');

    expect(
      validateNodeSlidePatch(
        current,
        serverPatch(current, [
          {
            op: 'replace_text',
            slideId: 'slide-1',
            elementId: 'headline',
            text: 'After',
          },
          {
            op: 'replace_text',
            slideId: 'slide-1',
            elementId: 'headline',
            text: 'After',
          },
        ]),
      ),
    ).toContain('replace_text must change element headline.');

    const canonical = snapshot();
    const canonicalHeadline = canonical.elements.find((element) => element.id === 'headline');
    if (!canonicalHeadline) throw new Error('Missing headline fixture');
    canonicalHeadline.bbox.width = 0.01;
    expect(
      validateNodeSlidePatch(
        canonical,
        serverPatch(canonical, [
          {
            op: 'resize',
            slideId: 'slide-1',
            elementId: 'headline',
            width: 0.001,
            height: canonicalHeadline.bbox.height,
          },
        ]),
      ),
    ).toContain('resize must change element headline.');
  });

  it('targets semantic copy instead of auxiliary labels in deterministic fallback', () => {
    const current = snapshot();
    const headline = current.elements.find((element) => element.id === 'headline');
    if (!headline) throw new Error('Missing headline fixture');
    current.elements.unshift({
      ...headline,
      id: 'section',
      name: 'Section label',
      role: 'section',
      content: 'OPENING / 01',
    });
    current.elements.push({
      ...headline,
      id: 'body',
      name: 'Body copy',
      role: 'body',
      content: 'Original body copy.',
    });
    const operations = deterministicAgentOperations(
      current,
      'Replace the body with “Reliability, security, and retention gate launch.”',
      {
        kind: 'slide',
        deckId: current.deck.id,
        slideIds: ['slide-1'],
        operationMode: 'unrestricted',
      },
    );
    expect(operations).toEqual([
      {
        op: 'replace_text',
        slideId: 'slide-1',
        elementId: 'body',
        text: 'Reliability, security, and retention gate launch.',
      },
    ]);
  });

  it('fails honestly when deterministic copy fallback cannot infer safe wording', () => {
    const current = snapshot();
    expect(() =>
      deterministicAgentOperations(
        current,
        'Make the story more persuasive without inventing metrics.',
        {
          kind: 'slide',
          deckId: current.deck.id,
          slideIds: ['slide-1'],
          operationMode: 'unrestricted',
        },
      ),
    ).toThrow('could not safely infer a copy, style, or layout operation');
  });

  it('turns a typo-tolerant whole-slide topic request into a focused reviewable copy patch', () => {
    const current = snapshotWithSecondSlide();
    const headline = current.elements.find((element) => element.id === 'headline');
    const firstSlide = current.slides.find((slide) => slide.id === 'slide-1');
    if (!headline || !firstSlide) throw new Error('Expected the primary slide fixture.');
    headline.role = 'headline';
    const semanticElements: SlideElement[] = [
      { ...headline, id: 'section', name: 'Section label', role: 'section', content: 'STORIES' },
      { ...headline, id: 'body', name: 'Body copy', role: 'body', content: 'Original body.' },
      { ...headline, id: 'bullet-1', name: 'Key point 1', role: 'bullet', content: '01  First' },
      { ...headline, id: 'bullet-2', name: 'Key point 2', role: 'bullet', content: '02  Second' },
      { ...headline, id: 'bullet-3', name: 'Key point 3', role: 'bullet', content: '03  Third' },
    ];
    current.elements.push(...semanticElements);
    firstSlide.elementOrder = [
      'section',
      'headline',
      'body',
      'bullet-1',
      'bullet-2',
      'bullet-3',
      'chart',
    ];

    const operations = deterministicAgentOperations(
      current,
      'What if I wanted to make the entire slide aout AI agents?',
      { kind: 'deck', deckId: current.deck.id, operationMode: 'unrestricted' },
      { preferredSlideId: 'slide-1' },
    );

    expect(operations).toHaveLength(6);
    expect(operations.every((operation) => operation.op === 'replace_text')).toBe(true);
    expect(
      operations.every(
        (operation) => operation.op === 'replace_text' && operation.slideId === 'slide-1',
      ),
    ).toBe(true);
    expect(JSON.stringify(operations)).toContain('AI agents');
    expect(JSON.stringify(operations)).toContain('bounded context');
    expect(JSON.stringify(operations)).not.toContain('slide-2');
  });

  it('uses the new value in an old/new quoted replacement and rejects mismatches', () => {
    const current = snapshot();
    const scope: PatchScope = {
      kind: 'slide',
      deckId: current.deck.id,
      slideIds: ['slide-1'],
      operationMode: 'unrestricted',
    };
    expect(deterministicAgentOperations(current, 'Replace "Before" with "After".', scope)).toEqual([
      {
        op: 'replace_text',
        slideId: 'slide-1',
        elementId: 'headline',
        text: 'After',
      },
    ]);
    expect(() =>
      deterministicAgentOperations(current, 'Replace "Missing" with "After".', scope),
    ).toThrow('could not safely infer new wording');
  });
});
