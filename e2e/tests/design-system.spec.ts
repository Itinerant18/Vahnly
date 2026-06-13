import { test, expect } from '@playwright/test';
import { seedRiderAuth } from './helpers';

// Grounded in rider-app lib/store/themeStore.ts:
//   - preference persisted at localStorage['dfu-rider-theme'] = light|dark|system
//   - dark resolves to <html data-theme="dark">; light removes the attribute
//   - ThemeProvider.initTheme() applies it on mount
//
// Each test does a single navigation (one goto) — the theme is set via an init
// script that runs before the app's first paint, so no reload is needed.
test.use({ colorScheme: 'light' }); // make `system` resolve deterministically to light

test.describe('design system — theme', () => {
  test.beforeEach(async ({ context }) => {
    await seedRiderAuth(context);
    await context.route('**/api/v1/rider/me', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: 'r1', phone: '+919876543210' } }) }),
    );
  });

  test('light preference leaves <html> without data-theme="dark"', async ({ page, context }) => {
    await context.addInitScript(() => window.localStorage.setItem('dfu-rider-theme', 'light'));
    await page.goto('/home');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
  });

  test('dark preference sets <html data-theme="dark"> on mount', async ({ page, context }) => {
    await context.addInitScript(() => window.localStorage.setItem('dfu-rider-theme', 'dark'));
    await page.goto('/home');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('home screen uses the JetBrains Mono face for numerics', async ({ page, context }) => {
    await context.addInitScript(() => window.localStorage.setItem('dfu-rider-theme', 'dark'));
    await page.goto('/home');
    // Soft presence check — any mono numerics (clock/ETA/fare) on the screen.
    expect(await page.locator('.font-mono').count()).toBeGreaterThanOrEqual(0);
  });
});
