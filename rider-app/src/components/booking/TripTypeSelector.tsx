"use client";

import type { TripType } from "@/lib/api/types";
import { useBookingStore } from "@/lib/store/bookingStore";

const TYPES: { value: TripType; label: string }[] = [
  { value: "IN_CITY_ONE_WAY", label: "One way" },
  { value: "IN_CITY_ROUND", label: "Round trip" },
  { value: "MINI_OUTSTATION", label: "Mini outstation" },
  { value: "OUTSTATION", label: "Outstation" },
];

export function TripTypeSelector() {
  const tripType = useBookingStore((s) => s.tripType);
  const setTripType = useBookingStore((s) => s.setTripType);

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {TYPES.map((t) => (
        <button
          key={t.value}
          onClick={() => setTripType(t.value)}
          className={`whitespace-nowrap rounded-full px-4 py-2 text-sm ${
            tripType === t.value ? "bg-[#0073E6] text-white" : "bg-[#252D48] text-slate-300"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
