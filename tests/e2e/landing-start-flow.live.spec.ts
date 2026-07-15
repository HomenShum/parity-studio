import { Buffer } from 'node:buffer';
import { expect, test } from 'playwright/test';
import {
  chooseDeterministicLandingModel,
  expectNoDocumentOverflow,
  openIsolatedLanding,
  watchLandingRuntime,
} from './landing-start-flow.helpers';

const liveBackendCoverage = process.env['NODESLIDE_E2E_LIVE_BACKEND'] === '1';
const mutationCoverage = process.env['NODESLIDE_E2E_MUTATIONS'] === '1';

test.describe('NodeSlide landing backend transitions', () => {
  test.skip(
    !liveBackendCoverage,
    'Set NODESLIDE_E2E_LIVE_BACKEND=1 against an isolated or production backend.',
  );

  test('opens the sample, returns home, and reopens it from recent decks', async ({ page }) => {
    test.setTimeout(180_000);
    const runtime = watchLandingRuntime(page);
    await openIsolatedLanding(page);

    await page.getByRole('button', { name: 'Explore the editable sample workspace' }).dblclick();
    await expect(page.getByTestId('deck-title')).toBeVisible({ timeout: 90_000 });
    await expect(page).toHaveURL(/[?&]deck=/);
    const sampleDeckUrl = page.url();
    await expectNoDocumentOverflow(page);
    expect(runtime.providerRequests).toEqual([]);

    await page.goto('/');
    await expect(page.getByTestId('nodeslide-landing')).toBeVisible({ timeout: 60_000 });
    const recents = page.getByRole('region', { name: 'Recent decks' });
    await expect(recents).toBeVisible();
    const recentDeck = recents.locator('li button').first();
    await expect(recentDeck).toBeVisible();
    await recentDeck.click();
    await expect(page.getByTestId('deck-title')).toBeVisible({ timeout: 60_000 });
    expect(page.url()).toBe(sampleDeckUrl);
  });

  test('keyboard submit exposes loading, suppresses duplicate creation, and leaves a reopenable recent', async ({
    page,
  }) => {
    test.skip(
      !mutationCoverage,
      'Set NODESLIDE_E2E_MUTATIONS=1 only against an isolated mutation-safe deployment.',
    );
    test.setTimeout(240_000);
    await openIsolatedLanding(page);
    await chooseDeterministicLandingModel(page);

    const prompt = page.getByLabel('Presentation brief');
    const unique = `Landing keyboard QA ${Date.now()}: build exactly six concise slides for a private product review.`;
    await prompt.fill(unique);
    const submit = page.getByRole('button', { name: 'Create presentation' });
    await expect(submit).toBeEnabled();

    // A semantically invalid attachment fails before any backend mutation and
    // preserves the user's draft so the same start flow can be corrected and retried.
    await page.getByTestId('landing-file-input').setInputFiles({
      name: 'malformed.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{not-json'),
    });
    await prompt.press('Enter');
    await expect(page.getByRole('alert')).toHaveText('Uploaded JSON is malformed.');
    await expect(prompt).toHaveValue(unique);
    await expect(page.getByLabel('Attached data files')).toContainText('malformed.json');
    await expect(submit).toBeEnabled();

    await page.getByRole('button', { name: 'Remove malformed.json' }).click();
    await page.getByTestId('landing-file-input').setInputFiles({
      name: 'valid.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"decision":"ship"}'),
    });
    await expect(page.getByRole('alert')).toHaveCount(0);

    await prompt.press('Enter');
    await expect(
      page.getByText(/Planning, composing, and validating your editable deck/i),
    ).toBeVisible();
    await expect(submit).toBeDisabled();
    await submit.dblclick({ force: true });

    await expect(page.getByTestId('deck-title')).toBeVisible({ timeout: 180_000 });
    const deckUrl = page.url();
    await expect(page).toHaveURL(/[?&]deck=/);

    await page.goto('/');
    await expect(page.getByTestId('nodeslide-landing')).toBeVisible({ timeout: 60_000 });
    const matchingRecent = page.getByRole('button', { name: new RegExp(unique.slice(0, 24), 'i') });
    await expect(matchingRecent).toHaveCount(1);
    await matchingRecent.click();
    await expect(page).toHaveURL(deckUrl);
  });
});
