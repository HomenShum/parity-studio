import { type Page, expect } from 'playwright/test';

export async function openFreshLanding(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload();
  await expect(page.getByTestId('nodeslide-landing')).toBeVisible();
}

export async function expectNoDocumentOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 2);
}

export async function openSampleWorkspace(page: Page): Promise<void> {
  await openFreshLanding(page);
  await page.getByRole('button', { name: 'Explore the editable sample workspace' }).click();
  await expect(page.getByTestId('deck-title')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('ai-composer')).toBeVisible();
  await expect(page).toHaveURL(/[?&]deck=/);
}

export async function readVersionState(
  page: Page,
): Promise<{ version: number; revisionCount: number }> {
  await page.getByTestId('inspector-more').click();
  await page.getByTestId('inspector-tab-versions').click();
  const versionText = await page.locator('.ns-count-pill').textContent();
  const match = /^v(\d+)$/.exec(versionText?.trim() ?? '');
  if (!match?.[1]) throw new Error(`Could not parse deck version from ${versionText ?? 'null'}.`);
  const revisionCount = await page.locator('[aria-label="Deck revisions"] .ns-version-row').count();
  return { version: Number(match[1]), revisionCount };
}
