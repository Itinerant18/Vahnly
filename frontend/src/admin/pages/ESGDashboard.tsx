import { useEffect, useState, useCallback } from 'react';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';

const API = '/api/v1/admin';

const authHeaders = (json = false): Record<string, string> => {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  return h;
};

interface EmissionFactor {
  vehicle_type: string;
  co2_kg_per_km: number;
  description: string;
}

interface CarbonRecord {
  id: string;
  trip_id?: string;
  vehicle_type: string;
  distance_km: number;
  emission_kg: number;
  offset_kg: number;
  recorded_date: string;
  [key: string]: unknown;
}

interface ESGReport {
  id: string;
  period: string;
  total_trips: number;
  total_distance_km: number;
  total_emission_kg: number;
  total_offset_kg: number;
  net_emission_kg: number;
  ev_trip_pct: number;
  women_driver_pct: number;
  status: string;
  metrics: Record<string, unknown>;
  created_at: string;
}

interface MTDSummary {
  total_emission_kg: number;
  total_trips: number;
}

const VT_CLS: Record<string, string> = {
  EV: 'bg-surface-positive text-content-positive',
  CNG: 'bg-surface-positive text-content-positive',
  PETROL: 'bg-surface-warning text-content-warning',
  DIESEL: 'bg-surface-negative text-content-negative',
  HYBRID: 'bg-surface-accent text-content-accent',
};

const ESG_COLUMNS: ColumnDef<CarbonRecord>[] = [
  { key: 'recorded_date', header: 'Date', type: 'date' },
  {
    key: 'vehicle_type', header: 'Vehicle Type',
    render: (v) => <span className={`text-xs px-2 py-0.5 rounded ${VT_CLS[String(v)] ?? 'bg-background-secondary'}`}>{String(v)}</span>,
  },
  {
    key: 'distance_km', header: 'Distance', type: 'numeric',
    render: (v) => <span className="font-mono text-mono-small tabular-nums text-content-primary">{Number(v).toFixed(1)} km</span>,
  },
  {
    key: 'emission_kg', header: 'Emission', type: 'numeric',
    render: (v) => <span className="font-mono text-mono-small tabular-nums text-content-warning">{Number(v).toFixed(3)} kg</span>,
  },
  {
    key: 'offset_kg', header: 'Offset', type: 'numeric',
    render: (v) => <span className="font-mono text-mono-small tabular-nums text-content-positive">{Number(v).toFixed(3)} kg</span>,
  },
  {
    key: 'net', header: 'Net', type: 'numeric',
    render: (_v, r) => {
      const net = r.emission_kg - r.offset_kg;
      return <span className={`font-mono text-mono-small tabular-nums font-semibold ${net > 0 ? 'text-content-negative' : 'text-content-positive'}`}>{net.toFixed(3)} kg</span>;
    },
  },
];

