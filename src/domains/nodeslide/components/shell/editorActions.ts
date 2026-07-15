import type {
  NodeSlideWorkspace,
  PatchScope,
  Slide,
  SlideElement,
} from '../../../../../shared/nodeslide';

export function elementScope(deckId: string, elements: readonly SlideElement[]): PatchScope {
  return {
    kind: 'elements',
    deckId,
    slideIds: [...new Set(elements.map((element) => element.slideId))],
    elementIds: elements.map((element) => element.id),
    operationMode: 'unrestricted',
  };
}

export function createBlankSlide(
  workspace: NodeSlideWorkspace,
  requestedIndex: number,
): { slide: Slide; elements: SlideElement[]; index: number } {
  const index = Math.max(0, Math.min(requestedIndex, workspace.deck.slideOrder.length));
  const slideId = uniqueClientId('slide');
  const titleId = uniqueClientId('element-title');
  const bodyId = uniqueClientId('element-body');
  const capabilities: SlideElement['exportCapabilities'] = [
    'web_native',
    'pptx_editable',
    'google_importable',
  ];
  const elements: SlideElement[] = [
    {
      id: titleId,
      slideId,
      name: 'Slide title',
      kind: 'text',
      role: 'headline',
      bbox: { x: 0.08, y: 0.1, width: 0.84, height: 0.16 },
      rotation: 0,
      content: 'Untitled slide',
      style: {
        color: workspace.deck.theme.colors.ink,
        fontFamily: workspace.deck.theme.typography.display,
        fontSize: 40,
        fontWeight: 700,
        lineHeight: 1.08,
      },
      sourceIds: [],
      locked: false,
      exportCapabilities: [...capabilities],
      version: 1,
    },
    {
      id: bodyId,
      slideId,
      name: 'Body copy',
      kind: 'text',
      role: 'body',
      bbox: { x: 0.08, y: 0.33, width: 0.72, height: 0.3 },
      rotation: 0,
      content: 'Add the point this slide needs to make.',
      style: {
        color: workspace.deck.theme.colors.muted,
        fontFamily: workspace.deck.theme.typography.body,
        fontSize: 24,
        fontWeight: 450,
        lineHeight: 1.35,
      },
      sourceIds: [],
      locked: false,
      exportCapabilities: [...capabilities],
      version: 1,
    },
  ];
  return {
    index,
    slide: {
      id: slideId,
      deckId: workspace.deck.id,
      title: 'Untitled slide',
      section: 'Deck',
      notes: '',
      background: workspace.deck.theme.colors.canvas,
      elementOrder: elements.map((element) => element.id),
      version: 1,
    },
    elements,
  };
}

export function duplicateSlide(
  workspace: NodeSlideWorkspace,
  sourceSlideId: string,
): { slide: Slide; elements: SlideElement[]; index: number } | null {
  const source = workspace.slides.find((slide) => slide.id === sourceSlideId);
  const sourceIndex = workspace.deck.slideOrder.indexOf(sourceSlideId);
  if (!source || sourceIndex < 0) return null;
  const slideId = uniqueClientId('slide');
  const sourceElements = source.elementOrder
    .map((elementId) => workspace.elements.find((element) => element.id === elementId))
    .filter((element): element is SlideElement => element !== undefined);
  const elementIds = new Map(
    sourceElements.map((element) => [element.id, uniqueClientId('element')]),
  );
  const elements = sourceElements.map((element) => ({
    ...structuredClone(element),
    id: elementIds.get(element.id) as string,
    slideId,
    version: 1,
  }));
  return {
    index: sourceIndex + 1,
    slide: {
      ...structuredClone(source),
      id: slideId,
      title: `${source.title} copy`,
      elementOrder: source.elementOrder.map((id) => elementIds.get(id) as string),
      version: 1,
    },
    elements,
  };
}

export function uniqueClientId(prefix: string) {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}
