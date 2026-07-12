import { describe, expect, it, vi } from 'vitest';
import type {
  DeckSnapshot,
  PatchOperation,
  PatchScope,
  SlideElement,
} from '../../shared/nodeslide';
import { nodeSlideSnapshotDigest } from './nodeslideDeckRepl';
import { type NodeSlidePatchInput, clocksForNodeSlideOperations } from './nodeslidePatches';
import {
  type NodeSlideRenderRepairCallbacks,
  runNodeSlideRenderRepairLoop,
} from './nodeslideRenderRepairLoop';
import { buildGoldenNodeSlide } from './nodeslideSeed';

const FIXED_NOW = 1_700_000_000_000;

function fixture(): DeckSnapshot {
  return buildGoldenNodeSlide('render-repair-tests', FIXED_NOW).snapshot;
}

function target(snapshot: DeckSnapshot): SlideElement {
  const element = snapshot.elements.find(
    (candidate) => candidate.kind === 'text' && !candidate.locked && candidate.content,
  );
  if (!element) throw new Error('Fixture requires editable text.');
  return element;
}

function patchFor(
  snapshot: DeckSnapshot,
  operations: PatchOperation[],
  scope: PatchScope = {
    kind: 'deck',
    deckId: snapshot.deck.id,
    operationMode: 'unrestricted',
  },
): NodeSlidePatchInput {
  return {
    deckId: snapshot.deck.id,
    baseDeckVersion: snapshot.deck.version,
    ...clocksForNodeSlideOperations(snapshot, operations),
    scope,
    operations,
  };
}

function dirtyObservation() {
  return {
    clean: false,
    observations: [
      {
        code: 'overflow',
        severity: 'error' as const,
        message: 'Text exceeds its visual box.',
      },
    ],
  };
}

function callbacks(
  overrides: Partial<NodeSlideRenderRepairCallbacks> = {},
): NodeSlideRenderRepairCallbacks {
  return {
    validate: () => ({ clean: false, safetyPassed: true, issues: [] }),
    render: ({ snapshotDigest }) => ({ artifact: { snapshotDigest }, bytes: 100 }),
    observe: () => dirtyObservation(),
    proposeRepair: ({ snapshot }) => {
      const element = target(snapshot as DeckSnapshot);
      return patchFor(snapshot as DeckSnapshot, [
        {
          op: 'replace_text',
          slideId: element.slideId,
          elementId: element.id,
          text: 'Repaired candidate',
        },
      ]);
    },
    ...overrides,
  };
}

