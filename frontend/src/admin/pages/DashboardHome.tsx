import React from 'react';
import { SvgAreaChart } from '../components/SvgAreaChart';
import { useDashboardData, TimeRange } from '../hooks/useDashboardData';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatNumber(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000) return `${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000) return n.toLocaleString('en-IN');
  return String(n);
}

function DeltaPill({ value, suffix = '%' }: { value: number; suffix?: string }) {
  const isPositive = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-pill px-2 py-0.5 text-[11px] font-medium font-mono leading-none ${
        isPositive ? 'bg-canvas-soft text-ink' : 'bg-ink text-on-dark'
      }`}
    >
      {isPositive ? '↑' : '↓'}
      {Math.abs(value)}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  KPI Card                                                           */
/* ------------------------------------------------------------------ */

interface KpiCardProps {
  label: string;
  value: string;
  delta?: { value: number; suffix?: string } | null;
}

function KpiCard({ label, value, delta }: KpiCardProps) {
  return (
    <div className="bg-canvas rounded-xl border border-canvas-soft p-5 flex flex-col gap-1">
      <span className="text-xs font-medium text-body mb-1">{label}</span>
      <span className="text-2xl font-bold font-mono text-ink">{value}</span>
      {delta != null && <DeltaPill value={delta.value} suffix={delta.suffix} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Time Range Toggle                                                  */
/* ------------------------------------------------------------------ */

const ranges: { key: TimeRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

function TimeRangeToggle({
  active,
  onChange,
}: {
  active: TimeRange;
  onChange: (r: TimeRange) => void;
}) {
  return (
    <div className="flex items-center bg-canvas-soft rounded-pill p-0.5 gap-0.5">
      {ranges.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`rounded-pill-tab px-4 py-1.5 text-sm font-medium transition-colors ${
            active === key
              ? 'bg-ink text-on-dark'
              : 'bg-transparent text-ink hover:bg-canvas-softer'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Status Badge                                                       */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: 'completed' | 'active' | 'cancelled' }) {
  const styles: Record<string, string> = {
    completed: 'bg-canvas-soft text-ink',
    active: 'bg-ink text-on-dark',
    cancelled: 'bg-canvas-soft text-body',
  };
  return (
    <span className={`rounded-pill px-2.5 py-0.5 text-[11px] font-medium capitalize ${styles[status]}`}>
      {status}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Alert Type Badge                                                   */
/* ------------------------------------------------------------------ */

function AlertTypeBadge({ type }: { type: string }) {
  return (
    <span className="rounded-pill bg-canvas-soft text-ink px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
      {type}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export const DashboardHome: React.FC = () => {
  const {
    kpis,
    tripsChart,
    revenueChart,
    cancelChart,
    driversChart,
    alerts,
    recentTrips,
    timeRange,
    setTimeRange,
  } = useDashboardData();

  return (
    <div className="w-full h-full overflow-y-auto p-6 space-y-6">
      {/* ---- Header ---- */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Dashboard</h1>
        <TimeRangeToggle active={timeRange} onChange={setTimeRange} />
      </div>

      {/* ---- KPI Cards ---- */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="Total trips"
          value={formatNumber(kpis.totalTrips)}
          delta={{ value: kpis.totalTripsDelta }}
        />
        <KpiCard
          label="Active trips"
          value={formatNumber(kpis.activeTrips)}
          delta={{ value: kpis.activeTripsChange, suffix: '' }}
        />
        <KpiCard
          label="New signups"
          value={formatNumber(kpis.newRiderSignups + kpis.newDriverSignups)}
          delta={{ value: kpis.newSignupsDelta }}
        />
        <KpiCard
          label="Online drivers"
          value={`${kpis.onlineDrivers} / ${formatNumber(kpis.totalDrivers)}`}
          delta={{ value: kpis.onlineDriversDelta }}
        />
        <KpiCard
          label="Cancellation rate"
          value={`${kpis.cancellationRate}%`}
          delta={{ value: kpis.cancellationDelta }}
        />
        <KpiCard
          label="Avg ETA to pickup"
          value={`${kpis.avgEtaMinutes} min`}
        />
        <KpiCard
          label="Avg trip rating"
          value={`${kpis.avgRating} ★`}
        />
        <KpiCard
          label="Revenue"
          value={`₹${formatNumber(kpis.grossRevenue)}`}
          delta={{ value: kpis.revenueDelta }}
        />
      </div>

      {/* ---- Charts ---- */}
      <div className="grid grid-cols-2 gap-4">
        <SvgAreaChart data={tripsChart} title="Trips" />
        <SvgAreaChart data={revenueChart} title="Revenue" valuePrefix="₹" />
        <SvgAreaChart data={cancelChart} title="Cancellation rate" valueSuffix="%" />
        <SvgAreaChart data={driversChart} title="Drivers online" />
      </div>

      {/* ---- Bottom: Trips Table + Alerts ---- */}
      <div className="grid grid-cols-5 gap-4">
        {/* Recent Trips — 3/5 = 60% */}
        <div className="col-span-3 bg-canvas rounded-xl border border-canvas-soft p-5">
          <h2 className="text-sm font-medium text-ink mb-4">Recent trips</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-canvas-soft">
                  <th className="text-mute uppercase text-[10px] tracking-wider font-medium pb-2 pr-4">Trip ID</th>
                  <th className="text-mute uppercase text-[10px] tracking-wider font-medium pb-2 pr-4">Rider</th>
                  <th className="text-mute uppercase text-[10px] tracking-wider font-medium pb-2 pr-4">Driver</th>
                  <th className="text-mute uppercase text-[10px] tracking-wider font-medium pb-2 pr-4">Status</th>
                  <th className="text-mute uppercase text-[10px] tracking-wider font-medium pb-2 pr-4 text-right">Amount</th>
                  <th className="text-mute uppercase text-[10px] tracking-wider font-medium pb-2 text-right">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-soft">
                {recentTrips.map((trip) => (
                  <tr key={trip.tripId} className="hover:bg-canvas-softer transition-colors">
                    <td className="py-2.5 pr-4 text-sm font-mono text-ink">{trip.tripId}</td>
                    <td className="py-2.5 pr-4 text-sm text-ink">{trip.rider}</td>
                    <td className="py-2.5 pr-4 text-sm text-ink">{trip.driver}</td>
                    <td className="py-2.5 pr-4">
                      <StatusBadge status={trip.status} />
                    </td>
                    <td className="py-2.5 pr-4 text-sm font-mono text-ink text-right">
                      {trip.amount > 0 ? `₹${trip.amount}` : '—'}
                    </td>
                    <td className="py-2.5 text-sm font-mono text-ink text-right">
                      {trip.durationMin > 0 ? `${trip.durationMin} min` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Alerts — 2/5 = 40% */}
        <div className="col-span-2 bg-canvas rounded-xl border border-canvas-soft p-5">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm font-medium text-ink">Alerts</h2>
            <span className="rounded-pill bg-ink text-on-dark px-2 py-0.5 text-[11px] font-mono font-medium">
              {alerts.length}
            </span>
          </div>
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div key={alert.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-mute whitespace-nowrap">
                    {alert.timestamp}
                  </span>
                  <AlertTypeBadge type={alert.type} />
                </div>
                <div className="flex items-start gap-1.5">
                  {alert.severity === 'critical' && (
                    <span className="mt-1 w-2 h-2 rounded-full bg-status-alert flex-shrink-0" />
                  )}
                  <p className="text-sm text-ink leading-snug">{alert.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
