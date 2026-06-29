import React, { useEffect, useState } from 'react';
import { adminApi } from '../../lib/adminApi';
import { formatPaiseCompact } from '../lib/money';

// Shape mirrors backend adminInsuranceClaim (internal/rider/.../insurance_handler.go)
interface InsuranceClaim {
  id: string;
  order_id: string;
  rider_id: string;
  rider_name: string;
  claim_type: string;
  description: string;
  status: string;
  amount_paise?: number | null;
  created_at: string;
}

type ClaimAction = 'APPROVED' | 'REJECTED';

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-500/15 text-amber-300',
  UNDER_REVIEW: 'bg-amber-500/15 text-amber-300',
  APPROVED: 'bg-emerald-500/15 text-emerald-300',
  REJECTED: 'bg-rose-500/15 text-rose-300',
};

export const InsuranceClaims: React.FC = () => {
  const [claims, setClaims] = useState<InsuranceClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // Gateway wraps list responses as { success, data: [...] }
    adminApi
      .get<{ data: InsuranceClaim[] }>('/api/v1/admin/insurance/claims')
      .then((d) => {
        if (!alive) return;
        setClaims(Array.isArray(d) ? (d as unknown as InsuranceClaim[]) : d.data ?? []);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Failed to load claims');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function updateStatus(claim: InsuranceClaim, status: ClaimAction) {
    setBusyId(claim.id);
    try {
      // Real backend route: PATCH /api/v1/admin/insurance/claims/{claimId}/status
      await adminApi.patch(`/api/v1/admin/insurance/claims/${claim.id}/status`, { status });
      setClaims((prev) =>
        prev.map((c) => (c.id === claim.id ? { ...c, status } : c)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update claim');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-content-tertiary animate-pulse">Loading insurance claims…</div>;
  }

  if (error) {
    return <div className="p-6 text-sm text-rose-400">Error: {error}</div>;
  }

  if (claims.length === 0) {
    return <div className="p-6 text-sm text-content-tertiary">No insurance claims found.</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-content-primary mb-4">Insurance Claims</h1>
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead className="text-left text-content-tertiary border-b border-white/10">
            <tr>
              <th className="px-4 py-3 font-medium">Claim ID</th>
              <th className="px-4 py-3 font-medium">Rider</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((c) => (
              <React.Fragment key={c.id}>
                <tr className="border-b border-white/5 text-content-secondary">
                  <td className="px-4 py-3 font-mono text-xs">{c.id.slice(0, 8)}</td>
                  <td className="px-4 py-3">{c.rider_name || c.rider_id}</td>
                  <td className="px-4 py-3">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">{c.claim_type}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs ${STATUS_STYLES[c.status] ?? 'bg-white/10 text-content-tertiary'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{c.amount_paise != null ? formatPaiseCompact(c.amount_paise) : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        disabled={busyId === c.id || c.status === 'APPROVED'}
                        onClick={() => updateStatus(c, 'APPROVED')}
                        className="rounded bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300 disabled:opacity-40"
                      >
                        Approve
                      </button>
                      <button
                        disabled={busyId === c.id || c.status === 'REJECTED'}
                        onClick={() => updateStatus(c, 'REJECTED')}
                        className="rounded bg-rose-500/15 px-2 py-1 text-xs text-rose-300 disabled:opacity-40"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                        className="rounded bg-white/10 px-2 py-1 text-xs text-content-secondary"
                      >
                        {expanded === c.id ? 'Hide' : 'View'}
                      </button>
                    </div>
                  </td>
                </tr>
                {expanded === c.id && (
                  <tr className="border-b border-white/5 bg-white/[0.02]">
                    <td colSpan={7} className="px-4 py-3 text-xs text-content-tertiary">
                      <div>Order: <span className="font-mono">{c.order_id}</span></div>
                      <div className="mt-1">{c.description || 'No description provided.'}</div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
