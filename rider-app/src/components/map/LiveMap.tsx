"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibre-map.css";

import { useEffect, useRef } from "react";
import type { LatLng } from "@/lib/api/types";
import { MapManager } from "@/lib/map/MapManager";

const DEFAULT_CENTER: LatLng = { lat: 22.5726, lng: 88.3639 };

export function LiveMap({ driver }: { driver: LatLng | null }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<MapManager | null>(null);

  useEffect(() => {
    const container = mapRef.current;
    if (!container || managerRef.current) return;
    const manager = new MapManager({
      container,
      center: driver ?? DEFAULT_CENTER,
      zoom: driver ? 15 : 13,
      pitch: 45,
    });
    managerRef.current = manager;
    return () => {
      manager.destroy();
      managerRef.current = null;
    };
    // Initialize once; driver updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    if (!driver) {
      manager.removeMarker("driver");
      return;
    }
    if (manager.hasMarker("driver")) manager.updateMarker("driver", driver, { animate: true });
    else manager.addMarker("driver", driver, "driver");
    manager.flyTo(driver, 15);
  }, [driver]);

  return <div ref={mapRef} aria-label="Live driver map" role="region" className="h-[60vh] w-full" />;
}

