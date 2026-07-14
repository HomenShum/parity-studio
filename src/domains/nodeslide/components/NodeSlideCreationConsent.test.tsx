// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NODESLIDE_DEFAULT_AGENT_MODEL } from '../../../../shared/nodeslide';
import { NodeSlideLanding } from './NodeSlideLanding';
import {
  NODESLIDE_NEBIUS_BRIEF_CONSENT,
  NODESLIDE_OPENROUTER_BRIEF_CONSENT,
  ProjectDialog,
} from './ProjectDialog';

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
});

beforeEach(() => {
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('NodeSlide creation consent', () => {
  it('never submits the recommended external route before one-shot landing consent', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <NodeSlideLanding
        clientSessionId="landing-external-consent"
        recentDecks={[]}
        creating={false}
        onCreate={onCreate}
        onExploreSample={() => undefined}
        onOpenProjects={() => undefined}
        onOpenDeck={() => undefined}
      />,
    );

    await user.type(screen.getByLabelText('Presentation brief'), 'Build a launch review deck');
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
    expect(consent).not.toBeChecked();
    expect(submit).toBeDisabled();

    fireEvent.submit(form);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
  });

  it('creates deterministically without showing or minting consent', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(
      <NodeSlideLanding
        clientSessionId="landing-deterministic-consent"
        recentDecks={[]}
        creating={false}
        onCreate={onCreate}
        onExploreSample={() => undefined}
        onOpenProjects={() => undefined}
        onOpenDeck={() => undefined}
      />,
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
});
