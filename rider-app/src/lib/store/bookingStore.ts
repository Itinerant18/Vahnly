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

// Trip types that price as a flat package (no surge) rather than by distance. The
// IN_CITY_ONE_WAY / IN_CITY_ROUND point-to-point types map to nothing (distance-priced).
const TRIP_TO_PACKAGE: Partial<Record<TripType, string>> = {
  IN_CITY_HOURLY: "HOURLY",
  MINI_OUTSTATION: "MINI_OUTSTATION",
  OUTSTATION: "OUTSTATION",
  MONTHLY: "MONTHLY",
};
const packageTypeFor = (t: TripType): string | undefined => TRIP_TO_PACKAGE[t];

// ── Booking readiness ─────────────────────────────────────────────────────────
// A booking may only be dispatched once every field REQUIRED for the chosen trip
// type is set and a fare estimate has actually been produced. Point-to-point and
// outstation trips need a drop-off; round/hourly/monthly are time-based and don't
// (mirrors `needsDrop` in BookingSheet). Every trip needs a car (it's a
// drive-your-car service) and a fare the rider has seen.
export const tripNeedsDropoff = (t: TripType): boolean =>
  t === "IN_CITY_ONE_WAY" || t === "MINI_OUTSTATION" || t === "OUTSTATION";

// One-line context hint per trip type, shown under the selector so the rider
// knows what each tier means before filling the form (e.g. round trips need no
// drop-off). Exhaustive Record — adding a TripType forces a hint here.
export const TRIP_HINT: Record<TripType, string> = {
  IN_CITY_ONE_WAY: "Pickup & drop are different locations in the city.",
  IN_CITY_ROUND: "Driver waits and brings you back — no drop-off needed.",
  IN_CITY_HOURLY: "Book a driver by the hour for multiple stops.",
  MINI_OUTSTATION: "Short intercity trip — set your out-of-city drop.",
  OUTSTATION: "Full intercity trip — set your destination.",
  MONTHLY: "Dedicated monthly driver — coming soon.",
};

export type BookingBlocker = "pickup" | "dropoff" | "car" | "fare" | null;

type ReadinessInput = Pick<
  BookingState,
  "pickup" | "dropoff" | "tripType" | "selectedCarId" | "oneTimeCar" | "fareEstimate"
>;

/** First unmet requirement blocking dispatch, or null when ready to book. */
export function bookingBlocker(s: ReadinessInput): BookingBlocker {
  if (!s.pickup) return "pickup";
  if (tripNeedsDropoff(s.tripType) && !s.dropoff) return "dropoff";
  if (!s.selectedCarId && !s.oneTimeCar) return "car";
  if (!s.fareEstimate) return "fare";
  return null;
}

const BLOCKER_MESSAGE: Record<Exclude<BookingBlocker, null>, string> = {
  pickup: "Set a pickup location",
  dropoff: "Add a drop-off location",
  car: "Choose your car",
  fare: "Get a fare estimate first",
};

export interface BookingState {
  pickup: LocationPoint | null;
  dropoff: LocationPoint | null;
  stops: LocationPoint[];
  tripType: TripType;
  durationHours: number;
  selectedCarId: string | null;
  carType: string | null; // tier of the selected/one-time car — drives tiered fare pricing
  oneTimeCar: OneTimeCar | null;
  personsCount: number;
  promoCode: string;
  promoResult: PromoResult | null;
  d4mCare: boolean;
  ownerNotInCar: boolean;
  paymentMethod: PaymentMethod;
  fareEstimate: FareEstimate | null;
  isSearching: boolean;
  bookingIdemKey: string | null; // stable idempotency key for the current booking attempt

