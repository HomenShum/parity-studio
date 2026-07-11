import {
  type BoundingBox,
  type DeckComment,
  type DeckPatch,
  type DeckSnapshot,
  type PatchOperation,
  type PatchScope,
  type SlideElement,
  isElementOperation,
} from '../../shared/nodeslide';
import { validatePatchScope } from '../../shared/nodeslidePatch';
import { nodeslideCleanText } from './nodeslideIds';
import { boundingBoxesIntersect, isNormalizedBoundingBox } from './nodeslideValidation';

const MAX_DECK_TITLE_LENGTH = 160;

export interface NodeSlideCasResult {
  canCommit: boolean;
  rebased: boolean;
  touchedSlideIds: string[];
  touchedElementIds: string[];
  reasons: string[];
}

export type NodeSlidePatchInput = Pick<
  DeckPatch,
  | 'deckId'
  | 'baseDeckVersion'
  | 'baseSlideVersions'
  | 'baseElementVersions'
  | 'scope'
  | 'operations'
>;

export function validateNodeSlidePatch(
  snapshot: DeckSnapshot,
  patch: NodeSlidePatchInput,
  scopedComment?: DeckComment | null,
): string[] {
  const errors = validatePatchScope(patch.scope, patch.operations);
  if (patch.deckId !== snapshot.deck.id) {
    errors.push(`Patch deck ${patch.deckId} does not match current deck ${snapshot.deck.id}.`);
  }
  if (patch.scope.deckId !== patch.deckId) {
    errors.push(`Scope deck ${patch.scope.deckId} does not match patch deck ${patch.deckId}.`);
  }
  if (patch.operations.length === 0) errors.push('A patch must contain at least one operation.');

  const initialSlides = new Map(snapshot.slides.map((slide) => [slide.id, slide]));
  const initialElements = new Map(snapshot.elements.map((element) => [element.id, element]));
  const slides = new Map(initialSlides);
  const elements = new Map(initialElements);
  const slideOrder = [...snapshot.deck.slideOrder];
  const sources = new Set(snapshot.sources.map((source) => source.id));
  const addedSlideIds = new Set<string>();
  const addedElementSlideIds = new Map<string, string>();
  for (const operation of patch.operations) {
    if (operation.op === 'add_slide') {
      addedSlideIds.add(operation.slide.id);
      for (const element of operation.elements) {
        addedElementSlideIds.set(element.id, operation.slide.id);
      }
    } else if (operation.op === 'add_element') {
      addedElementSlideIds.set(operation.element.id, operation.slideId);
    }
  }

  if ('slideIds' in patch.scope) {
    if (patch.scope.slideIds.length === 0) errors.push('Scoped slideIds cannot be empty.');
    if (new Set(patch.scope.slideIds).size !== patch.scope.slideIds.length) {
      errors.push('Scoped slideIds must be unique.');
    }
    for (const slideId of patch.scope.slideIds) {
      if (!initialSlides.has(slideId) && !addedSlideIds.has(slideId)) {
        errors.push(`Scope references unknown slide ${slideId}.`);
      }
    }
  }
  if ('elementIds' in patch.scope) {
    if (patch.scope.elementIds.length === 0) errors.push('Scoped elementIds cannot be empty.');
    if (new Set(patch.scope.elementIds).size !== patch.scope.elementIds.length) {
      errors.push('Scoped elementIds must be unique.');
    }
    for (const elementId of patch.scope.elementIds) {
      const element = initialElements.get(elementId);
      const elementSlideId = element?.slideId ?? addedElementSlideIds.get(elementId);
      if (!elementSlideId) {
        errors.push(`Scope references unknown element ${elementId}.`);
      } else if ('slideIds' in patch.scope && !patch.scope.slideIds.includes(elementSlideId)) {
        errors.push(`Scoped element ${elementId} is outside scoped slides.`);
      }
    }
  }
  if (patch.scope.kind === 'bounding_box') {
    if (!isNormalizedBoundingBox(patch.scope.bbox)) {
      errors.push('Bounding-box scope must be finite, positive, normalized, and fully in bounds.');
    }
    for (const elementId of patch.scope.elementIds) {
      const element = initialElements.get(elementId);
      if (element && !boundingBoxesIntersect(element.bbox, patch.scope.bbox)) {
        errors.push(`Scoped element ${elementId} does not intersect the bounding-box scope.`);
      }
    }
  }
  if (patch.scope.kind === 'comment') {
    if (!scopedComment || scopedComment.id !== patch.scope.commentId) {
      errors.push(`Comment scope ${patch.scope.commentId} does not resolve to a comment.`);
    } else {
      if (scopedComment.deckId !== patch.deckId) {
        errors.push(`Comment ${scopedComment.id} belongs to another deck.`);
      }
      if (scopedComment.status !== 'open') {
        errors.push(`Comment ${scopedComment.id} is not open.`);
      }
    }
  }

  for (const operation of patch.operations) {
    if (operation.op === 'update_deck') {
      validateDeckTitle(operation.properties.title, errors);
      if (operation.properties.title?.trim() === snapshot.deck.title) {
        errors.push('update_deck must change the deck title.');
      }
      continue;
    }

    if (operation.op === 'add_slide') {
      const slideId = operation.slide.id;
      const validIndex =
        Number.isInteger(operation.index) &&
        operation.index >= 0 &&
        operation.index <= slideOrder.length;
      if (!validIndex) {
        errors.push(`Slide insertion index ${operation.index} is outside deck bounds.`);
      }

      const duplicateSlide = slides.has(slideId) || slideOrder.includes(slideId);
      if (duplicateSlide) errors.push(`Slide ${slideId} already exists.`);
      if (operation.slide.deckId !== patch.deckId) {
        errors.push(`Added slide ${slideId} belongs to another deck.`);
      }

      const bundledIds = new Set<string>();
      for (const element of operation.elements) {
        if (bundledIds.has(element.id)) {
          errors.push(`Added slide ${slideId} contains duplicate element ${element.id}.`);
        }
        bundledIds.add(element.id);
        if (elements.has(element.id)) errors.push(`Element ${element.id} already exists.`);
        if (element.slideId !== slideId) {
          errors.push(`Added element ${element.id} declares a different slideId.`);
        }
        validateAddedElement(element, patch.scope, sources, errors);
      }
      validateAddedSlideElementOrder(operation.slide.elementOrder, bundledIds, slideId, errors);

      if (!duplicateSlide) slides.set(slideId, operation.slide);
      if (validIndex && !duplicateSlide) slideOrder.splice(operation.index, 0, slideId);
      for (const element of operation.elements) {
        if (!elements.has(element.id)) elements.set(element.id, element);
      }
      continue;
    }

    const slide = slides.get(operation.slideId);
    if (!slide) {
      errors.push(`Operation ${operation.op} references unknown slide ${operation.slideId}.`);
      continue;
    }
    if (operation.op === 'remove_slide') {
      if (slideOrder.length <= 1 || slides.size <= 1) {
        errors.push('Cannot remove the final slide from a deck.');
        continue;
      }
      const orderIndex = slideOrder.indexOf(operation.slideId);
      if (orderIndex < 0) {
        errors.push(`Operation remove_slide references unknown slide ${operation.slideId}.`);
        continue;
      }
      slideOrder.splice(orderIndex, 1);
      slides.delete(operation.slideId);
      for (const [elementId, element] of elements) {
        if (element.slideId === operation.slideId) elements.delete(elementId);
      }
      continue;
    }
    if (operation.op === 'reorder_slide') {
      if (
        !Number.isInteger(operation.index) ||
        operation.index < 0 ||
        operation.index >= slideOrder.length
      ) {
        errors.push(`Slide reorder index ${operation.index} is outside deck bounds.`);
      } else {
        const previousIndex = slideOrder.indexOf(operation.slideId);
        if (previousIndex >= 0) {
          if (previousIndex === operation.index) {
            errors.push(`reorder_slide must move slide ${operation.slideId} to a new index.`);
          }
          slideOrder.splice(previousIndex, 1);
          slideOrder.splice(operation.index, 0, operation.slideId);
        }
      }
      continue;
    }
    if (operation.op === 'update_slide') {
      if (Object.keys(operation.properties).length === 0) {
        errors.push('update_slide requires at least one property.');
      }
      if (
        operation.properties.background !== undefined &&
        operation.properties.background.trim().length === 0
      ) {
        errors.push('Slide background cannot be empty.');
      }
      const changesSlide =
        (operation.properties.title !== undefined && operation.properties.title !== slide.title) ||
        (operation.properties.notes !== undefined && operation.properties.notes !== slide.notes) ||
        (operation.properties.background !== undefined &&
          operation.properties.background !== slide.background);
      if (!changesSlide) {
        errors.push(`update_slide must change slide ${operation.slideId}.`);
      }
      continue;
    }
    if (operation.op === 'add_element') {
      if (operation.element.slideId !== operation.slideId) {
        errors.push(`Added element ${operation.element.id} declares a different slideId.`);
      }
      if (elements.has(operation.element.id)) {
        errors.push(`Element ${operation.element.id} already exists.`);
      }
      if ('elementIds' in patch.scope && !patch.scope.elementIds.includes(operation.element.id)) {
        errors.push(`Added element ${operation.element.id} is not explicitly named in scope.`);
      }
      validateAddedElement(operation.element, patch.scope, sources, errors);
      if (!elements.has(operation.element.id)) {
        elements.set(operation.element.id, operation.element);
      }
      continue;
    }

    const element = elements.get(operation.elementId);
    if (!element || element.slideId !== operation.slideId) {
      errors.push(`Operation ${operation.op} references unknown element ${operation.elementId}.`);
      continue;
    }
    if (element.locked) errors.push(`Element ${operation.elementId} is locked.`);
    if (operation.op === 'replace_text' && element.kind !== 'text') {
      errors.push(
        `replace_text requires a text element; ${operation.elementId} is ${element.kind}.`,
      );
    }
    if (operation.op === 'replace_text' && operation.text === (element.content ?? '')) {
      errors.push(`replace_text must change element ${operation.elementId}.`);
    }
    if (operation.op === 'move') {
      if (
        !isUnitValue(operation.x) ||
        !isUnitValue(operation.y) ||
        operation.x + element.bbox.width > 1 + Number.EPSILON ||
        operation.y + element.bbox.height > 1 + Number.EPSILON
      ) {
        errors.push(
          `Move for ${operation.elementId} would place its bbox outside normalized bounds.`,
        );
      }
      if (operation.x === element.bbox.x && operation.y === element.bbox.y) {
        errors.push(`move must change element ${operation.elementId}.`);
      }
    }
    if (operation.op === 'resize') {
      if (
        !isPositiveUnitValue(operation.width) ||
        !isPositiveUnitValue(operation.height) ||
        element.bbox.x + operation.width > 1 + Number.EPSILON ||
        element.bbox.y + operation.height > 1 + Number.EPSILON
      ) {
        errors.push(
          `Resize for ${operation.elementId} would place its bbox outside normalized bounds.`,
        );
      }
      if (operation.width === element.bbox.width && operation.height === element.bbox.height) {
        errors.push(`resize must change element ${operation.elementId}.`);
      }
    }
    if (operation.op === 'update_style') {
      const styleKeys = Object.keys(operation.properties) as Array<
        keyof typeof operation.properties
      >;
      if (styleKeys.length === 0) {
        errors.push('update_style requires at least one property.');
      } else if (styleKeys.every((key) => element.style[key] === operation.properties[key])) {
        errors.push(`update_style must change element ${operation.elementId}.`);
      }
    }
    if (operation.op === 'remove_element') elements.delete(operation.elementId);
  }

  return [...new Set(errors)];
}

