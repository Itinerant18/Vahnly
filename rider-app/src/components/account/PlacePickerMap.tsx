"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

interface Props {
  lat: number;
  lng: number;
  onPick: (lat: number, lng: number) => void;
}

const PIN_HTML = `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:var(--accent-400);transform:rotate(-45deg);border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`;

export default function PlacePickerMap({ lat, lng, onPick }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !elRef.current || mapRef.current) return;

      const map = L.map(elRef.current, { zoomControl: false, attributionControl: false }).setView(
        [lat, lng],
        15,
      );
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
      }).addTo(map);

      const icon = L.divIcon({ html: PIN_HTML, className: "", iconSize: [22, 22], iconAnchor: [11, 22] });
      const marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map);

      marker.on("dragend", () => {
        const p = marker.getLatLng();
        onPickRef.current(p.lat, p.lng);
      });
      map.on("click", (e: { latlng: { lat: number; lng: number } }) => {
        marker.setLatLng(e.latlng);
        onPickRef.current(e.latlng.lat, e.latlng.lng);
      });

      mapRef.current = map;
      markerRef.current = marker;
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep marker in sync when lat/lng change externally (e.g. current location)
  useEffect(() => {
    if (markerRef.current && mapRef.current) {
      markerRef.current.setLatLng([lat, lng]);
      mapRef.current.setView([lat, lng]);
    }
  }, [lat, lng]);

  return <div ref={elRef} className="h-56 w-full overflow-hidden rounded-2xl" />;
}
