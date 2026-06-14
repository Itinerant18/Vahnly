import React, { useState, useEffect, useCallback } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';

// ── Types ────────────────────────────────────────────────────────────────────
interface VaultDoc {
  id: string; entity_type: string; entity_id: string;
  doc_type: string; display_name: string; file_url: string;
  file_size_bytes: number; mime_type: string; version: number;
  tags: string[]; expiry_date: string | null;
  uploaded_by_email: string; status: string;
  created_at: string; updated_at: string;
  [key: string]: unknown; // satisfies DataTable's row constraint
}
interface AccessEntry {
  id: number; document_id: string; accessed_by_email: string;
  access_type: string; ip_address: string; created_at: string;
}

const DOC_TYPES = ['DRIVING_LICENSE','RC_BOOK','INSURANCE','PUC','ID_PROOF','ADDRESS_PROOF','KYC_SELFIE','BACKGROUND_CHECK','TRIP_INVOICE','GST_INVOICE','OTHER'];
const ENTITY_TYPES = ['DRIVER','RIDER','VEHICLE','ORDER','SYSTEM'];

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-surface-positive text-content-positive',
  EXPIRED: 'bg-surface-negative text-content-negative',
  SUPERSEDED: 'bg-background-secondary text-content-secondary',
  DELETED: 'bg-surface-negative text-content-negative',
};

const MIME_ICONS: Record<string, string> = {
  'application/pdf': '📄', 'image/jpeg': '🖼', 'image/png': '🖼', 'image/jpg': '🖼',
};

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

function daysUntil(d: string | null) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

// ── Column definitions for the DataTable hero component ───────────────────────
// Factory: the leading checkbox column needs the page's bulk-select state, so
// columns are built with the current selection set + toggle handler.
const buildDocColumns = (
  selectedIds: Set<string>,
  toggleSelect: (id: string) => void,
): ColumnDef<VaultDoc>[] => [
  {
    key: '_select', header: '', width: 32,
    render: (_v, doc) => (
      <span onClick={e => { e.stopPropagation(); toggleSelect(doc.id); }}>
        <input type="checkbox" checked={selectedIds.has(doc.id)} readOnly className="rounded" />
      </span>
    ),
  },
  {
    key: 'display_name', header: 'Document',
    render: (_v, doc) => (
      <div className="flex items-center gap-2">
        <span className="text-lg">{MIME_ICONS[doc.mime_type] ?? '📁'}</span>
        <div>
          <div className="text-xs font-medium text-content-primary truncate max-w-[180px]">{doc.display_name}</div>
          <div className="text-[10px] text-content-tertiary font-mono text-mono-small">v{doc.version}</div>
        </div>
      </div>
    ),
  },
  {
    key: 'entity_type', header: 'Entity',
    render: (_v, doc) => (
      <div>
        <div className="text-xs text-content-secondary">{doc.entity_type}</div>
        <div className="text-[10px] text-content-tertiary font-mono text-mono-small">{doc.entity_id.slice(0, 8)}…</div>
      </div>
    ),
  },
  {
    key: 'doc_type', header: 'Type',
    render: (_v, doc) => <span className="text-xs text-content-secondary">{doc.doc_type}</span>,
  },
  {
    key: 'tags', header: 'Tags',
    render: (_v, doc) => (
      <div className="flex gap-1 flex-wrap">
        {doc.tags.slice(0, 3).map(t => (
          <span key={t} className="text-[10px] border border-background-secondary rounded px-1.5 py-0.5 text-content-tertiary">{t}</span>
        ))}
      </div>
    ),
  },
  {
    key: 'expiry_date', header: 'Expiry',
    render: (_v, doc) => {
      const expDays = daysUntil(doc.expiry_date);
      return doc.expiry_date ? (
        <div>
          <div className="text-xs text-content-secondary">{doc.expiry_date}</div>
          {expDays !== null && (
            <div className={`text-[10px] font-medium ${expDays <= 0 ? 'text-content-negative' : expDays <= 30 ? 'text-content-warning' : 'text-content-tertiary'}`}>
              {expDays <= 0 ? 'EXPIRED' : `${expDays}d`}
            </div>
          )}
        </div>
      ) : <span className="text-[10px] text-content-tertiary">—</span>;
    },
  },
  { key: 'status', header: 'Status', type: 'status' },
  {
    key: 'file_size_bytes', header: 'Size',
    render: (_v, doc) => <span className="text-xs text-content-tertiary">{fileSize(doc.file_size_bytes)}</span>,
  },
];

