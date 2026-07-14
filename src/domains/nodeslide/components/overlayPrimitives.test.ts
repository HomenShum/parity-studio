import { describe, expect, it, vi } from 'vitest';
import {
  focusWithoutScrolling,
  getFocusLoopTarget,
  getModalSurfaceKeyAction,
  getRovingFocusIndex,
  restoreConnectedFocus,
} from './overlayPrimitives';

describe('NodeSlide overlay interaction primitives', () => {
  it('traps focus at both edges without disturbing focus in the middle', () => {
    const items = ['close', 'first-control', 'last-control'] as const;

    expect(getFocusLoopTarget(items, 'last-control', false)).toBe('close');
    expect(getFocusLoopTarget(items, 'close', true)).toBe('last-control');
    expect(getFocusLoopTarget(items, 'first-control', false)).toBeNull();
    expect(getFocusLoopTarget([], null, false)).toBeNull();
  });

  it('gives drawers one Escape and Tab contract while ignoring IME composition', () => {
    expect(getModalSurfaceKeyAction('Escape', false)).toBe('close');
    expect(getModalSurfaceKeyAction('Escape', true)).toBeNull();
    expect(getModalSurfaceKeyAction('Tab', false)).toBe('trap-focus');
    expect(getModalSurfaceKeyAction('Enter', false)).toBeNull();
  });

  it('supports wrapped roving focus for menus and inspector tabs', () => {
    expect(getRovingFocusIndex(4, 3, 'ArrowRight')).toBe(0);
    expect(getRovingFocusIndex(4, 0, 'ArrowLeft')).toBe(3);
    expect(getRovingFocusIndex(4, 2, 'Home')).toBe(0);
    expect(getRovingFocusIndex(4, 1, 'End')).toBe(3);
    expect(getRovingFocusIndex(4, 1, 'Enter')).toBeNull();
  });

  it('restores focus only to a still-connected opener and prevents scroll jumps', () => {
    const connectedFocus = vi.fn();
    const disconnectedFocus = vi.fn();

    expect(restoreConnectedFocus({ isConnected: true, focus: connectedFocus })).toBe(true);
    expect(connectedFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(restoreConnectedFocus({ isConnected: false, focus: disconnectedFocus })).toBe(false);
    expect(disconnectedFocus).not.toHaveBeenCalled();
    expect(focusWithoutScrolling(null)).toBe(false);
  });
});
