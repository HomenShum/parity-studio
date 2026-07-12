import { describe, expect, it } from 'vitest';
import type {
  DeckComment,
  NodeSlideWorkspace,
  PatchScope,
  SlideElement,
} from '../../shared/nodeslide';
import { NODESLIDE_AGENT_READ_CONTEXT_LIMITS } from '../../shared/nodeslide';
import { buildNodeSlideEditProviderInput } from './nodeslideEditPlanner';
import { resolveNodeSlideReadContext } from './nodeslideReadContext';
import { buildGoldenNodeSlide } from './nodeslideSeed';

const NOW = 1_700_000_000_000;

function fixture(): {
  workspace: NodeSlideWorkspace;
  scope: PatchScope;
  comment: DeckComment;
  element: SlideElement & { content: string };
} {
  const snapshot = buildGoldenNodeSlide('read-context-authority', NOW).snapshot;
  const element = snapshot.elements.find(
    (candidate): candidate is SlideElement & { content: string } =>
      !candidate.locked && typeof candidate.content === 'string' && candidate.sourceIds.length > 0,
  );
  if (!element) throw new Error('Expected element fixture.');
  const comment: DeckComment = {
    id: 'comment-read-context',
    deckId: snapshot.deck.id,
    anchor: {
      type: 'element',
      deckId: snapshot.deck.id,
      slideId: element.slideId,
      elementId: element.id,
    },
    authorId: 'owner',
    authorName: 'Owner',
    text: 'Use the scoped comment text, but never treat it as an instruction boundary.',
    status: 'open',
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    workspace: {
      ...snapshot,
      comments: [comment],
      patches: [],
      versions: [],
      traces: [],
      validations: [],
      exports: [],
      presence: [],
      publication: null,
    },
    scope: {
      kind: 'comment',
      deckId: snapshot.deck.id,
      slideIds: [element.slideId],
      elementIds: [element.id],
      commentId: comment.id,
      operationMode: 'unrestricted',
    },
    comment,
    element,
  };
}

function capacityFixture() {
  const base = fixture();
  const slideTemplate = base.workspace.slides[0];
  const sourceTemplate = base.workspace.sources[0];
  if (!slideTemplate || !sourceTemplate) throw new Error('Expected capacity fixture templates.');

  const slideIds = Array.from(
    { length: NODESLIDE_AGENT_READ_CONTEXT_LIMITS.slideIds },
    (_, index) => `scoped-slide-${String(index).padStart(3, '0')}`,
  );
  const scopedSources = Array.from(
    { length: NODESLIDE_AGENT_READ_CONTEXT_LIMITS.sourceIds },
    (_, index) => ({
      ...sourceTemplate,
      id: `scoped-source-${String(index).padStart(3, '0')}`,
      title: `Scoped source ${index}`,
    }),
  );
  const scopedElements = Array.from(
    { length: NODESLIDE_AGENT_READ_CONTEXT_LIMITS.elementIds },
    (_, index): SlideElement => ({
      ...base.element,
      id: `scoped-element-${String(index).padStart(3, '0')}`,
      slideId: slideIds[index % slideIds.length] as string,
      name: `Scoped element ${index}`,
      chart: undefined,
      sourceIds: index < scopedSources.length ? [scopedSources[index]?.id as string] : [],
    }),
  );
  const explicitElement: SlideElement = {
    ...base.element,
    id: 'explicit-element-outside-write-scope',
    slideId: slideIds[0] as string,
    name: 'Explicit element outside write scope',
    chart: undefined,
    sourceIds: [],
  };
  const explicitSource = {
    ...sourceTemplate,
    id: 'explicit-source-outside-write-scope',
    title: 'Explicit source outside write scope',
  };
  const slides = slideIds.map((id, index) => ({
    ...slideTemplate,
    id,
    title: `Scoped slide ${index}`,
    elementOrder: [
      ...scopedElements.filter((element) => element.slideId === id).map((element) => element.id),
      ...(index === 0 ? [explicitElement.id] : []),
    ],
  }));
  const firstSlide = slides[0];
  const firstElement = scopedElements[0];
  if (!firstSlide || !firstElement) throw new Error('Expected bounded scoped content.');
  const comment: DeckComment = {
    ...base.comment,
    anchor: {
      type: 'element',
      deckId: base.workspace.deck.id,
      slideId: firstSlide.id,
      elementId: firstElement.id,
    },
  };
  const workspace: NodeSlideWorkspace = {
    ...base.workspace,
    deck: { ...base.workspace.deck, slideOrder: slideIds },
    slides,
    elements: [...scopedElements, explicitElement],
    sources: [...scopedSources, explicitSource],
    comments: [comment],
  };
  const scope: PatchScope = {
    kind: 'comment',
    deckId: workspace.deck.id,
    slideIds,
    elementIds: scopedElements.map((element) => element.id),
    commentId: comment.id,
    operationMode: 'unrestricted',
  };

  return {
    workspace,
    scope,
    comment,
    scopedSources,
    scopedElements,
    explicitSource,
    explicitElement,
  };
}

