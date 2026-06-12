'use client';

import React from 'react';
import { useTranslations } from 'next-intl';

export default function DriverIncentivesPage() {
  const t = useTranslations('driverIncentives');
  const quests = [
    { title: t('quest1Title'), desc: t('quest1Desc'), completed: 8, total: 10, reward: 500, expiry: t('expiresInDays', { days: 3 }) },
    { title: t('quest2Title'), desc: t('quest2Desc'), completed: 1, total: 2, reward: 1200, expiry: t('expiresInDays', { days: 5 }) },
    { title: t('quest3Title'), desc: t('quest3Desc'), completed: 12, total: 15, reward: 300, expiry: t('noExpiration') }
  ];

  return (
    <div className="space-y-6 text-left font-sans">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">{t('title')}</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">{t('subtitle')}</p>
      </div>

      {/* Quests Container */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          {t('activeQuests')}
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
                    <span>{t('progress', { completed: q.completed, total: q.total, pct })}</span>
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
          {t('surgeTitle')}
        </h4>

        <div className="space-y-2 text-xs font-mono text-zinc-400">
          <div className="flex justify-between border-b border-zinc-900 pb-1.5">
            <span>{t('surgeZone1')}</span>
            <span className="text-amber-500">{t('surgeExpected', { multiplier: '1.4' })}</span>
          </div>
          <div className="flex justify-between border-b border-zinc-900 pb-1.5">
            <span>{t('surgeZone2')}</span>
            <span className="text-amber-500">{t('surgeExpected', { multiplier: '1.3' })}</span>
          </div>
          <div className="flex justify-between border-b border-zinc-900 pb-1.5">
            <span>{t('surgeZone3')}</span>
            <span className="text-amber-500">{t('surgeExpected', { multiplier: '1.5' })}</span>
          </div>
        </div>
      </div>

    </div>
  );
}
