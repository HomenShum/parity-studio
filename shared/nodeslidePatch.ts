import {
  type DeckPatch,
  type DeckSnapshot,
  NODESLIDE_ADD_SLIDE_ELEMENT_LIMIT,
  NODESLIDE_GROUP_ID_LIMIT,
  NODESLIDE_GROUP_MEMBER_LIMIT,
  NODESLIDE_SCOPE_ELEMENT_LIMIT,
  NODESLIDE_SCOPE_SLIDE_LIMIT,
  type PatchOperation,
  type PatchScope,
  type Slide,
  type SlideElement,
  clampNormalized,
  operationElementIds,
} from './nodeslide';

const MAX_DECK_TITLE_LENGTH = 160;

export interface PatchApplicationResult {
  snapshot: DeckSnapshot;
  affectedSlideIds: string[];
  affectedElementIds: string[];
}

export function validatePatchScope(
  scope: PatchScope,
  operations: readonly PatchOperation[],
): string[] {
  const errors: string[] = [];
  const allowedSlides = 'slideIds' in scope ? new Set(scope.slideIds) : null;
  const allowedElements = 'elementIds' in scope ? new Set(scope.elementIds) : null;
  const hasElementScopedAuthority =
    scope.kind === 'elements' || scope.kind === 'bounding_box' || scope.kind === 'comment';

  if ('slideIds' in scope && scope.slideIds.length > NODESLIDE_SCOPE_SLIDE_LIMIT) {
    errors.push(`Patch scope supports at most ${NODESLIDE_SCOPE_SLIDE_LIMIT} slide IDs.`);
  }
  if ('elementIds' in scope && scope.elementIds.length > NODESLIDE_SCOPE_ELEMENT_LIMIT) {
    errors.push(`Patch scope supports at most ${NODESLIDE_SCOPE_ELEMENT_LIMIT} element IDs.`);
  }

  for (const operation of operations) {
    const targetSlideId =
      operation.op === 'add_slide'
        ? operation.slide.id
        : operation.op === 'update_deck'
          ? null
          : operation.slideId;
    if (allowedSlides && targetSlideId !== null && !allowedSlides.has(targetSlideId)) {
      errors.push(`Operation ${operation.op} targets slide ${targetSlideId} outside scope.`);
    }

    if (allowedElements) {
      for (const targetId of operationElementIds(operation)) {
        if (!allowedElements.has(targetId)) {
          errors.push(`Operation ${operation.op} targets element ${targetId} outside scope.`);
        }
      }
    }
    if (
      hasElementScopedAuthority &&
      (operation.op === 'add_slide' ||
        operation.op === 'remove_slide' ||
        operation.op === 'update_slide' ||
        operation.op === 'reorder_slide')
    ) {
      errors.push(
        `Operation ${operation.op} targets a whole slide outside element-scoped authority.`,
      );
    }
    if (
      operation.op === 'update_deck' &&
      (scope.kind !== 'deck' || scope.operationMode !== 'unrestricted')
    ) {
      errors.push('update_deck requires deck scope with unrestricted mode.');
    }

    if (scope.operationMode === 'copy' && operation.op !== 'replace_text') {
      errors.push(`Copy-only scope does not permit ${operation.op}.`);
    }
    if (
      scope.operationMode === 'style' &&
      operation.op !== 'update_style' &&
      operation.op !== 'set_visibility_v1'
    ) {
      errors.push(`Style-only scope does not permit ${operation.op}.`);
    }
    if (
      scope.operationMode === 'layout' &&
      operation.op !== 'move' &&
      operation.op !== 'resize' &&
      operation.op !== 'reorder_slide' &&
      operation.op !== 'group_elements_v1' &&
      operation.op !== 'ungroup_elements_v1' &&
      operation.op !== 'reorder_element_v1'
    ) {
      errors.push(`Layout-only scope does not permit ${operation.op}.`);
    }
  }

  return [...new Set(errors)];
}

