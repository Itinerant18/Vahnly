import React, { useState, useEffect, useCallback } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

// ── Types ────────────────────────────────────────────────────────────────────
interface AuditEntry {
  id: string; admin_id: string; admin_email: string; admin_role: string;
  action: string; module: string; entity_type: string; entity_id: string;
  details: string | null; before_value: unknown; after_value: unknown;
  ip_address: string; user_agent: string; created_at: string;
}
interface ActionMeta { action: string; module: string; count: number; }

// ── Helpers ───────────────────────────────────────────────────────────────────
const MODULE_COLORS: Record<string, string> = {
  auth: 'bg-surface-positive text-content-positive',
  compliance: 'bg-surface-accent text-content-accent',
  dispatch: 'bg-surface-accent text-content-accent',
  finance: 'bg-surface-warning text-content-warning',
  config: 'bg-surface-accent text-content-accent',
  support: 'bg-surface-accent text-content-accent',
  drivers: 'bg-surface-warning text-content-warning',
  safety: 'bg-surface-negative text-content-negative',
  marketing: 'bg-pink-100 text-pink-700',
};
const ACTION_COLORS: Record<string, string> = {
  LOGIN: 'bg-surface-positive text-content-positive', LOGOUT: 'bg-background-secondary text-content-secondary',
  KYC_APPROVE: 'bg-surface-accent text-content-accent', KYC_REJECT: 'bg-surface-negative text-content-negative',
  FORCE_MATCH: 'bg-surface-accent text-content-accent', DRIVER_SUSPEND: 'bg-surface-warning text-content-warning',
  PAYOUT_APPROVED: 'bg-surface-warning text-content-warning', FLAG_UPDATED: 'bg-surface-accent text-content-accent',
  TICKET_RESOLVED: 'bg-surface-accent text-content-accent',
};

