import React, { useEffect, useState } from 'react';
import { SvgAreaChart } from '../components/SvgAreaChart';
import { useDashboardData, TimeRange } from '../hooks/useDashboardData';
import { API_GATEWAY_BASE_URL } from '../../config';
import { getAdminRole } from '../auth';
import { StatCard } from '../../components/ds/StatCard';
import { AdminBadge } from '../../components/ds/AdminBadge';

/* ------------------------------------------------------------------ */
/*  Rider Metrics                                                       */
/* ------------------------------------------------------------------ */

interface RiderMetrics {
  active_riders_today:  number;
  new_signups_today:    number;
  trips_booked_today:   number;
  avg_fare_paise_today: number;
  daily_bookings: { label: string; value: number }[];
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
            {[{ k: 'Day 1', v: '62%' }, { k: 'Day 7', v: '38%' }, { k: 'Day 30', v: '21%' }].map((c) => (
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

function RecentTripsTable({
  trips,
}: {
  trips: Array<{ tripId: string; rider: string; driver: string; status: 'completed' | 'active' | 'cancelled'; amount: number; durationMin: number }>;
}) {
  const statusVariant = (s: string) =>
    s === 'completed' ? 'positive' : s === 'active' ? 'accent' : 'neutral';

  return (
    <div className="card overflow-hidden p-0">
      <div className="px-500 py-400 border-b border-border-opaque">
        <h2 className="text-heading-small text-content-primary">Recent trips</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-background-secondary border-b border-border-opaque">
              {['Trip ID', 'Rider', 'Driver', 'Status', 'Fare', 'Duration'].map((h, i) => (
                <th key={h} className={`px-4 py-2.5 text-label-small text-content-secondary uppercase tracking-wide whitespace-nowrap ${i >= 4 ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trips.map((trip) => (
              <tr key={trip.tripId} className="border-b border-border-opaque last:border-none hover:bg-background-secondary transition-base">
                <td className="px-4 py-3 font-mono text-mono-small text-content-primary">{trip.tripId}</td>
                <td className="px-4 py-3 text-paragraph-medium text-content-primary">{trip.rider}</td>
                <td className="px-4 py-3 text-paragraph-medium text-content-primary">{trip.driver}</td>
                <td className="px-4 py-3">
                  <AdminBadge label={trip.status} variant={statusVariant(trip.status) as 'positive' | 'accent' | 'neutral'} />
                </td>
                <td className="px-4 py-3 text-right font-mono text-mono-small text-content-primary">
                  {trip.amount > 0 ? `₹${trip.amount}` : '—'}
                </td>
                <td className="px-4 py-3 text-right font-mono text-mono-small text-content-primary">
                  {trip.durationMin > 0 ? `${trip.durationMin} min` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                      */
/* ------------------------------------------------------------------ */

export const DashboardHome: React.FC = () => {
  const {
    kpis, tripsChart, revenueChart, cancelChart, driversChart,
    alerts, recentTrips, timeRange, setTimeRange,
  } = useDashboardData();

  return (
    <div className="w-full h-full overflow-y-auto bg-background-primary">
      <div className="max-w-[1280px] mx-auto px-700 py-600 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-heading-xl text-content-primary">Dashboard</h1>
          <TimeRangeToggle active={timeRange} onChange={setTimeRange} />
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Total Trips"       value={formatNumber(kpis.totalTrips)}      trend={{ value: kpis.totalTripsDelta }} />
          <StatCard label="Active Trips"      value={formatNumber(kpis.activeTrips)}     trend={{ value: kpis.activeTripsChange, suffix: '' }} />
          <StatCard label="New Signups"       value={formatNumber(kpis.newRiderSignups + kpis.newDriverSignups)} trend={{ value: kpis.newSignupsDelta }} />
          <StatCard label="Online Drivers"    value={`${kpis.onlineDrivers}/${formatNumber(kpis.totalDrivers)}`} trend={{ value: kpis.onlineDriversDelta }} />
          <StatCard label="Cancellation Rate" value={`${kpis.cancellationRate}%`}        trend={{ value: kpis.cancellationDelta }} />
          <StatCard label="Avg ETA"           value={`${kpis.avgEtaMinutes} min`} />
          <StatCard label="Avg Rating"        value={`${kpis.avgRating} ★`} />
          <StatCard label="Revenue"           value={`₹${formatNumber(kpis.grossRevenue)}`} trend={{ value: kpis.revenueDelta }} />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-2 gap-4">
          <SvgAreaChart data={tripsChart}   title="Trips" />
          <SvgAreaChart data={revenueChart} title="Revenue"           valuePrefix="₹" />
          <SvgAreaChart data={cancelChart}  title="Cancellation rate" valueSuffix="%" />
          <SvgAreaChart data={driversChart} title="Drivers online" />
        </div>

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
