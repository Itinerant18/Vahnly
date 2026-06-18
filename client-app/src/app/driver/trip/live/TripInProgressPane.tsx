'use client';

import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SlideToConfirm } from '../../../../components/SlideToConfirm';
import { addOrderEvent } from '@/api/client';
import { useAuthStore } from '@/store/useAuthStore';
import { FareDisplay, StatusBadge } from '../../../../components/ds';

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

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h > 0 ? String(h).padStart(2, '0') : null, String(m).padStart(2, '0'), String(s).padStart(2, '0')]
    .filter(Boolean)
    .join(':');
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

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [accumulatedDistance, setAccumulatedDistance] = useState(0);
  const prevCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

  const [sosProgress, setSosProgress] = useState(0);
  const [isHoldingSos, setIsHoldingSos] = useState(false);
  const sosTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [isReportingIssue, setIsReportingIssue] = useState(false);
  const [issueText, setIssueText] = useState('');
  const [isSubmittingIssue, setIsSubmittingIssue] = useState(false);

  const [riderPanelOpen, setRiderPanelOpen] = useState(true);

  const [showChargeModal, setShowChargeModal] = useState(false);
  const [chargeType, setChargeType] = useState<'toll_added' | 'parking_added'>('toll_added');
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeSubmitting, setChargeSubmitting] = useState(false);

  const riderFirstName = String(activeTrip?.customer_name || 'Rider').split(' ')[0];
  const carMake = activeTrip?.car_make || activeTrip?.rider_car_make;
  const carModel = activeTrip?.car_model || activeTrip?.rider_car_model;
  const carPlate = activeTrip?.car_plate || activeTrip?.rider_car_plate;
  const emergencyCount = activeTrip?.emergency_contact_count ?? 0;
  const d4mCareOpted = Boolean(activeTrip?.d4m_care_opted ?? activeTrip?.d4mCareOptIn);

  const currentTotalFare = activeTrip.quoted_fare_paise / 100 + tollCharges + parkingCharges;

  const submitCharge = async () => {
    const rupees = parseFloat(chargeAmount);
    if (!rupees || rupees <= 0 || chargeSubmitting) return;
    setChargeSubmitting(true);
    try {
      if (token && activeTrip?.order_id) {
        await addOrderEvent(token, activeTrip.order_id, {
          event_type: chargeType,
          amount_paise: Math.round(rupees * 100),
          description: chargeType === 'toll_added' ? 'Toll added mid-trip' : 'Parking added mid-trip',
        });
      }
      if (chargeType === 'toll_added') handleTollAddition();
      else handleParkingAddition();
      setShowChargeModal(false);
      setChargeAmount('');
    } catch {
      alert('Failed to add charge. Please try again.');
    } finally {
      setChargeSubmitting(false);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => setElapsedSeconds((p) => p + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeTrip) return;
    const lat = activeTrip.pickup_lat;
    const lng = activeTrip.pickup_lng;
    if (prevCoordsRef.current) {
      const dist = getDistanceKm(prevCoordsRef.current.lat, prevCoordsRef.current.lng, lat, lng);
      if (dist > 0.001) setAccumulatedDistance((p) => p + dist);
    }
    prevCoordsRef.current = { lat, lng };
  }, [activeTrip]);

  const startSosHold = () => {
    setIsHoldingSos(true);
    setSosProgress(0);
    const startTime = Date.now();
    sosTimerRef.current = setInterval(() => {
      const progress = Math.min(((Date.now() - startTime) / 2000) * 100, 100);
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
    if (sosTimerRef.current) { clearInterval(sosTimerRef.current); sosTimerRef.current = null; }
    setIsHoldingSos(false);
    setSosProgress(0);
  };

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
        logAudit?.('MID_TRIP_ISSUE_REPORTED', { orderId: activeTrip.order_id, description: issueText });
        alert('Report filed. Support team is monitoring.');
        setIssueText('');
        setIsReportingIssue(false);
      }
    } catch {
      alert('Failed to report. Try again.');
    } finally {
      setIsSubmittingIssue(false);
    }
  };

  return (
    <div className="space-y-4 text-left">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusBadge status="on_trip" label="In Progress" />
        </div>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-label-small text-content-secondary px-3 py-1.5 min-h-[36px]
            bg-background-secondary border border-border-opaque rounded-sm
            cursor-pointer hover:bg-background-tertiary transition-base
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
        >
          {isCollapsed ? '▼ Expand' : '▲ Collapse'}
        </button>
      </div>

      {/* ── Collapsible content ── */}
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28 }}
            className="overflow-hidden space-y-3"
          >
            {/* Rider card */}
            <div className="card flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-pill bg-background-tertiary flex items-center justify-center text-heading-small text-content-secondary flex-shrink-0 select-none">
                  {riderFirstName[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-heading-small text-content-primary">{activeTrip.customer_name}</p>
                  <p className="font-mono text-mono-small text-content-warning tabular-nums">
                    ★ {activeTrip.customer_rating || '4.9'}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const p = activeTrip.customer_phone;
                    if (p && p !== 'Unavailable') window.location.href = `tel:${p}`;
                  }}
                  aria-label="Call rider"
                  className="h-9 px-3 rounded-sm bg-background-secondary border border-border-opaque
                    text-label-small text-content-primary cursor-pointer
                    hover:bg-background-tertiary transition-base min-w-[44px]
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
                >
                  📞
                </button>
                <button
                  onClick={() => alert('Opening chat')}
                  aria-label="Chat with rider"
                  className="h-9 px-3 rounded-sm bg-background-secondary border border-border-opaque
                    text-label-small text-content-primary cursor-pointer
                    hover:bg-background-tertiary transition-base min-w-[44px]
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
                >
                  💬
                </button>
              </div>
            </div>

            {/* Rider context */}
            <div className="bg-background-secondary border border-border-opaque rounded-md overflow-hidden">
              <button
                onClick={() => setRiderPanelOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-background-tertiary transition-base"
              >
                <span className="text-label-small text-content-secondary uppercase tracking-wider">
                  Rider Context
                </span>
                <span className="text-content-tertiary">{riderPanelOpen ? '▲' : '▼'}</span>
              </button>
              <AnimatePresence initial={false}>
                {riderPanelOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    className="overflow-hidden px-4 pb-4 space-y-2"
                  >
                    <p className="text-paragraph-small text-content-secondary">
                      In car:{' '}
                      <span className="text-content-primary font-medium">
                        {[carMake, carModel].filter(Boolean).join(' ') || 'Not specified'}
                      </span>
                      {carPlate && <span className="text-content-tertiary"> [{carPlate}]</span>}
                    </p>
                    <p className="text-paragraph-small text-content-secondary">
                      Emergency contacts:{' '}
                      <span className="text-content-primary font-medium">{emergencyCount}</span>
                    </p>
                    {d4mCareOpted && (
                      <StatusBadge status="completed" label="D4M Care — Insured Trip" size="sm" />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Live metrics */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-background-secondary rounded-sm p-3 text-center border border-border-opaque">
                <span className="text-label-small text-content-tertiary block">Duration</span>
                <span className="font-mono text-mono-large text-content-primary tabular-nums">
                  {formatTime(elapsedSeconds)}
                </span>
              </div>
              <div className="bg-background-secondary rounded-sm p-3 text-center border border-border-opaque">
                <span className="text-label-small text-content-tertiary block">Distance est.</span>
                <span className="font-mono text-mono-large text-content-primary tabular-nums">
                  {(accumulatedDistance + 0.42).toFixed(2)} km
                </span>
              </div>
            </div>

            {/* Financial snapshot */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Base', amount: activeTrip.quoted_fare_paise },
                { label: 'Tolls', amount: tollCharges * 100 },
                { label: 'Parking', amount: parkingCharges * 100 },
              ].map(({ label, amount }) => (
                <div key={label} className="bg-background-secondary rounded-sm p-2 text-center border border-border-opaque">
                  <span className="text-label-small text-content-tertiary block">{label}</span>
                  <FareDisplay amount={amount} size="sm" />
                </div>
              ))}
            </div>

            {/* Charge action row */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handleTollAddition}
                className="h-11 rounded-sm bg-background-secondary border border-border-opaque
                  text-label-small text-content-primary
                  cursor-pointer hover:bg-background-tertiary transition-base
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
              >
                ➕ Toll
              </button>
              <button
                onClick={handleParkingAddition}
                className="h-11 rounded-sm bg-background-secondary border border-border-opaque
                  text-label-small text-content-primary
                  cursor-pointer hover:bg-background-tertiary transition-base
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
              >
                🅿 Park
              </button>
              <button
                onClick={() => setIsReportingIssue(!isReportingIssue)}
                className="h-11 rounded-sm bg-surface-negative border border-negative-200
                  text-label-small text-content-negative
                  cursor-pointer hover:opacity-80 transition-base
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative-400"
              >
                🚨 Issue
              </button>
            </div>

            <button
              onClick={() => setShowChargeModal(true)}
              className="w-full h-11 rounded-sm bg-background-secondary border border-border-opaque
                text-label-medium text-content-secondary
                cursor-pointer hover:bg-background-tertiary transition-base
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            >
              ➕ Add Custom Toll / Parking
            </button>

            {/* Report issue expandable */}
            <AnimatePresence>
              {isReportingIssue && (
                <motion.form
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  onSubmit={handleReportIssueSubmit}
                  className="overflow-hidden bg-background-secondary border border-border-opaque rounded-sm p-4 space-y-3"
                >
                  <label className="text-label-small text-content-negative block">
                    Describe the issue
                  </label>
                  <input
                    type="text"
                    value={issueText}
                    onChange={(e) => setIssueText(e.target.value)}
                    placeholder="e.g., roadblock, tyre puncture"
                    className="w-full h-11 rounded-sm border border-border-opaque bg-background-primary
                      font-body text-paragraph-large text-content-primary px-3
                      focus:border-border-accent focus:ring-2 focus:ring-accent-400 outline-none
                      placeholder:text-content-tertiary transition-base"
                    required
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setIsReportingIssue(false)}
                      className="h-9 px-4 rounded-sm bg-background-primary border border-border-opaque
                        text-label-small text-content-secondary cursor-pointer hover:bg-background-tertiary"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingIssue}
                      className="h-9 px-4 rounded-sm bg-negative-400 text-white
                        text-label-small font-medium cursor-pointer disabled:opacity-40
                        hover:bg-negative-500 transition-base"
                    >
                      {isSubmittingIssue ? 'Filing…' : 'Submit Report'}
                    </button>
                  </div>
                </motion.form>
              )}
            </AnimatePresence>

            {/* SOS */}
            <div className="flex items-center justify-between border-t border-border-opaque pt-3">
              <span className="text-label-small text-content-tertiary">Safety</span>
              <button
                onMouseDown={startSosHold}
                onMouseUp={cancelSosHold}
                onMouseLeave={cancelSosHold}
                onTouchStart={startSosHold}
                onTouchEnd={cancelSosHold}
                className="relative overflow-hidden bg-negative-400 hover:bg-negative-500
                  text-white text-label-small font-medium
                  px-4 py-2 min-h-[44px] rounded-pill
                  cursor-pointer select-none transition-base
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative-400"
              >
                {isHoldingSos && (
                  <span
                    className="absolute inset-0 bg-negative-600 transition-none"
                    style={{ width: `${sosProgress}%` }}
                  />
                )}
                <span className="relative z-10">
                  🚨 SOS {isHoldingSos ? `(${Math.round(sosProgress)}%)` : '(Hold)'}
                </span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── End odometer ── */}
      <div className="card space-y-3">
        <h4 className="text-heading-small text-content-primary">End odometer</h4>
        <input
          type="number"
          value={endOdometer}
          onChange={(e) => setEndOdometer(e.target.value)}
          placeholder={`> ${startOdometer} km`}
          className="w-full h-12 rounded-sm border border-border-opaque bg-background-secondary
            font-mono text-mono-medium text-content-primary text-center px-4
            focus:border-border-accent focus:ring-2 focus:ring-accent-400 outline-none
            placeholder:text-content-tertiary transition-base"
          required
        />
        <div>
          <div className="flex justify-between text-label-small text-content-tertiary mb-1">
            <span>E</span>
            <span className="font-mono">{endFuel}%</span>
            <span>F</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={endFuel}
            onChange={(e) => setEndFuel(parseInt(e.target.value))}
            className="w-full h-8 cursor-pointer"
            aria-label="End fuel level"
          />
        </div>
      </div>

      {/* Running fare */}
      <div className="flex items-center justify-between bg-background-secondary rounded-sm p-4 border border-border-opaque">
        <div>
          <span className="text-label-small text-content-tertiary block">Running total</span>
          <FareDisplay amount={currentTotalFare * 100} size="lg" />
        </div>
        <div className="text-right">
          <span className="text-label-small text-content-tertiary block">Start odo</span>
          <span className="font-mono text-mono-medium text-content-primary">{startOdometer} km</span>
        </div>
      </div>

      {/* Slide to end */}
      <SlideToConfirm
        label="Slide to End Journey"
        onConfirm={handleSlideToEndTrip}
        color="red"
      />

      {/* Custom charge modal */}
      {showChargeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm bg-background-primary border border-border-opaque rounded-lg p-5 space-y-4 shadow-elevation-3">
            <h4 className="text-heading-small text-content-primary">Add Charge</h4>
            <div className="grid grid-cols-2 gap-2">
              {(['toll_added', 'parking_added'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setChargeType(t)}
                  className={[
                    'h-11 rounded-sm text-label-medium border transition-base cursor-pointer',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400',
                    chargeType === t
                      ? 'bg-interactive-primary border-interactive-primary text-interactive-primary-text'
                      : 'bg-background-secondary border-border-opaque text-content-secondary hover:text-content-primary',
                  ].join(' ')}
                >
                  {t === 'toll_added' ? '🛣️ Toll' : '🅿️ Parking'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 h-12 rounded-sm border border-border-opaque bg-background-secondary px-3">
              <span className="text-content-secondary font-mono">₹</span>
              <input
                type="number"
                min="0"
                value={chargeAmount}
                onChange={(e) => setChargeAmount(e.target.value)}
                placeholder="Amount"
                className="flex-1 bg-transparent font-mono text-content-primary outline-none"
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowChargeModal(false)}
                className="h-10 px-4 rounded-sm bg-background-secondary border border-border-opaque
                  text-label-medium text-content-secondary cursor-pointer hover:bg-background-tertiary"
              >
                Cancel
              </button>
              <button
                onClick={submitCharge}
                disabled={chargeSubmitting || !chargeAmount}
                className="h-10 px-4 rounded-sm bg-interactive-primary text-interactive-primary-text
                  text-label-medium font-medium cursor-pointer disabled:opacity-40
                  hover:opacity-90 transition-base"
              >
                {chargeSubmitting ? 'Adding…' : 'Add Charge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
