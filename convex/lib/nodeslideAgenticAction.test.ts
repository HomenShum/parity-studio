import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeSlideWorkspace } from '../../shared/nodeslide';
import { runDeckReplShadow } from '../nodeslideAgent';
import type { NodeSlideDeckReplShadowReceipt } from './nodeslideDeckRepl';
import {
  type NodeSlideExecutionTrace,
  assertExecutionTraceBounds,
} from './nodeslideExecutionTrace';
import { buildGoldenNodeSlide } from './nodeslideSeed';

const OWNER_ACCESS_KEY = 'a'.repeat(43);
const NOW = 1_700_000_000_000;
const SHADOW_FLAG = 'NODESLIDE_AGENTIC_SHADOW_ENABLED';
const GLOBAL_FLAG = 'NODESLIDE_AGENTIC_GLOBAL_ENABLED';
const originalShadowFlag = process.env[SHADOW_FLAG];
const originalGlobalFlag = process.env[GLOBAL_FLAG];

type ShadowArgs = {
  deckId: string;
  ownerAccessKey: string;
  sessionId: string;
  expectedSnapshotDigest?: string;
  commands: unknown;
};

type ShadowContext = {
  runQuery: ReturnType<typeof vi.fn>;
  runMutation: ReturnType<typeof vi.fn>;
};

type ShadowHandler = (
  context: ShadowContext,
  args: ShadowArgs,
) => Promise<NodeSlideDeckReplShadowReceipt>;

const shadowHandler = (runDeckReplShadow as unknown as { _handler: ShadowHandler })._handler;

function workspace(): NodeSlideWorkspace {
  const snapshot = buildGoldenNodeSlide('agentic-action-tests', NOW).snapshot;
  return {
    ...snapshot,
    comments: [],
    patches: [],
    versions: [],
    traces: [],
    validations: [],
    exports: [],
    presence: [],
    publication: null,
  };
}

function context(value: NodeSlideWorkspace | null) {
  const persisted: NodeSlideExecutionTrace[] = [];
  const runQuery = vi.fn(async () => value);
  const runMutation = vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
    if ('trace' in args) persisted.push(args.trace as NodeSlideExecutionTrace);
    return { ok: true };
  });
  return { context: { runQuery, runMutation }, persisted };
}

