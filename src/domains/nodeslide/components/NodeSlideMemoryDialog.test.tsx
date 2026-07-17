// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NodeSlideAgentMemory } from '../../../../shared/nodeslide';
import { NodeSlideMemoryDialog } from './NodeSlideMemoryDialog';

const activeMemory: NodeSlideAgentMemory = {
  id: 'memory-1',
  deckId: 'deck-1',
  category: 'preference',
  content: 'Prefer concise executive headlines and cite every market claim.',
  status: 'active',
  source: 'user',
  contentDigest: 'sha256:abc',
  createdAt: Date.parse('2026-07-10T16:00:00.000Z'),
  updatedAt: Date.parse('2026-07-11T17:30:00.000Z'),
  lastUsedAt: Date.parse('2026-07-12T18:45:00.000Z'),
  useCount: 2,
};

const archivedMemory: NodeSlideAgentMemory = {
  id: 'memory-2',
  deckId: 'deck-1',
  category: 'decision',
  content: 'Lead with the operating decision before the market context.',
  status: 'archived',
  source: 'agent',
  sourceRunId: 'run_1234567890abcdef',
  contentDigest: 'sha256:def',
  createdAt: Date.parse('2026-07-08T12:00:00.000Z'),
  updatedAt: Date.parse('2026-07-09T13:00:00.000Z'),
  useCount: 0,
};

