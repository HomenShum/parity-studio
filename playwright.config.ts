import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'playwright/test';

const remoteBaseUrl = process.env['PLAYWRIGHT_BASE_URL'];
const journeyProofEnabled = process.env['NODESLIDE_JOURNEY_PROOF'] === '1';
const baseURL = remoteBaseUrl ?? 'http://127.0.0.1:4173';
const vercelBypassSecret = process.env['VERCEL_AUTOMATION_BYPASS_SECRET']?.trim();
const bypassStorageState = join(
  tmpdir(),
  `parity-studio-vercel-bypass-${process.env['GITHUB_RUN_ID'] ?? 'local'}.json`,
);

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  ...(remoteBaseUrl && vercelBypassSecret
    ? { globalSetup: './tests/e2e/vercel-bypass.globalSetup.ts' }
    : {}),
  reporter: process.env['CI']
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    browserName: 'chromium',
    ...(remoteBaseUrl && vercelBypassSecret ? { storageState: bypassStorageState } : {}),
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Protected-preview traces can serialize the bypass cookie. Keep that
    // credential out of uploaded artifacts while retaining screenshots/video.
    trace: remoteBaseUrl && vercelBypassSecret ? 'off' : 'retain-on-failure',
    screenshot: journeyProofEnabled ? 'on' : 'only-on-failure',
    video: journeyProofEnabled ? 'on' : 'retain-on-failure',
  },
  webServer: remoteBaseUrl
    ? undefined
    : {
        command: 'pnpm dev:web --host 127.0.0.1 --port 4173',
        url: baseURL,
        reuseExistingServer: !process.env['CI'],
        timeout: 120_000,
        env: {
          VITE_CONVEX_URL: process.env['VITE_CONVEX_URL'] ?? 'https://ci-placeholder.convex.cloud',
          VITE_CONVEX_SITE_URL:
            process.env['VITE_CONVEX_SITE_URL'] ?? 'https://ci-placeholder.convex.site',
        },
      },
});
