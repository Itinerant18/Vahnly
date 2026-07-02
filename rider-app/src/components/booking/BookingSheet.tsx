"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { useBookingStore, bookingBlocker, tripNeedsDropoff, TRIP_HINT } from "@/lib/store/bookingStore";
import { useToastStore } from "@/lib/store/useToastStore";
import { friendlyError } from "@/lib/ui/errorMessage";
import { garageApi } from "@/lib/api/garage";
import { cityConfigApi, type TripTypeInfo } from "@/lib/api/cityConfig";
import { searchPlaces, type GeocodeResult } from "@/lib/utils/geocode";
import { QuickTiles } from "./QuickTiles";
import { FareDisplay } from "@/components/ds/FareDisplay";
import { CrossIcon, PinIcon, CarIcon, FlameIcon, CheckIcon } from "@/components/ds/Icon";
import { BorderBeam } from "@/components/ui/border-beam";
import type { CarType, GarageCar, LocationPoint, PaymentMethod, Transmission, TripType } from "@/lib/api/types";

const TRIP_TYPES: { value: TripType; label: string }[] = [
  { value: "IN_CITY_ONE_WAY",  label: "One-Way" },
  { value: "IN_CITY_ROUND",    label: "Round Trip" },
  { value: "IN_CITY_HOURLY",   label: "Hourly" },
  { value: "MINI_OUTSTATION",  label: "Mini Out." },
  { value: "OUTSTATION",       label: "Outstation" },
  { value: "MONTHLY",          label: "Monthly" },
];

// Simple car spec — the only two facts a booking needs about the rider's car:
// transmission routes to capable drivers, class sets the fare tier.
const TRANSMISSIONS: { value: Transmission; label: string }[] = [
  { value: "MANUAL",    label: "Manual" },
  { value: "AUTOMATIC", label: "Automatic" },
];
const CAR_CLASSES: { value: CarType; label: string; seats: number; bags: number }[] = [
  { value: "HATCHBACK", label: "Hatchback", seats: 4, bags: 2 },
  { value: "SEDAN",     label: "Sedan",     seats: 4, bags: 3 },
  { value: "SUV",       label: "SUV",       seats: 6, bags: 4 },
  { value: "PREMIUM",   label: "Premium",   seats: 4, bags: 3 },
];

const HOURLY_BLOCKS = [2, 4, 8, 12];

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH",   label: "Cash" },
  { value: "UPI",    label: "UPI" },
  { value: "CARD",   label: "Card" },
  { value: "WALLET", label: "Wallet" },
];

// ── Scheduling bounds ─────────────────────────────────────────────────────────
// Min lead matches the dispatch sweeper (~40 min); max look-ahead 7 days; 30-min
// slots; any hour of day (24/7).
const SCHEDULE_LEAD_MIN = 40;
const SCHEDULE_MAX_DAYS = 7;
const SLOT_STEP_SEC = 1800; // 30 min

// Operating hours come from city config (GET /api/v1/rider/city-config). These are
// only the fallback defaults when the endpoint or a field is unset.
const DEFAULT_OPEN_HOUR = 6;
const DEFAULT_CLOSE_HOUR = 23;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Keep a chosen time inside operating hours (last start slot 30 min before close). */
function clampToHours(d: Date, openH: number, closeH: number) {
  const h = d.getHours();
  if (h < openH) d.setHours(openH, 0, 0, 0);
  else if (h >= closeH) d.setHours(closeH - 1, 30, 0, 0);
  return d;
}

