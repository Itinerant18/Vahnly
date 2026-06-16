'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getDriverPerformance, DriverPerformanceResponse } from '@/api/client';
import { useAuthStore } from '@/store/useAuthStore';

export default function DriverPerformancePage() {
  const t = useTranslations('driverPerformance');
  const { token } = useAuthStore();
  const [data, setData] = useState<DriverPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fallbackMetrics = {
    rating: 4.92,
    acceptance: 96,
    cancellation: 2.1,
    completion: 97.9,
    trips: 412
  };

  const fallbackCompliments = [
    { label: t('compliment1'), count: 184 },
    { label: t('compliment2'), count: 142 },
    { label: t('compliment3'), count: 96 },
    { label: t('compliment4'), count: 88 }
  ];

  const fallbackReviews = [
    { name: 'Anirban Das', rating: 5, date: '2026-06-03', text: t('review1Text') },
    { name: 'Rohan Sen', rating: 5, date: '2026-06-01', text: t('review2Text') },
    { name: 'Priya Dey', rating: 4, date: '2026-05-28', text: t('review3Text') }
  ];

  const fallbackTiers = [
    { name: t('tier1Name'), perks: t('tier1Perks') },
    { name: t('tier2Name'), perks: t('tier2Perks') },
    { name: t('tier3Name'), perks: t('tier3Perks') },
    { name: t('tier4Name'), perks: t('tier4Perks') }
  ];

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await getDriverPerformance(token);
      setData(res);
      setError(null);
    } catch (err) {
      console.warn('[DriverPerformance] fetch failed:', err);
      setError('Live performance data is unavailable.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const metrics = data?.metrics ?? fallbackMetrics;
  const compliments = data?.compliments ?? fallbackCompliments;
  const reviews = data?.reviews ?? fallbackReviews;
  const tiers = data?.tiers ?? fallbackTiers;

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">{t('title')}</h2>
        <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">{t('subtitle')}</p>
        {error && <p className="text-content-negative text-[10px] font-mono mt-2">{error}</p>}
        {loading && <p className="text-content-tertiary text-[10px] font-mono mt-2 animate-pulse uppercase tracking-wider">Loading performance…</p>}
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center font-mono text-xs">
        <div className="bg-background-primary border border-border-opaque p-4 rounded-2xl">
          <span className="text-content-tertiary block text-[8px] uppercase">{t('ratingScore')}</span>
          <span className="text-xl font-bold text-content-warning block mt-1">★ {metrics.rating}</span>
        </div>
        <div className="bg-background-primary border border-border-opaque p-4 rounded-2xl">
          <span className="text-content-tertiary block text-[8px] uppercase">{t('acceptIndex')}</span>
          <span className="text-xl font-bold text-white block mt-1">{metrics.acceptance}%</span>
        </div>
        <div className="bg-background-primary border border-border-opaque p-4 rounded-2xl">
          <span className="text-content-tertiary block text-[8px] uppercase">{t('cancelRate')}</span>
          <span className="text-xl font-bold text-content-negative block mt-1">{metrics.cancellation}%</span>
        </div>
        <div className="bg-background-primary border border-border-opaque p-4 rounded-2xl">
          <span className="text-content-tertiary block text-[8px] uppercase">{t('completeRate')}</span>
          <span className="text-xl font-bold text-content-positive block mt-1">{metrics.completion}%</span>
        </div>
      </div>

      {/* Tier benefits */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
          {t('tierBenefitsTitle')}
        </h4>

        <div className="space-y-3">
          {tiers.map((tier, idx) => (
            <div key={idx} className={`p-3 rounded-xl border text-xs leading-relaxed ${
              idx === 2
                ? 'bg-surface-positive/20 border-positive-400/60 text-content-positive'
                : 'bg-background-secondary/40 border-border-opaque text-content-secondary'
            }`}>
              <span className="block font-bold text-white font-mono text-[10px] uppercase">{tier.name}</span>
              <span className="block mt-0.5">{tier.perks}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Compliments counts */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-3">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
          {t('complimentsTitle')}
        </h4>

        <div className="grid grid-cols-2 gap-4 text-xs font-mono">
          {compliments.map((c, i) => (
            <div key={i} className="flex justify-between border-b border-border-opaque pb-1.5 text-content-secondary">
              <span>{c.label}:</span>
              <span className="text-white font-bold">{c.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Reviews logs */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
          {t('reviewsTitle')}
        </h4>

        <div className="divide-y divide-border-opaque">
          {reviews.map((r, i) => (
            <div key={i} className="py-3.5 space-y-1.5 text-xs">
              <div className="flex justify-between items-center font-mono">
                <div>
                  <span className="text-white font-sans font-semibold">{r.name}</span>
                  <span className="text-content-tertiary text-[8px] ml-2">{r.date}</span>
                </div>
                <span className="text-content-warning font-bold">★ {r.rating}</span>
              </div>
              <p className="text-content-secondary leading-relaxed font-sans">{r.text}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
