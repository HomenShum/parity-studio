import { expect, test } from 'playwright/test';
import { openSampleWorkspace } from './helpers';

test('builds a bounded noncontiguous multi-slide scope without moving canvas focus', async ({
  page,
}) => {
  await openSampleWorkspace(page);

  const thumbnails = page.locator('[data-testid^="slide-thumbnail-"]');
  expect(await thumbnails.count()).toBeGreaterThanOrEqual(4);
  const activeBefore = await page
    .locator('.ns-slide-row.is-active')
    .getAttribute('data-multi-selected');

  await page.keyboard.down('Control');
  await thumbnails.nth(1).click();
  await thumbnails.nth(3).click();
  await page.keyboard.up('Control');

  await expect(page.locator('.ns-slide-row[data-multi-selected="true"]')).toHaveCount(2);
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await expect(page.locator('.ns-slide-row.is-active')).toHaveCount(1);
  expect(await page.locator('.ns-slide-row.is-active').getAttribute('data-multi-selected')).toBe(
    activeBefore,
  );

  const advancedControls = page.getByTestId('ai-provider-summary');
  await advancedControls.click();

  const scope = page.getByRole('button', { name: 'Selected slides (2)' });
  await expect(scope).toBeVisible();
  await scope.click();
  await expect(scope).toHaveAttribute('aria-pressed', 'true');
});