export function ESGDashboard() {
  const [tab, setTab] = useState<'overview' | 'records' | 'reports'>('overview');
  const [factors, setFactors] = useState<EmissionFactor[]>([]);
  const [records, setRecords] = useState<CarbonRecord[]>([]);
  const [reports, setReports] = useState<ESGReport[]>([]);
  const [mtd, setMtd] = useState<MTDSummary>({ total_emission_kg: 0, total_trips: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const r = await fetch(`${API}/esg/summary`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setFactors(d.emission_factors ?? []);
      setRecords(d.carbon_records ?? []);
      setReports(d.esg_reports ?? []);
      setMtd(d.mtd_summary ?? { total_emission_kg: 0, total_trips: 0 });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const publishReport = async (id: string) => {
    await fetch(`${API}/esg/reports/${id}/publish`, { method: 'POST', headers: authHeaders() });
    load();
  };

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'records', label: 'Carbon Records' },
    { key: 'reports', label: 'ESG Reports' },
  ] as const;

  const totalNetMTD = records.slice(0, 50).reduce((sum, r) => sum + r.emission_kg - r.offset_kg, 0);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-content-primary">Carbon & ESG Reporting</h1>

      {loading && <p className="text-xs text-content-tertiary animate-pulse">Loading…</p>}
      {error && (
        <div className="bg-surface-negative border-l-4 border-l-negative-400 rounded-sm px-4 py-3 flex items-center gap-2">
          <p className="text-sm text-content-negative">Some data failed to load.</p>
          <button type="button" onClick={() => load()} className="ml-auto rounded-sm border border-negative-400 px-3 py-1 text-xs text-content-negative hover:bg-background-secondary transition-colors">Retry</button>
        </div>
      )}

      <div className="flex gap-2 border-b border-border-opaque">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px ${tab === t.key ? 'border-b-2 border-border-accent text-content-accent' : 'text-content-secondary hover:text-content-primary'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-surface-positive rounded-lg p-4">
              <p className="text-2xl font-bold text-content-positive">{mtd.total_trips.toLocaleString()}</p>
              <p className="text-sm text-content-positive">Trips MTD</p>
            </div>
            <div className="bg-surface-warning rounded-lg p-4">
              <p className="text-2xl font-bold text-content-warning">{mtd.total_emission_kg.toFixed(1)} kg</p>
              <p className="text-sm text-content-warning">CO₂ Emitted MTD</p>
            </div>
            <div className="bg-surface-accent rounded-lg p-4">
              <p className="text-2xl font-bold text-content-accent">{totalNetMTD.toFixed(1)} kg</p>
              <p className="text-sm text-content-accent">Net Emissions</p>
            </div>
            <div className="bg-surface-positive rounded-lg p-4">
              <p className="text-2xl font-bold text-content-positive">{factors.length}</p>
              <p className="text-sm text-content-positive">Vehicle Types Tracked</p>
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-content-primary mb-3">Emission Factors by Vehicle Type</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {factors.map(f => (
                <div key={f.vehicle_type} className="p-3 bg-white border border-border-opaque rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded font-semibold ${VT_CLS[f.vehicle_type] ?? 'bg-background-secondary text-content-secondary'}`}>{f.vehicle_type}</span>
                    <span className="font-bold text-content-primary">{f.co2_kg_per_km} kg/km</span>
                  </div>
                  <p className="text-xs text-content-secondary">{f.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'records' && (
        <DataTable<CarbonRecord>
          columns={ESG_COLUMNS}
          data={records}
          rowKey={(r) => r.id}
        />
      )}

      {tab === 'reports' && (
        <div className="space-y-4">
          {reports.map(rp => (
            <div key={rp.id} className="p-5 bg-white border border-border-opaque rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${rp.status === 'PUBLISHED' ? 'bg-surface-positive text-content-positive' : 'bg-surface-warning text-content-warning'}`}>{rp.status}</span>
                    <h3 className="font-semibold text-content-primary">{rp.period}</h3>
                  </div>
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div><p className="text-content-secondary text-xs">Total Trips</p><p className="font-semibold">{rp.total_trips.toLocaleString()}</p></div>
                    <div><p className="text-content-secondary text-xs">Distance</p><p className="font-semibold">{rp.total_distance_km.toFixed(0)} km</p></div>
                    <div><p className="text-content-secondary text-xs">CO₂ Emitted</p><p className="font-semibold text-content-warning">{rp.total_emission_kg.toFixed(1)} kg</p></div>
                    <div><p className="text-content-secondary text-xs">Net Emission</p><p className={`font-semibold ${rp.net_emission_kg > 0 ? 'text-content-negative' : 'text-content-positive'}`}>{rp.net_emission_kg.toFixed(1)} kg</p></div>
                    <div><p className="text-content-secondary text-xs">EV Trips</p><p className="font-semibold text-content-positive">{rp.ev_trip_pct.toFixed(1)}%</p></div>
                    <div><p className="text-content-secondary text-xs">Women Drivers</p><p className="font-semibold">{rp.women_driver_pct.toFixed(1)}%</p></div>
                  </div>
                </div>
                {rp.status === 'DRAFT' && (
                  <button onClick={() => publishReport(rp.id)} className="ml-4 px-4 py-2 bg-positive-400 text-white text-sm rounded hover:bg-positive-400 whitespace-nowrap">Publish</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
