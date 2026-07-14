import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

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

interface FocusTarget {
  focus: (options?: FocusOptions) => void;
}

interface RestorableFocusTarget extends FocusTarget {
  isConnected: boolean;
}

interface InertRecord {
  element: HTMLElement;
  inert: boolean;
  ariaHidden: string | null;
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      element.getClientRects().length > 0 &&
      !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
      !element.matches(':disabled'),
  );
}

export function focusWithoutScrolling(target: FocusTarget | null | undefined): boolean {
  if (!target) return false;
  target.focus({ preventScroll: true });
  return true;
}

export function restoreConnectedFocus(target: RestorableFocusTarget | null | undefined): boolean {
  if (!target?.isConnected) return false;
  return focusWithoutScrolling(target);
}

export function getFocusLoopTarget<T>(
  elements: readonly T[],
  activeElement: T | null,
  backwards: boolean,
): T | null {
  if (elements.length === 0) return null;
  const activeIndex = activeElement === null ? -1 : elements.indexOf(activeElement);
  const lastIndex = elements.length - 1;
  if (backwards && activeIndex <= 0) return elements[lastIndex] ?? null;
  if (!backwards && (activeIndex === -1 || activeIndex === lastIndex)) return elements[0] ?? null;
  return null;
}

export function getRovingFocusIndex(
  itemCount: number,
  currentIndex: number,
  key: string,
): number | null {
  if (itemCount <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;
  if (key === 'ArrowDown' || key === 'ArrowRight')
    return (currentIndex + 1 + itemCount) % itemCount;
  if (key === 'ArrowUp' || key === 'ArrowLeft') {
    return (currentIndex - 1 + itemCount) % itemCount;
  }
  return null;
}

export function getModalSurfaceKeyAction(
  key: string,
  isComposing: boolean,
): 'close' | 'trap-focus' | null {
  if (key === 'Escape' && !isComposing) return 'close';
  if (key === 'Tab') return 'trap-focus';
  return null;
}

export function useViewportMatch(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useLayoutEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}

interface UseModalSurfaceOptions<T extends HTMLElement> {
  open: boolean;
  onClose: () => void;
  initialFocusRef: RefObject<HTMLElement | null>;
  activate?: (surface: T) => void;
  deactivate?: (surface: T) => void;
  inertRootSelector?: string;
  shouldRestoreFocusRef?: RefObject<boolean>;
}

export function useModalSurface<T extends HTMLElement>({
  open,
  onClose,
  initialFocusRef,
  activate,
  deactivate,
  inertRootSelector,
  shouldRestoreFocusRef,
}: UseModalSurfaceOptions<T>) {
  const surfaceRef = useRef<T>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const activateRef = useRef(activate);
  const deactivateRef = useRef(deactivate);
  onCloseRef.current = onClose;
  activateRef.current = activate;
  deactivateRef.current = deactivate;

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!open || !surface) return;

    const activeElement = document.activeElement;
    returnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    activateRef.current?.(surface);
    const releaseInert = inertRootSelector
      ? makeOutsideSurfaceInert(surface, inertRootSelector)
      : undefined;

    const initialFocus = initialFocusRef.current;
    if (initialFocus && surface.contains(initialFocus) && !initialFocus.matches(':disabled')) {
      focusWithoutScrolling(initialFocus);
    } else {
      focusWithoutScrolling(getFocusableElements(surface)[0] ?? surface);
    }

    return () => {
      releaseInert?.();
      deactivateRef.current?.(surface);
      const returnFocus = returnFocusRef.current;
      returnFocusRef.current = null;
      if (shouldRestoreFocusRef?.current ?? true) restoreConnectedFocus(returnFocus);
    };
  }, [inertRootSelector, initialFocusRef, open, shouldRestoreFocusRef]);

  const handleKeyDown = (event: ReactKeyboardEvent<T>) => {
    if (event.defaultPrevented) return;
    const action = getModalSurfaceKeyAction(event.key, event.nativeEvent.isComposing);
    if (action === 'close') {
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (action !== 'trap-focus') return;

    event.stopPropagation();
    const surface = surfaceRef.current;
    if (!surface) return;
    const focusableElements = getFocusableElements(surface);
    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const nextFocus = getFocusLoopTarget(focusableElements, activeElement, event.shiftKey);
    if (!nextFocus) return;
    event.preventDefault();
    focusWithoutScrolling(nextFocus);
  };

  return { surfaceRef, handleKeyDown };
}

