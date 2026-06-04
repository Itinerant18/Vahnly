'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { getTripById } from '../tripData';

export default function TripDetailClient({ tripId }: { tripId: string }) {
  const trip = getTripById(tripId);

  const [replayProgress, setReplayProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (trip && isPlaying) {
      interval = setInterval(() => {
        setReplayProgress((prev) => (prev >= 100 ? 0 : prev + 2));
      }, 150);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [trip, isPlaying]);

  const handleDispute = () => {
    if (!trip) return;
    const reason = prompt('Enter the reason for disputing this trip fare:');
    if (reason) {
      alert(`Dispute ticket registered successfully for Trip ${trip.id}. Central dispatcher agents will verify GPS trail maps and odometer uploads.`);
    }
  };

  // Deep-link to an unknown trip id — surface a clean recoverable state.
  if (!trip) {
    return (
      <div className="space-y-6 text-left animate-fadeIn">
        <div className="pb-4 border-b border-zinc-900">
          <h2 className="text-xl font-bold tracking-tight text-white font-move">Trip not found</h2>
          <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">No audit record for ID: {tripId}</p>
        </div>
        <Link
          href="/driver-account/trip-history"
          className="inline-block text-xs font-bold uppercase tracking-wider border border-zinc-800 px-4 py-2 rounded-full hover:bg-zinc-900 transition font-mono"
        >
          ← Back to trip history
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn text-left">
      {/* Header */}
      <div className="flex justify-between items-center pb-4 border-b border-zinc-900">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white font-move">Trip Audit Summary</h2>
          <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">ID: {trip.id.toUpperCase()} ({trip.date})</p>
        </div>
        <Link
          href="/driver-account/trip-history"
          className="text-xs font-bold uppercase tracking-wider border border-zinc-800 px-4 py-2 rounded-full hover:bg-zinc-900 transition font-mono cursor-pointer"
        >
          ← Back to list
        </Link>
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
            <line x1="30%" y1="70%" x2="70%" y2="30%" stroke="#3b82f6" strokeWidth="3" strokeDasharray="5,5" />
            <circle cx="30%" cy="70%" r="6" fill="#10b981" />
            <circle cx="70%" cy="30%" r="6" fill="#ef4444" />
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

        <div className="relative z-10 p-4 flex justify-between items-center bg-gradient-to-b from-black to-transparent">
          <span className="bg-zinc-900 text-zinc-400 border border-zinc-850 px-2.5 py-1 rounded text-[8px] font-mono font-bold uppercase tracking-wider">
            GPS REPLAY: {replayProgress}%
          </span>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="bg-white text-black font-mono font-bold text-[8px] uppercase px-3 py-1 rounded-full cursor-pointer hover:bg-zinc-200"
          >
            {isPlaying ? 'Pause' : 'Play'}
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
            <div>
              <span className="text-zinc-600 font-bold uppercase text-[9px] block mb-0.5 font-mono">Pickup Hub</span>
              {trip.pickup}
            </div>
            <div>
              <span className="text-zinc-600 font-bold uppercase text-[9px] block mb-0.5 font-mono">Destination</span>
              {trip.dropoff}
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-900 text-[10px] font-mono">
              <div>
                <span className="text-zinc-600 block text-[8px] uppercase font-bold">Driving Distance</span>
                <span className="text-white block mt-0.5 font-bold">{trip.distance} KM</span>
              </div>
              <div>
                <span className="text-zinc-600 block text-[8px] uppercase font-bold">Transit Time</span>
                <span className="text-white block mt-0.5 font-bold">{trip.duration} Mins</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bill Receipt Itemized */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
          <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
            <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">Itemized Payout</h4>
            <button
              onClick={handleDispute}
              className="text-red-500 hover:text-red-400 font-mono font-bold text-[8px] uppercase tracking-wider cursor-pointer"
            >
              Raise Dispute
            </button>
          </div>
          <div className="space-y-2 font-mono text-[10px] text-zinc-400">
            <div className="flex justify-between">
              <span>Base Package Quoted:</span>
              <span className="text-white">₹{trip.bill.base.toFixed(2)}</span>
            </div>
            {trip.bill.tolls > 0 && (
              <div className="flex justify-between">
                <span>Toll Additions:</span>
                <span className="text-white">₹{trip.bill.tolls.toFixed(2)}</span>
              </div>
            )}
            {trip.bill.parking > 0 && (
              <div className="flex justify-between">
                <span>Parking Additions:</span>
                <span className="text-white">₹{trip.bill.parking.toFixed(2)}</span>
              </div>
            )}
            {trip.bill.waiting > 0 && (
              <div className="flex justify-between">
                <span>Waiting Charges:</span>
                <span className="text-white">₹{trip.bill.waiting.toFixed(2)}</span>
              </div>
            )}
            {trip.bill.surge > 0 && (
              <div className="flex justify-between">
                <span>Night Surge Surcharge:</span>
                <span className="text-white">₹{trip.bill.surge.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-zinc-900 pt-2 text-zinc-500">
              <span>Platform Commission (10%):</span>
              <span className="text-red-400">-₹{trip.bill.deductions.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-xs text-white border-t border-zinc-800 pt-2">
              <span>Net Settled payout:</span>
              <span className="text-emerald-400">₹{trip.bill.net.toFixed(2)}</span>
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
              {Array.from({ length: trip.ratingReceived }).map(() => '★').join('')}
            </span>
            <span className="text-zinc-400 block text-[9px] mt-0.5">&quot;{trip.commentReceived}&quot;</span>
          </div>
          <div className="bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl space-y-1 text-left">
            <span className="text-zinc-500 text-[8px] uppercase block">Rating You Provided</span>
            <span className="text-amber-500 font-bold text-sm block">
              {Array.from({ length: trip.ratingGiven }).map(() => '★').join('')}
            </span>
            <span className="text-zinc-400 block text-[9px] mt-0.5">Tags: Polite, Safety conscious</span>
          </div>
        </div>
      </div>
    </div>
  );
}
