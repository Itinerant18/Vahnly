import { test, expect } from '@playwright/test';
import { seedRiderAuth, seedAdminAuth, fulfillJson } from './helpers';

// Task 4 — visual regression. Baselines live in tests/visual.spec.ts-snapshots/.
// First run (or intentional UI change): `npm run update-snapshots`.
// CI run: pixels differing by >1% (config maxDiffPixelRatio 0.01) fail the test.
//
// Each screen uses its app's dev URL (env override → sensible default). Mark a
// screen test.skip until its app + baseline are wired in your environment.

const RIDER = process.env.RIDER_URL ?? 'http://localhost:3050';
const DRIVER = process.env.DRIVER_URL ?? 'http://localhost:3000';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5173';

test.describe('visual regression', () => {
  test('rider home — light', async ({ page, context }) => {
    await seedRiderAuth(context);
    await context.addInitScript(() => window.localStorage.setItem('dfu-rider-theme', 'light'));
    await context.route('**/api/v1/rider/me', (r) => fulfillJson(r, { id: 'r1', phone: '+919876543210' }));
    await page.goto(`${RIDER}/home`);
    await expect(page).toHaveScreenshot('rider-home-light.png', { fullPage: true });
  });

  test('rider login', async ({ page }) => {
    await page.goto(`${RIDER}/login`);
    await expect(page).toHaveScreenshot('rider-login.png', { fullPage: true });
  });

  test.skip('driver duty dashboard (online)', async ({ page, context }) => {
    await context.addInitScript(() => window.localStorage.setItem('platform-auth-storage', JSON.stringify({ state: { token: 'x', isAuthenticated: true }, version: 0 })));
    await page.goto(`${DRIVER}/driver`);
    await expect(page).toHaveScreenshot('driver-duty-online.png', { fullPage: true });
  });

  test.skip('admin dashboard', async ({ page, context }) => {
    await seedAdminAuth(context);
    await page.goto(`${ADMIN}/admin`);
    await expect(page).toHaveScreenshot('admin-dashboard.png', { fullPage: true });
  });

  test.skip('admin driver KYC queue', async ({ page, context }) => {
    await seedAdminAuth(context);
    await page.goto(`${ADMIN}/admin/drivers/onboarding`);
    await expect(page).toHaveScreenshot('admin-kyc-queue.png', { fullPage: true });
  });
});