export function applyDeckPatch(
  snapshot: DeckSnapshot,
  patch: Pick<DeckPatch, 'baseDeckVersion' | 'operations' | 'scope'>,
  committedAt = Date.now(),
): PatchApplicationResult {
  if (patch.scope.deckId !== snapshot.deck.id) {
    throw new Error(
      `Patch scope deck ${patch.scope.deckId} does not match current deck ${snapshot.deck.id}.`,
    );
  }
  if (patch.baseDeckVersion !== snapshot.deck.version) {
    throw new Error(
      `Stale patch: based on deck version ${patch.baseDeckVersion}, current version is ${snapshot.deck.version}.`,
    );
  }

  const scopeErrors = validatePatchScope(patch.scope, patch.operations);
  if (scopeErrors.length > 0) {
    throw new Error(scopeErrors.join(' '));
  }

  const deck = structuredClone(snapshot.deck);
  const slides = structuredClone(snapshot.slides);
  const elements = structuredClone(snapshot.elements);
  const affectedSlideIds = new Set<string>();
  const affectedElementIds = new Set<string>();
  let slideOrderChanged = false;

  if (patch.operations.length === 0) {
    throw new Error('A patch must contain at least one operation.');
  }

  for (const operation of patch.operations) {
    if (operation.op === 'update_deck') {
      const title = validatedDeckTitle(operation.properties.title);
      deck.title = title;
      continue;
    }

    if (operation.op === 'add_slide') {
      if (operation.elements.length > NODESLIDE_ADD_SLIDE_ELEMENT_LIMIT) {
        throw new Error(
          `Added slides support at most ${NODESLIDE_ADD_SLIDE_ELEMENT_LIMIT} bundled elements.`,
        );
      }
      assertAddSlideIndex(operation.index, deck.slideOrder.length);
      if (
        slides.some((slide) => slide.id === operation.slide.id) ||
        deck.slideOrder.includes(operation.slide.id)
      ) {
        throw new Error(`Slide ${operation.slide.id} already exists.`);
      }
      if (operation.slide.deckId !== deck.id) {
        throw new Error(`Added slide ${operation.slide.id} belongs to another deck.`);
      }

      const addedSlide = structuredClone(operation.slide);
      const addedElements = structuredClone(operation.elements);
      const elementIds = new Set<string>();
      for (const element of addedElements) {
        if (elementIds.has(element.id)) {
          throw new Error(`Added slide ${addedSlide.id} contains duplicate element ${element.id}.`);
        }
        elementIds.add(element.id);
        if (elements.some((candidate) => candidate.id === element.id)) {
          throw new Error(`Element ${element.id} already exists.`);
        }
        if (element.slideId !== addedSlide.id) {
          throw new Error(`Added element ${element.id} declares a different slideId.`);
        }
        assertFiniteBox(element.bbox, element.id);
        element.bbox = normalizeBox(element.bbox);
        element.visible = element.visible ?? true;
        element.version = Math.max(1, element.version);
      }
      assertCanonicalElementOrder(addedSlide, elementIds);
      assertValidFlatGroups(addedSlide, addedElements);
      addedSlide.version = Math.max(1, addedSlide.version);

      deck.slideOrder.splice(operation.index, 0, addedSlide.id);
      slideOrderChanged = true;
      slides.push(addedSlide);
      elements.push(...addedElements);
      affectedSlideIds.add(addedSlide.id);
      for (const element of addedElements) affectedElementIds.add(element.id);
      continue;
    }

    affectedSlideIds.add(operation.slideId);
    if (operation.op === 'reorder_slide') {
      const previousIndex = deck.slideOrder.indexOf(operation.slideId);
      if (previousIndex < 0) throw new Error(`Unknown slide ${operation.slideId}.`);
      deck.slideOrder.splice(previousIndex, 1);
      const nextIndex = Math.max(0, Math.min(operation.index, deck.slideOrder.length));
      deck.slideOrder.splice(nextIndex, 0, operation.slideId);
      slideOrderChanged = previousIndex !== nextIndex || slideOrderChanged;
      continue;
    }

    const slide = slides.find((candidate) => candidate.id === operation.slideId);
    if (!slide) throw new Error(`Unknown slide ${operation.slideId}.`);

    if (operation.op === 'remove_slide') {
      const orderIndex = deck.slideOrder.indexOf(operation.slideId);
      if (orderIndex < 0) throw new Error(`Unknown slide ${operation.slideId}.`);
      if (slides.length <= 1 || deck.slideOrder.length <= 1) {
        throw new Error('Cannot remove the final slide from a deck.');
      }
      for (const element of elements) {
        if (element.slideId === operation.slideId) affectedElementIds.add(element.id);
      }
      for (let index = elements.length - 1; index >= 0; index -= 1) {
        const element = elements[index];
        if (element?.slideId !== operation.slideId) continue;
        elements.splice(index, 1);
      }
      const slideIndex = slides.findIndex((candidate) => candidate.id === operation.slideId);
      slides.splice(slideIndex, 1);
      deck.slideOrder.splice(orderIndex, 1);
      slideOrderChanged = true;
      continue;
    }

    if (operation.op === 'update_slide') {
      Object.assign(slide, operation.properties);
      slide.version += 1;
      continue;
    }

    if (operation.op === 'add_element') {
      if (elements.some((element) => element.id === operation.element.id)) {
        throw new Error(`Element ${operation.element.id} already exists.`);
      }
      const added = structuredClone(operation.element);
      if (added.groupId !== undefined) {
        throw new Error('add_element cannot create partial group membership; group it explicitly.');
      }
      added.slideId = operation.slideId;
      assertFiniteBox(added.bbox, added.id);
      added.bbox = normalizeBox(added.bbox);
      added.visible = added.visible ?? true;
      added.version = Math.max(1, added.version);
      elements.push(added);
      slide.elementOrder.push(added.id);
      slide.version += 1;
      affectedElementIds.add(added.id);
      continue;
    }

    if (operation.op === 'group_elements_v1') {
      const members = requireGroupMembers(elements, slide, operation.elementIds, operation.groupId);
      if (elements.some((element) => element.groupId === operation.groupId)) {
        throw new Error(`Group ${operation.groupId} already exists.`);
      }
      for (const member of members) {
        if (member.locked) throw new Error(`Element ${member.id} is locked.`);
        if (member.groupId !== undefined) {
          throw new Error(`Element ${member.id} already belongs to group ${member.groupId}.`);
        }
      }
      slide.elementOrder = compactGroupOrder(slide.elementOrder, operation.elementIds);
      for (const member of members) {
        member.groupId = operation.groupId;
        member.version += 1;
        affectedElementIds.add(member.id);
      }
      slide.version += 1;
      continue;
    }

    if (operation.op === 'ungroup_elements_v1') {
      const members = requireGroupMembers(elements, slide, operation.elementIds, operation.groupId);
      const actualMembers = elements
        .filter(
          (element) =>
            element.slideId === operation.slideId && element.groupId === operation.groupId,
        )
        .map((element) => element.id);
      if (!sameMembers(actualMembers, operation.elementIds)) {
        throw new Error(
          `ungroup_elements_v1 must name every member of group ${operation.groupId}.`,
        );
      }
      for (const member of members) {
        if (member.locked) throw new Error(`Element ${member.id} is locked.`);
        if (member.groupId !== operation.groupId) {
          throw new Error(`Element ${member.id} is not in group ${operation.groupId}.`);
        }
      }
      for (const member of members) {
        // biome-ignore lint/performance/noDelete: optional storage must omit legacy-compatible group metadata.
        delete member.groupId;
        member.version += 1;
        affectedElementIds.add(member.id);
      }
      slide.version += 1;
      continue;
    }

    const elementIndex = elements.findIndex(
      (candidate) =>
        candidate.id === operation.elementId && candidate.slideId === operation.slideId,
    );
    if (elementIndex < 0) throw new Error(`Unknown element ${operation.elementId}.`);
    const element = elements[elementIndex];
    if (!element) throw new Error(`Unknown element ${operation.elementId}.`);
    if (element.locked) throw new Error(`Element ${operation.elementId} is locked.`);

    affectedElementIds.add(operation.elementId);
    if (operation.op === 'remove_element') {
      if (element.groupId !== undefined) {
        throw new Error(`Element ${operation.elementId} must be ungrouped before removal.`);
      }
      elements.splice(elementIndex, 1);
      slide.elementOrder = slide.elementOrder.filter((id) => id !== operation.elementId);
      slide.version += 1;
      continue;
    }

    if (operation.op === 'move') {
      assertFinite(operation.x, `${operation.elementId}.x`);
      assertFinite(operation.y, `${operation.elementId}.y`);
      element.bbox.x = clampNormalized(operation.x);
      element.bbox.y = clampNormalized(operation.y);
      element.bbox = normalizeBox(element.bbox);
    } else if (operation.op === 'resize') {
      assertFinite(operation.width, `${operation.elementId}.width`);
      assertFinite(operation.height, `${operation.elementId}.height`);
      element.bbox.width = clampNormalized(operation.width);
      element.bbox.height = clampNormalized(operation.height);
      element.bbox = normalizeBox(element.bbox);
    } else if (operation.op === 'replace_text') {
      element.content = operation.text;
      if (operation.sourceIds !== undefined) element.sourceIds = [...operation.sourceIds];
      if (element.kind === 'math' && element.math) {
        element.math = {
          ...element.math,
          display: operation.text,
          expression: operation.text,
        };
      }
    } else if (operation.op === 'update_style') {
      element.style = { ...element.style, ...operation.properties };
    } else if (operation.op === 'update_chart') {
      if (element.kind !== 'chart') {
        throw new Error(
          `update_chart requires a chart element; ${operation.elementId} is ${element.kind}.`,
        );
      }
      element.chart = structuredClone(operation.chart);
    } else if (operation.op === 'update_image') {
      if (element.kind !== 'image') {
        throw new Error(
          `update_image requires an image element; ${operation.elementId} is ${element.kind}.`,
        );
      }
      element.imageUrl = operation.imageUrl;
      element.altText = operation.altText;
      element.image = {
        placeholder: false,
        ...(operation.credit ? { credit: operation.credit } : {}),
        ...(element.image?.sourceId ? { sourceId: element.image.sourceId } : {}),
      };
      if (operation.sourceIds !== undefined) element.sourceIds = [...operation.sourceIds];
    } else if (operation.op === 'set_visibility_v1') {
      if ((element.visible ?? true) === operation.visible) {
        throw new Error(`set_visibility_v1 must change element ${operation.elementId}.`);
      }
      element.visible = operation.visible;
    } else if (operation.op === 'reorder_element_v1') {
      if (element.groupId !== undefined) {
        throw new Error(`Element ${operation.elementId} must be ungrouped before z-order changes.`);
      }
      if (
        !Number.isInteger(operation.index) ||
        operation.index < 0 ||
        operation.index >= slide.elementOrder.length
      ) {
        throw new Error(`Element z-order index ${operation.index} is outside slide bounds.`);
      }
      const previousIndex = slide.elementOrder.indexOf(operation.elementId);
      if (previousIndex < 0)
        throw new Error(`Element ${operation.elementId} is absent from order.`);
      if (previousIndex === operation.index) {
        throw new Error(`reorder_element_v1 must change element ${operation.elementId}.`);
      }
      slide.elementOrder.splice(previousIndex, 1);
      slide.elementOrder.splice(operation.index, 0, operation.elementId);
    }
    element.version += 1;
    slide.version += 1;
  }

  if (slideOrderChanged) {
    synchronizePageNumbers(deck.slideOrder, slides, elements, affectedSlideIds, affectedElementIds);
  }

  deck.version += 1;
  deck.updatedAt = committedAt;

  return {
    snapshot: {
      deck,
      slides,
      elements,
      sources: structuredClone(snapshot.sources),
    },
    affectedSlideIds: [...affectedSlideIds],
    affectedElementIds: [...affectedElementIds],
  };
}

