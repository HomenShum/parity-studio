/**
 * Headless rendering of an HTML string via Playwright. Used by the visual
 * verifier to capture a PNG of the decomposed ui_kit's index.html.
 *
 * Lazy-launches a single browser per process; reused across tool calls.
 * Closes on signal or process exit.
 */

import type { Browser } from 'playwright';
import { chromium } from 'playwright';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserPromise === null) {
    browserPromise = chromium.launch({ headless: true });
  }
  return await browserPromise;
}

export async function shutdownRenderer(): Promise<void> {
  if (browserPromise === null) return;
  const browser = await browserPromise;
  await browser.close();
  browserPromise = null;
}

export interface RenderResult {
  pngBase64: string;
  width: number;
  height: number;
  latencyMs: number;
}

export async function renderHtmlToPng(
  html: string,
  options?: { width?: number; height?: number; settleMs?: number },
): Promise<RenderResult> {
  const width = options?.width ?? 1440;
  const height = options?.height ?? 900;
  const settleMs = options?.settleMs ?? 1500;
  const t0 = Date.now();

  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
  });
  try {
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 15_000 });
    await page.waitForTimeout(settleMs);
    const buf = await page.screenshot({ fullPage: false, animations: 'disabled' });
    return {
      pngBase64: buf.toString('base64'),
      width,
      height,
      latencyMs: Date.now() - t0,
    };
  } finally {
    await page.close();
  }
}

// Best-effort cleanup
process.on('SIGINT', () => {
  void shutdownRenderer().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdownRenderer().finally(() => process.exit(0));
});
