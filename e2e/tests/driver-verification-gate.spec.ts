import { test, expect } from '@playwright/test';

test.describe('Driver Phone Verification Gate', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      (window as any).__E2E__ = true;
    });
  });

  test('unverified driver login is gated and can be verified to proceed', async ({ page }) => {
    // 1. Mock Login returning phone_verified: false
    await page.route('**/api/v1/driver/login', (route) =>
      route.fulfill({
        json: {
          token: 'e2e-driver-jwt',
          role: 'DRIVER',
          driver_id: 'd1',
          name: 'Test Driver',
          phone_verified: false,
          phone: '9999988888',
        }
      })
    );

    // 2. Mock OTP sending on gate mount
    await page.route('**/api/v1/driver/auth/send-otp', (route) =>
      route.fulfill({
        json: { message: 'sent', expires_in_seconds: 300 }
      })
    );

    // 3. Mock OTP verification returning phone_verified: true
    await page.route('**/api/v1/driver/auth/verify-otp', (route) =>
      route.fulfill({
        json: {
          token: 'e2e-driver-jwt',
          role: 'DRIVER',
          driver_id: 'd1',
          name: 'Test Driver',
          phone_verified: true,
          phone: '9999988888',
        }
      })
    );

    // Mock profile and duty checks so the driver dashboard loads without error
    await page.route('**/api/v1/driver/me', (route) =>
      route.fulfill({
        json: {
          id: 'd1',
          name: 'Test Driver',
          phone: '9999988888',
          current_state: 'OFFLINE',
          is_verified: true,
          city_prefix: 'KOL',
        }
      })
    );

    await page.route('**/api/v1/driver/orders/active', (route) =>
      route.fulfill({
        json: { order: null }
      })
    );

    // Load Login Page
    await page.goto('/login');

    // Fill credentials and Login
    await page.getByPlaceholder('99999 88888').fill('9999988888');
    await page.getByPlaceholder('••••••••').fill('password123');
    await page.getByRole('button', { name: 'Authenticate & Access' }).click();

    // Verify verification gate is displayed
    await expect(page.getByText('Phone Verification Required')).toBeVisible();
    await expect(page.getByText('+91 99999 88888')).toBeVisible();

    // Fill OTP digits to trigger verification
    for (let i = 1; i <= 6; i++) {
      await page.getByLabel(`OTP digit ${i}`).fill(String(i));
    }

    // Assert redirection to driver console
    await expect(page).toHaveURL(/\/driver/, { timeout: 15000 });
  });

  test('driver direct signup requires OTP verification before completing', async ({ page }) => {
    // 1. Mock OTP send
    await page.route('**/api/v1/driver/auth/send-otp', (route) =>
      route.fulfill({
        json: { message: 'sent', expires_in_seconds: 300 }
      })
    );

    // 2. Mock OTP verify returning a phone token
    await page.route('**/api/v1/driver/auth/verify-otp', (route) =>
      route.fulfill({
        json: {
          is_new_driver: true,
          phone_token: 'valid-signed-phone-token',
          phone: '9999988888',
        }
      })
    );

    // 3. Mock Driver Register
    await page.route('**/api/v1/driver/register', (route) =>
      route.fulfill({
        json: { message: 'Driver registered successfully', driver_id: 'd1' }
      })
    );

    // 4. Mock login immediately following registration
    await page.route('**/api/v1/driver/login', (route) =>
      route.fulfill({
        json: {
          token: 'e2e-driver-jwt',
          role: 'DRIVER',
          driver_id: 'd1',
          name: 'Registering Driver',
          phone_verified: true,
          phone: '9999988888',
        }
      })
    );

    // Load Login Page
    await page.goto('/login');

    // Switch to Register flow
    await page.getByRole('button', { name: 'Sign up as Driver Partner' }).click();

    // Fill Registration Details
    await page.getByPlaceholder('John Doe').fill('Registering Driver');
    await page.getByPlaceholder('99999 88888').fill('9999988888');
    await page.getByPlaceholder('••••••••').fill('password123');

    // Submit registration form (triggers OTP)
    await page.getByRole('button', { name: 'Register & Start Onboarding' }).click();

    // Verification screen should appear inside the signup flow
    await expect(page.getByText('Enter the 6-digit verification code')).toBeVisible();

    // Enter digits to complete registration
    for (let i = 1; i <= 6; i++) {
      await page.getByLabel(`OTP digit ${i}`).fill(String(i));
    }

    // Assert we land on onboarding page
    await expect(page).toHaveURL(/\/driver-onboarding/, { timeout: 15000 });
  });
});
