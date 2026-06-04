'use client';

import React, { useState } from 'react';

export default function DriverEarningsPage() {
  const [range, setRange] = useState<'TODAY' | 'WEEK' | 'MONTH'>('WEEK');

  const stats = {
    TODAY: { gross: 1280, trips: 1120, tips: 100, bonus: 150, incentives: 50, commissions: 140, net: 1140 },
    WEEK: { gross: 9680, trips: 8200, tips: 650, bonus: 1200, incentives: 450, commissions: 820, net: 8860 },
    MONTH: { gross: 42800, trips: 36500, tips: 2800, bonus: 5000, incentives: 1800, commissions: 3650, net: 39150 }
  };

  const trips = [
    { id: 'TRP-9901', date: '2026-06-03 21:30', route: 'Salt Lake ➔ Park Street', amount: 780.00, method: 'UPI' },
    { id: 'TRP-9892', date: '2026-06-03 14:15', route: 'Howrah Junction ➔ Ballygunge', amount: 560.00, method: 'Cash' },
    { id: 'TRP-9844', date: '2026-06-02 18:40', route: 'Kolkata Airport ➔ New Town Hub', amount: 840.00, method: 'UPI' },
    { id: 'TRP-9781', date: '2026-06-01 11:20', route: 'Alipore ➔ Salt Lake Sector V', amount: 660.00, method: 'Wallet' }
  ];

  const currentStats = stats[range];

  const handleDownloadReport = () => {
    alert('CSV statement statement-report-2026-Q2.csv downloaded successfully.');
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white font-move">Earnings Statement</h2>
          <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Escrow transaction ledger breakdown and tax indices</p>
        </div>

        <button
          onClick={handleDownloadReport}
          className="bg-zinc-900 hover:bg-zinc-850 text-zinc-300 border border-zinc-800 rounded-xl px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition cursor-pointer font-mono"
        >
          ⬇️ Download PDF/CSV
        </button>
      </div>

      {/* Date Range Selector */}
      <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-900 max-w-sm font-mono text-[10px]">
        {(['TODAY', 'WEEK', 'MONTH'] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`flex-1 py-2 font-bold uppercase rounded-lg transition-all ${
              range === r ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Primary Balance Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-2">
          <span className="text-zinc-500 block text-[9px] uppercase font-mono tracking-wider font-bold">Gross Billing</span>
          <span className="text-2xl font-mono font-bold text-white">₹{currentStats.gross.toFixed(2)}</span>
        </div>
        
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-2">
          <span className="text-zinc-500 block text-[9px] uppercase font-mono tracking-wider font-bold">Total Commissions / GST</span>
          <span className="text-2xl font-mono font-bold text-red-500">-₹{currentStats.commissions.toFixed(2)}</span>
        </div>

        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-2">
          <span className="text-zinc-500 block text-[9px] uppercase font-mono tracking-wider font-bold">Net Payout Escrow Balance</span>
          <span className="text-2xl font-mono font-bold text-emerald-400">₹{currentStats.net.toFixed(2)}</span>
        </div>
      </div>

      {/* Ledger Item Details */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          Commission & Incentive Breakdown
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs font-mono">
          <div className="space-y-2.5">
            <div className="flex justify-between border-b border-zinc-900 pb-1.5 text-zinc-400">
              <span>Completed Ride Earnings:</span>
              <span className="text-white">₹{currentStats.trips.toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-b border-zinc-900 pb-1.5 text-zinc-400">
              <span>Customer Tips Collected:</span>
              <span className="text-white">₹{currentStats.tips.toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-b border-zinc-900 pb-1.5 text-zinc-400">
              <span>Bonus Quests Completed:</span>
              <span className="text-white">₹{currentStats.bonus.toFixed(2)}</span>
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex justify-between border-b border-zinc-900 pb-1.5 text-zinc-400">
              <span>Surge Zone Incentives:</span>
              <span className="text-white">₹{currentStats.incentives.toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-b border-zinc-900 pb-1.5 text-zinc-500">
              <span>Platform Service Commission (10%):</span>
              <span className="text-red-400">-₹{(currentStats.trips * 0.1).toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-b border-zinc-900 pb-1.5 text-zinc-500">
              <span>Tax Deducted (TDS / GST 1%):</span>
              <span className="text-red-400">-₹{(currentStats.gross * 0.01).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Trips Log list */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          Recent Settled Statement Items
        </h4>

        <div className="divide-y divide-zinc-900">
          {trips.map((trp) => (
            <div key={trp.id} className="py-3 flex justify-between items-center text-xs font-mono">
              <div>
                <span className="text-white block font-sans font-medium">{trp.route}</span>
                <span className="text-zinc-500 text-[8px] block mt-0.5">{trp.date} • ID: {trp.id} ({trp.method})</span>
              </div>
              <span className="text-white font-bold">₹{trp.amount.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tax Info recap */}
      <div className="bg-zinc-900/30 border border-zinc-900 rounded-xl p-4 text-[10px] font-mono text-zinc-500 text-left leading-relaxed">
        🔔 [ANNUAL_TAX_SUMMARY]: Financial year 2026-27 accumulated PAN deductions: GST ₹1,420, TDS (Sec 194-C) ₹420. Download formal tax estimates in the settings sub-page menu.
      </div>
    </div>
  );
}
