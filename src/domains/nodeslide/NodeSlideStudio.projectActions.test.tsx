// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { Children, type ReactElement, type ReactNode, isValidElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

const studioSource = readFileSync('src/domains/nodeslide/NodeSlideStudio.tsx', 'utf8');

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
