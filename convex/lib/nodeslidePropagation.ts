import {
  type DeckPatch,
  type DeckSnapshot,
  NODESLIDE_PROPAGATION_OPERATION_LIMIT,
  type PatchOperation,
  type PatchScope,
  type SlideElement,
} from '../../shared/nodeslide';
import { nodeslideContentDigest } from './nodeslideIds';
import { clocksForNodeSlideOperations } from './nodeslidePatches';

export interface NodeSlidePropagationPlan {
  parentPatchId: string;
  scope: PatchScope;
  operations: PatchOperation[];
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  affectedSlideIds: string[];
  affectedSlideDigest: string;
}

/** Produces a new review unit; it never mutates or widens the accepted parent patch. */
export function planNodeSlidePropagation(
  snapshot: DeckSnapshot,
  parent: Pick<DeckPatch, 'id' | 'deckId' | 'status' | 'operations' | 'proposalKind'>,
): NodeSlidePropagationPlan {
  if (parent.deckId !== snapshot.deck.id || parent.status !== 'accepted') {
    throw new Error('Propagation requires an accepted patch from this deck.');
  }
  if (parent.proposalKind === 'propagation') {
    throw new Error('Propagation proposals cannot recursively widen themselves.');
  }
  const sourceSlideIds = new Set(
    parent.operations.flatMap((operation) =>
      operation.op === 'update_deck' || operation.op === 'add_slide' ? [] : [operation.slideId],
    ),
  );
  const sourceElements = new Map(snapshot.elements.map((element) => [element.id, element]));
  const slideRank = new Map(snapshot.deck.slideOrder.map((slideId, index) => [slideId, index]));
  const elementRank = new Map<string, number>();
  for (const slide of snapshot.slides) {
    slide.elementOrder.forEach((elementId, index) => elementRank.set(elementId, index));
  }
  const candidates = [...snapshot.elements].sort(
    (left, right) =>
      (slideRank.get(left.slideId) ?? Number.MAX_SAFE_INTEGER) -
        (slideRank.get(right.slideId) ?? Number.MAX_SAFE_INTEGER) ||
      (elementRank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (elementRank.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
      left.id.localeCompare(right.id),
  );
  const operations: PatchOperation[] = [];
  const emitted = new Set<string>();

  for (const sourceOperation of parent.operations) {
    const source = sourceElementForOperation(sourceOperation, sourceElements);
    const role = semanticRole(source);
    if (!source || !role) continue;
    for (const target of candidates) {
      if (
        sourceSlideIds.has(target.slideId) ||
        target.locked ||
        target.kind !== source.kind ||
        semanticRole(target) !== role
      ) {
        continue;
      }
      const propagated = propagatedOperation(sourceOperation, source, target);
      if (!propagated) continue;
      const key = `${propagated.op}\u0000${target.id}`;
      if (emitted.has(key)) continue;
      emitted.add(key);
      operations.push(propagated);
      if (operations.length > NODESLIDE_PROPAGATION_OPERATION_LIMIT) {
        throw new Error(
          `Propagation exceeds the ${NODESLIDE_PROPAGATION_OPERATION_LIMIT}-operation review bound.`,
        );
      }
    }
  }

  if (operations.length === 0) {
    throw new Error('The accepted patch has no safe semantic-role matches to propagate.');
  }
  const affectedSlideIds = [
    ...new Set(
      operations.flatMap((operation) => ('slideId' in operation ? [operation.slideId] : [])),
    ),
  ].sort(
    (left, right) =>
      (slideRank.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (slideRank.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right),
  );
  const elementIds = [...new Set(operations.flatMap(targetElementIds))];
  const operationMode = operations.every(
    (operation) => operation.op === 'update_style' || operation.op === 'set_visibility_v1',
  )
    ? 'style'
    : operations.every((operation) => operation.op === 'move' || operation.op === 'resize')
      ? 'layout'
      : 'unrestricted';
  const scope: PatchScope = {
    kind: 'elements',
    deckId: snapshot.deck.id,
    slideIds: affectedSlideIds,
    elementIds,
    operationMode,
  };
  const clocks = clocksForNodeSlideOperations(snapshot, operations);
  const affectedSlideDigest = nodeslideContentDigest(
    JSON.stringify({
      version: 'nodeslide.propagation-affected-slides/v1',
      deckId: snapshot.deck.id,
      parentPatchId: parent.id,
      affectedSlideIds,
    }),
  );
  return {
    parentPatchId: parent.id,
    scope,
    operations,
    baseDeckVersion: snapshot.deck.version,
    ...clocks,
    affectedSlideIds,
    affectedSlideDigest,
  };
}

function sourceElementForOperation(
  operation: PatchOperation,
  elements: ReadonlyMap<string, SlideElement>,
): SlideElement | undefined {
  if (
    operation.op !== 'update_style' &&
    operation.op !== 'move' &&
    operation.op !== 'resize' &&
    operation.op !== 'set_visibility_v1'
  ) {
    return undefined;
  }
  const element = elements.get(operation.elementId);
  return element?.slideId === operation.slideId ? element : undefined;
}

function semanticRole(element: SlideElement | undefined): string | null {
  const role = element?.role?.trim().toLocaleLowerCase('en-US');
  return role || null;
}

function propagatedOperation(
  operation: PatchOperation,
  source: SlideElement,
  target: SlideElement,
): PatchOperation | null {
  if (operation.op === 'update_style') {
    const properties = Object.fromEntries(
      Object.entries(operation.properties).filter(([key, value]) => {
        return target.style[key as keyof typeof target.style] !== value;
      }),
    ) as typeof operation.properties;
    return Object.keys(properties).length > 0
      ? { op: 'update_style', slideId: target.slideId, elementId: target.id, properties }
      : null;
  }
  if (operation.op === 'move') {
    return target.bbox.x !== source.bbox.x || target.bbox.y !== source.bbox.y
      ? {
          op: 'move',
          slideId: target.slideId,
          elementId: target.id,
          x: source.bbox.x,
          y: source.bbox.y,
        }
      : null;
  }
  if (operation.op === 'resize') {
    return target.bbox.width !== source.bbox.width || target.bbox.height !== source.bbox.height
      ? {
          op: 'resize',
          slideId: target.slideId,
          elementId: target.id,
          width: source.bbox.width,
          height: source.bbox.height,
        }
      : null;
  }
  if (operation.op === 'set_visibility_v1') {
    const visible = source.visible ?? true;
    return (target.visible ?? true) !== visible
      ? {
          op: 'set_visibility_v1',
          slideId: target.slideId,
          elementId: target.id,
          visible,
        }
      : null;
  }
  return null;
}

function targetElementIds(operation: PatchOperation): string[] {
  if (
    operation.op === 'update_style' ||
    operation.op === 'move' ||
    operation.op === 'resize' ||
    operation.op === 'set_visibility_v1'
  ) {
    return [operation.elementId];
  }
  return [];
}
