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
  promoCost: number;
  // Deltas (percentage change)
  totalTripsDelta: number;
  activeTripsChange: number; // absolute
  newSignupsDelta: number;
  onlineDriversDelta: number;
  cancellationDelta: number;
  revenueDelta: number;
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
  severity: 'critical' | 'warn' | 'info';
}

export interface RecentTrip {
  tripId: string;
  rider: string;
  driver: string;
  status: 'completed' | 'active' | 'cancelled';
  amount: number;
  durationMin: number;
  city: string;
}

interface ChartsData {
  tripsChart: ChartPoint[];
  revenueChart: ChartPoint[];
  cancelChart: ChartPoint[];
  driversChart: ChartPoint[];
}

// ─── Auth header helper ──────────────────────────────────────────────
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('admin_jwt_token');
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
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
      promoCost: data.promo_cost ?? 0,
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
      severity: a.severity as AlertItem['severity'],
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

// ─── Mock data generators (fallback when backend is unreachable) ─────

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function mockTripsChart(range: TimeRange): ChartPoint[] {
  const rng = seededRandom(42);
  if (range === 'today') {
    return Array.from({ length: 24 }, (_, i) => {
      const label = `${i.toString().padStart(2, '0')}:00`;
      let base = 20;
      if (i >= 7 && i <= 10) base = 140 + Math.floor(rng() * 60);
      else if (i >= 17 && i <= 21) base = 160 + Math.floor(rng() * 80);
      else if (i >= 11 && i <= 16) base = 90 + Math.floor(rng() * 40);
      else if (i >= 22 || i <= 2) base = 40 + Math.floor(rng() * 20);
      else base = 30 + Math.floor(rng() * 25);
      return { label, value: base };
    });
  }
  if (range === 'week') {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const bases = [2100, 2250, 2180, 2320, 2580, 2890, 2640];
    return days.map((d, i) => ({ label: d, value: bases[i] + Math.floor(rng() * 200 - 100) }));
  }
  return Array.from({ length: 30 }, (_, i) => {
    const base = 2000 + Math.floor(rng() * 600);
    const weekendBoost = (i % 7 === 5 || i % 7 === 6) ? 400 : 0;
    return { label: `${i + 1}`, value: base + weekendBoost };
  });
}

function mockRevenueChart(range: TimeRange): ChartPoint[] {
  const rng = seededRandom(99);
  if (range === 'today') {
    return Array.from({ length: 24 }, (_, i) => {
      const label = `${i.toString().padStart(2, '0')}:00`;
      let base = 4000;
      if (i >= 7 && i <= 10) base = 32000 + Math.floor(rng() * 12000);
      else if (i >= 17 && i <= 21) base = 38000 + Math.floor(rng() * 15000);
      else if (i >= 11 && i <= 16) base = 21000 + Math.floor(rng() * 8000);
      else if (i >= 22 || i <= 2) base = 9000 + Math.floor(rng() * 4000);
      else base = 6000 + Math.floor(rng() * 3000);
      return { label, value: base };
    });
  }
  if (range === 'week') {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const bases = [485000, 510000, 498000, 530000, 590000, 680000, 620000];
    return days.map((d, i) => ({ label: d, value: bases[i] + Math.floor(rng() * 40000 - 20000) }));
  }
  return Array.from({ length: 30 }, (_, i) => {
    const base = 470000 + Math.floor(rng() * 120000);
    const weekendBoost = (i % 7 === 5 || i % 7 === 6) ? 90000 : 0;
    return { label: `${i + 1}`, value: base + weekendBoost };
  });
}

function mockCancelChart(range: TimeRange): ChartPoint[] {
  const rng = seededRandom(77);
  if (range === 'today') {
    return Array.from({ length: 24 }, (_, i) => ({
      label: `${i.toString().padStart(2, '0')}:00`,
      value: parseFloat((3.5 + rng() * 5).toFixed(1)),
    }));
  }
  if (range === 'week') {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return days.map((d) => ({ label: d, value: parseFloat((4.0 + rng() * 3.5).toFixed(1)) }));
  }
  return Array.from({ length: 30 }, (_, i) => ({
    label: `${i + 1}`,
    value: parseFloat((3.8 + rng() * 4.2).toFixed(1)),
  }));
}

