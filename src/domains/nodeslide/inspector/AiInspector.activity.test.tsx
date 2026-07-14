// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import {
  type AgentTrace,
  type DeckPatch,
  type DeckSnapshot,
  NODESLIDE_NEBIUS_REVIEW_CONSENT,
  NODESLIDE_NEBIUS_VARIATIONS_CONSENT,
  NODESLIDE_TOOLCHAIN_VERSION,
  type NodeSlideAgentMessage,
} from '../../../../shared/nodeslide';
import {
  NODESLIDE_VARIATION_SCHEMA_VERSION,
  type SlideVariation,
} from '../../../../shared/nodeslideVariation';
import {
  clearNodeSlideComposerSession,
  nodeSlideComposerSessionKey,
} from '../composer/nodeSlideComposerSession';
import { AiInspector, type AiInspectorProps } from './AiInspector';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: () => undefined,
  });
  if (!globalThis.ResizeObserver) {
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  }
  if (!globalThis.PointerEvent) vi.stubGlobal('PointerEvent', MouseEvent);
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('NodeSlide persisted activity AI Elements adapter', () => {
  it('proposes against exactly the noncontiguous selected slides and labels the scope count', async () => {
    const snapshot = fixture('multi-slide-scope');
    const slide2 = snapshot.slides[1];
    const slide4 = snapshot.slides[3];
    if (!slide2 || !slide4) throw new Error('Fixture requires four slides.');
    const onPropose = vi.fn<AiInspectorProps<string>['onPropose']>();
    const user = userEvent.setup();
    renderInspector(snapshot, {
      initialProviderMode: 'deterministic',
      onPropose,
      selectedSlideIds: [slide2.id, slide4.id],
    });

    const scopeButton = screen.getByRole('button', { name: 'Selected slides (2)' });
    expect(scopeButton).toHaveAttribute('aria-pressed', 'false');
    await user.click(scopeButton);
    expect(scopeButton).toHaveAttribute('aria-pressed', 'true');
    await user.type(
      screen.getByRole('textbox', { name: 'AI instruction' }),
      'Align these two slides to the same decision narrative.',
    );
    await user.click(screen.getByTestId('ai-submit'));

    await waitFor(() => expect(onPropose).toHaveBeenCalledTimes(1));
    expect(onPropose.mock.calls[0]?.[1]).toEqual({
      kind: 'slide',
      deckId: snapshot.deck.id,
      slideIds: [slide2.id, slide4.id],
      operationMode: 'unrestricted',
    });
  });

  it('shows the exact multi-slide count on a reviewable proposal card', () => {
    const snapshot = fixture('multi-slide-proposal');
    const slide2 = snapshot.slides[1];
    const slide4 = snapshot.slides[3];
    if (!slide2 || !slide4) throw new Error('Fixture requires four slides.');
    const patch = proposal(snapshot);
    renderInspector(snapshot, {
      patches: [
        {
          ...patch,
          scope: {
            kind: 'slide',
            deckId: snapshot.deck.id,
            slideIds: [slide2.id, slide4.id],
            operationMode: 'unrestricted',
          },
        },
      ],
    });

    expect(screen.getByText('2 slides')).toBeVisible();
  });

  it('prioritizes review while keeping an obvious expandable follow-up composer', async () => {
    const snapshot = fixture('review-first-composer');
    const user = userEvent.setup();
    renderInspector(snapshot, { patches: [proposal(snapshot)] });

    const composer = screen.getByTestId('ai-composer');
    const instruction = screen.getByRole('textbox', { name: 'AI instruction' });
    expect(composer).toHaveAttribute('data-composer-mode', 'follow-up');
    expect(instruction).toHaveAttribute('rows', '1');
    expect(instruction).toHaveAttribute('placeholder', 'Ask a follow-up or request a revision...');
    expect(composer.closest('.ns-ai-v3-shell')).toHaveClass('is-awaiting-review');

    await user.click(instruction);

    await waitFor(() => expect(composer).toHaveAttribute('data-composer-mode', 'full'));
    expect(instruction).toHaveAttribute('rows', '9');
    expect(screen.getByTestId('ai-connect-agent')).toBeVisible();
  });

  it('fails closed before per-request provider consent and resets consent after submit', async () => {
    const snapshot = fixture('consent');
    const onPropose = vi.fn<AiInspectorProps<string>['onPropose']>();
    const onGenerateVariations = vi.fn<AiInspectorProps<string>['onGenerateVariations']>();
    const user = userEvent.setup();
    renderInspector(snapshot, { onGenerateVariations, onPropose });

    const consent = screen.getByTestId('ai-provider-consent');
    const submit = screen.getByTestId('ai-submit');
    const directions = screen.getByTestId('ai-generate-directions');
    const form = submit.closest('form');
    if (!form) throw new Error('Expected the AI composer form.');

    expect(consent).not.toBeChecked();
    expect(submit).toBeDisabled();
    expect(directions).toBeDisabled();
    fireEvent.submit(form);
    fireEvent.click(directions);
    expect(onPropose).not.toHaveBeenCalled();
    expect(onGenerateVariations).not.toHaveBeenCalled();

    await user.click(consent);
    await waitFor(() => expect(directions).toBeEnabled());
    await user.click(directions);

    await waitFor(() => expect(onGenerateVariations).toHaveBeenCalledTimes(1));
    expect(onGenerateVariations.mock.calls[0]?.[0]).toMatchObject({
      providerMode: 'nebius',
      providerConsent: NODESLIDE_NEBIUS_VARIATIONS_CONSENT,
    });
    await waitFor(() => expect(consent).not.toBeChecked());

    await user.type(
      screen.getByRole('textbox', { name: 'AI instruction' }),
      'Sharpen the executive takeaway.',
    );
    expect(submit).toBeDisabled();
    fireEvent.submit(form);
    expect(onPropose).not.toHaveBeenCalled();

    await user.click(consent);
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() => expect(onPropose).toHaveBeenCalledTimes(1));
    expect(onPropose.mock.calls[0]?.[2]).toMatchObject({
      providerMode: 'nebius',
      providerConsent: NODESLIDE_NEBIUS_REVIEW_CONSENT,
    });
    await waitFor(() => expect(consent).not.toBeChecked());

    await user.type(screen.getByRole('textbox', { name: 'AI instruction' }), 'Second request');
    expect(submit).toBeDisabled();
    fireEvent.submit(form);
    expect(onPropose).toHaveBeenCalledTimes(1);
  });

  it('keeps deterministic requests private without requiring or minting consent', async () => {
    const snapshot = fixture('deterministic');
    const onPropose = vi.fn<AiInspectorProps<string>['onPropose']>();
    const user = userEvent.setup();
    renderInspector(snapshot, {
      initialProviderMode: 'deterministic',
      onPropose,
    });

    await user.type(screen.getByRole('textbox', { name: 'AI instruction' }), 'Tighten the title.');

    expect(screen.queryByTestId('ai-provider-consent')).not.toBeInTheDocument();
    const submit = screen.getByTestId('ai-submit');
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(onPropose).toHaveBeenCalledTimes(1));
    expect(onPropose.mock.calls[0]?.[2]).toMatchObject({ providerMode: 'deterministic' });
    expect(onPropose.mock.calls[0]?.[2]).not.toHaveProperty('providerConsent');
  });

  it('keeps the review scroll position stable as activity arrives during proposal and direction review', () => {
    const snapshot = fixture('scroll');
    const firstMessage = message({ id: 'message-1', content: 'First persisted update.' });
    const props = inspectorProps(snapshot, {
      agentMessages: [firstMessage],
      patches: [proposal(snapshot)],
    });
    const view = render(
      <div className="nodeslide-studio">
        <AiInspector {...props} />
      </div>,
    );
    const reviewScroll = screen.getByTestId('ai-review-scroll');
    let scrollHeight = 900;
    Object.defineProperty(reviewScroll, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(reviewScroll, 'clientHeight', {
      configurable: true,
      value: 300,
    });
    reviewScroll.scrollTop = 215;

    scrollHeight = 1_200;
    view.rerender(
      <div className="nodeslide-studio">
        <AiInspector
          {...inspectorProps(snapshot, {
            agentMessages: [
              firstMessage,
              message({ id: 'message-2', content: 'A later persisted update.' }),
            ],
            variations: [direction(snapshot)],
          })}
        />
      </div>,
    );

    expect(reviewScroll.scrollTop).toBe(215);
    expect(reviewScroll.querySelector('[role="log"]')).toHaveAttribute('data-follow', 'false');
  });

  it('links only referenced source records with resolved titles and safe URLs', async () => {
    const snapshot = fixture('sources');
    const user = userEvent.setup();
    renderInspector(snapshot, {
      agentMessages: [
        message({
          id: 'message-sources',
          sourceIds: ['source-ok', 'source-missing', 'source-unsafe'],
          resolvedSources: [
            {
              id: 'source-ok',
              title: 'Official evidence',
              url: 'https://example.test/evidence',
            },
            { id: 'source-unsafe', title: 'Unsafe', url: 'javascript:alert(1)' },
            { id: 'source-orphan', title: 'Orphan', url: 'https://example.test/orphan' },
          ],
        }),
      ],
    });

    expect(screen.getByText('2 persisted source snapshots')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Unsafe' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Orphan' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Used 1 sources/i }));
    expect(screen.getByRole('link', { name: 'Official evidence' })).toHaveAttribute(
      'href',
      'https://example.test/evidence',
    );
  });

  it('shows Tool only for persisted pending/failure lifecycle and preserves unprojected tool copy', () => {
    const snapshot = fixture('tools');
    renderInspector(snapshot, {
      agentMessages: [
        message({
          id: 'message-pending',
          role: 'tool',
          content: 'Searching persisted references.',
          toolName: 'web_search',
          toolActivity: { state: 'input-available' },
        }),
        message({
          id: 'message-failed',
          role: 'tool',
          content: 'Validating the candidate.',
          toolName: 'candidate_validation',
          toolActivity: {
            state: 'output-error',
            errorText: 'Candidate validation rejected the persisted result.',
          },
        }),
        message({
          id: 'message-unprojected',
          role: 'tool',
          content: 'Retained two source snapshots.',
          toolName: 'source_snapshot',
        }),
      ],
    });

    expect(screen.getAllByTestId('agent-tool')).toHaveLength(2);
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getAllByTestId('agent-tool')[1]).toHaveAttribute(
      'data-tool-state',
      'output-error',
    );
    expect(screen.getByText('Candidate validation rejected the persisted result.')).toBeVisible();
    expect(screen.getByText('Retained two source snapshots.')).toBeVisible();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
  });

  it('keeps label-only plans neutral instead of inferring per-step Task state', () => {
    const snapshot = fixture('plan');
    const trace: AgentTrace = {
      id: 'trace-plan',
      deckId: snapshot.deck.id,
      status: 'planning',
      summary: 'Preparing a bounded proposal.',
      plan: ['Read scoped context', 'Draft operations', 'Validate candidate'],
      context: [],
      toolCalls: [],
      guardrails: [],
      createdAt: 1_000,
    };
    const { container } = renderInspector(snapshot, { traces: [trace] });

    expect(screen.getByText('Read scoped context')).toBeInTheDocument();
    expect(container.querySelector('.ns-plan-list .is-current')).toBeNull();
    expect(container.querySelector('.ns-plan-list .ns-spin')).toBeNull();
  });
});

