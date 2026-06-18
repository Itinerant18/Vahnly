// Typed API contracts. These mirror the Go backend JSON (internal/domain/*).
// Monetary values are paise (integers) — never floats.

export type TripType =
  | "IN_CITY_ROUND"
  | "IN_CITY_ONE_WAY"
  | "IN_CITY_HOURLY"
  | "MINI_OUTSTATION"
  | "OUTSTATION"
  | "MONTHLY";

// Package (duration-based) pricing tier sent to the backend. Derived from TripType:
// IN_CITY_HOURLY→HOURLY, MINI_OUTSTATION/OUTSTATION/MONTHLY map 1:1; the IN_CITY_*
// point-to-point types send no package_type (distance-priced).
export type PackageType = "HOURLY" | "MINI_OUTSTATION" | "OUTSTATION" | "MONTHLY";

export type CarType = "HATCHBACK" | "SEDAN" | "SUV" | "PREMIUM";
export type Transmission = "MANUAL" | "AUTOMATIC";
export type PaymentMethod = "CASH" | "UPI" | "CARD" | "WALLET";

export type TripStatus =
  | "CREATED"
  | "ASSIGNED"
  | "EN_ROUTE_TO_PICKUP"
  | "ARRIVED_AT_PICKUP"
  | "DELIVERING"
  | "WAITING"
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

// ─── Insurance / D4M Care ───────────────────────────────────────────────────
export type InsuranceClaimStatus = "OPEN" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
export type InsuranceClaimType = "ACCIDENT" | "PROPERTY_DAMAGE" | "OTHER";

export interface InsuranceClaim {
  id: string;
  order_id: string;
  claim_type: InsuranceClaimType;
  description: string;
  status: InsuranceClaimStatus;
  amount_paise?: number;
  photos?: string[];
  created_at: string;
}

export interface InsuranceCoverage {
  order_id: string;
  covered: boolean;
  plan?: string;
  coverage_amount_paise?: number;
}

export interface D4MCareStatus {
  monthly_active: boolean;
  plan?: string;
  renews_at?: string;
}

// ─── Support tickets (rider) ────────────────────────────────────────────────
export type SupportTicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export interface SupportTicketMessage {
  id: string;
  ticket_id: string;
  sender: "RIDER" | "AGENT";
  body: string;
  created_at: string;
}

export interface SupportTicket {
  id: string;
  subject: string;
  category: string;
  status: SupportTicketStatus;
  order_id?: string;
  user_type?: string;
  created_at: string;
  messages?: SupportTicketMessage[];
}

// ─── Payment methods ────────────────────────────────────────────────────────
export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  is_default: boolean;
}

export interface UpiMethod {
  id: string;
  vpa: string;
  is_default: boolean;
}

export interface PaymentMethodsResponse {
  cards: SavedCard[];
  upis: UpiMethod[];
}

// ─── Notification preferences ───────────────────────────────────────────────
export interface NotifChannelPrefs {
  push: boolean;
  sms: boolean;
  email: boolean;
}

export interface NotificationPreferences {
  trip_updates: NotifChannelPrefs;
  promotions: NotifChannelPrefs;
  safety_alerts: NotifChannelPrefs;
  document_expiry: NotifChannelPrefs;
}

// ─── CMS legal documents ────────────────────────────────────────────────────
export type CMSDocumentType =
  | "TERMS_OF_SERVICE"
  | "PRIVACY_POLICY"
  | "CANCELLATION_POLICY"
  | "REFUND_POLICY";

export interface CMSDocument {
  type: CMSDocumentType;
  title: string;
  html: string;
  updated_at?: string;
}
