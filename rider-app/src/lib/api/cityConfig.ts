import { apiClient } from "./client";
import type { TripType } from "./types";

// Server-side trip-type catalog entry (label + hint + requirements), mirrors
// service.TripTypeInfo. Lets copy vary per city without an app release.
export interface TripTypeInfo {
  value: TripType;
  label: string;
  hint: string;
  needs_dropoff: boolean;
  bookable: boolean;
}

export interface CityConfig {
  city_prefix: string;
  center_lat?: number;
  center_lng?: number;
  operating_hours_start: string; // "HH:MM"
  operating_hours_end: string; // "HH:MM"
  supported_trip_types: string[]; // empty = all tiers allowed
  trip_types?: TripTypeInfo[]; // optional — older backends omit it
}

export const cityConfigApi = {
  get: (city?: string) =>
    apiClient.get<CityConfig>(
      `/api/v1/rider/city-config${city ? `?city=${encodeURIComponent(city)}` : ""}`,
    ),
};
