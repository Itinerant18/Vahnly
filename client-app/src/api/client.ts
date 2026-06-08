import { StartTripPayload } from '../types/trip';

export type DriverStatus = 'ONLINE_AVAILABLE' | 'OFFLINE';
export type DevicePlatform = 'ANDROID_FCM' | 'IOS_APNS';

type HttpMethod = 'GET' | 'POST' | 'PATCH';

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
  onboarding_step?: number;
  verification_status?: string;
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

export interface OrderOffer {
  orderId: string;
  riderName: string;
  riderRating: number;
  pickup: { address: string; lat: number; lng: number };
  drop: { address: string; lat: number; lng: number };
  fareEstimate: number;
  etaMinutes: number;
  tripType: 'CITY' | 'OUTSTATION' | 'MINI_OUTSTATION';
  notes?: string;
  carTypeRequested?: string;
  transmissionRequired?: string;
  d4mCareOptIn?: boolean;
  distanceKm?: number;
  durationMinutes?: number;
}

export type PendingOfferOrder = OrderOffer;

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

export async function respondToOffer(
  token: string,
  orderId: string,
  response: 'ACCEPTED' | 'DECLINED',
  reason?: string,
  correlationId?: string,
): Promise<{ success: boolean; status: string }> {
  return request<{ success: boolean; status: string }>(`/api/v1/driver/orders/${orderId}/offer-response`, {
    method: 'PATCH',
    token,
    body: { response, reason, correlation_id: correlationId },
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

// --- Phase 2: Driver Odometer Ingestion ---

export interface OdometerCheckpointResponse {
  id: string;
  order_id: string;
  checkpoint_type: 'START' | 'END';
  odometer_reading: number;
  fuel_level: number;
  photo_url: string;
  captured_at: string;
  status: string;
}

export interface OdometerCheckpointPayload {
  checkpoint_type: 'START' | 'END';
  odometer_reading: number;
  fuel_level: number;
  photo_url: string;
  timestamp: string;
}

export async function submitOdometerCheckpoint(
  token: string,
  orderId: string,
  checkpoint: OdometerCheckpointPayload,
): Promise<OdometerCheckpointResponse> {
  return request<OdometerCheckpointResponse>(`/api/v1/driver/orders/${orderId}/odometer`, {
    method: 'POST',
    token,
    body: checkpoint,
  });
}

// --- Phase 3: Driver Onboarding & Authentication ---

export interface OnboardingStepResponse {
  success: boolean;
  onboarding_step: number;
}

export interface DocumentUploadResponse {
  document_id: string;
  storage_url: string;
  status: string;
  document_type: string;
}

export interface PresignedUrlResponse {
  upload_url: string;
  storage_url: string;
}

export interface QuizValidationResponse {
  passed: boolean;
  score: number;
}

export interface DriverRegisterResponse {
  message: string;
  driver_id: string;
}

export async function driverRegister(payload: any): Promise<DriverRegisterResponse> {
  return request<DriverRegisterResponse>('/api/v1/driver/register', {
    method: 'POST',
    body: payload,
  });
}

// saveOnboardingStep saves step data, supports offline caching queue
export async function saveOnboardingStep(
  token: string,
  stepId: number,
  data: Record<string, any>,
): Promise<OnboardingStepResponse> {
  const path = `/api/v1/driver/onboarding/step/${stepId}`;
  
  // Check if browser is offline
  if (typeof window !== 'undefined' && !navigator.onLine) {
    queueOfflinePayload(token, stepId, data);
    return { success: true, onboarding_step: stepId };
  }

  try {
    return await request<OnboardingStepResponse>(path, {
      method: 'POST',
      token,
      body: data,
    });
  } catch (error) {
    // If it's a network error (e.g. failure to fetch), queue it offline
    if (error instanceof TypeError && error.message.includes('fetch')) {
      queueOfflinePayload(token, stepId, data);
      return { success: true, onboarding_step: stepId };
    }
    throw error;
  }
}

// queueOfflinePayload writes failed payloads to localStorage queue
function queueOfflinePayload(token: string, stepId: number, data: Record<string, any>) {
  if (typeof window === 'undefined') return;
  try {
    const queue = JSON.parse(localStorage.getItem('onboarding-offline-queue') || '[]');
    queue.push({ token, stepId, data, timestamp: new Date().toISOString() });
    localStorage.setItem('onboarding-offline-queue', JSON.stringify(queue));
    console.log(`[OFFLINE] Queued onboarding step ${stepId} for sync`);
  } catch (e) {
    console.error('Failed to queue offline onboarding payload:', e);
  }
}

// syncOfflineOnboarding tries to upload all queued payloads sequentially
export async function syncOfflineOnboarding(): Promise<void> {
  if (typeof window === 'undefined' || !navigator.onLine) return;
  try {
    const queueRaw = localStorage.getItem('onboarding-offline-queue');
    if (!queueRaw) return;
    const queue = JSON.parse(queueRaw) as Array<{ token: string; stepId: number; data: Record<string, any> }>;
    if (queue.length === 0) return;

    console.log(`[OFFLINE] Syncing ${queue.length} queued onboarding payloads...`);
    const remaining: typeof queue = [];
    
    for (const item of queue) {
      try {
        await request<OnboardingStepResponse>(`/api/v1/driver/onboarding/step/${item.stepId}`, {
          method: 'POST',
          token: item.token,
          body: item.data,
        });
      } catch (err) {
        // Keep in queue if it failed due to network again
        remaining.push(item);
      }
    }

    if (remaining.length > 0) {
      localStorage.setItem('onboarding-offline-queue', JSON.stringify(remaining));
    } else {
      localStorage.removeItem('onboarding-offline-queue');
      console.log('[OFFLINE] Offline onboarding sync complete.');
    }
  } catch (e) {
    console.error('Failed to sync offline onboarding queue:', e);
  }
}

export async function uploadDocument(
  token: string,
  docType: string,
  file: File,
): Promise<DocumentUploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('document_type', docType);

  const response = await fetch(buildUrl('/api/v1/driver/onboarding/upload'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Region-Prefix': REGION_PREFIX,
    },
    body: formData,
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new ApiClientError(
      bodyText || `upload_failed_${response.status}`,
      response.status,
      bodyText,
    );
  }
  return JSON.parse(bodyText) as DocumentUploadResponse;
}

export async function getPresignedUrl(
  token: string,
  filename: string,
  docType: string,
): Promise<PresignedUrlResponse> {
  return request<PresignedUrlResponse>('/api/v1/driver/onboarding/presigned-url', {
    method: 'POST',
    token,
    body: { filename, document_type: docType },
  });
}

export async function validateQuiz(
  token: string,
  answers: Record<string, number>,
): Promise<QuizValidationResponse> {
  return request<QuizValidationResponse>('/api/v1/driver/onboarding/quiz', {
    method: 'POST',
    token,
    body: { answers },
  });
}

export async function setDriverDutyState(
  token: string,
  dutyState: 'ONLINE' | 'OFFLINE',
  latitude?: number,
  longitude?: number,
): Promise<{ success: boolean; duty_state: string }> {
  return request<{ success: boolean; duty_state: string }>('/api/v1/driver/duty', {
    method: 'POST',
    token,
    body: { duty_state: dutyState, latitude, longitude },
  });
}

export async function triggerDriverSOS(
  token: string,
): Promise<{ success: boolean; sos_id: string; trip_id: string; message: string }> {
  return request<{ success: boolean; sos_id: string; trip_id: string; message: string }>('/api/v1/driver/sos', {
    method: 'POST',
    token,
  });
}

export interface DriverDutyStats {
  trips_count: number;
  earnings_rupees: number;
  online_hours: number;
  acceptance_rate: number;
  rating: number;
}

export async function getDriverDutyStats(
  token: string,
): Promise<DriverDutyStats> {
  return request<DriverDutyStats>('/api/v1/driver/stats', {
    method: 'GET',
    token,
  });
}

export async function verifyTripOTP(
  token: string,
  orderId: string,
  otp: string,
): Promise<{ success: boolean; status: string }> {
  return request<{ success: boolean; status: string }>(`/api/v1/driver/orders/${orderId}/verify-otp`, {
    method: 'POST',
    token,
    body: { otp },
  });
}

export async function driverArriveAtPickup(token: string, orderId: string): Promise<{ success: boolean; status: string }> {
  return request<{ success: boolean; status: string }>(`/api/v1/driver/orders/${orderId}/arrived`, {
    method: 'PATCH',
    token,
    body: {},
  });
}

export async function driverStartTrip(
  token: string,
  orderId: string,
  payload: StartTripPayload,
): Promise<{
  success: boolean;
  status: string;
  checkpoint_id: string;
  odometer_value: number;
  fuel_percentage: number;
}> {
  return request<{
    success: boolean;
    status: string;
    checkpoint_id: string;
    odometer_value: number;
    fuel_percentage: number;
  }>(`/api/v1/driver/orders/${orderId}/start`, {
    method: 'PATCH',
    token,
    body: {
      odometer_reading: payload.odometerReading,
      fuel_level: payload.fuelPercentage,
      otp: payload.otp,
      photo_url: payload.photoUrl,
    },
  });
}

export interface FinalBill {
  order_id: string;
  base_fare_paise: number;
  distance_km: number;
  distance_charge_paise: number;
  wait_minutes: number;
  wait_charge_paise: number;
  overtime_minutes: number;
  overtime_charge_paise: number;
  tolls_paise: number;
  parking_charges_paise: number;
  night_surge_paise: number;
  care_surcharge_paise: number;
  total_fare_paise: number;
}

export async function addOrderEvent(
  token: string,
  orderId: string,
  payload: { event_type: 'ADD_TOLL' | 'ADD_STOP'; amount_paise: number; description: string },
): Promise<{ success: boolean; message: string }> {
  return request<{ success: boolean; message: string }>(`/api/v1/driver/orders/${orderId}/events`, {
    method: 'POST',
    token,
    body: payload,
  });
}

export async function driverEndTrip(
  token: string,
  orderId: string,
  payload: { odometer_reading: number; fuel_level: number; photo_url?: string },
): Promise<FinalBill> {
  return request<FinalBill>(`/api/v1/driver/orders/${orderId}/end`, {
    method: 'PATCH',
    token,
    body: payload,
  });
}

export async function driverConfirmPayment(
  token: string,
  orderId: string,
  payload: { payment_method: 'UPI' | 'CASH'; rider_rating: number; tags: string[] },
): Promise<{ success: boolean; message: string }> {
  return request<{ success: boolean; message: string }>(`/api/v1/driver/orders/${orderId}/confirm-payment`, {
    method: 'POST',
    token,
    body: payload,
  });
}



