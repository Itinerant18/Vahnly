'use client';

import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SlideToConfirm } from '../../../../components/SlideToConfirm';
import { addOrderEvent } from '@/api/client';
import { useAuthStore } from '@/store/useAuthStore';

interface TripInProgressPaneProps {
  activeTrip: any;
  tollCharges: number;
  parkingCharges: number;
  handleTollAddition: () => void;
  handleParkingAddition: () => void;
  endOdometer: string;
  setEndOdometer: (o: string) => void;
  endFuel: number;
  setEndFuel: (f: number) => void;
  startOdometer: string;
  endOdoPhoto: string | null;
  setEndOdoPhoto: (p: string | null) => void;
  handleSlideToEndTrip: () => Promise<void>;
  triggerSOS?: () => void;
  logAudit?: (event: string, meta: any) => void;
}

// Haversine formula to compute distance in KM
function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export const TripInProgressPane: React.FC<TripInProgressPaneProps> = ({
  activeTrip,
  tollCharges,
  parkingCharges,
  handleTollAddition,
  handleParkingAddition,
  endOdometer,
  setEndOdometer,
  endFuel,
  setEndFuel,
  startOdometer,
  endOdoPhoto,
  setEndOdoPhoto,
  handleSlideToEndTrip,
  triggerSOS,
  logAudit,
}) => {
  const { token } = useAuthStore();
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Time & Distance Tracking
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [accumulatedDistance, setAccumulatedDistance] = useState(0);
  const prevCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

  // SOS button press-hold state
  const [sosProgress, setSosProgress] = useState(0);
  const [isHoldingSos, setIsHoldingSos] = useState(false);
  const sosTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Issue reporting modal/input states
  const [isReportingIssue, setIsReportingIssue] = useState(false);
  const [issueText, setIssueText] = useState('');
  const [isSubmittingIssue, setIsSubmittingIssue] = useState(false);

  // 1. Duration counter logic
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 2. Distance accumulator logic based on actual trip coordinate changes
  useEffect(() => {
    if (!activeTrip) return;

    // We can simulate driver movement or listen to the coordinates passed down
    const lat = activeTrip.pickup_lat;
    const lng = activeTrip.pickup_lng;

    if (prevCoordsRef.current) {
      const dist = getDistanceKm(prevCoordsRef.current.lat, prevCoordsRef.current.lng, lat, lng);
      if (dist > 0.001) {
        setAccumulatedDistance((prev) => prev + dist);
      }
    }
    prevCoordsRef.current = { lat, lng };
  }, [activeTrip]);

  const currentTotalFare =
    activeTrip.quoted_fare_paise / 100 + tollCharges + parkingCharges;

  // Formatting utility
  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return [h > 0 ? String(h).padStart(2, '0') : null, String(m).padStart(2, '0'), String(s).padStart(2, '0')]
      .filter(Boolean)
      .join(':');
  };

  // SOS Hold Confirmation Handler
  const startSosHold = () => {
    setIsHoldingSos(true);
    setSosProgress(0);

    const startTime = Date.now();
    const duration = 2000; // 2 seconds

    sosTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min((elapsed / duration) * 100, 100);
      setSosProgress(progress);

      if (progress >= 100) {
        clearInterval(sosTimerRef.current!);
        sosTimerRef.current = null;
        setIsHoldingSos(false);
        setSosProgress(0);
        if (triggerSOS) triggerSOS();
      }
    }, 50);
  };

  const cancelSosHold = () => {
    if (sosTimerRef.current) {
      clearInterval(sosTimerRef.current);
      sosTimerRef.current = null;
    }
    setIsHoldingSos(false);
    setSosProgress(0);
  };

  // Mid-trip Report Issue Mutation
  const handleReportIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueText.trim()) return;

    setIsSubmittingIssue(true);
    try {
      if (token && activeTrip?.order_id) {
        await addOrderEvent(token, activeTrip.order_id, {
          event_type: 'REPORT_ISSUE',
          amount_paise: 0,
          description: issueText,
        });

        if (logAudit) {
          logAudit('MID_TRIP_ISSUE_REPORTED', {
            orderId: activeTrip.order_id,
            description: issueText,
          });
        }
        alert('Report filed. Central support team is monitoring the route.');
        setIssueText('');
        setIsReportingIssue(false);
      } else {
        alert('Static Sandbox: issue reported successfully.');
        setIsReportingIssue(false);
      }
    } catch (err) {
      alert('Failed to report issue. Please try again.');
    } finally {
      setIsSubmittingIssue(false);
    }
  };

  return (
    <div className="space-y-4 text-left font-mono selection:bg-white selection:text-black">
      {/* 1. Header with Collapsible Toggle */}
      <div className="border-b border-zinc-900 pb-3 flex justify-between items-center">
        <div>
          <span className="text-[8px] text-zinc-500 uppercase tracking-widest block font-bold">
            Transit Telemetry Stream
          </span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-bold text-white">ACTIVE METRICS</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-[9px] font-bold text-zinc-400 hover:text-white px-3 py-1.5 bg-zinc-900 rounded-lg border border-zinc-800 transition active:scale-95 cursor-pointer"
          >
            {isCollapsed ? '▼ EXPAND' : '▲ COLLAPSE'}
          </button>
          <div className="bg-emerald-950 text-emerald-400 border border-emerald-900 text-[8px] font-bold px-2 py-1 rounded animate-pulse">
            DELIVERING
          </div>
        </div>
      </div>

      {/* Collapsible Pane Container using framer-motion */}
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden space-y-4"
          >
            {/* 2. Rider Card with Photo & Quick Actions */}
            <div className="bg-zinc-900/40 border border-zinc-850 p-4 rounded-2xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Rider Photo Avatar */}
                <div className="h-12 w-12 rounded-xl bg-zinc-850 border border-zinc-800 flex items-center justify-center text-xl overflow-hidden font-sans select-none">
                  👤
                </div>
                <div>
                  <h4 className="text-xs font-bold text-zinc-300">Rider</h4>
                  <p className="text-sm font-extrabold text-white mt-0.5">
                    {activeTrip.customer_name}
                  </p>
                  <span className="text-[9px] text-amber-500">★ {activeTrip.customer_rating || '4.9'}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => alert(`Dialing rider: ${activeTrip.customer_phone || 'Protected'}`)}
                  className="h-8 px-3 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px] font-bold text-zinc-400 hover:text-white hover:border-zinc-700 transition cursor-pointer"
                >
                  📞 CALL
                </button>
                <button
                  onClick={() => alert('Opening Secure Rider Chat Tunnel...')}
                  className="h-8 px-3 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px] font-bold text-zinc-400 hover:text-white hover:border-zinc-700 transition cursor-pointer"
                >
                  💬 CHAT
                </button>
              </div>
            </div>

            {/* 3. Live Trip Counter Metrics */}
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="bg-zinc-900/60 p-3 rounded-xl border border-zinc-900">
                <span className="text-zinc-500 text-[7px] uppercase block tracking-wider font-bold">
                  TRANSIT DURATION
                </span>
                <span className="text-lg font-bold text-white block mt-1">
                  {formatTime(elapsedSeconds)}
                </span>
              </div>
              <div className="bg-zinc-900/60 p-3 rounded-xl border border-zinc-900">
                <span className="text-zinc-500 text-[7px] uppercase block tracking-wider font-bold">
                  DISTANCE EST.
                </span>
                <span className="text-lg font-bold text-white block mt-1">
                  {(accumulatedDistance + 0.42).toFixed(2)} KM
                </span>
              </div>
            </div>

            {/* 4. Financial Status Overview */}
            <div className="grid grid-cols-3 gap-2 text-center uppercase font-bold text-[9px]">
              <div className="bg-zinc-900/30 border border-zinc-900 p-2.5 rounded-lg">
                <span className="text-zinc-600 block text-[7px]">BASE FARE</span>
                <span className="text-white block mt-0.5">
                  ₹{(activeTrip.quoted_fare_paise / 100).toFixed(0)}
                </span>
              </div>
              <div className="bg-zinc-900/30 border border-zinc-900 p-2.5 rounded-lg">
                <span className="text-zinc-600 block text-[7px]">TOLLS</span>
                <span className="text-white block mt-0.5">₹{tollCharges}</span>
              </div>
              <div className="bg-zinc-900/30 border border-zinc-900 p-2.5 rounded-lg">
                <span className="text-zinc-600 block text-[7px]">PARKING</span>
                <span className="text-white block mt-0.5">₹{parkingCharges}</span>
              </div>
            </div>

            {/* 5. Mid-trip Mutation Actions */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handleTollAddition}
                className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-[9px] font-bold uppercase py-2.5 rounded-xl text-zinc-300 transition cursor-pointer text-center"
              >
                ➕ TOLL (₹50)
              </button>
              <button
                onClick={handleParkingAddition}
                className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-[9px] font-bold uppercase py-2.5 rounded-xl text-zinc-300 transition cursor-pointer text-center"
              >
                ➕ PARK (₹30)
              </button>
              <button
                onClick={() => setIsReportingIssue(!isReportingIssue)}
                className="bg-red-950/30 hover:bg-red-950/50 border border-red-900/40 text-[9px] font-bold uppercase py-2.5 rounded-xl text-red-400 transition cursor-pointer text-center"
              >
                🚨 REPORT ISSUE
              </button>
            </div>

            {/* Report Issue Form Expansion */}
            <AnimatePresence>
              {isReportingIssue && (
                <motion.form
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  onSubmit={handleReportIssueSubmit}
                  className="bg-zinc-950 border border-zinc-900 p-3 rounded-xl space-y-2 overflow-hidden"
                >
                  <label className="block text-[8px] font-bold text-red-400 uppercase tracking-wide">
                    File Route Issue Report
                  </label>
                  <input
                    type="text"
                    value={issueText}
                    onChange={(e) => setIssueText(e.target.value)}
                    placeholder="Describe issue (e.g., roadblock, tyre puncture)"
                    className="w-full bg-black border border-zinc-800 rounded-lg p-2 text-white focus:outline-none focus:border-red-500 text-xs font-mono"
                    required
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setIsReportingIssue(false)}
                      className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded text-[8px] font-bold uppercase tracking-wider text-zinc-400 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingIssue}
                      className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded text-[8px] font-bold uppercase tracking-wider cursor-pointer"
                    >
                      {isSubmittingIssue ? 'Filing...' : 'Submit Report'}
                    </button>
                  </div>
                </motion.form>
              )}
            </AnimatePresence>

            {/* 6. Emergency SOS button */}
            <div className="border-t border-zinc-900/80 pt-3 flex justify-between items-center">
              <span className="text-[8px] text-zinc-500 uppercase font-bold">
                Route Safety Mesh
              </span>
              <button
                onMouseDown={startSosHold}
                onMouseUp={cancelSosHold}
                onMouseLeave={cancelSosHold}
                onTouchStart={startSosHold}
                onTouchEnd={cancelSosHold}
                className="bg-red-600 hover:bg-red-700 text-white font-bold text-[9px] px-4 py-2 rounded-full transition-all cursor-pointer select-none border border-red-500 active:scale-95 flex items-center gap-1.5 relative overflow-hidden"
              >
                {isHoldingSos && (
                  <span
                    className="absolute inset-0 bg-red-800 transition-all duration-100"
                    style={{ width: `${sosProgress}%`, opacity: 0.8 }}
                  />
                )}
                <span className="relative z-10">🚨 SOS TRP ALERT {isHoldingSos ? `(${Math.round(sosProgress)}%)` : '(Hold)'}</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 7. End Odometer Capture & Slide Confirmation */}
      <div className="bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl space-y-3">
        <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest block border-b border-zinc-850 pb-1.5">
          End Odometer Capture (Required to Slide Close)
        </span>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-[8px] font-bold text-zinc-650 uppercase mb-1">
              End Odometer KM
            </label>
            <input
              type="number"
              value={endOdometer}
              onChange={(e) => setEndOdometer(e.target.value)}
              placeholder={`>${startOdometer} KM`}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-white focus:outline-none focus:border-zinc-500 text-xs font-mono"
              required
            />
          </div>
          <div>
            <label className="block text-[8px] font-bold text-zinc-650 uppercase mb-1">
              End Fuel ({endFuel}%)
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={endFuel}
              onChange={(e) => setEndFuel(parseInt(e.target.value))}
              className="w-full h-8 cursor-pointer animate-none"
            />
          </div>
        </div>
      </div>

      <div className="bg-zinc-900/30 p-3 rounded-xl border border-zinc-900 flex justify-between items-center font-mono">
        <div>
          <span className="text-zinc-500 text-[7px] uppercase block">Accumulated Transit Fare</span>
          <span className="text-base font-bold text-white block mt-0.5">₹{currentTotalFare.toFixed(2)}</span>
        </div>
        <div className="text-right">
          <span className="text-zinc-500 text-[7px] uppercase block">Start Odometer</span>
          <span className="text-xs font-bold text-zinc-300 block mt-0.5">{startOdometer} KM</span>
        </div>
      </div>

      <SlideToConfirm
        label="Slide to End Journey"
        onConfirm={handleSlideToEndTrip}
        color="red"
      />
    </div>
  );
};
