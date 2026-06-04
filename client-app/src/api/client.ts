export type DriverStatus = 'ONLINE_AVAILABLE' | 'OFFLINE';
export type DevicePlatform = 'ANDROID_FCM' | 'IOS_APNS';

type HttpMethod = 'GET' | 'POST';

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[key]) {
    return process.env[key];
  }
  return undefined;
}

export const BASE_URL =
  readEnv('VITE_API_BASE_URL') ||
  readEnv('NEXT_PUBLIC_API_GATEWAY') ||
  readEnv('API_GATEWAY_URL') ||
  'http://localhost:8080';

export const GRPC_URL =
  readEnv('VITE_GRPC_URL') ||
  readEnv('NEXT_PUBLIC_GRPC_URL') ||
  'http://localhost:50051';

export const GRPC_WEB_URL =
  readEnv('VITE_GRPC_WEB_URL') ||
  readEnv('NEXT_PUBLIC_GRPC_WEB_URL') ||
  'http://localhost:8080';

export const SSE_URL =
  readEnv('VITE_ANALYTICS_URL') ||
  readEnv('NEXT_PUBLIC_ANALYTICS_URL') ||
  readEnv('ANALYTICS_SSE_URL') ||
  'http://localhost:8089';

export const WS_BASE_URL =
  readEnv('VITE_WS_BASE_URL') ||
  readEnv('NEXT_PUBLIC_WS_GATEWAY') ||
  readEnv('WS_GATEWAY_URL') ||
  BASE_URL.replace(/^http/i, 'ws');

const REGION_PREFIX = 'KOL';

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export interface DriverAuthUser {
  id: string;
  role: 'DRIVER';
  name: string;
  current_state: string;
}

export interface DriverLoginResponse {
  token: string;
  user: DriverAuthUser;
}

export interface DriverProfile {
  id: string;
  name: string;
  phone: string | null;
  current_state: string;
  acceptance_rate: number;
  cancellation_rate: number;
  is_verified: boolean;
  city_prefix: string;
  created_at: string;
  total_trips: number;
}

export interface DriverStatusResponse {
  status: DriverStatus;
  updated_at: string;
}

export interface PricingQuote {
  h3_cell: string;
  calculated_fare_paise: number;
  active_surge_multiplier: number;
  circuit_breaker_nominal: boolean;
}

export interface PendingOfferOrder {
  id: string;
  city_prefix: string;
  pickup_h3_cell: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  base_fare_paise: number;
  surge_multiplier: number;
  customer_id: string;
}

export interface PendingOfferResponse {
  order: PendingOfferOrder | null;
  offer_expires_in_seconds?: number;
}

export interface TripLifecycleResponse {
  order_id?: string;
  status?: string;
  message?: string;
}

export interface DriverTrip {
  id: string;
  status: string;
  base_fare_paise: number;
  surge_multiplier: number;
  assigned_at: string | null;
  completed_at: string | null;
  pickup_h3_cell: string;
  driver_payout_paise: number;
}

export interface TripHistoryResponse {
  limit: number;
  offset: number;
  trips: DriverTrip[];
}

export interface EarningsBreakdownItem {
  order_id: string;
  amount_paise: number;
  completed_at: string;
}

export interface EarningsResponse {
  total_paise: number;
  trip_count: number;
  period_from: string;
  period_to: string;
  breakdown: EarningsBreakdownItem[];
}

export interface DeviceTokenResponse {
  status: 'REGISTERED';
  platform_type: DevicePlatform;
  updated_at: string;
}

export interface DriverLocationResponse {
  recorded: boolean;
  h3_cell: string;
}

interface RequestOptions {
  method: HttpMethod;
  token?: string;
  body?: unknown;
}

function buildUrl(path: string): string {
  return `${BASE_URL.replace(/\/$/, '')}${path}`;
}

async function request<T>(path: string, options: RequestOptions): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Region-Prefix': REGION_PREFIX,
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(buildUrl(path), {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new ApiClientError(
      bodyText || `gateway_request_failed_${response.status}`,
      response.status,
      bodyText,
    );
  }

  if (!bodyText) {
    return undefined as T;
  }

  return JSON.parse(bodyText) as T;
}

