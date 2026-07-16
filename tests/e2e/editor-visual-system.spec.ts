import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Page, expect, test } from 'playwright/test';
import { openFreshLanding } from './helpers';

const artifactDir = resolve('.tmp/nodeslide-visual-followup/after');
const capturedMetrics: VisualMetrics[] = [];

const cases = [
  { name: 'desktop-light', width: 1440, height: 900, theme: 'light' },
  { name: 'desktop-dark', width: 1440, height: 900, theme: 'dark' },
  { name: 'narrow-light', width: 1024, height: 768, theme: 'light' },
  { name: 'narrow-dark', width: 1024, height: 768, theme: 'dark' },
  { name: 'mobile-light', width: 390, height: 844, theme: 'light' },
  { name: 'mobile-dark', width: 390, height: 844, theme: 'dark' },
] as const;

test.describe('NodeSlide editor visual-system boundary', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => mkdirSync(artifactDir, { recursive: true }));
  test.afterAll(() => {
    writeFileSync(
      resolve(artifactDir, 'metrics.json'),
      `${JSON.stringify(capturedMetrics, null, 2)}\n`,
      'utf8',
    );
  });

  for (const visualCase of cases) {
    test(`${visualCase.name} keeps tabs, navigation, and composer legible`, async ({ page }) => {
      const runtimeErrors: string[] = [];
      page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
      });

      await page.setViewportSize({ width: visualCase.width, height: visualCase.height });
      await openVisualWorkspace(page);
      await setStudioTheme(page, visualCase.theme);

      const inspector = page.getByTestId('inspector');
      const composer = page.getByTestId('ai-composer');
      await expect(inspector).toHaveAttribute('aria-label', 'NodeSlide inspector');
      await expect(composer).toBeVisible();

      for (const label of ['AI', 'Design', 'Comments', 'Evidence', 'Trace']) {
        await expect(page.getByRole('tab', { name: label, exact: true })).toBeVisible();
      }

      const more = page.getByTestId('inspector-more');
      await expect(more).toBeVisible();
      await expect(more).toContainText('More');
      await more.click();
      const moreMenu = page.getByRole('menu', { name: 'More inspector views' });
      await expect(moreMenu).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Versions' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'JSON' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(moreMenu).toBeHidden();
      await expect(more).toBeFocused();
      await more.evaluate((button: HTMLButtonElement) => button.blur());

      const textarea = page.getByRole('textbox', { name: 'AI instruction' });
      await expect(textarea).toBeVisible();
      const toolsToggle = page.getByTestId('ai-tools-toggle');
      await expect(toolsToggle).toBeVisible();
      await toolsToggle.click();
      for (const label of [
        'Connect BYOK model or coding agent',
        'Toggle web research',
        'Manage deck memory',
        'Add read context reference',
        'Add command',
        'Propose edit',
      ]) {
        await expect(composer.getByRole('button', { name: label })).toBeVisible();
      }
      await expect(page.getByTestId('ai-model-select')).toBeVisible();
      await composer.getByRole('button', { name: 'Expand composer' }).click();
      await expect(composer.getByRole('button', { name: 'Collapse composer' })).toBeVisible();
      await expect(page.getByTestId('ai-effort-select')).toBeVisible();
      await expect(page.getByTestId('ai-attach-data')).toBeVisible();

      await page.evaluate(() => document.fonts.ready);
      const metrics = await collectMetrics(page, visualCase.name, runtimeErrors);
      capturedMetrics.push(metrics);

      expect(metrics.theme).toBe(visualCase.theme);
      expect(metrics.documentOverflow).toBeLessThanOrEqual(2);
      expect(metrics.inspectorOverflow).toBeLessThanOrEqual(1);
      expect(metrics.composerOverflow).toBeLessThanOrEqual(1);
      expect(metrics.primaryTabs).toHaveLength(5);
      expect(metrics.primaryTabs.every((tab) => tab.insideInspector)).toBe(true);
      expect(metrics.moreInsideInspector).toBe(true);
      if (visualCase.width <= 699) {
        expect(metrics.textarea.height).toBeGreaterThanOrEqual(100);
      } else {
        expect(metrics.textarea.height).toBeGreaterThanOrEqual(72);
        expect(metrics.textarea.height).toBeLessThanOrEqual(96);
      }
      expect(metrics.secondaryControlsAfterPrompt).toBe(true);
      expect(metrics.composerContentBottomGap).toBeLessThanOrEqual(16);
      expect(metrics.dataLabel).toBe('Data');
      expect(metrics.unnamedButtons).toEqual([]);
      expect(metrics.accidentalHorizontalScrollers).toEqual([]);
      expect(runtimeErrors).toEqual([]);

      if (visualCase.width >= 1100) {
        expect(metrics.modeButtons.map(({ label }) => label)).toEqual([
          'Edit',
          'Overview',
          'Compare',
        ]);
        expect(metrics.modeButtons.every(({ height }) => height >= 28)).toBe(true);
        expect(metrics.modeGaps.every((gap) => gap >= 3)).toBe(true);
      }

      if (visualCase.width <= 699) {
        expect(metrics.primaryTabs.every(({ height }) => height >= 44)).toBe(true);
        expect(metrics.composerControls.every(({ height }) => height >= 44)).toBe(true);
      }

      await page.screenshot({
        path: resolve(artifactDir, `${visualCase.name}.png`),
        animations: 'disabled',
      });
    });
  }
});

