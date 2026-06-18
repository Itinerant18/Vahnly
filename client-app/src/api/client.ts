import { StartTripPayload } from '../types/trip';
import { useAuthStore } from '../store/useAuthStore';

export type DriverStatus = 'ONLINE_AVAILABLE' | 'OFFLINE';
export type DevicePlatform = 'ANDROID_FCM' | 'IOS_APNS';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export const BASE_URL =
  process.env.NEXT_PUBLIC_API_GATEWAY ||
  'http://localhost:8085';

export const GRPC_URL =
  process.env.NEXT_PUBLIC_GRPC_URL ||
  'http://localhost:50051';

export const GRPC_WEB_URL =
  process.env.NEXT_PUBLIC_GRPC_WEB_URL ||
  'http://localhost:8085';

export const SSE_URL =
  process.env.NEXT_PUBLIC_ANALYTICS_URL ||
  'http://localhost:8089';

export const WS_BASE_URL =
  process.env.NEXT_PUBLIC_WS_GATEWAY ||
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
  phone_verified?: boolean;
  phone?: string;
}

export interface DriverLoginResponse {
  token: string;
  user: DriverAuthUser;
  phone_verified?: boolean;
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
  // Phase 10: rider's car + driver transmission-match context.
  carMake?: string;
  carModel?: string;
  carType?: string;
  carColor?: string;
  carTransmission?: string; // "Manual" | "Automatic"
  transmissionMatch?: boolean;
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
  tips_paise?: number; // subset of total: TIP_CREDIT entries from rider ratings (Phase 10)
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
    // Backend phone-OTP gate: a driver token without a verified number is rejected on
    // protected routes. Clear the session and bounce to /login so the OTP gate runs.
    if (response.status === 403 && bodyText.includes('phone_verification_required')) {
      try {
        useAuthStore.getState().logout();
      } catch {
        /* ignore */
      }
      if (typeof window !== 'undefined') window.location.href = '/login';
    }
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

// The gateway returns a flat DriverAuthResponse (token + driver_id/role/name/...),
// not a nested { token, user }. Map it here so callers get DriverLoginResponse.
interface DriverLoginRaw {
  token: string;
  role: 'DRIVER';
  driver_id: string;
  name: string;
  verification_status?: string;
  onboarding_step?: number;
  phone_verified?: boolean;
  phone?: string;
}

export async function driverLogin(phone: string, password: string): Promise<DriverLoginResponse> {
  // This is the REAL authentication endpoint, not the mock one at /auth/driver/login
  const raw = await request<DriverLoginRaw>('/api/v1/driver/login', {
    method: 'POST',
    body: { phone, password },
  });
  return {
    token: raw.token,
    user: {
      id: raw.driver_id,
      role: raw.role ?? 'DRIVER',
      name: raw.name,
      current_state: '',
      phone_verified: raw.phone_verified,
      phone: raw.phone || phone,
    },
    phone_verified: raw.phone_verified,
  };
}

export interface DriverGoogleLoginResponse {
  token?: string;
  user?: DriverAuthUser;
  registered?: boolean;
  email?: string;
  name?: string;
  phone_verified?: boolean;
}

interface DriverGoogleLoginRaw {
  token?: string;
  role?: 'DRIVER';
  driver_id?: string;
  name?: string;
  verification_status?: string;
  onboarding_step?: number;
  registered?: boolean;
  email?: string;
  phone_verified?: boolean;
  phone?: string;
}

export async function driverGoogleLogin(
  idToken: string,
  regData?: { phone: string; cityPrefix: string; name?: string; phoneToken?: string }
): Promise<DriverGoogleLoginResponse> {
  const payload = {
    id_token: idToken,
    // Backend expects snake_case keys (city_prefix). Spreading regData as-is sent the
    // camelCase `cityPrefix`, so the server saw an empty city and refused to create the
    // driver (returned registered:false -> "no token received").
    ...(regData && {
      phone: regData.phone,
      city_prefix: regData.cityPrefix,
      name: regData.name,
      phone_token: regData.phoneToken,
    }),
  };
  const raw = await request<DriverGoogleLoginRaw>('/api/v1/driver/login/google', {
    method: 'POST',
    body: payload,
  });

  if (raw.registered === false) {
    return {
      registered: false,
      email: raw.email,
      name: raw.name,
    };
  }

  return {
    registered: true,
    token: raw.token,
    user: {
      id: raw.driver_id || '',
      role: raw.role ?? 'DRIVER',
      name: raw.name || '',
      current_state: '',
      phone_verified: raw.phone_verified,
      phone: raw.phone || regData?.phone || '',
    },
    phone_verified: raw.phone_verified,
  };
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

export interface DriverOrderDetail {
  id: string;
  status: string;
  waiting_started_at: string | null;
  last_odometer: number;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  base_fare_paise: number;
  surge_multiplier: number;
  customer_id: string;
}

export async function getDriverOrder(token: string, orderId: string): Promise<DriverOrderDetail> {
  return request<DriverOrderDetail>(`/api/v1/driver/orders/${orderId}`, { method: 'GET', token });
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

export interface DriverAccountEarnings {
  gross_earnings: number;
  trips_count: number;
  incentives: number;
  deductions: number;
  net_payout: number;
  time_series: Array<{ label: string; amount: number }>;
}

export interface DriverNotification {
  id: string;
  category: 'ALL' | 'TRIPS' | 'EARNINGS' | 'PROMOTIONS' | 'SYSTEM';
  title: string;
  body: string;
  is_read: boolean;
  timestamp: string;
}

export async function getDriverAccountEarnings(
  token: string,
  range: 'TODAY' | 'WEEK' | 'MONTH',
): Promise<DriverAccountEarnings> {
  return request<DriverAccountEarnings>(`/api/v1/driver-account/earnings?range=${range}`, { method: 'GET', token });
}

export async function triggerDriverWithdrawal(
  token: string,
): Promise<{ status: string; payout_id: string }> {
  return request<{ status: string; payout_id: string }>('/api/v1/driver-account/payouts/withdraw', { method: 'POST', token });
}

// ─── Driver-account features (FEAT-002: vehicles / wallet / training) ──────────

export interface DriverVehicle {
  id: string;
  make: string;
  model: string;
  license_plate: string;
  transmission: string;
  rc_status: string;
  insurance_status: string;
  puc_status: string;
}

export async function getDriverVehicles(token: string): Promise<{ vehicles: DriverVehicle[] }> {
  return request<{ vehicles: DriverVehicle[] }>('/api/v1/driver-account/vehicles', { method: 'GET', token });
}

export async function addDriverVehicle(
  token: string,
  body: { make: string; model: string; license_plate: string; transmission?: string },
): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>('/api/v1/driver-account/vehicles', { method: 'POST', token, body });
}

export async function deleteDriverVehicle(token: string, id: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/v1/driver-account/vehicles/${id}`, { method: 'DELETE', token });
}

export interface DriverWalletTxn {
  id: string;
  amount_paise: number;
  entry_type: 'CREDIT' | 'DEBIT';
  description: string;
  created_at: string;
}

export async function getDriverWallet(token: string): Promise<{ balance_paise: number; transactions: DriverWalletTxn[] }> {
  return request<{ balance_paise: number; transactions: DriverWalletTxn[] }>('/api/v1/driver-account/wallet', { method: 'GET', token });
}

export interface TrainingModule {
  id: string;
  title: string;
  duration_label: string;
  module_type: string;
  status: string;
  score: number | null;
}

export async function getDriverTraining(token: string): Promise<{ modules: TrainingModule[] }> {
  return request<{ modules: TrainingModule[] }>('/api/v1/driver-account/training', { method: 'GET', token });
}

export async function submitTrainingQuiz(
  token: string,
  moduleId: string,
  score: number,
): Promise<{ status: string; score: number }> {
  return request<{ status: string; score: number }>(`/api/v1/driver-account/training/${moduleId}/submit`, {
    method: 'POST',
    token,
    body: { score },
  });
}

export async function getDriverNotifications(
  token: string,
): Promise<DriverNotification[]> {
  return request<DriverNotification[]>('/api/v1/driver-account/notifications', { method: 'GET', token });
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
  battery?: number,
  networkType?: string,
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
      battery,
      network_type: networkType,
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

export interface DriverSendOTPResponse {
  message: string;
  expires_in_seconds: number;
}

export interface DriverVerifyOTPResponse {
  is_new_driver?: boolean;
  phone_token?: string;
  phone?: string;
  token?: string;
  user?: DriverAuthUser;
  phone_verified?: boolean;
}

export async function sendDriverOTP(phone: string): Promise<DriverSendOTPResponse> {
  return request<DriverSendOTPResponse>('/api/v1/driver/auth/send-otp', {
    method: 'POST',
    body: { phone },
  });
}

export async function verifyDriverOTP(phone: string, otp: string): Promise<DriverVerifyOTPResponse> {
  const res = await request<any>('/api/v1/driver/auth/verify-otp', {
    method: 'POST',
    body: { phone, otp },
  });
  
  if (res.is_new_driver) {
    return {
      is_new_driver: true,
      phone_token: res.phone_token,
      phone: res.phone,
    };
  }
  
  return {
    is_new_driver: false,
    token: res.token,
    user: {
      id: res.driver_id,
      role: res.role ?? 'DRIVER',
      name: res.name,
      current_state: '',
      phone_verified: res.phone_verified,
      phone: res.phone || phone,
    },
    phone_verified: res.phone_verified,
  };
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
    queueOfflinePayload(stepId, data);
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
      queueOfflinePayload(stepId, data);
      return { success: true, onboarding_step: stepId };
    }
    throw error;
  }
}

// queueOfflinePayload writes failed payloads to the localStorage queue. The JWT is
// deliberately NOT persisted — it is re-read from the live session at sync time, so
// a stale token never lingers in localStorage where XSS or a shared device could read it.
function queueOfflinePayload(stepId: number, data: Record<string, any>) {
  if (typeof window === 'undefined') return;
  try {
    const queue = JSON.parse(localStorage.getItem('onboarding-offline-queue') || '[]');
    queue.push({ stepId, data, timestamp: new Date().toISOString() });
    localStorage.setItem('onboarding-offline-queue', JSON.stringify(queue));
    console.log(`[OFFLINE] Queued onboarding step ${stepId} for sync`);
  } catch (e) {
    console.error('Failed to queue offline onboarding payload:', e);
  }
}

// syncOfflineOnboarding tries to upload all queued payloads sequentially using the
// current session token. With no active session the queue is held for next login.
export async function syncOfflineOnboarding(): Promise<void> {
  if (typeof window === 'undefined' || !navigator.onLine) return;
  const token = useAuthStore.getState().token;
  if (!token) return;
  try {
    const queueRaw = localStorage.getItem('onboarding-offline-queue');
    if (!queueRaw) return;
    const queue = JSON.parse(queueRaw) as Array<{ stepId: number; data: Record<string, any> }>;
    if (queue.length === 0) return;

    console.log(`[OFFLINE] Syncing ${queue.length} queued onboarding payloads...`);
    const remaining: typeof queue = [];

    for (const item of queue) {
      try {
        await request<OnboardingStepResponse>(`/api/v1/driver/onboarding/step/${item.stepId}`, {
          method: 'POST',
          token,
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
  startOdometer: number,
  fuelPercentage: number,
): Promise<{ success: boolean; status: string }> {
  return request<{ success: boolean; status: string }>(`/api/v1/driver/orders/${orderId}/verify-otp`, {
    method: 'PATCH',
    token,
    body: {
      otp,
      start_odometer: startOdometer,
      fuel_percentage: fuelPercentage,
    },
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
  driver_payout_paise: number;
}

export async function addOrderEvent(
  token: string,
  orderId: string,
  payload: {
    event_type: 'ADD_TOLL' | 'ADD_STOP' | 'REPORT_ISSUE' | 'NO_SHOW' | 'toll_added' | 'parking_added' | 'waiting_added';
    amount_paise: number;
    description: string;
  },
): Promise<{ success: boolean; message: string }> {
  return request<{ success: boolean; message: string }>(`/api/v1/driver/orders/${orderId}/events`, {
    method: 'POST',
    token,
    body: payload,
  });
}

export type CarIssueType = 'FUEL_LOW' | 'WARNING_LIGHT' | 'TYRE' | 'AC' | 'OTHER';

// Phase 10: driver files a post-trip issue about the rider's car.
export async function reportCarIssue(
  token: string,
  orderId: string,
  payload: { issue_type: CarIssueType; description: string },
): Promise<{ success: boolean; admin_notified: boolean; message: string }> {
  return request<{ success: boolean; admin_notified: boolean; message: string }>(
    `/api/v1/driver/orders/${orderId}/car-issue-report`,
    { method: 'POST', token, body: payload },
  );
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

// Driver rates the rider after a completed trip (separate from payment confirmation).
export async function rateRider(
  token: string,
  orderId: string,
  payload: { rating: number; tags: string[]; comment: string },
): Promise<{ success: boolean; message: string }> {
  return request<{ success: boolean; message: string }>(`/api/v1/driver/orders/${orderId}/rate-rider`, {
    method: 'POST',
    token,
    body: payload,
  });
}

export interface OfflineCachedPacket {
  type: "TELEMETRY" | "TRIP_EVENT" | "CHECKPOINT";
  payload: any;
  captured_at: string;
}

export async function syncOfflinePayload(
  token: string,
  payload: { order_id: string; device_fingerprint: string; packets: OfflineCachedPacket[] },
): Promise<{ status: string; reconciled_packets: number }> {
  return request<{ status: string; reconciled_packets: number }>('/api/v1/driver/sync/offline-payload', {
    method: 'POST',
    token,
    body: payload,
  });
}

// ─── Driver Earnings / Payouts / Wallet (ledger-backed) ───────────────────────

export type EarningsPeriod = "TODAY" | "WEEK" | "MONTH" | "CUSTOM";

export interface DriverEarningsSummary {
  gross_earnings_paise: number;
  tips_paise: number;
  bonuses_paise: number;
  incentives_paise: number;
  platform_deductions_paise: number;
  net_earnings_paise: number;
  trip_count: number;
  online_hours: number;
  acceptance_rate: number;
}

export interface DriverDailyBreakdown {
  date: string;
  earnings_paise: number;
  trips: number;
}

export interface DriverRecentTrip {
  order_id: string;
  pickup_short: string;
  drop_short: string;
  fare_paise: number;
  driver_earnings_paise: number;
  tip_paise: number;
  completed_at: string;
  distance_km: number;
  duration_minutes: number;
}

export interface DriverEarningsResponse {
  period: EarningsPeriod;
  summary: DriverEarningsSummary;
  daily_breakdown: DriverDailyBreakdown[];
  recent_trips: DriverRecentTrip[];
}

export async function getDriverEarnings(
  token: string,
  period: EarningsPeriod,
  from?: string,
  to?: string,
): Promise<DriverEarningsResponse> {
  const params: Record<string, string | number> = { period };
  if (period === "CUSTOM" && from && to) {
    params.from = from;
    params.to = to;
  }
  return request<DriverEarningsResponse>(`/api/v1/driver/earnings?${encodeQuery(params)}`, {
    method: "GET",
    token,
  });
}

// Fetches the monthly statement CSV as raw text (server generates it on the fly).
export async function getEarningsStatementCsv(
  token: string,
  year: number,
  month: number,
): Promise<string> {
  const res = await fetch(buildUrl(`/api/v1/driver/earnings/statement?year=${year}&month=${month}`), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "X-Region-Prefix": REGION_PREFIX },
  });
  if (!res.ok) {
    throw new ApiClientError(`statement_failed_${res.status}`, res.status, await res.text());
  }
  return res.text();
}

export type PayoutStatus = "PENDING" | "PROCESSING" | "PAID" | "FAILED";

export interface PayoutHistoryItem {
  id: string;
  amount_paise: number;
  net_amount_paise: number;
  status: PayoutStatus;
  failure_reason: string | null;
  requested_at: string;
  updated_at: string;
}

export interface DriverPayoutsResponse {
  available_balance_paise: number;
  bank_account: {
    verified: boolean;
    bank_name?: string;
    ifsc?: string;
    account_masked?: string;
  };
  upi_id: string;
  payout_history: PayoutHistoryItem[];
}

export async function getDriverPayouts(token: string): Promise<DriverPayoutsResponse> {
  return request<DriverPayoutsResponse>("/api/v1/driver/payouts", { method: "GET", token });
}

export interface PayoutRequestResult {
  payout_id: string;
  status: PayoutStatus;
  estimated_time: string;
}

export async function requestDriverPayout(
  token: string,
  amountPaise: number,
): Promise<PayoutRequestResult> {
  return request<PayoutRequestResult>("/api/v1/driver/payouts/request", {
    method: "POST",
    token,
    body: { amount_paise: amountPaise },
  });
}

export async function getPayoutDetail(token: string, payoutId: string): Promise<PayoutHistoryItem> {
  return request<PayoutHistoryItem>(`/api/v1/driver/payouts/${payoutId}`, { method: "GET", token });
}

// ─── Vehicle management ───────────────────────────────────────────────────────

export type VehicleDocStatus = "VALID" | "EXPIRING" | "EXPIRED" | "MISSING";

export interface VehicleDocSlot {
  document_type: "RC" | "INSURANCE" | "PUC";
  storage_url?: string;
  expiry_date?: string | null;
  status: VehicleDocStatus;
}

export interface DriverVehicleFull {
  id: string;
  make: string;
  model: string;
  year: number;
  plate: string;
  fuel_type: string;
  car_type: string;
  transmission: string;
  documents: VehicleDocSlot[];
}

export async function getVehicles(token: string): Promise<{ vehicles: DriverVehicleFull[] }> {
  return request<{ vehicles: DriverVehicleFull[] }>("/api/v1/driver/vehicles", { method: "GET", token });
}

export async function createVehicle(
  token: string,
  body: { make: string; model: string; year: number; plate: string; fuel_type: string; car_type: string; transmission: string },
): Promise<DriverVehicleFull> {
  return request<DriverVehicleFull>("/api/v1/driver/vehicles", { method: "POST", token, body });
}

export async function uploadVehicleDocument(
  token: string,
  vehicleId: string,
  documentType: string,
  file: File,
  expiryDate: string,
): Promise<VehicleDocSlot> {
  const form = new FormData();
  form.append("file", file);
  form.append("document_type", documentType);
  if (expiryDate) form.append("expiry_date", expiryDate);
  const res = await fetch(buildUrl(`/api/v1/driver/vehicles/${vehicleId}/documents`), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "X-Region-Prefix": REGION_PREFIX },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new ApiClientError(text || `upload_failed_${res.status}`, res.status, text);
  return JSON.parse(text) as VehicleDocSlot;
}

export async function deleteVehicleNew(token: string, id: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/v1/driver/vehicles/${id}`, { method: "DELETE", token });
}

// ─── Support tickets ──────────────────────────────────────────────────────────

export type TicketCategory = "TRIP" | "PAYMENT" | "VEHICLE" | "ACCOUNT" | "SAFETY" | "OTHER";
export type TicketStatus = "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";

export interface SupportTicketListItem {
  ticket_number: string;
  category: string;
  subject: string;
  status: TicketStatus;
  priority: string;
  created_at: string;
  updated_at: string;
}

export interface SupportTicketMessage {
  sender_type: string;
  sender_name: string;
  content: string;
  attachment_urls: string[];
  created_at: string;
}

export async function createSupportTicket(
  token: string,
  body: { category: TicketCategory; subject: string; description: string; order_id?: string; attachments?: string[] },
): Promise<{ ticket_number: string; status: string; priority: string }> {
  return request("/api/v1/driver/support/tickets", { method: "POST", token, body });
}

export async function uploadSupportAttachment(token: string, file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(buildUrl("/api/v1/driver/support/attachments"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "X-Region-Prefix": REGION_PREFIX },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new ApiClientError(text || `upload_failed_${res.status}`, res.status, text);
  return JSON.parse(text) as { url: string };
}

export async function getSupportTickets(token: string): Promise<{ tickets: SupportTicketListItem[] }> {
  return request<{ tickets: SupportTicketListItem[] }>("/api/v1/driver/support/tickets", { method: "GET", token });
}

export async function getSupportTicket(
  token: string,
  id: string,
): Promise<{ ticket: SupportTicketListItem; description: string; messages: SupportTicketMessage[] }> {
  return request(`/api/v1/driver/support/tickets/${id}`, { method: "GET", token });
}

export async function replySupportTicket(
  token: string,
  id: string,
  message: string,
  attachments: string[] = [],
): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/v1/driver/support/tickets/${id}/reply`, {
    method: "POST",
    token,
    body: { message, attachments },
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface NotificationPrefs {
  trip_offers: boolean;
  earnings: boolean;
  promotions: boolean;
  safety: boolean;
}

export async function updateNotificationPrefs(token: string, prefs: NotificationPrefs): Promise<NotificationPrefs> {
  return request<NotificationPrefs>("/api/v1/driver/notifications/preferences", { method: "PATCH", token, body: prefs });
}

export async function updateLanguage(token: string, language: string): Promise<{ preferred_language: string }> {
  return request<{ preferred_language: string }>("/api/v1/driver/profile/language", { method: "PATCH", token, body: { language } });
}

export async function changeDriverPassword(token: string, currentPassword: string, newPassword: string): Promise<{ status: string }> {
  return request<{ status: string }>("/api/v1/driver/auth/change-password", {
    method: "POST",
    token,
    body: { current_password: currentPassword, new_password: newPassword },
  });
}

export async function deleteDriverAccount(token: string): Promise<{ status: string }> {
  return request<{ status: string }>("/api/v1/driver/account", { method: "DELETE", token });
}

// ─── Driver-account: incentives / performance / referrals / profile / docs ─────
// Field names mirror the current page mock objects so the live JSON drops straight
// into the existing renders.

export interface DriverIncentiveQuest {
  title: string;
  desc: string;
  completed: number;
  total: number;
  reward: number;
  expiry: string;
}

export interface DriverSurgePrediction {
  zone: string;
  multiplier: string;
}

export interface DriverIncentivesResponse {
  quests: DriverIncentiveQuest[];
  surge_predictions: DriverSurgePrediction[];
}

export async function getDriverIncentives(token: string): Promise<DriverIncentivesResponse> {
  return request<DriverIncentivesResponse>("/api/v1/driver/incentives", { method: "GET", token });
}

export interface DriverPerformanceMetrics {
  rating: number;
  acceptance: number;
  cancellation: number;
  completion: number;
  trips: number;
}

export interface DriverPerformanceCompliment {
  label: string;
  count: number;
}

export interface DriverPerformanceReview {
  name: string;
  rating: number;
  date: string;
  text: string;
}

export interface DriverPerformanceTier {
  name: string;
  perks: string;
}

export interface DriverPerformanceResponse {
  metrics: DriverPerformanceMetrics;
  compliments: DriverPerformanceCompliment[];
  reviews: DriverPerformanceReview[];
  tiers: DriverPerformanceTier[];
}

export async function getDriverPerformance(token: string): Promise<DriverPerformanceResponse> {
  return request<DriverPerformanceResponse>("/api/v1/driver/performance", { method: "GET", token });
}

export interface DriverReferralsResponse {
  code: string;
  stats: {
    joined: number;
    pending: number;
    earnings: number;
  };
}

export async function getDriverReferrals(token: string): Promise<DriverReferralsResponse> {
  return request<DriverReferralsResponse>("/api/v1/driver/referrals", { method: "GET", token });
}

export interface DriverKycDocument {
  name: string;
  status: string;
  date: string;
}

export async function getDriverDocuments(token: string): Promise<{ documents: DriverKycDocument[] }> {
  return request<{ documents: DriverKycDocument[] }>("/api/v1/driver/me/documents", { method: "GET", token });
}

export async function updateDriverProfile(
  token: string,
  body: { name?: string; bio?: string; can_drive_manual?: boolean },
): Promise<{ name?: string; bio?: string; status?: string }> {
  return request("/api/v1/driver/profile", { method: "PATCH", token, body });
}

export async function markNotificationRead(token: string, id: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/v1/driver/notifications/${id}/read`, { method: "PATCH", token });
}

// ─── Safety: fatigue / mandatory rest break ────────────────────────────────────

export interface FatigueCheckResponse {
  must_take_break: boolean;
  hours_remaining: number;
  message?: string;
}

export async function getFatigueCheck(token: string): Promise<FatigueCheckResponse> {
  return request<FatigueCheckResponse>("/api/v1/driver/safety/fatigue-check", { method: "GET", token });
}

