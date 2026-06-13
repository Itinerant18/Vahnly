"use client";

import { useBookingStore } from "@/lib/store/bookingStore";
import { formatCurrency } from "@/lib/utils/formatCurrency";

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
        <p className="text-lg font-bold">
          {formatCurrency(fare.fare_breakdown.estimated_total_paise)}
        </p>
        <p className="text-xs text-content-secondary">
          {fare.surge_active ? "Surge active · " : ""}
          {fare.driver_availability} availability
        </p>
      </div>
      <p className="text-xs text-content-secondary">~{fare.estimated_pickup_eta_minutes} min</p>
    </div>
  );
}
