'use client';

import React, { useState } from 'react';

export default function RiderInsurancePage() {
  const [subscription, setSubscription] = useState('TRIP_BY_TRIP');
  const [claims, setClaims] = useState([
    { id: 'CLM-011', date: '2026-05-10', type: 'Windshield crack compensation', amount: 4500.00, status: 'Settled' }
  ]);

  const handleFileClaim = () => {
    const reason = prompt('Enter description of incident for filing insurance claim:');
    if (!reason) return;

    const created = {
      id: `CLM-${Math.floor(Math.random() * 900 + 100)}`,
      date: new Date().toISOString().split('T')[0],
      type: reason,
      amount: 0,
      status: 'Awaiting Document Review'
    };

    setClaims((prev) => [created, ...prev]);
    alert(`Insurance claim ${created.id} submitted. Auto claims adjusters will review vehicle dashboard logs.`);
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div className="flex justify-between items-center pb-4 border-b border-zinc-900">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white font-move">Insurance & D4M Care</h2>
          <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Configure monthly protection plans or submit vehicle damage claims</p>
        </div>

        <button
          onClick={handleFileClaim}
          className="bg-white hover:bg-zinc-200 text-black text-[10px] font-mono font-bold uppercase px-4 py-2 rounded-full cursor-pointer"
        >
          File a Claim
        </button>
      </div>

      {/* Subscription Type */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          D4M Care Subscription Plan
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <label className="flex items-center justify-between p-3.5 bg-zinc-900/40 border border-zinc-800 rounded-xl cursor-pointer">
            <div className="flex items-center gap-3">
              <input
                type="radio"
                name="insurance-sub"
                checked={subscription === 'TRIP_BY_TRIP'}
                onChange={() => setSubscription('TRIP_BY_TRIP')}
              />
              <div>
                <span className="text-white font-sans font-medium block">Trip-by-Trip Coverage</span>
                <span className="text-[9px] text-zinc-500 block mt-0.5">₹49 per matching ride allocation</span>
              </div>
            </div>
          </label>

          <label className="flex items-center justify-between p-3.5 bg-zinc-900/40 border border-zinc-800 rounded-xl cursor-pointer">
            <div className="flex items-center gap-3">
              <input
                type="radio"
                name="insurance-sub"
                checked={subscription === 'MONTHLY'}
                onChange={() => setSubscription('MONTHLY')}
              />
              <div>
                <span className="text-white font-sans font-medium block">Monthly Unlimited Pack</span>
                <span className="text-[9px] text-zinc-500 block mt-0.5">₹399 per month unlimited protection</span>
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Coverage details */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3 font-mono text-xs text-zinc-400">
        <span className="text-zinc-600 block text-[8px] uppercase font-bold border-b border-zinc-900 pb-1.5">Active Insurance Policy Details</span>
        <div className="flex justify-between">
          <span>Accidental Damage Shield:</span>
          <span className="text-white">Covered up to ₹2,00,000</span>
        </div>
        <div className="flex justify-between">
          <span>Medical Expense Coverage:</span>
          <span className="text-white">Covered up to ₹50,000</span>
        </div>
        <div className="flex justify-between">
          <span>Roadside Towing support:</span>
          <span className="text-white">Unlimited 24/7 coverage</span>
        </div>
      </div>

      {/* Past Claims */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          Claims History
        </h4>

        <div className="divide-y divide-zinc-900">
          {claims.map((c) => (
            <div key={c.id} className="py-3 flex justify-between items-center text-xs font-mono">
              <div>
                <span className="text-white block font-sans font-medium">{c.type}</span>
                <span className="text-zinc-500 text-[8px] block mt-0.5">{c.date} • ID: {c.id}</span>
              </div>
              <div className="text-right">
                {c.amount > 0 && <span className="text-white block font-bold">₹{c.amount.toFixed(2)}</span>}
                <span className={`text-[8px] block mt-0.5 font-bold uppercase ${c.status === 'Settled' ? 'text-emerald-500' : 'text-amber-500 animate-pulse'}`}>
                  ● {c.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
