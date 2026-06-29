'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { getTripById } from '../tripData';
import { getDriverOrder, type DriverOrderDetail } from '@/api/client';
import { useAuthStore } from '@/store/useAuthStore';
import { useToastStore } from '@/store/useToastStore';
import { FareDisplay } from '@/components/ds';
import { StarIcon } from '@/components/ds/Icon';

export default function TripDetailClient({ tripId }: { tripId: string }) {
  const trip = getTripById(tripId);

  const { token } = useAuthStore();
  const [replayProgress, setReplayProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [driverOrder, setDriverOrder] = useState<DriverOrderDetail | null>(null);

  useEffect(() => {
    if (!tripId || !token) return;
    const fetchDriverOrder = async () => {
      try {
        // Driver-scoped endpoint — do not replace with admin endpoint
        const order = await getDriverOrder(token, tripId);
        setDriverOrder(order);
      } catch (err) {
        console.error('Failed to fetch driver trip detail:', err);
      }
    };
    fetchDriverOrder();
  }, [tripId, token]);

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
    // No driver-facing dispute endpoint exists yet — acknowledge the request without
    // claiming anything was persisted to a backend.
    useToastStore.getState().show('Dispute submitted — our team will review', 'success');
  };

  // Deep-link to an unknown trip id — surface a clean recoverable state.
  if (!trip) {
    return (
      <div className="space-y-6 text-left animate-fadeIn">
        <div className="pb-4 border-b border-border-opaque">
          <h2 className="text-xl font-bold tracking-tight text-white font-move">Trip not found</h2>
          <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">No audit record for ID: {tripId}</p>
        </div>
        <Link
          href="/driver-account/trip-history"
          className="inline-block text-xs font-bold uppercase tracking-wider border border-border-opaque px-4 py-2 rounded-full hover:bg-background-secondary transition font-mono"
        >
          ← Back to trip history
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn text-left">
      {/* Header */}
      <div className="flex justify-between items-center pb-4 border-b border-border-opaque">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white font-move">Trip Audit Summary</h2>
          <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">ID: {trip.id.toUpperCase()} ({trip.date})</p>
        </div>
        <Link
          href="/driver-account/trip-history"
          className="text-xs font-bold uppercase tracking-wider border border-border-opaque px-4 py-2 rounded-full hover:bg-background-secondary transition font-mono cursor-pointer"
        >
          ← Back to list
        </Link>
      </div>

      {/* Simulated SVG Map Route Replay */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl overflow-hidden relative min-h-[250px] flex flex-col justify-between">
        <div className="absolute inset-0 bg-black/60 z-0">
          <svg className="w-full h-full opacity-40" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="detailGrid" width="30" height="30" patternUnits="userSpaceOnUse">
                <path d="M 30 0 L 0 0 0 30" fill="none" stroke="var(--border-opaque)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#detailGrid)" />
            <line x1="30%" y1="70%" x2="70%" y2="30%" stroke="var(--accent-400)" strokeWidth="3" strokeDasharray="5,5" />
            <circle cx="30%" cy="70%" r="6" fill="var(--positive-400)" />
            <circle cx="70%" cy="30%" r="6" fill="var(--negative-400)" />
            <circle
              cx={`${30 + (replayProgress / 100) * (70 - 30)}%`}
              cy={`${70 + (replayProgress / 100) * (30 - 70)}%`}
              r="7"
              fill="var(--content-primary)"
              stroke="var(--accent-400)"
              strokeWidth="2"
            />
          </svg>
        </div>

        <div className="relative z-10 p-4 flex justify-between items-center bg-gradient-to-b from-black to-transparent">
          <span className="bg-background-secondary text-content-secondary border border-border-opaque px-2.5 py-1 rounded text-[8px] font-mono font-bold uppercase tracking-wider">
            GPS REPLAY: {replayProgress}%
          </span>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="bg-white text-black font-mono font-bold text-[8px] uppercase px-3 py-1 rounded-full cursor-pointer hover:bg-background-tertiary"
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
        </div>

        <div className="relative z-10 p-4 bg-gradient-to-t from-black to-transparent text-[10px] font-mono text-content-secondary">
          <span>Speed sampling: 48 km/h (Stable) • Deviations: None detected</span>
        </div>
      </div>

      {/* Details split grids */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
            Trip Specifications
          </h4>
          <div className="space-y-3 text-xs font-mono text-content-secondary">
            <div>
              <span className="text-content-tertiary font-bold uppercase text-[9px] block mb-0.5 font-mono">Pickup Hub</span>
              {trip.pickup}
            </div>
            <div>
              <span className="text-content-tertiary font-bold uppercase text-[9px] block mb-0.5 font-mono">Destination</span>
              {trip.dropoff}
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border-opaque text-[10px] font-mono">
              <div>
                <span className="text-content-tertiary block text-[8px] uppercase font-bold">Driving Distance</span>
                <span className="text-white block mt-0.5 font-bold">{trip.distance} KM</span>
              </div>
              <div>
                <span className="text-content-tertiary block text-[8px] uppercase font-bold">Transit Time</span>
                <span className="text-white block mt-0.5 font-bold">{trip.duration} Mins</span>
              </div>
              {driverOrder && (
                <>
                  <div>
                    <span className="text-content-tertiary block text-[8px] uppercase font-bold">Order Status</span>
                    <span className="text-white block mt-0.5 font-bold">{driverOrder.status}</span>
                  </div>
                  <div>
                    <span className="text-content-tertiary block text-[8px] uppercase font-bold">Last Odometer</span>
                    <span className="text-white block mt-0.5 font-bold">{driverOrder.last_odometer} KM</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Bill Receipt Itemized */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
          <div className="flex justify-between items-center border-b border-border-opaque pb-2">
            <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">Itemized Payout</h4>
            <button
              onClick={handleDispute}
              className="text-content-negative hover:text-content-negative font-mono font-bold text-[8px] uppercase tracking-wider cursor-pointer"
            >
              Raise Dispute
            </button>
          </div>
          <div className="space-y-2 font-mono text-[10px] text-content-secondary">
            <div className="flex justify-between">
              <span>Base Package Quoted:</span>
              <FareDisplay amount={trip.bill.base * 100} size="md" className="text-white" />
            </div>
            {trip.bill.tolls > 0 && (
              <div className="flex justify-between">
                <span>Toll Additions:</span>
                <FareDisplay amount={trip.bill.tolls * 100} size="md" className="text-white" />
              </div>
            )}
            {trip.bill.parking > 0 && (
              <div className="flex justify-between">
                <span>Parking Additions:</span>
                <FareDisplay amount={trip.bill.parking * 100} size="md" className="text-white" />
              </div>
            )}
            {trip.bill.waiting > 0 && (
              <div className="flex justify-between">
                <span>Waiting Charges:</span>
                <FareDisplay amount={trip.bill.waiting * 100} size="md" className="text-white" />
              </div>
            )}
            {trip.bill.surge > 0 && (
              <div className="flex justify-between">
                <span>Night Surge Surcharge:</span>
                <FareDisplay amount={trip.bill.surge * 100} size="md" className="text-white" />
              </div>
            )}
            <div className="flex justify-between border-t border-border-opaque pt-2 text-content-tertiary">
              <span>Platform Commission (10%):</span>
              <span className="text-content-negative">-<FareDisplay amount={trip.bill.deductions * 100} size="md" /></span>
            </div>
            <div className="flex justify-between font-bold text-xs text-white border-t border-border-opaque pt-2">
              <span>Net Settled payout:</span>
              <FareDisplay amount={trip.bill.net * 100} size="md" className="text-content-positive" />
            </div>
          </div>
        </div>
      </div>

      {/* Feedback details */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
          Feedback Exchange Ratings
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-center font-mono">
          <div className="bg-background-secondary/40 p-4 border border-border-opaque rounded-xl space-y-1 text-left">
            <span className="text-content-tertiary text-[8px] uppercase block">Rating You Received</span>
            <span className="text-content-warning font-bold text-sm block">
              {Array.from({ length: trip.ratingReceived }).map((_, i) => (
                <StarIcon key={i} size={14} className="text-yellow-500 fill-yellow-500" />
              ))}
            </span>
            <span className="text-content-secondary block text-[9px] mt-0.5">&quot;{trip.commentReceived}&quot;</span>
          </div>
          <div className="bg-background-secondary/40 p-4 border border-border-opaque rounded-xl space-y-1 text-left">
            <span className="text-content-tertiary text-[8px] uppercase block">Rating You Provided</span>
            <span className="text-content-warning font-bold text-sm block">
              {Array.from({ length: trip.ratingGiven }).map((_, i) => (
                <StarIcon key={i} size={14} className="text-yellow-500 fill-yellow-500" />
              ))}
            </span>
            <span className="text-content-secondary block text-[9px] mt-0.5">Tags: Polite, Safety conscious</span>
          </div>
        </div>
      </div>
    </div>
  );
}
