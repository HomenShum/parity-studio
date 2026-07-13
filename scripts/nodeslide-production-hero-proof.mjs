import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.NODESLIDE_QA_URL ?? 'https://parity-studio.vercel.app/?domain=nodeslide';
const outDir = process.env.NODESLIDE_QA_OUT;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 812 } });
  await page.addInitScript(() => {
    localStorage.removeItem('nodeslide.firstRun.v1');
    sessionStorage.clear();
  });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  await page.getByTestId('first-run-dialog').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('first-run-explore').click();
  await page.getByTestId('ai-provider-openrouter').check();
  await page.getByTestId('ai-provider-consent').check();
  await page
    .getByLabel('AI instruction')
    .fill(
      "Rewrite this slide's headline to 'NodeSlide turns World Cup data into an editable story' and the body to explain that charts, citations, and uploaded CSV data remain editable and reviewable. Preserve the layout.",
    );
  await page.getByTestId('ai-submit').click();
  const proposal = page.getByTestId('proposal-card');
  try {
    await proposal.waitFor({ state: 'visible', timeout: 60_000 });
  } catch (error) {
    if (outDir) {
      await mkdir(outDir, { recursive: true });
      await page.screenshot({ path: `${outDir}/j2-glm-proposal-failure.png` });
    }
    const pageText = await page.locator('body').innerText();
    const inspectorOffset = Math.max(0, pageText.indexOf('INSPECTOR'));
    throw new Error(
      `Proposal did not become reviewable. Visible state:\n${pageText.slice(inspectorOffset, inspectorOffset + 4_000)}`,
      { cause: error },
    );
  }
  await proposal
    .getByText('openrouter · z-ai/glm-5.2', { exact: false })
    .waitFor({ state: 'visible', timeout: 10_000 });
  const proposalText = await proposal.innerText();
  assert(
    proposalText.includes('openrouter · z-ai/glm-5.2'),
    `The proposal must name OpenRouter and z-ai/glm-5.2. Visible proposal:\n${proposalText.slice(0, 2_000)}`,
  );
  if (proposalText.toLowerCase().includes('deterministic fallback')) {
    await page.getByRole('tab', { name: 'Trace' }).click();
    await page.waitForTimeout(500);
    const fallbackTrace = await page.locator('body').innerText();
    const traceOffset = Math.max(0, fallbackTrace.toLowerCase().indexOf('fallback') - 500);
    throw new Error(
      `The hero proof requires a model-authored proposal, not the deterministic fallback. Visible trace:\n${fallbackTrace.slice(traceOffset, traceOffset + 2_500)}`,
    );
  }
  assert(
    !(await page.getByTestId('ai-provider-consent').isChecked()),
    'External consent must reset after the proposal request.',
  );
  assert(
    await page.getByTestId('proposal-accept').isVisible(),
    'Proposal must remain human-gated.',
  );

  await page.getByRole('tab', { name: 'Trace' }).click();
  const trace = page.locator('body');
  await trace.getByText('z-ai/glm-5.2', { exact: false }).first().waitFor({ timeout: 10_000 });
  const traceText = await trace.innerText();
  assert(traceText.includes('COUNTERSIGNED RECEIPT'), 'Trace must expose the custody receipt.');
  assert(
    traceText.includes('Awaiting review'),
    'The slide must remain unchanged pending acceptance.',
  );
  assert(
    !traceText.toLowerCase().includes('deterministic fallback'),
    'The hero trace must remain attributed to the successful GLM path.',
  );

  if (outDir) {
    await mkdir(outDir, { recursive: true });
    await page.screenshot({ path: `${outDir}/j2-glm-proposal-trace.png` });
  }
  console.log(`PASS NodeSlide production hero · ${url}`);
  console.log('PASS real OpenRouter · z-ai/glm-5.2 proposal is validated and human-gated');
  console.log('PASS per-request consent resets and custody trace remains inspectable');
} finally {
  await browser.close();
}
