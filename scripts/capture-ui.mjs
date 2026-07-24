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
 *
 * The exit code is 1 when a wait target never appears. A capture of the wrong screen is worse than
 * no capture, so this fails instead of writing a picture of something else.
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
