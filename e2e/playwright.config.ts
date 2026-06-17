import { defineConfig, devices } from '@playwright/test';

/**
 * Cross-app e2e + visual-regression config.
 *
 * Each frontend runs on its own dev server; projects below pin the matching
 * baseURL. To run locally, start the servers first (or let `webServer` boot them):
 *   rider-app  → npm --prefix ../rider-app run dev   (http://localhost:3050)
 *   client-app → npm --prefix ../client-app run dev   (http://localhost:3000)  [driver]
 *   frontend   → npm --prefix ../frontend run dev     (http://localhost:5173)  [admin]
 *
 * Then: npm test   (or `npx playwright test --project=rider`)
 *
 * All API + realtime traffic is mocked per-spec via page.route(), so no backend
 * is required.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    // Visual-regression tolerance: fail when >1% of pixels differ (Task 4).
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' },
  },
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'rider',
      testMatch: /rider-.*\.spec\.ts/,
      use: { ...devices['Pixel 7'], baseURL: process.env.RIDER_URL ?? 'http://localhost:3050' },
    },
    {
      name: 'driver',
      testMatch: /driver-.*\.spec\.ts/,
      use: { ...devices['Pixel 7'], baseURL: process.env.DRIVER_URL ?? 'http://localhost:3000' },
    },
    {
      name: 'admin',
      testMatch: /admin-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: process.env.ADMIN_URL ?? 'http://localhost:5173' },
    },
    {
      name: 'design',
      testMatch: /design-system\.spec\.ts/,
      use: { ...devices['Pixel 7'], baseURL: process.env.RIDER_URL ?? 'http://localhost:3050' },
    },
    {
      name: 'visual',
      testMatch: /visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Uncomment to let Playwright boot the dev servers automatically. Disabled by
  // default so the suite can also run against already-running servers in CI.
  // webServer: [
  //   { command: 'npm --prefix ../rider-app run dev', url: 'http://localhost:3050', reuseExistingServer: !process.env.CI, timeout: 120_000 },
  //   { command: 'npm --prefix ../client-app run dev', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI, timeout: 120_000 },
  //   { command: 'npm --prefix ../frontend run dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI, timeout: 120_000 },
  // ],
});
