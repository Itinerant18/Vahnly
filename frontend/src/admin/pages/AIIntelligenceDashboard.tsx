import { useEffect, useState, useCallback } from 'react';

const API = '/api/v1/admin';

const authHeaders = (json = false): Record<string, string> => {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  return h;
};

interface FraudEvent {
  id: string;
  entity_type: string;
  entity_id: string;
  fraud_type: string;
  score: number;
  evidence: Record<string, unknown>;
  status: string;
  reviewed_at?: string;
  created_at: string;
}

interface FraudRule {
  id: string;
  rule_name: string;
  fraud_type: string;
  description: string;
  threshold: number;
  weight: number;
  action: string;
  is_enabled: boolean;
  triggers_today: number;
}

interface Forecast {
  id: string;
  city: string;
  zone_name: string;
  forecast_hour: string;
  predicted_demand: number;
  current_supply: number;
  surge_predicted: number;
  confidence_pct: number;
  gap: number;
}

interface VoCTopic {
  id: string;
  topic: string;
  source: string;
  mention_count: number;
  positive_count: number;
  negative_count: number;
  sentiment_score: number;
  period_start: string;
  period_end: string;
  trending: boolean;
}

interface VoCSample {
  id: string;
  topic_id: string;
  entity_type: string;
  content: string;
  sentiment: string;
  created_at: string;
}

const SCORE_CLS = (s: number) =>
  s >= 80 ? 'text-content-negative font-bold' : s >= 50 ? 'text-content-warning font-semibold' : 'text-content-positive';

const SENT_CLS: Record<string, string> = {
  POSITIVE: 'bg-surface-positive text-content-positive',
  NEGATIVE: 'bg-surface-negative text-content-negative',
  NEUTRAL: 'bg-background-secondary text-content-primary',
};

