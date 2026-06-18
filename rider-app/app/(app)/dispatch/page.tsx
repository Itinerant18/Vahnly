"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useBookingStore } from "@/lib/store/bookingStore";
import { useTripStore } from "@/lib/store/tripStore";
import { ordersApi } from "@/lib/api/orders";
import { RiderStreamManager } from "@/lib/websocket/RiderStreamManager";
import type { RiderWebSocketMessage } from "@/lib/websocket/types";
import { FareDisplay } from "@/components/ds";

type DispatchState = "BOOKING" | "SEARCHING" | "TIMEOUT";

// Driver payload captured from the rider.order.assigned WS event, shown in the
// driver-assigned modal before routing to the live trip.
interface AssignedDriver {
  driverId: string;
  name: string;
  photo: string;
  rating: number;
  tripsCount: number;
  transmissionExpertise: string;
  etaMinutes: number;
  etaKm: number;
  vehicleContext: string;
}

const SEARCH_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 3_000;

function RadarRing({ delay, size }: { delay: string; size: string }) {
  return (
    <div
      className="absolute rounded-full border border-border-accent"
      style={{
        width: size,
        height: size,
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        animation: `ping 2s ${delay} ease-out infinite`,
      }}
    />
  );
}

function RadarAnimation() {
  return (
    <div className="relative flex h-48 w-48 items-center justify-center">
      <RadarRing delay="0s" size="192px" />
      <RadarRing delay="0.5s" size="148px" />
      <RadarRing delay="1s" size="104px" />
      <div className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full bg-surface-accent ring-2 ring-border-accent">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="var(--accent-400)" strokeWidth="1.5" />
          <path d="M12 7v5l3 3" stroke="var(--accent-400)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const pct = seconds / total;
  const r = 24;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--background-tertiary)" strokeWidth="4" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke="var(--accent-400)"
        strokeWidth="4"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        transform="rotate(-90 32 32)"
        style={{ transition: "stroke-dasharray 0.5s linear" }}
      />
      <text x="32" y="37" textAnchor="middle" fill="var(--content-primary)" fontSize="14" fontWeight="bold">
        {seconds}
      </text>
    </svg>
  );
}

