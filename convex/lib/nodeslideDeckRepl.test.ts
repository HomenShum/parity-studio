import { describe, expect, it } from 'vitest';
import type {
  DeckSnapshot,
  PatchOperation,
  PatchScope,
  SlideElement,
} from '../../shared/nodeslide';
import {
  type NodeSlideDeckReplCommand,
  nodeSlideDeckReplDefaultBudget,
  nodeSlideSnapshotDigest,
  runNodeSlideDeckRepl,
} from './nodeslideDeckRepl';
import { buildGoldenNodeSlide } from './nodeslideSeed';

const FIXED_NOW = 1_700_000_000_000;

function fixture(): DeckSnapshot {
  return buildGoldenNodeSlide('deck-repl-tests', FIXED_NOW).snapshot;
}

function constantClock(): () => number {
  return () => FIXED_NOW;
}

function editableText(snapshot: DeckSnapshot): SlideElement {
  const element = snapshot.elements.find(
    (candidate) => candidate.kind === 'text' && !candidate.locked && candidate.content,
  );
  if (!element) throw new Error('Fixture requires editable text.');
  return element;
}

function proposalCommand(
  snapshot: DeckSnapshot,
  operations?: PatchOperation[],
  scope?: PatchScope,
): NodeSlideDeckReplCommand {
  const target = editableText(snapshot);
  const proposed =
    operations ??
    ([
      {
        op: 'replace_text',
        slideId: target.slideId,
        elementId: target.id,
        text: 'A sharper, reviewable story',
      },
    ] satisfies PatchOperation[]);
  return {
    id: 'proposal-1',
    type: 'propose_patch',
    baseDeckVersion: snapshot.deck.version,
    baseSlideVersions: Object.fromEntries(
      snapshot.slides.map((slide) => [slide.id, slide.version]),
    ),
    baseElementVersions: Object.fromEntries(
      snapshot.elements.map((element) => [element.id, element.version]),
    ),
    scope:
      scope ??
      ({
        kind: 'elements',
        deckId: snapshot.deck.id,
        slideIds: [target.slideId],
        elementIds: [target.id],
        operationMode: 'copy',
      } satisfies PatchScope),
    operations: proposed,
  };
}