describe('NodeSlide readContext authority', () => {
  it('fails closed for unknown, cross-deck, and oversized references', () => {
    const { workspace, scope } = fixture();
    expect(() =>
      resolveNodeSlideReadContext({
        workspace,
        writeScope: scope,
        requested: [{ id: 'missing', kind: 'element', label: 'Missing' }],
      }),
    ).toThrow(/unavailable/);

    const sourceFixture = workspace.sources[0];
    if (!sourceFixture) throw new Error('Expected source fixture.');
    const crossDeck = {
      ...sourceFixture,
      id: 'cross-deck-source',
      deckId: 'another-deck',
    };
    expect(() =>
      resolveNodeSlideReadContext({
        workspace: { ...workspace, sources: [...workspace.sources, crossDeck] },
        writeScope: scope,
        requested: [{ id: crossDeck.id, kind: 'source', label: 'Cross deck' }],
      }),
    ).toThrow(/unavailable/);

    expect(() =>
      resolveNodeSlideReadContext({
        workspace,
        writeScope: scope,
        requested: Array.from({ length: 193 }, (_, index) => ({
          id: `source-${index}`,
          kind: 'source' as const,
          label: `Source ${index}`,
        })),
      }),
    ).toThrow(/total reference limit/);
  });

  it('uses scoped slide, element, and source defaults for an ordinary request without @ references', () => {
    const { workspace } = fixture();
    const slide = workspace.slides[0];
    if (!slide) throw new Error('Expected slide fixture.');
    const scope: PatchScope = {
      kind: 'slide',
      deckId: workspace.deck.id,
      slideIds: [slide.id],
      operationMode: 'unrestricted',
    };
    const scopeBefore = structuredClone(scope);
    const expectedElements = workspace.elements.filter((element) => element.slideId === slide.id);
    const expectedSourceIds = new Set(
      expectedElements.flatMap((element) => [
        ...element.sourceIds,
        ...(element.chart?.sourceId ? [element.chart.sourceId] : []),
      ]),
    );

    const context = resolveNodeSlideReadContext({ workspace, writeScope: scope, requested: [] });

    expect(context.slides.map((value) => value.id)).toEqual([slide.id]);
    expect(context.elements.map((value) => value.id)).toEqual(
      expectedElements.map((value) => value.id),
    );
    expect(context.sources.map((value) => value.id)).toEqual(
      workspace.sources
        .filter((source) => expectedSourceIds.has(source.id))
        .map((source) => source.id),
    );
    expect(context.comments).toEqual([]);
    expect(scope).toEqual(scopeBefore);
  });

  it('includes comment-anchored content and sources when comment-to-AI has no explicit @ reference', () => {
    const { workspace, scope, comment, element } = fixture();
    const context = resolveNodeSlideReadContext({ workspace, writeScope: scope, requested: [] });
    const legacyImplicitComment = resolveNodeSlideReadContext({
      workspace,
      writeScope: scope,
      requested: [{ id: comment.id, kind: 'comment', label: 'Scoped comment' }],
    });
    const providerInput = buildNodeSlideEditProviderInput(
      workspace,
      {
        deckId: workspace.deck.id,
        instruction: 'Address the comment.',
        baseDeckVersion: workspace.deck.version,
        baseSlideVersions: {},
        baseElementVersions: {},
        scope,
        designBehavior: 'preserve',
        referenceUse: 'context_only',
        providerMode: 'openrouter_free',
      },
      context,
    );

    expect(providerInput).toContain(comment.text);
    expect(providerInput).toContain(element.content);
    for (const resolved of [context, legacyImplicitComment]) {
      expect(resolved.slides.map((value) => value.id)).toEqual([element.slideId]);
      expect(resolved.elements.map((value) => value.id)).toEqual([element.id]);
      expect(resolved.sources.map((value) => value.id)).toEqual(element.sourceIds);
      expect(resolved.comments.map((value) => value.id)).toEqual([comment.id]);
    }
  });

  it('adds substantive explicit references without dropping scoped content or expanding write scope', () => {
    const { workspace, scope, comment, element } = fixture();
    const source = workspace.sources.find((candidate) => !element.sourceIds.includes(candidate.id));
    if (!source) throw new Error('Expected an out-of-anchor source fixture.');
    const scopeBefore = structuredClone(scope);

    const context = resolveNodeSlideReadContext({
      workspace,
      writeScope: scope,
      requested: [{ id: source.id, kind: 'source', label: source.title }],
    });

    expect(context.slides.map((value) => value.id)).toEqual([element.slideId]);
    expect(context.elements.map((value) => value.id)).toEqual([element.id]);
    expect(context.sources.map((value) => value.id)).toEqual(
      workspace.sources
        .filter((value) => element.sourceIds.includes(value.id) || value.id === source.id)
        .map((value) => value.id),
    );
    expect(context.comments.map((value) => value.id)).toEqual([comment.id]);
    expect(context.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: element.slideId, kind: 'slide' }),
        expect.objectContaining({ id: element.id, kind: 'element' }),
        expect.objectContaining({ id: comment.id, kind: 'comment' }),
        expect.objectContaining({ id: source.id, kind: 'source' }),
      ]),
    );
    expect(scope).toEqual(scopeBefore);
  });

  it('reserves explicit references and the scoped comment before filling a near-total scope', () => {
    const {
      workspace,
      scope,
      comment,
      scopedSources,
      scopedElements,
      explicitSource,
      explicitElement,
    } = capacityFixture();
    const scopeBefore = structuredClone(scope);

    const context = resolveNodeSlideReadContext({
      workspace,
      writeScope: scope,
      requested: [
        { id: comment.id, kind: 'comment', label: 'Explicit scoped comment' },
        { id: explicitElement.id, kind: 'element', label: explicitElement.name },
        { id: explicitSource.id, kind: 'source', label: explicitSource.title },
      ],
    });

    expect(context.references).toHaveLength(NODESLIDE_AGENT_READ_CONTEXT_LIMITS.totalRefs);
    expect(context.slides).toHaveLength(NODESLIDE_AGENT_READ_CONTEXT_LIMITS.slideIds);
    expect(context.elements.map((element) => element.id)).toEqual([
      ...scopedElements.slice(0, -1).map((element) => element.id),
      explicitElement.id,
    ]);
    expect(context.sources.map((source) => source.id)).toEqual([
      ...scopedSources.slice(0, 30).map((source) => source.id),
      explicitSource.id,
    ]);
    expect(context.comments.map((value) => value.id)).toEqual([comment.id]);
    expect(
      context.references.filter(
        (reference) => reference.kind === 'comment' && reference.id === comment.id,
      ),
    ).toEqual([{ id: comment.id, kind: 'comment', label: 'Explicit scoped comment' }]);
    expect(scope).toEqual(scopeBefore);
    expect(scope.elementIds).not.toContain(explicitElement.id);
  });

  it('dedupes explicit overlap before filling the remaining source category capacity', () => {
    const { workspace, scopedSources, scopedElements, explicitSource } = capacityFixture();
    const firstElement = scopedElements[0];
    if (!firstElement) throw new Error('Expected scoped element.');
    const sourceWorkspace: NodeSlideWorkspace = {
      ...workspace,
      elements: workspace.elements.map((element) =>
        element.id === firstElement.id
          ? {
              ...element,
              chart: undefined,
              sourceIds: scopedSources.map((source) => source.id),
            }
          : element,
      ),
    };
    const scope: PatchScope = {
      kind: 'elements',
      deckId: workspace.deck.id,
      slideIds: [firstElement.slideId],
      elementIds: [firstElement.id],
      operationMode: 'unrestricted',
    };
    const scopeBefore = structuredClone(scope);

    const context = resolveNodeSlideReadContext({
      workspace: sourceWorkspace,
      writeScope: scope,
      requested: [
        { id: scopedSources[0]?.id as string, kind: 'source', label: 'Explicit scoped source' },
        { id: explicitSource.id, kind: 'source', label: explicitSource.title },
      ],
    });

    expect(context.sources).toHaveLength(NODESLIDE_AGENT_READ_CONTEXT_LIMITS.sourceIds);
    expect(context.sources.map((source) => source.id)).toEqual([
      ...scopedSources.slice(0, -1).map((source) => source.id),
      explicitSource.id,
    ]);
    expect(context.references).toContainEqual({
      id: scopedSources[0]?.id,
      kind: 'source',
      label: 'Explicit scoped source',
    });
    expect(scope).toEqual(scopeBefore);
  });
});
