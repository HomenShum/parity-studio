// Quick visual check — boots dev server, screenshots the current shell
// at 1680x900 so we can compare to docs reference image.
//
// Usage: pnpm exec tsx scripts/screenshot-shell.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const URL = process.env.SHELL_URL ?? 'http://localhost:5174/';
const OUT = resolve(repoRoot, 'runs', `shell-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.error('[console]', m.text());
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(2_000);
await mkdir(dirname(OUT), { recursive: true });
await page.screenshot({ path: OUT, fullPage: false });
console.log('saved', OUT);
await browser.close();
