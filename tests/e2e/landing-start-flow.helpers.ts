import { type Locator, type Page, expect } from 'playwright/test';

export const LANDING_STARTERS = [
  {
    label: 'World Cup data story',
    prompt:
      'Create an evidence-led presentation about the 2022 FIFA World Cup with an editable chart, a goals-per-match formula, source-linked claims, and a clear executive takeaway.',
  },
  {
    label: 'AI 2027 scenario',
    prompt:
      'Build a scenario presentation about AI through 2027. Separate evidence from assumptions, visualize the major inflection points, and end with decisions leaders should make now.',
  },
  {
    label: 'AI Fund product narrative',
    prompt:
      'Create a concise product narrative for AI Fund reviewers: customer problem, agentic workflow, technical trust model, product wedge, validation plan, and next milestones.',
  },
] as const;

export const LANDING_MODEL_MATRIX = [
  {
    group: 'Recommended',
    label: 'GLM 5.2',
    provider: 'Nebius',
    efforts: ['Low', 'Medium', 'High'],
  },
  {
    group: 'More live models',
    label: 'GLM 5.2',
    provider: 'OpenRouter',
    efforts: ['Low', 'Medium', 'High', 'XHigh'],
  },
  {
    group: 'More live models',
    label: 'Claude Sonnet 5',
    provider: 'OpenRouter',
    efforts: ['Low', 'Medium', 'High', 'XHigh', 'Max'],
  },
  {
    group: 'More live models',
    label: 'Claude Fable 5',
    provider: 'OpenRouter',
    efforts: ['Low', 'Medium', 'High'],
  },
  {
    group: 'More live models',
    label: 'Gemini 3.5 Flash',
    provider: 'OpenRouter',
    efforts: ['Low', 'Medium', 'High'],
  },
  {
    group: 'More live models',
    label: 'Gemini 3.1 Pro',
    provider: 'OpenRouter',
    efforts: ['Low', 'Medium', 'High'],
  },
  {
    group: 'More live models',
    label: 'GPT-5.6 Luna',
    provider: 'OpenRouter',
    efforts: ['Low', 'Medium', 'High', 'XHigh', 'Max'],
  },
  {
    group: 'More live models',
    label: 'GPT-5.6 Sol',
    provider: 'OpenRouter',
    efforts: ['Low', 'Medium', 'High', 'XHigh', 'Max'],
  },
  {
    group: 'More live models',
    label: 'GPT-5.6 Terra',
    provider: 'OpenRouter',
    efforts: ['Low', 'Medium', 'High', 'XHigh', 'Max'],
  },
] as const;

export interface LandingRuntimeProbe {
  consoleErrors: string[];
  pageErrors: string[];
  providerRequests: string[];
}

export function watchLandingRuntime(page: Page): LandingRuntimeProbe {
  const probe: LandingRuntimeProbe = {
    consoleErrors: [],
    pageErrors: [],
    providerRequests: [],
  };
  page.on('console', (message) => {
    if (message.type() === 'error') probe.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => probe.pageErrors.push(error.message));
  page.on('request', (request) => {
    if (/openrouter|nebius|generativelanguage|api\.anthropic|api\.openai/i.test(request.url())) {
      probe.providerRequests.push(request.url());
    }
  });
  return probe;
}

export async function openIsolatedLanding(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload();
  await expect(page.getByTestId('nodeslide-landing')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'What presentation should we build?',
  );
  await expect(page.getByTestId('nodeslide-studio')).toHaveCount(0);
}

export async function chooseLandingModel(
  page: Page,
  model: { group: string; label: string },
): Promise<void> {
  await page.getByTestId('landing-model-select').click();
  const dialog = page.getByRole('dialog', { name: 'Generation model' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(model.group).getByText(model.label, { exact: true }).click();
  await expect(dialog).toBeHidden();
}

export async function chooseDeterministicLandingModel(page: Page): Promise<void> {
  await page.getByTestId('landing-model-select').click();
  const dialog = page.getByRole('dialog', { name: 'Generation model' });
  await dialog.getByLabel('Private fallback').getByText('Deterministic', { exact: true }).click();
  await expect(dialog).toBeHidden();
}

export async function readSelectOptions(page: Page, trigger: Locator): Promise<string[]> {
  await trigger.click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  const labels = await listbox
    .getByRole('option')
    .allTextContents()
    .then((options) => options.map((label) => label.trim()));
  await page.keyboard.press('Escape');
  await expect(listbox).toBeHidden();
  return labels;
}

export async function chooseSelectOption(
  page: Page,
  trigger: Locator,
  label: string,
): Promise<void> {
  await trigger.click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  await listbox.getByRole('option', { name: label, exact: true }).click();
  await expect(listbox).toBeHidden();
}

export async function grantLandingSessionConsent(page: Page): Promise<void> {
  const consent = page.getByTestId('landing-provider-consent');
  await expect(consent).toBeVisible();
  await consent.check();
  await expectLandingSessionConsent(page, true);
}

export async function expectLandingSessionConsent(page: Page, granted: boolean): Promise<void> {
  const consent = page.getByTestId('landing-provider-consent');
  await expect(consent).toBeVisible();
  if (granted) {
    await expect(consent).toBeChecked();
  } else {
    await expect(consent).not.toBeChecked();
  }
}

export async function expectNoDocumentOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 2);
}

export async function expectNoMojibake(page: Page): Promise<void> {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(
    /(?:\u00c2[\u00a0-\u00bf]|\u00c3[\u0080-\u00bf]|\u00e2(?:\u0080|\u0096|\u0097|\u0082))/u,
  );
}

export async function visibleControlNames(page: Page): Promise<string[]> {
  return page.locator('button:visible').evaluateAll((buttons) =>
    buttons.map((button) => {
      const label = button.getAttribute('aria-label')?.trim();
      const text = button.textContent?.replace(/\s+/g, ' ').trim();
      return label || text || '<unnamed>';
    }),
  );
}

export async function expectCleanRuntime(probe: LandingRuntimeProbe): Promise<void> {
  expect(probe.pageErrors).toEqual([]);
  expect(probe.consoleErrors).toEqual([]);
}
