import {
  type AgentReadReference,
  type DeckComment,
  NODESLIDE_AGENT_READ_CONTEXT_LIMITS,
  type NodeSlideWorkspace,
  type PatchScope,
  type Slide,
  type SlideElement,
  type SourceRecord,
} from '../../shared/nodeslide';

const REFERENCE_ID_LIMIT = 256;
const REFERENCE_LABEL_LIMIT = 240;
const REFERENCE_KIND_LIMITS: Readonly<Record<AgentReadReference['kind'], number>> = {
  deck: 1,
  slide: NODESLIDE_AGENT_READ_CONTEXT_LIMITS.slideIds,
  element: NODESLIDE_AGENT_READ_CONTEXT_LIMITS.elementIds,
  comment: NODESLIDE_AGENT_READ_CONTEXT_LIMITS.commentIds,
  source: NODESLIDE_AGENT_READ_CONTEXT_LIMITS.sourceIds,
  version: 8,
  data: 32,
};

export interface ResolvedNodeSlideReadContext {
  references: AgentReadReference[];
  slides: Slide[];
  elements: SlideElement[];
  sources: SourceRecord[];
  comments: DeckComment[];
}

/** Resolves every client reference against one already-authorized workspace. */
export function resolveNodeSlideReadContext(args: {
  workspace: NodeSlideWorkspace;
  writeScope: PatchScope;
  requested?: readonly AgentReadReference[];
}): ResolvedNodeSlideReadContext {
  const supplied = args.requested ?? [];
  assertReferenceBounds(supplied);
  const reserved = withRequiredScopedComment(args.workspace, args.writeScope, supplied);
  assertReferenceBounds(reserved);
  const requested = mergeReferences(reserved, defaultReferences(args.workspace, args.writeScope));
  assertReferenceBounds(requested);

  const references = canonicalReferences(requested);
  const slideById = new Map(args.workspace.slides.map((slide) => [slide.id, slide]));
  const elementById = new Map(args.workspace.elements.map((element) => [element.id, element]));
  const sourceById = new Map(args.workspace.sources.map((source) => [source.id, source]));
  const commentById = new Map(args.workspace.comments.map((comment) => [comment.id, comment]));
  const slides = new Map<string, Slide>();
  const elements = new Map<string, SlideElement>();
  const sources = new Map<string, SourceRecord>();
  const comments = new Map<string, DeckComment>();

  for (const reference of references) {
    if (reference.kind === 'deck') {
      if (reference.id !== args.workspace.deck.id) unavailable(reference);
      continue;
    }
    if (reference.kind === 'slide') {
      const slide = slideById.get(reference.id);
      if (!slide || slide.deckId !== args.workspace.deck.id) unavailable(reference);
      slides.set(slide.id, slide);
      continue;
    }
    if (reference.kind === 'element') {
      const element = elementById.get(reference.id);
      if (!element || !slideById.has(element.slideId)) unavailable(reference);
      elements.set(element.id, element);
      continue;
    }
    if (reference.kind === 'source') {
      const source = sourceById.get(reference.id);
      if (!source || source.deckId !== args.workspace.deck.id) unavailable(reference);
      sources.set(source.id, source);
      continue;
    }
    if (reference.kind === 'comment') {
      const comment = commentById.get(reference.id);
      if (
        !comment ||
        comment.deckId !== args.workspace.deck.id ||
        comment.anchor.deckId !== args.workspace.deck.id
      ) {
        unavailable(reference);
      }
      comments.set(comment.id, comment);
      continue;
    }
    // Version snapshots and abstract data handles are not provider-readable.
    // Reference the authorized slide, element, source, or comment object instead.
    unavailable(reference);
  }

  return {
    references,
    slides: orderedBy(args.workspace.slides, slides),
    elements: orderedBy(args.workspace.elements, elements),
    sources: orderedBy(args.workspace.sources, sources),
    comments: orderedBy(args.workspace.comments, comments),
  };
}

function mergeReferences(
  reservedReferences: readonly AgentReadReference[],
  scopedDefaults: readonly AgentReadReference[],
): AgentReadReference[] {
  const merged = [...reservedReferences];
  const seen = new Set(reservedReferences.map(referenceKey));
  const counts = new Map<AgentReadReference['kind'], number>();
  for (const reference of reservedReferences) {
    counts.set(reference.kind, (counts.get(reference.kind) ?? 0) + 1);
  }

  for (const reference of scopedDefaults) {
    const key = referenceKey(reference);
    if (seen.has(key)) continue;
    if (merged.length >= NODESLIDE_AGENT_READ_CONTEXT_LIMITS.totalRefs) break;
    const kindCount = counts.get(reference.kind) ?? 0;
    if (kindCount >= REFERENCE_KIND_LIMITS[reference.kind]) continue;
    merged.push(reference);
    seen.add(key);
    counts.set(reference.kind, kindCount + 1);
  }
  return merged;
}