export function useDrawerSurface<T extends HTMLElement = HTMLElement>({
  open,
  onClose,
  initialFocusRef,
  shouldRestoreFocusRef,
}: Pick<UseModalSurfaceOptions<T>, 'open' | 'onClose' | 'initialFocusRef'> & {
  shouldRestoreFocusRef?: RefObject<boolean>;
}) {
  return useModalSurface<T>({
    open,
    onClose,
    initialFocusRef,
    inertRootSelector: '.nodeslide-studio',
    ...(shouldRestoreFocusRef ? { shouldRestoreFocusRef } : {}),
  });
}

interface OverlayBackdropProps {
  open: boolean;
  className?: string;
  onDismiss: () => void;
}

export function OverlayBackdrop({ open, className = '', onDismiss }: OverlayBackdropProps) {
  if (!open) return null;
  return (
    <div
      className={`ns-overlay-backdrop ${className}`.trim()}
      data-ns-overlay-exempt=""
      data-open="true"
      role="presentation"
      aria-hidden="true"
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    />
  );
}

interface PopoverSurfaceProps {
  open: boolean;
  id: string;
  surfaceRole: 'dialog' | 'menu';
  ariaLabel: string;
  className: string;
  triggerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}

export function PopoverSurface({
  open,
  id,
  surfaceRole,
  ariaLabel,
  className,
  triggerRef,
  onClose,
  children,
}: PopoverSurfaceProps) {
  const surfaceRef = useRef<HTMLDialogElement | HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef(true);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!open || !surface) return;
    restoreFocusRef.current = true;

    const initialFocus =
      surfaceRole === 'menu'
        ? surface.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
        : surface;
    focusWithoutScrolling(initialFocus ?? surface);

    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (surface.contains(target) || triggerRef.current?.contains(target)) return;
      restoreFocusRef.current = false;
      onCloseRef.current();
    };
    const dismissOnFocusExit = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (surface.contains(target) || triggerRef.current?.contains(target)) return;
      restoreFocusRef.current = false;
      onCloseRef.current();
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOnFocusExit);

    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOnFocusExit);
      if (restoreFocusRef.current) restoreConnectedFocus(triggerRef.current);
    };
  }, [open, surfaceRole, triggerRef]);

  if (!open) return null;
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      restoreFocusRef.current = true;
      onCloseRef.current();
      return;
    }
    if (surfaceRole !== 'menu') return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      ),
    ).filter((item) => !item.matches(':disabled'));
    const activeIndex =
      document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1;
    const nextIndex = getRovingFocusIndex(items.length, activeIndex, event.key);
    if (nextIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    focusWithoutScrolling(items[nextIndex]);
  };

  if (surfaceRole === 'dialog') {
    return (
      <dialog
        ref={surfaceRef as RefObject<HTMLDialogElement>}
        open
        id={id}
        className={className}
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {children}
      </dialog>
    );
  }

  return (
    <div
      ref={surfaceRef as RefObject<HTMLDivElement>}
      id={id}
      className={className}
      role="menu"
      aria-label={ariaLabel}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
}

function makeOutsideSurfaceInert(surface: HTMLElement, rootSelector: string) {
  const root = surface.closest<HTMLElement>(rootSelector);
  if (!root) return () => undefined;

  const records: InertRecord[] = [];
  let current: HTMLElement | null = surface;
  while (current && current !== root) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      if (!(sibling instanceof HTMLElement) || sibling === current) continue;
      if (sibling.hasAttribute('data-ns-overlay-exempt')) continue;
      records.push({
        element: sibling,
        inert: sibling.inert,
        ariaHidden: sibling.getAttribute('aria-hidden'),
      });
      sibling.inert = true;
      sibling.setAttribute('aria-hidden', 'true');
    }
    current = parent;
  }

  return () => {
    for (const record of records) {
      record.element.inert = record.inert;
      if (record.ariaHidden === null) record.element.removeAttribute('aria-hidden');
      else record.element.setAttribute('aria-hidden', record.ariaHidden);
    }
  };
}