function synchronizePageNumbers(
  slideOrder: readonly string[],
  slides: Slide[],
  elements: SlideElement[],
  affectedSlideIds: Set<string>,
  affectedElementIds: Set<string>,
): void {
  slideOrder.forEach((slideId, index) => {
    const expected = String(index + 1).padStart(2, '0');
    const changed = elements.filter(
      (element) =>
        element.slideId === slideId &&
        element.kind === 'text' &&
        element.role === 'page_number' &&
        element.content !== expected,
    );
    if (changed.length === 0) return;
    for (const element of changed) {
      element.content = expected;
      element.version += 1;
      affectedElementIds.add(element.id);
    }
    const slide = slides.find((candidate) => candidate.id === slideId);
    if (slide) slide.version += 1;
    affectedSlideIds.add(slideId);
  });
}

export function changedElementIds(operations: readonly PatchOperation[]): string[] {
  return [...new Set(operations.flatMap(operationElementIds))];
}

function assertAddSlideIndex(index: number, slideCount: number): void {
  if (!Number.isInteger(index) || index < 0 || index > slideCount) {
    throw new Error(`Slide insertion index ${index} is outside deck bounds.`);
  }
}

function assertCanonicalElementOrder(slide: Slide, elementIds: ReadonlySet<string>): void {
  const orderedIds = new Set(slide.elementOrder);
  if (orderedIds.size !== slide.elementOrder.length) {
    throw new Error(`Added slide ${slide.id} has duplicate IDs in elementOrder.`);
  }
  if (
    orderedIds.size !== elementIds.size ||
    [...orderedIds].some((elementId) => !elementIds.has(elementId))
  ) {
    throw new Error(`Added slide ${slide.id} must order every bundled element exactly once.`);
  }
}

