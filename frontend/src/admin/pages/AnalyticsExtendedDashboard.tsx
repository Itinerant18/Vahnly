import React, { useState, useEffect, useCallback } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';
import { SvgAreaChart } from '../components/SvgAreaChart';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';
import { exportToCsv, type CsvColumn } from '../lib/tableTools';

type PrebuiltTab = 'operations' | 'growth' | 'finance' | 'driver-supply' | 'marketing' | 'safety';
type ReportTab = 'prebuilt' | 'custom' | 'exports';
type Period = '7d' | '30d' | '90d';

const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '30d': 30, '90d': 90 };
const DASHBOARD_LABELS: Record<PrebuiltTab, string> = {
  operations: 'Operations', growth: 'Growth', finance: 'Finance',
  'driver-supply': 'Driver Supply', marketing: 'Marketing', safety: 'Safety',
};
const DASHBOARD_ICONS: Record<PrebuiltTab, string> = {
  operations: '🗺', growth: '📈', finance: '💰', 'driver-supply': '🚗', marketing: '📣', safety: '🛡',
};

function rupees(p: number) { return `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`; }

const KPI: React.FC<{ label: string; value: string | number; sub?: string; color?: string }> = ({ label, value, sub, color }) => (
  <div className={`rounded-xl border p-4 ${color ? `border-${color}-200 bg-${color}-50` : 'border-background-secondary bg-background-primary'}`}>
    <div className="text-xs text-content-tertiary uppercase tracking-wide">{label}</div>
    <div className="text-2xl font-bold text-content-primary mt-1">{typeof value === 'number' ? value.toLocaleString() : value}</div>
    {sub && <div className="text-xs text-content-secondary mt-0.5">{sub}</div>}
  </div>
);

