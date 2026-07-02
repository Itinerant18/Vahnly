"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RiderStreamManager } from "@/lib/websocket/RiderStreamManager";
import type { RiderWebSocketMessage } from "@/lib/websocket/types";
import { useTripStore } from "@/lib/store/tripStore";
import type { TripStatus } from "@/lib/api/types";
import { useNotificationStore } from "@/lib/store/notificationStore";
import { ordersApi } from "@/lib/api/orders";
import { searchPlaces, type GeocodeResult } from "@/lib/utils/geocode";
import { StatusBanner } from "@/components/trip/StatusBanner";
import { DriverCard } from "@/components/trip/DriverCard";
import { OTPDisplay } from "@/components/trip/OTPDisplay";
import { SOSModal } from "@/components/trip/SOSModal";
import { RideCheckModal } from "@/components/trip/RideCheckModal";
import { ShareTripSheet } from "@/components/trip/ShareTripSheet";
import { TripTimeline } from "@/components/trip/TripTimeline";
import { FareDisplay } from "@/components/ds/FareDisplay";
import { BlurFade } from "@/components/ui/blur-fade";
import { NumberTicker } from "@/components/ui/number-ticker";
import { BorderBeam } from "@/components/ui/border-beam";
import { openGoogleMapsNavigation } from "@/lib/map/navigation";

const TripMap = dynamic(() => import("@/components/trip/TripMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-background-secondary" />,
});

// ── Floating Action Button ───────────────────────────────────────────────────
function FAB({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
      <button
        type="button"
        onClick={onClick}
        className={[
          "flex flex-col items-center gap-1 rounded-md px-3 py-3 min-h-[56px] min-w-[48px] cursor-pointer",
          "transition-all duration-200 ease-out",
          "active:scale-90",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400",
          danger
            ? "bg-negative-400 text-white shadow-elevation-2 glow-negative"
            : "bg-background-primary/90 border border-border-opaque backdrop-blur-sm",
        ].join(" ")}
      >
        <span className="flex h-5 w-5 items-center justify-center leading-none">{icon}</span>
        <span className={`text-label-small ${danger ? "text-white" : "text-content-secondary"}`}>
          {label}
        </span>
      </button>
  );
}

// ── Cancellation fees (display only; backend enforces) ────────────────────────
// Mirrors backend env defaults: free before the driver sets off, ₹30 once
// EN_ROUTE, ₹50 once the driver has travelled to / reached the car.
const CANCEL_FEE_ENROUTE_PAISE = 3000;
const CANCEL_FEE_ARRIVED_PAISE = 5000;

function cancelFeePaise(status: TripStatus | null): number {
  switch (status) {
    case "EN_ROUTE_TO_PICKUP":
      return CANCEL_FEE_ENROUTE_PAISE;
    case "ARRIVED_AT_PICKUP":
    case "WAITING":
    case "DELIVERING":
      return CANCEL_FEE_ARRIVED_PAISE;
    default:
      return 0; // CREATED, ASSIGNED, terminal
  }
}

// ── Waiting meter (rider-facing running estimate) ─────────────────────────────
// The WS "waiting" event carries no amount, so estimate client-side at the known
// ₹2/min rate. Backend is the source of truth on the final bill.
const WAIT_RATE_PAISE_PER_MIN = 200;

function WaitingMeter() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const chargePaise = Math.ceil(seconds / 60) * WAIT_RATE_PAISE_PER_MIN;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-2 flex items-center justify-between gap-3 rounded-md bg-surface-warning px-4 py-2.5 backdrop-blur-sm"
    >
      <span className="font-mono text-mono-small text-content-warning tabular-nums">
        Driver waiting · {mm}:{ss}
      </span>
      <span className="text-label-small text-content-warning">
        ≈ <FareDisplay amount={chargePaise} size="sm" className="text-content-warning" /> so far
      </span>
    </div>
  );
}

