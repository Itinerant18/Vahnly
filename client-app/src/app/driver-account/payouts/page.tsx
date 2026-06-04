'use client';

import React, { useState } from 'react';

export default function DriverPayoutsPage() {
  const [balance, setBalance] = useState(2860.00);
  const [withdrawVal, setWithdrawVal] = useState('');
  const [bankDetails, setBankDetails] = useState({ account: '•••• •••• 9876', holder: 'Aniket Karmakar', upi: 'aniket.k@okaxis' });
  const [isEditingBank, setIsEditingBank] = useState(false);
  const [autoPayout, setAutoPayout] = useState(true);
  const [history, setHistory] = useState([
    { id: 'PAY-8821', date: '2026-06-01', amount: 4500.00, status: 'Settled', channel: 'UPI' },
    { id: 'PAY-8755', date: '2026-05-25', amount: 8200.00, status: 'Settled', channel: 'Bank Transfer' },
    { id: 'PAY-8610', date: '2026-05-18', amount: 5600.00, status: 'Settled', channel: 'UPI' }
  ]);

  const handleWithdrawAll = () => {
    setWithdrawVal(balance.toString());
  };

  const handleRequestPayout = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(withdrawVal);
    if (isNaN(val) || val <= 0 || val > balance) {
      alert('Provide a valid withdraw amount within your available balance limit.');
      return;
    }

    const newPayment = {
      id: `PAY-${Math.floor(Math.random() * 9000 + 1000)}`,
      date: new Date().toISOString().split('T')[0],
      amount: val,
      status: 'Processing',
      channel: 'UPI Instant'
    };

    setBalance((prev) => prev - val);
    setHistory((prev) => [newPayment, ...prev]);
    setWithdrawVal('');
    alert(`Payout request of ₹${val.toFixed(2)} submitted! Funds will settle to ${bankDetails.upi} instantly.`);
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">Payout Settlement Node</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Withdraw earnings to linked accounts or toggle auto-settlement schedules</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        
        {/* Withdraw Panel Container (Left 2 columns on desktop) */}
        <div className="sm:col-span-2 space-y-6">
          
          {/* Card Balance */}
          <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-6 flex justify-between items-center relative overflow-hidden">
            <div className="space-y-1">
              <span className="text-zinc-500 text-[9px] uppercase font-mono tracking-wider font-bold">Withdrawable Balance</span>
              <h3 className="text-3xl font-mono font-bold text-emerald-400">₹{balance.toFixed(2)}</h3>
              <span className="text-[8px] font-mono text-zinc-600 block pt-0.5">Clears immediately to linked UPI node</span>
            </div>
            
            <div className="flex flex-col items-end gap-1.5 text-[9px] font-mono uppercase font-bold text-zinc-400 text-right">
              <span>Auto-Payout: {autoPayout ? 'ENABLED' : 'DISABLED'}</span>
              <button 
                onClick={() => setAutoPayout(!autoPayout)}
                className={`h-5 w-10 rounded-full transition relative p-0.5 cursor-pointer ${autoPayout ? 'bg-white' : 'bg-zinc-800'}`}
              >
                <div className={`h-4 w-4 rounded-full shadow transition-transform ${autoPayout ? 'translate-x-5 bg-black' : 'translate-x-0 bg-zinc-400'}`} />
              </button>
            </div>
          </div>

          {/* Form withdrawal input */}
          <form onSubmit={handleRequestPayout} className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
            <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
              Withdraw Funds
            </h4>
            
            <div className="space-y-2">
              <label className="block text-[8px] font-bold text-zinc-500 uppercase font-mono tracking-wider">Amount to Withdraw (INR)</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3.5 top-3.5 text-zinc-500 font-mono text-xs">₹</span>
                  <input
                    type="number"
                    value={withdrawVal}
                    onChange={(e) => setWithdrawVal(e.target.value)}
                    placeholder="Enter amount"
                    min="1"
                    step="0.01"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 pl-7 text-white focus:outline-none focus:border-zinc-500 text-xs font-mono"
                    required
                  />
                </div>
                <button
                  type="button"
                  onClick={handleWithdrawAll}
                  className="bg-zinc-900 hover:bg-zinc-850 text-zinc-300 border border-zinc-800 rounded-xl px-4 text-[10px] font-bold uppercase tracking-wider transition cursor-pointer font-mono font-bold"
                >
                  Withdraw Max
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-white hover:bg-zinc-200 text-black py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer active:scale-95 font-sans"
            >
              Request Instant Withdrawal
            </button>
          </form>

        </div>

        {/* Bank Config Info (Right column on desktop) */}
        <div className="space-y-6">
          <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
            <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
              <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">Linked Settlement Accounts</h4>
              <button
                type="button"
                onClick={() => setIsEditingBank(!isEditingBank)}
                className="text-[8px] font-mono font-bold text-zinc-400 hover:text-white uppercase tracking-wider cursor-pointer"
              >
                {isEditingBank ? 'Save' : 'Edit'}
              </button>
            </div>

            {isEditingBank ? (
              <div className="space-y-3 text-xs font-mono">
                <div>
                  <label className="block text-[8px] text-zinc-500 uppercase mb-1">Account Holder</label>
                  <input
                    type="text"
                    value={bankDetails.holder}
                    onChange={(e) => setBankDetails({ ...bankDetails, holder: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[8px] text-zinc-500 uppercase mb-1">Account Number</label>
                  <input
                    type="text"
                    value={bankDetails.account}
                    onChange={(e) => setBankDetails({ ...bankDetails, account: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[8px] text-zinc-500 uppercase mb-1">UPI ID Destination</label>
                  <input
                    type="text"
                    value={bankDetails.upi}
                    onChange={(e) => setBankDetails({ ...bankDetails, upi: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-white focus:outline-none"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3 font-mono text-xs text-zinc-400 leading-relaxed">
                <div>
                  <span className="text-zinc-600 block text-[8px] uppercase">Bank Account Name</span>
                  <span className="font-bold text-white">{bankDetails.holder}</span>
                </div>
                <div>
                  <span className="text-zinc-600 block text-[8px] uppercase">Account Endpoint</span>
                  <span className="font-bold text-white">{bankDetails.account}</span>
                </div>
                <div>
                  <span className="text-zinc-600 block text-[8px] uppercase">UPI ID</span>
                  <span className="font-bold text-emerald-400">{bankDetails.upi}</span>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* History of settlements */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          Settlement Withdrawal History
        </h4>

        <div className="divide-y divide-zinc-900">
          {history.map((item) => (
            <div key={item.id} className="py-3 flex justify-between items-center text-xs font-mono">
              <div>
                <span className="text-white block font-sans font-medium">Payout Request {item.id}</span>
                <span className="text-zinc-500 text-[8px] block mt-0.5">{item.date} via {item.channel}</span>
              </div>
              <div className="text-right">
                <span className="text-white block font-bold">₹{item.amount.toFixed(2)}</span>
                <span className={`text-[8px] block mt-0.5 ${item.status === 'Settled' ? 'text-emerald-500' : 'text-amber-500 animate-pulse'}`}>
                  ● {item.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
