import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'playwright/test';
import { expectNoDocumentOverflow, openFreshLanding } from './helpers';

const proofDir = resolve(process.cwd(), '.tmp', 'dialog-runtime');

test.beforeAll(async () => {
  await mkdir(proofDir, { recursive: true });
});

test('connections dialog is centered, readable, scrollable, and restores focus', async ({
  page,
}) => {
  await openFreshLanding(page);
  const trigger = page.getByRole('button', { name: 'BYOK / Agents' });
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: 'Connect your own runtime' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  if (!box) throw new Error('Connections dialog has no rendered geometry.');
  expect(box.width).toBeGreaterThanOrEqual(880);
  expect(Math.abs(box.x - (1440 - box.width) / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y - (1000 - box.height) / 2)).toBeLessThanOrEqual(2);

  const titleSize = await dialog
    .getByRole('heading', { level: 1 })
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(titleSize).toBeGreaterThanOrEqual(20);
  const firstInput = dialog.locator('input').first();
  await expect(firstInput).toBeFocused();
  const firstInputBox = await firstInput.boundingBox();
  if (!firstInputBox) throw new Error('First BYOK field has no rendered geometry.');
  expect(firstInputBox.height).toBeGreaterThanOrEqual(38);
  await expect(dialog.getByRole('button', { name: 'Continue to Google' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Save in this tab' })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Claude Code / Cursor' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await dialog.getByRole('tab', { name: 'Codex' }).click();
  await expect(dialog.getByText('~/.codex/config.toml')).toBeVisible();
  await expectNoDocumentOverflow(page);
  await page.screenshot({ path: resolve(proofDir, 'connections-desktop.png') });

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('landing omits the editor-owned Open deck dialog entry point', async ({ page }) => {
  await openFreshLanding(page);
  await expect(page.getByRole('button', { name: 'Open deck' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Open a deck' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'BYOK / Agents' })).toBeVisible();
  await expectNoDocumentOverflow(page);
});

test('connections dialog remains usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFreshLanding(page);
  await page.getByRole('button', { name: 'BYOK / Agents' }).click();

  const dialog = page.getByRole('dialog', { name: 'Connect your own runtime' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  if (!box) throw new Error('Mobile connections dialog has no rendered geometry.');
  expect(box.x).toBeGreaterThanOrEqual(7);
  expect(box.width).toBeLessThanOrEqual(374);
  expect(box.height).toBeLessThanOrEqual(828);
  await page.screenshot({ path: resolve(proofDir, 'connections-mobile.png') });
  await dialog.getByRole('button', { name: 'Save in this tab' }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: 'Save in this tab' })).toBeVisible();
  await expectNoDocumentOverflow(page);
});
