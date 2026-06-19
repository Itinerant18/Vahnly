"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useBookingStore } from "@/lib/store/bookingStore";
import { garageApi } from "@/lib/api/garage";
import { cityConfigApi } from "@/lib/api/cityConfig";
import { searchPlaces, type GeocodeResult } from "@/lib/utils/geocode";
import { QuickTiles } from "./QuickTiles";
import { FareDisplay } from "@/components/ds/FareDisplay";
import type { GarageCar, LocationPoint, PaymentMethod, TripType } from "@/lib/api/types";

const TRIP_TYPES: { value: TripType; label: string }[] = [
  { value: "IN_CITY_ONE_WAY",  label: "One-Way" },
  { value: "IN_CITY_ROUND",    label: "Round Trip" },
  { value: "IN_CITY_HOURLY",   label: "Hourly" },
  { value: "MINI_OUTSTATION",  label: "Mini Out." },
  { value: "OUTSTATION",       label: "Outstation" },
  { value: "MONTHLY",          label: "Monthly" },
];

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

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-border-opaque px-4 py-3">
      {children}
    </div>
  );
}

// ── Shimmer: exact same width as the loaded fare strip ────────────────────────
function FareShimmer() {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1.5">
        <div className="h-6 w-28 animate-pulse rounded-sm bg-gray-100" />
        <div className="h-3.5 w-40 animate-pulse rounded-sm bg-gray-100" />
      </div>
      <div className="h-5 w-12 animate-pulse rounded-sm bg-gray-100" />
    </div>
  );
}

// ── Chip — reusable pill-shape selector chip ──────────────────────────────────
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
        "flex-shrink-0 rounded-pill px-4 py-1.5 text-label-medium transition-base cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400",
        active
          ? "bg-background-inverse text-content-inverse"
          : "bg-background-secondary text-content-secondary border border-border-opaque hover:text-content-primary",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// ── D4M Toggle ────────────────────────────────────────────────────────────────
