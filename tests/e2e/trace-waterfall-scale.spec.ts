import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Page, expect, test } from 'playwright/test';
import {
  TRACE_FIXTURE_ROOT_SPAN_ID,
  TRACE_SCALE_DOM_NODE_BUDGET,
  TRACE_SCALE_INTERACTION_BUDGET_MS,
  createTraceWaterfallFixture,
} from '../../src/domains/nodeslide/inspector/TraceWaterfall.fixture';

const artifactDir = resolve('.tmp/nodeslide-trace-scale');
const capturedMetrics: TraceScaleMetrics[] = [];
const fixtureUrl = (count: number, loaded = count) =>
  `/tests/fixtures/trace-waterfall.html?count=${count}&loaded=${loaded}`;

test.describe('NodeSlide trace waterfall scale scenarios', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => mkdirSync(artifactDir, { recursive: true }));
  test.afterAll(() => {
    writeFileSync(
      resolve(artifactDir, 'metrics.json'),
      `${JSON.stringify(capturedMetrics, null, 2)}\n`,
      'utf8',
    );
  });

  for (const count of [4, 10, 100] as const) {
    test(`exact ${count}-span compact/expanded transition stays bounded`, async ({ page }) => {
      const runtimeErrors = collectRuntimeErrors(page);
      await page.goto(fixtureUrl(count));

      await expect(page.getByTestId('trace-fixture-span-count')).toHaveText(
        `${count} of ${count} spans loaded`,
      );
      await expect(page.getByTestId('trace-waterfall')).toHaveAttribute(
        'aria-label',
        'Compact trace activity',
      );
      await expect(page.getByTestId('trace-activity-row')).toHaveCount(Math.min(6, count));
      await expect(page.getByRole('button', { name: 'Open full trace timeline' })).toBeVisible();
      expect(await page.evaluate(() => document.characterSet)).toBe('UTF-8');

      const compactMetrics = await traceDomMetrics(page);
      expect(compactMetrics.documentOverflow).toBeLessThanOrEqual(2);
      expect(compactMetrics.domNodes).toBeLessThan(TRACE_SCALE_DOM_NODE_BUDGET);

      if (count === 100) {
        await page.screenshot({
          path: resolve(artifactDir, 'exact-100-compact.png'),
          animations: 'disabled',
        });
      }

      await page.getByRole('button', { name: 'Open full trace timeline' }).click();
      await expect(page.getByLabel('Expanded trace observability view')).toBeVisible();
      await expect(page.getByLabel('Search trace spans')).toBeVisible();
      await expect(page.getByLabel('Group trace spans')).toHaveValue('trace');
      await expect(page.getByTestId('trace-minimap-bucket')).toHaveCount(48);
      await expect(page.locator('.ns-waterfall-toolbar output')).toContainText(
        `of ${count} loaded spans visible`,
      );

      const mountedRows = await page.getByTestId('trace-waterfall-row').count();
      expect(mountedRows).toBeGreaterThan(0);
      expect(mountedRows).toBeLessThan(40);
      const expandedMetrics = await traceDomMetrics(page);
      expect(expandedMetrics.documentOverflow).toBeLessThanOrEqual(2);
      expect(expandedMetrics.domNodes).toBeLessThan(TRACE_SCALE_DOM_NODE_BUDGET);
      expect(expandedMetrics.axisEndClipped).toBe(false);
      expect(expandedMetrics.waterfallOverflowX).toBe('hidden');
      expect(runtimeErrors).toEqual([]);

      if (count === 100) {
        await page.screenshot({
          path: resolve(artifactDir, 'exact-100-expanded.png'),
          animations: 'disabled',
        });
      }
      capturedMetrics.push({
        scenario: `exact-${count}`,
        compactDomNodes: compactMetrics.domNodes,
        expandedDomNodes: expandedMetrics.domNodes,
        mountedRows,
        totalSpans: count,
      });
    });
  }

  test('250-loaded / 1,000-total fixture preserves state and stays virtualized', async ({
    page,
  }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    const generated = createTraceWaterfallFixture(1_000, { loadedSpanCount: 250 });
    const target = [...generated.telemetry.spans]
      .reverse()
      .find(
        (span) =>
          span.spanId !== TRACE_FIXTURE_ROOT_SPAN_ID &&
          span.name.endsWith('· retrieval') &&
          Boolean(span.sourceIds?.length),
      );
    if (!target) throw new Error('high-volume fixture is missing a span-bound retrieval target');

    await page.goto(fixtureUrl(1_000, 250));
    await expect(page.getByTestId('trace-fixture-span-count')).toHaveText(
      '250 of 1,000 spans loaded',
    );
    await expect(page.getByTestId('trace-activity-row')).toHaveCount(6);
    await expect(page.getByTestId('trace-partial-notice')).toContainText('loaded window only');
    const highVolumeCompactMetrics = await traceDomMetrics(page);
    expect(highVolumeCompactMetrics.domNodes).toBeLessThan(TRACE_SCALE_DOM_NODE_BUDGET);
    expect(highVolumeCompactMetrics.documentOverflow).toBeLessThanOrEqual(2);

    await page.getByRole('button', { name: 'Open full trace timeline' }).click();
    await expect(page.getByLabel('Expanded trace observability view')).toBeVisible();
    const initiallyMounted = await page.getByTestId('trace-waterfall-row').count();
    expect(initiallyMounted).toBeGreaterThan(1);
    expect(initiallyMounted).toBeLessThanOrEqual(9);

    const expandLatencyMs = await measureButtonPaint(page, 'Expand loaded');
    expect(expandLatencyMs).toBeLessThan(TRACE_SCALE_INTERACTION_BUDGET_MS);
    await expect(page.locator('.ns-waterfall-toolbar output')).toContainText(
      '250 of 250 loaded spans visible',
    );
    expect(await page.getByTestId('trace-waterfall-row').count()).toBeLessThan(40);

    const scroll = page.locator('.ns-waterfall-scroll');
    await scroll.evaluate((element) => {
      element.scrollTop = 1_800;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(1_700);
    const mountedAfterScroll = page.getByTestId('trace-waterfall-row');
    await mountedAfterScroll.nth(Math.floor((await mountedAfterScroll.count()) / 2)).click();
    const selectedBeforeCollapse = await selectedSpanId(page);
    const scrollBeforeCollapse = await scroll.evaluate((element) => element.scrollTop);

    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Trace inspector')).toBeVisible();
    await expect(page.getByTestId('trace-compact-selection')).toContainText(selectedBeforeCollapse);
    await page.getByRole('button', { name: 'Open full trace timeline' }).click();
    await expect(page.getByLabel('Expanded trace observability view')).toBeVisible();
    await expect
      .poll(() => scroll.evaluate((element) => element.scrollTop))
      .toBeCloseTo(scrollBeforeCollapse, 0);
    expect(await selectedSpanId(page)).toBe(selectedBeforeCollapse);

    await page.getByLabel('Group trace spans').selectOption('service');
    const groupSummaryCount = await page.getByTestId('trace-group-summary').count();
    expect(groupSummaryCount).toBeGreaterThan(1);
    expect(groupSummaryCount).toBeLessThanOrEqual(12);
    await page.getByRole('button', { name: 'Sources', exact: true }).click();
    const searchStart = await page.evaluate(() => performance.now());
    await page.getByLabel('Search trace spans').fill(target.name);
    await expect(page.getByTestId('trace-waterfall-row')).toHaveCount(1);
    const searchLatencyMs = await page.evaluate(
      (startedAt) => performance.now() - startedAt,
      searchStart,
    );
    expect(searchLatencyMs).toBeLessThan(TRACE_SCALE_INTERACTION_BUDGET_MS);

    await page.getByTestId('trace-waterfall-row').click();
    expect(await selectedSpanId(page)).toBe(target.spanId);
    const selectedEvidence = page.getByTestId('trace-span-evidence');
    await expect(selectedEvidence).toHaveAttribute('data-span-id', target.spanId);
    await expect(selectedEvidence.getByTestId('trace-source-citation')).toHaveCount(1);
    await expect(selectedEvidence.locator('time')).toHaveCount(1);
    const selectedTimes = page
      .getByTestId('trace-selected-span')
      .locator('.ns-waterfall-detail-grid > section')
      .first()
      .locator('time');
    await expect(selectedTimes).toHaveCount(2);
    await expect(selectedTimes.first()).toHaveAttribute(
      'dateTime',
      new Date(target.startTime).toISOString(),
    );
    await expect(selectedTimes.last()).toHaveAttribute(
      'dateTime',
      new Date(target.endTime ?? target.startTime).toISOString(),
    );

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('trace-compact-selection')).toContainText(target.name);
    await page.getByRole('button', { name: 'Open full trace timeline' }).click();
    await expect(page.getByLabel('Group trace spans')).toHaveValue('service');
    await expect(page.getByRole('button', { name: 'Sources', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByLabel('Search trace spans')).toHaveValue(target.name);
    expect(await selectedSpanId(page)).toBe(target.spanId);

    await page.getByTestId('trace-load-more').click();
    await expect(page.getByTestId('trace-fixture-span-count')).toHaveText(
      '1,000 of 1,000 spans loaded',
    );
    await expect(page.getByLabel('Search trace spans')).toHaveValue(target.name);
    await expect(page.getByLabel('Group trace spans')).toHaveValue('service');
    expect(await selectedSpanId(page)).toBe(target.spanId);

    await page.getByLabel('Search trace spans').fill('');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    const regroupStart = await page.evaluate(() => performance.now());
    await page.getByLabel('Group trace spans').selectOption('trace');
    await expect(page.locator('.ns-waterfall-toolbar output')).toContainText(
      '1000 of 1000 loaded spans visible',
    );
    const regroupLatencyMs = await page.evaluate(
      (startedAt) => performance.now() - startedAt,
      regroupStart,
    );
    expect(regroupLatencyMs).toBeLessThan(TRACE_SCALE_INTERACTION_BUDGET_MS);

    const finalMetrics = await traceDomMetrics(page);
    const finalMountedRows = await page.getByTestId('trace-waterfall-row').count();
    expect(finalMountedRows).toBeGreaterThan(0);
    expect(finalMountedRows).toBeLessThan(40);
    expect(await page.getByTestId('trace-minimap-bucket').count()).toBe(48);
    expect(finalMetrics.domNodes).toBeLessThan(TRACE_SCALE_DOM_NODE_BUDGET);
    expect(finalMetrics.documentOverflow).toBeLessThanOrEqual(2);
    expect(finalMetrics.axisEndClipped).toBe(false);
    expect(finalMetrics.waterfallOverflowX).toBe('hidden');
    expect(finalMetrics.waterfallOverscrollY).toBe('auto');
    expect(finalMetrics.waterfallScrollRange).toBeGreaterThan(0);
    expect(finalMetrics.inspectorScrollRange).toBeGreaterThan(0);
    expect(runtimeErrors).toEqual([]);

    await settleTracePixels(page);
    await page.screenshot({
      path: resolve(artifactDir, 'high-volume-1000-expanded.png'),
      animations: 'disabled',
    });
    capturedMetrics.push({
      scenario: 'high-volume-250-of-1000',
      compactDomNodes: highVolumeCompactMetrics.domNodes,
      expandedDomNodes: finalMetrics.domNodes,
      mountedRows: finalMountedRows,
      totalSpans: 1_000,
      expandLatencyMs,
      searchLatencyMs,
      regroupLatencyMs,
      restoredScrollTop: scrollBeforeCollapse,
    });
  });
});

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function selectedSpanId(page: Page): Promise<string> {
  const value = await page
    .getByTestId('trace-selected-span')
    .locator(':scope > header > code')
    .textContent();
  if (!value?.trim()) throw new Error('selected span detail did not expose a span ID');
  return value.trim();
}

async function measureButtonPaint(page: Page, label: string): Promise<number> {
  return page.evaluate(async (buttonLabel) => {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate) => candidate.textContent?.trim() === buttonLabel,
    );
    if (!button) throw new Error(`Could not find ${buttonLabel} button`);
    const startedAt = performance.now();
    button.click();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return performance.now() - startedAt;
  }, label);
}