function moduleBadge(module: string) {
  const cls = MODULE_COLORS[module] ?? 'bg-canvas-soft text-body';
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${cls}`}>{module || '—'}</span>;
}
function actionBadge(action: string) {
  const cls = ACTION_COLORS[action] ?? 'bg-canvas-soft text-body';
  return <span className={`text-[11px] font-mono font-medium px-2 py-0.5 rounded ${cls}`}>{action}</span>;
}
function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtJSON(val: unknown): string {
  if (val === null || val === undefined || val === 'null') return '—';
  try { return JSON.stringify(JSON.parse(String(val)), null, 2); } catch { return String(val); }
}

// ── Main Component ────────────────────────────────────────────────────────────
export const AuditLogsDashboard: React.FC = () => {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Filters
  const [searchEmail, setSearchEmail] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  // Metadata for dropdowns
  const [actionMeta, setActionMeta] = useState<ActionMeta[]>([]);
  const [modules, setModules] = useState<string[]>([]);

  // Expanded row + diff view
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showRetention, setShowRetention] = useState(false);
  const [retentionDays, setRetentionDays] = useState(365);
  const [cleanupMsg, setCleanupMsg] = useState('');

  const role = localStorage.getItem('admin_role') || 'ADMIN';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const headers = { 'X-Admin-Role': role };

  const base = `${API_GATEWAY_BASE_URL}/api/v1/admin/audit`;

  const fetchMeta = useCallback(async () => {
    const res = await fetch(`${base}/actions`, { headers });
    if (res.ok) {
      const d = await res.json();
      setActionMeta(d.actions || []);
      setModules(d.modules || []);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      from: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
      to: new Date().toISOString().slice(0, 10),
    });
    if (searchEmail) p.set('admin_email', searchEmail);
    if (moduleFilter) p.set('module', moduleFilter);
    if (actionFilter) p.set('action', actionFilter);
    if (entityTypeFilter) p.set('entity_type', entityTypeFilter);
    if (roleFilter) p.set('admin_role', roleFilter);

    const res = await fetch(`${base}/logs?${p}`, { headers });
    if (res.ok) { const d = await res.json(); setLogs(d.logs || []); setTotal(d.total || 0); }
    setLoading(false);
  }, [page, searchEmail, moduleFilter, actionFilter, entityTypeFilter, roleFilter]);

  const exportCSV = () => {
    const p = new URLSearchParams({ from: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });
    if (moduleFilter) p.set('module', moduleFilter);
    if (searchEmail) p.set('admin_email', searchEmail);
    window.open(`${base}/export?${p}`, '_blank');
  };

  const runCleanup = async () => {
    const res = await fetch(`${base}/cleanup?days=${retentionDays}`, { method: 'DELETE', headers });
    if (res.ok) { const d = await res.json(); setCleanupMsg(`Deleted ${d.deleted_count} entries older than ${retentionDays} days`); fetchLogs(); }
  };

  useEffect(() => { fetchMeta(); }, [fetchMeta]);
  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const distinctActions = [...new Set(actionMeta.map(a => a.action))].sort();

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Audit Logs</h1>
          <p className="text-sm text-mute">Tamper-evident record of every admin action — who, what, when, where</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="px-3 py-1.5 border border-canvas-soft rounded-lg text-sm text-body hover:bg-canvas-soft">↓ Export CSV</button>
          {isSuperAdmin && <button onClick={() => setShowRetention(!showRetention)} className="px-3 py-1.5 border border-negative-400 text-content-negative rounded-lg text-sm hover:bg-surface-negative">Retention</button>}
        </div>
      </div>

      {/* Retention panel */}
      {showRetention && (
        <div className="bg-surface-negative border border-negative-400 rounded-xl p-4 space-y-3">
          <div className="text-sm font-semibold text-content-negative">Retention Policy Cleanup</div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-body">Delete logs older than</span>
            <input type="number" value={retentionDays} onChange={e => setRetentionDays(Number(e.target.value))} min={90}
              className="w-24 border border-negative-400 rounded px-3 py-1.5 text-sm bg-white text-ink focus:outline-none" />
            <span className="text-sm text-body">days</span>
            <button onClick={runCleanup} className="px-4 py-1.5 bg-negative-400 text-white rounded-lg text-sm font-medium hover:bg-negative-400">Delete</button>
          </div>
          {cleanupMsg && <div className="text-sm text-content-negative">{cleanupMsg}</div>}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input type="text" placeholder="Filter by admin email…" value={searchEmail}
          onChange={e => { setSearchEmail(e.target.value); setPage(0); }}
          className="border border-canvas-soft rounded-lg px-3 py-1.5 text-sm bg-canvas text-ink w-52 focus:outline-none focus:ring-1 focus:ring-accent" />
        <select value={moduleFilter} onChange={e => { setModuleFilter(e.target.value); setPage(0); }}
          className="border border-canvas-soft rounded-lg px-3 py-1.5 text-sm bg-canvas text-ink focus:outline-none">
          <option value="">All modules</option>
          {modules.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={actionFilter} onChange={e => { setActionFilter(e.target.value); setPage(0); }}
          className="border border-canvas-soft rounded-lg px-3 py-1.5 text-sm bg-canvas text-ink focus:outline-none">
          <option value="">All actions</option>
          {distinctActions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input type="text" placeholder="Entity type (DRIVER, ORDER…)" value={entityTypeFilter}
          onChange={e => { setEntityTypeFilter(e.target.value); setPage(0); }}
          className="border border-canvas-soft rounded-lg px-3 py-1.5 text-sm bg-canvas text-ink w-44 focus:outline-none focus:ring-1 focus:ring-accent" />
        <input type="text" placeholder="Role" value={roleFilter}
          onChange={e => { setRoleFilter(e.target.value); setPage(0); }}
          className="border border-canvas-soft rounded-lg px-3 py-1.5 text-sm bg-canvas text-ink w-32 focus:outline-none focus:ring-1 focus:ring-accent" />
        <span className="ml-auto text-xs text-mute self-center">{total.toLocaleString()} entries</span>
      </div>

      {/* Table */}
      <div className="bg-canvas rounded-xl border border-canvas-soft overflow-hidden">
        <table className="w-full text-sm min-w-[800px]">
          <thead className="bg-canvas-soft/50">
            <tr className="text-xs text-mute">
              <th className="text-left px-4 py-2.5">When</th>
              <th className="text-left px-4 py-2.5">Admin</th>
              <th className="text-left px-4 py-2.5">Role</th>
              <th className="text-left px-4 py-2.5">Module</th>
              <th className="text-left px-4 py-2.5">Action</th>
              <th className="text-left px-4 py-2.5">Entity</th>
              <th className="text-left px-4 py-2.5">IP</th>
              <th className="text-left px-4 py-2.5 w-5"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="text-center py-10 text-mute text-sm animate-pulse">Loading…</td></tr>}
            {!loading && logs.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-mute text-sm">No audit logs found.</td></tr>}
            {logs.map(entry => (
              <React.Fragment key={entry.id}>
                <tr className={`border-t border-canvas-soft/50 hover:bg-canvas-soft/20 cursor-pointer ${expanded === entry.id ? 'bg-canvas-soft/30' : ''}`}
                  onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}>
                  <td className="px-4 py-2.5 text-xs text-mute whitespace-nowrap" title={new Date(entry.created_at).toLocaleString()}>{relTime(entry.created_at)}</td>
                  <td className="px-4 py-2.5 text-xs font-mono text-body">{entry.admin_email}</td>
                  <td className="px-4 py-2.5 text-xs text-mute">{entry.admin_role}</td>
                  <td className="px-4 py-2.5">{moduleBadge(entry.module)}</td>
                  <td className="px-4 py-2.5">{actionBadge(entry.action)}</td>
                  <td className="px-4 py-2.5 text-xs text-mute">
                    {entry.entity_type && <span>{entry.entity_type}</span>}
                    {entry.entity_id && <span className="ml-1 font-mono text-[10px]">{entry.entity_id.slice(0, 12)}{entry.entity_id.length > 12 ? '…' : ''}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-mute">{entry.ip_address}</td>
                  <td className="px-4 py-2.5 text-xs text-mute">{expanded === entry.id ? '▲' : '▼'}</td>
                </tr>
                {expanded === entry.id && (
                  <tr className="bg-canvas-soft/20">
                    <td colSpan={8} className="px-6 pb-4 pt-2">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Details */}
                        <div>
                          <div className="text-xs font-semibold text-mute uppercase tracking-wide mb-1">Details</div>
                          <div className="bg-canvas border border-canvas-soft rounded-lg p-3 text-xs text-body font-mono whitespace-pre-wrap break-all">
                            {entry.details || '—'}
                          </div>
                        </div>
                        {/* Before */}
                        <div>
                          <div className="text-xs font-semibold text-mute uppercase tracking-wide mb-1">Before</div>
                          <pre className="bg-canvas border border-canvas-soft rounded-lg p-3 text-xs font-mono text-body overflow-auto max-h-40 whitespace-pre-wrap break-all">
                            {fmtJSON(entry.before_value)}
                          </pre>
                        </div>
                        {/* After */}
                        <div>
                          <div className="text-xs font-semibold text-mute uppercase tracking-wide mb-1">After</div>
                          <pre className="bg-canvas border border-canvas-soft rounded-lg p-3 text-xs font-mono text-body overflow-auto max-h-40 whitespace-pre-wrap break-all">
                            {fmtJSON(entry.after_value)}
                          </pre>
                        </div>
                      </div>
                      {entry.user_agent && (
                        <div className="mt-2 text-[10px] text-mute font-mono truncate">UA: {entry.user_agent}</div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 rounded-lg border border-canvas-soft text-body disabled:opacity-40 hover:bg-canvas-soft">Previous</button>
          <span className="text-mute">Page {page + 1} / {totalPages}</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 rounded-lg border border-canvas-soft text-body disabled:opacity-40 hover:bg-canvas-soft">Next</button>
        </div>
      )}

      {/* Action frequency sidebar */}
      {actionMeta.length > 0 && (
        <div className="bg-canvas rounded-xl border border-canvas-soft p-4">
          <div className="text-sm font-semibold text-ink mb-3">Action Frequency (last 90 days)</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {actionMeta.slice(0, 12).map(a => (
              <button key={`${a.module}:${a.action}`} onClick={() => { setActionFilter(a.action); setModuleFilter(a.module); setPage(0); }}
                className="flex items-center justify-between text-xs border border-canvas-soft rounded-lg px-3 py-2 hover:bg-canvas-soft text-left">
                <div>
                  <div className="font-mono text-body">{a.action}</div>
                  {a.module && <div className="text-mute text-[10px]">{a.module}</div>}
                </div>
                <span className="font-mono text-ink font-medium">{a.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
