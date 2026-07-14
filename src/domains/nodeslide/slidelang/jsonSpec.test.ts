import { describe, expect, it } from 'vitest';
import {
  type DeckSnapshot,
  NODESLIDE_SCHEMA_VERSION,
  type SlideElement,
} from '../../../../shared/nodeslide';
import { applyDeckPatch } from '../../../../shared/nodeslidePatch';
import {
  NODESLIDE_JSON_FORMAT,
  NODESLIDE_JSON_VERSION,
  diffNodeSlideSnapshots,
  exportNodeSlideJson,
  parseNodeSlideJson,
} from './jsonSpec';
import { createLocalSlideLangAdapter } from './localAdapter';

function snapshot(): DeckSnapshot {
  return createLocalSlideLangAdapter().scaffold({
    deckId: 'deck-json',
    projectId: 'project-json',
    title: 'Portable deck',
    brief: {
      prompt: 'Build a portable deck',
      audience: 'Reviewers',
      purpose: 'Verify JSON portability',
      successCriteria: ['Round trips exactly'],
    },
    timestamp: 100,
  });
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing test fixture ${label}.`);
  return value;
}

function withoutVersions(value: DeckSnapshot): unknown {
  const slidesById = new Map(value.slides.map((slide) => [slide.id, slide]));
  const elementsById = new Map(value.elements.map((element) => [element.id, element]));
  const orderedSlides = value.deck.slideOrder.flatMap((slideId) => {
    const slide = slidesById.get(slideId);
    return slide ? [slide] : [];
  });
  return {
    deck: {
      title: value.deck.title,
      slideOrder: value.deck.slideOrder,
    },
    slides: orderedSlides.map(({ version: _version, ...slide }) => slide),
    elements: orderedSlides.flatMap((slide) =>
      slide.elementOrder.flatMap((elementId) => {
        const element = elementsById.get(elementId);
        if (!element) return [];
        const { version: _version, ...content } = element;
        return [content];
      }),
    ),
    sources: value.sources,
  };
}

describe('NodeSlide JSON envelope', () => {
  it('exports and parses an exact, versioned snapshot with a preview', () => {
    const source = snapshot();
    const exported = exportNodeSlideJson(source);

    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.envelope).toMatchObject({
      format: NODESLIDE_JSON_FORMAT,
      version: NODESLIDE_JSON_VERSION,
    });
    expect(exported.preview).toMatchObject({
      deckId: 'deck-json',
      schemaVersion: NODESLIDE_SCHEMA_VERSION,
      slideCount: 1,
      elementCount: 2,
      sourceCount: 0,
    });

    const parsed = parseNodeSlideJson(exported.json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.snapshot).toEqual(source);
    expect(parsed.fidelity).toMatchObject({ fidelity: 'exact', canApply: true });
  });

  it('round-trips thin decorative geometry already valid in a canonical deck', () => {
    const source = snapshot();
    const decoration = required(source.elements[0], 'decorative element');
    decoration.bbox.width = 0.008;

    const exported = exportNodeSlideJson(source);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const parsed = parseNodeSlideJson(exported.json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.snapshot.elements[0]?.bbox.width).toBe(0.008);
  });

  it('rejects unknown envelope versions, element kinds, and non-canonical order', () => {
    const source = snapshot();
    const unsupportedVersion = JSON.stringify({
      format: NODESLIDE_JSON_FORMAT,
      version: 2,
      snapshot: source,
    });
    expect(parseNodeSlideJson(unsupportedVersion)).toMatchObject({
      ok: false,
      issues: [{ code: 'unsupported_version', path: '$.version' }],
    });

    const invalidKind = structuredClone(source) as unknown as {
      elements: Array<{ kind: string }>;
    };
    required(invalidKind.elements[0], 'first element').kind = 'table';
    expect(
      parseNodeSlideJson(
        JSON.stringify({
          format: NODESLIDE_JSON_FORMAT,
          version: NODESLIDE_JSON_VERSION,
          snapshot: invalidKind,
        }),
      ),
    ).toMatchObject({ ok: false, issues: [{ code: 'invalid_envelope' }] });

    const invalidOrder = structuredClone(source);
    const invalidOrderSlide = required(invalidOrder.slides[0], 'first slide');
    invalidOrderSlide.elementOrder = [
      required(invalidOrderSlide.elementOrder[0], 'first order ID'),
    ];
    const parsedOrder = parseNodeSlideJson(
      JSON.stringify({
        format: NODESLIDE_JSON_FORMAT,
        version: NODESLIDE_JSON_VERSION,
        snapshot: invalidOrder,
      }),
    );
    expect(parsedOrder).toMatchObject({ ok: false, issues: [{ code: 'invalid_snapshot' }] });
  });

  it('enforces caller-lowered byte and count bounds', () => {
    const source = snapshot();
    const exported = exportNodeSlideJson(source);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    expect(parseNodeSlideJson(exported.json, { maxInputBytes: 10 })).toMatchObject({
      ok: false,
      issues: [{ code: 'input_too_large' }],
    });
    expect(parseNodeSlideJson(exported.json, { maxElements: 1 })).toMatchObject({
      ok: false,
      issues: [{ code: 'limit_exceeded', path: 'snapshot.elements' }],
    });
  });
});

describe('NodeSlide JSON structural diff', () => {
  it('emits typed operations for title, slide fields, elements, and z-order', () => {
    const current = snapshot();
    const imported = structuredClone(current);
    const slide = required(imported.slides[0], 'first slide');
    const title = required(imported.elements[0], 'title element');
    const removed = required(imported.elements[1], 'purpose element');
    const added: SlideElement = {
      id: 'deck-json:slide:cover:callout',
      slideId: slide.id,
      name: 'Callout',
      kind: 'shape',
      bbox: { x: 0.05, y: 0.05, width: 0.2, height: 0.1 },
      rotation: 0,
      style: { fill: '#ffcc00' },
      sourceIds: [],
      locked: false,
      visible: true,
      exportCapabilities: ['web_native', 'pptx_editable'],
      version: 1,
    };

    imported.deck.title = 'Imported title';
    slide.title = 'Imported slide';
    slide.notes = 'Presenter note';
    slide.background = '#202020';
    slide.elementOrder = [added.id, title.id];
    title.bbox = { x: 0.75, y: 0.7, width: 0.25, height: 0.3 };
    title.content = 'Imported copy';
    title.style = { ...title.style, color: '#ffffff' };
    title.visible = false;
    imported.elements = [title, added];

    const diff = diffNodeSlideSnapshots(current, imported);
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    expect(diff.fidelity).toMatchObject({ fidelity: 'regenerated_metadata', canApply: true });
    expect(diff.operations.map((operation) => operation.op)).toEqual(
      expect.arrayContaining([
        'update_deck',
        'update_slide',
        'remove_element',
        'add_element',
        'move',
        'resize',
        'replace_text',
        'update_style',
        'set_visibility_v1',
        'reorder_element_v1',
      ]),
    );
    expect(diff.operations.findIndex((operation) => operation.op === 'resize')).toBeLessThan(
      diff.operations.findIndex((operation) => operation.op === 'move'),
    );
    expect(diff.preview).toMatchObject({
      deckTitleChanged: true,
      slidesUpdated: 1,
      elementsAdded: 1,
      elementsRemoved: 1,
      elementsUpdated: 1,
      elementsReordered: 1,
    });

    const applied = applyDeckPatch(
      current,
      {
        baseDeckVersion: current.deck.version,
        scope: { kind: 'deck', deckId: current.deck.id, operationMode: 'unrestricted' },
        operations: diff.operations,
      },
      200,
    ).snapshot;
    expect(withoutVersions(applied)).toEqual(withoutVersions(imported));
    expect(applied.elements.some((element) => element.id === removed.id)).toBe(false);
  });

  it('replaces an element through typed operations when its imported kind changes', () => {
    const current = snapshot();
    const imported = structuredClone(current);
    const importedTitle = required(imported.elements[0], 'title element');
    importedTitle.kind = 'shape';
    importedTitle.visible = true;

    const diff = diffNodeSlideSnapshots(current, imported);
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    expect(diff.fidelity.canApply).toBe(true);
    expect(diff.operations.map((operation) => operation.op)).toEqual(
      expect.arrayContaining(['remove_element', 'add_element', 'reorder_element_v1']),
    );

    const applied = applyDeckPatch(
      current,
      {
        baseDeckVersion: current.deck.version,
        scope: { kind: 'deck', deckId: current.deck.id, operationMode: 'unrestricted' },
        operations: diff.operations,
      },
      200,
    ).snapshot;
    expect(withoutVersions(applied)).toEqual(withoutVersions(imported));
    expect(applied.elements.find((element) => element.id === importedTitle.id)?.kind).toBe('shape');
  });

  it('adds, removes, and reorders whole slides while preserving imported IDs', () => {
    const current = snapshot();
    const secondSlide = {
      id: 'deck-json:slide:second',
      deckId: current.deck.id,
      title: 'Second',
      background: current.deck.theme.colors.canvas,
      elementOrder: [],
      version: 1,
    };
    current.slides.push(secondSlide);
    current.deck.slideOrder.push(secondSlide.id);

    const imported = structuredClone(current);
    const addedSlide = {
      id: 'deck-json:slide:added',
      deckId: current.deck.id,
      title: 'Added',
      background: '#303030',
      elementOrder: [],
      version: 1,
    };
    imported.slides = [secondSlide, addedSlide];
    imported.elements = [];
    imported.deck.slideOrder = [secondSlide.id, addedSlide.id];

    const diff = diffNodeSlideSnapshots(current, imported);
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    expect(diff.operations.map((operation) => operation.op)).toEqual(
      expect.arrayContaining(['add_slide', 'remove_slide', 'reorder_slide']),
    );
    expect(diff.preview).toMatchObject({
      slidesAdded: 1,
      slidesRemoved: 1,
      slidesReordered: 1,
    });

    const applied = applyDeckPatch(
      current,
      {
        baseDeckVersion: current.deck.version,
        scope: { kind: 'deck', deckId: current.deck.id, operationMode: 'unrestricted' },
        operations: diff.operations,
      },
      200,
    ).snapshot;
    expect(withoutVersions(applied)).toEqual(withoutVersions(imported));
  });

  it('rejects cross-slide element reparenting instead of emitting a colliding add', () => {
    const current = snapshot();
    const secondSlide = {
      id: 'deck-json:slide:second',
      deckId: current.deck.id,
      title: 'Second',
      background: current.deck.theme.colors.canvas,
      elementOrder: [],
      version: 1,
    };
    current.slides.push(secondSlide);
    current.deck.slideOrder.push(secondSlide.id);

    const imported = structuredClone(current);
    const movedElement = required(imported.elements[1], 'purpose element');
    const firstImportedSlide = required(imported.slides[0], 'first slide');
    const secondImportedSlide = required(imported.slides[1], 'second slide');
    movedElement.slideId = secondImportedSlide.id;
    firstImportedSlide.elementOrder = firstImportedSlide.elementOrder.filter(
      (elementId) => elementId !== movedElement.id,
    );
    secondImportedSlide.elementOrder = [movedElement.id];

    const diff = diffNodeSlideSnapshots(current, imported);
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    expect(diff.operations).toEqual([]);
    expect(diff.fidelity).toMatchObject({ fidelity: 'unsupported', canApply: false });
    expect(diff.fidelity.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'element_reparent_unsupported' })]),
    );
  });

  it('reports source-record and unsupported element-source changes instead of hiding writes', () => {
    const current = snapshot();
    const currentSlide = required(current.slides[0], 'first slide');
    current.sources = [
      {
        id: 'source-1',
        deckId: current.deck.id,
        title: 'Source',
        sourceType: 'url',
        url: 'https://example.com',
        retrievedAt: 100,
        citation: 'Example',
      },
    ];
    const shape: SlideElement = {
      id: 'shape-1',
      slideId: currentSlide.id,
      name: 'Shape',
      kind: 'shape',
      bbox: { x: 0, y: 0, width: 0.1, height: 0.1 },
      rotation: 0,
      style: {},
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native'],
      version: 1,
    };
    current.elements.push(shape);
    currentSlide.elementOrder.push(shape.id);

    const imported = structuredClone(current);
    required(imported.sources[0], 'first source').citation = 'Changed citation';
    required(
      imported.elements.find((element) => element.id === shape.id),
      'shape element',
    ).sourceIds = ['source-1'];
    const diff = diffNodeSlideSnapshots(current, imported);

    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    expect(diff.fidelity.canApply).toBe(false);
    expect(diff.fidelity.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['sources_unsupported', 'element_sources_unsupported']),
    );
    expect(diff.operations).toEqual([]);
  });

  it('returns no partial operation list when the patch bound would be exceeded', () => {
    const current = snapshot();
    const imported = structuredClone(current);
    imported.deck.title = 'Changed title';
    required(imported.slides[0], 'first slide').title = 'Changed slide';

    const diff = diffNodeSlideSnapshots(current, imported, { maxOperations: 1 });
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    expect(diff.operations).toEqual([]);
    expect(diff.preview.requiredOperationCount).toBe(2);
    expect(diff.fidelity).toMatchObject({ fidelity: 'unsupported', canApply: false });
    expect(diff.fidelity.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'operation_limit_exceeded' })]),
    );
  });
});
