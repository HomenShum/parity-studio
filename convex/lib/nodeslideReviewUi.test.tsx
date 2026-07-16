import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  type AgentTrace,
  type DeckComment,
  type DeckPatch,
  type DeckSnapshot,
  NODESLIDE_AGENT_MODELS,
  NODESLIDE_OPENROUTER_REVIEW_CONSENT,
  NODESLIDE_OPENROUTER_VARIATIONS_CONSENT,
  NODESLIDE_TOOLCHAIN_VERSION,
  type NodeSlideAgentMessage,
  type NodeSlideAgentRun,
  type NodeSlideWorkspace,
} from '../../shared/nodeslide';
import {
  type AiAgentActivity,
  type AiCommentContext,
  type AiComposerCommand,
  AiInspector,
  type AiReadReference,
  createAiProviderRequest,
  createAiVariationProviderRequest,
  createCommentScope,
} from '../../src/domains/nodeslide/inspector/AiInspector';
import { CommentsInspector } from '../../src/domains/nodeslide/inspector/CommentsInspector';
import { InspectorPanel } from '../../src/domains/nodeslide/inspector/InspectorPanel';
import { projectNodeSlideAgentMessages } from '../../src/domains/nodeslide/inspector/NodeSlideAssistantThread';
import { NODESLIDE_EDIT_MODEL, NODESLIDE_EDIT_PROVIDER } from './nodeslideProvider';
import { buildGoldenNodeSlide } from './nodeslideSeed';