async function openVisualWorkspace(page: Page) {
  await openFreshLanding(page);
  await page.getByRole('button', { name: 'Explore the editable sample workspace' }).click();
  await expect(page.getByTestId('deck-title')).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/[?&]deck=/);

  const composer = page.getByTestId('ai-composer');
  const openInspector = page
    .locator('button[aria-label="Open inspector"]:visible, button[aria-label="Ask AI"]:visible')
    .first();
  await expect
    .poll(async () => (await composer.isVisible()) || (await openInspector.isVisible()))
    .toBe(true);
  if (await openInspector.isVisible()) {
    await openInspector.click();
  }
  await expect(composer).toBeVisible();
  await expect(page.locator('.ns-editor-slide')).toBeVisible();
}

async function setStudioTheme(page: Page, theme: 'light' | 'dark') {
  const studio = page.getByTestId('nodeslide-studio');
  if ((await studio.getAttribute('data-ns-theme')) !== theme) {
    await page.locator('.ns-theme-toggle').evaluate((button: HTMLButtonElement) => button.click());
  }
  await expect(studio).toHaveAttribute('data-ns-theme', theme);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  // Screenshot proof needs a settled compositor frame after the editor theme
  // changes; the authored slide keeps its own palette while the shell repaints.
  await page.waitForTimeout(1_000);
}

interface RectMetric {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface VisualMetrics {
  name: string;
  theme: string | null;
  documentOverflow: number;
  inspectorOverflow: number;
  composerOverflow: number;
  primaryTabs: Array<RectMetric & { label: string; insideInspector: boolean }>;
  moreInsideInspector: boolean;
  textarea: RectMetric;
  secondaryControlsAfterPrompt: boolean;
  composerContentBottomGap: number;
  dataLabel: string;
  modeButtons: Array<RectMetric & { label: string }>;
  modeGaps: number[];
  composerControls: Array<RectMetric & { label: string }>;
  unnamedButtons: string[];
  accidentalHorizontalScrollers: string[];
  runtimeErrors: string[];
}

async function collectMetrics(
  page: Page,
  name: string,
  runtimeErrors: string[],
): Promise<VisualMetrics> {
  return page.evaluate(
    ({ name: frameName, runtimeErrors: errors }) => {
      const rect = (element: Element): RectMetric => {
        const bounds = element.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height,
        };
      };
      const visible = (element: Element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) !== 0 &&
          bounds.width > 0 &&
          bounds.height > 0
        );
      };
      const selectorHint = (element: Element) =>
        [
          element.tagName.toLowerCase(),
          element.id ? `#${element.id}` : '',
          ...Array.from(element.classList)
            .slice(0, 2)
            .map((className) => `.${className}`),
        ].join('');