function renderInspector(
  snapshot: DeckSnapshot,
  overrides: Partial<AiInspectorProps<string>> = {},
) {
  clearNodeSlideComposerSession(nodeSlideComposerSessionKey('editor', snapshot.deck.id));
  return render(
    <div className="nodeslide-studio">
      <AiInspector {...inspectorProps(snapshot, overrides)} />
    </div>,
  );
}

function inspectorProps(
  snapshot: DeckSnapshot,
  overrides: Partial<AiInspectorProps<string>> = {},
): AiInspectorProps<string> {
  const slide = snapshot.slides[0];
  if (!slide) throw new Error('Fixture requires a slide.');
  return {
    deck: snapshot.deck,
    slide,
    selectedElements: [],
    workspaceElements: snapshot.elements,
    patches: [],
    traces: [],
    agentRuns: [],
    agentMessages: [],
    variations: [],
    variationsLoading: false,
    isSubmitting: false,
    variationBusy: false,
    variationGenerating: false,
    variationError: null,
    previewedVariationId: null,
    onPropose: () => undefined,
    onAccept: () => undefined,
    onReject: () => undefined,
    onPreviewPatch: () => undefined,
    onGenerateVariations: () => undefined,
    onPreviewVariation: () => undefined,
    onAcceptVariation: () => undefined,
    onRejectVariation: () => undefined,
    ...overrides,
  };
}

