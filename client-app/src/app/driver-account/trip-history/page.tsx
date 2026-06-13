'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { TripItem, TRIP_HISTORY } from './tripData';
import { DriverTrip, getTripHistory } from '@/api/client';
import { useAuthStore } from '@/store/useAuthStore';
import { FareDisplay } from '@/components/ds';

function mapDriverTripToTripItem(trip: DriverTrip): TripItem {
  const baseFare = trip.base_fare_paise / 100;
  const quotedFare = (trip.base_fare_paise * trip.surge_multiplier) / 100;
  const payout = trip.driver_payout_paise > 0 ? trip.driver_payout_paise / 100 : quotedFare;
  const date = trip.completed_at || trip.assigned_at || '';

  return {
    id: trip.id,
    date: date ? new Date(date).toLocaleString() : 'Unscheduled',
    type: 'CITY',
    route: `Pickup cell ${trip.pickup_h3_cell}`,
    fare: payout,
    status: trip.status,
    car: 'Assigned vehicle',
    rider: 'Rider',
    duration: 0,
    distance: 0,
    ratingGiven: 0,
    ratingReceived: 0,
    commentReceived: 'Live backend trip record',
    pickup: `H3 ${trip.pickup_h3_cell}`,
    dropoff: 'Dropoff location',
    bill: {
      base: baseFare,
      tolls: 0,
      parking: 0,
      waiting: 0,
      surge: Math.max(0, quotedFare - baseFare),
      deductions: 0,
      net: payout,
    },
  };
}

