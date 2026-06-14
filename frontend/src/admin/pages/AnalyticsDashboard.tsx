import React, { useState, useEffect, useCallback } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';
import { SvgAreaChart } from '../components/SvgAreaChart';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';

interface Summary {
  total_trips: number;
  completed_trips: number;
  cancelled_trips: number;
  revenue_paise: number;
  cancellation_rate: number;
  unique_riders: number;
  active_drivers: number;
  avg_fare_paise: number;
}

interface DayStat {
  day: string;
  total?: number;
  completed?: number;
  cancelled?: number;
  revenue_paise?: number;
}

interface HourStat { hour: number; demand: number; }

interface Funnel {
  created: number;
  assigned: number;
  started: number;
  completed: number;
  cancelled: number;
}

interface CityRow {
  city: string;
  total: number;
  revenue_paise: number;
  [key: string]: unknown;
}

type Period = '7d' | '30d' | '90d';

const PERIOD_LABELS: Record<Period, string> = { '7d': '7 Days', '30d': '30 Days', '90d': '90 Days' };

function periodToRange(p: Period): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (p === '7d' ? 7 : p === '30d' ? 30 : 90));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function pct(n: number, d: number) {
  if (!d) return '—';
  return `${((n / d) * 100).toFixed(1)}%`;
}

const CITY_COLUMNS: ColumnDef<CityRow>[] = [
  {
    key: 'city', header: 'City', sortable: true,
    render: (v) => <span className="font-mono text-content-primary font-medium">{String(v)}</span>,
  },
  { key: 'total', header: 'Trips', type: 'numeric', sortable: true },
  { key: 'revenue_paise', header: 'Revenue', type: 'currency', sortable: true },
  {
    key: 'avg', header: 'Avg/Trip', type: 'numeric',
    render: (_v, r) => (
      <span className="font-mono text-mono-small text-content-secondary tabular-nums">
        {r.total ? rupees(Math.round(r.revenue_paise / r.total)) : '—'}
      </span>
    ),
  },
];

const KPI: React.FC<{ label: string; value: string; sub?: string; accent?: boolean }> = ({ label, value, sub, accent }) => (
  <div className={`rounded-xl border p-5 flex flex-col gap-1 ${accent ? 'border-accent/30 bg-accent/5' : 'border-background-secondary bg-background-primary'}`}>
    <div className="text-xs text-content-tertiary uppercase tracking-wide">{label}</div>
    <div className="text-2xl font-bold text-content-primary">{value}</div>
    {sub && <div className="text-xs text-content-secondary">{sub}</div>}
  </div>
);

