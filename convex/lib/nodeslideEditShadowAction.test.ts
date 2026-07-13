import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NODESLIDE_DEFAULT_OPENROUTER_AGENT_MODEL,
  NODESLIDE_OPENROUTER_EDIT_CONSENT,
  type NodeSlideAgentModelId,
  type NodeSlideReasoningEffort,
  type NodeSlideWorkspace,
  type PatchScope,
} from '../../shared/nodeslide';
import { proposeEdit } from '../nodeslideAgent';
import { nodeSlideSnapshotDigest } from './nodeslideDeckRepl';
import { callNodeSlideFreeJson } from './nodeslideProvider';
import { buildGoldenNodeSlide } from './nodeslideSeed';
import {
  type NodeSlideShadowComparison,
  nodeSlideEditTurnInputDigest,
} from './nodeslideShadowComparison';

vi.mock('./nodeslideProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./nodeslideProvider')>()),
  callNodeSlideFreeJson: vi.fn(),
}));

const NOW = 1_700_000_000_000;
const OWNER_ACCESS_KEY = 'a'.repeat(43);
const GLOBAL_FLAG = 'NODESLIDE_AGENTIC_GLOBAL_ENABLED';
const SHADOW_FLAG = 'NODESLIDE_AGENTIC_SHADOW_ENABLED';
const originalGlobalFlag = process.env[GLOBAL_FLAG];
const originalShadowFlag = process.env[SHADOW_FLAG];
const providerMock = vi.mocked(callNodeSlideFreeJson);
const TEST_PROVIDER = 'openrouter' as const;
const TEST_MODEL = NODESLIDE_DEFAULT_OPENROUTER_AGENT_MODEL;

type ProposeContext = {
  runQuery: ReturnType<typeof vi.fn>;
  runMutation: ReturnType<typeof vi.fn>;
};

type ProposeArgs = {
  deckId: string;
  ownerAccessKey: string;
  instruction: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: PatchScope;
  providerMode: 'openrouter_free';
  providerModel?: NodeSlideAgentModelId;
  providerEffort?: NodeSlideReasoningEffort;
  providerConsent: typeof NODESLIDE_OPENROUTER_EDIT_CONSENT;
  webResearch?: boolean;
  webResearchConsent?: string;
};

type ProposeHandler = (context: ProposeContext, args: ProposeArgs) => Promise<unknown>;
const proposeHandler = (proposeEdit as unknown as { _handler: ProposeHandler })._handler;

function fixture() {
  const snapshot = buildGoldenNodeSlide('edit-shadow-action-tests', NOW).snapshot;
  const target = snapshot.elements.find((element) => element.kind === 'text' && !element.locked);
  if (!target) throw new Error('Expected an unlocked text fixture.');
  target.content = 'Before';
  const slide = snapshot.slides.find((candidate) => candidate.id === target.slideId);
  if (!slide) throw new Error('Expected target slide fixture.');
  const workspace: NodeSlideWorkspace = {
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
  const scope: PatchScope = {
    kind: 'elements',
    deckId: snapshot.deck.id,
    slideIds: [slide.id],
    elementIds: [target.id],
    operationMode: 'copy',
  };
  const args: ProposeArgs = {
    deckId: snapshot.deck.id,
    ownerAccessKey: OWNER_ACCESS_KEY,
    instruction: 'Replace "Before" with "CANDIDATE_ONLY".',
    baseDeckVersion: snapshot.deck.version,
    baseSlideVersions: { [slide.id]: slide.version },
    baseElementVersions: { [target.id]: target.version },
    scope,
    providerMode: 'openrouter_free',
    providerConsent: NODESLIDE_OPENROUTER_EDIT_CONSENT,
  };
  return { snapshot, workspace, target, args };
}

function providerSuccess(target: { id: string; slideId: string }) {
  providerMock.mockResolvedValue({
    ok: true,
    value: {
      summary: 'PROVIDER_PROSE_MUST_NOT_PERSIST_IN_COMPARISON',
      operations: [
        {
          op: 'replace_text',
          slideId: target.slideId,
          elementId: target.id,
          text: 'BASELINE_ONLY',
        },
      ],
    },
    telemetry: {
      provider: TEST_PROVIDER,
      model: TEST_MODEL,
      reasoningEffort: 'high',
      costMicroUsd: 0,
      inputTokens: 100,
      outputTokens: 20,
    },
  });
}

function harness(workspace: NodeSlideWorkspace) {
  const baselineResponse = {
    marker: 'BASELINE_RESPONSE',
    patch: { id: 'persisted-baseline', status: 'ready' as const },
  };
  const calls: Record<string, unknown>[] = [];
  const runMutation = vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
    if ('idempotencyKey' in args) {
      return {
        created: true,
        run: { id: 'agent-run-test', status: 'queued' },
      };
    }
    if ('runId' in args && 'status' in args) return args.runId;
    calls.push(args);
    if ('operations' in args) return baselineResponse;
    return true;
  });
  return {
    context: {
      runQuery: vi.fn(async () => workspace),
      runMutation,
    },
    baselineResponse,
    calls,
  };
}

