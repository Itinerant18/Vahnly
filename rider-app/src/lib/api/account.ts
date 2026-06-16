import { apiClient } from "./client";
import type {
  EmergencyContact,
  NotificationPreferences,
  RiderNotificationItem,
  RiderReferral,
  SavedPlace,
} from "./types";

export interface SavePlaceInput {
  label: "HOME" | "WORK" | "CUSTOM";
  display_name: string;
  address_text: string;
  lat: number;
  lng: number;
}

export interface EmergencyContactInput {
  name: string;
  phone: string;
  relationship?: string;
  auto_share_trip?: boolean;
  display_order?: number;
}

export const accountApi = {
  // Saved places
  listPlaces: () => apiClient.get<SavedPlace[]>("/api/v1/rider/me/places"),
  addPlace: (place: SavePlaceInput) =>
    apiClient.post<SavedPlace>("/api/v1/rider/me/places", place),
  removePlace: (placeId: string) =>
    apiClient.del<{ message: string }>(`/api/v1/rider/me/places/${placeId}`),

  // Emergency contacts
  listEmergency: () =>
    apiClient.get<EmergencyContact[]>("/api/v1/rider/me/emergency-contacts"),
  addEmergency: (c: EmergencyContactInput) =>
    apiClient.post<{ message: string }>(
      "/api/v1/rider/me/emergency-contacts",
      c,
    ),
  updateEmergency: (id: string, c: EmergencyContactInput) =>
    apiClient.put<{ message: string }>(
      `/api/v1/rider/me/emergency-contacts/${id}`,
      c,
    ),
  removeEmergency: (id: string) =>
    apiClient.del<{ message: string }>(
      `/api/v1/rider/me/emergency-contacts/${id}`,
    ),

  // Referral
  referral: () => apiClient.get<RiderReferral[]>("/api/v1/rider/me/referral"),

  // Notifications
  notifications: (limit = 20, offset = 0) =>
    apiClient.get<RiderNotificationItem[]>(
      `/api/v1/rider/me/notifications?limit=${limit}&offset=${offset}`,
    ),
  markNotificationRead: (id: string) =>
    apiClient.patch<{ message: string }>(
      `/api/v1/rider/me/notifications/${id}/read`,
    ),

  // Device tokens (push)
  registerDeviceToken: (deviceToken: string, platform: "IOS" | "ANDROID" | "WEB") =>
    apiClient.post<{ message: string }>("/api/v1/rider/me/device-tokens", {
      device_token: deviceToken,
      platform,
    }),

  // Notification preferences (per-category push/SMS/email toggles)
  notifPreferences: () =>
    apiClient.get<NotificationPreferences>(
      "/api/v1/rider/notifications/preferences",
    ),
  updateNotifPreferences: (prefs: NotificationPreferences) =>
    apiClient.patch<NotificationPreferences>(
      "/api/v1/rider/notifications/preferences",
      prefs,
    ),

  // Account deletion (irreversible). Backend route is DELETE /api/v1/rider/me.
  deleteAccount: () =>
    apiClient.del<{ message: string }>("/api/v1/rider/me"),
};
