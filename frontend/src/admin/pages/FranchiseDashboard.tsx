import { useEffect, useState, useCallback } from 'react';

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
}

const TENANT_STATUS_CLS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  SUSPENDED: 'bg-red-100 text-red-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
};

export function FranchiseDashboard() {
  const [tab, setTab] = useState<'tenants' | 'operators'>('tenants');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [operators, setOperators] = useState<TenantOperator[]>([]);
  const [filterTenant, setFilterTenant] = useState('');
  const [showAddOp, setShowAddOp] = useState(false);
  const [newOp, setNewOp] = useState({ tenant_id: '', admin_email: '', role: 'OPERATOR_ADMIN' });

  const loadTenants = useCallback(async () => {
    const r = await fetch(`${API}/franchise/tenants`, { headers: authHeaders() });
    const d = await r.json();
    setTenants(d.tenants ?? []);
  }, []);

  const loadOperators = useCallback(async () => {
    const qs = filterTenant ? `?tenant_id=${filterTenant}` : '';
    const r = await fetch(`${API}/franchise/operators${qs}`, { headers: authHeaders() });
    const d = await r.json();
    setOperators(d.operators ?? []);
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
      <h1 className="text-2xl font-bold text-gray-900">Multi-tenant / Franchise</h1>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-blue-50 rounded-lg p-4">
          <p className="text-2xl font-bold text-blue-700">{tenants.length}</p>
          <p className="text-sm text-blue-600">Total Tenants</p>
        </div>
        <div className="bg-green-50 rounded-lg p-4">
          <p className="text-2xl font-bold text-green-700">{tenants.filter(t => t.status === 'ACTIVE').length}</p>
          <p className="text-sm text-green-600">Active</p>
        </div>
        <div className="bg-purple-50 rounded-lg p-4">
          <p className="text-2xl font-bold text-purple-700">{tenants.reduce((s, t) => s + t.active_drivers, 0).toLocaleString()}</p>
          <p className="text-sm text-purple-600">Total Active Drivers</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px ${tab === t.key ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'tenants' && (
        <div className="space-y-3">
          {tenants.map(t => (
            <div key={t.id} className="p-5 bg-white border border-gray-200 rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${TENANT_STATUS_CLS[t.status] ?? 'bg-gray-100'}`}>{t.status}</span>
                    <h3 className="font-semibold text-gray-900">{t.name}</h3>
                    <span className="text-xs text-gray-400 font-mono">@{t.slug}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div><p className="text-gray-500 text-xs">Contact</p><p className="font-medium">{t.contact_email}</p></div>
                    <div><p className="text-gray-500 text-xs">Cities</p><p className="font-medium">{t.allowed_cities.join(', ')}</p></div>
                    <div><p className="text-gray-500 text-xs">Revenue Share</p><p className="font-medium">{t.revenue_share_pct}%</p></div>
                    <div><p className="text-gray-500 text-xs">Drivers / Riders</p><p className="font-medium">{t.active_drivers} / {t.active_riders}</p></div>
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  {t.status === 'ACTIVE' && (
                    <button onClick={() => updateTenantStatus(t.id, t, 'SUSPENDED')} className="text-xs text-red-600 border border-red-200 px-2 py-1 rounded hover:bg-red-50">Suspend</button>
                  )}
                  {t.status === 'SUSPENDED' && (
                    <button onClick={() => updateTenantStatus(t.id, t, 'ACTIVE')} className="text-xs text-green-600 border border-green-200 px-2 py-1 rounded hover:bg-green-50">Reactivate</button>
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
            <button onClick={() => setShowAddOp(true)} className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">+ Add Operator</button>
          </div>

          {showAddOp && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
              <p className="font-medium text-blue-800">New Operator User</p>
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
                <button onClick={addOperator} className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">Save</button>
                <button onClick={() => setShowAddOp(false)} className="px-4 py-1.5 bg-white text-gray-600 text-sm border rounded hover:bg-gray-50">Cancel</button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>{['Tenant', 'Email', 'Role', 'Status', 'Created'].map(h => <th key={h} className="text-left p-3 font-medium text-gray-600">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {operators.map(op => (
                  <tr key={op.id} className="hover:bg-gray-50">
                    <td className="p-3 font-medium">{op.tenant_name}</td>
                    <td className="p-3">{op.admin_email}</td>
                    <td className="p-3 text-xs">{op.role}</td>
                    <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded ${op.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{op.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td className="p-3 text-xs text-gray-500">{new Date(op.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
