import React, { useState, useEffect, useCallback, useRef } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';

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
  [key: string]: unknown;
}
interface CMSAsset {
  id: number; asset_type: string; platform: string; title: string;
  file_url: string; thumbnail_url: string; min_app_version: string;
  status: string; display_order: number; created_at: string;
}

const LANGUAGES = ['en', 'hi', 'bn', 'ta', 'te', 'mr'];

// Minimal Markdown → HTML renderer (headings, bold, italic, links, lists, code).
// Escapes HTML first so user content can't inject markup, then applies inline rules.
const renderMarkdown = (md: string): string => {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) => esc(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" class="text-accent underline" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code class="bg-background-secondary px-1 rounded font-mono text-[12px]">$1</code>');
  const lines = md.split('\n');
  const html: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { html.push('</ul>'); inList = false; } };
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const lvl = h[1].length;
      const size = lvl === 1 ? 'text-lg font-bold' : lvl === 2 ? 'text-base font-bold' : 'text-sm font-semibold';
      html.push(`<h${lvl} class="${size} text-content-primary mt-3 mb-1">${inline(h[2])}</h${lvl}>`);
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { html.push('<ul class="list-disc pl-5 space-y-0.5">'); inList = true; }
      html.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      html.push(`<p class="my-1">${inline(line)}</p>`);
    }
  }
  closeList();
  return html.join('');
};
const PAGE_TYPE_ICONS: Record<string, string> = {
  POLICY: '📜', FAQ: '❓', HELP_ARTICLE: '💡', ONBOARDING: '👋', BANNER: '📢', SPLASH: '🎨',
};
const STATUS_COLORS: Record<string, string> = {
  PUBLISHED: 'bg-surface-positive text-content-positive',
  DRAFT: 'bg-surface-warning text-content-warning',
  ARCHIVED: 'bg-background-secondary text-content-secondary',
};

type Tab = 'pages' | 'i18n' | 'assets';

// I18NString carries a numeric id; DataTable's row constraint expects an optional string id,
// so the table operates over this id-widened view (rowKey supplies the actual key).
type I18NRow = Omit<I18NString, 'id'> & { id?: string };