describe('NodeSlide AI review inspector', () => {
  it('uses prop-driven reading and drafting phases at the 900ms boundary', () => {
    const reading = renderAi({
      agentActivity: {
        status: 'running',
        elapsedMs: 899,
        ask: 'Make the decision clearer.',
      },
    });
    expect(reading).toContain('You asked');
    expect(reading).toContain('Make the decision clearer.');
    expect(reading).toContain('Reading context');
    expect(reading).not.toContain('Drafting proposal');

    const drafting = renderAi({
      agentActivity: {
        status: 'running',
        elapsedMs: 900,
        ask: 'Make the decision clearer.',
      },
    });
    expect(drafting).toContain('Drafting proposal');
  });

  it('renders honest timed-out and failed states without implying a change was applied', () => {
    for (const activity of [
      {
        status: 'timed_out',
        elapsedMs: 12_000,
        ask: 'Try a tighter hierarchy.',
        message: 'The provider did not return before the time limit.',
      },
      {
        status: 'failed',
        elapsedMs: 320,
        ask: 'Try a tighter hierarchy.',
        message: 'The proposal could not be validated.',
      },
    ] satisfies AiAgentActivity[]) {
      const markup = renderAi({ agentActivity: activity });
      expect(markup).toContain('role="alert"');
      expect(markup).toContain(activity.status === 'timed_out' ? 'Timed out' : 'Failed');
      expect(markup).toContain('No proposal was created or applied');
      expect(markup).toContain('Your deck remains unchanged');
    }
  });

  it('keeps a slow provider nonterminal until the backend actually finishes or times out', () => {
    const markup = renderAi({
      agentActivity: {
        status: 'delayed',
        elapsedMs: 20_000,
        ask: 'Try a tighter hierarchy.',
        message: 'The provider is still working.',
      },
    });

    expect(markup).toContain('Still working');
    expect(markup).toContain('The provider is still working.');
    expect(markup).toContain('No proposal has been created or applied yet.');
    expect(markup).not.toContain('has-failed');
    expect(markup).not.toContain('role="alert"');
  });

  it('renders user cancellation as a distinct non-error terminal state', () => {
    const markup = renderAi({
      agentActivity: {
        status: 'cancelled',
        elapsedMs: 420,
        ask: 'Stop this run.',
        message: 'Run cancelled. No deck changes were applied.',
      },
    });

    expect(markup).toContain('Cancelled');
    expect(markup).toContain('has-cancelled');
    expect(markup).toContain('Run cancelled. No deck changes were applied.');
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain('has-failed');
  });

  it('recommends the live GLM route with inline consent and keeps deterministic fallback available', () => {
    const markup = renderAi();
    expect(markup).toContain('External model: on · OpenRouter · GLM 5.2');
    expect(markup).toMatch(/data-testid="ai-provider-openrouter"[^>]*checked=""/);
    expect(markup).toContain('OpenRouter · Z.ai · GLM 5.2 — external');
    expect(markup).toContain('Allow GLM 5.2 via OpenRouter for this request');
    expect(markup).toContain('It does not browse or fetch URLs');
    expect(markup).toContain('data-testid="ai-model-select"');
    expect(markup).not.toMatch(/data-testid="ai-provider-controls"[^>]*open=/);
    expect(markup).toContain('Claude Sonnet 5');
    expect(markup).toContain('Claude Fable 5');
    expect(markup).toContain('Gemini 3.5 Flash');
    expect(markup).toContain('Gemini 3.1 Pro');
    expect(markup).toContain('GPT-5.6 Sol');
    expect(markup).toContain('GPT-5.6 Terra');
    expect(markup).toMatch(/<input type="checkbox"[^>]*ai-provider-consent/);
    expect(markup).not.toMatch(/<input type="checkbox"[^>]*disabled=""[^>]*ai-provider-consent/);

    expect(createAiProviderRequest('openrouter_free', false)).toBeNull();
    expect(createAiProviderRequest('openrouter_free', true)).toEqual({
      providerMode: 'openrouter_free',
      providerModel: 'z-ai/glm-5.2',
      providerConsent: NODESLIDE_OPENROUTER_REVIEW_CONSENT,
    });
    expect(createAiVariationProviderRequest('openrouter_free', false)).toBeNull();
    expect(createAiVariationProviderRequest('openrouter_free', true)).toEqual({
      providerMode: 'openrouter_free',
      providerModel: 'z-ai/glm-5.2',
      providerConsent: NODESLIDE_OPENROUTER_VARIATIONS_CONSENT,
    });
    expect(
      createAiProviderRequest('openrouter_free', true, 'anthropic/claude-sonnet-5'),
    ).toMatchObject({ providerModel: 'anthropic/claude-sonnet-5' });
  });

  it('keeps the idle AI surface conversational while preserving advanced controls', () => {
    const markup = renderAi();

    expect(markup).toContain('What should we change?');
    expect(markup).toContain('3 directions');
    expect(markup).not.toContain('Current agent scope and policy');
    expect(markup).toContain('Active AI context');
    expect(markup).toContain('Whole slide');
    expect(markup).toContain('aria-label="Agent settings"');
    expect(markup).not.toMatch(/data-testid="ai-provider-controls"[^>]*open=/);
    expect(markup).toContain('data-testid="ai-provider-route-status"');
    expect(markup).not.toContain('ns-ai-v3-route-disclosure');
    expect(markup).not.toContain('data-testid="variation-section"');
    expect(markup).not.toContain('No proposal waiting');
  });

  it('shows a bounded CSV, JSON, or TXT attachment control only when uploads are available', () => {
    expect(renderAi()).not.toContain('data-testid="ai-attach-data"');
    const markup = renderAi({
      onAttachDataFile: async (file) => ({
        id: `source-${file.name}`,
        kind: 'source',
        label: `Source: ${file.name}`,
      }),
    });
    expect(markup).toContain('data-testid="ai-attach-data"');
    expect(markup).toContain('accept=".csv,.json,.txt,text/csv,application/json,text/plain"');
    expect(markup).toContain('aria-label="Attach data file"');
  });

  it('derives bounded write targets from every comment anchor type', () => {
    const snapshot = fixture();
    const slide = requiredSlide(snapshot);
    const slideElements = snapshot.elements.filter((element) => element.slideId === slide.id);
    const anchorElement = slideElements[0];
    if (!anchorElement) throw new Error('Fixture needs an anchor element.');
    const context = (anchor: DeckComment['anchor']) => ({
      id: 'comment-scope',
      kind: 'comment' as const,
      label: 'Scoped comment',
      text: 'Make this clearer.',
      anchor,
    });

    expect(
      createCommentScope(
        context({ type: 'slide', deckId: snapshot.deck.id, slideId: slide.id }),
        'copy',
        snapshot.deck,
        snapshot.elements,
      ),
    ).toMatchObject({
      slideIds: [slide.id],
      elementIds: slideElements.map((element) => element.id),
    });
    expect(
      createCommentScope(
        context({
          type: 'element',
          deckId: snapshot.deck.id,
          slideId: slide.id,
          elementId: anchorElement.id,
        }),
        'copy',
        snapshot.deck,
        snapshot.elements,
      ),
    ).toMatchObject({ slideIds: [slide.id], elementIds: [anchorElement.id] });
    expect(
      createCommentScope(
        context({
          type: 'bounding_box',
          deckId: snapshot.deck.id,
          slideId: slide.id,
          bbox: anchorElement.bbox,
        }),
        'copy',
        snapshot.deck,
        snapshot.elements,
      ),
    ).toMatchObject({ elementIds: expect.arrayContaining([anchorElement.id]) });
    expect(
      createCommentScope(
        context({ type: 'deck', deckId: snapshot.deck.id }),
        'copy',
        snapshot.deck,
        snapshot.elements,
      ),
    ).toMatchObject({
      slideIds: snapshot.deck.slideOrder,
      elementIds: snapshot.elements.map((element) => element.id),
    });
  });

  it('renders supplied @ references, typed / commands, visible tokens, and policy selectors', () => {
    const reference: AiReadReference = {
      id: 'source-quarterly',
      kind: 'source',
      label: 'Quarterly source',
    };
    const referenceMenu = renderAi({
      initialInstruction: '@',
      initialReadContext: [reference],
      references: [reference],
    });
    expect(referenceMenu).toContain('role="menu"');
    expect(referenceMenu).toContain('Quarterly source');
    expect(referenceMenu).toContain('@Quarterly source');
    expect(referenceMenu).toContain('Review before apply');

    const commands: readonly AiComposerCommand<string>[] = [
      { id: '/edit', label: 'Edit the current scope' },
      { id: '/propagate', label: 'Propose propagation' },
    ];
    const commandMenu = renderAi({ commands, initialInstruction: '/' });
    expect(commandMenu).toContain('/variations');
    expect(commandMenu).toContain('/edit');
    expect(commandMenu).toContain('/propagate');
    expect(commandMenu.match(/<option value=/g)).toHaveLength(13 + NODESLIDE_AGENT_MODELS.length);
    expect(commandMenu).toContain('aria-label="Agent settings"');
  });

  it('keeps comment-to-AI context implicit when no @ reference was selected', () => {
    const snapshot = fixture();
    const comment = commentFixture(snapshot)[0];
    if (!comment) throw new Error('Fixture needs an open comment.');
    const commentContext: AiCommentContext = {
      id: comment.id,
      kind: 'comment',
      label: `Comment by ${comment.authorName}`,
      text: comment.text,
      anchor: comment.anchor,
    };

    const markup = renderAi({ commentContext });

    expect(markup).toContain('Review before apply');
    expect(markup).toContain(`@${commentContext.label}`);
    expect(markup).not.toContain('1 explicit reference');
  });

  it('shows preview, scope/base/ops evidence, and only candidate-specific validation receipts', () => {
    const snapshot = fixture();
    const patch = proposal(snapshot, true);
    const withReceipt = renderAi({ patches: [patch], traces: [proposalTrace(patch)] });
    expect(withReceipt).toContain('Preview / Compare');
    expect(withReceipt).toContain('Write scope');
    expect(withReceipt).toContain(`Deck v${snapshot.deck.version}`);
    expect(withReceipt).toContain('1 ops');
    expect(withReceipt).toContain('Provider · model');
    expect(withReceipt).toContain(`${NODESLIDE_EDIT_PROVIDER} · ${NODESLIDE_EDIT_MODEL}`);
    expect(withReceipt).toContain('Candidate validation passed');
    expect(withReceipt).toContain('Receipt candidate-validation');
    expect(withReceipt).toContain('data-testid="proposal-accept"');
    expect(withReceipt).toContain('data-testid="proposal-reject"');

    const withoutReceipt = renderAi({ patches: [proposal(snapshot, false)] });
    expect(withoutReceipt).not.toContain('Candidate validation');
  });

  it('renders durable conversation with assistant-ui messages and collapses tool activity', () => {
    const run: NodeSlideAgentRun = {
      id: 'run-review',
      deckId: fixture().deck.id,
      idempotencyKey: 'fixed-run-review',
      instruction: 'Make the title decisive.',
      status: 'completed',
      provider: NODESLIDE_EDIT_PROVIDER,
      model: NODESLIDE_EDIT_MODEL,
      webResearch: false,
      attempt: 1,
      createdAt: 1_000,
      updatedAt: 1_100,
      completedAt: 1_100,
    };
    const messages: NodeSlideAgentMessage[] = [
      {
        id: 'm1',
        deckId: run.deckId,
        runId: run.id,
        role: 'user',
        content: run.instruction,
        createdAt: 1_000,
      },
      {
        id: 'm2',
        deckId: run.deckId,
        runId: run.id,
        role: 'tool',
        toolName: 'validate_patch',
        content: 'Candidate passed.',
        createdAt: 1_050,
      },
      {
        id: 'm3',
        deckId: run.deckId,
        runId: run.id,
        role: 'assistant',
        content: 'The change is ready.',
        createdAt: 1_100,
      },
    ];

    const markup = renderAi({ agentRuns: [run], agentMessages: messages });
    expect(markup.match(/data-testid="agent-message-user"/g)).toHaveLength(1);
    expect(markup.match(/data-testid="agent-message-assistant"/g)).toHaveLength(1);
    expect(markup.match(/data-testid="agent-message-tool"/g)).toHaveLength(1);
    expect(markup).toContain('1 step');
    expect(markup).toContain('Validate patch');
    expect(markup).toContain(NODESLIDE_EDIT_MODEL);
  });

  it('keeps the U04 50-message conversation usable and offers bounded earlier history', () => {
    const run: NodeSlideAgentRun = {
      id: 'run-u04',
      deckId: fixture().deck.id,
      idempotencyKey: 'fixed-u04',
      instruction: 'Make this slide more persuasive without changing any numbers.',
      status: 'completed',
      provider: NODESLIDE_EDIT_PROVIDER,
      model: NODESLIDE_EDIT_MODEL,
      webResearch: false,
      attempt: 1,
      createdAt: 1_000,
      updatedAt: 61_000,
      completedAt: 61_000,
    };
    const messages: NodeSlideAgentMessage[] = Array.from({ length: 55 }, (_, index) => ({
      id: `u04-${index}`,
      deckId: run.deckId,
      runId: run.id,
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content:
        index % 2 === 0
          ? 'Make this slide more persuasive without changing any numbers.'
          : 'The scoped candidate preserves every number and is ready for review.',
      createdAt: 1_000 + index * 1_000,
    }));

    const markup = renderAi({ agentRuns: [run], agentMessages: messages });
    expect(markup).toContain('Show 5 earlier messages');
    expect(markup).toContain('5 hidden');
    expect(markup.match(/data-testid="agent-message-(?:user|assistant)"/g)).toHaveLength(50);
  });

  it('groups U07 tool flooding and exposes only persisted planner/executor branches', () => {
    const run: NodeSlideAgentRun = {
      id: 'run-a03',
      deckId: fixture().deck.id,
      idempotencyKey: 'fixed-a03-f17-f18',
      instruction: 'Continue until the deck is presentation-ready.',
      status: 'completed',
      provider: NODESLIDE_EDIT_PROVIDER,
      model: NODESLIDE_EDIT_MODEL,
      webResearch: true,
      attempt: 1,
      createdAt: 1_000,
      updatedAt: 22_000,
      completedAt: 22_000,
    };
    const messages: NodeSlideAgentMessage[] = [
      {
        id: 'a03-user',
        deckId: run.deckId,
        runId: run.id,
        role: 'user',
        content: run.instruction,
        createdAt: 1_000,
      },
      {
        id: 'a03-plan',
        deckId: run.deckId,
        runId: run.id,
        role: 'assistant',
        agentRole: 'planner',
        content: 'I split the readiness pass into independent narrative and evidence branches.',
        createdAt: 2_000,
      },
      {
        id: 'a03-read-narrative',
        deckId: run.deckId,
        runId: run.id,
        role: 'tool',
        toolName: 'read_context',
        agentRole: 'executor',
        branchId: 'narrative',
        branchLabel: 'Narrative',
        parallelGroupId: 'readiness-wave-1',
        content: 'Read slides 1–4 at deck version 7.',
        createdAt: 3_000,
      },
      {
        id: 'a03-read-evidence',
        deckId: run.deckId,
        runId: run.id,
        role: 'tool',
        toolName: 'web_research',
        agentRole: 'researcher',
        branchId: 'evidence',
        branchLabel: 'Evidence',
        parallelGroupId: 'readiness-wave-1',
        content: 'Captured two authorized source snapshots.',
        createdAt: 3_010,
      },
      {
        id: 'a03-patch-narrative',
        deckId: run.deckId,
        runId: run.id,
        role: 'tool',
        toolName: 'patch_proposal',
        agentRole: 'executor',
        branchId: 'narrative',
        branchLabel: 'Narrative',
        parallelGroupId: 'readiness-wave-1',
        content: 'Prepared a CAS-bound narrative patch.',
        createdAt: 6_000,
      },
      {
        id: 'a03-validate-evidence',
        deckId: run.deckId,
        runId: run.id,
        role: 'tool',
        toolName: 'candidate_validation',
        agentRole: 'validator',
        branchId: 'evidence',
        branchLabel: 'Evidence',
        parallelGroupId: 'readiness-wave-1',
        content: 'Validated the independent evidence update.',
        createdAt: 7_000,
      },
      {
        id: 'a03-final',
        deckId: run.deckId,
        runId: run.id,
        role: 'assistant',
        agentRole: 'executor',
        content: 'Both independent branches converged and the deck is ready for review.',
        createdAt: 22_000,
      },
    ];

    const projected = projectNodeSlideAgentMessages(messages);
    expect(projected).toHaveLength(4);
    expect(projected[2]?.toolActivities).toHaveLength(4);

    const markup = renderAi({ agentRuns: [run], agentMessages: messages });
    expect(markup.match(/data-testid="agent-message-tool"/g)).toHaveLength(1);
    expect(markup).toContain('Parallel agent activity');
    expect(markup).toContain('4 steps · 2 branches');
    expect(markup).toContain('4 steps');
    expect(markup).toContain('2 parallel branches');
    expect(markup).toContain('Planner');
    expect(markup).toContain('Executor');
    expect(markup).toContain('Narrative');
    expect(markup).toContain('Evidence');
  });

  it('uses one action set for a compact multi-proposal review queue', () => {
    const snapshot = fixture();
    const first = proposal(snapshot, true);
    const second = {
      ...proposal(snapshot, false),
      id: 'patch-second',
      summary: 'Tighten the subtitle',
      createdAt: 1_100,
    };
    const markup = renderAi({ patches: [first, second] });

    expect(markup).toContain('2 changes ready');
    expect(markup).toContain('Changes ready for review');
    expect(markup.match(/data-testid="proposal-card"/g)).toHaveLength(1);
    expect(markup.match(/data-testid="proposal-accept"/g)).toHaveLength(1);
  });

  it('lets terminal truth override a stale active run label and cancel action', () => {
    const run: NodeSlideAgentRun = {
      id: 'run-stale',
      deckId: fixture().deck.id,
      idempotencyKey: 'fixed-stale',
      instruction: 'Try a tighter hierarchy.',
      status: 'planning',
      provider: 'test',
      model: 'test',
      webResearch: false,
      attempt: 1,
      createdAt: 1_000,
      updatedAt: 1_010,
    };
    const markup = renderAi({
      agentRuns: [run],
      agentActivity: {
        status: 'failed',
        elapsedMs: 200,
        ask: run.instruction,
        message: 'Validation failed.',
      },
    });
    expect(markup).toContain('Failed');
    expect(markup).not.toContain('Planning edit');
    expect(markup).not.toContain('data-testid="ai-cancel-run"');
  });
});

