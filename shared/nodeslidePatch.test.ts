import { describe, expect, it } from 'vitest';
import {
  clocksForNodeSlideOperations,
  evaluateNodeSlideCas,
  summarizePatchOperations,
  touchedNodeSlideIds,
  validateNodeSlidePatch,
} from '../convex/lib/nodeslidePatches';
import {
  type DeckSnapshot,
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
    expect(
      validatePatchScope(
        {
          kind: 'elements',
          deckId: 'deck-1',
          slideIds: ['slide-1'],
          elementIds: ['headline'],
          operationMode: 'unrestricted',
        },
        [removeOperation],
      ),
    ).toContain('Operation remove_slide targets a whole slide outside element scope.');

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
  });
});
