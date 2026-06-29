import React, { useState, useEffect, useCallback } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';

// ── Types ─────────────────────────────────────────────────────────────────────
interface APIKey {
  id: string; name: string; key_prefix: string; owner_type: string;
  owner_name: string; scopes: string[]; rate_limit_per_min: number;
  rate_limit_per_day: number; quota_monthly: number; is_sandbox: boolean;
  is_active: boolean; last_used_at: string | null; expires_at: string | null;
  created_at: string;
}
interface Webhook {
  id: string; name: string; endpoint_url: string; owner_type: string;
  subscribed_events: string[]; signing_secret: string; is_active: boolean;
  retry_count: number; timeout_ms: number; last_triggered_at: string | null;
  last_status_code: number | null; failure_count: number; created_at: string;
}
interface APILogEntry {
  id: string; key_prefix: string; method: string; path: string;
  status_code: number; response_time_ms: number; ip_address: string;
  is_sandbox: boolean; error_message: string | null; created_at: string;
  [key: string]: unknown;
}
interface LogStats { total: number; error_rate: number; avg_response_ms: number; p99_response_ms: number; }
interface StatusIncident {
  id: number; title: string; description: string; severity: string; status: string;
  affected_components: string[]; started_at: string; resolved_at: string | null;
}

type Tab = 'keys' | 'webhooks' | 'logs' | 'sandbox' | 'status';

const SCOPES_ALL = ['trips:read', 'trips:write', 'drivers:read', 'payments:read', 'payments:write', 'analytics:read', 'riders:read'];
const SEVERITY_COLORS: Record<string, string> = { MINOR: 'bg-surface-warning text-content-warning', MAJOR: 'bg-surface-warning text-content-warning', CRITICAL: 'bg-surface-negative text-content-negative' };
const INCIDENT_STATUS: Record<string, string> = { INVESTIGATING: 'bg-surface-negative text-content-negative', IDENTIFIED: 'bg-surface-warning text-content-warning', MONITORING: 'bg-surface-warning text-content-warning', RESOLVED: 'bg-surface-positive text-content-positive' };
const HTTP_COLORS = (code: number) => code < 300 ? 'text-content-positive' : code < 400 ? 'text-content-accent' : code < 500 ? 'text-content-warning' : 'text-content-negative';

function relTime(iso: string | null) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function SectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="bg-surface-negative border-l-4 border-l-negative-400 rounded-sm px-4 py-3 flex items-center gap-2 mb-4">
      <p className="text-sm text-content-negative">Couldn’t load this section.</p>
      <button type="button" onClick={onRetry} className="ml-auto rounded-sm border border-negative-400 px-3 py-1 text-xs text-content-negative hover:bg-background-secondary transition-colors">Retry</button>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export const DeveloperDashboard: React.FC = () => {
  const [tab, setTab] = useState<Tab>('keys');
  const role = localStorage.getItem('admin_role') || 'SUPER_ADMIN';
  const email = localStorage.getItem('admin_email') || '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const headers = { 'X-Admin-Role': role, 'X-Admin-Email': email, 'Content-Type': 'application/json' };
  const base = `${API_GATEWAY_BASE_URL}/api/v1/admin/dev`;

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'keys',     label: 'API Keys',     icon: '🔑' },
    { key: 'webhooks', label: 'Webhooks',      icon: '🪝' },
    { key: 'logs',     label: 'API Logs',      icon: '📋' },
    { key: 'sandbox',  label: 'Sandbox',       icon: '🧪' },
    { key: 'status',   label: 'Status Page',   icon: '📡' },
  ];

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-content-primary">Developer / API</h1>
        <p className="text-sm text-content-tertiary">API keys, webhooks, request logs, and status page management</p>
      </div>
      <div className="flex gap-1 border-b border-background-secondary">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 flex items-center gap-1.5 transition-colors ${
              tab === t.key ? 'border-accent text-accent' : 'border-transparent text-content-secondary hover:text-content-primary'
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      {tab === 'keys'     && <APIKeysTab     base={base} headers={headers} isSuperAdmin={isSuperAdmin} />}
      {tab === 'webhooks' && <WebhooksTab    base={base} headers={headers} isSuperAdmin={isSuperAdmin} />}
      {tab === 'logs'     && <APILogsTab     base={base} headers={headers} />}
      {tab === 'sandbox'  && <SandboxTab     base={base} headers={headers} isSuperAdmin={isSuperAdmin} />}
      {tab === 'status'   && <StatusPageTab  base={base} headers={headers} isSuperAdmin={isSuperAdmin} />}
    </div>
  );
};