describe('NodeSlide comment and inspector routing surfaces', () => {
  it('offers Send to AI for each open root comment without resolving it', () => {
    const snapshot = fixture();
    const slide = requiredSlide(snapshot);
    const comments = commentFixture(snapshot);
    const markup = renderToStaticMarkup(
      <CommentsInspector
        deckId={snapshot.deck.id}
        slide={slide}
        selectedElements={[]}
        comments={comments}
        onAddComment={() => undefined}
        onReply={() => undefined}
        onSetStatus={() => undefined}
        onSendToAi={() => undefined}
      />,
    );

    expect(markup).toContain('Open review request');
    expect(markup).toContain('Send to AI');
    expect(markup).not.toContain('Resolved review request');
  });

  it('exposes slide and selection context chips and all six collapsed tabs', () => {
    const snapshot = fixture();
    const slide = requiredSlide(snapshot);
    const element = snapshot.elements.find((candidate) => candidate.slideId === slide.id);
    if (!element) throw new Error('Fixture needs a slide element.');
    const workspace = workspaceFixture(snapshot);

    const expanded = renderPanel(workspace, slide, false, [element]);
    expect(expanded).toContain(`Slide · ${slide.title}`);
    expect(expanded).toContain('Selection · 1');
    expect(expanded).toMatch(/data-testid="inspector-tab-ai"[^>]*tabindex="0"/);
    for (const tab of ['design', 'comments', 'versions', 'data', 'trace']) {
      expect(expanded).toMatch(new RegExp(`data-testid="inspector-tab-${tab}"[^>]*tabindex="-1"`));
    }
    expect(expanded).toContain('aria-label="Resize inspector"');
    expect(expanded).toContain('Drag or use Left and Right arrow keys to resize inspector');

    const collapsed = renderPanel(workspace, slide, true, []);
    for (const tab of ['AI', 'Design', 'Comments', 'Versions', 'Data', 'Trace']) {
      expect(collapsed).toContain(`aria-label="Open ${tab}"`);
    }
  });
});

