import React, { useEffect, useState, useCallback } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';
import { getAdminRole } from '../auth';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';

interface PromoCode {
  id: string;
  code: string;
  description: string;
  discount_type: 'FLAT' | 'PERCENT';
  discount_value: number;
  max_discount_paise: number;
  min_fare_paise: number;
  max_redemptions: number | null;
  per_rider_limit: number;
  total_redeemed: number;
  city_prefix: string;
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;
  total_savings_paise: number;
  [key: string]: unknown;
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

function randomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// Column definitions for the DataTable. Built as a factory so the actions column
// can close over the role-gated toggle handler.
const PROMO_COLUMNS = (
  canCreate: boolean,
  toggleActive: (p: PromoCode) => void,
): ColumnDef<PromoCode>[] => [
  {
    key: 'code', header: 'Code',
    render: (v) => <span className="font-mono text-mono-small font-semibold text-content-primary">{String(v)}</span>,
  },
  {
    key: 'discount_type', header: 'Type',
    render: (v) => <span className="text-paragraph-small text-content-secondary">{String(v)}</span>,
  },
  {
    key: 'discount_value', header: 'Discount',
    // FLAT discount_value is stored in paise; PERCENT is a raw percent.
    render: (_v, r) => (
      <span className="font-mono text-mono-small text-content-primary tabular-nums">
        {r.discount_type === 'FLAT' ? rupees(r.discount_value) : `${r.discount_value}%`}
      </span>
    ),
  },
  {
    key: 'total_redeemed', header: 'Uses', type: 'numeric',
    render: (_v, r) => (
      <span className="font-mono text-mono-small text-content-primary tabular-nums">
        {r.total_redeemed}{r.max_redemptions ? ` / ${r.max_redemptions}` : ''}
      </span>
    ),
  },
  {
    key: 'valid_until', header: 'Valid Until',
    render: (v) => v
      ? <span className="text-paragraph-small text-content-secondary">{new Date(String(v)).toLocaleDateString()}</span>
      : <span className="text-content-tertiary">No expiry</span>,
  },
  {
    key: 'is_active', header: 'Status', type: 'status',
    render: (_v, r) => (
      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-pill ${r.is_active ? 'text-status-online bg-status-online/10' : 'text-content-tertiary bg-background-secondary'}`}>
        {r.is_active ? 'Active' : 'Inactive'}
      </span>
    ),
  },
  {
    key: 'actions', header: 'Actions', type: 'actions',
    render: (_v, r) => canCreate ? (
      <button
        onClick={(e) => { e.stopPropagation(); toggleActive(r); }}
        className="text-[11px] font-semibold text-content-primary underline"
      >
        {r.is_active ? 'Deactivate' : 'Activate'}
      </button>
    ) : null,
  },
];

export const PromoCodesManager: React.FC = () => {
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const role = getAdminRole();
  const canCreate = role === 'SUPER_ADMIN' || role === 'MARKETING';

  const fetchPromos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/promo-codes`, {
        headers: { 'X-Admin-Role': role },
      });
      if (res.ok) {
        const data = await res.json();
        setPromos((data as PromoCode[]) || []);
      }
    } catch (err) {
      console.error('Failed to fetch promo codes', err);
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    fetchPromos();
  }, [fetchPromos]);

  const toggleActive = async (p: PromoCode) => {
    await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/promo-codes/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Role': role },
      body: JSON.stringify({ is_active: !p.is_active }),
    });
    fetchPromos();
  };

  const totalSavings = promos.reduce((sum, p) => sum + p.total_savings_paise, 0);
  const activeCount = promos.filter((p) => p.is_active).length;
  const mostUsed = promos.reduce<PromoCode | null>((best, p) => (!best || p.total_redeemed > best.total_redeemed ? p : best), null);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-content-primary">Promo Codes</h1>
          <p className="text-xs text-content-tertiary mt-0.5">Create and manage discount codes</p>
        </div>
        {canCreate && (
          <button onClick={() => setShowModal(true)} className="h-9 px-4 rounded-pill bg-content-primary text-background-primary text-xs font-semibold">
            + New Promo
          </button>
        )}
      </div>

      {/* Analytics cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard label="Total savings given" value={rupees(totalSavings)} />
        <StatCard label="Most used code" value={mostUsed ? `${mostUsed.code} (${mostUsed.total_redeemed})` : '—'} />
        <StatCard label="Active promos" value={String(activeCount)} />
      </div>

      {/* Table */}
      <DataTable<PromoCode>
        columns={PROMO_COLUMNS(canCreate, toggleActive)}
        data={promos}
        loading={loading}
        emptyState={
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-heading-medium text-content-secondary">No promo codes yet</span>
            <span className="text-paragraph-small text-content-tertiary">Create your first code to get started.</span>
          </div>
        }
      />

      {showModal && (
        <CreatePromoModal
          onClose={() => setShowModal(false)}
          onCreated={() => {
            setShowModal(false);
            fetchPromos();
          }}
        />
      )}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-background-primary border border-background-secondary rounded-xl p-4">
    <div className="text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">{label}</div>
    <div className="text-xl font-bold text-content-primary mt-1">{value}</div>
  </div>
);

