import { apiClient } from '../apiClient';

export interface DashboardKpisResponse {
  total_trips?: number;
  active_trips?: number;
  new_rider_signups?: number;
  new_driver_signups?: number;
  online_drivers?: number;
  total_drivers?: number;
  cancellation_rate?: number;
  avg_eta_minutes?: number;
  avg_rating?: number;
  gross_revenue?: number;
  net_revenue?: number;
  promo_cost_paise?: number;
  outstanding_payouts_paise?: number;
  open_tickets?: number;
  sla_breaches?: number;
  sos_24h?: number;
  total_trips_delta?: number;
  active_trips_change?: number;
  new_signups_delta?: number;
  online_drivers_delta?: number;
  cancellation_delta?: number;
  revenue_delta?: number;
}

export interface AnalyticsSummaryResponse {
  total_trips?: number;
  completed_trips?: number;
  cancelled_trips?: number;
  revenue_paise?: number;
  cancellation_rate?: number;
  unique_riders?: number;
  active_drivers?: number;
  avg_fare_paise?: number;
}

export const getDashboardKPIs = () =>
  apiClient.get<DashboardKpisResponse>('/api/v1/admin/dashboard/kpis');

export const getAnalyticsSummary = (range: '7d' | '30d' | '90d') =>
  apiClient.get<AnalyticsSummaryResponse>(`/api/v1/admin/analytics/summary?range=${range}`);
