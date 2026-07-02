import { apiClient } from "./client";
import type { LatLng } from "./types";

export interface MapRouteRequest {
  driver?: LatLng;
  pickup: LatLng;
  dropoff?: LatLng;
  trip_id?: string;
}

export interface MapRouteResponse {
  geometry: LatLng[];
  distance_meters: number;
  duration_seconds: number;
  fare_estimate_paise?: number;
}

export interface NearbyMapDriver {
  id: string;
  lat: number;
  lng: number;
  bearing?: number;
  eta_seconds?: number;
}

export interface GeocodeResult {
  display_name: string;
  lat: number;
  lng: number;
}

export const mapApi = {
  route: (req: MapRouteRequest) =>
    apiClient.post<MapRouteResponse>("/api/map/route", req),

  eta: (req: MapRouteRequest) =>
    apiClient.post<MapRouteResponse>("/api/map/eta", req),

  nearbyDrivers: (lat: number, lng: number, radiusMeters = 3000) => {
    const q = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      radius: String(radiusMeters),
    });
    return apiClient.get<{ drivers: NearbyMapDriver[] }>(
      `/api/map/drivers/nearby?${q.toString()}`,
    );
  },

  geocode: (address: string) => {
    const q = new URLSearchParams({ address });
    return apiClient.get<{ results: GeocodeResult[] }>(`/api/map/geocode?${q.toString()}`);
  },

  reverseGeocode: (point: LatLng) => {
    const q = new URLSearchParams({ lat: String(point.lat), lng: String(point.lng) });
    return apiClient.get<GeocodeResult>(`/api/map/reverse-geocode?${q.toString()}`);
  },
};

