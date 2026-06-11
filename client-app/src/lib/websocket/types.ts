// Rider live-trip WebSocket message types.
//
// These mirror the Go constants in internal/rider/realtime/realtime.go. Every
// message the rider WS (`GET /ws/rider?token=...`) emits is one of the members
// of the RiderWebSocketMessage union below, shaped as { type, data }.

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

export interface RiderOrderAssigned {
  type: "rider.order.assigned";
  data: {
    order_id: string;
    driver_id: string;
    driver_name: string;
    driver_photo: string;
    driver_rating: number;
    driver_trips_count: number;
    transmission_expertise: string;
    eta_minutes: number;
    eta_km: number;
    vehicle_context: string; // e.g. "Driving your Maruti Swift"
  };
}

export interface RiderDriverLocation {
  type: "rider.driver.location";
  data: {
    order_id: string;
    driver_id: string;
    lat: number;
    lng: number;
    bearing: number;
    speed_kmh: number;
    eta_minutes: number;
    status: string;
  };
}

export interface RiderDriverArrived {
  type: "rider.driver.arrived";
  data: {
    order_id: string;
    driver_id: string;
    arrived_at: string; // RFC3339
  };
}

export interface RiderTripStarted {
  type: "rider.trip.started";
  data: {
    order_id: string;
    started_at: string; // RFC3339
    odometer_start: number;
  };
}

export interface RiderTripCompleted {
  type: "rider.trip.completed";
  data: {
    order_id: string;
    total_fare_paise: number;
    fare_breakdown: FareBreakdown;
    distance_km: number;
    duration_minutes: number;
  };
}

export interface RiderTripCancelled {
  type: "rider.trip.cancelled";
  data: {
    order_id: string;
    cancelled_by: "RIDER" | "DRIVER" | "ADMIN" | "SYSTEM";
    reason: string;
    cancellation_fee_paise: number;
  };
}

export interface RiderNotification {
  type: "rider.notification";
  data: {
    type: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  };
}

export interface RiderRideCheck {
  type: "rider.ride_check";
  data: {
    order_id: string;
    message: string; // "Everything ok?"
  };
}

export type RiderWebSocketMessage =
  | RiderOrderAssigned
  | RiderDriverLocation
  | RiderDriverArrived
  | RiderTripStarted
  | RiderTripCompleted
  | RiderTripCancelled
  | RiderNotification
  | RiderRideCheck;

export type RiderWebSocketMessageType = RiderWebSocketMessage["type"];

// ---------------------------------------------------------------------------
// Driver WebSocket message types (Phase 10).
//
// These mirror the driver-facing payloads pushed over the gateway assignment
// backplane ("gateway:assignments:broadcast"). Every message is { type, ...data }.
// ---------------------------------------------------------------------------

// Enriched offer/assignment context shown in the driver offer popup.
export interface DriverOrderAssigned {
  type: "driver.order.assigned";
  order_id: string;
  rider_name: string; // first name only
  car_make: string;
  car_model: string;
  car_type: string;
  car_color: string;
  car_transmission: "Manual" | "Automatic" | string;
  transmission_match: boolean; // does the driver's expertise cover the car?
  fare_estimate: number;
  eta_minutes: number;
}

// Operations-initiated forced assignment (admin force-match).
export interface DriverForceAssigned {
  type: "driver.force.assigned";
  order_id: string;
  pickup_address: string;
  rider_name: string;
  car_context: string; // e.g. "Maruti Swift"
  message: string; // "You've been assigned a trip by operations"
}

export type DriverWebSocketMessage = DriverOrderAssigned | DriverForceAssigned;

export type DriverWebSocketMessageType = DriverWebSocketMessage["type"];
