import { defineConfig } from 'playwright/test';

const remoteBaseUrl = process.env['PLAYWRIGHT_BASE_URL'];
const baseURL = remoteBaseUrl ?? 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env['CI']
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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