// ── Main Component ───────────────────────────────────────────────────────────
export const DocumentsVaultDashboard: React.FC = () => {
  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 30;

  // Filters
  const [search, setSearch] = useState('');
  const [entityType, setEntityType] = useState('');
  const [docType, setDocType] = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');

  // Selected doc for detail panel
  const [selected, setSelected] = useState<VaultDoc | null>(null);
  const [accessLog, setAccessLog] = useState<AccessEntry[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Tag editing
  const [editingTags, setEditingTags] = useState<string[] | null>(null);
  const [tagInput, setTagInput] = useState('');

  // Bulk select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const role = localStorage.getItem('admin_role') || 'SUPER_ADMIN';
  const email = localStorage.getItem('admin_email') || '';
  const headers = {
    'X-Admin-Role': role,
    'X-Admin-Email': email, 'Content-Type': 'application/json',
  };

  const base = `${API_GATEWAY_BASE_URL}/api/v1/admin/documents`;

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    if (search) p.set('search', search);
    if (entityType) p.set('entity_type', entityType);
    if (docType) p.set('doc_type', docType);
    if (statusFilter !== 'ALL') p.set('status', statusFilter);

    const res = await fetch(`${base}?${p}`, { headers });
    if (res.ok) { const d = await res.json(); setDocs(d.documents || []); setTotal(d.total || 0); }
    setLoading(false);
  }, [search, entityType, docType, statusFilter, page]);

  const openDetail = async (doc: VaultDoc) => {
    setSelected(doc); setDetailLoading(true); setEditingTags(null);
    const res = await fetch(`${base}/${doc.id}`, { headers });
    if (res.ok) { const d = await res.json(); setAccessLog(d.access_log || []); setSelected(d.document || doc); }
    setDetailLoading(false);
  };

  const saveTags = async () => {
    if (!selected || editingTags === null) return;
    await fetch(`${base}/${selected.id}/tags`, {
      method: 'POST', headers,
      body: JSON.stringify({ tags: editingTags }),
    });
    setEditingTags(null);
    fetchDocs();
    // refresh detail
    openDetail(selected);
  };

  const deleteDoc = async (id: string) => {
    if (!confirm('Soft-delete this document?')) return;
    const res = await fetch(`${base}/${id}`, { method: 'DELETE', headers });
    if (res.ok) { setSelected(null); fetchDocs(); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 flex gap-5 h-full min-h-0">
      {/* Left: list */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div>
          <h1 className="text-xl font-bold text-content-primary">Documents Vault</h1>
          <p className="text-sm text-content-tertiary">Centralized search, tagging, and access audit for all platform documents</p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <input type="text" placeholder="Search by name or entity ID…" value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            className="border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary w-52 focus:outline-none focus:ring-1 focus:ring-accent" />
          <select value={entityType} onChange={e => { setEntityType(e.target.value); setPage(0); }}
            className="border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
            <option value="">All entities</option>
            {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={docType} onChange={e => { setDocType(e.target.value); setPage(0); }}
            className="border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
            <option value="">All doc types</option>
            {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
            className="border border-background-secondary rounded-lg px-3 py-1.5 text-sm bg-background-primary text-content-primary focus:outline-none">
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="EXPIRED">Expired</option>
            <option value="SUPERSEDED">Superseded</option>
          </select>
          <span className="ml-auto text-xs text-content-tertiary self-center">{total.toLocaleString()} docs</span>
        </div>

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="bg-accent/5 border border-accent/20 rounded-lg px-4 py-2.5 flex items-center gap-3 text-sm">
            <span className="font-medium text-accent">{selectedIds.size} selected</span>
            <button onClick={() => setSelectedIds(new Set())} className="text-content-tertiary hover:text-content-secondary">Clear</button>
            <button className="ml-auto text-content-secondary border border-background-secondary rounded px-3 py-1 hover:bg-background-secondary">
              ↓ Bulk Download URLs
            </button>
          </div>
        )}

        {/* Doc table (DataTable hero component) */}
        <DataTable<VaultDoc>
          columns={buildDocColumns(selectedIds, toggleSelect)}
          data={docs}
          loading={loading}
          rowKey={(d) => d.id}
          onRowClick={openDetail}
          className="flex-1"
          emptyState={
            <div className="flex flex-col items-center gap-1 text-center">
              <span className="text-heading-medium text-content-secondary">No documents match this filter.</span>
            </div>
          }
        />

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 rounded-lg border border-background-secondary text-content-secondary disabled:opacity-40 hover:bg-background-secondary">
              Previous
            </button>
            <span className="text-content-tertiary">Page {page + 1} / {totalPages}</span>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 rounded-lg border border-background-secondary text-content-secondary disabled:opacity-40 hover:bg-background-secondary">
              Next
            </button>
          </div>
        )}
      </div>

      {/* Right: Detail panel */}
      <div className="w-80 shrink-0">
        <div className="bg-background-primary rounded-xl border border-background-secondary p-5 sticky top-0 space-y-4">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-48 text-content-tertiary text-sm">
              <span className="text-4xl mb-2">🗄</span>
              Select a document to inspect
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-sm text-content-primary">{selected.display_name}</div>
                  <div className="text-xs text-content-tertiary mt-0.5">{selected.doc_type}</div>
                </div>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLES[selected.status] ?? 'bg-background-secondary text-content-secondary'}`}>
                  {selected.status}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                {[
                  ['Entity', `${selected.entity_type} ${selected.entity_id.slice(0, 12)}…`],
                  ['Size', fileSize(selected.file_size_bytes)],
                  ['Version', `v${selected.version}`],
                  ['Uploaded by', selected.uploaded_by_email],
                  ['Uploaded', new Date(selected.created_at).toLocaleDateString('en-IN')],
                  ...(selected.expiry_date ? [['Expires', selected.expiry_date]] : []),
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-content-tertiary">{k}</span>
                    <span className="text-content-secondary font-mono truncate ml-2 max-w-[160px]">{v}</span>
                  </div>
                ))}
              </div>

              <div>
                <a href={selected.file_url} target="_blank" rel="noopener noreferrer"
                  className="block w-full text-center border border-background-secondary rounded-lg px-4 py-2 text-sm text-content-secondary hover:bg-background-secondary">
                  ↗ Open Document
                </a>
              </div>

              {/* Tags */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-content-tertiary uppercase tracking-wide">Tags</div>
                  <button onClick={() => { setEditingTags([...selected.tags]); setTagInput(''); }}
                    className="text-xs text-accent hover:underline">Edit</button>
                </div>
                {editingTags ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {editingTags.map(t => (
                        <span key={t} className="flex items-center gap-1 text-[11px] border border-background-secondary rounded px-1.5 py-0.5 text-content-secondary">
                          {t}
                          <button onClick={() => setEditingTags(editingTags.filter(x => x !== t))} aria-label="Remove tag" className="text-content-negative hover:text-content-negative leading-none">×</button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && tagInput.trim()) { setEditingTags([...editingTags, tagInput.trim()]); setTagInput(''); } }}
                        placeholder="Add tag…"
                        className="flex-1 border border-background-secondary rounded px-2 py-1 text-xs bg-background-primary text-content-primary focus:outline-none" />
                      <button onClick={saveTags} className="text-xs bg-accent text-white px-2 py-1 rounded">Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {selected.tags.length === 0
                      ? <span className="text-xs text-content-tertiary italic">No tags</span>
                      : selected.tags.map(t => <span key={t} className="text-[11px] border border-background-secondary rounded px-1.5 py-0.5 text-content-secondary">{t}</span>)}
                  </div>
                )}
              </div>

              {/* Access log */}
              {!detailLoading && accessLog.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-content-tertiary uppercase tracking-wide mb-2">Access Log</div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {accessLog.map(e => (
                      <div key={e.id} className="flex items-center justify-between text-[11px]">
                        <div>
                          <span className="text-content-secondary">{e.accessed_by_email.split('@')[0]}</span>
                          <span className={`ml-1 font-mono ${e.access_type === 'DELETE' ? 'text-content-negative' : 'text-content-tertiary'}`}>{e.access_type}</span>
                        </div>
                        <div className="text-content-tertiary">{new Date(e.created_at).toLocaleDateString('en-IN')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Delete */}
              <button onClick={() => deleteDoc(selected.id)}
                className="w-full text-center border border-negative-400 rounded-lg px-4 py-2 text-sm text-content-negative hover:bg-surface-negative">
                Soft Delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