function encodeQuery(params: Record<string, string | number>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => query.set(key, String(value)));
  return query.toString();
}

export async function driverLogin(phone: string, password: string): Promise<DriverLoginResponse> {
  return request<DriverLoginResponse>('/api/v1/auth/driver/login', {
    method: 'POST',
    body: { phone, password },
  });
}

export async function getDriverProfile(token: string): Promise<DriverProfile> {
  return request<DriverProfile>('/api/v1/driver/me', { method: 'GET', token });
}

export async function setDriverStatus(
  token: string,
  driverId: string,
  status: DriverStatus,
): Promise<DriverStatusResponse> {
  return request<DriverStatusResponse>('/api/v1/driver/status', {
    method: 'POST',
    token,
    body: { driver_id: driverId, status },
  });
}

export async function getPricingQuote(
  token: string,
  h3Cell: string,
  baseFarePaise: number,
): Promise<PricingQuote> {
  const query = encodeQuery({ h3_cell: h3Cell, base_fare_paise: baseFarePaise });
  return request<PricingQuote>(`/api/v1/pricing/quote?${query}`, { method: 'GET', token });
}

export async function getPendingOffer(token: string): Promise<PendingOfferResponse> {
  return request<PendingOfferResponse>('/api/v1/driver/offer', { method: 'GET', token });
}

export async function acceptOffer(
  token: string,
  orderId: string,
  driverId: string,
): Promise<TripLifecycleResponse> {
  return request<TripLifecycleResponse>('/api/v1/dispatch/accept', {
    method: 'POST',
    token,
    body: { order_id: orderId, driver_id: driverId },
  });
}

export async function declineOffer(
  token: string,
  orderId: string,
  driverId: string,
  cityPrefix: string,
): Promise<TripLifecycleResponse> {
  return request<TripLifecycleResponse>('/api/v1/dispatch/decline', {
    method: 'POST',
    token,
    body: { order_id: orderId, driver_id: driverId, city_prefix: cityPrefix },
  });
}

export async function arriveAtPickup(
  token: string,
  orderId: string,
  driverId: string,
): Promise<TripLifecycleResponse> {
  return request<TripLifecycleResponse>('/api/v1/trip/arrive', {
    method: 'POST',
    token,
    body: { order_id: orderId, driver_id: driverId },
  });
}

export async function startTrip(
  token: string,
  orderId: string,
  driverId: string,
): Promise<TripLifecycleResponse> {
  return request<TripLifecycleResponse>('/api/v1/trip/start', {
    method: 'POST',
    token,
    body: { order_id: orderId, driver_id: driverId },
  });
}

export async function completeTrip(
  token: string,
  orderId: string,
  driverId: string,
): Promise<TripLifecycleResponse> {
  return request<TripLifecycleResponse>('/api/v1/trip/complete', {
    method: 'POST',
    token,
    body: { order_id: orderId, driver_id: driverId },
  });
}

export async function getTripHistory(
  token: string,
  limit: number,
  offset: number,
): Promise<TripHistoryResponse> {
  const query = encodeQuery({ limit, offset });
  return request<TripHistoryResponse>(`/api/v1/driver/trips?${query}`, { method: 'GET', token });
}

export async function getEarnings(
  token: string,
  from: string,
  to: string,
): Promise<EarningsResponse> {
  const query = encodeQuery({ from, to });
  return request<EarningsResponse>(`/api/v1/driver/earnings?${query}`, { method: 'GET', token });
}

export async function registerDeviceToken(
  token: string,
  deviceToken: string,
  platform: DevicePlatform,
): Promise<DeviceTokenResponse> {
  return request<DeviceTokenResponse>('/api/v1/driver/device-token', {
    method: 'POST',
    token,
    body: { device_token: deviceToken, platform_type: platform },
  });
}

export async function updateDriverLocation(
  token: string,
  driverId: string,
  cityPrefix: string,
  latitude: number,
  longitude: number,
  bearing: number,
  speedKms: number,
): Promise<DriverLocationResponse> {
  return request<DriverLocationResponse>('/api/v1/driver/location', {
    method: 'POST',
    token,
    body: {
      driver_id: driverId,
      city_prefix: cityPrefix,
      latitude,
      longitude,
      bearing,
      speed_kms: speedKms,
    },
  });
}
