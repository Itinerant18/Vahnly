'use client';

import React from 'react';

export default function DriverIncentivesPage() {
  const quests = [
    { title: 'Weekly Core Pilot Quest', desc: 'Complete 10 rides during peak traffic splits (08:00-11:00 / 17:00-20:00)', completed: 8, total: 10, reward: 500, expiry: 'Expires in 3 days' },
    { title: 'Outstation Marathon Runner', desc: 'Complete 2 Outstation round-trips exceeding 100 KM path length', completed: 1, total: 2, reward: 1200, expiry: 'Expires in 5 days' },
    { title: 'Zero-incident Rating Badge', desc: 'Secure 15 consecutive 5-star ratings from car owners', completed: 12, total: 15, reward: 300, expiry: 'No expiration' }
  ];

  return (
    <div className="space-y-6 text-left font-sans">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">Incentives & Quests</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Track active pilot targets, unlock payouts, and analyze surge zones</p>
      </div>

      {/* Quests Container */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          Active Pilot Quests
        </h3>

        <div className="space-y-3">
          {quests.map((q, idx) => {
            const pct = Math.round((q.completed / q.total) * 100);
            return (
              <div key={idx} className="bg-zinc-950 border border-zinc-900 p-5 rounded-2xl space-y-4">
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-white font-sans">{q.title}</h4>
                    <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">{q.desc}</p>
                  </div>
                  <span className="bg-emerald-950/20 text-emerald-400 border border-emerald-900 px-2.5 py-1 rounded text-[10px] font-mono font-bold shrink-0">
                    +₹{q.reward}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="space-y-1.5 font-mono text-[9px]">
                  <div className="flex justify-between text-zinc-500">
                    <span>Progress: {q.completed} / {q.total} ({pct}%)</span>
                    <span>{q.expiry}</span>
                  </div>
                  <div className="h-1.5 bg-zinc-900 rounded-full w-full overflow-hidden">
                    <div className="h-full bg-white transition-all duration-500" style={{ width: `${pct}%` }}></div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Surge predictions details */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          High-demand Surge Predictions
        </h4>
        
        <div className="space-y-2 text-xs font-mono text-zinc-400">
          <div className="flex justify-between border-b border-zinc-900 pb-1.5">
            <span>Park Street Dining (20:00 - 23:00):</span>
            <span className="text-amber-500">1.4x Surge expected</span>
          </div>
          <div className="flex justify-between border-b border-zinc-900 pb-1.5">
            <span>Salt Lake Sector V (17:30 - 19:30):</span>
            <span className="text-amber-500">1.3x Surge expected</span>
          </div>
          <div className="flex justify-between border-b border-zinc-900 pb-1.5">
            <span>Howrah Junction (08:30 - 11:30):</span>
            <span className="text-amber-500">1.5x Surge expected</span>
          </div>
        </div>
      </div>

    </div>
  );
}
