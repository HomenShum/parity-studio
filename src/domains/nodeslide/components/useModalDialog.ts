import type { MouseEvent as ReactMouseEvent, RefObject, SyntheticEvent } from 'react';
import { useModalSurface } from './overlayPrimitives';

interface UseModalDialogOptions {
  open: boolean;
  onClose: () => void;
  initialFocusRef: RefObject<HTMLElement | null>;
}

/**
 * Keeps a React-controlled dialog in the browser's modal top layer while `open` is true.
 * The caller remains responsible for updating `open` from `onClose`.
 */
export function useModalDialog({ open, onClose, initialFocusRef }: UseModalDialogOptions) {
  const { surfaceRef: dialogRef, handleKeyDown } = useModalSurface<HTMLDialogElement>({
    open,
    onClose,
    initialFocusRef,
    activate: showNativeModal,
    deactivate: closeNativeModal,
  });

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  const handleBackdropMouseDown = (event: ReactMouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const outsideDialog =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;
    if (outsideDialog) onClose();
  };

  return {
    dialogRef,
    handleBackdropMouseDown,
    handleCancel,
    handleKeyDown,
  };
}

function showNativeModal(dialog: HTMLDialogElement) {
  if (!dialog.open) dialog.showModal();
}

function closeNativeModal(dialog: HTMLDialogElement) {
  if (dialog.open) dialog.close();
}
