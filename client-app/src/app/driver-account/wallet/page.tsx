'use client';

import React, { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { getDriverWallet, type DriverWalletTxn } from '@/api/client';
import { formatCurrency, formatCompactDate } from '@/lib/format';

// Maps a transaction description to a type icon. The driver wallet is system-managed
// (toll/parking reimbursements, fuel card, referral bonuses) — no self top-up.
function txnIcon(description: string, entry: 'CREDIT' | 'DEBIT'): string {
  const d = description.toLowerCase();
  if (d.includes('toll') || d.includes('fastag')) return '🛣️';
  if (d.includes('park')) return '🅿️';
  if (d.includes('fuel')) return '⛽';
  if (d.includes('referral') || d.includes('bonus')) return '🎁';
  return entry === 'CREDIT' ? '➕' : '➖';
}

export default function DriverWalletPage() {
  const { token } = useAuthStore();
  const [balancePaise, setBalancePaise] = useState(0);
  const [history, setHistory] = useState<DriverWalletTxn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    getDriverWallet(token)
      .then((res) => {
        setBalancePaise(res.balance_paise);
        setHistory(res.transactions);
      })
      .catch((err) => console.warn('[Wallet] load failed:', err))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="space-y-6 text-left">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">Wallet</h2>
        <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">Toll &amp; parking reimbursements, referral bonuses</p>
      </div>

      {/* Passive balance card (gray — system-managed, not a spending wallet) */}
      <div className="bg-background-secondary/60 border border-border-opaque rounded-2xl p-6 space-y-1">
        <span className="text-content-secondary text-[9px] uppercase font-mono tracking-wider font-bold">Wallet Balance</span>
        <h3 className="text-3xl font-mono font-bold text-content-primary">{loading ? '₹—' : formatCurrency(balancePaise)}</h3>
        <span className="text-[8px] font-mono text-content-tertiary block pt-0.5">System-managed • no self top-up</span>
      </div>

      {/* Explanatory text */}
      <div className="bg-background-secondary/30 border border-border-opaque rounded-xl p-4 text-[10px] font-mono text-content-tertiary leading-relaxed">
        ℹ️ Tolls and parking you pay during a trip are <span className="text-content-secondary">auto-reimbursed</span> to this wallet. Referral bonuses land here too. Your trip earnings are paid out separately on the <span className="text-content-secondary">Payouts</span> screen.
      </div>

      {/* Transactions */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">Transactions</h4>
        <div className="divide-y divide-border-opaque">
          {!loading && history.length === 0 && (
            <p className="py-3 text-[10px] font-mono text-content-tertiary text-center">No wallet transactions yet.</p>
          )}
          {history.map((txn) => (
            <div key={txn.id} className="py-3 flex justify-between items-center text-xs font-mono">
              <div className="flex items-center gap-3">
                <span className="text-base leading-none">{txnIcon(txn.description, txn.entry_type)}</span>
                <div>
                  <span className="text-white block font-sans font-medium">{txn.description}</span>
                  <span className="text-content-tertiary text-[8px] block mt-0.5">{formatCompactDate(txn.created_at)}</span>
                </div>
              </div>
              <span className={`font-bold ${txn.entry_type === 'CREDIT' ? 'text-content-positive' : 'text-content-secondary'}`}>
                {txn.entry_type === 'CREDIT' ? '+' : '-'}{formatCurrency(txn.amount_paise)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
