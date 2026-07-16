import type { DeckSnapshot, PatchOperation, PatchScope } from '../../shared/nodeslide';
import {
  type NodeSlideDeckReplResult,
  nodeSlideSnapshotDigest,
  runNodeSlideDeckRepl,
} from './nodeslideDeckRepl';
import { nodeslideStableId } from './nodeslideIds';

export const NODESLIDE_LIVE_DECK_REPL_OPERATION_LIMIT = 64 as const;
export const NODESLIDE_LIVE_DECK_REPL_SLIDE_LIMIT = 8 as const;

export type NodeSlideLiveDeckReplValidation =
  | {
      status: 'validated';
      operations: PatchOperation[];
      inspectedSlideIds: string[];
      result: NodeSlideDeckReplResult;
    }
  | {
      status: 'skipped_high_cardinality';
      operations: PatchOperation[];
      inspectedSlideIds: string[];
      operationLimit: typeof NODESLIDE_LIVE_DECK_REPL_OPERATION_LIMIT;
    }
  | {
      status: 'skipped_unsupported_scope';
      operations: PatchOperation[];
      inspectedSlideIds: string[];
      scopeKind: 'comment';
    };

/**
 * Runs the exact live edit candidate through the bounded semantic executor.
 *
 * The REPL stays pure and non-committing: it reads an immutable snapshot, emits
 * bounded inspection receipts, and returns the exact validated proposal. The
 * caller still persists a review proposal through the existing owner-gated
 * mutation. High-cardinality candidates retain the established validator path
 * because the REPL's independent hard limit is intentionally lower.
 */
export function validateNodeSlideLiveEditWithDeckRepl(args: {
  runId: string;
  traceId: string;
  snapshot: DeckSnapshot;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: PatchScope;
  operations: readonly PatchOperation[];
}): NodeSlideLiveDeckReplValidation {
  const operations = structuredClone([...args.operations]);
  const inspectedSlideIds = touchedExistingSlideIds(args.snapshot, operations).slice(
    0,
    NODESLIDE_LIVE_DECK_REPL_SLIDE_LIMIT,
  );
  // Comments are stored alongside the workspace, not in the immutable deck
  // snapshot consumed by the semantic REPL. Preserve the established
  // linked-comment validator/persistence path instead of falsely rejecting a
  // valid comment scope because that external anchor is absent here.
  if (args.scope.kind === 'comment') {
    return {
      status: 'skipped_unsupported_scope',
      operations,
      inspectedSlideIds,
      scopeKind: 'comment',
    };
  }
  if (operations.length > NODESLIDE_LIVE_DECK_REPL_OPERATION_LIMIT) {
    return {
      status: 'skipped_high_cardinality',
      operations,
      inspectedSlideIds,
      operationLimit: NODESLIDE_LIVE_DECK_REPL_OPERATION_LIMIT,
    };
  }

  const commands = [
    { id: 'inspect-deck', type: 'inspect_deck' as const },
    ...inspectedSlideIds.flatMap((slideId, index) => [
      { id: `inspect-slide-${index + 1}`, type: 'inspect_slide' as const, slideId },
      { id: `measure-slide-${index + 1}`, type: 'measure_slide' as const, slideId },
    ]),
    {
      id: 'validate-live-proposal',
      type: 'propose_patch' as const,
      baseDeckVersion: args.baseDeckVersion,
      baseSlideVersions: structuredClone(args.baseSlideVersions),
      baseElementVersions: structuredClone(args.baseElementVersions),
      scope: structuredClone(args.scope),
      operations,
    },
  ];
  const result = runNodeSlideDeckRepl({
    sessionId: nodeslideStableId('session_live_edit', args.runId),
    traceId: args.traceId,
    snapshot: args.snapshot,
    expectedSnapshotDigest: nodeSlideSnapshotDigest(args.snapshot),
    commands,
    budget: {
      maxSteps: commands.length,
      maxInputBytes: 128_000,
      maxOutputBytes: 96_000,
      maxOperations: NODESLIDE_LIVE_DECK_REPL_OPERATION_LIMIT,
      maxWallTimeMs: 5_000,
    },
  });
  const proposal =
    result.status === 'completed' && result.proposals.length === 1 ? result.proposals[0] : null;
  if (!proposal) {
    const detail = result.receipts.find((receipt) => receipt.status === 'error')?.summary;
    throw new Error(detail ?? `Bounded Deck REPL stopped before review: ${result.terminalReason}.`);
  }
  return {
    status: 'validated',
    operations: structuredClone(proposal.operations),
    inspectedSlideIds,
    result,
  };
}

function touchedExistingSlideIds(
  snapshot: DeckSnapshot,
  operations: readonly PatchOperation[],
): string[] {
  const existing = new Set(snapshot.slides.map((slide) => slide.id));
  const touched = new Set<string>();
  for (const operation of operations) {
    const slideId =
      'slideId' in operation
        ? operation.slideId
        : operation.op === 'add_slide'
          ? operation.slide.id
          : null;
    if (slideId && existing.has(slideId)) touched.add(slideId);
  }
  return snapshot.deck.slideOrder.filter((slideId) => touched.has(slideId));
}
