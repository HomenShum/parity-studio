// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NODESLIDE_DEFAULT_AGENT_MODEL } from '../../../../shared/nodeslide';
import { AgentSessionProvider } from '../session/AgentSessionProvider';
import { NodeSlideLanding } from './NodeSlideLanding';
import {
  NODESLIDE_NEBIUS_BRIEF_CONSENT,
  NODESLIDE_OPENROUTER_BRIEF_CONSENT,
  ProjectDialog,
  createDeckProviderAdmission,
} from './ProjectDialog';

const blobUrls = new Map<string, Blob>();
let blobUrlSequence = 0;

beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      blobUrlSequence += 1;
      const url = `blob:nodeslide-consent-${blobUrlSequence}`;
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
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
    },
  });
  if (!File.prototype.text) {
    Object.defineProperty(File.prototype, 'text', {
      configurable: true,
      value(this: File) {
        return readBlob(this);
      },
    });
  }
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
  if (!globalThis.PointerEvent) vi.stubGlobal('PointerEvent', MouseEvent);
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

describe('NodeSlide creation consent', () => {
  it('accepts only the exact token for the named creation provider', () => {
    expect(
      createDeckProviderAdmission(
        'nebius',
        NODESLIDE_DEFAULT_AGENT_MODEL,
        'medium',
        NODESLIDE_OPENROUTER_BRIEF_CONSENT,
      ),
    ).toBeNull();
    expect(
      createDeckProviderAdmission(
        'openrouter_free',
        NODESLIDE_DEFAULT_AGENT_MODEL,
        'medium',
        NODESLIDE_NEBIUS_BRIEF_CONSENT,
      ),
    ).toBeNull();
    expect(
      createDeckProviderAdmission(
        'nebius',
        NODESLIDE_DEFAULT_AGENT_MODEL,
        'medium',
        NODESLIDE_NEBIUS_BRIEF_CONSENT,
      ),
    ).toMatchObject({
      providerMode: 'nebius',
      providerConsent: NODESLIDE_NEBIUS_BRIEF_CONSENT,
    });
    expect(
      createDeckProviderAdmission('deterministic', NODESLIDE_DEFAULT_AGENT_MODEL, 'medium', null),
    ).toEqual({ providerMode: 'deterministic' });
  });

  it('never submits the recommended external route before one-shot landing consent', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <AgentSessionProvider clientSessionId="landing-external-consent">
        <NodeSlideLanding
          clientSessionId="landing-external-consent"
          recentDecks={[]}
          creating={false}
          onCreate={onCreate}
          onExploreSample={() => undefined}
          onOpenProjects={() => undefined}
          onOpenDeck={() => undefined}
        />
      </AgentSessionProvider>,
    );

    await user.type(
      screen.getByLabelText('Presentation brief'),
      'Build exactly six slides for a launch review',
    );
    const consent = screen.getByTestId('landing-provider-consent');
    const submit = screen.getByRole('button', { name: 'Create presentation' });
    const form = submit.closest('form');
    if (!form) throw new Error('Expected the landing composer form.');

    expect(consent).not.toBeChecked();
    expect(submit).toBeDisabled();
    fireEvent.submit(form);
    await waitFor(() => expect(onCreate).not.toHaveBeenCalled());

    await user.click(consent);
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const request = onCreate.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      providerModel: NODESLIDE_DEFAULT_AGENT_MODEL,
      providerConsent:
        request.providerMode === 'nebius'
          ? NODESLIDE_NEBIUS_BRIEF_CONSENT
          : NODESLIDE_OPENROUTER_BRIEF_CONSENT,
    });
    expect(request.brief.successCriteria[0]).toBe('Exactly 6 slides in the requested narrative');
    expect(consent).not.toBeChecked();
    expect(submit).toBeDisabled();

    fireEvent.submit(form);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
  });

  it('blocks unsupported deck lengths before consuming consent and stays editable', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <AgentSessionProvider clientSessionId="landing-slide-count-boundary">
        <NodeSlideLanding
          clientSessionId="landing-slide-count-boundary"
          recentDecks={[]}
          creating={false}
          onCreate={onCreate}
          onExploreSample={() => undefined}
          onOpenProjects={() => undefined}
          onOpenDeck={() => undefined}
        />
      </AgentSessionProvider>,
    );

    const brief = screen.getByLabelText('Presentation brief');
    const consent = screen.getByTestId('landing-provider-consent');
    const submit = screen.getByRole('button', { name: 'Create presentation' });
    await user.type(brief, 'Create a concise two-slide launch proof.');
    await user.click(consent);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'NodeSlide currently creates 3–8 slides. Change the requested 2-slide deck to 3–8 slides.',
    );
    expect(submit).toBeDisabled();
    expect(onCreate).not.toHaveBeenCalled();

    await user.clear(brief);
    await user.type(brief, 'Create a concise three-slide launch proof.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(consent).not.toBeChecked();
    await user.click(consent);
    expect(submit).toBeEnabled();
  });

  it('requires fresh keyboard consent after a landing preset rewrites the request', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <AgentSessionProvider clientSessionId="landing-keyboard-preset-consent">
        <NodeSlideLanding
          clientSessionId="landing-keyboard-preset-consent"
          recentDecks={[]}
          creating={false}
          onCreate={onCreate}
          onExploreSample={() => undefined}
          onOpenProjects={() => undefined}
          onOpenDeck={() => undefined}
        />
      </AgentSessionProvider>,
    );

    const prompt = screen.getByLabelText('Presentation brief');
    const consent = screen.getByTestId('landing-provider-consent');
    const submit = screen.getByRole('button', { name: 'Create presentation' });
    await user.type(prompt, 'Build a generic launch review.');
    consent.focus();
    await user.keyboard('[Space]');
    expect(consent).toBeChecked();

    const starter = screen.getByRole('button', { name: 'World Cup data story' });
    starter.focus();
    await user.keyboard('{Enter}');

    expect((prompt as HTMLTextAreaElement).value).toContain('2022 FIFA World Cup');
    expect(consent).not.toBeChecked();
    expect(submit).toBeDisabled();
    prompt.focus();
    await user.keyboard('{Enter}');
    expect(onCreate).not.toHaveBeenCalled();

    consent.focus();
    await user.keyboard('[Space]');
    prompt.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      title: 'World Cup 2022 — The Data Story',
      providerModel: NODESLIDE_DEFAULT_AGENT_MODEL,
    });
  });

  it('invalidates landing consent when attached evidence changes the request', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <AgentSessionProvider clientSessionId="landing-attachment-consent">
        <NodeSlideLanding
          clientSessionId="landing-attachment-consent"
          recentDecks={[]}
          creating={false}
          onCreate={onCreate}
          onExploreSample={() => undefined}
          onOpenProjects={() => undefined}
          onOpenDeck={() => undefined}
        />
      </AgentSessionProvider>,
    );

    await user.type(screen.getByLabelText('Presentation brief'), 'Build an evidence review.');
    const consent = screen.getByTestId('landing-provider-consent');
    await user.click(consent);
    expect(consent).toBeChecked();

    await user.upload(
      screen.getByTestId('landing-file-input'),
      new File(['metric,value\nretention,82'], 'evidence.csv', { type: 'text/csv' }),
    );

    await waitFor(() => expect(consent).not.toBeChecked());
    expect(screen.getByRole('button', { name: 'Create presentation' })).toBeDisabled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('clears external consent before opening the sample without creating a deck', async () => {
    const onCreate = vi.fn();
    const onExploreSample = vi.fn();
    const user = userEvent.setup();
    render(
      <AgentSessionProvider clientSessionId="landing-sample-consent">
        <NodeSlideLanding
          clientSessionId="landing-sample-consent"
          recentDecks={[]}
          creating={false}
          onCreate={onCreate}
          onExploreSample={onExploreSample}
          onOpenProjects={() => undefined}
          onOpenDeck={() => undefined}
        />
      </AgentSessionProvider>,
    );

    await user.type(screen.getByLabelText('Presentation brief'), 'Build an external draft.');
    const consent = screen.getByTestId('landing-provider-consent');
    await user.click(consent);
    expect(consent).toBeChecked();

    const sample = screen.getByRole('button', { name: /Explore the editable sample workspace/ });
    sample.focus();
    await user.keyboard('{Enter}');

    expect(onExploreSample).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
    expect(consent).not.toBeChecked();
  });

  it('creates deterministically without showing or minting consent', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <AgentSessionProvider clientSessionId="landing-deterministic-consent">
        <NodeSlideLanding
          clientSessionId="landing-deterministic-consent"
          recentDecks={[]}
          creating={false}
          onCreate={onCreate}
          onExploreSample={() => undefined}
          onOpenProjects={() => undefined}
          onOpenDeck={() => undefined}
        />
      </AgentSessionProvider>,
    );

    await user.click(screen.getByTestId('landing-model-select'));
    const modelDialog = await screen.findByRole('dialog', { name: 'Generation model' });
    await user.click(within(modelDialog).getByText('Deterministic'));
    await user.type(screen.getByLabelText('Presentation brief'), 'Build a private launch deck');

    expect(screen.queryByTestId('landing-provider-consent')).not.toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Create presentation' });
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({ providerMode: 'deterministic' });
    expect(onCreate.mock.calls[0]?.[0]).not.toHaveProperty('providerConsent');
  });

  it('blocks project creation until checked and consumes consent on submit', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <ProjectDialog
        open
        clientSessionId="project-external-consent"
        recentDecks={[]}
        creating={false}
        onClose={() => undefined}
        onCreate={onCreate}
        onOpenDeck={() => undefined}
      />,
    );

    await user.type(screen.getByTestId('new-deck-title'), 'Launch truth');
    await user.type(
      screen.getByRole('textbox', { name: 'What should this deck accomplish?' }),
      'Explain the launch decision with evidence.',
    );
    await user.type(screen.getByTestId('preview-access-code'), 'preview-code');
    const consent = screen.getByTestId('provider-consent');
    const submit = screen.getByRole('button', { name: /Create deck/ });
    const form =
      submit.closest('form') ?? document.getElementById(submit.getAttribute('form') ?? '');
    if (!form) throw new Error('Expected the project creation form.');

    expect(consent).not.toBeChecked();
    expect(submit).toBeDisabled();
    fireEvent.submit(form);
    await waitFor(() => expect(onCreate).not.toHaveBeenCalled());

    await user.click(consent);
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]?.[0]).toHaveProperty('providerConsent');
    expect(consent).not.toBeChecked();
  });

  it('does not carry project consent across the keyboard-activated World Cup preset', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <ProjectDialog
        open
        clientSessionId="project-preset-consent"
        recentDecks={[]}
        creating={false}
        onClose={() => undefined}
        onCreate={onCreate}
        onOpenDeck={() => undefined}
      />,
    );

    await user.type(screen.getByTestId('new-deck-title'), 'Initial title');
    await user.type(
      screen.getByRole('textbox', { name: 'What should this deck accomplish?' }),
      'Build an initial decision brief.',
    );
    await user.type(screen.getByTestId('preview-access-code'), 'preview-code');
    const consent = screen.getByTestId('provider-consent');
    await user.click(consent);
    expect(consent).toBeChecked();

    const starter = screen.getByTestId('world-cup-starter');
    starter.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByTestId('new-deck-title')).toHaveValue('World Cup 2022 — The Data Story');
    expect(consent).not.toBeChecked();
    const submit = screen.getByRole('button', { name: /Create deck/ });
    expect(submit).toBeDisabled();
    const form =
      submit.closest('form') ?? document.getElementById(submit.getAttribute('form') ?? '');
    if (!form) throw new Error('Expected the project creation form.');
    fireEvent.submit(form);
    expect(onCreate).not.toHaveBeenCalled();

    consent.focus();
    await user.keyboard('[Space]');
    const prompt = screen.getByRole('textbox', { name: 'What should this deck accomplish?' });
    prompt.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      title: 'World Cup 2022 — The Data Story',
      providerModel: NODESLIDE_DEFAULT_AGENT_MODEL,
    });
  });
});

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read test file.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(blob);
  });
}
