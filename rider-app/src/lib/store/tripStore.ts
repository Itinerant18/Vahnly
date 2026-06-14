import { create } from "zustand";
import { ordersApi } from "../api/orders";
import type { FareBreakdown, LatLng, Order, TripStatus } from "../api/types";

// The server only persists a hash of the pickup OTP (orders.otp_hash), so the
// plaintext code — returned once at booking — is kept on-device here to survive a
// cold start / app restart mid-trip. Cleared when the trip reaches a terminal state.
const OTP_STORAGE_KEY = "dfu_active_otp";

export interface DriverInfo {
  driverId: string;
  name: string;
  photo: string;
  rating: number;
  tripsCount: number;
  vehicleContext: string;
  etaMinutes: number;
  bearing: number;
}

export interface CompletedFare {
  orderId: string;
  totalFarePaise: number;
  fareBreakdown: FareBreakdown;
  distanceKm: number;
  durationMinutes: number;
}

export interface TripState {
  activeOrder: Order | null;
  driverLocation: LatLng | null;
  driverETA: number | null;
  driverBearing: number;
  driverInfo: DriverInfo | null;
  otp: string | null;
  completedFare: CompletedFare | null;
  // Running in-trip fare estimate, updated live when the driver adds tolls/charges
  // (rider.fare.updated). Null until the first update; falls back to base fare in the UI.
  fareEstimatePaise: number | null;
  tripStatus: TripStatus | null;
  elapsedMinutes: number;
  wsConnected: boolean;

  setActiveOrder: (order: Order | null) => void;
  updateDriverLocation: (loc: LatLng, etaMinutes?: number, bearing?: number) => void;
  updateStatus: (status: TripStatus) => void;
  updateFareEstimate: (newEstimatePaise: number) => void;
  setWsConnected: (connected: boolean) => void;
  setElapsedMinutes: (m: number) => void;
  setDriverInfo: (info: DriverInfo) => void;
  setOTP: (otp: string) => void;
  clearPickupOtp: () => void;
  setCompletedFare: (fare: CompletedFare) => void;
  hydrateActiveOrder: () => Promise<void>;
  cancelTrip: (reason: string) => Promise<void>;
  triggerSOS: () => Promise<void>;
}

export const useTripStore = create<TripState>((set, get) => ({
  activeOrder: null,
  driverLocation: null,
  driverETA: null,
  driverBearing: 0,
  driverInfo: null,
  otp: null,
  completedFare: null,
  fareEstimatePaise: null,
  tripStatus: null,
  elapsedMinutes: 0,
  wsConnected: false,

  setActiveOrder: (order) => set({ activeOrder: order, tripStatus: order?.status ?? null }),
  updateDriverLocation: (loc, etaMinutes, bearing) =>
    set({
      driverLocation: loc,
      driverETA: etaMinutes ?? get().driverETA,
      driverBearing: bearing ?? get().driverBearing,
    }),
  updateStatus: (status) => set({ tripStatus: status }),
  updateFareEstimate: (newEstimatePaise) => set({ fareEstimatePaise: newEstimatePaise }),
  setWsConnected: (connected) => set({ wsConnected: connected }),
  setElapsedMinutes: (m) => set({ elapsedMinutes: m }),
  setDriverInfo: (info) => set({ driverInfo: info }),
  setOTP: (otp) => {
    set({ otp });
    if (typeof window !== "undefined") window.localStorage.setItem(OTP_STORAGE_KEY, otp);
  },
  clearPickupOtp: () => {
    set({ otp: null });
    if (typeof window !== "undefined") window.localStorage.removeItem(OTP_STORAGE_KEY);
  },
  setCompletedFare: (fare) => set({ completedFare: fare }),

  // Rebuild trip state from the server's source of truth. Called on screen mount
  // (cold start / refresh) and on every WS *reconnect* so a dropped socket can't
  // leave the rider stranded on a stale "ghost" trip after the server has moved on.
  hydrateActiveOrder: async () => {
    try {
      const res = await ordersApi.active();
      get().setActiveOrder(res.order);
      if (res.driver_location) set({ driverLocation: res.driver_location });
      if (typeof window !== "undefined") {
        if (res.order.status === "COMPLETED" || res.order.status === "CANCELLED") {
          window.localStorage.removeItem(OTP_STORAGE_KEY);
        } else {
          const saved = window.localStorage.getItem(OTP_STORAGE_KEY);
          if (saved) set({ otp: saved });
        }
      }
    } catch {
      // No active order (404) or a transient error — keep whatever state we have.
    }
  },

  cancelTrip: async (reason) => {
    const order = get().activeOrder;
    if (!order) return;
    await ordersApi.cancel(order.id, reason);
    set({ tripStatus: "CANCELLED" });
  },

  triggerSOS: async () => {
    const order = get().activeOrder;
    if (!order) return;
    await ordersApi.sos(order.id);
  },
}));
