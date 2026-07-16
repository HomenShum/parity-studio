import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.NODESLIDE_QA_URL ?? 'https://parity-studio.vercel.app/';
const outDir = process.env.NODESLIDE_QA_OUT;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function openSample(page, expectComposer = true) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  const sample = page.getByRole('button', { name: 'Explore the editable sample workspace' });
  await sample.waitFor({ state: 'visible', timeout: 30_000 });
  await sample.click();
  if (expectComposer) {
    await page.getByTestId('ai-composer').waitFor({ state: 'visible', timeout: 90_000 });
  } else {
    await page.getByRole('button', { name: 'Slide 1 actions' }).waitFor({
      state: 'visible',
      timeout: 90_000,
    });
  }
}

const browser = await chromium.launch();
try {
  const desktop = await browser.newPage({ viewport: { width: 1512, height: 812 } });
  await openSample(desktop);
  const controls = desktop.getByTestId('ai-provider-controls');
  assert((await controls.getAttribute('open')) === null, 'Advanced controls must start collapsed.');
  assert(await desktop.getByTestId('ai-read-scope').isVisible(), 'Read scope must be visible.');
  assert(await desktop.getByTestId('ai-write-scope').isVisible(), 'Write scope must be visible.');
  await desktop.getByTestId('ai-provider-summary').click();
  assert(
    await desktop.getByTestId('ai-provider-route-status').isVisible(),
    'Provider route status must be visible inside the single settings disclosure.',
  );
  const openRouter = desktop.getByTestId('ai-provider-openrouter');
  const consent = desktop.getByTestId('ai-provider-consent');
  assert(await openRouter.isVisible(), 'OpenRouter choice must be directly discoverable.');
  assert(
    await consent.isEnabled(),
    'External consent must be available for the selected OpenRouter route.',
  );
  await consent.check();
  assert(await consent.isChecked(), 'External consent must be explicitly checked per request.');

  const split = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await openSample(split);
  const geometry = await split.evaluate(() => {
    const canvas = document.querySelector('.ns-canvas-panel')?.getBoundingClientRect();
    const inspector = document.querySelector('.ns-inspector')?.getBoundingClientRect();
    return {
      noOverlap: Boolean(canvas && inspector && canvas.right <= inspector.left + 1),
      noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
    };
  });
  assert(geometry.noOverlap, 'The 900px assistant must use a split pane, not cover the canvas.');
  assert(geometry.noOverflow, 'The 900px split pane must not create horizontal overflow.');

  const phone = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await openSample(phone, false);
  assert(
    await phone.getByRole('button', { name: 'Slide 1 actions' }).isVisible(),
    'Phone storyboard must retain a visible slide-actions path.',
  );
  assert(
    await phone.getByRole('button', { name: 'Add slide' }).isVisible(),
    'Phone storyboard must retain a visible add-slide path.',
  );

  if (outDir) {
    await mkdir(outDir, { recursive: true });
    await desktop.screenshot({ path: `${outDir}/b8-desktop-provider-controls.png` });
    await phone.screenshot({ path: `${outDir}/b8-phone-slide-actions.png` });
  }
  console.log(`PASS NodeSlide agent operability · ${url}`);
  console.log('PASS desktop scope is explicit and provider consent is one disclosure');
  console.log('PASS 900px assistant is a non-overlapping split pane');
  console.log('PASS phone slide actions and add-slide remain visible');
} finally {
  await browser.close();
}
