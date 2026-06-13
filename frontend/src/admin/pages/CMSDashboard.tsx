import React, { useState, useEffect, useCallback } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

// ── Types ────────────────────────────────────────────────────────────────────
interface CMSPage {
  id: number; slug: string; title: string; page_type: string;
  status: string; min_app_version: string; created_by_email: string;
  created_at: string; updated_at: string; published_at: string | null;
}
interface ContentVersion {
  id: number; page_id: number; language_code: string;
  content_body: string; version: number; is_current: boolean;
  created_by_email: string; created_at: string;
}
interface I18NString {
  id: number; key_name: string; namespace: string; language_code: string;
  value: string; description: string; updated_at: string;
}
interface CMSAsset {
  id: number; asset_type: string; platform: string; title: string;
  file_url: string; thumbnail_url: string; min_app_version: string;
  status: string; display_order: number; created_at: string;
}

const LANGUAGES = ['en', 'hi', 'bn', 'ta', 'te', 'mr'];
const PAGE_TYPE_ICONS: Record<string, string> = {
  POLICY: '📜', FAQ: '❓', HELP_ARTICLE: '💡', ONBOARDING: '👋', BANNER: '📢', SPLASH: '🎨',
};
const STATUS_COLORS: Record<string, string> = {
  PUBLISHED: 'bg-surface-positive text-content-positive',
  DRAFT: 'bg-surface-warning text-content-warning',
  ARCHIVED: 'bg-background-secondary text-content-secondary',
};

type Tab = 'pages' | 'i18n' | 'assets';

