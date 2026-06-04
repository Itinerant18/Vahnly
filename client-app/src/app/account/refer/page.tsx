'use client';

import React from 'react';

export default function RiderReferPage() {
  const code = 'RIDER-SARAH-452';

  const stats = {
    joined: 2,
    rewarded: 1,
    earnings: 300.00
  };

  const statusList = [
    { 
      name: 'John Connor', 
      date: '2026-06-03', 
      milestones: { joined: true, firstRide: true, bonusCredited: true },
      reward: 'Rewarded (₹300)' 
    },
    { 
      name: 'Kyle Reese', 
      date: '2026-06-01', 
      milestones: { joined: true, firstRide: false, bonusCredited: false },
      reward: 'Pending first ride' 
    }
  ];

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: 'Join Drivers-For-U as Rider',
        text: `Use invite code ${code} to get ₹100 discount on your first professional driver match!`,
        url: window.location.origin
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(`Use invite code ${code} to get ₹100 discount on your first professional driver match! Link: ${window.location.origin}`);
      alert('Referral invite link copied successfully to clipboard.');
    }
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">Refer & Earn Rewards</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Invite vehicle owners to hire pilots and unlock platform wallet cashbacks</p>
      </div>

      {/* Code card */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-6 text-center space-y-4 max-w-md mx-auto">
        <span className="text-zinc-500 text-[9px] uppercase font-mono tracking-wider font-bold">Your Unique Invite Code</span>
        <div className="bg-zinc-900 border border-zinc-850 p-4 rounded-xl font-mono text-xl font-bold tracking-widest text-white select-all">
          {code}
        </div>
        <button
          onClick={handleShare}
          className="w-full bg-white hover:bg-zinc-200 text-black py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer active:scale-95"
        >
          📢 Share Invite Code
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-zinc-950 border border-zinc-900 p-5 rounded-2xl space-y-1 text-center font-mono">
          <span className="text-zinc-500 block text-[8px] uppercase">PARTNERS JOINED</span>
          <span className="text-xl font-bold text-white block mt-0.5">{stats.joined} Owners</span>
        </div>
        <div className="bg-zinc-950 border border-zinc-900 p-5 rounded-2xl space-y-1 text-center font-mono">
          <span className="text-zinc-500 block text-[8px] uppercase">STATUS AWARDED</span>
          <span className="text-xl font-bold text-white block mt-1">{stats.rewarded} settled</span>
        </div>
        <div className="bg-zinc-950 border border-zinc-900 p-5 rounded-2xl space-y-1 text-center font-mono">
          <span className="text-zinc-500 block text-[8px] uppercase">TOTAL WALLET CASHBACK</span>
          <span className="text-xl font-bold text-emerald-400 block mt-1">₹{stats.earnings.toFixed(2)}</span>
        </div>
      </div>

      {/* Status List */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          Referral Milestones History
        </h4>

        <div className="space-y-4 divide-y divide-zinc-900">
          {statusList.map((item, idx) => (
            <div key={idx} className="pt-4 first:pt-0 flex flex-col sm:flex-row justify-between sm:items-center gap-4 text-xs font-mono">
              <div className="space-y-1">
                <span className="text-white block font-sans font-bold text-sm">{item.name}</span>
                <span className="text-zinc-500 text-[8px] block">Invited on: {item.date}</span>
              </div>

              {/* Progress Milestones Checklist Grid */}
              <div className="grid grid-cols-3 gap-2 max-w-xs w-full text-center text-[8px] font-bold uppercase tracking-wider shrink-0">
                <div className={`p-1.5 rounded border ${
                  item.milestones.joined 
                    ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900' 
                    : 'bg-zinc-900 text-zinc-600 border-zinc-850'
                }`}>
                  Joined
                </div>
                <div className={`p-1.5 rounded border ${
                  item.milestones.firstRide 
                    ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900' 
                    : 'bg-zinc-900 text-zinc-600 border-zinc-850'
                }`}>
                  First Ride Active
                </div>
                <div className={`p-1.5 rounded border ${
                  item.milestones.bonusCredited 
                    ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900' 
                    : 'bg-zinc-900 text-zinc-600 border-zinc-850'
                }`}>
                  Bonus Credited
                </div>
              </div>

              <span className={`text-[8px] font-bold uppercase tracking-wider text-right shrink-0 ${
                item.reward.includes('Rewarded') ? 'text-emerald-400' : 'text-zinc-500'
              }`}>
                {item.reward}
              </span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