// ── Cancel confirm sheet ──────────────────────────────────────────────────────
function CancelConfirmSheet({
  status,
  onCancel,
  onClose,
}: {
  status: TripStatus | null;
  onCancel: () => void;
  onClose: () => void;
}) {
  const fee = cancelFeePaise(status);
  const reached = status === "ARRIVED_AT_PICKUP" || status === "WAITING" || status === "DELIVERING";
  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/60"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div
        className="w-full rounded-t-2xl bg-background-primary/95 backdrop-blur-xl p-6 shadow-elevation-3 animate-spring-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-pill bg-border-opaque/60" />
        <h3 className="text-heading-small text-content-primary">Cancel trip?</h3>
        {fee > 0 ? (
          <div className="mt-2 space-y-2">
            <p className="text-paragraph-medium text-content-secondary">
              Your driver is already {reached ? "at your car" : "on the way to your car"}, so a
              cancellation fee applies. It will be charged to your selected payment method.
            </p>
            <div className="flex items-center justify-between rounded-sm bg-surface-negative px-3 py-2">
              <span className="text-label-medium text-content-negative">Cancellation fee</span>
              <FareDisplay amount={fee} size="md" className="text-content-negative" />
            </div>
          </div>
        ) : (
          <p className="mt-2 text-paragraph-medium text-content-secondary">
            No fee applies yet. You can cancel this trip free of charge.
          </p>
        )}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-sm bg-background-secondary border border-border-opaque
              py-3 text-label-medium text-content-secondary cursor-pointer min-h-[44px]
              hover:bg-background-tertiary transition-base
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
          >
            Keep trip
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-sm bg-negative-400 border border-negative-400
              py-3 text-label-medium text-white font-semibold cursor-pointer min-h-[44px]
              hover:opacity-90 transition-base
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative-400"
          >
            {fee > 0 ? `Cancel & pay ₹${Math.round(fee / 100)}` : "Cancel trip"}
          </button>
        </div>
        <div className="h-4" />
      </div>
    </div>
  );
}

// ── Extend duration sheet ─────────────────────────────────────────────────────
function ExtendSheet({
  onExtend,
  onClose,
}: {
  onExtend: (hours: number) => void;
  onClose: () => void;
}) {
  const OPTIONS = [1, 2, 4];
  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/60"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div
        className="w-full rounded-t-2xl bg-background-primary/95 backdrop-blur-xl p-6 shadow-elevation-3 animate-spring-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-pill bg-border-opaque/60" />
        <h3 className="text-heading-small text-content-primary">Extend trip</h3>
        <p className="mt-2 text-paragraph-medium text-content-secondary">
          Add more hours to your booking. Extra time is charged at your trip&apos;s hourly rate.
        </p>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {OPTIONS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => onExtend(h)}
              className="rounded-sm bg-background-secondary border border-border-opaque
                py-3 text-label-medium text-content-primary cursor-pointer
                hover:bg-background-tertiary transition-base
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            >
              +{h}h
            </button>
          ))}
        </div>
        <div className="h-4" />
      </div>
    </div>
  );
}

