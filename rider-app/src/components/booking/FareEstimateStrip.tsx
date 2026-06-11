"use client";

import { useBookingStore } from "@/lib/store/bookingStore";
import { formatCurrency } from "@/lib/utils/formatCurrency";

export function FareEstimateStrip() {
  const fare = useBookingStore((s) => s.fareEstimate);
  const isSearching = useBookingStore((s) => s.isSearching);

  if (isSearching && !fare) {
    return <div className="rounded-lg bg-[#1A1F3A] px-4 py-3 text-sm text-slate-400">Estimating fare…</div>;
  }
  if (!fare) return null;

  return (
    <div className="flex items-center justify-between rounded-lg bg-[#1A1F3A] px-4 py-3">
      <div>
        <p className="text-lg font-bold">
          {formatCurrency(fare.fare_breakdown.estimated_total_paise)}
        </p>
        <p className="text-xs text-slate-400">
          {fare.surge_active ? "Surge active · " : ""}
          {fare.driver_availability} availability
        </p>
      </div>
      <p className="text-xs text-slate-400">~{fare.estimated_pickup_eta_minutes} min</p>
    </div>
  );
}