function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={[
        "relative h-6 w-11 rounded-pill transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 cursor-pointer",
        on ? "bg-positive-400" : "bg-background-tertiary",
      ].join(" ")}
    >
      <span
        className={[
          "absolute top-0.5 h-5 w-5 rounded-pill bg-background-primary shadow-elevation-1 border-2 border-white transition-transform duration-200",
          on ? "translate-x-5" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
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
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center">{icon}</div>
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-sm
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="mt-0.5 flex-shrink-0">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" fill="currentColor" className="text-content-tertiary" />
              </svg>
              <span className="text-paragraph-small text-content-primary line-clamp-2">{r.display_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main BookingSheet ─────────────────────────────────────────────────────────
type Snap = "peek" | "half" | "full";

export function BookingSheet() {
  const router = useRouter();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [snapPoint, setSnapPoint] = useState<Snap>("peek");
  const dragStartY = useRef(0);
  const dragStartPx = useRef(0);
  const isDragging = useRef(false);
  const [dragPx, setDragPx] = useState<number | null>(null);
  const [cars, setCars] = useState<GarageCar[]>([]);
  const [showCarPicker, setShowCarPicker] = useState(false);
  const [showFareModal, setShowFareModal] = useState(false);
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

  const {
    pickup, dropoff, tripType, durationHours, personsCount, d4mCare, ownerNotInCar,
    promoCode, paymentMethod, fareEstimate, isSearching, scheduledAt,
    setPickup, setDropoff, setTripType, setDurationHours, setPersonsCount,
    setScheduledAt, setD4mCare, setOwnerNotInCar, setPromoCode, setPaymentMethod,
    validatePromo, bookDriver, selectedCarId, setSelectedCar,
  } = useBookingStore();

  // Fetch garage cars
  useEffect(() => {
    garageApi.list().then(setCars).catch(() => {});
    garageApi.list().then((list) => {
      const def = list.find((c) => c.is_default);
      if (def && !selectedCarId) setSelectedCar(def.id);
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
    }).catch(() => { /* keep defaults */ });
  }, []);

  // Only offer tiers the city supports; empty list = all tiers.
  const tripTypes = allowedTiers.length
    ? TRIP_TYPES.filter((t) => allowedTiers.includes(t.value))
    : TRIP_TYPES;

  const selectedCar = cars.find((c) => c.id === selectedCarId);
  const needsDuration =
    tripType === "IN_CITY_ROUND" || tripType === "OUTSTATION" ||
    tripType === "MINI_OUTSTATION" || tripType === "IN_CITY_HOURLY";
  // Time-based tiers (round trip, hourly, monthly) don't take a destination.
  const needsDrop =
    tripType === "IN_CITY_ONE_WAY" || tripType === "MINI_OUTSTATION" || tripType === "OUTSTATION";
  // Monthly/permanent is estimate-only until recurring billing lands (backend blocks it).
  const isMonthly = tripType === "MONTHLY";

  // ── Drag/snap logic (3 snaps: peek ~120px, half ~55%, full ~92%) ─────────────
  // Values are "px from the top of the viewport" where the sheet's top edge sits.
  // Smaller = sheet pulled further up / more content visible.
  const getSnapPx = useCallback(() => {
    const h = sheetRef.current?.offsetHeight ?? (typeof window !== "undefined" ? window.innerHeight : 800);
    return {
      peek: h - 120,            // ~120px visible
      half: Math.round(h * 0.45), // ~55% height visible
      full: Math.round(h * 0.08), // ~92% height visible
    };
  }, []);

  const onTouchStart = (e: React.TouchEvent) => {
    const snap = getSnapPx();
    dragStartY.current = e.touches[0].clientY;
    dragStartPx.current = snap[snapPoint];
    isDragging.current = true;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const delta = e.touches[0].clientY - dragStartY.current;
    const snap = getSnapPx();
    const clamped = Math.max(snap.full, Math.min(snap.peek, dragStartPx.current + delta));
    setDragPx(clamped);
  };

  const onTouchEnd = () => {
    isDragging.current = false;
    if (dragPx !== null) {
      const snap = getSnapPx();
      // Snap to whichever of the three points is nearest on release.
      const nearest = (["peek", "half", "full"] as const).reduce((best, key) =>
        Math.abs(snap[key] - dragPx) < Math.abs(snap[best] - dragPx) ? key : best,
      "peek");
      setSnapPoint(nearest);
      setDragPx(null);
    }
  };

  // Tap on the handle cycles peek → half → full → peek.
  const onHandleTap = () => {
    setSnapPoint((s) => (s === "peek" ? "half" : s === "half" ? "full" : "peek"));
  };

  const snap = typeof window !== "undefined" ? getSnapPx() : { peek: 680, half: 360, full: 64 };
  const translateY = dragPx !== null
    ? `${dragPx}px`
    : snapPoint === "peek"
      ? `calc(100% - 120px)`
      : `${snap[snapPoint]}px`;

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
  const onBook = async () => {
    if (!pickup) return;
    setBookingError(null);
    setBookingState("loading");
    try {
      const { order } = await bookDriver();
      router.push(`/dispatch?orderId=${order.id}`);
    } catch (e) {
      setBookingError(e instanceof Error ? e.message : "Booking failed. Please try again.");
      setBookingState("idle");
    }
  };

  const fareBreakdown = fareEstimate?.fare_breakdown;

  return (
    <>
      {/* ── Bottom sheet ─────────────────────────────────────────────────── */}
      <div
        ref={sheetRef}
        style={{
          transform: `translateY(${translateY})`,
          transition: isDragging.current ? "none" : "transform 0.3s cubic-bezier(0.32,0.72,0,1)",
        }}
        className="fixed inset-x-0 bottom-0 z-30 flex h-screen flex-col rounded-t-lg
          bg-background-primary shadow-elevation-3"
      >
        {/* Drag handle */}
        <div
          className="flex-shrink-0 cursor-grab touch-none px-4 pb-2 pt-3 active:cursor-grabbing"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onClick={onHandleTap}
        >
          <div className="mx-auto h-1 w-9 rounded-pill bg-border-opaque" />
        </div>

        {/* Quick tiles — always visible at top */}
        <div className="flex-shrink-0">
          <QuickTiles />
        </div>

        {/* Scrollable booking form */}
        <div className="flex-1 overflow-y-auto overscroll-contain">

          {/* [1] Trip Type Selector */}
          <Section>
            <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
              {tripTypes.map((t) => (
                <Chip key={t.value} active={tripType === t.value} onClick={() => setTripType(t.value)}>
                  {t.label}
                </Chip>
              ))}
            </div>
          </Section>

          {/* [2] Pickup — current location prefilled by home page; type to search */}
          <Section>
            <PlaceInput
              value={pickup?.address ?? ""}
              placeholder="Pickup location"
              icon={<div className="h-3 w-3 rounded-pill bg-accent-400" />}
              onSelect={setPickup}
              onClear={() => setPickup(null)}
            />
          </Section>

          {/* [3] Drop — hidden for Round Trip */}
          {needsDrop && (
            <Section>
              <PlaceInput
                value={dropoff?.address ?? ""}
                placeholder="Where to?"
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" fill="currentColor" className="text-content-tertiary" />
                  </svg>
                }
                onSelect={setDropoff}
                onClear={() => setDropoff(null)}
              />
            </Section>
          )}

          {/* [4] Add Stop */}
          {dropoff && needsDrop && (
            <Section>
              <button className="flex items-center gap-2 text-label-small text-content-accent hover:opacity-80 min-h-[36px]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M12 7v10M7 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Add stop
              </button>
            </Section>
          )}

          {/* [5] Schedule */}
          <Section>
            <div className="flex items-center gap-2">
              <span className="text-label-small text-content-secondary">When</span>
              <Chip active={!scheduledAt} onClick={() => setScheduledAt(null)}>Now</Chip>
              <Chip
                active={!!scheduledAt}
                onClick={() => setScheduledAt(defaultSlot(openH, closeH).toISOString())}
              >
                Schedule
              </Chip>
            </div>
            {scheduledAt && (
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
                  className="w-full h-11 rounded-sm border border-border-opaque bg-background-secondary
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
          </Section>

          {/* [6] Duration slider */}
          {needsDuration && (
            <Section>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-paragraph-medium text-content-primary">Duration</span>
                  <span className="font-mono text-mono-medium text-content-primary tabular-nums">
                    {durationHours || 4}h
                  </span>
                </div>
                {/* Custom slider track */}
                <div className="relative h-2 rounded-pill bg-background-tertiary">
                  <div
                    className="absolute left-0 top-0 h-full rounded-pill bg-background-inverse transition-all"
                    style={{ width: `${(((durationHours || 4) - 1) / 11) * 100}%` }}
                  />
                </div>
                <input
                  type="range"
                  min={1}
                  max={12}
                  step={1}
                  value={durationHours || 4}
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
            </Section>
          )}

          {/* [7] Car Selector */}
          <Section>
            <button
              onClick={() => setShowCarPicker(true)}
              className="flex w-full items-center justify-between min-h-[44px]
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            >
              <div className="flex items-center gap-3">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M3 17l1.5-4.5L7 8h10l2.5 4.5L21 17H3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" className="text-content-tertiary" />
                  <circle cx="7.5" cy="17.5" r="1.5" stroke="currentColor" strokeWidth="1.5" className="text-content-tertiary" />
                  <circle cx="16.5" cy="17.5" r="1.5" stroke="currentColor" strokeWidth="1.5" className="text-content-tertiary" />
                </svg>
                <div className="text-left">
                  {selectedCar ? (
                    <>
                      <p className="text-label-medium text-content-primary">
                        {selectedCar.color ?? ""} {selectedCar.make} {selectedCar.model}
                      </p>
                      <p className="text-label-small text-content-secondary">
                        {selectedCar.registration_plate} · {selectedCar.transmission}
                      </p>
                    </>
                  ) : (
                    <p className="text-paragraph-medium text-content-tertiary">Select your car</p>
                  )}
                </div>
              </div>
              <span className="text-label-small text-content-accent">Change ›</span>
            </button>
          </Section>

          {/* [8] Persons stepper */}
          <Section>
            <div className="flex items-center justify-between">
              <span className="text-paragraph-medium text-content-primary">Persons</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPersonsCount(personsCount - 1)}
                  disabled={personsCount <= 1}
                  aria-label="Decrease persons"
                  className="flex h-11 w-11 items-center justify-center rounded-sm
                    bg-background-secondary border border-border-opaque
                    text-label-large text-content-primary
                    disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed
                    hover:bg-background-tertiary transition-base
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
                >
                  −
                </button>
                <span className="font-mono text-mono-medium text-content-primary tabular-nums w-4 text-center">
                  {personsCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPersonsCount(personsCount + 1)}
                  disabled={personsCount >= 8}
                  aria-label="Increase persons"
                  className="flex h-11 w-11 items-center justify-center rounded-sm
                    bg-background-secondary border border-border-opaque
                    text-label-large text-content-primary
                    disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed
                    hover:bg-background-tertiary transition-base
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
                >
                  +
                </button>
              </div>
            </div>
          </Section>

          {/* [9] Fare Estimate Strip */}
          <Section>
            {isSearching && !fareEstimate ? (
              <FareShimmer />
            ) : fareEstimate ? (
              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <FareDisplay amount={fareBreakdown?.estimated_total_paise ?? 0} size="lg" />
                      {fareEstimate.surge_active && (
                        <span className="inline-flex items-center gap-1 rounded-sm bg-surface-negative px-2 py-0.5 text-label-small text-content-negative">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M12 3c2 3 5 5 5 9a5 5 0 11-10 0c0-2 1-3 2-4 .5 1 1.5 1.5 2 1 .5-1.5-1-3.5 1-6z" />
                          </svg>
                          {fareBreakdown?.surge_multiplier?.toFixed(1)}× surge
                        </span>
                      )}
                      {(fareBreakdown?.night_charge_paise ?? 0) > 0 && (
                        <span title="Night charge" className="inline-flex text-content-tertiary">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                          </svg>
                        </span>
                      )}
                    </div>
                    <p className="text-paragraph-small text-content-secondary mt-0.5">
                      Estimated fare · {fareEstimate.driver_availability} availability
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowFareModal(true)}
                      className="text-label-small text-content-accent hover:opacity-80 mt-0.5
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
                    >
                      Fare breakdown →
                    </button>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-mono-small text-content-secondary tabular-nums">
                      ~{fareEstimate.estimated_pickup_eta_minutes} min
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-paragraph-small text-content-tertiary">
                Enter pickup to see fare estimate
              </p>
            )}
          </Section>

          {/* [10] D4M Care toggle */}
          <Section>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center text-content-accent">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 3l7 3v5c0 4.4-3 7.4-7 8.5-4-1.1-7-4.1-7-8.5V6l7-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <span className="text-label-medium text-content-primary">D4M Care</span>
                  <p className="text-paragraph-small text-content-secondary">
                    ₹49 — Insurance + support
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowD4mInfo(true)}
                  className="ml-1 text-content-tertiary hover:text-content-secondary min-w-[24px] min-h-[24px] flex items-center justify-center
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 rounded-pill"
                  aria-label="D4M Care info"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M12 16v-4M12 8h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <Toggle on={d4mCare} onToggle={() => setD4mCare(!d4mCare)} />
            </div>
          </Section>

          {/* [10b] Owner-not-in-car toggle */}
          <Section>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center text-content-secondary">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M3 17l1.5-4.5L7 8h10l2.5 4.5L21 17H3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    <circle cx="7.5" cy="17.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="16.5" cy="17.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </span>
                <div>
                  <span className="text-label-medium text-content-primary">I won&apos;t be in the car</span>
                  <p className="text-paragraph-small text-content-secondary">
                    Driver takes the car without me
                  </p>
                </div>
              </div>
              <Toggle on={ownerNotInCar} onToggle={() => setOwnerNotInCar(!ownerNotInCar)} />
            </div>
          </Section>

          {/* [11] Promo Code */}
          <Section>
            <div className="flex items-center gap-2">
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
                <span className="flex items-center text-content-positive" aria-label="Promo applied">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
              {promoStatus === "err" && (
                <span className="text-content-negative text-label-small">Invalid</span>
              )}
              <button
                type="button"
                onClick={applyPromo}
                disabled={!promoInput}
                className="rounded-sm bg-background-secondary border border-border-opaque
                  px-3 py-1.5 text-label-small text-content-accent font-medium
                  disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed
                  hover:bg-background-tertiary transition-base
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
          </Section>

          {/* [12] Payment Method */}
          <Section>
            <div className="flex gap-2">
              {PAYMENT_METHODS.map((pm) => (
                <Chip key={pm.value} active={paymentMethod === pm.value} onClick={() => setPaymentMethod(pm.value)}>
                  {pm.label}
                </Chip>
              ))}
            </div>
          </Section>

          {/* [13] Book Driver CTA */}
          <div className="px-4 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] pt-4">
            {bookingError && (
              <p role="alert" className="mb-2 text-label-small text-content-negative">
                {bookingError}
              </p>
            )}
            <button
              type="button"
              disabled={!pickup || isMonthly || bookingState === "loading"}
              onClick={onBook}
              className="relative flex h-14 w-full items-center justify-center overflow-hidden
                rounded-sm bg-interactive-primary text-interactive-primary-text
                text-label-large font-medium
                transition-base cursor-pointer
                hover:opacity-90 active:scale-[0.99]
                disabled:opacity-50 disabled:cursor-not-allowed
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2"
              style={{
                boxShadow: "0 4px 16px rgba(0,0,0,0.24)",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {bookingState === "loading" ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
                  </svg>
                  Finding drivers…
                </span>
              ) : isMonthly ? (
                "Monthly — coming soon"
              ) : (
                "Book Driver"
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Car picker bottom sheet ────────────────────────────────────────── */}
      {showCarPicker && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60"
          onClick={() => setShowCarPicker(false)}
        >
          <div
            className="rounded-t-lg bg-background-primary p-4 shadow-elevation-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-9 rounded-pill bg-border-opaque" />
            <h3 className="mb-3 text-heading-small text-content-primary">Select your car</h3>
            <div className="space-y-2">
              {cars.map((car) => (
                <button
                  key={car.id}
                  type="button"
                  onClick={() => { setSelectedCar(car.id); setShowCarPicker(false); }}
                  className={[
                    "flex w-full items-center justify-between rounded-sm px-4 py-3 min-h-[56px] transition-base cursor-pointer",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400",
                    selectedCarId === car.id
                      ? "bg-background-secondary border-2 border-interactive-primary"
                      : "bg-background-secondary border border-border-opaque hover:border-border-selected",
                  ].join(" ")}
                >
                  <div className="text-left">
                    <p className="text-label-medium text-content-primary">{car.make} {car.model}</p>
                    <p className="text-label-small text-content-secondary">{car.registration_plate} · {car.transmission}</p>
                  </div>
                  {selectedCarId === car.id && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-interactive-primary" />
                    </svg>
                  )}
                </button>
              ))}
              {cars.length === 0 && (
                <p className="py-6 text-center text-paragraph-small text-content-secondary">
                  No cars in garage. Add one from Account.
                </p>
              )}
            </div>
            <div className="h-6" />
          </div>
        </div>
      )}

      {/* ── Fare breakdown modal ───────────────────────────────────────────── */}
      {showFareModal && fareBreakdown && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60"
          onClick={() => setShowFareModal(false)}
        >
          <div
            className="rounded-t-lg bg-background-primary p-4 shadow-elevation-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-9 rounded-pill bg-border-opaque" />
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
        >
          <div
            className="rounded-t-lg bg-background-primary p-4 shadow-elevation-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-9 rounded-pill bg-border-opaque" />
            <h3 className="mb-2 text-heading-small text-content-primary">D4M Care — ₹49/trip</h3>
            <p className="text-paragraph-medium text-content-secondary">
              D4M Care provides accident insurance coverage during your trip — up to ₹1 lakh
              for medical expenses, ₹5 lakh personal accident cover, and zero-liability protection
              for your vehicle. Highly recommended for outstation trips.
            </p>
            <button
              type="button"
              onClick={() => setShowD4mInfo(false)}
              className="mt-5 w-full h-11 rounded-sm bg-background-secondary border border-border-opaque
                text-label-medium text-content-primary cursor-pointer
                hover:bg-background-tertiary transition-base
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