describe('NodeSlide same-turn edit shadow comparison isolation', () => {
  it('requires separate exact consent before any web research or deck read', async () => {
    const { args } = fixture();
    const context = { runQuery: vi.fn(), runMutation: vi.fn() };
    await expect(proposeHandler(context, { ...args, webResearch: true })).rejects.toMatchObject({
      data: { code: 'invalid_request' },
    });
    expect(context.runQuery).not.toHaveBeenCalled();
    expect(context.runMutation).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    process.env[GLOBAL_FLAG] = 'true';
    process.env[SHADOW_FLAG] = 'true';
    providerMock.mockReset();
  });

  afterEach(() => {
    if (originalGlobalFlag === undefined) delete process.env[GLOBAL_FLAG];
    else process.env[GLOBAL_FLAG] = originalGlobalFlag;
    if (originalShadowFlag === undefined) delete process.env[SHADOW_FLAG];
    else process.env[SHADOW_FLAG] = originalShadowFlag;
  });

  it('returns only the baseline and hands one opaque same-snapshot pair to atomic scheduling', async () => {
    const { snapshot, workspace, target, args } = fixture();
    providerSuccess(target);
    const test = harness(workspace);

    const result = await proposeHandler(test.context, args);

    expect(result).toBe(test.baselineResponse);
    expect(test.calls).toHaveLength(2);
    const proposalArgs = test.calls.find((call) => 'operations' in call);
    expect(proposalArgs).toBeDefined();
    const comparison = proposalArgs?.shadowComparison as NodeSlideShadowComparison;
    expect(proposalArgs?.planningInputDigest).toBe(comparison.turnInputDigest);
    expect(proposalArgs?.planningSnapshotDigest).toBe(comparison.baseSnapshotDigest);
    expect(proposalArgs?.shadowComparisonRequested).toBe(true);
    expect(proposalArgs?.shadowControlsDigest).toBe(comparison.controlsDigest);
    expect(proposalArgs?.operations).toEqual([
      {
        op: 'replace_text',
        slideId: target.slideId,
        elementId: target.id,
        text: 'BASELINE_ONLY',
      },
    ]);
    expect(proposalArgs).toMatchObject({
      provider: TEST_PROVIDER,
      model: TEST_MODEL,
      costMicroUsd: 0,
      inputTokens: 100,
      outputTokens: 20,
    });
    expect(JSON.stringify(proposalArgs?.operations)).not.toContain('CANDIDATE_ONLY');

    expect(comparison.baseSnapshotDigest).toBe(nodeSlideSnapshotDigest(snapshot));
    expect(comparison.turnInputDigest).toBe(
      nodeSlideEditTurnInputDigest({
        deckId: args.deckId,
        instruction: args.instruction,
        baseDeckVersion: args.baseDeckVersion,
        baseSlideVersions: args.baseSlideVersions,
        baseElementVersions: args.baseElementVersions,
        scope: args.scope,
        designBehavior: 'preserve',
        referenceUse: 'context_only',
        providerMode: args.providerMode,
        providerModel: TEST_MODEL,
        providerEffort: 'high',
      }),
    );
    expect(comparison.baseline.outcome).toBe('proposed');
    expect(comparison.candidate.outcome).toBe('proposed');
    expect(comparison.baseline.proposalDigest).not.toBe(comparison.candidate.proposalDigest);
    expect(comparison.candidateExposed).toBe(false);
    expect(comparison.candidateCommitted).toBe(false);
    expect(comparison).not.toHaveProperty('ownerAccessKey');
    expect(JSON.stringify(comparison)).not.toContain('BASELINE_ONLY');
    expect(JSON.stringify(comparison)).not.toContain('CANDIDATE_ONLY');
    expect(JSON.stringify(comparison)).not.toContain('PROVIDER_PROSE_MUST_NOT_PERSIST');
  });

  it('persists the exact selected model in the proposal trace attribution', async () => {
    const { workspace, target, args } = fixture();
    args.providerModel = 'anthropic/claude-sonnet-5';
    providerMock.mockResolvedValue({
      ok: true,
      value: {
        summary: 'Provider copy',
        operations: [
          {
            op: 'replace_text',
            slideId: target.slideId,
            elementId: target.id,
            text: 'Claude-selected copy',
          },
        ],
      },
      telemetry: {
        provider: TEST_PROVIDER,
        model: args.providerModel,
        reasoningEffort: 'high',
        costMicroUsd: 2_400,
        inputTokens: 180,
        outputTokens: 44,
      },
    });
    const test = harness(workspace);

    await proposeHandler(test.context, args);

    expect(providerMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: args.providerModel }),
    );
    const proposalArgs = test.calls.find((call) => 'operations' in call);
    expect(proposalArgs).toMatchObject({
      provider: TEST_PROVIDER,
      model: args.providerModel,
      costMicroUsd: 2_400,
      inputTokens: 180,
      outputTokens: 44,
    });
    expect(proposalArgs?.traceSummary).toContain('OpenRouter Claude Sonnet 5 proposed');
    expect(proposalArgs?.toolCalls).toContain(
      'Called Claude Sonnet 5 through the maintained pi-ai OpenRouter provider after exact edit consent',
    );
  });

  it('leaves the baseline call and response unchanged when shadow flags are off', async () => {
    delete process.env[GLOBAL_FLAG];
    delete process.env[SHADOW_FLAG];
    const { workspace, target, args } = fixture();
    providerSuccess(target);
    const test = harness(workspace);

    const result = await proposeHandler(test.context, args);

    expect(result).toBe(test.baselineResponse);
    expect(test.calls).toHaveLength(2);
    const proposalArgs = test.calls.find((call) => 'operations' in call);
    expect(proposalArgs?.shadowComparisonRequested).toBe(false);
    expect(proposalArgs?.shadowControlsDigest).toBeUndefined();
    expect(proposalArgs?.planningInputDigest).toBeUndefined();
    expect(proposalArgs?.planningSnapshotDigest).toBeUndefined();
    expect(proposalArgs?.shadowComparison).toBeUndefined();
  });

  it('preserves deterministic-fallback persistence attribution after extraction', async () => {
    const { workspace, args } = fixture();
    const telemetry = {
      provider: TEST_PROVIDER,
      model: TEST_MODEL,
      reasoningEffort: 'high' as const,
      costMicroUsd: 0,
      inputTokens: 100,
      outputTokens: 20,
    };
    providerMock.mockResolvedValue({
      ok: false,
      reason: 'The GLM 5.2 route returned invalid JSON after one repair attempt.',
      telemetry,
    });
    const test = harness(workspace);

    await proposeHandler(test.context, args);

    const proposalArgs = test.calls.find((call) => 'operations' in call);
    expect(proposalArgs).toMatchObject({
      provider: telemetry.provider,
      model: `${TEST_MODEL} (deterministic fallback)`,
      costMicroUsd: telemetry.costMicroUsd,
      inputTokens: telemetry.inputTokens,
      outputTokens: telemetry.outputTokens,
      operations: [{ op: 'replace_text', text: 'CANDIDATE_ONLY' }],
    });
    expect(proposalArgs?.traceSummary).toContain(
      'The GLM 5.2 route returned invalid JSON after one repair attempt.',
    );
    expect(proposalArgs?.toolCalls).toContain('Used deterministic bounded edit fallback');
    expect(proposalArgs?.shadowComparison).toBeDefined();
  });

  it('binds the comparison to the baseline request clock while snapshot digest binds loaded state', async () => {
    const { snapshot, workspace, target, args } = fixture();
    args.baseDeckVersion = Math.max(0, snapshot.deck.version - 1);
    providerSuccess(target);
    const test = harness(workspace);

    await proposeHandler(test.context, args);

    const proposalArgs = test.calls.find((call) => 'operations' in call);
    const comparison = proposalArgs?.shadowComparison as NodeSlideShadowComparison;
    expect(comparison.baseDeckVersion).toBe(args.baseDeckVersion);
    expect(comparison.baseSnapshotDigest).toBe(nodeSlideSnapshotDigest(snapshot));
  });

  it('preserves linked-comment forwarding and records the candidate as unsupported scope', async () => {
    const { workspace, target, args } = fixture();
    const commentId = 'comment-open';
    workspace.comments.push({
      id: commentId,
      deckId: workspace.deck.id,
      anchor: { type: 'deck', deckId: workspace.deck.id },
      authorId: 'reviewer',
      authorName: 'Reviewer',
      text: 'Please update this copy.',
      status: 'open',
      createdAt: NOW,
      updatedAt: NOW,
    });
    args.scope = {
      kind: 'comment',
      deckId: workspace.deck.id,
      slideIds: [target.slideId],
      elementIds: [target.id],
      commentId,
      operationMode: 'copy',
    };
    providerSuccess(target);
    const test = harness(workspace);

    await proposeHandler(test.context, args);

    const proposalArgs = test.calls.find((call) => 'operations' in call);
    const comparison = proposalArgs?.shadowComparison as NodeSlideShadowComparison;
    expect(proposalArgs?.linkedCommentId).toBe(commentId);
    expect(comparison.candidate).toMatchObject({
      outcome: 'skipped',
      terminalReason: 'skipped_unsupported_scope',
      operationCount: 0,
    });
  });

  it('does not run or persist a candidate when baseline planning fails', async () => {
    const { workspace, args } = fixture();
    args.scope.operationMode = 'unrestricted';
    args.instruction = 'Improve it somehow.';
    providerMock.mockResolvedValue({ ok: false, reason: 'The GLM 5.2 route was unavailable.' });
    const test = harness(workspace);

    await expect(proposeHandler(test.context, args)).rejects.toMatchObject({
      data: { code: 'fallback_unavailable' },
    });
    expect(test.calls).toHaveLength(1);
    expect(test.calls.some((call) => 'operations' in call)).toBe(false);
  });
});
