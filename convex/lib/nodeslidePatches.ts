import {
  type BoundingBox,
  type DeckComment,
  type DeckPatch,
  type DeckSnapshot,
  NODESLIDE_ADD_SLIDE_ELEMENT_LIMIT,
  NODESLIDE_ELEMENT_SOURCE_LIMIT,
  NODESLIDE_GROUP_ID_LIMIT,
  NODESLIDE_GROUP_MEMBER_LIMIT,
  NODESLIDE_SCOPE_ELEMENT_LIMIT,
  NODESLIDE_SCOPE_SLIDE_LIMIT,
  NODESLIDE_VERSION_CLOCK_LIMIT,
  type PatchOperation,
  type PatchScope,
  type SlideElement,
  operationElementIds,
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
  validateClockBounds(
    'baseSlideVersions',
    patch.baseSlideVersions,
    NODESLIDE_VERSION_CLOCK_LIMIT,
    errors,
  );
  validateClockBounds(
    'baseElementVersions',
    patch.baseElementVersions,
    NODESLIDE_VERSION_CLOCK_LIMIT,
    errors,
  );

  const initialSlides = new Map(snapshot.slides.map((slide) => [slide.id, slide]));
  const initialElements = new Map(snapshot.elements.map((element) => [element.id, element]));
  const slides = new Map(
    snapshot.slides.map((slide) => [slide.id, structuredClone(slide)] as const),
  );
  const elements = new Map(
    snapshot.elements.map((element) => [element.id, structuredClone(element)] as const),
  );
  const slideOrder = [...snapshot.deck.slideOrder];
  let deckTitle = snapshot.deck.title;
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
    if (patch.scope.slideIds.length > NODESLIDE_SCOPE_SLIDE_LIMIT) {
      errors.push(`Patch scope supports at most ${NODESLIDE_SCOPE_SLIDE_LIMIT} slide IDs.`);
    }
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
    if (patch.scope.elementIds.length > NODESLIDE_SCOPE_ELEMENT_LIMIT) {
      errors.push(`Patch scope supports at most ${NODESLIDE_SCOPE_ELEMENT_LIMIT} element IDs.`);
    }
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
      validateCommentAnchorScope(scopedComment, patch.scope, initialElements, errors);
    }
  }

  for (const operation of patch.operations) {
    if (operation.op === 'update_deck') {
      validateDeckTitle(operation.properties.title, errors);
      const nextTitle = operation.properties.title?.trim();
      if (nextTitle === deckTitle) {
        errors.push('update_deck must change the deck title.');
      }
      if (nextTitle && nextTitle.length <= MAX_DECK_TITLE_LENGTH) deckTitle = nextTitle;
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
      if (operation.elements.length > NODESLIDE_ADD_SLIDE_ELEMENT_LIMIT) {
        errors.push(
          `Added slides support at most ${NODESLIDE_ADD_SLIDE_ELEMENT_LIMIT} bundled elements.`,
        );
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
      validateFlatGroupMetadata(operation.slide.elementOrder, operation.elements, errors);

      if (!duplicateSlide) slides.set(slideId, structuredClone(operation.slide));
      if (validIndex && !duplicateSlide) slideOrder.splice(operation.index, 0, slideId);
      for (const element of operation.elements) {
        if (!elements.has(element.id)) elements.set(element.id, structuredClone(element));
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
      if (
        changesSlide &&
        (operation.properties.background === undefined ||
          operation.properties.background.trim().length > 0)
      ) {
        Object.assign(slide, structuredClone(operation.properties));
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
      if (operation.element.groupId !== undefined) {
        errors.push('add_element cannot create partial group membership; group it explicitly.');
      }
      validateAddedElement(operation.element, patch.scope, sources, errors);
      if (!elements.has(operation.element.id)) {
        elements.set(operation.element.id, structuredClone(operation.element));
      }
      continue;
    }

    if (operation.op === 'group_elements_v1' || operation.op === 'ungroup_elements_v1') {
      const groupErrors = validateGroupOperation(operation, slide.elementOrder, elements);
      errors.push(...groupErrors);
      if (groupErrors.length === 0) {
        const members = operation.elementIds.map((elementId) => elements.get(elementId));
        if (operation.op === 'group_elements_v1') {
          slide.elementOrder = compactGroupOrder(slide.elementOrder, operation.elementIds);
          for (const member of members) if (member) member.groupId = operation.groupId;
        } else {
          for (const member of members) {
            if (!member) continue;
            // biome-ignore lint/performance/noDelete: optional storage must omit group metadata.
            delete member.groupId;
          }
        }
      }
      continue;
    }

    const element = elements.get(operation.elementId);
    if (!element || element.slideId !== operation.slideId) {
      errors.push(`Operation ${operation.op} references unknown element ${operation.elementId}.`);
      continue;
    }
    const canMutate = !element.locked;
    if (!canMutate) errors.push(`Element ${operation.elementId} is locked.`);
    if (operation.op === 'replace_text' && element.kind !== 'text' && element.kind !== 'math') {
      errors.push(
        `replace_text requires a text or math element; ${operation.elementId} is ${element.kind}.`,
      );
    }
    if (operation.op === 'replace_text' && (element.kind === 'text' || element.kind === 'math')) {
      const currentText =
        element.kind === 'math'
          ? (element.math?.display ?? element.math?.expression ?? element.content ?? '')
          : (element.content ?? '');
      if (operation.text === currentText) {
        errors.push(`replace_text must change element ${operation.elementId}.`);
      } else if (canMutate) {
        element.content = operation.text;
        if (element.kind === 'math' && element.math) {
          element.math.display = operation.text;
          element.math.expression = operation.text;
        }
      }
    }
    if (operation.op === 'move') {
      const invalidMove =
        !isUnitValue(operation.x) ||
        !isUnitValue(operation.y) ||
        operation.x + element.bbox.width > 1 + Number.EPSILON ||
        operation.y + element.bbox.height > 1 + Number.EPSILON;
      if (invalidMove) {
        errors.push(
          `Move for ${operation.elementId} would place its bbox outside normalized bounds.`,
        );
      } else {
        const nextBox = canonicalBox({ ...element.bbox, x: operation.x, y: operation.y });
        if (boxesEqual(nextBox, element.bbox)) {
          errors.push(`move must change element ${operation.elementId}.`);
        } else if (canMutate) {
          element.bbox = nextBox;
        }
      }
    }
    if (operation.op === 'resize') {
      const invalidResize =
        !isPositiveUnitValue(operation.width) ||
        !isPositiveUnitValue(operation.height) ||
        element.bbox.x + operation.width > 1 + Number.EPSILON ||
        element.bbox.y + operation.height > 1 + Number.EPSILON;
      if (invalidResize) {
        errors.push(
          `Resize for ${operation.elementId} would place its bbox outside normalized bounds.`,
        );
      } else {
        const nextBox = canonicalBox({
          ...element.bbox,
          width: operation.width,
          height: operation.height,
        });
        if (boxesEqual(nextBox, element.bbox)) {
          errors.push(`resize must change element ${operation.elementId}.`);
        } else if (canMutate) {
          element.bbox = nextBox;
        }
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
      } else if (canMutate) {
        element.style = { ...element.style, ...operation.properties };
      }
    }
    if (operation.op === 'update_chart') {
      if (element.kind !== 'chart') {
        errors.push(
          `update_chart requires a chart element; ${operation.elementId} is ${element.kind}.`,
        );
      } else {
        const chart = operation.chart;
        const validLabels = chart.labels.length > 0 && chart.labels.length <= 24;
        const validSeries =
          chart.series.length > 0 &&
          chart.series.length <= 6 &&
          chart.series.every(
            (series) =>
              series.name.trim().length > 0 &&
              series.values.length === chart.labels.length &&
              series.values.every(Number.isFinite),
          );
        if (!validLabels || !validSeries) {
          errors.push(
            'update_chart requires 1-24 labels and 1-6 finite series aligned to those labels.',
          );
        } else if (JSON.stringify(chart) === JSON.stringify(element.chart)) {
          errors.push(`update_chart must change element ${operation.elementId}.`);
        } else if (canMutate) {
          element.chart = structuredClone(chart);
        }
      }
    }
    if (operation.op === 'update_image') {
      if (element.kind !== 'image') {
        errors.push(
          `update_image requires an image element; ${operation.elementId} is ${element.kind}.`,
        );
      } else {
        const imageUrl = operation.imageUrl.trim();
        const altText = operation.altText.replace(/\s+/gu, ' ').trim();
        const isEmbeddedImage =
          /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/iu.test(imageUrl);
        if (!isEmbeddedImage || imageUrl.length > 700_000) {
          errors.push('update_image requires an embedded PNG, JPEG, WebP, or GIF under 700 KB.');
        }
        if (!altText || altText.length > 320) {
          errors.push('update_image requires alt text between 1 and 320 characters.');
        }
        if ((operation.credit?.length ?? 0) > 320) {
          errors.push('update_image credit cannot exceed 320 characters.');
        }
        if (
          operation.sourceIds?.some((sourceId) => !sources.has(sourceId)) ||
          (operation.sourceIds?.length ?? 0) > NODESLIDE_ELEMENT_SOURCE_LIMIT
        ) {
          errors.push('update_image contains an unknown or excessive source binding.');
        }
        if (
          isEmbeddedImage &&
          altText &&
          imageUrl.length <= 700_000 &&
          (operation.credit?.length ?? 0) <= 320 &&
          (operation.sourceIds?.length ?? 0) <= NODESLIDE_ELEMENT_SOURCE_LIMIT &&
          !operation.sourceIds?.some((sourceId) => !sources.has(sourceId))
        ) {
          const unchanged =
            imageUrl === (element.imageUrl ?? '') &&
            altText === (element.altText ?? '') &&
            (operation.credit ?? '') === (element.image?.credit ?? '');
          if (unchanged) {
            errors.push(`update_image must change element ${operation.elementId}.`);
          } else if (canMutate) {
            element.imageUrl = imageUrl;
            element.altText = altText;
            element.image = {
              placeholder: false,
              ...(operation.credit ? { credit: operation.credit.trim() } : {}),
              ...(element.image?.sourceId ? { sourceId: element.image.sourceId } : {}),
            };
            if (operation.sourceIds !== undefined) element.sourceIds = [...operation.sourceIds];
          }
        }
      }
    }
    if (operation.op === 'set_visibility_v1') {
      if ((element.visible ?? true) === operation.visible) {
        errors.push(`set_visibility_v1 must change element ${operation.elementId}.`);
      } else if (canMutate) {
        element.visible = operation.visible;
      }
    }
    if (operation.op === 'reorder_element_v1') {
      const previousIndex = slide.elementOrder.indexOf(operation.elementId);
      if (element.groupId !== undefined) {
        errors.push(`Element ${operation.elementId} must be ungrouped before z-order changes.`);
      } else if (
        !Number.isInteger(operation.index) ||
        operation.index < 0 ||
        operation.index >= slide.elementOrder.length
      ) {
        errors.push(`Element z-order index ${operation.index} is outside slide bounds.`);
      } else if (previousIndex < 0) {
        errors.push(`Element ${operation.elementId} is absent from slide order.`);
      } else if (previousIndex === operation.index) {
        errors.push(`reorder_element_v1 must change element ${operation.elementId}.`);
      } else if (canMutate) {
        slide.elementOrder.splice(previousIndex, 1);
        slide.elementOrder.splice(operation.index, 0, operation.elementId);
      }
    }
    if (operation.op === 'remove_element') {
      if (element.groupId !== undefined) {
        errors.push(`Element ${operation.elementId} must be ungrouped before removal.`);
      } else if (canMutate) {
        elements.delete(operation.elementId);
        slide.elementOrder = slide.elementOrder.filter((id) => id !== operation.elementId);
      }
    }
  }

  return [...new Set(errors)];
}

function validateCommentAnchorScope(
  comment: DeckComment,
  scope: Extract<PatchScope, { kind: 'comment' }>,
  elements: ReadonlyMap<string, SlideElement>,
  errors: string[],
): void {
  const anchor = comment.anchor;
  if (anchor.deckId !== scope.deckId) {
    errors.push(`Comment ${comment.id} anchor belongs to another deck.`);
  }
  if (anchor.type === 'deck') return;

  for (const slideId of scope.slideIds) {
    if (slideId !== anchor.slideId) {
      errors.push(`Comment ${comment.id} scope targets slide ${slideId} outside its anchor.`);
    }
  }

  for (const elementId of scope.elementIds) {
    const element = elements.get(elementId);
    if (!element) {
      errors.push(`Comment ${comment.id} scope cannot expand to new element ${elementId}.`);
      continue;
    }
    if (element.slideId !== anchor.slideId) {
      errors.push(`Comment ${comment.id} scope targets element ${elementId} outside its anchor.`);
      continue;
    }
    if (anchor.type === 'element' && element.id !== anchor.elementId) {
      errors.push(`Comment ${comment.id} scope targets element ${elementId} outside its anchor.`);
    }
    if (anchor.type === 'bounding_box' && !boundingBoxesIntersect(element.bbox, anchor.bbox)) {
      errors.push(`Comment ${comment.id} scope targets element ${elementId} outside its anchor.`);
    }
  }
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
    for (const elementId of operationElementIds(operation)) {
      if (existingIds.has(elementId)) elementIds.add(elementId);
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
  options: { preferredSlideId?: string } = {},
): PatchOperation[] {
  const eligible = eligibleElements(snapshot, scope);
  const lower = instruction.toLowerCase();
  const wholeSlideTopic =
    scope.operationMode === 'copy' || scope.operationMode === 'unrestricted'
      ? extractWholeSlideTopic(instruction)
      : null;
  if (wholeSlideTopic) {
    const wholeSlideOperations = deterministicWholeSlideRewrite(
      snapshot,
      eligible,
      scope,
      wholeSlideTopic,
      options.preferredSlideId,
    );
    if (wholeSlideOperations.length > 0) return wholeSlideOperations;
    throw new Error(
      'The selected model returned an invalid proposal, and the deterministic whole-slide fallback found no editable semantic copy on the focused slide.',
    );
  }
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
      'The selected model returned an invalid proposal, and the deterministic fallback could not safely infer a copy, style, or layout operation.',
    );
  }

  if (inferredMode === 'copy') {
    const target = selectDeterministicTextTarget(eligible, instruction);
    if (!target) throw new Error('Deterministic copy fallback found no unlocked text in scope.');
    const text = deterministicRewrite(target.content ?? '', instruction);
    if (text === null) {
      throw new Error(
        'The selected model returned an invalid proposal, and the deterministic copy fallback could not safely infer new wording. Retry with exact replacement copy in quotation marks.',
      );
    }
    if (text === (target.content ?? '')) {
      if (
        scope.operationMode === 'unrestricted' &&
        /\b(?:decisive|assertive|stronger|emphasis|emphasize|bold)\b/.test(lower)
      ) {
        const currentWeight = target.style.fontWeight ?? 500;
        const nextWeight =
          currentWeight < 700 ? 700 : currentWeight < 900 ? currentWeight + 50 : 900;
        const accentAlreadyApplied = target.style.color === snapshot.deck.theme.colors.accent;
        return [
          {
            op: 'update_style',
            slideId: target.slideId,
            elementId: target.id,
            properties: {
              color: snapshot.deck.theme.colors.accent,
              fontWeight: nextWeight,
              ...(currentWeight >= 900 && accentAlreadyApplied
                ? { letterSpacing: target.style.letterSpacing === -0.01 ? -0.015 : -0.01 }
                : {}),
            },
          },
        ];
      }
      throw new Error(
        `The selected model returned an invalid proposal, and the deterministic copy fallback would not change ${target.name}.`,
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
  const copyOperations = operations.filter(
    (operation): operation is Extract<PatchOperation, { op: 'replace_text' }> =>
      operation.op === 'replace_text',
  );
  const copySlideIds = new Set(copyOperations.map((operation) => operation.slideId));
  if (
    operations.length >= 3 &&
    copyOperations.length === operations.length &&
    copySlideIds.size === 1
  ) {
    const slideId = copyOperations[0]?.slideId ?? '';
    const slideLabel =
      snapshot?.slides.find((slide) => slide.id === slideId)?.title ?? (slideId || 'slide');
    return nodeslideCleanText(
      `Rewrite editable copy on ${slideLabel} · ${operations.length} changes`,
      240,
    );
  }
  const labels = operations.map((operation) => {
    if (operation.op === 'update_deck') return 'update deck title';
    if (operation.op === 'add_slide') return `add slide ${operation.slide.title}`;
    const slideLabel =
      snapshot?.slides.find((slide) => slide.id === operation.slideId)?.title ?? operation.slideId;
    if (operation.op === 'remove_slide') return `remove slide ${slideLabel}`;
    if (operation.op === 'reorder_slide') return `reorder slide ${slideLabel}`;
    if (operation.op === 'update_slide') return `update slide ${slideLabel}`;
    if (operation.op === 'add_element') return `add ${operation.element.name}`;
    if (operation.op === 'group_elements_v1') {
      return `group ${operation.elementIds.length} elements on ${slideLabel}`;
    }
    if (operation.op === 'ungroup_elements_v1') {
      return `ungroup ${operation.elementIds.length} elements on ${slideLabel}`;
    }
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
  if (element.sourceIds.length > NODESLIDE_ELEMENT_SOURCE_LIMIT) {
    errors.push(`Added element ${element.id} exceeds the source-reference limit.`);
  }
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

function validateClockBounds(
  label: string,
  clocks: Record<string, number>,
  limit: number,
  errors: string[],
): void {
  const entries = Object.entries(clocks);
  if (entries.length > limit) errors.push(`${label} supports at most ${limit} entries.`);
  for (const [id, version] of entries) {
    if (!id || id.length > 256 || !Number.isSafeInteger(version) || version < 1) {
      errors.push(`${label} contains an invalid ID or version.`);
      break;
    }
  }
}

function validateGroupOperation(
  operation: Extract<PatchOperation, { op: 'group_elements_v1' | 'ungroup_elements_v1' }>,
  elementOrder: readonly string[],
  elements: ReadonlyMap<string, SlideElement>,
): string[] {
  const errors: string[] = [];
  if (!operation.groupId || operation.groupId.length > NODESLIDE_GROUP_ID_LIMIT) {
    errors.push(`Group IDs must contain 1-${NODESLIDE_GROUP_ID_LIMIT} characters.`);
  }
  if (
    operation.elementIds.length < 2 ||
    operation.elementIds.length > NODESLIDE_GROUP_MEMBER_LIMIT ||
    new Set(operation.elementIds).size !== operation.elementIds.length
  ) {
    errors.push(`Groups require 2-${NODESLIDE_GROUP_MEMBER_LIMIT} unique element IDs.`);
    return errors;
  }
  const members = operation.elementIds.map((elementId) => elements.get(elementId));
  if (
    members.some(
      (member) =>
        !member || member.slideId !== operation.slideId || !elementOrder.includes(member.id),
    )
  ) {
    errors.push(`Group ${operation.groupId} references an unknown or cross-slide element.`);
    return errors;
  }
  if (members.some((member) => member?.locked)) errors.push('Locked elements cannot be regrouped.');
  if (operation.op === 'group_elements_v1') {
    if (members.some((member) => member?.groupId !== undefined)) {
      errors.push('An element must be ungrouped before joining another flat group.');
    }
    if ([...elements.values()].some((element) => element.groupId === operation.groupId)) {
      errors.push(`Group ${operation.groupId} already exists.`);
    }
  } else {
    const actual = [...elements.values()]
      .filter(
        (element) => element.slideId === operation.slideId && element.groupId === operation.groupId,
      )
      .map((element) => element.id);
    if (
      members.some((member) => member?.groupId !== operation.groupId) ||
      !sameMembers(actual, operation.elementIds)
    ) {
      errors.push(`ungroup_elements_v1 must name every member of group ${operation.groupId}.`);
    }
  }
  return errors;
}

function validateFlatGroupMetadata(
  elementOrder: readonly string[],
  elements: readonly SlideElement[],
  errors: string[],
): void {
  const groups = new Map<string, string[]>();
  for (const element of elements) {
    if (element.groupId === undefined) continue;
    if (!element.groupId || element.groupId.length > NODESLIDE_GROUP_ID_LIMIT) {
      errors.push(`Element ${element.id} has an invalid group ID.`);
      continue;
    }
    const members = groups.get(element.groupId) ?? [];
    members.push(element.id);
    groups.set(element.groupId, members);
  }
  for (const [groupId, members] of groups) {
    const indexes = members.map((id) => elementOrder.indexOf(id)).sort((a, b) => a - b);
    if (
      members.length < 2 ||
      members.length > NODESLIDE_GROUP_MEMBER_LIMIT ||
      indexes.some((value, index) => index > 0 && value !== (indexes[index - 1] ?? 0) + 1)
    ) {
      errors.push(`Group ${groupId} must contain bounded contiguous elements.`);
    }
  }
}

function compactGroupOrder(order: readonly string[], memberIds: readonly string[]): string[] {
  const selected = new Set(memberIds);
  const members = order.filter((id) => selected.has(id));
  const insertionIndex = Math.min(...members.map((id) => order.indexOf(id)));
  const remaining = order.filter((id) => !selected.has(id));
  remaining.splice(insertionIndex, 0, ...members);
  return remaining;
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
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

type WholeSlideTextRole = 'section' | 'headline' | 'body' | 'bullet';

function extractWholeSlideTopic(instruction: string): string | null {
  const normalized = nodeslideCleanText(instruction, 500);
  const topic = normalized
    .match(
      /\b(?:make|turn|transform|change|rewrite|reframe|refocus)\b[\s\S]{0,80}?\b(?:the\s+)?(?:entire|whole|full|current|this)\s+slide\b[\s\S]{0,40}?\b(?:about|aout|around|into|on|focus(?:ed)?\s+on)\b\s+(.{2,120}?)(?:[.!?]+|$)/i,
    )?.[1]
    ?.replace(/\s+(?:please|for me)$/i, '')
    .trim();
  if (
    !topic ||
    /^(?:it|this|that|something|anything|better|more compelling|more persuasive)$/i.test(topic)
  ) {
    return null;
  }
  return normalizeWholeSlideTopic(nodeslideCleanText(topic, 80));
}

function normalizeWholeSlideTopic(topic: string): string {
  return topic
    .replace(/\bai\b/gi, 'AI')
    .replace(/\bllm\b/gi, 'LLM')
    .replace(/\bllms\b/gi, 'LLMs');
}

function deterministicWholeSlideRewrite(
  snapshot: DeckSnapshot,
  eligible: readonly SlideElement[],
  scope: PatchScope,
  topic: string,
  preferredSlideId?: string,
): PatchOperation[] {
  const semanticBySlide = new Map<
    string,
    Array<{ element: SlideElement; role: WholeSlideTextRole }>
  >();
  for (const element of eligible) {
    const role = wholeSlideTextRole(element);
    if (!role) continue;
    const current = semanticBySlide.get(element.slideId) ?? [];
    current.push({ element, role });
    semanticBySlide.set(element.slideId, current);
  }

  const scopedSlideId =
    scope.kind !== 'deck' && scope.slideIds.length === 1 ? scope.slideIds[0] : undefined;
  const availableSlideIds = snapshot.deck.slideOrder.filter((slideId) =>
    semanticBySlide.has(slideId),
  );
  const targetSlideId =
    (preferredSlideId && semanticBySlide.has(preferredSlideId) ? preferredSlideId : undefined) ??
    (scopedSlideId && semanticBySlide.has(scopedSlideId) ? scopedSlideId : undefined) ??
    (availableSlideIds.length === 1 ? availableSlideIds[0] : undefined);
  if (!targetSlideId) return [];

  const slide = snapshot.slides.find((candidate) => candidate.id === targetSlideId);
  if (!slide) return [];
  const elementRank = new Map(slide.elementOrder.map((elementId, index) => [elementId, index]));
  const targets = [...(semanticBySlide.get(targetSlideId) ?? [])].sort(
    (left, right) =>
      (elementRank.get(left.element.id) ?? Number.MAX_SAFE_INTEGER) -
        (elementRank.get(right.element.id) ?? Number.MAX_SAFE_INTEGER) ||
      left.element.id.localeCompare(right.element.id),
  );
  const displayTopic = topic.length > 0 ? `${topic[0]?.toUpperCase()}${topic.slice(1)}` : topic;
  const isAgentTopic = /\b(?:AI\s+)?agents?\b/i.test(topic);
  const bulletCopy = isAgentTopic
    ? [
        'Read only the bounded context it needs',
        'Plan and use approved tools',
        'Validate results before human approval',
        'Return a reviewable, traceable result',
        'Keep every action inside its write scope',
      ]
    : [
        'Start with the essential context',
        'Show the system or story in motion',
        'Make the evidence easy to inspect',
        'End with the decision or next step',
        'Keep the result editable and reviewable',
      ];
  let bulletIndex = 0;
  const operations: PatchOperation[] = [];
  for (const { element, role } of targets) {
    if (operations.length >= 8) break;
    const current = element.content ?? '';
    const text =
      role === 'section'
        ? `${topic.toUpperCase()} / OVERVIEW`
        : role === 'headline'
          ? `${displayTopic}: from context to clear action`
          : role === 'body'
            ? isAgentTopic
              ? `${displayTopic} turns a goal into a bounded plan, uses approved tools, validates the result, and keeps a human in control.`
              : `${displayTopic} becomes a focused narrative: what matters, how it works, and what the audience should do next.`
            : preserveListPrefix(
                current,
                bulletCopy[bulletIndex++] ?? 'Keep the outcome reviewable',
              );
    const cleaned = nodeslideCleanText(text, 500);
    if (!cleaned || cleaned === current) continue;
    operations.push({
      op: 'replace_text',
      slideId: element.slideId,
      elementId: element.id,
      text: cleaned,
    });
  }
  return operations;
}

function wholeSlideTextRole(element: SlideElement): WholeSlideTextRole | null {
  if (element.kind !== 'text' || element.visible === false) return null;
  const semanticLabel = `${element.role ?? ''} ${element.name}`.toLowerCase();
  if (
    /\b(?:footer|page number|slide number|caption|citation|source|metric|statistic)\b/.test(
      semanticLabel,
    )
  ) {
    return null;
  }
  if (/\b(?:section|eyebrow|kicker)\b/.test(semanticLabel)) return 'section';
  if (/\b(?:headline|title|heading)\b/.test(semanticLabel)) return 'headline';
  if (/\b(?:body|paragraph|description|summary|subhead|subtitle)\b/.test(semanticLabel)) {
    return 'body';
  }
  if (/\b(?:bullet|key point|takeaway)\b/.test(semanticLabel)) return 'bullet';
  return null;
}

function preserveListPrefix(current: string, text: string): string {
  const prefix = current.match(/^\s*(?:(?:[-•▪–—]|\d{1,2}[.)]?|[A-Z][.)])\s+)/u)?.[0] ?? '';
  return `${prefix}${text}`;
}

function deterministicRewrite(current: string, instruction: string): string | null {
  const quoted = [...instruction.matchAll(/(?:\u201c([^\u201d]{1,500})\u201d|"([^"]{1,500})")/gu)]
    .map((match) => (match[1] ?? match[2])?.trim())
    .filter((value): value is string => Boolean(value));
  if (quoted.length >= 2 && /\breplace\b[\s\S]*\bwith\b/i.test(instruction)) {
    const [from, to] = quoted;
    return from === current && to && to !== from ? to : null;
  }
  if (quoted.length === 1) return quoted[0] ?? null;
  if (quoted.length > 1) return null;
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

function canonicalBox(bbox: BoundingBox): BoundingBox {
  const width = Math.max(0.01, Math.min(1, Math.max(0, bbox.width)));
  const height = Math.max(0.01, Math.min(1, Math.max(0, bbox.height)));
  const x = Math.min(Math.min(1, Math.max(0, bbox.x)), 1 - width);
  const y = Math.min(Math.min(1, Math.max(0, bbox.y)), 1 - height);
  return { x, y, width, height };
}

function boxesEqual(left: BoundingBox, right: BoundingBox): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function roundNormalized(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 1000) / 1000));
}

export function bboxContainsPoint(bbox: BoundingBox, x: number, y: number): boolean {
  return x >= bbox.x && x <= bbox.x + bbox.width && y >= bbox.y && y <= bbox.y + bbox.height;
}
