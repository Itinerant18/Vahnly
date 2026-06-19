import { test, expect } from '@playwright/test';
import { fulfillJson, seedAdminAuth } from './helpers';

// SCAFFOLD — SKIPPED until written against the real admin app. This was never
// exercised (the Admin CI test job blocked it). Its mocked endpoint
// (/api/v1/admin/drivers/onboarding) doesn't match the app's actual calls
// (/api/v1/admin/drivers/pending, /drivers), and seedAdminAuth seeds a placeholder
// localStorage token while the admin app authenticates via cookie (see
// frontend/src/config.ts). Un-skip once the route, API endpoints/shapes, cookie
// auth, and KYC DOM selectors are confirmed against frontend/src/admin
// (DriverOnboardingQueue / ComplianceDashboard).
test.describe.skip('admin KYC approval', () => {
  test.beforeEach(async ({ context }) => {
    await seedAdminAuth(context);
    await context.route('**/api/v1/admin/drivers/onboarding**', (r) =>
      fulfillJson(r, {
        columns: [
          { key: 'DOCS_UPLOADED', drivers: [{ id: 'drv-1', name: 'Amit Kumar', stage: 'DOCS_UPLOADED' }] },
          { key: 'UNDER_REVIEW', drivers: [] },
          { key: 'VERIFIED', drivers: [] },
        ],
      }),
    );
    await context.route('**/api/v1/admin/drivers/drv-1/kyc/documents**', (r) =>
      fulfillJson(r, [
        { type: 'DL_FRONT', url: 'https://stub.local/dl-front.jpg', status: 'PENDING' },
      ]),
    );
    await context.route('**/api/v1/admin/drivers/drv-1/kyc-document', (r) =>
      fulfillJson(r, { id: 'drv-1', status: 'VERIFIED' }),
    );
    // Stub any document image so the drawer can render without a real S3.
    await context.route('https://stub.local/**', (r) =>
      r.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }),
    );
  });

  test('approves a driver KYC document', async ({ page }) => {
    await page.goto('/admin/drivers/onboarding');

    // Pipeline board with at least the Docs-Uploaded column.
    await expect(page.getByText(/Amit Kumar/)).toBeVisible();

    // Open the driver's review drawer.
    await page.getByText('Amit Kumar').click();

    // Approve. The approve control may be a button labelled with a check/Approve.
    const approve = page.getByRole('button', { name: /approve/i });
    await expect(approve).toBeVisible();
    await approve.click();

    // After the mocked 200, the status reflects Verified somewhere on screen.
    await expect(page.getByText(/verified/i)).toBeVisible();
  });
});
