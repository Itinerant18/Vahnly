import { apiClient } from "./client";
import type { PaymentMethodsResponse } from "./types";

export interface AddPaymentMethodInput {
  type: "CARD" | "UPI";
  vpa?: string;
  card_number?: string;
  exp_month?: number;
  exp_year?: number;
  name?: string;
}

export const paymentsApi = {
  list: () =>
    apiClient.get<PaymentMethodsResponse>("/api/v1/rider/me/payment-methods"),
  add: (input: AddPaymentMethodInput) =>
    apiClient.post<PaymentMethodsResponse>(
      "/api/v1/rider/me/payment-methods",
      input,
    ),
  remove: (id: string) =>
    apiClient.del<{ message: string }>(
      `/api/v1/rider/me/payment-methods/${id}`,
    ),
  setDefault: (id: string) =>
    apiClient.patch<{ message: string }>(
      `/api/v1/rider/me/payment-methods/${id}/set-default`,
    ),
  // Stub on the backend (always valid); validated client-side first.
  verifyUpi: (vpa: string) =>
    apiClient.get<{ valid: boolean; name?: string }>(
      `/api/v1/payment/verify-upi?id=${encodeURIComponent(vpa)}`,
    ),
};
