"use client";

import type { GarageCar } from "@/lib/api/types";
import { useBookingStore } from "@/lib/store/bookingStore";

export function CarSelector({ cars }: { cars: GarageCar[] }) {
  const selectedCarId = useBookingStore((s) => s.selectedCarId);
  const setSelectedCar = useBookingStore((s) => s.setSelectedCar);

  return (
    <div className="space-y-2">
      {cars.map((car) => (
        <button
          key={car.id}
          onClick={() => setSelectedCar(car.id)}
          className={`flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm ${
            selectedCarId === car.id ? "bg-[#0073E6]/20 ring-1 ring-[#0073E6]" : "bg-[#252D48]"
          }`}
        >
          <span>
            {car.make} {car.model}
          </span>
          <span className="text-xs text-slate-400">{car.transmission}</span>
        </button>
      ))}
    </div>
  );
}
