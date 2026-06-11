import { create } from "zustand";
import { fareApi } from "../api/fare";
import { ordersApi } from "../api/orders";
import type {
  FareEstimate,
  LocationPoint,
  OneTimeCar,
  Order,
  PaymentMethod,
  PromoResult,
  TripType,
} from "../api/types";

let fareDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export interface BookingState {
  pickup: LocationPoint | null;
  dropoff: LocationPoint | null;
  stops: LocationPoint[];
  tripType: TripType;
  durationHours: number;
  selectedCarId: string | null;
  oneTimeCar: OneTimeCar | null;
  personsCount: number;
  promoCode: string;
  promoResult: PromoResult | null;
  d4mCare: boolean;
  paymentMethod: PaymentMethod;
  fareEstimate: FareEstimate | null;
  isSearching: boolean;

  setPickup: (p: LocationPoint | null) => void;
  setDropoff: (p: LocationPoint | null) => void;
  addStop: (p: LocationPoint) => void;
  removeStop: (index: number) => void;
  setTripType: (t: TripType) => void;
  setDurationHours: (h: number) => void;
  setSelectedCar: (carId: string | null) => void;
  setOneTimeCar: (car: OneTimeCar | null) => void;
  setPersonsCount: (n: number) => void;
  scheduledAt: string | null;
  setScheduledAt: (t: string | null) => void;
  setPromoCode: (code: string) => void;
  validatePromo: () => Promise<void>;
  setD4mCare: (on: boolean) => void;
  setPaymentMethod: (m: PaymentMethod) => void;
  fetchFareEstimate: () => void;
  bookDriver: () => Promise<{ order: Order; otp: string }>;
  reset: () => void;
}

const initial = {
  pickup: null as LocationPoint | null,
  dropoff: null as LocationPoint | null,
  stops: [] as LocationPoint[],
  tripType: "IN_CITY_ONE_WAY" as TripType,
  durationHours: 0,
  selectedCarId: null as string | null,
  oneTimeCar: null as OneTimeCar | null,
  personsCount: 1,
  scheduledAt: null as string | null,
  promoCode: "",
  promoResult: null as PromoResult | null,
  d4mCare: false,
  paymentMethod: "CASH" as PaymentMethod,
  fareEstimate: null as FareEstimate | null,
  isSearching: false,
};

export const useBookingStore = create<BookingState>((set, get) => ({
  ...initial,

  setPickup: (p) => {
    set({ pickup: p });
    get().fetchFareEstimate();
  },
  setDropoff: (p) => {
    set({ dropoff: p });
    get().fetchFareEstimate();
  },
  addStop: (p) => set((s) => ({ stops: [...s.stops, p].slice(0, 3) })),
  removeStop: (index) => set((s) => ({ stops: s.stops.filter((_, i) => i !== index) })),
  setTripType: (t) => {
    set({ tripType: t });
    get().fetchFareEstimate();
  },
  setDurationHours: (h) => set({ durationHours: h }),
  setSelectedCar: (carId) => set({ selectedCarId: carId, oneTimeCar: null }),
  setOneTimeCar: (car) => set({ oneTimeCar: car, selectedCarId: null }),
  setPersonsCount: (n) => set({ personsCount: Math.max(1, Math.min(8, n)) }),
  setScheduledAt: (t) => set({ scheduledAt: t }),
  setPromoCode: (code) => set({ promoCode: code }),

  validatePromo: async () => {
    const { promoCode, fareEstimate } = get();
    if (!promoCode || !fareEstimate) {
      set({ promoResult: null });
      return;
    }
    // The backend validates the promo as part of the fare estimate; re-fetch to
    // surface the applied discount.
    get().fetchFareEstimate();
  },

  setD4mCare: (on) => {
    set({ d4mCare: on });
    get().fetchFareEstimate();
  },
  setPaymentMethod: (m) => set({ paymentMethod: m }),

  fetchFareEstimate: () => {
    const { pickup } = get();
    if (!pickup) return;
    if (fareDebounceTimer) clearTimeout(fareDebounceTimer);
    fareDebounceTimer = setTimeout(async () => {
      const s = get();
      if (!s.pickup) return;
      set({ isSearching: true });
      try {
        const est = await fareApi.estimate({
          pickup_lat: s.pickup.lat,
          pickup_lng: s.pickup.lng,
          dropoff_lat: s.dropoff?.lat,
          dropoff_lng: s.dropoff?.lng,
          trip_type: s.tripType,
          duration_hours: s.durationHours,
          promo_code: s.promoCode || undefined,
          d4m_care: s.d4mCare,
          payment_method: s.paymentMethod,
        });
        set({ fareEstimate: est });
      } finally {
        set({ isSearching: false });
      }
    }, 500);
  },

  bookDriver: async () => {
    const s = get();
    if (!s.pickup) throw new Error("pickup required");
    const res = await ordersApi.create({
      pickup_lat: s.pickup.lat,
      pickup_lng: s.pickup.lng,
      pickup_address: s.pickup.address,
      dropoff_lat: s.dropoff?.lat,
      dropoff_lng: s.dropoff?.lng,
      dropoff_address: s.dropoff?.address,
      stops: s.stops,
      trip_type: s.tripType,
      duration_hours: s.durationHours,
      garage_car_id: s.selectedCarId ?? undefined,
      one_time_car: s.oneTimeCar ?? undefined,
      persons_count: s.personsCount,
      promo_code: s.promoCode || undefined,
      d4m_care_opted: s.d4mCare,
      payment_method: s.paymentMethod,
      scheduled_at: s.scheduledAt ?? undefined,
    });
    return { order: res.order, otp: res.otp };
  },

  reset: () => set({ ...initial }),
}));
