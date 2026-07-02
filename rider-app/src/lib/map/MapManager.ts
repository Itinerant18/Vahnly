"use client";

import maplibregl, {
  type GeoJSONSource,
  type LngLatBoundsLike,
  type Map as MapLibreMap,
  type Marker,
} from "maplibre-gl";
import type { LatLng } from "@/lib/api/types";

export type MapMarkerKind = "driver" | "pickup" | "dropoff" | "user";

export interface MapManagerOptions {
  container: HTMLElement;
  center?: LatLng;
  zoom?: number;
  pitch?: number;
}

const DEFAULT_CENTER: LatLng = { lat: 22.5726, lng: 88.3639 };
const DEFAULT_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const ROUTE_SOURCE_ID = "dfu-route";
const ROUTE_GLOW_LAYER_ID = "dfu-route-glow";
const ROUTE_LAYER_ID = "dfu-route-line";
const BUILDINGS_LAYER_ID = "dfu-buildings-3d";

function toLngLat(point: LatLng): [number, number] {
  return [point.lng, point.lat];
}

function markerHtml(kind: MapMarkerKind): string {
  if (kind === "driver") {
    return `
      <div class="dfu-map-marker dfu-map-marker-driver">
        <span class="dfu-map-marker-pulse"></span>
        <span class="dfu-map-marker-core"></span>
      </div>
    `;
  }

  const label = kind === "pickup" ? "P" : kind === "dropoff" ? "D" : "";
  const tone = kind === "pickup" ? "pickup" : kind === "dropoff" ? "dropoff" : "user";
  return `
    <div class="dfu-map-pin dfu-map-pin-${tone}" aria-hidden="true">
      ${label ? `<span>${label}</span>` : ""}
    </div>
  `;
}

function makeMarkerElement(kind: MapMarkerKind): HTMLElement {
  const element = document.createElement("div");
  element.className = "dfu-map-marker-wrap";
  element.innerHTML = markerHtml(kind);
  return element;
}

export class MapManager {
  private readonly map: MapLibreMap;
  private readonly markers = new Map<string, Marker>();
  private readonly markerPositions = new Map<string, LatLng>();
  private loaded = false;
  private loadPromise: Promise<void>;

  constructor(options: MapManagerOptions) {
    const center = options.center ?? DEFAULT_CENTER;
    this.map = new maplibregl.Map({
      container: options.container,
      style: DEFAULT_STYLE,
      center: toLngLat(center),
      zoom: options.zoom ?? 14,
      pitch: options.pitch ?? 45,
      bearing: 0,
      attributionControl: false,
    });

    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    this.loadPromise = new Promise((resolve) => {
      this.map.once("load", () => {
        this.loaded = true;
        this.enableBuildings();
        resolve();
      });
    });
  }

  ready(): Promise<void> {
    return this.loadPromise;
  }

  addMarker(id: string, point: LatLng, kind: MapMarkerKind): void {
    if (this.markers.has(id)) {
      this.updateMarker(id, point);
      return;
    }
    this.removeMarker(id);
    const marker = new maplibregl.Marker({
      element: makeMarkerElement(kind),
      anchor: kind === "pickup" || kind === "dropoff" ? "bottom" : "center",
    })
      .setLngLat(toLngLat(point))
      .addTo(this.map);
    this.markers.set(id, marker);
    this.markerPositions.set(id, point);
  }

  hasMarker(id: string): boolean {
    return this.markers.has(id);
  }

  updateMarker(id: string, point: LatLng, options: { animate?: boolean } = {}): void {
    const marker = this.markers.get(id);
    if (!marker) return;

    const previous = this.markerPositions.get(id);
    this.markerPositions.set(id, point);
    if (!options.animate || !previous) {
      marker.setLngLat(toLngLat(point));
      return;
    }

    const startedAt = performance.now();
    const durationMs = 650;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      marker.setLngLat([
        previous.lng + (point.lng - previous.lng) * eased,
        previous.lat + (point.lat - previous.lat) * eased,
      ]);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  removeMarker(id: string): void {
    this.markers.get(id)?.remove();
    this.markers.delete(id);
    this.markerPositions.delete(id);
  }

  clearMarkers(prefix?: string): void {
    for (const id of this.markers.keys()) {
      if (!prefix || id.startsWith(prefix)) this.removeMarker(id);
    }
  }

  async drawRoute(points: LatLng[]): Promise<void> {
    await this.ready();
    if (points.length < 2) {
      this.clearRoute();
      return;
    }

    const data: GeoJSON.Feature<GeoJSON.LineString> = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: points.map(toLngLat),
      },
    };

    const source = this.map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
      return;
    }

    this.map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data });
    this.map.addLayer({
      id: ROUTE_GLOW_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#1a5cff",
        "line-width": 10,
        "line-opacity": 0.22,
        "line-blur": 4,
      },
    });
    this.map.addLayer({
      id: ROUTE_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#4A6FA5",
        "line-width": 4,
        "line-opacity": 0.95,
      },
    });
  }

  clearRoute(): void {
    if (!this.loaded) return;
    if (this.map.getLayer(ROUTE_LAYER_ID)) this.map.removeLayer(ROUTE_LAYER_ID);
    if (this.map.getLayer(ROUTE_GLOW_LAYER_ID)) this.map.removeLayer(ROUTE_GLOW_LAYER_ID);
    if (this.map.getSource(ROUTE_SOURCE_ID)) this.map.removeSource(ROUTE_SOURCE_ID);
  }

  flyTo(point: LatLng, zoom?: number): void {
    this.map.flyTo({
      center: toLngLat(point),
      zoom: zoom ?? Math.max(this.map.getZoom(), 15),
      speed: 0.9,
      curve: 1.25,
      essential: true,
    });
  }

  fitToMarkers(extraPoints: LatLng[] = []): void {
    const points = [...this.markerPositions.values(), ...extraPoints];
    if (points.length === 0) return;
    if (points.length === 1) {
      this.flyTo(points[0]);
      return;
    }

    const bounds = points.reduce(
      (acc, point) => acc.extend(toLngLat(point)),
      new maplibregl.LngLatBounds(toLngLat(points[0]), toLngLat(points[0])),
    );
    this.map.fitBounds(bounds as LngLatBoundsLike, {
      padding: { top: 96, right: 48, bottom: 160, left: 48 },
      maxZoom: 16,
      duration: 700,
    });
  }

  resize(): void {
    this.map.resize();
  }

  destroy(): void {
    this.clearMarkers();
    this.map.remove();
  }

  private enableBuildings(): void {
    if (this.map.getLayer(BUILDINGS_LAYER_ID)) return;

    try {
      const firstSymbol = this.map
        .getStyle()
        .layers?.find((layer) => layer.type === "symbol")?.id;

      this.map.addLayer(
        {
          id: BUILDINGS_LAYER_ID,
          type: "fill-extrusion",
          source: "openmaptiles",
          "source-layer": "building",
          minzoom: 14,
          paint: {
            "fill-extrusion-color": "#c6d1df",
            "fill-extrusion-height": ["coalesce", ["get", "render_height"], ["get", "height"], 12],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0],
            "fill-extrusion-opacity": 0.42,
          },
        },
        firstSymbol,
      );
    } catch {
      // Some styles already include buildings or use a different source-layer.
    }
  }
}