interface RenderAiOptions {
  agentActivity?: AiAgentActivity;
  commentContext?: AiCommentContext;
  initialInstruction?: string;
  initialReadContext?: readonly AiReadReference[];
  references?: readonly AiReadReference[];
  commands?: readonly AiComposerCommand<string>[];
  patches?: readonly DeckPatch[];
  traces?: readonly AgentTrace[];
  agentRuns?: readonly NodeSlideAgentRun[];
  agentMessages?: readonly NodeSlideAgentMessage[];
  onAttachDataFile?: (file: File) => Promise<AiReadReference>;
}

function renderAi({
  agentActivity,
  commentContext,
  initialInstruction = '',
  initialReadContext = [],
  references = [],
  commands = [],
  patches = [],
  traces = [],
  agentRuns = [],
  agentMessages = [],
  onAttachDataFile,
}: RenderAiOptions = {}) {
  const snapshot = fixture();
  const slide = requiredSlide(snapshot);
  return renderToStaticMarkup(
    <AiInspector<string>
      deck={snapshot.deck}
      slide={slide}
      selectedElements={[]}
      patches={patches}
      traces={traces}
      agentRuns={agentRuns}
      agentMessages={agentMessages}
      variations={[]}
      variationsLoading={false}
      isSubmitting={false}
      variationBusy={false}
      variationGenerating={false}
      variationError={null}
      previewedVariationId={null}
      references={references}
      commands={commands}
      initialInstruction={initialInstruction}
      initialReadContext={initialReadContext}
      {...(commentContext ? { commentContext } : {})}
      {...(agentActivity ? { agentActivity } : {})}
      onPropose={() => undefined}
      onProposeVisualMaterial={async () => undefined}
      {...(onAttachDataFile ? { onAttachDataFile } : {})}
      onAccept={() => undefined}
      onReject={() => undefined}
      onPreviewPatch={() => undefined}
      onGenerateVariations={() => undefined}
      onPreviewVariation={() => undefined}
      onAcceptVariation={() => undefined}
      onRejectVariation={() => undefined}
    />,
  );
}