// ── Main Component ───────────────────────────────────────────────────────────
export const AnalyticsExtendedDashboard: React.FC = () => {
  const [mainTab, setMainTab] = useState<ReportTab>('prebuilt');
  const [activeDB, setActiveDB] = useState<PrebuiltTab>('operations');
  const [period, setPeriod] = useState<Period>('30d');
  const [dbData, setDbData] = useState<any>(null);
  const [tripsData, setTripsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const role = localStorage.getItem('admin_role') || 'ADMIN';
  const headers = { 'X-Admin-Role': role };

  const periodRange = () => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - PERIOD_DAYS[period]);
    return `from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`;
  };

  const fetchDashboard = useCallback(async () => {
    setLoading(true); setDbData(null);
    try {
      const base = `${API_GATEWAY_BASE_URL}/api/v1/admin/analytics`;
      const qs = periodRange();
      const [dbRes, tripsRes] = await Promise.all([
        fetch(`${base}/prebuilt/${activeDB}?${qs}`, { headers }),
        fetch(`${base}/trips-over-time?${qs}`, { headers }),
      ]);
      if (dbRes.ok) setDbData(await dbRes.json());
      if (tripsRes.ok) { const d = await tripsRes.json(); setTripsData(d.data || []); }
    } catch (_) {
    } finally { setLoading(false); }
  }, [activeDB, period]);

  useEffect(() => { if (mainTab === 'prebuilt') fetchDashboard(); }, [fetchDashboard, mainTab]);

  const chartPoints = tripsData.map(d => ({ label: d.day?.slice(5) ?? '', value: d.total ?? 0 }));

  const exportCSV = (report: string) => {
    const qs = periodRange();
    window.open(`${API_GATEWAY_BASE_URL}/api/v1/admin/analytics/export?report=${report}&${qs}`, '_blank');
  };

  // Export the in-memory chart series of a single chart to CSV.
  const exportChartCsv = (filename: string, rows: { label: string; value: number }[]) =>
    exportToCsv<{ label: string; value: number }>(
      `${filename}_${new Date().toISOString().slice(0, 10)}.csv`,
      [{ key: 'label', label: 'period' }, { key: 'value', label: 'value' }],
      rows,
    );

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-content-primary">Analytics & Reports</h1>
          <p className="text-sm text-content-tertiary">Prebuilt dashboards and custom report builder</p>
        </div>
        <div className="flex gap-2">
          {(['7d', '30d', '90d'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                period === p ? 'bg-accent text-white border-accent' : 'bg-background-primary border-background-secondary text-content-secondary hover:text-content-primary'
              }`}>{p}</button>
          ))}
        </div>
      </div>

      {/* Top tabs */}
      <div className="flex gap-1 border-b border-background-secondary">
        {(['prebuilt', 'custom', 'exports'] as ReportTab[]).map(t => (
          <button key={t} onClick={() => setMainTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
              mainTab === t ? 'border-accent text-accent' : 'border-transparent text-content-secondary hover:text-content-primary'
            }`}>
            {t === 'prebuilt' ? 'Prebuilt Dashboards' : t === 'custom' ? 'Custom Reports' : 'Exports'}
          </button>
        ))}
      </div>

      {/* Prebuilt Dashboards */}
      {mainTab === 'prebuilt' && (
        <div className="space-y-5">
          {/* Dashboard selector */}
          <div className="flex gap-2 flex-wrap">
            {(Object.keys(DASHBOARD_LABELS) as PrebuiltTab[]).map(d => (
              <button key={d} onClick={() => setActiveDB(d)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors flex items-center gap-1.5 ${
                  activeDB === d ? 'bg-accent text-white border-accent' : 'bg-background-primary border-background-secondary text-content-secondary hover:text-content-primary'
                }`}>
                {DASHBOARD_ICONS[d]} {DASHBOARD_LABELS[d]}
              </button>
            ))}
          </div>

          {loading && <div className="text-sm text-content-tertiary animate-pulse">Loading {DASHBOARD_LABELS[activeDB]} dashboard…</div>}

          {!loading && dbData && (
            <>
              {/* Operations Dashboard */}
              {activeDB === 'operations' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    <KPI label="Active Trips" value={dbData.active_trips ?? 0} color="indigo" />
                    <KPI label="Online Drivers" value={dbData.online_drivers ?? 0} color="emerald" />
                    <KPI label="Active SOS" value={dbData.open_sos ?? 0} color={dbData.open_sos > 0 ? 'red' : undefined} />
                    <KPI label="Open Tickets" value={dbData.open_tickets ?? 0} />
                    <KPI label="Trips Today" value={dbData.today_trips ?? 0} />
                    <KPI label="Revenue Today" value={rupees(dbData.today_revenue_paise ?? 0)} />
                  </div>
                  {chartPoints.length >= 2 && (
                    <div className="bg-background-primary rounded-xl border border-background-secondary p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-semibold text-content-primary">Trips Over Period</div>
                        <button onClick={() => exportChartCsv('trips_over_period', chartPoints)}
                          className="text-xs border border-background-secondary rounded px-2 py-1 text-content-secondary hover:bg-background-secondary">↓ CSV</button>
                      </div>
                      <SvgAreaChart data={chartPoints} height={140} strokeColor="var(--accent-400)" fillColor="var(--accent-400)" />
                    </div>
                  )}
                </div>
              )}

              {/* Growth Dashboard */}
              {activeDB === 'growth' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <KPI label="Unique Riders (period)" value={dbData.period_riders ?? 0} />
                    <KPI label="New Drivers (period)" value={dbData.period_drivers ?? 0} />
                    <KPI label="Total Trips" value={dbData.period_trips ?? 0} color="indigo" />
                  </div>
                  {chartPoints.length >= 2 && (
                    <div className="bg-background-primary rounded-xl border border-background-secondary p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-semibold text-content-primary">Trip Volume Trend</div>
                        <button onClick={() => exportChartCsv('trip_volume_trend', chartPoints)}
                          className="text-xs border border-background-secondary rounded px-2 py-1 text-content-secondary hover:bg-background-secondary">↓ CSV</button>
                      </div>
                      <SvgAreaChart data={chartPoints} height={140} strokeColor="var(--positive-400)" fillColor="var(--positive-400)" />
                    </div>
                  )}
                  {dbData.daily_riders?.length > 0 && (
                    <div className="bg-background-primary rounded-xl border border-background-secondary p-5">
                      <div className="text-sm font-semibold text-content-primary mb-3">Daily Active Riders</div>
                      <SvgAreaChart
                        data={dbData.daily_riders.map((r: any) => ({ label: r.day?.slice(5) ?? '', value: r.riders ?? 0 }))}
                        height={120} strokeColor="var(--warning-400)" fillColor="var(--warning-400)"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Finance Dashboard */}
              {activeDB === 'finance' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <KPI label="Gross Revenue" value={rupees(dbData.gross_revenue_paise ?? 0)} color="emerald" />
                    <KPI label="Completed Trips" value={dbData.completed_trips ?? 0} />
                    <KPI label="Avg Fare" value={rupees(dbData.avg_fare_paise ?? 0)} />
                    <KPI label="Pending Payouts" value={rupees(dbData.pending_payouts_paise ?? 0)} color="yellow" />
                    <KPI label="Paid Payouts" value={rupees(dbData.paid_payouts_paise ?? 0)} />
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => exportCSV('revenue')}
                      className="px-4 py-2 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">
                      ↓ Export Revenue CSV
                    </button>
                  </div>
                </div>
              )}

              {/* Driver Supply Dashboard */}
              {activeDB === 'driver-supply' && dbData.state_counts && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <KPI label="Available" value={dbData.state_counts.available ?? 0} color="emerald" />
                    <KPI label="En Route" value={dbData.state_counts.en_route ?? 0} color="blue" />
                    <KPI label="On Trip" value={dbData.state_counts.delivering ?? 0} color="indigo" />
                    <KPI label="Offline" value={dbData.state_counts.offline ?? 0} />
                  </div>
                  <KPI label="Active Drivers (period)" value={dbData.active_drivers_period ?? 0} />
                  <div className="bg-background-primary rounded-xl border border-background-secondary p-5">
                    <div className="text-sm font-semibold text-content-primary mb-3">Driver State Distribution</div>
                    <div className="space-y-2">
                      {[
                        { label: 'Available', value: dbData.state_counts.available ?? 0, color: 'bg-surface-positive0' },
                        { label: 'En Route', value: dbData.state_counts.en_route ?? 0, color: 'bg-surface-accent0' },
                        { label: 'On Trip', value: dbData.state_counts.delivering ?? 0, color: 'bg-surface-accent0' },
                        { label: 'Offline', value: dbData.state_counts.offline ?? 0, color: 'bg-background-tertiary' },
                      ].map(row => {
                        const total = (dbData.state_counts.available + dbData.state_counts.en_route + dbData.state_counts.delivering + dbData.state_counts.offline) || 1;
                        const pct = Math.round((row.value / total) * 100);
                        return (
                          <div key={row.label} className="flex items-center gap-3">
                            <div className="w-20 text-xs text-content-secondary shrink-0">{row.label}</div>
                            <div className="flex-1 h-4 bg-background-secondary rounded-sm overflow-hidden">
                              <div className={`h-full ${row.color}`} style={{ width: `${pct}%` }} />
                            </div>
                            <div className="w-20 text-right text-xs text-content-primary font-mono">{row.value.toLocaleString()} ({pct}%)</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Marketing Dashboard */}
              {activeDB === 'marketing' && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <KPI label="Active Campaigns" value={dbData.active_campaigns ?? 0} color="indigo" />
                  <KPI label="Audience Segments" value={dbData.total_segments ?? 0} />
                  <KPI label="Orders in Period" value={dbData.orders_in_period ?? 0} />
                </div>
              )}

              {/* Safety Dashboard */}
              {activeDB === 'safety' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <KPI label="Active SOS" value={dbData.active_sos ?? 0} color={dbData.active_sos > 0 ? 'red' : undefined} />
                    <KPI label="Incidents (period)" value={dbData.total_incidents ?? 0} />
                    <KPI label="Open Investigations" value={dbData.open_incidents ?? 0} color="yellow" />
                    <KPI label="Pending Anomalies" value={dbData.anomalies ?? 0} />
                  </div>
                  {dbData.by_category?.length > 0 && (
                    <div className="bg-background-primary rounded-xl border border-background-secondary p-5">
                      <div className="text-sm font-semibold text-content-primary mb-3">Incidents by Category</div>
                      <div className="space-y-2">
                        {dbData.by_category.map((c: any) => {
                          const maxVal = Math.max(...dbData.by_category.map((x: any) => x.count), 1);
                          return (
                            <div key={c.category} className="flex items-center gap-3">
                              <div className="w-32 text-xs text-content-secondary shrink-0 truncate">{c.category}</div>
                              <div className="flex-1 h-4 bg-background-secondary rounded-sm overflow-hidden">
                                <div className="h-full bg-negative-400" style={{ width: `${(c.count / maxVal) * 100}%` }} />
                              </div>
                              <div className="w-8 text-right text-xs text-content-primary font-mono">{c.count}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Custom Report Builder */}
      {mainTab === 'custom' && <CustomReportBuilder period={period} headers={headers} periodRange={periodRange} />}

      {/* Exports */}
      {mainTab === 'exports' && (
        <div className="space-y-4">
          <p className="text-sm text-content-tertiary">One-click CSV exports for common datasets. The date range above applies to all exports.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { label: 'Trips Export', report: 'trips', desc: 'All trips with fare, status, city, timestamps' },
              { label: 'Revenue Export', report: 'revenue', desc: 'Daily revenue by city for the selected period' },
            ].map(e => (
              <div key={e.report} className="bg-background-primary rounded-xl border border-background-secondary p-5">
                <div className="font-medium text-sm text-content-primary">{e.label}</div>
                <div className="text-xs text-content-tertiary mt-1 mb-3">{e.desc}</div>
                <button onClick={() => exportCSV(e.report)}
                  className="px-4 py-2 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary w-full text-center">
                  ↓ Download CSV
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Custom Report Builder ────────────────────────────────────────────────────
const DIMENSIONS = ['city', 'day', 'week', 'hour', 'status', 'driver_id'] as const;
const METRICS = ['trips', 'completed_trips', 'cancelled_trips', 'revenue_paise', 'unique_riders'] as const;

type Dimension = typeof DIMENSIONS[number];
type Metric = typeof METRICS[number];

// Custom report rows are dynamic (top-cities vs trips-over-time), so columns are
// derived from the result keys. `revenue_paise` is in paise → currency column.
interface ReportRow {
  [key: string]: unknown;
}

const mono = (v: unknown) => (
  <span className="text-xs text-content-secondary font-mono">{String(v)}</span>
);

const buildColumns = (keys: string[]): ColumnDef<ReportRow>[] =>
  keys.map((c) => (
    c === 'revenue_paise'
      ? { key: c, header: c, type: 'currency' as const }
      : { key: c, header: c, render: mono }
  ));

// Persisted custom-report configuration (localStorage).
interface SavedReport {
  name: string;
  dims: Dimension[];
  metrics: Metric[];
}
const SAVED_REPORTS_KEY = 'admin_saved_reports';

const loadSavedReports = (): SavedReport[] => {
  try {
    const raw = localStorage.getItem(SAVED_REPORTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SavedReport[]) : [];
  } catch { return []; }
};

// Map the chosen dimension + metric to the right analytics endpoint.
// Precedence: city → top-cities, hour → demand-by-hour, time(day/week) →
// revenue-over-time when a revenue metric is selected, else trips-over-time.
const resolveEndpoint = (dims: Dimension[], metrics: Metric[]): string => {
  if (dims.includes('city')) return 'top-cities';
  if (dims.includes('hour')) return 'demand-by-hour';
  const wantsRevenue = metrics.includes('revenue_paise');
  return wantsRevenue ? 'revenue-over-time' : 'trips-over-time';
};

const CustomReportBuilder: React.FC<{
  period: Period; headers: Record<string, string>; periodRange: () => string;
}> = ({ headers, periodRange }) => {
  const [dims, setDims] = useState<Dimension[]>(['day']);
  const [metrics, setMetrics] = useState<Metric[]>(['trips', 'revenue_paise']);
  const [result, setResult] = useState<ReportRow[] | null>(null);
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState<SavedReport[]>(loadSavedReports);
  const [reportName, setReportName] = useState('');

  const toggle = <T extends string>(arr: T[], val: T, set: (a: T[]) => void) =>
    arr.includes(val) ? set(arr.filter(x => x !== val)) : set([...arr, val]);

  const runReport = async () => {
    setRunning(true);
    try {
      const base = `${API_GATEWAY_BASE_URL}/api/v1/admin/analytics`;
      const qs = periodRange();
      const endpoint = resolveEndpoint(dims, metrics);
      const res = await fetch(`${base}/${endpoint}?${qs}`, { headers });
      if (res.ok) { const d = await res.json(); setResult(d.data || []); }
      else setResult([]);
    } catch (_) {
    } finally { setRunning(false); }
  };

  const saveReport = () => {
    const name = reportName.trim();
    if (!name) return;
    const next = [...saved.filter(r => r.name !== name), { name, dims, metrics }];
    setSaved(next);
    localStorage.setItem(SAVED_REPORTS_KEY, JSON.stringify(next));
    setReportName('');
  };

  const loadReport = (r: SavedReport) => { setDims(r.dims); setMetrics(r.metrics); };

  const deleteReport = (name: string) => {
    const next = saved.filter(r => r.name !== name);
    setSaved(next);
    localStorage.setItem(SAVED_REPORTS_KEY, JSON.stringify(next));
  };

  const reportColumns = result && result.length > 0 ? buildColumns(Object.keys(result[0])) : [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4">
          <div className="text-sm font-semibold text-content-primary mb-3">Dimensions (Group By)</div>
          <div className="flex flex-wrap gap-2">
            {DIMENSIONS.map(d => (
              <button key={d} onClick={() => toggle(dims, d, setDims)}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors font-mono ${
                  dims.includes(d) ? 'bg-accent text-white border-accent' : 'bg-background-primary border-background-secondary text-content-secondary hover:text-content-primary'
                }`}>{d}</button>
            ))}
          </div>
        </div>
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4">
          <div className="text-sm font-semibold text-content-primary mb-3">Metrics</div>
          <div className="flex flex-wrap gap-2">
            {METRICS.map(m => (
              <button key={m} onClick={() => toggle(metrics, m, setMetrics)}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors font-mono ${
                  metrics.includes(m) ? 'bg-surface-accent0 text-white border-border-accent' : 'bg-background-primary border-background-secondary text-content-secondary hover:text-content-primary'
                }`}>{m}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={runReport} disabled={running || dims.length === 0 || metrics.length === 0}
          className="px-5 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50">
          {running ? 'Running…' : 'Run Report'}
        </button>
        <input
          type="text"
          value={reportName}
          onChange={e => setReportName(e.target.value)}
          placeholder="Report name…"
          className="px-3 py-2 rounded-lg text-sm border border-background-secondary bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" />
        <button onClick={saveReport} disabled={!reportName.trim()}
          className="px-4 py-2 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary disabled:opacity-50">
          💾 Save report
        </button>
      </div>

      {/* Saved reports */}
      {saved.length > 0 && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4">
          <div className="text-sm font-semibold text-content-primary mb-3">Saved Reports</div>
          <div className="flex flex-wrap gap-2">
            {saved.map(r => (
              <div key={r.name} className="flex items-center gap-1 border border-background-secondary rounded-lg pl-3 pr-1.5 py-1">
                <button onClick={() => loadReport(r)} className="text-xs text-content-secondary hover:text-content-primary">
                  {r.name} <span className="text-content-tertiary font-mono">({r.dims.join('+')} · {r.metrics.length}m)</span>
                </button>
                <button onClick={() => deleteReport(r.name)} className="text-content-tertiary hover:text-content-negative text-xs px-1" aria-label={`Delete ${r.name}`}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && result.length > 0 && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => exportToCsv<ReportRow>(
                `custom_report_${new Date().toISOString().slice(0, 10)}.csv`,
                Object.keys(result[0]).map(k => ({ key: k, label: k })) as CsvColumn<ReportRow>[],
                result,
              )}
              className="px-4 py-2 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">
              ↓ Export CSV
            </button>
          </div>
          <DataTable<ReportRow>
            columns={reportColumns}
            data={result}
          />
        </>
      )}
      {result && result.length === 0 && (
        <div className="text-sm text-content-tertiary text-center py-8">No data for the selected configuration.</div>
      )}
    </div>
  );
};