export function evaluateNodeSlideCas(
  snapshot: DeckSnapshot,
  patch: NodeSlidePatchInput,
): NodeSlideCasResult {
  const touched = touchedNodeSlideIds(snapshot, patch.operations);
  const reasons: string[] = [];
  const requiresExactDeckVersion = patch.operations.some(
    (operation) =>
      operation.op === 'add_slide' ||
      operation.op === 'remove_slide' ||
      operation.op === 'update_deck',
  );
  if (requiresExactDeckVersion && patch.baseDeckVersion !== snapshot.deck.version) {
    reasons.push(
      `Deck changed from v${patch.baseDeckVersion} to v${snapshot.deck.version}; deck-level operations cannot be rebased.`,
    );
  }
  for (const slideId of touched.slideIds) {
    const slide = snapshot.slides.find((candidate) => candidate.id === slideId);
    const expected = patch.baseSlideVersions[slideId];
    if (!slide) {
      reasons.push(`Touched slide ${slideId} no longer exists.`);
    } else if (expected === undefined) {
      reasons.push(`No base slide clock was supplied for ${slideId}.`);
    } else if (expected !== slide.version) {
      reasons.push(`Slide ${slideId} changed from v${expected} to v${slide.version}.`);
    }
  }
  for (const elementId of touched.elementIds) {
    const element = snapshot.elements.find((candidate) => candidate.id === elementId);
    const expected = patch.baseElementVersions[elementId];
    if (!element) {
      reasons.push(`Touched element ${elementId} no longer exists.`);
    } else if (expected === undefined) {
      reasons.push(`No base element clock was supplied for ${elementId}.`);
    } else if (expected !== element.version) {
      reasons.push(`Element ${elementId} changed from v${expected} to v${element.version}.`);
    }
  }
  return {
    canCommit: reasons.length === 0,
    rebased: reasons.length === 0 && patch.baseDeckVersion !== snapshot.deck.version,
    touchedSlideIds: touched.slideIds,
    touchedElementIds: touched.elementIds,
    reasons,
  };
}

