'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { LocationIcon, FlagIcon } from '@/components/ds/Icon';

interface BillBreakdown {
  basePaise: number;
  tollsPaise: number;
  parkingPaise: number;
  waitingPaise: number;
  surgePaise: number;
  deductionsPaise: number;
  netPaise: number;
}

interface BookingItem {
  id: string;
  date: string;
  type: 'CITY' | 'OUTSTATION';
  route: string;
  status: 'Upcoming' | 'Ongoing' | 'Completed' | 'Cancelled';
  car: string;
  driver: string;
  duration: number;
  distance: number;
  pickup: string;
  dropoff: string;
  bill: BillBreakdown;
  pathPoints: { x: number; y: number }[]; // Coordinates for true trajectory replay
}

export default function RiderBookingsPage() {
  const t = useTranslations('accountBookings');
  const [activeTab, setActiveTab] = useState<'UPCOMING' | 'ONGOING' | 'COMPLETED' | 'CANCELLED'>('COMPLETED');
  const [selectedBooking, setSelectedBooking] = useState<BookingItem | null>(null);
  const [replayProgress, setReplayProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | null>(null);

  const formatPaise = (paise: number) => {
    return `₹${(paise / 100).toFixed(2)}`;
  };

  const bookings: BookingItem[] = [
    {
      id: 'trp-2209',
      date: '2026-06-03 21:30',
      type: 'CITY',
      route: 'Salt Lake Sector V ➔ Park Street Dining Grid',
      status: 'Completed',
      car: 'Audi A6 Sedan',
      driver: 'Aniket Karmakar (★ 4.92)',
      duration: 38,
      distance: 14.8,
      pickup: 'Salt Lake Sector V Tech Hub, Kolkata',
      dropoff: 'Park Street Dining Grid, Kolkata',
      bill: { basePaise: 78000, tollsPaise: 5000, parkingPaise: 3000, waitingPaise: 0, surgePaise: 5000, deductionsPaise: 0, netPaise: 91000 },
      pathPoints: [
        { x: 50, y: 150 },
        { x: 100, y: 120 },
        { x: 150, y: 140 },
        { x: 200, y: 90 },
        { x: 250, y: 110 },
        { x: 300, y: 50 }
      ]
    },
    {
      id: 'trp-2122',
      date: '2026-06-02 18:40',
      type: 'OUTSTATION',
      route: 'Kolkata Airport ➔ Digha Beach Resort',
      status: 'Completed',
      car: 'Audi A6 Sedan',
      driver: 'Aniket Karmakar (★ 4.92)',
      duration: 180,
      distance: 175.4,
      pickup: 'Netaji Subhash Chandra Bose Int. Airport, Kolkata',
      dropoff: 'Digha Beach Resort Front Office, West Bengal',
      bill: { basePaise: 320000, tollsPaise: 24000, parkingPaise: 5000, waitingPaise: 0, surgePaise: 10000, deductionsPaise: 0, netPaise: 359000 },
      pathPoints: [
        { x: 40, y: 160 },
        { x: 90, y: 140 },
        { x: 130, y: 130 },
        { x: 190, y: 100 },
        { x: 240, y: 80 },
        { x: 310, y: 40 }
      ]
    },
    {
      id: 'trp-1990',
      date: '2026-06-05 09:00',
      type: 'CITY',
      route: 'Alipore Hub ➔ Sector V Tech Park',
      status: 'Upcoming',
      car: 'Maruti Swift',
      driver: 'Awaiting Assignment',
      duration: 40,
      distance: 18.0,
      pickup: 'Alipore Police Bodyguard Line Hub, Kolkata',
      dropoff: 'Salt Lake Sector V Tech Hub, Kolkata',
      bill: { basePaise: 62000, tollsPaise: 0, parkingPaise: 0, waitingPaise: 0, surgePaise: 0, deductionsPaise: 0, netPaise: 62000 },
      pathPoints: []
    },
    {
      id: 'trp-3031',
      date: '2026-06-04 14:10',
      type: 'CITY',
      route: 'Howrah Railway Station ➔ Gariahat Junction',
      status: 'Ongoing',
      car: 'Hyundai Verna',
      driver: 'Rajesh Sen (★ 4.88)',
      duration: 25,
      distance: 11.2,
      pickup: 'Howrah Station Platform 1 Exit, Howrah',
      dropoff: 'Gariahat Shopping Junction, Kolkata',
      bill: { basePaise: 48000, tollsPaise: 2000, parkingPaise: 0, waitingPaise: 0, surgePaise: 3000, deductionsPaise: 0, netPaise: 53000 },
      pathPoints: [
        { x: 30, y: 180 },
        { x: 80, y: 160 },
        { x: 140, y: 120 },
        { x: 210, y: 110 }
      ]
    }
  ];

  // Replay animation loop
  useEffect(() => {
    let lastTime = 0;
    const animate = (time: number) => {
      if (isPlaying && selectedBooking && selectedBooking.pathPoints.length > 0) {
        if (time - lastTime > 40) {
          setReplayProgress((p) => (p >= 100 ? 0 : p + 1));
          lastTime = time;
        }
      }
      requestRef.current = requestAnimationFrame(animate);
    };

    if (selectedBooking) {
      requestRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [selectedBooking, isPlaying]);

  // Render path to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedBooking || selectedBooking.pathPoints.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Canvas can't consume CSS vars directly — resolve design tokens once per draw.
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Grid background
    ctx.strokeStyle = v('--background-secondary');
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Draw Hooghly River outline simulation
    ctx.strokeStyle = v('--accent-400');
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.bezierCurveTo(40, 60, -10, 140, 30, 200);
    ctx.stroke();

    const points = selectedBooking.pathPoints;

    // Draw traveled path line
    ctx.strokeStyle = v('--accent-400');
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]); // Reset line dash

    // Draw pickup/dropoff anchors
    const start = points[0];
    const end = points[points.length - 1];

    ctx.fillStyle = v('--positive-400'); // Green pickup
    ctx.beginPath();
    ctx.arc(start.x, start.y, 6, 0, 2 * Math.PI);
    ctx.fill();

    ctx.fillStyle = v('--negative-400'); // Red destination
    ctx.beginPath();
    ctx.arc(end.x, end.y, 6, 0, 2 * Math.PI);
    ctx.fill();

    // Interpolate gliding dot position
    const segmentCount = points.length - 1;
    const totalProgress = replayProgress / 100;
    const rawProgress = totalProgress * segmentCount;
    const activeSegment = Math.min(Math.floor(rawProgress), segmentCount - 1);
    const segmentProgress = rawProgress - activeSegment;

    const p1 = points[activeSegment];
    const p2 = points[activeSegment + 1];

    if (p1 && p2) {
      const dotX = p1.x + (p2.x - p1.x) * segmentProgress;
      const dotY = p1.y + (p2.y - p1.y) * segmentProgress;

      ctx.fillStyle = v('--content-primary');
      ctx.strokeStyle = v('--accent-400');
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 7, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
  }, [selectedBooking, replayProgress]);

  const filtered = bookings.filter((b) => b.status.toUpperCase() === activeTab);

  const handleCancelBooking = (id: string) => {
    if (confirm(t('cancelConfirm'))) {
      alert(t('cancelSuccess', { id }));
    }
  };

  const handleSelectBooking = (item: BookingItem) => {
    setSelectedBooking(item);
    setReplayProgress(0);
    setIsPlaying(true);
  };

  const handleCloneBooking = (item: BookingItem) => {
    // Redirect with query parameters to prefill the booking console layout
    window.location.href = `/rider?pickup=${encodeURIComponent(item.pickup)}&dropoff=${encodeURIComponent(item.dropoff)}&type=${item.type}`;
  };

  const handleRaiseDispute = (item: BookingItem) => {
    // Redirect to support page with trip ID and auto pre-select option
    window.location.href = `/account/support?tripId=${item.id}`;
  };

  return (
    <div className="space-y-6 text-left">
      
      {!selectedBooking ? (
        <div className="space-y-6 animate-fadeIn">
          {/* Header */}
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white font-move">{t('title')}</h2>
            <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">{t('subtitle')}</p>
          </div>

          {/* Tabs */}
          <div className="flex bg-background-primary p-1 rounded-xl border border-border-opaque max-w-sm font-mono text-[9px]">
            {(['UPCOMING', 'ONGOING', 'COMPLETED', 'CANCELLED'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-1.5 font-bold uppercase rounded-lg transition-all cursor-pointer ${
                  activeTab === tab ? 'bg-white text-black' : 'text-content-secondary hover:text-white'
                }`}
              >
                {t(`tab${tab.charAt(0)}${tab.slice(1).toLowerCase()}`)}
              </button>
            ))}
          </div>

          {/* List display */}
          <div className="space-y-3">
            {filtered.length === 0 ? (
              <div className="py-8 text-center text-xs text-content-tertiary italic font-mono">
                {t('emptyList')}
              </div>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelectBooking(item)}
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
                        <span className="text-[9px] text-content-tertiary font-bold uppercase">{item.date.split(' ')[0]} • {t('idLabel')}: {item.id}</span>
                      </div>
                      
                      <h4 className="text-sm font-bold text-white truncate font-sans tracking-tight">
                        {item.route}
                      </h4>
                      <p className="text-[10px] text-content-tertiary font-mono">{t('vehicleLabel')}: {item.car} • {t('pilotLabel')}: {item.driver.split(' ')[0]}</p>
                    </div>

                    <div className="text-right shrink-0 flex flex-col justify-between space-y-4">
                      <span className="text-sm font-bold text-content-positive">{formatPaise(item.bill.netPaise)}</span>
                      <span className="text-[8px] text-content-tertiary font-bold uppercase tracking-wider block">{t('inspect')}</span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        /* DETAIL EXPLORER VIEW */
        <div className="space-y-6 animate-fadeIn">
          {/* Header */}
          <div className="flex justify-between items-center pb-4 border-b border-border-opaque">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white font-move">{t('detailTitle')}</h2>
              <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">{t('detailMeta', { id: selectedBooking.id.toUpperCase(), date: selectedBooking.date })}</p>
            </div>

            <button
              onClick={() => setSelectedBooking(null)}
              className="text-xs font-bold uppercase tracking-wider border border-border-opaque px-4 py-2 rounded-full hover:bg-background-secondary transition font-mono cursor-pointer"
            >
              {t('backToList')}
            </button>
          </div>

          {/* HTML5 Canvas live replay */}
          {selectedBooking.pathPoints.length > 0 ? (
            <div className="bg-background-primary border border-border-opaque rounded-2xl overflow-hidden relative min-h-[250px] flex flex-col justify-between">
              <canvas 
                ref={canvasRef} 
                width={350} 
                height={200}
                className="w-full h-full min-h-[200px] object-cover bg-black"
              />

              {/* Controls Overlay */}
              <div className="absolute inset-x-0 top-0 p-4 flex justify-between items-center bg-gradient-to-b from-black to-transparent z-10">
                <span className="bg-background-secondary text-content-secondary border border-border-opaque px-2.5 py-1 rounded text-[8px] font-mono font-bold uppercase tracking-wider">
                  {t('gpsTrailReplay', { progress: replayProgress })}
                </span>

                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="bg-white text-black font-mono font-bold text-[8px] uppercase px-3 py-1 rounded-full cursor-pointer hover:bg-background-tertiary"
                >
                  {isPlaying ? t('pause') : t('play')}
                </button>
              </div>

              <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black to-transparent text-[10px] font-mono text-content-secondary z-10">
                <span>{t('telemetryStatus')}</span>
              </div>
            </div>
          ) : (
            <div className="bg-background-primary border border-border-opaque rounded-2xl p-6 text-center text-xs text-content-tertiary italic font-mono">
              {t('gpsUnavailable')}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
            {/* Specs card */}
            <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
              <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2 flex justify-between items-center">
                <span>{t('tripSpecifications')}</span>
                <button
                  onClick={() => handleCloneBooking(selectedBooking)}
                  className="text-[8px] text-content-secondary hover:text-white underline uppercase cursor-pointer"
                >
                  {t('rebookClone')}
                </button>
              </h4>

              <div className="space-y-3 text-xs font-mono text-content-secondary">
                <div><LocationIcon size={20} /> <span className="text-content-tertiary font-bold uppercase text-[9px] block mb-0.5 font-mono">{t('pickupLocation')}</span> {selectedBooking.pickup}</div>
                <div><FlagIcon size={20} /> <span className="text-content-tertiary font-bold uppercase text-[9px] block mb-0.5 font-mono">{t('destination')}</span> {selectedBooking.dropoff}</div>
                
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border-opaque text-[10px] font-mono">
                  <div>
                    <span className="text-content-tertiary block text-[8px] uppercase font-bold">{t('drivingDistance')}</span>
                    <span className="text-white block mt-0.5 font-bold">{t('distanceValue', { distance: selectedBooking.distance })}</span>
                  </div>
                  <div>
                    <span className="text-content-tertiary block text-[8px] uppercase font-bold">{t('transitDuration')}</span>
                    <span className="text-white block mt-0.5 font-bold">{t('durationValue', { duration: selectedBooking.duration })}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Receipt Itemized card */}
            <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
              <div className="flex justify-between items-center border-b border-border-opaque pb-2">
                <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">
                  {t('itemizedReceipt')}
                </h4>
                
                {selectedBooking.status === 'Upcoming' ? (
                  <button
                    onClick={() => handleCancelBooking(selectedBooking.id)}
                    className="text-content-negative hover:text-content-negative font-mono font-bold text-[8px] uppercase tracking-wider cursor-pointer"
                  >
                    {t('cancelBooking')}
                  </button>
                ) : (
                  <button
                    onClick={() => handleRaiseDispute(selectedBooking)}
                    className="text-content-negative hover:text-content-negative font-mono font-bold text-[8px] uppercase tracking-wider cursor-pointer"
                  >
                    {t('disputeBill')}
                  </button>
                )}
              </div>

              <div className="space-y-2 font-mono text-[10px] text-content-secondary">
                <div className="flex justify-between">
                  <span>{t('upfrontBasePrice')}</span>
                  <span className="text-white">{formatPaise(selectedBooking.bill.basePaise)}</span>
                </div>
                {selectedBooking.bill.tollsPaise > 0 && (
                  <div className="flex justify-between">
                    <span>{t('tollAdditions')}</span>
                    <span className="text-white">{formatPaise(selectedBooking.bill.tollsPaise)}</span>
                  </div>
                )}
                {selectedBooking.bill.parkingPaise > 0 && (
                  <div className="flex justify-between">
                    <span>{t('parkingAdditions')}</span>
                    <span className="text-white">{formatPaise(selectedBooking.bill.parkingPaise)}</span>
                  </div>
                )}
                {selectedBooking.bill.surgePaise > 0 && (
                  <div className="flex justify-between">
                    <span>{t('surgeMultipliers')}</span>
                    <span className="text-white">{formatPaise(selectedBooking.bill.surgePaise)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-xs text-white border-t border-border-opaque pt-2.5">
                  <span>{t('totalSettledBilling')}</span>
                  <span className="text-content-positive">{formatPaise(selectedBooking.bill.netPaise)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