function requireGroupMembers(
  elements: SlideElement[],
  slide: Slide,
  elementIds: readonly string[],
  groupId: string,
): SlideElement[] {
  if (!groupId || groupId.length > NODESLIDE_GROUP_ID_LIMIT) {
    throw new Error(`Group IDs must contain 1-${NODESLIDE_GROUP_ID_LIMIT} characters.`);
  }
  if (
    elementIds.length < 2 ||
    elementIds.length > NODESLIDE_GROUP_MEMBER_LIMIT ||
    new Set(elementIds).size !== elementIds.length
  ) {
    throw new Error(
      `Groups require 2-${NODESLIDE_GROUP_MEMBER_LIMIT} unique same-slide element IDs.`,
    );
  }
  const members = elementIds.map((elementId) =>
    elements.find((element) => element.id === elementId && element.slideId === slide.id),
  );
  if (members.some((member) => member === undefined)) {
    throw new Error(`Group ${groupId} references an unknown element.`);
  }
  if (elementIds.some((elementId) => !slide.elementOrder.includes(elementId))) {
    throw new Error(`Group ${groupId} references an element absent from slide order.`);
  }
  return members as SlideElement[];
}

function compactGroupOrder(order: readonly string[], memberIds: readonly string[]): string[] {
  const selected = new Set(memberIds);
  const orderedMembers = order.filter((id) => selected.has(id));
  const firstIndex = Math.min(...orderedMembers.map((id) => order.indexOf(id)));
  const remaining = order.filter((id) => !selected.has(id));
  remaining.splice(firstIndex, 0, ...orderedMembers);
  return remaining;
}

