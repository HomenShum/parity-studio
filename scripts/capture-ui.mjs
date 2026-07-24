/**
 * Capture the running app to PNG files, for before-and-after evidence.
 *
 * The owner asked a fair question: every change ships without a picture of its effect. The in-app
 * browser pane cannot answer that, because it only takes a screenshot when a human has the pane on
 * screen. This script does not need the pane. It drives a real Chromium through Playwright and
 * writes real files, so a change can be shown and not only described.
 *
 * Usage:
 *   node scripts/capture-ui.mjs --url http://localhost:5180/?domain=nodeslide --out shot.png
 *                               [--click <testid>] [--wait <testid>] [--width 1440] [--height 900]
 *                               [--measure <css selector>]
 *
 * The exit code is 1 when a wait target never appears. A capture of the wrong screen is worse than
 * no capture, so this fails instead of writing a picture of something else.
 *
 * `--measure` prints the geometry and type scale of one element. A screenshot shows that a layout
 * changed; it does not say by how much, and "looks centred" is not a fact. Design review kept
 * turning into opinion because the numbers were never on the table — this puts them there, so
 * "the palette is pinned to the corner at 9px type" is a reading rather than an impression.
 */

import { chromium } from 'playwright';

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

const url = flag('url', 'http://localhost:5180/');
const out = flag('out', 'shot.png');
const clickTarget = flag('click');
const clickText = flag('clickText');
const waitTarget = flag('wait');
const measureTarget = flag('measure');
const width = Number(flag('width', 1440));
const height = Number(flag('height', 900));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });

const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 160));
});

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });

  if (clickTarget) {
    const target = page.locator(`[data-testid="${clickTarget}"]`);
    await target.waitFor({ state: 'visible', timeout: 20_000 });
    await target.click();
  }

  // Not every control carries a test id. Text is the fallback, and it is what a person clicks.
  if (clickText) {
    const target = page.getByText(clickText, { exact: false }).first();
    await target.waitFor({ state: 'visible', timeout: 20_000 });
    await target.click();
    await page.waitForTimeout(2500);
  }

  if (waitTarget) {
    await page.locator(`[data-testid="${waitTarget}"]`).waitFor({
      state: 'visible',
      timeout: 20_000,
    });
  }

  // Let fonts and any entry animation settle, so two captures are comparable.
  await page.waitForTimeout(900);
  await page.screenshot({ path: out, fullPage: false });

  if (typeof measureTarget === 'string') {
    const measured = await page.evaluate((selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        left: Math.round(box.left),
        top: Math.round(box.top),
        width: Math.round(box.width),
        height: Math.round(box.height),
        // Positive means it sits right of centre, negative left. Zero is centred, and says so
        // without anyone having to judge a screenshot.
        centreOffsetPx: Math.round(box.left + box.width / 2 - window.innerWidth / 2),
        fontSize: style.fontSize,
        // Every distinct text size inside, smallest first. A scale with an 8px floor under a 31px
        // icon reads as noise no matter how the individual rules look in isolation.
        textSizes: [
          ...new Set(
            [...node.querySelectorAll('*')]
              .filter((child) => child.textContent?.trim())
              .map((child) => getComputedStyle(child).fontSize),
          ),
        ].sort((a, b) => Number.parseFloat(a) - Number.parseFloat(b)),
      };
    }, measureTarget);

    process.stdout.write(
      measured
        ? `measured ${measureTarget}\n${JSON.stringify(measured, null, 2)}\n`
        : `measured ${measureTarget}: NOT FOUND\n`,
    );
    if (!measured) process.exitCode = 1;
  }

  process.stdout.write(
    `captured ${out} at ${width}x${height}\n` +
      `  url            ${url}\n` +
      `  clicked        ${clickTarget ?? '(none)'}\n` +
      `  waited for     ${waitTarget ?? '(none)'}\n` +
      `  console errors ${consoleErrors.length}${consoleErrors.length ? `: ${consoleErrors[0]}` : ''}\n`,
  );
} catch (error) {
  process.stderr.write(`capture failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
