'use client';

import React from 'react';
import { useTranslations } from 'next-intl';

export default function RiderReferPage() {
  const t = useTranslations('accountRefer');
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
        title: t('shareTitle'),
        text: t('shareText', { code }),
        url: window.location.origin
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(t('shareTextWithLink', { code, link: window.location.origin }));
      alert(t('inviteCopied'));
    }
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">{t('title')}</h2>
        <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">{t('subtitle')}</p>
      </div>

      {/* Code card */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-6 text-center space-y-4 max-w-md mx-auto">
        <span className="text-content-tertiary text-[9px] uppercase font-mono tracking-wider font-bold">{t('uniqueInviteCode')}</span>
        <div className="bg-background-secondary border border-border-opaque p-4 rounded-xl font-mono text-xl font-bold tracking-widest text-white select-all">
          {code}
        </div>
        <button
          onClick={handleShare}
          className="w-full bg-white hover:bg-background-tertiary text-black py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer active:scale-95"
        >
          {t('shareInviteCode')}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-background-primary border border-border-opaque p-5 rounded-2xl space-y-1 text-center font-mono">
          <span className="text-content-tertiary block text-[8px] uppercase">{t('partnersJoined')}</span>
          <span className="text-xl font-bold text-white block mt-0.5">{t('ownersCount', { count: stats.joined })}</span>
        </div>
        <div className="bg-background-primary border border-border-opaque p-5 rounded-2xl space-y-1 text-center font-mono">
          <span className="text-content-tertiary block text-[8px] uppercase">{t('statusAwarded')}</span>
          <span className="text-xl font-bold text-white block mt-1">{t('settledCount', { count: stats.rewarded })}</span>
        </div>
        <div className="bg-background-primary border border-border-opaque p-5 rounded-2xl space-y-1 text-center font-mono">
          <span className="text-content-tertiary block text-[8px] uppercase">{t('totalWalletCashback')}</span>
          <span className="text-xl font-bold text-content-positive block mt-1">₹{stats.earnings.toFixed(2)}</span>
        </div>
      </div>

      {/* Status List */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
          {t('milestonesHistory')}
        </h4>

        <div className="space-y-4 divide-y divide-border-opaque">
          {statusList.map((item, idx) => (
            <div key={idx} className="pt-4 first:pt-0 flex flex-col sm:flex-row justify-between sm:items-center gap-4 text-xs font-mono">
              <div className="space-y-1">
                <span className="text-white block font-sans font-bold text-sm">{item.name}</span>
                <span className="text-content-tertiary text-[8px] block">{t('invitedOn', { date: item.date })}</span>
              </div>

              {/* Progress Milestones Checklist Grid */}
              <div className="grid grid-cols-3 gap-2 max-w-xs w-full text-center text-[8px] font-bold uppercase tracking-wider shrink-0">
                <div className={`p-1.5 rounded border ${
                  item.milestones.joined 
                    ? 'bg-surface-positive/20 text-content-positive border-positive-400' 
                    : 'bg-background-secondary text-content-tertiary border-border-opaque'
                }`}>
                  {t('joined')}
                </div>
                <div className={`p-1.5 rounded border ${
                  item.milestones.firstRide 
                    ? 'bg-surface-positive/20 text-content-positive border-positive-400' 
                    : 'bg-background-secondary text-content-tertiary border-border-opaque'
                }`}>
                  {t('firstRideActive')}
                </div>
                <div className={`p-1.5 rounded border ${
                  item.milestones.bonusCredited 
                    ? 'bg-surface-positive/20 text-content-positive border-positive-400' 
                    : 'bg-background-secondary text-content-tertiary border-border-opaque'
                }`}>
                  {t('bonusCredited')}
                </div>
              </div>

              <span className={`text-[8px] font-bold uppercase tracking-wider text-right shrink-0 ${
                item.reward.includes('Rewarded') ? 'text-content-positive' : 'text-content-tertiary'
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
