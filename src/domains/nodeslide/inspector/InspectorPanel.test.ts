import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MORE_INSPECTOR_TABS,
  PRIMARY_INSPECTOR_TABS,
  inspectorTabAfterKey,
  primaryInspectorTabAfterKey,
  rememberInspectorTab,
} from './InspectorPanel';
import type { InspectorTab } from './types';

const source = readFileSync(new URL('./InspectorPanel.tsx', import.meta.url), 'utf8');
const aiSource = readFileSync(new URL('./AiInspector.tsx', import.meta.url), 'utf8');

describe('NodeSlide inspector shell state', () => {
  it('keeps five high-frequency views visible and moves Versions and JSON into More', () => {
    expect(PRIMARY_INSPECTOR_TABS.map(({ label }) => label)).toEqual([
      'AI',
      'Design',
      'Comments',
      'Evidence',
      'Trace',
    ]);
    expect(MORE_INSPECTOR_TABS.map(({ label }) => label)).toEqual(['Versions', 'JSON']);
    expect(source).toContain('data-testid="inspector-more"');
    expect(source).toContain('aria-haspopup="menu"');
    expect(source).toContain('surfaceRole="menu"');
  });

  it('implements automatic, wrapping roving focus for the five primary tabs', () => {
    expect(primaryInspectorTabAfterKey('ai', 'ArrowLeft')).toBe('trace');
    expect(primaryInspectorTabAfterKey('trace', 'ArrowRight')).toBe('ai');
    expect(primaryInspectorTabAfterKey('comments', 'Home')).toBe('ai');
    expect(primaryInspectorTabAfterKey('comments', 'End')).toBe('trace');
    expect(primaryInspectorTabAfterKey('comments', 'Enter')).toBeNull();
  });

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

  it('removes the duplicate validation footer while preserving Deck CI and Trace access', () => {
    expect(source).not.toContain('data-testid="validation-status"');
    expect(source).not.toContain('className="ns-inspector-footer"');
    expect(source).toContain("onOpenDeckCiTrace={() => onTabChange('trace')}");
    expect(aiSource).toContain('<DeckCiStatus');
    expect(aiSource).toContain('onOpenTrace: onOpenDeckCiTrace');
  });

  it('keeps session Turbo authority reachable in the primary AI composer', () => {
    expect(source).not.toContain('showApprovalModeControl={false}');
    expect(source).toContain('onApprovalModeChange');
  });
});
