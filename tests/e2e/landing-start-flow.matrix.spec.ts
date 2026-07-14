import { Buffer } from 'node:buffer';
import { expect, test } from 'playwright/test';
import {
  LANDING_MODEL_MATRIX,
  LANDING_STARTERS,
  armLandingConsent,
  chooseDeterministicLandingModel,
  chooseLandingModel,
  expectCleanRuntime,
  expectLandingConsentInvalidated,
  expectNoDocumentOverflow,
  expectNoMojibake,
  openIsolatedLanding,
  readSelectOptions,
  visibleControlNames,
  watchLandingRuntime,
} from './landing-start-flow.helpers';

const acknowledgeKnownSourceFailures = process.env['NODESLIDE_ACKNOWLEDGE_KNOWN_FAILURES'] === '1';

test.describe('NodeSlide landing and start-flow control matrix', () => {
  test('accounts for every first-paint control and keeps the composer keyboard-operable', async ({
    page,
  }) => {
    const runtime = watchLandingRuntime(page);
    await openIsolatedLanding(page);

    const url = new URL(page.url());
    expect(url.pathname).toBe('/');
    expect(url.searchParams.has('deck')).toBe(false);
    expect(url.searchParams.has('share')).toBe(false);

    await expect(page.getByRole('link', { name: 'NodeSlide home' })).toHaveAttribute('href', '/');
    await expect(page.getByLabel('Presentation brief')).toBeVisible();
    await expect(page.getByLabel('Generation model')).toBeVisible();
    await expect(page.getByLabel('Reasoning effort')).toBeVisible();
    await expect(page.getByLabel('Attached data files')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create presentation' })).toBeDisabled();

    expect(await visibleControlNames(page)).toEqual([
      'BYOK / Agents',
      'Open deck',
      'Attach data',
      'Generation model',
      'Create presentation',
      ...LANDING_STARTERS.map(({ label }) => label),
      'Explore the editable sample workspace',
    ]);

    const prompt = page.getByLabel('Presentation brief');
    await prompt.fill('First line');
    await prompt.press('Shift+Enter');
    await prompt.type('Second line');
    await expect(prompt).toHaveValue('First line\nSecond line');

    // Enter with the default external route and no consent must remain a no-op.
    await prompt.press('Enter');
    await expect(prompt).toHaveValue('First line\nSecond line');
    await expect(page.getByRole('button', { name: 'Create presentation' })).toBeDisabled();
    await expect(page.getByText(/Planning, composing, and validating/i)).toHaveCount(0);

    const unnamed = await page
      .locator('button:visible, a:visible, input:visible, select:visible, textarea:visible')
      .evaluateAll((controls) =>
        controls
          .filter((control) => {
            const aria = control.getAttribute('aria-label')?.trim();
            const title = control.getAttribute('title')?.trim();
            const text = control.textContent?.trim();
            const labels =
              control instanceof HTMLInputElement ||
              control instanceof HTMLSelectElement ||
              control instanceof HTMLTextAreaElement
                ? (control.labels?.length ?? 0)
                : 0;
            return !aria && !title && !text && labels === 0;
          })
          .map((control) => control.outerHTML.slice(0, 180)),
      );
    expect(unnamed).toEqual([]);
    await expectNoDocumentOverflow(page);
    await expectNoMojibake(page);
    expect(runtime.providerRequests).toEqual([]);
    await expectCleanRuntime(runtime);
  });

  test('every starter prefills only, never submits or grants provider consent', async ({
    page,
  }) => {
    const runtime = watchLandingRuntime(page);
    await openIsolatedLanding(page);

    for (const starter of LANDING_STARTERS) {
      await page.getByRole('button', { name: starter.label }).click();
      await expect(page.getByLabel('Presentation brief')).toHaveValue(starter.prompt);
      await expectLandingConsentInvalidated(page);
      await expect(page.getByTestId('nodeslide-landing')).toBeVisible();
    }

    await page.getByLabel('Presentation brief').fill('A fresh idea typed directly by the user.');
    await expectLandingConsentInvalidated(page);
    expect(runtime.providerRequests).toEqual([]);
    await expectCleanRuntime(runtime);
  });

  test('exercises the complete model catalog and only provider-native effort choices', async ({
    page,
  }) => {
    const runtime = watchLandingRuntime(page);
    await openIsolatedLanding(page);
    await page.getByLabel('Presentation brief').fill('Build a model-routing QA deck.');

    await page.getByTestId('landing-model-select').click();
    const modelDialog = page.getByRole('dialog', { name: 'Generation model' });
    const search = modelDialog.getByPlaceholder('Search models and providers…');
    await search.fill('definitely-not-a-real-model');
    await expect(modelDialog.getByText('No models found.')).toBeVisible();
    await search.fill('');
    await page.keyboard.press('Escape');
    await expect(modelDialog).toBeHidden();
    await expect(page.getByTestId('landing-model-select')).toBeFocused();

    for (const model of LANDING_MODEL_MATRIX) {
      await chooseLandingModel(page, model);
      await expect(page.getByTestId('landing-model-select')).toContainText(model.label);
      await expect(page.locator('.ns-landing-web')).toHaveText(model.provider);
      await expect(page.getByTestId('landing-provider-consent')).not.toBeChecked();
      await expect(readSelectOptions(page.getByTestId('landing-effort-select'))).resolves.toEqual(
        model.efforts,
      );
    }

    await chooseDeterministicLandingModel(page);
    await expect(page.getByTestId('landing-model-select')).toContainText('Deterministic');
    await expect(page.getByTestId('landing-effort-select')).toHaveCount(0);
    await expect(page.getByTestId('landing-provider-consent')).toHaveCount(0);
    await expect(page.locator('.ns-landing-privacy')).toContainText('No external model egress');
    await expect(page.getByRole('button', { name: 'Create presentation' })).toBeEnabled();
    expect(runtime.providerRequests).toEqual([]);
    await expectCleanRuntime(runtime);
  });

  test('invalidates one-shot consent whenever the exact request snapshot changes', async ({
    page,
  }) => {
    const runtime = watchLandingRuntime(page);
    await openIsolatedLanding(page);
    const prompt = page.getByLabel('Presentation brief');
    await prompt.fill('Build a consent-bound presentation.');

    await armLandingConsent(page);
    await expect(page.getByRole('button', { name: 'Create presentation' })).toBeEnabled();
    await prompt.press('End');
    await prompt.type(' Updated.');
    await expectLandingConsentInvalidated(page);

    await armLandingConsent(page);
    await page.getByTestId('landing-effort-select').selectOption('low');
    await expectLandingConsentInvalidated(page);

    await armLandingConsent(page);
    await chooseLandingModel(page, LANDING_MODEL_MATRIX[1]);
    await expectLandingConsentInvalidated(page);

    await armLandingConsent(page);
    await page.getByRole('button', { name: LANDING_STARTERS[0].label }).click();
    await expectLandingConsentInvalidated(page);

    await armLandingConsent(page);
    await page.getByTestId('landing-file-input').setInputFiles({
      name: 'consent-snapshot.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('label,value\nA,1\n'),
    });
    await expect(page.getByLabel('Attached data files')).toContainText('consent-snapshot.csv');
    await expectLandingConsentInvalidated(page);

    await armLandingConsent(page);
    await page.getByRole('button', { name: 'Remove consent-snapshot.csv' }).click();
    await expect(page.getByLabel('Attached data files')).toHaveCount(0);
    await expectLandingConsentInvalidated(page);

    expect(runtime.providerRequests).toEqual([]);
    await expectCleanRuntime(runtime);
  });

  test('accepts, removes, rejects, bounds, and recovers from attachment input edge cases', async ({
    page,
  }) => {
    test.fail(
      acknowledgeKnownSourceFailures,
      'Known product defect: attachment churn triggers React setState-during-render in PromptInput.',
    );
    const runtime = watchLandingRuntime(page);
    await openIsolatedLanding(page);
    const input = page.getByTestId('landing-file-input');

    await input.setInputFiles({
      name: 'valid.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('label,value\nA,1\n'),
    });
    await expect(page.getByLabel('Attached data files')).toContainText('valid.csv');
    await page.getByRole('button', { name: 'Remove valid.csv' }).click();
    await expect(page.getByLabel('Attached data files')).toHaveCount(0);

    await input.setInputFiles({
      name: 'not-data.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not-an-image'),
    });
    await expect(page.getByRole('alert')).toHaveText('No files match the accepted types.');
    await expect(page.getByLabel('Attached data files')).toHaveCount(0);

    await input.setInputFiles({
      name: 'too-large.txt',
      mimeType: 'text/plain',
      buffer: Buffer.alloc(24_001, 'x'),
    });
    await expect(page.getByRole('alert')).toHaveText('All files exceed the maximum size.');
    await expect(page.getByLabel('Attached data files')).toHaveCount(0);

    await input.setInputFiles([
      { name: 'one.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2') },
      { name: 'two.json', mimeType: 'application/json', buffer: Buffer.from('{"value":2}') },
      { name: 'three.md', mimeType: 'text/markdown', buffer: Buffer.from('# Evidence') },
    ]);
    await expect(page.getByLabel('Attached data files')).toContainText('one.csv');
    await expect(page.getByLabel('Attached data files')).toContainText('two.json');
    await expect(page.getByLabel('Attached data files')).toContainText('three.md');

    await input.setInputFiles({
      name: 'four.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('four'),
    });
    await expect(page.getByLabel('Attached data files')).not.toContainText('four.txt');

    await page.getByRole('button', { name: 'Remove one.csv' }).click();
    await input.setInputFiles({
      name: 'replacement.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('replacement'),
    });
    await expect(page.getByLabel('Attached data files')).toContainText('replacement.txt');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(runtime.providerRequests).toEqual([]);
    await expectCleanRuntime(runtime);
  });

  test('reports a visible reason when the attachment cap rejects another file', async ({
    page,
  }) => {
    test.fail(
      true,
      'Known product defect: the fourth file is rejected, but the landing composer emits no inline max-files alert.',
    );
    await openIsolatedLanding(page);
    const input = page.getByTestId('landing-file-input');
    await input.setInputFiles([
      { name: 'one.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2') },
      { name: 'two.json', mimeType: 'application/json', buffer: Buffer.from('{"value":2}') },
      { name: 'three.md', mimeType: 'text/markdown', buffer: Buffer.from('# Evidence') },
    ]);
    await input.setInputFiles({
      name: 'four.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('four'),
    });
    await expect(page.getByLabel('Attached data files')).not.toContainText('four.txt');
    await expect(page.getByRole('alert')).toHaveText('Too many files. Some were not added.', {
      timeout: 1_500,
    });
  });

  test('opens, operates, and closes BYOK and coding-agent connections without egress', async ({
    page,
    context,
  }) => {
    const runtime = watchLandingRuntime(page);
    await openIsolatedLanding(page);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const trigger = page.getByRole('button', { name: 'BYOK / Agents' });
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: 'Connect your own runtime' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Continue to Google' })).toBeDisabled();
    await expect(
      dialog.getByText(/does not expose a Google Slides push or pull action/i),
    ).toBeVisible();

    await dialog.getByLabel('Anthropic').fill('test-anthropic-1234');
    await dialog.getByLabel('Model ID').fill('test/model');
    await dialog.getByRole('button', { name: 'Save in this tab' }).click();
    await expect(
      dialog.getByText('Saved in this browser tab only. Nothing was sent to NodeSlide.'),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        window.sessionStorage.getItem('parity.studio.byok.ANTHROPIC_API_KEY'),
      ),
    ).toBe('test-anthropic-1234');

    await dialog.getByRole('tab', { name: 'Codex' }).click();
    await expect(dialog.getByRole('tab', { name: 'Codex' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await dialog.getByRole('button', { name: 'Revoke all' }).click();
    await expect(dialog.getByText('Local connection values revoked from this tab.')).toBeVisible();
    expect(
      await page.evaluate(() =>
        window.sessionStorage.getItem('parity.studio.byok.ANTHROPIC_API_KEY'),
      ),
    ).toBeNull();

    await dialog.getByRole('button', { name: 'Copy config' }).click();
    await expect(dialog.getByText(/Codex config\.toml snippet copied/i)).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      '[mcp_servers.nodeslide]',
    );
    await expect(dialog.getByRole('link', { name: /Setup and tool reference/ })).toHaveAttribute(
      'href',
      'https://github.com/HomenShum/parity-studio/tree/main/mcp',
    );

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page
      .getByRole('dialog', { name: 'Connect your own runtime' })
      .getByRole('button', { name: 'Close' })
      .click();
    await expect(dialog).toBeHidden();
    expect(runtime.providerRequests).toEqual([]);
    await expectCleanRuntime(runtime);
  });

  test('opens and closes the capability-honest owned-deck dialog', async ({ page }) => {
    const runtime = watchLandingRuntime(page);
    await openIsolatedLanding(page);
    const trigger = page.getByRole('button', { name: 'Open deck' });
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: 'Open a deck' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/A deck ID alone never grants access/i)).toBeVisible();
    await expect(dialog.getByText('No owned decks are stored in this browser yet.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /import/i })).toHaveCount(0);
    await expect(dialog.getByRole('tab')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await dialog.getByRole('button', { name: 'Close project dialog' }).click();
    await expect(dialog).toBeHidden();
    expect(runtime.providerRequests).toEqual([]);
    await expectCleanRuntime(runtime);
  });
});