beforeAll(() => {
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface RenderMemoryDialogOptions {
  memories?: readonly NodeSlideAgentMemory[];
  loading?: boolean;
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  onClose?: () => void;
  onCreate?: (category: NodeSlideAgentMemory['category'], content: string) => Promise<void>;
  onUpdate?: (
    memoryId: string,
    update: Partial<Pick<NodeSlideAgentMemory, 'category' | 'content' | 'status'>>,
  ) => Promise<void>;
  onDelete?: (memoryId: string) => Promise<void>;
}

function renderMemoryDialog({
  memories = [activeMemory, archivedMemory],
  loading = false,
  enabled = true,
  onEnabledChange = vi.fn(),
  onClose = vi.fn(),
  onCreate = vi.fn().mockResolvedValue(undefined),
  onUpdate = vi.fn().mockResolvedValue(undefined),
  onDelete = vi.fn().mockResolvedValue(undefined),
}: RenderMemoryDialogOptions = {}) {
  return render(
    <NodeSlideMemoryDialog
      open
      memories={memories}
      loading={loading}
      enabled={enabled}
      onEnabledChange={onEnabledChange}
      onClose={onClose}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
    />,
  );
}

describe('NodeSlide memory manager', () => {
  it('discloses deck scope, provenance, lifecycle timestamps, use, and retention', async () => {
    const user = userEvent.setup();
    renderMemoryDialog();

    expect(
      screen.getByRole('dialog', { name: 'What should this agent remember?' }),
    ).toHaveAccessibleDescription('Manage persistent, owner-only memory for this deck.');

    const disclosure = screen.getByTestId('memory-scope-disclosure');
    expect(disclosure).toHaveTextContent('Deck-scoped, not account-wide');
    expect(disclosure).toHaveTextContent('owner-gated');
    const disclosureTrigger = within(disclosure).getByRole('button', {
      name: /Deck-scoped, not account-wide/,
    });
    expect(disclosureTrigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(disclosureTrigger);
    expect(disclosureTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(disclosure).toHaveTextContent('Only relevant active memory can be used in a new run');
    expect(disclosure).toHaveTextContent('retained until you delete them');
    expect(disclosure).toHaveTextContent(
      'Public shares and exported snapshots never include memory',
    );
    expect(disclosure).toHaveTextContent('Trace stores memory IDs and digests, not memory text');

    const activeCard = screen.getByText(activeMemory.content).closest('article');
    expect(activeCard).not.toBeNull();
    expect(activeCard).toHaveTextContent('Category: Preference');
    expect(activeCard).toHaveTextContent('Source: Deck owner');
    expect(activeCard).toHaveTextContent('Status: Active');
    expect(activeCard).toHaveTextContent('Usage: 2 runs');
    expect(activeCard).toHaveTextContent('Captured:');
    expect(activeCard).toHaveTextContent('Updated:');
    expect(activeCard).toHaveTextContent('Last used:');
    expect(activeCard).toHaveTextContent(
      'Retention: Stored until permanently deleted. Archiving keeps it stored but excludes it from runs.',
    );

    const timestamps = activeCard?.querySelectorAll('time') ?? [];
    expect(timestamps).toHaveLength(3);
    expect(timestamps[0]).toHaveAttribute(
      'datetime',
      new Date(activeMemory.createdAt).toISOString(),
    );
    expect(timestamps[1]).toHaveAttribute(
      'datetime',
      new Date(activeMemory.updatedAt).toISOString(),
    );
    expect(timestamps[2]).toHaveAttribute(
      'datetime',
      new Date(activeMemory.lastUsedAt ?? 0).toISOString(),
    );

    const memoryToggle = screen.getByRole('checkbox', {
      name: 'Use relevant memory in new runs',
    });
    expect(memoryToggle).toBeChecked();
    expect(memoryToggle).toHaveAccessibleDescription(
      /each new run may retrieve only relevant active entries/i,
    );

    await user.click(screen.getByRole('tab', { name: /Archived 1/i }));
    const archivedCard = screen.getByText(archivedMemory.content).closest('article');
    expect(archivedCard).not.toBeNull();
    expect(archivedCard).toHaveTextContent('Category: Decision');
    expect(archivedCard).toHaveTextContent('Source: Agent');
    expect(archivedCard).toHaveTextContent('Status: Archived');
    expect(archivedCard).toHaveTextContent('Usage: Never used');
    expect(archivedCard).toHaveTextContent('Last used: Never');
    expect(archivedCard).toHaveTextContent(
      'Retention: Still stored until permanently deleted. It cannot be used unless you restore it.',
    );
    expect(within(archivedCard as HTMLElement).getByText(/Source: Agent/)).toHaveAttribute(
      'title',
      archivedMemory.sourceRunId,
    );
    expect(archivedCard?.querySelectorAll('time')).toHaveLength(2);
  });

  it('supports keyboard-complete tabs, editing, confirmation, and dialog dismissal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    renderMemoryDialog({ onClose, onUpdate });

    const composer = screen.getByRole('textbox', { name: 'Memory text' });
    expect(composer).toHaveFocus();

    const activeTab = screen.getByRole('tab', { name: /Active 1/i });
    const archivedTab = screen.getByRole('tab', { name: /Archived 1/i });
    expect(activeTab).toHaveAttribute('aria-controls', 'ns-memory-active-panel');
    expect(activeTab).toHaveAttribute('aria-selected', 'true');
    expect(archivedTab).toHaveAttribute('aria-selected', 'false');

    activeTab.focus();
    await user.keyboard('{ArrowRight}');
    expect(archivedTab).toHaveFocus();
    expect(archivedTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Archived 1');

    await user.keyboard('{ArrowLeft}');
    expect(activeTab).toHaveFocus();
    expect(activeTab).toHaveAttribute('aria-selected', 'true');

    const archiveButton = screen.getByRole('button', {
      name: `Archive memory: ${activeMemory.content}`,
    });
    await user.click(archiveButton);
    const archiveConfirmation = screen.getByRole('alertdialog', { name: 'Archive this memory?' });
    expect(archiveConfirmation).toHaveTextContent(
      'It stays stored in this deck and can be restored, but archived memory is excluded from new runs.',
    );
    expect(screen.getByRole('button', { name: 'Confirm archive' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('alertdialog', { name: 'Archive this memory?' }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: `Archive memory: ${activeMemory.content}` }),
      ).toHaveFocus(),
    );
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    const editButton = screen.getByRole('button', {
      name: `Edit memory: ${activeMemory.content}`,
    });
    await user.click(editButton);
    const editInput = screen.getByRole('textbox', {
      name: `Edit memory: ${activeMemory.content}`,
    });
    expect(editInput).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: /^Edit memory:/ })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: `Edit memory: ${activeMemory.content}` }),
      ).toHaveFocus(),
    );

    composer.focus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('explains loading and empty states and disables use without active memory', () => {
    const { rerender } = renderMemoryDialog({ memories: [], loading: true, enabled: false });

    expect(screen.getByRole('status')).toHaveTextContent('Loading deck memory…');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-busy', 'true');

    rerender(
      <NodeSlideMemoryDialog
        open
        memories={[]}
        enabled={false}
        onEnabledChange={() => undefined}
        onClose={() => undefined}
        onCreate={async () => undefined}
        onUpdate={async () => undefined}
        onDelete={async () => undefined}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('No active memory yet');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Nothing will be retrieved until you add or restore an active memory.',
    );
    const memoryToggle = screen.getByRole('checkbox', {
      name: 'Use relevant memory in new runs',
    });
    expect(memoryToggle).toBeDisabled();
    expect(memoryToggle).toHaveAccessibleDescription(
      'Unavailable until this deck has an active entry. Archived entries remain stored.',
    );
  });

  it('changes use only from the explicit toggle and keeps long-running creation recoverable', async () => {
    const user = userEvent.setup();
    const createRequest = deferred();
    const onEnabledChange = vi.fn();
    const onCreate = vi.fn(() => createRequest.promise);
    render(<EnabledMemoryHarness onEnabledChange={onEnabledChange} onCreate={onCreate} />);

    const memoryToggle = screen.getByRole('checkbox', {
      name: 'Use relevant memory in new runs',
    });
    await user.click(memoryToggle);
    expect(memoryToggle).toBeChecked();
    expect(screen.getByText(/Memory use enabled for future runs/)).toBeInTheDocument();
    await user.click(memoryToggle);
    expect(memoryToggle).not.toBeChecked();
    expect(screen.getByText(/Memory use disabled for future runs/)).toBeInTheDocument();

    const draft = 'Use a one-sentence executive summary.';
    const memoryInput = screen.getByRole('textbox', { name: 'Memory text' });
    await user.type(memoryInput, draft);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(onCreate).toHaveBeenCalledWith('preference', draft);
    expect(screen.getByRole('status')).toHaveTextContent('Saving new memory…');
    expect(screen.getByRole('status')).toHaveTextContent(
      'If this view is interrupted, reopen Deck memory and verify the current state before retrying.',
    );
    expect(memoryInput).toBeDisabled();
    expect(memoryInput).toHaveValue(draft);
    expect(screen.getByRole('button', { name: /Adding/ })).toBeDisabled();

    await act(async () => createRequest.resolve());

    await waitFor(() => expect(memoryInput).toHaveValue(''));
    expect(memoryToggle).not.toBeChecked();
    expect(onEnabledChange.mock.calls).toEqual([[true], [false]]);
    expect(screen.getByText(/Memory use was not changed/)).toBeInTheDocument();
  });

  it('confirms and applies archive, restore, and permanent-delete state transitions', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<LifecycleHarness onUpdate={onUpdate} onDelete={onDelete} />);

    await user.click(
      screen.getByRole('button', { name: `Archive memory: ${activeMemory.content}` }),
    );
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Archive this memory?' })).toHaveTextContent(
      'stays stored in this deck and can be restored',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm archive' }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(activeMemory.id, { status: 'archived' }),
    );
    expect(screen.queryByText(activeMemory.content)).not.toBeInTheDocument();
    expect(screen.getByText(/Memory archived. It remains stored/)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Archived 2/i }));
    const archivedCard = screen.getByText(archivedMemory.content).closest('article');
    expect(archivedCard).not.toBeNull();
    await user.click(
      within(archivedCard as HTMLElement).getByRole('button', {
        name: `Restore memory: ${archivedMemory.content}`,
      }),
    );
    expect(screen.getByRole('alertdialog', { name: 'Restore this memory?' })).toHaveTextContent(
      'eligible for relevance matching because memory use is on',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm restore' }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(archivedMemory.id, { status: 'active' }),
    );
    expect(screen.queryByText(archivedMemory.content)).not.toBeInTheDocument();
    expect(screen.getByText(/Memory restored as Active/)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Active 1/i }));
    const restoredCard = screen.getByText(archivedMemory.content).closest('article');
    expect(restoredCard).not.toBeNull();
    await user.click(
      within(restoredCard as HTMLElement).getByRole('button', {
        name: `Delete memory permanently: ${archivedMemory.content}`,
      }),
    );
    expect(
      screen.getByRole('alertdialog', { name: 'Delete this memory permanently?' }),
    ).toHaveTextContent('cannot be undone');
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(archivedMemory.id));
    expect(screen.queryByText(archivedMemory.content)).not.toBeInTheDocument();
    expect(screen.getByText(/Memory deleted permanently/)).toBeInTheDocument();
  });

  it('keeps a failed long-running transition retryable and tells the user how to recover', async () => {
    const user = userEvent.setup();
    const updateRequest = deferred();
    const onUpdate = vi
      .fn()
      .mockImplementationOnce(() => updateRequest.promise)
      .mockResolvedValueOnce(undefined);
    renderMemoryDialog({ memories: [activeMemory], onUpdate });

    await user.click(
      screen.getByRole('button', { name: `Archive memory: ${activeMemory.content}` }),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm archive' }));

    expect(screen.getByRole('status')).toHaveTextContent('Archiving memory…');
    expect(screen.getByRole('status')).toHaveTextContent(
      'reopen Deck memory and verify the current state before retrying',
    );
    expect(screen.getByRole('button', { name: /Archiving/ })).toBeDisabled();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-busy', 'true');

    await act(async () => updateRequest.reject(new Error('Memory service is unavailable.')));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Memory service is unavailable.');
    expect(alert).toHaveTextContent('Your confirmation remains here.');
    expect(alert).toHaveTextContent(
      'reopen Deck memory and verify its current status before retrying',
    );
    expect(screen.getByRole('alertdialog', { name: 'Archive this memory?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm archive' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Confirm archive' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole('alertdialog', { name: 'Archive this memory?' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Memory archived. It remains stored/)).toBeInTheDocument();
  });

  it('surfaces create failures without enabling memory or losing the draft', async () => {
    const user = userEvent.setup();
    const onEnabledChange = vi.fn();
    const onCreate = vi.fn().mockRejectedValue(new Error('Memory service is unavailable.'));
    renderMemoryDialog({ memories: [], enabled: false, onEnabledChange, onCreate });

    const draft = 'Use a one-sentence executive summary.';
    await user.type(screen.getByRole('textbox', { name: 'Memory text' }), draft);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Memory service is unavailable.');
    expect(alert).toHaveTextContent('Your draft is still here.');
    expect(alert).toHaveTextContent('verify whether it was saved before retrying');
    expect(onCreate).toHaveBeenCalledWith('preference', draft);
    expect(onEnabledChange).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Memory text' })).toHaveValue(draft);
  });
});

function EnabledMemoryHarness({
  onEnabledChange,
  onCreate,
}: {
  onEnabledChange: (enabled: boolean) => void;
  onCreate: (category: NodeSlideAgentMemory['category'], content: string) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(false);
  return (
    <NodeSlideMemoryDialog
      open
      memories={[activeMemory]}
      enabled={enabled}
      onEnabledChange={(nextEnabled) => {
        setEnabled(nextEnabled);
        onEnabledChange(nextEnabled);
      }}
      onClose={() => undefined}
      onCreate={onCreate}
      onUpdate={async () => undefined}
      onDelete={async () => undefined}
    />
  );
}

function LifecycleHarness({
  onUpdate,
  onDelete,
}: {
  onUpdate: (
    memoryId: string,
    update: Partial<Pick<NodeSlideAgentMemory, 'category' | 'content' | 'status'>>,
  ) => Promise<void>;
  onDelete: (memoryId: string) => Promise<void>;
}) {
  const [memories, setMemories] = useState<NodeSlideAgentMemory[]>([activeMemory, archivedMemory]);
  return (
    <NodeSlideMemoryDialog
      open
      memories={memories}
      enabled
      onEnabledChange={() => undefined}
      onClose={() => undefined}
      onCreate={async () => undefined}
      onUpdate={async (memoryId, update) => {
        await onUpdate(memoryId, update);
        setMemories((current) =>
          current.map((memory) => (memory.id === memoryId ? { ...memory, ...update } : memory)),
        );
      }}
      onDelete={async (memoryId) => {
        await onDelete(memoryId);
        setMemories((current) => current.filter((memory) => memory.id !== memoryId));
      }}
    />
  );
}

function deferred() {
  let resolvePromise: () => void = () => undefined;
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = () => resolve();
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}
