"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useBookingStore } from "@/lib/store/bookingStore";
import { garageApi } from "@/lib/api/garage";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { QuickTiles } from "./QuickTiles";
import type { GarageCar, PaymentMethod, TripType } from "@/lib/api/types";

const TRIP_TYPES: { value: TripType; label: string }[] = [
  { value: "IN_CITY_ROUND", label: "Round Trip" },
  { value: "IN_CITY_ONE_WAY", label: "One-Way" },
  { value: "MINI_OUTSTATION", label: "Mini Out." },
  { value: "OUTSTATION", label: "Outstation" },
];

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" },
  { value: "WALLET", label: "Wallet" },
];

function Section({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-white/6 px-4 py-3">{children}</div>;
}

function Shimmer() {
  return (
    <div className="flex items-center justify-between">
      <div className="h-4 w-24 animate-pulse rounded bg-white/10" />
      <div className="h-4 w-16 animate-pulse rounded bg-white/10" />
    </div>
  );
}

export function BookingSheet() {
  const router = useRouter();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
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

  const {
    pickup, dropoff, tripType, durationHours, personsCount, d4mCare,
    promoCode, paymentMethod, fareEstimate, isSearching, scheduledAt,
    setPickup, setDropoff, setTripType, setDurationHours, setPersonsCount,
    setScheduledAt, setD4mCare, setPromoCode, setPaymentMethod,
    validatePromo, bookDriver, selectedCarId, setSelectedCar,
  } = useBookingStore();

  // Fetch garage cars once
  useEffect(() => {
    garageApi.list().then(setCars).catch(() => {});
    // Auto-select default car
    garageApi.list().then((list) => {
      const def = list.find((c) => c.is_default);
      if (def && !selectedCarId) setSelectedCar(def.id);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCar = cars.find((c) => c.id === selectedCarId);

  const needsDuration = tripType === "IN_CITY_ROUND" || tripType === "OUTSTATION" || tripType === "MINI_OUTSTATION";
  const needsDrop = tripType !== "IN_CITY_ROUND";

  // Touch handlers
  const getSnapPx = useCallback(() => {
    const h = sheetRef.current?.offsetHeight ?? (typeof window !== "undefined" ? window.innerHeight : 800);
    return {
      collapsed: h - 120,
      expanded: Math.round(h * 0.15),
    };
  }, []);

  const onTouchStart = (e: React.TouchEvent) => {
    const snap = getSnapPx();
    dragStartY.current = e.touches[0].clientY;
    dragStartPx.current = expanded ? snap.expanded : snap.collapsed;
    isDragging.current = true;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const delta = e.touches[0].clientY - dragStartY.current;
    const snap = getSnapPx();
    const clamped = Math.max(snap.expanded, Math.min(snap.collapsed, dragStartPx.current + delta));
    setDragPx(clamped);
  };

  const onTouchEnd = () => {
    isDragging.current = false;
    if (dragPx !== null) {
      const snap = getSnapPx();
      const mid = (snap.expanded + snap.collapsed) / 2;
      setExpanded(dragPx < mid);
      setDragPx(null);
    }
  };

  const snap = typeof window !== "undefined" ? getSnapPx() : { collapsed: 680, expanded: 120 };
  const translateY = dragPx !== null
    ? `${dragPx}px`
    : expanded
      ? `${snap.expanded}px`
      : `calc(100% - 120px)`;

  // Promo apply
  const applyPromo = async () => {
    setPromoCode(promoInput);
    try {
      await validatePromo();
      setPromoStatus("ok");
    } catch {
      setPromoStatus("err");
    }
  };

  // Book driver
  const onBook = async () => {
    if (!pickup) return;
    setBookingState("loading");
    try {
      const { order } = await bookDriver();
      router.push(`/dispatch?orderId=${order.id}`);
    } catch {
      setBookingState("idle");
    }
  };

  const fareBreakdown = fareEstimate?.fare_breakdown;

  return (
    <>
      {/* Bottom sheet */}
      <div
        ref={sheetRef}
        style={{
          transform: `translateY(${translateY})`,
          transition: isDragging.current ? "none" : "transform 0.3s cubic-bezier(0.32,0.72,0,1)",
        }}
        className="fixed inset-x-0 bottom-0 z-30 flex h-screen flex-col rounded-t-3xl bg-[#141414]"
      >
        {/* Drag handle */}
        <div
          className="flex-shrink-0 cursor-grab touch-none px-4 pb-1 pt-3 active:cursor-grabbing"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onClick={() => setExpanded((e) => !e)}
        >
          <div className="mx-auto h-1 w-10 rounded-full bg-white/20" />
        </div>

        {/* Quick tiles — always visible at top */}
        <div className="flex-shrink-0">
          <QuickTiles />
        </div>

        {/* Scrollable booking sections */}
        <div className="flex-1 overflow-y-auto overscroll-contain">

          {/* [1] Trip Type */}
          <Section>
            <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
              {TRIP_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTripType(t.value)}
                  className={`flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    tripType === t.value
                      ? "bg-[#FF6B35] text-white"
                      : "bg-[#1E1E1E] text-[#9CA3AF]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Section>

          {/* [2] Pickup */}
          <Section>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center">
                <div className="h-3 w-3 rounded-full bg-[#22C55E]" />
              </div>
              <input
                className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#9CA3AF]"
                placeholder="Pickup location"
                value={pickup?.address ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setPickup(val ? { lat: 22.5726, lng: 88.3639, address: val } : null);
                }}
              />
            </div>
          </Section>

          {/* [3] Drop — hidden for Round Trip */}
          {needsDrop && (
            <Section>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" fill="#EF4444" />
                  </svg>
                </div>
                <input
                  className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#9CA3AF]"
                  placeholder="Where to?"
                  value={dropoff?.address ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDropoff(val ? { lat: 22.5926, lng: 88.3839, address: val } : null);
                  }}
                />
              </div>
            </Section>
          )}

          {/* [4] Add Stop */}
          {dropoff && needsDrop && (
            <Section>
              <button className="flex items-center gap-2 text-sm text-[#FF6B35]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="#FF6B35" strokeWidth="1.5" />
                  <path d="M12 7v10M7 12h10" stroke="#FF6B35" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Add stop
              </button>
            </Section>
          )}

          {/* [5] Schedule */}
          <Section>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#9CA3AF]">When</span>
              <button
                onClick={() => setScheduledAt(null)}
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  !scheduledAt ? "bg-[#FF6B35] text-white" : "bg-[#1E1E1E] text-[#9CA3AF]"
                }`}
              >
                Now
              </button>
              <button
                onClick={() => setScheduledAt(new Date(Date.now() + 3600000).toISOString())}
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  scheduledAt ? "bg-[#FF6B35] text-white" : "bg-[#1E1E1E] text-[#9CA3AF]"
                }`}
              >
                {scheduledAt
                  ? new Date(scheduledAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                  : "Schedule"}
              </button>
            </div>
          </Section>

          {/* [6] Duration — Round Trip / Outstation only */}
          {needsDuration && (
            <Section>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white">Duration</span>
                  <span className="text-sm font-semibold text-[#FF6B35]">{durationHours || 4}h</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={12}
                  step={1}
                  value={durationHours || 4}
                  onChange={(e) => setDurationHours(Number(e.target.value))}
                  className="w-full accent-[#FF6B35]"
                />
                <div className="flex justify-between text-[10px] text-[#9CA3AF]">
                  {[1, 3, 5, 7, 9, 12].map((h) => <span key={h}>{h}h</span>)}
                </div>
              </div>
            </Section>
          )}

          {/* [7] Car Selector */}
          <Section>
            <button
              onClick={() => setShowCarPicker(true)}
              className="flex w-full items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M3 17l1.5-4.5L7 8h10l2.5 4.5L21 17H3z" stroke="#9CA3AF" strokeWidth="1.5" strokeLinejoin="round" />
                  <circle cx="7.5" cy="17.5" r="1.5" stroke="#9CA3AF" strokeWidth="1.5" />
                  <circle cx="16.5" cy="17.5" r="1.5" stroke="#9CA3AF" strokeWidth="1.5" />
                </svg>
                <div className="text-left">
                  {selectedCar ? (
                    <>
                      <p className="text-sm text-white">{selectedCar.make} {selectedCar.model}</p>
                      <p className="text-xs text-[#9CA3AF]">{selectedCar.registration_plate} · {selectedCar.transmission}</p>
                    </>
                  ) : (
                    <p className="text-sm text-[#9CA3AF]">Select your car</p>
                  )}
                </div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M9 18l6-6-6-6" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </Section>

          {/* [8] Persons */}
          <Section>
            <div className="flex items-center justify-between">
              <span className="text-sm text-white">Passengers</span>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setPersonsCount(personsCount - 1)}
                  disabled={personsCount <= 1}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1E1E1E] text-white disabled:opacity-40"
                >
                  −
                </button>
                <span className="w-4 text-center text-sm font-semibold text-white">{personsCount}</span>
                <button
                  onClick={() => setPersonsCount(personsCount + 1)}
                  disabled={personsCount >= 8}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1E1E1E] text-white disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>
          </Section>

          {/* [9] Fare Estimate Strip */}
          <Section>
            {isSearching && !fareEstimate ? (
              <Shimmer />
            ) : fareEstimate ? (
              <div>
                <div className="flex items-center justify-between">
                  <div>
                    <button
                      onClick={() => setShowFareModal(true)}
                      className="flex items-center gap-1.5"
                    >
                      <span className="text-lg font-bold text-white">
                        {formatCurrency(fareBreakdown?.estimated_total_paise ?? 0)}
                      </span>
                      {fareEstimate.surge_active && (
                        <span className="rounded-full bg-[#EF4444]/20 px-2 py-0.5 text-[10px] font-semibold text-[#EF4444]">
                          ⚡ {fareBreakdown?.surge_multiplier?.toFixed(1)}× surge
                        </span>
                      )}
                      {(fareBreakdown?.night_charge_paise ?? 0) > 0 && (
                        <span className="text-sm">🌙</span>
                      )}
                    </button>
                    <p className="text-xs text-[#9CA3AF]">
                      {fareEstimate.driver_availability} availability ·{" "}
                      <span className="text-[#FF6B35]">Fare breakdown →</span>
                    </p>
                  </div>
                  <span className="text-sm text-[#9CA3AF]">~{fareEstimate.estimated_pickup_eta_minutes} min</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[#9CA3AF]">Enter pickup to see fare estimate</p>
            )}
          </Section>

          {/* [10] D4M Care */}
          <Section>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-white">D4M Care</span>
                <button onClick={() => setShowD4mInfo(true)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="#9CA3AF" strokeWidth="1.5" />
                    <path d="M12 16v-4M12 8h.01" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
                <span className="text-xs text-[#9CA3AF]">₹49/trip</span>
              </div>
              <button
                onClick={() => setD4mCare(!d4mCare)}
                className={`relative h-6 w-11 rounded-full transition-colors ${d4mCare ? "bg-[#FF6B35]" : "bg-white/20"}`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    d4mCare ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </Section>

          {/* [11] Promo Code */}
          <Section>
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M7 7h.01M17 17h.01M3 12l9-9 9 9-9 9-9-9z" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#9CA3AF]"
                placeholder="Promo code"
                value={promoInput}
                onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromoStatus("idle"); }}
              />
              {promoStatus === "ok" && <span className="text-[#22C55E]">✓</span>}
              {promoStatus === "err" && <span className="text-[#EF4444] text-xs">Invalid</span>}
              <button
                onClick={applyPromo}
                disabled={!promoInput}
                className="rounded-lg bg-[#1E1E1E] px-3 py-1.5 text-xs font-medium text-[#FF6B35] disabled:opacity-40"
              >
                Apply
              </button>
            </div>
            {promoStatus === "ok" && fareEstimate?.fare_breakdown.promo_discount_paise ? (
              <p className="mt-1 text-xs text-[#22C55E]">
                {formatCurrency(fareEstimate.fare_breakdown.promo_discount_paise)} saved
              </p>
            ) : null}
            {promoStatus === "err" && (
              <p className="mt-1 text-xs text-[#EF4444]">Invalid or expired code</p>
            )}
          </Section>

          {/* [12] Payment Method */}
          <Section>
            <div className="flex gap-2">
              {PAYMENT_METHODS.map((pm) => (
                <button
                  key={pm.value}
                  onClick={() => setPaymentMethod(pm.value)}
                  className={`flex-1 rounded-xl py-2 text-xs font-medium transition-colors ${
                    paymentMethod === pm.value
                      ? "bg-[#FF6B35] text-white"
                      : "bg-[#1E1E1E] text-[#9CA3AF]"
                  }`}
                >
                  {pm.label}
                  {pm.value === "WALLET" && fareEstimate && (
                    <span className="block text-[9px] opacity-70">bal</span>
                  )}
                </button>
              ))}
            </div>
          </Section>

          {/* [13] Book Driver CTA */}
          <div className="px-4 pb-8 pt-3">
            <button
              disabled={!pickup || bookingState === "loading"}
              onClick={onBook}
              className="relative flex h-14 w-full items-center justify-center overflow-hidden rounded-2xl bg-[#FF6B35] text-base font-bold text-white shadow-lg shadow-[#FF6B35]/30 transition-opacity disabled:opacity-50"
            >
              {bookingState === "loading" ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeDasharray="40 20" />
                  </svg>
                  Finding drivers…
                </span>
              ) : (
                "Book Driver"
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Car picker bottom sheet */}
      {showCarPicker && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={() => setShowCarPicker(false)}>
          <div className="rounded-t-3xl bg-[#141414] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
            <h3 className="mb-3 text-base font-semibold text-white">Select your car</h3>
            <div className="space-y-2">
              {cars.map((car) => (
                <button
                  key={car.id}
                  onClick={() => { setSelectedCar(car.id); setShowCarPicker(false); }}
                  className={`flex w-full items-center justify-between rounded-xl px-4 py-3 ${
                    selectedCarId === car.id ? "bg-[#FF6B35]/15 ring-1 ring-[#FF6B35]" : "bg-[#1E1E1E]"
                  }`}
                >
                  <div className="text-left">
                    <p className="text-sm font-medium text-white">{car.make} {car.model}</p>
                    <p className="text-xs text-[#9CA3AF]">{car.registration_plate} · {car.transmission}</p>
                  </div>
                  {selectedCarId === car.id && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12l5 5L20 7" stroke="#FF6B35" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
              ))}
              {cars.length === 0 && (
                <p className="py-4 text-center text-sm text-[#9CA3AF]">No cars in garage. Add one from Account.</p>
              )}
            </div>
            <div className="h-6" />
          </div>
        </div>
      )}

      {/* Fare breakdown modal */}
      {showFareModal && fareBreakdown && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={() => setShowFareModal(false)}>
          <div className="rounded-t-3xl bg-[#141414] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
            <h3 className="mb-4 text-base font-semibold text-white">Fare Breakdown</h3>
            <div className="space-y-3">
              {[
                ["Base fare", fareBreakdown.base_fare_paise],
                ["Distance charge", fareBreakdown.distance_charge_paise],
                ["Night charge", fareBreakdown.night_charge_paise],
                ["D4M Care", fareBreakdown.d4m_care_paise],
                ["Promo discount", -fareBreakdown.promo_discount_paise],
              ].map(([label, paise]) => (
                Number(paise) !== 0 && (
                  <div key={label as string} className="flex justify-between text-sm">
                    <span className="text-[#9CA3AF]">{label as string}</span>
                    <span className={Number(paise) < 0 ? "text-[#22C55E]" : "text-white"}>
                      {Number(paise) < 0 ? "-" : ""}{formatCurrency(Math.abs(Number(paise)))}
                    </span>
                  </div>
                )
              ))}
              {fareBreakdown.surge_multiplier > 1 && (
                <div className="flex justify-between text-sm">
                  <span className="text-[#9CA3AF]">Surge</span>
                  <span className="text-[#EF4444]">{fareBreakdown.surge_multiplier.toFixed(1)}×</span>
                </div>
              )}
              <div className="border-t border-white/10 pt-3">
                <div className="flex justify-between">
                  <span className="font-semibold text-white">Total</span>
                  <span className="font-bold text-[#FF6B35]">
                    {formatCurrency(fareBreakdown.estimated_total_paise)}
                  </span>
                </div>
              </div>
            </div>
            <div className="h-6" />
          </div>
        </div>
      )}

      {/* D4M Info modal */}
      {showD4mInfo && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={() => setShowD4mInfo(false)}>
          <div className="rounded-t-3xl bg-[#141414] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
            <h3 className="mb-2 text-base font-semibold text-white">D4M Care — ₹49/trip</h3>
            <p className="text-sm text-[#9CA3AF]">
              D4M Care provides accident insurance coverage during your trip — up to ₹1 lakh for medical expenses,
              ₹5 lakh personal accident cover, and zero-liability protection for your vehicle.
              Highly recommended for outstation trips.
            </p>
            <button
              onClick={() => setShowD4mInfo(false)}
              className="mt-4 w-full rounded-xl bg-[#1E1E1E] py-3 text-sm font-medium text-white"
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