// Read-only data columns for the i18n strings DataTable (Edit action appended in-component).
const I18N_COLUMNS: ColumnDef<I18NRow>[] = [
  {
    key: 'key_name', header: 'Key',
    render: (v) => <span className="font-mono text-mono-small text-content-secondary">{String(v)}</span>,
  },
  {
    key: 'namespace', header: 'Namespace',
    render: (v) => <span className="text-xs text-content-tertiary">{String(v)}</span>,
  },
  {
    key: 'language_code', header: 'Lang',
    render: (v) => (
      <span className="text-[10px] font-mono border border-background-secondary rounded px-1.5 py-0.5 text-content-tertiary">
        {String(v).toUpperCase()}
      </span>
    ),
  },
  {
    key: 'value', header: 'Value',
    render: (v) => <span className="text-content-secondary max-w-xs truncate block">{String(v)}</span>,
  },
];

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
        <h1 className="text-xl font-bold text-content-primary">Content Management (CMS)</h1>
        <p className="text-sm text-content-tertiary">Manage app pages, localization strings, and visual assets</p>
      </div>
      <div className="flex gap-1 border-b border-background-secondary">
        {(['pages', 'i18n', 'assets'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
              tab === t ? 'border-accent text-accent' : 'border-transparent text-content-secondary hover:text-content-primary'
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
  const [showPreview, setShowPreview] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const restoreVersion = async (v: ContentVersion) => {
    if (!selected) return;
    if (!confirm(`Restore version v${v.version}? This saves it as the new current version.`)) return;
    setSaving(true);
    const res = await fetch(`${base}/pages/${selected.id}/content`, {
      method: 'POST', headers,
      body: JSON.stringify({ language_code: activeLang, content_body: v.content_body }),
    });
    if (res.ok) {
      setEditBody(v.content_body);
      setMsg(`Restored v${v.version} ✓`);
      setShowHistory(false);
      openPage(selected);
    } else setMsg('Error restoring');
    setSaving(false);
  };

  // Wrap or insert markdown around the current textarea selection (toolbar buttons).
  const applyMarkdown = (kind: 'bold' | 'italic' | 'heading' | 'link') => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = editBody.slice(start, end);
    let inserted: string;
    let caretOffset = 0;
    switch (kind) {
      case 'bold': inserted = `**${sel || 'bold text'}**`; caretOffset = 2; break;
      case 'italic': inserted = `*${sel || 'italic text'}*`; caretOffset = 1; break;
      case 'heading': inserted = `## ${sel || 'Heading'}`; caretOffset = 3; break;
      case 'link': inserted = `[${sel || 'link text'}](https://)`; caretOffset = 1; break;
    }
    const next = editBody.slice(0, start) + inserted + editBody.slice(end);
    setEditBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = sel ? start + inserted.length : start + caretOffset;
      ta.setSelectionRange(pos, sel ? pos : pos + (sel ? 0 : (inserted.length - caretOffset * 2)));
    });
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
      <div className="bg-background-primary rounded-xl border border-background-secondary overflow-hidden">
        <div className="px-4 py-3 border-b border-background-secondary flex items-center gap-2">
          <input type="text" placeholder="Filter pages…" value={filter} onChange={e => setFilter(e.target.value)}
            className="flex-1 text-sm bg-transparent outline-none text-content-primary" />
        </div>
        <div className="divide-y divide-background-secondary/50">
          {filtered.map(p => (
            <button key={p.id} onClick={() => openPage(p)}
              className={`w-full text-left px-4 py-3 hover:bg-background-secondary/30 transition-colors ${selected?.id === p.id ? 'bg-accent/5 border-l-2 border-accent' : ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-content-primary">
                    {PAGE_TYPE_ICONS[p.page_type] ?? '📄'} {p.title}
                  </div>
                  <div className="text-xs text-content-tertiary font-mono">{p.slug}</div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLORS[p.status] ?? 'bg-background-secondary text-content-secondary'}`}>
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
          <div className="bg-background-primary rounded-xl border border-background-secondary p-10 text-center text-content-tertiary text-sm">
            Select a page to edit its content
          </div>
        ) : (
          <>
            <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-semibold text-content-primary">{selected.title}</div>
                  <div className="text-xs text-content-tertiary">{selected.page_type} · {selected.slug}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={loadHistory} className="text-xs border border-background-secondary rounded px-2 py-1 text-content-secondary hover:bg-background-secondary">
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
                      activeLang === lang ? 'bg-accent text-white border-accent' : 'bg-background-primary border-background-secondary text-content-secondary hover:text-content-primary'
                    }`}>
                    {lang} {content.find(v => v.language_code === lang) ? '✓' : ''}
                  </button>
                ))}
              </div>

              {/* Markdown toolbar */}
              <div className="flex items-center gap-1 flex-wrap">
                <button type="button" onClick={() => applyMarkdown('bold')}
                  className="text-xs font-bold border border-background-secondary rounded px-2 py-1 text-content-secondary hover:bg-background-secondary" title="Bold">B</button>
                <button type="button" onClick={() => applyMarkdown('italic')}
                  className="text-xs italic border border-background-secondary rounded px-2 py-1 text-content-secondary hover:bg-background-secondary" title="Italic">I</button>
                <button type="button" onClick={() => applyMarkdown('heading')}
                  className="text-xs font-semibold border border-background-secondary rounded px-2 py-1 text-content-secondary hover:bg-background-secondary" title="Heading">H</button>
                <button type="button" onClick={() => applyMarkdown('link')}
                  className="text-xs border border-background-secondary rounded px-2 py-1 text-content-secondary hover:bg-background-secondary" title="Link">🔗 Link</button>
                <button type="button" onClick={() => setShowPreview(p => !p)}
                  className="ml-auto text-xs border border-background-secondary rounded px-2 py-1 text-content-secondary hover:bg-background-secondary">
                  {showPreview ? 'Hide Preview' : 'Show Preview'}
                </button>
              </div>

              {/* Editor + live preview */}
              <div className={`grid gap-3 ${showPreview ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                <textarea
                  ref={textareaRef}
                  value={editBody}
                  onChange={e => setEditBody(e.target.value)}
                  rows={16}
                  placeholder="Enter markdown content…"
                  className="w-full border border-background-secondary rounded-lg px-3 py-2.5 text-sm font-mono bg-background-primary text-content-primary resize-y focus:outline-none focus:ring-1 focus:ring-accent"
                />
                {showPreview && (
                  <div className="border border-background-secondary rounded-lg px-3 py-2.5 text-sm bg-background-secondary/20 text-content-primary overflow-auto"
                    style={{ minHeight: '12rem' }}>
                    {editBody.trim()
                      ? <div dangerouslySetInnerHTML={{ __html: renderMarkdown(editBody) }} />
                      : <span className="text-content-tertiary text-xs">Preview appears here…</span>}
                  </div>
                )}
              </div>

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
              <div className="bg-background-primary rounded-xl border border-background-secondary p-4">
                <div className="text-sm font-semibold text-content-primary mb-3">Version History ({activeLang.toUpperCase()})</div>
                <div className="space-y-2">
                  {history.map(v => (
                    <div key={v.id} className="flex items-center justify-between text-sm border border-background-secondary rounded-lg px-3 py-2">
                      <div>
                        <span className="font-mono text-content-secondary">v{v.version}</span>
                        {v.is_current && <span className="ml-2 bg-accent/10 text-accent text-[10px] px-1.5 py-0.5 rounded">current</span>}
                        <span className="ml-2 text-xs text-content-tertiary">{v.created_by_email}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-content-tertiary">{new Date(v.created_at).toLocaleDateString('en-IN')}</span>
                        {!v.is_current && (
                          <button onClick={() => restoreVersion(v)} disabled={saving}
                            className="text-xs text-accent hover:underline disabled:opacity-50">
                            Restore
                          </button>
                        )}
                      </div>
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
const PAGE_SIZE = 100;

const I18NTab: React.FC<{ headers: Record<string, string> }> = ({ headers }) => {
  const [strings, setStrings] = useState<I18NString[]>([]);
  const [total, setTotal] = useState(0);
  const [ns, setNs] = useState('');
  const [lang, setLang] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Partial<I18NString> | null>(null);
  const [saving, setSaving] = useState(false);

  const base = `${API_GATEWAY_BASE_URL}/api/v1/admin/cms`;

  const fetchStrings = useCallback(async () => {
    const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (ns) p.set('namespace', ns);
    if (lang) p.set('language', lang);
    if (search) p.set('search', search);
    const res = await fetch(`${base}/i18n?${p}`, { headers });
    if (res.ok) { const d = await res.json(); setStrings(d.strings || []); setTotal(d.total || 0); }
  }, [ns, lang, search, offset]);

  // Reset to first page whenever filters change.
  useEffect(() => { setOffset(0); }, [ns, lang, search]);

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
          className="border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent">
          <option value="">All namespaces</option>
          {namespaces.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={lang} onChange={e => setLang(e.target.value)}
          className="border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent">
          <option value="">All languages</option>
          {LANGUAGES.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
        </select>
        <input type="text" placeholder="Search key or value…" value={search} onChange={e => setSearch(e.target.value)}
          className="border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary w-48 focus:outline-none focus:ring-1 focus:ring-accent" />
        <span className="ml-auto text-xs text-content-tertiary">
          {total > 0 ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}` : '0'} strings
        </span>
        <button onClick={() => setEditing({ namespace: 'common', language_code: 'en', key_name: '', value: '', description: '' })}
          className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">
          + Add String
        </button>
      </div>

      {editing && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
          <div className="text-sm font-semibold text-content-primary">{editing.id ? 'Edit' : 'New'} i18n String</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-content-tertiary">Key</label>
              <input value={editing.key_name || ''} onChange={e => setEditing({ ...editing, key_name: e.target.value })}
                placeholder="e.g. book_a_ride"
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div>
              <label className="text-xs text-content-tertiary">Namespace</label>
              <input value={editing.namespace || ''} onChange={e => setEditing({ ...editing, namespace: e.target.value })}
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div>
              <label className="text-xs text-content-tertiary">Language</label>
              <select value={editing.language_code || 'en'} onChange={e => setEditing({ ...editing, language_code: e.target.value })}
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
                {LANGUAGES.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-content-tertiary">Value</label>
              <input value={editing.value || ''} onChange={e => setEditing({ ...editing, value: e.target.value })}
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
          </div>
          <div>
            <label className="text-xs text-content-tertiary">Description</label>
            <input value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })}
              className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" />
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditing(null)} className="px-4 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      <DataTable<I18NRow>
        columns={[
          ...I18N_COLUMNS,
          {
            key: 'actions', header: '', type: 'actions', width: 64,
            render: (_v, s) => (
              <button
                onClick={(e) => { e.stopPropagation(); setEditing(s as unknown as I18NString); }}
                className="text-xs text-accent hover:underline"
              >
                Edit
              </button>
            ),
          },
        ]}
        data={strings as unknown as I18NRow[]}
        rowKey={(s) => String(s.id)}
        emptyState={<span className="text-paragraph-small text-content-tertiary">No strings found.</span>}
      />

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <button
            onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
            disabled={offset === 0}
            className="px-3 py-1.5 border border-background-secondary rounded-lg text-content-secondary hover:bg-background-secondary disabled:opacity-40 disabled:cursor-not-allowed">
            ← Prev
          </button>
          <span className="text-content-tertiary">
            Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
          </span>
          <button
            onClick={() => setOffset(o => o + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
            className="px-3 py-1.5 border border-background-secondary rounded-lg text-content-secondary hover:bg-background-secondary disabled:opacity-40 disabled:cursor-not-allowed">
            Next →
          </button>
        </div>
      )}
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
          className="border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
          <option value="">All types</option>
          {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={() => setShowAdd(!showAdd)}
          className="ml-auto px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">
          + Add Asset
        </button>
      </div>

      {showAdd && (
        <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-3">
          <div className="text-sm font-semibold text-content-primary">New Asset</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-content-tertiary">Type</label>
              <select value={newAsset.asset_type} onChange={e => setNewAsset({ ...newAsset, asset_type: e.target.value })}
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
                {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-content-tertiary">Platform</label>
              <select value={newAsset.platform} onChange={e => setNewAsset({ ...newAsset, platform: e.target.value })}
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
                {['ALL', 'iOS', 'ANDROID'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-content-tertiary">Title</label>
              <input value={newAsset.title} onChange={e => setNewAsset({ ...newAsset, title: e.target.value })}
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div>
              <label className="text-xs text-content-tertiary">Min App Version (optional)</label>
              <input value={newAsset.min_app_version} onChange={e => setNewAsset({ ...newAsset, min_app_version: e.target.value })}
                placeholder="e.g. 3.2.0"
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-content-tertiary">File URL</label>
              <input value={newAsset.file_url} onChange={e => setNewAsset({ ...newAsset, file_url: e.target.value })}
                placeholder="https://cdn.driversfor-u.in/assets/..."
                className="mt-1 w-full border border-background-secondary rounded px-3 py-1.5 text-sm bg-background-primary text-content-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={addAsset} className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">Save</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-1.5 border border-background-secondary rounded-lg text-sm text-content-secondary hover:bg-background-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {assets.length === 0 && (
          <div className="col-span-full text-center py-10 text-content-tertiary text-sm">No assets found. Add one above.</div>
        )}
        {assets.map(a => (
          <div key={a.id} className={`bg-background-primary rounded-xl border overflow-hidden ${a.status === 'INACTIVE' ? 'border-background-secondary opacity-60' : 'border-background-secondary'}`}>
            <div className="aspect-video bg-background-secondary flex items-center justify-center text-4xl">
              {a.thumbnail_url ? <img src={a.thumbnail_url} className="w-full h-full object-cover" alt={a.title} /> : '🖼️'}
            </div>
            <div className="p-3">
              <div className="text-xs font-medium text-content-primary truncate">{a.title || a.asset_type}</div>
              <div className="text-[10px] text-content-tertiary mt-0.5">{a.asset_type} · {a.platform}</div>
              {a.min_app_version && <div className="text-[10px] text-content-tertiary">v{a.min_app_version}+</div>}
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
