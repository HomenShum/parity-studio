// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('fails closed before session consent and reuses the grant for later landing requests', async () => {
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
    expect(submit).toBeEnabled();
    fireEvent.submit(form);
    await waitFor(() => expect(onCreate).not.toHaveBeenCalled());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Allow external AI for this browser tab once',
    );

    await user.click(consent);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
    expect(consent).toBeChecked();

    await user.clear(screen.getByLabelText('Presentation brief'));
    await user.type(screen.getByLabelText('Presentation brief'), 'Build a second six-slide review');
    await user.click(submit);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
    expect(consent).toBeChecked();
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
    expect(consent).toBeChecked();
    expect(submit).toBeEnabled();
  });

  it('keeps keyboard-granted session consent when a landing preset rewrites the request', async () => {
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
    expect(consent).toBeChecked();
    expect(submit).toBeEnabled();
    prompt.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      title: 'World Cup 2022 — The Data Story',
      providerModel: NODESLIDE_DEFAULT_AGENT_MODEL,
    });
  });

  it('keeps session consent when attached evidence changes the request', async () => {
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

    await waitFor(() => expect(consent).toBeChecked());
    expect(screen.getByRole('button', { name: 'Create presentation' })).toBeEnabled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('cancels landing creation when session authority changes during file parsing', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <AgentSessionProvider clientSessionId="landing-consent-file-race">
        <NodeSlideLanding
          clientSessionId="landing-consent-file-race"
          recentDecks={[]}
          creating={false}
          onCreate={onCreate}
          onExploreSample={() => undefined}
          onOpenDeck={() => undefined}
        />
      </AgentSessionProvider>,
    );

    const prompt = screen.getByLabelText('Presentation brief');
    await user.type(prompt, 'Build a six-slide evidence review.');
    await user.click(screen.getByTestId('landing-provider-consent'));
    await user.upload(
      screen.getByTestId('landing-file-input'),
      new File(['label,value\nA,1'], 'evidence.csv', { type: 'text/csv' }),
    );
    await screen.findByText('evidence.csv');
    const submit = screen.getByRole('button', { name: 'Create presentation' });
    await waitFor(() => expect(submit).toBeEnabled());

    let resolveText: ((content: string) => void) | undefined;
    const fileText = vi.spyOn(File.prototype, 'text').mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveText = resolve;
        }),
    );
    await user.click(submit);
    await waitFor(() => expect(resolveText).toBeTypeOf('function'));
    await user.click(screen.getByTestId('landing-provider-consent'));
    await act(async () => {
      resolveText?.('label,value\nA,1');
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/consent.*changed.*prepared/i),
    );
    expect(onCreate).not.toHaveBeenCalled();
    expect(prompt).toHaveValue('Build a six-slide evidence review.');
    fileText.mockRestore();
  });

  it('keeps the session grant while opening the sample without creating a deck', async () => {
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
    expect(consent).toBeChecked();
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

  it('keeps a long recent-deck history bounded until the user expands it inline', async () => {
    const onOpenDeck = vi.fn();
    const user = userEvent.setup();
    const recentDecks = Array.from({ length: 6 }, (_, index) => ({
      id: `deck-${index + 1}`,
      title: `Recent deck ${index + 1}`,
      version: index + 1,
      updatedAt: index,
    }));
    render(
      <AgentSessionProvider clientSessionId="landing-bounded-recents">
        <NodeSlideLanding
          clientSessionId="landing-bounded-recents"
          recentDecks={recentDecks}
          creating={false}
          onCreate={() => undefined}
          onExploreSample={() => undefined}
          onOpenDeck={onOpenDeck}
        />
      </AgentSessionProvider>,
    );

    expect(screen.getByRole('button', { name: /Recent deck 4/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Recent deck 5/ })).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Show 2 more' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(screen.getByRole('button', { name: /Recent deck 6/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await user.click(screen.getByRole('button', { name: /Recent deck 6/ }));
    expect(onOpenDeck).toHaveBeenCalledWith('deck-6');
  });

  it('blocks project creation until checked and keeps consent for the browser session', async () => {
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
    expect(submit).toBeEnabled();
    fireEvent.submit(form);
    await waitFor(() => expect(onCreate).not.toHaveBeenCalled());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Allow external AI for this browser tab once',
    );

    await user.click(consent);
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]?.[0]).toHaveProperty('providerConsent');
    expect(consent).toBeChecked();

    await user.click(screen.getByTestId('provider-deterministic'));
    expect(consent).toBeEnabled();
    await user.click(consent);
    expect(consent).not.toBeChecked();
  });

  it('cancels project creation when consent is revoked during file parsing', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <ProjectDialog
        open
        clientSessionId="project-consent-file-race"
        recentDecks={[]}
        creating={false}
        onClose={() => undefined}
        onCreate={onCreate}
        onOpenDeck={() => undefined}
      />,
    );

    await user.type(screen.getByTestId('new-deck-title'), 'Authority-safe deck');
    await user.type(
      screen.getByRole('textbox', { name: 'What should this deck accomplish?' }),
      'Build a six-slide evidence review.',
    );
    await user.type(screen.getByTestId('preview-access-code'), 'preview-code');
    await user.click(screen.getByTestId('provider-consent'));
    await user.upload(
      screen.getByTestId('create-file-input'),
      new File(['label,value\nA,1'], 'evidence.csv', { type: 'text/csv' }),
    );
    await screen.findByText('and attached files', { exact: false });
    const submit = screen.getByRole('button', { name: /Create deck/ });
    await waitFor(() => expect(submit).toBeEnabled());

    let resolveText: ((content: string) => void) | undefined;
    const fileText = vi.spyOn(File.prototype, 'text').mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveText = resolve;
        }),
    );
    await user.click(submit);
    await waitFor(() => expect(resolveText).toBeTypeOf('function'));
    await user.click(screen.getByTestId('provider-consent'));
    await act(async () => {
      resolveText?.('label,value\nA,1');
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/consent.*changed.*prepared/i),
    );
    expect(onCreate).not.toHaveBeenCalled();
    fileText.mockRestore();
  });

  it('cancels project creation when the dialog closes during file parsing', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    const props = {
      clientSessionId: 'project-close-file-race',
      recentDecks: [],
      creating: false,
      onClose: () => undefined,
      onCreate,
      onOpenDeck: () => undefined,
    } as const;
    const view = render(<ProjectDialog open {...props} />);

    await user.type(screen.getByTestId('new-deck-title'), 'Close-safe deck');
    await user.type(
      screen.getByRole('textbox', { name: 'What should this deck accomplish?' }),
      'Build a six-slide evidence review.',
    );
    await user.type(screen.getByTestId('preview-access-code'), 'preview-code');
    await user.click(screen.getByTestId('provider-consent'));
    await user.upload(
      screen.getByTestId('create-file-input'),
      new File(['label,value\nA,1'], 'evidence.csv', { type: 'text/csv' }),
    );
    await screen.findByText('and attached files', { exact: false });

    let resolveText: ((content: string) => void) | undefined;
    const fileText = vi.spyOn(File.prototype, 'text').mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveText = resolve;
        }),
    );
    await user.click(screen.getByRole('button', { name: /Create deck/ }));
    await waitFor(() => expect(resolveText).toBeTypeOf('function'));
    view.rerender(<ProjectDialog open={false} {...props} />);
    await act(async () => {
      resolveText?.('label,value\nA,1');
      await Promise.resolve();
    });

    await waitFor(() => expect(onCreate).not.toHaveBeenCalled());
    fileText.mockRestore();
  });

  it('carries project session consent across the keyboard-activated World Cup preset', async () => {
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
    expect(consent).toBeChecked();
    const submit = screen.getByRole('button', { name: /Create deck/ });
    expect(submit).toBeEnabled();
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