export function AIIntelligenceDashboard() {
  const [tab, setTab] = useState<'fraud' | 'demand' | 'voc'>('fraud');

  // Fraud
  const [events, setEvents] = useState<FraudEvent[]>([]);
  const [rules, setRules] = useState<FraudRule[]>([]);
  const [fraudSummary, setFraudSummary] = useState({ open: 0, confirmed: 0, dismissed: 0 });
  const [fraudTab, setFraudTab] = useState<'events' | 'rules'>('events');

  // Demand
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [cityFilter, setCityFilter] = useState('');

  // VoC
  const [topics, setTopics] = useState<VoCTopic[]>([]);
  const [samples, setSamples] = useState<VoCSample[]>([]);

  const loadFraud = useCallback(async () => {
    const r = await fetch(`${API}/ai/fraud/events`, { headers: authHeaders() });
    const d = await r.json();
    setEvents(d.events ?? []);
    setFraudSummary(d.summary ?? {});
  }, []);

  const loadRules = useCallback(async () => {
    const r = await fetch(`${API}/ai/fraud/rules`, { headers: authHeaders() });
    const d = await r.json();
    setRules(d.rules ?? []);
  }, []);

  const loadForecasts = useCallback(async () => {
    const qs = cityFilter ? `?city=${encodeURIComponent(cityFilter)}` : '';
    const r = await fetch(`${API}/ai/demand-forecasts${qs}`, { headers: authHeaders() });
    const d = await r.json();
    setForecasts(d.forecasts ?? []);
  }, [cityFilter]);

  const loadVoC = useCallback(async () => {
    const r = await fetch(`${API}/ai/voc/topics`, { headers: authHeaders() });
    const d = await r.json();
    setTopics(d.topics ?? []);
    setSamples(d.samples ?? []);
  }, []);

  useEffect(() => { loadFraud(); loadRules(); }, [loadFraud, loadRules]);
  useEffect(() => { loadForecasts(); }, [loadForecasts]);
  useEffect(() => { loadVoC(); }, [loadVoC]);

  const updateFraud = async (id: string, status: string) => {
    await fetch(`${API}/ai/fraud/events/${id}`, { method: 'PATCH', headers: authHeaders(true), body: JSON.stringify({ status }) });
    loadFraud();
  };

  const toggleRule = async (rule: FraudRule) => {
    await fetch(`${API}/ai/fraud/rules/${rule.id}`, {
      method: 'PATCH', headers: authHeaders(true),
      body: JSON.stringify({ threshold: rule.threshold, weight: rule.weight, action: rule.action, is_enabled: !rule.is_enabled }),
    });
    loadRules();
  };

  const TABS = [
    { key: 'fraud', label: 'Fraud Detection' },
    { key: 'demand', label: 'Demand Heatmap' },
    { key: 'voc', label: 'Voice of Customer' },
  ] as const;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-content-primary">AI Intelligence</h1>

      <div className="flex gap-2 border-b border-border-opaque">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px ${tab === t.key ? 'border-b-2 border-border-accent text-content-accent' : 'text-content-secondary hover:text-content-primary'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'fraud' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {([['OPEN', fraudSummary.open, 'yellow'], ['CONFIRMED', fraudSummary.confirmed, 'red'], ['DISMISSED', fraudSummary.dismissed, 'gray']] as const).map(([label, count, color]) => (
              <div key={label} className={`bg-${color}-50 rounded-lg p-4`}>
                <p className={`text-2xl font-bold text-${color}-700`}>{count}</p>
                <p className={`text-sm text-${color}-600`}>{label}</p>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            {(['events', 'rules'] as const).map(t => (
              <button key={t} onClick={() => setFraudTab(t)}
                className={`px-3 py-1.5 text-sm rounded ${fraudTab === t ? 'bg-accent-400 text-white' : 'bg-background-secondary text-content-primary hover:bg-background-tertiary'}`}>
                {t === 'events' ? 'Events' : 'Rules'}
              </button>
            ))}
          </div>

          {fraudTab === 'events' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-background-secondary">
                  <tr>{['Entity', 'Type', 'Score', 'Status', 'Created', 'Actions'].map(h => <th key={h} className="text-left p-3 font-medium text-content-secondary">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border-opaque">
                  {events.map(e => (
                    <tr key={e.id} className="hover:bg-background-secondary">
                      <td className="p-3 font-mono text-xs">{e.entity_type}/{e.entity_id}</td>
                      <td className="p-3">{e.fraud_type}</td>
                      <td className={`p-3 ${SCORE_CLS(e.score)}`}>{e.score.toFixed(1)}</td>
                      <td className="p-3"><span className="px-2 py-0.5 rounded text-xs bg-background-secondary">{e.status}</span></td>
                      <td className="p-3 text-content-secondary text-xs">{new Date(e.created_at).toLocaleDateString()}</td>
                      <td className="p-3 space-x-2">
                        {e.status === 'OPEN' && (
                          <>
                            <button onClick={() => updateFraud(e.id, 'CONFIRMED')} className="text-xs text-content-negative hover:underline">Confirm</button>
                            <button onClick={() => updateFraud(e.id, 'DISMISSED')} className="text-xs text-content-secondary hover:underline">Dismiss</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {fraudTab === 'rules' && (
            <div className="space-y-2">
              {rules.map(rule => (
                <div key={rule.id} className="flex items-center justify-between p-4 bg-white border border-border-opaque rounded-lg">
                  <div>
                    <p className="font-medium text-content-primary">{rule.rule_name}</p>
                    <p className="text-sm text-content-secondary">{rule.description}</p>
                    <p className="text-xs text-content-tertiary mt-1">Action: {rule.action} | Threshold: {rule.threshold} | Triggers today: {rule.triggers_today}</p>
                  </div>
                  <button onClick={() => toggleRule(rule)}
                    className={`px-3 py-1 rounded text-sm ${rule.is_enabled ? 'bg-surface-positive text-content-positive' : 'bg-background-secondary text-content-secondary'}`}>
                    {rule.is_enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'demand' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input value={cityFilter} onChange={e => setCityFilter(e.target.value)} placeholder="Filter by city (e.g. KOL)" className="border rounded px-3 py-1.5 text-sm w-48" />
            <button onClick={loadForecasts} className="px-4 py-1.5 bg-accent-400 text-white text-sm rounded hover:bg-accent-400">Apply</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background-secondary">
                <tr>{['City', 'Zone', 'Hour', 'Demand', 'Supply', 'Gap', 'Surge', 'Confidence'].map(h => <th key={h} className="text-left p-3 font-medium text-content-secondary">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border-opaque">
                {forecasts.map(f => (
                  <tr key={f.id} className={`hover:bg-background-secondary ${f.gap > 10 ? 'bg-surface-negative' : ''}`}>
                    <td className="p-3 font-medium">{f.city}</td>
                    <td className="p-3">{f.zone_name}</td>
                    <td className="p-3 text-xs text-content-secondary">{new Date(f.forecast_hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="p-3">{f.predicted_demand}</td>
                    <td className="p-3">{f.current_supply}</td>
                    <td className={`p-3 font-semibold ${f.gap > 0 ? 'text-content-negative' : 'text-content-positive'}`}>{f.gap > 0 ? `+${f.gap}` : f.gap}</td>
                    <td className="p-3">{f.surge_predicted.toFixed(1)}x</td>
                    <td className="p-3">{f.confidence_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'voc' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold text-content-primary mb-3">Trending Topics</h3>
            <div className="space-y-3">
              {topics.map(t => (
                <div key={t.id} className="p-4 bg-white border border-border-opaque rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-content-primary">{t.topic}</span>
                    {t.trending && <span className="text-xs bg-surface-warning text-content-warning px-2 py-0.5 rounded">Trending</span>}
                  </div>
                  <p className="text-xs text-content-secondary mt-1">Source: {t.source} | {t.mention_count} mentions | Sentiment: {(t.sentiment_score * 100).toFixed(0)}%</p>
                  <div className="flex gap-2 mt-2 text-xs">
                    <span className="text-content-positive">+{t.positive_count} positive</span>
                    <span className="text-content-negative">-{t.negative_count} negative</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="font-semibold text-content-primary mb-3">Recent Samples</h3>
            <div className="space-y-2">
              {samples.map(s => (
                <div key={s.id} className="p-3 bg-white border border-border-opaque rounded">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-content-secondary">{s.entity_type}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${SENT_CLS[s.sentiment] ?? 'bg-background-secondary'}`}>{s.sentiment}</span>
                  </div>
                  <p className="text-sm text-content-primary">{s.content}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
