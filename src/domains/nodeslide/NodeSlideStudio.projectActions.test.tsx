// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { Children, type ReactElement, type ReactNode, isValidElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NodeSlideWorkspace } from '../../../shared/nodeslide';
import {
  getDeckOwnerAccessKey,
  listStoredDeckAccess,
  storeDeckOwnerAccessKey,
} from '../../lib/sessionIdentity';
import { DeckDeletionAction, EditorProjectDialogs } from './NodeSlideStudio';
import { NodeSlideConnectionsDialog } from './components/NodeSlideConnectionsDialog';
import {
  type OwnerCapabilityRecovery,
  OwnerCapabilityRecoveryDialog,
} from './components/OwnerCapabilityRecoveryDialog';
import { runFocusedEditorMutation } from './components/shell/editorActions';

const studioSource = readFileSync('src/domains/nodeslide/NodeSlideStudio.tsx', 'utf8');
const projectDialogSource = readFileSync(
  'src/domains/nodeslide/components/shell/EditorProjectDialogs.tsx',
  'utf8',
);

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('NodeSlide editor project actions', () => {
  it('allows publish-safe file export while preserving nonblocking fidelity notes', () => {
    expect(studioSource).toContain('if (!exportValidation.publishOk) {');
    expect(studioSource).not.toContain(
      'if (!exportValidation.publishOk || !exportValidation.cleanOk) {',
    );
    expect(studioSource).toContain('fidelity note');
  });

  it('binds Connections and normal-session recovery to the current editor deck', () => {
    const recovery: OwnerCapabilityRecovery = {
      deckId: 'deck:current',
      deckTitle: 'Current plan',
      ownerAccessKey: 'owner:current',
    };
    const tree = EditorProjectDialogs({
      deckId: 'deck:current',
      deckTitle: 'Current plan',
      ownerAccessKey: 'owner:current',
      connectionsOpen: true,
      deleteDeckOpen: false,
      projectsOpen: false,
      ownerRecovery: recovery,
      deleteDeck: async () => undefined,
      onCloseConnections: () => undefined,
      onCloseDeleteDeck: () => undefined,
      onCloseRecovery: () => undefined,
    }) as ReactElement<{ children: ReactNode }>;
    const children = Children.toArray(tree.props.children);
    const connections = findElement(children, NodeSlideConnectionsDialog);
    const recoveryDialog = findElement(children, OwnerCapabilityRecoveryDialog);

    expect(connections.props).toMatchObject({ open: true, deckId: 'deck:current' });
    expect(recoveryDialog.props).toMatchObject({ open: true, recovery });
  });

  it('requires the exact deck title and keeps a failed deletion open with its error', async () => {
    const user = userEvent.setup();
    const deleteDeck = vi.fn().mockRejectedValue(new Error('Deletion service unavailable.'));
    const removeOwnerCapability = vi.fn();
    const navigate = vi.fn();
    render(
      <DeckDeletionAction
        open
        deckId="deck:current"
        deckTitle="Current plan"
        ownerAccessKey="owner:current"
        deleteDeck={deleteDeck}
        onClose={() => undefined}
        removeOwnerCapability={removeOwnerCapability}
        navigate={navigate}
      />,
    );

    const confirmation = screen.getByTestId('delete-deck-confirmation');
    const confirm = screen.getByTestId('delete-deck-confirm');
    await user.type(confirmation, 'current plan');
    expect(confirm).toBeDisabled();

    await user.clear(confirmation);
    await user.type(confirmation, 'Current plan');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(await screen.findByRole('alert')).toHaveTextContent('Deletion service unavailable.');
    expect(screen.getByTestId('delete-deck-dialog')).toBeInTheDocument();
    expect(deleteDeck).toHaveBeenCalledWith({
      deckId: 'deck:current',
      ownerAccessKey: 'owner:current',
    });
    expect(removeOwnerCapability).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('removes only the deleted deck capability and navigates to the clean landing route', async () => {
    const user = userEvent.setup();
    const deleteDeck = vi.fn().mockResolvedValue({ deleted: true });
    const navigate = vi.fn();
    storeDeckOwnerAccessKey('deck:current', 'owner:current');
    storeDeckOwnerAccessKey('deck:other', 'owner:other');
    render(
      <DeckDeletionAction
        open
        deckId="deck:current"
        deckTitle="Current plan"
        ownerAccessKey="owner:current"
        deleteDeck={deleteDeck}
        onClose={() => undefined}
        navigate={navigate}
      />,
    );

    await user.type(screen.getByTestId('delete-deck-confirmation'), 'Current plan');
    await user.click(screen.getByTestId('delete-deck-confirm'));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    expect(getDeckOwnerAccessKey('deck:current')).toBeUndefined();
    expect(listStoredDeckAccess()).toEqual([
      { deckId: 'deck:other', ownerAccessKey: 'owner:other' },
    ]);
  });

  it('keeps Open deck recents-only and routes New deck to the prompt-first landing', () => {
    expect(studioSource.match(/<ProjectDialog/g)).toHaveLength(1);
    expect(studioSource).toContain('initialMode="open"');
    expect(studioSource).toContain('createEnabled={false}');
    expect(studioSource).not.toContain('initialMode="create"');
    expect(studioSource).toContain("onNewDeck={() => window.location.assign('/')}");
    expect(projectDialogSource).toContain('DeckDeletionAction');
  });
});

describe('NodeSlide focused direct text mutations', () => {
  it('persists an accepted slide-6 headline and restores its active selection', async () => {
    let workspace = focusedWorkspace('Original headline', 2, 4);
    let activeSlideId = 'slide-1';
    let selectedElementIds: string[] = [];

    const accepted = await runFocusedEditorMutation({
      focus: { slideId: 'slide-6', elementIds: ['headline-6'] },
      readWorkspace: () => workspace,
      mutate: async () => {
        expect(workspace.deck.version).toBe(2);
        expect(workspace.elements[0]?.version).toBe(4);
        workspace = focusedWorkspace('Decision-ready headline', 3, 5);
        return true;
      },
      restoreFocus: (focus) => {
        activeSlideId = focus.slideId;
        selectedElementIds = focus.elementIds;
      },
    });

    expect(accepted).toBe(true);
    expect(workspace.elements[0]).toMatchObject({
      id: 'headline-6',
      content: 'Decision-ready headline',
      version: 5,
    });
    expect(activeSlideId).toBe('slide-6');
    expect(selectedElementIds).toEqual(['headline-6']);
  });

  it('preserves slide-6 focus when the canonical CAS rejects a stale element version', async () => {
    const workspace = focusedWorkspace('Newer remote headline', 3, 5);
    let activeSlideId = 'slide-1';
    let selectedElementIds: string[] = [];

    const accepted = await runFocusedEditorMutation({
      focus: { slideId: 'slide-6', elementIds: ['headline-6'] },
      readWorkspace: () => workspace,
      mutate: async () => false,
      restoreFocus: (focus) => {
        activeSlideId = focus.slideId;
        selectedElementIds = focus.elementIds;
      },
    });

    expect(accepted).toBe(false);
    expect(activeSlideId).toBe('slide-6');
    expect(selectedElementIds).toEqual(['headline-6']);
    expect(workspace.elements[0]?.content).toBe('Newer remote headline');
  });

  it('preserves focus and reports an unexpected failed mutation instead of resetting', async () => {
    const workspace = focusedWorkspace('Original headline', 2, 4);
    let activeSlideId = 'slide-1';
    let selectedElementIds: string[] = [];
    const onUnexpectedFailure = vi.fn();

    const accepted = await runFocusedEditorMutation({
      focus: { slideId: 'slide-6', elementIds: ['headline-6'] },
      readWorkspace: () => workspace,
      mutate: async () => {
        throw new Error('Mutation service unavailable.');
      },
      restoreFocus: (focus) => {
        activeSlideId = focus.slideId;
        selectedElementIds = focus.elementIds;
      },
      onUnexpectedFailure,
    });

    expect(accepted).toBe(false);
    expect(onUnexpectedFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Mutation service unavailable.' }),
    );
    expect(activeSlideId).toBe('slide-6');
    expect(selectedElementIds).toEqual(['headline-6']);
  });

  it('keeps native blur edits on the canonical versioned patch path', () => {
    expect(studioSource).toContain('onReplaceText={(elementId, text, baseElementVersion) => {');
    expect(studioSource).toContain('applyFocusedOperations(');
    expect(studioSource).toContain(
      "[{ op: 'replace_text', slideId: element.slideId, elementId, text }]",
    );
    expect(studioSource).toContain('{ [elementId]: baseElementVersion }');
    expect(studioSource).toContain('baseDeckVersion: currentWorkspace.deck.version');
    expect(studioSource).toContain('baseSlideVersions: clocks.baseSlideVersions');
    expect(studioSource).toContain('baseElementVersions: applyExpectedElementVersions(');
  });
});

function findElement(
  children: readonly ReactNode[],
  type: ReactElement['type'],
): ReactElement<Record<string, unknown>> {
  const element = children.find((child) => isValidElement(child) && child.type === type);
  if (!isValidElement<Record<string, unknown>>(element)) {
    throw new Error('Expected project dialog element was not rendered.');
  }
  return element;
}

function focusedWorkspace(
  headline: string,
  deckVersion: number,
  elementVersion: number,
): NodeSlideWorkspace {
  return {
    deck: {
      id: 'deck-1',
      slideOrder: ['slide-1', 'slide-6'],
      version: deckVersion,
    },
    slides: [
      { id: 'slide-1', deckId: 'deck-1', elementOrder: [], version: 1 },
      { id: 'slide-6', deckId: 'deck-1', elementOrder: ['headline-6'], version: 2 },
    ],
    elements: [
      {
        id: 'headline-6',
        slideId: 'slide-6',
        kind: 'text',
        name: 'Headline',
        content: headline,
        version: elementVersion,
      },
    ],
    sources: [],
    comments: [],
    patches: [],
    versions: [],
    traces: [],
    validations: [],
    exports: [],
    presence: [],
    publication: null,
  } as unknown as NodeSlideWorkspace;
}
