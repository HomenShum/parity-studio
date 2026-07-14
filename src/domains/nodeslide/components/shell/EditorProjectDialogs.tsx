import { useState } from 'react';
import { removeDeckOwnerAccessKey } from '../../../../lib/sessionIdentity';
import { DeleteDeckDialog } from '../DeleteDeckDialog';
import { NodeSlideConnectionsDialog } from '../NodeSlideConnectionsDialog';
import {
  type OwnerCapabilityRecovery,
  OwnerCapabilityRecoveryDialog,
} from '../OwnerCapabilityRecoveryDialog';

type DeleteDeckMutation = (args: { deckId: string; ownerAccessKey: string }) => Promise<unknown>;

interface DeckDeletionActionProps {
  open: boolean;
  deckId: string;
  deckTitle: string;
  ownerAccessKey: string;
  deleteDeck: DeleteDeckMutation;
  onClose: () => void;
  removeOwnerCapability?: (deckId: string) => unknown;
  navigate?: (path: string) => void;
}

/** Owns the fail-open delete flow while the existing confirmation dialog owns exact-title input. */
export function DeckDeletionAction({ open, ...props }: DeckDeletionActionProps) {
  if (!open) return null;
  return <OpenDeckDeletionAction key={props.deckId} {...props} />;
}

function OpenDeckDeletionAction({
  deckId,
  deckTitle,
  ownerAccessKey,
  deleteDeck,
  onClose,
  removeOwnerCapability = removeDeckOwnerAccessKey,
  navigate = (path) => window.location.assign(path),
}: Omit<DeckDeletionActionProps, 'open'>) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const confirmDeletion = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteDeck({ deckId, ownerAccessKey });
      removeOwnerCapability(deckId);
      navigate('/');
    } catch (error) {
      setDeleteError(deleteErrorMessage(error, 'Deck could not be deleted. Try again.'));
      setDeleting(false);
    }
  };

  return (
    <DeleteDeckDialog
      open
      deckTitle={deckTitle}
      deleting={deleting}
      error={deleteError}
      onCancel={onClose}
      onConfirm={() => void confirmDeletion()}
    />
  );
}

interface EditorProjectDialogsProps {
  deckId: string;
  deckTitle: string;
  ownerAccessKey: string;
  connectionsOpen: boolean;
  deleteDeckOpen: boolean;
  projectsOpen: boolean;
  ownerRecovery: OwnerCapabilityRecovery | null;
  deleteDeck: DeleteDeckMutation;
  onCloseConnections: () => void;
  onCloseDeleteDeck: () => void;
  onCloseRecovery: () => void;
}

/** Keeps editor project actions bound to the active deck instead of a stale URL parameter. */
export function EditorProjectDialogs({
  deckId,
  deckTitle,
  ownerAccessKey,
  connectionsOpen,
  deleteDeckOpen,
  projectsOpen,
  ownerRecovery,
  deleteDeck,
  onCloseConnections,
  onCloseDeleteDeck,
  onCloseRecovery,
}: EditorProjectDialogsProps) {
  return (
    <>
      <NodeSlideConnectionsDialog
        open={connectionsOpen}
        onClose={onCloseConnections}
        deckId={deckId}
      />
      <OwnerCapabilityRecoveryDialog
        open={Boolean(ownerRecovery) && !projectsOpen}
        recovery={ownerRecovery}
        onClose={onCloseRecovery}
      />
      <DeckDeletionAction
        open={deleteDeckOpen}
        deckId={deckId}
        deckTitle={deckTitle}
        ownerAccessKey={ownerAccessKey}
        deleteDeck={deleteDeck}
        onClose={onCloseDeleteDeck}
      />
    </>
  );
}

function deleteErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
      return data.message;
    }
  }
  return error instanceof Error ? error.message : fallback;
}
