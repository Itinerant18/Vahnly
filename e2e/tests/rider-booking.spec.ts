import { test, expect } from '@playwright/test';
import { fulfillJson, seedRiderAuth } from './helpers';

// SCAFFOLD: grounded where verified (auth seed, geolocation, mono ETA), but the
// /home booking DOM + estimate/order endpoints should be confirmed against the
// running app. API + realtime are fully mocked — no backend required.
test.use({
  geolocation: { latitude: 22.5726, longitude: 88.3639 }, // Kolkata
  permissions: ['geolocation'],
});

test.describe('rider booking flow', () => {
  test.beforeEach(async ({ context }) => {
    await seedRiderAuth(context);
    // Broad stubs so no request escapes to a backend.
    await context.route('**/api/v1/rider/me', (r) => fulfillJson(r, { id: 'r1', phone: '+919876543210', name: 'Test Rider' }));
    await context.route('**/api/v1/rider/garage**', (r) => fulfillJson(r, []));
    await context.route('**/api/v1/rider/fare-estimate', (r) =>
      fulfillJson(r, {
        fare_breakdown: { estimated_total_paise: 48000, base_fare_paise: 40000, distance_charge_paise: 8000, night_charge_paise: 0, d4m_care_paise: 0, promo_discount_paise: 0, surge_multiplier: 1 },
        surge_active: false, driver_availability: 'HIGH', estimated_pickup_eta_minutes: 5,
      }),
    );
    // POST /api/v1/rider/orders → CreateOrderResult { order, fare_estimate, otp }
    await context.route('**/api/v1/rider/orders', (r) =>
      fulfillJson(r, {
        order: { id: 'order-e2e-1', status: 'SEARCHING' },
        otp: '4821',
        fare_estimate: { fare_breakdown: { estimated_total_paise: 48000 } },
      }),
    );
  });

  test('authenticated rider reaches the home/booking screen', async ({ page }) => {
    await page.goto('/home');
    // The booking sheet exposes the primary CTA.
    await expect(page.getByRole('button', { name: 'Book Driver' })).toBeVisible();
  });

  // FIXME: the booking sheet is collapsed by default and its drag handle detaches
  // from the DOM on the expand re-render, so driving the full form headlessly is
  // flaky. Stabilise the expand interaction (e.g. an aria-expanded toggle with a
  // test id) to enable this end-to-end booking assertion. The "reaches the
  // home/booking screen" test above already verifies auth + the screen render.
  test.fixme('booking a driver navigates to the dispatch screen', async ({ page }) => {
    await page.goto('/home');

    // Expand the collapsed sheet so the form + CTA are interactable.
    await page.locator('.cursor-grab').first().click();

    // Pickup must be set before Book Driver enables (BookingSheet guard).
    const pickup = page.getByPlaceholder('Pickup location');
    await pickup.fill('Sector V, Kolkata');

    const book = page.getByRole('button', { name: 'Book Driver' });
    await expect(book).toBeEnabled();
    await book.click();

    // First nav to /dispatch may trigger a dev-server route compile.
    await expect(page).toHaveURL(/\/dispatch/, { timeout: 20_000 });
  });

  // Realtime assignment arrives over WebSocket. Playwright can intercept it with
  // page.routeWebSocket (1.48+). The exact WS URL + envelope must be confirmed;
  // the documented shape is { rider_id, type: 'rider.order.assigned', data }.
  test.skip('driver-assigned event renders on the dispatch screen', async ({ page }) => {
    await page.routeWebSocket(/\/ws/, (ws) => {
      ws.onMessage(() => {
        ws.send(JSON.stringify({
          rider_id: 'r1',
          type: 'rider.order.assigned',
          data: { driver: { name: 'Ravi', eta_minutes: 4 }, order_id: 'order-e2e-1' },
        }));
      });
    });
    await page.goto('/dispatch?orderId=order-e2e-1');
    await expect(page.getByText(/Ravi/)).toBeVisible();
    await expect(page.locator('.font-mono')).toContainText(/4/);
  });
});