export default function DriverTripHistoryPage() {
  const { token } = useAuthStore();
  const [filterType, setFilterType] = useState<'ALL' | 'CITY' | 'OUTSTATION'>('ALL');
  const [selectedTrip, setSelectedTrip] = useState<TripItem | null>(null);
  const [liveTrips, setLiveTrips] = useState<TripItem[]>([]);
  const [liveLoaded, setLiveLoaded] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  
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

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    getTripHistory(token, 20, 0)
      .then((data) => {
        if (!cancelled) {
          setLiveTrips(data.trips.map(mapDriverTripToTripItem));
          setLiveLoaded(true);
          setHistoryError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('[DriverTripHistory] Trip history fetch failed:', err);
          setHistoryError('Live trip history is unavailable.');
          setLiveLoaded(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const history = liveLoaded ? liveTrips : TRIP_HISTORY;

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
            <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">Filter past completed matches or inspect audit log details</p>
            {historyError && <p className="text-content-negative text-[10px] font-mono mt-2">{historyError}</p>}
          </div>

          {/* Filter Tabs */}
          <div className="flex bg-background-primary p-1 rounded-xl border border-border-opaque max-w-xs font-mono text-[9px]">
            {(['ALL', 'CITY', 'OUTSTATION'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilterType(tab)}
                className={`flex-1 py-1.5 font-bold uppercase rounded-lg transition-all ${
                  filterType === tab ? 'bg-white text-black' : 'text-content-secondary hover:text-white'
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
                className="w-full bg-background-primary hover:bg-background-secondary border border-border-opaque hover:border-border-opaque p-5 rounded-2xl transition cursor-pointer text-left block"
              >
                <div className="flex justify-between items-start gap-4 font-mono text-xs">
                  <div className="space-y-2 flex-grow truncate">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase border ${
                        item.type === 'OUTSTATION' 
                          ? 'bg-surface-accent/20 text-content-accent border-border-accent' 
                          : 'bg-background-secondary text-content-secondary border-border-opaque'
                      }`}>
                        {item.type}
                      </span>
                      <span className="text-[9px] text-content-tertiary font-bold uppercase">{item.date.split(' ')[0]} • ID: {item.id}</span>
                    </div>
                    
                    <h4 className="text-sm font-bold text-white truncate font-sans tracking-tight">
                      {item.route}
                    </h4>
                    <p className="text-[10px] text-content-tertiary font-mono">Vehicle Asset: {item.car.split(' • ')[0]}</p>
                  </div>

                  <div className="text-right shrink-0 flex flex-col justify-between space-y-4">
                    <FareDisplay amount={item.fare * 100} size="md" className="font-bold text-content-positive" />
                    <span className="text-[8px] text-content-tertiary font-bold uppercase tracking-wider block">Details ➔</span>
                  </div>
                </div>
              </button>
            ))}
            {filteredHistory.length === 0 && (
              <div className="bg-background-primary border border-border-opaque p-5 rounded-2xl text-xs text-content-tertiary font-mono">
                No live trips found for this driver.
              </div>
            )}
          </div>
        </div>
      ) : (
        /* DETAIL VIEW: Trip replay and itemized metrics */
        <div className="space-y-6 animate-fadeIn">
          {/* Header */}
          <div className="flex justify-between items-center pb-4 border-b border-border-opaque">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white font-move">Trip Audit Summary</h2>
              <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">ID: {selectedTrip.id.toUpperCase()} ({selectedTrip.date})</p>
            </div>

            <div className="flex items-center gap-2">
              {!liveLoaded && (
                <Link
                  href={`/driver-account/trip-history/${selectedTrip.id}`}
                  className="text-xs font-bold uppercase tracking-wider border border-border-opaque px-4 py-2 rounded-full hover:bg-background-secondary transition font-mono cursor-pointer"
                >
                  Open as page ↗
                </Link>
              )}
              <button
                onClick={() => setSelectedTrip(null)}
                className="text-xs font-bold uppercase tracking-wider border border-border-opaque px-4 py-2 rounded-full hover:bg-background-secondary transition font-mono cursor-pointer"
              >
                ← Close Detail
              </button>
            </div>
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

                {/* Route line */}
                <line x1="30%" y1="70%" x2="70%" y2="30%" stroke="var(--accent-400)" strokeWidth="3" strokeDasharray="5,5" />

                {/* Pickup and dropoff nodes */}
                <circle cx="30%" cy="70%" r="6" fill="var(--positive-400)" />
                <circle cx="70%" cy="30%" r="6" fill="var(--negative-400)" />

                {/* Gliding simulation dot */}
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

            {/* Overlays */}
            <div className="relative z-10 p-4 flex justify-between items-center bg-gradient-to-b from-black to-transparent">
              <span className="bg-background-secondary text-content-secondary border border-border-opaque px-2.5 py-1 rounded text-[8px] font-mono font-bold uppercase tracking-wider">
                GPS REPLAY: {replayProgress}%
              </span>

              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="bg-white text-black font-mono font-bold text-[8px] uppercase px-3 py-1 rounded-full cursor-pointer hover:bg-background-tertiary"
              >
                {isPlaying ? '⏸️ Pause' : '▶️ Play'}
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
                <div>📍 <span className="text-content-tertiary font-bold uppercase text-[9px] block mb-0.5 font-mono">Pickup Hub</span> {selectedTrip.pickup}</div>
                <div>🏁 <span className="text-content-tertiary font-bold uppercase text-[9px] block mb-0.5 font-mono">Destination</span> {selectedTrip.dropoff}</div>
                
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border-opaque text-[10px] font-mono">
                  <div>
                    <span className="text-content-tertiary block text-[8px] uppercase font-bold">Driving Distance</span>
                    <span className="text-white block mt-0.5 font-bold">{selectedTrip.distance} KM</span>
                  </div>
                  <div>
                    <span className="text-content-tertiary block text-[8px] uppercase font-bold">Transit Time</span>
                    <span className="text-white block mt-0.5 font-bold">{selectedTrip.duration} Mins</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bill Receipt Itemized */}
            <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
              <div className="flex justify-between items-center border-b border-border-opaque pb-2">
                <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">
                  Itemized Payout
                </h4>
                
                <button
                  onClick={() => handleDispute(selectedTrip.id)}
                  className="text-content-negative hover:text-content-negative font-mono font-bold text-[8px] uppercase tracking-wider cursor-pointer"
                >
                  Raise Dispute
                </button>
              </div>

              <div className="space-y-2 font-mono text-[10px] text-content-secondary">
                <div className="flex justify-between">
                  <span>Base Package Quoted:</span>
                  <FareDisplay amount={selectedTrip.bill.base * 100} size="md" className="text-white" />
                </div>
                {selectedTrip.bill.tolls > 0 && (
                  <div className="flex justify-between">
                    <span>Toll Additions:</span>
                    <FareDisplay amount={selectedTrip.bill.tolls * 100} size="md" className="text-white" />
                  </div>
                )}
                {selectedTrip.bill.parking > 0 && (
                  <div className="flex justify-between">
                    <span>Parking Additions:</span>
                    <FareDisplay amount={selectedTrip.bill.parking * 100} size="md" className="text-white" />
                  </div>
                )}
                {selectedTrip.bill.waiting > 0 && (
                  <div className="flex justify-between">
                    <span>Waiting Charges:</span>
                    <FareDisplay amount={selectedTrip.bill.waiting * 100} size="md" className="text-white" />
                  </div>
                )}
                {selectedTrip.bill.surge > 0 && (
                  <div className="flex justify-between">
                    <span>Night Surge Surcharge:</span>
                    <FareDisplay amount={selectedTrip.bill.surge * 100} size="md" className="text-white" />
                  </div>
                )}
                <div className="flex justify-between border-t border-border-opaque pt-2 text-content-tertiary">
                  <span>Platform Commission (10%):</span>
                  <span className="text-content-negative">-<FareDisplay amount={selectedTrip.bill.deductions * 100} size="md" /></span>
                </div>
                <div className="flex justify-between font-bold text-xs text-white border-t border-border-opaque pt-2">
                  <span>Net Settled payout:</span>
                  <FareDisplay amount={selectedTrip.bill.net * 100} size="md" className="text-content-positive" />
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
                  {Array.from({ length: selectedTrip.ratingReceived }).map((_, i) => '★').join('')}
                </span>
                <span className="text-content-secondary block text-[9px] mt-0.5">"{selectedTrip.commentReceived}"</span>
              </div>

              <div className="bg-background-secondary/40 p-4 border border-border-opaque rounded-xl space-y-1 text-left">
                <span className="text-content-tertiary text-[8px] uppercase block">Rating You Provided</span>
                <span className="text-content-warning font-bold text-sm block">
                  {Array.from({ length: selectedTrip.ratingGiven }).map((_, i) => '★').join('')}
                </span>
                <span className="text-content-secondary block text-[9px] mt-0.5">Tags: Polite, Safety conscious</span>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
