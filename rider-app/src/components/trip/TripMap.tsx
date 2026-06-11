"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { TripStatus } from "@/lib/api/types";

interface TripMapProps {
  pickup: { lat: number; lng: number } | null;
  dropoff?: { lat: number; lng: number } | null;
  driverLat: number | null;
  driverLng: number | null;
  driverBearing: number;
  tripStatus: TripStatus | null;
  etaMinutes: number | null;
}

function driverIconHtml(bearing: number): string {
  return `<div style="transform:rotate(${bearing}deg);width:36px;height:36px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 2px 6px #FF6B3540)">
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <circle cx="14" cy="14" r="13" fill="#FF6B35" fill-opacity="0.15" stroke="#FF6B35"/>
      <path d="M14 6l3 4H11l3-4z" fill="#FF6B35"/>
      <rect x="10" y="10" width="8" height="10" rx="1.5" fill="#FF6B35"/>
      <rect x="10.5" y="10.5" width="7" height="4" rx="0.5" fill="white" fill-opacity="0.4"/>
      <circle cx="11.5" cy="21" r="1.5" fill="#1E1E1E"/>
      <circle cx="16.5" cy="21" r="1.5" fill="#1E1E1E"/>
    </svg>
  </div>`;
}

const USER_PIN_HTML = `
  <div style="position:relative;width:18px;height:18px">
    <div style="position:absolute;inset:-4px;border-radius:50%;background:#22C55E;opacity:0.25;animation:ping 2s ease-out infinite"></div>
    <div style="width:18px;height:18px;border-radius:50%;background:#22C55E;border:2px solid white;box-shadow:0 0 8px #22C55E60"></div>
  </div>`;

const DROP_PIN_HTML = `
  <div style="width:16px;height:16px;border-radius:50%;background:#EF4444;border:2px solid white;box-shadow:0 0 8px #EF444460"></div>`;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

export default function TripMap({
  pickup,
  dropoff,
  driverLat,
  driverLng,
  driverBearing,
  tripStatus,
  etaMinutes,
}: TripMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<import("leaflet").Map | null>(null);
  const driverMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const pickupMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const dropoffMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const polylineRef = useRef<import("leaflet").Polyline | null>(null);
  const etaLabelRef = useRef<import("leaflet").Marker | null>(null);
  const rafRef = useRef<number>(0);

  const interpRef = useRef({
    fromLat: 0, fromLng: 0,
    toLat: 0, toLng: 0,
    startMs: 0, durationMs: 5000,
    bearing: 0,
    initialized: false,
  });

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;
    const center = pickup ?? { lat: 22.5726, lng: 88.3639 };

    import("leaflet").then((L) => {
      const map = L.map(mapRef.current!, {
        center: [center.lat, center.lng],
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd", maxZoom: 19,
      }).addTo(map);

      // Pickup marker
      if (pickup) {
        const userIcon = L.divIcon({ html: USER_PIN_HTML, className: "", iconSize: [18, 18], iconAnchor: [9, 9] });
        pickupMarkerRef.current = L.marker([pickup.lat, pickup.lng], { icon: userIcon }).addTo(map);
      }

      // Dropoff marker (hidden until DELIVERING)
      if (dropoff) {
        const dropIcon = L.divIcon({ html: DROP_PIN_HTML, className: "", iconSize: [16, 16], iconAnchor: [8, 8] });
        const dm = L.marker([dropoff.lat, dropoff.lng], { icon: dropIcon, opacity: 0 });
        dm.addTo(map);
        dropoffMarkerRef.current = dm;
      }

      // Driver marker (starts at pickup until we get real location)
      const driverIcon = L.divIcon({ html: driverIconHtml(0), className: "", iconSize: [36, 36], iconAnchor: [18, 18] });
      const startLat = driverLat ?? center.lat;
      const startLng = driverLng ?? center.lng;
      const dm = L.marker([startLat, startLng], { icon: driverIcon }).addTo(map);
      driverMarkerRef.current = dm;
      interpRef.current = { fromLat: startLat, fromLng: startLng, toLat: startLat, toLng: startLng, startMs: Date.now(), durationMs: 5000, bearing: 0, initialized: false };

      // Polyline
      polylineRef.current = L.polyline([], { color: "#FF6B35", weight: 3, dashArray: "6 4" }).addTo(map);

      // ETA label marker
      const etaIcon = L.divIcon({ html: `<div id="eta-label" style="background:#000000cc;color:#FF6B35;font-size:11px;font-weight:bold;padding:2px 6px;border-radius:8px;white-space:nowrap"></div>`, className: "", iconSize: [70, 22], iconAnchor: [35, 11] });
      etaLabelRef.current = L.marker([center.lat, center.lng], { icon: etaIcon, interactive: false }).addTo(map);

      leafletMapRef.current = map;
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      leafletMapRef.current?.remove();
      leafletMapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When new driver location arrives, update interpolation target
  useEffect(() => {
    if (driverLat === null || driverLng === null || !driverMarkerRef.current) return;
    const cur = driverMarkerRef.current.getLatLng();
    interpRef.current = {
      fromLat: cur.lat, fromLng: cur.lng,
      toLat: driverLat, toLng: driverLng,
      startMs: Date.now(), durationMs: 5000,
      bearing: driverBearing,
      initialized: true,
    };
  }, [driverLat, driverLng, driverBearing]);

  // Show/hide dropoff marker based on status
  useEffect(() => {
    if (!dropoffMarkerRef.current) return;
    dropoffMarkerRef.current.setOpacity(tripStatus === "DELIVERING" ? 1 : 0);
  }, [tripStatus]);

  // rAF loop: interpolate driver position + update polyline + ETA label
  useEffect(() => {
    const animate = () => {
      const interp = interpRef.current;
      if (driverMarkerRef.current && interp.initialized) {
        const elapsed = Date.now() - interp.startMs;
        const t = easeInOut(Math.min(1, elapsed / interp.durationMs));
        const lat = lerp(interp.fromLat, interp.toLat, t);
        const lng = lerp(interp.fromLng, interp.toLng, t);
        driverMarkerRef.current.setLatLng([lat, lng]);

        // Rotate driver icon
        const el = driverMarkerRef.current.getElement();
        if (el) {
          const inner = el.firstElementChild as HTMLElement | null;
          if (inner) inner.style.transform = `rotate(${interp.bearing}deg)`;
        }

        // Update polyline
        if (polylineRef.current) {
          if (tripStatus === "EN_ROUTE_TO_PICKUP" && pickup) {
            polylineRef.current.setLatLngs([[lat, lng], [pickup.lat, pickup.lng]]);
            const midLat = (lat + pickup.lat) / 2;
            const midLng = (lng + pickup.lng) / 2;
            etaLabelRef.current?.setLatLng([midLat, midLng]);
            const el2 = etaLabelRef.current?.getElement()?.firstElementChild as HTMLElement | null;
            if (el2 && etaMinutes !== null) el2.textContent = `${etaMinutes} min`;
          } else if (tripStatus === "DELIVERING" && pickup && dropoff) {
            polylineRef.current.setLatLngs([[pickup.lat, pickup.lng], [dropoff.lat, dropoff.lng]]);
            const midLat = (pickup.lat + dropoff.lat) / 2;
            const midLng = (pickup.lng + dropoff.lng) / 2;
            etaLabelRef.current?.setLatLng([midLat, midLng]);
          } else {
            polylineRef.current.setLatLngs([]);
          }
        }
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tripStatus, pickup, dropoff, etaMinutes]);

  return <div ref={mapRef} className="h-full w-full" />;
}