// ── API Keys Tab ──────────────────────────────────────────────────────────────
const APIKeysTab: React.FC<{ base: string; headers: Record<string, string>; isSuperAdmin: boolean }> = ({ base, headers, isSuperAdmin }) => {
  const [keys, setKeys] = useState<APIKey[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<any>({ name: '', owner_type: 'CORPORATE', owner_name: '', scopes: ['trips:read'], rate_limit_per_min: 60, is_sandbox: false });
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const fetchKeys = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${base}/keys`, { headers });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json(); setKeys(d.keys || []);
    } catch { setLoadError(true); }
  }, []);

  const createKey = async () => {
    const res = await fetch(`${base}/keys`, { method: 'POST', headers, body: JSON.stringify(newKey) });
    if (res.ok) { const d = await res.json(); setCreatedKey(d.key); setShowCreate(false); fetchKeys(); }
  };

  const revokeKey = async (id: string) => {
    if (!confirm('Revoke this key?')) return;
    await fetch(`${base}/keys/${id}`, { method: 'DELETE', headers });
    fetchKeys();
  };

  const toggleKey = async (key: APIKey) => {
    await fetch(`${base}/keys/${key.id}`, { method: 'PATCH', headers, body: JSON.stringify({ is_active: !key.is_active }) });
    fetchKeys();
  };

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  return (
    <div className="space-y-4">
      {loadError && <SectionError onRetry={fetchKeys} />}
      <div className="flex items-center justify-between">
        <p className="text-sm text-content-tertiary">Plaintext keys are shown ONCE at creation and cannot be retrieved again.</p>
        {isSuperAdmin && <button onClick={() => setShowCreate(!showCreate)} className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">+ Generate Key</button>}
      </div>

      {createdKey && (
        <div className="bg-surface-positive border border-positive-400 rounded-xl p-4 space-y-2">
          <div className="text-sm font-semibold text-content-positive">✓ Key created — copy it now, it won't be shown again!</div>
          <div className="bg-white border border-positive-400 rounded-lg px-4 py-2.5 font-mono text-sm text-content-primary break-all">{createdKey}</div>
          <button onClick={() => { navigator.clipboard.writeText(createdKey); setCreatedKey(null); }}
            className="px-3 py-1.5 bg-positive-400 text-white rounded text-xs font-medium hover:bg-positive-400">Copy & Dismiss</button>
        </div>
      )}

      {showCreate && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
          <div className="text-sm font-semibold text-content-primary">New API Key</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><label className="text-xs text-content-tertiary">Name</label><input value={newKey.name} onChange={e => setNewKey({ ...newKey, name: e.target.value })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" /></div>
            <div><label className="text-xs text-content-tertiary">Owner Type</label>
              <select value={newKey.owner_type} onChange={e => setNewKey({ ...newKey, owner_type: e.target.value })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
                {['CORPORATE','PARTNER','INTERNAL'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className="text-xs text-content-tertiary">Owner Name</label><input value={newKey.owner_name} onChange={e => setNewKey({ ...newKey, owner_name: e.target.value })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" /></div>
            <div><label className="text-xs text-content-tertiary">Rate Limit / min</label><input type="number" value={newKey.rate_limit_per_min} onChange={e => setNewKey({ ...newKey, rate_limit_per_min: Number(e.target.value) })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none" /></div>
          </div>
          <div>
            <label className="text-xs text-content-tertiary">Scopes</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {SCOPES_ALL.map(s => (
                <button key={s} onClick={() => setNewKey({ ...newKey, scopes: newKey.scopes.includes(s) ? newKey.scopes.filter((x: string) => x !== s) : [...newKey.scopes, s] })}
                  className={`px-2.5 py-1 rounded text-xs border font-mono ${newKey.scopes.includes(s) ? 'bg-accent text-white border-accent' : 'bg-background-primary border-background-secondary text-content-secondary'}`}>{s}</button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newKey.is_sandbox} onChange={e => setNewKey({ ...newKey, is_sandbox: e.target.checked })} /> Sandbox key (cannot access production data)</label>
          <div className="flex gap-2">
            <button onClick={createKey} className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Generate</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {keys.filter(k => !k.is_sandbox).map(k => (
          <div key={k.id} className={`bg-background-primary rounded-xl border border-background-secondary p-4 flex items-center gap-4 ${!k.is_active ? 'opacity-60' : ''}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm text-content-primary">{k.name}</span>
                <span className="font-mono text-xs bg-background-secondary px-2 py-0.5 rounded text-content-tertiary">{k.key_prefix}…</span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${k.is_active ? 'bg-surface-positive text-content-positive' : 'bg-background-secondary text-content-secondary'}`}>{k.is_active ? 'ACTIVE' : 'REVOKED'}</span>
                <span className="text-xs text-content-tertiary">{k.owner_name}</span>
              </div>
              <div className="flex gap-3 mt-1 text-xs text-content-tertiary flex-wrap">
                <span>{k.rate_limit_per_min}/min</span>
                <span>{k.quota_monthly.toLocaleString()}/month</span>
                <span>Last used: {relTime(k.last_used_at)}</span>
              </div>
              <div className="flex gap-1 mt-1.5 flex-wrap">
                {k.scopes.map(s => <span key={s} className="text-[10px] border border-background-secondary rounded px-1.5 py-0.5 font-mono text-content-tertiary">{s}</span>)}
              </div>
            </div>
            {isSuperAdmin && (
              <div className="flex gap-2 shrink-0">
                <button onClick={() => toggleKey(k)} className="text-xs border border-background-secondary rounded px-2 py-1 text-content-secondary hover:bg-background-secondary">{k.is_active ? 'Disable' : 'Enable'}</button>
                <button onClick={() => revokeKey(k.id)} className="text-xs border border-negative-400 text-content-negative rounded px-2 py-1 hover:bg-surface-negative">Revoke</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Webhooks Tab ──────────────────────────────────────────────────────────────
const WebhooksTab: React.FC<{ base: string; headers: Record<string, string>; isSuperAdmin: boolean }> = ({ base, headers, isSuperAdmin }) => {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newWh, setNewWh] = useState<any>({ name: '', endpoint_url: '', owner_type: 'CORPORATE', subscribed_events: [] });
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const fetchWebhooks = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${base}/webhooks`, { headers });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json(); setWebhooks(d.webhooks || []); setAvailableEvents(d.available_events || []);
    } catch { setLoadError(true); }
  }, []);

  const createWebhook = async () => {
    const res = await fetch(`${base}/webhooks`, { method: 'POST', headers, body: JSON.stringify(newWh) });
    if (res.ok) { const d = await res.json(); setCreatedSecret(d.signing_secret); setShowCreate(false); fetchWebhooks(); }
  };

  const testWebhook = async (id: string) => {
    setTesting(id);
    await fetch(`${base}/webhooks/${id}/test`, { method: 'POST', headers });
    setTesting(null); fetchWebhooks();
  };

  const toggleWebhook = async (wh: Webhook) => {
    await fetch(`${base}/webhooks/${wh.id}`, { method: 'PATCH', headers, body: JSON.stringify({ is_active: !wh.is_active }) });
    fetchWebhooks();
  };

  useEffect(() => { fetchWebhooks(); }, [fetchWebhooks]);

  return (
    <div className="space-y-4">
      {loadError && <SectionError onRetry={fetchWebhooks} />}
      <div className="flex items-center justify-between">
        <p className="text-sm text-content-tertiary">Subscribe to platform events via HTTP POST webhooks. Signed with HMAC-SHA256.</p>
        {isSuperAdmin && <button onClick={() => setShowCreate(!showCreate)} className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">+ Add Webhook</button>}
      </div>

      {createdSecret && (
        <div className="bg-surface-positive border border-positive-400 rounded-xl p-4 space-y-2">
          <div className="text-sm font-semibold text-content-positive">✓ Webhook created — save the signing secret!</div>
          <div className="bg-white border border-positive-400 rounded-lg px-4 py-2.5 font-mono text-sm text-content-primary break-all">{createdSecret}</div>
          <button onClick={() => { navigator.clipboard.writeText(createdSecret); setCreatedSecret(null); }}
            className="px-3 py-1.5 bg-positive-400 text-white rounded text-xs font-medium hover:bg-positive-400">Copy & Dismiss</button>
        </div>
      )}

      {showCreate && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
          <div className="text-sm font-semibold text-content-primary">New Webhook</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className="text-xs text-content-tertiary">Name</label><input value={newWh.name} onChange={e => setNewWh({ ...newWh, name: e.target.value })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" /></div>
            <div><label className="text-xs text-content-tertiary">Endpoint URL</label><input value={newWh.endpoint_url} onChange={e => setNewWh({ ...newWh, endpoint_url: e.target.value })} placeholder="https://your-server.com/hooks" className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm font-mono bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" /></div>
          </div>
          <div>
            <label className="text-xs text-content-tertiary">Subscribe to events</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {availableEvents.map(ev => (
                <button key={ev} onClick={() => setNewWh({ ...newWh, subscribed_events: newWh.subscribed_events.includes(ev) ? newWh.subscribed_events.filter((x: string) => x !== ev) : [...newWh.subscribed_events, ev] })}
                  className={`px-2.5 py-1 rounded text-xs border font-mono ${newWh.subscribed_events.includes(ev) ? 'bg-accent text-white border-accent' : 'bg-background-primary border-background-secondary text-content-secondary'}`}>{ev}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={createWebhook} className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Create</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {webhooks.map(wh => (
          <div key={wh.id} className={`bg-background-primary rounded-xl border border-background-secondary p-4 ${!wh.is_active ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm text-content-primary">{wh.name}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${wh.is_active ? 'bg-surface-positive text-content-positive' : 'bg-background-secondary text-content-secondary'}`}>{wh.is_active ? 'ACTIVE' : 'PAUSED'}</span>
                  {wh.failure_count > 0 && <span className="text-[10px] bg-surface-negative text-content-negative px-1.5 py-0.5 rounded">{wh.failure_count} failures</span>}
                </div>
                <div className="text-xs font-mono text-content-tertiary mt-0.5 truncate max-w-md">{wh.endpoint_url}</div>
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {wh.subscribed_events.map(ev => <span key={ev} className="text-[10px] border border-background-secondary rounded px-1.5 py-0.5 font-mono text-content-tertiary">{ev}</span>)}
                </div>
                <div className="text-xs text-content-tertiary mt-1">Secret: <span className="font-mono">{wh.signing_secret}</span> · Last fired: {relTime(wh.last_triggered_at)}{wh.last_status_code ? ` (${wh.last_status_code})` : ''}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => testWebhook(wh.id)} disabled={testing === wh.id} className="text-xs border border-background-secondary rounded px-2 py-1 text-content-secondary hover:bg-background-secondary disabled:opacity-50">
                  {testing === wh.id ? '…' : 'Test'}
                </button>
                {isSuperAdmin && <button onClick={() => toggleWebhook(wh)} className="text-xs border border-background-secondary rounded px-2 py-1 text-content-secondary hover:bg-background-secondary">{wh.is_active ? 'Pause' : 'Resume'}</button>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── API Logs Tab ──────────────────────────────────────────────────────────────
const LOG_COLUMNS: ColumnDef<APILogEntry>[] = [
  {
    key: 'created_at', header: 'Time', type: 'date',
    render: (v) => <span className="text-xs text-content-tertiary">{relTime(v as string | null)}</span>,
  },
  {
    key: 'key_prefix', header: 'Key',
    render: (v, r) => (
      <span className="font-mono text-mono-small text-content-secondary">
        {String(v)}{r.is_sandbox && <span className="ml-1 text-[10px] bg-surface-warning text-content-warning px-1 rounded">sandbox</span>}
      </span>
    ),
  },
  {
    key: 'method', header: 'Method',
    render: (v) => <span className="font-mono text-mono-small font-medium text-content-secondary">{String(v)}</span>,
  },
  {
    key: 'path', header: 'Path',
    render: (v) => <span className="font-mono text-mono-small text-content-tertiary truncate max-w-xs block">{String(v)}</span>,
  },
  {
    key: 'status_code', header: 'Status', type: 'numeric',
    render: (v) => <span className={`font-mono text-mono-small font-medium ${HTTP_COLORS(Number(v))}`}>{String(v)}</span>,
  },
  { key: 'response_time_ms', header: 'RT (ms)', type: 'numeric' },
  {
    key: 'ip_address', header: 'IP',
    render: (v) => <span className="font-mono text-mono-small text-content-tertiary">{String(v)}</span>,
  },
];

const APILogsTab: React.FC<{ base: string; headers: Record<string, string> }> = ({ base, headers }) => {
  const [logs, setLogs] = useState<APILogEntry[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [keyFilter, setKeyFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const PAGE_SIZE = 50;

  const fetchLogs = useCallback(async () => {
    setLoadError(false);
    const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    if (keyFilter) p.set('key_prefix', keyFilter);
    if (statusFilter) p.set('status_code', statusFilter);
    try {
      const res = await fetch(`${base}/logs?${p}`, { headers });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json(); setLogs(d.logs || []); setTotal(d.total || 0); setStats(d.stats);
    } catch { setLoadError(true); }
  }, [page, keyFilter, statusFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  return (
    <div className="space-y-4">
      {loadError && <SectionError onRetry={fetchLogs} />}
      <div className="flex gap-2 flex-wrap">
        <input placeholder="Filter by key prefix…" value={keyFilter} onChange={e => { setKeyFilter(e.target.value); setPage(0); }}
          className="border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary w-44 focus:outline-none focus:ring-1 focus:ring-accent" />
        <input placeholder="Status code (e.g. 429)…" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
          className="border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary w-44 focus:outline-none focus:ring-1 focus:ring-accent" />
        <span className="ml-auto text-xs text-content-tertiary self-center">{total.toLocaleString()} requests</span>
      </div>

      {stats && (
        <div className="grid grid-cols-4 gap-3">
          {[['Total', total.toLocaleString()], ['Error Rate', `${stats.error_rate?.toFixed(1) ?? 0}%`], ['Avg RT', `${stats.avg_response_ms?.toFixed(0) ?? 0}ms`], ['p99 RT', `${stats.p99_response_ms?.toFixed(0) ?? 0}ms`]].map(([l, v]) => (
            <div key={l} className="bg-background-primary border border-background-secondary rounded-xl p-3 text-center">
              <div className="text-xs text-content-tertiary">{l}</div>
              <div className="text-lg font-bold text-content-primary mt-0.5">{v}</div>
            </div>
          ))}
        </div>
      )}

      <DataTable<APILogEntry>
        columns={LOG_COLUMNS}
        data={logs}
        rowKey={(r) => String(r.id)}
      />
      {Math.ceil(total / PAGE_SIZE) > 1 && (
        <div className="flex justify-between text-sm">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 border border-background-secondary rounded-lg text-content-secondary disabled:opacity-40 hover:bg-background-secondary">Prev</button>
          <span className="text-content-tertiary">Page {page + 1}</span>
          <button disabled={page >= Math.ceil(total / PAGE_SIZE) - 1} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 border border-background-secondary rounded-lg text-content-secondary disabled:opacity-40 hover:bg-background-secondary">Next</button>
        </div>
      )}
    </div>
  );
};

// ── Sandbox Tab ───────────────────────────────────────────────────────────────
const SandboxTab: React.FC<{ base: string; headers: Record<string, string>; isSuperAdmin: boolean }> = ({ base, headers }) => {
  const [sandboxKeys, setSandboxKeys] = useState<APIKey[]>([]);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${base}/keys?sandbox=true`, { headers });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json(); setSandboxKeys(d.keys || []);
    } catch { setLoadError(true); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      {loadError && <SectionError onRetry={load} />}
      <div className="bg-surface-warning border border-warning-400 rounded-xl p-5">
        <div className="text-sm font-semibold text-content-warning mb-1">🧪 Sandbox Environment</div>
        <p className="text-sm text-content-warning">Sandbox keys operate against a separate copy of the platform with seeded test data. Trips, payments, and driver state changes made in sandbox do not affect production data.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[['Base URL', `${API_GATEWAY_BASE_URL}/api/v1`], ['Auth', 'X-API-Key: {your-sandbox-key}'], ['Trip Webhook', 'Fires to your endpoint but does not charge real users'], ['Rate Limits', '1000 req/min in sandbox (vs prod limits)']].map(([k, v]) => (
          <div key={k} className="bg-background-primary border border-background-secondary rounded-xl p-4">
            <div className="text-xs text-content-tertiary uppercase tracking-wide">{k}</div>
            <div className="text-sm font-mono text-content-primary mt-1">{v}</div>
          </div>
        ))}
      </div>
      <div>
        <div className="text-sm font-semibold text-content-primary mb-2">Sandbox API Keys</div>
        {sandboxKeys.length === 0 && <div className="text-sm text-content-tertiary">No sandbox keys yet. Create one from the API Keys tab.</div>}
        {sandboxKeys.map(k => (
          <div key={k.id} className="bg-background-primary border border-background-secondary rounded-xl p-4 flex items-center gap-3">
            <span className="text-2xl">🧪</span>
            <div>
              <div className="text-sm font-medium text-content-primary">{k.name}</div>
              <div className="font-mono text-xs text-content-tertiary">{k.key_prefix}…</div>
            </div>
            <div className="ml-auto text-xs text-content-tertiary">Created {relTime(k.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Status Page Tab ───────────────────────────────────────────────────────────
const StatusPageTab: React.FC<{ base: string; headers: Record<string, string>; isSuperAdmin: boolean }> = ({ base, headers, isSuperAdmin }) => {
  const [incidents, setIncidents] = useState<StatusIncident[]>([]);
  const [editing, setEditing] = useState<Partial<StatusIncident> | null>(null);
  const [loadError, setLoadError] = useState(false);

  const fetchIncidents = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${base}/incidents`, { headers });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      setIncidents(d.incidents || []);
    } catch {
      setLoadError(true);
    }
  }, []);

  const save = async () => {
    if (!editing) return;
    const method = editing.id ? 'PATCH' : 'POST';
    const url = editing.id ? `${base}/incidents/${editing.id}` : `${base}/incidents`;
    await fetch(url, { method, headers, body: JSON.stringify(editing) });
    setEditing(null); fetchIncidents();
  };

  useEffect(() => { fetchIncidents(); }, [fetchIncidents]);

  const openIncidents = incidents.filter(i => i.status !== 'RESOLVED');
  const systemOK = openIncidents.length === 0;

  const COMPONENTS = ['api-gateway', 'matching-api', 'dispatch-service', 'payment-gateway', 'admin-portal', 'rider-app', 'driver-app'];

  return (
    <div className="space-y-5">
      {loadError && <SectionError onRetry={fetchIncidents} />}
      <div className={`rounded-xl p-4 flex items-center gap-3 ${systemOK ? 'bg-surface-positive border border-positive-400' : 'bg-surface-negative border border-negative-400'}`}>
        <span className="text-2xl">{systemOK ? '✅' : '⚠️'}</span>
        <div>
          <div className={`font-semibold text-sm ${systemOK ? 'text-content-positive' : 'text-content-negative'}`}>
            {systemOK ? 'All Systems Operational' : `${openIncidents.length} Active Incident${openIncidents.length > 1 ? 's' : ''}`}
          </div>
          <div className="text-xs text-content-tertiary">Updated {new Date().toLocaleTimeString('en-IN')}</div>
        </div>
        {isSuperAdmin && <button onClick={() => setEditing({ severity: 'MINOR', status: 'INVESTIGATING', affected_components: [] })} className="ml-auto px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">+ Incident</button>}
      </div>

      {editing && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
          <div className="text-sm font-semibold text-content-primary">{editing.id ? 'Update' : 'New'} Incident</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2"><label className="text-xs text-content-tertiary">Title</label><input value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" /></div>
            <div><label className="text-xs text-content-tertiary">Severity</label>
              <select value={editing.severity || 'MINOR'} onChange={e => setEditing({ ...editing, severity: e.target.value })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
                {['MINOR','MAJOR','CRITICAL'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div><label className="text-xs text-content-tertiary">Status</label>
              <select value={editing.status || 'INVESTIGATING'} onChange={e => setEditing({ ...editing, status: e.target.value })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
                {['INVESTIGATING','IDENTIFIED','MONITORING','RESOLVED'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="md:col-span-2"><label className="text-xs text-content-tertiary">Description</label><textarea value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} rows={2} className="mt-1 w-full border border-background-secondary rounded px-3 py-2 text-sm bg-background-primary text-content-primary resize-none focus:outline-none" /></div>
          </div>
          <div>
            <label className="text-xs text-content-tertiary">Affected Components</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {COMPONENTS.map(c => (
                <button key={c} onClick={() => {
                  const cur = editing.affected_components || [];
                  setEditing({ ...editing, affected_components: cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c] });
                }} className={`px-2.5 py-1 rounded text-xs border font-mono ${(editing.affected_components || []).includes(c) ? 'bg-accent text-white border-accent' : 'bg-background-primary border-background-secondary text-content-secondary'}`}>{c}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={save} className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Save</button>
            <button onClick={() => setEditing(null)} className="px-4 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {incidents.map(inc => (
          <div key={inc.id} className="bg-background-primary rounded-xl border border-background-secondary p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${SEVERITY_COLORS[inc.severity] ?? 'bg-background-secondary text-content-secondary'}`}>{inc.severity}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${INCIDENT_STATUS[inc.status] ?? 'bg-background-secondary text-content-secondary'}`}>{inc.status}</span>
                  <span className="text-sm font-medium text-content-primary">{inc.title}</span>
                </div>
                <p className="text-xs text-content-tertiary mt-1">{inc.description}</p>
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {inc.affected_components.map(c => <span key={c} className="text-[10px] border border-background-secondary rounded px-1.5 py-0.5 font-mono text-content-tertiary">{c}</span>)}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-content-tertiary">{relTime(inc.started_at)}</div>
                {inc.resolved_at && <div className="text-xs text-content-positive">Resolved {relTime(inc.resolved_at)}</div>}
                {isSuperAdmin && <button onClick={() => setEditing(inc)} className="text-xs text-accent hover:underline mt-1">Update</button>}
              </div>
            </div>
          </div>
        ))}
        {incidents.length === 0 && <div className="text-center py-8 text-sm text-content-tertiary">No incidents recorded.</div>}
      </div>
    </div>
  );
};
