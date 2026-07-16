import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repo, 'artifacts', 'nodeslide-agent-ux-2026-07-15-responsive');
const appUrl = process.env.NODESLIDE_URL ?? 'http://127.0.0.1:4173/';
const shots = [
  ['desktop-light', 1512, 812, 'light'],
  ['desktop-dark', 1512, 812, 'dark'],
  ['tablet-light', 900, 900, 'light'],
  ['tablet-dark', 900, 900, 'dark'],
  ['mobile-light', 390, 844, 'light'],
  ['mobile-dark', 390, 844, 'dark'],
  ['mobile-settings-open-light', 390, 844, 'light', true],
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();

for (const [name, width, height, theme, settingsOpen = false] of shots) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 45_000 });
  await page.evaluate((value) => localStorage.setItem('nodeslide.v3.theme', value), theme);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Explore the editable sample workspace', { exact: true }).click();

  const openInspector = page.getByRole('button', { name: 'Open inspector' });
  await Promise.race([
    page.getByTestId('ai-composer').waitFor({ state: 'visible', timeout: 90_000 }),
    openInspector.waitFor({ state: 'visible', timeout: 90_000 }),
  ]);
  if (await openInspector.isVisible().catch(() => false)) await openInspector.click();
  await page.getByTestId('ai-composer').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByText('What should we change?', { exact: true }).waitFor({
    state: 'visible',
    timeout: 15_000,
  });
  if (settingsOpen) {
    await page.getByRole('button', { name: 'Agent settings' }).click();
    await page.getByText('Provider and privacy', { exact: true }).waitFor({ state: 'visible' });
  }

  const audit = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    theme: document.querySelector('.nodeslide-studio')?.getAttribute('data-ns-theme'),
    text: document.body.innerText,
  }));
  for (const expected of ['What should we change?', 'Propose']) {
    if (!audit.text.includes(expected)) throw new Error(`${name} is missing ${expected}`);
  }
  if (audit.overflow) throw new Error(`${name} has horizontal overflow`);
  if (audit.theme !== theme) throw new Error(`${name} rendered theme ${audit.theme}`);

  const path = join(outDir, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`WROTE ${path} | theme:${audit.theme} | hOverflow:${audit.overflow}`);
  await context.close();
}

await browser.close();
