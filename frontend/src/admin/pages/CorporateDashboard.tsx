import React, { useState, useEffect, useCallback } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';
import { SvgAreaChart } from '../components/SvgAreaChart';

// ── Types ─────────────────────────────────────────────────────────────────────
interface CorporateAccount {
  id: string; company_name: string; gstin: string; billing_email: string;
  city_prefix: string; plan_type: string; is_active: boolean;
  credit_limit_paise: number; current_balance_paise: number;
  contract_start_date: string | null; contract_end_date: string | null;
  primary_contact_name: string; primary_contact_phone: string;
  sso_provider: string; employee_count: number; created_at: string;
}
interface Employee {
  id: string; corporate_id: string; name: string; email: string;
  phone: string; employee_id: string; department: string; cost_center: string;
  role: string; is_active: boolean; monthly_limit_paise: number; created_at: string;
}
interface TripPolicy {
  id: number; corporate_id: string; policy_name: string; max_fare_paise: number;
  allowed_trip_types: string[]; allowed_car_types: string[];
  requires_approval: boolean; approval_threshold_paise: number;
  allowed_hours_start: number; allowed_hours_end: number;
  allowed_days: string[]; cost_center_required: boolean; is_default: boolean;
}
interface Invoice {
  id: string; invoice_number: string; period_start: string; period_end: string;
  total_trips: number; subtotal_paise: number; gst_paise: number;
  total_paise: number; status: string; due_date: string | null; paid_at: string | null;
}
interface Analytics {
  total_trips: number; total_revenue_paise: number; total_employees: number;
  daily_trips: { day: string; trips: number; revenue_paise: number }[];
  by_department: { department: string; trips: number; revenue_paise: number }[];
}

type Tab = 'accounts' | 'employees' | 'policies' | 'invoices' | 'analytics';

const PLAN_COLORS: Record<string, string> = { STANDARD: 'bg-background-secondary text-content-secondary', PREMIUM: 'bg-surface-accent text-content-accent', ENTERPRISE: 'bg-surface-accent text-content-accent' };
const INV_STATUS: Record<string, string> = { DRAFT: 'bg-background-secondary text-content-secondary', SENT: 'bg-surface-accent text-content-accent', PAID: 'bg-surface-positive text-content-positive', OVERDUE: 'bg-surface-negative text-content-negative', CANCELLED: 'bg-background-secondary text-content-tertiary' };
const ROLE_COLORS: Record<string, string> = { ADMIN: 'bg-surface-accent text-content-accent', MANAGER: 'bg-surface-accent text-content-accent', EMPLOYEE: 'bg-background-secondary text-content-secondary' };
function rupees(p: number) { return `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`; }

