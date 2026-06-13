"use client";

import type { TripStatus } from "@/lib/api/types";

type StatusConfig = {
  label: string;
  cls: string; // full className string for the banner
};

const CONFIG: Record<TripStatus, StatusConfig> = {
  CREATED: {
    label: "Finding your driver…",
    cls: "bg-background-primary/90 text-content-secondary border border-border-opaque backdrop-blur-sm",
  },
  ASSIGNED: {
    label: "Driver assigned",
    cls: "bg-accent-400 text-white",
  },
  EN_ROUTE_TO_PICKUP: {
    label: "Driver on the way",
    cls: "bg-accent-400 text-white",
  },
  ARRIVED_AT_PICKUP: {
    label: "Driver has arrived! 🎉",
    cls: "bg-positive-400 text-white",
  },
  DELIVERING: {
    label: "Trip in progress",
    cls: "bg-background-inverse text-content-inverse",
  },
  COMPLETED: {
    label: "Trip complete ✓",
    cls: "bg-positive-400 text-white",
  },
  CANCELLED: {
    label: "Trip cancelled",
    cls: "bg-negative-400 text-white",
  },
};

export function StatusBanner({ status }: { status: TripStatus | null }) {
  const cfg = status
    ? CONFIG[status]
    : { label: "Connecting…", cls: "bg-background-primary/90 text-content-secondary border border-border-opaque backdrop-blur-sm" };

  return (
    <div className={`flex items-center justify-center gap-2 rounded-md px-4 py-3 ${cfg.cls}`}>
      <span className="text-label-medium font-semibold">{cfg.label}</span>
    </div>
  );
}
