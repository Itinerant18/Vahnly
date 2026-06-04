'use client';

import React from 'react';

export default function DriverPerformancePage() {
  const metrics = {
    rating: 4.92,
    acceptance: 96,
    cancellation: 2.1,
    completion: 97.9,
    trips: 412
  };

  const compliments = [
    { label: '🎖️ Safe Driver Navigation', count: 184 },
    { label: '💬 Exceptionally Polite', count: 142 },
    { label: '🧹 Clean Cabin Maintenance', count: 96 },
    { label: '⏰ Perfect Punctuality', count: 88 }
  ];

  const reviews = [
    { name: 'Anirban Das', rating: 5, date: '2026-06-03', text: 'Exceptionally smooth automatic transmission transition. Guided the Audi A6 through heavy Salt Lake route traffic with ease.' },
    { name: 'Rohan Sen', rating: 5, date: '2026-06-01', text: 'Punctual arrival. Polite behavior and followed all speed bounds.' },
    { name: 'Priya Dey', rating: 4, date: '2026-05-28', text: 'Good pilot. Highly recommended for manual transmission cars.' }
  ];

  const tiers = [
    { name: 'Bronze Standard', perks: 'Base commission settlement rate (15%).' },
    { name: 'Silver Classic', perks: '10% discount on in-app wallet fuel-cards.' },
    { name: 'Gold Partner (Your Active Tier)', perks: 'Lower service commission (10%), priority dispatch assignment match locks.' },
    { name: 'Platinum Elite', perks: '5% lower commission, auto-instant withdrawal clears, free health insurance perks.' }
  ];

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">Performance & Metrics</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Track dispatcher quality scores, compliments, and partner status tiers</p>
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center font-mono text-xs">
        <div className="bg-zinc-950 border border-zinc-900 p-4 rounded-2xl">
          <span className="text-zinc-500 block text-[8px] uppercase">RATING SCORE</span>
          <span className="text-xl font-bold text-amber-500 block mt-1">★ {metrics.rating}</span>
        </div>
        <div className="bg-zinc-950 border border-zinc-900 p-4 rounded-2xl">
          <span className="text-zinc-500 block text-[8px] uppercase">ACCEPT INDEX</span>
          <span className="text-xl font-bold text-white block mt-1">{metrics.acceptance}%</span>
        </div>
        <div className="bg-zinc-950 border border-zinc-900 p-4 rounded-2xl">
          <span className="text-zinc-500 block text-[8px] uppercase">CANCEL RATE</span>
          <span className="text-xl font-bold text-red-500 block mt-1">{metrics.cancellation}%</span>
        </div>
        <div className="bg-zinc-950 border border-zinc-900 p-4 rounded-2xl">
          <span className="text-zinc-500 block text-[8px] uppercase">COMPLETE RATE</span>
          <span className="text-xl font-bold text-emerald-400 block mt-1">{metrics.completion}%</span>
        </div>
      </div>

      {/* Tier benefits */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          Partner Level Benefits
        </h4>

        <div className="space-y-3">
          {tiers.map((t, idx) => (
            <div key={idx} className={`p-3 rounded-xl border text-xs leading-relaxed ${
              t.name.includes('Gold') 
                ? 'bg-emerald-950/20 border-emerald-900/60 text-emerald-300' 
                : 'bg-zinc-900/40 border-zinc-900 text-zinc-400'
            }`}>
              <span className="block font-bold text-white font-mono text-[10px] uppercase">{t.name}</span>
              <span className="block mt-0.5">{t.perks}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Compliments counts */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          Compliments Log
        </h4>

        <div className="grid grid-cols-2 gap-4 text-xs font-mono">
          {compliments.map((c, i) => (
            <div key={i} className="flex justify-between border-b border-zinc-900 pb-1.5 text-zinc-400">
              <span>{c.label}:</span>
              <span className="text-white font-bold">{c.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Reviews logs */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          Recent Rider Reviews
        </h4>

        <div className="divide-y divide-zinc-900">
          {reviews.map((r, i) => (
            <div key={i} className="py-3.5 space-y-1.5 text-xs">
              <div className="flex justify-between items-center font-mono">
                <div>
                  <span className="text-white font-sans font-semibold">{r.name}</span>
                  <span className="text-zinc-600 text-[8px] ml-2">{r.date}</span>
                </div>
                <span className="text-amber-500 font-bold">★ {r.rating}</span>
              </div>
              <p className="text-zinc-400 leading-relaxed font-sans">{r.text}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
