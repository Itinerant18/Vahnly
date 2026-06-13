'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';

export default function RiderRewardsPage() {
  const t = useTranslations('accountRewards');
  const [promoInput, setPromoInput] = useState('');
  const [promoList, setPromoList] = useState([
    { code: 'FREE50', desc: '₹100 off on your next city hourly drive', expiry: '2026-06-30', status: 'Active' },
    { code: 'WELCOME', desc: 'Flat 10% discount on first outstation route', expiry: '2026-07-15', status: 'Active' }
  ]);

  const completedTrips = 12;
  const targetTrips = 15;
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const progressOffset = circumference - (completedTrips / targetTrips) * circumference;

  const handleApplyPromo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoInput.trim()) return;

    const code = promoInput.toUpperCase();
    if (promoList.some(p => p.code === code)) {
      alert(t('couponAlreadyActive'));
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
    alert(t('promoRegistered', { code }));
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">{t('title')}</h2>
        <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Code Apply */}
        <form onSubmit={handleApplyPromo} className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4 font-mono text-xs">
          <h4 className="text-xs font-bold text-white uppercase border-b border-border-opaque pb-2">{t('applyPromoCode')}</h4>

          <div className="space-y-2">
            <label className="block text-[8px] text-content-tertiary uppercase">{t('couponVoucherCode')}</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value)}
                placeholder={t('promoPlaceholder')}
                className="flex-grow bg-background-secondary border border-border-opaque rounded-xl p-2.5 text-white uppercase focus:outline-none"
                required
              />
              <button
                type="submit"
                className="bg-white hover:bg-background-tertiary text-black px-6 rounded-xl text-[10px] font-bold uppercase tracking-wider cursor-pointer"
              >
                {t('redeem')}
              </button>
            </div>
          </div>
        </form>

        {/* Loyalty level details with custom radial SVG */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 flex items-center justify-between gap-6 font-mono text-xs text-content-secondary">
          <div className="space-y-3 flex-grow">
            <span className="text-content-tertiary block text-[8px] uppercase font-bold border-b border-border-opaque pb-1.5">{t('loyaltyRewardsTier')}</span>
            <div className="flex justify-between">
              <span>{t('activeTierRank')}</span>
              <span className="text-white font-bold">{t('goldClassOwner')}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('ridesCompleted')}</span>
              <span className="text-white font-bold">{t('transitsCount', { completed: completedTrips, target: targetTrips })}</span>
            </div>
            <p className="text-[10px] text-content-tertiary leading-normal font-sans pt-1">
              {t('goldPerksNote')}
            </p>
          </div>

          {/* Radial progress ring SVG */}
          <div className="relative shrink-0 flex items-center justify-center h-20 w-20">
            <svg className="h-16 w-16 transform -rotate-90">
              {/* Background circle */}
              <circle
                cx="32"
                cy="32"
                r={radius}
                stroke="var(--background-secondary)"
                strokeWidth="4"
                fill="transparent"
              />
              {/* Foreground circle */}
              <circle
                cx="32"
                cy="32"
                r={radius}
                stroke="var(--positive-400)"
                strokeWidth="4"
                fill="transparent"
                strokeDasharray={circumference}
                strokeDashoffset={progressOffset}
                strokeLinecap="round"
                className="transition-all duration-500"
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center text-center">
              <span className="text-[10px] font-bold text-white font-mono">{Math.round((completedTrips / targetTrips) * 100)}%</span>
            </div>
          </div>
        </div>

      </div>

      {/* Promos List */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
          {t('activeRewardCoupons')}
        </h4>

        <div className="divide-y divide-border-opaque">
          {promoList.map((p) => (
            <div key={p.code} className="py-3 flex justify-between items-center text-xs font-mono">
              <div>
                <span className="text-white block font-sans font-medium">{p.desc}</span>
                <span className="text-content-tertiary text-[8px] block mt-0.5">{t('codeExpiry', { code: p.code, expiry: p.expiry })}</span>
              </div>
              <span className="bg-surface-positive/20 text-content-positive border border-positive-400 px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider shrink-0 border">
                {p.status}
              </span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