describe('NodeSlide Deck REPL shadow action', () => {
  beforeEach(() => {
    process.env[SHADOW_FLAG] = 'true';
    process.env[GLOBAL_FLAG] = 'true';
  });

  afterEach(() => {
    if (originalShadowFlag === undefined) delete process.env[SHADOW_FLAG];
    else process.env[SHADOW_FLAG] = originalShadowFlag;
    if (originalGlobalFlag === undefined) delete process.env[GLOBAL_FLAG];
    else process.env[GLOBAL_FLAG] = originalGlobalFlag;
  });

  it('fails closed before validation or data access when the deployment flag is absent', async () => {
    delete process.env[GLOBAL_FLAG];
    const harness = context(workspace());

    await expect(
      shadowHandler(harness.context, {
        deckId: 'deck-ignored',
        ownerAccessKey: OWNER_ACCESS_KEY,
        sessionId: 'disabled-session',
        commands: [{ id: 'inspect', type: 'inspect_deck' }],
      }),
    ).rejects.toMatchObject({ data: { code: 'feature_disabled' } });
    expect(harness.context.runQuery).not.toHaveBeenCalled();
    expect(harness.context.runMutation).not.toHaveBeenCalled();
  });

  it('runs only against an owner-authorized snapshot and persists a bounded no-egress trace', async () => {
    const current = workspace();
    const harness = context(current);
    const result = await shadowHandler(harness.context, {
      deckId: current.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      sessionId: 'shadow-session',
      commands: [{ id: 'inspect', type: 'inspect_deck' }],
    });

    expect(result.terminalReason).toBe('completed');
    expect(result.proposalCount).toBe(0);
    expect(result.candidateExposed).toBe(false);
    expect(result.candidateCommitted).toBe(false);
    expect(harness.context.runQuery).toHaveBeenCalledOnce();
    expect(harness.context.runMutation).toHaveBeenCalledTimes(2);
    expect(harness.persisted).toHaveLength(1);
    expect(harness.persisted[0]?.adapterId).toBe('nodeslide/deck-repl-shadow-probe');
    expect(harness.persisted[0]?.controlsDigest).toMatch(/^controls_sha256:[0-9a-f]{64}$/);
    expect(harness.persisted[0]?.egressMode).toBe('deny');
    expect(harness.persisted[0]?.allowedHosts).toEqual([]);
    expect(JSON.stringify(harness.persisted[0])).not.toContain(OWNER_ACCESS_KEY);
    expect(() =>
      assertExecutionTraceBounds(harness.persisted[0] as NodeSlideExecutionTrace),
    ).not.toThrow();
  });

  it('persists stale digest outcomes without attempting a commit', async () => {
    const current = workspace();
    const harness = context(current);
    const result = await shadowHandler(harness.context, {
      deckId: current.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      sessionId: 'stale-session',
      expectedSnapshotDigest: `snap_sha256:${'0'.repeat(64)}`,
      commands: [{ id: 'inspect', type: 'inspect_deck' }],
    });

    expect(result.terminalReason).toBe('stale_snapshot');
    expect(result.receiptCount).toBe(0);
    expect(harness.persisted[0]?.terminalReason).toBe('stale_snapshot');
    expect(harness.persisted[0]?.proposalDigests).toEqual([]);
  });

  it('returns only opaque proposal metadata and never candidate operations', async () => {
    const current = workspace();
    const harness = context(current);
    const target = current.elements.find((element) => element.kind === 'text' && !element.locked);
    expect(target).toBeDefined();
    if (!target) return;
    const slide = current.slides.find((candidate) => candidate.id === target.slideId);
    expect(slide).toBeDefined();
    if (!slide) return;
    const replacement = 'Shadow candidate text must stay server-side.';

    const result = await shadowHandler(harness.context, {
      deckId: current.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      sessionId: 'hidden-candidate-session',
      commands: [
        {
          id: 'propose-hidden-copy',
          type: 'propose_patch',
          baseDeckVersion: current.deck.version,
          baseSlideVersions: { [slide.id]: slide.version },
          baseElementVersions: { [target.id]: target.version },
          scope: {
            kind: 'elements',
            deckId: current.deck.id,
            slideIds: [slide.id],
            elementIds: [target.id],
            operationMode: 'copy',
          },
          operations: [
            {
              op: 'replace_text',
              slideId: slide.id,
              elementId: target.id,
              text: replacement,
            },
          ],
        },
      ],
    });

    expect(result.proposalCount).toBe(1);
    expect(result.proposalDigests[0]).toMatch(/^ops_sha256:[0-9a-f]{64}$/);
    expect(result.candidateExposed).toBe(false);
    expect(result.candidateCommitted).toBe(false);
    expect(JSON.stringify(result)).not.toContain(replacement);
    expect(JSON.stringify(result)).not.toContain('replace_text');
    expect(
      harness.context.runMutation.mock.calls.some(([, args]) =>
        JSON.stringify(args).includes(replacement),
      ),
    ).toBe(false);
  });

  it('rejects malformed command envelopes before reading a deck', async () => {
    const current = workspace();
    const harness = context(current);
    await expect(
      shadowHandler(harness.context, {
        deckId: current.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        sessionId: 'oversized-session',
        commands: Array.from({ length: 13 }, (_, index) => ({
          id: `command-${index}`,
          type: 'inspect_deck',
        })),
      }),
    ).rejects.toMatchObject({ data: { code: 'invalid_request' } });
    expect(harness.context.runQuery).not.toHaveBeenCalled();
    expect(harness.context.runMutation).not.toHaveBeenCalled();
  });

  it('rejects malformed capability and snapshot bindings before reading a deck', async () => {
    const current = workspace();
    const malformedOwner = context(current);
    await expect(
      shadowHandler(malformedOwner.context, {
        deckId: current.deck.id,
        ownerAccessKey: 'not-an-owner-capability',
        sessionId: 'malformed-owner-session',
        commands: [{ id: 'inspect', type: 'inspect_deck' }],
      }),
    ).rejects.toMatchObject({ data: { code: 'invalid_request' } });
    expect(malformedOwner.context.runQuery).not.toHaveBeenCalled();

    const malformedDigest = context(current);
    await expect(
      shadowHandler(malformedDigest.context, {
        deckId: current.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        sessionId: 'malformed-digest-session',
        expectedSnapshotDigest: 'snap_not-canonical',
        commands: [{ id: 'inspect', type: 'inspect_deck' }],
      }),
    ).rejects.toMatchObject({ data: { code: 'invalid_request' } });
    expect(malformedDigest.context.runQuery).not.toHaveBeenCalled();
  });

  it('rejects oversized command payloads before reading a deck or consuming quota', async () => {
    const current = workspace();
    const harness = context(current);
    await expect(
      shadowHandler(harness.context, {
        deckId: current.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        sessionId: 'oversized-input-session',
        commands: [
          {
            id: 'oversized-find',
            type: 'find_elements',
            text: 'x'.repeat(65_000),
          },
        ],
      }),
    ).rejects.toMatchObject({ data: { code: 'invalid_request' } });
    expect(harness.context.runQuery).not.toHaveBeenCalled();
    expect(harness.context.runMutation).not.toHaveBeenCalled();
  });

  it('does not execute when owner authorization cannot load the workspace', async () => {
    const harness = context(null);
    await expect(
      shadowHandler(harness.context, {
        deckId: 'deck-missing',
        ownerAccessKey: OWNER_ACCESS_KEY,
        sessionId: 'missing-session',
        commands: [{ id: 'inspect', type: 'inspect_deck' }],
      }),
    ).rejects.toMatchObject({ data: { code: 'invalid_request' } });
    expect(harness.context.runMutation).not.toHaveBeenCalled();
  });
});
