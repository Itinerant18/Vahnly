import { useEffect, useState, useCallback } from 'react';

const API = '/api/v1/admin';

interface Campaign {
  id: string;
  name: string;
  trigger_type: string;
  reward_type: string;
  reward_value: number;
  target_cities: string[];
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  drivers_targeted: number;
  drivers_claimed: number;
}

interface CoachingFlag {
  id: string;
  driver_id: string;
  flag_type: string;
  severity: string;
  details: Record<string, unknown>;
  is_resolved: boolean;
  created_at: string;
}

interface TrainingModule {
  id: string;
  title: string;
  category: string;
  duration_mins: number;
  is_mandatory: boolean;
  pass_score: number;
  is_active: boolean;
}

interface Inspection {
  id: string;
  driver_id: string;
  vehicle_plate: string;
  status: string;
  due_date: string;
  overall_score?: number;
  notes: string;
}

interface TelSummary {
  driver_id: string;
  period_date: string;
  total_distance_km: number;
  harsh_braking_count: number;
  speeding_count: number;
  safety_score: number;
}

const SEV_CLS: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  LOW: 'bg-gray-100 text-gray-600',
};

const INSP_CLS: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  SUBMITTED: 'bg-blue-100 text-blue-700',
  OVERDUE: 'bg-red-200 text-red-800',
};

