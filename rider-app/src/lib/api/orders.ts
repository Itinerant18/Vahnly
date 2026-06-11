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
  duration_hours?: number;
  garage_car_id?: string;
  one_time_car?: OneTimeCar;
  persons_count?: number;
  promo_code?: string;
  d4m_care_opted: boolean;
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
