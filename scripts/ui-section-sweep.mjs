/**
 * Walk every UI section and report its type scale and geometry, one row per section.
 *
 * The owner found three real problems by looking — a composer that was not at the bottom, a palette
 * pinned to a corner, a panel that read like a config dump. All three had a measurable cause, and
 * none of them was found by a test. That is the gap this closes: design review kept being a matter
 * of whether someone happened to open the right tab.
 *
 * It does not judge taste. It reports the numbers that make bad taste visible — how many distinct
 * text sizes a section uses, how small the smallest is, and how far the largest is from it. A
 * section with nine text sizes between 7px and 16px is not a style, it is an accident.
 *
 * Usage:
 *   node scripts/ui-section-sweep.mjs [--url https://nodeslide.vercel.app/] [--out docs/design/evidence/sweep]
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

const url = flag('url', 'https://nodeslide.vercel.app/');
const outDir = flag('out', 'docs/design/evidence/sweep');

/**
 * Every distinct text size rendered as CHROME inside a region, smallest first.
 *
 * Slide thumbnails are excluded. The first run of this reported the left rail using 20 text sizes
 * down to 0.89px, which reads as a catastrophic finding and is not one — that is a slide's own
 * headline drawn at thumbnail scale, working exactly as intended. Counting a deck's content as
 * interface typography would make the loudest number in the table the one false row.
 */
const TYPE_SCALE = (selector) => {
  const root = document.querySelector(selector);
  if (!root) return null;
  const CONTENT = '[class*="slide-preview"], [class*="thumb"], [class*="ns-slide-render"], svg';
  const sizes = new Map();
  let contentNodes = 0;
  for (const node of root.querySelectorAll('*')) {
    if (node.children.length > 0) continue;
    const text = node.textContent?.trim();
    if (!text) continue;
    if (node.closest(CONTENT)) {
      contentNodes += 1;
      continue;
    }
    const size = Number.parseFloat(getComputedStyle(node).fontSize);
    sizes.set(size, (sizes.get(size) ?? 0) + 1);
  }
  const box = root.getBoundingClientRect();
  if (sizes.size === 0) return { width: 0, height: 0, sizes: [], distinctSizes: 0, contentNodes };
  return {
    width: Math.round(box.width),
    height: Math.round(box.height),
    sizes: [...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([px, n]) => `${px}px×${n}`),
    distinctSizes: sizes.size,
    smallest: Math.min(...sizes.keys()),
    largest: Math.max(...sizes.keys()),
    contentNodes,
  };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await mkdir(outDir, { recursive: true });

const rows = [];
const record = async (name, selector, file) => {
  const measured = await page.evaluate(TYPE_SCALE, selector);
  if (file) await page.screenshot({ path: path.join(outDir, `${file}.png`) });
  rows.push({ section: name, ...(measured ?? { missing: true }) });
};

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  await page.waitForTimeout(3500);
  await record('landing', 'body', 'landing');

  await page
    .getByText('Explore the editable sample workspace')
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(8000);

  await record('workspace top bar', 'header', 'workspace');
  await record('left rail', '.ns-navigator, aside', null);

  for (const tab of ['ai', 'design', 'comments', 'versions', 'data', 'json', 'trace']) {
    const control = page.locator(`[data-testid="inspector-tab-${tab}"]`);
    await control.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1400);
    await record(`inspector · ${tab}`, '.ns-inspector, [class*="inspector"]', `inspector-${tab}`);
  }

  await page.keyboard.press('Control+k');
  await page.waitForTimeout(1500);
  await record('command palette', '.ns-command-palette', 'palette');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  const widest = rows
    .filter((row) => !row.missing)
    .sort((a, b) => b.distinctSizes - a.distinctSizes);

  process.stdout.write(
    `${'section'.padEnd(22)}${'sizes'.padEnd(7)}${'min'.padEnd(7)}${'max'.padEnd(7)}scale\n` +
      `${'-'.repeat(78)}\n` +
      `${widest
        .map(
          (row) =>
            `${row.section.padEnd(22)}${String(row.distinctSizes).padEnd(7)}${`${row.smallest}px`.padEnd(7)}${`${row.largest}px`.padEnd(7)}${row.sizes.join(' ')}`,
        )
        .join('\n')}\n\n` +
      `Sections that could not be measured: ${
        rows
          .filter((r) => r.missing)
          .map((r) => r.section)
          .join(', ') || 'none'
      }\n` +
      `Screenshots in ${outDir}\n`,
  );
} catch (error) {
  process.stderr.write(`sweep failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