export function DriverOpsDashboard() {
  const [tab, setTab] = useState<'incentives' | 'coaching' | 'inspection' | 'telematics'>('incentives');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [flags, setFlags] = useState<CoachingFlag[]>([]);
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [summaries, setSummaries] = useState<TelSummary[]>([]);
  const [inspStatus, setInspStatus] = useState('');

  const load = useCallback(async () => {
    const [c, f, m, s] = await Promise.all([
      fetch(`${API}/driver-ops/incentives`).then(r => r.json()),
      fetch(`${API}/driver-ops/coaching/flags?open=true`).then(r => r.json()),
      fetch(`${API}/driver-ops/coaching/modules`).then(r => r.json()),
      fetch(`${API}/driver-ops/telematics/summaries`).then(r => r.json()),
    ]);
    setCampaigns(c.campaigns ?? []);
    setFlags(f.flags ?? []);
    setModules(m.modules ?? []);
    setSummaries(s.summaries ?? []);
  }, []);

  const loadInspections = useCallback(async () => {
    const qs = inspStatus ? `?status=${inspStatus}` : '';
    const r = await fetch(`${API}/driver-ops/inspections${qs}`);
    const d = await r.json();
    setInspections(d.inspections ?? []);
  }, [inspStatus]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadInspections(); }, [loadInspections]);

  const resolveFlag = async (id: string) => {
    await fetch(`${API}/driver-ops/coaching/flags/${id}/resolve`, { method: 'POST' });
    load();
  };

  const reviewInspection = async (id: string, status: string) => {
    await fetch(`${API}/driver-ops/inspections/${id}/review`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, overall_score: status === 'APPROVED' ? 85 : 0, notes: '' }),
    });
    loadInspections();
  };

  const TABS = [
    { key: 'incentives', label: 'Incentives' },
    { key: 'coaching', label: 'Coaching' },
    { key: 'inspection', label: 'Inspection' },
    { key: 'telematics', label: 'Telematics' },
  ] as const;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Driver Operations</h1>

      <div className="flex gap-2 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px ${tab === t.key ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'incentives' && (
        <div className="space-y-3">
          {campaigns.map(c => (
            <div key={c.id} className="p-4 bg-white border border-gray-200 rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{c.name}</p>
                  <p className="text-sm text-gray-500 mt-1">{c.trigger_type} → {c.reward_type} ₹{c.reward_value} | Cities: {c.target_cities.join(', ')}</p>
                  <p className="text-xs text-gray-400 mt-1">{new Date(c.starts_at).toLocaleDateString()} — {new Date(c.ends_at).toLocaleDateString()}</p>
                </div>
                <div className="text-right">
                  <span className={`text-xs px-2 py-1 rounded ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{c.is_active ? 'Active' : 'Inactive'}</span>
                  <p className="text-xs text-gray-500 mt-2">{c.drivers_claimed}/{c.drivers_targeted} claimed</p>
                  <div className="w-32 bg-gray-200 rounded-full h-1.5 mt-1">
                    <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${c.drivers_targeted ? (c.drivers_claimed / c.drivers_targeted) * 100 : 0}%` }} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'coaching' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold text-gray-700 mb-3">Open Flags ({flags.length})</h3>
            <div className="space-y-2">
              {flags.map(f => (
                <div key={f.id} className="p-3 bg-white border border-gray-200 rounded">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className={`text-xs px-2 py-0.5 rounded mr-2 ${SEV_CLS[f.severity] ?? ''}`}>{f.severity}</span>
                      <span className="text-sm font-medium">{f.flag_type}</span>
                    </div>
                    <button onClick={() => resolveFlag(f.id)} className="text-xs text-blue-600 hover:underline">Resolve</button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Driver: {f.driver_id} | {new Date(f.created_at).toLocaleDateString()}</p>
                </div>
              ))}
              {flags.length === 0 && <p className="text-sm text-gray-500">No open flags</p>}
            </div>
          </div>
          <div>
            <h3 className="font-semibold text-gray-700 mb-3">Training Modules</h3>
            <div className="space-y-2">
              {modules.map(m => (
                <div key={m.id} className="p-3 bg-white border border-gray-200 rounded">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">{m.title}</p>
                    {m.is_mandatory && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Mandatory</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{m.category} | {m.duration_mins} min | Pass: {m.pass_score}%</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'inspection' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <select value={inspStatus} onChange={e => setInspStatus(e.target.value)} className="border rounded px-3 py-1.5 text-sm">
              <option value="">All Statuses</option>
              {['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'OVERDUE'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>{['Driver', 'Plate', 'Status', 'Due Date', 'Score', 'Actions'].map(h => <th key={h} className="text-left p-3 font-medium text-gray-600">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {inspections.map(ins => (
                  <tr key={ins.id} className="hover:bg-gray-50">
                    <td className="p-3 font-mono text-xs">{ins.driver_id}</td>
                    <td className="p-3 font-semibold">{ins.vehicle_plate}</td>
                    <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded ${INSP_CLS[ins.status] ?? 'bg-gray-100'}`}>{ins.status}</span></td>
                    <td className="p-3 text-gray-500 text-xs">{ins.due_date}</td>
                    <td className="p-3">{ins.overall_score ?? '-'}</td>
                    <td className="p-3 space-x-2">
                      {ins.status === 'SUBMITTED' && (
                        <>
                          <button onClick={() => reviewInspection(ins.id, 'APPROVED')} className="text-xs text-green-600 hover:underline">Approve</button>
                          <button onClick={() => reviewInspection(ins.id, 'REJECTED')} className="text-xs text-red-600 hover:underline">Reject</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'telematics' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>{['Driver', 'Date', 'Distance', 'Harsh Braking', 'Speeding', 'Safety Score'].map(h => <th key={h} className="text-left p-3 font-medium text-gray-600">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {summaries.map(s => (
                <tr key={`${s.driver_id}-${s.period_date}`} className={`hover:bg-gray-50 ${s.safety_score < 60 ? 'bg-red-50' : ''}`}>
                  <td className="p-3 font-mono text-xs">{s.driver_id}</td>
                  <td className="p-3 text-gray-500 text-xs">{s.period_date}</td>
                  <td className="p-3">{s.total_distance_km.toFixed(1)} km</td>
                  <td className="p-3">{s.harsh_braking_count}</td>
                  <td className="p-3">{s.speeding_count}</td>
                  <td className={`p-3 font-bold ${s.safety_score < 60 ? 'text-red-600' : s.safety_score < 80 ? 'text-yellow-600' : 'text-green-600'}`}>{s.safety_score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
