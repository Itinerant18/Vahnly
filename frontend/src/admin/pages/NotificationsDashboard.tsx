import { useEffect, useState, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Notification {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  status: string;
  acknowledged_at?: string;
  resolved_at?: string;
  delivery_status: Record<string, string>;
  created_at: string;
}

interface AlertRule {
  id: string;
  alert_type: string;
  name: string;
  description: string;
  severity: string;
  is_enabled: boolean;
  threshold_value?: number;
  threshold_unit: string;
  window_minutes: number;
  cooldown_minutes: number;
  channels: string[];
  last_fired_at?: string;
  fired_count: number;
  recipient_count: number;
}

interface Recipient {
  id: string;
  rule_id: string;
  email: string;
  phone: string;
  slack_user_id: string;
}

interface ChannelConfig {
  id: string;
  channel: string;
  config: Record<string, string | number>;
  is_enabled: boolean;
  updated_at: string;
}

interface Stats {
  total_unread: number;
  by_severity: Record<string, number>;
  fired_today: number;
  fired_this_week: number;
  active_rules: number;
  total_rules: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const ALERT_ICONS: Record<string, string> = {
  SOS: '🆘',
  HIGH_CANCELLATION: '📉',
  SURGE_CAP: '⚡',
  PAYMENT_GW_DOWN: '💳',
  KYC_BACKLOG_SLA: '📋',
  PAYOUT_FAILURE: '💸',
};

const SEVERITY_CLS: Record<string, string> = {
  CRITICAL: 'bg-surface-negative text-content-negative border border-negative-400',
  HIGH: 'bg-surface-warning text-content-warning border border-warning-400',
  MEDIUM: 'bg-surface-warning text-content-warning border border-warning-400',
  LOW: 'bg-surface-accent text-content-accent border border-border-accent',
};

const STATUS_CLS: Record<string, string> = {
  UNREAD: 'bg-surface-accent text-content-accent',
  READ: 'bg-background-secondary text-content-secondary',
  ACKNOWLEDGED: 'bg-surface-warning text-content-warning',
  RESOLVED: 'bg-surface-positive text-content-positive',
};

const CHANNELS = ['EMAIL', 'SLACK', 'SMS'];
const ALERT_TYPES = ['SOS', 'HIGH_CANCELLATION', 'SURGE_CAP', 'PAYMENT_GW_DOWN', 'KYC_BACKLOG_SLA', 'PAYOUT_FAILURE'];

// ── Helper components ─────────────────────────────────────────────────────────

const SeverityBadge = ({ s }: { s: string }) => (
  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${SEVERITY_CLS[s] ?? 'bg-background-secondary text-content-secondary'}`}>{s}</span>
);

const StatusBadge = ({ s }: { s: string }) => (
  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLS[s] ?? 'bg-background-secondary text-content-secondary'}`}>{s}</span>
);

const Toggle = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
  <button
    onClick={onChange}
    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-surface-positive0' : 'bg-background-tertiary'}`}
  >
    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
  </button>
);

// ── Main component ─────────────────────────────────────────────────────────────

