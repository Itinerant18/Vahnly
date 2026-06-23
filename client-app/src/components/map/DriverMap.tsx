'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type L from 'leaflet';
import { cellToBoundary } from 'h3-js';

export interface MapDriver {
  id: string;
  latitude: number;
  longitude: number;
  bearing: number;
  speed: number;
}

export interface MapH3Hex {
  index: string;
  intensity: number;
  color: string;
}

interface DriverMapProps {
  drivers?: MapDriver[];
  h3Hexagons?: MapH3Hex[];
  pickup?: { lat: number; lng: number } | null;
  destination?: { lat: number; lng: number } | null;
  center?: { lat: number; lng: number };
  zoom?: number;
  theme?: 'light' | 'dark';
}

const DRIVER_ICON_HTML = `
  <div style="position:relative;width:24px;height:24px">
    <div style="position:absolute;inset:0;border-radius:50%;background:var(--accent-400);opacity:0.25;animation:pulse 2s infinite"></div>
    <div style="position:absolute;inset:4px;border-radius:50%;background:var(--accent-400);border:2px solid var(--content-primary);box-shadow:0 0 8px var(--accent-400)"></div>
  </div>
`;

export default function DriverMap({
  drivers = [],
  h3Hexagons = [],
  pickup = null,
  destination = null,
  center = { lat: 22.5726, lng: 88.3639 },
  zoom = 15,
}: DriverMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const driverMarkers = useRef<L.Marker[]>([]);
  const polygonLayers = useRef<L.Polygon[]>([]);
  const pickupMarker = useRef<L.Marker | null>(null);
  const destinationMarker = useRef<L.Marker | null>(null);
  const routePolyline = useRef<L.Polyline | null>(null);

  const defaultCenter = center ?? { lat: 22.5726, lng: 88.3639 };

  useEffect(() => {
    let isCancelled = false;
    let createdMap: L.Map | null = null;

    const container = mapRef.current;
    if (!container) return;

    import('leaflet')
      .then((L) => {
        if (isCancelled || !mapRef.current) return;

        if (leafletMap.current || (container as any)._leaflet_id != null) return;

        let map: L.Map;
        try {
          map = L.map(container, {
            center: [defaultCenter.lat, defaultCenter.lng],
            zoom: zoom,
            zoomControl: false,
            attributionControl: false,
          });
        } catch {
          return;
        }

        L.tileLayer(
          'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
          { subdomains: 'abcd', maxZoom: 19 }
        ).addTo(map);

        createdMap = map;
        leafletMap.current = map;
      })
      .catch(() => {});

    return () => {
      isCancelled = true;
      const map = createdMap ?? leafletMap.current;
      if (map) {
        map.remove();
      }
      delete (container as any)._leaflet_id;
      leafletMap.current = null;
      pickupMarker.current = null;
      destinationMarker.current = null;
      routePolyline.current = null;
      driverMarkers.current = [];
      polygonLayers.current = [];
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Recenter map when prop changes
  const centerLat = center?.lat;
  const centerLng = center?.lng;
  useEffect(() => {
    if (!leafletMap.current || centerLat === undefined || centerLng === undefined) return;
    leafletMap.current.setView([centerLat, centerLng], leafletMap.current.getZoom(), { animate: true });
  }, [centerLat, centerLng]);

  // Update drivers
  useEffect(() => {
    if (!leafletMap.current) return;
    import('leaflet').then((L) => {
      // Clear old driver markers
      driverMarkers.current.forEach((m) => m.remove());
      driverMarkers.current = [];

      const driverIcon = L.divIcon({
        html: DRIVER_ICON_HTML,
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      drivers.forEach((d) => {
        const m = L.marker([d.latitude, d.longitude], { icon: driverIcon }).addTo(leafletMap.current!);
        driverMarkers.current.push(m);
      });
    });
  }, [drivers]);

  // Update Pickup & Destination markers + route polyline
  useEffect(() => {
    if (!leafletMap.current) return;
    import('leaflet').then((L) => {
      // Clear pickup marker
      if (pickupMarker.current) {
        pickupMarker.current.remove();
        pickupMarker.current = null;
      }
      if (pickup) {
        const pickupIcon = L.divIcon({
          html: `<div style="position:relative;width:20px;height:20px"><div style="position:absolute;inset:0;border-radius:50%;background:var(--positive-400);opacity:0.3;animation:pulse 2s infinite"></div><div style="position:absolute;inset:5px;border-radius:50%;background:var(--positive-400);border:2.5px solid var(--content-primary)"></div></div>`,
          className: '',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        });
        pickupMarker.current = L.marker([pickup.lat, pickup.lng], { icon: pickupIcon }).addTo(leafletMap.current!);
      }

      // Clear destination marker
      if (destinationMarker.current) {
        destinationMarker.current.remove();
        destinationMarker.current = null;
      }
      if (destination) {
        const dropIcon = L.divIcon({
          html: `<div style="position:relative;width:20px;height:20px"><div style="position:absolute;inset:0;border-radius:50%;background:var(--negative-400);opacity:0.3;animation:pulse 2s infinite"></div><div style="position:absolute;inset:5px;border-radius:50%;background:var(--negative-400);border:2.5px solid var(--content-primary)"></div></div>`,
          className: '',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        });
        destinationMarker.current = L.marker([destination.lat, destination.lng], { icon: dropIcon }).addTo(leafletMap.current!);
      }

      // Clear polyline
      if (routePolyline.current) {
        routePolyline.current.remove();
        routePolyline.current = null;
      }
      if (pickup && destination) {
        routePolyline.current = L.polyline(
          [
            [pickup.lat, pickup.lng],
            [destination.lat, destination.lng],
          ],
          {
            color: 'var(--accent-400)',
            weight: 3,
            opacity: 0.8,
          }
        ).addTo(leafletMap.current!);
      }
    });
  }, [pickup, destination]);

  // Update H3 Hexagon Surges
  useEffect(() => {
    if (!leafletMap.current) return;
    import('leaflet').then((L) => {
      // Clear old hexagon polygons
      polygonLayers.current.forEach((p) => p.remove());
      polygonLayers.current = [];

      h3Hexagons.forEach((hex) => {
        try {
          const boundary = cellToBoundary(hex.index); // Array of [lat, lng]
          const poly = L.polygon(
            boundary.map(([lat, lng]) => [lat, lng]),
            {
              fillColor: hex.color || 'var(--negative-400)',
              fillOpacity: hex.intensity * 0.3 || 0.1,
              color: hex.color || 'var(--negative-400)',
              weight: 1,
              opacity: 0.5,
            }
          ).addTo(leafletMap.current!);
          polygonLayers.current.push(poly);
        } catch (e) {
          console.warn('[DriverMap] Failed to render H3 Hexagon:', hex.index, e);
        }
      });
    });
  }, [h3Hexagons]);

  return (
    <div className="relative w-full h-full overflow-hidden rounded-2xl border border-border-opaque shadow-2xl bg-background-tertiary select-none">
      <div ref={mapRef} className="w-full h-full" />

      <div className="absolute top-4 left-4 p-2.5 rounded-xl border border-border-opaque/80 bg-background-secondary/70 backdrop-blur-md shadow-lg flex items-center gap-2 z-[1000]">
        <div className="w-2 h-2 rounded-full bg-positive-400 animate-pulse" />
        <span className="text-[11px] font-semibold text-content-secondary uppercase tracking-wider">
          Live Map Grid (CartoDB)
        </span>
      </div>
    </div>
  );
}
