"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import "@/components/map/maplibre-map.css";

import { useEffect, useMemo, useRef } from "react";
import type { LatLng, TripStatus } from "@/lib/api/types";
import { MapManager } from "@/lib/map/MapManager";

interface TripMapProps {
  pickup: LatLng | null;
  dropoff?: LatLng | null;
  driverLat: number | null;
  driverLng: number | null;
  driverBearing: number;
  tripStatus: TripStatus | null;
  etaMinutes: number | null;
}

const DEFAULT_CENTER: LatLng = { lat: 22.5726, lng: 88.3639 };

function activeRoutePoints(status: TripStatus | null, driver: LatLng | null, pickup: LatLng | null, dropoff: LatLng | null): LatLng[] {
  if (status === "DELIVERING" && driver && dropoff) return [driver, dropoff];
  if ((status === "EN_ROUTE_TO_PICKUP" || status === "ASSIGNED") && driver && pickup) return [driver, pickup];
  if (pickup && dropoff) return [pickup, dropoff];
  return [];
}

export default function TripMap({
  pickup,
  dropoff = null,
  driverLat,
  driverLng,
  tripStatus,
  etaMinutes,
}: TripMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<MapManager | null>(null);
  const driver = useMemo(
    () => (driverLat != null && driverLng != null ? { lat: driverLat, lng: driverLng } : null),
    [driverLat, driverLng],
  );
  const center = driver ?? pickup ?? dropoff ?? DEFAULT_CENTER;

  useEffect(() => {
    const container = mapRef.current;
    if (!container || managerRef.current) return;
    const manager = new MapManager({ container, center, zoom: 15, pitch: 50 });
    managerRef.current = manager;
    return () => {
      manager.destroy();
      managerRef.current = null;
    };
    // Map lifecycle is initialized once; moving data is handled by effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;

    if (pickup) manager.addMarker("pickup", pickup, "pickup");
    else manager.removeMarker("pickup");

    if (dropoff && tripStatus === "DELIVERING") manager.addMarker("dropoff", dropoff, "dropoff");
    else manager.removeMarker("dropoff");
  }, [pickup, dropoff, tripStatus]);

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    if (driver) {
      if (manager.hasMarker("driver")) {
        manager.updateMarker("driver", driver, { animate: true });
      } else {
        manager.addMarker("driver", driver, "driver");
      }
    } else {
      manager.removeMarker("driver");
    }
  }, [driver]);

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    const routePoints = activeRoutePoints(tripStatus, driver, pickup, dropoff);
    void manager.drawRoute(routePoints);
    manager.fitToMarkers(routePoints);
  }, [tripStatus, driver, pickup, dropoff]);

  return (
    <div className="relative h-full w-full">
      <div ref={mapRef} aria-label="Live trip map" role="region" className="h-full w-full" />
      {etaMinutes != null && (
        <div className="absolute left-1/2 top-[104px] z-10 -translate-x-1/2 rounded-full border border-border-opaque bg-background-primary/85 px-3 py-1 text-label-small font-semibold text-accent-400 shadow-elevation-1 backdrop-blur-sm">
          {etaMinutes} min
        </div>
      )}
    </div>
  );
}
