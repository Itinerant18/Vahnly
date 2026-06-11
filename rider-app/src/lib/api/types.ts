// Typed API contracts. These mirror the Go backend JSON (internal/domain/*).
// Monetary values are paise (integers) — never floats.

export type TripType =
  | "IN_CITY_ROUND"
  | "IN_CITY_ONE_WAY"
  | "MINI_OUTSTATION"
  | "OUTSTATION";

export type CarType = "HATCHBACK" | "SEDAN" | "SUV" | "PREMIUM";
export type Transmission = "MANUAL" | "AUTOMATIC";
export type PaymentMethod = "CASH" | "UPI" | "CARD" | "WALLET";

export type TripStatus =
  | "CREATED"
  | "ASSIGNED"
  | "EN_ROUTE_TO_PICKUP"
  | "ARRIVED_AT_PICKUP"
  | "DELIVERING"
  | "COMPLETED"
  | "CANCELLED";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface LocationPoint {
  lat: number;
  lng: number;
  address: string;
}

export interface OneTimeCar {
  make: string;
  model: string;
  car_type: CarType;
  transmission: Transmission;
}

export interface Rider {
  id: string;
  phone: string;
  phone_verified: boolean;
  name?: string;
  email?: string;
  email_verified: boolean;
  gender?: string;
  date_of_birth?: string;
  profile_photo_url?: string;
  preferred_language: string;
  kyc_level: string;
  is_active: boolean;
  referral_code?: string;
  created_at: string;
  updated_at: string;
}

export interface GarageCar {
  id: string;
  rider_id: string;
  make: string;
  model: string;
  year: number;
  car_type: CarType;
  transmission: Transmission;
  fuel_type?: string;
  registration_plate: string;
  color?: string;
  insurance_expiry?: string;
  puc_expiry?: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FareBreakdown {
  base_fare_paise: number;
  distance_charge_paise: number;
  night_charge_paise: number;
  d4m_care_paise: number;
  surge_multiplier: number;
  promo_discount_paise: number;
  estimated_total_paise: number;
  estimated_total_inr: string;
}

export type DriverAvailability = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export interface FareEstimate {
  fare_breakdown: FareBreakdown;
  estimated_pickup_eta_minutes: number;
  driver_availability: DriverAvailability;
  surge_active: boolean;
  h3_cell: string;
}

export interface PromoResult {
  promo_code_id?: string;
  code: string;
  discount_paise: number;
}

export interface Order {
  id: string;
  status: TripStatus;
  city_prefix: string;
  rider_id?: string;
  assigned_driver_id?: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat?: number;
  dropoff_lng?: number;
  pickup_h3_cell: string;
  garage_car_id?: string;
  base_fare_paise: number;
  surge_multiplier: number;
  promo_code?: string;
  promo_discount_paise: number;
  d4m_care_opted: boolean;
  payment_method?: PaymentMethod;
  persons_count?: number;
  trip_share_token?: string;
  rider_rating_for_driver?: number;
  rider_tip_paise: number;
  cancelled_by?: string;
  cancellation_reason?: string;
  created_at: string;
}

export interface Wallet {
  id: string;
  rider_id: string;
  balance_paise: number;
  locked_paise: number;
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: string;
  rider_id: string;
  type: string;
  amount_paise: number;
  balance_after_paise: number;
  reference_id?: string;
  reference_type?: string;
  description?: string;
  created_at: string;
}

export interface RiderReferral {
  id: string;
  referrer_rider_id?: string;
  referred_rider_id?: string;
  referral_code: string;
  status: string;
  reward_amount_paise: number;
  rewarded_at?: string;
  created_at: string;
}

export interface RiderNotificationItem {
  id: string;
  rider_id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export interface EmergencyContact {
  id: string;
  rider_id: string;
  name: string;
  phone: string;
  relationship?: string;
  auto_share_trip: boolean;
  display_order: number;
  created_at: string;
}

export interface SavedPlace {
  id: string;
  rider_id: string;
  label: string;
  display_name: string;
  address_text: string;
  lat: number;
  lng: number;
  is_active: boolean;
  created_at: string;
}

// Standard API envelope: { success, data } or { success, error, code }.
export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}
