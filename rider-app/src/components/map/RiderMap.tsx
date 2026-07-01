"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import L from "leaflet";
import type { LocationPoint } from "@/lib/api/types";

interface NearbyDriver {
  id: string;
  lat: number;
  lng: number;
  bearing?: number;
}

interface RiderMapProps {
  center?: { lat: number; lng: number };
  pickup?: LocationPoint | null;
  dropoff?: LocationPoint | null;
  nearbyDrivers?: NearbyDriver[];
  onRecenter?: () => void;
}

const USER_ICON_HTML = `
  <div style="position:relative;width:20px;height:20px">
    <div style="position:absolute;inset:0;border-radius:50%;background:var(--accent-400);opacity:0.3;animation:pulse 2s infinite"></div>
    <div style="position:absolute;inset:4px;border-radius:50%;background:var(--accent-400);border:2px solid var(--content-primary);box-shadow:0 0 8px var(--accent-400)"></div>
  </div>
`;

const DRIVER_ICON_HTML = `
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
    <circle cx="14" cy="14" r="13" fill="var(--accent-400)" fill-opacity="0.15" stroke="var(--accent-400)" stroke-width="1"/>
    <circle cx="14" cy="14" r="5" fill="var(--accent-400)"/>
  </svg>
`;

export default function RiderMap({ center, pickup, nearbyDrivers = [], onRecenter }: RiderMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const userMarker = useRef<L.Marker | null>(null);
  const driverMarkers = useRef<L.Marker[]>([]);

  const defaultCenter = center ?? { lat: 22.5726, lng: 88.3639 };

  useEffect(() => {
    let isCancelled = false;
    let createdMap: L.Map | null = null;

    const container = mapRef.current;
    if (!container) return;

    // A previous map (StrictMode re-invoke / HMR) may still own this DOM
    // node. Bail rather than let L.map throw "already initialized".
    if (leafletMap.current || (container as any)._leaflet_id != null) return;

    let map: L.Map;
    try {
      map = L.map(container, {
        center: [defaultCenter.lat, defaultCenter.lng],
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
      });
    } catch {
      // Container still bound to a stale Leaflet instance — skip this pass.
      return;
    }

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      { subdomains: "abcd", maxZoom: 19 }
    ).addTo(map);

    // User location marker
    const userIcon = L.divIcon({
      html: USER_ICON_HTML,
      className: "",
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    const uMarker = L.marker([defaultCenter.lat, defaultCenter.lng], { icon: userIcon }).addTo(map);
    userMarker.current = uMarker;

    createdMap = map;
    leafletMap.current = map;

    return () => {
      isCancelled = true;
      const map = createdMap ?? leafletMap.current;
      if (map) {
        map.remove();
      }
      // Clear Leaflet's container binding so a remount can re-initialize cleanly.
      delete (container as any)._leaflet_id;
      leafletMap.current = null;
      userMarker.current = null;
      driverMarkers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update map center / user marker when location changes
  useEffect(() => {
    if (!leafletMap.current || !center) return;
    leafletMap.current.setView([center.lat, center.lng], leafletMap.current.getZoom(), { animate: true });
    userMarker.current?.setLatLng([center.lat, center.lng]);
  }, [center?.lat, center?.lng]);

  // Update nearby driver markers
  useEffect(() => {
    if (!leafletMap.current) return;
    // Remove old markers
    driverMarkers.current.forEach((m) => m.remove());
    driverMarkers.current = [];

    const driverIcon = L.divIcon({
      html: DRIVER_ICON_HTML,
      className: "",
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    nearbyDrivers.forEach((d) => {
      const m = L.marker([d.lat, d.lng], { icon: driverIcon }).addTo(leafletMap.current!);
      driverMarkers.current.push(m);
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

      {/* Driver-count halo — hidden when no drivers are nearby */}
      {nearbyDrivers.length > 0 && (
        <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-background-secondary/80 border border-border-opaque px-4 py-1.5 text-xs font-medium text-content-primary backdrop-blur-sm">
          {nearbyDrivers.length} {nearbyDrivers.length === 1 ? "driver" : "drivers"} nearby
        </div>
      )}

      {/* Recenter FAB */}
      <button
        onClick={onRecenter}
        aria-label="Recenter map"
        className="absolute bottom-[136px] right-4 flex h-12 w-12 items-center justify-center rounded-full bg-background-tertiary shadow-lg ring-1 ring-border-opaque"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
