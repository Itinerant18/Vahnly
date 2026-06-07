import { useEffect, useState, useCallback } from 'react';

const API = '/api/v1/admin';

const authHeaders = (json = false): Record<string, string> => {
  const token = localStorage.getItem('admin_jwt_token') || '';
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (json) h['Content-Type'] = 'application/json';
  return h;
};

interface ServiceSnap {
  service_name: string;
  uptime_pct: number;
  error_rate_pct: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  requests_per_min: number;
  recorded_at: string;
}

interface Incident {
  id: string;
  service_name: string;
  title: string;
  severity: string;
  status: string;
  impact_description: string;
  started_at: string;
  resolved_at?: string;
  root_cause: string;
}

interface Experiment {
  id: string;
  name: string;
  description: string;
  hypothesis: string;
  metric: string;
  status: string;
  variants: unknown;
  target_cities: string[];
  start_date?: string;
  end_date?: string;
}

interface ExpResult {
  experiment_id: string;
  variant_name: string;
  sample_size: number;
  conversion_rate: number;
  avg_metric_value: number;
  p_value?: number;
  is_winner: boolean;
}

interface ChatbotIntent {
  id: string;
  intent_name: string;
  response_template: string;
  confidence_threshold: number;
  fallback_to_human: boolean;
  trigger_count: number;
  is_active: boolean;
}

interface ChatStats {
  total_sessions: number;
  deflected: number;
  escalated: number;
  active: number;
  deflection_rate_pct: number;
}

const STATUS_CLS: Record<string, string> = {
  ACTIVE: 'bg-yellow-100 text-yellow-700',
  RESOLVED: 'bg-green-100 text-green-700',
  INVESTIGATING: 'bg-red-100 text-red-700',
};

const EXP_CLS: Record<string, string> = {
  RUNNING: 'bg-blue-100 text-blue-700',
  PAUSED: 'bg-gray-100 text-gray-600',
  CONCLUDED: 'bg-green-100 text-green-700',
};

