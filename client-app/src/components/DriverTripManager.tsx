import React from 'react';
import { DutyState, useDriverDutyStore } from '../store/useDriverDutyStore';
import { OfferPopup } from './OfferPopup';
import { FinalBill } from '../api/client';
import { ArrivedVerificationPane } from '../app/driver/trip/live/ArrivedVerificationPane';
import { TripInProgressPane } from '../app/driver/trip/live/TripInProgressPane';
import { FareDisplay, ETADisplay, StatusBadge } from './ds';

// ─────────────────────────────────────────────────────────────────────────────
// DashboardHome — Duty toggle + stats
// ─────────────────────────────────────────────────────────────────────────────

interface DashboardHomeProps {
  dutyState: DutyState;
  activeVehicle: string;
  setActiveVehicle: (v: string) => void;
  preferredTripFilter: 'ALL' | 'CITY' | 'OUTSTATION';
  setPreferredTripFilter: (f: 'ALL' | 'CITY' | 'OUTSTATION') => void;
  handleToggleDutySwitch: () => Promise<void>;
  stats: {
    trips_count: number;
    earnings_rupees: number;
    online_hours: number;
    acceptance_rate: number;
    rating: number;
  };
  setDutyState: (s: DutyState) => void;
  logAudit: (e: string, m: any) => void;
}