function fixture(): DeckSnapshot {
  return buildGoldenNodeSlide('review-inspector-test', 1_000).snapshot;
}

function requiredSlide(snapshot: DeckSnapshot) {
  const slide = snapshot.slides[0];
  if (!slide) throw new Error('Missing slide fixture.');
  return slide;
}

function proposal(snapshot: DeckSnapshot, withReceipt: boolean): DeckPatch {
  const slide = requiredSlide(snapshot);
  const patchId = withReceipt ? 'patch-with-receipt' : 'patch-without-receipt';
  return {
    id: patchId,
    deckId: snapshot.deck.id,
    baseDeckVersion: snapshot.deck.version,
    baseSlideVersions: { [slide.id]: slide.version },
    baseElementVersions: {},
    scope: {
      kind: 'slide',
      deckId: snapshot.deck.id,
      slideIds: [slide.id],
      operationMode: 'unrestricted',
    },
    operations: [
      {
        op: 'update_slide',
        slideId: slide.id,
        properties: { title: 'Sharper review title' },
      },
    ],
    source: 'agent',
    traceId: 'trace-proposal',
    status: 'ready',
    summary: 'Sharpen the review title',
    ...(withReceipt
      ? {
          candidateDigest: 'candidate-digest',
          candidateValidation: {
            id: 'candidate-validation',
            patchId,
            candidateDigest: 'candidate-digest',
            deckId: snapshot.deck.id,
            deckVersion: snapshot.deck.version,
            ok: true,
            publishOk: true,
            cleanOk: true,
            issues: [],
            checkedAt: 1_100,
            toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
          },
        }
      : {}),
    createdAt: 1_000,
    updatedAt: 1_000,
  };
}

