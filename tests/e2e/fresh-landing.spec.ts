import { Buffer } from 'node:buffer';
import { expect, test } from 'playwright/test';
import { expectNoDocumentOverflow, openFreshLanding } from './helpers';

test.describe('canonical fresh landing', () => {
  test('opens at the canonical URL and exposes an honest model picker', async ({ page }) => {
    await openFreshLanding(page);

    const url = new URL(page.url());
    expect(url.pathname).toBe('/');
    expect(url.search).toBe('');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'What presentation should we build?',
    );
    await expect(page.getByTestId('nodeslide-studio')).toHaveCount(0);

    const prompt = page.getByLabel('Presentation brief');
    await prompt.fill('Build a concise quarterly review');
    await expect(prompt).toHaveValue('Build a concise quarterly review');

    const model = page.getByTestId('landing-model-select');
    const recommendedLabel = (await model.innerText()).trim();
    await model.click();
    const modelDialog = page.getByRole('dialog', { name: 'Generation model' });
    await modelDialog.getByText('Deterministic', { exact: true }).click();
    await expect(page.locator('.ns-landing-privacy')).toContainText('No external model egress');

    await model.click();
    await modelDialog
      .getByLabel('Recommended')
      .getByText(recommendedLabel, { exact: true })
      .click();
    await expect(page.locator('.ns-landing-privacy')).toContainText(
      'Check consent for this request before creation',
    );
    const consent = page.getByTestId('landing-provider-consent');
    await expect(consent).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Create presentation' })).toBeDisabled();
    await consent.check();
    await expect(page.getByRole('button', { name: 'Create presentation' })).toBeEnabled();
  });

  test('attaches and removes a local data file before creation', async ({ page }) => {
    await openFreshLanding(page);
    await page.getByTestId('landing-file-input').setInputFiles({
      name: 'quarterly.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('quarter,revenue\nQ1,42\n'),
    });

    await expect(page.getByLabel('Attached data files')).toContainText('quarterly.csv');
    await page.getByRole('button', { name: 'Remove quarterly.csv' }).click();
    await expect(page.getByLabel('Attached data files')).toHaveCount(0);
  });

  test('has basic landmarks, names, keyboard focus, and no unnamed visible buttons', async ({
    page,
  }) => {
    await openFreshLanding(page);

    await expect(page.locator('main:visible')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByLabel('Presentation brief')).toBeVisible();
    await expect(page.getByLabel('Generation model')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create presentation' })).toBeDisabled();

    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    const unnamedButtons = await page
      .locator('button:visible')
      .evaluateAll((buttons) =>
        buttons
          .filter(
            (button) =>
              !button.getAttribute('aria-label') &&
              !button.getAttribute('title') &&
              !(button.textContent ?? '').trim(),
          )
          .map((button) => button.outerHTML.slice(0, 160)),
      );
    expect(unnamedButtons).toEqual([]);
    await expectNoDocumentOverflow(page);
  });

  test('keeps starter and sample actions at accessible touch sizes and spacing', async ({
    page,
  }) => {
    await openFreshLanding(page);

    const starters = page.getByLabel('Presentation starters');
    const starterButtons = starters.getByRole('button');
    const starterHeights = await starterButtons.evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height),
    );
    expect(starterHeights.length).toBeGreaterThan(0);
    expect(Math.min(...starterHeights)).toBeGreaterThanOrEqual(24);

    const sample = page.getByRole('button', { name: 'Explore the editable sample workspace' });
    const sampleHeight = await sample.evaluate((button) => button.getBoundingClientRect().height);
    expect(sampleHeight).toBeGreaterThanOrEqual(24);

    const starterGap = await starters.evaluate((container) => {
      const style = getComputedStyle(container);
      return Math.min(Number.parseFloat(style.columnGap), Number.parseFloat(style.rowGap));
    });
    expect(starterGap).toBeGreaterThanOrEqual(8);

    const sampleGap = await page.evaluate(() => {
      const starter = document.querySelector('.ns-landing-starters');
      const sampleButton = document.querySelector('.ns-landing-sample');
      if (!(starter instanceof HTMLElement) || !(sampleButton instanceof HTMLElement)) return -1;
      return sampleButton.getBoundingClientRect().top - starter.getBoundingClientRect().bottom;
    });
    expect(sampleGap).toBeGreaterThanOrEqual(8);

    const viewAll = page.getByRole('button', { name: 'View all' });
    if (await viewAll.count()) {
      const viewAllHeight = await viewAll.evaluate(
        (button) => button.getBoundingClientRect().height,
      );
      expect(viewAllHeight).toBeGreaterThanOrEqual(24);
    }
  });
});

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 900, height: 1100 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  test(`fresh landing is usable at ${viewport.name} width`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openFreshLanding(page);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByLabel('Presentation brief')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create presentation' })).toBeVisible();
    await expectNoDocumentOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`fresh-landing-${viewport.name}.png`),
      fullPage: true,
    });
  });
}
