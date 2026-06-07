import { useEffect, useState, useCallback } from 'react';

const API = '/api/v1/admin';

const authHeaders = (json = false): Record<string, string> => {
  const token = localStorage.getItem('admin_jwt_token') || '';
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
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
  EV: 'bg-green-100 text-green-700',
  CNG: 'bg-teal-100 text-teal-700',
  PETROL: 'bg-orange-100 text-orange-700',
  DIESEL: 'bg-red-100 text-red-700',
  HYBRID: 'bg-blue-100 text-blue-700',
};

export function ESGDashboard() {
  const [tab, setTab] = useState<'overview' | 'records' | 'reports'>('overview');
  const [factors, setFactors] = useState<EmissionFactor[]>([]);
  const [records, setRecords] = useState<CarbonRecord[]>([]);
  const [reports, setReports] = useState<ESGReport[]>([]);
  const [mtd, setMtd] = useState<MTDSummary>({ total_emission_kg: 0, total_trips: 0 });

  const load = useCallback(async () => {
    const r = await fetch(`${API}/esg/summary`, { headers: authHeaders() });
    const d = await r.json();
    setFactors(d.emission_factors ?? []);
    setRecords(d.carbon_records ?? []);
    setReports(d.esg_reports ?? []);
    setMtd(d.mtd_summary ?? { total_emission_kg: 0, total_trips: 0 });
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
      <h1 className="text-2xl font-bold text-gray-900">Carbon & ESG Reporting</h1>

      <div className="flex gap-2 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px ${tab === t.key ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-green-50 rounded-lg p-4">
              <p className="text-2xl font-bold text-green-700">{mtd.total_trips.toLocaleString()}</p>
              <p className="text-sm text-green-600">Trips MTD</p>
            </div>
            <div className="bg-orange-50 rounded-lg p-4">
              <p className="text-2xl font-bold text-orange-700">{mtd.total_emission_kg.toFixed(1)} kg</p>
              <p className="text-sm text-orange-600">CO₂ Emitted MTD</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-4">
              <p className="text-2xl font-bold text-blue-700">{totalNetMTD.toFixed(1)} kg</p>
              <p className="text-sm text-blue-600">Net Emissions</p>
            </div>
            <div className="bg-teal-50 rounded-lg p-4">
              <p className="text-2xl font-bold text-teal-700">{factors.length}</p>
              <p className="text-sm text-teal-600">Vehicle Types Tracked</p>
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-gray-700 mb-3">Emission Factors by Vehicle Type</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {factors.map(f => (
                <div key={f.vehicle_type} className="p-3 bg-white border border-gray-200 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded font-semibold ${VT_CLS[f.vehicle_type] ?? 'bg-gray-100 text-gray-600'}`}>{f.vehicle_type}</span>
                    <span className="font-bold text-gray-800">{f.co2_kg_per_km} kg/km</span>
                  </div>
                  <p className="text-xs text-gray-500">{f.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'records' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>{['Date', 'Vehicle Type', 'Distance', 'Emission', 'Offset', 'Net'].map(h => <th key={h} className="text-left p-3 font-medium text-gray-600">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {records.map(r => {
                const net = r.emission_kg - r.offset_kg;
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="p-3 text-gray-500 text-xs">{r.recorded_date}</td>
                    <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded ${VT_CLS[r.vehicle_type] ?? 'bg-gray-100'}`}>{r.vehicle_type}</span></td>
                    <td className="p-3">{r.distance_km.toFixed(1)} km</td>
                    <td className="p-3 text-orange-600">{r.emission_kg.toFixed(3)} kg</td>
                    <td className="p-3 text-green-600">{r.offset_kg.toFixed(3)} kg</td>
                    <td className={`p-3 font-semibold ${net > 0 ? 'text-red-600' : 'text-green-600'}`}>{net.toFixed(3)} kg</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'reports' && (
        <div className="space-y-4">
          {reports.map(rp => (
            <div key={rp.id} className="p-5 bg-white border border-gray-200 rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${rp.status === 'PUBLISHED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{rp.status}</span>
                    <h3 className="font-semibold text-gray-900">{rp.period}</h3>
                  </div>
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div><p className="text-gray-500 text-xs">Total Trips</p><p className="font-semibold">{rp.total_trips.toLocaleString()}</p></div>
                    <div><p className="text-gray-500 text-xs">Distance</p><p className="font-semibold">{rp.total_distance_km.toFixed(0)} km</p></div>
                    <div><p className="text-gray-500 text-xs">CO₂ Emitted</p><p className="font-semibold text-orange-600">{rp.total_emission_kg.toFixed(1)} kg</p></div>
                    <div><p className="text-gray-500 text-xs">Net Emission</p><p className={`font-semibold ${rp.net_emission_kg > 0 ? 'text-red-600' : 'text-green-600'}`}>{rp.net_emission_kg.toFixed(1)} kg</p></div>
                    <div><p className="text-gray-500 text-xs">EV Trips</p><p className="font-semibold text-green-600">{rp.ev_trip_pct.toFixed(1)}%</p></div>
                    <div><p className="text-gray-500 text-xs">Women Drivers</p><p className="font-semibold">{rp.women_driver_pct.toFixed(1)}%</p></div>
                  </div>
                </div>
                {rp.status === 'DRAFT' && (
                  <button onClick={() => publishReport(rp.id)} className="ml-4 px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 whitespace-nowrap">Publish</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