function proposalTrace(patch: DeckPatch): AgentTrace {
  return {
    id: patch.traceId ?? 'trace-proposal',
    deckId: patch.deckId,
    patchId: patch.id,
    status: 'awaiting_review',
    summary: patch.summary,
    plan: ['Draft bounded operations'],
    context: [],
    toolCalls: ['Called GLM 5.2 through pi-ai'],
    guardrails: ['Explicit scope only'],
    provider: NODESLIDE_EDIT_PROVIDER,
    model: NODESLIDE_EDIT_MODEL,
    costMicroUsd: 1_250,
    inputTokens: 120,
    outputTokens: 30,
    createdAt: patch.createdAt,
  };
}

function commentFixture(snapshot: DeckSnapshot): DeckComment[] {
  const slide = requiredSlide(snapshot);
  return [
    {
      id: 'comment-open',
      deckId: snapshot.deck.id,
      anchor: { type: 'slide', deckId: snapshot.deck.id, slideId: slide.id },
      authorId: 'reviewer-open',
      authorName: 'Open Reviewer',
      text: 'Open review request',
      status: 'open',
      createdAt: 900,
      updatedAt: 950,
    },
    {
      id: 'comment-resolved',
      deckId: snapshot.deck.id,
      anchor: { type: 'slide', deckId: snapshot.deck.id, slideId: slide.id },
      authorId: 'reviewer-resolved',
      authorName: 'Resolved Reviewer',
      text: 'Resolved review request',
      status: 'resolved',
      createdAt: 800,
      updatedAt: 850,
    },
  ];
}