describe('NodeSlide render-observe-repair loop', () => {
  it('returns a zero-attempt clean result without rendering', () => {
    const render = vi.fn(() => ({ artifact: {}, bytes: 1 }));
    const snapshot = fixture();
    const result = runNodeSlideRenderRepairLoop({
      base: snapshot,
      callbacks: callbacks({
        validate: () => ({ clean: true, safetyPassed: true, issues: [] }),
        render,
      }),
      now: () => FIXED_NOW,
    });

    expect(result.terminalReason).toBe('clean');
    expect(result.usage.attempts).toBe(0);
    expect(result.proposals).toEqual([]);
    expect(render).not.toHaveBeenCalled();
  });

  it('performs one validated in-memory repair and keeps the base immutable', () => {
    const snapshot = fixture();
    const before = structuredClone(snapshot);
    const originalTarget = target(snapshot);
    const render = vi.fn(({ snapshotDigest }) => ({ artifact: { snapshotDigest }, bytes: 100 }));
    const result = runNodeSlideRenderRepairLoop({
      base: snapshot,
      expectedBaseDigest: nodeSlideSnapshotDigest(snapshot),
      callbacks: callbacks({
        validate: (candidate) => ({
          clean:
            (candidate as DeckSnapshot).elements.find((element) => element.id === originalTarget.id)
              ?.content === 'Repaired candidate',
          safetyPassed: true,
          issues: [],
        }),
        render,
      }),
      now: () => FIXED_NOW,
    });

    expect(result.terminalReason).toBe('clean');
    expect(result.proposals).toHaveLength(1);
    expect(result.operations).toHaveLength(1);
    expect(result.usage.attempts).toBe(1);
    expect(render).toHaveBeenCalledOnce();
    expect(
      result.candidate.elements.find((element) => element.id === originalTarget.id)?.content,
    ).toBe('Repaired candidate');
    expect(snapshot).toEqual(before);
  });

  it('stops when bounded visual observation reports a clean render', () => {
    const proposeRepair = vi.fn();
    const result = runNodeSlideRenderRepairLoop({
      base: fixture(),
      callbacks: callbacks({
        observe: () => ({ clean: true, observations: [] }),
        proposeRepair,
      }),
      now: () => FIXED_NOW,
    });

    expect(result.terminalReason).toBe('clean');
    expect(result.usage.attempts).toBe(1);
    expect(proposeRepair).not.toHaveBeenCalled();
  });

  it('detects semantic A-B-A repair cycles despite changing version clocks', () => {
    const snapshot = fixture();
    const element = target(snapshot);
    const original = element.content ?? '';
    const result = runNodeSlideRenderRepairLoop({
      base: snapshot,
      callbacks: callbacks({
        proposeRepair: ({ snapshot: candidate }) => {
          const current = (candidate as DeckSnapshot).elements.find(
            (item) => item.id === element.id,
          );
          if (!current) throw new Error('Missing target.');
          return patchFor(candidate as DeckSnapshot, [
            {
              op: 'replace_text',
              slideId: current.slideId,
              elementId: current.id,
              text: current.content === original ? 'Cycle B' : original,
            },
          ]);
        },
      }),
      budget: { maxNoProgress: 4 },
      now: () => FIXED_NOW,
    });

    expect(result.terminalReason).toBe('cycle_detected');
    expect(result.proposals).toHaveLength(2);
    expect(result.candidate.elements.find((item) => item.id === element.id)?.content).toBe(
      original,
    );
  });

  it('stops after repeated unchanged observations even while candidates change', () => {
    const snapshot = fixture();
    const element = target(snapshot);
    const result = runNodeSlideRenderRepairLoop({
      base: snapshot,
      callbacks: callbacks({
        proposeRepair: ({ snapshot: candidate }) => {
          const current = (candidate as DeckSnapshot).elements.find(
            (item) => item.id === element.id,
          );
          if (!current) throw new Error('Missing target.');
          return patchFor(candidate as DeckSnapshot, [
            {
              op: 'move',
              slideId: current.slideId,
              elementId: current.id,
              x: Math.min(1 - current.bbox.width, current.bbox.x + 0.005),
              y: current.bbox.y,
            },
          ]);
        },
      }),
      budget: { maxNoProgress: 2 },
      now: () => FIXED_NOW,
    });

    expect(result.terminalReason).toBe('no_progress');
    expect(result.proposals).toHaveLength(1);
    expect(result.usage.attempts).toBe(2);
  });

  it('rejects stale, locked, and out-of-scope proposals', () => {
    const staleSnapshot = fixture();
    const staleResult = runNodeSlideRenderRepairLoop({
      base: staleSnapshot,
      callbacks: callbacks({
        proposeRepair: ({ snapshot }) => {
          const element = target(snapshot as DeckSnapshot);
          const patch = patchFor(snapshot as DeckSnapshot, [
            {
              op: 'replace_text',
              slideId: element.slideId,
              elementId: element.id,
              text: 'Stale',
            },
          ]);
          patch.baseElementVersions[element.id] -= 1;
          return patch;
        },
      }),
      now: () => FIXED_NOW,
    });
    expect(staleResult.terminalReason).toBe('stale_snapshot');

    const lockedSnapshot = fixture();
    const lockedTarget = target(lockedSnapshot);
    lockedTarget.locked = true;
    const lockedResult = runNodeSlideRenderRepairLoop({
      base: lockedSnapshot,
      callbacks: callbacks({
        proposeRepair: ({ snapshot }) => {
          const current = (snapshot as DeckSnapshot).elements.find(
            (item) => item.id === lockedTarget.id,
          );
          if (!current) throw new Error('Missing target.');
          return patchFor(snapshot as DeckSnapshot, [
            {
              op: 'replace_text',
              slideId: current.slideId,
              elementId: current.id,
              text: 'Locked mutation',
            },
          ]);
        },
      }),
      now: () => FIXED_NOW,
    });
    expect(lockedResult.terminalReason).toBe('invalid_proposal');

    const scopeSnapshot = fixture();
    const first = target(scopeSnapshot);
    const outside = scopeSnapshot.elements.find(
      (item) => item.slideId !== first.slideId && !item.locked,
    );
    if (!outside) throw new Error('Fixture requires a second-slide element.');
    const scope: PatchScope = {
      kind: 'elements',
      deckId: scopeSnapshot.deck.id,
      slideIds: [first.slideId],
      elementIds: [first.id],
      operationMode: 'unrestricted',
    };
    const outOfScopeResult = runNodeSlideRenderRepairLoop({
      base: scopeSnapshot,
      callbacks: callbacks({
        proposeRepair: ({ snapshot }) =>
          patchFor(
            snapshot as DeckSnapshot,
            [
              {
                op: 'move',
                slideId: outside.slideId,
                elementId: outside.id,
                x: Math.max(0, outside.bbox.x - 0.01),
                y: outside.bbox.y,
              },
            ],
            scope,
          ),
      }),
      now: () => FIXED_NOW,
    });
    expect(outOfScopeResult.terminalReason).toBe('invalid_proposal');
  });

  it('enforces attempt, operation, render, observation, and wall-time budgets', () => {
    const snapshot = fixture();
    const element = target(snapshot);
    const changingProposal: NodeSlideRenderRepairCallbacks['proposeRepair'] = ({
      snapshot: candidate,
      attempt,
    }) => {
      const current = (candidate as DeckSnapshot).elements.find((item) => item.id === element.id);
      if (!current) throw new Error('Missing target.');
      return patchFor(candidate as DeckSnapshot, [
        {
          op: 'replace_text',
          slideId: current.slideId,
          elementId: current.id,
          text: `Attempt ${attempt}`,
        },
      ]);
    };
    const attempt = runNodeSlideRenderRepairLoop({
      base: snapshot,
      callbacks: callbacks({ proposeRepair: changingProposal }),
      budget: { maxAttempts: 1, maxNoProgress: 4 },
      now: () => FIXED_NOW,
    });
    expect(attempt.terminalReason).toBe('attempt_budget_exhausted');

    const operation = runNodeSlideRenderRepairLoop({
      base: snapshot,
      callbacks: callbacks({
        proposeRepair: ({ snapshot: candidate }) => {
          const current = target(candidate as DeckSnapshot);
          return patchFor(candidate as DeckSnapshot, [
            {
              op: 'replace_text',
              slideId: current.slideId,
              elementId: current.id,
              text: 'One',
            },
            {
              op: 'update_style',
              slideId: current.slideId,
              elementId: current.id,
              properties: { fontWeight: 700 },
            },
          ]);
        },
      }),
      budget: { maxOperations: 1 },
      now: () => FIXED_NOW,
    });
    expect(operation.terminalReason).toBe('operation_budget_exhausted');

    const render = runNodeSlideRenderRepairLoop({
      base: snapshot,
      callbacks: callbacks({ render: () => ({ artifact: 'x'.repeat(20), bytes: 20 }) }),
      budget: { maxRenderBytes: 10 },
      now: () => FIXED_NOW,
    });
    expect(render.terminalReason).toBe('render_budget_exhausted');

    const observation = runNodeSlideRenderRepairLoop({
      base: snapshot,
      callbacks: callbacks({
        observe: () => ({
          clean: false,
          observations: [{ code: 'large', severity: 'error', message: 'x'.repeat(500) }],
        }),
      }),
      budget: { maxObservationBytes: 10 },
      now: () => FIXED_NOW,
    });
    expect(observation.terminalReason).toBe('observation_budget_exhausted');

    let tick = FIXED_NOW;
    const wall = runNodeSlideRenderRepairLoop({
      base: snapshot,
      callbacks: callbacks({
        render: () => {
          tick += 11;
          return { artifact: {}, bytes: 1 };
        },
        proposeRepair: changingProposal,
      }),
      budget: { maxWallTimeMs: 10, maxNoProgress: 4 },
      now: () => tick,
    });
    expect(wall.terminalReason).toBe('wall_time_exhausted');
  });

  it('stops immediately on deterministic safety failure', () => {
    const render = vi.fn(() => ({ artifact: {}, bytes: 1 }));
    const result = runNodeSlideRenderRepairLoop({
      base: fixture(),
      callbacks: callbacks({
        validate: () => ({
          clean: false,
          safetyPassed: false,
          issues: [{ code: 'source', severity: 'error', message: 'Source gate failed.' }],
        }),
        render,
      }),
      now: () => FIXED_NOW,
    });
    expect(result.terminalReason).toBe('safety_failure');
    expect(render).not.toHaveBeenCalled();
  });

  it('sanitizes callback failures and never leaks raw secrets', () => {
    const result = runNodeSlideRenderRepairLoop({
      base: fixture(),
      callbacks: callbacks({
        render: () => {
          throw new Error('Bearer secret-token sk-supersecret123456789');
        },
      }),
      now: () => FIXED_NOW,
    });
    const serialized = JSON.stringify(result.receipts);

    expect(result.terminalReason).toBe('adapter_failure');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('supersecret123456789');
    expect(serialized).toContain('REDACTED');
  });

  it('is deterministic and binds execution to the expected base digest', () => {
    const snapshot = fixture();
    const run = () =>
      runNodeSlideRenderRepairLoop({
        base: snapshot,
        callbacks: callbacks({ observe: () => ({ clean: true, observations: [] }) }),
        now: () => FIXED_NOW,
      });
    expect(run()).toEqual(run());

    const stale = runNodeSlideRenderRepairLoop({
      base: snapshot,
      expectedBaseDigest: 'snap_wrong',
      callbacks: callbacks(),
      now: () => FIXED_NOW,
    });
    expect(stale.terminalReason).toBe('stale_snapshot');
    expect(stale.receipts).toEqual([]);
  });
});
