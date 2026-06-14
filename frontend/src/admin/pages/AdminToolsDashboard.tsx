import { useEffect, useState, useCallback } from 'react';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';

const API = '/api/v1/admin';

const authHeaders = (json = false): Record<string, string> => {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  return h;
};

interface ImpSession {
  id: string;
  admin_email: string;
  target_type: string;
  target_id: string;
  reason: string;
  status: string;
  actions_taken: number;
  started_at: string;
  ended_at?: string;
}

interface BulkOp {
  id: string;
  operation_type: string;
  status: string;
  total_count: number;
  processed_count: number;
  failed_count: number;
  created_by: string;
  approved_by?: string;
  note: string;
  created_at: string;
  completed_at?: string;
}

interface CronJob {
  id: string;
  job_name: string;
  description: string;
  cron_expr: string;
  last_run_at?: string;
  next_run_at?: string;
  last_status: string;
  last_duration_ms: number;
  last_rows_processed: number;
  consecutive_failures: number;
  is_enabled: boolean;
}

interface CronRun {
  id: string;
  job_name: string;
  started_at: string;
  finished_at?: string;
  status: string;
  rows_processed: number;
  error: string;
  [key: string]: unknown;
}

interface ExportQuery {
  id: string;
  name: string;
  description: string;
  category: string;
  query_template: string;
  params_schema: Record<string, unknown>;
  is_public: boolean;
  download_count: number;
}

interface ExportJob {
  id: string;
  query_name: string;
  status: string;
  row_count: number;
  file_size_bytes: number;
  file_url: string;
  created_by: string;
  created_at: string;
  completed_at?: string;
  [key: string]: unknown;
}

const CRON_CLS: Record<string, string> = {
  SUCCESS: 'bg-surface-positive text-content-positive',
  FAILED: 'bg-surface-negative text-content-negative',
  RUNNING: 'bg-surface-accent text-content-accent',
  NEVER_RUN: 'bg-background-secondary text-content-secondary',
};

const JOB_STATUS_CLS: Record<string, string> = {
  COMPLETED: 'bg-surface-positive text-content-positive',
  FAILED: 'bg-surface-negative text-content-negative',
  QUEUED: 'bg-surface-warning text-content-warning',
  PROCESSING: 'bg-surface-accent text-content-accent',
};

const BULK_CLS: Record<string, string> = {
  COMPLETED: 'bg-surface-positive text-content-positive',
  PENDING: 'bg-surface-warning text-content-warning',
  APPROVED: 'bg-surface-accent text-content-accent',
  FAILED: 'bg-surface-negative text-content-negative',
};

const CRON_RUN_COLUMNS: ColumnDef<CronRun>[] = [
  { key: 'job_name', header: 'Job', render: (v) => <span className="font-mono text-mono-small">{String(v)}</span> },
  { key: 'started_at', header: 'Started', type: 'date' },
  {
    key: 'status', header: 'Status',
    render: (v) => <span className={`px-1.5 py-0.5 rounded ${CRON_CLS[String(v)] ?? 'bg-background-secondary'}`}>{String(v)}</span>,
  },
  { key: 'rows_processed', header: 'Rows', type: 'numeric', render: (v) => Number(v).toLocaleString() },
  {
    key: 'error', header: 'Error',
    render: (v) => <span className="text-content-negative truncate max-w-xs block">{String(v) || '—'}</span>,
  },
];

const EXPORT_JOB_COLUMNS: ColumnDef<ExportJob>[] = [
  { key: 'query_name', header: 'Query', render: (v) => <span className="font-medium">{String(v)}</span> },
  {
    key: 'status', header: 'Status',
    render: (v) => <span className={`text-xs px-2 py-0.5 rounded ${JOB_STATUS_CLS[String(v)] ?? 'bg-background-secondary'}`}>{String(v)}</span>,
  },
  { key: 'row_count', header: 'Rows', type: 'numeric', render: (v) => Number(v).toLocaleString() },
  {
    key: 'file_size_bytes', header: 'Size',
    render: (v) => <span className="text-xs text-content-secondary">{Number(v) > 0 ? `${(Number(v) / 1024 / 1024).toFixed(1)} MB` : '—'}</span>,
  },
  { key: 'created_at', header: 'Created', type: 'date' },
  {
    key: 'file_url', header: 'Download',
    render: (v) => v ? <a href={String(v)} className="text-xs text-content-accent hover:underline">Download</a> : <>—</>,
  },
];

