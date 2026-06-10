import React, { useState, useEffect } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

interface AdminUser {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  role: string;
  region_prefix: string;
  is_active: boolean;
  two_factor_enabled: boolean;
  last_active_at: string | null;
  city_scope: string;
}

interface AuditLog {
  id: string;
  admin_id: string;
  admin_email: string;
  action: string;
  details: string;
  ip_address: string;
  created_at: string;
}

export const AdminTeamManagement: React.FC = () => {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [selectedAdminId, setSelectedAdminId] = useState<string>('');
  
  // Forms & Dialog states
  const [showInviteModal, setShowInviteModal] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  
  // Form Values
  const [inviteName, setInviteName] = useState<string>('');
  const [inviteEmail, setInviteEmail] = useState<string>('');
  const [invitePhone, setInvitePhone] = useState<string>('');
  const [inviteRole, setInviteRole] = useState<string>('AUDITOR');
  const [inviteRegion, setInviteRegion] = useState<string>('KOL');
  const [inviteCityScope, setInviteCityScope] = useState<string>('KOL');
  
  const [editAdminUser, setEditAdminUser] = useState<AdminUser | null>(null);
  const [editRole, setEditRole] = useState<string>('AUDITOR');
  const [editCityScope, setEditCityScope] = useState<string>('KOL');
  
  const [statusMsg, setStatusMsg] = useState<{ type: 'SUCCESS' | 'ERROR'; text: string } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const rolesList = [
    { value: 'SUPER_ADMIN', label: 'Super Admin' },
    { value: 'OPERATIONS_MANAGER', label: 'Operations Manager' },
    { value: 'FLEET_MANAGER', label: 'Fleet / Driver Manager' },
    { value: 'CUSTOMER_SUPPORT', label: 'Customer Support' },
    { value: 'FINANCE', label: 'Finance' },
    { value: 'MARKETING', label: 'Marketing' },
    { value: 'ANALYTICS', label: 'Analytics / BI' },
    { value: 'CITY_MANAGER', label: 'City Manager' },
    { value: 'COMPLIANCE', label: 'Compliance / Safety' },
    { value: 'AUDITOR', label: 'Read-only Auditor' },
  ];

  const token = localStorage.getItem('admin_jwt_token') ?? '';

  const fetchAdmins = async () => {
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/team`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAdmins(data || []);
      }
    } catch (e) {
      console.error('Failed to list team administrators', e);
    }
  };

  const fetchAuditLogs = async (adminId?: string) => {
    try {
      const url = adminId 
        ? `${API_GATEWAY_BASE_URL}/api/v1/admin/team/audit?admin_id=${encodeURIComponent(adminId)}`
        : `${API_GATEWAY_BASE_URL}/api/v1/admin/team/audit`;
      
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data || []);
      }
    } catch (e) {
      console.error('Failed to list audit logs', e);
    }
  };

  useEffect(() => {
    fetchAdmins();
    fetchAuditLogs();
  }, []);

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.confirm(
      `Invite ${inviteEmail.trim()} as ${inviteRole}?` +
      (inviteRole === 'SUPER_ADMIN' ? '\n\n⚠ SUPER_ADMIN grants full platform control.' : '')
    )) {
      return;
    }
    setIsLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/team/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          full_name: inviteName.trim(),
          phone: invitePhone.trim(),
          email: inviteEmail.trim(),
          role: inviteRole,
          region_prefix: inviteRegion,
          city_scope: inviteCityScope
        })
      });

      if (res.ok) {
        setStatusMsg({ type: 'SUCCESS', text: 'Invitation dispatched successfully.' });
        setInviteName('');
        setInviteEmail('');
        setInvitePhone('');
        setShowInviteModal(false);
        fetchAdmins();
        fetchAuditLogs();
      } else {
        setStatusMsg({ type: 'ERROR', text: 'Failed to dispatch invitation.' });
      }
    } catch (err) {
      setStatusMsg({ type: 'ERROR', text: 'Network connection failure.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editAdminUser) return;
    if (!window.confirm(
      `Change ${editAdminUser.email}'s role to ${editRole}?` +
      (editRole === 'SUPER_ADMIN' ? '\n\n⚠ SUPER_ADMIN grants full platform control.' : '')
    )) {
      return;
    }
    setIsLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/team/edit-role`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          admin_id: editAdminUser.id,
          role: editRole,
          city_scope: editCityScope
        })
      });

      if (res.ok) {
        setStatusMsg({ type: 'SUCCESS', text: 'Role configuration updated.' });
        setShowEditModal(false);
        fetchAdmins();
        fetchAuditLogs();
      } else {
        setStatusMsg({ type: 'ERROR', text: 'Update rejected.' });
      }
    } catch (err) {
      setStatusMsg({ type: 'ERROR', text: 'Network error.' });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSuspend = async (admin: AdminUser) => {
    if (!window.confirm(`Are you sure you want to ${admin.is_active ? 'SUSPEND' : 'ACTIVATE'} ${admin.full_name}?`)) return;
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/team/suspend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          admin_id: admin.id,
          suspend: admin.is_active
        })
      });

      if (res.ok) {
        fetchAdmins();
        fetchAuditLogs();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const resetMFA = async (adminId: string) => {
    if (!window.confirm('Are you sure you want to RESET the 2FA parameters for this administrator?')) return;
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/team/reset-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ admin_id: adminId })
      });

      if (res.ok) {
        alert('MFA credentials have been cleared and reset successfully.');
        fetchAdmins();
        fetchAuditLogs();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAdminSelectForAudit = (adminId: string) => {
    setSelectedAdminId(adminId);
    fetchAuditLogs(adminId);
  };

  return (
    <div className="p-6 space-y-6 text-ink bg-white font-sans max-w-7xl mx-auto">
      
      {/* Upper Control Bar */}
      <div className="flex justify-between items-center border-b border-canvas-soft pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-ink">Administrative Team Control</h2>
          <p className="text-body text-xs mt-1">Manage corporate accounts, security scopes, permissions, and compliance logs.</p>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="bg-ink hover:bg-black-elevated text-on-dark font-medium py-2 px-5 rounded-pill text-xs transition active:scale-[0.98] cursor-pointer"
        >
          Invite Administrator
        </button>
      </div>

      {statusMsg && (
        <div className={`p-3.5 rounded-xl text-xs font-mono font-bold tracking-wide uppercase text-center ${
          statusMsg.type === 'SUCCESS' ? 'bg-canvas-soft border border-surface-pressed text-ink' : 'bg-ink text-on-dark'
        }`}>
          {statusMsg.text}
        </div>
      )}

      {/* Main Grid split: List vs Audit timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Side: Admins List Table */}
        <div className="lg:col-span-2 bg-canvas rounded-xl border border-canvas-soft p-5 space-y-4">
          <h3 className="text-sm font-bold tracking-tight">Active Administrators</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-mute uppercase text-[10px] tracking-wider border-b border-canvas-soft">
                  <th className="pb-3 font-bold">Admin / Email</th>
                  <th className="pb-3 font-bold">Role</th>
                  <th className="pb-3 font-bold">City Scope</th>
                  <th className="pb-3 font-bold">Status</th>
                  <th className="pb-3 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-soft text-xs">
                {admins.map((admin) => (
                  <tr 
                    key={admin.id} 
                    className={`hover:bg-canvas-softer transition cursor-pointer ${selectedAdminId === admin.id ? 'bg-canvas-softer' : ''}`}
                    onClick={() => handleAdminSelectForAudit(admin.id)}
                  >
                    <td className="py-3">
                      <div className="font-bold text-ink">{admin.full_name}</div>
                      <div className="text-[10px] text-body font-mono">{admin.email}</div>
                    </td>
                    <td className="py-3 font-medium">
                      <span className="bg-canvas-soft px-2.5 py-0.5 rounded-pill text-[10px] font-bold">
                        {admin.role}
                      </span>
                    </td>
                    <td className="py-3 font-mono font-bold">{admin.city_scope}</td>
                    <td className="py-3">
                      <span className="flex items-center gap-1.5 font-medium">
                        <span className={`w-2 h-2 rounded-full ${admin.is_active ? 'bg-status-online' : 'bg-status-alert'}`} />
                        {admin.is_active ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td className="py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => {
                            setEditAdminUser(admin);
                            setEditRole(admin.role);
                            setEditCityScope(admin.city_scope);
                            setShowEditModal(true);
                          }}
                          className="bg-canvas border border-canvas-soft text-ink font-bold px-3 py-1 rounded-pill text-[10px] hover:bg-canvas-soft"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => resetMFA(admin.id)}
                          className="bg-canvas border border-canvas-soft text-ink font-bold px-3 py-1 rounded-pill text-[10px] hover:bg-canvas-soft"
                          title="Reset MFA Credentials"
                        >
                          2FA
                        </button>
                        <button
                          onClick={() => toggleSuspend(admin)}
                          className={`font-bold px-3 py-1 rounded-pill text-[10px] text-white ${
                            admin.is_active ? 'bg-black hover:bg-black-elevated' : 'bg-status-online'
                          }`}
                        >
                          {admin.is_active ? 'Suspend' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Side: Audit Logs Timeline */}
        <div className="bg-canvas rounded-xl border border-canvas-soft p-5 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold tracking-tight">Security Audit Logs</h3>
            {selectedAdminId && (
              <button 
                onClick={() => handleAdminSelectForAudit('')}
                className="text-[10px] font-bold text-body hover:text-ink cursor-pointer"
              >
                Clear Filter
              </button>
            )}
          </div>
          
          <div className="space-y-4 max-h-[360px] overflow-y-auto pr-1">
            {auditLogs.length === 0 ? (
              <div className="text-center text-xs text-mute py-8">No security actions recorded in ledger.</div>
            ) : (
              auditLogs.map((log) => (
                <div key={log.id} className="border-l border-ink pl-3.5 space-y-1 py-1 relative">
                  <div className="absolute w-2 h-2 rounded-full bg-ink -left-[4.5px] top-2" />
                  <div className="flex justify-between items-center text-[10px] font-bold text-body">
                    <span className="font-mono">{log.action}</span>
                    <span className="font-mono font-normal">{new Date(log.created_at).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-xs text-ink font-medium leading-snug">{log.details}</p>
                  <div className="text-[9px] text-mute flex justify-between font-mono">
                    <span className="truncate max-w-[130px]" title={log.admin_email}>{log.admin_email}</span>
                    <span>IP: {log.ip_address}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Invite Admin Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-6 z-[60]">
          <div className="bg-white rounded-xl border border-canvas-soft max-w-md w-full p-6 space-y-4 relative shadow-lg">
            <h3 className="text-sm font-bold tracking-tight">Invite Corporate Administrator</h3>
            
            <form onSubmit={handleInviteSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-xs text-ink focus:outline-none"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                />
              </div>
              
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-xs text-ink focus:outline-none"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1">Phone Number</label>
                <input
                  type="text"
                  className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-xs text-ink focus:outline-none"
                  placeholder="+91..."
                  value={invitePhone}
                  onChange={(e) => setInvitePhone(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1">Operating Hub</label>
                  <select
                    className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-xs text-ink focus:outline-none cursor-pointer"
                    value={inviteRegion}
                    onChange={(e) => {
                      setInviteRegion(e.target.value);
                      setInviteCityScope(e.target.value);
                    }}
                  >
                    <option value="KOL">KOL (Kolkata)</option>
                    <option value="BLR">BLR (Bengaluru)</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1">Assigned Role</label>
                  <select
                    className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-xs text-ink focus:outline-none cursor-pointer"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                  >
                    {rolesList.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1">Scoped Cities (comma separated)</label>
                <input
                  type="text"
                  required
                  className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-xs text-ink focus:outline-none font-mono"
                  value={inviteCityScope}
                  onChange={(e) => setInviteCityScope(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-canvas-soft">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="bg-canvas border border-canvas-soft text-ink py-2 px-5 rounded-pill text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="bg-ink hover:bg-black-elevated text-on-dark py-2 px-5 rounded-pill text-xs font-medium cursor-pointer"
                >
                  {isLoading ? 'Sending...' : 'Dispatched'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Role Modal */}
      {showEditModal && editAdminUser && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-6 z-[60]">
          <div className="bg-white rounded-xl border border-canvas-soft max-w-md w-full p-6 space-y-4 relative shadow-lg">
            <h3 className="text-sm font-bold tracking-tight">Configure Admin Permissions</h3>
            <p className="text-body text-xs">Modifying: <strong>{editAdminUser.full_name}</strong> ({editAdminUser.email})</p>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1">Administrative Role</label>
                <select
                  className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-xs text-ink focus:outline-none cursor-pointer"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                >
                  {rolesList.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1">Scoped Cities (comma separated)</label>
                <input
                  type="text"
                  required
                  className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-xs text-ink focus:outline-none font-mono"
                  value={editCityScope}
                  onChange={(e) => setEditCityScope(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-canvas-soft">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="bg-canvas border border-canvas-soft text-ink py-2 px-5 rounded-pill text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="bg-ink hover:bg-black-elevated text-on-dark py-2 px-5 rounded-pill text-xs font-medium cursor-pointer"
                >
                  {isLoading ? 'Saving...' : 'Save Parameters'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
