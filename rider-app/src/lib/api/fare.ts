import { apiClient } from "./client";
import type { FareEstimate, PaymentMethod, TripType } from "./types";

export interface FareEstimateRequest {
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat?: number;
  dropoff_lng?: number;
  trip_type: TripType;
  duration_hours?: number;
  car_type?: string;
  transmission?: string;
  scheduled_at?: string | null;
  promo_code?: string;
  d4m_care: boolean;
  payment_method: PaymentMethod;
  city?: string;
}

export const fareApi = {
  estimate: (req: FareEstimateRequest) =>
    apiClient.post<FareEstimate>("/api/v1/rider/fare-estimate", req),
};
