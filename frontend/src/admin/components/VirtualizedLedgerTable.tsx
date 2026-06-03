import React, { useRef, useState, useCallback } from 'react';

export interface LedgerRow {
  id: number;
  order_id: string;
  city_prefix: string;
  account_type: string;
  entry_type: string;
  amount_paise: number;
  description: string;
}

interface VirtualizedLedgerTableProps {
  rows: LedgerRow[];
  /** Visible viewport height in px. */
  height?: number;
}

const ROW_H = 44; // px — fixed row height enables window math
const OVERSCAN = 6; // rows rendered above/below the viewport to mask fast scrolls
const GRID = 'grid grid-cols-[minmax(120px,1.4fr)_64px_1.2fr_72px_minmax(96px,0.8fr)_2fr] gap-2 items-center px-3';

/**
 * Windowed ledger table: renders only the rows intersecting the scroll viewport
 * (plus overscan), so DOM node count and memory stay constant regardless of how
 * many ledger entries the backend returns. Paise are formatted to rupees at the
 * presentation edge only — storage stays integer.
 */
export const VirtualizedLedgerTable: React.FC<VirtualizedLedgerTableProps> = ({ rows, height = 240 }) => {
  const [scrollTop, setScrollTop] = useState(0);
  const rafRef = useRef<number | null>(null);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const next = e.currentTarget.scrollTop;
    // Coalesce scroll updates to one per frame to avoid re-render storms.
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      setScrollTop(next);
      rafRef.current = null;
    });
  }, []);

  const total = rows.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const visibleCount = Math.ceil(height / ROW_H) + OVERSCAN * 2;
  const end = Math.min(total, start + visibleCount);
  const slice = rows.slice(start, end);

  if (total === 0) {
    return (
      <div className="border border-canvas-soft rounded-xl">
        <div className={`${GRID} h-11 text-mute uppercase text-[10px] font-medium border-b border-canvas-soft tracking-wider`}>
          <span>Order ID</span><span>Region</span><span>Account</span><span>Type</span>
          <span className="text-right">Amount</span><span>Description</span>
        </div>
        <div className="p-6 text-center text-body text-sm">No completed transactions on record.</div>
      </div>
    );
  }

  return (
    <div className="border border-canvas-soft rounded-xl overflow-hidden">
      {/* Sticky header */}
      <div className={`${GRID} h-11 text-mute uppercase text-[10px] font-medium border-b border-canvas-soft tracking-wider bg-canvas`}>
        <span>Order ID</span><span>Region</span><span>Account</span><span>Type</span>
        <span className="text-right">Amount</span><span>Description</span>
      </div>

      {/* Scroll viewport */}
      <div className="overflow-y-auto relative" style={{ height }} onScroll={onScroll}>
        {/* Spacer sets the true scroll height */}
        <div style={{ height: total * ROW_H, position: 'relative' }}>
          <div style={{ transform: `translateY(${start * ROW_H}px)` }}>
            {slice.map((entry) => (
              <div
                key={entry.id}
                style={{ height: ROW_H }}
                className={`${GRID} text-sm border-b border-canvas-soft hover:bg-canvas-softer transition`}
              >
                <span className="font-mono text-xs text-body truncate">{entry.order_id.slice(0, 16)}...</span>
                <span>
                  <span className="bg-canvas-soft px-2 py-0.5 rounded-pill text-xs font-medium">{entry.city_prefix}</span>
                </span>
                <span className="text-body truncate">{entry.account_type}</span>
                <span>
                  <span className={`px-2 py-0.5 rounded-pill text-[10px] font-medium ${
                    entry.entry_type === 'DEBIT' ? 'bg-ink text-on-dark' : 'bg-canvas-soft text-ink'
                  }`}>
                    {entry.entry_type}
                  </span>
                </span>
                <span className="text-right font-mono font-medium">₹{(entry.amount_paise / 100).toFixed(2)}</span>
                <span className="text-body text-xs truncate">{entry.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
