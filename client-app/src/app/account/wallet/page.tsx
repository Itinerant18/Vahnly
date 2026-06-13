'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FareDisplay } from '@/components/ds';

export default function RiderWalletPage() {
  const t = useTranslations('accountWallet');
  const [balance, setBalance] = useState(1500.00);
  const [addVal, setAddVal] = useState('');
  const [history, setHistory] = useState([
    { id: 'TXN-001', date: '2026-06-03', label: 'Debit for trip trp-2209', amount: -910.00, type: 'DEBIT' },
    { id: 'TXN-002', date: '2026-06-02', label: 'Refund for cancelled route', amount: 350.00, type: 'CREDIT' },
    { id: 'TXN-003', date: '2026-06-01', label: 'Added cash via UPI', amount: 2000.00, type: 'CREDIT' }
  ]);

  const handleAddPreset = (amt: number) => {
    const created = {
      id: `TXN-${Math.floor(Math.random() * 900 + 100)}`,
      date: new Date().toISOString().split('T')[0],
      label: 'Added cash via Quick Top-up Preset',
      amount: amt,
      type: 'CREDIT' as const
    };

    setBalance((p) => p + amt);
    setHistory((prev) => [created, ...prev]);
    alert(t('addedToWallet', { amount: amt.toFixed(2) }));
  };

  const handleAddMoney = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(addVal);
    if (isNaN(val) || val <= 0) {
      alert(t('invalidTopupAmount'));
      return;
    }

    const created = {
      id: `TXN-${Math.floor(Math.random() * 900 + 100)}`,
      date: new Date().toISOString().split('T')[0],
      label: 'Added cash via UPI (Secure Payment Gateway)',
      amount: val,
      type: 'CREDIT' as const
    };

    setBalance((p) => p + val);
    setHistory((prev) => [created, ...prev]);
    setAddVal('');
    alert(t('addedToBalance', { amount: val.toFixed(2) }));
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">{t('title')}</h2>
        <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        
        {/* Balance Card */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden">
          <div className="space-y-1">
            <span className="text-content-tertiary text-[9px] uppercase font-mono tracking-wider font-bold">{t('walletBalance')}</span>
            <h3 className="text-3xl font-mono font-bold text-content-positive"><FareDisplay amount={balance * 100} size="lg" /></h3>
            <span className="text-[8px] font-mono text-content-tertiary block pt-0.5">{t('autoDebitActive')}</span>
          </div>

          <div className="flex gap-2 pt-6 font-mono text-[9px] uppercase font-bold text-content-secondary">
            <span className="bg-background-secondary text-content-secondary px-3 py-1 rounded border border-border-opaque">
              {t('autoPayActive')}
            </span>
          </div>
        </div>

        {/* Top-up Form & Presets */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4 font-mono text-xs text-white">
          <h4 className="text-xs font-bold text-white uppercase border-b border-border-opaque pb-2">
            {t('topupWalletFunds')}
          </h4>

          {/* Quick Select Presets */}
          <div className="space-y-2">
            <label className="block text-[8px] text-content-tertiary uppercase font-mono">{t('quickPresetAmounts')}</label>
            <div className="flex gap-2">
              {[100, 500, 1000].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => handleAddPreset(amt)}
                  className="flex-1 bg-background-secondary hover:bg-background-tertiary border border-border-opaque hover:border-border-opaque py-2.5 rounded-xl font-bold transition active:scale-95 cursor-pointer text-center text-xs"
                >
                  +₹{amt}
                </button>
              ))}
            </div>
          </div>

          {/* Manual Form */}
          <form onSubmit={handleAddMoney} className="space-y-2 pt-2 border-t border-border-opaque">
            <label className="block text-[8px] font-bold text-content-tertiary uppercase font-mono tracking-wider">{t('customAmount')}</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={addVal}
                onChange={(e) => setAddVal(e.target.value)}
                placeholder={t('enterAmount')}
                min="100"
                className="flex-grow bg-background-secondary border border-border-opaque rounded-xl p-3 text-white focus:outline-none text-xs font-mono"
                required
              />
              <button
                type="submit"
                className="bg-white hover:bg-background-tertiary text-black px-6 rounded-xl text-[10px] font-bold uppercase tracking-wider cursor-pointer"
              >
                {t('addCash')}
              </button>
            </div>
          </form>
        </div>

      </div>

      {/* Transaction list */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
          {t('transactionsHistory')}
        </h4>

        <div className="divide-y divide-border-opaque">
          {history.map((txn) => (
            <div key={txn.id} className="py-3 flex justify-between items-center text-xs font-mono">
              <div>
                <span className="text-white block font-sans font-medium">{txn.label}</span>
                <span className="text-content-tertiary text-[8px] block mt-0.5">{txn.date} • ID: {txn.id}</span>
              </div>
              <span className={`font-bold ${txn.amount > 0 ? 'text-content-positive' : 'text-content-secondary'}`}>
                {txn.amount > 0 ? '+' : ''}<FareDisplay amount={txn.amount * 100} size="sm" />
              </span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