export function touchedNodeSlideIds(
  snapshot: DeckSnapshot,
  operations: readonly PatchOperation[],
): { slideIds: string[]; elementIds: string[] } {
  const slideIds = new Set<string>();
  const elementIds = new Set<string>();
  const existingIds = new Set(snapshot.elements.map((element) => element.id));
  for (const operation of operations) {
    if (operation.op === 'update_deck' || operation.op === 'add_slide') continue;
    slideIds.add(operation.slideId);
    if (operation.op === 'remove_slide') {
      for (const element of snapshot.elements) {
        if (element.slideId === operation.slideId) elementIds.add(element.id);
      }
      continue;
    }
    if (isElementOperation(operation) && operation.op !== 'add_element') {
      if (existingIds.has(operation.elementId)) elementIds.add(operation.elementId);
    }
  }
  return { slideIds: [...slideIds], elementIds: [...elementIds] };
}

export function clocksForNodeSlideOperations(
  snapshot: DeckSnapshot,
  operations: readonly PatchOperation[],
): { baseSlideVersions: Record<string, number>; baseElementVersions: Record<string, number> } {
  const touched = touchedNodeSlideIds(snapshot, operations);
  return {
    baseSlideVersions: Object.fromEntries(
      touched.slideIds.flatMap((slideId) => {
        const slide = snapshot.slides.find((candidate) => candidate.id === slideId);
        return slide ? [[slideId, slide.version]] : [];
      }),
    ),
    baseElementVersions: Object.fromEntries(
      touched.elementIds.flatMap((elementId) => {
        const element = snapshot.elements.find((candidate) => candidate.id === elementId);
        return element ? [[elementId, element.version]] : [];
      }),
    ),
  };
}

