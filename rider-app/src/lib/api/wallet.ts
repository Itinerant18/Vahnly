import { apiClient } from "./client";
import type { Wallet, WalletTransaction } from "./types";

export interface WalletTransactionsResult {
  transactions: WalletTransaction[];
  total: number;
  limit: number;
  offset: number;
}

export const walletApi = {
  get: () => apiClient.get<Wallet>("/api/v1/rider/me/wallet"),
  transactions: (limit = 20, offset = 0) =>
    apiClient.get<WalletTransactionsResult>(
      `/api/v1/rider/me/wallet/transactions?limit=${limit}&offset=${offset}`,
    ),
  topup: (amountPaise: number) =>
    apiClient.post<{ message: string }>("/api/v1/rider/me/wallet/topup", {
      amount_paise: amountPaise,
    }),
};
