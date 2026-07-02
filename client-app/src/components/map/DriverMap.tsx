'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import { useEffect, useRef } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type Marker } from 'maplibre-gl';
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

const DEFAULT_CENTER = { lat: 22.5726, lng: 88.3639 };
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const ROUTE_SOURCE_ID = 'driver-route';
const ROUTE_LAYER_ID = 'driver-route-line';
const H3_SOURCE_ID = 'driver-h3-heatmap';
const H3_FILL_LAYER_ID = 'driver-h3-fill';
const H3_LINE_LAYER_ID = 'driver-h3-line';
const BUILDINGS_LAYER_ID = 'driver-buildings-3d';

function toLngLat(point: { lat: number; lng: number }): [number, number] {
  return [point.lng, point.lat];
}

function markerElement(kind: 'driver' | 'pickup' | 'drop'): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML =
    kind === 'driver'
      ? `<div style="position:relative;width:28px;height:28px">
          <div style="position:absolute;inset:0;border-radius:999px;background:#1a5cff;opacity:.24;animation:dfu-map-pulse 1.8s ease-out infinite"></div>
          <div style="position:absolute;inset:8px;border-radius:999px;background:#1a5cff;border:2px solid white;box-shadow:0 0 18px rgba(26,92,255,.65)"></div>
        </div>`
      : `<div style="width:26px;height:34px;display:grid;place-items:center;border-radius:999px 999px 999px 4px;transform:rotate(-45deg);background:${kind === 'pickup' ? '#12a150' : '#e23b3b'};box-shadow:0 8px 24px rgba(0,0,0,.28)">
          <span style="transform:rotate(45deg);color:white;font-size:11px;font-weight:800">${kind === 'pickup' ? 'P' : 'D'}</span>
        </div>`;
  return element;
}

function enableBuildings(map: MapLibreMap): void {
  if (map.getLayer(BUILDINGS_LAYER_ID)) return;
  try {
    const firstSymbol = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
    map.addLayer(
      {
        id: BUILDINGS_LAYER_ID,
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': '#3d4b5d',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
          'fill-extrusion-opacity': 0.45,
        },
      },
      firstSymbol,
    );
  } catch {
    // Style variants can differ; the base map remains usable without extrusion.
  }
}

function h3FeatureCollection(h3Hexagons: MapH3Hex[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: h3Hexagons.flatMap((hex) => {
      try {
        const ring = cellToBoundary(hex.index).map(([lat, lng]) => [lng, lat]);
        ring.push(ring[0]);
        return [{
          type: 'Feature' as const,
          properties: {
            intensity: Math.max(0, Math.min(1, hex.intensity)),
            color: hex.color || '#ef4444',
          },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [ring],
          },
        }];
      } catch {
        return [];
      }
    }),
  };
}

export default function DriverMap({
  drivers = [],
  h3Hexagons = [],
  pickup = null,
  destination = null,
  center = DEFAULT_CENTER,
  zoom = 15,
}: DriverMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<MapLibreMap | null>(null);
  const markers = useRef<Map<string, Marker>>(new Map());
  const loaded = useRef(false);

  useEffect(() => {
    const container = mapRef.current;
    if (!container || mapInstance.current) return;

    const map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: toLngLat(center),
      zoom,
      pitch: 50,
      attributionControl: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    map.once('load', () => {
      loaded.current = true;
      enableBuildings(map);
    });
    mapInstance.current = map;

    return () => {
      markers.current.forEach((marker) => marker.remove());
      markers.current.clear();
      loaded.current = false;
      map.remove();
      mapInstance.current = null;
    };
    // Initialize once; prop updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    map.flyTo({ center: toLngLat(center), zoom: Math.max(zoom, map.getZoom()), speed: 0.8, essential: true });
  }, [center.lat, center.lng, zoom]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    const active = new Set<string>();
    drivers.forEach((driver) => {
      const id = `driver:${driver.id}`;
      active.add(id);
      const point = [driver.longitude, driver.latitude] as [number, number];
      const existing = markers.current.get(id);
      if (existing) {
        existing.setLngLat(point);
      } else {
        markers.current.set(id, new maplibregl.Marker({ element: markerElement('driver') }).setLngLat(point).addTo(map));
      }
    });

    for (const [id, marker] of markers.current.entries()) {
      if (id.startsWith('driver:') && !active.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }
  }, [drivers]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    const syncMarker = (id: string, point: { lat: number; lng: number } | null, kind: 'pickup' | 'drop') => {
      const existing = markers.current.get(id);
      if (!point) {
        existing?.remove();
        markers.current.delete(id);
        return;
      }
      if (existing) existing.setLngLat(toLngLat(point));
      else markers.current.set(id, new maplibregl.Marker({ element: markerElement(kind), anchor: 'bottom' }).setLngLat(toLngLat(point)).addTo(map));
    };

    syncMarker('pickup', pickup, 'pickup');
    syncMarker('drop', destination, 'drop');

    const route: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: pickup && destination ? [toLngLat(pickup), toLngLat(destination)] : [],
      },
    };

    const drawRoute = () => {
      const source = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
      if (source) {
        source.setData(route);
      } else {
        map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: route });
        map.addLayer({
          id: ROUTE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#1a5cff', 'line-width': 4, 'line-opacity': 0.9 },
        });
      }
    };

    if (loaded.current) drawRoute();
    else map.once('load', drawRoute);
  }, [pickup, destination]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    const data = h3FeatureCollection(h3Hexagons);

    const drawH3 = () => {
      const source = map.getSource(H3_SOURCE_ID) as GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
        return;
      }
      map.addSource(H3_SOURCE_ID, { type: 'geojson', data });
      map.addLayer({
        id: H3_FILL_LAYER_ID,
        type: 'fill',
        source: H3_SOURCE_ID,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['+', 0.08, ['*', ['get', 'intensity'], 0.35]],
        },
      });
      map.addLayer({
        id: H3_LINE_LAYER_ID,
        type: 'line',
        source: H3_SOURCE_ID,
        paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.55, 'line-width': 1 },
      });
    };

    if (loaded.current) drawH3();
    else map.once('load', drawH3);
  }, [h3Hexagons]);

  return (
    <div className="relative w-full h-full overflow-hidden rounded-2xl border border-border-opaque shadow-2xl bg-background-tertiary select-none">
      <style>{`@keyframes dfu-map-pulse{0%{transform:scale(.55);opacity:.9}100%{transform:scale(1.8);opacity:0}}`}</style>
      <div ref={mapRef} className="w-full h-full" />

      <div className="absolute top-4 left-4 z-10 flex items-center gap-2 rounded-xl border border-border-opaque/80 bg-background-secondary/80 p-2.5 text-[11px] font-semibold uppercase tracking-wider text-content-secondary shadow-lg backdrop-blur-md">
        <div className="w-2 h-2 rounded-full bg-positive-400 animate-pulse" />
        Live Map Grid
      </div>
    </div>
  );
}

