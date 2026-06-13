import React, { useState, useMemo, useCallback } from 'react';
import { AdminBadge } from './AdminBadge';

// ── Types ──────────────────────────────────────────────────────────────────

type ColType = 'text' | 'numeric' | 'currency' | 'status' | 'avatar' | 'date' | 'actions' | 'badge' | 'custom';

type SortDir = 'asc' | 'desc' | null;

export interface ColumnDef<T = Record<string, unknown>> {
  key: string;
  header: string;
  type?: ColType;
  sortable?: boolean;
  width?: number | string;
  render?: (value: unknown, row: T) => React.ReactNode;
  className?: string;
}

export interface BulkAction {
  label: string;
  onClick: (selectedIds: string[]) => void;
  variant?: 'default' | 'destructive';
}

export interface DataTableProps<T extends { id?: string; [key: string]: unknown }> {
  columns: ColumnDef<T>[];
  data: T[];
  loading?: boolean;
  selectable?: boolean;
  bulkActions?: BulkAction[];
  onRowClick?: (row: T) => void;
  emptyState?: React.ReactNode;
  exportable?: boolean;
  rowKey?: (row: T) => string;
  className?: string;
  stickyHeader?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return iso; }
}

// ── Skeleton row ───────────────────────────────────────────────────────────

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded-sm bg-background-tertiary animate-pulse" style={{ width: `${50 + (i * 17) % 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ── Sort icon ──────────────────────────────────────────────────────────────

function SortIcon({ dir }: { dir: SortDir }) {
  return (
    <span className="inline-flex flex-col ml-1 opacity-60">
      <svg width="8" height="5" viewBox="0 0 8 5" fill="none">
        <path d="M4 0L8 5H0L4 0Z" fill={dir === 'asc' ? 'currentColor' : 'var(--content-tertiary)'} />
      </svg>
      <svg width="8" height="5" viewBox="0 0 8 5" fill="none" className="-mt-0.5">
        <path d="M4 5L0 0H8L4 5Z" fill={dir === 'desc' ? 'currentColor' : 'var(--content-tertiary)'} />
      </svg>
    </span>
  );
}

// ── Cell renderer ─────────────────────────────────────────────────────────

function Cell<T extends Record<string, unknown>>({ col, row }: { col: ColumnDef<T>; row: T }) {
  const raw = row[col.key];

  if (col.render) {
    return <>{col.render(raw, row)}</>;
  }

  switch (col.type) {
    case 'numeric':
      return (
        <span className="font-mono text-mono-small text-content-primary tabular-nums">
          {raw != null ? String(raw) : '—'}
        </span>
      );
    case 'currency':
      return (
        <span className="font-mono text-mono-small text-content-primary tabular-nums">
          {raw != null ? formatCurrency(Number(raw)) : '—'}
        </span>
      );
    case 'status':
    case 'badge':
      return raw != null ? <AdminBadge label={String(raw)} /> : <span className="text-content-tertiary">—</span>;
    case 'date':
      return (
        <span className="text-paragraph-small text-content-secondary">
          {raw != null ? formatDate(String(raw)) : '—'}
        </span>
      );
    case 'avatar': {
      const name = String(raw ?? '');
      return (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-pill bg-background-tertiary border border-border-opaque flex items-center justify-center flex-shrink-0">
            <span className="text-label-small text-content-secondary">{name.charAt(0).toUpperCase()}</span>
          </div>
          <span className="text-paragraph-medium text-content-primary truncate">{name}</span>
        </div>
      );
    }
    default:
      return (
        <span className="text-paragraph-medium text-content-primary">
          {raw != null ? String(raw) : '—'}
        </span>
      );
  }
}

// ── Main DataTable ─────────────────────────────────────────────────────────