describe('NodeSlide Deck REPL', () => {
  it('is deterministic and leaves the caller snapshot immutable', () => {
    const snapshot = fixture();
    const before = structuredClone(snapshot);
    const args = {
      sessionId: 'session-1',
      traceId: 'trace-1',
      snapshot,
      expectedSnapshotDigest: nodeSlideSnapshotDigest(snapshot),
      commands: [
        { id: 'deck', type: 'inspect_deck' as const },
        { id: 'slide', type: 'measure_slide' as const, slideId: snapshot.deck.slideOrder[0] ?? '' },
      ],
      now: constantClock(),
    };

    expect(runNodeSlideDeckRepl(args)).toEqual(runNodeSlideDeckRepl(args));
    expect(snapshot).toEqual(before);
  });

  it('returns a validated patch proposal without committing it', () => {
    const snapshot = fixture();
    const before = structuredClone(snapshot);
    const result = runNodeSlideDeckRepl({
      sessionId: 'session-proposal',
      traceId: 'trace-proposal',
      snapshot,
      commands: [proposalCommand(snapshot)],
      now: constantClock(),
    });

    expect(result.status).toBe('completed');
    expect(result.terminalReason).toBe('completed');
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]?.operations).toHaveLength(1);
    expect(result.proposals[0]?.operationDigest).toMatch(/^ops_sha256:[0-9a-f]{64}$/);
    expect(snapshot).toEqual(before);
  });

  it('rejects stale element clocks', () => {
    const snapshot = fixture();
    const command = proposalCommand(snapshot);
    if (command.type !== 'propose_patch') throw new Error('Expected proposal command.');
    const target = editableText(snapshot);
    command.baseElementVersions[target.id] -= 1;

    const result = runNodeSlideDeckRepl({
      sessionId: 'session-stale',
      traceId: 'trace-stale',
      snapshot,
      commands: [command],
      now: constantClock(),
    });

    expect(result.terminalReason).toBe('stale_snapshot');
    expect(result.proposals).toEqual([]);
    expect(result.receipts[0]?.status).toBe('error');
  });

  it('rejects locked and out-of-scope writes', () => {
    const locked = fixture();
    const lockedCommand = proposalCommand(locked);
    if (lockedCommand.type !== 'propose_patch') throw new Error('Expected proposal command.');
    const lockedOperation = lockedCommand.operations[0];
    if (!lockedOperation || !('elementId' in lockedOperation)) {
      throw new Error('Expected element operation.');
    }
    const lockedTarget = locked.elements.find(
      (candidate) => candidate.id === lockedOperation.elementId,
    );
    if (!lockedTarget) throw new Error('Expected proposal target.');
    lockedTarget.locked = true;
    const lockedResult = runNodeSlideDeckRepl({
      sessionId: 'session-locked',
      traceId: 'trace-locked',
      snapshot: locked,
      commands: [lockedCommand],
      now: constantClock(),
    });
    expect(lockedResult.terminalReason).toBe('command_rejected');

    const snapshot = fixture();
    const target = editableText(snapshot);
    const another = snapshot.elements.find(
      (candidate) => candidate.slideId !== target.slideId && !candidate.locked,
    );
    if (!another) throw new Error('Fixture requires a second-slide element.');
    const operation: PatchOperation = {
      op: 'move',
      slideId: another.slideId,
      elementId: another.id,
      x: Math.max(0, another.bbox.x - 0.01),
      y: another.bbox.y,
    };
    const scope: PatchScope = {
      kind: 'elements',
      deckId: snapshot.deck.id,
      slideIds: [target.slideId],
      elementIds: [target.id],
      operationMode: 'unrestricted',
    };
    const outsideResult = runNodeSlideDeckRepl({
      sessionId: 'session-scope',
      traceId: 'trace-scope',
      snapshot,
      commands: [proposalCommand(snapshot, [operation], scope)],
      now: constantClock(),
    });
    expect(outsideResult.terminalReason).toBe('command_rejected');
  });

  it('rejects unknown IDs and duplicate command IDs', () => {
    const snapshot = fixture();
    const unknown = runNodeSlideDeckRepl({
      sessionId: 'session-unknown',
      traceId: 'trace-unknown',
      snapshot,
      commands: [{ id: 'missing', type: 'inspect_slide', slideId: 'not-a-slide' }],
      now: constantClock(),
    });
    expect(unknown.terminalReason).toBe('command_rejected');

    const duplicate = runNodeSlideDeckRepl({
      sessionId: 'session-duplicate',
      traceId: 'trace-duplicate',
      snapshot,
      commands: [
        { id: 'same', type: 'inspect_deck' },
        { id: 'same', type: 'inspect_deck' },
      ],
      now: constantClock(),
    });
    expect(duplicate.terminalReason).toBe('invalid_request');
    expect(duplicate.receipts).toHaveLength(2);
  });

  it('enforces step, input, output, operation, and wall-time ceilings', () => {
    const snapshot = fixture();
    const step = runNodeSlideDeckRepl({
      sessionId: 'session-step',
      traceId: 'trace-step',
      snapshot,
      commands: [
        { id: 'one', type: 'inspect_deck' },
        { id: 'two', type: 'inspect_deck' },
      ],
      budget: { maxSteps: 1 },
      now: constantClock(),
    });
    expect(step.terminalReason).toBe('step_budget_exhausted');
    expect(step.receipts).toHaveLength(1);

    const input = runNodeSlideDeckRepl({
      sessionId: 'session-input',
      traceId: 'trace-input',
      snapshot,
      commands: [{ id: 'one', type: 'inspect_deck' }],
      budget: { maxInputBytes: 1 },
      now: constantClock(),
    });
    expect(input.terminalReason).toBe('input_budget_exhausted');

    const output = runNodeSlideDeckRepl({
      sessionId: 'session-output',
      traceId: 'trace-output',
      snapshot,
      commands: [{ id: 'one', type: 'inspect_deck' }],
      budget: { maxOutputBytes: 1 },
      now: constantClock(),
    });
    expect(output.terminalReason).toBe('output_budget_exhausted');
    expect(output.receipts).toEqual([]);

    const target = editableText(snapshot);
    const operations: PatchOperation[] = [
      {
        op: 'replace_text',
        slideId: target.slideId,
        elementId: target.id,
        text: 'First change',
      },
      {
        op: 'update_style',
        slideId: target.slideId,
        elementId: target.id,
        properties: { fontWeight: 700 },
      },
    ];
    const operation = runNodeSlideDeckRepl({
      sessionId: 'session-operation',
      traceId: 'trace-operation',
      snapshot,
      commands: [proposalCommand(snapshot, operations)],
      budget: { maxOperations: 1 },
      now: constantClock(),
    });
    expect(operation.terminalReason).toBe('operation_budget_exhausted');

    const ticks = [FIXED_NOW, FIXED_NOW + 11];
    const wall = runNodeSlideDeckRepl({
      sessionId: 'session-wall',
      traceId: 'trace-wall',
      snapshot,
      commands: [{ id: 'one', type: 'inspect_deck' }],
      budget: { maxWallTimeMs: 10 },
      now: () => ticks.shift() ?? FIXED_NOW + 11,
    });
    expect(wall.terminalReason).toBe('wall_time_exhausted');
  });

  it('redacts secret-like text and bounds content previews', () => {
    const snapshot = fixture();
    const slideId = snapshot.deck.slideOrder[0] ?? '';
    const target = snapshot.elements.find((element) => element.slideId === slideId);
    if (!target) throw new Error('Fixture requires a slide element.');
    target.content = `api_key=supersecretvalue123456 ${'x'.repeat(600)}`;

    const result = runNodeSlideDeckRepl({
      sessionId: 'session-redaction',
      traceId: 'trace-redaction',
      snapshot,
      commands: [{ id: 'slide', type: 'inspect_slide', slideId }],
      now: constantClock(),
    });
    const serialized = JSON.stringify(result.receipts);
    expect(serialized).not.toContain('supersecretvalue123456');
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).toContain('contentTruncated');
  });

  it('stops before execution when the expected snapshot digest differs', () => {
    const snapshot = fixture();
    const result = runNodeSlideDeckRepl({
      sessionId: 'session-digest',
      traceId: 'trace-digest',
      snapshot,
      expectedSnapshotDigest: 'snap_not-current',
      commands: [{ id: 'deck', type: 'inspect_deck' }],
      now: constantClock(),
    });
    expect(result.terminalReason).toBe('stale_snapshot');
    expect(result.receipts).toEqual([]);
  });

  it('rejects invalid requested budgets instead of silently widening them', () => {
    const snapshot = fixture();
    const result = runNodeSlideDeckRepl({
      sessionId: 'session-budget',
      traceId: 'trace-budget',
      snapshot,
      commands: [],
      budget: { maxSteps: nodeSlideDeckReplDefaultBudget().maxSteps * 10_000 },
      now: constantClock(),
    });
    expect(result.terminalReason).toBe('invalid_request');
  });
});
