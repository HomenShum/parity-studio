import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type SyntheticEvent,
  useLayoutEffect,
  useRef,
} from 'react';

interface UseModalDialogOptions {
  open: boolean;
  onClose: () => void;
  initialFocusRef: RefObject<HTMLElement | null>;
}

const focusableSelector = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(dialog: HTMLDialogElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
      !element.matches(':disabled'),
  );
}

function focusWithoutScrolling(element: HTMLElement) {
  element.focus({ preventScroll: true });
}

/**
 * Keeps a React-controlled dialog in the browser's modal top layer while `open` is true.
 * The caller remains responsible for updating `open` from `onClose`.
 */
export function useModalDialog({ open, onClose, initialFocusRef }: UseModalDialogOptions) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    const activeElement = document.activeElement;
    returnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;

    if (!dialog.open) dialog.showModal();

    const initialFocus = initialFocusRef.current;
    if (initialFocus && dialog.contains(initialFocus) && !initialFocus.matches(':disabled')) {
      focusWithoutScrolling(initialFocus);
    } else {
      const firstFocusable = getFocusableElements(dialog)[0];
      focusWithoutScrolling(firstFocusable ?? dialog);
    }

    return () => {
      if (dialog.open) dialog.close();

      const returnFocus = returnFocusRef.current;
      returnFocusRef.current = null;
      if (returnFocus?.isConnected) focusWithoutScrolling(returnFocus);
    };
  }, [initialFocusRef, open]);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    onCloseRef.current();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusableElements = getFocusableElements(dialog);
    if (focusableElements.length === 0) {
      event.preventDefault();
      focusWithoutScrolling(dialog);
      return;
    }

    const activeIndex =
      document.activeElement instanceof HTMLElement
        ? focusableElements.indexOf(document.activeElement)
        : -1;
    const lastIndex = focusableElements.length - 1;
    const shouldWrapBackward = event.shiftKey && activeIndex <= 0;
    const shouldWrapForward = !event.shiftKey && (activeIndex === -1 || activeIndex === lastIndex);

    if (shouldWrapBackward || shouldWrapForward) {
      event.preventDefault();
      const nextFocus = shouldWrapBackward ? focusableElements[lastIndex] : focusableElements[0];
      if (nextFocus) focusWithoutScrolling(nextFocus);
    }
  };

  const handleBackdropMouseDown = (event: ReactMouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const outsideDialog =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;
    if (outsideDialog) onCloseRef.current();
  };

  return {
    dialogRef,
    handleBackdropMouseDown,
    handleCancel,
    handleKeyDown,
  };
}
