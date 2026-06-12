import { apiClient } from "./client";
import type { SupportTicket } from "./types";

export interface CreateTicketInput {
  category: string;
  subject: string;
  message: string;
  order_id?: string;
  // Always RIDER so admin can distinguish rider tickets from driver tickets.
  user_type: "RIDER";
}

export const supportApi = {
  list: () => apiClient.get<SupportTicket[]>("/api/v1/rider/support/tickets"),
  create: (input: CreateTicketInput) =>
    apiClient.post<SupportTicket>("/api/v1/rider/support/tickets", input),
  get: (id: string) =>
    apiClient.get<SupportTicket>(`/api/v1/rider/support/tickets/${id}`),
  reply: (id: string, message: string) =>
    apiClient.post<{ message: string }>(
      `/api/v1/rider/support/tickets/${id}/reply`,
      { message },
    ),
};