export function PlatformDashboard() {
  const [tab, setTab] = useState<'health' | 'experiments' | 'chatbot'>('health');

  const [services, setServices] = useState<ServiceSnap[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [results, setResults] = useState<ExpResult[]>([]);
  const [chatStats, setChatStats] = useState<ChatStats | null>(null);
  const [intents, setIntents] = useState<ChatbotIntent[]>([]);

  const emptyIncident = { service_name: '', title: '', severity: 'HIGH', impact_description: '' };
  const [showIncident, setShowIncident] = useState(false);
  const [newIncident, setNewIncident] = useState(emptyIncident);

  const emptyExperiment = { name: '', hypothesis: '', metric: '', target_cities: '' };
  const [showExperiment, setShowExperiment] = useState(false);
  const [newExperiment, setNewExperiment] = useState(emptyExperiment);

  const emptyIntent = { intent_name: '', response_template: '', confidence_threshold: 0.75, fallback_to_human: false };
  const [showIntent, setShowIntent] = useState(false);
  const [newIntent, setNewIntent] = useState(emptyIntent);

  const load = useCallback(async () => {
    const [health, exp, chat] = await Promise.all([
      fetch(`${API}/platform/health`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API}/platform/experiments`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API}/platform/chatbot`, { headers: authHeaders() }).then(r => r.json()),
    ]);
    setServices(health.services ?? []);
    setIncidents(health.incidents ?? []);
    setExperiments(exp.experiments ?? []);
    setResults(exp.results ?? []);
    setChatStats(chat.stats ?? null);
    setIntents(chat.intents ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const resolveIncident = async (id: string) => {
    await fetch(`${API}/platform/health/incidents/${id}`, {
      method: 'PATCH', headers: authHeaders(true),
      body: JSON.stringify({ status: 'RESOLVED', root_cause: 'Resolved by admin' }),
    });
    load();
  };

  const createIncident = async () => {
    if (!newIncident.service_name || !newIncident.title) return;
    await fetch(`${API}/platform/health/incidents`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ ...newIncident, status: 'INVESTIGATING', root_cause: '' }),
    });
    setShowIncident(false);
    setNewIncident(emptyIncident);
    load();
  };

  const createExperiment = async () => {
    if (!newExperiment.name || !newExperiment.metric) return;
    await fetch(`${API}/platform/experiments`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({
        name: newExperiment.name,
        description: '',
        hypothesis: newExperiment.hypothesis,
        metric: newExperiment.metric,
        status: 'DRAFT',
        variants: [{ name: 'control', split_pct: 50 }, { name: 'treatment', split_pct: 50 }],
        target_cities: newExperiment.target_cities.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
        start_date: '',
        end_date: '',
      }),
    });
    setShowExperiment(false);
    setNewExperiment(emptyExperiment);
    load();
  };

  const createIntent = async () => {
    if (!newIntent.intent_name || !newIntent.response_template) return;
    await fetch(`${API}/platform/chatbot/intents`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ ...newIntent, confidence_threshold: Number(newIntent.confidence_threshold), is_active: true }),
    });
    setShowIntent(false);
    setNewIntent(emptyIntent);
    load();
  };

  const toggleIntent = async (intent: ChatbotIntent) => {
    await fetch(`${API}/platform/chatbot/intents/${intent.id}`, {
      method: 'PATCH', headers: authHeaders(true),
      body: JSON.stringify({ response_template: intent.response_template, confidence_threshold: intent.confidence_threshold, fallback_to_human: intent.fallback_to_human, is_active: !intent.is_active }),
    });
    load();
  };

  const resultsByExp = (expId: string) => results.filter(r => r.experiment_id === expId);

  const TABS = [
    { key: 'health', label: 'Service Health' },
    { key: 'experiments', label: 'Experiments' },
    { key: 'chatbot', label: 'Chatbot' },
  ] as const;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Platform Engineering</h1>

      <div className="flex gap-2 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px ${tab === t.key ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'health' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {services.map(s => (
              <div key={s.service_name} className={`p-4 rounded-lg border ${s.error_rate_pct > 1 ? 'border-red-300 bg-red-50' : s.uptime_pct < 99.9 ? 'border-yellow-300 bg-yellow-50' : 'border-green-200 bg-green-50'}`}>
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-sm text-gray-900">{s.service_name}</p>
                  <span className={`w-2 h-2 rounded-full ${s.error_rate_pct > 1 ? 'bg-red-500' : 'bg-green-500'}`} />
                </div>
                <p className="text-lg font-bold text-gray-800">{s.uptime_pct.toFixed(2)}%</p>
                <p className="text-xs text-gray-500">uptime</p>
                <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-gray-600">
                  <span>p50: {s.p50_latency_ms}ms</span>
                  <span>p95: {s.p95_latency_ms}ms</span>
                  <span>Errors: {s.error_rate_pct.toFixed(2)}%</span>
                  <span>RPS: {s.requests_per_min}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button onClick={() => setShowIncident(v => !v)} className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
              {showIncident ? 'Cancel' : 'Report Incident'}
            </button>
          </div>

          {showIncident && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
              <p className="font-medium text-blue-800">Report Service Incident</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input value={newIncident.service_name} onChange={e => setNewIncident(p => ({ ...p, service_name: e.target.value }))} placeholder="Service name (e.g. payment-gateway)" className="border rounded px-3 py-1.5 text-sm" />
                <select value={newIncident.severity} onChange={e => setNewIncident(p => ({ ...p, severity: e.target.value }))} className="border rounded px-3 py-1.5 text-sm">
                  {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input value={newIncident.title} onChange={e => setNewIncident(p => ({ ...p, title: e.target.value }))} placeholder="Title" className="border rounded px-3 py-1.5 text-sm md:col-span-2" />
                <textarea value={newIncident.impact_description} onChange={e => setNewIncident(p => ({ ...p, impact_description: e.target.value }))} placeholder="Impact description" className="border rounded px-3 py-1.5 text-sm md:col-span-2" rows={2} />
              </div>
              <button onClick={createIncident} className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">Create</button>
            </div>
          )}

          {incidents.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-700 mb-3">Incidents</h3>
              <div className="space-y-2">
                {incidents.map(inc => (
                  <div key={inc.id} className="p-4 bg-white border border-gray-200 rounded-lg">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded ${STATUS_CLS[inc.status] ?? 'bg-gray-100'}`}>{inc.status}</span>
                          <span className="text-xs text-gray-500">{inc.severity}</span>
                          <span className="text-sm font-medium text-gray-900">{inc.title}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{inc.service_name} | {new Date(inc.started_at).toLocaleString()}</p>
                        {inc.root_cause && <p className="text-xs text-gray-600 mt-1">Root cause: {inc.root_cause}</p>}
                      </div>
                      {inc.status !== 'RESOLVED' && (
                        <button onClick={() => resolveIncident(inc.id)} className="text-xs text-blue-600 hover:underline whitespace-nowrap ml-4">Mark Resolved</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'experiments' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowExperiment(v => !v)} className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
              {showExperiment ? 'Cancel' : '+ New Experiment'}
            </button>
          </div>

          {showExperiment && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
              <p className="font-medium text-blue-800">New Experiment</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input value={newExperiment.name} onChange={e => setNewExperiment(p => ({ ...p, name: e.target.value }))} placeholder="Experiment name" className="border rounded px-3 py-1.5 text-sm" />
                <input value={newExperiment.metric} onChange={e => setNewExperiment(p => ({ ...p, metric: e.target.value }))} placeholder="Primary metric" className="border rounded px-3 py-1.5 text-sm" />
                <input value={newExperiment.hypothesis} onChange={e => setNewExperiment(p => ({ ...p, hypothesis: e.target.value }))} placeholder="Hypothesis" className="border rounded px-3 py-1.5 text-sm md:col-span-2" />
                <input value={newExperiment.target_cities} onChange={e => setNewExperiment(p => ({ ...p, target_cities: e.target.value }))} placeholder="Cities (blank = all)" className="border rounded px-3 py-1.5 text-sm md:col-span-2" />
              </div>
              <p className="text-xs text-gray-500">Created as DRAFT with control/treatment 50-50 split.</p>
              <button onClick={createExperiment} className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">Create</button>
            </div>
          )}

          {experiments.map(exp => {
            const expResults = resultsByExp(exp.id);
            return (
              <div key={exp.id} className="p-4 bg-white border border-gray-200 rounded-lg">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${EXP_CLS[exp.status] ?? 'bg-gray-100'}`}>{exp.status}</span>
                      <h3 className="font-semibold text-gray-900">{exp.name}</h3>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{exp.hypothesis}</p>
                    <p className="text-xs text-gray-400 mt-1">Metric: {exp.metric} | Cities: {exp.target_cities.join(', ') || 'All'}</p>
                  </div>
                </div>
                {expResults.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>{['Variant', 'Sample', 'Conversion', 'Avg Metric', 'p-value', ''].map(h => <th key={h} className="text-left p-2 font-medium text-gray-500">{h}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {expResults.map(res => (
                          <tr key={res.variant_name} className={res.is_winner ? 'bg-green-50' : ''}>
                            <td className="p-2 font-medium">{res.variant_name}</td>
                            <td className="p-2">{res.sample_size.toLocaleString()}</td>
                            <td className="p-2">{(res.conversion_rate * 100).toFixed(1)}%</td>
                            <td className="p-2">{res.avg_metric_value.toFixed(2)}</td>
                            <td className="p-2">{res.p_value != null ? res.p_value.toFixed(3) : '—'}</td>
                            <td className="p-2">{res.is_winner && <span className="text-green-600 font-semibold">Winner</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'chatbot' && chatStats && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {([
              ['Total Sessions', chatStats.total_sessions],
              ['Deflected', chatStats.deflected],
              ['Escalated', chatStats.escalated],
              ['Deflection Rate', `${chatStats.deflection_rate_pct.toFixed(1)}%`],
            ] as const).map(([label, val]) => (
              <div key={label} className="bg-blue-50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-blue-700">{val}</p>
                <p className="text-sm text-blue-500">{label}</p>
              </div>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-700">Intents</h3>
              <button onClick={() => setShowIntent(v => !v)} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
                {showIntent ? 'Cancel' : '+ New Intent'}
              </button>
            </div>

            {showIntent && (
              <div className="p-4 mb-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input value={newIntent.intent_name} onChange={e => setNewIntent(p => ({ ...p, intent_name: e.target.value }))} placeholder="Intent name (e.g. trip_cancellation)" className="border rounded px-3 py-1.5 text-sm" />
                  <label className="text-xs text-gray-500 flex items-center gap-2">
                    Confidence ≥
                    <input type="number" step="0.05" min="0" max="1" value={newIntent.confidence_threshold} onChange={e => setNewIntent(p => ({ ...p, confidence_threshold: Number(e.target.value) }))} className="border rounded px-3 py-1.5 text-sm w-24" />
                  </label>
                  <textarea value={newIntent.response_template} onChange={e => setNewIntent(p => ({ ...p, response_template: e.target.value }))} placeholder="Response template" className="border rounded px-3 py-1.5 text-sm md:col-span-2" rows={2} />
                  <label className="text-xs text-gray-600 flex items-center gap-2">
                    <input type="checkbox" checked={newIntent.fallback_to_human} onChange={e => setNewIntent(p => ({ ...p, fallback_to_human: e.target.checked }))} />
                    Fall back to human agent
                  </label>
                </div>
                <button onClick={createIntent} className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">Create</button>
              </div>
            )}

            <div className="space-y-2">
              {intents.map(intent => (
                <div key={intent.id} className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded">
                  <div>
                    <p className="font-medium text-sm text-gray-900">{intent.intent_name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Triggered {intent.trigger_count}× | Confidence ≥{(intent.confidence_threshold * 100).toFixed(0)}% | Fallback: {intent.fallback_to_human ? 'Yes' : 'No'}</p>
                  </div>
                  <button onClick={() => toggleIntent(intent)}
                    className={`text-xs px-3 py-1 rounded ${intent.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {intent.is_active ? 'Active' : 'Inactive'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