const CreatePromoModal: React.FC<{ onClose: () => void; onCreated: () => void }> = ({ onClose, onCreated }) => {
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'FLAT' | 'PERCENT'>('FLAT');
  const [amount, setAmount] = useState('');
  const [cap, setCap] = useState('');
  const [minFare, setMinFare] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [maxTotal, setMaxTotal] = useState('');
  const [perRider, setPerRider] = useState('1');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!code.trim() || !amount) {
      setError('Code and amount are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        code: code.trim().toUpperCase(),
        discount_type: discountType,
        // FLAT amount is entered in rupees, stored as paise; PERCENT is a raw percent.
        discount_value: discountType === 'FLAT' ? Math.round(parseFloat(amount) * 100) : parseInt(amount, 10),
        max_discount_paise: cap ? Math.round(parseFloat(cap) * 100) : 0,
        min_fare_paise: minFare ? Math.round(parseFloat(minFare) * 100) : 0,
        max_redemptions: maxTotal ? parseInt(maxTotal, 10) : null,
        per_rider_limit: perRider ? parseInt(perRider, 10) : 1,
        valid_until: validUntil ? new Date(validUntil).toISOString() : null,
        is_active: isActive,
      };
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/promo-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Role': getAdminRole() },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onCreated();
      } else {
        const txt = await res.text();
        setError(txt || 'Failed to create promo');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const input = 'h-9 w-full rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-background-primary rounded-xl shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-content-primary">Create Promo Code</h2>

        <div>
          <Label>Code</Label>
          <div className="flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="WELCOME50" className={input} />
            <button onClick={() => setCode(randomCode())} className="h-9 px-3 rounded-pill border border-content-primary text-content-primary text-[11px] font-semibold whitespace-nowrap">
              Generate
            </button>
          </div>
        </div>

        <div>
          <Label>Discount type</Label>
          <div className="flex gap-2">
            {(['FLAT', 'PERCENT'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setDiscountType(t)}
                className={`flex-1 h-9 rounded-pill text-xs font-semibold ${discountType === t ? 'bg-content-primary text-background-primary' : 'bg-background-secondary text-content-tertiary'}`}
              >
                {t === 'FLAT' ? 'Flat (₹)' : 'Percentage (%)'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{discountType === 'FLAT' ? 'Amount (₹)' : 'Percent (%)'}</Label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" className={input} />
          </div>
          <div>
            <Label>Max discount cap (₹)</Label>
            <input value={cap} onChange={(e) => setCap(e.target.value)} type="number" placeholder="0 = none" className={input} />
          </div>
          <div>
            <Label>Min fare (₹)</Label>
            <input value={minFare} onChange={(e) => setMinFare(e.target.value)} type="number" className={input} />
          </div>
          <div>
            <Label>Valid until</Label>
            <input value={validUntil} onChange={(e) => setValidUntil(e.target.value)} type="date" className={input} />
          </div>
          <div>
            <Label>Max uses (total)</Label>
            <input value={maxTotal} onChange={(e) => setMaxTotal(e.target.value)} type="number" placeholder="Unlimited" className={input} />
          </div>
          <div>
            <Label>Max uses per rider</Label>
            <input value={perRider} onChange={(e) => setPerRider(e.target.value)} type="number" className={input} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-content-primary">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active immediately
        </label>

        {error && <p className="text-xs text-status-negative">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 h-10 rounded-pill bg-background-secondary text-content-primary text-xs font-semibold">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex-1 h-10 rounded-pill bg-content-primary text-background-primary text-xs font-semibold disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Promo'}
          </button>
        </div>
      </div>
    </div>
  );
};

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[10px] font-semibold uppercase tracking-wider text-content-tertiary mb-1">{children}</div>
);
