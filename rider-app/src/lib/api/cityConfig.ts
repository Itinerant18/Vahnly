import { apiClient } from "./client";

export interface CityConfig {
  city_prefix: string;
  operating_hours_start: string; // "HH:MM"
  operating_hours_end: string; // "HH:MM"
  supported_trip_types: string[]; // empty = all tiers allowed
}

export const cityConfigApi = {
  get: (city?: string) =>
    apiClient.get<CityConfig>(
      `/api/v1/rider/city-config${city ? `?city=${encodeURIComponent(city)}` : ""}`,
    ),
};
