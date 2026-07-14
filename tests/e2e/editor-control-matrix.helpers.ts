import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Locator, type Page, type TestInfo, expect } from 'playwright/test';

export interface RuntimeProblemLog {
  consoleErrors: string[];
  pageErrors: string[];
}

export interface InteractiveControlSnapshot {
  key: string;
  tag: string;
  role: string;
  name: string;
  testId: string | null;
  disabled: boolean;
  pressed: string | null;
  selected: string | null;
  checked: boolean | null;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  horizontallyClipped: boolean;
}

export interface SurfaceSnapshot {
  surface: string;
  viewport: { width: number; height: number };
  clientWidth: number;
  scrollWidth: number;
  overflow: number;
  controls: InteractiveControlSnapshot[];
}

export interface MatrixArtifactWriter {
  screenshot: (name: string, options?: { fullPage?: boolean }) => Promise<string>;
  json: (name: string, value: unknown) => Promise<string>;
}

const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
].join(',');

export function watchRuntimeProblems(page: Page): RuntimeProblemLog {
  const log: RuntimeProblemLog = { consoleErrors: [], pageErrors: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') log.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => log.pageErrors.push(error.message));
  return log;
}

export function createMatrixArtifactWriter(page: Page, testInfo: TestInfo): MatrixArtifactWriter {
  const writeArtifact = async (
    name: string,
    extension: 'json' | 'png',
    write: (path: string) => Promise<void> | void,
    contentType: string,
  ) => {
    const path = testInfo.outputPath('editor-control-matrix', `${safeName(name)}.${extension}`);
    mkdirSync(dirname(path), { recursive: true });
    await write(path);
    await testInfo.attach(name, { path, contentType });
    return path;
  };

  return {
    screenshot: (name, options) =>
      writeArtifact(
        name,
        'png',
        (path) =>
          page.screenshot({
            path,
            animations: 'disabled',
            fullPage: options?.fullPage ?? false,
          }),
        'image/png',
      ),
    json: (name, value) =>
      writeArtifact(
        name,
        'json',
        (path) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'),
        'application/json',
      ),
  };
}

export async function snapshotSurface(
  page: Page,
  surface: Locator,
  surfaceName: string,
): Promise<SurfaceSnapshot> {
  await expect(surface, `${surfaceName} should be visible before it is inventoried`).toBeVisible();
  return surface.evaluate(
    (root, { interactiveSelector, name }) => {
      const rootRect = root.getBoundingClientRect();
      const viewport = {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      };
      const visible = (element: Element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          !element.closest('[hidden]') &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) !== 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const textFromIds = (ids: string | null) =>
        (ids ?? '')
          .split(/\s+/u)
          .filter(Boolean)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
          .filter(Boolean)
          .join(' ');
      const associatedLabel = (element: Element) => {
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement
        ) {
          return Array.from(element.labels ?? [])
            .map((label) => label.textContent?.trim() ?? '')
            .filter(Boolean)
            .join(' ');
        }
        return '';
      };
      const accessibleName = (element: Element) =>
        element.getAttribute('aria-label')?.trim() ||
        textFromIds(element.getAttribute('aria-labelledby')) ||
        associatedLabel(element) ||
        element.getAttribute('title')?.trim() ||
        element.getAttribute('placeholder')?.trim() ||
        element.textContent?.replace(/\s+/gu, ' ').trim() ||
        element.getAttribute('data-testid')?.trim() ||
        '';
      const roleFor = (element: Element) => {
        const explicit = element.getAttribute('role');
        if (explicit) return explicit;
        if (element instanceof HTMLButtonElement) return 'button';
        if (element instanceof HTMLAnchorElement) return 'link';
        if (element instanceof HTMLSelectElement) return 'combobox';
        if (element instanceof HTMLTextAreaElement) return 'textbox';
        if (element instanceof HTMLInputElement) {
          if (element.type === 'checkbox') return 'checkbox';
          if (element.type === 'radio') return 'radio';
          if (element.type === 'range') return 'slider';
          return 'textbox';
        }
        return element.tagName.toLowerCase();
      };
      const controls = Array.from(root.querySelectorAll<HTMLElement>(interactiveSelector))
        .filter(visible)
        .map((element, index) => {
          const rect = element.getBoundingClientRect();
          const testId = element.getAttribute('data-testid');
          const role = roleFor(element);
          const controlName = accessibleName(element);
          const disabled =
            (element instanceof HTMLButtonElement ||
              element instanceof HTMLInputElement ||
              element instanceof HTMLSelectElement ||
              element instanceof HTMLTextAreaElement) &&
            element.disabled;
          const checked =
            element instanceof HTMLInputElement &&
            (element.type === 'checkbox' || element.type === 'radio')
              ? element.checked
              : null;
          return {
            key: `${name}:${testId ?? `${role}:${controlName}`}:${index}`,
            tag: element.tagName.toLowerCase(),
            role,
            name: controlName,
            testId,
            disabled,
            pressed: element.getAttribute('aria-pressed'),
            selected: element.getAttribute('aria-selected'),
            checked,
            left: Math.round(rect.left * 10) / 10,
            right: Math.round(rect.right * 10) / 10,
            top: Math.round(rect.top * 10) / 10,
            bottom: Math.round(rect.bottom * 10) / 10,
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
            horizontallyClipped:
              rect.left < rootRect.left - 2 ||
              rect.right > rootRect.right + 2 ||
              rect.left < -2 ||
              rect.right > viewport.width + 2,
          };
        });
      return {
        surface: name,
        viewport,
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        overflow: Math.max(0, root.scrollWidth - root.clientWidth),
        controls,
      };
    },
    { interactiveSelector: INTERACTIVE_SELECTOR, name: surfaceName },
  );
}

export function expectSurfaceSnapshotOperable(snapshot: SurfaceSnapshot): void {
  expect(snapshot.overflow, `${snapshot.surface} has horizontal overflow`).toBeLessThanOrEqual(2);
  expect(
    snapshot.controls.filter((control) => !control.name),
    `${snapshot.surface} has visible interactive controls without names`,
  ).toEqual([]);
  expect(
    snapshot.controls
      .filter((control) => control.horizontallyClipped)
      .map(({ name, testId, left, right }) => ({ name, testId, left, right })),
    `${snapshot.surface} has horizontally clipped controls`,
  ).toEqual([]);
}

export async function expectKeyboardFocusVisible(locator: Locator, label: string): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await locator.page().keyboard.press('Tab');
  await locator.focus();
  await expect(locator, `${label} should receive keyboard focus`).toBeFocused();
  const metric = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      focusVisible: element.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
      boxShadow: style.boxShadow,
    };
  });
  expect(metric.focusVisible, `${label} should match :focus-visible`).toBe(true);
  expect(
    (metric.outlineStyle !== 'none' && metric.outlineWidth >= 1) || metric.boxShadow !== 'none',
    `${label} should paint a visible outline or focus shadow`,
  ).toBe(true);
}

export async function expectDocumentHasNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
}

export async function settleUi(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

export function expectRuntimeClean(log: RuntimeProblemLog): void {
  expect(log.pageErrors, 'page errors').toEqual([]);
  expect(log.consoleErrors, 'console errors').toEqual([]);
}

function safeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');
}