function withRequiredScopedComment(
  workspace: NodeSlideWorkspace,
  scope: PatchScope,
  references: readonly AgentReadReference[],
): AgentReadReference[] {
  if (
    scope.kind !== 'comment' ||
    references.some((reference) => reference.kind === 'comment' && reference.id === scope.commentId)
  ) {
    return [...references];
  }
  const comment = workspace.comments.find((candidate) => candidate.id === scope.commentId);
  if (!comment) throw new Error('Scoped NodeSlide comment is unavailable.');
  return [
    ...references,
    {
      id: comment.id,
      kind: 'comment',
      label: safeLabel(`Comment by ${comment.authorName}`),
    },
  ];
}

function defaultReferences(workspace: NodeSlideWorkspace, scope: PatchScope): AgentReadReference[] {
  const slideIds =
    scope.kind === 'deck' ? new Set(workspace.deck.slideOrder) : new Set(scope.slideIds);
  const elementIds =
    'elementIds' in scope
      ? new Set(scope.elementIds)
      : new Set(
          workspace.elements
            .filter((element) => slideIds.has(element.slideId))
            .map((element) => element.id),
        );
  const slides = workspace.slides.filter((slide) => slideIds.has(slide.id));
  const elements = workspace.elements.filter((element) => elementIds.has(element.id));
  const sourceIds = new Set(
    elements.flatMap((element) => [
      ...element.sourceIds,
      ...(element.chart?.sourceId ? [element.chart.sourceId] : []),
    ]),
  );
  return [
    ...slides.map((slide) => ({
      id: slide.id,
      kind: 'slide' as const,
      label: safeLabel(slide.title),
    })),
    ...elements.map((element) => ({
      id: element.id,
      kind: 'element' as const,
      label: safeLabel(element.name),
    })),
    ...workspace.sources
      .filter((source) => sourceIds.has(source.id))
      .map((source) => ({
        id: source.id,
        kind: 'source' as const,
        label: safeLabel(source.title),
      })),
  ];
}

function safeLabel(label: string): string {
  return label.slice(0, REFERENCE_LABEL_LIMIT);
}

function assertReferenceBounds(references: readonly AgentReadReference[]): void {
  if (references.length > NODESLIDE_AGENT_READ_CONTEXT_LIMITS.totalRefs) {
    throw new Error('NodeSlide readContext exceeds the total reference limit.');
  }
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const reference of references) {
    if (
      !reference.id ||
      reference.id.length > REFERENCE_ID_LIMIT ||
      typeof reference.label !== 'string' ||
      reference.label.length > REFERENCE_LABEL_LIMIT
    ) {
      throw new Error('NodeSlide readContext contains an invalid reference.');
    }
    const key = referenceKey(reference);
    if (seen.has(key)) throw new Error('NodeSlide readContext references must be unique.');
    seen.add(key);
    counts.set(reference.kind, (counts.get(reference.kind) ?? 0) + 1);
  }
  if ((counts.get('deck') ?? 0) > 1) throw new Error('readContext supports one deck reference.');
  if ((counts.get('slide') ?? 0) > NODESLIDE_AGENT_READ_CONTEXT_LIMITS.slideIds)
    throw new Error('readContext exceeds the slide reference limit.');
  if ((counts.get('element') ?? 0) > NODESLIDE_AGENT_READ_CONTEXT_LIMITS.elementIds)
    throw new Error('readContext exceeds the element reference limit.');
  if ((counts.get('source') ?? 0) > NODESLIDE_AGENT_READ_CONTEXT_LIMITS.sourceIds)
    throw new Error('readContext exceeds the source reference limit.');
  if ((counts.get('comment') ?? 0) > NODESLIDE_AGENT_READ_CONTEXT_LIMITS.commentIds)
    throw new Error('readContext exceeds the comment reference limit.');
  if ((counts.get('version') ?? 0) > 8 || (counts.get('data') ?? 0) > 32) {
    throw new Error('readContext exceeds the version or data reference limit.');
  }
}

function referenceKey(reference: AgentReadReference): string {
  return `${reference.kind}\u0000${reference.id}`;
}

function canonicalReferences(references: readonly AgentReadReference[]): AgentReadReference[] {
  const rank = ['deck', 'slide', 'element', 'comment', 'source', 'version', 'data'];
  return references
    .map((reference) => ({ ...reference }))
    .sort(
      (left, right) =>
        rank.indexOf(left.kind) - rank.indexOf(right.kind) || left.id.localeCompare(right.id),
    );
}

function orderedBy<T extends { id: string }>(
  order: readonly T[],
  selected: ReadonlyMap<string, T>,
): T[] {
  return order.filter((value) => selected.has(value.id));
}

function unavailable(reference: AgentReadReference): never {
  throw new Error(`NodeSlide readContext ${reference.kind} reference is unavailable.`);
}
