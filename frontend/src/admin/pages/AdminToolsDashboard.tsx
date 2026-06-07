import { useEffect, useState, useCallback } from 'react';

const API = '/api/v1/admin';

const authHeaders = (json = false): Record<string, string> => {
  const token = localStorage.getItem('admin_jwt_token') || '';
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
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
}

const CRON_CLS: Record<string, string> = {
  SUCCESS: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  RUNNING: 'bg-blue-100 text-blue-700',
  NEVER_RUN: 'bg-gray-100 text-gray-500',
};

const JOB_STATUS_CLS: Record<string, string> = {
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  QUEUED: 'bg-yellow-100 text-yellow-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
};

const BULK_CLS: Record<string, string> = {
  COMPLETED: 'bg-green-100 text-green-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  APPROVED: 'bg-blue-100 text-blue-700',
  FAILED: 'bg-red-100 text-red-700',
};

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
      <h1 className="text-2xl font-bold text-gray-900">Admin Tools</h1>

      <div className="flex gap-2 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px ${tab === t.key ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'cron' && (
        <div className="space-y-6">
          <div className="space-y-2">
            {cronJobs.map(job => (
              <div key={job.id} className={`flex items-center justify-between p-4 bg-white border rounded-lg ${job.consecutive_failures > 0 ? 'border-red-300' : 'border-gray-200'}`}>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${CRON_CLS[job.last_status] ?? 'bg-gray-100'}`}>{job.last_status}</span>
                    <p className="font-medium text-gray-900">{job.job_name}</p>
                    {job.consecutive_failures > 0 && <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{job.consecutive_failures}× failed</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{job.description}</p>
                  <div className="flex gap-4 mt-1 text-xs text-gray-400">
                    <span>Cron: <code className="bg-gray-100 px-1 rounded">{job.cron_expr}</code></span>
                    <span>Duration: {job.last_duration_ms}ms</span>
                    <span>Rows: {job.last_rows_processed.toLocaleString()}</span>
                    {job.next_run_at && <span>Next: {new Date(job.next_run_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                  </div>
                </div>
                <button onClick={() => toggleCron(job.id)}
                  className={`ml-4 px-3 py-1.5 text-xs rounded ${job.is_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {job.is_enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            ))}
          </div>

          {cronRuns.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-700 mb-2 text-sm">Recent Runs</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>{['Job', 'Started', 'Status', 'Rows', 'Error'].map(h => <th key={h} className="text-left p-2 font-medium text-gray-500">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {cronRuns.map(run => (
                      <tr key={run.id} className="hover:bg-gray-50">
                        <td className="p-2 font-mono">{run.job_name}</td>
                        <td className="p-2 text-gray-500">{new Date(run.started_at).toLocaleString()}</td>
                        <td className="p-2"><span className={`px-1.5 py-0.5 rounded ${CRON_CLS[run.status] ?? 'bg-gray-100'}`}>{run.status}</span></td>
                        <td className="p-2">{run.rows_processed.toLocaleString()}</td>
                        <td className="p-2 text-red-600 truncate max-w-xs">{run.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'exports' && (
        <div className="space-y-6">
          <div>
            <h3 className="font-semibold text-gray-700 mb-3">Available Queries</h3>
            <div className="space-y-2">
              {exportQueries.map(q => (
                <div key={q.id} className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{q.category}</span>
                      <p className="font-medium text-gray-900">{q.name}</p>
                      {!q.is_public && <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">Private</span>}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{q.description}</p>
                    <p className="text-xs text-gray-400 mt-1">{q.download_count} downloads</p>
                  </div>
                  <button onClick={() => submitExport(q)} className="ml-4 px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">Run Export</button>
                </div>
              ))}
            </div>
          </div>

          {exportJobs.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-700 mb-3">Recent Jobs</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>{['Query', 'Status', 'Rows', 'Size', 'Created', 'Download'].map(h => <th key={h} className="text-left p-3 font-medium text-gray-600">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {exportJobs.map(j => (
                      <tr key={j.id} className="hover:bg-gray-50">
                        <td className="p-3 font-medium">{j.query_name}</td>
                        <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded ${JOB_STATUS_CLS[j.status] ?? 'bg-gray-100'}`}>{j.status}</span></td>
                        <td className="p-3">{j.row_count.toLocaleString()}</td>
                        <td className="p-3 text-xs text-gray-500">{j.file_size_bytes > 0 ? `${(j.file_size_bytes / 1024 / 1024).toFixed(1)} MB` : '—'}</td>
                        <td className="p-3 text-xs text-gray-500">{new Date(j.created_at).toLocaleString()}</td>
                        <td className="p-3">{j.file_url ? <a href={j.file_url} className="text-xs text-blue-600 hover:underline">Download</a> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'bulk' && (
        <div className="space-y-3">
          {bulkOps.map(op => (
            <div key={op.id} className="p-4 bg-white border border-gray-200 rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${BULK_CLS[op.status] ?? 'bg-gray-100'}`}>{op.status}</span>
                    <p className="font-semibold text-gray-900">{op.operation_type}</p>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{op.note}</p>
                  <p className="text-xs text-gray-400 mt-1">By: {op.created_by} | {new Date(op.created_at).toLocaleString()}</p>
                  <div className="flex gap-4 mt-2 text-sm">
                    <span>Total: <strong>{op.total_count.toLocaleString()}</strong></span>
                    <span className="text-green-600">Done: {op.processed_count.toLocaleString()}</span>
                    {op.failed_count > 0 && <span className="text-red-600">Failed: {op.failed_count}</span>}
                  </div>
                  {op.total_count > 0 && op.processed_count > 0 && (
                    <div className="w-48 bg-gray-200 rounded-full h-1.5 mt-2">
                      <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${(op.processed_count / op.total_count) * 100}%` }} />
                    </div>
                  )}
                </div>
                {op.status === 'PENDING' && (
                  <button onClick={() => approveBulk(op.id)} className="ml-4 px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">Approve</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'impersonation' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500 bg-yellow-50 border border-yellow-200 rounded p-3">All impersonation sessions are logged and audited. Use only for debugging with explicit user consent.</p>
          {sessions.map(s => (
            <div key={s.id} className="p-4 bg-white border border-gray-200 rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${s.status === 'ACTIVE' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{s.status}</span>
                    <p className="font-medium text-gray-900">{s.target_type}: {s.target_id}</p>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">By: {s.admin_email} | {s.actions_taken} actions</p>
                  <p className="text-sm text-gray-600 mt-1">{s.reason}</p>
                  <p className="text-xs text-gray-400 mt-1">Started: {new Date(s.started_at).toLocaleString()}{s.ended_at && ` | Ended: ${new Date(s.ended_at).toLocaleString()}`}</p>
                </div>
                {s.status === 'ACTIVE' && (
                  <button onClick={() => endSession(s.id)} className="ml-4 px-3 py-1.5 bg-red-600 text-white text-xs rounded hover:bg-red-700">End Session</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
