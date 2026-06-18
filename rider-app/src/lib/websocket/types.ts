// Rider live-trip WebSocket message types. Mirror the Go constants in
// internal/rider/realtime/realtime.go. Every message is { type, data }.
import type { FareBreakdown } from "../api/types";

export type ConnectionStatus = "CONNECTED" | "DISCONNECTED" | "RECONNECTING";

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
    vehicle_context: string;
    // Present when sent on driver-accept (offer-accept model): drives the live banner
    // straight to EN_ROUTE_TO_PICKUP. Absent on the legacy match-time payload.
    status?: string;
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
  data: { order_id: string; driver_id: string; arrived_at: string };
}

export interface RiderTripStarted {
  type: "rider.trip.started";
  data: { order_id: string; started_at: string; odometer_start: number };
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

export interface RiderNotificationMessage {
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
  data: { order_id: string; message: string };
}

export interface RiderChat {
  type: "rider.chat";
  data: { order_id: string; from: "RIDER" | "DRIVER"; text: string; ts: number };
}

export interface RiderFareUpdated {
  type: "rider.fare.updated";
  data: {
    order_id: string;
    new_estimate_paise: number;
    added_component: "TOLL" | "PARKING" | "WAITING" | "OTHER";
    amount_paise: number;
  };
}

export type RiderWebSocketMessage =
  | RiderOrderAssigned
  | RiderDriverLocation
  | RiderDriverArrived
  | RiderTripStarted
  | RiderTripCompleted
  | RiderTripCancelled
  | RiderNotificationMessage
  | RiderRideCheck
  | RiderChat
  | RiderFareUpdated;

export type RiderWebSocketMessageType = RiderWebSocketMessage["type"];

const KNOWN_TYPES: ReadonlySet<string> = new Set<RiderWebSocketMessageType>([
  "rider.order.assigned",
  "rider.driver.location",
  "rider.driver.arrived",
  "rider.trip.started",
  "rider.trip.completed",
  "rider.trip.cancelled",
  "rider.notification",
  "rider.ride_check",
  "rider.chat",
  "rider.fare.updated",
]);

export function isRiderWebSocketMessage(v: unknown): v is RiderWebSocketMessage {
  return (
    typeof v === "object" &&
    v !== null &&
    "type" in v &&
    typeof (v as { type: unknown }).type === "string" &&
    KNOWN_TYPES.has((v as { type: string }).type)
  );
}