export const DashboardHome: React.FC<DashboardHomeProps> = ({
  dutyState,
  activeVehicle,
  setActiveVehicle,
  preferredTripFilter,
  setPreferredTripFilter,
  handleToggleDutySwitch,
  stats,
  logAudit,
}) => {
  const isOffline = dutyState === 'OFFLINE';

  return (
    <div className="space-y-4 text-left">

      {/* ── Vehicle + trip-type filter row ── */}
      <div className="flex justify-between items-start bg-background-secondary rounded-md p-4 border border-border-opaque">
        <div className="min-w-0 flex-1">
          <span className="text-label-small text-content-tertiary uppercase tracking-wider block mb-1">
            Vehicle
          </span>
          <select
            value={activeVehicle}
            onChange={(e) => setActiveVehicle(e.target.value)}
            className="bg-transparent text-label-large text-content-primary outline-none cursor-pointer w-full max-w-[180px]"
          >
            <option>WB-02-AK-9988 (Premium SUV)</option>
            <option>KA-03-MD-4561 (Hatchback Core)</option>
          </select>
        </div>
        <div className="text-right flex-shrink-0">
          <span className="text-label-small text-content-tertiary uppercase tracking-wider block mb-1">
            Job Type
          </span>
          <select
            value={preferredTripFilter}
            onChange={(e) => setPreferredTripFilter(e.target.value as any)}
            className="bg-transparent text-label-large text-content-primary outline-none cursor-pointer text-right"
          >
            <option value="ALL">All</option>
            <option value="CITY">City Only</option>
            <option value="OUTSTATION">Outstation Only</option>
          </select>
        </div>
      </div>

      {/* ── Go Online / Go Offline toggle ── */}
      {isOffline ? (
        /* OFFLINE → Go Online */
        <button
          onClick={handleToggleDutySwitch}
          type="button"
          className="w-full h-14 rounded-sm bg-interactive-primary text-interactive-primary-text
            text-label-large font-medium
            transition-base cursor-pointer
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2
            animate-[subtlePulse_2s_ease-in-out_infinite]"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          Go Online
        </button>
      ) : (
        /* ONLINE → Go Offline */
        <button
          onClick={handleToggleDutySwitch}
          type="button"
          className="w-full h-14 rounded-sm bg-background-primary
            border-2 border-status-online
            text-label-large font-medium text-content-negative
            transition-base cursor-pointer
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2"
          style={{
            boxShadow: '0 0 16px rgba(58,167,109,0.25)',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          Go Offline
        </button>
      )}

      {/* ── Today's stats row (online only) ── */}
      {!isOffline && (
        <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1">
          {/* Trips */}
          <div className="flex-shrink-0 bg-background-secondary rounded-sm px-3 py-2 flex flex-col items-center min-w-[72px]">
            <span className="font-mono text-mono-large text-content-primary tabular-nums">
              {stats.trips_count}
            </span>
            <span className="text-label-small text-content-secondary">trips</span>
          </div>

          {/* Earnings */}
          <div className="flex-shrink-0 bg-background-secondary rounded-sm px-3 py-2 flex flex-col items-center min-w-[88px]">
            <FareDisplay amount={stats.earnings_rupees * 100} size="md" />
            <span className="text-label-small text-content-secondary">earned</span>
          </div>

          {/* Hours */}
          <div className="flex-shrink-0 bg-background-secondary rounded-sm px-3 py-2 flex flex-col items-center min-w-[72px]">
            <span className="font-mono text-mono-large text-content-primary tabular-nums">
              {stats.online_hours.toFixed(1)}h
            </span>
            <span className="text-label-small text-content-secondary">online</span>
          </div>

          {/* Acceptance */}
          <div className="flex-shrink-0 bg-background-secondary rounded-sm px-3 py-2 flex flex-col items-center min-w-[72px]">
            <span className="font-mono text-mono-large text-content-primary tabular-nums">
              {stats.acceptance_rate}%
            </span>
            <span className="text-label-small text-content-secondary">rate</span>
          </div>
        </div>
      )}

      {/* ── Status / seeking indicator ── */}
      {!isOffline && (
        <div className="flex items-center justify-between border-t border-border-opaque pt-3">
          <div className="flex items-center gap-2">
            <span className="status-dot status-dot-online animate-ping" />
            <span className="text-label-medium text-content-primary">Seeking matches…</span>
          </div>
          <StatusBadge status="online" size="sm" />
        </div>
      )}

      {/* ── Demo trigger (dev only) ── */}
      <button
        onClick={() => {
          useDriverDutyStore.getState().setDutyState('OFFER_PENDING');
          logAudit('INCOMING_OFFER_RECEIVED', { source: 'DEMO' });
        }}
        className="w-full bg-surface-warning border border-border-opaque rounded-sm py-3 text-label-medium text-content-warning cursor-pointer transition-base hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
      >
        🔔 Simulate Incoming Booking (Demo)
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// NavigationPane — En Route to Pickup
// ─────────────────────────────────────────────────────────────────────────────

interface NavigationPaneProps {
  activeTrip: any;
  mapGlideProgress: number;
  setShowCancelModal: (show: boolean) => void;
  handleArrivedAtPickup: () => Promise<void>;
}

export const NavigationPane: React.FC<NavigationPaneProps> = ({
  activeTrip,
  mapGlideProgress,
  setShowCancelModal,
  handleArrivedAtPickup,
}) => {
  const etaMinutes = Math.max(1, Math.round(6 - (mapGlideProgress / 100) * 5));

  return (
    <div className="space-y-4 text-left animate-enter">

      {/* ── Status header ── */}
      <div className="flex items-center justify-between">
        <StatusBadge status="active" label="Heading to pickup" />
        <div className="flex items-baseline gap-1">
          <span className="text-label-small text-content-secondary">Arrive in</span>
          <ETADisplay minutes={etaMinutes} />
        </div>
      </div>

      <div className="border-t border-border-opaque" />

      {/* ── Rider mini-card ── */}
      <div className="card flex items-center gap-4">
        <div className="w-12 h-12 rounded-pill bg-background-tertiary flex items-center justify-center text-heading-medium text-content-secondary flex-shrink-0">
          {activeTrip.customer_name?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-heading-small text-content-primary truncate">{activeTrip.customer_name}</p>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-content-warning text-label-medium">★</span>
            <span className="font-mono text-mono-small text-content-secondary tabular-nums">
              {activeTrip.customer_rating?.toFixed(2) ?? '—'}
            </span>
          </div>
        </div>
        <span className="text-label-small text-content-tertiary">+91 98XXX XXXXX</span>
      </div>

      {/* ── Pickup address ── */}
      <div className="bg-background-secondary rounded-sm p-4 border border-border-opaque">
        <span className="text-label-small text-content-tertiary block mb-1">Pickup address</span>
        <p className="text-label-large text-content-primary">{activeTrip.pickup_address}</p>
        {activeTrip.special_notes && (
          <p className="text-paragraph-small text-content-warning mt-2">
            "{activeTrip.special_notes}"
          </p>
        )}
      </div>

      {/* ── Action row ── */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => alert(`Dialing ${activeTrip.customer_phone}`)}
          className="flex flex-col items-center justify-center gap-1 h-16 bg-background-secondary rounded-sm border border-border-opaque
            text-label-small text-content-primary cursor-pointer transition-base
            hover:bg-background-tertiary active:scale-95
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
        >
          <span className="text-xl">📞</span>
          <span>Call</span>
        </button>
        <button
          onClick={() => alert('Opening in-app chat')}
          className="flex flex-col items-center justify-center gap-1 h-16 bg-background-secondary rounded-sm border border-border-opaque
            text-label-small text-content-primary cursor-pointer transition-base
            hover:bg-background-tertiary active:scale-95
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
        >
          <span className="text-xl">💬</span>
          <span>Chat</span>
        </button>
        <button
          onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${activeTrip.pickup_lat},${activeTrip.pickup_lng}`, '_blank')}
          className="flex flex-col items-center justify-center gap-1 h-16 bg-accent-400 rounded-sm
            text-label-small text-white cursor-pointer transition-base
            hover:bg-accent-500 active:scale-95
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
        >
          <span className="text-xl">🗺️</span>
          <span>Navigate</span>
        </button>
      </div>

      {/* ── CTAs ── */}
      <button
        onClick={handleArrivedAtPickup}
        className="w-full h-14 rounded-sm bg-interactive-primary text-interactive-primary-text
          text-label-large font-medium cursor-pointer transition-base
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        ✔ I&apos;ve Arrived
      </button>

      <button
        type="button"
        onClick={() => setShowCancelModal(true)}
        className="w-full text-center text-label-medium text-content-negative py-3 min-h-[44px]
          cursor-pointer hover:opacity-80 transition-base
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative-400"
      >
        Cancel Allocation
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CompletedPane — Receipt & Rating
// ─────────────────────────────────────────────────────────────────────────────

interface CompletedPaneProps {
  activeTrip: any;
  startOdometer: string;
  endOdometer: string;
  waitingCharges: number;
  tollCharges: number;
  parkingCharges: number;
  riderRating: number;
  setRiderRating: (r: number) => void;
  riderCommentTags: string[];
  toggleRiderCommentTag: (t: string) => void;
  handlePaymentConfirmationSubmit: (m: string) => void;
  calculateTotalBill: () => number;
  finalBill?: FinalBill | null;
}

export const CompletedPane: React.FC<CompletedPaneProps> = ({
  activeTrip,
  startOdometer,
  endOdometer,
  waitingCharges,
  tollCharges,
  parkingCharges,
  riderRating,
  setRiderRating,
  riderCommentTags,
  toggleRiderCommentTag,
  handlePaymentConfirmationSubmit,
  calculateTotalBill,
  finalBill,
}) => {
  const displayTotal = finalBill ? finalBill.total_fare_paise / 100 : calculateTotalBill();
  const baseFare = finalBill ? finalBill.base_fare_paise / 100 : activeTrip.quoted_fare_paise / 100;
  const distanceCharge = finalBill
    ? finalBill.distance_charge_paise / 100
    : Math.max(0, (parseFloat(endOdometer) - parseFloat(startOdometer) - 15) * 18);
  const waitCharge = finalBill ? finalBill.wait_charge_paise / 100 : waitingCharges;
  const tolls = finalBill ? finalBill.tolls_paise / 100 : tollCharges;
  const parking = finalBill ? finalBill.parking_charges_paise / 100 : parkingCharges;
  const surge = finalBill ? finalBill.night_surge_paise / 100 : 50;
  const care = finalBill ? finalBill.care_surcharge_paise / 100 : 15;
  const waitMinutes = finalBill ? finalBill.wait_minutes : Math.round(waitingCharges / 2);

  return (
    <div className="space-y-4 text-left animate-enter">

      {/* ── Title row ── */}
      <div className="flex items-center justify-between border-b border-border-opaque pb-3">
        <h3 className="text-heading-medium text-content-primary">Receipt & Settlement</h3>
        <FareDisplay amount={displayTotal * 100} size="lg" className="text-content-positive" />
      </div>

      {/* ── Fare breakdown ── */}
      <div className="bg-background-secondary rounded-md p-4 space-y-2 border border-border-opaque">
        {[
          { label: 'Base Package', value: baseFare },
          distanceCharge > 0 && { label: 'Extra Mileage', value: distanceCharge },
          waitCharge > 0 && { label: `Waiting (${waitMinutes} min)`, value: waitCharge },
          tolls > 0 && { label: 'Tolls/Gate Fee', value: tolls },
          parking > 0 && { label: 'Parking Fee', value: parking },
          { label: 'Night/Surge', value: surge },
          { label: 'D4M Care', value: care },
        ].filter(Boolean).map((row: any) => (
          <div key={row.label} className="flex justify-between items-center">
            <span className="text-paragraph-small text-content-secondary">{row.label}</span>
            <FareDisplay amount={row.value * 100} size="sm" />
          </div>
        ))}
        <div className="border-t border-border-opaque pt-2 flex justify-between items-center">
          <span className="text-label-large text-content-primary font-medium">Grand Total</span>
          <FareDisplay amount={displayTotal * 100} size="md" className="text-content-positive font-bold" />
        </div>
      </div>

      {/* ── Rider rating ── */}
      <div className="space-y-2">
        <span className="text-label-small text-content-tertiary uppercase tracking-wider block">
          Rate Rider
        </span>
        <div className="flex items-center justify-between bg-background-secondary rounded-sm p-3 border border-border-opaque">
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRiderRating(star)}
                className={`text-2xl min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer transition-base ${
                  star <= riderRating ? 'text-content-warning' : 'text-border-opaque'
                }`}
              >
                ★
              </button>
            ))}
          </div>
          <span className="text-label-small text-content-secondary font-mono">{riderRating} / 5</span>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {['Polite', 'Punctual', 'Clean Car', 'Low Noise', 'Cooperative'].map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleRiderCommentTag(tag)}
              className={[
                'text-label-small py-2 px-3 rounded-pill border transition-base cursor-pointer min-h-[36px]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400',
                riderCommentTags.includes(tag)
                  ? 'bg-interactive-primary border-interactive-primary text-interactive-primary-text'
                  : 'bg-background-secondary border-border-opaque text-content-secondary hover:text-content-primary',
              ].join(' ')}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* ── Payment CTAs ── */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <button
          onClick={() => handlePaymentConfirmationSubmit('CASH')}
          className="h-14 rounded-sm bg-background-secondary border border-border-opaque
            text-label-large text-content-primary font-medium
            cursor-pointer transition-base hover:bg-background-tertiary active:scale-95
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
        >
          💵 Cash
        </button>
        <button
          onClick={() => handlePaymentConfirmationSubmit('UPI')}
          className="h-14 rounded-sm bg-interactive-primary
            text-interactive-primary-text text-label-large font-medium
            cursor-pointer transition-base hover:opacity-90 active:scale-95
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2"
        >
          💳 UPI
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// DriverTripManager — state router (unchanged interface)
// ─────────────────────────────────────────────────────────────────────────────

interface DriverTripManagerProps {
  activeTrip: any;
  stats: any;
  activeVehicle: string;
  setActiveVehicle: (v: string) => void;
  preferredTripFilter: 'ALL' | 'CITY' | 'OUTSTATION';
  setPreferredTripFilter: (f: 'ALL' | 'CITY' | 'OUTSTATION') => void;
  handleToggleDutySwitch: () => Promise<void>;
  logAudit: (e: string, m: any) => void;
  mapGlideProgress: number;
  setShowCancelModal: (show: boolean) => void;
  handleArrivedAtPickup: () => Promise<void>;
  freeWaitSeconds: number;
  setFreeWaitSeconds: (s: number) => void;
  waitingCharges: number;
  setWaitingCharges: (c: number) => void;
  otpError: string;
  setOtpError: (err: string) => void;
  startOdometer: string;
  setStartOdometer: (o: string) => void;
  startFuel: number;
  setStartFuel: (f: number) => void;
  startOdoPhoto: string | null;
  setStartOdoPhoto: (p: string | null) => void;
  otpVerificationCode: string;
  setOtpVerificationCode: (c: string) => void;
  setDutyState: (s: DutyState) => void;
  setActiveTrip: (t: any) => void;
  tollCharges: number;
  parkingCharges: number;
  handleTollAddition: () => void;
  handleParkingAddition: () => void;
  endOdometer: string;
  setEndOdometer: (o: string) => void;
  endFuel: number;
  setEndFuel: (f: number) => void;
  endOdoPhoto: string | null;
  setEndOdoPhoto: (p: string | null) => void;
  handleSlideToEndTrip: () => Promise<void>;
  triggerSOS?: () => void;
  riderRating: number;
  setRiderRating: (r: number) => void;
  riderCommentTags: string[];
  toggleRiderCommentTag: (t: string) => void;
  handlePaymentConfirmationSubmit: (m: string) => void;
  calculateTotalBill: () => number;
  finalBill?: FinalBill | null;
}

export const DriverTripManager: React.FC<DriverTripManagerProps> = (props) => {
  const { state } = useDriverDutyStore();

  switch (state) {
    case 'OFFER_PENDING':
      return <OfferPopup />;

    case 'EN_ROUTE':
      if (!props.activeTrip) return <DashboardHome {...props} dutyState={state} />;
      return (
        <NavigationPane
          activeTrip={props.activeTrip}
          mapGlideProgress={props.mapGlideProgress}
          setShowCancelModal={props.setShowCancelModal}
          handleArrivedAtPickup={props.handleArrivedAtPickup}
        />
      );

    case 'ARRIVED':
      if (!props.activeTrip) return <DashboardHome {...props} dutyState={state} />;
      return (
        <ArrivedVerificationPane
          activeTrip={props.activeTrip}
          freeWaitSeconds={props.freeWaitSeconds}
          setFreeWaitSeconds={props.setFreeWaitSeconds}
          waitingCharges={props.waitingCharges}
          setWaitingCharges={props.setWaitingCharges}
          otpError={props.otpError}
          setOtpError={props.setOtpError}
          startOdometer={props.startOdometer}
          setStartOdometer={props.setStartOdometer}
          startFuel={props.startFuel}
          setStartFuel={props.setStartFuel}
          startOdoPhoto={props.startOdoPhoto}
          setStartOdoPhoto={props.setStartOdoPhoto}
          otpVerificationCode={props.otpVerificationCode}
          setOtpVerificationCode={props.setOtpVerificationCode}
          logAudit={props.logAudit}
          setDutyState={props.setDutyState}
          setActiveTrip={props.setActiveTrip}
        />
      );

    case 'DELIVERING':
      if (!props.activeTrip) return <DashboardHome {...props} dutyState={state} />;
      return (
        <TripInProgressPane
          activeTrip={props.activeTrip}
          tollCharges={props.tollCharges}
          parkingCharges={props.parkingCharges}
          handleTollAddition={props.handleTollAddition}
          handleParkingAddition={props.handleParkingAddition}
          endOdometer={props.endOdometer}
          setEndOdometer={props.setEndOdometer}
          endFuel={props.endFuel}
          setEndFuel={props.setEndFuel}
          startOdometer={props.startOdometer}
          endOdoPhoto={props.endOdoPhoto}
          setEndOdoPhoto={props.setEndOdoPhoto}
          handleSlideToEndTrip={props.handleSlideToEndTrip}
          triggerSOS={props.triggerSOS}
          logAudit={props.logAudit}
        />
      );

    case 'COMPLETED':
      if (!props.activeTrip) return <DashboardHome {...props} dutyState={state} />;
      return (
        <CompletedPane
          activeTrip={props.activeTrip}
          startOdometer={props.startOdometer}
          endOdometer={props.endOdometer}
          waitingCharges={props.waitingCharges}
          tollCharges={props.tollCharges}
          parkingCharges={props.parkingCharges}
          riderRating={props.riderRating}
          setRiderRating={props.setRiderRating}
          riderCommentTags={props.riderCommentTags}
          toggleRiderCommentTag={props.toggleRiderCommentTag}
          handlePaymentConfirmationSubmit={props.handlePaymentConfirmationSubmit}
          calculateTotalBill={props.calculateTotalBill}
          finalBill={props.finalBill}
        />
      );

    default:
      return <DashboardHome {...props} dutyState={state} />;
  }
};
