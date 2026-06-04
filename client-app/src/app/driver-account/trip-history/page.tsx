'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { TripItem, TRIP_HISTORY } from './tripData';

export default function DriverTripHistoryPage() {
  const [filterType, setFilterType] = useState<'ALL' | 'CITY' | 'OUTSTATION'>('ALL');
  const [selectedTrip, setSelectedTrip] = useState<TripItem | null>(null);
  
  // Replay animation state for the detail view
  const [replayProgress, setReplayProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  // Replay animation tick
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (selectedTrip && isPlaying) {
      interval = setInterval(() => {
        setReplayProgress((prev) => (prev >= 100 ? 0 : prev + 2));
      }, 150);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [selectedTrip, isPlaying]);

  const history = TRIP_HISTORY;

  const filteredHistory = filterType === 'ALL'
    ? history 
    : history.filter((t) => t.type === filterType);

  const handleDispute = (id: string) => {
    const reason = prompt('Enter the reason for disputing this trip fare:');
    if (reason) {
      alert(`Dispute ticket registered successfully for Trip ${id}. Central dispatcher agents will verify GPS trail maps and odometer uploads.`);
    }
  };

  const handleSelectTrip = (trip: TripItem) => {
    setSelectedTrip(trip);
    setReplayProgress(0);
    setIsPlaying(true);
  };

  return (
    <div className="space-y-6 text-left">
      
      {/* MASTER VIEW: List of past trips */}
      {!selectedTrip ? (
        <div className="space-y-6 animate-fadeIn">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white font-move">Ride Trip History</h2>
            <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Filter past completed matches or inspect audit log details</p>
          </div>

          {/* Filter Tabs */}
          <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-900 max-w-xs font-mono text-[9px]">
            {(['ALL', 'CITY', 'OUTSTATION'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilterType(tab)}
                className={`flex-1 py-1.5 font-bold uppercase rounded-lg transition-all ${
                  filterType === tab ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* List display */}
          <div className="space-y-3">
            {filteredHistory.map((item) => (
              <button
                key={item.id}
                onClick={() => handleSelectTrip(item)}
                type="button"
                className="w-full bg-zinc-950 hover:bg-zinc-900 border border-zinc-900 hover:border-zinc-850 p-5 rounded-2xl transition cursor-pointer text-left block"
              >
                <div className="flex justify-between items-start gap-4 font-mono text-xs">
                  <div className="space-y-2 flex-grow truncate">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase border ${
                        item.type === 'OUTSTATION' 
                          ? 'bg-blue-950/20 text-blue-400 border-blue-900' 
                          : 'bg-zinc-900 text-zinc-400 border-zinc-850'
                      }`}>
                        {item.type}
                      </span>
                      <span className="text-[9px] text-zinc-500 font-bold uppercase">{item.date.split(' ')[0]} • ID: {item.id}</span>
                    </div>
                    
                    <h4 className="text-sm font-bold text-white truncate font-sans tracking-tight">
                      {item.route}
                    </h4>
                    <p className="text-[10px] text-zinc-500 font-mono">Vehicle Asset: {item.car.split(' • ')[0]}</p>
                  </div>

                  <div className="text-right shrink-0 flex flex-col justify-between space-y-4">
                    <span className="text-sm font-bold text-emerald-400">₹{item.fare.toFixed(2)}</span>
                    <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider block">Details ➔</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* DETAIL VIEW: Trip replay and itemized metrics */
        <div className="space-y-6 animate-fadeIn">
          {/* Header */}
          <div className="flex justify-between items-center pb-4 border-b border-zinc-900">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white font-move">Trip Audit Summary</h2>
              <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">ID: {selectedTrip.id.toUpperCase()} ({selectedTrip.date})</p>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href={`/driver-account/trip-history/${selectedTrip.id}`}
                className="text-xs font-bold uppercase tracking-wider border border-zinc-800 px-4 py-2 rounded-full hover:bg-zinc-900 transition font-mono cursor-pointer"
              >
                Open as page ↗
              </Link>
              <button
                onClick={() => setSelectedTrip(null)}
                className="text-xs font-bold uppercase tracking-wider border border-zinc-800 px-4 py-2 rounded-full hover:bg-zinc-900 transition font-mono cursor-pointer"
              >
                ← Close Detail
              </button>
            </div>
          </div>

          {/* Simulated SVG Map Route Replay */}
          <div className="bg-zinc-950 border border-zinc-900 rounded-2xl overflow-hidden relative min-h-[250px] flex flex-col justify-between">
            <div className="absolute inset-0 bg-black/60 z-0">
              <svg className="w-full h-full opacity-40" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <pattern id="detailGrid" width="30" height="30" patternUnits="userSpaceOnUse">
                    <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#222" strokeWidth="1" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#detailGrid)" />

                {/* Route line */}
                <line x1="30%" y1="70%" x2="70%" y2="30%" stroke="#3b82f6" strokeWidth="3" strokeDasharray="5,5" />
                
                {/* Pickup and dropoff nodes */}
                <circle cx="30%" cy="70%" r="6" fill="#10b981" />
                <circle cx="70%" cy="30%" r="6" fill="#ef4444" />
                
                {/* Gliding simulation dot */}
                <circle 
                  cx={`${30 + (replayProgress / 100) * (70 - 30)}%`} 
                  cy={`${70 + (replayProgress / 100) * (30 - 70)}%`} 
                  r="7" 
                  fill="#fff" 
                  stroke="#1e3b8a" 
                  strokeWidth="2" 
                />
              </svg>
            </div>

            {/* Overlays */}
            <div className="relative z-10 p-4 flex justify-between items-center bg-gradient-to-b from-black to-transparent">
              <span className="bg-zinc-900 text-zinc-400 border border-zinc-850 px-2.5 py-1 rounded text-[8px] font-mono font-bold uppercase tracking-wider">
                GPS REPLAY: {replayProgress}%
              </span>

              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="bg-white text-black font-mono font-bold text-[8px] uppercase px-3 py-1 rounded-full cursor-pointer hover:bg-zinc-200"
              >
                {isPlaying ? '⏸️ Pause' : '▶️ Play'}
              </button>
            </div>

            <div className="relative z-10 p-4 bg-gradient-to-t from-black to-transparent text-[10px] font-mono text-zinc-400">
              <span>Speed sampling: 48 km/h (Stable) • Deviations: None detected</span>
            </div>
          </div>

          {/* Details split grids */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
            
            <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
              <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
                Trip Specifications
              </h4>

              <div className="space-y-3 text-xs font-mono text-zinc-400">
                <div>📍 <span className="text-zinc-600 font-bold uppercase text-[9px] block mb-0.5 font-mono">Pickup Hub</span> {selectedTrip.pickup}</div>
                <div>🏁 <span className="text-zinc-600 font-bold uppercase text-[9px] block mb-0.5 font-mono">Destination</span> {selectedTrip.dropoff}</div>
                
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-900 text-[10px] font-mono">
                  <div>
                    <span className="text-zinc-600 block text-[8px] uppercase font-bold">Driving Distance</span>
                    <span className="text-white block mt-0.5 font-bold">{selectedTrip.distance} KM</span>
                  </div>
                  <div>
                    <span className="text-zinc-600 block text-[8px] uppercase font-bold">Transit Time</span>
                    <span className="text-white block mt-0.5 font-bold">{selectedTrip.duration} Mins</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bill Receipt Itemized */}
            <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
              <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">
                  Itemized Payout
                </h4>
                
                <button
                  onClick={() => handleDispute(selectedTrip.id)}
                  className="text-red-500 hover:text-red-400 font-mono font-bold text-[8px] uppercase tracking-wider cursor-pointer"
                >
                  Raise Dispute
                </button>
              </div>

              <div className="space-y-2 font-mono text-[10px] text-zinc-400">
                <div className="flex justify-between">
                  <span>Base Package Quoted:</span>
                  <span className="text-white">₹{selectedTrip.bill.base.toFixed(2)}</span>
                </div>
                {selectedTrip.bill.tolls > 0 && (
                  <div className="flex justify-between">
                    <span>Toll Additions:</span>
                    <span className="text-white">₹{selectedTrip.bill.tolls.toFixed(2)}</span>
                  </div>
                )}
                {selectedTrip.bill.parking > 0 && (
                  <div className="flex justify-between">
                    <span>Parking Additions:</span>
                    <span className="text-white">₹{selectedTrip.bill.parking.toFixed(2)}</span>
                  </div>
                )}
                {selectedTrip.bill.waiting > 0 && (
                  <div className="flex justify-between">
                    <span>Waiting Charges:</span>
                    <span className="text-white">₹{selectedTrip.bill.waiting.toFixed(2)}</span>
                  </div>
                )}
                {selectedTrip.bill.surge > 0 && (
                  <div className="flex justify-between">
                    <span>Night Surge Surcharge:</span>
                    <span className="text-white">₹{selectedTrip.bill.surge.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-zinc-900 pt-2 text-zinc-500">
                  <span>Platform Commission (10%):</span>
                  <span className="text-red-400">-₹{selectedTrip.bill.deductions.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-xs text-white border-t border-zinc-800 pt-2">
                  <span>Net Settled payout:</span>
                  <span className="text-emerald-400">₹{selectedTrip.bill.net.toFixed(2)}</span>
                </div>
              </div>
            </div>

          </div>

          {/* Feedback details */}
          <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
            <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
              Feedback Exchange Ratings
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-center font-mono">
              <div className="bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl space-y-1 text-left">
                <span className="text-zinc-500 text-[8px] uppercase block">Rating You Received</span>
                <span className="text-amber-500 font-bold text-sm block">
                  {Array.from({ length: selectedTrip.ratingReceived }).map((_, i) => '★').join('')}
                </span>
                <span className="text-zinc-400 block text-[9px] mt-0.5">"{selectedTrip.commentReceived}"</span>
              </div>

              <div className="bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl space-y-1 text-left">
                <span className="text-zinc-500 text-[8px] uppercase block">Rating You Provided</span>
                <span className="text-amber-500 font-bold text-sm block">
                  {Array.from({ length: selectedTrip.ratingGiven }).map((_, i) => '★').join('')}
                </span>
                <span className="text-zinc-400 block text-[9px] mt-0.5">Tags: Polite, Safety conscious</span>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