function mockDriversChart(range: TimeRange): ChartPoint[] {
  const rng = seededRandom(55);
  if (range === 'today') {
    return Array.from({ length: 24 }, (_, i) => {
      let base = 120;
      if (i >= 6 && i <= 10) base = 580 + Math.floor(rng() * 120);
      else if (i >= 16 && i <= 22) base = 640 + Math.floor(rng() * 150);
      else if (i >= 11 && i <= 15) base = 420 + Math.floor(rng() * 80);
      else base = 150 + Math.floor(rng() * 60);
      return { label: `${i.toString().padStart(2, '0')}:00`, value: base };
    });
  }
  if (range === 'week') {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const bases = [540, 560, 550, 580, 620, 710, 660];
    return days.map((d, i) => ({ label: d, value: bases[i] + Math.floor(rng() * 40 - 20) }));
  }
  return Array.from({ length: 30 }, (_, i) => {
    const base = 520 + Math.floor(rng() * 100);
    const weekendBoost = (i % 7 === 5 || i % 7 === 6) ? 80 : 0;
    return { label: `${i + 1}`, value: base + weekendBoost };
  });
}

function mockKpis(range: TimeRange): KpiData {
  if (range === 'today') {
    return {
      totalTrips: 1847, activeTrips: 142, newRiderSignups: 83, newDriverSignups: 12,
      onlineDrivers: 634, totalDrivers: 1120, cancellationRate: 5.8, avgEtaMinutes: 4.2,
      avgRating: 4.72, grossRevenue: 428500, netRevenue: 371200, promoCost: 57300,
      totalTripsDelta: 8.4, activeTripsChange: 23, newSignupsDelta: 12.1,
      onlineDriversDelta: 3.6, cancellationDelta: -0.9, revenueDelta: 6.2,
    };
  }
  if (range === 'week') {
    return {
      totalTrips: 16240, activeTrips: 142, newRiderSignups: 614, newDriverSignups: 78,
      onlineDrivers: 634, totalDrivers: 1120, cancellationRate: 5.3, avgEtaMinutes: 4.5,
      avgRating: 4.68, grossRevenue: 3842000, netRevenue: 3310000, promoCost: 532000,
      totalTripsDelta: 5.1, activeTripsChange: 23, newSignupsDelta: 9.4,
      onlineDriversDelta: 2.8, cancellationDelta: -1.2, revenueDelta: 4.7,
    };
  }
  return {
    totalTrips: 68930, activeTrips: 142, newRiderSignups: 2640, newDriverSignups: 318,
    onlineDrivers: 634, totalDrivers: 1120, cancellationRate: 5.1, avgEtaMinutes: 4.4,
    avgRating: 4.69, grossRevenue: 16480000, netRevenue: 14250000, promoCost: 2230000,
    totalTripsDelta: 11.3, activeTripsChange: 23, newSignupsDelta: 14.6,
    onlineDriversDelta: 7.2, cancellationDelta: -2.1, revenueDelta: 9.8,
  };
}

function mockAlerts(): AlertItem[] {
  return [
    { id: 'ALR-001', timestamp: '2 min ago', type: 'sos', message: 'SOS triggered by rider Priya M. on trip TRP-KOL-4821. Location shared with emergency contacts.', severity: 'critical' },
    { id: 'ALR-002', timestamp: '5 min ago', type: 'surge', message: 'Surge pricing activated in Salt Lake Zone — demand 2.4× supply.', severity: 'warn' },
    { id: 'ALR-003', timestamp: '11 min ago', type: 'suspension', message: 'Driver Rajesh K. (DRV-0482) auto-suspended: rating fell below 4.0 threshold.', severity: 'warn' },
    { id: 'ALR-004', timestamp: '15 min ago', type: 'system', message: 'Payment gateway latency spike: avg response 1.8s (threshold 500ms).', severity: 'critical' },
    { id: 'ALR-005', timestamp: '23 min ago', type: 'payout', message: 'Weekly payout batch for 842 drivers initiated — ₹24.8L pending settlement.', severity: 'info' },
    { id: 'ALR-006', timestamp: '34 min ago', type: 'signup', message: '12 new driver applications pending verification in Kolkata region.', severity: 'info' },
    { id: 'ALR-007', timestamp: '41 min ago', type: 'surge', message: 'Surge deactivated in Park Street corridor — supply normalized.', severity: 'info' },
    { id: 'ALR-008', timestamp: '52 min ago', type: 'sos', message: 'SOS resolved: rider Ankit V. confirmed false trigger on trip TRP-DEL-7734.', severity: 'warn' },
    { id: 'ALR-009', timestamp: '1 hr ago', type: 'system', message: 'Geocoding service failover to backup provider — primary node unreachable.', severity: 'critical' },
    { id: 'ALR-010', timestamp: '1 hr ago', type: 'suspension', message: 'Driver Meena S. (DRV-1190) reinstated after document re-verification.', severity: 'info' },
    { id: 'ALR-011', timestamp: '2 hr ago', type: 'payout', message: 'Payout failure for 3 drivers — bank IFSC mismatch flagged for manual review.', severity: 'warn' },
  ];
}