export function AdminToolsDashboard() {
  const [tab, setTab] = useState<'impersonation' | 'bulk' | 'cron' | 'exports'>('cron');
  const [sessions, setSessions] = useState<ImpSession[]>([]);
  const [bulkOps, setBulkOps] = useState<BulkOp[]>([]);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [cronRuns, setCronRuns] = useState<CronRun[]>([]);
  const [exportQueries, setExportQueries] = useState<ExportQuery[]>([]);
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);

  const load = useCallback(async () => {
    const [imp, bulk, cron, eq, ej] = await Promise.all([
      fetch(`${API}/tools/impersonation`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API}/tools/bulk-operations`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API}/tools/cron-jobs`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API}/tools/exports/queries`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API}/tools/exports/jobs`, { headers: authHeaders() }).then(r => r.json()),
    ]);
    setSessions(imp.sessions ?? []);
    setBulkOps(bulk.operations ?? []);
    setCronJobs(cron.jobs ?? []);
    setCronRuns(cron.recent_runs ?? []);
    setExportQueries(eq.queries ?? []);
    setExportJobs(ej.jobs ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleCron = async (id: string) => {
    await fetch(`${API}/tools/cron-jobs/${id}/toggle`, { method: 'POST', headers: authHeaders() });
    load();
  };

  const approveBulk = async (id: string) => {
    await fetch(`${API}/tools/bulk-operations/${id}/approve`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ approved_by: 'admin@drivers-for-u.in' }),
    });
    load();
  };

  const submitExport = async (q: ExportQuery) => {
    await fetch(`${API}/tools/exports/jobs`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ query_id: q.id, query_name: q.name, params: {}, created_by: 'admin@drivers-for-u.in' }),
    });
    load();
  };

  const endSession = async (id: string) => {
    await fetch(`${API}/tools/impersonation/${id}/end`, { method: 'POST', headers: authHeaders() });
    load();
  };

  const TABS = [
    { key: 'cron', label: 'Cron Jobs' },
    { key: 'exports', label: 'Data Exports' },
    { key: 'bulk', label: 'Bulk Operations' },
    { key: 'impersonation', label: 'Impersonation' },
  ] as const;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-content-primary">Admin Tools</h1>

      <div className="flex gap-2 border-b border-border-opaque">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px ${tab === t.key ? 'border-b-2 border-border-accent text-content-accent' : 'text-content-secondary hover:text-content-primary'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'cron' && (
        <div className="space-y-6">
          <div className="space-y-2">
            {cronJobs.map(job => (
              <div key={job.id} className={`flex items-center justify-between p-4 bg-white border rounded-lg ${job.consecutive_failures > 0 ? 'border-negative-400' : 'border-border-opaque'}`}>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${CRON_CLS[job.last_status] ?? 'bg-background-secondary'}`}>{job.last_status}</span>
                    <p className="font-medium text-content-primary">{job.job_name}</p>
                    {job.consecutive_failures > 0 && <span className="text-xs bg-surface-negative text-content-negative px-1.5 py-0.5 rounded">{job.consecutive_failures}× failed</span>}
                  </div>
                  <p className="text-xs text-content-secondary mt-1">{job.description}</p>
                  <div className="flex gap-4 mt-1 text-xs text-content-tertiary">
                    <span>Cron: <code className="bg-background-secondary px-1 rounded">{job.cron_expr}</code></span>
                    <span>Duration: {job.last_duration_ms}ms</span>
                    <span>Rows: {job.last_rows_processed.toLocaleString()}</span>
                    {job.next_run_at && <span>Next: {new Date(job.next_run_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                  </div>
                </div>
                <button onClick={() => toggleCron(job.id)}
                  className={`ml-4 px-3 py-1.5 text-xs rounded ${job.is_enabled ? 'bg-surface-positive text-content-positive' : 'bg-background-secondary text-content-secondary'}`}>
                  {job.is_enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            ))}
          </div>

          {cronRuns.length > 0 && (
            <div>
              <h3 className="font-semibold text-content-primary mb-2 text-sm">Recent Runs</h3>
              <DataTable<CronRun>
                columns={CRON_RUN_COLUMNS}
                data={cronRuns}
                rowKey={(r) => r.id}
              />
            </div>
          )}
        </div>
      )}

      {tab === 'exports' && (
        <div className="space-y-6">
          <div>
            <h3 className="font-semibold text-content-primary mb-3">Available Queries</h3>
            <div className="space-y-2">
              {exportQueries.map(q => (
                <div key={q.id} className="flex items-center justify-between p-4 bg-white border border-border-opaque rounded-lg">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-background-secondary text-content-secondary px-2 py-0.5 rounded">{q.category}</span>
                      <p className="font-medium text-content-primary">{q.name}</p>
                      {!q.is_public && <span className="text-xs bg-surface-warning text-content-warning px-1.5 py-0.5 rounded">Private</span>}
                    </div>
                    <p className="text-xs text-content-secondary mt-1">{q.description}</p>
                    <p className="text-xs text-content-tertiary mt-1">{q.download_count} downloads</p>
                  </div>
                  <button onClick={() => submitExport(q)} className="ml-4 px-3 py-1.5 bg-accent-400 text-white text-xs rounded hover:bg-accent-400">Run Export</button>
                </div>
              ))}
            </div>
          </div>

          {exportJobs.length > 0 && (
            <div>
              <h3 className="font-semibold text-content-primary mb-3">Recent Jobs</h3>
              <DataTable<ExportJob>
                columns={EXPORT_JOB_COLUMNS}
                data={exportJobs}
                rowKey={(j) => j.id}
              />
            </div>
          )}
        </div>
      )}

      {tab === 'bulk' && (
        <div className="space-y-3">
          {bulkOps.map(op => (
            <div key={op.id} className="p-4 bg-white border border-border-opaque rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${BULK_CLS[op.status] ?? 'bg-background-secondary'}`}>{op.status}</span>
                    <p className="font-semibold text-content-primary">{op.operation_type}</p>
                  </div>
                  <p className="text-sm text-content-secondary mt-1">{op.note}</p>
                  <p className="text-xs text-content-tertiary mt-1">By: {op.created_by} | {new Date(op.created_at).toLocaleString()}</p>
                  <div className="flex gap-4 mt-2 text-sm">
                    <span>Total: <strong>{op.total_count.toLocaleString()}</strong></span>
                    <span className="text-content-positive">Done: {op.processed_count.toLocaleString()}</span>
                    {op.failed_count > 0 && <span className="text-content-negative">Failed: {op.failed_count}</span>}
                  </div>
                  {op.total_count > 0 && op.processed_count > 0 && (
                    <div className="w-48 bg-background-tertiary rounded-full h-1.5 mt-2">
                      <div className="bg-surface-accent0 h-1.5 rounded-full" style={{ width: `${(op.processed_count / op.total_count) * 100}%` }} />
                    </div>
                  )}
                </div>
                {op.status === 'PENDING' && (
                  <button onClick={() => approveBulk(op.id)} className="ml-4 px-3 py-1.5 bg-accent-400 text-white text-xs rounded hover:bg-accent-400">Approve</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'impersonation' && (
        <div className="space-y-3">
          <p className="text-sm text-content-secondary bg-surface-warning border border-warning-400 rounded p-3">All impersonation sessions are logged and audited. Use only for debugging with explicit user consent.</p>
          {sessions.map(s => (
            <div key={s.id} className="p-4 bg-white border border-border-opaque rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${s.status === 'ACTIVE' ? 'bg-surface-accent text-content-accent' : 'bg-background-secondary text-content-secondary'}`}>{s.status}</span>
                    <p className="font-medium text-content-primary">{s.target_type}: {s.target_id}</p>
                  </div>
                  <p className="text-xs text-content-secondary mt-1">By: {s.admin_email} | {s.actions_taken} actions</p>
                  <p className="text-sm text-content-secondary mt-1">{s.reason}</p>
                  <p className="text-xs text-content-tertiary mt-1">Started: {new Date(s.started_at).toLocaleString()}{s.ended_at && ` | Ended: ${new Date(s.ended_at).toLocaleString()}`}</p>
                </div>
                {s.status === 'ACTIVE' && (
                  <button onClick={() => endSession(s.id)} className="ml-4 px-3 py-1.5 bg-negative-400 text-white text-xs rounded hover:bg-negative-400">End Session</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