async function settleTracePixels(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const inspector = document.querySelector<HTMLElement>('.ns-trace-inspector');
    const waterfall = document.querySelector<HTMLElement>('.ns-waterfall-scroll');
    if (inspector) inspector.scrollTop = 0;
    if (waterfall) {
      waterfall.scrollTop = 0;
      waterfall.dispatchEvent(new Event('scroll'));
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

interface TraceDomMetrics {
  domNodes: number;
  documentOverflow: number;
  axisEndClipped: boolean;
  waterfallOverflowX: string;
  waterfallOverscrollY: string;
  waterfallScrollRange: number;
  inspectorScrollRange: number;
}

async function traceDomMetrics(page: Page): Promise<TraceDomMetrics> {
  return page.evaluate(() => {
    const scroll = document.querySelector<HTMLElement>('.ns-waterfall-scroll');
    const inspector = document.querySelector<HTMLElement>('.ns-trace-inspector');
    const axis = document.querySelector<HTMLElement>('.ns-waterfall-axis');
    const end = axis?.querySelector<HTMLElement>('[data-edge="end"]');
    const axisRect = axis?.getBoundingClientRect();
    const endRect = end?.getBoundingClientRect();
    const scrollStyle = scroll ? getComputedStyle(scroll) : null;
    return {
      domNodes: document.querySelectorAll('*').length,
      documentOverflow: Math.max(
        0,
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      axisEndClipped: Boolean(axisRect && endRect && endRect.right > axisRect.right + 1),
      waterfallOverflowX: scrollStyle?.overflowX ?? 'absent',
      waterfallOverscrollY: scrollStyle?.overscrollBehaviorY ?? 'absent',
      waterfallScrollRange: scroll ? Math.max(0, scroll.scrollHeight - scroll.clientHeight) : 0,
      inspectorScrollRange: inspector
        ? Math.max(0, inspector.scrollHeight - inspector.clientHeight)
        : 0,
    };
  });
}

interface TraceScaleMetrics {
  scenario: string;
  compactDomNodes: number;
  expandedDomNodes: number;
  mountedRows: number;
  totalSpans: number;
  expandLatencyMs?: number;
  searchLatencyMs?: number;
  regroupLatencyMs?: number;
  restoredScrollTop?: number;
}
