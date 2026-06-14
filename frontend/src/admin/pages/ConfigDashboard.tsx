import React, { useState, useEffect, useCallback } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';

// ── Types ────────────────────────────────────────────────────────────────────
interface PlatformSetting { key: string; value: string; data_type: string; category: string; description: string; }
interface FeatureFlag {
  id: number; flag_key: string; name: string; description: string;
  is_enabled: boolean; rollout_percentage: number;
  target_cities: string[]; target_roles: string[];
  is_kill_switch: boolean; updated_at: string;
}
interface AppVersion {
  id: number; platform: string; version_string: string; build_number: number;
  release_type: string; min_supported_version: string; release_notes: string;
  store_url: string; is_latest: boolean; created_at: string;
}
interface Integration {
  id: number; integration_key: string; display_name: string; category: string;
  logo_emoji: string; is_enabled: boolean; config_json: string;
  api_key_masked: string; webhook_url: string; health_status: string;
  last_health_check: string | null; updated_by: string; updated_at: string;
}
interface NotifTemplate {
  id: number; template_key: string; name: string; channel: string;
  event_trigger: string; title_template: string; body_template: string;
  variables: string[]; language_code: string; is_active: boolean;
}
interface CancelRule {
  id: number; rule_name: string; applies_to: string; trip_status_at_cancel: string;
  minutes_elapsed_min: number; minutes_elapsed_max: number;
  cancellation_fee_pct: number; cancellation_fee_fixed_paise: number;
  refund_pct: number; party_at_fault: string; is_active: boolean; priority: number;
  [key: string]: unknown; // satisfies DataTable's row constraint
}
// DataTable's generic requires id?: string, but CancelRule.id is numeric. Columns
// and handlers are authored against CancelRule; only the DataTable boundary is cast
// to this constraint-satisfying row shape.
type CancelRuleRow = { id?: string; [key: string]: unknown };
interface RatingRule {
  id: number; applies_to: string; threshold_type: string;
  min_trips_required: number; rating_below: number;
  action: string; cooldown_days: number; is_active: boolean;
}

type Section = 'brand' | 'flags' | 'versions' | 'integrations' | 'templates' | 'cancel' | 'ratings';

const NAV: { key: Section; label: string; icon: string }[] = [
  { key: 'brand',        label: 'Global Settings',       icon: '⚙️' },
  { key: 'flags',        label: 'Feature Flags',         icon: '🚩' },
  { key: 'versions',     label: 'App Versions',          icon: '📱' },
  { key: 'integrations', label: 'Integrations',          icon: '🔌' },
  { key: 'templates',    label: 'Notification Templates', icon: '✉️' },
  { key: 'cancel',       label: 'Cancellation Rules',    icon: '🚫' },
  { key: 'ratings',      label: 'Rating Thresholds',     icon: '⭐' },
];

const HEALTH_COLORS: Record<string, string> = {
  HEALTHY: 'bg-surface-positive text-content-positive',
  DEGRADED: 'bg-surface-warning text-content-warning',
  DOWN: 'bg-surface-negative text-content-negative',
  UNKNOWN: 'bg-background-secondary text-content-secondary',
};
const RELEASE_COLORS: Record<string, string> = {
  FORCE: 'bg-surface-negative text-content-negative', OPTIONAL: 'bg-surface-accent text-content-accent', SILENT: 'bg-background-secondary text-content-secondary',
};
const CHANNEL_COLORS: Record<string, string> = {
  PUSH: 'bg-surface-accent text-content-accent', SMS: 'bg-surface-accent text-content-accent',
  EMAIL: 'bg-surface-accent text-content-accent', WHATSAPP: 'bg-surface-positive text-content-positive',
};