// ── Component ────────────────────────────────────────────────────────────────
export const CMSDashboard: React.FC = () => {
  const [tab, setTab] = useState<Tab>('pages');
  const role = localStorage.getItem('admin_role') || 'SUPER_ADMIN';
  const email = localStorage.getItem('admin_email') || '';
  const headers = {
    'X-Admin-Role': role,
    'X-Admin-Email': email, 'Content-Type': 'application/json',
  };

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">Content Management (CMS)</h1>
        <p className="text-sm text-mute">Manage app pages, localization strings, and visual assets</p>
      </div>
      <div className="flex gap-1 border-b border-canvas-soft">
        {(['pages', 'i18n', 'assets'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
              tab === t ? 'border-accent text-accent' : 'border-transparent text-body hover:text-ink'
            }`}>
            {t === 'pages' ? 'Content Pages' : t === 'i18n' ? 'i18n Strings' : 'Assets'}
          </button>
        ))}
      </div>
      {tab === 'pages' && <PagesTab headers={headers} />}
      {tab === 'i18n' && <I18NTab headers={headers} />}
      {tab === 'assets' && <AssetsTab headers={headers} />}
    </div>
  );
};

// ── Pages Tab ────────────────────────────────────────────────────────────────
const PagesTab: React.FC<{ headers: Record<string, string> }> = ({ headers }) => {
  const [pages, setPages] = useState<CMSPage[]>([]);
  const [selected, setSelected] = useState<CMSPage | null>(null);
  const [content, setContent] = useState<ContentVersion[]>([]);
  const [activeLang, setActiveLang] = useState('en');
  const [editBody, setEditBody] = useState('');
  const [history, setHistory] = useState<ContentVersion[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const base = `${API_GATEWAY_BASE_URL}/api/v1/admin/cms`;

  const fetchPages = useCallback(async () => {
    const res = await fetch(`${base}/pages`, { headers });
    if (res.ok) { const d = await res.json(); setPages(d.pages || []); }
  }, []);

  const openPage = async (page: CMSPage) => {
    setSelected(page); setShowHistory(false); setMsg(null);
    const res = await fetch(`${base}/pages/${page.id}`, { headers });
    if (res.ok) {
      const d = await res.json();
      setContent(d.content || []);
      const cur = (d.content || []).find((v: ContentVersion) => v.language_code === activeLang);
      setEditBody(cur?.content_body ?? '');
    }
  };

  const loadHistory = async () => {
    if (!selected) return;
    const res = await fetch(`${base}/pages/${selected.id}/history?language=${activeLang}`, { headers });
    if (res.ok) { const d = await res.json(); setHistory(d.versions || []); setShowHistory(true); }
  };

  const saveContent = async () => {
    if (!selected) return;
    setSaving(true);
    const res = await fetch(`${base}/pages/${selected.id}/content`, {
      method: 'POST', headers,
      body: JSON.stringify({ language_code: activeLang, content_body: editBody }),
    });
    if (res.ok) { setMsg('Saved ✓'); fetchPages(); }
    else setMsg('Error saving');
    setSaving(false);
  };

  const publishPage = async () => {
    if (!selected) return;
    const res = await fetch(`${base}/pages/${selected.id}/publish`, { method: 'POST', headers });
    if (res.ok) { setMsg('Published ✓'); fetchPages(); openPage({ ...selected, status: 'PUBLISHED' }); }
  };

  useEffect(() => { fetchPages(); }, [fetchPages]);
  useEffect(() => {
    const cur = content.find(v => v.language_code === activeLang);
    setEditBody(cur?.content_body ?? '');
  }, [activeLang, content]);

  const filtered = pages.filter(p =>
    !filter || p.title.toLowerCase().includes(filter.toLowerCase()) ||
    p.page_type.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Page list */}
      <div className="bg-canvas rounded-xl border border-canvas-soft overflow-hidden">
        <div className="px-4 py-3 border-b border-canvas-soft flex items-center gap-2">
          <input type="text" placeholder="Filter pages…" value={filter} onChange={e => setFilter(e.target.value)}
            className="flex-1 text-sm bg-transparent outline-none text-ink" />
        </div>
        <div className="divide-y divide-canvas-soft/50">
          {filtered.map(p => (
            <button key={p.id} onClick={() => openPage(p)}
              className={`w-full text-left px-4 py-3 hover:bg-canvas-soft/30 transition-colors ${selected?.id === p.id ? 'bg-accent/5 border-l-2 border-accent' : ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-ink">
                    {PAGE_TYPE_ICONS[p.page_type] ?? '📄'} {p.title}
                  </div>
                  <div className="text-xs text-mute font-mono">{p.slug}</div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLORS[p.status] ?? 'bg-canvas-soft text-body'}`}>
                  {p.status}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="lg:col-span-2 space-y-4">
        {!selected ? (
          <div className="bg-canvas rounded-xl border border-canvas-soft p-10 text-center text-mute text-sm">
            Select a page to edit its content
          </div>
        ) : (
          <>
            <div className="bg-canvas rounded-xl border border-canvas-soft p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-semibold text-ink">{selected.title}</div>
                  <div className="text-xs text-mute">{selected.page_type} · {selected.slug}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={loadHistory} className="text-xs border border-canvas-soft rounded px-2 py-1 text-body hover:bg-canvas-soft">
                    History
                  </button>
                  {selected.status !== 'PUBLISHED' && (
                    <button onClick={publishPage} className="text-xs bg-surface-positive0 text-white rounded px-3 py-1 hover:bg-positive-400">
                      Publish
                    </button>
                  )}
                </div>
              </div>

              {/* Language tabs */}
              <div className="flex gap-1 flex-wrap">
                {LANGUAGES.map(lang => (
                  <button key={lang} onClick={() => setActiveLang(lang)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors uppercase ${
                      activeLang === lang ? 'bg-accent text-white border-accent' : 'bg-canvas border-canvas-soft text-body hover:text-ink'
                    }`}>
                    {lang} {content.find(v => v.language_code === lang) ? '✓' : ''}
                  </button>
                ))}
              </div>

              <textarea
                value={editBody}
                onChange={e => setEditBody(e.target.value)}
                rows={16}
                placeholder="Enter markdown content…"
                className="w-full border border-canvas-soft rounded-lg px-3 py-2.5 text-sm font-mono bg-canvas text-ink resize-y focus:outline-none focus:ring-1 focus:ring-accent"
              />

              <div className="flex items-center gap-3">
                <button onClick={saveContent} disabled={saving}
                  className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save Version'}
                </button>
                {msg && <span className={`text-sm ${msg.startsWith('Error') ? 'text-content-negative' : 'text-content-positive'}`}>{msg}</span>}
              </div>
            </div>

            {/* Version history */}
            {showHistory && (
              <div className="bg-canvas rounded-xl border border-canvas-soft p-4">
                <div className="text-sm font-semibold text-ink mb-3">Version History ({activeLang.toUpperCase()})</div>
                <div className="space-y-2">
                  {history.map(v => (
                    <div key={v.id} className="flex items-center justify-between text-sm border border-canvas-soft rounded-lg px-3 py-2">
                      <div>
                        <span className="font-mono text-body">v{v.version}</span>
                        {v.is_current && <span className="ml-2 bg-accent/10 text-accent text-[10px] px-1.5 py-0.5 rounded">current</span>}
                        <span className="ml-2 text-xs text-mute">{v.created_by_email}</span>
                      </div>
                      <div className="text-xs text-mute">{new Date(v.created_at).toLocaleDateString('en-IN')}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ── i18n Tab ─────────────────────────────────────────────────────────────────
const I18NTab: React.FC<{ headers: Record<string, string> }> = ({ headers }) => {
  const [strings, setStrings] = useState<I18NString[]>([]);
  const [total, setTotal] = useState(0);
  const [ns, setNs] = useState('');
  const [lang, setLang] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<I18NString> | null>(null);
  const [saving, setSaving] = useState(false);

  const base = `${API_GATEWAY_BASE_URL}/api/v1/admin/cms`;

  const fetchStrings = useCallback(async () => {
    const p = new URLSearchParams({ limit: '100' });
    if (ns) p.set('namespace', ns);
    if (lang) p.set('language', lang);
    if (search) p.set('search', search);
    const res = await fetch(`${base}/i18n?${p}`, { headers });
    if (res.ok) { const d = await res.json(); setStrings(d.strings || []); setTotal(d.total || 0); }
  }, [ns, lang, search]);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    const res = await fetch(`${base}/i18n`, { method: 'POST', headers, body: JSON.stringify(editing) });
    if (res.ok) { setEditing(null); fetchStrings(); }
    setSaving(false);
  };

  useEffect(() => { fetchStrings(); }, [fetchStrings]);

  const namespaces = [...new Set(strings.map(s => s.namespace))].sort();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <select value={ns} onChange={e => setNs(e.target.value)}
          className="border border-canvas-soft rounded-lg px-3 py-1.5 text-sm bg-canvas text-ink focus:outline-none focus:ring-1 focus:ring-accent">
          <option value="">All namespaces</option>
          {namespaces.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={lang} onChange={e => setLang(e.target.value)}
          className="border border-canvas-soft rounded-lg px-3 py-1.5 text-sm bg-canvas text-ink focus:outline-none focus:ring-1 focus:ring-accent">
          <option value="">All languages</option>
          {LANGUAGES.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
        </select>
        <input type="text" placeholder="Search key or value…" value={search} onChange={e => setSearch(e.target.value)}
          className="border border-canvas-soft rounded-lg px-3 py-1.5 text-sm bg-canvas text-ink w-48 focus:outline-none focus:ring-1 focus:ring-accent" />
        <span className="ml-auto text-xs text-mute">{total} strings</span>
        <button onClick={() => setEditing({ namespace: 'common', language_code: 'en', key_name: '', value: '', description: '' })}
          className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">
          + Add String
        </button>
      </div>

      {editing && (
        <div className="bg-canvas rounded-xl border border-canvas-soft p-4 space-y-3">
          <div className="text-sm font-semibold text-ink">{editing.id ? 'Edit' : 'New'} i18n String</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-mute">Key</label>
              <input value={editing.key_name || ''} onChange={e => setEditing({ ...editing, key_name: e.target.value })}
                placeholder="e.g. book_a_ride"
                className="mt-1 w-full border border-canvas-soft rounded px-3 py-1.5 text-sm bg-canvas text-ink font-mono focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div>
              <label className="text-xs text-mute">Namespace</label>
              <input value={editing.namespace || ''} onChange={e => setEditing({ ...editing, namespace: e.target.value })}
                className="mt-1 w-full border border-canvas-soft rounded px-3 py-1.5 text-sm bg-canvas text-ink focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div>
              <label className="text-xs text-mute">Language</label>
              <select value={editing.language_code || 'en'} onChange={e => setEditing({ ...editing, language_code: e.target.value })}
                className="mt-1 w-full border border-canvas-soft rounded px-3 py-1.5 text-sm bg-canvas text-ink focus:outline-none">
                {LANGUAGES.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-mute">Value</label>
              <input value={editing.value || ''} onChange={e => setEditing({ ...editing, value: e.target.value })}
                className="mt-1 w-full border border-canvas-soft rounded px-3 py-1.5 text-sm bg-canvas text-ink focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
          </div>
          <div>
            <label className="text-xs text-mute">Description</label>
            <input value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })}
              className="mt-1 w-full border border-canvas-soft rounded px-3 py-1.5 text-sm bg-canvas text-ink focus:outline-none focus:ring-1 focus:ring-accent" />
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditing(null)} className="px-4 py-1.5 border border-canvas-soft rounded-lg text-sm text-body hover:bg-canvas-soft">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-canvas rounded-xl border border-canvas-soft overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-canvas-soft/50">
            <tr className="text-xs text-mute">
              <th className="text-left px-4 py-2.5">Key</th>
              <th className="text-left px-4 py-2.5">Namespace</th>
              <th className="text-left px-4 py-2.5">Lang</th>
              <th className="text-left px-4 py-2.5">Value</th>
              <th className="text-left px-4 py-2.5 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {strings.map(s => (
              <tr key={s.id} className="border-t border-canvas-soft/50 hover:bg-canvas-soft/20">
                <td className="px-4 py-2.5 font-mono text-xs text-body">{s.key_name}</td>
                <td className="px-4 py-2.5 text-xs text-mute">{s.namespace}</td>
                <td className="px-4 py-2.5"><span className="text-[10px] font-mono border border-canvas-soft rounded px-1.5 py-0.5 text-mute">{s.language_code.toUpperCase()}</span></td>
                <td className="px-4 py-2.5 text-body max-w-xs truncate">{s.value}</td>
                <td className="px-4 py-2.5">
                  <button onClick={() => setEditing(s)} className="text-xs text-accent hover:underline">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Assets Tab ───────────────────────────────────────────────────────────────
const AssetsTab: React.FC<{ headers: Record<string, string> }> = ({ headers }) => {
  const [assets, setAssets] = useState<CMSAsset[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newAsset, setNewAsset] = useState({ asset_type: 'ONBOARDING_SLIDE', platform: 'ALL', title: '', file_url: '', thumbnail_url: '', min_app_version: '' });

  const base = `${API_GATEWAY_BASE_URL}/api/v1/admin/cms`;

  const fetchAssets = useCallback(async () => {
    const p = new URLSearchParams();
    if (typeFilter) p.set('asset_type', typeFilter);
    const res = await fetch(`${base}/assets?${p}`, { headers });
    if (res.ok) { const d = await res.json(); setAssets(d.assets || []); }
  }, [typeFilter]);

  const addAsset = async () => {
    const res = await fetch(`${base}/assets`, { method: 'POST', headers, body: JSON.stringify(newAsset) });
    if (res.ok) { setShowAdd(false); fetchAssets(); }
  };

  const toggleStatus = async (id: number, currentStatus: string) => {
    const next = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    await fetch(`${base}/assets/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: next }) });
    fetchAssets();
  };

  useEffect(() => { fetchAssets(); }, [fetchAssets]);

  const ASSET_TYPES = ['SPLASH_SCREEN', 'ONBOARDING_SLIDE', 'APP_STORE_SCREENSHOT', 'APP_ICON', 'BANNER'];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center flex-wrap">
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="border border-canvas-soft rounded-lg px-3 py-1.5 text-sm bg-canvas text-ink focus:outline-none">
          <option value="">All types</option>
          {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={() => setShowAdd(!showAdd)}
          className="ml-auto px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">
          + Add Asset
        </button>
      </div>

      {showAdd && (
        <div className="bg-canvas rounded-xl border border-canvas-soft p-4 space-y-3">
          <div className="text-sm font-semibold text-ink">New Asset</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-mute">Type</label>
              <select value={newAsset.asset_type} onChange={e => setNewAsset({ ...newAsset, asset_type: e.target.value })}
                className="mt-1 w-full border border-canvas-soft rounded px-3 py-1.5 text-sm bg-canvas text-ink focus:outline-none">
                {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-mute">Platform</label>
              <select value={newAsset.platform} onChange={e => setNewAsset({ ...newAsset, platform: e.target.value })}
                className="mt-1 w-full border border-canvas-soft rounded px-3 py-1.5 text-sm bg-canvas text-ink focus:outline-none">
                {['ALL', 'iOS', 'ANDROID'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-mute">Title</label>
              <input value={newAsset.title} onChange={e => setNewAsset({ ...newAsset, title: e.target.value })}
                className="mt-1 w-full border border-canvas-soft rounded px-3 py-1.5 text-sm bg-canvas text-ink focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div>
              <label className="text-xs text-mute">Min App Version (optional)</label>
              <input value={newAsset.min_app_version} onChange={e => setNewAsset({ ...newAsset, min_app_version: e.target.value })}
                placeholder="e.g. 3.2.0"
                className="mt-1 w-full border border-canvas-soft rounded px-3 py-1.5 text-sm bg-canvas text-ink focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-mute">File URL</label>
              <input value={newAsset.file_url} onChange={e => setNewAsset({ ...newAsset, file_url: e.target.value })}
                placeholder="https://cdn.driversfor-u.in/assets/..."
                className="mt-1 w-full border border-canvas-soft rounded px-3 py-1.5 text-sm bg-canvas text-ink font-mono focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={addAsset} className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Save</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-1.5 border border-canvas-soft rounded-lg text-sm text-body hover:bg-canvas-soft">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {assets.length === 0 && (
          <div className="col-span-full text-center py-10 text-mute text-sm">No assets found. Add one above.</div>
        )}
        {assets.map(a => (
          <div key={a.id} className={`bg-canvas rounded-xl border overflow-hidden ${a.status === 'INACTIVE' ? 'border-canvas-soft opacity-60' : 'border-canvas-soft'}`}>
            <div className="aspect-video bg-canvas-soft flex items-center justify-center text-4xl">
              {a.thumbnail_url ? <img src={a.thumbnail_url} className="w-full h-full object-cover" alt={a.title} /> : '🖼️'}
            </div>
            <div className="p-3">
              <div className="text-xs font-medium text-ink truncate">{a.title || a.asset_type}</div>
              <div className="text-[10px] text-mute mt-0.5">{a.asset_type} · {a.platform}</div>
              {a.min_app_version && <div className="text-[10px] text-mute">v{a.min_app_version}+</div>}
              <div className="flex items-center justify-between mt-2">
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${a.status === 'ACTIVE' ? 'bg-surface-positive text-content-positive' : 'bg-background-secondary text-content-secondary'}`}>
                  {a.status}
                </span>
                <button onClick={() => toggleStatus(a.id, a.status)} className="text-[11px] text-accent hover:underline">
                  {a.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
