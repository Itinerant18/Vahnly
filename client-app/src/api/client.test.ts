import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  acceptOffer,
  arriveAtPickup,
  completeTrip,
  declineOffer,
  driverLogin,
  getDriverProfile,
  getEarnings,
  getPendingOffer,
  getPricingQuote,
  getTripHistory,
  registerDeviceToken,
  setDriverStatus,
  startTrip,
  updateDriverLocation,
} from './client';

const baseUrl = 'http://localhost:8080';
const server = setupServer();

interface CapturedRequest {
  method: string;
  pathname: string;
  search: string;
  authorization: string | null;
  region: string | null;
  body: unknown;
}

let captured: CapturedRequest | null = null;

async function capture(request: Request): Promise<CapturedRequest> {
  const url = new URL(request.url);
  let body: unknown = undefined;
  if (request.method !== 'GET') {
    body = await request.json();
  }

  captured = {
    method: request.method,
    pathname: url.pathname,
    search: url.search,
    authorization: request.headers.get('Authorization'),
    region: request.headers.get('X-Region-Prefix'),
    body,
  };
  return captured;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  captured = null;
});
afterAll(() => server.close());

describe('driver API client smoke tests', () => {
  it('posts driver login credentials', async () => {
    server.use(http.post(`${baseUrl}/api/v1/auth/driver/login`, async ({ request }) => {
      await capture(request);
      return HttpResponse.json({
        token: 'jwt',
        user: { id: 'driver-1', role: 'DRIVER', name: 'Driver', current_state: 'OFFLINE' },
      });
    }));

    await driverLogin('999', 'secret');

    expect(captured).toMatchObject({
      method: 'POST',
      pathname: '/api/v1/auth/driver/login',
      region: 'KOL',
      body: { phone: '999', password: 'secret' },
    });
  });

  it('gets driver profile with bearer token', async () => {
    server.use(http.get(`${baseUrl}/api/v1/driver/me`, async ({ request }) => {
      await capture(request);
      return HttpResponse.json({
        id: 'driver-1',
        name: 'Driver',
        phone: '999',
        current_state: 'ONLINE_AVAILABLE',
        acceptance_rate: 1,
        cancellation_rate: 0,
        is_verified: true,
        city_prefix: 'KOL',
        created_at: '2026-06-04T00:00:00Z',
        total_trips: 1,
      });
    }));

    await getDriverProfile('jwt');

    expect(captured).toMatchObject({
      method: 'GET',
      pathname: '/api/v1/driver/me',
      authorization: 'Bearer jwt',
      region: 'KOL',
    });
  });

  it('posts driver status updates', async () => {
    server.use(http.post(`${baseUrl}/api/v1/driver/status`, async ({ request }) => {
      await capture(request);
      return HttpResponse.json({ status: 'ONLINE_AVAILABLE', updated_at: '2026-06-04T00:00:00Z' });
    }));

    await setDriverStatus('jwt', 'driver-1', 'ONLINE_AVAILABLE');

    expect(captured).toMatchObject({
      pathname: '/api/v1/driver/status',
      authorization: 'Bearer jwt',
      body: { driver_id: 'driver-1', status: 'ONLINE_AVAILABLE' },
    });
  });

  it('gets pricing quotes with query parameters', async () => {
    server.use(http.get(`${baseUrl}/api/v1/pricing/quote`, async ({ request }) => {
      await capture(request);
      return HttpResponse.json({
        h3_cell: 'cell-1',
        calculated_fare_paise: 12000,
        active_surge_multiplier: 1.2,
        circuit_breaker_nominal: true,
      });
    }));

    await getPricingQuote('jwt', 'cell-1', 10000);

    expect(captured).toMatchObject({
      pathname: '/api/v1/pricing/quote',
      search: '?h3_cell=cell-1&base_fare_paise=10000',
      authorization: 'Bearer jwt',
    });
  });

  it('gets the pending offer', async () => {
    server.use(http.get(`${baseUrl}/api/v1/driver/offer`, async ({ request }) => {
      await capture(request);
      return HttpResponse.json({ order: null });
    }));

    await getPendingOffer('jwt');

    expect(captured).toMatchObject({
      pathname: '/api/v1/driver/offer',
      authorization: 'Bearer jwt',
    });
  });

  it.each([
    ['accept', acceptOffer, '/api/v1/dispatch/accept', { order_id: 'order-1', driver_id: 'driver-1' }],
    ['arrive', arriveAtPickup, '/api/v1/trip/arrive', { order_id: 'order-1', driver_id: 'driver-1' }],
    ['start', startTrip, '/api/v1/trip/start', { order_id: 'order-1', driver_id: 'driver-1' }],
    ['complete', completeTrip, '/api/v1/trip/complete', { order_id: 'order-1', driver_id: 'driver-1' }],
  ])('posts %s trip lifecycle action', async (_name, fn, path, expectedBody) => {
    server.use(http.post(`${baseUrl}${path}`, async ({ request }) => {
      await capture(request);
      return HttpResponse.json({ status: 'OK' });
    }));

    await fn('jwt', 'order-1', 'driver-1');

    expect(captured).toMatchObject({
      method: 'POST',
      pathname: path,
      authorization: 'Bearer jwt',
      region: 'KOL',
      body: expectedBody,
    });
  });

  it('posts decline with city prefix', async () => {
    server.use(http.post(`${baseUrl}/api/v1/dispatch/decline`, async ({ request }) => {
      await capture(request);
      return HttpResponse.json({ status: 'OK' });
    }));

    await declineOffer('jwt', 'order-1', 'driver-1', 'KOL');

    expect(captured).toMatchObject({
      pathname: '/api/v1/dispatch/decline',
      body: { order_id: 'order-1', driver_id: 'driver-1', city_prefix: 'KOL' },
    });
  });

  it('gets trip history and earnings with query parameters', async () => {
    server.use(
      http.get(`${baseUrl}/api/v1/driver/trips`, async ({ request }) => {
        await capture(request);
        return HttpResponse.json({ limit: 20, offset: 5, trips: [] });
      }),
      http.get(`${baseUrl}/api/v1/driver/earnings`, async ({ request }) => {
        await capture(request);
        return HttpResponse.json({
          total_paise: 0,
          trip_count: 0,
          period_from: '2026-06-04T00:00:00Z',
          period_to: '2026-06-04T23:59:59Z',
          breakdown: [],
        });
      }),
    );

    await getTripHistory('jwt', 20, 5);
    expect(captured).toMatchObject({
      pathname: '/api/v1/driver/trips',
      search: '?limit=20&offset=5',
      authorization: 'Bearer jwt',
    });

    await getEarnings('jwt', '2026-06-04T00:00:00Z', '2026-06-04T23:59:59Z');
    expect(captured).toMatchObject({
      pathname: '/api/v1/driver/earnings',
      search: '?from=2026-06-04T00%3A00%3A00Z&to=2026-06-04T23%3A59%3A59Z',
      authorization: 'Bearer jwt',
    });
  });

  it('posts device tokens and driver locations', async () => {
    server.use(
      http.post(`${baseUrl}/api/v1/driver/device-token`, async ({ request }) => {
        await capture(request);
        return HttpResponse.json({
          status: 'REGISTERED',
          platform_type: 'ANDROID_FCM',
          updated_at: '2026-06-04T00:00:00Z',
        });
      }),
      http.post(`${baseUrl}/api/v1/driver/location`, async ({ request }) => {
        await capture(request);
        return HttpResponse.json({ recorded: true, h3_cell: 'cell-1' });
      }),
    );

    await registerDeviceToken('jwt', 'fcm-token', 'ANDROID_FCM');
    expect(captured).toMatchObject({
      pathname: '/api/v1/driver/device-token',
      body: { device_token: 'fcm-token', platform_type: 'ANDROID_FCM' },
    });

    await updateDriverLocation('jwt', 'driver-1', 'KOL', 22.57, 88.36, 90, 30);
    expect(captured).toMatchObject({
      pathname: '/api/v1/driver/location',
      authorization: 'Bearer jwt',
      body: {
        driver_id: 'driver-1',
        city_prefix: 'KOL',
        latitude: 22.57,
        longitude: 88.36,
        bearing: 90,
        speed_kms: 30,
      },
    });
  });
});
