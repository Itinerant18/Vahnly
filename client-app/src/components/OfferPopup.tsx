'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useOfferStore } from '@/store/useOfferStore';

function formatRupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

interface SlideToAcceptProps {
  onAccept: () => void;
}

function SlideToAccept({ onAccept }: SlideToAcceptProps) {
  const [sliderVal, setSliderVal] = useState(0);
  const sliderRef = useRef<HTMLDivElement | null>(null);

  const handleMove = (clientX: number) => {
    if (!sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const width = rect.width - 48; // handle size
    const relativeX = clientX - rect.left - 24;
    const val = Math.max(0, Math.min(100, (relativeX / width) * 100));
    setSliderVal(val);

    if (val >= 90) {
      onAccept();
      setSliderVal(0);
    }
  };

  const handleEnd = () => {
    if (sliderVal < 90) {
      setSliderVal(0);
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches[0]) {
      handleMove(e.touches[0].clientX);
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (e.buttons === 1) {
      handleMove(e.clientX);
    }
  };

  return (
    <div
      ref={sliderRef}
      className="relative h-12 w-full select-none overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 p-1 flex items-center justify-center"
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      onTouchEnd={handleEnd}
    >
      <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-zinc-500 pointer-events-none animate-pulse">
        {sliderVal > 10 ? '' : '➔ Slide to accept'}
      </span>
      <div
        className="absolute left-1 h-10 w-10 cursor-grab active:cursor-grabbing rounded-lg bg-white shadow-lg flex items-center justify-center text-black font-bold text-xs"
        style={{ left: `calc(${sliderVal}% * (100% - 44px) / 100 + 2px)` }}
        onTouchMove={onTouchMove}
        onMouseMove={onMouseMove}
      >
        ➔
      </div>
    </div>
  );
}

export function OfferPopup() {
  const { token, user } = useAuthStore();
  const { currentOffer, status, offerExpiresAt, acceptOffer, declineOffer, reconcilePendingOffer } = useOfferStore();
  const [remaining, setRemaining] = useState(15);
  const [showDeclinePicker, setShowDeclinePicker] = useState(false);
  const expiredRef = useRef(false);

  const driverID = user?.id || 'drv-aniket-7602';

  // On a fresh offer (incl. a remount after WS reconnect), reconcile against the server
  // so a stale OFFER_PENDING left by a dropped connection is cleared, not hung.
  useEffect(() => {
    if (status === 'OFFER_PENDING') {
      expiredRef.current = false;
      setShowDeclinePicker(false);
      if (token) {
        reconcilePendingOffer(token);
      }
    }
  }, [currentOffer?.orderId, status, token, reconcilePendingOffer]);

  // Clock-based countdown: each tick derives the remaining time from the absolute expiry,
  // so backgrounding the tab (which throttles timers) or a remount cannot stall the
  // auto-decline — on resume the next tick sees time has elapsed and fires TIMEOUT.
  useEffect(() => {
    if (status !== 'OFFER_PENDING') return;

    const tick = () => {
      const expiry = offerExpiresAt ?? Date.now() + 15000;
      const secs = Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
      setRemaining(secs);
      if (secs <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        if (token) {
          declineOffer(token, driverID, 'TIMEOUT');
        }
      }
    };

    tick();
    const interval = window.setInterval(tick, 500);
    return () => window.clearInterval(interval);
  }, [status, offerExpiresAt, token, declineOffer, driverID]);

  if (status !== 'OFFER_PENDING' || !currentOffer) return null;

  const progress = Math.max(0, Math.min(1, remaining / 15));
  const ringStyle = {
    background: `conic-gradient(#ffffff ${progress * 360}deg, #27272a 0deg)`,
  };

  const handleAccept = async () => {
    if (token) {
      await acceptOffer(token, driverID);
    }
  };

  const handleDeclineSelect = async (reason: string) => {
    if (token) {
      await declineOffer(token, driverID, reason);
      setShowDeclinePicker(false);
      alert('Offer declined. A 30-second matching cooldown has been applied.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-white shadow-2xl space-y-4 animate-scaleUp">
        
        {/* HEADER BLOCK */}
        <div className="flex items-start justify-between gap-4">
          <div className="text-left">
            <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-zinc-500">
              Incoming Job Match
            </span>
            <h3 className="mt-0.5 text-lg font-extrabold flex items-center gap-1.5">
              👤 {currentOffer.riderName}
              <span className="text-xs bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded text-amber-500 font-mono font-bold">
                ★ {currentOffer.riderRating.toFixed(2)}
              </span>
            </h3>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <span className="text-[8px] font-mono font-bold bg-zinc-900 border border-zinc-850 px-2 py-0.5 rounded uppercase tracking-wider text-zinc-400">
                🏷️ {currentOffer.tripType}
              </span>
              {currentOffer.d4mCareOptIn && (
                <span className="text-[8px] font-mono font-bold bg-zinc-900 border border-zinc-800 text-white px-2 py-0.5 rounded uppercase tracking-wider">
                  🛡️ D4M Care Protection
                </span>
              )}
            </div>
          </div>

          {/* TIMER PROGRESS CIRCLE */}
          <div
            className="grid h-12 w-12 place-items-center rounded-full p-0.5 shadow-md flex-shrink-0"
            style={ringStyle}
            aria-label={`${remaining} seconds remaining`}
          >
            <div className="grid h-full w-full place-items-center rounded-full bg-zinc-950 font-mono text-[11px] font-bold">
              {remaining}s
            </div>
          </div>
        </div>

        {/* RIDER CAR CONTEXT (Phase 10) */}
        {(currentOffer.carMake || currentOffer.carModel) && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-1.5 text-left">
            <p className="text-sm font-bold text-white">
              Driving their{' '}
              {[currentOffer.carColor, currentOffer.carMake, currentOffer.carModel]
                .filter(Boolean)
                .join(' ')}
            </p>
            <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
              ({currentOffer.carType || 'CAR'} · {currentOffer.carTransmission || 'Any'})
            </p>
            {currentOffer.transmissionMatch === false && (
              <div className="mt-1 rounded-lg border border-amber-600/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-bold text-amber-400">
                ⚠ Requested: {currentOffer.carTransmission || 'Manual'} — doesn&apos;t match your expertise
              </div>
            )}
            <p className="text-[10px] text-zinc-500">For {currentOffer.riderName}</p>
          </div>
        )}

        {/* TRIP INFO GRID */}
        <div className="border-t border-b border-zinc-900 py-3 space-y-2.5 text-xs text-left">
          <div>
            <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-zinc-500 block">Pickup Address</span>
            <p className="text-zinc-200 mt-0.5 font-sans truncate">{currentOffer.pickup.address}</p>
          </div>
          <div>
            <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-zinc-500 block">Drop Address</span>
            <p className="text-zinc-200 mt-0.5 font-sans truncate">{currentOffer.drop.address}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-zinc-900/60 pt-2 text-[10px] font-mono text-zinc-400">
            <div>
              Car requested: <strong className="text-white">{currentOffer.carTypeRequested || 'SEDAN'}</strong>
            </div>
            <div>
              Transmission: <strong className="text-white">{currentOffer.transmissionRequired || 'ANY'}</strong>
            </div>
            <div>
              Est. Distance: <strong className="text-white">{currentOffer.distanceKm ? `${currentOffer.distanceKm.toFixed(1)} km` : '4.5 km'}</strong>
            </div>
            <div>
              Est. Duration: <strong className="text-white">{currentOffer.durationMinutes ? `${currentOffer.durationMinutes} mins` : '12 mins'}</strong>
            </div>
          </div>
        </div>

        {/* NOTES ROW */}
        {currentOffer.notes && (
          <div className="bg-zinc-900/30 border border-zinc-900 p-2.5 rounded-lg text-left">
            <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-zinc-500 block">Special client instructions</span>
            <p className="text-[10px] text-zinc-400 italic mt-0.5 font-sans">"{currentOffer.notes}"</p>
          </div>
        )}

        {/* BOTTOM FARE & CONFIRM CONTROLS */}
        <div className="flex items-center justify-between border-t border-zinc-900 pt-3.5 gap-4">
          <div className="text-left flex-shrink-0">
            <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-zinc-500 block">Est. Payout</span>
            <span className="text-xl font-extrabold text-white font-mono">{formatRupees(currentOffer.fareEstimate)}</span>
          </div>

          <div className="flex-1 flex gap-2 items-center">
            <button
              type="button"
              onClick={() => setShowDeclinePicker(true)}
              className="bg-zinc-900 hover:bg-zinc-850 text-zinc-400 hover:text-white border border-zinc-800 px-4 py-3 rounded-xl font-mono text-[9px] font-bold uppercase tracking-wider transition cursor-pointer"
            >
              Decline
            </button>
            <div className="flex-1">
              <SlideToAccept onAccept={handleAccept} />
            </div>
          </div>
        </div>

      </div>

      {/* Decline Reason Picker Modal Overlay */}
      {showDeclinePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-white shadow-2xl text-left space-y-4 animate-scaleUp">
            <div>
              <h4 className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-400">Decline Reason</h4>
              <p className="text-[10px] text-zinc-500 font-sans mt-0.5">Please indicate why you are declining this job offer to help optimize dispatch algorithms.</p>
            </div>
            
            <div className="flex flex-col gap-2">
              {['Too far', 'Need a break', 'Vehicle issue', 'Other'].map((reason) => (
                <button
                  key={reason}
                  onClick={() => handleDeclineSelect(reason.toUpperCase().replace(/ /g, '_'))}
                  className="w-full text-left bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 hover:border-zinc-700 py-3 px-4 rounded-xl text-xs font-mono transition text-zinc-300 hover:text-white cursor-pointer"
                >
                  {reason}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowDeclinePicker(false)}
              className="w-full bg-zinc-950 border border-zinc-900 text-[10px] font-mono font-bold uppercase py-2 rounded-lg text-zinc-500 hover:text-zinc-300 transition cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
