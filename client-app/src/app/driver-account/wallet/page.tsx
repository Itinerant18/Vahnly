'use client';

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { getDriverWallet, DriverWalletTxn } from '@/api/client';

export default function DriverWalletPage() {
  const { token } = useAuthStore();
  const [balance, setBalance] = useState(0.0);
  const [addVal, setAddVal] = useState('');
  const [history, setHistory] = useState<DriverWalletTxn[]>([]);

  useEffect(() => {
    if (!token) return;
    getDriverWallet(token)
      .then((res) => {
        setBalance(res.balance_paise / 100);
        setHistory(res.transactions);
      })
      .catch((err) => console.warn('Failed to load wallet:', err));
  }, [token]);

  const handleAddMoney = (e: React.FormEvent) => {
    e.preventDefault();
    // Balance/history are real (GetWallet), but top-up needs a payment provider (Stripe/
    // Razorpay) which is not yet wired. Do not fake a credit.
    alert('Wallet top-up is not available yet — payment provider integration pending. Your earnings are paid out via the Payouts screen.');
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">In-App Fuel & Toll Wallet</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Top-up card balances for automated toll gates and service partners</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        
        {/* Balance Card */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden">
          <div className="space-y-1">
            <span className="text-zinc-500 text-[9px] uppercase font-mono tracking-wider font-bold">Wallet Balance</span>
            <h3 className="text-3xl font-mono font-bold text-white">₹{balance.toFixed(2)}</h3>
            <span className="text-[8px] font-mono text-zinc-600 block pt-0.5">Auto-renewal NHAI fast-tags active</span>
          </div>

          <div className="flex gap-2 pt-6 font-mono text-[9px] uppercase font-bold text-zinc-400">
            <span className="bg-zinc-900 text-zinc-400 px-3 py-1 rounded border border-zinc-850">
              ⛽ Fuel HPCL Linked
            </span>
            <span className="bg-zinc-900 text-zinc-400 px-3 py-1 rounded border border-zinc-850">
              ⚡ FAST-TAG LINKED
            </span>
          </div>
        </div>

        {/* Top-up Form */}
        <form onSubmit={handleAddMoney} className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
            Add Money to Wallet
          </h4>

          <div className="space-y-2">
            <label className="block text-[8px] font-bold text-zinc-500 uppercase font-mono tracking-wider">Top-Up Amount (INR)</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={addVal}
                onChange={(e) => setAddVal(e.target.value)}
                placeholder="Enter amount"
                min="100"
                className="flex-grow bg-zinc-900 border border-zinc-850 rounded-xl p-3 text-white focus:outline-none text-xs font-mono"
                required
              />
              <button
                type="submit"
                className="bg-white hover:bg-zinc-200 text-black px-6 rounded-xl text-[10px] font-bold uppercase tracking-wider cursor-pointer"
              >
                Add Cash
              </button>
            </div>
          </div>
        </form>

      </div>

      {/* Transaction list */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          Wallet Transaction History
        </h4>

        <div className="divide-y divide-zinc-900">
          {history.length === 0 && (
            <p className="py-3 text-[10px] font-mono text-zinc-600 text-center">No wallet transactions yet.</p>
          )}
          {history.map((txn) => (
            <div key={txn.id} className="py-3 flex justify-between items-center text-xs font-mono">
              <div>
                <span className="text-white block font-sans font-medium">{txn.description}</span>
                <span className="text-zinc-500 text-[8px] block mt-0.5">{new Date(txn.created_at).toLocaleDateString()} • ID: {txn.id.slice(0, 8)}</span>
              </div>
              <span className={`font-bold ${txn.entry_type === 'CREDIT' ? 'text-emerald-400' : 'text-zinc-400'}`}>
                {txn.entry_type === 'CREDIT' ? '+' : '-'}₹{(txn.amount_paise / 100).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
