import React, { useState, useEffect, useCallback } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

// ── Types ────────────────────────────────────────────────────────────────────
interface PendingDriver {
  id: string; name: string; phone: string; dl_number: string;
  city_prefix: string; background_check_status: string; created_at: string;
}
interface VaultDocument {
  id: string; entity_type: string; entity_id: string; doc_type: string;
  display_name: string; expiry_date: string | null; status: string; tags: string[];
}
interface PrivacyRequest {
  id: string; request_type: string; requester_type: string;
  requester_email: string; requester_phone: string;
  status: string; notes: string; deadline_at: string | null;
  processed_by_email: string | null; created_at: string;
}

type Tab = 'kyc' | 'expiry' | 'privacy' | 'regulatory';

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-surface-warning text-content-warning',
  UNDER_REVIEW: 'bg-surface-accent text-content-accent',
  APPROVED: 'bg-surface-positive text-content-positive',
  REJECTED: 'bg-surface-negative text-content-negative',
  PROCESSING: 'bg-surface-accent text-content-accent',
  COMPLETED: 'bg-surface-positive text-content-positive',
  OPEN: 'bg-surface-warning text-content-warning',
  ACTIVE: 'bg-surface-positive text-content-positive',
  EXPIRED: 'bg-surface-negative text-content-negative',
};

function badge(status: string) {
  const cls = STATUS_BADGE[status] ?? 'bg-background-secondary text-content-secondary';
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>{status}</span>;
}

function daysUntil(dateStr: string | null) {
  if (!dateStr) return null;
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
  return diff;
}

