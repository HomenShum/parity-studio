#!/usr/bin/env node
import { chromium } from 'playwright';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:6285';
const out = process.argv[3] ?? path.resolve('dashboard.png');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
// SSE keeps networkidle from ever firing; just wait for paint + a beat.
await page.waitForLoadState('load').catch(() => {});
await page.waitForTimeout(2_500);
await page.screenshot({ path: out, animations: 'disabled' });
await browser.close();
console.log('wrote', out);