      const studio = document.querySelector<HTMLElement>('[data-testid="nodeslide-studio"]');
      const inspector = document.querySelector<HTMLElement>('[data-testid="inspector"]');
      const composer = document.querySelector<HTMLElement>('[data-testid="ai-composer"]');
      const prompt = composer?.querySelector<HTMLElement>('.ns-prompt-input');
      const textarea = composer?.querySelector<HTMLTextAreaElement>('.ns-prompt-textarea');
      const more = document.querySelector<HTMLElement>('[data-testid="inspector-more"]');
      const dataButton = document.querySelector<HTMLElement>('[data-testid="ai-attach-data"]');
      if (!studio || !inspector || !composer || !prompt || !textarea || !more || !dataButton) {
        throw new Error(
          'Visual metrics could not find the editor, inspector, or composer surface.',
        );
      }

      const inspectorRect = rect(inspector);
      const promptRect = rect(prompt);
      const composerRect = rect(composer);
      const secondaryControls = Array.from(
        composer.querySelectorAll<HTMLElement>(
          '.ns-ai-v3-suggested-actions, .ns-ai-v3-policy-summary, .ns-ai-v3-controls-disclosure',
        ),
      ).filter(visible);
      const composerContentBottom = Math.max(
        promptRect.bottom,
        ...secondaryControls.map((control) => rect(control).bottom),
      );
      const primaryTabs = Array.from(inspector.querySelectorAll<HTMLElement>('[role="tab"]')).map(
        (tab) => {
          const bounds = rect(tab);
          return {
            ...bounds,
            label: tab.textContent?.trim() ?? '',
            insideInspector:
              bounds.left >= inspectorRect.left - 1 && bounds.right <= inspectorRect.right + 1,
          };
        },
      );
      const moreRect = rect(more);
      const modeButtons = Array.from(
        document.querySelectorAll<HTMLElement>('.ns-editor-mode-controls button'),
      )
        .filter(visible)
        .map((button) => ({ ...rect(button), label: button.textContent?.trim() ?? '' }));
      const modeGaps = modeButtons
        .slice(1)
        .map((button, index) => button.left - (modeButtons[index]?.right ?? button.left));
      const composerControlSelectors = [
        '[data-testid="ai-model-select"]',
        '[data-testid="ai-effort-select"]',
        '[data-testid="ai-attach-data"]',
        '.ns-ai-tool-button',
        '.ns-ai-v3-expand-composer',
        '[data-testid="ai-submit"]',
      ];
      const composerControls = Array.from(
        composer.querySelectorAll<HTMLElement>(composerControlSelectors.join(',')),
      )
        .filter(visible)
        .map((control) => ({
          ...rect(control),
          label:
            control.textContent?.trim() ||
            control.getAttribute('aria-label') ||
            selectorHint(control),
        }));

      const unnamedButtons = Array.from(inspector.querySelectorAll<HTMLButtonElement>('button'))
        .filter(visible)
        .filter(
          (button) =>
            !button.textContent?.trim() &&
            !button.getAttribute('aria-label') &&
            !button.getAttribute('title'),
        )
        .map(selectorHint);
      const accidentalHorizontalScrollers = Array.from(inspector.querySelectorAll<HTMLElement>('*'))
        .filter(visible)
        .filter((element) => {
          const overflowX = getComputedStyle(element).overflowX;
          return (
            element.scrollWidth > element.clientWidth + 2 &&
            overflowX !== 'hidden' &&
            overflowX !== 'clip'
          );
        })
        .map(selectorHint);

      return {
        name: frameName,
        theme: studio.dataset.nsTheme ?? null,
        documentOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        inspectorOverflow: Math.max(0, inspector.scrollWidth - inspector.clientWidth),
        composerOverflow: Math.max(0, prompt.scrollWidth - prompt.clientWidth),
        primaryTabs,
        moreInsideInspector:
          moreRect.left >= inspectorRect.left - 1 && moreRect.right <= inspectorRect.right + 1,
        textarea: rect(textarea),
        secondaryControlsAfterPrompt: secondaryControls.every(
          (control) => rect(control).top >= promptRect.bottom - 1,
        ),
        composerContentBottomGap: Math.max(0, composerRect.bottom - composerContentBottom),
        dataLabel: getComputedStyle(dataButton, '::after').content.replaceAll('"', ''),
        modeButtons,
        modeGaps,
        composerControls,
        unnamedButtons,
        accidentalHorizontalScrollers,
        runtimeErrors: errors,
      };
    },
    { name, runtimeErrors },
  );
}