// ── Main Component ───────────────────────────────────────────────────────────
export const ComplianceExtendedDashboard: React.FC = () => {
  const [tab, setTab] = useState<Tab>('kyc');
  const role = localStorage.getItem('admin_role') || 'SUPER_ADMIN';
  const email = localStorage.getItem('admin_email') || '';
  const headers = {
    'X-Admin-Role': role,
    'X-Admin-Email': email, 'Content-Type': 'application/json',
  };

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-content-primary">Compliance & KYC</h1>
        <p className="text-sm text-content-tertiary">Document verification, expiry tracking, privacy requests, and regulatory compliance</p>
      </div>
      <div className="flex gap-1 border-b border-background-secondary">
        {(['kyc', 'expiry', 'privacy', 'regulatory'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? 'border-accent text-accent' : 'border-transparent text-content-secondary hover:text-content-primary'
            }`}>
            {t === 'kyc' ? 'KYC Queue' : t === 'expiry' ? 'Doc Expiry' : t === 'privacy' ? 'Privacy / GDPR' : 'Regulatory'}
          </button>
        ))}
      </div>
      {tab === 'kyc' && <KYCTab headers={headers} />}
      {tab === 'expiry' && <ExpiryTab headers={headers} />}
      {tab === 'privacy' && <PrivacyTab headers={headers} />}
      {tab === 'regulatory' && <RegulatoryTab />}
    </div>
  );
};

// ── KYC Queue Tab ────────────────────────────────────────────────────────────
const KYCTab: React.FC<{ headers: Record<string, string> }> = ({ headers }) => {
  const [drivers, setDrivers] = useState<PendingDriver[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [msg, setMsg] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ limit: '50', offset: '0' });
    if (statusFilter !== 'ALL') p.set('status', statusFilter);
    const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/pending?${p}`, { headers });
    if (res.ok) { const d = await res.json(); setDrivers(d.drivers || []); }
    setLoading(false);
  }, [statusFilter]);

  const openDetail = async (id: string) => {
    const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/pending/${id}`, { headers });
    if (res.ok) setSelected(await res.json());
  };

  const doVerify = async (action: 'APPROVE' | 'REJECT', reason?: string) => {
    if (!selected) return;
    const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/verify`, {
      method: 'POST', headers,
      body: JSON.stringify({ driver_id: selected.id, action, rejection_reason: reason }),
    });
    if (res.ok) { setMsg(action === 'APPROVE' ? '✓ KYC Approved' : '✗ Rejected'); setSelected(null); setShowReject(false); fetch_(); }
    else setMsg('Error — action failed');
  };

  useEffect(() => { fetch_(); }, [fetch_]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="space-y-3">
        <div className="rounded-lg border border-background-secondary bg-background-secondary/40 px-4 py-2.5 text-xs text-content-tertiary">
          ℹ️ KYC verification applies to <span className="font-medium text-content-secondary">drivers only</span>. Riders are not subject to a separate KYC review, so the driver onboarding queue (<span className="font-mono">/drivers/pending</span>) is the sole KYC source here.
        </div>
        {msg && <div className={`rounded-lg px-4 py-2.5 text-sm ${msg.startsWith('Error') ? 'bg-surface-negative text-content-negative' : 'bg-surface-positive text-content-positive'}`}>{msg}</div>}
        <div className="flex gap-1 flex-wrap">
          {['ALL', 'PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs border ${statusFilter === s ? 'bg-accent text-white border-accent' : 'bg-background-primary border-background-secondary text-content-secondary hover:text-content-primary'}`}>
              {s}
            </button>
          ))}
        </div>
        <div className="bg-background-primary rounded-xl border border-background-secondary overflow-hidden">
          {loading && <div className="p-6 text-sm text-content-tertiary animate-pulse">Loading…</div>}
          {!loading && drivers.length === 0 && <div className="p-6 text-center text-sm text-content-tertiary">Queue is empty.</div>}
          <div className="divide-y divide-background-secondary/50">
            {drivers.map(d => (
              <button key={d.id} onClick={() => openDetail(d.id)}
                className={`w-full text-left px-4 py-3 hover:bg-background-secondary/30 ${selected?.id === d.id ? 'bg-accent/5 border-l-2 border-accent' : ''}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-content-primary">{d.name}</div>
                    <div className="text-xs text-content-tertiary">{d.phone} · {d.city_prefix}</div>
                  </div>
                  {badge(d.background_check_status)}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-background-primary rounded-xl border border-background-secondary p-5">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-48 text-content-tertiary text-sm">
            <span className="text-4xl mb-2">📋</span>Select a driver to review
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-content-primary">{selected.name}</div>
                <div className="text-xs text-content-tertiary">{selected.phone} · DL: {selected.dl_number}</div>
              </div>
              {badge(selected.background_check_status)}
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                ['City', selected.city_prefix],
                ['Applied', new Date(selected.created_at).toLocaleDateString('en-IN')],
              ].map(([k, v]) => (
                <div key={k} className="bg-background-secondary/50 rounded-lg p-3">
                  <div className="text-xs text-content-tertiary">{k}</div>
                  <div className="font-mono text-content-primary">{v}</div>
                </div>
              ))}
            </div>
            <div>
              <div className="text-xs font-semibold text-content-tertiary uppercase tracking-wide mb-2">Documents</div>
              <div className="grid grid-cols-2 gap-2">
                {['Driving License', 'ID Proof', 'Address Proof', 'Selfie'].map(doc => {
                  const key = doc.toLowerCase().replace(/ /g, '_') + '_url';
                  const url = selected[key];
                  return (
                    <div key={doc} className="bg-background-secondary/50 rounded-lg p-3 text-center">
                      <div className="text-2xl mb-1">{url ? '📄' : '❌'}</div>
                      <div className="text-xs text-content-secondary">{doc}</div>
                      {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-accent hover:underline">View</a>
                           : <div className="text-[10px] text-content-tertiary">Not uploaded</div>}
                    </div>
                  );
                })}
              </div>
            </div>
            {(selected.background_check_status === 'PENDING' || selected.background_check_status === 'UNDER_REVIEW') && (
              <div className="space-y-2">
                {showReject ? (
                  <>
                    <textarea rows={2} value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                      placeholder="Rejection reason (required)…"
                      className="w-full border border-background-secondary rounded-lg px-3 py-2 text-sm bg-background-primary text-content-primary resize-none focus:outline-none" />
                    <div className="flex gap-2">
                      <button onClick={() => doVerify('REJECT', rejectReason)} disabled={!rejectReason.trim()}
                        className="flex-1 bg-surface-negative0 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40">
                        Confirm Reject
                      </button>
                      <button onClick={() => setShowReject(false)} className="px-4 py-2 border border-background-secondary rounded-lg text-sm text-content-secondary">Cancel</button>
                    </div>
                  </>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => doVerify('APPROVE')} className="flex-1 bg-surface-positive0 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-positive-400">✓ Approve</button>
                    <button onClick={() => { setShowReject(true); setRejectReason(''); }} className="flex-1 bg-surface-negative text-content-negative border border-negative-400 px-4 py-2 rounded-lg text-sm font-medium hover:bg-surface-negative">✗ Reject</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Document Expiry Tab ──────────────────────────────────────────────────────
const ExpiryTab: React.FC<{ headers: Record<string, string> }> = ({ headers }) => {
  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [days, setDays] = useState(60);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/documents/expiring?days=${days}`, { headers });
      if (res.ok) { const d = await res.json(); setDocs(d.documents || []); }
      setLoading(false);
    })();
  }, [days]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-content-secondary">Show documents expiring within</span>
        {[30, 60, 90].map(d => (
          <button key={d} onClick={() => setDays(d)}
            className={`px-3 py-1.5 rounded-lg text-sm border ${days === d ? 'bg-accent text-white border-accent' : 'bg-background-primary border-background-secondary text-content-secondary hover:text-content-primary'}`}>
            {d} days
          </button>
        ))}
        <span className="text-xs text-content-tertiary ml-auto">{docs.length} document{docs.length !== 1 ? 's' : ''}</span>
      </div>

      {loading && <div className="text-sm text-content-tertiary animate-pulse">Loading…</div>}

      <div className="space-y-2">
        {docs.length === 0 && !loading && (
          <div className="bg-background-primary rounded-xl border border-background-secondary p-8 text-center text-content-tertiary text-sm">
            ✅ No documents expiring in the next {days} days.
          </div>
        )}
        {docs.map(doc => {
          const d = daysUntil(doc.expiry_date);
          const urgency = d !== null && d <= 14 ? 'border-negative-400 bg-surface-negative' : d !== null && d <= 30 ? 'border-warning-400 bg-surface-warning' : 'border-background-secondary bg-background-primary';
          return (
            <div key={doc.id} className={`rounded-xl border p-4 flex items-center justify-between gap-4 ${urgency}`}>
              <div>
                <div className="text-sm font-medium text-content-primary">{doc.display_name}</div>
                <div className="text-xs text-content-tertiary">{doc.entity_type} · {doc.entity_id.slice(0, 8)}… · {doc.doc_type}</div>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {doc.tags.map(tag => <span key={tag} className="text-[10px] border border-background-secondary rounded px-1.5 py-0.5 text-content-tertiary">{tag}</span>)}
                </div>
              </div>
              <div className="text-right shrink-0">
                {doc.expiry_date && (
                  <>
                    <div className="text-sm font-mono text-content-primary">{doc.expiry_date}</div>
                    <div className={`text-xs font-medium ${d !== null && d <= 14 ? 'text-content-negative' : d !== null && d <= 30 ? 'text-content-warning' : 'text-content-tertiary'}`}>
                      {d !== null ? (d <= 0 ? 'EXPIRED' : `${d}d left`) : ''}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Privacy / GDPR Tab ───────────────────────────────────────────────────────
const PrivacyTab: React.FC<{ headers: Record<string, string> }> = ({ headers }) => {
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [showNew, setShowNew] = useState(false);
  const [newReq, setNewReq] = useState({ request_type: 'DATA_EXPORT', requester_type: 'RIDER', requester_email: '', requester_phone: '', requester_id: '', notes: '' });
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [processAction, setProcessAction] = useState<'COMPLETE' | 'REJECT'>('COMPLETE');
  const [processNote, setProcessNote] = useState('');

  const base = `${API_GATEWAY_BASE_URL}/api/v1/admin/compliance`;

  const fetch_ = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ limit: '50' });
    if (statusFilter !== 'ALL') p.set('status', statusFilter);
    const res = await fetch(`${base}/privacy-requests?${p}`, { headers });
    if (res.ok) { const d = await res.json(); setRequests(d.requests || []); }
    setLoading(false);
  }, [statusFilter]);

  const createRequest = async () => {
    const res = await fetch(`${base}/privacy-requests`, { method: 'POST', headers, body: JSON.stringify(newReq) });
    if (res.ok) { setShowNew(false); fetch_(); }
  };

  const processRequest = async () => {
    if (!processingId) return;
    const res = await fetch(`${base}/privacy-requests/${processingId}/process`, {
      method: 'POST', headers,
      body: JSON.stringify({ action: processAction, notes: processNote }),
    });
    if (res.ok) { setProcessingId(null); fetch_(); }
  };

  useEffect(() => { fetch_(); }, [fetch_]);

  const REQ_TYPES = ['DATA_EXPORT', 'DATA_DELETE', 'CONSENT_WITHDRAWAL', 'RECTIFICATION'];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        {['ALL', 'PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs border ${statusFilter === s ? 'bg-accent text-white border-accent' : 'bg-background-primary border-background-secondary text-content-secondary hover:text-content-primary'}`}>
            {s}
          </button>
        ))}
        <button onClick={() => setShowNew(!showNew)}
          className="ml-auto px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">
          + New Request
        </button>
      </div>

      {showNew && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
          <div className="text-sm font-semibold text-content-primary">New Privacy Request</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-content-tertiary">Request Type</label>
              <select value={newReq.request_type} onChange={e => setNewReq({ ...newReq, request_type: e.target.value })}
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
                {REQ_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-content-tertiary">Requester Type</label>
              <select value={newReq.requester_type} onChange={e => setNewReq({ ...newReq, requester_type: e.target.value })}
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
                <option value="RIDER">RIDER</option>
                <option value="DRIVER">DRIVER</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-content-tertiary">Email</label>
              <input value={newReq.requester_email} onChange={e => setNewReq({ ...newReq, requester_email: e.target.value })}
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div>
              <label className="text-xs text-content-tertiary">Phone</label>
              <input value={newReq.requester_phone} onChange={e => setNewReq({ ...newReq, requester_phone: e.target.value })}
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={createRequest} className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Submit</button>
            <button onClick={() => setShowNew(false)} className="px-4 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">Cancel</button>
          </div>
        </div>
      )}

      {processingId && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
          <div className="text-sm font-semibold text-content-primary">Process Request</div>
          <div className="flex gap-2">
            {(['COMPLETE', 'REJECT'] as const).map(a => (
              <button key={a} onClick={() => setProcessAction(a)}
                className={`px-3 py-1.5 rounded-lg text-xs border ${processAction === a ? (a === 'COMPLETE' ? 'bg-surface-positive0 text-white' : 'bg-surface-negative0 text-white') : 'bg-background-primary border-background-secondary text-content-secondary'}`}>
                {a}
              </button>
            ))}
          </div>
          <textarea rows={2} value={processNote} onChange={e => setProcessNote(e.target.value)}
            placeholder="Notes (optional)…"
            className="w-full border border-background-secondary rounded-lg px-3 py-2 text-sm bg-background-primary text-content-primary resize-none focus:outline-none" />
          <div className="flex gap-2">
            <button onClick={processRequest} className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Confirm</button>
            <button onClick={() => setProcessingId(null)} className="px-4 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary">Cancel</button>
          </div>
        </div>
      )}

      {loading && <div className="text-sm text-content-tertiary animate-pulse">Loading…</div>}

      <div className="space-y-2">
        {requests.map(req => {
          const deadline = daysUntil(req.deadline_at);
          return (
            <div key={req.id} className="bg-background-primary rounded-xl border border-background-secondary p-4 flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-content-primary">{req.request_type}</span>
                  {badge(req.status)}
                </div>
                <div className="text-xs text-content-tertiary mt-0.5">{req.requester_type} · {req.requester_email}</div>
                {req.notes && <div className="text-xs text-content-secondary mt-1 italic">"{req.notes}"</div>}
                {req.processed_by_email && <div className="text-xs text-content-tertiary">Processed by {req.processed_by_email}</div>}
              </div>
              <div className="text-right shrink-0 space-y-1">
                {deadline !== null && req.status === 'PENDING' && (
                  <div className={`text-xs font-medium ${deadline <= 7 ? 'text-content-negative' : 'text-content-tertiary'}`}>{deadline}d left</div>
                )}
                <div className="text-xs text-content-tertiary">{new Date(req.created_at).toLocaleDateString('en-IN')}</div>
                {(req.status === 'PENDING' || req.status === 'PROCESSING') && (
                  <button onClick={() => setProcessingId(req.id)} className="text-xs text-accent hover:underline">Process</button>
                )}
              </div>
            </div>
          );
        })}
        {requests.length === 0 && !loading && (
          <div className="text-sm text-content-tertiary text-center py-8">No privacy requests matching this filter.</div>
        )}
      </div>
    </div>
  );
};

