import React, { useState, useEffect, useCallback } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';

// ── Types ────────────────────────────────────────────────────────────────────
interface AuditEntry {
  id: string; admin_id: string; admin_email: string; admin_role: string;
  action: string; module: string; entity_type: string; entity_id: string;
  details: string | null; before_value: unknown; after_value: unknown;
  ip_address: string; user_agent: string; created_at: string;
  [key: string]: unknown; // satisfies DataTable's row constraint
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
  const cls = MODULE_COLORS[module] ?? 'bg-background-secondary text-content-secondary';
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${cls}`}>{module || '—'}</span>;
}
function actionBadge(action: string) {
  const cls = ACTION_COLORS[action] ?? 'bg-background-secondary text-content-secondary';
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

// Parse an audit value (may be a JSON string, an object, or null) into a flat
// record for key-level diffing; returns null when it isn't an object.
function parseObj(val: unknown): Record<string, unknown> | null {
  if (val === null || val === undefined || val === 'null') return null;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch { return null; }
}

type DiffKind = 'added' | 'removed' | 'changed' | 'same';
interface DiffRow { key: string; kind: DiffKind; before: unknown; after: unknown; }

function diffObjects(before: Record<string, unknown>, after: Record<string, unknown>): DiffRow[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.map((key) => {
    const inB = key in before, inA = key in after;
    const bv = before[key], av = after[key];
    let kind: DiffKind = 'same';
    if (inB && !inA) kind = 'removed';
    else if (!inB && inA) kind = 'added';
    else if (JSON.stringify(bv) !== JSON.stringify(av)) kind = 'changed';
    return { key, kind, before: bv, after: av };
  });
}

function cell(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

const DIFF_ROW_CLS: Record<DiffKind, string> = {
  added: 'bg-surface-positive',
  removed: 'bg-surface-negative',
  changed: 'bg-surface-warning',
  same: '',
};

// ── Column definitions (DataTable hero component) ───────────────────────────────
const AUDIT_COLUMNS: ColumnDef<AuditEntry>[] = [
  {
    key: 'created_at', header: 'When',
    render: (v) => (
      <span className="text-xs text-content-tertiary whitespace-nowrap" title={new Date(String(v)).toLocaleString()}>{relTime(String(v))}</span>
    ),
  },
  {
    key: 'admin_email', header: 'Admin',
    render: (v) => <span className="font-mono text-mono-small text-content-secondary">{String(v)}</span>,
  },
  {
    key: 'admin_role', header: 'Role',
    render: (v) => <span className="text-xs text-content-tertiary">{String(v)}</span>,
  },
  {
    key: 'module', header: 'Module',
    render: (v) => moduleBadge(String(v)),
  },
  {
    key: 'action', header: 'Action',
    render: (v) => actionBadge(String(v)),
  },
  {
    key: 'entity_type', header: 'Entity',
    render: (_v, r) => (
      <span className="text-xs text-content-tertiary">
        {r.entity_type && <span>{r.entity_type}</span>}
        {r.entity_id && <span className="ml-1 font-mono text-[10px]">{r.entity_id.slice(0, 12)}{r.entity_id.length > 12 ? '…' : ''}</span>}
      </span>
    ),
  },
  {
    key: 'ip_address', header: 'IP',
    render: (v) => <span className="font-mono text-mono-small text-content-tertiary">{String(v)}</span>,
  },
  {
    key: '_expand', header: '', width: 20,
    render: () => <span className="text-xs text-content-tertiary">▼</span>,
  },
];

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
          <h1 className="text-xl font-bold text-content-primary">Audit Logs</h1>
          <p className="text-sm text-content-tertiary">Tamper-evident record of every admin action — who, what, when, where</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="px-3 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">↓ Export CSV</button>
          {isSuperAdmin && <button onClick={() => setShowRetention(!showRetention)} className="px-3 py-1.5 border border-negative-400 text-content-negative rounded-lg text-sm hover:bg-surface-negative">Retention</button>}
        </div>
      </div>

      {/* Retention panel */}
      {showRetention && (
        <div className="bg-surface-negative border border-negative-400 rounded-xl p-4 space-y-3">
          <div className="text-sm font-semibold text-content-negative">Retention Policy Cleanup</div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-content-secondary">Delete logs older than</span>
            <input type="number" value={retentionDays} onChange={e => setRetentionDays(Number(e.target.value))} min={90}
              className="w-24 border border-negative-400 rounded px-3 py-1.5 text-sm bg-white text-content-primary focus:outline-none" />
            <span className="text-sm text-content-secondary">days</span>
            <button onClick={runCleanup} className="px-4 py-1.5 bg-negative-400 text-white rounded-lg text-sm font-medium hover:bg-negative-400">Delete</button>
          </div>
          {cleanupMsg && <div className="text-sm text-content-negative">{cleanupMsg}</div>}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input type="text" placeholder="Filter by admin email…" value={searchEmail}
          onChange={e => { setSearchEmail(e.target.value); setPage(0); }}
          className="border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary w-52 focus:outline-none focus:ring-1 focus:ring-accent" />
        <select value={moduleFilter} onChange={e => { setModuleFilter(e.target.value); setPage(0); }}
          className="border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
          <option value="">All modules</option>
          {modules.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={actionFilter} onChange={e => { setActionFilter(e.target.value); setPage(0); }}
          className="border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
          <option value="">All actions</option>
          {distinctActions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input type="text" placeholder="Entity type (DRIVER, ORDER…)" value={entityTypeFilter}
          onChange={e => { setEntityTypeFilter(e.target.value); setPage(0); }}
          className="border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary w-44 focus:outline-none focus:ring-1 focus:ring-accent" />
        <input type="text" placeholder="Role" value={roleFilter}
          onChange={e => { setRoleFilter(e.target.value); setPage(0); }}
          className="border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary w-32 focus:outline-none focus:ring-1 focus:ring-accent" />
        <span className="ml-auto text-xs text-content-tertiary self-center">{total.toLocaleString()} entries</span>
      </div>

      {/* Table */}
      <DataTable<AuditEntry>
        columns={AUDIT_COLUMNS}
        data={logs}
        loading={loading}
        rowKey={(r) => r.id}
        onRowClick={(r) => setExpanded(expanded === r.id ? null : r.id)}
        emptyState={<span className="text-content-tertiary text-sm">No audit logs found.</span>}
      />

      {/* Expanded row detail (Details / Before / After) */}
      {expanded && (() => {
        const entry = logs.find(e => e.id === expanded);
        if (!entry) return null;
        const beforeObj = parseObj(entry.before_value);
        const afterObj = parseObj(entry.after_value);
        const diff = beforeObj && afterObj ? diffObjects(beforeObj, afterObj) : null;
        return (
          <div className="bg-background-secondary/20 border border-background-secondary rounded-xl px-6 pb-4 pt-3">
            {/* Details */}
            <div className="mb-4">
              <div className="text-xs font-semibold text-content-tertiary uppercase tracking-wide mb-1">Details</div>
              <div className="bg-background-primary border border-background-secondary rounded-lg p-3 text-xs text-content-secondary font-mono whitespace-pre-wrap break-all">
                {entry.details || '—'}
              </div>
            </div>

            {diff ? (
              /* Key-level diff: added (green), removed (red), changed (amber) keys highlighted. */
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className="text-xs font-semibold text-content-tertiary uppercase tracking-wide">Changes</div>
                  <div className="flex gap-2 text-[10px]">
                    <span className="px-1.5 py-0.5 rounded bg-surface-warning text-content-warning">changed</span>
                    <span className="px-1.5 py-0.5 rounded bg-surface-positive text-content-positive">added</span>
                    <span className="px-1.5 py-0.5 rounded bg-surface-negative text-content-negative">removed</span>
                  </div>
                </div>
                <div className="bg-background-primary border border-background-secondary rounded-lg overflow-auto max-h-56">
                  <table className="w-full text-xs font-mono">
                    <thead className="bg-background-secondary/50 text-content-tertiary">
                      <tr>
                        <th className="text-left px-3 py-1.5 font-medium">Key</th>
                        <th className="text-left px-3 py-1.5 font-medium">Before</th>
                        <th className="text-left px-3 py-1.5 font-medium">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.map((r) => (
                        <tr key={r.key} className={`border-t border-background-secondary/50 ${DIFF_ROW_CLS[r.kind]}`}>
                          <td className="px-3 py-1.5 text-content-secondary align-top">{r.key}</td>
                          <td className="px-3 py-1.5 align-top break-all">{r.kind === 'added' ? '—' : <span className={r.kind === 'changed' || r.kind === 'removed' ? 'text-content-negative' : 'text-content-tertiary'}>{cell(r.before)}</span>}</td>
                          <td className="px-3 py-1.5 align-top break-all">{r.kind === 'removed' ? '—' : <span className={r.kind === 'changed' || r.kind === 'added' ? 'text-content-positive' : 'text-content-tertiary'}>{cell(r.after)}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* Non-object values: fall back to side-by-side raw JSON. */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-semibold text-content-tertiary uppercase tracking-wide mb-1">Before</div>
                  <pre className="bg-background-primary border border-background-secondary rounded-lg p-3 text-xs font-mono text-content-secondary overflow-auto max-h-40 whitespace-pre-wrap break-all">
                    {fmtJSON(entry.before_value)}
                  </pre>
                </div>
                <div>
                  <div className="text-xs font-semibold text-content-tertiary uppercase tracking-wide mb-1">After</div>
                  <pre className="bg-background-primary border border-background-secondary rounded-lg p-3 text-xs font-mono text-content-secondary overflow-auto max-h-40 whitespace-pre-wrap break-all">
                    {fmtJSON(entry.after_value)}
                  </pre>
                </div>
              </div>
            )}
            {entry.user_agent && (
              <div className="mt-2 text-[10px] text-content-tertiary font-mono truncate">UA: {entry.user_agent}</div>
            )}
          </div>
        );
      })()}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 rounded-lg border border-background-secondary text-content-secondary disabled:opacity-40 hover:bg-background-secondary">Previous</button>
          <span className="text-content-tertiary">Page {page + 1} / {totalPages}</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 rounded-lg border border-background-secondary text-content-secondary disabled:opacity-40 hover:bg-background-secondary">Next</button>
        </div>
      )}

      {/* Action frequency sidebar */}
      {actionMeta.length > 0 && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4">
          <div className="text-sm font-semibold text-content-primary mb-3">Action Frequency (last 90 days)</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {actionMeta.slice(0, 12).map(a => (
              <button key={`${a.module}:${a.action}`} onClick={() => { setActionFilter(a.action); setModuleFilter(a.module); setPage(0); }}
                className="flex items-center justify-between text-xs border border-background-secondary rounded-lg px-3 py-2 hover:bg-background-secondary text-left">
                <div>
                  <div className="font-mono text-content-secondary">{a.action}</div>
                  {a.module && <div className="text-content-tertiary text-[10px]">{a.module}</div>}
                </div>
                <span className="font-mono text-content-primary font-medium">{a.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