export function deterministicAgentOperations(
  snapshot: DeckSnapshot,
  instruction: string,
  scope: PatchScope,
): PatchOperation[] {
  const eligible = eligibleElements(snapshot, scope);
  const lower = instruction.toLowerCase();
  const inferredMode =
    scope.operationMode !== 'unrestricted'
      ? scope.operationMode
      : /move|layout|align|position|space|resize/.test(lower)
        ? 'layout'
        : /copy|text|title|headline|body|paragraph|description|summary|bullet|section|label|word|short|concise|say|read|replace|rewrite/.test(
              lower,
            )
          ? 'copy'
          : /style|color|font|bold|weight|emphasis|accent|contrast|visual/.test(lower)
            ? 'style'
            : null;

  if (inferredMode === null) {
    throw new Error(
      'The free route returned an invalid proposal, and the deterministic fallback could not safely infer a copy, style, or layout operation.',
    );
  }

  if (inferredMode === 'copy') {
    const target = selectDeterministicTextTarget(eligible, instruction);
    if (!target) throw new Error('Deterministic copy fallback found no unlocked text in scope.');
    const text = deterministicRewrite(target.content ?? '', instruction);
    if (text === null) {
      throw new Error(
        'The free route returned an invalid proposal, and the deterministic copy fallback could not safely infer new wording. Retry with exact replacement copy in quotation marks.',
      );
    }
    if (text === (target.content ?? '')) {
      throw new Error(
        `The free route returned an invalid proposal, and the deterministic copy fallback would not change ${target.name}.`,
      );
    }
    return [
      {
        op: 'replace_text',
        slideId: target.slideId,
        elementId: target.id,
        text,
      },
    ];
  }
  if (inferredMode === 'layout') {
    const target = eligible[0];
    if (!target)
      throw new Error('Deterministic layout fallback found no unlocked element in scope.');
    const horizontalDelta = target.bbox.x + target.bbox.width + 0.02 <= 1 ? 0.02 : -0.02;
    const verticalDelta = target.bbox.y + target.bbox.height + 0.015 <= 1 ? 0.015 : -0.015;
    return [
      {
        op: 'move',
        slideId: target.slideId,
        elementId: target.id,
        x: roundNormalized(target.bbox.x + horizontalDelta),
        y: roundNormalized(target.bbox.y + verticalDelta),
      },
    ];
  }

  const target = eligible.find((element) => element.kind === 'text') ?? eligible[0];
  if (!target) throw new Error('Deterministic style fallback found no unlocked element in scope.');
  return [
    {
      op: 'update_style',
      slideId: target.slideId,
      elementId: target.id,
      properties: {
        color: snapshot.deck.theme.colors.accent,
        ...(target.kind === 'text'
          ? { fontWeight: Math.max(target.style.fontWeight ?? 500, 650) }
          : {}),
      },
    },
  ];
}

