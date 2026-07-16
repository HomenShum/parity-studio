// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  NODESLIDE_WEB_RESEARCH_CONSENT,
  type NodeSlideAgentMessage,
  type NodeSlideAgentRun,
} from '../../../../shared/nodeslide';
import {
  NODESLIDE_VARIATION_SCHEMA_VERSION,
  type SlideVariation,
} from '../../../../shared/nodeslideVariation';
import {
  clearNodeSlideComposerSession,
  nodeSlideComposerSessionKey,
} from '../composer/nodeSlideComposerSession';
import { AiInspector, type AiInspectorProps, type AiReadReference } from './AiInspector';

const blobUrls = new Map<string, Blob>();
let blobUrlSequence = 0;

beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      blobUrlSequence += 1;
      const url = `blob:nodeslide-inspector-test-${blobUrlSequence}`;
      blobUrls.set(url, blob);
      return url;
    },
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: (url: string) => blobUrls.delete(url),
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
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
  blobUrls.clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const blob = blobUrls.get(String(input));
    if (!blob) throw new Error(`Unexpected test fetch: ${String(input)}`);
    return { ok: true, blob: async () => blob } as Response;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('NodeSlide persisted activity assistant-ui thread adapter', () => {
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

  it('renders a compact review queue with one active decision and historical run attribution', async () => {
    const snapshot = fixture('compact-review-queue');
    const first = {
      ...proposal(snapshot),
      id: 'patch-first',
      summary: 'Clarify the decision headline.',
      candidateDigest: 'digest-shared',
      createdAt: 1_000,
      updatedAt: 1_000,
    };
    const second = {
      ...proposal(snapshot),
      id: 'patch-second',
      summary: 'Tighten the supporting evidence.',
      candidateDigest: 'digest-shared',
      createdAt: 2_000,
      updatedAt: 2_000,
    };
    const runs: NodeSlideAgentRun[] = [
      agentRun(snapshot, first.id, 'Rewrite only this headline.', 'openrouter', 'z-ai/glm-5.2'),
      agentRun(snapshot, second.id, 'Strengthen this evidence.', 'nebius', 'zai-org/GLM-5.2'),
    ];
    const user = userEvent.setup();
    renderInspector(snapshot, { patches: [first, second], agentRuns: runs });

    expect(screen.getAllByTestId('proposal-card')).toHaveLength(2);
    await waitFor(() => expect(screen.getAllByTestId('proposal-accept')).toHaveLength(1));
    expect(
      screen.getByText('nebius · zai-org/GLM-5.2', { selector: '.ns-proposal-origin strong' }),
    ).toBeVisible();
    expect(screen.getByText('Equivalent candidate')).toBeVisible();

    await user.click(screen.getByRole('button', { name: /Clarify the decision headline/ }));

    await waitFor(() =>
      expect(
        screen.getByText('openrouter · z-ai/glm-5.2', {
          selector: '.ns-proposal-origin strong',
        }),
      ).toBeVisible(),
    );
    expect(screen.getByText('“Rewrite only this headline.”')).toBeVisible();
    expect(screen.getAllByTestId('proposal-accept')).toHaveLength(1);
  });

  it('holds review decisions until the durable candidate receipt is finalized', async () => {
    const snapshot = fixture('durable-review-finalizing');
    const readyPatch = proposal(snapshot);
    const view = renderInspector(snapshot, { patches: [readyPatch], isSubmitting: true });

    expect(screen.getByTestId('proposal-accept')).toBeDisabled();
    expect(screen.getByTestId('proposal-reject')).toBeDisabled();
    expect(screen.getByTestId('proposal-accept')).toHaveTextContent('Finalizing');

    view.rerender(
      <div className="nodeslide-studio">
        <AiInspector {...inspectorProps(snapshot, { patches: [readyPatch] })} />
      </div>,
    );

    await waitFor(() => expect(screen.getByTestId('proposal-accept')).toBeEnabled());
    expect(screen.getByTestId('proposal-reject')).toBeEnabled();
  });

  it('makes the typing target and write authority explicit before a deictic element request', async () => {
    const snapshot = fixture('explicit-write-authority');
    const user = userEvent.setup();
    renderInspector(snapshot, { initialProviderMode: 'deterministic' });

    const composer = screen.getByTestId('ai-composer');
    const composerHeading = composer.querySelector('.ns-ai-v3-composer-heading');
    if (!composerHeading) throw new Error('Expected the prompt-first composer heading.');
    expect(within(composerHeading as HTMLElement).getByText('Writes to this slide')).toBeVisible();
    await user.type(
      screen.getByRole('textbox', { name: 'AI instruction' }),
      'Change this headline to emphasize the decision.',
    );

    expect(
      screen.getByText('No element is selected; this request can change the whole slide.'),
    ).toBeVisible();
    expect(screen.getByRole('group', { name: 'Current agent scope and policy' })).toHaveTextContent(
      'Writes to this slide',
    );
    expect(screen.getByText('Tools')).toBeVisible();
  });

  it('narrows the write scope when the user selects an element after opening the composer', async () => {
    const snapshot = fixture('selection-scope-transition');
    const selectedElement = snapshot.elements[0];
    if (!selectedElement) throw new Error('Fixture requires a selectable element.');
    const view = renderInspector(snapshot, { initialProviderMode: 'deterministic' });

    expect(screen.getAllByText('Writes to this slide').length).toBeGreaterThan(0);

    view.rerender(
      <div className="nodeslide-studio">
        <AiInspector
          {...inspectorProps(snapshot, {
            initialProviderMode: 'deterministic',
            selectedElements: [selectedElement],
          })}
        />
      </div>,
    );

    await waitFor(() =>
      expect(screen.getAllByText('Writes to 1 selected element').length).toBeGreaterThan(0),
    );
  });

  it('fails closed before session consent and reuses the grant across editor requests', async () => {
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
    await waitFor(() => expect(consent).toBeChecked());

    await user.type(
      screen.getByRole('textbox', { name: 'AI instruction' }),
      'Sharpen the executive takeaway.',
    );
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(onPropose).toHaveBeenCalledTimes(1));
    expect(onPropose.mock.calls[0]?.[2]).toMatchObject({
      providerMode: 'nebius',
      providerConsent: NODESLIDE_NEBIUS_REVIEW_CONSENT,
    });
    await waitFor(() => expect(consent).toBeChecked());

    await user.type(screen.getByRole('textbox', { name: 'AI instruction' }), 'Second request');
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(onPropose).toHaveBeenCalledTimes(2));
    expect(consent).toBeChecked();
  });

  it('keeps session revocation reachable after switching back to private mode', async () => {
    const snapshot = fixture('private-mode-revoke');
    const user = userEvent.setup();
    renderInspector(snapshot);

    const consent = screen.getByTestId('ai-provider-consent');
    await user.click(consent);
    expect(consent).toBeChecked();

    await user.click(screen.getByTestId('ai-model-select'));
    const dialog = await screen.findByRole('dialog', { name: 'Agent model' });
    await user.click(within(dialog).getByText('Deterministic', { exact: true }));

    expect(screen.getByTestId('ai-provider-consent')).toBeEnabled();
    await user.click(screen.getByTestId('ai-provider-consent'));
    expect(screen.queryByTestId('ai-provider-consent')).not.toBeInTheDocument();
  });

  it('keeps Enter operable and explains the one-time session gate before egress', async () => {
    const snapshot = fixture('session-consent-enter');
    const onPropose = vi.fn<AiInspectorProps<string>['onPropose']>();
    const user = userEvent.setup();
    renderInspector(snapshot, { onPropose });

    const instruction = screen.getByRole('textbox', { name: 'AI instruction' });
    await user.type(instruction, 'Make the headline more decisive.');
    expect(screen.getByTestId('ai-submit')).toBeEnabled();

    instruction.focus();
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Allow external AI for this browser tab once',
      ),
    );
    expect(onPropose).not.toHaveBeenCalled();
    expect(screen.getByTestId('ai-provider-consent')).not.toBeChecked();
    expect(instruction).toHaveValue('Make the headline more decisive.');

    await user.click(screen.getByTestId('ai-provider-consent'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps Shift+Enter as a newline while reference and command menus are open', async () => {
    const snapshot = fixture('autocomplete-newline');
    const user = userEvent.setup();
    renderInspector(snapshot, {
      initialProviderMode: 'deterministic',
      references: [{ id: 'source-one', kind: 'source', label: 'Source one' }],
    });

    const instruction = screen.getByRole('textbox', { name: 'AI instruction' });
    await user.type(instruction, '@');
    expect(screen.getByRole('menu', { name: 'Read context' })).toBeVisible();
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(instruction).toHaveValue('@\n');

    await user.clear(instruction);
    await user.type(instruction, '/');
    expect(screen.getByRole('menu', { name: 'Commands' })).toBeVisible();
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(instruction).toHaveValue('/\n');
  });

  it('keeps session consent when a keyboard-activated suggestion rewrites the request', async () => {
    const snapshot = fixture('keyboard-suggestion-consent');
    const onPropose = vi.fn<AiInspectorProps<string>['onPropose']>();
    const user = userEvent.setup();
    renderInspector(snapshot, { onPropose });

    const consent = screen.getByTestId('ai-provider-consent');
    consent.focus();
    await user.keyboard('[Space]');
    expect(consent).toBeChecked();

    const suggestion = screen.getByRole('button', { name: 'Sharpen the story' });
    suggestion.focus();
    await user.keyboard('{Enter}');

    const instruction = screen.getByRole('textbox', { name: 'AI instruction' });
    expect((instruction as HTMLTextAreaElement).value).toContain('Sharpen this slide');
    expect(consent).toBeChecked();
    expect(screen.getByTestId('ai-submit')).toBeEnabled();
    instruction.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onPropose).toHaveBeenCalledTimes(1));
    expect(onPropose.mock.calls[0]?.[2]).toMatchObject({
      providerMode: 'nebius',
      providerConsent: NODESLIDE_NEBIUS_REVIEW_CONSENT,
    });
  });

  it('keeps session consent when editor scope changes after approval', async () => {
    const snapshot = fixture('scope-consent');
    const onPropose = vi.fn<AiInspectorProps<string>['onPropose']>();
    const user = userEvent.setup();
    renderInspector(snapshot, { onPropose });

    await user.type(
      screen.getByRole('textbox', { name: 'AI instruction' }),
      'Tighten the decision narrative.',
    );
    const consent = screen.getByTestId('ai-provider-consent');
    await user.click(consent);
    expect(consent).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Deck' }));

    expect(consent).toBeChecked();
    expect(screen.getByTestId('ai-submit')).toBeEnabled();
    fireEvent.click(screen.getByTestId('ai-submit'));
    await waitFor(() => expect(onPropose).toHaveBeenCalledTimes(1));
    expect(onPropose.mock.calls[0]?.[1]).toMatchObject({ kind: 'deck' });
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

  it('gates deterministic Web, submits after one session grant, and fails closed after revoke', async () => {
    const snapshot = fixture('deterministic-web-consent');
    const onPropose = vi.fn<AiInspectorProps<string>['onPropose']>();
    const user = userEvent.setup();
    renderInspector(snapshot, {
      initialProviderMode: 'deterministic',
      onPropose,
    });

    const instruction = screen.getByRole('textbox', { name: 'AI instruction' });
    await user.type(instruction, 'Ground the market claim in current sources.');
    expect(screen.queryByTestId('ai-provider-consent')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('ai-web-research-toggle'));

    const consent = screen.getByTestId('ai-provider-consent');
    const submit = screen.getByTestId('ai-submit');
    expect(consent).not.toBeChecked();
    expect(screen.getByText('Allow Web')).toBeVisible();
    expect(submit).toBeEnabled();

    await user.click(submit);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Allow Web for this browser tab once'),
    );
    expect(onPropose).not.toHaveBeenCalled();
    expect(instruction).toHaveValue('Ground the market claim in current sources.');

    await user.click(consent);
    expect(consent).toBeChecked();
    expect(screen.getByText('Web allowed')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.click(submit);

    await waitFor(() => expect(onPropose).toHaveBeenCalledTimes(1));
    expect(onPropose.mock.calls[0]?.[2]).toMatchObject({
      providerMode: 'deterministic',
      webResearch: true,
      webResearchConsent: NODESLIDE_WEB_RESEARCH_CONSENT,
    });
    expect(onPropose.mock.calls[0]?.[2]).not.toHaveProperty('providerConsent');
    expect(consent).toBeChecked();

    await user.type(instruction, 'Check one more claim.');
    await user.click(consent);
    expect(consent).not.toBeChecked();
    expect(screen.getByText('Allow Web')).toBeVisible();

    await user.click(submit);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Allow Web for this browser tab once'),
    );
    expect(onPropose).toHaveBeenCalledTimes(1);
  });

  it('keeps delegated change handling compact, explicit, and keyboard-operable', async () => {
    const snapshot = fixture('delegated-change-handling');
    const onApprovalModeChange = vi.fn<NonNullable<AiInspectorProps['onApprovalModeChange']>>();
    const user = userEvent.setup();
    renderInspector(snapshot, {
      approvalMode: 'auto_apply',
      approvalExpiresAt: Date.now() + 60_000,
      onApprovalModeChange,
    });

    const summary = screen.getByTestId('ai-approval-summary');
    expect(summary).toHaveTextContent('Auto-apply safe edits');
    summary.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByTestId('ai-provider-controls')).toHaveAttribute('open', '');
    expect(screen.getByTestId('ai-approval-controls')).toBeVisible();
    await user.click(screen.getByRole('radio', { name: /review before applying/i }));
    expect(onApprovalModeChange).toHaveBeenCalledWith('review');
  });

  it('blocks keyboard and form submission while change authority is transitioning', async () => {
    const snapshot = fixture('delegation-transition-lock');
    const onPropose = vi.fn<AiInspectorProps<string>['onPropose']>();
    const user = userEvent.setup();
    renderInspector(snapshot, {
      initialProviderMode: 'deterministic',
      approvalBusy: true,
      onPropose,
    });

    const instruction = screen.getByRole('textbox', { name: 'AI instruction' });
    await user.type(instruction, 'Change this headline.');
    await user.keyboard('{Enter}');
    const form = screen.getByTestId('ai-submit').closest('form');
    if (!form) throw new Error('Expected the AI composer form.');
    fireEvent.submit(form);

    expect(onPropose).not.toHaveBeenCalled();
    expect(screen.getByTestId('ai-submit')).toBeDisabled();
  });

  it('invalidates an attachment submission when change authority transitions mid-upload', async () => {
    const snapshot = fixture('delegation-attachment-race');
    const onPropose = vi.fn<AiInspectorProps<string>['onPropose']>();
    let resolveAttachment: ((reference: AiReadReference) => void) | undefined;
    const onAttachDataFile = vi.fn(
      () =>
        new Promise<AiReadReference>((resolve) => {
          resolveAttachment = resolve;
        }),
    );
    const user = userEvent.setup();
    const view = renderInspector(snapshot, {
      initialProviderMode: 'deterministic',
      onAttachDataFile,
      onPropose,
      onApprovalModeChange: vi.fn(),
    });

    await user.upload(
      screen.getByTestId('ai-data-file-input'),
      new File(['label,value\nA,1'], 'evidence.csv', { type: 'text/csv' }),
    );
    await user.type(screen.getByRole('textbox', { name: 'AI instruction' }), 'Use this data.');
    await user.click(screen.getByTestId('ai-submit'));
    await waitFor(() => expect(onAttachDataFile).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('radio', { name: /review before applying/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deck' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Operation mode' })).toBeDisabled();
    expect(screen.getByTestId('ai-model-select')).toBeDisabled();
    expect(screen.getByTestId('ai-web-research-toggle')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add command' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'AI instruction' })).toBeDisabled();
    expect(screen.getByTestId('ai-submit')).toBeDisabled();
    const form = screen.getByTestId('ai-submit').closest('form');
    if (!form) throw new Error('Expected the AI composer form.');
    fireEvent.submit(form);
    expect(onAttachDataFile).toHaveBeenCalledTimes(1);

    view.rerender(
      <div className="nodeslide-studio">
        <AiInspector
          {...inspectorProps(snapshot, {
            initialProviderMode: 'deterministic',
            approvalMode: 'auto_apply',
            approvalExpiresAt: Date.now() + 60_000,
            onAttachDataFile,
            onPropose,
            onApprovalModeChange: vi.fn(),
          })}
        />
      </div>,
    );
    await act(async () => {
      resolveAttachment?.({ kind: 'source', id: 'source-evidence', label: 'evidence.csv' });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /review before applying/i })).toBeEnabled(),
    );
    expect(onPropose).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/change handling.*changed/i),
    );
    expect(onPropose).not.toHaveBeenCalled();
  });

  it('starts the authority guard before raw attachment conversion and preserves the retry', async () => {
    const snapshot = fixture('delegation-raw-attachment-race');
    const onAttachDataFile = vi.fn(async () => ({
      kind: 'source' as const,
      id: 'source-evidence',
      label: 'evidence.csv',
    }));
    const onPropose = vi.fn<AiInspectorProps<string>['onPropose']>();
    let resolveBlobFetch: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      (input: RequestInfo | URL) =>
        new Promise<Response>((resolve, reject) => {
          const blob = blobUrls.get(String(input));
          if (!blob) {
            reject(new Error(`Unexpected test fetch: ${String(input)}`));
            return;
          }
          resolveBlobFetch = () => resolve({ ok: true, blob: async () => blob } as Response);
        }),
    );
    const user = userEvent.setup();
    const view = renderInspector(snapshot, {
      initialProviderMode: 'deterministic',
      onAttachDataFile,
      onPropose,
      onApprovalModeChange: vi.fn(),
    });

    await user.upload(
      screen.getByTestId('ai-data-file-input'),
      new File(['label,value\nA,1'], 'evidence.csv', { type: 'text/csv' }),
    );
    await user.type(screen.getByRole('textbox', { name: 'AI instruction' }), 'Use this data.');
    const form = screen.getByTestId('ai-submit').closest('form');
    if (!form) throw new Error('Expected the AI composer form.');
    fireEvent.submit(form);
    await waitFor(() => expect(resolveBlobFetch).toBeTypeOf('function'));
    expect(screen.getByRole('button', { name: 'Deck' })).toBeDisabled();

    view.rerender(
      <div className="nodeslide-studio">
        <AiInspector
          {...inspectorProps(snapshot, {
            initialProviderMode: 'deterministic',
            approvalMode: 'auto_apply',
            approvalExpiresAt: Date.now() + 60_000,
            onAttachDataFile,
            onPropose,
            onApprovalModeChange: vi.fn(),
          })}
        />
      </div>,
    );
    await act(async () => {
      resolveBlobFetch?.();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/change handling.*changed/i),
    );
    expect(onAttachDataFile).not.toHaveBeenCalled();
    expect(onPropose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'AI instruction' })).toHaveValue('Use this data.');
    expect(screen.getByText('evidence.csv')).toBeInTheDocument();
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
    expect(reviewScroll).toHaveAttribute('role', 'log');
    expect(reviewScroll).toHaveAttribute('data-follow', 'false');
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

  it('offers an explicit bounded retry only for a retryable failed durable run', async () => {
    const snapshot = fixture('retry-failed-run');
    const onRetryRun = vi.fn();
    const user = userEvent.setup();
    const view = renderInspector(snapshot, {
      agentActivity: {
        status: 'failed',
        elapsedMs: 1_200,
        ask: 'Rewrite the headline.',
        message: 'The provider ended before a validated proposal was returned.',
      },
      onRetryRun,
    });

    const retry = screen.getByRole('button', { name: 'Retry the same request' });
    expect(retry).toBeVisible();
    await user.click(retry);
    expect(onRetryRun).toHaveBeenCalledTimes(1);

    view.rerender(
      <div className="nodeslide-studio">
        <AiInspector
          {...inspectorProps(snapshot, {
            agentActivity: {
              status: 'cancelled',
              elapsedMs: 1_200,
              ask: 'Rewrite the headline.',
              message: 'Run cancelled. No deck changes were applied.',
            },
            onRetryRun,
          })}
        />
      </div>,
    );
    expect(screen.queryByRole('button', { name: 'Retry the same request' })).toBeNull();
  });

  it('does not keep a stale durable run cancellable after the request has failed', () => {
    const snapshot = fixture('terminal-over-stale-run');
    const staleRun: NodeSlideAgentRun = {
      ...agentRun(snapshot, 'patch-stale', 'Rewrite the headline.', 'nebius', 'zai-org/GLM-5.2'),
      status: 'planning',
    };

    renderInspector(snapshot, {
      agentRuns: [staleRun],
      agentActivity: {
        status: 'failed',
        elapsedMs: 1_200,
        ask: 'Rewrite the headline.',
        message: 'The provider ended before a validated proposal was returned.',
      },
      onCancelRun: vi.fn(),
    });

    expect(
      screen.getByText('The provider ended before a validated proposal was returned.'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull();
    expect(screen.getByTestId('ai-composer')).not.toHaveAttribute('data-running', 'true');
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

function agentRun(
  snapshot: DeckSnapshot,
  patchId: string,
  instruction: string,
  provider: string,
  model: string,
): NodeSlideAgentRun {
  return {
    id: `run-${patchId}`,
    deckId: snapshot.deck.id,
    idempotencyKey: `idempotency-${patchId}`,
    instruction,
    status: 'awaiting_review',
    provider,
    model,
    webResearch: false,
    attempt: 1,
    patchId,
    createdAt: 1_000,
    updatedAt: 1_000,
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
