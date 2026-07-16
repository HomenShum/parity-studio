import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_LIVE_DECK_REPL_OPERATION_LIMIT,
  validateNodeSlideLiveEditWithDeckRepl,
} from './nodeslideLiveDeckRepl';
import { buildGoldenNodeSlide } from './nodeslideSeed';

const NOW = 1_720_000_000_000;

describe('NodeSlide live Deck REPL validation', () => {
  it('inspects, measures, and validates the exact review candidate', () => {
    const snapshot = buildGoldenNodeSlide('live-repl', NOW).snapshot;
    const element = snapshot.elements.find((candidate) => candidate.kind === 'text');
    expect(element).toBeDefined();
    if (!element) return;
    const operation = {
      op: 'replace_text' as const,
      slideId: element.slideId,
      elementId: element.id,
      text: `${element.content ?? ''} Refined.`,
    };

    const validation = validateNodeSlideLiveEditWithDeckRepl({
      runId: 'run-live-repl',
      traceId: 'trace-live-repl',
      snapshot,
      baseDeckVersion: snapshot.deck.version,
      baseSlideVersions: Object.fromEntries(
        snapshot.slides.map((slide) => [slide.id, slide.version]),
      ),
      baseElementVersions: Object.fromEntries(
        snapshot.elements.map((candidate) => [candidate.id, candidate.version]),
      ),
      scope: {
        kind: 'elements',
        deckId: snapshot.deck.id,
        slideIds: [element.slideId],
        elementIds: [element.id],
        operationMode: 'copy',
      },
      operations: [operation],
    });

    expect(validation.status).toBe('validated');
    if (validation.status !== 'validated') return;
    expect(validation.operations).toEqual([operation]);
    expect(validation.inspectedSlideIds).toEqual([element.slideId]);
    expect(validation.result.receipts.map((receipt) => receipt.commandType)).toEqual([
      'inspect_deck',
      'inspect_slide',
      'measure_slide',
      'propose_patch',
    ]);
    expect(validation.result.proposals[0]?.operations).toEqual([operation]);
  });

  it('keeps high-cardinality candidates on the established validator path', () => {
    const snapshot = buildGoldenNodeSlide('live-repl-large', NOW).snapshot;
    const operations = Array.from(
      { length: NODESLIDE_LIVE_DECK_REPL_OPERATION_LIMIT + 1 },
      (_, index) => ({
        op: 'update_deck' as const,
        properties: { title: `Deck ${index}` },
      }),
    );
    const validation = validateNodeSlideLiveEditWithDeckRepl({
      runId: 'run-live-repl-large',
      traceId: 'trace-live-repl-large',
      snapshot,
      baseDeckVersion: snapshot.deck.version,
      baseSlideVersions: {},
      baseElementVersions: {},
      scope: { kind: 'deck', deckId: snapshot.deck.id, operationMode: 'unrestricted' },
      operations,
    });

    expect(validation).toMatchObject({
      status: 'skipped_high_cardinality',
      operationLimit: NODESLIDE_LIVE_DECK_REPL_OPERATION_LIMIT,
    });
  });

  it('preserves linked-comment validation outside the snapshot-only executor', () => {
    const snapshot = buildGoldenNodeSlide('live-repl-comment', NOW).snapshot;
    const element = snapshot.elements.find((candidate) => candidate.kind === 'text');
    expect(element).toBeDefined();
    if (!element) return;
    const operation = {
      op: 'replace_text' as const,
      slideId: element.slideId,
      elementId: element.id,
      text: 'Comment-requested refinement.',
    };

    const validation = validateNodeSlideLiveEditWithDeckRepl({
      runId: 'run-live-repl-comment',
      traceId: 'trace-live-repl-comment',
      snapshot,
      baseDeckVersion: snapshot.deck.version,
      baseSlideVersions: { [element.slideId]: 1 },
      baseElementVersions: { [element.id]: element.version },
      scope: {
        kind: 'comment',
        deckId: snapshot.deck.id,
        slideIds: [element.slideId],
        elementIds: [element.id],
        commentId: 'comment-open',
        operationMode: 'copy',
      },
      operations: [operation],
    });

    expect(validation).toMatchObject({
      status: 'skipped_unsupported_scope',
      scopeKind: 'comment',
      operations: [operation],
    });
  });
});