  setPickup: (p: LocationPoint | null) => void;
  setDropoff: (p: LocationPoint | null) => void;
  addStop: (p: LocationPoint) => void;
  removeStop: (index: number) => void;
  setTripType: (t: TripType) => void;
  setDurationHours: (h: number) => void;
  setSelectedCar: (carId: string | null, carType?: string | null) => void;
  setOneTimeCar: (car: OneTimeCar | null) => void;
  setPersonsCount: (n: number) => void;
  scheduledAt: string | null;
  setScheduledAt: (t: string | null) => void;
  setPromoCode: (code: string) => void;
  validatePromo: () => Promise<void>;
  setD4mCare: (on: boolean) => void;
  setOwnerNotInCar: (on: boolean) => void;
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
  carType: null as string | null,
  oneTimeCar: null as OneTimeCar | null,
  personsCount: 1,
  scheduledAt: null as string | null,
  promoCode: "",
  promoResult: null as PromoResult | null,
  d4mCare: false,
  ownerNotInCar: false,
  paymentMethod: "CASH" as PaymentMethod,
  fareEstimate: null as FareEstimate | null,
  isSearching: false,
  bookingIdemKey: null as string | null,
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
  setDurationHours: (h) => {
    set({ durationHours: h });
    get().fetchFareEstimate();
  },
  setSelectedCar: (carId, carType = null) => {
    set({ selectedCarId: carId, carType, oneTimeCar: null });
    get().fetchFareEstimate();
  },
  setOneTimeCar: (car) => {
    set({ oneTimeCar: car, selectedCarId: null, carType: car?.car_type ?? null });
    get().fetchFareEstimate();
  },
  setPersonsCount: (n) => set({ personsCount: Math.max(1, Math.min(8, n)) }),
  setScheduledAt: (t) => set({ scheduledAt: t }),
  setPromoCode: (code) => set({ promoCode: code }),

  validatePromo: async () => {
    const s = get();
    if (!s.promoCode || !s.pickup) {
      set({ promoResult: null });
      return;
    }
    // The backend prices the promo inside fare-estimate. Call it directly
    // (bypassing the 500ms debounce) so we can surface the applied discount and
    // throw when the code is rejected (no discount produced).
    set({ isSearching: true });
    try {
      const est = await fareApi.estimate({
        pickup_lat: s.pickup.lat,
        pickup_lng: s.pickup.lng,
        dropoff_lat: s.dropoff?.lat,
        dropoff_lng: s.dropoff?.lng,
        trip_type: s.tripType,
        package_type: packageTypeFor(s.tripType),
        duration_hours: s.durationHours,
        car_type: s.carType ?? undefined,
        promo_code: s.promoCode,
        d4m_care: s.d4mCare,
        payment_method: s.paymentMethod,
      });
      const discount = est.fare_breakdown.promo_discount_paise;
      set({
        fareEstimate: est,
        promoResult:
          discount > 0 ? { code: s.promoCode, discount_paise: discount } : null,
      });
      if (discount <= 0) throw new Error("promo_invalid");
    } finally {
      set({ isSearching: false });
    }
  },

  setD4mCare: (on) => {
    set({ d4mCare: on });
    get().fetchFareEstimate();
  },
  setOwnerNotInCar: (on) => set({ ownerNotInCar: on }),
  setPaymentMethod: (m) => set({ paymentMethod: m }),

  fetchFareEstimate: () => {
    const { pickup } = get();
    if (!pickup) return;
    // Phase 4 — fare freshness: drop the previous quote the moment a fare input
    // changes so readiness re-blocks (CTA → "Getting fare…") and the rider can
    // never confirm a stale price. isSearching keeps the shimmer up meanwhile.
    set({ fareEstimate: null, isSearching: true });
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
          package_type: packageTypeFor(s.tripType),
          duration_hours: s.durationHours,
          car_type: s.carType ?? undefined,
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
    const blocker = bookingBlocker(s);
    if (blocker) throw new Error(BLOCKER_MESSAGE[blocker]);
    const pickup = s.pickup!; // bookingBlocker returns "pickup" when unset, so it's non-null here
    // Stable idempotency key for THIS booking attempt: generated once, reused on a retry, and
    // cleared on success — so a double-tap / network retry replays the first order rather than
    // creating a second one.
    let idemKey = s.bookingIdemKey;
    if (!idemKey) {
      idemKey =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      set({ bookingIdemKey: idemKey });
    }
    const res = await ordersApi.create(
      {
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        pickup_address: pickup.address,
        dropoff_lat: s.dropoff?.lat,
        dropoff_lng: s.dropoff?.lng,
        dropoff_address: s.dropoff?.address,
        stops: s.stops,
        trip_type: s.tripType,
        package_type: packageTypeFor(s.tripType),
        duration_hours: s.durationHours,
        garage_car_id: s.selectedCarId ?? undefined,
        one_time_car: s.oneTimeCar ?? undefined,
        persons_count: s.personsCount,
        promo_code: s.promoCode || undefined,
        d4m_care_opted: s.d4mCare,
        owner_not_in_car: s.ownerNotInCar,
        payment_method: s.paymentMethod,
        scheduled_at: s.scheduledAt ?? undefined,
      },
      idemKey,
    );
    set({ bookingIdemKey: null }); // success — next booking gets a fresh key
    return { order: res.order, otp: res.otp };
  },

  reset: () => set({ ...initial }),
}));
