"use client";

import { useBookingStore } from "@/lib/store/bookingStore";
import { FareDisplay } from "@/components/ds";

export function FareEstimateStrip() {
  const fare = useBookingStore((s) => s.fareEstimate);
  const isSearching = useBookingStore((s) => s.isSearching);

  if (isSearching && !fare) {
    return <div className="rounded-lg bg-background-secondary px-4 py-3 text-sm text-content-secondary">Estimating fare…</div>;
  }
  if (!fare) return null;

  return (
    <div className="flex items-center justify-between rounded-lg bg-background-secondary px-4 py-3">
      <div>
        <FareDisplay
          amount={fare.fare_breakdown.estimated_total_paise}
          size="lg"
          className="font-bold"
        />
        <p className="text-xs text-content-secondary">
          {fare.surge_active ? "Surge active · " : ""}
          {fare.driver_availability} availability
        </p>
      </div>
      <p className="text-xs text-content-secondary">
        ~<span className="font-mono tabular-nums">{fare.estimated_pickup_eta_minutes}</span> min
      </p>
    </div>
  );
}
