import { useMemo, useState } from 'react';

export interface CsvColumn<T> {
  key: keyof T;
  label: string;
}

// exportToCsv builds a CSV from typed rows and triggers a browser download.
// RFC-4180 escaping (quotes doubled; fields with comma/quote/newline quoted).
export function exportToCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]): void {
  const esc = (v: unknown): string => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(',')).join('\n');
  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type SortDir = 'asc' | 'desc';

// useSort gives client-side column sorting for an admin table. Click a header to
// sort; click again to flip direction. Numbers sort numerically, others by locale.
export function useSort<T>(rows: T[], initialKey: keyof T | null = null) {
  const [sortKey, setSortKey] = useState<keyof T | null>(initialKey);
  const [dir, setDir] = useState<SortDir>('asc');

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return dir === 'asc' ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, dir]);

  const toggleSort = (key: keyof T) => {
    if (sortKey === key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setDir('asc');
    }
  };

  // Arrow indicator for a header cell.
  const indicator = (key: keyof T): string => (sortKey === key ? (dir === 'asc' ? ' ▲' : ' ▼') : '');

  return { sorted, sortKey, dir, toggleSort, indicator };
}
