export interface GeocodeResult {
  display_name: string;
  lat: number;
  lng: number;
}

interface NominatimItem {
  display_name: string;
  lat: string;
  lon: string;
}

/**
 * Search places via OpenStreetMap Nominatim. Returns up to 5 Indian results.
 * Returns an empty array on empty query or any failure (never throws).
 */
export async function searchPlaces(query: string): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (!q) return [];

  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=in&q=" +
    encodeURIComponent(q);

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const items = (await res.json()) as NominatimItem[];
    if (!Array.isArray(items)) return [];
    return items
      .map((it) => ({
        display_name: it.display_name,
        lat: Number(it.lat),
        lng: Number(it.lon),
      }))
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  } catch {
    return [];
  }
}
