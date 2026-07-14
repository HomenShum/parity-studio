import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  type AgentTrace,
  type DeckComment,
  type DeckPatch,
  type DeckSnapshot,
  NODESLIDE_AGENT_MODELS,
  NODESLIDE_DEFAULT_AGENT_MODEL,
  NODESLIDE_NEBIUS_REVIEW_CONSENT,
  NODESLIDE_NEBIUS_VARIATIONS_CONSENT,
  NODESLIDE_OPENROUTER_REVIEW_CONSENT,
  NODESLIDE_OPENROUTER_VARIATIONS_CONSENT,
  NODESLIDE_TOOLCHAIN_VERSION,
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

  it('recommends the live Nebius GLM route with provider-native effort controls', () => {
    const markup = renderAi();
    expect(markup).toContain('External model: on · Nebius · GLM 5.2');
    expect(markup).toMatch(/data-testid="ai-provider-external"[^>]*checked=""/);
    expect(markup).toContain('Nebius · Z.ai · GLM 5.2 — external');
    expect(markup).toContain('Allow one Nebius request / GLM 5.2 / High');
    expect(markup).toContain('It does not browse or fetch URLs');
    expect(markup).toContain('data-testid="ai-model-select"');
    expect(markup).toContain('data-testid="ai-effort-select"');
    expect(markup).toContain('<option value="low">Light</option>');
    expect(markup).toContain('<option value="medium">Medium</option>');
    expect(markup).toContain('<option value="high" selected="">High</option>');
    expect(markup).not.toContain('<option value="xhigh">Extra High</option>');
    expect(markup).not.toContain('<option value="max">Ultra</option>');
    expect(markup).not.toMatch(/data-testid="ai-provider-controls"[^>]*open=/);
    expect(markup).toContain('Claude Sonnet 5 · Anthropic');
    expect(markup).toContain('Claude Fable 5 · Anthropic');
    expect(markup).toContain('Gemini 3.5 Flash · Google');
    expect(markup).toContain('Gemini 3.1 Pro · Google');
    expect(markup).toContain('GPT-5.6 Sol · OpenAI');
    expect(markup).toContain('GPT-5.6 Terra · OpenAI');
    expect(markup).toMatch(/<input type="checkbox"[^>]*ai-provider-consent/);
    expect(markup).not.toMatch(/<input type="checkbox"[^>]*disabled=""[^>]*ai-provider-consent/);

    expect(createAiProviderRequest('nebius', false)).toBeNull();
    expect(createAiProviderRequest('nebius', true)).toEqual({
      providerMode: 'nebius',
      providerModel: NODESLIDE_DEFAULT_AGENT_MODEL,
      providerEffort: 'high',
      providerConsent: NODESLIDE_NEBIUS_REVIEW_CONSENT,
    });
    expect(createAiVariationProviderRequest('nebius', false)).toBeNull();
    expect(createAiVariationProviderRequest('nebius', true)).toEqual({
      providerMode: 'nebius',
      providerModel: NODESLIDE_DEFAULT_AGENT_MODEL,
      providerEffort: 'high',
      providerConsent: NODESLIDE_NEBIUS_VARIATIONS_CONSENT,
    });
    expect(createAiProviderRequest('openrouter_free', true, 'z-ai/glm-5.2')).toMatchObject({
      providerMode: 'openrouter_free',
      providerModel: 'z-ai/glm-5.2',
      providerConsent: NODESLIDE_OPENROUTER_REVIEW_CONSENT,
    });
    expect(createAiVariationProviderRequest('openrouter_free', true, 'z-ai/glm-5.2')).toMatchObject(
      { providerConsent: NODESLIDE_OPENROUTER_VARIATIONS_CONSENT },
    );
    expect(
      createAiProviderRequest('openrouter_free', true, 'anthropic/claude-sonnet-5'),
    ).toMatchObject({ providerModel: 'anthropic/claude-sonnet-5' });
  });

  it('shows extended effort levels only for models whose provider exposes them', () => {
    const markup = renderAi({
      initialProviderMode: 'openrouter_free',
      initialProviderModel: 'z-ai/glm-5.2',
    });

    expect(markup).toContain('<option value="xhigh">Extra High</option>');
    expect(markup).toContain('<option value="max">Ultra</option>');
  });

  it('keeps the idle AI surface conversational while preserving advanced controls', () => {
    const markup = renderAi();

    expect(markup).toContain('What should we change?');
    expect(markup).toContain('Generate 3 directions');
    expect(markup).toContain('Current agent scope and policy');
    expect(markup).toContain('Whole slide');
    expect(markup).toContain('Advanced controls');
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
    expect(referenceMenu).toContain('Read context · locked write scope');

    const commands: readonly AiComposerCommand<string>[] = [
      { id: '/edit', label: 'Edit the current scope' },
      { id: '/propagate', label: 'Propose propagation' },
    ];
    const commandMenu = renderAi({ commands, initialInstruction: '/' });
    expect(commandMenu).toContain('/variations');
    expect(commandMenu).toContain('/edit');
    expect(commandMenu).toContain('/propagate');
    expect(commandMenu.match(/<option value=/g)).toHaveLength(16 + NODESLIDE_AGENT_MODELS.length);
    expect(commandMenu).toContain('Advanced controls');
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

    expect(markup).toContain('Scoped context by default');
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

  it('exposes slide and selection context chips and all seven collapsed tabs', () => {
    const snapshot = fixture();
    const slide = requiredSlide(snapshot);
    const element = snapshot.elements.find((candidate) => candidate.slideId === slide.id);
    if (!element) throw new Error('Fixture needs a slide element.');
    const workspace = workspaceFixture(snapshot);

    const expanded = renderPanel(workspace, slide, false, [element]);
    expect(expanded).toContain(`Slide · ${slide.title}`);
    expect(expanded).toContain('Selection · 1');
    expect(expanded).toMatch(/data-testid="inspector-tab-ai"[^>]*tabindex="0"/);
    for (const tab of ['design', 'comments', 'versions', 'data', 'json', 'trace']) {
      expect(expanded).toMatch(new RegExp(`data-testid="inspector-tab-${tab}"[^>]*tabindex="-1"`));
    }
    expect(expanded).toContain('aria-label="Resize inspector"');
    expect(expanded).toContain('Drag or use Left and Right arrow keys to resize inspector');

    const collapsed = renderPanel(workspace, slide, true, []);
    for (const tab of ['AI', 'Design', 'Comments', 'Versions', 'Evidence', 'JSON', 'Trace']) {
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
  onAttachDataFile?: (file: File) => Promise<AiReadReference>;
  initialProviderMode?: 'deterministic' | 'openrouter_free' | 'nebius';
  initialProviderModel?: (typeof NODESLIDE_AGENT_MODELS)[number]['id'];
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
  onAttachDataFile,
  initialProviderMode,
  initialProviderModel,
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
      {...(initialProviderMode ? { initialProviderMode } : {})}
      {...(initialProviderModel ? { initialProviderModel } : {})}
      {...(commentContext ? { commentContext } : {})}
      {...(agentActivity ? { agentActivity } : {})}
      onPropose={() => undefined}
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
