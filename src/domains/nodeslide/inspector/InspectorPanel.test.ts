import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectorTabAfterKey, rememberInspectorTab } from './InspectorPanel';
import type { InspectorTab } from './types';

const source = readFileSync(new URL('./InspectorPanel.tsx', import.meta.url), 'utf8');

describe('NodeSlide inspector shell state', () => {
  it('implements automatic, wrapping roving focus for all inspector tabs', () => {
    expect(inspectorTabAfterKey('ai', 'ArrowLeft')).toBe('trace');
    expect(inspectorTabAfterKey('trace', 'ArrowRight')).toBe('ai');
    expect(inspectorTabAfterKey('comments', 'Home')).toBe('ai');
    expect(inspectorTabAfterKey('comments', 'End')).toBe('trace');
    expect(inspectorTabAfterKey('comments', 'Enter')).toBeNull();
  });

  it('retains every visited tab so switching or collapsing does not destroy drafts', () => {
    const mounted = new Set<InspectorTab>();

    rememberInspectorTab(mounted, 'ai');
    rememberInspectorTab(mounted, 'comments');
    rememberInspectorTab(mounted, 'ai');

    expect([...mounted]).toEqual(['ai', 'comments']);
    expect(source).toContain("mountedTabsRef.current.has('ai')");
    expect(source).toContain('hidden={activeTab !== id}');
    expect(source).toContain('hidden={collapsed} inert={collapsed}');
    expect(source).not.toMatch(/if \(collapsed\)\s*\{\s*return/);
  });

  it('binds the responsive drawer to modal labeling, backdrop, focus, and Escape handling', () => {
    expect(source).toContain("role={drawerOpen ? 'dialog' : undefined}");
    expect(source).toContain('aria-modal={drawerOpen ? true : undefined}');
    expect(source).toContain('initialFocusRef: closeButtonRef');
    expect(source).toContain('onKeyDown={drawerOpen ? handleDrawerKeyDown : undefined}');
    expect(source).toContain('<OverlayBackdrop');
  });
});