export function DataTable<T extends { id?: string; [key: string]: unknown }>({
  columns,
  data,
  loading = false,
  selectable = false,
  bulkActions = [],
  onRowClick,
  emptyState,
  exportable = false,
  rowKey,
  className = '',
  stickyHeader = true,
}: DataTableProps<T>) {
  const [sortKey, setSortKey]       = useState<string | null>(null);
  const [sortDir, setSortDir]       = useState<SortDir>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const getKey = useCallback((row: T): string => {
    if (rowKey) return rowKey(row);
    return String(row.id ?? JSON.stringify(row));
  }, [rowKey]);

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return data;
    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const dir = sortDir === 'asc' ? 1 : -1;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [data, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); return; }
    if (sortDir === 'asc') { setSortDir('desc'); return; }
    setSortKey(null); setSortDir(null);
  };

  const allIds = sorted.map(getKey);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSelected = allIds.some((id) => selectedIds.has(id)) && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedCount = selectedIds.size;
  const hasSelected = selectedCount > 0;

  const exportCSV = () => {
    const header = columns.map((c) => c.header).join(',');
    const rows = sorted.map((row) =>
      columns.map((c) => {
        const v = row[c.key];
        return `"${String(v ?? '').replace(/"/g, '\"')}"`;
      }).join(',')
    ).join('\n');
    const blob = new Blob([`${header}\n${rows}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalCols = columns.length + (selectable ? 1 : 0);

  return (
    <div className={`relative flex flex-col bg-background-primary rounded-md border border-border-opaque overflow-hidden ${className}`}>
      
      {/* Bulk action bar */}
      {hasSelected && bulkActions.length > 0 && (
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 bg-background-inverse z-10 animate-slide-down">
          <span className="text-label-medium text-content-inverse">{selectedCount} selected</span>
          <div className="flex items-center gap-2 ml-2">
            {bulkActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => action.onClick(Array.from(selectedIds))}
                className={`px-3 py-1.5 rounded-sm text-label-small font-medium transition-base cursor-pointer ${
                  action.variant === 'destructive'
                    ? 'bg-negative-400 text-white hover:bg-negative-500'
                    : 'bg-background-primary text-content-primary hover:bg-background-secondary'
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-content-inverse opacity-70 hover:opacity-100 transition-base cursor-pointer"
            aria-label="Clear selection"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      {/* Toolbar */}
      {exportable && (
        <div className="flex-shrink-0 flex items-center justify-end px-4 py-2 border-b border-border-opaque">
          <button
            type="button"
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-background-secondary border border-border-opaque text-label-small text-content-secondary hover:text-content-primary hover:bg-background-tertiary transition-base cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Export CSV
          </button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className={`${stickyHeader ? 'sticky top-0 z-10' : ''}`}>
            <tr className="bg-background-secondary border-b border-border-opaque">
              {selectable && (
                <th className="w-10 px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleAll}
                    className="w-4 h-4 cursor-pointer accent-content-primary"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={`px-4 py-2.5 text-label-small text-content-secondary uppercase tracking-wide font-medium text-left whitespace-nowrap ${
                    ['numeric', 'currency', 'actions'].includes(col.type ?? '') ? 'text-right' : ''
                  } ${col.sortable ? 'cursor-pointer select-none hover:text-content-primary transition-base' : ''}`}
                  onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                >
                  {col.header}
                  {col.sortable && <SortIcon dir={sortKey === col.key ? sortDir : null} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={totalCols} />)
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={totalCols} className="py-16">
                  {emptyState ?? (
                    <div className="flex flex-col items-center gap-3 text-center">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-content-tertiary">
                        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      <span className="text-heading-medium text-content-secondary">No results</span>
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              sorted.map((row) => {
                const id = getKey(row);
                const isSelected = selectedIds.has(id);
                return (
                  <tr
                    key={id}
                    onClick={() => onRowClick?.(row)}
                    className={`border-b border-border-opaque last:border-none transition-colors duration-fast ${
                      isSelected ? 'bg-accent-50' : ''
                    } ${
                      onRowClick ? 'cursor-pointer hover:bg-background-secondary' : 'hover:bg-background-secondary'
                    }`}
                  >
                    {selectable && (
                      <td className="w-10 px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(id)}
                          className="w-4 h-4 cursor-pointer accent-content-primary"
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-4 py-3 ${
                          ['numeric', 'currency', 'actions'].includes(col.type ?? '') ? 'text-right' : ''
                        } ${col.className ?? ''}`}
                      >
                        <Cell col={col as ColumnDef<Record<string, unknown>>} row={row as Record<string, unknown>} />
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
