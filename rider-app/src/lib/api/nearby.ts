import { apiClient } from "./client";

export interface NearbyDriver {
  id: string;
  lat: number;
  lng: number;
  bearing?: number;
}

interface NearbyDriversResult {
  drivers: NearbyDriver[];
}

export const nearbyApi = {
  list: (lat: number, lng: number) => {
    const q = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    return apiClient.get<NearbyDriversResult>(
      `/api/v1/rider/nearby-drivers?${q.toString()}`,
    );
  },
};