// ── Main Component ─────────────────────────────────────────────────────────────
export const CorporateDashboard: React.FC = () => {
  const [tab, setTab] = useState<Tab>('accounts');
  const [selectedAccount, setSelectedAccount] = useState<CorporateAccount | null>(null);
  const role = localStorage.getItem('admin_role') || 'SUPER_ADMIN';
  const email = localStorage.getItem('admin_email') || '';
  const isSuperAdmin = ['SUPER_ADMIN', 'OPERATIONS_MANAGER'].includes(role);
  const headers = { 'X-Admin-Role': role, 'X-Admin-Email': email, 'Content-Type': 'application/json' };
  const base = `${API_GATEWAY_BASE_URL}/api/v1/admin/corporate`;

  const TABS: { key: Tab; label: string }[] = [
    { key: 'accounts',  label: 'Accounts' },
    { key: 'employees', label: 'Employees' },
    { key: 'policies',  label: 'Trip Policies' },
    { key: 'invoices',  label: 'Invoices' },
    { key: 'analytics', label: 'Analytics' },
  ];

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-content-primary">Corporate / B2B</h1>
        <p className="text-sm text-content-tertiary">Manage corporate accounts, employees, policies, and billing</p>
      </div>
      <div className="flex gap-1 border-b border-background-secondary">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? 'border-accent text-accent' : 'border-transparent text-content-secondary hover:text-content-primary'
            }`}>{t.label}</button>
        ))}
      </div>
      {tab === 'accounts'  && <AccountsTab  base={base} headers={headers} isSuperAdmin={isSuperAdmin} selectedAccount={selectedAccount} onSelect={setSelectedAccount} />}
      {tab === 'employees' && <EmployeesTab base={base} headers={headers} isSuperAdmin={isSuperAdmin} selectedAccount={selectedAccount} />}
      {tab === 'policies'  && <PoliciesTab  base={base} headers={headers} isSuperAdmin={isSuperAdmin} selectedAccount={selectedAccount} />}
      {tab === 'invoices'  && <InvoicesTab  base={base} headers={headers} isSuperAdmin={isSuperAdmin} selectedAccount={selectedAccount} />}
      {tab === 'analytics' && <AnalyticsTab base={base} headers={headers} selectedAccount={selectedAccount} />}
    </div>
  );
};

// ── Accounts Tab ──────────────────────────────────────────────────────────────
const AccountsTab: React.FC<{
  base: string; headers: Record<string, string>; isSuperAdmin: boolean;
  selectedAccount: CorporateAccount | null; onSelect: (a: CorporateAccount) => void;
}> = ({ base, headers, isSuperAdmin, selectedAccount, onSelect }) => {
  const [accounts, setAccounts] = useState<CorporateAccount[]>([]);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newAcc, setNewAcc] = useState<Partial<CorporateAccount>>({ plan_type: 'STANDARD', city_prefix: 'KOL', credit_limit_paise: 0 });

  const fetch_ = useCallback(async () => {
    const p = search ? `?search=${encodeURIComponent(search)}` : '';
    const res = await fetch(`${base}${p}`, { headers });
    if (res.ok) { const d = await res.json(); setAccounts(d.accounts || []); }
  }, [search]);

  const createAcc = async () => {
    const res = await fetch(base, { method: 'POST', headers, body: JSON.stringify(newAcc) });
    if (res.ok) { setShowCreate(false); fetch_(); }
  };

  useEffect(() => { fetch_(); }, [fetch_]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="space-y-3">
        <div className="flex gap-2">
          <input type="text" placeholder="Search company…" value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" />
          {isSuperAdmin && <button onClick={() => setShowCreate(!showCreate)} className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium">+ Add</button>}
        </div>

        {showCreate && (
          <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
            <div className="text-sm font-semibold text-content-primary">New Corporate Account</div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Company Name', k: 'company_name', span: 2 },
                { label: 'GSTIN', k: 'gstin' }, { label: 'Billing Email', k: 'billing_email' },
                { label: 'Contact Name', k: 'primary_contact_name' }, { label: 'Contact Phone', k: 'primary_contact_phone' },
              ].map(f => (
                <div key={f.k} className={f.span === 2 ? 'col-span-2' : ''}>
                  <label className="text-xs text-content-tertiary">{f.label}</label>
                  <input value={String((newAcc as any)[f.k] ?? '')} onChange={e => setNewAcc({ ...newAcc, [f.k]: e.target.value })}
                    className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" />
                </div>
              ))}
              <div>
                <label className="text-xs text-content-tertiary">Plan</label>
                <select value={newAcc.plan_type || 'STANDARD'} onChange={e => setNewAcc({ ...newAcc, plan_type: e.target.value })}
                  className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
                  {['STANDARD','PREMIUM','ENTERPRISE'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-content-tertiary">Credit Limit (₹)</label>
                <input type="number" value={(newAcc.credit_limit_paise ?? 0) / 100} onChange={e => setNewAcc({ ...newAcc, credit_limit_paise: Number(e.target.value) * 100 })}
                  className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={createAcc} className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Create</button>
              <button onClick={() => setShowCreate(false)} className="px-4 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">Cancel</button>
            </div>
          </div>
        )}

        <div className="divide-y divide-background-secondary/50 bg-background-primary rounded-xl border border-background-secondary overflow-hidden">
          {accounts.map(acc => (
            <button key={acc.id} onClick={() => onSelect(acc)}
              className={`w-full text-left px-4 py-3 hover:bg-background-secondary/30 transition-colors ${selectedAccount?.id === acc.id ? 'bg-accent/5 border-l-2 border-accent' : ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-content-primary">{acc.company_name}</div>
                  <div className="text-xs text-content-tertiary">{acc.billing_email} · {acc.city_prefix}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${PLAN_COLORS[acc.plan_type] ?? 'bg-background-secondary text-content-secondary'}`}>{acc.plan_type}</span>
                  <span className="text-[10px] text-content-tertiary">{acc.employee_count} employees</span>
                </div>
              </div>
            </button>
          ))}
          {accounts.length === 0 && <div className="p-6 text-center text-sm text-content-tertiary">No corporate accounts found.</div>}
        </div>
      </div>

      <div className="bg-background-primary rounded-xl border border-background-secondary p-5">
        {!selectedAccount ? (
          <div className="flex flex-col items-center justify-center h-40 text-content-tertiary text-sm">
            <span className="text-4xl mb-2">🏢</span>Select an account to see details
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-content-primary">{selectedAccount.company_name}</div>
                <div className="text-xs text-content-tertiary">{selectedAccount.gstin || 'No GSTIN'} · {selectedAccount.city_prefix}</div>
              </div>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${PLAN_COLORS[selectedAccount.plan_type]}`}>{selectedAccount.plan_type}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['Billing Email', selectedAccount.billing_email],
                ['Contact', `${selectedAccount.primary_contact_name} ${selectedAccount.primary_contact_phone}`],
                ['Credit Limit', rupees(selectedAccount.credit_limit_paise)],
                ['Balance', rupees(selectedAccount.current_balance_paise)],
                ['Contract Start', selectedAccount.contract_start_date ?? '—'],
                ['Contract End', selectedAccount.contract_end_date ?? '—'],
                ['SSO', selectedAccount.sso_provider || 'None'],
                ['Employees', selectedAccount.employee_count.toString()],
              ].map(([k, v]) => (
                <div key={k} className="bg-background-secondary/50 rounded-lg p-3">
                  <div className="text-xs text-content-tertiary">{k}</div>
                  <div className="text-xs font-medium text-content-primary mt-0.5 truncate">{v}</div>
                </div>
              ))}
            </div>
            <div className={`px-3 py-2 rounded-lg text-xs font-medium ${selectedAccount.is_active ? 'bg-surface-positive text-content-positive' : 'bg-surface-negative text-content-negative'}`}>
              Account is {selectedAccount.is_active ? 'Active' : 'Inactive'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Employees Tab ─────────────────────────────────────────────────────────────
const EmployeesTab: React.FC<{ base: string; headers: Record<string, string>; isSuperAdmin: boolean; selectedAccount: CorporateAccount | null }> = ({ base, headers, isSuperAdmin, selectedAccount }) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newEmp, setNewEmp] = useState<Partial<Employee>>({ role: 'EMPLOYEE', monthly_limit_paise: 0 });
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [bulkResult, setBulkResult] = useState<any>(null);

  const fetch_ = useCallback(async () => {
    if (!selectedAccount) { setEmployees([]); return; }
    const p = new URLSearchParams({ limit: '100' });
    if (search) p.set('search', search);
    const res = await fetch(`${base}/${selectedAccount.id}/employees?${p}`, { headers });
    if (res.ok) { const d = await res.json(); setEmployees(d.employees || []); setTotal(d.total || 0); }
  }, [selectedAccount, search]);

  const addEmployee = async () => {
    if (!selectedAccount) return;
    const res = await fetch(`${base}/${selectedAccount.id}/employees`, { method: 'POST', headers, body: JSON.stringify(newEmp) });
    if (res.ok) { setShowAdd(false); fetch_(); }
  };

  const bulkUpload = async () => {
    if (!selectedAccount || !csvFile) return;
    const text = await csvFile.text();
    const res = await fetch(`${base}/${selectedAccount.id}/employees/bulk`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'text/plain' },
      body: text,
    });
    if (res.ok) { const d = await res.json(); setBulkResult(d); fetch_(); }
  };

  useEffect(() => { fetch_(); }, [fetch_]);

  if (!selectedAccount) return <div className="text-sm text-content-tertiary py-8 text-center">Select an account from the Accounts tab first.</div>;

  const depts = [...new Set(employees.map(e => e.department).filter(Boolean))];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-medium text-content-primary">{selectedAccount.company_name} — {total} employees</div>
        <div className="flex gap-2">
          <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
            className="border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary w-40 focus:outline-none" />
          {isSuperAdmin && <>
            <button onClick={() => setShowAdd(!showAdd)} className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">+ Add</button>
            <label className="px-3 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary cursor-pointer">
              ↑ CSV Bulk
              <input type="file" accept=".csv" className="hidden" onChange={e => setCsvFile(e.target.files?.[0] ?? null)} />
            </label>
            {csvFile && <button onClick={bulkUpload} className="px-3 py-1.5 bg-positive-400 text-white rounded-lg text-sm font-medium">Upload: {csvFile.name}</button>}
          </>}
        </div>
      </div>

      {bulkResult && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-3 text-sm">
          Bulk upload: <span className="text-content-positive">{bulkResult.inserted} inserted</span> · <span className="text-content-tertiary">{bulkResult.skipped} skipped</span>
          {bulkResult.errors?.length > 0 && <div className="text-xs text-content-negative mt-1">{bulkResult.errors.join(', ')}</div>}
        </div>
      )}

      {showAdd && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
          <div className="text-sm font-semibold text-content-primary">Add Employee</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[{ label: 'Name', k: 'name' }, { label: 'Email', k: 'email' }, { label: 'Phone', k: 'phone' }, { label: 'Employee ID', k: 'employee_id' }, { label: 'Department', k: 'department' }, { label: 'Cost Center', k: 'cost_center' }].map(f => (
              <div key={f.k}>
                <label className="text-xs text-content-tertiary">{f.label}</label>
                <input value={String((newEmp as any)[f.k] ?? '')} onChange={e => setNewEmp({ ...newEmp, [f.k]: e.target.value })}
                  className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" />
              </div>
            ))}
            <div>
              <label className="text-xs text-content-tertiary">Role</label>
              <select value={newEmp.role || 'EMPLOYEE'} onChange={e => setNewEmp({ ...newEmp, role: e.target.value })}
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
                {['EMPLOYEE','MANAGER','ADMIN'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-content-tertiary">Monthly Limit (₹)</label>
              <input type="number" value={(newEmp.monthly_limit_paise ?? 0) / 100} onChange={e => setNewEmp({ ...newEmp, monthly_limit_paise: Number(e.target.value) * 100 })}
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={addEmployee} className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Save</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">Cancel</button>
          </div>
        </div>
      )}

      {depts.length > 0 && (
        <div className="flex gap-1 flex-wrap text-xs">
          <span className="text-content-tertiary">Departments:</span>
          {depts.map(d => <span key={d} className="border border-background-secondary rounded px-1.5 py-0.5 text-content-secondary">{d}</span>)}
        </div>
      )}

      <div className="bg-background-primary rounded-xl border border-background-secondary overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-background-secondary/50"><tr className="text-xs text-content-tertiary">
            <th className="text-left px-4 py-2.5">Name</th>
            <th className="text-left px-4 py-2.5">Email</th>
            <th className="text-left px-4 py-2.5">Department</th>
            <th className="text-left px-4 py-2.5">Cost Center</th>
            <th className="text-left px-4 py-2.5">Role</th>
            <th className="text-right px-4 py-2.5">Limit/mo</th>
            <th className="text-left px-4 py-2.5">Status</th>
          </tr></thead>
          <tbody>
            {employees.map(emp => (
              <tr key={emp.id} className="border-t border-background-secondary/50 hover:bg-background-secondary/20">
                <td className="px-4 py-2.5 text-sm font-medium text-content-primary">{emp.name}</td>
                <td className="px-4 py-2.5 text-xs text-content-tertiary">{emp.email}</td>
                <td className="px-4 py-2.5 text-xs text-content-secondary">{emp.department || '—'}</td>
                <td className="px-4 py-2.5 text-xs font-mono text-content-tertiary">{emp.cost_center || '—'}</td>
                <td className="px-4 py-2.5"><span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ROLE_COLORS[emp.role] ?? 'bg-background-secondary text-content-secondary'}`}>{emp.role}</span></td>
                <td className="px-4 py-2.5 text-xs text-right text-content-tertiary">{emp.monthly_limit_paise > 0 ? rupees(emp.monthly_limit_paise) : '—'}</td>
                <td className="px-4 py-2.5"><span className={`text-[10px] ${emp.is_active ? 'text-content-positive' : 'text-content-tertiary'}`}>{emp.is_active ? '● Active' : '● Inactive'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Policies Tab ──────────────────────────────────────────────────────────────
const PoliciesTab: React.FC<{ base: string; headers: Record<string, string>; isSuperAdmin: boolean; selectedAccount: CorporateAccount | null }> = ({ base, headers, isSuperAdmin, selectedAccount }) => {
  const [policies, setPolicies] = useState<TripPolicy[]>([]);
  const [editing, setEditing] = useState<Partial<TripPolicy> | null>(null);

  const fetch_ = useCallback(async () => {
    if (!selectedAccount) return;
    const res = await fetch(`${base}/${selectedAccount.id}/policies`, { headers });
    if (res.ok) { const d = await res.json(); setPolicies(d.policies || []); }
  }, [selectedAccount]);

  const save = async () => {
    if (!editing || !selectedAccount) return;
    const method = editing.id ? 'PATCH' : 'POST';
    const url = editing.id ? `${base}/${selectedAccount.id}/policies/${editing.id}` : `${base}/${selectedAccount.id}/policies`;
    await fetch(url, { method, headers, body: JSON.stringify(editing) });
    setEditing(null); fetch_();
  };

  useEffect(() => { fetch_(); }, [fetch_]);

  const TRIP_TYPES = ['IN_CITY', 'ROUND_TRIP', 'OUTSTATION', 'MINI_OUTSTATION'];
  const CAR_TYPES = ['HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM'];

  if (!selectedAccount) return <div className="text-sm text-content-tertiary py-8 text-center">Select an account from the Accounts tab first.</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-content-primary">{selectedAccount.company_name} — Trip Policies</div>
        {isSuperAdmin && <button onClick={() => setEditing({ max_fare_paise: 0, requires_approval: false, allowed_trip_types: ['IN_CITY'], allowed_car_types: ['SEDAN'], allowed_hours_start: 0, allowed_hours_end: 23, allowed_days: ['MON','TUE','WED','THU','FRI'], is_default: false, cost_center_required: false })} className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">+ Policy</button>}
      </div>

      {editing && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
          <div className="text-sm font-semibold text-content-primary">Trip Policy</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="col-span-2 md:col-span-3"><label className="text-xs text-content-tertiary">Policy Name</label><input value={editing.policy_name || ''} onChange={e => setEditing({ ...editing, policy_name: e.target.value })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" /></div>
            <div><label className="text-xs text-content-tertiary">Max Fare (₹) — 0 = unlimited</label><input type="number" value={(editing.max_fare_paise ?? 0) / 100} onChange={e => setEditing({ ...editing, max_fare_paise: Number(e.target.value) * 100 })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none" /></div>
            <div><label className="text-xs text-content-tertiary">Approval Threshold (₹)</label><input type="number" value={(editing.approval_threshold_paise ?? 0) / 100} onChange={e => setEditing({ ...editing, approval_threshold_paise: Number(e.target.value) * 100 })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none" /></div>
            <div><label className="text-xs text-content-tertiary">Hours (start – end)</label><div className="flex gap-1 mt-1"><input type="number" min={0} max={23} value={editing.allowed_hours_start ?? 0} onChange={e => setEditing({ ...editing, allowed_hours_start: Number(e.target.value) })} className="w-16 border border-background-secondary rounded px-2 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none" /><span className="self-center text-content-tertiary">–</span><input type="number" min={0} max={23} value={editing.allowed_hours_end ?? 23} onChange={e => setEditing({ ...editing, allowed_hours_end: Number(e.target.value) })} className="w-16 border border-background-secondary rounded px-2 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none" /></div></div>
          </div>
          <div>
            <label className="text-xs text-content-tertiary">Allowed Trip Types</label>
            <div className="flex gap-1.5 mt-1 flex-wrap">
              {TRIP_TYPES.map(t => <button key={t} onClick={() => { const cur = editing.allowed_trip_types || []; setEditing({ ...editing, allowed_trip_types: cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t] }); }} className={`px-2.5 py-1 rounded text-xs border ${(editing.allowed_trip_types || []).includes(t) ? 'bg-accent text-white border-accent' : 'bg-background-primary border-background-secondary text-content-secondary'}`}>{t}</button>)}
            </div>
          </div>
          <div>
            <label className="text-xs text-content-tertiary">Allowed Car Types</label>
            <div className="flex gap-1.5 mt-1 flex-wrap">
              {CAR_TYPES.map(t => <button key={t} onClick={() => { const cur = editing.allowed_car_types || []; setEditing({ ...editing, allowed_car_types: cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t] }); }} className={`px-2.5 py-1 rounded text-xs border ${(editing.allowed_car_types || []).includes(t) ? 'bg-accent text-white border-accent' : 'bg-background-primary border-background-secondary text-content-secondary'}`}>{t}</button>)}
            </div>
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={editing.requires_approval ?? false} onChange={e => setEditing({ ...editing, requires_approval: e.target.checked })} /> Requires approval</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={editing.cost_center_required ?? false} onChange={e => setEditing({ ...editing, cost_center_required: e.target.checked })} /> Cost center required</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={editing.is_default ?? false} onChange={e => setEditing({ ...editing, is_default: e.target.checked })} /> Default policy</label>
          </div>
          <div className="flex gap-2">
            <button onClick={save} className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Save</button>
            <button onClick={() => setEditing(null)} className="px-4 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {policies.map(p => (
          <div key={p.id} className={`bg-background-primary rounded-xl border border-background-secondary p-4 ${p.is_default ? 'border-accent/30' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-content-primary">{p.policy_name}</span>
                  {p.is_default && <span className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded font-medium">DEFAULT</span>}
                  {p.requires_approval && <span className="text-[10px] bg-surface-warning text-content-warning px-1.5 py-0.5 rounded">APPROVAL REQ.</span>}
                </div>
                <div className="text-xs text-content-tertiary mt-1">Max fare: {p.max_fare_paise > 0 ? rupees(p.max_fare_paise) : 'No limit'} · Hours: {p.allowed_hours_start}:00–{p.allowed_hours_end}:00</div>
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {p.allowed_trip_types.map(t => <span key={t} className="text-[10px] border border-background-secondary rounded px-1.5 py-0.5 text-content-tertiary">{t}</span>)}
                  {p.allowed_car_types.map(t => <span key={t} className="text-[10px] border border-background-secondary rounded px-1.5 py-0.5 text-content-tertiary">{t}</span>)}
                </div>
              </div>
              {isSuperAdmin && <button onClick={() => setEditing(p)} className="text-xs text-accent hover:underline shrink-0">Edit</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Invoices Tab ──────────────────────────────────────────────────────────────
const InvoicesTab: React.FC<{ base: string; headers: Record<string, string>; isSuperAdmin: boolean; selectedAccount: CorporateAccount | null }> = ({ base, headers, isSuperAdmin, selectedAccount }) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [showGen, setShowGen] = useState(false);
  const [genReq, setGenReq] = useState({ period_start: '', period_end: '', notes: '' });
  const [genResult, setGenResult] = useState<any>(null);

  const fetch_ = useCallback(async () => {
    if (!selectedAccount) return;
    const res = await fetch(`${base}/${selectedAccount.id}/invoices`, { headers });
    if (res.ok) { const d = await res.json(); setInvoices(d.invoices || []); }
  }, [selectedAccount]);

  const generate = async () => {
    if (!selectedAccount) return;
    const res = await fetch(`${base}/${selectedAccount.id}/invoices/generate`, { method: 'POST', headers, body: JSON.stringify(genReq) });
    if (res.ok) { const d = await res.json(); setGenResult(d); setShowGen(false); fetch_(); }
    else setGenResult({ error: 'Generation failed — period may already have an invoice.' });
  };

  const updateStatus = async (invId: string, status: string) => {
    if (!selectedAccount) return;
    await fetch(`${base}/${selectedAccount.id}/invoices/${invId}`, { method: 'PATCH', headers, body: JSON.stringify({ status }) });
    fetch_();
  };

  useEffect(() => { fetch_(); }, [fetch_]);

  if (!selectedAccount) return <div className="text-sm text-content-tertiary py-8 text-center">Select an account from the Accounts tab first.</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-content-primary">{selectedAccount.company_name} — Invoices</div>
        {isSuperAdmin && <button onClick={() => setShowGen(!showGen)} className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Generate Invoice</button>}
      </div>

      {genResult && (
        <div className={`rounded-xl border p-4 text-sm ${genResult.error ? 'bg-surface-negative border-negative-400 text-content-negative' : 'bg-surface-positive border-positive-400 text-content-positive'}`}>
          {genResult.error ? genResult.error : `✓ Invoice ${genResult.invoice_number} created — ${genResult.total_trips} trips · ${rupees(genResult.total_paise ?? 0)}`}
        </div>
      )}

      {showGen && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
          <div className="text-sm font-semibold text-content-primary">Generate Monthly Invoice</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-content-tertiary">Period Start</label><input type="date" value={genReq.period_start} onChange={e => setGenReq({ ...genReq, period_start: e.target.value })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none" /></div>
            <div><label className="text-xs text-content-tertiary">Period End</label><input type="date" value={genReq.period_end} onChange={e => setGenReq({ ...genReq, period_end: e.target.value })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none" /></div>
            <div className="col-span-2"><label className="text-xs text-content-tertiary">Notes (optional)</label><input value={genReq.notes} onChange={e => setGenReq({ ...genReq, notes: e.target.value })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" /></div>
          </div>
          <div className="flex gap-2">
            <button onClick={generate} className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Generate</button>
            <button onClick={() => setShowGen(false)} className="px-4 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-background-primary rounded-xl border border-background-secondary overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-background-secondary/50"><tr className="text-xs text-content-tertiary">
            <th className="text-left px-4 py-2.5">Invoice</th>
            <th className="text-left px-4 py-2.5">Period</th>
            <th className="text-right px-4 py-2.5">Trips</th>
            <th className="text-right px-4 py-2.5">Subtotal</th>
            <th className="text-right px-4 py-2.5">GST</th>
            <th className="text-right px-4 py-2.5">Total</th>
            <th className="text-left px-4 py-2.5">Status</th>
            <th className="text-left px-4 py-2.5">Due</th>
            <th className="px-4 py-2.5"></th>
          </tr></thead>
          <tbody>
            {invoices.map(inv => (
              <tr key={inv.id} className="border-t border-background-secondary/50 hover:bg-background-secondary/20">
                <td className="px-4 py-2.5 text-xs font-mono font-medium text-content-primary">{inv.invoice_number}</td>
                <td className="px-4 py-2.5 text-xs text-content-tertiary">{inv.period_start} → {inv.period_end}</td>
                <td className="px-4 py-2.5 text-xs text-right text-content-secondary">{inv.total_trips}</td>
                <td className="px-4 py-2.5 text-xs text-right font-mono text-content-secondary">{rupees(inv.subtotal_paise)}</td>
                <td className="px-4 py-2.5 text-xs text-right font-mono text-content-tertiary">{rupees(inv.gst_paise)}</td>
                <td className="px-4 py-2.5 text-xs text-right font-mono font-semibold text-content-primary">{rupees(inv.total_paise)}</td>
                <td className="px-4 py-2.5"><span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${INV_STATUS[inv.status] ?? 'bg-background-secondary text-content-secondary'}`}>{inv.status}</span></td>
                <td className="px-4 py-2.5 text-xs text-content-tertiary">{inv.due_date ?? '—'}</td>
                <td className="px-4 py-2.5">
                  {isSuperAdmin && inv.status !== 'PAID' && inv.status !== 'CANCELLED' && (
                    <div className="flex gap-1">
                      {inv.status === 'DRAFT' && <button onClick={() => updateStatus(inv.id, 'SENT')} className="text-[10px] text-accent hover:underline">Send</button>}
                      {inv.status === 'SENT' && <button onClick={() => updateStatus(inv.id, 'PAID')} className="text-[10px] text-content-positive hover:underline">Mark Paid</button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {invoices.length === 0 && <tr><td colSpan={9} className="text-center py-8 text-sm text-content-tertiary">No invoices yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Analytics Tab ─────────────────────────────────────────────────────────────
const AnalyticsTab: React.FC<{ base: string; headers: Record<string, string>; selectedAccount: CorporateAccount | null }> = ({ base, headers, selectedAccount }) => {
  const [data, setData] = useState<Analytics | null>(null);
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');

  useEffect(() => {
    if (!selectedAccount) return;
    (async () => {
      const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
      const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const to = new Date().toISOString().slice(0, 10);
      const res = await fetch(`${base}/${selectedAccount.id}/analytics?from=${from}&to=${to}`, { headers });
      if (res.ok) setData(await res.json());
    })();
  }, [selectedAccount, period]);

  if (!selectedAccount) return <div className="text-sm text-content-tertiary py-8 text-center">Select an account from the Accounts tab first.</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-content-primary">{selectedAccount.company_name} — Analytics</div>
        <div className="flex gap-1">
          {(['7d','30d','90d'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1.5 rounded-lg text-sm border ${period === p ? 'bg-accent text-white border-accent' : 'bg-background-primary border-background-secondary text-content-secondary'}`}>{p}</button>
          ))}
        </div>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[['Total Trips', data.total_trips.toLocaleString()], ['Revenue', rupees(data.total_revenue_paise)], ['Active Employees', data.total_employees.toLocaleString()]].map(([l, v]) => (
              <div key={l} className="bg-background-primary border border-background-secondary rounded-xl p-4 text-center">
                <div className="text-xs text-content-tertiary">{l}</div>
                <div className="text-2xl font-bold text-content-primary mt-0.5">{v}</div>
              </div>
            ))}
          </div>

          {data.daily_trips.length >= 2 && (
            <div className="bg-background-primary rounded-xl border border-background-secondary p-5">
              <div className="text-sm font-semibold text-content-primary mb-3">Daily Trip Volume</div>
              <SvgAreaChart data={data.daily_trips.map(d => ({ label: d.day.slice(5), value: d.trips }))} height={120} strokeColor="var(--accent-400)" fillColor="var(--accent-400)" />
            </div>
          )}

          {data.by_department.length > 0 && (
            <div className="bg-background-primary rounded-xl border border-background-secondary p-5">
              <div className="text-sm font-semibold text-content-primary mb-3">Spending by Department</div>
              <div className="space-y-2">
                {data.by_department.map(d => {
                  const maxRev = Math.max(...data.by_department.map(x => x.revenue_paise), 1);
                  return (
                    <div key={d.department} className="flex items-center gap-3">
                      <div className="w-32 text-xs text-content-secondary shrink-0 truncate">{d.department || 'Unknown'}</div>
                      <div className="flex-1 h-4 bg-background-secondary rounded-sm overflow-hidden">
                        <div className="h-full bg-accent/60 rounded-sm" style={{ width: `${(d.revenue_paise / maxRev) * 100}%` }} />
                      </div>
                      <div className="w-28 text-right text-xs font-mono text-content-primary">{rupees(d.revenue_paise)} <span className="text-content-tertiary">({d.trips})</span></div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
