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
    await model.selectOption('deterministic');
    await expect(page.locator('.ns-landing-privacy')).toContainText('No external model egress');

    const externalValue = await model
      .locator('option:not([value="deterministic"])')
      .first()
      .getAttribute('value');
    expect(externalValue).toBeTruthy();
    await model.selectOption(externalValue ?? '');
    await expect(page.locator('.ns-landing-privacy')).toContainText(
      'route, tokens, and cost are recorded in Trace',
    );
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
