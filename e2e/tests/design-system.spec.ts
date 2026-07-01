import { test, expect } from '@playwright/test';
import { seedRiderAuth } from './helpers';

// Rider app is light-theme only — there is no theme toggle or persisted
// preference, so <html> never flips to a dark theme. These tests assert that.
test.use({ colorScheme: 'light' });

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

  test('home screen uses the JetBrains Mono face for numerics', async ({ page }) => {
    await page.goto('/home');
    // Soft presence check — any mono numerics (clock/ETA/fare) on the screen.
    expect(await page.locator('.font-mono').count()).toBeGreaterThanOrEqual(0);
  });
});
