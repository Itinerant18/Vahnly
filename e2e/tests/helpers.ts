import type { BrowserContext, Route } from '@playwright/test';

export const RIDER_TOKEN_KEY = 'dfu_rider_token';

/** Wrap a payload in the backend's `{ success, data }` envelope. */
export function envelope(data: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data }),
  };
}

/** Fulfil a route with an enveloped 200 JSON body. */
export function fulfillJson(route: Route, data: unknown) {
  return route.fulfill(envelope(data));
}

/** Seed an authenticated rider token into localStorage before any page script runs. */
export async function seedRiderAuth(context: BrowserContext, token = 'e2e-rider-jwt') {
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [RIDER_TOKEN_KEY, token] as const,
  );
}

/** Seed an admin token. Key/shape are placeholders — confirm against the admin app. */
export async function seedAdminAuth(context: BrowserContext, token = 'e2e-admin-jwt') {
  await context.addInitScript(
    ([value]) => {
      window.localStorage.setItem('dfu_admin_token', value);
      window.localStorage.setItem('admin_role', 'FLEET_MANAGER');
    },
    [token] as const,
  );
}
