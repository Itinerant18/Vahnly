import type { LatLng } from "../api/types";

// India bounding box — matches the backend validation (internal/rider/service).
export const INDIA_BBOX = { minLat: 6, maxLat: 37, minLng: 68, maxLng: 98 };

export function isWithinIndia(lat: number, lng: number): boolean {
  return (
    lat >= INDIA_BBOX.minLat &&
    lat <= INDIA_BBOX.maxLat &&
    lng >= INDIA_BBOX.minLng &&
    lng <= INDIA_BBOX.maxLng
  );
}

/** Great-circle distance in metres between two points. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const d2r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * d2r;
  const dLng = (b.lng - a.lng) * d2r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
