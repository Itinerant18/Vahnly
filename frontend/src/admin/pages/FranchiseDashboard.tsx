import { useEffect, useState, useCallback } from 'react';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';

const API = '/api/v1/admin';

const authHeaders = (json = false): Record<string, string> => {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  return h;
};

interface Tenant {
  id: string;
  name: string;
  slug: string;
  contact_email: string;
  contact_phone: string;
  allowed_cities: string[];
  revenue_share_pct: number;
  status: string;
  active_drivers: number;
  active_riders: number;
  created_at: string;
}

interface TenantOperator {
  id: string;
  tenant_id: string;
  tenant_name: string;
  admin_email: string;
  role: string;
  is_active: boolean;
  created_at: string;
  [key: string]: unknown;
}

const TENANT_STATUS_CLS: Record<string, string> = {
  ACTIVE: 'bg-surface-positive text-content-positive',
  SUSPENDED: 'bg-surface-negative text-content-negative',
  PENDING: 'bg-surface-warning text-content-warning',
};

const OPERATOR_COLUMNS: ColumnDef<TenantOperator>[] = [
  {
    key: 'tenant_name', header: 'Tenant',
    render: (v) => <span className="font-medium text-content-primary">{String(v)}</span>,
  },
  { key: 'admin_email', header: 'Email' },
  {
    key: 'role', header: 'Role',
    render: (v) => <span className="text-xs text-content-primary">{String(v)}</span>,
  },
  {
    key: 'is_active', header: 'Status', type: 'status',
    render: (v) => (
      <span className={`text-xs px-2 py-0.5 rounded ${v ? 'bg-surface-positive text-content-positive' : 'bg-background-secondary text-content-secondary'}`}>
        {v ? 'Active' : 'Inactive'}
      </span>
    ),
  },
  { key: 'created_at', header: 'Created', type: 'date' },
];

