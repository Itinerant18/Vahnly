'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function PublicShareContent() {
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
      <header className="border-b border-zinc-850 pb-4 flex justify-between items-center w-full max-w-xl mx-auto text-left">
        <div>
          <span className="bg-emerald-950/20 text-emerald-400 border border-emerald-900 px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider block w-max mb-1">
            Live Public Tracking Share
          </span>
          <h1 className="text-sm font-bold tracking-tight text-white font-mono uppercase">Platform Journey Tracker</h1>
        </div>
        <span className="text-[9px] font-mono text-zinc-500 uppercase font-bold">ID: {tripData.id}</span>
      </header>

      {/* Main Map Box */}
      <main className="w-full max-w-xl mx-auto flex-grow my-6 flex flex-col gap-4 text-left">
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl overflow-hidden relative min-h-[300px] flex flex-col justify-between">
          {/* Simulated SVG Grid Network */}
          <div className="absolute inset-0 bg-black/60 z-0">
            <svg className="w-full h-full opacity-40" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="shareGrid" width="30" height="30" patternUnits="userSpaceOnUse">
                  <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#222" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#shareGrid)" />

              {/* Route */}
              <line x1="25%" y1="75%" x2="75%" y2="25%" stroke="#3b82f6" strokeWidth="3" strokeDasharray="5,5" />
              
              {/* Pickup/Drop */}
              <circle cx="25%" cy="75%" r="6" fill="#10b981" />
              <circle cx="75%" cy="25%" r="6" fill="#ef4444" />
              
              {/* Glide car */}
              <circle 
                cx={`${25 + (replayProgress / 100) * (75 - 25)}%`} 
                cy={`${75 + (replayProgress / 100) * (25 - 75)}%`} 
                r="7" 
                fill="#fff" 
                stroke="#1e3a8a" 
                strokeWidth="2" 
              />
            </svg>
          </div>

          {/* Map details overlay header */}
          <div className="relative z-10 p-4 bg-gradient-to-b from-black to-transparent flex justify-between items-center text-[9px] font-mono font-bold text-zinc-500">
            <span>DRIVER ETA: {Math.max(1, Math.round(tripData.etaMins - (replayProgress / 100) * tripData.etaMins))} MINS</span>
            <span className="bg-emerald-950/20 text-emerald-400 border border-emerald-900 px-2 py-0.5 rounded uppercase">
              EN ROUTE
            </span>
          </div>

          <div className="relative z-10 p-4 bg-gradient-to-t from-black to-transparent text-[9px] font-mono text-zinc-500">
            <span>Live telemetry path sync: 100% active</span>
          </div>
        </div>

        {/* Trip description card details */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-3 border-b border-zinc-900 pb-3">
            <div className="h-10 w-10 bg-zinc-900 rounded-xl flex items-center justify-center text-lg">
              👤
            </div>
            <div>
              <h4 className="text-xs font-bold text-white">{tripData.driverName} ({tripData.driverRating})</h4>
              <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider block mt-0.5">
                Pilot allocated by {tripData.riderName.split(' ')[0]}
              </span>
            </div>
          </div>

          <div className="space-y-2.5 text-xs font-mono text-zinc-400">
            <div>📍 <span className="text-zinc-600 font-bold uppercase text-[8px] block mb-0.5">Pickup Node</span> {tripData.pickup}</div>
            <div>🏁 <span className="text-zinc-600 font-bold uppercase text-[8px] block mb-0.5 font-mono">Destination</span> {tripData.dropoff}</div>
            <div className="border-t border-zinc-900 pt-2.5 text-[9px]">
              <span className="text-zinc-600 block text-[8px] uppercase font-bold">Assigned Vehicle</span>
              <span className="text-white block mt-0.5">{tripData.car}</span>
            </div>
          </div>
        </div>

        {/* Timeline tracker */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3 font-mono text-[9px]">
          <h4 className="text-[10px] font-bold text-white uppercase tracking-wider border-b border-zinc-900 pb-2">
            Trip Progress Timeline
          </h4>
          <div className="space-y-2 text-zinc-400">
            <div className="flex items-center gap-2 text-zinc-500">
              <span>●</span>
              <span>Trip booked at 21:05</span>
            </div>
            <div className="flex items-center gap-2 text-zinc-500">
              <span>●</span>
              <span>Driver assigned at 21:07</span>
            </div>
            <div className="flex items-center gap-2 text-zinc-500">
              <span>●</span>
              <span>Driver arrived at 21:12</span>
            </div>
            <div className="flex items-center gap-2 text-white font-bold">
              <span>●</span>
              <span>Trip started at 21:15 (In transit)</span>
            </div>
          </div>
        </div>
      </main>

      <footer className="w-full max-w-xl mx-auto text-center text-[8px] font-mono text-zinc-700 select-none pt-4 border-t border-zinc-900">
        ENCRYPTED PUBLIC DISPATCH TRAIL • GEOFENCE ENABLED
      </footer>
    </div>
  );
}

export default function PublicSharePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center font-sans text-zinc-500 font-mono text-xs uppercase animate-pulse">
        Establishing Secure Share Connection...
      </div>
    }>
      <PublicShareContent />
    </Suspense>
  );
}
