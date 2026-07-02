"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibre-map.css";

import { useEffect, useRef, useState } from "react";
import { Navigation } from "lucide-react";
import { MapManager } from "@/lib/map/MapManager";
import type { LatLng, LocationPoint } from "@/lib/api/types";

interface NearbyDriver {
  id: string;
  lat: number;
  lng: number;
  bearing?: number;
}

interface RiderMapProps {
  center?: LatLng;
  pickup?: LocationPoint | null;
  dropoff?: LocationPoint | null;
  nearbyDrivers?: NearbyDriver[];
  onRecenter?: () => void;
}

const DEFAULT_CENTER: LatLng = { lat: 22.5726, lng: 88.3639 };

function routePreviewPoints(pickup?: LocationPoint | null, dropoff?: LocationPoint | null): LatLng[] {
  if (!pickup || !dropoff) return [];
  return [pickup, dropoff];
}

export default function RiderMap({
  center,
  pickup,
  dropoff,
  nearbyDrivers = [],
  onRecenter,
}: RiderMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<MapManager | null>(null);
  const [recenterSpin, setRecenterSpin] = useState(false);

  const centerLat = center?.lat ?? DEFAULT_CENTER.lat;
  const centerLng = center?.lng ?? DEFAULT_CENTER.lng;

  useEffect(() => {
    const container = mapRef.current;
    if (!container || managerRef.current) return;
    const manager = new MapManager({
      container,
      center: { lat: centerLat, lng: centerLng },
      zoom: 14,
      pitch: 45,
    });
    managerRef.current = manager;
    manager.addMarker("user", { lat: centerLat, lng: centerLng }, "user");
    return () => {
      manager.destroy();
      managerRef.current = null;
    };
    // The manager owns lifecycle; prop changes are handled by separate effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    const point = { lat: centerLat, lng: centerLng };
    manager.updateMarker("user", point, { animate: true });
    manager.flyTo(point, 14);
  }, [centerLat, centerLng]);

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    if (pickup) manager.addMarker("pickup", pickup, "pickup");
    else manager.removeMarker("pickup");
    manager.fitToMarkers(routePreviewPoints(pickup, dropoff));
  }, [pickup, dropoff]);

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    if (dropoff) manager.addMarker("dropoff", dropoff, "dropoff");
    else manager.removeMarker("dropoff");
    void manager.drawRoute(routePreviewPoints(pickup, dropoff));
    manager.fitToMarkers(routePreviewPoints(pickup, dropoff));
  }, [dropoff, pickup]);

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    manager.clearMarkers("driver:");
    nearbyDrivers.forEach((driver) => {
      manager.addMarker(`driver:${driver.id}`, { lat: driver.lat, lng: driver.lng }, "driver");
    });
  }, [nearbyDrivers]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={mapRef}
        role="region"
        aria-label="Map of nearby drivers"
        className="h-full w-full"
      />

      {nearbyDrivers.length > 0 && (
        <div className="absolute left-1/2 top-16 z-10 -translate-x-1/2 rounded-full border border-border-opaque bg-background-primary/85 px-4 py-1.5 text-xs font-medium text-content-primary shadow-elevation-1 backdrop-blur-sm">
          {nearbyDrivers.length} {nearbyDrivers.length === 1 ? "driver" : "drivers"} nearby
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setRecenterSpin(true);
          window.setTimeout(() => setRecenterSpin(false), 400);
          onRecenter?.();
        }}
        aria-label="Recenter map"
        className="absolute bottom-[136px] right-4 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-background-primary text-content-primary shadow-elevation-2 ring-1 ring-border-opaque transition-transform active:scale-90"
      >
        <Navigation
          aria-hidden="true"
          className={recenterSpin ? "animate-spin" : ""}
          size={20}
          strokeWidth={1.8}
          style={{ animationDuration: "400ms" }}
        />
      </button>
    </div>
  );
}

