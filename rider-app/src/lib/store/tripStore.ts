import { create } from "zustand";
import { ordersApi } from "../api/orders";
import type { FareBreakdown, LatLng, Order, TripStatus } from "../api/types";

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
  tripStatus: TripStatus | null;
  elapsedMinutes: number;
  wsConnected: boolean;

  setActiveOrder: (order: Order | null) => void;
  updateDriverLocation: (loc: LatLng, etaMinutes?: number, bearing?: number) => void;
  updateStatus: (status: TripStatus) => void;
  setWsConnected: (connected: boolean) => void;
  setElapsedMinutes: (m: number) => void;
  setDriverInfo: (info: DriverInfo) => void;
  setOTP: (otp: string) => void;
  setCompletedFare: (fare: CompletedFare) => void;
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
  setWsConnected: (connected) => set({ wsConnected: connected }),
  setElapsedMinutes: (m) => set({ elapsedMinutes: m }),
  setDriverInfo: (info) => set({ driverInfo: info }),
  setOTP: (otp) => set({ otp }),
  setCompletedFare: (fare) => set({ completedFare: fare }),

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