for (const visualCase of [
  { name: 'desktop-light', width: 1440, height: 1000, scheme: 'light' },
  { name: 'desktop-dark', width: 1440, height: 1000, scheme: 'dark' },
  { name: 'tablet-light', width: 900, height: 1100, scheme: 'light' },
  { name: 'tablet-dark', width: 900, height: 1100, scheme: 'dark' },
  { name: 'mobile-light', width: 390, height: 844, scheme: 'light' },
  { name: 'mobile-dark', width: 390, height: 844, scheme: 'dark' },
] as const) {
  test(`landing is reachable and bounded at ${visualCase.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: visualCase.width, height: visualCase.height });
    await page.emulateMedia({ colorScheme: visualCase.scheme });
    const runtime = watchLandingRuntime(page);
    await openIsolatedLanding(page);

    await expect(page.getByLabel('Presentation brief')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create presentation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'BYOK / Agents' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open deck' })).toBeVisible();
    await expectNoDocumentOverflow(page);
    await expectNoMojibake(page);

    await page.screenshot({
      path: testInfo.outputPath(`landing-${visualCase.name}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await expectCleanRuntime(runtime);
  });
}

test('mobile landing controls meet the minimum touch-target floor', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openIsolatedLanding(page);
  const undersized = await page.locator('button:visible, select:visible').evaluateAll((controls) =>
    controls
      .map((control) => ({
        height: Math.round(control.getBoundingClientRect().height * 10) / 10,
        name:
          control.getAttribute('aria-label') ||
          control.textContent?.replace(/\s+/g, ' ').trim() ||
          control.tagName.toLowerCase(),
      }))
      .filter(({ height }) => height < 40),
  );
  expect(undersized, JSON.stringify(undersized, null, 2)).toEqual([]);
});

