"use client";

import { useState } from "react";
import { useTripStore } from "@/lib/store/tripStore";

export function TripActions({ tripId }: { tripId?: string }) {
  const cancelTrip = useTripStore((s) => s.cancelTrip);
  const triggerSOS = useTripStore((s) => s.triggerSOS);
  const status = useTripStore((s) => s.tripStatus);
  const activeOrder = useTripStore((s) => s.activeOrder);
  const id = tripId ?? activeOrder?.id ?? "";
  const [busy, setBusy] = useState(false);

  const cancellable = status === "CREATED" || status === "ASSIGNED" || status === "EN_ROUTE_TO_PICKUP";
  const inTrip = status === "DELIVERING";

  const onCancel = async () => {
    setBusy(true);
    try {
      await cancelTrip("rider cancelled");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex gap-2" data-trip-id={id}>
      {cancellable && (
        <button
          className="flex-1 rounded-lg bg-[#EF4444]/20 py-3 text-sm font-semibold text-[#EF4444] disabled:opacity-50"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel trip
        </button>
      )}
      {inTrip && (
        <button
          className="flex-1 rounded-lg bg-[#EF4444] py-3 text-sm font-semibold text-white"
          onClick={() => triggerSOS()}
        >
          SOS
        </button>
      )}
    </div>
  );
}
