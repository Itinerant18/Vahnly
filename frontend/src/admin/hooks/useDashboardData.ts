import { useState, useMemo, useEffect, useCallback } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

export type TimeRange = 'today' | 'week' | 'month';

export interface KpiData {
  totalTrips: number;
  activeTrips: number;
  newRiderSignups: number;
  newDriverSignups: number;
  onlineDrivers: number;
  totalDrivers: number;
  cancellationRate: number;
  avgEtaMinutes: number;
  avgRating: number;
  grossRevenue: number;
  netRevenue: number;
  // Money fields below are in PAISE (extended /dashboard/kpis contract).
  promoCostPaise: number;
  outstandingPayoutsPaise: number;
  openTickets: number;
  slaBreaches: number;
  sos24h: number;
  // Deltas (percentage change)
  totalTripsDelta: number;
  activeTripsChange: number; // absolute
  newSignupsDelta: number;
  onlineDriversDelta: number;
  cancellationDelta: number;
  revenueDelta: number;
}

// Lightweight live-driver record for the dashboard mini-map. Coordinates are
// optional because not every driver record carries a last-known position.
export interface LiveDriver {
  driverId: string;
  name: string;
  status: string;
  lat: number | null;
  lng: number | null;
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface AlertItem {
  id: string;
  timestamp: string;
  type: 'sos' | 'surge' | 'suspension' | 'payout' | 'system' | 'signup' | 'cancellation';
  message: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface RecentTrip {
  tripId: string;
  rider: string;
  driver: string;
  status: 'completed' | 'active' | 'cancelled';
  amount: number;
  durationMin: number;
  city: string;
  [key: string]: unknown; // satisfies DataTable's row constraint
}

interface ChartsData {
  tripsChart: ChartPoint[];
  revenueChart: ChartPoint[];
  cancelChart: ChartPoint[];
  driversChart: ChartPoint[];
}

// ─── Auth header helper ──────────────────────────────────────────────
function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

// ─── API fetchers (return null on failure so fallback kicks in) ──────
async function fetchKpis(range: TimeRange): Promise<KpiData | null> {
  try {
    const res = await fetch(
      `${API_GATEWAY_BASE_URL}/api/v1/admin/dashboard/kpis?range=${range}`,
      { headers: authHeaders() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      totalTrips: data.total_trips ?? 0,
      activeTrips: data.active_trips ?? 0,
      newRiderSignups: data.new_rider_signups ?? 0,
      newDriverSignups: data.new_driver_signups ?? 0,
      onlineDrivers: data.online_drivers ?? 0,
      totalDrivers: data.total_drivers ?? 0,
      cancellationRate: data.cancellation_rate ?? 0,
      avgEtaMinutes: data.avg_eta_minutes ?? 0,
      avgRating: data.avg_rating ?? 0,
      grossRevenue: data.gross_revenue ?? 0,
      netRevenue: data.net_revenue ?? 0,
      promoCostPaise: data.promo_cost_paise ?? 0,
      outstandingPayoutsPaise: data.outstanding_payouts_paise ?? 0,
      openTickets: data.open_tickets ?? 0,
      slaBreaches: data.sla_breaches ?? 0,
      sos24h: data.sos_24h ?? 0,
      totalTripsDelta: data.total_trips_delta ?? 0,
      activeTripsChange: data.active_trips_change ?? 0,
      newSignupsDelta: data.new_signups_delta ?? 0,
      onlineDriversDelta: data.online_drivers_delta ?? 0,
      cancellationDelta: data.cancellation_delta ?? 0,
      revenueDelta: data.revenue_delta ?? 0,
    };
  } catch {
    return null;
  }
}

async function fetchCharts(range: TimeRange): Promise<ChartsData | null> {
  try {
    const res = await fetch(
      `${API_GATEWAY_BASE_URL}/api/v1/admin/dashboard/charts?range=${range}`,
      { headers: authHeaders() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      tripsChart: (data.trips_chart ?? []).map((p: { label: string; value: number }) => ({ label: p.label, value: p.value })),
      revenueChart: (data.revenue_chart ?? []).map((p: { label: string; value: number }) => ({ label: p.label, value: p.value })),
      cancelChart: (data.cancel_chart ?? []).map((p: { label: string; value: number }) => ({ label: p.label, value: p.value })),
      driversChart: (data.drivers_chart ?? []).map((p: { label: string; value: number }) => ({ label: p.label, value: p.value })),
    };
  } catch {
    return null;
  }
}

async function fetchAlerts(): Promise<AlertItem[] | null> {
  try {
    const res = await fetch(
      `${API_GATEWAY_BASE_URL}/api/v1/admin/dashboard/alerts?limit=15`,
      { headers: authHeaders() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data.alerts ?? []).map((a: { id: string; timestamp: string; type: string; message: string; severity: string }) => ({
      id: a.id,
      timestamp: a.timestamp,
      type: a.type as AlertItem['type'],
      message: a.message,
      // Normalize legacy 'warn' to 'warning' so the UI severity map resolves.
      severity: (a.severity === 'warn' ? 'warning' : a.severity) as AlertItem['severity'],
    }));
  } catch {
    return null;
  }
}

async function fetchRecentTrips(): Promise<RecentTrip[] | null> {
  try {
    const res = await fetch(
      `${API_GATEWAY_BASE_URL}/api/v1/admin/dashboard/recent-trips?limit=10`,
      { headers: authHeaders() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data.trips ?? []).map((t: { trip_id: string; rider: string; driver: string; status: string; amount: number; duration_min: number; city: string }) => ({
      tripId: t.trip_id,
      rider: t.rider,
      driver: t.driver,
      status: t.status as RecentTrip['status'],
      amount: t.amount,
      durationMin: t.duration_min,
      city: t.city,
    }));
  } catch {
    return null;
  }
}

async function fetchDrivers(): Promise<LiveDriver[] | null> {
  try {
    const res = await fetch(
      `${API_GATEWAY_BASE_URL}/api/v1/admin/drivers`,
      { headers: authHeaders() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const list: unknown[] = Array.isArray(data) ? data : (data.drivers ?? []);
    return list.map((raw) => {
      const d = raw as Record<string, unknown>;
      const lat = d.lat ?? d.latitude;
      const lng = d.lng ?? d.longitude;
      return {
        driverId: String(d.driver_id ?? d.id ?? ''),
        name: String(d.name ?? ''),
        status: String(d.status ?? d.current_state ?? ''),
        lat: typeof lat === 'number' ? lat : null,
        lng: typeof lng === 'number' ? lng : null,
      };
    });
  } catch {
    return null;
  }
}


// ─── Main hook ──────────────────────────────────────────────────────
//
// No mock fallback: on fetch failure the hook surfaces `error`/empty state so
// the UI never renders fabricated numbers. A 30s poll keeps everything fresh.

const EMPTY_CHARTS: ChartsData = {
  tripsChart: [],
  revenueChart: [],
  cancelChart: [],
  driversChart: [],
};

export function useDashboardData() {
  const [timeRange, setTimeRange] = useState<TimeRange>('today');
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [charts, setCharts] = useState<ChartsData>(EMPTY_CHARTS);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [recentTrips, setRecentTrips] = useState<RecentTrip[]>([]);
  const [drivers, setDrivers] = useState<LiveDriver[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);

  // Fetch KPIs and charts whenever timeRange changes.
  const loadRangeData = useCallback(async (range: TimeRange) => {
    const [kpiResult, chartResult] = await Promise.all([
      fetchKpis(range),
      fetchCharts(range),
    ]);

    if (kpiResult) {
      setKpis(kpiResult);
    } else {
      setKpis(null);
      setError(true);
    }
    if (chartResult) {
      setCharts(chartResult);
    } else {
      setCharts(EMPTY_CHARTS);
      setError(true);
    }
  }, []);

  // Fetch alerts, recent trips, and live drivers (range-independent).
  const loadStaticData = useCallback(async () => {
    const [alertResult, tripsResult, driverResult] = await Promise.all([
      fetchAlerts(),
      fetchRecentTrips(),
      fetchDrivers(),
    ]);

    if (alertResult) setAlerts(alertResult); else setError(true);
    if (tripsResult) setRecentTrips(tripsResult); else setError(true);
    if (driverResult) setDrivers(driverResult); else setError(true);
  }, []);

  // Load range data on mount and whenever the range changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    loadRangeData(timeRange).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [timeRange, loadRangeData]);

  // Load static data on mount, then poll every 30s.
  useEffect(() => {
    loadStaticData();
    const interval = setInterval(loadStaticData, 30_000);
    return () => clearInterval(interval);
  }, [loadStaticData]);

  // Memoize chart slices to keep stable references.
  const tripsChart = useMemo(() => charts.tripsChart, [charts.tripsChart]);
  const revenueChart = useMemo(() => charts.revenueChart, [charts.revenueChart]);
  const cancelChart = useMemo(() => charts.cancelChart, [charts.cancelChart]);
  const driversChart = useMemo(() => charts.driversChart, [charts.driversChart]);

  return {
    kpis,
    tripsChart,
    revenueChart,
    cancelChart,
    driversChart,
    alerts,
    recentTrips,
    drivers,
    timeRange,
    setTimeRange,
    loading,
    error,
  };
}
