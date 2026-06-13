"use client";

import type { LatLng } from "@/lib/api/types";
import { DriverMarker } from "./DriverMarker";

// Placeholder map surface. A real map (Google Maps / MapLibre) renders here; the
// driver marker overlays the live driver position from the trip store.
export function LiveMap({ driver }: { driver: LatLng | null }) {
  return (
    <div className="relative h-[60vh] w-full bg-background-secondary">
      <div className="absolute inset-0 flex items-center justify-center text-xs text-content-tertiary">
        Map
      </div>
      {driver && <DriverMarker lat={driver.lat} lng={driver.lng} />}
    </div>
  );
}
