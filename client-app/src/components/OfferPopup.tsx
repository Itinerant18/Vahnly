'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useOfferStore } from '@/store/useOfferStore';
import { FareDisplay } from '@/components/ds';

// ── Slide-to-Accept ───────────────────────────────────────────────────────────
// Uses DS tokens only — no hardcoded hex values.

interface SlideToAcceptProps {
  onAccept: () => void;
  variant?: 'accept' | 'end';
}

function SlideToAccept({ onAccept, variant = 'accept' }: SlideToAcceptProps) {
  const [sliderVal, setSliderVal] = useState(0);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const isDragging = useRef(false);

  const trackCls =
    variant === 'accept'
      ? 'bg-surface-positive border border-positive-300'
      : 'bg-surface-negative border border-negative-300';
  const thumbCls =
    variant === 'accept'
      ? 'bg-status-online'
      : 'bg-status-negative';
  const labelCls =
    variant === 'accept'
      ? 'text-content-positive'
      : 'text-content-negative';
  const label = variant === 'accept' ? 'Slide to accept →' : 'Slide to end trip →';

  const handleMove = (clientX: number) => {
    if (!sliderRef.current || !isDragging.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const width = rect.width - 52;
    const relativeX = clientX - rect.left - 26;
    const val = Math.max(0, Math.min(100, (relativeX / width) * 100));
    setSliderVal(val);
    if (val >= 90) {
      isDragging.current = false;
      onAccept();
      setSliderVal(0);
    }
  };

  const handleEnd = () => {
    isDragging.current = false;
    if (sliderVal < 90) setSliderVal(0);
  };

  return (
    <div
      ref={sliderRef}
      className={`relative h-14 w-full select-none overflow-hidden rounded-pill flex items-center justify-center ${trackCls}`}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      onTouchEnd={handleEnd}
    >
      {/* Label — fades as thumb moves */}
      <span
        className={`text-label-medium font-body pointer-events-none transition-opacity duration-100 ${labelCls}`}
        style={{ opacity: Math.max(0, 1 - sliderVal / 40) }}
      >
        {label}
      </span>

      {/* Draggable thumb */}
      <div
        className={`absolute left-1 w-12 h-12 rounded-pill ${thumbCls} shadow-elevation-2 flex items-center justify-center text-white cursor-grab active:cursor-grabbing z-10 transition-none`}
        style={{ left: `calc(${sliderVal}% * (100% - 52px) / 100 + 2px)` }}
        onMouseDown={(e) => { e.preventDefault(); isDragging.current = true; }}
        onMouseMove={(e) => handleMove(e.clientX)}
        onTouchStart={() => { isDragging.current = true; }}
        onTouchMove={(e) => e.touches[0] && handleMove(e.touches[0].clientX)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

// ── Countdown Ring ────────────────────────────────────────────────────────────

interface CountdownRingProps {
  remaining: number; // seconds
  total?: number;    // default 15
}

function CountdownRing({ remaining, total = 15 }: CountdownRingProps) {
  const r = 20;
  const circ = 2 * Math.PI * r;
  const progress = Math.max(0, Math.min(1, remaining / total));
  const offset = circ * (1 - progress);

  // warning-400 until 5s, then negative-400
  const strokeClass = remaining > 5 ? 'text-status-pending' : 'text-status-negative';

  return (
    <div className="relative flex-shrink-0 w-14 h-14 flex items-center justify-center">
      <svg width="56" height="56" viewBox="0 0 56 56" className="-rotate-90">
        {/* Track */}
        <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-border-opaque" />
        {/* Progress */}
        <circle
          cx="28" cy="28" r={r}
          fill="none" stroke="currentColor" strokeWidth="3"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={`${strokeClass} transition-[stroke-dashoffset] duration-100 linear`}
        />
      </svg>
      {/* Center number */}
      <span className={`absolute font-mono text-mono-medium font-bold ${strokeClass}`}>
        {remaining}s
      </span>
    </div>
  );
}

// ── OfferPopup ────────────────────────────────────────────────────────────────

export function OfferPopup() {
  const { token, user } = useAuthStore();
  const { currentOffer, status, offerExpiresAt, acceptOffer, declineOffer, reconcilePendingOffer } = useOfferStore();
  const [remaining, setRemaining] = useState(15);
  const [showDeclinePicker, setShowDeclinePicker] = useState(false);
  const expiredRef = useRef(false);
  const driverID = user?.id || 'drv-placeholder';

  // Reconcile on mount if pending
  useEffect(() => {
    if (status === 'OFFER_PENDING') {
      expiredRef.current = false;
      setShowDeclinePicker(false);
      if (token) reconcilePendingOffer(token);
    }
  }, [currentOffer?.orderId, status, token, reconcilePendingOffer]);

  // Clock-accurate countdown
  useEffect(() => {
    if (status !== 'OFFER_PENDING') return;
    const tick = () => {
      const expiry = offerExpiresAt ?? Date.now() + 15000;
      const secs = Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
      setRemaining(secs);
      if (secs <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        if (token) declineOffer(token, driverID, 'TIMEOUT');
      }
    };
    tick();
    const interval = window.setInterval(tick, 500);
    return () => window.clearInterval(interval);
  }, [status, offerExpiresAt, token, declineOffer, driverID]);

  if (status !== 'OFFER_PENDING' || !currentOffer) return null;

  const handleAccept = async () => {
    if (token) await acceptOffer(token, driverID);
  };

  const handleDecline = async (reason: string) => {
    if (token) {
      await declineOffer(token, driverID, reason);
      setShowDeclinePicker(false);
    }
  };

  return (
    <>
      {/* ── Full-screen backdrop ── */}
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end">

        {/* ── Sheet ── */}
        <div
          className="w-full bg-background-primary rounded-t-lg shadow-elevation-3 animate-enter"
          style={{ maxHeight: '92dvh', overflowY: 'auto' }}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-300 pb-400">
            <div className="w-9 h-1 rounded-pill bg-border-opaque" />
          </div>

          <div className="px-500 pb-500 space-y-500">

            {/* ── Header row: rider info + countdown ── */}
            <div className="flex items-start justify-between gap-400">
              <div className="flex-1 min-w-0">
                <span className="text-label-small text-content-tertiary uppercase tracking-wider">
                  Incoming Job Match
                </span>
                <h2 className="text-heading-xl text-content-primary mt-1 flex items-center gap-300">
                  {currentOffer.riderName}
                  <span className="font-mono text-mono-small text-content-secondary tabular-nums">
                    ★ {currentOffer.riderRating.toFixed(2)}
                  </span>
                </h2>

                {/* Chips row */}
                <div className="flex flex-wrap gap-200 mt-300">
                  <span className="badge badge-neutral text-label-small">
                    {currentOffer.tripType}
                  </span>
                  {currentOffer.d4mCareOptIn && (
                    <span className="badge badge-accent text-label-small">
                      🛡 Insured Trip
                    </span>
                  )}
                </div>
              </div>

              <CountdownRing remaining={remaining} />
            </div>

            {/* ── Car context card ── */}
            {(currentOffer.carMake || currentOffer.carModel) && (
              <div className="bg-background-secondary rounded-md p-500 space-y-200">
                <p className="text-heading-small text-content-primary">
                  {[currentOffer.carColor, currentOffer.carMake, currentOffer.carModel].filter(Boolean).join(' ')}
                </p>
                <p className="text-paragraph-small text-content-secondary">
                  {currentOffer.carType || 'Car'} · {currentOffer.carTransmission || 'Any'}
                </p>

                {/* Transmission mismatch warning */}
                {currentOffer.transmissionMatch === false && (
                  <div className="flex items-center gap-300 bg-surface-warning rounded-sm p-300 mt-200">
                    <span className="text-content-warning text-label-medium">⚠</span>
                    <p className="text-paragraph-small text-content-warning">
                      Car needs {currentOffer.carTransmission || 'Manual'} — check your expertise match
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── Trip details grid ── */}
            <div className="grid grid-cols-2 gap-300">
              {/* Pickup distance */}
              <div className="bg-background-secondary rounded-sm p-400">
                <span className="text-label-small text-content-tertiary block mb-1">Pickup distance</span>
                <span className="font-mono text-mono-medium text-content-primary tabular-nums">
                  {currentOffer.distanceKm ? `${currentOffer.distanceKm.toFixed(1)} km` : '—'}
                </span>
              </div>

              {/* ETA */}
              <div className="bg-background-secondary rounded-sm p-400">
                <span className="text-label-small text-content-tertiary block mb-1">Est. duration</span>
                <span className="font-mono text-mono-medium text-content-primary tabular-nums">
                  {currentOffer.durationMinutes ? `${currentOffer.durationMinutes} min` : '—'}
                </span>
              </div>

              {/* Pickup address */}
              <div className="col-span-2 bg-background-secondary rounded-sm p-400">
                <span className="text-label-small text-content-tertiary block mb-1">Pickup</span>
                <p className="text-paragraph-medium text-content-primary truncate">
                  {currentOffer.pickup.address}
                </p>
              </div>

              {/* Drop address */}
              <div className="col-span-2 bg-background-secondary rounded-sm p-400">
                <span className="text-label-small text-content-tertiary block mb-1">Drop</span>
                <p className="text-paragraph-medium text-content-primary truncate">
                  {currentOffer.drop.address}
                </p>
              </div>
            </div>

            {/* Special notes */}
            {currentOffer.notes && (
              <div className="bg-surface-warning rounded-sm p-400">
                <span className="text-label-small text-content-warning block mb-1">Client notes</span>
                <p className="text-paragraph-small text-content-primary">"{currentOffer.notes}"</p>
              </div>
            )}

            {/* ── Fare row ── */}
            <div className="flex items-center justify-between border-t border-border-opaque pt-400">
              <div>
                <span className="text-label-small text-content-tertiary block">Est. Payout</span>
                <FareDisplay
                  amount={currentOffer.fareEstimate}
                  size="display"
                  className="text-content-primary font-bold"
                />
              </div>
              <span className="badge badge-neutral">{currentOffer.tripType}</span>
            </div>

            {/* ── Slide to accept ── */}
            <SlideToAccept onAccept={handleAccept} />

            {/* ── Decline ── */}
            <button
              type="button"
              onClick={() => setShowDeclinePicker(true)}
              className="w-full text-center text-label-medium text-content-tertiary py-300 min-h-[44px] cursor-pointer hover:text-content-secondary transition-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2"
            >
              Decline
            </button>
          </div>
        </div>
      </div>

      {/* ── Decline reason sheet ── */}
      {showDeclinePicker && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-end">
          <div className="w-full bg-background-primary rounded-t-lg shadow-elevation-3 px-500 pt-400 pb-[calc(var(--space-500)+env(safe-area-inset-bottom,0px))] animate-enter">
            <div className="flex justify-center mb-400">
              <div className="w-9 h-1 rounded-pill bg-border-opaque" />
            </div>
            <h3 className="text-heading-small text-content-primary mb-200">Why are you declining?</h3>
            <p className="text-paragraph-small text-content-secondary mb-500">
              Your feedback helps optimize dispatch algorithms.
            </p>
            <div className="space-y-200">
              {['Too far', 'Need a break', 'Vehicle issue', 'Other'].map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => handleDecline(reason.toUpperCase().replace(/ /g, '_'))}
                  className="w-full text-left bg-background-secondary hover:bg-background-tertiary border border-border-opaque rounded-sm px-500 py-400 text-label-large text-content-primary transition-base min-h-[44px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
                >
                  {reason}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowDeclinePicker(false)}
              className="w-full mt-400 text-label-medium text-content-tertiary py-300 min-h-[44px] cursor-pointer hover:text-content-secondary transition-base"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