export function FranchiseDashboard() {
  const [tab, setTab] = useState<'tenants' | 'operators'>('tenants');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [operators, setOperators] = useState<TenantOperator[]>([]);
  const [filterTenant, setFilterTenant] = useState('');
  const [showAddOp, setShowAddOp] = useState(false);
  const [newOp, setNewOp] = useState({ tenant_id: '', admin_email: '', role: 'OPERATOR_ADMIN' });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadTenants = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const r = await fetch(`${API}/franchise/tenants`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setTenants(d.tenants ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOperators = useCallback(async () => {
    const qs = filterTenant ? `?tenant_id=${filterTenant}` : '';
    try {
      const r = await fetch(`${API}/franchise/operators${qs}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setOperators(d.operators ?? []);
    } catch {
      setError(true);
    }
  }, [filterTenant]);

  useEffect(() => { loadTenants(); loadOperators(); }, [loadTenants, loadOperators]);

  const updateTenantStatus = async (id: string, tenant: Tenant, newStatus: string) => {
    await fetch(`${API}/franchise/tenants/${id}`, {
      method: 'PATCH', headers: authHeaders(true),
      body: JSON.stringify({ ...tenant, status: newStatus }),
    });
    loadTenants();
  };

  const addOperator = async () => {
    await fetch(`${API}/franchise/operators`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify(newOp),
    });
    setShowAddOp(false);
    setNewOp({ tenant_id: '', admin_email: '', role: 'OPERATOR_ADMIN' });
    loadOperators();
  };

  const TABS = [
    { key: 'tenants', label: 'Tenants / Sub-operators' },
    { key: 'operators', label: 'Operator Users' },
  ] as const;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-content-primary">Multi-tenant / Franchise</h1>

      {loading && <p className="text-xs text-content-tertiary animate-pulse">Loading…</p>}
      {error && (
        <div className="bg-surface-negative border-l-4 border-l-negative-400 rounded-sm px-4 py-3 flex items-center gap-2">
          <p className="text-sm text-content-negative">Some data failed to load.</p>
          <button type="button" onClick={() => { loadTenants(); loadOperators(); }} className="ml-auto rounded-sm border border-negative-400 px-3 py-1 text-xs text-content-negative hover:bg-background-secondary transition-colors">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface-accent rounded-lg p-4">
          <p className="text-2xl font-bold text-content-accent">{tenants.length}</p>
          <p className="text-sm text-content-accent">Total Tenants</p>
        </div>
        <div className="bg-surface-positive rounded-lg p-4">
          <p className="text-2xl font-bold text-content-positive">{tenants.filter(t => t.status === 'ACTIVE').length}</p>
          <p className="text-sm text-content-positive">Active</p>
        </div>
        <div className="bg-surface-accent rounded-lg p-4">
          <p className="text-2xl font-bold text-content-accent">{tenants.reduce((s, t) => s + t.active_drivers, 0).toLocaleString()}</p>
          <p className="text-sm text-content-accent">Total Active Drivers</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-border-opaque">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px ${tab === t.key ? 'border-b-2 border-border-accent text-content-accent' : 'text-content-secondary hover:text-content-primary'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'tenants' && (
        <div className="space-y-3">
          {tenants.map(t => (
            <div key={t.id} className="p-5 bg-white border border-border-opaque rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${TENANT_STATUS_CLS[t.status] ?? 'bg-background-secondary'}`}>{t.status}</span>
                    <h3 className="font-semibold text-content-primary">{t.name}</h3>
                    <span className="text-xs text-content-tertiary font-mono">@{t.slug}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div><p className="text-content-secondary text-xs">Contact</p><p className="font-medium">{t.contact_email}</p></div>
                    <div><p className="text-content-secondary text-xs">Cities</p><p className="font-medium">{t.allowed_cities.join(', ')}</p></div>
                    <div><p className="text-content-secondary text-xs">Revenue Share</p><p className="font-medium">{t.revenue_share_pct}%</p></div>
                    <div><p className="text-content-secondary text-xs">Drivers / Riders</p><p className="font-medium">{t.active_drivers} / {t.active_riders}</p></div>
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  {t.status === 'ACTIVE' && (
                    <button onClick={() => updateTenantStatus(t.id, t, 'SUSPENDED')} className="text-xs text-content-negative border border-negative-400 px-2 py-1 rounded hover:bg-surface-negative">Suspend</button>
                  )}
                  {t.status === 'SUSPENDED' && (
                    <button onClick={() => updateTenantStatus(t.id, t, 'ACTIVE')} className="text-xs text-content-positive border border-positive-400 px-2 py-1 rounded hover:bg-surface-positive">Reactivate</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'operators' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <select value={filterTenant} onChange={e => setFilterTenant(e.target.value)} className="border rounded px-3 py-1.5 text-sm">
              <option value="">All Tenants</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button onClick={() => setShowAddOp(true)} className="px-4 py-1.5 bg-accent-400 text-white text-sm rounded hover:bg-accent-400">+ Add Operator</button>
          </div>

          {showAddOp && (
            <div className="p-4 bg-surface-accent border border-border-accent rounded-lg space-y-3">
              <p className="font-medium text-content-accent">New Operator User</p>
              <div className="grid grid-cols-3 gap-3">
                <select value={newOp.tenant_id} onChange={e => setNewOp(p => ({ ...p, tenant_id: e.target.value }))} className="border rounded px-3 py-1.5 text-sm">
                  <option value="">Select Tenant</option>
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <input value={newOp.admin_email} onChange={e => setNewOp(p => ({ ...p, admin_email: e.target.value }))} placeholder="admin@example.com" className="border rounded px-3 py-1.5 text-sm" />
                <select value={newOp.role} onChange={e => setNewOp(p => ({ ...p, role: e.target.value }))} className="border rounded px-3 py-1.5 text-sm">
                  <option value="OPERATOR_ADMIN">Operator Admin</option>
                  <option value="OPERATOR_VIEWER">Operator Viewer</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={addOperator} className="px-4 py-1.5 bg-accent-400 text-white text-sm rounded hover:bg-accent-400">Save</button>
                <button onClick={() => setShowAddOp(false)} className="px-4 py-1.5 bg-white text-content-secondary text-sm border rounded hover:bg-background-secondary">Cancel</button>
              </div>
            </div>
          )}

          <DataTable<TenantOperator>
            columns={OPERATOR_COLUMNS}
            data={operators}
            rowKey={(r) => r.id}
          />
        </div>
      )}
    </div>
  );
}
