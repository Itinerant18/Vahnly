import React, { useState } from 'react';

interface SettingGroup {
  key: string;
  label: string;
  description: string;
  settings: SettingItem[];
}

interface SettingItem {
  key: string;
  label: string;
  description?: string;
  type: 'toggle' | 'text' | 'number' | 'select';
  value: string | boolean | number;
  options?: string[];
}

const defaultGroups: SettingGroup[] = [
  {
    key: 'dispatch',
    label: 'Dispatch Settings',
    description: 'Controls how the matching engine operates',
    settings: [
      { key: 'matching_radius_km', label: 'Matching Radius (km)', type: 'number', value: 5 },
      { key: 'max_wait_time_sec', label: 'Max Driver Wait Time (seconds)', type: 'number', value: 180 },
      { key: 'retry_attempts', label: 'Matching Retry Attempts', type: 'number', value: 3 },
      { key: 'hungarian_enabled', label: 'Hungarian Algorithm (Batch Matching)', type: 'toggle', value: true },
      { key: 'priority_order', label: 'Driver Priority', type: 'select', value: 'NEAREST', options: ['NEAREST', 'HIGHEST_RATED', 'ROUND_ROBIN', 'LOYALTY_TIER'] },
    ],
  },
  {
    key: 'platform',
    label: 'Platform Settings',
    description: 'General platform-level configuration',
    settings: [
      { key: 'maintenance_mode', label: 'Maintenance Mode', description: 'Disables new bookings and shows a maintenance banner', type: 'toggle', value: false },
      { key: 'surge_cap_multiplier', label: 'Global Surge Cap (×)', type: 'number', value: 3.5 },
      { key: 'cancellation_fee_pct', label: 'Cancellation Fee (%)', type: 'number', value: 15 },
      { key: 'sos_auto_alert', label: 'Auto-Alert Safety Team on SOS', type: 'toggle', value: true },
      { key: 'default_city', label: 'Default City (new riders)', type: 'select', value: 'KOL', options: ['KOL', 'BLR', 'DEL', 'MUM'] },
    ],
  },
  {
    key: 'notifications',
    label: 'Notification Settings',
    description: 'Controls when and how admins are alerted',
    settings: [
      { key: 'sos_email_alert', label: 'SOS Email Alerts', type: 'toggle', value: true },
      { key: 'payout_failure_alert', label: 'Payout Failure Alerts', type: 'toggle', value: true },
      { key: 'surge_cap_alert', label: 'Surge Cap Hit Alerts', type: 'toggle', value: false },
      { key: 'sla_breach_threshold_min', label: 'SLA Breach Alert Threshold (minutes)', type: 'number', value: 30 },
      { key: 'alert_email', label: 'Ops Alert Email', type: 'text', value: 'ops@driversfor-u.in' },
    ],
  },
  {
    key: 'security',
    label: 'Security & Access',
    description: 'Authentication and access control settings',
    settings: [
      { key: 'require_2fa', label: 'Require 2FA for all admins', type: 'toggle', value: true },
      { key: 'session_timeout_min', label: 'Admin Session Timeout (minutes)', type: 'number', value: 60 },
      { key: 'max_login_attempts', label: 'Max Login Attempts (before lockout)', type: 'number', value: 5 },
      { key: 'lockout_duration_min', label: 'Lockout Duration (minutes)', type: 'number', value: 30 },
    ],
  },
];

type Values = Record<string, string | boolean | number>;

function buildInitial(groups: SettingGroup[]): Values {
  const v: Values = {};
  for (const g of groups) for (const s of g.settings) v[`${g.key}.${s.key}`] = s.value;
  return v;
}

export const SettingsDashboard: React.FC = () => {
  const [values, setValues] = useState<Values>(buildInitial(defaultGroups));
  const [saved, setSaved] = useState(false);
  const [activeGroup, setActiveGroup] = useState(defaultGroups[0].key);

  const set = (gk: string, sk: string, val: string | boolean | number) => {
    setSaved(false);
    setValues(prev => ({ ...prev, [`${gk}.${sk}`]: val }));
  };

  const handleSave = () => {
    // In production this would POST to /api/v1/admin/settings
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const activeGroupData = defaultGroups.find(g => g.key === activeGroup)!;

  return (
    <div className="p-6 flex gap-6 h-full">
      {/* Sidebar nav */}
      <div className="w-52 shrink-0 space-y-1">
        <div className="text-xs font-semibold text-content-tertiary uppercase tracking-wide px-3 mb-3">Configuration</div>
        {defaultGroups.map(g => (
          <button
            key={g.key}
            onClick={() => setActiveGroup(g.key)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              activeGroup === g.key
                ? 'bg-accent/10 text-accent font-medium'
                : 'text-content-secondary hover:text-content-primary hover:bg-background-secondary'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Settings panel */}
      <div className="flex-1 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-content-primary">{activeGroupData.label}</h1>
          <p className="text-sm text-content-tertiary">{activeGroupData.description}</p>
        </div>

        <div className="space-y-4">
          {activeGroupData.settings.map(s => {
            const vk = `${activeGroupData.key}.${s.key}`;
            const val = values[vk];

            return (
              <div key={s.key} className="bg-background-primary rounded-xl border border-background-secondary p-5 flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="text-sm font-medium text-content-primary">{s.label}</div>
                  {s.description && <div className="text-xs text-content-tertiary mt-0.5">{s.description}</div>}
                </div>
                <div className="shrink-0">
                  {s.type === 'toggle' && (
                    <button
                      onClick={() => set(activeGroupData.key, s.key, !val)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${val ? 'bg-accent' : 'bg-background-secondary'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${val ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  )}
                  {s.type === 'number' && (
                    <input
                      type="number"
                      value={String(val)}
                      onChange={e => set(activeGroupData.key, s.key, parseFloat(e.target.value))}
                      className="w-28 border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary text-right focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  )}
                  {s.type === 'text' && (
                    <input
                      type="text"
                      value={String(val)}
                      onChange={e => set(activeGroupData.key, s.key, e.target.value)}
                      className="w-56 border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  )}
                  {s.type === 'select' && s.options && (
                    <select
                      value={String(val)}
                      onChange={e => set(activeGroupData.key, s.key, e.target.value)}
                      className="border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      {s.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            className="px-5 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm font-medium"
          >
            Save Changes
          </button>
          {saved && <span className="text-sm text-content-positive">✓ Settings saved</span>}
          <span className="text-xs text-content-tertiary ml-auto">Some settings require a gateway restart to take effect.</span>
        </div>
      </div>
    </div>
  );
};