export function summarizePatchOperations(
  operations: readonly PatchOperation[],
  snapshot?: DeckSnapshot,
): string {
  const labels = operations.map((operation) => {
    if (operation.op === 'update_deck') return 'update deck title';
    if (operation.op === 'add_slide') return `add slide ${operation.slide.title}`;
    const slideLabel =
      snapshot?.slides.find((slide) => slide.id === operation.slideId)?.title ?? operation.slideId;
    if (operation.op === 'remove_slide') return `remove slide ${slideLabel}`;
    if (operation.op === 'reorder_slide') return `reorder slide ${slideLabel}`;
    if (operation.op === 'update_slide') return `update slide ${slideLabel}`;
    if (operation.op === 'add_element') return `add ${operation.element.name}`;
    const elementLabel =
      snapshot?.elements.find((element) => element.id === operation.elementId)?.name ??
      operation.elementId;
    return `${operation.op.replaceAll('_', ' ')} ${elementLabel}`;
  });
  return nodeslideCleanText(labels.join('; '), 240);
}

function validateDeckTitle(value: string | undefined, errors: string[]): void {
  if (value === undefined) {
    errors.push('update_deck requires a title.');
    return;
  }
  const title = value.trim();
  if (!title) {
    errors.push('Deck title cannot be empty.');
  } else if (title.length > MAX_DECK_TITLE_LENGTH) {
    errors.push(`Deck title cannot exceed ${MAX_DECK_TITLE_LENGTH} characters.`);
  }
}

function validateAddedElement(
  element: SlideElement,
  scope: PatchScope,
  sourceIds: ReadonlySet<string>,
  errors: string[],
): void {
  if (!isNormalizedBoundingBox(element.bbox)) {
    errors.push(`Added element ${element.id} must have a normalized in-bounds bbox.`);
  }
  if (scope.kind === 'bounding_box' && !boundingBoxesIntersect(element.bbox, scope.bbox)) {
    errors.push(`Added element ${element.id} is outside the bounding-box scope.`);
  }
  for (const sourceId of element.sourceIds) {
    if (!sourceIds.has(sourceId)) {
      errors.push(`Added element ${element.id} references unknown source ${sourceId}.`);
    }
  }
  if (element.chart?.sourceId && !sourceIds.has(element.chart.sourceId)) {
    errors.push(`Added chart ${element.id} references unknown source ${element.chart.sourceId}.`);
  }
}

function validateAddedSlideElementOrder(
  elementOrder: readonly string[],
  elementIds: ReadonlySet<string>,
  slideId: string,
  errors: string[],
): void {
  const orderedIds = new Set(elementOrder);
  if (orderedIds.size !== elementOrder.length) {
    errors.push(`Added slide ${slideId} has duplicate IDs in elementOrder.`);
  }
  if (
    orderedIds.size !== elementIds.size ||
    [...orderedIds].some((elementId) => !elementIds.has(elementId))
  ) {
    errors.push(`Added slide ${slideId} must order every bundled element exactly once.`);
  }
}

