"use client";

import type { GarageCar } from "@/lib/api/types";

export function GarageCarCard({ car }: { car: GarageCar }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-background-secondary p-4">
      <div>
        <p className="text-sm font-semibold">
          {car.make} {car.model}
        </p>
        <p className="text-xs text-content-secondary">
          {car.registration_plate} · {car.transmission}
        </p>
      </div>
      {car.is_default && (
        <span className="rounded-full bg-surface-accent px-2 py-1 text-[10px] text-content-accent">
          Default
        </span>
      )}
    </div>
  );
}
