"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type L from "leaflet";
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
    <div style="position:absolute;inset:0;border-radius:50%;background:#3B82F6;opacity:0.3;animation:pulse 2s infinite"></div>
    <div style="position:absolute;inset:4px;border-radius:50%;background:#3B82F6;border:2px solid white;box-shadow:0 0 8px #3B82F640"></div>
  </div>
`;

const DRIVER_ICON_HTML = `
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
    <circle cx="14" cy="14" r="13" fill="#FF6B35" fill-opacity="0.15" stroke="#FF6B35" stroke-width="1"/>
    <circle cx="14" cy="14" r="5" fill="#FF6B35"/>
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

    // Dynamic import to avoid SSR issues (this component is only loaded client-side)
    import("leaflet")
      .then((L) => {
        if (isCancelled || !mapRef.current) return;

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
          "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
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
      })
      .catch(() => {
        // Swallow dynamic-import / init races so they never surface as an
        // unhandledRejection in dev (StrictMode double-mount, fast-refresh).
      });

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
    import("leaflet").then((L) => {
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
    });
  }, [nearbyDrivers]);

  return (
    <div className="relative h-full w-full">
      <div ref={mapRef} className="h-full w-full" />

      {/* ETA halo */}
      {nearbyDrivers.length > 0 && (
        <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
          Drivers ~3 min away
        </div>
      )}

      {/* Recenter FAB */}
      <button
        onClick={onRecenter}
        className="absolute bottom-[136px] right-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#1E1E1E] shadow-lg ring-1 ring-white/10"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1.5" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