test('dark preference produces a dark landing surface or an explicit theme control', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openIsolatedLanding(page);
  const darkState = await page.evaluate(() => {
    const landing = document.querySelector<HTMLElement>('[data-testid="nodeslide-landing"]');
    if (!landing) throw new Error('Landing surface is missing.');
    const backgroundImage = getComputedStyle(landing).backgroundImage;
    const colors = Array.from(
      backgroundImage.matchAll(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/g),
      (match) => [Number(match[1]), Number(match[2]), Number(match[3])],
    );
    const luminances = colors
      .map(([red = 255, green = 255, blue = 255]) => (red * 299 + green * 587 + blue * 114) / 1000)
      .sort((left, right) => right - left);
    const surfaceLuminance =
      luminances.length >= 2
        ? ((luminances[0] ?? 255) + (luminances[1] ?? 255)) / 2
        : (luminances[0] ?? 255);
    return {
      backgroundImage,
      darkMedia: window.matchMedia('(prefers-color-scheme: dark)').matches,
      hasThemeControl: Boolean(
        document.querySelector('[aria-label*="dark theme" i], [aria-label*="light theme" i]'),
      ),
      surfaceLuminance,
    };
  });
  expect(darkState.darkMedia).toBe(true);
  expect(
    darkState.hasThemeControl || darkState.surfaceLuminance < 100,
    JSON.stringify(darkState),
  ).toBe(true);
});
