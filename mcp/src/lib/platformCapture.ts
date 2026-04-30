import { chromium } from 'playwright';

export interface PlatformCaptureOptions {
  url: string;
  waitMs?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  selector?: string;
}

export interface PlatformCaptureResult {
  url: string;
  finalUrl: string;
  title: string;
  artifactHtml: string;
  textSample: string;
  consoleErrors: string[];
  viewport: { width: number; height: number };
}

export async function capturePlatformRoute(
  options: PlatformCaptureOptions,
): Promise<PlatformCaptureResult> {
  const width = options.viewportWidth ?? 1440;
  const height = options.viewportHeight ?? 1000;
  const waitMs = options.waitMs ?? 1500;
  const consoleErrors: string[] = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });

  try {
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    if (waitMs > 0) await page.waitForTimeout(waitMs);

    const captured = await page.evaluate((selector) => {
      const doc = (globalThis as unknown as { document: any }).document;
      const win = globalThis as unknown as { location: { href: string } };
      const target = selector ? doc.querySelector(selector) : null;
      const sourceRoot = target ?? doc.body;
      const html = doc.documentElement.cloneNode(true);

      html.querySelectorAll('script,noscript').forEach((node: any) => node.remove());
      html.querySelectorAll('link[rel="preload"],link[rel="modulepreload"]').forEach((node: any) =>
        node.remove(),
      );

      if (target) {
        const body = html.querySelector('body') ?? doc.createElement('body');
        body.innerHTML = sourceRoot.outerHTML;
      }

      const head = html.querySelector('head') ?? doc.createElement('head');
      if (!head.parentNode) html.insertBefore(head, html.firstChild);

      const css: string[] = [];
      for (const sheet of Array.from(doc.styleSheets) as any[]) {
        try {
          const rules = Array.from(sheet.cssRules ?? []) as Array<{ cssText?: string }>;
          css.push(...rules.map((rule) => rule.cssText ?? '').filter(Boolean));
        } catch {
          if (sheet.href) {
            css.push(`/* parity capture: stylesheet not readable due to browser policy: ${sheet.href} */`);
          }
        }
      }
      if (css.length > 0) {
        const style = doc.createElement('style');
        style.setAttribute('data-parity-captured-css', 'true');
        style.textContent = css.join('\n');
        head.appendChild(style);
      }

      const base = doc.createElement('base');
      base.href = win.location.href;
      head.insertBefore(base, head.firstChild);

      return {
        finalUrl: win.location.href,
        title: doc.title || '',
        textSample: (sourceRoot.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2000),
        artifactHtml: `<!doctype html>\n${html.outerHTML}`,
      };
    }, options.selector ?? null);

    return {
      url: options.url,
      finalUrl: captured.finalUrl,
      title: captured.title,
      artifactHtml: captured.artifactHtml,
      textSample: captured.textSample,
      consoleErrors,
      viewport: { width, height },
    };
  } finally {
    await context.close();
    await browser.close();
  }
}
