'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  getDriverEarnings, getEarningsStatementCsv,
  type DriverEarningsResponse, type EarningsPeriod,
} from '@/api/client';
import { useAuthStore } from '@/store/useAuthStore';
import { formatCurrency, formatCompactDate } from '@/lib/format';
import { useCountUp } from '@/lib/useCountUp';
import { saveAndShareCsv } from '@/lib/saveStatement';

// Code-split recharts out of the initial earnings bundle; it only renders client-side.
const EarningsChart = dynamic(() => import('./EarningsChart'), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center text-[10px] font-mono text-content-tertiary">Loading…</div>
  ),
});

function KpiValue({ paise, className }: { paise: number; className: string }) {
  const v = useCountUp(paise);
  return <span className={className}>{formatCurrency(v)}</span>;
}

function CountInt({ value, className }: { value: number; className: string }) {
  const v = useCountUp(value, 600);
  return <span className={className}>{Math.round(v)}</span>;
}

export default function DriverEarningsPage() {
  const router = useRouter();
  const { token } = useAuthStore();
  const [period, setPeriod] = useState<EarningsPeriod>('TODAY');
  const [customFrom, setCustomFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<DriverEarningsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await getDriverEarnings(token, period, customFrom, customTo);
      setData(res);
      setError(null);
    } catch (err) {
      console.warn('[DriverEarnings] fetch failed:', err);
      setError('Live earnings data is unavailable.');
    } finally {
      setLoading(false);
    }
  }, [token, period, customFrom, customTo]);

  useEffect(() => { void load(); }, [load]);

  const s = data?.summary;
  const onlineHours = s?.online_hours ?? 0;

  const chartData = useMemo(() => {
    const days = data?.daily_breakdown ?? [];
    return days.slice(-7).map((d) => ({
      label: new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' }),
      rupees: d.earnings_paise / 100,
    }));
  }, [data]);

  const handleDownloadStatement = async () => {
    if (!token) return;
    setDownloading(true);
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const csv = await getEarningsStatementCsv(token, year, month);
      await saveAndShareCsv(`earnings-statement-${year}-${String(month).padStart(2, '0')}.csv`, csv);
    } catch (err) {
      console.warn('[DriverEarnings] statement download failed:', err);
      alert('Could not generate the statement. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white font-move">Earnings</h2>
          <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">Ledger-backed payout summary</p>
          {error && <p className="text-content-negative text-[10px] font-mono mt-2">{error}</p>}
        </div>
        <button
          onClick={handleDownloadStatement}
          disabled={downloading}
          className="bg-background-secondary hover:bg-background-tertiary text-content-secondary border border-border-opaque rounded-xl px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition cursor-pointer font-mono disabled:opacity-50"
        >
          {downloading ? 'Preparing…' : 'Download Statement'}
        </button>
      </div>

      {/* Period selector */}
      <div className="flex bg-background-primary p-1 rounded-xl border border-border-opaque max-w-sm font-mono text-[10px]">
        {(['TODAY', 'WEEK', 'MONTH', 'CUSTOM'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`flex-1 py-2 font-bold uppercase rounded-lg transition-all ${
              period === p ? 'bg-white text-black' : 'text-content-secondary hover:text-white'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {period === 'CUSTOM' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-sm">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
            className="bg-background-primary border border-border-opaque rounded-xl p-3 text-xs text-white font-mono" />
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
            className="bg-background-primary border border-border-opaque rounded-xl p-3 text-xs text-white font-mono" />
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-1 col-span-2 lg:col-span-1">
          <span className="text-content-tertiary block text-[9px] uppercase font-mono tracking-wider font-bold">Net Earnings</span>
          <KpiValue paise={s?.net_earnings_paise ?? 0} className="text-2xl font-mono font-bold text-content-positive block" />
        </div>
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-1">
          <span className="text-content-tertiary block text-[9px] uppercase font-mono tracking-wider font-bold">Trips</span>
          <CountInt value={s?.trip_count ?? 0} className="text-2xl font-mono font-bold text-white block" />
        </div>
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-1">
          <span className="text-content-tertiary block text-[9px] uppercase font-mono tracking-wider font-bold">Tips</span>
          <KpiValue paise={s?.tips_paise ?? 0} className="text-2xl font-mono font-bold text-white block" />
        </div>
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-1">
          <span className="text-content-tertiary block text-[9px] uppercase font-mono tracking-wider font-bold">Online</span>
          <span className="text-2xl font-mono font-bold text-white block">{onlineHours.toFixed(1)} hrs</span>
        </div>
      </div>

      {/* Daily earnings bar chart */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-3">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">Daily Earnings (last 7 days)</h4>
        <div className="h-48">
          {mounted && chartData.length > 0 ? (
            <EarningsChart data={chartData} />
          ) : (
            <div className="h-full flex items-center justify-center text-[10px] font-mono text-content-tertiary">
              {loading ? 'Loading…' : 'No earnings in this period.'}
            </div>
          )}
        </div>
      </div>

      {/* Recent trips */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">Recent Trips</h4>
        <div className="divide-y divide-border-opaque">
          {(data?.recent_trips ?? []).length === 0 && (
            <p className="py-3 text-[10px] font-mono text-content-tertiary text-center">No trips in this period.</p>
          )}
          {(data?.recent_trips ?? []).map((t) => (
            <button
              key={t.order_id}
              onClick={() => router.push(`/driver-account/trip-history/${t.order_id}`)}
              className="w-full py-3 flex justify-between items-center text-xs font-mono text-left hover:bg-background-secondary/30 transition rounded-lg px-1"
            >
              <div>
                <span className="text-white block font-sans font-medium">
                  {t.pickup_short || 'Ride'} {t.drop_short ? `➔ ${t.drop_short}` : ''}
                </span>
                <span className="text-content-tertiary text-[8px] block mt-0.5">{formatCompactDate(t.completed_at)} • fare {formatCurrency(t.fare_paise)}</span>
              </div>
              <div className="text-right">
                <span className="text-content-positive block font-bold">{formatCurrency(t.driver_earnings_paise)}</span>
                {t.tip_paise > 0 && <span className="text-content-tertiary text-[8px] block">tip {formatCurrency(t.tip_paise)}</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
