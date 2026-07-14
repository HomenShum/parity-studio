// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudioToolbar, type StudioToolbarProps } from './StudioToolbar';

const source = readFileSync('src/domains/nodeslide/components/StudioToolbar.tsx', 'utf8');

afterEach(cleanup);

describe('NodeSlide v3 studio toolbar', () => {
  it('keeps launch actions visible and labels preview-only settings honestly', () => {
    const markup = renderToStaticMarkup(<StudioToolbar {...toolbarProps()} />);

    expect(markup).toContain('NodeSlide');
    expect(markup).toContain('v18');
    expect(markup).toContain('Reset demo');
    expect(markup).toContain('aria-label="Project actions"');
    expect(markup).not.toContain('Create or open');
    expect(markup).toContain('aria-label="Share deck"');
    expect(markup).toContain('aria-label="Present deck"');
    expect(markup).toContain('aria-label="Export deck"');
    expect(source).toContain('data-testid="export-json"');
    expect(source).toContain('Validated, re-openable NodeSlide snapshot');
    expect(markup).toContain('aria-label="Open command palette"');
    expect(markup).toContain('aria-label="Collapse slide navigator"');
    expect(source).toContain(
      'English is active. Additional localization and copy policies are preview-only.',
    );
    expect(source).toMatch(/value="zh-CN"[\s\S]*?disabled/);
    expect(source.match(/type="checkbox"[\s\S]*?disabled/g)).toHaveLength(2);
  });

  it('makes every editor project action reachable from one clearly labeled menu', async () => {
    const user = userEvent.setup();
    const callbacks = {
      onNewDeck: vi.fn(),
      onOpenProjects: vi.fn(),
      onOpenConnections: vi.fn(),
      onBackupRecoveryKey: vi.fn(),
      onDeleteDeck: vi.fn(),
    };
    render(<StudioToolbar {...toolbarProps(callbacks)} />);

    const trigger = screen.getByRole('button', { name: 'Project actions' });
    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Project actions' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /New deck/ })).toHaveFocus();
    expect(screen.getByRole('menuitem', { name: /Open deck/ })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /Connections/ })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /Back up recovery key/ })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /Delete deck/ })).toBeVisible();

    await user.click(screen.getByRole('menuitem', { name: /Connections/ }));
    expect(callbacks.onOpenConnections).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu', { name: 'Project actions' })).not.toBeInTheDocument();

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: /Back up recovery key/ }));
    expect(callbacks.onBackupRecoveryKey).toHaveBeenCalledOnce();

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: /Delete deck/ }));
    expect(callbacks.onDeleteDeck).toHaveBeenCalledOnce();

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: /Open deck/ }));
    expect(callbacks.onOpenProjects).toHaveBeenCalledOnce();

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: /New deck/ }));
    expect(callbacks.onNewDeck).toHaveBeenCalledOnce();
  });

  it('supports roving keyboard focus and restores focus on Escape', async () => {
    const user = userEvent.setup();
    render(<StudioToolbar {...toolbarProps()} />);
    const trigger = screen.getByRole('button', { name: 'Project actions' });

    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: /New deck/ })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /Open deck/ })).toHaveFocus();

    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: /Delete deck/ })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Project actions' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

function toolbarProps(overrides: Partial<StudioToolbarProps> = {}): StudioToolbarProps {
  return {
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
    onNewDeck: () => undefined,
    onOpenProjects: () => undefined,
    onOpenConnections: () => undefined,
    onBackupRecoveryKey: () => undefined,
    onDeleteDeck: () => undefined,
    onUndo: () => undefined,
    onRedo: () => undefined,
    onShare: () => undefined,
    onPresent: () => undefined,
    onExportHtml: () => undefined,
    onExportJson: () => undefined,
    onExportPptx: () => undefined,
    onOpenCommandPalette: () => undefined,
    onToggleInspector: () => undefined,
    onThemeModeChange: () => undefined,
    onToggleNavigator: () => undefined,
    onResetView: () => undefined,
    ...overrides,
  };
}
