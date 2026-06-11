"use client";

import type { GarageCar } from "@/lib/api/types";

export function GarageCarCard({ car }: { car: GarageCar }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-[#1A1F3A] p-4">
      <div>
        <p className="text-sm font-semibold">
          {car.make} {car.model}
        </p>
        <p className="text-xs text-slate-400">
          {car.registration_plate} · {car.transmission}
        </p>
      </div>
      {car.is_default && (
        <span className="rounded-full bg-[#0073E6]/20 px-2 py-1 text-[10px] text-[#0073E6]">
          Default
        </span>
      )}
    </div>
  );
}