function workspaceFixture(snapshot: DeckSnapshot): NodeSlideWorkspace {
  return {
    ...snapshot,
    comments: commentFixture(snapshot),
    patches: [],
    versions: [],
    traces: [],
    validations: [],
    exports: [],
    presence: [],
    publication: null,
  };
}

function renderPanel(
  workspace: NodeSlideWorkspace,
  slide: DeckSnapshot['slides'][number],
  collapsed: boolean,
  selectedElements: DeckSnapshot['elements'],
) {
  return renderToStaticMarkup(
    <InspectorPanel
      workspace={workspace}
      slide={slide}
      selectedElements={selectedElements}
      activeTab="ai"
      collapsed={collapsed}
      width={360}
      agentBusy={false}
      variations={[]}
      variationsLoading={false}
      variationBusy={false}
      variationGenerating={false}
      variationError={null}
      previewedVariationId={null}
      activeTastePackId={null}
      tastePackBusy={false}
      onTabChange={() => undefined}
      onToggleCollapsed={() => undefined}
      onWidthChange={() => undefined}
      onProposeEdit={() => undefined}
      onAcceptPatch={() => undefined}
      onRejectPatch={() => undefined}
      onGenerateVariations={() => undefined}
      onPreviewVariation={() => undefined}
      onAcceptVariation={() => undefined}
      onRejectVariation={() => undefined}
      onApplyTastePack={() => undefined}
      onClearTastePack={() => undefined}
      onApplyDesignPatch={() => undefined}
      onAddComment={() => undefined}
      onReply={() => undefined}
      onSetCommentStatus={() => undefined}
      onRestoreVersion={() => undefined}
    />,
  );
}
