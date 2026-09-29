import type { Env } from '../types';

export interface RouteResult {
  distance_km: number;
  duration_minutes: number;
  geometry?: string;
}

export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function getRoute(
  env: Env,
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  cityPrefix = 'KOL'
): Promise<RouteResult> {
  const cacheKey = `dm:${originLat.toFixed(4)},${originLng.toFixed(4)}:${destLat.toFixed(4)},${destLng.toFixed(4)}`;
  const dispatchStub = env.CITY_DISPATCH_DO.getByName(cityPrefix);

  // 1. Check CityDispatchDO SQLite cache
  const cachedJson = await dispatchStub.getCachedDM(cacheKey);
  if (cachedJson) {
    try {
      return JSON.parse(cachedJson) as RouteResult;
    } catch {}
  }

  // 2. If OSRM is configured, call OSRM
  if (env.OSRM_BASE_URL) {
    try {
      const url = `${env.OSRM_BASE_URL.replace(/\/$/, '')}/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        const data = (await resp.json()) as {
          routes?: Array<{ distance: number; duration: number; geometry?: unknown }>;
        };
        if (data.routes && data.routes.length > 0) {
          const r = data.routes[0];
          const result: RouteResult = {
            distance_km: Math.round((r.distance / 1000) * 10) / 10,
            duration_minutes: Math.ceil(r.duration / 60),
            geometry: typeof r.geometry === 'string' ? r.geometry : JSON.stringify(r.geometry),
          };
          await dispatchStub.setCachedDM(cacheKey, JSON.stringify(result), 600);
          return result;
        }
      }
    } catch (err) {
      console.warn('[getRoute] OSRM fetch failed, falling back to Haversine * 1.3:', err);
    }
  }

  // 3. Fallback: Haversine * 1.3 road winding factor, avg 25 km/h urban speed
  const straightLineKm = haversineDistanceKm(originLat, originLng, destLat, destLng);
  const roadDistanceKm = Math.max(0.5, Math.round(straightLineKm * 1.3 * 10) / 10);
  const durationMinutes = Math.max(2, Math.ceil((roadDistanceKm / 25) * 60));

  const result: RouteResult = {
    distance_km: roadDistanceKm,
    duration_minutes: durationMinutes,
  };

  await dispatchStub.setCachedDM(cacheKey, JSON.stringify(result), 300);
  return result;
}
