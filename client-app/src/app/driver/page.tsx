'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import MapInterpolated, { MapH3Hex, MapDriver } from '../../components/MapInterpolated';

// We map a local version of MapH3Hex to prevent SSR conflicts.
// Wait! Let's make sure the import is correct. In our components folder, the map component is named `MapInterpolated` but it supports `h3Hexagons` prop!
// Let's import MapInterpolated from '../../components/MapInterpolated'.

export default function DriverPage() {
  const [isOnline, setIsOnline] = useState(false);
  const [cityPrefix] = useState('KOL');
  
  // Driver state machine: 'offline' | 'searching' | 'offered' | 'accepted' | 'started' | 'completed'
  const [driverState, setDriverState] = useState<'offline' | 'searching' | 'offered' | 'accepted' | 'started' | 'completed'>('offline');
  
  // Active offer timer
  const [offerCountdown, setOfferCountdown] = useState(15);
  const [offerTimerProgress, setOfferTimerProgress] = useState(100);
  
  // Slide gesture state
  const [sliderVal, setSliderVal] = useState(0);
  const isSliding = useRef(false);
  const sliderTrackRef = useRef<HTMLDivElement | null>(null);

  // Active H3 cells overlay details
  const [h3Overlays, setH3Overlays] = useState<MapH3Hex[]>([]);

  // Simulation drivers list (empty for driver app as the driver is the center, or shows mock passenger points)
  const [discoveryPassengers, setDiscoveryPassengers] = useState<MapDriver[]>([]);

  // Telemetry offline coordinates logging buffer
  const [offlinePacketsCount, setOfflinePacketsCount] = useState(0);

  // Setup demand hexagon overlays when going online
  useEffect(() => {
    if (isOnline) {
      setH3Overlays([
        { index: '88283082b9fffff', intensity: 0.8, color: 'rgba(245, 158, 11, 0.25)' }, // amber surge
        { index: '88283082b9fcdef', intensity: 0.4, color: 'rgba(59, 130, 246, 0.2)' },  // moderate blue
      ]);
      setDriverState('searching');
    } else {
      setH3Overlays([]);
      setDriverState('offline');
    }
  }, [isOnline]);

  // Offer Discovery Loop Simulation
  useEffect(() => {
    if (driverState === 'searching') {
      const trigger = setTimeout(() => {
        setDriverState('offered');
        setOfferCountdown(15);
        setOfferTimerProgress(100);
      }, 7000); // Receive ride offer after 7s online
      return () => clearTimeout(trigger);
    }
  }, [driverState]);

  // 15-Second Radial Offer Countdown Timer Bar Logic
  useEffect(() => {
    if (driverState === 'offered' && offerCountdown > 0) {
      const interval = setInterval(() => {
        setOfferCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            setDriverState('searching'); // Timed out: return to searching
            return 0;
          }
          const nextVal = prev - 1;
          setOfferTimerProgress((nextVal / 15) * 100);
          return nextVal;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [driverState, offerCountdown]);

  // Slide Gesture Drag Tracker
  const handleTouchStart = () => {
    isSliding.current = true;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isSliding.current || !sliderTrackRef.current) return;
    const rect = sliderTrackRef.current.getBoundingClientRect();
    const width = rect.width - 56; // minus thumb diameter
    const x = e.clientX - rect.left - 28;
    const percent = Math.min(100, Math.max(0, (x / width) * 100));
    setSliderVal(percent);
    
    if (percent >= 98) {
      triggerSlideAction();
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSliding.current || !sliderTrackRef.current) return;
    const rect = sliderTrackRef.current.getBoundingClientRect();
    const width = rect.width - 56;
    const touch = e.touches[0];
    const x = touch.clientX - rect.left - 28;
    const percent = Math.min(100, Math.max(0, (x / width) * 100));
    setSliderVal(percent);

    if (percent >= 98) {
      triggerSlideAction();
    }
  };

  const handleMouseOrTouchEnd = () => {
    isSliding.current = false;
    // Snap back to 0 if not completed
    if (sliderVal < 98) {
      setSliderVal(0);
    }
  };

  const triggerSlideAction = () => {
    isSliding.current = false;
    setSliderVal(0);

    if (driverState === 'accepted') {
      setDriverState('started');
    } else if (driverState === 'started') {
      setDriverState('completed');
      setTimeout(() => {
        setDriverState('searching');
      }, 3000);
    }
  };

  const handleAcceptOffer = () => {
    setDriverState('accepted');
  };

  const handleDeclineOffer = () => {
    setDriverState('searching');
  };

  return (
    <main className="min-h-screen bg-white text-ink flex flex-col md:flex-row antialiased font-sans selection:bg-black selection:text-white">
      
      {/* 1. Left Control Panel: Online Duty Dashboard */}
      <section className="w-full md:w-[380px] p-6 flex flex-col justify-between border-b md:border-b-0 md:border-r border-canvas-soft bg-white z-10">
        
        <div>
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <Link href="/" className="flex items-center gap-2 group">
              <span className="text-xs font-bold text-mute group-hover:text-ink transition">←</span>
              <h1 className="text-xl font-bold tracking-tight text-ink font-move">
                drivers-for-u
              </h1>
            </Link>
            <span className="px-2.5 py-0.5 rounded-full border border-surface-pressed bg-canvas-soft text-[10px] font-bold text-ink tracking-wider uppercase">
              Partner portal
            </span>
          </div>

          {/* Toggle Switch online/offline */}
          <div className="p-5 rounded-xl border border-canvas-soft bg-canvas-softer flex items-center justify-between shadow-sm mb-6">
            <div>
              <h2 className="font-bold text-ink font-move">Duty switch</h2>
              <p className="text-xs text-body mt-0.5 leading-relaxed">
                {isOnline ? 'Active & receiving dispatches' : 'Offline'}
              </p>
            </div>
            <button
              onClick={() => setIsOnline(!isOnline)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                isOnline ? 'bg-black' : 'bg-surface-pressed'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  isOnline ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Core States Body */}
          {isOnline ? (
            <div className="space-y-6 animate-in">
              {/* Searching Screen */}
              {driverState === 'searching' && (
                <div className="space-y-5">
                  <div className="p-6 rounded-xl border border-canvas-soft bg-canvas-softer text-center space-y-4">
                    <div className="relative w-10 h-10 mx-auto flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full border border-black/20 animate-ping" />
                      <div className="w-8 h-8 rounded-full bg-black flex items-center justify-center text-white text-xs font-bold select-none">
                        ⚡
                      </div>
                    </div>
                    <div>
                      <h3 className="font-bold text-ink text-base font-move">Online & available</h3>
                      <p className="text-xs text-body mt-1">Positioned near high-demand surge grid cells...</p>
                    </div>
                  </div>

                  {/* Active Surge Legend */}
                  <div className="p-5 rounded-xl border border-canvas-soft bg-white space-y-3">
                    <h4 className="text-[10px] font-bold text-mute uppercase tracking-wider">Demand metrics</h4>
                    <div className="flex items-center justify-between text-xs text-ink">
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded bg-black/10 border border-black/30" />
                        <span className="font-semibold">Sector V surge zone</span>
                      </div>
                      <span className="font-bold text-black font-move">x1.40 Surge</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Ride Accepted Panel */}
              {driverState === 'accepted' && (
                <div className="space-y-6 animate-in">
                  <div className="p-5 rounded-xl border border-canvas-soft bg-canvas-softer space-y-3">
                    <h3 className="font-bold text-ink text-base font-move">Trip assigned</h3>
                    <div className="flex justify-between items-center text-xs text-ink">
                      <span className="text-body font-semibold">Rider identity</span>
                      <span className="font-mono bg-white px-2 py-0.5 rounded border border-canvas-soft text-[10px]">usr-match-56</span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-ink">
                      <span className="text-body font-semibold">Fare estimate</span>
                      <span className="font-bold text-black font-move">₹350.00</span>
                    </div>
                  </div>

                  {/* Slide to Start Gesture */}
                  <div
                    ref={sliderTrackRef}
                    onMouseMove={handleMouseMove}
                    onTouchMove={handleTouchMove}
                    onMouseUp={handleMouseOrTouchEnd}
                    onTouchEnd={handleMouseOrTouchEnd}
                    className="relative h-14 w-full rounded-xl bg-canvas-softer border border-canvas-soft overflow-hidden select-none"
                  >
                    <div
                      style={{ width: `${sliderVal}%` }}
                      className="absolute inset-y-0 left-0 bg-black/10 transition-all duration-75"
                    />
                    <div
                      onMouseDown={handleTouchStart}
                      onTouchStart={handleTouchStart}
                      style={{ left: `${sliderVal}%`, transform: `translateX(-${sliderVal * 0.56}px)` }}
                      className="absolute top-1 left-1 w-12 h-12 rounded-lg bg-black flex items-center justify-center cursor-grab active:cursor-grabbing text-white font-bold shadow-md transition-all duration-75"
                    >
                      →
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-mute pointer-events-none uppercase tracking-wider">
                      Slide to start journey
                    </div>
                  </div>
                </div>
              )}

              {/* Ride Started Panel */}
              {driverState === 'started' && (
                <div className="space-y-6 animate-in">
                  <div className="p-5 rounded-xl border border-canvas-soft bg-canvas-softer space-y-3">
                    <h3 className="font-bold text-ink text-base font-move">Journey in progress</h3>
                    <div className="flex items-center justify-between text-xs text-ink">
                      <span className="text-body font-semibold">Navigating destination</span>
                      <span className="font-bold text-black font-move">Park Street Terminal</span>
                    </div>
                  </div>

                  {/* Slide to Complete Gesture */}
                  <div
                    ref={sliderTrackRef}
                    onMouseMove={handleMouseMove}
                    onTouchMove={handleTouchMove}
                    onMouseUp={handleMouseOrTouchEnd}
                    onTouchEnd={handleMouseOrTouchEnd}
                    className="relative h-14 w-full rounded-xl bg-canvas-softer border border-canvas-soft overflow-hidden select-none"
                  >
                    <div
                      style={{ width: `${sliderVal}%` }}
                      className="absolute inset-y-0 left-0 bg-black/10 transition-all duration-75"
                    />
                    <div
                      onMouseDown={handleTouchStart}
                      onTouchStart={handleTouchStart}
                      style={{ left: `${sliderVal}%`, transform: `translateX(-${sliderVal * 0.56}px)` }}
                      className="absolute top-1 left-1 w-12 h-12 rounded-lg bg-black flex items-center justify-center cursor-grab active:cursor-grabbing text-white font-bold shadow-md transition-all duration-75"
                    >
                      ✓
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-mute pointer-events-none uppercase tracking-wider">
                      Slide to complete trip
                    </div>
                  </div>
                </div>
              )}

              {/* Ride Completed Panel */}
              {driverState === 'completed' && (
                <div className="p-6 rounded-xl border border-canvas-soft bg-canvas-softer text-center space-y-4 animate-in">
                  <div className="w-12 h-12 rounded-full bg-black mx-auto flex items-center justify-center text-white font-bold text-xl select-none">
                    ✓
                  </div>
                  <div>
                    <h3 className="font-bold text-ink text-base font-move">Trip finished</h3>
                    <p className="text-xs text-body mt-1">Earnings credited to your wallet ledger successfully.</p>
                  </div>
                </div>
              )}

            </div>
          ) : (
            <div className="p-6 rounded-xl border border-canvas-soft bg-canvas-softer text-center space-y-2">
              <h3 className="font-bold text-ink font-move">Offline</h3>
              <p className="text-xs text-body leading-relaxed">Toggle the duty switch online to map demand grids and receive passenger dispatches.</p>
            </div>
          )}

        </div>

        {/* Offline Ring Buffer Status */}
        {isOnline && (
          <div className="mt-6 border-t border-canvas-soft pt-4 flex items-center justify-between text-[10px] font-bold text-body uppercase tracking-wider">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-black" />
              <span>Offline GPS buffer</span>
            </div>
            <span className="font-mono text-ink">
              {offlinePacketsCount} Packets
            </span>
          </div>
        )}

      </section>

      {/* 2. Right Canvas Map View Panel */}
      <section className="flex-1 h-[450px] md:h-screen relative p-4 bg-canvas-softer">
        <MapInterpolated
          drivers={discoveryPassengers}
          h3Hexagons={h3Overlays}
        />

        {/* 3. Full-Screen Unavoidable Ride Offer Flash Card Overlay */}
        {driverState === 'offered' && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-6">
            <div className="w-full max-w-sm rounded-xl border border-canvas-soft bg-white shadow-2xl p-6 space-y-6 text-center animate-in">
              
              <div>
                <span className="inline-block px-3 py-1 rounded-full border border-surface-pressed bg-canvas-soft text-[10px] font-bold uppercase tracking-widest text-ink">
                  High-priority dispatch
                </span>
                <h2 className="text-xl font-bold text-ink mt-4 font-move">New trip request!</h2>
                <p className="text-xs text-body mt-1">Salt Lake Sector V → Park Street Hub</p>
              </div>

              {/* 15-second progress timer bar */}
              <div className="relative w-full h-1 rounded-full bg-canvas-softer overflow-hidden border border-canvas-soft">
                <div
                  style={{ width: `${offerTimerProgress}%` }}
                  className="h-full bg-black transition-all duration-1000 ease-linear"
                />
              </div>
              <div className="text-[11px] font-bold text-ink uppercase tracking-wider animate-pulse">
                Expires in {offerCountdown} seconds
              </div>

              <div className="flex justify-between items-center p-3.5 rounded-lg border border-canvas-soft bg-canvas-softer text-xs text-ink">
                <div className="text-left space-y-0.5">
                  <span className="text-[10px] text-body uppercase font-bold block">Est. earnings</span>
                  <span className="font-bold text-black text-sm font-move">₹350.00</span>
                </div>
                <div className="text-right space-y-0.5">
                  <span className="text-[10px] text-body uppercase font-bold block">Distance</span>
                  <span className="font-bold text-black text-sm font-move">4.5 Kms</span>
                </div>
              </div>

              {/* Accept & Decline Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleDeclineOffer}
                  className="flex-1 py-3 rounded-full border border-canvas-soft bg-white hover:bg-canvas-softer font-semibold text-ink transition duration-200 cursor-pointer text-xs"
                >
                  Decline
                </button>
                <button
                  onClick={handleAcceptOffer}
                  className="flex-1 py-3 rounded-full bg-black hover:bg-black-elevated font-semibold text-white transition duration-200 cursor-pointer text-xs"
                >
                  Accept offer
                </button>
              </div>

            </div>
          </div>
        )}
      </section>

    </main>
  );
}
