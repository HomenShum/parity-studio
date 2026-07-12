import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StudioToolbar, type StudioToolbarProps } from './StudioToolbar';

const source = readFileSync(new URL('./StudioToolbar.tsx', import.meta.url), 'utf8');

describe('NodeSlide v3 studio toolbar', () => {
  it('keeps launch actions visible and labels preview-only settings honestly', () => {
    const markup = renderToolbar();

    expect(markup).toContain('NodeSlide');
    expect(markup).toContain('v18');
    expect(markup).toContain('Reset demo');
    expect(markup).toContain('aria-label="Share deck"');
    expect(markup).toContain('aria-label="Present deck"');
    expect(markup).toContain('aria-label="Export deck"');
    expect(markup).toContain('aria-label="Open command palette"');
    expect(markup).toContain('aria-label="Collapse slide navigator"');
    expect(source).toContain(
      'English is active. Additional localization and copy policies are preview-only.',
    );
    expect(source).toMatch(/value="zh-CN"[\s\S]*?disabled/);
    expect(source.match(/type="checkbox"[\s\S]*?disabled/g)).toHaveLength(2);
  });
});

function renderToolbar(overrides: Partial<StudioToolbarProps> = {}) {
  const props: StudioToolbarProps = {
    title: 'Launch narrative',
    version: 18,
    presence: [],
    canUndo: true,
    canRedo: false,
    inspectorCollapsed: false,
    themeMode: 'light',
    language: 'en',
    navigatorCollapsed: false,
    onTitleChange: () => undefined,
    onOpenProjects: () => undefined,
    onUndo: () => undefined,
    onRedo: () => undefined,
    onShare: () => undefined,
    onPresent: () => undefined,
    onExportHtml: () => undefined,
    onExportPptx: () => undefined,
    onOpenCommandPalette: () => undefined,
    onToggleInspector: () => undefined,
    onThemeModeChange: () => undefined,
    onToggleNavigator: () => undefined,
    onResetView: () => undefined,
    ...overrides,
  };

  return renderToStaticMarkup(<StudioToolbar {...props} />);
}
