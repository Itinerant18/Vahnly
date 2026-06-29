import { apiClient } from '../apiClient';

export interface AdminOrder {
  id: string;
  city_prefix: string;
  customer_id: string;
  status: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  pickup_h3_cell: string;
  assigned_driver_id: string | null;
  driver_name: string;
  surge_multiplier: number;
  base_fare_paise: number;
  created_at: string;
  assigned_at: string | null;
  trip_type: string;
  car_type: string;
  transmission: string;
  payment_method: string;
  promo_applied: string;
  d4m_care: boolean;
  rating: number;
  plate: string;
  [key: string]: unknown;
}

export interface OrdersListParams {
  page: number;
  limit: number;
  status?: string;
  driverId?: string;
  riderId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  city?: string;
  tripType?: string;
  carType?: string;
  payment?: string;
  transmission?: string;
  promo?: string;
  d4mCare?: string;
  ratingLess3?: boolean;
}

export interface OrdersListResult {
  orders: AdminOrder[];
  total?: number;
  hasMore: boolean;
}

interface PaginatedOrdersResponse {
  orders?: AdminOrder[];
  data?: AdminOrder[];
  total?: number;
  page?: number;
  limit?: number;
  has_more?: boolean;
  hasMore?: boolean;
}

export interface TimelineEvent {
  event: string;
  timestamp: string;
  status: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RiderInfo {
  customer_id: string;
  name: string;
  phone: string;
  trip_count: number;
}

export interface DriverInfo {
  driver_id: string;
  name: string;
  phone: string;
  is_verified: boolean;
  trip_count: number;
}

export interface VehicleInfo {
  plate: string;
  model: string;
  type: string;
  transmission: string;
}

export interface FareBreakdown {
  base: number;
  distance: number;
  time: number;
  night: number;
  surge: number;
  care: number;
  promo: number;
  tax: number;
  total: number;
}

export interface PaymentAttempt {
  timestamp: string;
  status: string;
  amount: number;
  txn_id: string;
  provider: string;
}

export interface ComplaintItem {
  id: string;
  title: string;
  category: string;
  status: string;
  severity: string;
  agent: string;
}

export interface OrderDetailResponse {
  trip: AdminOrder;
  timeline: TimelineEvent[];
  polyline: LatLng[];
  rider: RiderInfo;
  driver: DriverInfo | null;
  vehicle: VehicleInfo;
  fare_breakdown: FareBreakdown;
  payment_attempts: PaymentAttempt[];
  issues: ComplaintItem[];
}

export interface GpsPoint {
  lat: number;
  lng: number;
  captured_at: string;
  speed: number;
}

export interface ForensicAudit {
  order_id: string;
  driver_id: string;
  offer_timestamps: Record<string, unknown>;
  odometer_inputs: Record<string, unknown>;
  route_metrics: Record<string, unknown>;
  hardware_state: Record<string, unknown>;
  final_invoice: Record<string, unknown>;
  captured_at: string;
}

export interface DriverPoolItem {
  driver_id: string;
  name: string;
  phone: string;
  city_prefix: string;
  status: string;
  [key: string]: unknown;
}

function appendParam(params: URLSearchParams, key: string, value?: string): void {
  if (value) params.set(key, value);
}

function ordersPath(params: OrdersListParams): string {
  const query = new URLSearchParams();
  const page = Math.max(1, params.page);
  query.set('page', String(page));
  query.set('limit', String(params.limit));
  query.set('offset', String((page - 1) * params.limit));
  appendParam(query, 'status', params.status);
  appendParam(query, 'driverId', params.driverId);
  appendParam(query, 'driver_id', params.driverId);
  appendParam(query, 'riderId', params.riderId);
  appendParam(query, 'customer_id', params.riderId);
  appendParam(query, 'dateFrom', params.dateFrom);
  appendParam(query, 'date_start', params.dateFrom);
  appendParam(query, 'dateTo', params.dateTo);
  appendParam(query, 'date_end', params.dateTo);
  appendParam(query, 'search', params.search);
  appendParam(query, 'city_prefix', params.city);
  appendParam(query, 'trip_type', params.tripType);
  appendParam(query, 'car_type', params.carType);
  appendParam(query, 'payment_method', params.payment);
  appendParam(query, 'transmission', params.transmission);
  appendParam(query, 'promo_applied', params.promo);
  appendParam(query, 'd4m_care', params.d4mCare);
  if (params.ratingLess3) query.set('rating_less_than_3', 'true');
  return `/api/v1/admin/orders?${query.toString()}`;
}

export async function getOrders(params: OrdersListParams): Promise<OrdersListResult> {
  const response = await apiClient.get<AdminOrder[] | PaginatedOrdersResponse>(ordersPath(params));
  const orders = Array.isArray(response) ? response : response.orders ?? response.data ?? [];
  const total = Array.isArray(response) ? undefined : response.total;
  const hasMore = Array.isArray(response)
    ? orders.length === params.limit
    : response.has_more ?? response.hasMore ?? (typeof total === 'number' ? params.page * params.limit < total : orders.length === params.limit);

  return { orders, total, hasMore };
}

export const getOrder = (orderId: string) =>
  apiClient.get<OrderDetailResponse>(`/api/v1/admin/orders/${orderId}`);

export const getOrderGpsTrail = (orderId: string) =>
  apiClient.get<{ trail?: GpsPoint[] }>(`/api/v1/admin/orders/${orderId}/gps-trail`);

export const getOrderForensicAudit = (orderId: string) =>
  apiClient.get<ForensicAudit>(`/api/v1/admin/orders/${orderId}/forensic-audit`);

export const postOrderAction = (orderId: string, action: string, payload?: Record<string, unknown>) =>
  apiClient.post<{ status: string }>(`/api/v1/admin/orders/${orderId}/${action}`, payload);

export const cancelOrder = (orderId: string, reason?: string) =>
  apiClient.post<{ status: string }>(`/api/v1/admin/orders/${orderId}/cancel`, reason ? { reason } : undefined);

export const reassignOrder = (orderId: string, driverId: string) =>
  apiClient.post<{ status: string }>(`/api/v1/admin/orders/${orderId}/reassign`, { driver_id: driverId });

export async function getActiveDriversForReassign(): Promise<DriverPoolItem[]> {
  const response = await apiClient.get<DriverPoolItem[] | { drivers?: DriverPoolItem[] }>('/api/v1/admin/drivers?status=ACTIVE');
  return Array.isArray(response) ? response : response.drivers ?? [];
}
