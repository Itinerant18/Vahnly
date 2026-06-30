import React, { useEffect, useState, Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import { SvgAreaChart } from '../components/SvgAreaChart';
import { useDashboardData, TimeRange, RecentTrip, LiveDriver } from '../hooks/useDashboardData';
import { API_GATEWAY_BASE_URL } from '../../config';
import { getAdminRole } from '../auth';
import { formatPaiseCompact } from '../lib/money';
import { StatCard } from '../../components/ds/StatCard';
import { AdminBadge } from '../../components/ds/AdminBadge';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';

// Leaflet mini-map is dynamically imported so the map bundle loads only on the dashboard.
const DashboardMiniMap = lazy(() => import('../components/DashboardMiniMap'));

/* ------------------------------------------------------------------ */
/*  Rider Metrics                                                       */
/* ------------------------------------------------------------------ */

interface RiderMetrics {
  active_riders_today:  number;
  new_signups_today:    number;
  trips_booked_today:   number;
  avg_fare_paise_today: number;
  daily_bookings: { label: string; value: number }[];
  retention?: { d1: number | null; d7: number | null; d30: number | null };
}

const RiderMetricsSection: React.FC = () => {
  const [metrics, setMetrics] = useState<RiderMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/riders/metrics`, {
      headers: { 'X-Admin-Role': getAdminRole() },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) { setMetrics(d); setLoading(false); } })
      .catch(() => setLoading(false));
    return () => { alive = false; };
  }, []);

  const m = metrics;

  return (
    <section className="space-y-4">
      <h2 className="text-heading-small text-content-primary">Rider Metrics</h2>
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Active Riders Today" value={m?.active_riders_today ?? '—'} loading={loading} />
        <StatCard label="New Signups Today"   value={m?.new_signups_today   ?? '—'} loading={loading} />
        <StatCard label="Trips Booked Today"  value={m?.trips_booked_today  ?? '—'} loading={loading} />
        <StatCard label="Avg Fare Today" value={m ? `₹${(m.avg_fare_paise_today / 100).toFixed(0)}` : '—'} loading={loading} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        {m && m.daily_bookings.length >= 2 ? (
          <SvgAreaChart data={m.daily_bookings} title="Daily bookings (7d)" />
        ) : (
          <div className="card flex items-center justify-center min-h-[180px]">
            <span className="text-paragraph-small text-content-tertiary">Daily bookings chart (insufficient data)</span>
          </div>
        )}
        <div className="card">
          <div className="text-label-medium text-content-primary uppercase tracking-wider mb-4">Rider retention</div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { k: 'Day 1', v: m?.retention?.d1 },
              { k: 'Day 7', v: m?.retention?.d7 },
              { k: 'Day 30', v: m?.retention?.d30 },
            ].map((c) => ({ k: c.k, v: c.v == null ? '—' : `${c.v}%` })).map((c) => (
              <div key={c.k} className="bg-background-secondary rounded-sm p-3">
                <div className="text-heading-medium font-mono text-content-primary">{c.v}</div>
                <div className="text-label-small text-content-tertiary uppercase tracking-wider mt-0.5">{c.k}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatNumber(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000)    return `${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000)      return n.toLocaleString('en-IN');
  return String(n);
}

/* ------------------------------------------------------------------ */
/*  Time Range Toggle                                                   */
/* ------------------------------------------------------------------ */

const ranges: { key: TimeRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week',  label: 'Week'  },
  { key: 'month', label: 'Month' },
];

function TimeRangeToggle({ active, onChange }: { active: TimeRange; onChange: (r: TimeRange) => void }) {
  return (
    <div className="flex items-center bg-background-secondary rounded-pill p-0.5 gap-0.5">
      {ranges.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`rounded-pill px-4 py-1.5 text-label-medium transition-base cursor-pointer ${
            active === key
              ? 'bg-interactive-primary text-interactive-primary-text'
              : 'bg-transparent text-content-secondary hover:text-content-primary hover:bg-background-tertiary'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Live Alerts Panel                                                   */
/* ------------------------------------------------------------------ */

const SEVERITY_BORDER: Record<string, string> = {
  critical: 'border-l-negative-400',
  warning:  'border-l-warning-400',
  info:     'border-l-accent-400',
};

function AlertsPanel({ alerts }: { alerts: Array<{ id: string; timestamp: string; type: string; severity: string; message: string }> }) {
  return (
    <div className="bg-background-primary rounded-md shadow-elevation-1 p-600 flex flex-col gap-3">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-heading-small text-content-primary">Live Alerts</h2>
        {alerts.length > 0 && <span className="badge badge-negative font-mono">{alerts.length}</span>}
      </div>
      {alerts.length === 0 ? (
        <p className="text-paragraph-small text-content-tertiary py-4 text-center">No active alerts</p>
      ) : (
        alerts.map((alert) => (
          <div
            key={alert.id}
            className={`flex flex-col gap-0.5 bg-background-secondary rounded-sm p-400 border-l-4 ${
              SEVERITY_BORDER[alert.severity] ?? 'border-l-border-opaque'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-mono-small text-content-tertiary">{alert.timestamp}</span>
              <AdminBadge label={alert.type} variant={alert.severity === 'critical' ? 'negative' : alert.severity === 'warning' ? 'warning' : 'accent'} />
            </div>
            <p className="text-label-medium text-content-primary mt-0.5">{alert.message}</p>
          </div>
        ))
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Recent Trips Table                                                  */
/* ------------------------------------------------------------------ */

// Column definitions for the recent-trips DataTable.
// Fare is stored in whole RUPEES (not paise), so it uses a custom font-mono render
// preserving the existing `₹{amount}` format instead of the 'currency' type.
const TRIP_COLUMNS: ColumnDef<RecentTrip>[] = [
  {
    key: 'tripId', header: 'Trip ID', width: 140,
    render: (v) => (
      <span className="font-mono text-mono-small text-content-primary truncate">{String(v)}</span>
    ),
  },
  { key: 'rider', header: 'Rider', type: 'text' },
  { key: 'driver', header: 'Driver', type: 'text' },
  { key: 'status', header: 'Status', type: 'status' },
  {
    key: 'amount', header: 'Fare', type: 'numeric',
    render: (v) => (
      <span className="font-mono text-mono-small text-content-primary tabular-nums">
        {Number(v) > 0 ? `₹${Number(v)}` : '—'}
      </span>
    ),
  },
  {
    key: 'durationMin', header: 'Duration', type: 'numeric',
    render: (v) => (
      <span className="font-mono text-mono-small text-content-primary tabular-nums">
        {Number(v) > 0 ? `${Number(v)} min` : '—'}
      </span>
    ),
  },
];

function RecentTripsTable({ trips }: { trips: RecentTrip[] }) {
  return (
    <div className="card overflow-hidden p-0">
      <div className="px-500 py-400 border-b border-border-opaque">
        <h2 className="text-heading-small text-content-primary">Recent trips</h2>
      </div>
      <DataTable<RecentTrip>
        columns={TRIP_COLUMNS}
        data={trips}
        rowKey={(t) => t.tripId}
        className="border-none rounded-none"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Live Fleet Mini-Map                                                 */
/* ------------------------------------------------------------------ */

const FLEET_LEGEND: { color: string; label: string }[] = [
  { color: 'bg-positive-400', label: 'Online' },
  { color: 'bg-accent-400',   label: 'On trip' },
  { color: 'bg-warning-400',  label: 'Idle' },
  { color: 'bg-background-tertiary', label: 'Offline' },
];

function LiveFleetMapCard({ drivers }: { drivers: LiveDriver[] }) {
  const navigate = useNavigate();
  const located = drivers.filter((d) => d.lat != null && d.lng != null).length;

  return (
    <button
      type="button"
      onClick={() => navigate('/live')}
      className="card p-0 overflow-hidden text-left cursor-pointer hover:shadow-elevation-2 transition-base flex flex-col"
      title="Open Live Operations"
    >
      <div className="flex items-center justify-between px-500 py-400 border-b border-border-opaque">
        <h2 className="text-heading-small text-content-primary">Live fleet</h2>
        <span className="text-label-small text-content-tertiary uppercase tracking-wider">
          {located} located → Live ↗
        </span>
      </div>
      <div className="relative h-[220px] bg-background-secondary">
        <Suspense fallback={
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-paragraph-small text-content-tertiary">Loading map…</span>
          </div>
        }>
          <DashboardMiniMap drivers={drivers} />
        </Suspense>
      </div>
      <div className="flex items-center gap-4 px-500 py-300 border-t border-border-opaque">
        {FLEET_LEGEND.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5 text-label-small text-content-secondary">
            <span className={`w-2 h-2 rounded-pill ${l.color}`} />
            {l.label}
          </span>
        ))}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                      */
/* ------------------------------------------------------------------ */

export const DashboardHome: React.FC = () => {
  const {
    kpis, tripsChart, revenueChart, cancelChart, driversChart,
    alerts, recentTrips, drivers, timeRange, setTimeRange, loading, error, reload,
  } = useDashboardData();

  return (
    <div className="w-full h-full overflow-y-auto bg-background-primary">
      <div className="max-w-[1280px] mx-auto px-700 py-600 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-heading-xl text-content-primary">Dashboard</h1>
          <TimeRangeToggle active={timeRange} onChange={setTimeRange} />
        </div>

        {/* Error banner — shown instead of fabricated data when a fetch fails */}
        {error && (
          <div className="bg-surface-negative border-l-4 border-l-negative-400 rounded-sm px-500 py-400 flex items-center gap-2">
            <span className="text-content-negative animate-pulse">●</span>
            <p className="text-label-medium text-content-negative">
              Some live data failed to load. Showing the latest available values — figures may be incomplete.
            </p>
            <button
              type="button"
              onClick={reload}
              className="ml-auto rounded-sm border border-negative-400 px-3 py-1 text-label-medium text-content-negative hover:bg-background-secondary transition-base"
            >
              Retry
            </button>
          </div>
        )}

        {/* KPI Cards — 12 cards. `loading` placeholder until KPIs resolve. */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Total Trips"       value={kpis ? formatNumber(kpis.totalTrips) : '—'}  loading={loading || !kpis} trend={kpis ? { value: kpis.totalTripsDelta } : null} />
          <StatCard label="Active Trips"      value={kpis ? formatNumber(kpis.activeTrips) : '—'} loading={loading || !kpis} trend={kpis ? { value: kpis.activeTripsChange, suffix: '' } : null} />
          <StatCard label="New Signups"       value={kpis ? formatNumber(kpis.newRiderSignups + kpis.newDriverSignups) : '—'} loading={loading || !kpis} trend={kpis ? { value: kpis.newSignupsDelta } : null} />
          <StatCard label="Online Drivers"    value={kpis ? `${kpis.onlineDrivers}/${formatNumber(kpis.totalDrivers)}` : '—'} loading={loading || !kpis} trend={kpis ? { value: kpis.onlineDriversDelta } : null} />
          <StatCard label="Cancellation Rate" value={kpis ? `${kpis.cancellationRate}%` : '—'}    loading={loading || !kpis} trend={kpis ? { value: kpis.cancellationDelta } : null} />
          <StatCard label="Avg ETA"           value={kpis ? `${kpis.avgEtaMinutes} min` : '—'}    loading={loading || !kpis} />
          <StatCard label="Avg Rating"        value={kpis ? `${kpis.avgRating} ★` : '—'}          loading={loading || !kpis} />
          <StatCard label="Revenue"           value={kpis ? `₹${formatNumber(kpis.grossRevenue)}` : '—'} loading={loading || !kpis} trend={kpis ? { value: kpis.revenueDelta } : null} />
          <StatCard label="Promo Cost"        value={kpis ? formatPaiseCompact(kpis.promoCostPaise) : '—'} loading={loading || !kpis} />
          <StatCard label="Outstanding Payouts" value={kpis ? formatPaiseCompact(kpis.outstandingPayoutsPaise) : '—'} loading={loading || !kpis} />
          <StatCard label="Open Tickets / SLA Breaches" value={kpis ? `${formatNumber(kpis.openTickets)} / ${formatNumber(kpis.slaBreaches)}` : '—'} loading={loading || !kpis} />
          <StatCard label="SOS (24h)"         value={kpis ? formatNumber(kpis.sos24h) : '—'}      loading={loading || !kpis} />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-2 gap-4">
          <SvgAreaChart data={tripsChart}   title="Trips" />
          <SvgAreaChart data={revenueChart} title="Revenue"           valuePrefix="₹" />
          <SvgAreaChart data={cancelChart}  title="Cancellation rate" valueSuffix="%" />
          <SvgAreaChart data={driversChart} title="Drivers online" />
        </div>

        {/* Live fleet mini-map — click to open Live Operations */}
        <LiveFleetMapCard drivers={drivers} />

        {/* Rider Metrics */}
        <RiderMetricsSection />

        {/* Alerts + Recent Trips */}
        <div className="grid grid-cols-5 gap-4">
          <div className="col-span-3">
            <RecentTripsTable trips={recentTrips} />
          </div>
          <div className="col-span-2">
            <AlertsPanel alerts={alerts} />
          </div>
        </div>

      </div>
    </div>
  );
};