// ── Regulatory Tab ───────────────────────────────────────────────────────────
const RegulatoryTab: React.FC = () => (
  <div className="space-y-4">
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {[
        { icon: '🚗', title: 'RTO Submission Reports', desc: 'Generate and export trip data reports formatted for Regional Transport Office (RTO) compliance filing.' },
        { icon: '🔍', title: 'AML / Sanctions Screening', desc: 'Integration hook for sanctions list screening of drivers and riders against OFAC/UN consolidated lists.' },
        { icon: '🧾', title: 'e-Invoice Compliance (IRP)', desc: 'Auto-generate GST e-invoices via Invoice Registration Portal (IRP) integration for B2B trips.' },
        { icon: '🛡', title: 'Insurance Policy Management', desc: 'Track fleet insurance policies, claim history, and coverage gaps across all registered vehicles.' },
        { icon: '📋', title: 'Background Check Integration', desc: 'Manage third-party background verification provider (Authbridge / Digilocker) sync and status.' },
        { icon: '🌐', title: 'DPDP Act Consent Log', desc: 'View and export user consent records per DPDP Act 2023 requirements for regulatory audit.' },
      ].map(item => (
        <div key={item.title} className="bg-background-primary rounded-xl border border-background-secondary p-5">
          <div className="text-2xl mb-2">{item.icon}</div>
          <div className="font-semibold text-sm text-content-primary">{item.title}</div>
          <div className="text-xs text-content-tertiary mt-1">{item.desc}</div>
          <button className="mt-3 text-xs text-accent hover:underline">Configure integration →</button>
        </div>
      ))}
    </div>
  </div>
);