function mockRecentTrips(): RecentTrip[] {
  return [
    { tripId: 'TRP-KOL-4821', rider: 'Priya Mukherjee', driver: 'Sunil Das', status: 'active', amount: 285, durationMin: 18, city: 'KOL' },
    { tripId: 'TRP-DEL-7734', rider: 'Ankit Verma', driver: 'Ramesh Yadav', status: 'completed', amount: 542, durationMin: 34, city: 'DEL' },
    { tripId: 'TRP-MUM-3310', rider: 'Sneha Patil', driver: 'Farhan Sheikh', status: 'completed', amount: 378, durationMin: 22, city: 'MUM' },
    { tripId: 'TRP-BLR-9184', rider: 'Karthik Nair', driver: 'Venkatesh R.', status: 'cancelled', amount: 0, durationMin: 0, city: 'BLR' },
    { tripId: 'TRP-KOL-4819', rider: 'Ritu Ghosh', driver: 'Amit Mondal', status: 'completed', amount: 195, durationMin: 12, city: 'KOL' },
    { tripId: 'TRP-DEL-7731', rider: 'Manish Sharma', driver: 'Jitender Singh', status: 'completed', amount: 724, durationMin: 41, city: 'DEL' },
    { tripId: 'TRP-MUM-3307', rider: 'Aditi Joshi', driver: 'Manoj Patil', status: 'active', amount: 460, durationMin: 28, city: 'MUM' },
    { tripId: 'TRP-BLR-9180', rider: 'Deepak Hegde', driver: 'Naveen Kumar', status: 'completed', amount: 312, durationMin: 19, city: 'BLR' },
    { tripId: 'TRP-KOL-4815', rider: 'Sayan Basu', driver: 'Debashis Roy', status: 'completed', amount: 148, durationMin: 9, city: 'KOL' },
    { tripId: 'TRP-DEL-7728', rider: 'Neha Kapoor', driver: 'Vikram Chauhan', status: 'completed', amount: 836, durationMin: 52, city: 'DEL' },
  ];
}

// ─── Main hook ──────────────────────────────────────────────────────

export function useDashboardData() {
  const [timeRange, setTimeRange] = useState<TimeRange>('today');
  const [kpis, setKpis] = useState<KpiData>(mockKpis('today'));
  const [charts, setCharts] = useState<ChartsData>({
    tripsChart: mockTripsChart('today'),
    revenueChart: mockRevenueChart('today'),
    cancelChart: mockCancelChart('today'),
    driversChart: mockDriversChart('today'),
  });
  const [alerts, setAlerts] = useState<AlertItem[]>(mockAlerts());
  const [recentTrips, setRecentTrips] = useState<RecentTrip[]>(mockRecentTrips());

  // Fetch KPIs and charts whenever timeRange changes
  const loadRangeData = useCallback(async (range: TimeRange) => {
    const [kpiResult, chartResult] = await Promise.all([
      fetchKpis(range),
      fetchCharts(range),
    ]);

    setKpis(kpiResult ?? mockKpis(range));
    if (chartResult) {
      setCharts(chartResult);
    } else {
      setCharts({
        tripsChart: mockTripsChart(range),
        revenueChart: mockRevenueChart(range),
        cancelChart: mockCancelChart(range),
        driversChart: mockDriversChart(range),
      });
    }
  }, []);

  // Fetch alerts and recent trips (range-independent)
  const loadStaticData = useCallback(async () => {
    const [alertResult, tripsResult] = await Promise.all([
      fetchAlerts(),
      fetchRecentTrips(),
    ]);

    setAlerts(alertResult ?? mockAlerts());
    setRecentTrips(tripsResult ?? mockRecentTrips());
  }, []);

  // Load data on mount and range change
  useEffect(() => {
    loadRangeData(timeRange);
  }, [timeRange, loadRangeData]);

  useEffect(() => {
    loadStaticData();
    // Refresh alerts every 30 seconds
    const interval = setInterval(loadStaticData, 30_000);
    return () => clearInterval(interval);
  }, [loadStaticData]);

  // Memoize the return to keep stable references
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
    timeRange,
    setTimeRange,
  };
}
