import { apiClient } from "./client";
import type { InsuranceClaim, InsuranceCoverage } from "./types";

export interface FileClaimInput {
  // orderId is required on every claim (claims are scoped to a covered trip).
  order_id: string;
  claim_type: "ACCIDENT" | "PROPERTY_DAMAGE" | "OTHER";
  description: string;
  photos?: string[]; // up to 3 data-URL / uploaded references
}

export const insuranceApi = {
  listClaims: () =>
    apiClient.get<InsuranceClaim[]>("/api/v1/rider/insurance/claims"),
  fileClaim: (input: FileClaimInput) =>
    apiClient.post<InsuranceClaim>("/api/v1/rider/insurance/claims", input),
  coverage: (orderId: string) =>
    apiClient.get<InsuranceCoverage>(
      `/api/v1/rider/insurance/coverage/${orderId}`,
    ),
};