// ── Collapsible trip-details card ─────────────────────────────────────────────
function TripDetailsCard() {
  const [open, setOpen] = useState(false);
  const order      = useTripStore((s) => s.activeOrder);
  const tripStatus = useTripStore((s) => s.tripStatus);
  if (!order) return null;

  const coords = (lat?: number, lng?: number) =>
    lat != null && lng != null ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : "—";

  return (
    <div className="rounded-md bg-background-primary/90 border border-border-opaque backdrop-blur-sm shadow-elevation-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 min-h-[48px]
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 rounded-md"
      >
        <span className="text-label-medium text-content-primary">Trip details</span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          className={`transition-transform text-content-tertiary ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-border-opaque px-4 py-3 space-y-3">
          {/* Status timeline */}
          <TripTimeline status={tripStatus} />

          <dl className="space-y-2 pt-1 text-paragraph-small">
            <div className="flex justify-between gap-3">
              <dt className="text-content-secondary">Pickup</dt>
              <dd className="text-right font-mono tabular-nums text-content-primary">
                {coords(order.pickup_lat, order.pickup_lng)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-secondary">Drop</dt>
              <dd className="text-right font-mono tabular-nums text-content-primary">
                {coords(order.dropoff_lat, order.dropoff_lng)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-secondary">Payment</dt>
              <dd className="text-content-primary">{order.payment_method ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-secondary">Passengers</dt>
              <dd className="text-content-primary tabular-nums">{order.persons_count ?? 1}</dd>
            </div>
            {order.promo_code && (
              <div className="flex justify-between gap-3">
                <dt className="text-content-secondary">Promo</dt>
                <dd className="text-content-primary">{order.promo_code}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-content-secondary">D4M Care</dt>
              <dd className={order.d4m_care_opted ? "text-content-positive" : "text-content-secondary"}>
                {order.d4m_care_opted ? "Active" : "Not added"}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}

// ── Change-drop input sheet ───────────────────────────────────────────────────
function ChangeDropSheet({
  onSelect,
  onClose,
}: {
  onSelect: (result: GeocodeResult) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const found = await searchPlaces(q);
      if (!cancelled) {
        setResults(found);
        setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  return (
    <div className="absolute inset-x-4 bottom-48 z-30">
      <div className="overflow-hidden rounded-sm bg-background-primary border border-border-opaque shadow-elevation-2">
        <div className="flex">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent px-4 py-3 text-paragraph-medium
              text-content-primary placeholder:text-content-tertiary outline-none"
            placeholder="Change drop-off address"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
          />
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex items-center px-3 text-content-tertiary hover:text-content-primary transition-base cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {(searching || results.length > 0) && (
          <div className="max-h-48 overflow-y-auto border-t border-border-opaque">
            {searching && results.length === 0 ? (
              <p className="px-4 py-3 text-paragraph-small text-content-tertiary">Searching…</p>
            ) : (
              results.map((r) => (
                <button
                  key={`${r.lat},${r.lng}`}
                  type="button"
                  onClick={() => onSelect(r)}
                  className="block w-full px-4 py-3 text-left text-paragraph-small text-content-primary
                    hover:bg-background-secondary transition-base cursor-pointer
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
                >
                  {r.display_name}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function LiveTripView({ tripId }: { tripId: string }) {
  const router = useRouter();

  const activeOrder    = useTripStore((s) => s.activeOrder);
  const driverLocation = useTripStore((s) => s.driverLocation);
  const driverBearing  = useTripStore((s) => s.driverBearing);
  const driverETA      = useTripStore((s) => s.driverETA);
  const tripStatus     = useTripStore((s) => s.tripStatus);
  const fareEstimate   = useTripStore((s) => s.fareEstimatePaise);

  const [showSOS,     setShowSOS]     = useState(false);
  const [showShare,   setShowShare]   = useState(false);
  const [showCancel,  setShowCancel]  = useState(false);
  const [rideCheckMsg, setRideCheckMsg] = useState<string | null>(null);
  const [addStopInput, setAddStopInput] = useState(false);
  const [changeDropInput, setChangeDropInput] = useState(false);
  const [showExtend, setShowExtend] = useState(false);
  const [chat, setChat] = useState<{ from: string; text: string; ts: number }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatOpen, setChatOpen] = useState(false);

  const sendChat = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t) return;
    setChat((c) => [...c, { from: "RIDER", text: t, ts: Date.now() / 1000 }]);
    setChatInput("");
    try { await ordersApi.sendChat(tripId, t); } catch { /* best-effort */ }
  }, [tripId]);

  const pickup  = activeOrder ? { lat: activeOrder.pickup_lat,  lng: activeOrder.pickup_lng  } : null;
  const dropoff = activeOrder?.dropoff_lat && activeOrder?.dropoff_lng
    ? { lat: activeOrder.dropoff_lat, lng: activeOrder.dropoff_lng }
    : null;

  // WS connection
  useEffect(() => {
    const trip  = useTripStore.getState();
    const notif = useNotificationStore.getState();

    // Cold start / hard refresh: rebuild trip state from the server up front so the
    // screen isn't blank (and the pickup OTP is restored) even before the socket opens.
    void trip.hydrateActiveOrder();
    let hasConnected = false;

    const manager = new RiderStreamManager({
      onStatusChange: (s) => {
        trip.setWsConnected(s === "CONNECTED");
        if (s === "CONNECTED") {
          // Resync on reconnect only — the first connect is already covered by the
          // mount hydrate above. A dropped socket can't leave the rider on a stale trip.
          if (hasConnected) void useTripStore.getState().hydrateActiveOrder();
          hasConnected = true;
        }
      },
      onMessage: (msg: RiderWebSocketMessage) => {
        switch (msg.type) {
          case "rider.order.assigned":
            // Offer-accept: the accept payload carries status EN_ROUTE_TO_PICKUP so the
            // banner flips straight to "Driver traveling to your car". Legacy/no-status
            // payloads fall back to ASSIGNED.
            trip.updateStatus(
              msg.data.status === "EN_ROUTE_TO_PICKUP" ? "EN_ROUTE_TO_PICKUP" : "ASSIGNED",
            );
            trip.setDriverInfo({
              driverId:       msg.data.driver_id,
              name:           msg.data.driver_name,
              phone:          msg.data.driver_phone,
              photo:          msg.data.driver_photo,
              rating:         msg.data.driver_rating,
              tripsCount:     msg.data.driver_trips_count,
              vehicleContext: msg.data.vehicle_context,
              etaMinutes:     msg.data.eta_minutes,
              bearing:        0,
            });
            break;
          case "rider.driver.location":
            trip.updateDriverLocation(
              { lat: msg.data.lat, lng: msg.data.lng },
              msg.data.eta_minutes,
              msg.data.bearing,
            );
            break;
          case "rider.driver.arrived":
            trip.updateStatus("ARRIVED_AT_PICKUP");
            break;
          case "rider.trip.started":
            trip.updateStatus("DELIVERING");
            break;
          case "rider.trip.waiting":
            trip.updateStatus("WAITING");
            break;
          case "rider.trip.resumed":
            trip.updateStatus("DELIVERING");
            break;
          case "rider.trip.completed":
            trip.updateStatus("COMPLETED");
            trip.clearPickupOtp();
            trip.setCompletedFare({
              orderId:         msg.data.order_id,
              totalFarePaise:  msg.data.total_fare_paise,
              fareBreakdown:   msg.data.fare_breakdown,
              distanceKm:      msg.data.distance_km,
              durationMinutes: msg.data.duration_minutes,
            });
            setTimeout(() => router.replace("/trip/bill"), 800);
            break;
          case "rider.trip.cancelled":
            trip.updateStatus("CANCELLED");
            trip.clearPickupOtp();
            setTimeout(() => router.replace("/home"), 1500);
            break;
          case "rider.notification":
            notif.addNotification({
              id:         crypto.randomUUID(),
              rider_id:   "",
              type:       msg.data.type,
              title:      msg.data.title,
              body:       msg.data.body,
              data:       msg.data.data,
              is_read:    false,
              created_at: new Date().toISOString(),
            });
            break;
          case "rider.ride_check":
            setRideCheckMsg(msg.data.message);
            break;
          case "rider.chat":
            setChat((c) => [...c, { from: msg.data.from, text: msg.data.text, ts: msg.data.ts }]);
            setChatOpen(true);
            break;
          case "rider.fare.updated":
            trip.updateFareEstimate(msg.data.new_estimate_paise);
            break;
        }
      },
    });
    manager.connect();
    return () => manager.disconnect();
  }, [tripId, router]);

  // First-mile: share the rider's live location with the driver so they can find the exact
  // car/pickup spot. Only while the driver is approaching; throttled to ~10s.
  useEffect(() => {
    const prePickup = !!tripStatus && ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP"].includes(tripStatus);
    if (!prePickup || typeof navigator === "undefined" || !navigator.geolocation) return;
    let last = 0;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - last < 10_000) return;
        last = now;
        void ordersApi.shareLocation(tripId, pos.coords.latitude, pos.coords.longitude).catch(() => {});
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 8_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [tripStatus, tripId]);

  const handleCancel = useCallback(async () => {
    setShowCancel(false);
    try {
      await useTripStore.getState().cancelTrip("RIDER_CHANGED_MIND");
      router.replace("/home");
    } catch {}
  }, [router]);

  const handleAddStop = async (address: string) => {
    if (!activeOrder) return;
    setAddStopInput(false);
    try {
      await ordersApi.addStop(activeOrder.id, { lat: pickup?.lat ?? 0, lng: pickup?.lng ?? 0, address });
    } catch {}
  };

  const handleExtend = useCallback(
    async (hours: number) => {
      if (!activeOrder) return;
      setShowExtend(false);
      try {
        await ordersApi.extend(activeOrder.id, hours);
      } catch {}
    },
    [activeOrder],
  );

  const handleChangeDrop = useCallback(
    async (result: GeocodeResult) => {
      if (!activeOrder) return;
      setChangeDropInput(false);
      try {
        await ordersApi.changeDrop(activeOrder.id, {
          lat: result.lat,
          lng: result.lng,
          address: result.display_name,
        });
        await useTripStore.getState().hydrateActiveOrder();
      } catch {}
    },
    [activeOrder],
  );

  const inTrip = tripStatus === "DELIVERING";

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-background-secondary">
      {/* Full-screen map */}
      <div className="absolute inset-0 z-0">
        <TripMap
          pickup={pickup}
          dropoff={dropoff}
          driverLat={driverLocation?.lat ?? null}
          driverLng={driverLocation?.lng ?? null}
          driverBearing={driverBearing}
          tripStatus={tripStatus}
          etaMinutes={driverETA}
        />
      </div>

      {/* Status banner — top */}
      <BlurFade className="absolute inset-x-4 top-4 z-20">
        <div className="relative overflow-hidden rounded-md">
          {tripStatus && ["EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP", "DELIVERING"].includes(tripStatus) && (
            <BorderBeam size={80} duration={8} colorFrom="#22c55e" colorTo="rgba(34,197,94,0.1)" borderWidth={1.5} />
          )}
          <StatusBanner status={tripStatus} />
          {tripStatus === "WAITING" && <WaitingMeter />}
        </div>
      </BlurFade>

      {/* Right-side FABs */}
      <BlurFade direction="right" offset={8} className="absolute right-3 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-2">
        {inTrip && (
          <>
            <FAB
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}
              label="Stop" onClick={() => setAddStopInput(true)}
            />
            <FAB
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" /></svg>}
              label="Drop" onClick={() => setChangeDropInput(true)}
            />
            <FAB
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" /><path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              label="Extend" onClick={() => setShowExtend(true)}
            />
          </>
        )}
        <FAB
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l9 16H3L12 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M12 10v4M12 17h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>}
          label="SOS" onClick={() => setShowSOS(true)} danger
        />
      </BlurFade>

      {/* Bottom panel */}
      <BlurFade direction="up" offset={8} className="absolute inset-x-0 bottom-0 z-20 space-y-2 pb-[80px] pt-2 px-4">
        {/* In-trip estimated fare strip */}
        {inTrip && activeOrder && (
          <div className="flex items-center justify-between rounded-md bg-background-primary/90
            border border-border-opaque px-4 py-2.5 backdrop-blur-sm shadow-elevation-1">
            <span className="text-label-small text-content-secondary">Est. fare</span>
            <FareDisplay amount={fareEstimate ?? activeOrder.base_fare_paise} size="sm" />
          </div>
        )}

        {dropoff && (
          <button
            type="button"
            onClick={() => openGoogleMapsNavigation(dropoff)}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-md bg-background-inverse px-4 py-3 text-label-medium font-semibold text-content-inverse shadow-elevation-2 transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 3l7 18-7-4-7 4 7-18z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            </svg>
            Start navigation
          </button>
        )}

        {/* OTP (ARRIVED_AT_PICKUP) */}
        <OTPDisplay />

        {/* Collapsible trip details + status timeline */}
        <TripDetailsCard />

        {/* Driver card */}
        <DriverCard
          onCall={() => {
            const phone = useTripStore.getState().driverInfo?.phone;
            if (typeof window !== "undefined" && phone) window.open(`tel:${phone}`, "_self");
          }}
          onShare={() => setShowShare(true)}
          onCancel={() => setShowCancel(true)}
          onChat={() => setChatOpen(true)}
        />

        {/* In-app chat with the driver (pickup coordination) */}
        {tripStatus && ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP", "DELIVERING"].includes(tripStatus) && (
          <div className="rounded-md border border-border-opaque bg-background-secondary overflow-hidden">
            <button
              onClick={() => setChatOpen((o) => !o)}
              className="w-full flex items-center justify-between px-4 py-3 text-label-medium font-semibold text-content-primary"
            >
              <span className="flex items-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M21 12a8 8 0 01-11.5 7.2L4 20l1.2-4.2A8 8 0 1121 12z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
                Message driver{chat.length > 0 ? ` (${chat.length})` : ""}
              </span>
              <span className="text-content-tertiary">{chatOpen ? "▾" : "▸"}</span>
            </button>
            {chatOpen && (
              <div className="px-4 pb-4 space-y-3">
                <div className="max-h-40 overflow-y-auto space-y-2">
                  {chat.length === 0 && (
                    <p className="text-paragraph-small text-content-tertiary text-center py-2">
                      Coordinate your pickup — e.g. exactly where the car is parked.
                    </p>
                  )}
                  {chat.map((m, i) => (
                    <BlurFade
                      key={i}
                      delay={0.05}
                      duration={0.2}
                      offset={4}
                      direction={m.from === "RIDER" ? "right" : "left"}
                      className={`flex ${m.from === "RIDER" ? "justify-end" : "justify-start"}`}
                    >
                      <span className={`inline-block max-w-[80%] rounded-md px-3 py-1.5 text-paragraph-small ${
                        m.from === "RIDER" ? "bg-accent-400 text-white" : "bg-background-primary text-content-primary border border-border-opaque"
                      }`}>{m.text}</span>
                    </BlurFade>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {["I'm at the gate", "Where are you?", "Coming in 5 min"].map((q) => (
                    <button
                      key={q}
                      onClick={() => sendChat(q)}
                      className="rounded-pill border border-border-opaque px-3 py-1 text-label-small text-content-secondary hover:text-content-primary hover:bg-background-primary transition-all duration-200 ease-out active:scale-95"
                    >
                      {q}
                    </button>
                  ))}
                </div>
                <form onSubmit={(e) => { e.preventDefault(); sendChat(chatInput); }} className="flex gap-2">
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type a message…"
                    maxLength={500}
                    className="flex-1 h-10 px-3 rounded-sm bg-background-primary border border-border-opaque text-label-medium text-content-primary focus:outline-none focus:border-border-accent"
                  />
                  <button
                    type="submit"
                    disabled={!chatInput.trim()}
                    className="h-10 px-4 rounded-sm bg-background-inverse text-content-inverse text-label-medium font-medium disabled:opacity-50"
                  >
                    Send
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </BlurFade>

      {/* Add Stop input */}
      {addStopInput && (
        <div className="absolute inset-x-4 bottom-48 z-30">
          <div className="flex overflow-hidden rounded-sm bg-background-primary border border-border-opaque shadow-elevation-2">
            <input
              autoFocus
              className="flex-1 bg-transparent px-4 py-3 text-paragraph-medium
                text-content-primary placeholder:text-content-tertiary outline-none"
              placeholder="Enter stop address"
              onKeyDown={(e) => {
                if (e.key === "Enter")  handleAddStop((e.target as HTMLInputElement).value);
                if (e.key === "Escape") setAddStopInput(false);
              }}
            />
            <button
              type="button"
              aria-label="Close"
              onClick={() => setAddStopInput(false)}
              className="flex items-center px-3 text-content-tertiary hover:text-content-primary transition-base cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Change Drop input */}
      {changeDropInput && (
        <ChangeDropSheet onSelect={handleChangeDrop} onClose={() => setChangeDropInput(false)} />
      )}

      {showExtend  && <ExtendSheet onExtend={handleExtend} onClose={() => setShowExtend(false)} />}
      {showSOS     && <SOSModal onClose={() => setShowSOS(false)} />}
      {showShare   && <ShareTripSheet onClose={() => setShowShare(false)} />}
      {showCancel  && <CancelConfirmSheet status={tripStatus} onCancel={handleCancel} onClose={() => setShowCancel(false)} />}
      {rideCheckMsg && (
        <RideCheckModal
          message={rideCheckMsg}
          onOk={() => setRideCheckMsg(null)}
          onSOS={() => { setRideCheckMsg(null); setShowSOS(true); }}
        />
      )}
    </div>
  );
}
