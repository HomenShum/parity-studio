import { describe, expect, it } from 'vitest';
import type { DeckComment, NodeSlideWorkspace, PatchScope } from '../../shared/nodeslide';
import { buildNodeSlideEditProviderInput } from './nodeslideEditPlanner';
import { resolveNodeSlideReadContext } from './nodeslideReadContext';
import { buildGoldenNodeSlide } from './nodeslideSeed';

const NOW = 1_700_000_000_000;

function fixture(): {
  workspace: NodeSlideWorkspace;
  scope: PatchScope;
  comment: DeckComment;
} {
  const snapshot = buildGoldenNodeSlide('read-context-authority', NOW).snapshot;
  const element = snapshot.elements.find((candidate) => !candidate.locked);
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

  it('always includes the authorized scoped comment text in provider input', () => {
    const { workspace, scope, comment } = fixture();
    const context = resolveNodeSlideReadContext({ workspace, writeScope: scope, requested: [] });
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
    expect(context.comments.map((value) => value.id)).toEqual([comment.id]);
  });
});
