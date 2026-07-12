import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  type DeckComment,
  type DeckPatch,
  type DeckSnapshot,
  NODESLIDE_OPENROUTER_REVIEW_CONSENT,
  NODESLIDE_OPENROUTER_VARIATIONS_CONSENT,
  NODESLIDE_TOOLCHAIN_VERSION,
  type NodeSlideWorkspace,
} from '../../shared/nodeslide';
import {
  type AiAgentActivity,
  type AiComposerCommand,
  AiInspector,
  type AiReadReference,
  createAiProviderRequest,
  createAiVariationProviderRequest,
  createCommentScope,
} from '../../src/domains/nodeslide/inspector/AiInspector';
import { CommentsInspector } from '../../src/domains/nodeslide/inspector/CommentsInspector';
import { InspectorPanel } from '../../src/domains/nodeslide/inspector/InspectorPanel';
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

  it('defaults to private deterministic processing and uses operation-specific consent tokens', () => {
    const markup = renderAi();
    expect(markup).toContain('Private / deterministic');
    expect(markup).toMatch(/data-testid="ai-provider-deterministic"[^>]*checked=""/);
    expect(markup).toContain('OpenRouter free — external');
    expect(markup).toContain('may route it to a third-party model');
    expect(markup).toMatch(/<input type="checkbox"[^>]*disabled=""[^>]*ai-provider-consent/);

    expect(createAiProviderRequest('openrouter_free', false)).toBeNull();
    expect(createAiProviderRequest('openrouter_free', true)).toEqual({
      providerMode: 'openrouter_free',
      providerConsent: NODESLIDE_OPENROUTER_REVIEW_CONSENT,
    });
    expect(createAiVariationProviderRequest('openrouter_free', false)).toBeNull();
    expect(createAiVariationProviderRequest('openrouter_free', true)).toEqual({
      providerMode: 'openrouter_free',
      providerConsent: NODESLIDE_OPENROUTER_VARIATIONS_CONSENT,
    });
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
    expect(referenceMenu).toContain('Read context is separate from locked write scope');

    const commands: readonly AiComposerCommand<string>[] = [
      { id: '/edit', label: 'Edit the current scope' },
      { id: '/propagate', label: 'Propose propagation' },
    ];
    const commandMenu = renderAi({ commands, initialInstruction: '/' });
    expect(commandMenu).toContain('/variations');
    expect(commandMenu).toContain('/edit');
    expect(commandMenu).toContain('/propagate');
    expect(commandMenu.match(/<option value=/g)).toHaveLength(12);
    expect(commandMenu).toContain('Suggestions only prefill the composer');
  });

  it('shows preview, scope/base/ops evidence, and only candidate-specific validation receipts', () => {
    const snapshot = fixture();
    const patch = proposal(snapshot, true);
    const withReceipt = renderAi({ patches: [patch] });
    expect(withReceipt).toContain('Preview / Compare');
    expect(withReceipt).toContain('Write scope');
    expect(withReceipt).toContain(`Deck v${snapshot.deck.version}`);
    expect(withReceipt).toContain('1 ops');
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

  it('exposes slide and selection context chips and all six collapsed tabs', () => {
    const snapshot = fixture();
    const slide = requiredSlide(snapshot);
    const element = snapshot.elements.find((candidate) => candidate.slideId === slide.id);
    if (!element) throw new Error('Fixture needs a slide element.');
    const workspace = workspaceFixture(snapshot);

    const expanded = renderPanel(workspace, slide, false, [element]);
    expect(expanded).toContain(`Slide · ${slide.title}`);
    expect(expanded).toContain('Selection · 1');

    const collapsed = renderPanel(workspace, slide, true, []);
    for (const tab of ['AI', 'Design', 'Comments', 'Versions', 'Data', 'Trace']) {
      expect(collapsed).toContain(`aria-label="Open ${tab}"`);
    }
  });
});

interface RenderAiOptions {
  agentActivity?: AiAgentActivity;
  initialInstruction?: string;
  initialReadContext?: readonly AiReadReference[];
  references?: readonly AiReadReference[];
  commands?: readonly AiComposerCommand<string>[];
  patches?: readonly DeckPatch[];
}

function renderAi({
  agentActivity,
  initialInstruction = '',
  initialReadContext = [],
  references = [],
  commands = [],
  patches = [],
}: RenderAiOptions = {}) {
  const snapshot = fixture();
  const slide = requiredSlide(snapshot);
  return renderToStaticMarkup(
    <AiInspector<string>
      deck={snapshot.deck}
      slide={slide}
      selectedElements={[]}
      patches={patches}
      traces={[]}
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
      {...(agentActivity ? { agentActivity } : {})}
      onPropose={() => undefined}
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
