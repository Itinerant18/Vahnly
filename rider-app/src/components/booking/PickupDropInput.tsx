"use client";

import { useBookingStore } from "@/lib/store/bookingStore";

// Kolkata centre — placeholder coordinates until a geocoder / map picker is wired.
const DEFAULT_COORD = { lat: 22.5726, lng: 88.3639 };

export function PickupDropInput() {
  const pickup = useBookingStore((s) => s.pickup);
  const dropoff = useBookingStore((s) => s.dropoff);
  const setPickup = useBookingStore((s) => s.setPickup);
  const setDropoff = useBookingStore((s) => s.setDropoff);

  return (
    <div className="space-y-2">
      <input
        className="w-full rounded-lg bg-[#252D48] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#0073E6]"
        placeholder="Pickup location"
        value={pickup?.address ?? ""}
        onChange={(e) =>
          setPickup(e.target.value ? { ...DEFAULT_COORD, address: e.target.value } : null)
        }
      />
      <input
        className="w-full rounded-lg bg-[#252D48] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#0073E6]"
        placeholder="Drop location (optional)"
        value={dropoff?.address ?? ""}
        onChange={(e) =>
          setDropoff(
            e.target.value
              ? { lat: DEFAULT_COORD.lat + 0.02, lng: DEFAULT_COORD.lng + 0.02, address: e.target.value }
              : null,
          )
        }
      />
    </div>
  );
}
