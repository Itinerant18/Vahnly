'use client';

import React, { useState } from 'react';

export default function RiderRewardsPage() {
  const [promoInput, setPromoInput] = useState('');
  const [promoList, setPromoList] = useState([
    { code: 'FREE50', desc: '₹100 off on your next city hourly drive', expiry: '2026-06-30', status: 'Active' },
    { code: 'WELCOME', desc: 'Flat 10% discount on first outstation route', expiry: '2026-07-15', status: 'Active' }
  ]);

  const handleApplyPromo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoInput.trim()) return;

    // Simulate promo adding
    const code = promoInput.toUpperCase();
    if (promoList.some(p => p.code === code)) {
      alert('Coupon already active in rewards wallet.');
      return;
    }

    const created = {
      code,
      desc: `₹100 discount coupon voucher active`,
      expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'Active'
    };

    setPromoList((prev) => [created, ...prev]);
    setPromoInput('');
    alert(`Promo code "${code}" registered successfully in your rewards index!`);
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">Promos & Offers</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Redeem promo code vouchers or view loyalty program perks</p>
      </div>

      {/* Code Apply */}
      <form onSubmit={handleApplyPromo} className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4 max-w-md font-mono text-xs">
        <h4 className="text-xs font-bold text-white uppercase border-b border-zinc-900 pb-2">Apply Promo Code</h4>
        
        <div className="space-y-2">
          <label className="block text-[8px] text-zinc-500 uppercase">Coupon Voucher Code</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value)}
              placeholder="e.g. WELCOME"
              className="flex-grow bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-white uppercase"
              required
            />
            <button
              type="submit"
              className="bg-white hover:bg-zinc-200 text-black px-6 rounded-xl text-[10px] font-bold uppercase tracking-wider cursor-pointer"
            >
              Redeem
            </button>
          </div>
        </div>
      </form>

      {/* Promos List */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          Active Reward Coupons
        </h4>

        <div className="divide-y divide-zinc-900">
          {promoList.map((p) => (
            <div key={p.code} className="py-3 flex justify-between items-center text-xs font-mono">
              <div>
                <span className="text-white block font-sans font-medium">{p.desc}</span>
                <span className="text-zinc-500 text-[8px] block mt-0.5">Code: {p.code} • Expiry: {p.expiry}</span>
              </div>
              <span className="bg-emerald-950/20 text-emerald-400 border border-emerald-900 px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider shrink-0 border">
                {p.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Loyalty level details */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3 font-mono text-xs text-zinc-400">
        <span className="text-zinc-600 block text-[8px] uppercase font-bold border-b border-zinc-900 pb-1.5">Loyalty Rewards Tier</span>
        <div className="flex justify-between">
          <span>Active Tier Rank:</span>
          <span className="text-white font-bold">Gold Class Owner</span>
        </div>
        <div className="flex justify-between">
          <span>Completed transits this month:</span>
          <span className="text-white font-bold">12 / 15 rides (Gold status saved)</span>
        </div>
        <p className="text-[10px] text-zinc-500 leading-normal font-sans pt-1">
          💡 Gold perks unlock ₹50 D4M Care premium exemptions, zero wait-fee commissions, and dedicated hotline support nodes.
        </p>
      </div>

    </div>
  );
}