function assertValidFlatGroups(slide: Slide, elements: readonly SlideElement[]): void {
  const groups = new Map<string, string[]>();
  for (const element of elements) {
    if (element.groupId === undefined) continue;
    if (!element.groupId || element.groupId.length > NODESLIDE_GROUP_ID_LIMIT) {
      throw new Error(`Element ${element.id} has an invalid group ID.`);
    }
    const members = groups.get(element.groupId) ?? [];
    members.push(element.id);
    groups.set(element.groupId, members);
  }
  for (const [groupId, members] of groups) {
    if (members.length < 2 || members.length > NODESLIDE_GROUP_MEMBER_LIMIT) {
      throw new Error(`Group ${groupId} must contain 2-${NODESLIDE_GROUP_MEMBER_LIMIT} elements.`);
    }
    const indexes = members.map((id) => slide.elementOrder.indexOf(id)).sort((a, b) => a - b);
    if (indexes.some((value, index) => index > 0 && value !== (indexes[index - 1] ?? 0) + 1)) {
      throw new Error(`Group ${groupId} must be contiguous in elementOrder.`);
    }
  }
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function validatedDeckTitle(value: string | undefined): string {
  if (value === undefined) throw new Error('update_deck requires a title.');
  const title = value.trim();
  if (!title) throw new Error('Deck title cannot be empty.');
  if (title.length > MAX_DECK_TITLE_LENGTH) {
    throw new Error(`Deck title cannot exceed ${MAX_DECK_TITLE_LENGTH} characters.`);
  }
  return title;
}

function normalizeBox(bbox: SlideElement['bbox']): SlideElement['bbox'] {
  const width = Math.max(0.01, clampNormalized(bbox.width));
  const height = Math.max(0.01, clampNormalized(bbox.height));
  const x = Math.min(clampNormalized(bbox.x), 1 - width);
  const y = Math.min(clampNormalized(bbox.y), 1 - height);
  return { x, y, width, height };
}

function assertFiniteBox(bbox: SlideElement['bbox'], elementId: string): void {
  assertFinite(bbox.x, `${elementId}.x`);
  assertFinite(bbox.y, `${elementId}.y`);
  assertFinite(bbox.width, `${elementId}.width`);
  assertFinite(bbox.height, `${elementId}.height`);
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
}