export function NotificationsDashboard() {
  const [tab, setTab] = useState<'inbox' | 'rules' | 'recipients' | 'channels'>('inbox');
  const [stats, setStats] = useState<Stats | null>(null);

  // Inbox state
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [selectedNotif, setSelectedNotif] = useState<Notification | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterType, setFilterType] = useState('');

  // Rules state
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);

  // Recipients state
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState('');
  const [newRecip, setNewRecip] = useState({ email: '', phone: '', slack_user_id: '' });

  // Channels state
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [channelEdits, setChannelEdits] = useState<Record<string, Record<string, string | number | boolean>>>({});

  const base = '/api/v1/admin/notifications';

  const authHeaders = (json = false): Record<string, string> => {
    const h: Record<string, string> = {};
    if (json) h['Content-Type'] = 'application/json';
    return h;
  };

  const loadStats = useCallback(() => {
    fetch(`${base}/stats`, { headers: authHeaders() }).then(r => r.json()).then(d => setStats(d)).catch(() => {});
  }, [base]);

  const loadNotifications = useCallback(() => {
    const p = new URLSearchParams();
    if (filterStatus) p.set('status', filterStatus);
    if (filterSeverity) p.set('severity', filterSeverity);
    if (filterType) p.set('alert_type', filterType);
    fetch(`${base}?${p}`, { headers: authHeaders() }).then(r => r.json()).then(d => setNotifications(d.notifications ?? [])).catch(() => {});
  }, [base, filterStatus, filterSeverity, filterType]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  useEffect(() => {
    if (tab === 'rules' || tab === 'recipients') {
      fetch(`${base}/rules`, { headers: authHeaders() }).then(r => r.json()).then(d => setRules(d.rules ?? [])).catch(() => {});
    }
    if (tab === 'channels') {
      fetch(`${base}/channels`, { headers: authHeaders() }).then(r => r.json()).then(d => {
        setChannels(d.channels ?? []);
        const edits: typeof channelEdits = {};
        (d.channels ?? []).forEach((c: ChannelConfig) => { edits[c.channel] = { ...c.config, is_enabled: c.is_enabled }; });
        setChannelEdits(edits);
      }).catch(() => {});
    }
  }, [tab, base]);

  useEffect(() => {
    if (!selectedRuleId) return;
    fetch(`${base}/rules/${selectedRuleId}/recipients`, { headers: authHeaders() }).then(r => r.json()).then(d => setRecipients(d.recipients ?? [])).catch(() => {});
  }, [selectedRuleId, base]);

  const openNotif = async (n: Notification) => {
    const detail = await fetch(`${base}/${n.id}`, { headers: authHeaders() }).then(r => r.json()).catch(() => n);
    setSelectedNotif(detail);
    setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, status: x.status === 'UNREAD' ? 'READ' : x.status } : x));
  };

  const acknowledge = async (id: string) => {
    await fetch(`${base}/${id}/acknowledge`, { method: 'POST', headers: authHeaders() });
    const upd = (x: Notification) => x.id === id ? { ...x, status: 'ACKNOWLEDGED' } : x;
    setNotifications(p => p.map(upd));
    setSelectedNotif(p => p && p.id === id ? { ...p, status: 'ACKNOWLEDGED' } : p);
  };

  const resolve = async (id: string) => {
    await fetch(`${base}/${id}/resolve`, { method: 'POST', headers: authHeaders() });
    const upd = (x: Notification) => x.id === id ? { ...x, status: 'RESOLVED' } : x;
    setNotifications(p => p.map(upd));
    setSelectedNotif(p => p && p.id === id ? { ...p, status: 'RESOLVED' } : p);
  };

  const bulkAck = async () => {
    if (!checkedIds.size) return;
    await fetch(`${base}/bulk-acknowledge`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ ids: [...checkedIds] }),
    });
    setNotifications(p => p.map(x => checkedIds.has(x.id) ? { ...x, status: 'ACKNOWLEDGED' } : x));
    setCheckedIds(new Set());
    loadStats();
  };

  const toggleRule = async (id: string) => {
    const d = await fetch(`${base}/rules/${id}/toggle`, { method: 'PATCH', headers: authHeaders() }).then(r => r.json());
    setRules(p => p.map(r => r.id === id ? { ...r, is_enabled: d.is_enabled } : r));
  };

  const saveRule = async () => {
    if (!editingRule) return;
    const method = editingRule.id ? 'PATCH' : 'POST';
    const url = editingRule.id ? `${base}/rules/${editingRule.id}` : `${base}/rules`;
    await fetch(url, { method, headers: authHeaders(true), body: JSON.stringify(editingRule) });
    setEditingRule(null);
    fetch(`${base}/rules`, { headers: authHeaders() }).then(r => r.json()).then(d => setRules(d.rules ?? []));
  };

  const addRecipient = async () => {
    if (!newRecip.email || !selectedRuleId) return;
    const updated = [...recipients, { id: '', rule_id: selectedRuleId, ...newRecip }];
    await fetch(`${base}/rules/${selectedRuleId}/recipients`, {
      method: 'PUT',
      headers: authHeaders(true),
      body: JSON.stringify({ recipients: updated.map(({ email, phone, slack_user_id }) => ({ email, phone, slack_user_id })) }),
    });
    setNewRecip({ email: '', phone: '', slack_user_id: '' });
    fetch(`${base}/rules/${selectedRuleId}/recipients`, { headers: authHeaders() }).then(r => r.json()).then(d => setRecipients(d.recipients ?? []));
  };

  const removeRecipient = async (rid: string) => {
    const updated = recipients.filter(r => r.id !== rid);
    await fetch(`${base}/rules/${selectedRuleId}/recipients`, {
      method: 'PUT',
      headers: authHeaders(true),
      body: JSON.stringify({ recipients: updated.map(({ email, phone, slack_user_id }) => ({ email, phone, slack_user_id })) }),
    });
    setRecipients(updated);
  };

  const saveChannel = async (channel: string) => {
    const edit = channelEdits[channel] ?? {};
    const { is_enabled, ...config } = edit;
    await fetch(`${base}/channels/${channel}`, {
      method: 'PUT',
      headers: authHeaders(true),
      body: JSON.stringify({ config, is_enabled: !!is_enabled }),
    });
    alert(`${channel} config saved.`);
  };

  const testChannel = async (channel: string) => {
    const d = await fetch(`${base}/channels/${channel}/test`, { method: 'POST', headers: authHeaders() }).then(r => r.json());
    alert(d.message ?? 'Test sent');
  };

  const simulate = async (alertType: string) => {
    await fetch(`${base}/simulate`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ alert_type: alertType }),
    });
    loadStats();
    loadNotifications();
  };

  const toggleCheck = (id: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const TABS = [
    { key: 'inbox', label: `Inbox${stats && stats.total_unread > 0 ? ` (${stats.total_unread})` : ''}` },
    { key: 'rules', label: 'Alert Rules' },
    { key: 'recipients', label: 'Recipients' },
    { key: 'channels', label: 'Channels' },
  ] as const;

  return (
    <div className="flex flex-col h-full bg-background-primary">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 border-b border-border">
        <h1 className="text-xl font-semibold text-content-primary">Notifications Center</h1>
        <p className="text-sm text-content-tertiary mt-0.5">System alerts, routing rules, and delivery channel configuration</p>

        {/* Stats bar */}
        {stats && (
          <div className="mt-3 flex gap-4 flex-wrap">
            {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(s => stats.by_severity[s] > 0 && (
              <div key={s} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${SEVERITY_CLS[s]}`}>
                <span>{stats.by_severity[s]} {s}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-background-secondary text-content-tertiary border border-border">
              {stats.fired_today} fired today · {stats.fired_this_week} this week
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-background-secondary text-content-tertiary border border-border">
              {stats.active_rules}/{stats.total_rules} rules active
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="mt-4 flex gap-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-t text-sm font-medium transition ${tab === t.key ? 'bg-content-primary text-gray-0' : 'text-content-tertiary hover:text-content-primary hover:bg-background-secondary'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab: Inbox */}
      {tab === 'inbox' && (
        <div className="flex flex-1 overflow-hidden">
          {/* Left: list */}
          <div className="w-96 flex flex-col border-r border-border overflow-hidden">
            {/* Filters */}
            <div className="px-3 py-2 border-b border-border flex gap-2 flex-wrap">
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-xs border border-border rounded px-2 py-1 bg-background-primary">
                <option value="">All Status</option>
                {['UNREAD','READ','ACKNOWLEDGED','RESOLVED'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)} className="text-xs border border-border rounded px-2 py-1 bg-background-primary">
                <option value="">All Severity</option>
                {['CRITICAL','HIGH','MEDIUM','LOW'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={filterType} onChange={e => setFilterType(e.target.value)} className="text-xs border border-border rounded px-2 py-1 bg-background-primary">
                <option value="">All Types</option>
                {ALERT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Bulk action bar */}
            {checkedIds.size > 0 && (
              <div className="px-3 py-1.5 bg-surface-accent border-b border-border-accent flex items-center justify-between">
                <span className="text-xs text-content-accent">{checkedIds.size} selected</span>
                <button onClick={bulkAck} className="text-xs bg-accent-400 text-white px-3 py-1 rounded hover:bg-accent-400">
                  Bulk Acknowledge
                </button>
              </div>
            )}

            {/* Notification list */}
            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 && (
                <div className="flex items-center justify-center h-full text-sm text-content-tertiary">No notifications</div>
              )}
              {notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => openNotif(n)}
                  className={`flex items-start gap-2 px-3 py-3 border-b border-border cursor-pointer hover:bg-background-secondary transition ${selectedNotif?.id === n.id ? 'bg-background-secondary' : ''} ${n.status === 'UNREAD' ? 'bg-surface-accent/40' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checkedIds.has(n.id)}
                    onChange={e => { e.stopPropagation(); toggleCheck(n.id); }}
                    className="mt-1 shrink-0"
                    onClick={e => e.stopPropagation()}
                  />
                  <span className="text-lg shrink-0">{ALERT_ICONS[n.alert_type] ?? '🔔'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <SeverityBadge s={n.severity} />
                      <StatusBadge s={n.status} />
                    </div>
                    <p className="text-xs font-medium text-content-primary truncate">{n.title}</p>
                    <p className="text-[11px] text-content-tertiary mt-0.5">{new Date(n.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: detail */}
          <div className="flex-1 overflow-y-auto p-6">
            {!selectedNotif ? (
              <div className="flex flex-col items-center justify-center h-full text-content-tertiary">
                <span className="text-4xl mb-3">🔔</span>
                <p className="text-sm">Select a notification to view details</p>
              </div>
            ) : (
              <div className="max-w-2xl">
                <div className="flex items-start gap-3 mb-4">
                  <span className="text-3xl">{ALERT_ICONS[selectedNotif.alert_type] ?? '🔔'}</span>
                  <div>
                    <h2 className="text-base font-semibold text-content-primary">{selectedNotif.title}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <SeverityBadge s={selectedNotif.severity} />
                      <StatusBadge s={selectedNotif.status} />
                      <span className="text-xs text-content-tertiary">{new Date(selectedNotif.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <p className="text-sm text-content-primary mb-4">{selectedNotif.body}</p>

                {/* Metadata */}
                <div className="bg-background-secondary border border-border rounded p-3 mb-4">
                  <p className="text-xs font-medium text-content-tertiary mb-2">Metadata</p>
                  <pre className="text-xs font-mono text-content-primary overflow-x-auto">{JSON.stringify(selectedNotif.metadata, null, 2)}</pre>
                </div>

                {/* Delivery status */}
                <div className="mb-4">
                  <p className="text-xs font-medium text-content-tertiary mb-2">Delivery Status</p>
                  <div className="flex gap-2 flex-wrap">
                    {Object.entries(selectedNotif.delivery_status ?? {}).map(([ch, st]) => (
                      <span key={ch} className={`px-2 py-1 rounded text-xs font-medium ${st === 'SENT' ? 'bg-surface-positive text-content-positive' : st === 'FAILED' ? 'bg-surface-negative text-content-negative' : 'bg-background-secondary text-content-secondary'}`}>
                        {ch}: {st}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  {!['ACKNOWLEDGED','RESOLVED'].includes(selectedNotif.status) && (
                    <button onClick={() => acknowledge(selectedNotif.id)} className="px-4 py-1.5 bg-surface-warning0 text-white text-sm rounded hover:bg-warning-400 font-medium">
                      Acknowledge
                    </button>
                  )}
                  {selectedNotif.status !== 'RESOLVED' && (
                    <button onClick={() => resolve(selectedNotif.id)} className="px-4 py-1.5 bg-positive-400 text-white text-sm rounded hover:bg-positive-400 font-medium">
                      Resolve
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Alert Rules */}
      {tab === 'rules' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-content-primary">Alert Rules</h2>
            <div className="flex gap-2">
              <select
                onChange={e => e.target.value && simulate(e.target.value)}
                defaultValue=""
                className="text-xs border border-border rounded px-2 py-1.5 bg-background-primary text-content-tertiary"
              >
                <option value="">🧪 Simulate alert…</option>
                {ALERT_TYPES.map(t => <option key={t} value={t}>{ALERT_ICONS[t]} {t}</option>)}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead className="bg-background-secondary border-b border-border text-xs text-content-tertiary">
                <tr>
                  <th className="text-left px-4 py-2.5">Alert Type</th>
                  <th className="text-left px-4 py-2.5">Severity</th>
                  <th className="text-left px-4 py-2.5">Threshold</th>
                  <th className="text-left px-4 py-2.5">Channels</th>
                  <th className="text-left px-4 py-2.5">Recipients</th>
                  <th className="text-left px-4 py-2.5">Last Fired</th>
                  <th className="text-left px-4 py-2.5">Enabled</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {rules.map(rule => (
                  <tr key={rule.id} className="border-b border-border hover:bg-background-secondary">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{ALERT_ICONS[rule.alert_type] ?? '🔔'}</span>
                        <div>
                          <p className="font-medium text-content-primary text-xs">{rule.name}</p>
                          <p className="text-[10px] text-content-tertiary">{rule.alert_type}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><SeverityBadge s={rule.severity} /></td>
                    <td className="px-4 py-3 text-xs text-content-tertiary">
                      {rule.threshold_value != null ? `${rule.threshold_value} ${rule.threshold_unit}` : '—'}
                      {rule.window_minutes > 0 && <span className="block text-[10px]">{rule.window_minutes} min window</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {(rule.channels ?? []).map(ch => (
                          <span key={ch} className="px-1.5 py-0.5 bg-background-secondary border border-border rounded text-[10px] text-content-primary">{ch}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-content-tertiary text-center">{rule.recipient_count}</td>
                    <td className="px-4 py-3 text-xs text-content-tertiary">
                      {rule.last_fired_at ? new Date(rule.last_fired_at).toLocaleString() : 'Never'}
                      <span className="block text-[10px]">{rule.fired_count} total</span>
                    </td>
                    <td className="px-4 py-3">
                      <Toggle checked={rule.is_enabled} onChange={() => toggleRule(rule.id)} />
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => setEditingRule(rule)} className="text-xs text-content-accent hover:underline">Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Edit rule modal */}
          {editingRule && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
              <div className="bg-background-primary rounded-lg shadow-xl w-full max-w-md p-6">
                <h3 className="font-semibold text-content-primary mb-4">{ALERT_ICONS[editingRule.alert_type]} Edit: {editingRule.name}</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-content-tertiary block mb-1">Severity</label>
                    <select value={editingRule.severity} onChange={e => setEditingRule({ ...editingRule, severity: e.target.value })} className="w-full text-sm border border-border rounded px-2 py-1.5">
                      {['LOW','MEDIUM','HIGH','CRITICAL'].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-content-tertiary block mb-1">Threshold Value</label>
                      <input type="number" value={editingRule.threshold_value ?? ''} onChange={e => setEditingRule({ ...editingRule, threshold_value: parseFloat(e.target.value) || undefined })} className="w-full text-sm border border-border rounded px-2 py-1.5" />
                    </div>
                    <div>
                      <label className="text-xs text-content-tertiary block mb-1">Unit</label>
                      <input value={editingRule.threshold_unit} onChange={e => setEditingRule({ ...editingRule, threshold_unit: e.target.value })} className="w-full text-sm border border-border rounded px-2 py-1.5" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-content-tertiary block mb-1">Window (min)</label>
                      <input type="number" value={editingRule.window_minutes} onChange={e => setEditingRule({ ...editingRule, window_minutes: parseInt(e.target.value) || 0 })} className="w-full text-sm border border-border rounded px-2 py-1.5" />
                    </div>
                    <div>
                      <label className="text-xs text-content-tertiary block mb-1">Cooldown (min)</label>
                      <input type="number" value={editingRule.cooldown_minutes} onChange={e => setEditingRule({ ...editingRule, cooldown_minutes: parseInt(e.target.value) || 0 })} className="w-full text-sm border border-border rounded px-2 py-1.5" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-content-tertiary block mb-1">Channels</label>
                    <div className="flex gap-2">
                      {CHANNELS.map(ch => (
                        <label key={ch} className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <input type="checkbox" checked={(editingRule.channels ?? []).includes(ch)} onChange={e => {
                            const chs = editingRule.channels ?? [];
                            setEditingRule({ ...editingRule, channels: e.target.checked ? [...chs, ch] : chs.filter(c => c !== ch) });
                          }} />
                          {ch}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-5">
                  <button onClick={saveRule} className="flex-1 bg-content-primary text-gray-0 text-sm py-1.5 rounded font-medium hover:bg-content-primary/90">Save</button>
                  <button onClick={() => setEditingRule(null)} className="px-4 text-sm py-1.5 border border-border rounded text-content-tertiary hover:bg-background-secondary">Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Recipients */}
      {tab === 'recipients' && (
        <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
          <h2 className="text-base font-semibold text-content-primary mb-4">Manage Recipients</h2>
          <div className="mb-4">
            <label className="text-xs text-content-tertiary block mb-1">Select Alert Rule</label>
            <select value={selectedRuleId} onChange={e => setSelectedRuleId(e.target.value)} className="w-full text-sm border border-border rounded px-3 py-2 bg-background-primary">
              <option value="">— choose a rule —</option>
              {rules.map(r => <option key={r.id} value={r.id}>{ALERT_ICONS[r.alert_type]} {r.name}</option>)}
            </select>
          </div>

          {selectedRuleId && (
            <>
              <div className="rounded border border-border overflow-hidden mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-background-secondary border-b border-border text-xs text-content-tertiary">
                    <tr>
                      <th className="text-left px-4 py-2.5">Email</th>
                      <th className="text-left px-4 py-2.5">Phone</th>
                      <th className="text-left px-4 py-2.5">Slack User ID</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipients.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-4 text-center text-xs text-content-tertiary">No recipients configured</td></tr>
                    )}
                    {recipients.map(rec => (
                      <tr key={rec.id} className="border-b border-border">
                        <td className="px-4 py-2.5 text-xs">{rec.email}</td>
                        <td className="px-4 py-2.5 text-xs text-content-tertiary">{rec.phone || '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-content-tertiary">{rec.slack_user_id || '—'}</td>
                        <td className="px-4 py-2.5">
                          <button onClick={() => removeRecipient(rec.id)} className="text-xs text-content-negative hover:underline">Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="border border-border rounded p-4 bg-background-secondary">
                <p className="text-xs font-medium text-content-primary mb-3">Add Recipient</p>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <input placeholder="Email *" value={newRecip.email} onChange={e => setNewRecip({ ...newRecip, email: e.target.value })} className="text-sm border border-border rounded px-2 py-1.5 bg-background-primary" />
                  <input placeholder="Phone" value={newRecip.phone} onChange={e => setNewRecip({ ...newRecip, phone: e.target.value })} className="text-sm border border-border rounded px-2 py-1.5 bg-background-primary" />
                  <input placeholder="Slack @user or ID" value={newRecip.slack_user_id} onChange={e => setNewRecip({ ...newRecip, slack_user_id: e.target.value })} className="text-sm border border-border rounded px-2 py-1.5 bg-background-primary" />
                </div>
                <button onClick={addRecipient} disabled={!newRecip.email} className="px-4 py-1.5 bg-content-primary text-gray-0 text-sm rounded disabled:opacity-50 font-medium hover:bg-content-primary/90">
                  Add Recipient
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab: Channels */}
      {tab === 'channels' && (
        <div className="flex-1 overflow-y-auto p-6">
          <h2 className="text-base font-semibold text-content-primary mb-4">Delivery Channel Configuration</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {channels.map(ch => {
              const edit = channelEdits[ch.channel] ?? {};
              const isEnabled = edit.is_enabled as boolean ?? ch.is_enabled;
              const channelLabels: Record<string, string> = { EMAIL: '📧 Email (SMTP)', SLACK: '💬 Slack Webhook', SMS: '📱 SMS (Twilio)' };
              const channelFields: Record<string, Array<{ key: string; label: string; type?: string }>> = {
                EMAIL: [{ key: 'smtp_host', label: 'SMTP Host' }, { key: 'smtp_port', label: 'SMTP Port', type: 'number' }, { key: 'from_email', label: 'From Email' }, { key: 'from_name', label: 'From Name' }],
                SLACK: [{ key: 'webhook_url', label: 'Webhook URL' }, { key: 'channel', label: 'Channel (#name)' }, { key: 'username', label: 'Bot Username' }],
                SMS: [{ key: 'account_sid', label: 'Account SID' }, { key: 'auth_token', label: 'Auth Token' }, { key: 'from_number', label: 'From Number (+91...)' }],
              };
              const fields = channelFields[ch.channel] ?? [];

              return (
                <div key={ch.channel} className={`border rounded-lg p-5 bg-background-primary ${isEnabled ? 'border-positive-400' : 'border-border'}`}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-content-primary text-sm">{channelLabels[ch.channel] ?? ch.channel}</h3>
                    <Toggle
                      checked={isEnabled}
                      onChange={() => setChannelEdits(prev => ({ ...prev, [ch.channel]: { ...prev[ch.channel], is_enabled: !isEnabled } }))}
                    />
                  </div>
                  <div className="space-y-2.5 mb-4">
                    {fields.map(f => (
                      <div key={f.key}>
                        <label className="text-[10px] text-content-tertiary block mb-0.5">{f.label}</label>
                        <input
                          type={f.type ?? 'text'}
                          value={(edit[f.key] as string | number) ?? ''}
                          onChange={e => setChannelEdits(prev => ({ ...prev, [ch.channel]: { ...prev[ch.channel], [f.key]: e.target.value } }))}
                          className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background-primary font-mono"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => saveChannel(ch.channel)} className="flex-1 bg-content-primary text-gray-0 text-xs py-1.5 rounded font-medium hover:bg-content-primary/90">Save</button>
                    <button onClick={() => testChannel(ch.channel)} className="px-3 text-xs py-1.5 border border-border rounded text-content-tertiary hover:bg-background-secondary">Test</button>
                  </div>
                  {ch.updated_at && (
                    <p className="text-[10px] text-content-tertiary mt-2">Last updated: {new Date(ch.updated_at).toLocaleString()}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
