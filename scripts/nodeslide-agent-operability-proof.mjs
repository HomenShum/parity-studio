import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.NODESLIDE_QA_URL ?? 'https://parity-studio.vercel.app/?domain=nodeslide';
const outDir = process.env.NODESLIDE_QA_OUT;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function openSample(page) {
  await page.addInitScript(() => {
    localStorage.removeItem('nodeslide.firstRun.v1');
  });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  const dialog = page.getByTestId('first-run-dialog');
  await dialog.waitFor({ state: 'visible', timeout: 30_000 });
  assert(await dialog.isVisible(), 'Fresh sessions must expose the first-run dialog.');
  assert(
    await page
      .getByText('Deterministic by default · OpenRouter opt-in', { exact: true })
      .isVisible(),
    'The concise privacy cue must remain visible.',
  );
  await page.getByTestId('first-run-explore').click();
  await page.getByTestId('nodeslide-studio').waitFor({ state: 'visible' });
}

const browser = await chromium.launch();
try {
  const desktop = await browser.newPage({ viewport: { width: 1512, height: 812 } });
  await openSample(desktop);
  const controls = desktop.getByTestId('ai-provider-controls');
  assert((await controls.getAttribute('open')) !== null, 'Provider controls must open by default.');
  assert(
    await desktop.getByTestId('ai-provider-route-status').isVisible(),
    'Provider route status must be visible without a second disclosure.',
  );
  const openRouter = desktop.getByTestId('ai-provider-openrouter');
  const consent = desktop.getByTestId('ai-provider-consent');
  assert(await openRouter.isVisible(), 'OpenRouter choice must be directly discoverable.');
  assert(!(await consent.isEnabled()), 'External consent must be disabled before route selection.');
  await openRouter.check();
  assert(
    await consent.isEnabled(),
    'External consent must become available after route selection.',
  );
  await consent.check();
  assert(await consent.isChecked(), 'External consent must be explicitly checked per request.');

  const phone = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await openSample(phone);
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
  console.log('PASS desktop provider consent is one disclosure and per-request explicit');
  console.log('PASS phone slide actions and add-slide remain visible');
} finally {
  await browser.close();
}
