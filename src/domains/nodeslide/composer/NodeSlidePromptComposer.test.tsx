// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NODESLIDE_DEFAULT_AGENT_MODEL,
  NODESLIDE_REASONING_EFFORTS,
  type NodeSlideReasoningEffort,
  nodeSlideModelSupportsReasoningEffort,
} from '../../../../shared/nodeslide';
import {
  type NodeSlideComposerModelValue,
  NodeSlidePromptComposer,
  type NodeSlidePromptComposerSubmit,
} from './NodeSlidePromptComposer';
import {
  clearNodeSlideComposerSession,
  useNodeSlideComposerSession,
} from './nodeSlideComposerSession';

const blobUrls = new Map<string, Blob>();
let blobUrlSequence = 0;

beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      blobUrlSequence += 1;
      const url = `blob:nodeslide-test-${blobUrlSequence}`;
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
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('PointerEvent', globalThis.PointerEvent ?? MouseEvent);
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

describe('NodeSlide AI Elements composer interactions', () => {
  it('lets a fresh user attach evidence before the instruction is submittable', () => {
    const sessionKey = 'editor:attachment-first';
    clearNodeSlideComposerSession(sessionKey);
    render(<ComposerPanel disabled sessionKey={sessionKey} />);

    expect(screen.getByRole('button', { name: 'Send instruction' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Attach data file' })).toBeEnabled();
    expect(screen.getByTestId('test-file-input')).toBeEnabled();
  });

  it('selects a model and exposes only provider-native effort names supported by it', async () => {
    const sessionKey = 'editor:model-selection';
    clearNodeSlideComposerSession(sessionKey);
    const user = userEvent.setup();
    render(<ComposerPanel insideDialog sessionKey={sessionKey} />);

    const effort = screen.getByTestId('test-effort-select');
    expect(optionLabels(effort)).toEqual(['Low', 'Medium', 'High']);
    expect(optionLabels(effort)).not.toEqual(
      expect.arrayContaining(['Light', 'Extra High', 'Ultra']),
    );

    await user.click(screen.getByTestId('test-model-select'));
    const dialog = await screen.findByRole('dialog', { name: 'Model and provider' });
    expect(dialog.closest('.nodeslide-studio')).not.toBeNull();
    expect(dialog.closest('dialog')).toBe(screen.getByTestId('native-dialog-host'));
    await user.click(within(dialog).getByText('Claude Sonnet 5'));

    expect(screen.getByTestId('test-model-select')).toHaveTextContent('Claude Sonnet 5');
    expect(optionLabels(screen.getByTestId('test-effort-select'))).toEqual([
      'Low',
      'Medium',
      'High',
      'XHigh',
      'Max',
    ]);
    await user.selectOptions(screen.getByTestId('test-effort-select'), 'max');
    expect(screen.getByTestId('test-effort-select')).toHaveValue('max');
  });

  it('keeps Shift+Enter as a newline and submits with Enter', async () => {
    const sessionKey = 'editor:keyboard';
    clearNodeSlideComposerSession(sessionKey);
    const onSubmit = vi.fn(async (_message: NodeSlidePromptComposerSubmit) => undefined);
    const user = userEvent.setup();
    render(<ComposerPanel onSubmit={onSubmit} sessionKey={sessionKey} />);

    const textbox = screen.getByRole('textbox', { name: 'AI instruction' });
    await user.type(textbox, 'First line');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(textbox, 'Second line');

    expect(textbox).toHaveValue('First line\nSecond line');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      text: 'First line\nSecond line',
      files: [],
    });
  });

  it('adds and removes an attachment through PromptInput', async () => {
    const sessionKey = 'editor:attachment-remove';
    clearNodeSlideComposerSession(sessionKey);
    const user = userEvent.setup();
    render(<ComposerPanel sessionKey={sessionKey} />);

    await user.upload(
      screen.getByTestId('test-file-input'),
      new File(['region,revenue\nWest,42'], 'revenue.csv', { type: 'text/csv' }),
    );
    expect(await screen.findByText('revenue.csv')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('session-attachment-count')).toHaveTextContent('1'),
    );

    await user.click(screen.getByRole('button', { name: 'Remove revenue.csv' }));
    await waitFor(() => expect(screen.queryByText('revenue.csv')).not.toBeInTheDocument());
    expect(screen.getByTestId('session-attachment-count')).toHaveTextContent('0');
  });

  it('reports the attachment cap after commit without updating a parent during render', async () => {
    const sessionKey = 'editor:attachment-cap';
    clearNodeSlideComposerSession(sessionKey);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<AttachmentErrorHarness sessionKey={sessionKey} />);

    await user.upload(screen.getByTestId('test-file-input'), [
      new File(['a,b\n1,2'], 'one.csv', { type: 'text/csv' }),
      new File(['{"value":2}'], 'two.json', { type: 'application/json' }),
      new File(['# Evidence'], 'three.md', { type: 'text/markdown' }),
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('session-attachment-count')).toHaveTextContent('3'),
    );

    await user.upload(
      screen.getByTestId('test-file-input'),
      new File(['four'], 'four.txt', { type: 'text/plain' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many files. Some were not added.',
    );
    expect(screen.queryByText('four.txt')).not.toBeInTheDocument();
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain(
      'Cannot update a component while rendering a different component',
    );
  });

  it('consumes pasted and dropped files in the submitted NodeSlide request', async () => {
    const sessionKey = 'editor:paste-drop';
    clearNodeSlideComposerSession(sessionKey);
    const onSubmit = vi.fn(async (_message: NodeSlidePromptComposerSubmit) => undefined);
    const user = userEvent.setup();
    render(<ComposerPanel onSubmit={onSubmit} sessionKey={sessionKey} />);

    const textbox = screen.getByRole('textbox', { name: 'AI instruction' });
    const pasted = new File(['{"market":"west"}'], 'market.json', {
      type: 'application/json',
    });
    fireEvent.paste(textbox, {
      clipboardData: {
        items: [{ getAsFile: () => pasted, kind: 'file', type: pasted.type }],
      },
    });
    expect(await screen.findByText('market.json')).toBeInTheDocument();

    const dropped = new File(['north: 19'], 'notes.txt', { type: 'text/plain' });
    const form = textbox.closest('form');
    if (!form) throw new Error('Expected PromptInput form');
    fireEvent.drop(form, {
      dataTransfer: { files: [dropped], types: ['Files'] },
    });
    expect(await screen.findByText('notes.txt')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('session-attachment-count')).toHaveTextContent('2'),
    );

    await user.type(textbox, 'Use these sources');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0]?.[0];
    expect(submitted?.files.map((file) => file.name)).toEqual(['market.json', 'notes.txt']);
    expect(await Promise.all(submitted?.files.map(readBlob) ?? [])).toEqual([
      '{"market":"west"}',
      'north: 19',
    ]);
  });

  it('does not submit after the composer unmounts while attachment content is resolving', async () => {
    const sessionKey = 'editor-unmount-attachment-race';
    clearNodeSlideComposerSession(sessionKey);
    const onSubmit = vi.fn(async (_message: NodeSlidePromptComposerSubmit) => undefined);
    const user = userEvent.setup();
    const view = render(<ComposerPanel onSubmit={onSubmit} sessionKey={sessionKey} />);

    await user.upload(
      screen.getByTestId('test-file-input'),
      new File(['metric,value\nTrust,91'], 'trust.csv', { type: 'text/csv' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('session-attachment-count')).toHaveTextContent('1'),
    );
    await user.type(screen.getByRole('textbox', { name: 'AI instruction' }), 'Use this evidence');

    let resolveFetch: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    await user.keyboard('{Enter}');
    await waitFor(() => expect(resolveFetch).toBeTypeOf('function'));

    view.unmount();
    await act(async () => {
      resolveFetch?.({
        ok: true,
        blob: async () => new Blob(['metric,value\nTrust,91'], { type: 'text/csv' }),
      } as Response);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('restores a keyed draft and attachments after AI to Trace to AI remount', async () => {
    const sessionKey = 'editor:tab-remount';
    clearNodeSlideComposerSession(sessionKey);
    const user = userEvent.setup();
    render(<TabHarness sessionKey={sessionKey} />);

    const textbox = screen.getByRole('textbox', { name: 'AI instruction' });
    await user.type(textbox, 'Preserve this draft');
    await user.upload(
      screen.getByTestId('test-file-input'),
      new File(['metric,value\nTrust,91'], 'trust.csv', { type: 'text/csv' }),
    );
    expect(await screen.findByText('trust.csv')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('session-attachment-count')).toHaveTextContent('1'),
    );

    await user.click(screen.getByRole('button', { name: 'Trace' }));
    expect(screen.queryByRole('textbox', { name: 'AI instruction' })).not.toBeInTheDocument();
    expect(screen.getByText('Trace panel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'AI' }));
    expect(await screen.findByRole('textbox', { name: 'AI instruction' })).toHaveValue(
      'Preserve this draft',
    );
    expect(await screen.findByText('trust.csv')).toBeInTheDocument();
    expect(screen.getByTestId('session-attachment-count')).toHaveTextContent('1');
  });
});

function ComposerPanel({
  sessionKey,
  onSubmit = async () => undefined,
  onAttachmentError,
  onAttachmentsChange,
  insideDialog = false,
  disabled = false,
}: {
  sessionKey: string;
  onSubmit?: (message: NodeSlidePromptComposerSubmit) => void | Promise<void>;
  onAttachmentError?: (message: string | null) => void;
  onAttachmentsChange?: () => void;
  insideDialog?: boolean;
  disabled?: boolean;
}) {
  const session = useNodeSlideComposerSession(sessionKey);
  const [model, setModel] = useState<NodeSlideComposerModelValue>(NODESLIDE_DEFAULT_AGENT_MODEL);
  const [effort, setEffort] = useState<NodeSlideReasoningEffort>('high');
  const effortOptions =
    model === 'deterministic'
      ? []
      : NODESLIDE_REASONING_EFFORTS.filter((option) =>
          nodeSlideModelSupportsReasoningEffort(model, option.id),
        );

  const selectModel = (next: NodeSlideComposerModelValue) => {
    setModel(next);
    if (next !== 'deterministic' && !nodeSlideModelSupportsReasoningEffort(next, effort)) {
      setEffort('high');
    }
  };

  const composer = (
    <>
      <NodeSlidePromptComposer
        attachmentInputTestId="test-file-input"
        clearAttachmentsOnSubmit={false}
        disabled={disabled}
        effort={effort}
        effortOptions={effortOptions}
        effortTestId="test-effort-select"
        model={model}
        modelLabel="Model and provider"
        modelTestId="test-model-select"
        {...(onAttachmentError ? { onAttachmentError } : {})}
        {...(onAttachmentsChange ? { onAttachmentsChange } : {})}
        onEffortChange={setEffort}
        onModelChange={selectModel}
        onSubmit={onSubmit}
        placeholder="Describe the change"
        session={session}
        submitLabel="Send instruction"
        textareaLabel="AI instruction"
      />
      <output data-testid="session-attachment-count">{session.attachments.length}</output>
    </>
  );

  return (
    <div className="nodeslide-studio">
      {insideDialog ? (
        <dialog data-testid="native-dialog-host" open>
          {composer}
        </dialog>
      ) : (
        composer
      )}
    </div>
  );
}

function AttachmentErrorHarness({ sessionKey }: { sessionKey: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <ComposerPanel
        onAttachmentError={setError}
        onAttachmentsChange={() => setError(null)}
        sessionKey={sessionKey}
      />
      {error ? <output role="alert">{error}</output> : null}
    </>
  );
}

function TabHarness({ sessionKey }: { sessionKey: string }) {
  const [tab, setTab] = useState<'ai' | 'trace'>('ai');
  return (
    <>
      <nav>
        <button type="button" onClick={() => setTab('ai')}>
          AI
        </button>
        <button type="button" onClick={() => setTab('trace')}>
          Trace
        </button>
      </nav>
      {tab === 'ai' ? <ComposerPanel sessionKey={sessionKey} /> : <div>Trace panel</div>}
    </>
  );
}

function optionLabels(select: HTMLElement): string[] {
  return within(select)
    .getAllByRole('option')
    .map((option) => option.textContent ?? '');
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read test file.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(blob);
  });
}
