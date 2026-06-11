"use client";

import type { TripStatus } from "@/lib/api/types";

const STEPS: { status: TripStatus; label: string }[] = [
  { status: "ASSIGNED", label: "Assigned" },
  { status: "EN_ROUTE_TO_PICKUP", label: "En route" },
  { status: "ARRIVED_AT_PICKUP", label: "Arrived" },
  { status: "DELIVERING", label: "In trip" },
  { status: "COMPLETED", label: "Complete" },
];

export function TripTimeline({ status }: { status: TripStatus | null }) {
  const activeIndex = STEPS.findIndex((s) => s.status === status);
  return (
    <ol className="flex items-center justify-between">
      {STEPS.map((step, i) => (
        <li key={step.status} className="flex flex-1 flex-col items-center">
          <span
            className={`h-2 w-2 rounded-full ${i <= activeIndex ? "bg-[#0073E6]" : "bg-[#252D48]"}`}
          />
          <span className="mt-1 text-[10px] text-slate-400">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
