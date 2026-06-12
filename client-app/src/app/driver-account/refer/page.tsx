'use client';

import React from 'react';
import { useTranslations } from 'next-intl';

export default function DriverReferPage() {
  const t = useTranslations('driverRefer');
  const code = 'DRV-ANIKET-998';

  const stats = {
    joined: 3,
    pending: 1,
    earnings: 1500.00
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: t('shareTitle'),
        text: t('shareText', { code }),
        url: window.location.origin
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(t('shareTextWithLink', { code, link: window.location.origin }));
      alert(t('copySuccess'));
    }
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">{t('title')}</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">{t('subtitle')}</p>
      </div>

      {/* Code card */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-6 text-center space-y-4 max-w-md mx-auto">
        <span className="text-zinc-500 text-[9px] uppercase font-mono tracking-wider font-bold">{t('yourCode')}</span>
        <div className="bg-zinc-900 border border-zinc-850 p-4 rounded-xl font-mono text-xl font-bold tracking-widest text-white select-all">
          {code}
        </div>
        <button
          onClick={handleShare}
          className="w-full bg-white hover:bg-zinc-200 text-black py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer active:scale-95"
        >
          {t('shareButton')}
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-zinc-950 border border-zinc-900 p-5 rounded-2xl space-y-1 text-center font-mono">
          <span className="text-zinc-500 block text-[8px] uppercase">{t('partnersJoined')}</span>
          <span className="text-xl font-bold text-white block mt-0.5">{t('driversCount', { count: stats.joined })}</span>
        </div>
        <div className="bg-zinc-950 border border-zinc-900 p-5 rounded-2xl space-y-1 text-center font-mono">
          <span className="text-zinc-500 block text-[8px] uppercase">{t('pendingVerification')}</span>
          <span className="text-xl font-bold text-white block mt-1">{stats.pending}</span>
        </div>
        <div className="bg-zinc-950 border border-zinc-900 p-5 rounded-2xl space-y-1 text-center font-mono">
          <span className="text-zinc-500 block text-[8px] uppercase">{t('totalReferralPayouts')}</span>
          <span className="text-xl font-bold text-emerald-400 block mt-1">₹{stats.earnings.toFixed(2)}</span>
        </div>
      </div>

      {/* Rules */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3 text-xs leading-relaxed text-zinc-400">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          {t('rewardTermsTitle')}
        </h4>
        <p>{t('rewardTerm1')}</p>
        <p>{t('rewardTerm2')}</p>
        <p>{t('rewardTerm3')}</p>
      </div>

    </div>
  );
}