export const AnalyticsDashboard: React.FC = () => {
  const [period, setPeriod] = useState<Period>('30d');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tripsData, setTripsData] = useState<DayStat[]>([]);
  const [revenueData, setRevenueData] = useState<DayStat[]>([]);
  const [hourData, setHourData] = useState<HourStat[]>([]);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const role = localStorage.getItem('admin_role') || 'ADMIN';
  const headers = {
    'X-Admin-Role': role,
    'X-Admin-Email': localStorage.getItem('admin_email') || '',
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { from, to } = periodToRange(period);
    const qs = `?from=${from}&to=${to}`;
    const base = `${API_GATEWAY_BASE_URL}/api/v1/admin/analytics`;

    try {
      const [sRes, tRes, rRes, hRes, fRes, cRes] = await Promise.all([
        fetch(`${base}/summary${qs}`, { headers }),
        fetch(`${base}/trips-over-time${qs}`, { headers }),
        fetch(`${base}/revenue-over-time${qs}`, { headers }),
        fetch(`${base}/demand-by-hour${qs}`, { headers }),
        fetch(`${base}/funnel${qs}`, { headers }),
        fetch(`${base}/top-cities${qs}`, { headers }),
      ]);
      if (sRes.ok) setSummary(await sRes.json());
      if (tRes.ok) { const d = await tRes.json(); setTripsData(d.data || []); }
      if (rRes.ok) { const d = await rRes.json(); setRevenueData(d.data || []); }
      if (hRes.ok) { const d = await hRes.json(); setHourData(d.data || []); }
      if (fRes.ok) setFunnel(await fRes.json());
      if (cRes.ok) { const d = await cRes.json(); setCities(d.data || []); }
    } catch (_) {
      // network error — backend may be offline
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const tripsChartData = tripsData.map(d => ({ label: d.day.slice(5), value: d.total ?? 0 }));
  const revenueChartData = revenueData.map(d => ({ label: d.day.slice(5), value: Math.round((d.revenue_paise ?? 0) / 100) }));
  const hourChartPoints = Array.from({ length: 24 }, (_, i) => {
    const found = hourData.find(h => h.hour === i);
    return { label: `${i}h`, value: found?.demand ?? 0 };
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-content-primary">Analytics & Reports</h1>
          <p className="text-sm text-content-tertiary">Platform-wide performance metrics</p>
        </div>
        <div className="flex gap-2">
          {(['7d', '30d', '90d'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                period === p
                  ? 'bg-accent text-white'
                  : 'bg-background-primary border border-background-secondary text-content-secondary hover:text-content-primary'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="text-sm text-content-tertiary animate-pulse">Loading analytics…</div>}

      {/* KPI Grid */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPI label="Total Trips" value={summary.total_trips.toLocaleString()} accent />
          <KPI label="Completed" value={summary.completed_trips.toLocaleString()} sub={pct(summary.completed_trips, summary.total_trips)} />
          <KPI label="Cancelled" value={summary.cancelled_trips.toLocaleString()} sub={`${summary.cancellation_rate.toFixed(1)}%`} />
          <KPI label="Gross Revenue" value={rupees(summary.revenue_paise)} accent />
          <KPI label="Unique Riders" value={summary.unique_riders.toLocaleString()} />
          <KPI label="Active Drivers" value={summary.active_drivers.toLocaleString()} />
          <KPI label="Avg Fare" value={rupees(summary.avg_fare_paise)} />
          <KPI label="Conversion" value={pct(summary.completed_trips, summary.total_trips)} />
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-background-primary rounded-xl border border-background-secondary p-5">
          <div className="text-sm font-semibold text-content-primary mb-3">Trips Over Time</div>
          {tripsChartData.length >= 2
            ? <SvgAreaChart data={tripsChartData} height={120} strokeColor="var(--accent-400)" fillColor="var(--accent-400)" />
            : <div className="text-xs text-content-tertiary">No data for period</div>}
        </div>
        <div className="bg-background-primary rounded-xl border border-background-secondary p-5">
          <div className="text-sm font-semibold text-content-primary mb-3">Revenue (₹) Over Time</div>
          {revenueChartData.length >= 2
            ? <SvgAreaChart data={revenueChartData} height={120} strokeColor="var(--positive-400)" fillColor="var(--positive-400)" />
            : <div className="text-xs text-content-tertiary">No data for period</div>}
        </div>
      </div>

      {/* Demand by Hour + Funnel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Demand heatmap by hour */}
        <div className="bg-background-primary rounded-xl border border-background-secondary p-5">
          <div className="text-sm font-semibold text-content-primary mb-4">Demand by Hour of Day</div>
          {hourChartPoints.some(p => p.value > 0) ? (
            <div className="flex items-end gap-0.5 h-24">
              {hourChartPoints.map((pt, i) => {
                const maxV = Math.max(...hourChartPoints.map(p => p.value), 1);
                const barH = Math.round((pt.value / maxV) * 100);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div
                      style={{ height: `${barH}%` }}
                      className="w-full bg-accent/60 hover:bg-accent rounded-sm transition-colors min-h-[2px]"
                    />
                    <div className="text-[9px] text-content-tertiary leading-none">{i % 4 === 0 ? pt.label : ''}</div>
                    <div className="absolute bottom-full mb-1 hidden group-hover:block bg-content-primary text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
                      {pt.label}: {pt.value}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-content-tertiary">No data for period</div>
          )}
        </div>

        {/* Funnel */}
        <div className="bg-background-primary rounded-xl border border-background-secondary p-5">
          <div className="text-sm font-semibold text-content-primary mb-4">Booking Funnel</div>
          {funnel ? (
            <div className="space-y-2">
              {[
                { label: 'Booked', value: funnel.created, color: 'bg-surface-accent0' },
                { label: 'Assigned', value: funnel.assigned, color: 'bg-surface-accent0' },
                { label: 'Trip Started', value: funnel.started, color: 'bg-surface-positive0' },
                { label: 'Completed', value: funnel.completed, color: 'bg-surface-positive0' },
                { label: 'Cancelled', value: funnel.cancelled, color: 'bg-negative-400' },
              ].map(step => {
                const pctVal = funnel.created > 0 ? Math.round((step.value / funnel.created) * 100) : 0;
                return (
                  <div key={step.label} className="flex items-center gap-3">
                    <div className="w-24 text-xs text-content-secondary shrink-0">{step.label}</div>
                    <div className="flex-1 h-5 bg-background-secondary rounded-sm overflow-hidden">
                      <div className={`h-full ${step.color} rounded-sm transition-all`} style={{ width: `${pctVal}%` }} />
                    </div>
                    <div className="w-20 text-right text-xs text-content-primary font-mono">
                      {step.value.toLocaleString()} <span className="text-content-tertiary">({pctVal}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-content-tertiary">No data for period</div>
          )}
        </div>
      </div>

      {/* Top Cities Table */}
      {cities.length > 0 && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-5">
          <div className="text-sm font-semibold text-content-primary mb-4">Top Cities by Volume</div>
          <DataTable<CityRow>
            columns={CITY_COLUMNS}
            data={cities}
            rowKey={(r) => r.city}
          />
        </div>
      )}
    </div>
  );
};
