import { useEffect, useState, useCallback } from 'react';

const API = '/api/v1/admin';

const authHeaders = (json = false): Record<string, string> => {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  return h;
};

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
  CRITICAL: 'bg-surface-negative text-content-negative',
  HIGH: 'bg-surface-warning text-content-warning',
  MEDIUM: 'bg-surface-warning text-content-warning',
  LOW: 'bg-background-secondary text-content-secondary',
};

const INSP_CLS: Record<string, string> = {
  APPROVED: 'bg-surface-positive text-content-positive',
  REJECTED: 'bg-surface-negative text-content-negative',
  PENDING: 'bg-surface-warning text-content-warning',
  SUBMITTED: 'bg-surface-accent text-content-accent',
  OVERDUE: 'bg-surface-negative text-content-negative',
};

export function DriverOpsDashboard() {
  const [tab, setTab] = useState<'incentives' | 'coaching' | 'inspection' | 'telematics'>('incentives');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [flags, setFlags] = useState<CoachingFlag[]>([]);
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [summaries, setSummaries] = useState<TelSummary[]>([]);
  const [inspStatus, setInspStatus] = useState('');

  const emptyCampaign = { name: '', trigger_type: 'PEAK_HOUR', reward_type: 'FIXED', reward_value: 0, target_cities: '', starts_at: '', ends_at: '' };
  const [showCreate, setShowCreate] = useState(false);
  const [newCampaign, setNewCampaign] = useState(emptyCampaign);

  const load = useCallback(async () => {
    const [c, f, m, s] = await Promise.all([
      fetch(`${API}/driver-ops/incentives`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API}/driver-ops/coaching/flags?open=true`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API}/driver-ops/coaching/modules`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API}/driver-ops/telematics/summaries`, { headers: authHeaders() }).then(r => r.json()),
    ]);
    setCampaigns(c.campaigns ?? []);
    setFlags(f.flags ?? []);
    setModules(m.modules ?? []);
    setSummaries(s.summaries ?? []);
  }, []);

  const loadInspections = useCallback(async () => {
    const qs = inspStatus ? `?status=${inspStatus}` : '';
    const r = await fetch(`${API}/driver-ops/inspections${qs}`, { headers: authHeaders() });
    const d = await r.json();
    setInspections(d.inspections ?? []);
  }, [inspStatus]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadInspections(); }, [loadInspections]);

  const resolveFlag = async (id: string) => {
    await fetch(`${API}/driver-ops/coaching/flags/${id}/resolve`, { method: 'POST', headers: authHeaders() });
    load();
  };

  const createCampaign = async () => {
    if (!newCampaign.name || !newCampaign.starts_at || !newCampaign.ends_at) return;
    await fetch(`${API}/driver-ops/incentives`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({
        name: newCampaign.name,
        trigger_type: newCampaign.trigger_type,
        condition_config: {},
        reward_type: newCampaign.reward_type,
        reward_value: Number(newCampaign.reward_value),
        target_cities: newCampaign.target_cities.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
        starts_at: new Date(newCampaign.starts_at).toISOString(),
        ends_at: new Date(newCampaign.ends_at).toISOString(),
        is_active: true,
      }),
    });
    setShowCreate(false);
    setNewCampaign(emptyCampaign);
    load();
  };

  const reviewInspection = async (id: string, status: string) => {
    await fetch(`${API}/driver-ops/inspections/${id}/review`, {
      method: 'PATCH', headers: authHeaders(true),
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
      <h1 className="text-2xl font-bold text-content-primary">Driver Operations</h1>

      <div className="flex gap-2 border-b border-border-opaque">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px ${tab === t.key ? 'border-b-2 border-border-accent text-content-accent' : 'text-content-secondary hover:text-content-primary'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'incentives' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setShowCreate(v => !v)} className="px-4 py-1.5 bg-accent-400 text-white text-sm rounded hover:bg-accent-400">
              {showCreate ? 'Cancel' : '+ New Campaign'}
            </button>
          </div>

          {showCreate && (
            <div className="p-4 bg-surface-accent border border-border-accent rounded-lg space-y-3">
              <p className="font-medium text-content-accent">New Incentive Campaign</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <input value={newCampaign.name} onChange={e => setNewCampaign(p => ({ ...p, name: e.target.value }))} placeholder="Campaign name" className="border rounded px-3 py-1.5 text-sm col-span-2 md:col-span-3" />
                <select value={newCampaign.trigger_type} onChange={e => setNewCampaign(p => ({ ...p, trigger_type: e.target.value }))} className="border rounded px-3 py-1.5 text-sm">
                  {['PEAK_HOUR', 'LOW_SUPPLY', 'MANUAL'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <select value={newCampaign.reward_type} onChange={e => setNewCampaign(p => ({ ...p, reward_type: e.target.value }))} className="border rounded px-3 py-1.5 text-sm">
                  {['FIXED', 'PERCENT', 'BONUS_TRIPS'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input type="number" value={newCampaign.reward_value} onChange={e => setNewCampaign(p => ({ ...p, reward_value: Number(e.target.value) }))} placeholder="Reward value" className="border rounded px-3 py-1.5 text-sm" />
                <input value={newCampaign.target_cities} onChange={e => setNewCampaign(p => ({ ...p, target_cities: e.target.value }))} placeholder="Cities (KOL,BLR)" className="border rounded px-3 py-1.5 text-sm" />
                <label className="text-xs text-content-secondary flex flex-col">Starts<input type="date" value={newCampaign.starts_at} onChange={e => setNewCampaign(p => ({ ...p, starts_at: e.target.value }))} className="border rounded px-3 py-1.5 text-sm" /></label>
                <label className="text-xs text-content-secondary flex flex-col">Ends<input type="date" value={newCampaign.ends_at} onChange={e => setNewCampaign(p => ({ ...p, ends_at: e.target.value }))} className="border rounded px-3 py-1.5 text-sm" /></label>
              </div>
              <button onClick={createCampaign} className="px-4 py-1.5 bg-accent-400 text-white text-sm rounded hover:bg-accent-400">Create</button>
            </div>
          )}

          {campaigns.map(c => (
            <div key={c.id} className="p-4 bg-white border border-border-opaque rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-content-primary">{c.name}</p>
                  <p className="text-sm text-content-secondary mt-1">{c.trigger_type} → {c.reward_type} ₹{c.reward_value} | Cities: {c.target_cities.join(', ')}</p>
                  <p className="text-xs text-content-tertiary mt-1">{new Date(c.starts_at).toLocaleDateString()} — {new Date(c.ends_at).toLocaleDateString()}</p>
                </div>
                <div className="text-right">
                  <span className={`text-xs px-2 py-1 rounded ${c.is_active ? 'bg-surface-positive text-content-positive' : 'bg-background-secondary text-content-secondary'}`}>{c.is_active ? 'Active' : 'Inactive'}</span>
                  <p className="text-xs text-content-secondary mt-2">{c.drivers_claimed}/{c.drivers_targeted} claimed</p>
                  <div className="w-32 bg-background-tertiary rounded-full h-1.5 mt-1">
                    <div className="bg-surface-accent0 h-1.5 rounded-full" style={{ width: `${c.drivers_targeted ? (c.drivers_claimed / c.drivers_targeted) * 100 : 0}%` }} />
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
            <h3 className="font-semibold text-content-primary mb-3">Open Flags ({flags.length})</h3>
            <div className="space-y-2">
              {flags.map(f => (
                <div key={f.id} className="p-3 bg-white border border-border-opaque rounded">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className={`text-xs px-2 py-0.5 rounded mr-2 ${SEV_CLS[f.severity] ?? ''}`}>{f.severity}</span>
                      <span className="text-sm font-medium">{f.flag_type}</span>
                    </div>
                    <button onClick={() => resolveFlag(f.id)} className="text-xs text-content-accent hover:underline">Resolve</button>
                  </div>
                  <p className="text-xs text-content-secondary mt-1">Driver: {f.driver_id} | {new Date(f.created_at).toLocaleDateString()}</p>
                </div>
              ))}
              {flags.length === 0 && <p className="text-sm text-content-secondary">No open flags</p>}
            </div>
          </div>
          <div>
            <h3 className="font-semibold text-content-primary mb-3">Training Modules</h3>
            <div className="space-y-2">
              {modules.map(m => (
                <div key={m.id} className="p-3 bg-white border border-border-opaque rounded">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-content-primary">{m.title}</p>
                    {m.is_mandatory && <span className="text-xs bg-surface-negative text-content-negative px-1.5 py-0.5 rounded">Mandatory</span>}
                  </div>
                  <p className="text-xs text-content-secondary mt-1">{m.category} | {m.duration_mins} min | Pass: {m.pass_score}%</p>
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
              <thead className="bg-background-secondary">
                <tr>{['Driver', 'Plate', 'Status', 'Due Date', 'Score', 'Actions'].map(h => <th key={h} className="text-left p-3 font-medium text-content-secondary">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border-opaque">
                {inspections.map(ins => (
                  <tr key={ins.id} className="hover:bg-background-secondary">
                    <td className="p-3 font-mono text-xs">{ins.driver_id}</td>
                    <td className="p-3 font-semibold">{ins.vehicle_plate}</td>
                    <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded ${INSP_CLS[ins.status] ?? 'bg-background-secondary'}`}>{ins.status}</span></td>
                    <td className="p-3 text-content-secondary text-xs">{ins.due_date}</td>
                    <td className="p-3">{ins.overall_score ?? '-'}</td>
                    <td className="p-3 space-x-2">
                      {ins.status === 'SUBMITTED' && (
                        <>
                          <button onClick={() => reviewInspection(ins.id, 'APPROVED')} className="text-xs text-content-positive hover:underline">Approve</button>
                          <button onClick={() => reviewInspection(ins.id, 'REJECTED')} className="text-xs text-content-negative hover:underline">Reject</button>
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
            <thead className="bg-background-secondary">
              <tr>{['Driver', 'Date', 'Distance', 'Harsh Braking', 'Speeding', 'Safety Score'].map(h => <th key={h} className="text-left p-3 font-medium text-content-secondary">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border-opaque">
              {summaries.map(s => (
                <tr key={`${s.driver_id}-${s.period_date}`} className={`hover:bg-background-secondary ${s.safety_score < 60 ? 'bg-surface-negative' : ''}`}>
                  <td className="p-3 font-mono text-xs">{s.driver_id}</td>
                  <td className="p-3 text-content-secondary text-xs">{s.period_date}</td>
                  <td className="p-3">{s.total_distance_km.toFixed(1)} km</td>
                  <td className="p-3">{s.harsh_braking_count}</td>
                  <td className="p-3">{s.speeding_count}</td>
                  <td className={`p-3 font-bold ${s.safety_score < 60 ? 'text-content-negative' : s.safety_score < 80 ? 'text-content-warning' : 'text-content-positive'}`}>{s.safety_score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
