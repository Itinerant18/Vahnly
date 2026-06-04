'use client';

import React, { useState } from 'react';

export default function RiderWalletPage() {
  const [balance, setBalance] = useState(1500.00);
  const [addVal, setAddVal] = useState('');
  const [history, setHistory] = useState([
    { id: 'TXN-001', date: '2026-06-03', label: 'Debit for trip trp-2209', amount: -910.00, type: 'DEBIT' },
    { id: 'TXN-002', date: '2026-06-02', label: 'Refund for cancelled route', amount: 350.00, type: 'CREDIT' },
    { id: 'TXN-003', date: '2026-06-01', label: 'Added cash via UPI', amount: 2000.00, type: 'CREDIT' }
  ]);

  const handleAddMoney = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(addVal);
    if (isNaN(val) || val <= 0) {
      alert('Provide a valid top-up amount.');
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
    alert(`₹${val.toFixed(2)} added successfully to wallet balance.`);
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">My Wallet</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Top-up wallet balance to automate seamless ride settlements</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        
        {/* Balance */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden">
          <div className="space-y-1">
            <span className="text-zinc-500 text-[9px] uppercase font-mono tracking-wider font-bold">Wallet Balance</span>
            <h3 className="text-3xl font-mono font-bold text-emerald-400">₹{balance.toFixed(2)}</h3>
            <span className="text-[8px] font-mono text-zinc-650 block pt-0.5">Auto-debit escrow settlements active</span>
          </div>

          <div className="flex gap-2 pt-6 font-mono text-[9px] uppercase font-bold text-zinc-400">
            <span className="bg-zinc-900 text-zinc-400 px-3 py-1 rounded border border-zinc-850">
              ✔️ Auto-Pay Active
            </span>
          </div>
        </div>

        {/* Top-up */}
        <form onSubmit={handleAddMoney} className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
            Top-up Wallet Funds
          </h4>

          <div className="space-y-2">
            <label className="block text-[8px] font-bold text-zinc-500 uppercase font-mono tracking-wider">Top-up amount (INR)</label>
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
          Transactions History
        </h4>

        <div className="divide-y divide-zinc-900">
          {history.map((txn) => (
            <div key={txn.id} className="py-3 flex justify-between items-center text-xs font-mono">
              <div>
                <span className="text-white block font-sans font-medium">{txn.label}</span>
                <span className="text-zinc-500 text-[8px] block mt-0.5">{txn.date} • ID: {txn.id}</span>
              </div>
              <span className={`font-bold ${txn.type === 'CREDIT' ? 'text-emerald-400' : 'text-zinc-400'}`}>
                {txn.type === 'CREDIT' ? '+' : ''}₹{txn.amount.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
