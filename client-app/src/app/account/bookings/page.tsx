'use client';

import React, { useState, useEffect } from 'react';

interface BillBreakdown {
  base: number;
  tolls: number;
  parking: number;
  waiting: number;
  surge: number;
  deductions: number;
  net: number;
}

interface BookingItem {
  id: string;
  date: string;
  type: 'CITY' | 'OUTSTATION';
  route: string;
  fare: number;
  status: 'Upcoming' | 'Completed' | 'Cancelled';
  car: string;
  driver: string;
  duration: number;
  distance: number;
  pickup: string;
  dropoff: string;
  bill: BillBreakdown;
}

export default function RiderBookingsPage() {
  const [activeTab, setActiveTab] = useState<'UPCOMING' | 'COMPLETED' | 'CANCELLED'>('COMPLETED');
  const [selectedBooking, setSelectedBooking] = useState<BookingItem | null>(null);
  const [replayProgress, setReplayProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  // Animated GPS replay loop
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (selectedBooking && isPlaying) {
      interval = setInterval(() => {
        setReplayProgress((p) => (p >= 100 ? 0 : p + 2));
      }, 150);
    }
    return () => clearInterval(interval);
  }, [selectedBooking, isPlaying]);

  const bookings: BookingItem[] = [
    {
      id: 'trp-2209',
      date: '2026-06-03 21:30',
      type: 'CITY',
      route: 'Salt Lake Sector V ➔ Park Street Dining Grid',
      fare: 780.00,
      status: 'Completed',
      car: 'Audi A6 Sedan',
      driver: 'Aniket Karmakar (★ 4.92)',
      duration: 38,
      distance: 14.8,
      pickup: 'Salt Lake Sector V Tech Hub, Kolkata',
      dropoff: 'Park Street Dining Grid, Kolkata',
      bill: { base: 780.00, tolls: 50.00, parking: 30.00, waiting: 0, surge: 50.00, deductions: 0, net: 910.00 }
    },
    {
      id: 'trp-2122',
      date: '2026-06-02 18:40',
      type: 'OUTSTATION',
      route: 'Kolkata Airport ➔ Digha Beach Resort',
      fare: 3200.00,
      status: 'Completed',
      car: 'Audi A6 Sedan',
      driver: 'Aniket Karmakar (★ 4.92)',
      duration: 180,
      distance: 175.4,
      pickup: 'Netaji Subhash Chandra Bose Int. Airport, Kolkata',
      dropoff: 'Digha Beach Resort Front Office, West Bengal',
      bill: { base: 3200.00, tolls: 240.00, parking: 50.00, waiting: 0, surge: 100.00, deductions: 0, net: 3590.00 }
    },
    {
      id: 'trp-1990',
      date: '2026-06-05 09:00',
      type: 'CITY',
      route: 'Alipore Hub ➔ Sector V Tech Park',
      fare: 620.00,
      status: 'Upcoming',
      car: 'Maruti Swift',
      driver: 'Awaiting Assignment',
      duration: 40,
      distance: 18.0,
      pickup: 'Alipore Police Bodyguard Line Hub, Kolkata',
      dropoff: 'Salt Lake Sector V Tech Hub, Kolkata',
      bill: { base: 620.00, tolls: 0, parking: 0, waiting: 0, surge: 0, deductions: 0, net: 620.00 }
    }
  ];

  const filtered = bookings.filter((b) => b.status.toUpperCase() === activeTab);

  const handleCancelBooking = (id: string) => {
    if (confirm('Cancel this scheduled trip? Cancellation fees may apply.')) {
      alert(`Booking ${id} cancelled successfully.`);
    }
  };

  const handleSelectBooking = (item: BookingItem) => {
    setSelectedBooking(item);
    setReplayProgress(0);
    setIsPlaying(true);
  };

  return (
    <div className="space-y-6 text-left">
      
      {!selectedBooking ? (
        <div className="space-y-6 animate-fadeIn">
          {/* Header */}
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white font-move">My Bookings</h2>
            <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Inspect upcoming schedules, completed records, or receipt invoice disputes</p>
          </div>

          {/* Tabs */}
          <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-900 max-w-xs font-mono text-[9px]">
            {(['UPCOMING', 'COMPLETED', 'CANCELLED'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTab(t)}
                className={`flex-1 py-1.5 font-bold uppercase rounded-lg transition-all ${
                  activeTab === t ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* List display */}
          <div className="space-y-3">
            {filtered.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-500 italic font-mono">
                No bookings found in this folder.
              </div>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelectBooking(item)}
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
                      <p className="text-[10px] text-zinc-500 font-mono">Vehicle profile: {item.car} • Pilot: {item.driver.split(' ')[0]}</p>
                    </div>

                    <div className="text-right shrink-0 flex flex-col justify-between space-y-4">
                      <span className="text-sm font-bold text-emerald-400">₹{item.fare.toFixed(2)}</span>
                      <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider block">Inspect ➔</span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        /* DETAIL SCREEN */
        <div className="space-y-6 animate-fadeIn">
          {/* Header */}
          <div className="flex justify-between items-center pb-4 border-b border-zinc-900">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white font-move">Booking Audit Receipt</h2>
              <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">ID: {selectedBooking.id.toUpperCase()} ({selectedBooking.date})</p>
            </div>

            <button
              onClick={() => setSelectedBooking(null)}
              className="text-xs font-bold uppercase tracking-wider border border-zinc-800 px-4 py-2 rounded-full hover:bg-zinc-900 transition font-mono cursor-pointer"
            >
              ← Back to index
            </button>
          </div>

          {/* SVG live replay */}
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
                GPS TRAIL REPLAY: {replayProgress}%
              </span>

              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="bg-white text-black font-mono font-bold text-[8px] uppercase px-3 py-1 rounded-full cursor-pointer hover:bg-zinc-200"
              >
                {isPlaying ? '⏸️ Pause' : '▶️ Play'}
              </button>
            </div>

            <div className="relative z-10 p-4 bg-gradient-to-t from-black to-transparent text-[10px] font-mono text-zinc-400">
              <span>Stable tracking telemetry index • No anomalies</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
            {/* Specs */}
            <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
              <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
                Trip Specifications
              </h4>

              <div className="space-y-3 text-xs font-mono text-zinc-400">
                <div>📍 <span className="text-zinc-600 font-bold uppercase text-[9px] block mb-0.5 font-mono">Pickup location</span> {selectedBooking.pickup}</div>
                <div>🏁 <span className="text-zinc-600 font-bold uppercase text-[9px] block mb-0.5 font-mono">Destination</span> {selectedBooking.dropoff}</div>
                
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-900 text-[10px] font-mono">
                  <div>
                    <span className="text-zinc-600 block text-[8px] uppercase font-bold">Driving Distance</span>
                    <span className="text-white block mt-0.5 font-bold">{selectedBooking.distance} KM</span>
                  </div>
                  <div>
                    <span className="text-zinc-600 block text-[8px] uppercase font-bold">Transit Duration</span>
                    <span className="text-white block mt-0.5 font-bold">{selectedBooking.duration} Mins</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Receipt Itemized */}
            <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
              <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">
                  Itemized Receipt
                </h4>
                
                {selectedBooking.status === 'Upcoming' ? (
                  <button
                    onClick={() => handleCancelBooking(selectedBooking.id)}
                    className="text-red-500 hover:text-red-400 font-mono font-bold text-[8px] uppercase tracking-wider cursor-pointer"
                  >
                    Cancel Booking
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      const res = prompt('Describe billing/trip concerns to file support dispute tickets:');
                      if (res) alert('Support ticket raised.');
                    }}
                    className="text-red-500 hover:text-red-400 font-mono font-bold text-[8px] uppercase tracking-wider cursor-pointer"
                  >
                    Dispute Bill
                  </button>
                )}
              </div>

              <div className="space-y-2 font-mono text-[10px] text-zinc-400">
                <div className="flex justify-between">
                  <span>Upfront Base Price Quoted:</span>
                  <span className="text-white">₹{selectedBooking.bill.base.toFixed(2)}</span>
                </div>
                {selectedBooking.bill.tolls > 0 && (
                  <div className="flex justify-between">
                    <span>Toll Additions:</span>
                    <span className="text-white">₹{selectedBooking.bill.tolls.toFixed(2)}</span>
                  </div>
                )}
                {selectedBooking.bill.parking > 0 && (
                  <div className="flex justify-between">
                    <span>Parking Additions:</span>
                    <span className="text-white">₹{selectedBooking.bill.parking.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-xs text-white border-t border-zinc-800 pt-2.5">
                  <span>Total Settled Billing:</span>
                  <span className="text-emerald-400">₹{selectedBooking.bill.net.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
