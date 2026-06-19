import { test, expect } from '@playwright/test';
import { fulfillJson } from './helpers';

// SKIPPED — un-CI-able as written. The login phone flow uses Firebase phone auth
// (PhoneVerifyScreen: signInWithPhoneNumber + invisible reCAPTCHA + signInWithCredential,
// then POST /api/v1/auth/firebase/verify), not the REST send-otp/verify-otp endpoints
// this spec mocks. Firebase SDK calls + reCAPTCHA can't be satisfied by Playwright route
// mocks. Un-skip once the Firebase Auth Emulator (test phone numbers / fixed OTP) is wired
// into CI + the app's test config; then rewrite against PhoneVerifyScreen's real DOM.
test.describe.skip('rider OTP login', () => {
  test('rider can log in with OTP and land on /home', async ({ page }) => {
    await page.route('**/api/v1/rider/auth/send-otp', (r) =>
      fulfillJson(r, { message: 'sent', expires_in_seconds: 300 }),
    );
    await page.route('**/api/v1/rider/auth/verify-otp', (r) =>
      fulfillJson(r, {
        token: 'e2e-rider-jwt',
        rider: { id: 'r1', phone: '+919876543210', name: 'Test Rider' },
        is_new_rider: false,
      }),
    );
    // /home may hydrate the rider — stub it so the route never hits a backend.
    await page.route('**/api/v1/rider/me', (r) =>
      fulfillJson(r, { id: 'r1', phone: '+919876543210', name: 'Test Rider' }),
    );

    await page.goto('/login');

    await page.getByPlaceholder('98765 43210').fill('9876543210');
    await page.getByRole('button', { name: 'Send OTP' }).click();

    // OTP step — filling all six boxes auto-triggers verify.
    await expect(page.getByLabel('OTP digit 1')).toBeVisible();
    for (let i = 1; i <= 6; i++) {
      await page.getByLabel(`OTP digit ${i}`).fill(String(i % 10));
    }

    // First redirect to /home can trigger a dev-server route compile.
    await expect(page).toHaveURL(/\/home/, { timeout: 20_000 });
  });

  test('wrong OTP surfaces an error and stays on /login', async ({ page }) => {
    await page.route('**/api/v1/rider/auth/send-otp', (r) =>
      fulfillJson(r, { message: 'sent', expires_in_seconds: 300 }),
    );
    // 400 (not 401): a 401 triggers the client's global unauthorized→logout path,
    // whereas a bad OTP is a validation error that surfaces inline on the form.
    await page.route('**/api/v1/rider/auth/verify-otp', (r) =>
      r.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'incorrect otp', code: 'ERR_OTP_INVALID' }),
      }),
    );

    await page.goto('/login');
    await page.getByPlaceholder('98765 43210').fill('9876543210');
    await page.getByRole('button', { name: 'Send OTP' }).click();
    for (let i = 1; i <= 6; i++) {
      await page.getByLabel(`OTP digit ${i}`).fill('0');
    }

    await expect(page.getByText(/incorrect or expired otp/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
