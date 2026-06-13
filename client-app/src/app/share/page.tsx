'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';

function PublicShareContent() {
  const t = useTranslations('share');
  const searchParams = useSearchParams();
  const tripId = searchParams?.get('tripId') || 'trp-2209';

  const [replayProgress, setReplayProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setReplayProgress((prev) => (prev >= 100 ? 0 : prev + 2));
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const tripData = {
    id: tripId,
    riderName: 'Sarah Connor (Car Owner)',
    driverName: 'Aniket Karmakar',
    driverRating: '★ 4.92',
    car: 'Audi A6 (Automatic) • WB-02-AK-9988',
    pickup: 'Salt Lake Sector V Tech Hub, Kolkata',
    dropoff: 'Park Street Dining Grid, Kolkata',
    status: 'EN_ROUTE_TO_DESTINATION',
    etaMins: 15
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-8 font-sans flex flex-col justify-between selection:bg-white selection:text-black">
      
      {/* Header */}
      <header className="border-b border-border-opaque pb-4 flex justify-between items-center w-full max-w-xl mx-auto text-left">
        <div>
          <span className="bg-surface-positive/20 text-content-positive border border-positive-400 px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider block w-max mb-1">
            {t('liveBadge')}
          </span>
          <h1 className="text-sm font-bold tracking-tight text-white font-mono uppercase">{t('journeyTracker')}</h1>
        </div>
        <span className="text-[9px] font-mono text-content-tertiary uppercase font-bold">{t('idLabel', { id: tripData.id })}</span>
      </header>

      {/* Main Map Box */}
      <main className="w-full max-w-xl mx-auto flex-grow my-6 flex flex-col gap-4 text-left">
        <div className="bg-background-primary border border-border-opaque rounded-2xl overflow-hidden relative min-h-[300px] flex flex-col justify-between">
          {/* Simulated SVG Grid Network */}
          <div className="absolute inset-0 bg-black/60 z-0">
            <svg className="w-full h-full opacity-40" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="shareGrid" width="30" height="30" patternUnits="userSpaceOnUse">
                  <path d="M 30 0 L 0 0 0 30" fill="none" stroke="var(--border-opaque)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#shareGrid)" />

              {/* Route */}
              <line x1="25%" y1="75%" x2="75%" y2="25%" stroke="var(--accent-400)" strokeWidth="3" strokeDasharray="5,5" />

              {/* Pickup/Drop */}
              <circle cx="25%" cy="75%" r="6" fill="var(--positive-400)" />
              <circle cx="75%" cy="25%" r="6" fill="var(--negative-400)" />

              {/* Glide car */}
              <circle
                cx={`${25 + (replayProgress / 100) * (75 - 25)}%`}
                cy={`${75 + (replayProgress / 100) * (25 - 75)}%`}
                r="7"
                fill="var(--content-primary)"
                stroke="var(--accent-400)"
                strokeWidth="2"
              />
            </svg>
          </div>

          {/* Map details overlay header */}
          <div className="relative z-10 p-4 bg-gradient-to-b from-black to-transparent flex justify-between items-center text-[9px] font-mono font-bold text-content-tertiary">
            <span>{t('driverEta', { mins: Math.max(1, Math.round(tripData.etaMins - (replayProgress / 100) * tripData.etaMins)) })}</span>
            <span className="bg-surface-positive/20 text-content-positive border border-positive-400 px-2 py-0.5 rounded uppercase">
              {t('enRoute')}
            </span>
          </div>

          <div className="relative z-10 p-4 bg-gradient-to-t from-black to-transparent text-[9px] font-mono text-content-tertiary">
            <span>{t('telemetrySync')}</span>
          </div>
        </div>

        {/* Trip description card details */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-3 border-b border-border-opaque pb-3">
            <div className="h-10 w-10 bg-background-secondary rounded-xl flex items-center justify-center text-lg">
              👤
            </div>
            <div>
              <h4 className="text-xs font-bold text-white">{tripData.driverName} ({tripData.driverRating})</h4>
              <span className="text-[9px] font-mono text-content-tertiary uppercase tracking-wider block mt-0.5">
                {t('pilotAllocatedBy', { name: tripData.riderName.split(' ')[0] })}
              </span>
            </div>
          </div>

          <div className="space-y-2.5 text-xs font-mono text-content-secondary">
            <div>📍 <span className="text-content-tertiary font-bold uppercase text-[8px] block mb-0.5">{t('pickupNode')}</span> {tripData.pickup}</div>
            <div>🏁 <span className="text-content-tertiary font-bold uppercase text-[8px] block mb-0.5 font-mono">{t('destination')}</span> {tripData.dropoff}</div>
            <div className="border-t border-border-opaque pt-2.5 text-[9px]">
              <span className="text-content-tertiary block text-[8px] uppercase font-bold">{t('assignedVehicle')}</span>
              <span className="text-white block mt-0.5">{tripData.car}</span>
            </div>
          </div>
        </div>

        {/* Timeline tracker */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-3 font-mono text-[9px]">
          <h4 className="text-[10px] font-bold text-white uppercase tracking-wider border-b border-border-opaque pb-2">
            {t('timelineTitle')}
          </h4>
          <div className="space-y-2 text-content-secondary">
            <div className="flex items-center gap-2 text-content-tertiary">
              <span>●</span>
              <span>{t('timelineBooked')}</span>
            </div>
            <div className="flex items-center gap-2 text-content-tertiary">
              <span>●</span>
              <span>{t('timelineAssigned')}</span>
            </div>
            <div className="flex items-center gap-2 text-content-tertiary">
              <span>●</span>
              <span>{t('timelineArrived')}</span>
            </div>
            <div className="flex items-center gap-2 text-white font-bold">
              <span>●</span>
              <span>{t('timelineStarted')}</span>
            </div>
          </div>
        </div>
      </main>

      <footer className="w-full max-w-xl mx-auto text-center text-[8px] font-mono text-content-tertiary select-none pt-4 border-t border-border-opaque">
        {t('footer')}
      </footer>
    </div>
  );
}

export default function PublicSharePage() {
  const t = useTranslations('share');
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center font-sans text-content-tertiary font-mono text-xs uppercase animate-pulse">
        {t('loadingFallback')}
      </div>
    }>
      <PublicShareContent />
    </Suspense>
  );
}
