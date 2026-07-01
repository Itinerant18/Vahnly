"use client";

import type { ReactNode } from "react";
import type { TripStatus } from "@/lib/api/types";
import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";

const CheckCircle = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8.5 12.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

type StatusConfig = {
  label: string;
  cls: string; // full className string for the banner
  icon?: ReactNode;
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
    label: "Driver traveling to your car",
    cls: "bg-accent-400 text-white",
  },
  ARRIVED_AT_PICKUP: {
    label: "Driver has arrived",
    cls: "bg-positive-400 text-white",
    icon: CheckCircle,
  },
  DELIVERING: {
    label: "Trip in progress",
    cls: "bg-background-inverse text-content-inverse",
  },
  WAITING: {
    label: "Driver waiting — meter running",
    cls: "bg-accent-400 text-white",
  },
  COMPLETED: {
    label: "Trip complete",
    cls: "bg-positive-400 text-white",
    icon: CheckCircle,
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
    <div role="status" aria-live="polite" className={`flex items-center justify-center gap-2 rounded-md px-4 py-3 ${cfg.cls}`}>
      {cfg.icon}
      <AnimatedShinyText shimmerWidth={60} className="!text-inherit !max-w-none">
        {cfg.label}
      </AnimatedShinyText>
    </div>
  );
}