// ── Main Component ───────────────────────────────────────────────────────────
export const ConfigDashboard: React.FC = () => {
  const [section, setSection] = useState<Section>('brand');
  const role = localStorage.getItem('admin_role') || 'SUPER_ADMIN';
  const email = localStorage.getItem('admin_email') || '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const headers = {
    'X-Admin-Role': role,
    'X-Admin-Email': email, 'Content-Type': 'application/json',
  };
  const base = `${API_GATEWAY_BASE_URL}/api/v1/admin/config`;

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar */}
      <div className="w-52 shrink-0 p-4 border-r border-background-secondary space-y-1">
        <div className="text-xs font-semibold text-content-tertiary uppercase tracking-wide px-2 mb-3">Configuration</div>
        {NAV.map(n => (
          <button key={n.key} onClick={() => setSection(n.key)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
              section === n.key ? 'bg-accent/10 text-accent font-medium' : 'text-content-secondary hover:text-content-primary hover:bg-background-secondary'
            }`}>
            <span>{n.icon}</span>{n.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 p-6 overflow-auto">
        {section === 'brand'        && <GlobalSettingsSection base={base} headers={headers} isSuperAdmin={isSuperAdmin} />}
        {section === 'flags'        && <FeatureFlagsSection   base={base} headers={headers} isSuperAdmin={isSuperAdmin} />}
        {section === 'versions'     && <AppVersionsSection    base={base} headers={headers} isSuperAdmin={isSuperAdmin} />}
        {section === 'integrations' && <IntegrationsSection   base={base} headers={headers} isSuperAdmin={isSuperAdmin} />}
        {section === 'templates'    && <TemplatesSection      base={base} headers={headers} isSuperAdmin={isSuperAdmin} />}
        {section === 'cancel'       && <CancelRulesSection    base={base} headers={headers} isSuperAdmin={isSuperAdmin} />}
        {section === 'ratings'      && <RatingRulesSection    base={base} headers={headers} isSuperAdmin={isSuperAdmin} />}
      </div>
    </div>
  );
};

// ── 20.1 Global Settings ─────────────────────────────────────────────────────
const GlobalSettingsSection: React.FC<{ base: string; headers: Record<string, string>; isSuperAdmin: boolean }> = ({ base, headers, isSuperAdmin }) => {
  const [settings, setSettings] = useState<PlatformSetting[]>([]);
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`${base}/settings`, { headers });
      if (res.ok) {
        const d = await res.json();
        setSettings(d.settings || []);
        const vals: Record<string, string> = {};
        for (const s of (d.settings || [])) vals[s.key] = s.value;
        setLocalValues(vals);
      }
    })();
  }, []);

  const save = async (category: string) => {
    const settingsToSave = settings.filter(s => s.category === category).map(s => ({ key: s.key, value: localValues[s.key] ?? s.value }));
    await fetch(`${base}/settings`, { method: 'POST', headers, body: JSON.stringify({ settings: settingsToSave }) });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const categories = [...new Set(settings.map(s => s.category))];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-bold text-content-primary">Global Settings</h2><p className="text-sm text-content-tertiary">Brand, locale, support, and legal configuration</p></div>
        {saved && <span className="text-sm text-content-positive">✓ Saved</span>}
      </div>
      {categories.map(cat => (
        <div key={cat} className="bg-background-primary rounded-xl border border-background-secondary p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-content-primary capitalize">{cat}</div>
            {isSuperAdmin && <button onClick={() => save(cat)} className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent/90">Save {cat}</button>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {settings.filter(s => s.category === cat).map(s => (
              <div key={s.key}>
                <label className="text-xs text-content-tertiary">{s.description || s.key}</label>
                {s.data_type === 'boolean' ? (
                  <button onClick={() => setLocalValues(v => ({ ...v, [s.key]: localValues[s.key] === 'true' ? 'false' : 'true' }))}
                    className={`mt-1 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${localValues[s.key] === 'true' ? 'bg-accent' : 'bg-background-secondary'}`}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${localValues[s.key] === 'true' ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                ) : (
                  <input
                    value={localValues[s.key] ?? ''}
                    onChange={e => setLocalValues(v => ({ ...v, [s.key]: e.target.value }))}
                    disabled={!isSuperAdmin}
                    className="mt-1 w-full border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary disabled:opacity-60 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

// ── 20.2 Feature Flags ───────────────────────────────────────────────────────
const FeatureFlagsSection: React.FC<{ base: string; headers: Record<string, string>; isSuperAdmin: boolean }> = ({ base, headers, isSuperAdmin }) => {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [editing, setEditing] = useState<FeatureFlag | null>(null);

  const fetchFlags = useCallback(async () => {
    const res = await fetch(`${base}/flags`, { headers });
    if (res.ok) { const d = await res.json(); setFlags(d.flags || []); }
  }, []);

  const toggle = async (flag: FeatureFlag) => {
    await fetch(`${base}/flags`, {
      method: 'POST', headers,
      body: JSON.stringify({ flag_key: flag.flag_key, is_enabled: !flag.is_enabled }),
    });
    fetchFlags();
  };

  const saveEditing = async () => {
    if (!editing) return;
    await fetch(`${base}/flags`, { method: 'POST', headers, body: JSON.stringify(editing) });
    setEditing(null); fetchFlags();
  };

  useEffect(() => { fetchFlags(); }, [fetchFlags]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-bold text-content-primary">Feature Flags</h2><p className="text-sm text-content-tertiary">Toggle features, set rollout %, city scope</p></div>
        {isSuperAdmin && <button onClick={() => setEditing({ id: 0, flag_key: '', name: '', description: '', is_enabled: false, rollout_percentage: 0, target_cities: [], target_roles: [], is_kill_switch: false, updated_at: '' })}
          className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">+ New Flag</button>}
      </div>

      {editing && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
          <div className="text-sm font-semibold text-content-primary">{editing.id ? 'Edit' : 'New'} Feature Flag</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-content-tertiary">Flag Key</label><input value={editing.flag_key} onChange={e => setEditing({ ...editing, flag_key: e.target.value })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm font-mono bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" /></div>
            <div><label className="text-xs text-content-tertiary">Name</label><input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" /></div>
            <div><label className="text-xs text-content-tertiary">Rollout % (0–100)</label><input type="number" min={0} max={100} value={editing.rollout_percentage} onChange={e => setEditing({ ...editing, rollout_percentage: Number(e.target.value) })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none" /></div>
            <div><label className="text-xs text-content-tertiary">Target Cities (comma-separated)</label><input value={editing.target_cities.join(',')} onChange={e => setEditing({ ...editing, target_cities: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="KOL,BLR" className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm font-mono bg-background-primary text-content-primary focus:outline-none" /></div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={editing.is_enabled} onChange={e => setEditing({ ...editing, is_enabled: e.target.checked })} /> Enabled</label>
            <label className="flex items-center gap-2 text-content-negative"><input type="checkbox" checked={editing.is_kill_switch} onChange={e => setEditing({ ...editing, is_kill_switch: e.target.checked })} /> Kill Switch</label>
          </div>
          <div className="flex gap-2">
            <button onClick={saveEditing} className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Save</button>
            <button onClick={() => setEditing(null)} className="px-4 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {flags.map(flag => (
          <div key={flag.flag_key} className={`bg-background-primary rounded-xl border p-4 flex items-center gap-4 ${flag.is_kill_switch ? 'border-negative-400' : 'border-background-secondary'}`}>
            <button onClick={() => isSuperAdmin && toggle(flag)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${flag.is_enabled ? (flag.is_kill_switch ? 'bg-surface-negative0' : 'bg-accent') : 'bg-background-secondary'} ${!isSuperAdmin ? 'cursor-default' : 'cursor-pointer'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${flag.is_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-content-primary">{flag.name}</span>
                {flag.is_kill_switch && <span className="text-[10px] bg-surface-negative text-content-negative px-1.5 py-0.5 rounded font-medium">KILL SWITCH</span>}
                <span className="text-xs text-content-tertiary font-mono">{flag.flag_key}</span>
              </div>
              <div className="text-xs text-content-tertiary mt-0.5">{flag.description}</div>
              {flag.target_cities.length > 0 && <div className="text-[10px] text-content-tertiary mt-0.5">Cities: {flag.target_cities.join(', ')}</div>}
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-mono text-content-primary">{flag.rollout_percentage}%</div>
              <div className="text-xs text-content-tertiary">rollout</div>
              {isSuperAdmin && <button onClick={() => setEditing(flag)} className="text-xs text-accent hover:underline mt-1">Edit</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── 20.3 App Versions ────────────────────────────────────────────────────────
const AppVersionsSection: React.FC<{ base: string; headers: Record<string, string>; isSuperAdmin: boolean }> = ({ base, headers, isSuperAdmin }) => {
  const [versions, setVersions] = useState<AppVersion[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newV, setNewV] = useState<Partial<AppVersion>>({ platform: 'ANDROID', version_string: '', release_type: 'OPTIONAL', min_supported_version: '', release_notes: '', store_url: '', is_latest: true });

  const fetchVersions = useCallback(async () => {
    const res = await fetch(`${base}/versions`, { headers });
    if (res.ok) { const d = await res.json(); setVersions(d.versions || []); }
  }, []);

  const addVersion = async () => {
    await fetch(`${base}/versions`, { method: 'POST', headers, body: JSON.stringify(newV) });
    setShowAdd(false); fetchVersions();
  };

  const setLatest = async (id: number) => {
    await fetch(`${base}/versions/${id}/set-latest`, { method: 'POST', headers });
    fetchVersions();
  };

  useEffect(() => { fetchVersions(); }, [fetchVersions]);

  const iosVersions = versions.filter(v => v.platform === 'iOS');
  const androidVersions = versions.filter(v => v.platform === 'ANDROID');

  const PlatformList: React.FC<{ label: string; versions: AppVersion[] }> = ({ label, versions }) => (
    <div className="bg-background-primary rounded-xl border border-background-secondary overflow-hidden">
      <div className="px-4 py-3 border-b border-background-secondary font-semibold text-sm text-content-primary">{label}</div>
      {versions.length === 0 && <div className="p-4 text-xs text-content-tertiary">No versions.</div>}
      {versions.map(v => (
        <div key={v.id} className={`flex items-center gap-3 px-4 py-3 border-b border-background-secondary/50 ${v.is_latest ? 'bg-accent/5' : ''}`}>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-medium text-content-primary">{v.version_string}</span>
              {v.is_latest && <span className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded font-medium">LATEST</span>}
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${RELEASE_COLORS[v.release_type] ?? 'bg-background-secondary text-content-secondary'}`}>{v.release_type}</span>
            </div>
            <div className="text-xs text-content-tertiary mt-0.5">Build {v.build_number} · Min: {v.min_supported_version || '—'}</div>
            {v.release_notes && <div className="text-xs text-content-secondary mt-0.5 truncate max-w-sm">{v.release_notes}</div>}
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs text-content-tertiary">{new Date(v.created_at).toLocaleDateString('en-IN')}</div>
            {isSuperAdmin && !v.is_latest && <button onClick={() => setLatest(v.id)} className="text-xs text-accent hover:underline mt-1">Set Latest</button>}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-bold text-content-primary">App Version Management</h2><p className="text-sm text-content-tertiary">Force update, optional update, min version</p></div>
        {isSuperAdmin && <button onClick={() => setShowAdd(!showAdd)} className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">+ Add Version</button>}
      </div>
      {showAdd && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
          <div className="text-sm font-semibold text-content-primary">New Release</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { label: 'Platform', type: 'select', key: 'platform', options: ['iOS', 'ANDROID'] },
              { label: 'Version', type: 'text', key: 'version_string', placeholder: '3.5.0' },
              { label: 'Build Number', type: 'number', key: 'build_number' },
              { label: 'Release Type', type: 'select', key: 'release_type', options: ['FORCE', 'OPTIONAL', 'SILENT'] },
              { label: 'Min Supported', type: 'text', key: 'min_supported_version', placeholder: '3.0.0' },
            ].map(f => (
              <div key={f.key}>
                <label className="text-xs text-content-tertiary">{f.label}</label>
                {f.type === 'select'
                  ? <select value={String((newV as any)[f.key] ?? '')} onChange={e => setNewV({ ...newV, [f.key]: e.target.value })}
                      className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
                      {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  : <input type={f.type} placeholder={f.placeholder} value={String((newV as any)[f.key] ?? '')}
                      onChange={e => setNewV({ ...newV, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
                      className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" />}
              </div>
            ))}
          </div>
          <div>
            <label className="text-xs text-content-tertiary">Release Notes</label>
            <textarea value={newV.release_notes || ''} onChange={e => setNewV({ ...newV, release_notes: e.target.value })} rows={2}
              className="mt-1 w-full border border-background-secondary rounded px-3 py-2 text-sm bg-background-primary text-content-primary resize-none focus:outline-none focus:ring-1 focus:ring-accent" />
          </div>
          <div className="flex gap-2">
            <button onClick={addVersion} className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Add Version</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">Cancel</button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <PlatformList label="iOS" versions={iosVersions} />
        <PlatformList label="Android" versions={androidVersions} />
      </div>
    </div>
  );
};

// ── 20.4 Integrations ────────────────────────────────────────────────────────
const INTEGRATION_CATEGORIES = ['payment', 'messaging', 'maps', 'kyc', 'analytics', 'accounting', 'crm'];

const IntegrationsSection: React.FC<{ base: string; headers: Record<string, string>; isSuperAdmin: boolean }> = ({ base, headers, isSuperAdmin }) => {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [editing, setEditing] = useState<Integration | null>(null);
  const [healthChecking, setHealthChecking] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState('');

  const fetchIntegrations = useCallback(async () => {
    const p = catFilter ? `?category=${catFilter}` : '';
    const res = await fetch(`${base}/integrations${p}`, { headers });
    if (res.ok) { const d = await res.json(); setIntegrations(d.integrations || []); }
  }, [catFilter]);

  const saveEditing = async () => {
    if (!editing) return;
    await fetch(`${base}/integrations/${editing.integration_key}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ is_enabled: editing.is_enabled, webhook_url: editing.webhook_url }),
    });
    setEditing(null); fetchIntegrations();
  };

  const healthCheck = async (key: string) => {
    setHealthChecking(key);
    await fetch(`${base}/integrations/${key}/health-check`, { method: 'POST', headers });
    setHealthChecking(null); fetchIntegrations();
  };

  useEffect(() => { fetchIntegrations(); }, [fetchIntegrations]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div><h2 className="text-lg font-bold text-content-primary">Integrations</h2><p className="text-sm text-content-tertiary">API keys, webhooks, health monitoring</p></div>
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setCatFilter('')} className={`px-2.5 py-1 rounded text-xs border ${!catFilter ? 'bg-accent text-white border-accent' : 'bg-background-primary border-background-secondary text-content-secondary'}`}>All</button>
          {INTEGRATION_CATEGORIES.map(c => (
            <button key={c} onClick={() => setCatFilter(c)} className={`px-2.5 py-1 rounded text-xs border capitalize ${catFilter === c ? 'bg-accent text-white border-accent' : 'bg-background-primary border-background-secondary text-content-secondary'}`}>{c}</button>
          ))}
        </div>
      </div>

      {editing && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
          <div className="font-semibold text-sm text-content-primary">{editing.logo_emoji} {editing.display_name}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-content-tertiary">API Key (will be masked)</label>
              <input type="password" placeholder="Enter to update…" onChange={e => setEditing({ ...editing, api_key_masked: e.target.value })}
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm font-mono bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div>
              <label className="text-xs text-content-tertiary">Webhook URL</label>
              <input value={editing.webhook_url} onChange={e => setEditing({ ...editing, webhook_url: e.target.value })}
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm font-mono bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.is_enabled} onChange={e => setEditing({ ...editing, is_enabled: e.target.checked })} /> Enable integration</label>
          <div className="flex gap-2">
            <button onClick={saveEditing} className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Save</button>
            <button onClick={() => setEditing(null)} className="px-4 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {integrations.map(ig => (
          <div key={ig.integration_key} className={`bg-background-primary rounded-xl border p-4 space-y-3 ${ig.is_enabled ? 'border-background-secondary' : 'border-background-secondary opacity-70'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{ig.logo_emoji}</span>
                <div>
                  <div className="text-sm font-medium text-content-primary">{ig.display_name}</div>
                  <div className="text-[10px] text-content-tertiary capitalize">{ig.category}</div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ig.is_enabled ? 'bg-surface-positive text-content-positive' : 'bg-background-secondary text-content-secondary'}`}>
                  {ig.is_enabled ? 'ENABLED' : 'DISABLED'}
                </span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${HEALTH_COLORS[ig.health_status] ?? 'bg-background-secondary text-content-secondary'}`}>
                  {ig.health_status}
                </span>
              </div>
            </div>
            {ig.api_key_masked && <div className="text-xs text-content-tertiary font-mono truncate">{ig.api_key_masked}</div>}
            <div className="flex gap-2">
              {isSuperAdmin && <button onClick={() => setEditing(ig)} className="flex-1 text-xs border border-background-secondary rounded px-2 py-1 text-content-secondary hover:bg-background-secondary">Configure</button>}
              <button onClick={() => healthCheck(ig.integration_key)} disabled={healthChecking === ig.integration_key}
                className="flex-1 text-xs border border-background-secondary rounded px-2 py-1 text-content-secondary hover:bg-background-secondary disabled:opacity-50">
                {healthChecking === ig.integration_key ? '…' : 'Health Check'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── 20.5 Notification Templates ──────────────────────────────────────────────
const TemplatesSection: React.FC<{ base: string; headers: Record<string, string>; isSuperAdmin: boolean }> = ({ base, headers, isSuperAdmin }) => {
  const [templates, setTemplates] = useState<NotifTemplate[]>([]);
  const [channel, setChannel] = useState('');
  const [editing, setEditing] = useState<Partial<NotifTemplate> | null>(null);

  const fetchTemplates = useCallback(async () => {
    const p = channel ? `?channel=${channel}` : '';
    const res = await fetch(`${base}/templates${p}`, { headers });
    if (res.ok) { const d = await res.json(); setTemplates(d.templates || []); }
  }, [channel]);

  const save = async () => {
    if (!editing) return;
    await fetch(`${base}/templates`, { method: 'POST', headers, body: JSON.stringify(editing) });
    setEditing(null); fetchTemplates();
  };

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div><h2 className="text-lg font-bold text-content-primary">Notification Templates</h2><p className="text-sm text-content-tertiary">Push, SMS, Email, WhatsApp with variable substitution</p></div>
        <div className="flex gap-1">
          {['', 'PUSH', 'SMS', 'EMAIL', 'WHATSAPP'].map(c => (
            <button key={c} onClick={() => setChannel(c)} className={`px-2.5 py-1 rounded text-xs border ${channel === c ? 'bg-accent text-white border-accent' : 'bg-background-primary border-background-secondary text-content-secondary'}`}>{c || 'All'}</button>
          ))}
        </div>
        {isSuperAdmin && <button onClick={() => setEditing({ channel: 'PUSH', language_code: 'en', is_active: true, variables: [] })} className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">+ Template</button>}
      </div>

      {editing && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
          <div className="text-sm font-semibold text-content-primary">Template Editor</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { label: 'Key', k: 'template_key', mono: true }, { label: 'Name', k: 'name' },
              { label: 'Event Trigger', k: 'event_trigger' },
            ].map(f => (
              <div key={f.k}>
                <label className="text-xs text-content-tertiary">{f.label}</label>
                <input value={String((editing as any)[f.k] ?? '')} onChange={e => setEditing({ ...editing, [f.k]: e.target.value })}
                  className={`mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent ${f.mono ? 'font-mono' : ''}`} />
              </div>
            ))}
            <div>
              <label className="text-xs text-content-tertiary">Channel</label>
              <select value={editing.channel || 'PUSH'} onChange={e => setEditing({ ...editing, channel: e.target.value })}
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
                {['PUSH','SMS','EMAIL','WHATSAPP'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          {(editing.channel === 'PUSH' || editing.channel === 'EMAIL') && (
            <div><label className="text-xs text-content-tertiary">Title Template</label><input value={editing.title_template || ''} onChange={e => setEditing({ ...editing, title_template: e.target.value })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" /></div>
          )}
          <div><label className="text-xs text-content-tertiary">Body Template (use {'{{variable}}'} for substitution)</label>
            <textarea value={editing.body_template || ''} onChange={e => setEditing({ ...editing, body_template: e.target.value })} rows={4}
              className="mt-1 w-full border border-background-secondary rounded px-3 py-2 text-sm font-mono bg-background-primary text-content-primary resize-none focus:outline-none focus:ring-1 focus:ring-accent" />
          </div>
          <div className="flex gap-2">
            <button onClick={save} className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Save</button>
            <button onClick={() => setEditing(null)} className="px-4 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {templates.map(t => (
          <div key={t.id} className="bg-background-primary rounded-xl border border-background-secondary p-4 flex items-start gap-3">
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${CHANNEL_COLORS[t.channel] ?? 'bg-background-secondary text-content-secondary'}`}>{t.channel}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-content-primary">{t.name}</span>
                <span className="text-xs text-content-tertiary font-mono">{t.template_key}</span>
                {!t.is_active && <span className="text-[10px] bg-background-secondary text-content-secondary px-1.5 py-0.5 rounded">inactive</span>}
              </div>
              {t.title_template && <div className="text-xs text-content-secondary mt-0.5">Title: <span className="font-medium">{t.title_template}</span></div>}
              <div className="text-xs text-content-tertiary mt-0.5 truncate">{t.body_template}</div>
              {t.variables.length > 0 && (
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {t.variables.map(v => <span key={v} className="text-[10px] font-mono border border-background-secondary rounded px-1.5 py-0.5 text-content-tertiary">{`{{${v}}}`}</span>)}
                </div>
              )}
            </div>
            {isSuperAdmin && <button onClick={() => setEditing(t)} className="text-xs text-accent hover:underline shrink-0">Edit</button>}
          </div>
        ))}
      </div>
    </div>
  );
};

// ── 20.6 Cancellation Rules ───────────────────────────────────────────────────
// Read-only display columns for the cancellation-rules DataTable. The per-row
// action buttons (Edit / Disable / Enable, gated by isSuperAdmin) are appended
// inside the component since they depend on component state/handlers.
const CANCEL_RULE_COLUMNS: ColumnDef<CancelRule>[] = [
  { key: 'rule_name', header: 'Rule', render: (v) => <span className="text-xs font-medium text-content-primary">{String(v)}</span> },
  { key: 'applies_to', header: 'Applies To', render: (v) => <span className="text-xs text-content-secondary">{String(v)}</span> },
  {
    key: 'is_active', header: 'Status',
    render: (_v, r) => <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${r.is_active ? 'bg-surface-positive text-content-positive' : 'bg-background-secondary text-content-secondary'}`}>{r.is_active ? 'ON' : 'OFF'}</span>,
  },
  {
    key: 'minutes_elapsed_min', header: 'Time Window', type: 'numeric',
    render: (_v, r) => <span className="text-xs text-content-tertiary font-mono">{r.minutes_elapsed_min}–{r.minutes_elapsed_max === 999999 ? '∞' : r.minutes_elapsed_max}m</span>,
  },
  {
    key: 'cancellation_fee_pct', header: 'Fee', type: 'numeric',
    render: (_v, r) => <span className="text-xs font-mono">{r.cancellation_fee_pct > 0 ? `${r.cancellation_fee_pct}%` : r.cancellation_fee_fixed_paise > 0 ? `₹${r.cancellation_fee_fixed_paise / 100}` : '—'}</span>,
  },
  {
    key: 'refund_pct', header: 'Refund', type: 'numeric',
    render: (v) => <span className="text-xs font-mono">{Number(v)}%</span>,
  },
  { key: 'party_at_fault', header: 'Fault', render: (v) => <span className="text-xs text-content-tertiary">{String(v)}</span> },
];

const CancelRulesSection: React.FC<{ base: string; headers: Record<string, string>; isSuperAdmin: boolean }> = ({ base, headers, isSuperAdmin }) => {
  const [rules, setRules] = useState<CancelRule[]>([]);
  const [editing, setEditing] = useState<Partial<CancelRule> | null>(null);

  const fetchRules = useCallback(async () => {
    const res = await fetch(`${base}/cancellation-rules`, { headers });
    if (res.ok) { const d = await res.json(); setRules(d.rules || []); }
  }, []);

  const save = async () => {
    if (!editing) return;
    const method = editing.id ? 'PATCH' : 'POST';
    const url = editing.id ? `${base}/cancellation-rules/${editing.id}` : `${base}/cancellation-rules`;
    await fetch(url, { method, headers, body: JSON.stringify(editing) });
    setEditing(null); fetchRules();
  };

  const toggle = async (rule: CancelRule) => {
    await fetch(`${base}/cancellation-rules/${rule.id}`, { method: 'PATCH', headers, body: JSON.stringify({ ...rule, is_active: !rule.is_active }) });
    fetchRules();
  };

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const columns: ColumnDef<CancelRule>[] = [
    ...CANCEL_RULE_COLUMNS,
    {
      key: 'actions', header: '', type: 'actions',
      render: (_v, row) => (
        isSuperAdmin ? (
          <div className="flex gap-2 justify-end">
            <button onClick={(e) => { e.stopPropagation(); setEditing(row); }} className="text-xs text-accent hover:underline">Edit</button>
            <button onClick={(e) => { e.stopPropagation(); toggle(row); }} className="text-xs text-content-tertiary hover:text-content-secondary">{row.is_active ? 'Disable' : 'Enable'}</button>
          </div>
        ) : null
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-bold text-content-primary">Cancellation & Refund Rules</h2><p className="text-sm text-content-tertiary">Rules engine evaluated in priority order</p></div>
        {isSuperAdmin && <button onClick={() => setEditing({ applies_to: 'RIDER', trip_status_at_cancel: 'CREATED', minutes_elapsed_min: 0, minutes_elapsed_max: 999999, cancellation_fee_pct: 0, cancellation_fee_fixed_paise: 0, refund_pct: 100, party_at_fault: 'NONE', is_active: true, priority: 0 })} className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">+ Rule</button>}
      </div>

      {editing && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
          <div className="text-sm font-semibold text-content-primary">{editing.id ? 'Edit' : 'New'} Cancellation Rule</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="col-span-2 md:col-span-3"><label className="text-xs text-content-tertiary">Rule Name</label><input value={editing.rule_name || ''} onChange={e => setEditing({ ...editing, rule_name: e.target.value })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" /></div>
            {[
              { label: 'Applies To', k: 'applies_to', type: 'select', options: ['RIDER','DRIVER','BOTH'] },
              { label: 'Trip Status', k: 'trip_status_at_cancel', type: 'text' },
              { label: 'Min Minutes', k: 'minutes_elapsed_min', type: 'number' },
              { label: 'Max Minutes', k: 'minutes_elapsed_max', type: 'number' },
              { label: 'Fee %', k: 'cancellation_fee_pct', type: 'number' },
              { label: 'Fee Fixed (paise)', k: 'cancellation_fee_fixed_paise', type: 'number' },
              { label: 'Refund %', k: 'refund_pct', type: 'number' },
              { label: 'Party at Fault', k: 'party_at_fault', type: 'select', options: ['RIDER','DRIVER','PLATFORM','NONE'] },
              { label: 'Priority', k: 'priority', type: 'number' },
            ].map(f => (
              <div key={f.k}>
                <label className="text-xs text-content-tertiary">{f.label}</label>
                {f.type === 'select'
                  ? <select value={String((editing as any)[f.k] ?? '')} onChange={e => setEditing({ ...editing, [f.k]: e.target.value })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
                      {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  : <input type="number" value={String((editing as any)[f.k] ?? '')} onChange={e => setEditing({ ...editing, [f.k]: f.k.includes('pct') || f.k.includes('paise') ? Number(e.target.value) : Number(e.target.value) })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none" />}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={save} className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Save</button>
            <button onClick={() => setEditing(null)} className="px-4 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">Cancel</button>
          </div>
        </div>
      )}

      <DataTable
        columns={columns as unknown as ColumnDef<CancelRuleRow>[]}
        data={rules as unknown as CancelRuleRow[]}
        rowKey={(r) => String(r.id)}
      />
    </div>
  );
};

// ── 20.7 Rating Rules ────────────────────────────────────────────────────────
const RatingRulesSection: React.FC<{ base: string; headers: Record<string, string>; isSuperAdmin: boolean }> = ({ base, headers, isSuperAdmin }) => {
  const [rules, setRules] = useState<RatingRule[]>([]);
  const [editing, setEditing] = useState<Partial<RatingRule> | null>(null);

  const fetchRules = useCallback(async () => {
    const res = await fetch(`${base}/rating-rules`, { headers });
    if (res.ok) { const d = await res.json(); setRules(d.rules || []); }
  }, []);

  const save = async () => {
    if (!editing) return;
    const method = editing.id ? 'PATCH' : 'POST';
    const url = editing.id ? `${base}/rating-rules/${editing.id}` : `${base}/rating-rules`;
    await fetch(url, { method, headers, body: JSON.stringify(editing) });
    setEditing(null); fetchRules();
  };

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const THRESHOLD_COLORS: Record<string, string> = { WARNING: 'bg-surface-warning text-content-warning', SUSPEND: 'bg-surface-warning text-content-warning', BAN: 'bg-surface-negative text-content-negative' };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-bold text-content-primary">Rating Threshold Rules</h2><p className="text-sm text-content-tertiary">Auto-warning, suspend, ban triggers based on rating</p></div>
        {isSuperAdmin && <button onClick={() => setEditing({ applies_to: 'DRIVER', threshold_type: 'WARNING', min_trips_required: 10, rating_below: 4.0, action: 'SEND_WARNING', cooldown_days: 0, is_active: true })} className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">+ Rule</button>}
      </div>

      {editing && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
          <div className="text-sm font-semibold text-content-primary">Rating Threshold Rule</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { label: 'Applies To', k: 'applies_to', type: 'select', options: ['DRIVER','RIDER'] },
              { label: 'Type', k: 'threshold_type', type: 'select', options: ['WARNING','SUSPEND','BAN'] },
              { label: 'Action', k: 'action', type: 'select', options: ['SEND_WARNING','AUTO_SUSPEND','AUTO_BAN'] },
              { label: 'Min Trips Required', k: 'min_trips_required', type: 'number' },
              { label: 'Rating Below', k: 'rating_below', type: 'number' },
              { label: 'Cooldown (days)', k: 'cooldown_days', type: 'number' },
            ].map(f => (
              <div key={f.k}>
                <label className="text-xs text-content-tertiary">{f.label}</label>
                {f.type === 'select'
                  ? <select value={String((editing as any)[f.k] ?? '')} onChange={e => setEditing({ ...editing, [f.k]: e.target.value })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
                      {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  : <input type="number" step={f.k === 'rating_below' ? '0.1' : '1'} value={String((editing as any)[f.k] ?? '')} onChange={e => setEditing({ ...editing, [f.k]: Number(e.target.value) })} className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none" />}
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.is_active ?? true} onChange={e => setEditing({ ...editing, is_active: e.target.checked })} /> Active</label>
          <div className="flex gap-2">
            <button onClick={save} className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Save</button>
            <button onClick={() => setEditing(null)} className="px-4 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {['DRIVER', 'RIDER'].map(entity => (
          <div key={entity} className="bg-background-primary rounded-xl border border-background-secondary overflow-hidden">
            <div className="px-4 py-3 border-b border-background-secondary text-sm font-semibold text-content-primary">{entity} Rules</div>
            {rules.filter(r => r.applies_to === entity).map(rule => (
              <div key={rule.id} className={`flex items-center gap-3 px-4 py-3 border-b border-background-secondary/50 ${!rule.is_active ? 'opacity-50' : ''}`}>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${THRESHOLD_COLORS[rule.threshold_type] ?? 'bg-background-secondary text-content-secondary'}`}>{rule.threshold_type}</span>
                <div className="flex-1">
                  <div className="text-sm font-mono text-content-primary">Rating &lt; {rule.rating_below.toFixed(2)}</div>
                  <div className="text-xs text-content-tertiary">{rule.action} · {rule.min_trips_required}+ trips · {rule.cooldown_days}d cooldown</div>
                </div>
                {isSuperAdmin && <button onClick={() => setEditing(rule)} className="text-xs text-accent hover:underline">Edit</button>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
