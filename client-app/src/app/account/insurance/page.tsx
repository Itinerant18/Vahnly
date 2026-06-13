'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FareDisplay } from '@/components/ds';

export default function RiderInsurancePage() {
  const t = useTranslations('accountInsurance');
  const [subscription, setSubscription] = useState('TRIP_BY_TRIP');
  const [claims, setClaims] = useState([
    { id: 'CLM-011', date: '2026-05-10', type: 'Windshield crack compensation', amount: 4500.00, status: 'Settled' }
  ]);

  const handleFileClaim = () => {
    const reason = prompt(t('incidentPrompt'));
    if (!reason) return;

    const created = {
      id: `CLM-${Math.floor(Math.random() * 900 + 100)}`,
      date: new Date().toISOString().split('T')[0],
      type: reason,
      amount: 0,
      status: 'Awaiting Document Review'
    };

    setClaims((prev) => [created, ...prev]);
    alert(t('claimSubmitted', { id: created.id }));
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div className="flex justify-between items-center pb-4 border-b border-border-opaque">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white font-move">{t('title')}</h2>
          <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">{t('subtitle')}</p>
        </div>

        <button
          onClick={handleFileClaim}
          className="bg-white hover:bg-background-tertiary text-black text-[10px] font-mono font-bold uppercase px-4 py-2 rounded-full cursor-pointer"
        >
          {t('fileClaim')}
        </button>
      </div>

      {/* Subscription Type */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
          {t('subscriptionPlan')}
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <label className="flex items-center justify-between p-3.5 bg-background-secondary/40 border border-border-opaque rounded-xl cursor-pointer">
            <div className="flex items-center gap-3">
              <input
                type="radio"
                name="insurance-sub"
                checked={subscription === 'TRIP_BY_TRIP'}
                onChange={() => setSubscription('TRIP_BY_TRIP')}
              />
              <div>
                <span className="text-white font-sans font-medium block">{t('tripByTripCoverage')}</span>
                <span className="text-[9px] text-content-tertiary block mt-0.5">{t('tripByTripPrice')}</span>
              </div>
            </div>
          </label>

          <label className="flex items-center justify-between p-3.5 bg-background-secondary/40 border border-border-opaque rounded-xl cursor-pointer">
            <div className="flex items-center gap-3">
              <input
                type="radio"
                name="insurance-sub"
                checked={subscription === 'MONTHLY'}
                onChange={() => setSubscription('MONTHLY')}
              />
              <div>
                <span className="text-white font-sans font-medium block">{t('monthlyUnlimitedPack')}</span>
                <span className="text-[9px] text-content-tertiary block mt-0.5">{t('monthlyUnlimitedPrice')}</span>
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Coverage details */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-3 font-mono text-xs text-content-secondary">
        <span className="text-content-tertiary block text-[8px] uppercase font-bold border-b border-border-opaque pb-1.5">{t('policyDetails')}</span>
        <div className="flex justify-between">
          <span>{t('accidentalDamageShield')}</span>
          <span className="text-white">{t('accidentalDamageValue')}</span>
        </div>
        <div className="flex justify-between">
          <span>{t('medicalExpenseCoverage')}</span>
          <span className="text-white">{t('medicalExpenseValue')}</span>
        </div>
        <div className="flex justify-between">
          <span>{t('roadsideTowingSupport')}</span>
          <span className="text-white">{t('roadsideTowingValue')}</span>
        </div>
      </div>

      {/* Past Claims */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
          {t('claimsHistory')}
        </h4>

        <div className="divide-y divide-border-opaque">
          {claims.map((c) => (
            <div key={c.id} className="py-3 flex justify-between items-center text-xs font-mono">
              <div>
                <span className="text-white block font-sans font-medium">{c.type}</span>
                <span className="text-content-tertiary text-[8px] block mt-0.5">{c.date} • ID: {c.id}</span>
              </div>
              <div className="text-right">
                {c.amount > 0 && <FareDisplay amount={c.amount * 100} size="md" className="text-white block font-bold" />}
                <span className={`text-[8px] block mt-0.5 font-bold uppercase ${c.status === 'Settled' ? 'text-content-positive' : 'text-content-warning animate-pulse'}`}>
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