function fmtHour(h: number) {
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ap}`;
}

/** Format a Date as a `datetime-local` value (local time, no zone suffix). */
function toLocalInput(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** First bookable slot: now + lead, rounded up to the next 30-min boundary. */
function defaultSlot(openH: number, closeH: number) {
  const d = new Date(Date.now() + SCHEDULE_LEAD_MIN * 60_000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 30) * 30); // setMinutes(60) rolls the hour
  return clampToHours(d, openH, closeH);
}

// ── Section reveal — heavy fade-up on first entrance ─────────────────────────
const sectionMotion = (index: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.55, delay: 0.05 * index, ease: [0.22, 1, 0.36, 1] as const },
});

// ── GlassSection — a frosted bento tile. `span` sets its footprint in the
// 6-column bento grid; headers live INSIDE tiles so the grid stays gallery-clean.
function GlassSection({
  index,
  span,
  className = "",
  children,
}: {
  index: number;
  span: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div {...sectionMotion(index)} className={span}>
      <div className={`glass-panel h-full rounded-3xl p-4 ${className}`}>{children}</div>
    </motion.div>
  );
}

// Small in-tile header: icon + label, one consistent family.
function TileHeader({ icon, label }: { icon?: React.ReactNode; label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {icon && <span className="text-content-tertiary">{icon}</span>}
      <span className="text-label-medium font-semibold text-content-primary">{label}</span>
    </div>
  );
}

// ── Shimmer: exact same width as the loaded fare strip ────────────────────────
function FareShimmer() {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1.5">
        <div className="h-6 w-28 animate-pulse rounded-sm bg-surface-neutral" />
        <div className="h-3.5 w-40 animate-pulse rounded-sm bg-surface-neutral" />
      </div>
      <div className="h-5 w-12 animate-pulse rounded-sm bg-surface-neutral" />
    </div>
  );
}

// ── Chip — reusable glass pill selector ───────────────────────────────────────
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex-shrink-0 rounded-pill px-4 py-1.5 text-label-medium cursor-pointer",
        "transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400",
        active
          ? "bg-secondary text-content-inverse shadow-brand-glow"
          : "glass-tile text-content-secondary hover:text-content-primary",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// ── Add-on toggle — hand-tuned glass switch, not a system default ─────────────
function Toggle({ on, onToggle, tone = "positive" }: { on: boolean; onToggle: () => void; tone?: "positive" | "warm" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={[
        "relative h-7 w-12 rounded-pill transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 cursor-pointer",
        "shadow-[inset_0_1px_3px_rgba(15,30,80,0.12)]",
        on
          ? tone === "positive" ? "bg-positive-400" : "bg-warning-400"
          : "bg-background-tertiary",
      ].join(" ")}
    >
      <span
        className={[
          "absolute top-0.5 h-6 w-6 rounded-pill bg-white shadow-elevation-1",
          "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          on ? "translate-x-[22px]" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}

// ── ReviewRow — one label/value line in the confirm sheet ─────────────────────
function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-label-medium text-content-secondary">{label}</span>
      <span className="text-right text-label-medium text-content-primary">{value}</span>
    </div>
  );
}

// ── Car silhouettes — iconic line-art per class, one visual family ────────────
function ClassSilhouette({ type }: { type: CarType }) {
  const common = { stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  switch (type) {
    case "HATCHBACK":
      return (
        <svg width="52" height="26" viewBox="0 0 52 26" aria-hidden="true">
          <path d="M6 18h-2c-1 0-2-1-2-2v-3c0-1 1-2 2.5-2.2L12 9l6-5h13c2 0 4 1 5 2.5L40 11l7 1.5c1.5.3 3 1.5 3 3v1.5c0 1-1 2-2 2h-2" {...common} />
          <circle cx="13" cy="19" r="4" {...common} />
          <circle cx="39" cy="19" r="4" {...common} />
          <path d="M17 19h18" {...common} />
        </svg>
      );
    case "SEDAN":
      return (
        <svg width="52" height="26" viewBox="0 0 52 26" aria-hidden="true">
          <path d="M5 18H3c-1 0-2-1-2-2v-2.5C1 12 2 11 3.5 11L11 10l6-5h14l8 5.5 8 1c1.5.2 3 1.3 3 2.8V16c0 1-1 2-2 2h-2" {...common} />
          <circle cx="13" cy="19" r="4" {...common} />
          <circle cx="40" cy="19" r="4" {...common} />
          <path d="M17 19h19" {...common} />
        </svg>
      );
    case "SUV":
      return (
        <svg width="52" height="28" viewBox="0 0 52 28" aria-hidden="true">
          <path d="M5 20H3c-1 0-2-1-2-2v-5c0-1.5 1-2.5 2.5-2.5H8l4-6h22l6 6h7c1.5 0 3 1 3 2.5V18c0 1-1 2-2 2h-2" {...common} />
          <circle cx="13" cy="21" r="4" {...common} />
          <circle cx="40" cy="21" r="4" {...common} />
          <path d="M17 21h19" {...common} />
          <path d="M22 4v6" {...common} />
        </svg>
      );
    case "PREMIUM":
      return (
        <svg width="52" height="26" viewBox="0 0 52 26" aria-hidden="true">
          <path d="M4 18H3c-1 0-2-1-2-2v-2c0-1.5 1.2-2.4 2.7-2.6L13 10l7-5h13c3 0 6 1.5 7.5 3.5L42 11l6 1c1.6.3 3 1.4 3 3v1c0 1-1 2-2 2h-2" {...common} />
          <circle cx="12" cy="19" r="4" {...common} />
          <circle cx="41" cy="19" r="4" {...common} />
          <path d="M16 19h21" {...common} />
          <path d="M31 8l2 3" {...common} />
        </svg>
      );
  }
}

// ── PlaceInput — debounced Nominatim search with a results dropdown ───────────
function PlaceInput({
  value,
  placeholder,
  icon,
  onSelect,
  onClear,
}: {
  value: string;
  placeholder: string;
  icon: React.ReactNode;
  onSelect: (place: LocationPoint) => void;
  onClear?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);

  // Debounce ~400ms; ignore stale responses if the query changed mid-flight.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      searchPlaces(q).then((r) => {
        if (!cancelled) {
          setResults(r);
          setOpen(true);
        }
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const choose = (r: GeocodeResult) => {
    onSelect({ lat: r.lat, lng: r.lng, address: r.display_name });
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-3 rounded-2xl bg-white/55 px-3 py-2.5 border border-white/70
        transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]
        focus-within:border-border-accent focus-within:bg-white/80 focus-within:shadow-elevation-1 focus-within:scale-[1.01]">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center">{icon}</div>
        <input
          className="flex-1 bg-transparent text-paragraph-medium text-content-primary
            outline-none placeholder:text-content-tertiary"
          placeholder={placeholder}
          value={query || value}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length) setOpen(true); }}
        />
        {(value || query) && onClear && (
          <button
            type="button"
            onClick={() => { onClear(); setQuery(""); setResults([]); setOpen(false); }}
            className="flex min-w-[24px] items-center justify-center text-content-tertiary hover:text-content-primary"
            aria-label="Clear location"
          >
            <CrossIcon size={14} />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-2xl
          border border-border-opaque bg-background-primary shadow-elevation-3">
          {results.map((r, i) => (
            <button
              key={`${r.lat},${r.lng},${i}`}
              type="button"
              onClick={() => choose(r)}
              className="flex w-full items-start gap-2 px-3 py-2.5 text-left min-h-[44px]
                hover:bg-background-secondary transition-base
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            >
              <PinIcon size={14} className="mt-0.5 flex-shrink-0 text-content-tertiary" />
              <span className="text-paragraph-small text-content-primary line-clamp-2">{r.display_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Payment method icons — one line-icon family ───────────────────────────────
function PaymentIcon({ method }: { method: PaymentMethod }) {
  const common = { stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  switch (method) {
    case "CASH":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="2" y="6" width="20" height="12" rx="2" {...common} />
          <circle cx="12" cy="12" r="3" {...common} />
          <path d="M5 9h.01M19 15h.01" {...common} />
        </svg>
      );
    case "UPI":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z" {...common} />
        </svg>
      );
    case "CARD":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="2" y="5" width="20" height="14" rx="2" {...common} />
          <path d="M2 10h20" {...common} />
          <path d="M6 15h4" {...common} />
        </svg>
      );
    case "WALLET":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 7H5a2 2 0 01-2-2 2 2 0 012-2h13v4" {...common} />
          <path d="M3 5v13a2 2 0 002 2h15a1 1 0 001-1V8a1 1 0 00-1-1" {...common} />
          <path d="M17 13h.01" {...common} />
        </svg>
      );
  }
}

// ── Main BookingSheet ─────────────────────────────────────────────────────────
export function BookingSheet() {
  const router = useRouter();
  const [cars, setCars] = useState<GarageCar[]>([]);
  // Half-picked car spec (chip taps) until both halves exist and hit the store.
  const [pickedTransmission, setPickedTransmission] = useState<Transmission | null>(null);
  const [pickedClass, setPickedClass] = useState<CarType | null>(null);
  const [showFareModal, setShowFareModal] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showD4mInfo, setShowD4mInfo] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [promoStatus, setPromoStatus] = useState<"idle" | "ok" | "err">("idle");
  const [bookingState, setBookingState] = useState<"idle" | "loading">("idle");
  const [bookingError, setBookingError] = useState<string | null>(null);

  // City config drives the picker's hours + which tiers are offered. Defaults hold
  // until the fetch resolves, and on any failure.
  const [openH, setOpenH] = useState(DEFAULT_OPEN_HOUR);
  const [closeH, setCloseH] = useState(DEFAULT_CLOSE_HOUR);
  const [allowedTiers, setAllowedTiers] = useState<string[]>([]);
  // Server trip-type catalog (label + hint per city). Empty until fetched or on
  // older backends — local TRIP_TYPES/TRIP_HINT are the fallback.
  const [tripCatalog, setTripCatalog] = useState<TripTypeInfo[]>([]);

  const {
    pickup, dropoff, tripType, durationHours, personsCount, d4mCare, ownerNotInCar,
    promoCode, paymentMethod, fareEstimate, isSearching, scheduledAt,
    setPickup, setDropoff, setTripType, setDurationHours, setPersonsCount,
    setScheduledAt, setD4mCare, setOwnerNotInCar, setPromoCode, setPaymentMethod,
    validatePromo, bookDriver, selectedCarId, oneTimeCar, setSelectedCar, setOneTimeCar,
  } = useBookingStore();

  // Fetch garage cars (single call, pick default car from result)
  useEffect(() => {
    garageApi.list().then((list) => {
      setCars(list);
      const def = list.find((c) => c.is_default);
      if (def && !selectedCarId) setSelectedCar(def.id, def.car_type);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // City config (operating hours + supported tiers). Falls back to defaults on error.
  useEffect(() => {
    cityConfigApi.get().then((c) => {
      const oh = parseInt((c.operating_hours_start ?? "").split(":")[0], 10);
      const ch = parseInt((c.operating_hours_end ?? "").split(":")[0], 10);
      if (Number.isFinite(oh)) setOpenH(oh);
      if (Number.isFinite(ch)) setCloseH(ch);
      setAllowedTiers(c.supported_trip_types ?? []);
      setTripCatalog(c.trip_types ?? []);
    }).catch(() => { /* keep defaults */ });
  }, []);

  // Only offer tiers the city supports. Prefer the server catalog (already
  // city-filtered, carries per-city labels); fall back to the local list.
  const tripTypes = tripCatalog.length
    ? tripCatalog.map((t) => ({ value: t.value, label: t.label }))
    : allowedTiers.length
      ? TRIP_TYPES.filter((t) => allowedTiers.includes(t.value))
      : TRIP_TYPES;
  const tripHint = tripCatalog.find((t) => t.value === tripType)?.hint ?? TRIP_HINT[tripType];

  const selectedCar = cars.find((c) => c.id === selectedCarId);

  // ── Car spec picker ──────────────────────────────────────────────────────────
  // Booking needs only transmission + class. A garage default (auto-picked above)
  // prefills both and books as a garage car; tapping any control switches to a
  // one-time spec. The store is only written once BOTH halves are known, so the
  // "car" blocker stays up until the spec is complete.
  const specTransmission: Transmission | null =
    oneTimeCar?.transmission ?? selectedCar?.transmission ?? pickedTransmission;
  const specClass: CarType | null =
    oneTimeCar?.car_type ?? selectedCar?.car_type ?? pickedClass;

  const chooseTransmission = (t: Transmission) => {
    setPickedTransmission(t);
    if (specClass) setOneTimeCar({ car_type: specClass, transmission: t });
  };
  const chooseClass = (c: CarType) => {
    setPickedClass(c);
    if (specTransmission) setOneTimeCar({ car_type: c, transmission: specTransmission });
  };

  const needsDuration =
    tripType === "IN_CITY_ROUND" || tripType === "OUTSTATION" ||
    tripType === "MINI_OUTSTATION" || tripType === "IN_CITY_HOURLY";
  // Time-based tiers (round trip, hourly, monthly) don't take a destination.
  const needsDrop = tripNeedsDropoff(tripType);
  // Monthly/permanent is estimate-only until recurring billing lands (backend blocks it).
  const isMonthly = tripType === "MONTHLY";

  // First unmet requirement blocking dispatch (null = ready). Drives the CTA's
  // disabled state and label so a rider can't book on a pickup pin alone.
  const blocker = bookingBlocker({ pickup, dropoff, tripType, selectedCarId, oneTimeCar, fareEstimate });
  // CTA label names the next step so the button guides the rider to completion.
  const ctaLabel = isMonthly
    ? "Monthly — coming soon"
    : blocker === "pickup" ? "Set pickup location"
    : blocker === "dropoff" ? "Add drop-off"
    : blocker === "car" ? "Choose your car"
    : blocker === "fare" ? "Getting fare…"
    : "Confirm Booking";

  // Swap pickup and drop — both must render for point-to-point trips.
  const swapEnds = () => {
    const p = pickup;
    setPickup(dropoff);
    setDropoff(p);
  };

  // ── Promo ──────────────────────────────────────────────────────────────────
  const applyPromo = async () => {
    setPromoCode(promoInput);
    try {
      await validatePromo();
      setPromoStatus("ok");
    } catch {
      setPromoStatus("err");
    }
  };

  // ── Book ───────────────────────────────────────────────────────────────────
  // Tapping the CTA opens a review sheet — it does NOT dispatch. Booking only
  // happens from the explicit confirm inside the review (Phase 3).
  const openReview = () => {
    if (blocker) return;
    setBookingError(null);
    setShowReview(true);
  };

  const confirmBooking = async () => {
    if (blocker) return;
    setBookingError(null);
    setBookingState("loading");
    try {
      const { order } = await bookDriver();
      router.push(`/dispatch?orderId=${order.id}`);
    } catch (e) {
      setBookingError(e instanceof Error ? e.message : "Booking failed. Please try again.");
      useToastStore.getState().show(friendlyError(e), "error");
      setBookingState("idle");
      setShowReview(false);
    }
  };

  const fareBreakdown = fareEstimate?.fare_breakdown;

  // Small breakdown chips under the headline fare — light, secondary.
  const breakdownChips = fareBreakdown
    ? [
        { label: "Base",     paise: fareBreakdown.base_fare_paise },
        { label: "Distance", paise: fareBreakdown.distance_charge_paise },
        { label: "Night",    paise: fareBreakdown.night_charge_paise },
        { label: "Care",     paise: fareBreakdown.d4m_care_paise },
      ].filter((c) => Number(c.paise) > 0)
    : [];

  return (
    <>
      {/* Bottom padding clears the floating tubelight navbar (+ device safe area). */}
      <div className="relative pb-[calc(8rem+env(safe-area-inset-bottom,0px))]">
        {/* Handle — hints the sheet layering over the map */}
        <div className="flex justify-center pb-1 pt-3">
          <div className="h-1 w-10 rounded-pill bg-secondary/25 shadow-brand-glow" />
        </div>

        {/* Quick tiles */}
        <QuickTiles />

        {/* Bento grid — 6 columns, tiles claim varied footprints for rhythm */}
        <div className="mx-4 grid grid-cols-6 gap-3 pt-1">
          {/* [1] Trip type selector — one of the brand moments, panel-free */}
          <motion.div {...sectionMotion(0)} className="col-span-6">
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {tripTypes.map((t) => {
                const disabled = t.value === "MONTHLY";
                const active = tripType === t.value;
                return (
                  <div key={t.value} className="relative flex-shrink-0">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setTripType(t.value)}
                      className={[
                        "relative rounded-pill px-4 py-2 text-label-medium cursor-pointer",
                        "transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-95",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400",
                        active
                          ? "text-content-inverse font-semibold scale-[1.04]"
                          : "glass-tile text-content-secondary hover:text-content-primary",
                        disabled && "opacity-40 cursor-not-allowed",
                      ].join(" ")}
                    >
                      {active && (
                        <motion.span
                          layoutId="trip-aura"
                          transition={{ type: "spring", stiffness: 320, damping: 30 }}
                          className="absolute inset-0 rounded-pill bg-gradient-to-r from-secondary to-secondary-3 shadow-brand-glow"
                          aria-hidden="true"
                        />
                      )}
                      <span className="relative">{t.label}</span>
                    </button>
                    {disabled && (
                      <span className="badge-shimmer absolute -right-1 -top-1 rounded-full bg-surface-warning px-1.5 py-0.5 text-[9px] font-semibold text-content-warning leading-none">
                        Soon
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Context hint: what the selected trip type means. */}
            <p className="mt-2 px-1 text-label-small text-content-positive" aria-live="polite">
              {tripHint}
            </p>
          </motion.div>

          {/* [2] Trip details — fields morph per trip type, container stays */}
          <GlassSection index={1} span="col-span-6">
            <TileHeader
              label="Route"
              icon={<PinIcon size={14} />}
            />
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={isMonthly ? "monthly" : needsDrop ? "route" : "pickup-only"}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              >
                {isMonthly ? (
                  <div className="py-4 text-center">
                    <p className="text-label-medium text-content-primary">Monthly driver plans are launching soon</p>
                    <p className="mt-1 text-paragraph-small text-content-secondary">
                      A dedicated driver for your daily routine — long-term plans arrive shortly.
                    </p>
                  </div>
                ) : (
                  <div className="relative space-y-2.5">
                    <PlaceInput
                      value={pickup?.address ?? ""}
                      placeholder="Pickup location"
                      icon={<div className="h-3 w-3 rounded-pill bg-secondary" />}
                      onSelect={setPickup}
                      onClear={() => setPickup(null)}
                    />
                    {needsDrop && (
                      <>
                        {/* Route connector — dotted line from pickup dot to drop pin */}
                        <div className="pointer-events-none absolute left-[25px] top-[44px] h-[26px] border-l-2 border-dotted border-secondary/35" aria-hidden="true" />
                        <PlaceInput
                          value={dropoff?.address ?? ""}
                          placeholder="Where to?"
                          icon={<PinIcon size={15} className="text-secondary-3" />}
                          onSelect={setDropoff}
                          onClear={() => setDropoff(null)}
                        />
                        {/* Swap ends */}
                        <button
                          type="button"
                          onClick={swapEnds}
                          aria-label="Swap pickup and drop"
                          className="glass-tile absolute right-2 top-[38px] z-10 flex h-9 w-9 items-center justify-center rounded-full
                            text-content-secondary transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]
                            active:scale-90 active:rotate-180 cursor-pointer
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                            <path d="M7 4v13M7 4L4 7M7 4l3 3M17 20V7m0 13l3-3m-3 3l-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* When — Now / Schedule chips */}
            {!isMonthly && (
              <div className="mt-4 flex items-center gap-2 border-t border-white/60 pt-3">
                <span className="text-label-small text-content-secondary">When</span>
                <Chip active={!scheduledAt} onClick={() => setScheduledAt(null)}>Now</Chip>
                <Chip
                  active={!!scheduledAt}
                  onClick={() => setScheduledAt(defaultSlot(openH, closeH).toISOString())}
                >
                  Schedule
                </Chip>
              </div>
            )}
            {scheduledAt && !isMonthly && (
              <div className="mt-3">
                <label htmlFor="schedule-at" className="mb-1 block text-label-small text-content-secondary">
                  Pickup date &amp; time
                </label>
                <input
                  id="schedule-at"
                  type="datetime-local"
                  step={SLOT_STEP_SEC}
                  min={toLocalInput(new Date(Date.now() + SCHEDULE_LEAD_MIN * 60_000))}
                  max={toLocalInput(new Date(Date.now() + SCHEDULE_MAX_DAYS * 86_400_000))}
                  value={toLocalInput(new Date(scheduledAt))}
                  onChange={(e) => { if (e.target.value) setScheduledAt(clampToHours(new Date(e.target.value), openH, closeH).toISOString()); }}
                  className="w-full h-11 rounded-2xl border border-white/70 bg-white/55
                    px-3 text-paragraph-medium text-content-primary outline-none transition-base
                    focus:border-border-accent focus:ring-2 focus:ring-accent-400"
                />
                <p className="mt-1 text-label-small text-content-secondary">
                  Driver arrives for{" "}
                  <span className="text-content-primary">
                    {new Date(scheduledAt).toLocaleString("en-IN", {
                      weekday: "short", day: "numeric", month: "short",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                  . Bookable {fmtHour(openH)} to {fmtHour(closeH)}, from 40 min ahead up to 7 days.
                </p>
              </div>
            )}

            {/* Duration — hourly gets block chips; longer trips keep the slider */}
            {needsDuration && !isMonthly && (
              tripType === "IN_CITY_HOURLY" ? (
                <div className="mt-4 border-t border-white/60 pt-3">
                  <div className="flex items-center gap-2">
                    <span className="text-label-small text-content-secondary">Duration</span>
                    {HOURLY_BLOCKS.map((h) => (
                      <Chip key={h} active={durationHours === h} onClick={() => setDurationHours(h)}>
                        {h}h
                      </Chip>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-2 border-t border-white/60 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-label-small text-content-secondary">Duration</span>
                    <span className="font-mono text-mono-medium text-content-primary tabular-nums">
                      {durationHours != null ? durationHours : 4}h
                    </span>
                  </div>
                  <div className="relative h-2 rounded-pill bg-background-tertiary">
                    <div
                      className="absolute left-0 top-0 h-full rounded-pill bg-gradient-to-r from-secondary to-secondary-3 transition-all"
                      style={{ width: `${(((durationHours ?? 4) - 1) / 11) * 100}%` }}
                    />
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={12}
                    step={1}
                    value={durationHours ?? 4}
                    onChange={(e) => setDurationHours(Number(e.target.value))}
                    className="absolute inset-0 w-full opacity-0 cursor-pointer h-2"
                    aria-label="Trip duration in hours"
                    style={{ marginTop: '-8px', position: 'relative' }}
                  />
                  <div className="flex justify-between text-label-small text-content-secondary">
                    <span>1h</span>
                    <span>12h</span>
                  </div>
                </div>
              )
            )}
          </GlassSection>

          {/* [3] Car preference — segmented transmission + class carousel */}
          <GlassSection index={2} span="col-span-6">
            <TileHeader label="Your car" icon={<CarIcon size={15} />} />
            {/* Transmission — luxury segmented control with a gliding thumb */}
            <div className="relative flex rounded-pill bg-white/50 p-1 border border-white/70 shadow-[inset_0_1px_3px_rgba(15,30,80,0.06)]">
              {TRANSMISSIONS.map((t) => {
                const active = specTransmission === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => chooseTransmission(t.value)}
                    className={[
                      "relative flex-1 rounded-pill py-2.5 text-label-medium cursor-pointer",
                      "transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400",
                      active ? "text-content-inverse font-semibold" : "text-content-secondary hover:text-content-primary",
                    ].join(" ")}
                  >
                    {active && (
                      <motion.span
                        layoutId="trans-thumb"
                        transition={{ type: "spring", stiffness: 360, damping: 32 }}
                        className="absolute inset-0 rounded-pill bg-gradient-to-r from-secondary to-secondary-2 shadow-brand-glow"
                        aria-hidden="true"
                      />
                    )}
                    <span className="relative">{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Car class — horizontal snap carousel of silhouette cards */}
            <div
              key={specTransmission ?? "none"}
              className="mt-3 flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-1 scrollbar-none"
            >
              {CAR_CLASSES.map((c, i) => {
                const active = specClass === c.value;
                return (
                  <motion.button
                    key={c.value}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: 0.04 * i, ease: [0.22, 1, 0.36, 1] }}
                    type="button"
                    onClick={() => chooseClass(c.value)}
                    className={[
                      "min-w-[118px] flex-shrink-0 snap-start rounded-2xl px-3 py-3 text-left cursor-pointer",
                      "transition-all duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.97]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400",
                      active
                        ? "bg-white/85 border-2 border-secondary shadow-brand-glow -translate-y-0.5"
                        : "glass-tile border border-white/65 opacity-85 hover:opacity-100",
                    ].join(" ")}
                    aria-pressed={active}
                    aria-label={c.label}
                  >
                    <span className={active ? "text-secondary" : "text-content-tertiary"}>
                      <ClassSilhouette type={c.value} />
                    </span>
                    <span className="mt-1.5 block text-label-medium text-content-primary">{c.label}</span>
                    <span className="mt-0.5 block text-label-small text-content-secondary">
                      {c.seats} seats · {c.bags} bags
                    </span>
                  </motion.button>
                );
              })}
            </div>

            {selectedCar && (
              <p className="mt-3 text-label-small text-content-secondary">
                Booking with your {selectedCar.make} {selectedCar.model} ({selectedCar.registration_plate})
              </p>
            )}
          </GlassSection>

          {/* [4] Fare estimate + promo — the commercial hero tile */}
          <GlassSection
            index={3}
            span="col-span-6"
            className="border-2 border-secondary/15 bg-white/70"
          >
            <TileHeader label="Estimated fare" />
            {isSearching && !fareEstimate ? (
              <FareShimmer />
            ) : fareEstimate ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="relative space-y-2 overflow-hidden rounded-xl"
              >
                <BorderBeam size={60} duration={8} colorFrom="#1a5cff" colorTo="rgba(26,92,255,0.05)" borderWidth={1} delay={0.5} />
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <FareDisplay amount={fareBreakdown?.estimated_total_paise ?? 0} size="lg" />
                      {fareEstimate.surge_active && (
                        <span className="inline-flex items-center gap-1 rounded-sm bg-surface-negative px-2 py-0.5 text-label-small text-content-negative">
                          <FlameIcon size={11} className="text-content-negative" />
                          {fareBreakdown?.surge_multiplier?.toFixed(1)}× surge
                        </span>
                      )}
                    </div>
                    <p className="text-paragraph-small text-content-secondary mt-0.5">
                      {fareEstimate.driver_availability} availability · ~{fareEstimate.estimated_pickup_eta_minutes} min pickup
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowFareModal(true)}
                    className="text-label-small text-content-accent hover:opacity-80
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
                  >
                    Breakdown →
                  </button>
                </div>
                {breakdownChips.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {breakdownChips.map((c) => (
                      <span key={c.label} className="rounded-pill bg-white/60 border border-white/70 px-2 py-0.5 text-label-small text-content-secondary">
                        {c.label} <FareDisplay amount={Number(c.paise)} size="sm" />
                      </span>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : (
              <p className="text-paragraph-small text-content-tertiary">
                Set your route and car to see the fare
              </p>
            )}

            {/* Promo code */}
            <div className="mt-4 flex items-center gap-2 border-t border-white/60 pt-3">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
                <path d="M7 7h.01M17 17h.01M3 12l9-9 9 9-9 9-9-9z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-content-tertiary" />
              </svg>
              <input
                className="flex-1 bg-transparent text-paragraph-medium text-content-primary
                  outline-none placeholder:text-content-tertiary"
                placeholder="Enter promo code"
                value={promoInput}
                onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromoStatus("idle"); }}
              />
              {promoStatus === "ok" && (
                <motion.span
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  className="flex items-center text-content-positive"
                  aria-label="Promo applied"
                >
                  <CheckIcon size={16} />
                </motion.span>
              )}
              {promoStatus === "err" && (
                <span className="text-content-negative text-label-small" role="status">Invalid</span>
              )}
              <button
                type="button"
                onClick={applyPromo}
                disabled={!promoInput}
                className="glass-tile rounded-pill px-3 py-1.5 text-label-small text-content-accent font-medium
                  disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed
                  transition-transform duration-200 active:scale-95
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
              >
                Apply
              </button>
            </div>
            {promoStatus === "ok" && fareEstimate?.fare_breakdown.promo_discount_paise ? (
              <p className="mt-1.5 text-label-small text-content-positive">
                <FareDisplay amount={fareEstimate.fare_breakdown.promo_discount_paise} size="sm" /> saved
              </p>
            ) : null}
            {promoStatus === "err" && (
              <p className="mt-1.5 text-label-small text-content-negative">Invalid or expired code</p>
            )}
          </GlassSection>

          {/* [5a] D4M Care — square bento tile */}
          <GlassSection
            index={4}
            span="col-span-3"
            className={d4mCare ? "bg-positive-50/70 shadow-[0_0_20px_rgba(58,157,104,0.14)] transition-all duration-300" : "transition-all duration-300"}
          >
            <div className="flex h-full flex-col">
              <div className="flex items-start justify-between">
                <motion.span
                  animate={d4mCare ? { scale: [1, 1.15, 1] } : { scale: 1 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  className={["flex h-7 w-7 items-center justify-center", d4mCare ? "text-content-positive" : "text-content-accent"].join(" ")}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 3l7 3v5c0 4.4-3 7.4-7 8.5-4-1.1-7-4.1-7-8.5V6l7-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </motion.span>
                <button
                  type="button"
                  onClick={() => setShowD4mInfo(true)}
                  className="text-content-tertiary hover:text-content-secondary min-w-[24px] min-h-[24px] flex items-center justify-center
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 rounded-pill"
                  aria-label="D4M Care info"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M12 16v-4M12 8h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <span className="mt-2 text-label-medium font-semibold text-content-primary">D4M Care</span>
              <p className="text-label-small text-content-secondary">₹49 — Insurance + support</p>
              <div className="mt-auto pt-3">
                <Toggle on={d4mCare} onToggle={() => setD4mCare(!d4mCare)} />
              </div>
            </div>
          </GlassSection>

          {/* [5b] Owner not in car — square bento tile, warmer cue */}
          <GlassSection
            index={4}
            span="col-span-3"
            className={ownerNotInCar ? "bg-warning-50/70 transition-all duration-300" : "transition-all duration-300"}
          >
            <div className="flex h-full flex-col">
              <span className="flex h-7 w-7 items-center justify-center text-content-secondary">
                <CarIcon size={22} />
              </span>
              <span className="mt-2 text-label-medium font-semibold text-content-primary">I won&apos;t be in the car</span>
              <p className="text-label-small text-content-secondary">Driver takes the car without me</p>
              <AnimatePresence>
                {ownerNotInCar && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="mt-1 overflow-hidden text-label-small text-content-warning"
                  >
                    Verified driver · GPS-tracked end to end.
                  </motion.p>
                )}
              </AnimatePresence>
              <div className="mt-auto pt-3">
                <Toggle on={ownerNotInCar} onToggle={() => setOwnerNotInCar(!ownerNotInCar)} tone="warm" />
              </div>
            </div>
          </GlassSection>

          {/* [6a] Payment — 2×2 method grid */}
          <GlassSection index={5} span="col-span-4">
            <TileHeader label="Payment" />
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map((pm) => {
                const active = paymentMethod === pm.value;
                return (
                  <button
                    key={pm.value}
                    type="button"
                    onClick={() => setPaymentMethod(pm.value)}
                    aria-pressed={active}
                    className={[
                      "relative flex flex-col items-center gap-1 rounded-2xl py-2.5 cursor-pointer",
                      "transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-95",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400",
                      active
                        ? "bg-white/85 border-2 border-secondary shadow-brand-glow"
                        : "glass-tile border border-white/65",
                    ].join(" ")}
                  >
                    <span className={active ? "text-secondary" : "text-content-tertiary"}>
                      <PaymentIcon method={pm.value} />
                    </span>
                    <span className="text-label-small text-content-primary">{pm.label}</span>
                    {active && (
                      <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-white">
                        <CheckIcon size={11} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </GlassSection>

          {/* [6b] Persons — compact bento tile */}
          <GlassSection index={5} span="col-span-2">
            <div className="flex h-full flex-col items-center">
              <span className="text-label-medium font-semibold text-content-primary">Persons</span>
              <span className="my-auto font-mono text-heading-medium text-content-primary tabular-nums">
                {personsCount}
              </span>
              <div className="flex gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setPersonsCount(personsCount - 1)}
                  disabled={personsCount <= 1}
                  aria-label="Decrease persons"
                  className="glass-tile flex h-10 w-10 items-center justify-center rounded-xl
                    text-label-large text-content-primary
                    disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed
                    transition-transform duration-200 active:scale-90
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => setPersonsCount(personsCount + 1)}
                  disabled={personsCount >= 8}
                  aria-label="Increase persons"
                  className="glass-tile flex h-10 w-10 items-center justify-center rounded-xl
                    text-label-large text-content-primary
                    disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed
                    transition-transform duration-200 active:scale-90
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
                >
                  +
                </button>
              </div>
            </div>
          </GlassSection>

          {/* [7] Hero confirm CTA */}
          <motion.div {...sectionMotion(6)} className="col-span-6 pt-2">
            {bookingError && (
              <p role="alert" className="mb-2 text-label-small text-content-negative">
                {bookingError}
              </p>
            )}
            <button
              type="button"
              disabled={!!blocker || isMonthly || bookingState === "loading"}
              onClick={openReview}
              aria-live="polite"
              className="cta-sheen h-16 w-full rounded-pill text-label-large font-semibold text-content-inverse cursor-pointer
                bg-gradient-to-r from-secondary via-secondary-2 to-secondary-3
                shadow-brand-glow
                transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98]
                disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2"
            >
              {bookingState === "loading" ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
                  </svg>
                  Finding drivers…
                </span>
              ) : (
                <span>{ctaLabel}</span>
              )}
            </button>
          </motion.div>
        </div>
      </div>

      {/* ── Review & confirm sheet (Phase 3) ───────────────────────────────── */}
      {showReview && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60"
          onClick={() => setShowReview(false)}
          onKeyDown={(e) => { if (e.key === "Escape") setShowReview(false); }}
          role="dialog"
          aria-modal="true"
          aria-label="Review booking"
        >
          <div
            className="rounded-t-[2rem] bg-background-primary/95 backdrop-blur-xl p-4 shadow-elevation-3 animate-spring-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-pill bg-border-opaque/60" />
            <h3 className="mb-4 text-heading-medium text-content-primary">Review &amp; confirm</h3>
            <div className="space-y-3">
              <ReviewRow label="Pickup" value={pickup?.address ?? "—"} />
              {(needsDrop || dropoff) && <ReviewRow label="Drop-off" value={dropoff?.address ?? "—"} />}
              <ReviewRow label="Trip" value={TRIP_TYPES.find((t) => t.value === tripType)?.label ?? tripType} />
              <ReviewRow
                label="Car"
                value={
                  selectedCar
                    ? `${selectedCar.make} ${selectedCar.model} · ${selectedCar.registration_plate}`
                    : oneTimeCar
                      ? `${CAR_CLASSES.find((c) => c.value === oneTimeCar.car_type)?.label ?? oneTimeCar.car_type} · ${TRANSMISSIONS.find((t) => t.value === oneTimeCar.transmission)?.label ?? oneTimeCar.transmission}`
                      : "—"
                }
              />
              <ReviewRow label="Payment" value={PAYMENT_METHODS.find((p) => p.value === paymentMethod)?.label ?? paymentMethod} />
              <ReviewRow label="When" value={scheduledAt ? new Date(scheduledAt).toLocaleString() : "Now"} />
              <div className="flex items-center justify-between border-t border-border-opaque pt-3">
                <span className="text-label-medium text-content-secondary">Estimated fare</span>
                <FareDisplay amount={fareBreakdown?.estimated_total_paise ?? 0} size="lg" />
              </div>
            </div>
            {bookingError && (
              <p role="alert" className="mt-3 text-label-small text-content-negative">{bookingError}</p>
            )}
            <button
              type="button"
              onClick={confirmBooking}
              disabled={bookingState === "loading"}
              className="mt-4 h-14 w-full rounded-pill bg-gradient-to-r from-secondary to-secondary-3 text-content-inverse text-label-large font-semibold
                cursor-pointer transition-transform active:scale-[0.99] shadow-brand-glow
                disabled:opacity-50 disabled:cursor-not-allowed
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2"
            >
              {bookingState === "loading" ? "Finding drivers…" : "Book Driver"}
            </button>
            <button
              type="button"
              onClick={() => setShowReview(false)}
              className="mt-2 h-11 w-full rounded-pill text-label-medium text-content-secondary hover:text-content-primary cursor-pointer"
            >
              Back
            </button>
            <div className="h-2" />
          </div>
        </div>
      )}

      {/* ── Fare breakdown modal ───────────────────────────────────────────── */}
      {showFareModal && fareBreakdown && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60"
          onClick={() => setShowFareModal(false)}
          onKeyDown={(e) => { if (e.key === "Escape") setShowFareModal(false); }}
          role="dialog"
          aria-modal="true"
          aria-label="Fare breakdown"
        >
          <div
            className="rounded-t-[2rem] bg-background-primary/95 backdrop-blur-xl p-4 shadow-elevation-3 animate-spring-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-pill bg-border-opaque/60" />
            <h3 className="mb-4 text-heading-medium text-content-primary">Fare breakdown</h3>
            <div className="space-y-3">
              {[
                { label: "Base fare",        paise: fareBreakdown.base_fare_paise },
                { label: "Distance charge",  paise: fareBreakdown.distance_charge_paise },
                { label: "Night charge",     paise: fareBreakdown.night_charge_paise },
                { label: "D4M Care",         paise: fareBreakdown.d4m_care_paise },
                { label: "Promo discount",   paise: -fareBreakdown.promo_discount_paise },
              ].map(({ label, paise }) =>
                Number(paise) !== 0 ? (
                  <div key={label} className="flex justify-between">
                    <span className="text-paragraph-medium text-content-secondary">{label}</span>
                    <span className={Number(paise) < 0 ? "text-content-positive" : ""}>
                      {Number(paise) < 0 && "−"}
                      <FareDisplay
                        amount={Math.abs(Number(paise))}
                        size="sm"
                        className={Number(paise) < 0 ? "text-content-positive" : ""}
                      />
                    </span>
                  </div>
                ) : null
              )}
              {fareBreakdown.surge_multiplier > 1 && (
                <div className="flex justify-between">
                  <span className="text-paragraph-medium text-content-secondary">Surge</span>
                  <span className="font-mono text-mono-small text-content-negative tabular-nums">
                    {fareBreakdown.surge_multiplier.toFixed(1)}×
                  </span>
                </div>
              )}
              <div className="border-t border-border-opaque pt-3 flex justify-between items-center">
                <span className="text-heading-small text-content-primary font-medium">Total</span>
                <FareDisplay amount={fareBreakdown.estimated_total_paise} size="md" className="text-content-primary" />
              </div>
            </div>
            <div className="h-6" />
          </div>
        </div>
      )}

      {/* ── D4M Info modal ─────────────────────────────────────────────────── */}
      {showD4mInfo && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60"
          onClick={() => setShowD4mInfo(false)}
          onKeyDown={(e) => { if (e.key === "Escape") setShowD4mInfo(false); }}
          role="dialog"
          aria-modal="true"
          aria-label="D4M Care information"
        >
          <div
            className="rounded-t-[2rem] bg-background-primary/95 backdrop-blur-xl p-4 shadow-elevation-3 animate-spring-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-pill bg-border-opaque/60" />
            <h3 className="mb-2 text-heading-small text-content-primary">D4M Care — ₹49/trip</h3>
            <p className="text-paragraph-medium text-content-secondary">
              D4M Care provides accident insurance coverage during your trip — up to ₹1 lakh
              for medical expenses, ₹5 lakh personal accident cover, and zero-liability protection
              for your vehicle. Highly recommended for outstation trips.
            </p>
            <button
              type="button"
              onClick={() => setShowD4mInfo(false)}
              className="mt-5 w-full h-11 rounded-pill glass-tile
                text-label-medium text-content-primary cursor-pointer
                transition-transform duration-200 active:scale-[0.98]
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            >
              Got it
            </button>
            <div className="h-4" />
          </div>
        </div>
      )}
    </>
  );
}
