import { apiClient } from "./client";
import type { CarType, GarageCar, Transmission } from "./types";

export interface GarageCarInput {
  make: string;
  model: string;
  year: number;
  car_type: CarType;
  transmission: Transmission;
  fuel_type?: string;
  registration_plate: string;
  color?: string;
  is_default?: boolean;
}

export const garageApi = {
  list: () => apiClient.get<GarageCar[]>("/api/v1/rider/me/garage"),
  add: (car: GarageCarInput) =>
    apiClient.post<GarageCar>("/api/v1/rider/me/garage", car),
  update: (carId: string, car: GarageCarInput) =>
    apiClient.put<GarageCar>(`/api/v1/rider/me/garage/${carId}`, car),
  remove: (carId: string) =>
    apiClient.del<{ message: string }>(`/api/v1/rider/me/garage/${carId}`),
  setDefault: (carId: string) =>
    apiClient.patch<{ message: string }>(
      `/api/v1/rider/me/garage/${carId}/set-default`,
    ),
};