function fixture(label: string): DeckSnapshot {
  return buildGoldenNodeSlide(`activity-elements-${label}`, 1_000).snapshot;
}

function message(
  overrides: Partial<NodeSlideAgentMessage> & Pick<NodeSlideAgentMessage, 'id'>,
): NodeSlideAgentMessage {
  const {
    id,
    deckId = 'deck-activity',
    runId = 'run-activity',
    role = 'assistant',
    content = 'Persisted assistant message.',
    createdAt = 1_000,
    ...messageOverrides
  } = overrides;
  return {
    id,
    deckId,
    runId,
    role,
    content,
    createdAt,
    ...messageOverrides,
  };
}

function proposal(snapshot: DeckSnapshot): DeckPatch {
  const slide = snapshot.slides[0];
  if (!slide) throw new Error('Fixture requires a slide.');
  return {
    id: 'patch-review',
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
    operations: [{ op: 'update_slide', slideId: slide.id, properties: { title: 'Review title' } }],
    source: 'agent',
    status: 'ready',
    summary: 'Review this bounded title change.',
    createdAt: 1_000,
    updatedAt: 1_000,
  };
}

function direction(snapshot: DeckSnapshot): SlideVariation {
  const slide = snapshot.slides[0];
  if (!slide) throw new Error('Fixture requires a slide.');
  return {
    schemaVersion: NODESLIDE_VARIATION_SCHEMA_VERSION,
    id: 'variation-review',
    batchId: 'batch-review',
    deckId: snapshot.deck.id,
    slideId: slide.id,
    baseDeckVersion: snapshot.deck.version,
    baseSlideVersion: slide.version,
    baseElementVersions: {},
    axes: { contentAngle: 'balanced', density: 'executive', layoutArchetype: 'headline' },
    origin: 'deterministic_fallback',
    fallbackReason: 'provider_not_requested',
    operations: [],
    candidate: {
      slide,
      elements: snapshot.elements.filter((element) => element.slideId === slide.id),
    },
    validation: {
      id: 'variation-validation',
      deckId: snapshot.deck.id,
      deckVersion: snapshot.deck.version,
      ok: true,
      publishOk: true,
      cleanOk: true,
      issues: [],
      checkedAt: 1_000,
      toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
    },
    status: 'ready',
    createdAt: 1_000,
  };
}
