import { apiClient } from "./client";
import type {
  FareEstimate,
  LocationPoint,
  OneTimeCar,
  Order,
  PaymentMethod,
  TripType,
} from "./types";

export interface CreateOrderRequest {
  pickup_lat: number;
  pickup_lng: number;
  pickup_address: string;
  dropoff_lat?: number;
  dropoff_lng?: number;
  dropoff_address?: string;
  stops?: LocationPoint[];
  trip_type: TripType;
  package_type?: string;
  duration_hours?: number;
  garage_car_id?: string;
  one_time_car?: OneTimeCar;
  persons_count?: number;
  promo_code?: string;
  d4m_care_opted: boolean;
  owner_not_in_car?: boolean;
  payment_method: PaymentMethod;
  scheduled_at?: string | null;
  city?: string;
}

export interface CreateOrderResult {
  order: Order;
  fare_estimate: FareEstimate;
  otp: string;
}

export interface ActiveOrderResult {
  order: Order;
  // Plaintext pickup OTP — the server returns it only while the trip is pre-pickup
  // (ASSIGNED / EN_ROUTE_TO_PICKUP / ARRIVED_AT_PICKUP), empty once the trip starts.
  // Lets a cold-start recover the code instead of relying on on-device storage.
  otp?: string;
  driver?: { first_name: string; rating: number };
  driver_location?: { lat: number; lng: number };
}

export interface RateRequest {
  rating: number;
  tags: string[];
  comment: string;
  tip_paise: number;
}

export interface OrderHistoryResult {
  orders: Order[];
  total: number;
  limit: number;
  offset: number;
}

export const ordersApi = {
  create: (req: CreateOrderRequest) =>
    apiClient.post<CreateOrderResult>("/api/v1/rider/orders", req),

  active: () => apiClient.get<ActiveOrderResult>("/api/v1/rider/orders/active"),

  history: (params: { status?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.limit != null) q.set("limit", String(params.limit));
    if (params.offset != null) q.set("offset", String(params.offset));
    const qs = q.toString();
    return apiClient.get<OrderHistoryResult>(
      `/api/v1/rider/orders${qs ? `?${qs}` : ""}`,
    );
  },

  cancel: (orderId: string, reason: string) =>
    apiClient.del<{ cancelled: boolean; fee_paise: number }>(
      `/api/v1/rider/orders/${orderId}/cancel`,
      { reason },
    ),

  rate: (orderId: string, req: RateRequest) =>
    apiClient.post<{ message: string }>(`/api/v1/rider/orders/${orderId}/rate`, req),

  sendChat: (orderId: string, text: string) =>
    apiClient.post<{ status: string }>(`/api/v1/rider/orders/${orderId}/chat`, { text }),

  shareLocation: (orderId: string, lat: number, lng: number) =>
    apiClient.post<{ status: string }>(`/api/v1/rider/orders/${orderId}/location`, { lat, lng }),

  sos: (orderId: string) =>
    apiClient.post<{ triggered: boolean; contacts_notified: number }>(
      `/api/v1/rider/orders/${orderId}/sos`,
    ),

  addStop: (orderId: string, stop: LocationPoint) =>
    apiClient.post<Order>(`/api/v1/rider/orders/${orderId}/stops`, stop),

  extend: (orderId: string, extendHours: number) =>
    apiClient.patch<Order>(`/api/v1/rider/orders/${orderId}/extend`, {
      extend_hours: extendHours,
    }),

  changeDrop: (orderId: string, point: { lat: number; lng: number; address: string }) =>
    apiClient.patch<Order>(`/api/v1/rider/orders/${orderId}/drop`, {
      dropoff_lat: point.lat,
      dropoff_lng: point.lng,
      dropoff_address: point.address,
    }),

  tripShare: (shareToken: string) =>
    apiClient.get<{
      status: string;
      driver_name?: string;
      driver_location?: { lat: number; lng: number };
      pickup_lat: number;
      pickup_lng: number;
      dropoff_lat: number;
      dropoff_lng: number;
      eta_minutes: number;
    }>(`/api/v1/trip-share/${shareToken}`),
};