function DriverAssignedModal({
  driver,
  onGoToTrip,
}: {
  driver: AssignedDriver;
  onGoToTrip: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60">
      <div className="w-full rounded-t-2xl bg-background-primary p-6 shadow-elevation-3">
        <div className="mx-auto mb-4 h-1 w-9 rounded-pill bg-border-opaque" />

        <p className="text-center text-sm font-medium text-content-accent">Driver assigned</p>

        <div className="mt-4 flex items-center gap-4">
          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-pill bg-background-secondary border border-border-opaque">
            {driver.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={driver.photo} alt={driver.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-2xl text-content-secondary select-none">
                👤
              </div>
            )}
          </div>
          <div className="flex-1">
            <p className="text-lg font-bold text-content-primary">{driver.name}</p>
            <div className="mt-0.5 flex items-center gap-2 text-sm text-content-secondary">
              <span className="font-mono tabular-nums">★ {driver.rating.toFixed(1)}</span>
              <span className="h-1 w-1 rounded-full bg-content-secondary" />
              <span className="tabular-nums">{driver.tripsCount} trips</span>
            </div>
            {driver.transmissionExpertise && (
              <span className="mt-1.5 inline-block rounded-pill bg-surface-accent px-2.5 py-0.5 text-label-small text-content-accent">
                {driver.transmissionExpertise}
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-2xl bg-background-tertiary px-4 py-3">
          <div>
            <p className="text-xs text-content-secondary">Arriving in</p>
            <p className="text-base font-bold text-content-primary tabular-nums">
              {driver.etaMinutes} min{driver.etaKm ? ` · ${driver.etaKm} km` : ""}
            </p>
          </div>
          <p className="text-sm text-content-secondary">Driving your car</p>
        </div>

        <div className="mt-5 flex gap-3">
          <a
            href="tel:"
            className="flex h-12 flex-1 items-center justify-center rounded-2xl bg-background-tertiary text-base font-semibold text-content-primary"
          >
            Call
          </a>
          <button
            type="button"
            onClick={onGoToTrip}
            className="h-12 flex-[2] rounded-2xl bg-interactive-primary text-base font-bold text-interactive-primary-text shadow-elevation-2"
          >
            Go to trip
          </button>
        </div>
        <div className="h-4" />
      </div>
    </div>
  );
}

function DispatchContent() {
  const router = useRouter();
  const params = useSearchParams();
  const orderId = params.get("orderId");

  const bookDriver = useBookingStore((s) => s.bookDriver);
  const fareEstimate = useBookingStore((s) => s.fareEstimate);
  const tripType = useBookingStore((s) => s.tripType);
  const resetBooking = useBookingStore((s) => s.reset);
  const setActiveOrder = useTripStore((s) => s.setActiveOrder);
  const setOTP = useTripStore((s) => s.setOTP);

  const [state, setState] = useState<DispatchState>(orderId ? "SEARCHING" : "BOOKING");
  const [activeOrderId, setActiveOrderId] = useState<string | null>(orderId);
  const [remainingSecs, setRemainingSecs] = useState(60);
  const [assignedDriver, setAssignedDriver] = useState<AssignedDriver | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goLiveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);

  const stopTimers = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };

  // Route to the live trip, guarding against a double-fire (modal auto-timer +
  // manual tap).
  const goLive = () => {
    stopTimers();
    if (goLiveTimeoutRef.current) clearTimeout(goLiveTimeoutRef.current);
    router.replace("/trip/live");
  };

  const startSearching = (oid: string) => {
    setActiveOrderId(oid);
    setState("SEARCHING");

    // Countdown timer
    let secs = 60;
    setRemainingSecs(secs);
    const countInterval = setInterval(() => {
      secs--;
      setRemainingSecs(secs);
    }, 1000);

    // Poll order status
    pollRef.current = setInterval(async () => {
      try {
        const res = await ordersApi.active();
        if (res.order.id !== oid) return;
        // Offer-accept: a bare ASSIGNED means an offer is out but the driver hasn't
        // accepted yet (they may still decline), so keep searching rather than stranding
        // the rider on the live screen with an empty driver card. Only advance once the
        // driver accepts (EN_ROUTE_TO_PICKUP); the WS rider.order.assigned push normally
        // beats this poll to it (and is what carries force-matched assignments).
        if (res.order.status === "EN_ROUTE_TO_PICKUP") {
          stopTimers();
          clearInterval(countInterval);
          setActiveOrder(res.order);
          router.replace("/trip/live");
        } else if (res.order.status === "CANCELLED") {
          stopTimers();
          clearInterval(countInterval);
          setActiveOrder(res.order);
          setState("TIMEOUT");
        }
      } catch {
        // ignore poll errors
      }
    }, POLL_INTERVAL_MS);

    // Hard timeout
    timeoutRef.current = setTimeout(() => {
      clearInterval(countInterval);
      stopTimers();
      setState("TIMEOUT");
    }, SEARCH_TIMEOUT_MS);
  };

  // Book on mount if no orderId passed
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (orderId) {
      startSearching(orderId);
      return;
    }

    bookDriver()
      .then(({ order, otp }) => { setOTP(otp); startSearching(order.id); })
      .catch(() => setState("TIMEOUT"));

    return () => stopTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // WS listener (belt-and-suspenders alongside the 3s poll): the assignment push
  // arrives instantly, so we surface the driver-assigned modal without waiting
  // for the next poll tick.
  useEffect(() => {
    const manager = new RiderStreamManager({
      onStatusChange: () => {},
      onMessage: (msg: RiderWebSocketMessage) => {
        if (msg.type !== "rider.order.assigned") return;
        const d = msg.data;
        const trip = useTripStore.getState();
        trip.updateStatus("ASSIGNED");
        trip.setDriverInfo({
          driverId: d.driver_id,
          name: d.driver_name,
          photo: d.driver_photo,
          rating: d.driver_rating,
          tripsCount: d.driver_trips_count,
          vehicleContext: d.vehicle_context,
          etaMinutes: d.eta_minutes,
          bearing: 0,
        });
        stopTimers();
        setAssignedDriver({
          driverId: d.driver_id,
          name: d.driver_name,
          photo: d.driver_photo,
          rating: d.driver_rating,
          tripsCount: d.driver_trips_count,
          transmissionExpertise: d.transmission_expertise,
          etaMinutes: d.eta_minutes,
          etaKm: d.eta_km,
          vehicleContext: d.vehicle_context,
        });
        // Auto-advance to the live trip after a beat if the rider doesn't tap.
        goLiveTimeoutRef.current = setTimeout(() => router.replace("/trip/live"), 3_000);
      },
    });
    manager.connect();
    return () => {
      manager.disconnect();
      if (goLiveTimeoutRef.current) clearTimeout(goLiveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTryAgain = () => {
    stopTimers();
    setState("BOOKING");
    startedRef.current = false;
    setActiveOrderId(null);
    bookDriver()
      .then(({ order, otp }) => {
        setOTP(otp);
        startedRef.current = true;
        startSearching(order.id);
      })
      .catch(() => setState("TIMEOUT"));
  };

  const handleGoBack = () => {
    stopTimers();
    resetBooking();
    router.replace("/home");
  };

  const tripLabel: Record<string, string> = {
    IN_CITY_ROUND: "Round Trip",
    IN_CITY_ONE_WAY: "One-Way",
    MINI_OUTSTATION: "Mini Outstation",
    OUTSTATION: "Outstation",
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background-primary px-6">
      {state === "BOOKING" && (
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="h-16 w-16 animate-pulse rounded-full bg-surface-accent ring-2 ring-border-accent" />
          <p className="text-content-secondary">Preparing your booking…</p>
        </div>
      )}

      {state === "SEARCHING" && (
        <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
          <RadarAnimation />

          <div>
            <h1 className="text-xl font-bold text-content-primary">Finding a driver near you…</h1>
            <p className="mt-1 text-sm text-content-secondary">Usually takes 30–60 seconds</p>
          </div>

          {/* Trip summary chip */}
          {fareEstimate && (
            <div className="flex items-center gap-3 rounded-2xl bg-background-tertiary px-4 py-2.5">
              <span className="text-sm text-content-secondary">{tripLabel[tripType] ?? tripType}</span>
              <span className="h-1 w-1 rounded-full bg-content-secondary" />
              <FareDisplay
                amount={fareEstimate.fare_breakdown.estimated_total_paise}
                size="lg"
                className="text-content-primary"
              />
            </div>
          )}

          <CountdownRing seconds={remainingSecs} total={60} />

          {/* Cancel button (free within first 30s) */}
          {remainingSecs > 30 && activeOrderId && (
            <button
              onClick={() => {
                stopTimers();
                ordersApi.cancel(activeOrderId, "RIDER_CHANGED_MIND").catch(() => {});
                handleGoBack();
              }}
              className="rounded-full border border-border-opaque px-6 py-2.5 text-sm text-content-secondary"
            >
              Cancel (no fee)
            </button>
          )}
          {remainingSecs <= 30 && (
            <p className="text-xs text-content-secondary">Cancellation fee may apply</p>
          )}
        </div>
      )}

      {state === "TIMEOUT" && (
        <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-background-tertiary">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="var(--negative-400)" strokeWidth="1.5" />
              <path d="M12 8v4M12 16h.01" stroke="var(--negative-400)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-content-primary">No drivers available</h1>
            <p className="mt-1 text-sm text-content-secondary">
              All drivers in your area are busy right now. Try again in a few minutes.
            </p>
          </div>

          <div className="flex w-full flex-col gap-3">
            <button
              onClick={handleTryAgain}
              className="h-14 w-full rounded-2xl bg-interactive-primary text-base font-bold text-interactive-primary-text shadow-elevation-2"
            >
              Try Again
            </button>
            <button
              onClick={handleTryAgain}
              className="h-12 w-full rounded-2xl bg-background-tertiary text-sm font-medium text-content-primary"
            >
              Increase search radius
            </button>
            <button
              onClick={() => router.push("/home")}
              className="h-12 w-full rounded-2xl bg-background-tertiary text-sm font-medium text-content-secondary"
            >
              Schedule for Later
            </button>
            <button
              onClick={handleGoBack}
              className="h-12 w-full text-sm text-content-secondary"
            >
              Go Back
            </button>
          </div>
        </div>
      )}

      {assignedDriver && (
        <DriverAssignedModal driver={assignedDriver} onGoToTrip={goLive} />
      )}
    </main>
  );
}

export default function DispatchPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-background-primary" />}>
      <DispatchContent />
    </Suspense>
  );
}
