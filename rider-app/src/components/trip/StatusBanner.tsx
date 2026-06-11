"use client";

import type { TripStatus } from "@/lib/api/types";

const CONFIG: Record<TripStatus, { label: string; color: string; bg: string }> = {
  CREATED:             { label: "Finding your driver…",   color: "text-[#9CA3AF]", bg: "bg-[#1E1E1E]/95" },
  ASSIGNED:            { label: "Driver assigned",         color: "text-[#3B82F6]", bg: "bg-[#3B82F6]/10" },
  EN_ROUTE_TO_PICKUP:  { label: "Driver on the way",       color: "text-[#3B82F6]", bg: "bg-[#3B82F6]/10" },
  ARRIVED_AT_PICKUP:   { label: "Driver has arrived! 🎉",  color: "text-[#22C55E]", bg: "bg-[#22C55E]/10" },
  DELIVERING:          { label: "Trip in progress",         color: "text-[#FF6B35]", bg: "bg-[#FF6B35]/10" },
  COMPLETED:           { label: "Trip complete ✓",          color: "text-[#22C55E]", bg: "bg-[#22C55E]/10" },
  CANCELLED:           { label: "Trip cancelled",           color: "text-[#EF4444]", bg: "bg-[#EF4444]/10" },
};

export function StatusBanner({ status }: { status: TripStatus | null }) {
  const cfg = status ? CONFIG[status] : { label: "Connecting…", color: "text-[#9CA3AF]", bg: "bg-[#1E1E1E]/95" };
  return (
    <div className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 backdrop-blur-sm ${cfg.bg}`}>
      <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
    </div>
  );
}