function eligibleElements(snapshot: DeckSnapshot, scope: PatchScope): SlideElement[] {
  const slideIds = 'slideIds' in scope ? new Set(scope.slideIds) : null;
  const elementIds = 'elementIds' in scope ? new Set(scope.elementIds) : null;
  return snapshot.elements.filter((element) => {
    if (element.locked) return false;
    if (slideIds && !slideIds.has(element.slideId)) return false;
    if (elementIds && !elementIds.has(element.id)) return false;
    if (scope.kind === 'bounding_box' && !boundingBoxesIntersect(element.bbox, scope.bbox)) {
      return false;
    }
    return true;
  });
}

function selectDeterministicTextTarget(
  eligible: readonly SlideElement[],
  instruction: string,
): SlideElement | undefined {
  const textElements = eligible.filter((element) => element.kind === 'text');
  if (textElements.length <= 1) return textElements[0];

  const lower = instruction.toLowerCase();
  const intents = [
    { pattern: /\b(?:headline|heading|title)\b/, roles: ['title', 'headline'] },
    { pattern: /\b(?:body|paragraph|description|summary)\b/, roles: ['body'] },
    { pattern: /\b(?:bullet|key point)\b/, roles: ['bullet'] },
    { pattern: /\b(?:metric|number|stat)\b/, roles: ['metric', 'caption'] },
    { pattern: /\b(?:section|eyebrow|label)\b/, roles: ['section'] },
  ]
    .map((intent) => ({ ...intent, index: lower.search(intent.pattern) }))
    .filter((intent) => intent.index >= 0)
    .sort((a, b) => a.index - b.index);
  const requestedRoles = intents[0]?.roles;
  if (requestedRoles) {
    const explicit = textElements.find((element) =>
      requestedRoles.includes((element.role ?? '').toLowerCase()),
    );
    if (explicit) return explicit;
  }

  const rolePriority = ['title', 'headline', 'body', 'bullet', 'metric', 'caption'];
  return [...textElements].sort((left, right) => {
    const leftIndex = rolePriority.indexOf((left.role ?? '').toLowerCase());
    const rightIndex = rolePriority.indexOf((right.role ?? '').toLowerCase());
    const leftScore = leftIndex < 0 ? rolePriority.length : leftIndex;
    const rightScore = rightIndex < 0 ? rolePriority.length : rightIndex;
    return leftScore - rightScore;
  })[0];
}

function deterministicRewrite(current: string, instruction: string): string | null {
  const quotedMatch = instruction.match(/(?:“([^”]{1,500})”|"([^"]{1,500})")/u);
  const quoted = (quotedMatch?.[1] ?? quotedMatch?.[2])?.trim();
  if (quoted) return quoted;
  const direct = instruction
    .match(
      /(?:replace(?:\s+(?:the\s+)?(?:copy|text|headline|title|body))?\s+with|set(?:\s+(?:the\s+)?(?:copy|text|headline|title|body))?\s+to|(?:say|read))\s*[:\-]?\s*(.{3,500})$/i,
    )?.[1]
    ?.trim();
  if (direct && !/^(make|be|feel)\b/i.test(direct)) return nodeslideCleanText(direct, 500);
  if (/upper(?:case)?|all caps/i.test(instruction)) return current.toUpperCase();
  if (/lower(?:case)?/i.test(instruction)) return current.toLowerCase();
  if (/short|concise|tight|trim/i.test(instruction)) {
    const firstSentence = current.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
    if (firstSentence && firstSentence.length < current.length) return firstSentence;
    return nodeslideCleanText(current, Math.max(24, Math.floor(current.length * 0.65)));
  }
  if (/question/i.test(instruction)) return `${current.replace(/[.!?]+$/, '')}?`;
  return null;
}

function isUnitValue(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPositiveUnitValue(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 1;
}

function roundNormalized(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 1000) / 1000));
}

export function bboxContainsPoint(bbox: BoundingBox, x: number, y: number): boolean {
  return x >= bbox.x && x <= bbox.x + bbox.width && y >= bbox.y && y <= bbox.y + bbox.height;
}
