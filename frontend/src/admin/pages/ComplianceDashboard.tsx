import React, { useState, useEffect, useCallback } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

interface PendingDriver {
  id: string;
  name: string;
  phone: string;
  dl_number: string;
  city_prefix: string;
  background_check_status: string;
  document_count?: number;
  created_at: string;
}

interface DriverDetail {
  id: string;
  name: string;
  phone: string;
  dl_number: string;
  city_prefix: string;
  background_check_status: string;
  license_doc_url?: string;
  id_proof_url?: string;
  address_proof_url?: string;
  selfie_url?: string;
  created_at: string;
}

type StatusFilter = 'ALL' | 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';

function statusBadge(s: string) {
  const map: Record<string, string> = {
    PENDING: 'bg-surface-warning text-content-warning',
    UNDER_REVIEW: 'bg-surface-accent text-content-accent',
    APPROVED: 'bg-surface-positive text-content-positive',
    REJECTED: 'bg-surface-negative text-content-negative',
  };
  const cls = map[s] ?? 'bg-canvas-soft text-body';
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>{s}</span>;
}

export const ComplianceDashboard: React.FC = () => {
  const [drivers, setDrivers] = useState<PendingDriver[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('PENDING');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<DriverDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const role = localStorage.getItem('admin_role') || 'SUPER_ADMIN';
  const headers = {
    'X-Admin-Role': role,
    'Content-Type': 'application/json',
    'X-Admin-Email': localStorage.getItem('admin_email') || '',
  };

  const fetchDrivers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50', offset: '0' });
    if (statusFilter !== 'ALL') params.set('status', statusFilter);
    if (search) params.set('search', search);
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/pending?${params}`, { headers });
      if (res.ok) {
        const d = await res.json();
        setDrivers(d.drivers || []);
        setTotal(d.total || 0);
      }
    } catch (_) {
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => { fetchDrivers(); }, [fetchDrivers]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/pending/${id}`, { headers });
      if (res.ok) setSelected(await res.json());
    } catch (_) {
    } finally {
      setDetailLoading(false);
    }
  };

  const doVerify = async (driverID: string, action: 'APPROVE' | 'REJECT', reason?: string) => {
    // REJECT already goes through a required-reason flow; gate the one-click APPROVE.
    if (action === 'APPROVE' && !window.confirm(`Approve KYC for driver ${driverID}? This activates them for live dispatch.`)) {
      return;
    }
    setActionMsg(null);
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/verify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ driver_id: driverID, action, rejection_reason: reason }),
      });
      if (res.ok) {
        setActionMsg(`${action === 'APPROVE' ? '✓ Approved' : '✗ Rejected'} successfully`);
        setSelected(null);
        fetchDrivers();
      } else {
        const t = await res.text();
        setActionMsg(`Error: ${t}`);
      }
    } catch (e) {
      setActionMsg(`Error: ${String(e)}`);
    }
  };

  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">Compliance & KYC</h1>
        <p className="text-sm text-mute">Driver document verification and background check queue</p>
      </div>

      {actionMsg && (
        <div className={`rounded-lg px-4 py-2.5 text-sm ${actionMsg.startsWith('Error') ? 'bg-surface-negative text-content-negative border border-negative-400' : 'bg-surface-positive text-content-positive border border-positive-400'}`}>
          {actionMsg}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex gap-1">
          {(['ALL', 'PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as StatusFilter[]).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                statusFilter === s ? 'bg-accent text-white border-accent' : 'bg-canvas border-canvas-soft text-body hover:text-ink'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search by name or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-canvas-soft rounded-lg px-3 py-1.5 text-sm bg-canvas text-ink focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <span className="ml-auto text-xs text-mute self-center">{total} drivers</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Driver List */}
        <div className="bg-canvas rounded-xl border border-canvas-soft overflow-hidden">
          <div className="px-4 py-3 border-b border-canvas-soft text-xs font-semibold text-mute uppercase tracking-wide">
            Verification Queue
          </div>
          {loading && <div className="p-6 text-sm text-mute animate-pulse">Loading…</div>}
          {!loading && drivers.length === 0 && (
            <div className="p-6 text-sm text-mute text-center">No drivers in this queue.</div>
          )}
          <div className="divide-y divide-canvas-soft/50">
            {drivers.map(d => (
              <button
                key={d.id}
                onClick={() => openDetail(d.id)}
                className={`w-full text-left px-4 py-3 hover:bg-canvas-soft/30 transition-colors ${selected?.id === d.id ? 'bg-accent/5 border-l-2 border-accent' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm text-ink">{d.name}</div>
                    <div className="text-xs text-mute">{d.phone} · {d.city_prefix} · DL: {d.dl_number}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {statusBadge(d.background_check_status)}
                    <div className="text-[10px] text-mute">{new Date(d.created_at).toLocaleDateString('en-IN')}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Detail Panel */}
        <div className="bg-canvas rounded-xl border border-canvas-soft p-5">
          {detailLoading && <div className="text-sm text-mute animate-pulse">Loading driver details…</div>}
          {!detailLoading && !selected && (
            <div className="flex flex-col items-center justify-center h-40 text-mute text-sm">
              <div className="text-3xl mb-2">📋</div>
              Select a driver to review their KYC documents
            </div>
          )}
          {!detailLoading && selected && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-ink">{selected.name}</div>
                  <div className="text-xs text-mute">{selected.phone} · {selected.city_prefix}</div>
                </div>
                {statusBadge(selected.background_check_status)}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-canvas-soft/50 rounded-lg p-3">
                  <div className="text-xs text-mute mb-1">DL Number</div>
                  <div className="font-mono text-ink">{selected.dl_number}</div>
                </div>
                <div className="bg-canvas-soft/50 rounded-lg p-3">
                  <div className="text-xs text-mute mb-1">Applied</div>
                  <div className="text-body">{new Date(selected.created_at).toLocaleDateString('en-IN')}</div>
                </div>
              </div>

              {/* Document placeholders */}
              <div>
                <div className="text-xs font-semibold text-mute uppercase tracking-wide mb-2">Documents</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Driving License', url: selected.license_doc_url },
                    { label: 'ID Proof', url: selected.id_proof_url },
                    { label: 'Address Proof', url: selected.address_proof_url },
                    { label: 'Selfie', url: selected.selfie_url },
                  ].map(doc => (
                    <div key={doc.label} className="bg-canvas-soft/50 rounded-lg p-3 text-center">
                      <div className="text-2xl mb-1">{doc.url ? '📄' : '❌'}</div>
                      <div className="text-xs text-body">{doc.label}</div>
                      {doc.url
                        ? <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-accent hover:underline">View</a>
                        : <div className="text-[10px] text-mute">Not uploaded</div>
                      }
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              {selected.background_check_status === 'PENDING' || selected.background_check_status === 'UNDER_REVIEW' ? (
                <div className="space-y-2">
                  {showRejectInput ? (
                    <div className="space-y-2">
                      <textarea
                        placeholder="Rejection reason (required)…"
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        className="w-full border border-canvas-soft rounded-lg px-3 py-2 text-sm bg-canvas text-ink resize-none focus:outline-none focus:ring-1 focus:ring-negative-400"
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { if (rejectReason.trim()) doVerify(selected.id, 'REJECT', rejectReason); }}
                          disabled={!rejectReason.trim()}
                          className="flex-1 bg-surface-negative0 hover:bg-negative-400 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium"
                        >
                          Confirm Reject
                        </button>
                        <button onClick={() => setShowRejectInput(false)} className="px-4 py-2 rounded-lg text-sm border border-canvas-soft text-body hover:bg-canvas-soft">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => doVerify(selected.id, 'APPROVE')}
                        className="flex-1 bg-surface-positive0 hover:bg-positive-400 text-white px-4 py-2 rounded-lg text-sm font-medium"
                      >
                        ✓ Approve KYC
                      </button>
                      <button
                        onClick={() => { setShowRejectInput(true); setRejectReason(''); }}
                        className="flex-1 bg-surface-negative hover:bg-surface-negative text-content-negative border border-negative-400 px-4 py-2 rounded-lg text-sm font-medium"
                      >
                        ✗ Reject
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-mute italic">This application has already been {selected.background_check_status.toLowerCase()}.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
