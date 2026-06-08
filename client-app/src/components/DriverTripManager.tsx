import React from 'react';
import { DutyState, useDriverDutyStore } from '../store/useDriverDutyStore';
import { OfferPopup } from './OfferPopup';
import { SlideToConfirm } from './SlideToConfirm';

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
  setDutyState,
  logAudit,
}) => {
  if (dutyState === 'OFFLINE') {
    return (
      <div className="space-y-4 text-left">
        <div className="flex justify-between items-center bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl">
          <div>
            <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Selected Vehicle</span>
            <select
              value={activeVehicle}
              onChange={(e) => setActiveVehicle(e.target.value)}
              className="block bg-transparent text-xs font-bold text-white outline-none mt-1 cursor-pointer"
            >
              <option>WB-02-AK-9988 (Premium SUV)</option>
              <option>KA-03-MD-4561 (Hatchback Core)</option>
            </select>
          </div>
          <div>
            <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest block text-right">Job Type Filter</span>
            <select
              value={preferredTripFilter}
              onChange={(e) => setPreferredTripFilter(e.target.value as any)}
              className="block bg-transparent text-xs font-bold text-white outline-none mt-1 cursor-pointer text-right"
            >
              <option value="ALL">City & Outstation</option>
              <option value="CITY">In-City Only</option>
              <option value="OUTSTATION">Outstation Only</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleToggleDutySwitch}
          type="button"
          className="w-full bg-white hover:bg-zinc-200 text-black py-4 rounded-xl text-xs font-bold uppercase tracking-wider transition active:scale-98 cursor-pointer text-center"
        >
          Go Online
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-left">
      <div className="flex justify-between items-center border-b border-zinc-900 pb-3">
        <div>
          <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">Telemetry Dispatch Loop</span>
          <h3 className="text-xs font-bold text-white mt-0.5 uppercase tracking-wide flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping"></span>
            Actively Seeking Matches...
          </h3>
        </div>

        <button
          onClick={handleToggleDutySwitch}
          className="bg-zinc-900 hover:bg-zinc-850 text-red-500 border border-zinc-800 text-[8px] font-mono font-bold uppercase py-1 px-3 rounded-full cursor-pointer"
        >
          Offline
        </button>
      </div>

      {/* Duty statistics snapshots */}
      <div className="grid grid-cols-4 gap-2 text-center text-zinc-400 font-mono text-[9px]">
        <div className="bg-zinc-900/60 p-2 rounded-lg border border-zinc-900">
          <span className="text-zinc-500 block text-[7px] uppercase">TRIPS</span>
          <span className="text-white block mt-0.5 font-bold">{stats.trips_count}</span>
        </div>
        <div className="bg-zinc-900/60 p-2 rounded-lg border border-zinc-900">
          <span className="text-zinc-500 block text-[7px] uppercase">EARNINGS</span>
          <span className="text-white block mt-0.5 font-bold">₹{stats.earnings_rupees.toFixed(2)}</span>
        </div>
        <div className="bg-zinc-900/60 p-2 rounded-lg border border-zinc-900">
          <span className="text-zinc-500 block text-[7px] uppercase">HOURS</span>
          <span className="text-white block mt-0.5 font-bold">{stats.online_hours}h</span>
        </div>
        <div className="bg-zinc-900/60 p-2 rounded-lg border border-zinc-900">
          <span className="text-zinc-500 block text-[7px] uppercase">ACCEPT</span>
          <span className="text-white block mt-0.5 font-bold">{stats.acceptance_rate}%</span>
        </div>
      </div>

      {/* Demo Match simulation trigger button */}
      <div className="flex gap-2 pt-2 border-t border-zinc-900 mt-3">
        <button
          onClick={() => {
            const mockOrderId = 'ord-demo-' + Math.floor(Math.random() * 10000);
            useDriverDutyStore.getState().setDutyState('OFFER_PENDING');
            logAudit('INCOMING_OFFER_RECEIVED', { orderId: mockOrderId, source: 'DEMO' });
          }}
          className="w-full bg-zinc-900 hover:bg-zinc-850 text-amber-500 border border-zinc-850 py-2.5 rounded-xl text-[9px] font-mono font-bold uppercase tracking-wider transition cursor-pointer text-center"
        >
          🔔 Simulate Incoming Booking (Demo)
        </button>
      </div>
    </div>
  );
};

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
  return (
    <div className="space-y-4 text-left animate-fadeIn">
      <div className="border-b border-zinc-900 pb-3 flex justify-between items-center">
        <div>
          <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">En Route to Pickup Hub</span>
          <h3 className="text-xs font-bold text-white mt-0.5">{activeTrip.customer_name}</h3>
        </div>
        <div className="bg-blue-900/30 text-blue-400 border border-blue-800 text-[8px] font-mono font-bold px-2 py-1 rounded">
          ETA: {Math.max(1, Math.round(6 - (mapGlideProgress / 100) * 5))} MINS
        </div>
      </div>

      <div className="text-xs space-y-1 font-mono text-zinc-400 leading-normal bg-zinc-900/40 p-3 border border-zinc-900 rounded-xl">
        <div>📍 <span className="text-zinc-500 font-bold">Pickup Address:</span> {activeTrip.pickup_address}</div>
        {activeTrip.special_notes && (
          <div className="mt-1.5 text-[9px] text-amber-500"><span className="text-zinc-500 font-bold">Notes:</span> "{activeTrip.special_notes}"</div>
        )}
      </div>

      {/* Rider details card */}
      <div className="bg-zinc-900/60 p-4 border border-zinc-905 rounded-xl space-y-3 font-mono">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-lg font-bold text-white">
              👤
            </div>
            <div>
              <span className="text-[7px] text-zinc-505 uppercase tracking-widest block">Rider details</span>
              <h3 className="text-xs font-bold text-white mt-0.5">{activeTrip.customer_name}</h3>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-amber-500 text-[10px]">★</span>
                <span className="text-[9px] text-zinc-400 font-bold">{activeTrip.customer_rating.toFixed(2)}</span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[7px] text-zinc-505 uppercase tracking-widest block">Phone Number</span>
            <span className="text-[10px] text-white font-bold block mt-0.5">
              +91 98XXX XXXXX
            </span>
          </div>
        </div>
      </div>

      {/* Route control button triggers */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => alert(`Dialing passenger number ${activeTrip.customer_phone} via secure proxy server mask...`)}
          className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 py-2.5 rounded-xl text-[9px] font-mono font-bold uppercase text-zinc-300 cursor-pointer"
        >
          📞 Call Client
        </button>
        <button
          onClick={() => alert('Opening secure in-app chat session window.')}
          className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 py-2.5 rounded-xl text-[9px] font-mono font-bold uppercase text-zinc-300 cursor-pointer"
        >
          💬 In-App Chat
        </button>
        <button
          onClick={() => {
            window.open(`https://www.google.com/maps/search/?api=1&query=${activeTrip.pickup_lat},${activeTrip.pickup_lng}`, '_blank');
          }}
          className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 py-2.5 rounded-xl text-[9px] font-mono font-bold uppercase text-zinc-300 cursor-pointer"
        >
          🗺️ Navigate (Maps)
        </button>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => setShowCancelModal(true)}
          className="flex-1 bg-zinc-900 hover:bg-zinc-850 text-red-500 border border-zinc-800 py-3 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider transition cursor-pointer"
        >
          Cancel Allocation
        </button>
        
        <button
          onClick={handleArrivedAtPickup}
          className="flex-1 bg-white hover:bg-zinc-200 text-black py-3 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider transition cursor-pointer active:scale-95"
        >
          ✔️ I've Arrived at Hub
        </button>
      </div>
    </div>
  );
};

interface ArrivedVerificationPaneProps {
  activeTrip: any;
  freeWaitSeconds: number;
  waitingCharges: number;
  otpError: string;
  startOdometer: string;
  setStartOdometer: (o: string) => void;
  startFuel: number;
  setStartFuel: (f: number) => void;
  startOdoPhoto: string | null;
  setStartOdoPhoto: (p: string | null) => void;
  otpVerificationCode: string;
  setOtpVerificationCode: (c: string) => void;
  handleVerifyOtpAndStart: (e: React.FormEvent) => Promise<void>;
  logAudit: (e: string, m: any) => void;
  setDutyState: (s: DutyState) => void;
  setActiveTrip: (t: any) => void;
}

export const ArrivedVerificationPane: React.FC<ArrivedVerificationPaneProps> = ({
  activeTrip,
  freeWaitSeconds,
  waitingCharges,
  otpError,
  startOdometer,
  setStartOdometer,
  startFuel,
  setStartFuel,
  startOdoPhoto,
  setStartOdoPhoto,
  otpVerificationCode,
  setOtpVerificationCode,
  handleVerifyOtpAndStart,
  logAudit,
  setDutyState,
  setActiveTrip,
}) => {
  return (
    <div className="space-y-4 text-left animate-fadeIn">
      <div className="border-b border-zinc-900 pb-3">
        <span className="bg-amber-950 text-amber-400 font-mono font-bold text-[8px] uppercase tracking-widest px-2.5 py-1 rounded border border-amber-900">
          🔐 SECURE PICKUP CHECKPOINT PANEL
        </span>
        <div className="flex justify-between items-center mt-2.5">
          <div>
            <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Active Client</span>
            <h3 className="text-xs font-bold text-white mt-0.5">{activeTrip.customer_name}</h3>
          </div>
        </div>
      </div>

      {/* Wait charge accumulator */}
      <div className="flex items-center gap-3 bg-zinc-900/40 border border-zinc-900 p-3 rounded-xl font-mono">
        {freeWaitSeconds > 0 ? (
          <>
            <div className="h-8 w-8 rounded-full border-2 border-zinc-800 border-t-zinc-400 animate-spin flex items-center justify-center text-[10px] font-bold text-zinc-400">
              ⏳
            </div>
            <div>
              <span className="text-[8px] text-zinc-505 uppercase tracking-widest block">Free Waiting Period</span>
              <span className="text-xs font-bold text-white font-mono">
                {Math.floor(freeWaitSeconds / 60)}:{(freeWaitSeconds % 60).toString().padStart(2, '0')} Remaining
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="h-8 w-8 rounded-full bg-red-950 border border-red-800 flex items-center justify-center text-xs animate-pulse">
              🚨
            </div>
            <div>
              <span className="text-[8px] text-zinc-505 uppercase tracking-widest block text-red-400 font-bold">Waiting Charges Incurred</span>
              <span className="text-xs font-bold text-amber-500 animate-pulse">
                ₹{waitingCharges.toFixed(2)} (Accumulating at ₹2/min)
              </span>
            </div>
          </>
        )}
      </div>

      {/* Speedometer odometer captures & OTP verification lock */}
      <form onSubmit={handleVerifyOtpAndStart} className="space-y-3 font-mono">
        {otpError && (
          <div className="bg-red-950 border border-red-900 text-red-200 text-[10px] p-2.5 rounded-xl font-bold uppercase">
            ❌ {otpError}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Start Odometer KM</label>
            <input
              type="number"
              value={startOdometer}
              onChange={(e) => setStartOdometer(e.target.value)}
              placeholder="e.g. 23450"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-zinc-500 text-xs"
              required
            />
          </div>
          <div>
            <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Fuel Gauge ({startFuel}%)</label>
            <input
              type="range"
              min="0"
              max="100"
              value={startFuel}
              onChange={(e) => setStartFuel(parseInt(e.target.value))}
              className="w-full h-8 cursor-pointer"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-[8px] font-bold text-zinc-505 uppercase tracking-wider mb-1">Dashboard Scan (Optional)</label>
            <button
              type="button"
              onClick={() => {
                setStartOdoPhoto(`s3://odometer-captures/start-${Date.now()}.png`);
                logAudit('ODOMETER_PHOTO_UPLOADED', { stage: 'START' });
              }}
              className="w-full bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 text-[9px] font-bold uppercase py-2.5 rounded-xl text-zinc-400 cursor-pointer"
            >
              {startOdoPhoto ? '✔️ Capture Ready' : '📷 Take Dash Photo'}
            </button>
          </div>
          <div>
            <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Enter Ride OTP (from Rider)</label>
            <input
              type="text"
              value={otpVerificationCode}
              onChange={(e) => setOtpVerificationCode(e.target.value)}
              placeholder="e.g. 1234"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-zinc-500 text-xs text-center font-bold tracking-widest"
              maxLength={4}
              required
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <button
            type="submit"
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer active:scale-95 text-center font-sans"
          >
            Verify OTP & Start Trip
          </button>

          <button
            type="button"
            disabled={freeWaitSeconds > 0}
            onClick={() => {
              if (confirm('Report rider no-show? This will cancel the booking with reason RIDER_NO_SHOW.')) {
                logAudit('TRIP_CANCELLED_BY_DRIVER', { orderId: activeTrip.order_id, reason: 'RIDER_NO_SHOW' });
                setActiveTrip(null);
                setDutyState('ONLINE');
              }
            }}
            className={`w-full py-3 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider transition cursor-pointer text-center ${
              freeWaitSeconds > 0
                ? 'bg-zinc-900 text-zinc-650 border border-zinc-950 cursor-not-allowed opacity-40'
                : 'bg-zinc-900 hover:bg-zinc-850 text-red-500 border border-zinc-800'
            }`}
            title={freeWaitSeconds > 0 ? 'Disabled during free wait period' : 'Report no-show'}
          >
            Report Rider No-Show {freeWaitSeconds > 0 ? `(${Math.floor(freeWaitSeconds / 60)}:${(freeWaitSeconds % 60).toString().padStart(2, '0')})` : ''}
          </button>
        </div>
      </form>
    </div>
  );
};

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
}) => {
  return (
    <div className="space-y-4 text-left animate-fadeIn">
      <div className="border-b border-zinc-900 pb-3 flex justify-between items-center">
        <div>
          <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Active Transit in Progress</span>
          <h3 className="text-xs font-bold text-white mt-0.5">{activeTrip.customer_name}</h3>
        </div>
        <div className="bg-emerald-950 text-emerald-400 border border-emerald-900 text-[8px] font-mono font-bold px-2 py-1 rounded animate-pulse">
          DELIVERING
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 font-mono text-[9px] uppercase font-bold text-zinc-400 text-center">
        <div className="bg-zinc-900 p-2.5 rounded-lg">
          <span className="text-zinc-600 block text-[7px]">BASE FARE</span>
          <span className="text-white block mt-0.5">₹{(activeTrip.quoted_fare_paise / 100).toFixed(0)}</span>
        </div>
        <div className="bg-zinc-900 p-2.5 rounded-lg">
          <span className="text-zinc-600 block text-[7px]">TOLLS ADDED</span>
          <span className="text-white block mt-0.5">₹{tollCharges}</span>
        </div>
        <div className="bg-zinc-900 p-2.5 rounded-lg">
          <span className="text-zinc-600 block text-[7px]">PARKING FEES</span>
          <span className="text-white block mt-0.5">₹{parkingCharges}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={handleTollAddition}
          className="bg-zinc-900 hover:bg-zinc-855 border border-zinc-850 text-[9px] font-mono font-bold uppercase py-2 rounded-xl text-zinc-300 cursor-pointer"
        >
          ➕ Add Toll (₹50)
        </button>
        <button
          onClick={handleParkingAddition}
          className="bg-zinc-900 hover:bg-zinc-855 border border-zinc-850 text-[9px] font-mono font-bold uppercase py-2 rounded-xl text-zinc-300 cursor-pointer"
        >
          ➕ Add Parking (₹30)
        </button>
      </div>

      <div className="bg-zinc-900/50 p-4 border border-zinc-900 rounded-xl space-y-3 font-mono">
        <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest block border-b border-zinc-850 pb-1.5">
          End Odometer Capture (Required to Slide Close)
        </span>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-[8px] font-bold text-zinc-600 uppercase mb-1">End Odometer KM</label>
            <input
              type="number"
              value={endOdometer}
              onChange={(e) => setEndOdometer(e.target.value)}
              placeholder={`>${startOdometer} KM`}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-white focus:outline-none focus:border-zinc-500 text-xs"
              required
            />
          </div>
          <div>
            <label className="block text-[8px] font-bold text-zinc-600 uppercase mb-1">End Fuel ({endFuel}%)</label>
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

      <SlideToConfirm
        label="Slide to End Journey"
        onConfirm={handleSlideToEndTrip}
        color="red"
      />
    </div>
  );
};

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
}) => {
  return (
    <div className="space-y-4 text-left animate-fadeIn">
      <h3 className="text-sm font-bold tracking-wider font-mono uppercase text-white border-b border-zinc-900 pb-3 flex justify-between items-center">
        <span>Receipt & Settlement</span>
        <span className="text-emerald-500 font-mono">₹{calculateTotalBill().toFixed(2)}</span>
      </h3>

      <div className="bg-zinc-900/50 border border-zinc-900 rounded-xl p-4 space-y-2 font-mono text-[10px] text-zinc-400">
        <div className="flex justify-between">
          <span>Base Package Quoted:</span>
          <span className="text-white">₹{(activeTrip.quoted_fare_paise / 100).toFixed(2)}</span>
        </div>
        {parseFloat(endOdometer) - parseFloat(startOdometer) > 15 && (
          <div className="flex justify-between">
            <span>Extra Mileage Charge:</span>
            <span className="text-white">₹{(Math.max(0, (parseFloat(endOdometer) - parseFloat(startOdometer)) - 15) * 18).toFixed(2)}</span>
          </div>
        )}
        {waitingCharges > 0 && (
          <div className="flex justify-between">
            <span>Waiting Fee ({Math.round(waitingCharges / 2)} mins):</span>
            <span className="text-white">₹{waitingCharges.toFixed(2)}</span>
          </div>
        )}
        {tollCharges > 0 && (
          <div className="flex justify-between">
            <span>Tolls/Gate Fee:</span>
            <span className="text-white">₹{tollCharges.toFixed(2)}</span>
          </div>
        )}
        {parkingCharges > 0 && (
          <div className="flex justify-between">
            <span>Parking Fee:</span>
            <span className="text-white">₹{parkingCharges.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Night / Surge Commissions:</span>
          <span className="text-white">₹50.00</span>
        </div>
        <div className="flex justify-between">
          <span>D4M Safety Care Premium:</span>
          <span className="text-white">₹15.00</span>
        </div>
        <div className="border-t border-zinc-800 pt-2 flex justify-between font-bold text-xs text-white">
          <span>Grand Total Net:</span>
          <span className="text-emerald-400">₹{calculateTotalBill().toFixed(2)}</span>
        </div>
      </div>

      <div className="space-y-2">
        <span className="block text-[8px] font-bold text-zinc-505 uppercase tracking-widest font-mono">Rate Rider Passenger Etiquette</span>
        <div className="flex justify-between items-center bg-zinc-900/30 border border-zinc-900 p-3 rounded-xl">
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRiderRating(star)}
                className={`text-lg cursor-pointer transition ${star <= riderRating ? 'text-amber-500' : 'text-zinc-700'}`}
              >
                ★
              </button>
            ))}
          </div>
          <span className="text-[10px] text-zinc-505 font-mono font-bold uppercase">{riderRating} Stars</span>
        </div>

        <div className="flex flex-wrap gap-1.5 pt-1">
          {['Polite', 'Punctual', 'Clean Car Care', 'Low Noise', 'Highly Cooperative'].map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleRiderCommentTag(tag)}
              className={`text-[8px] font-bold uppercase tracking-wider py-1.5 px-3 rounded-full border transition cursor-pointer ${
                riderCommentTags.includes(tag)
                  ? 'bg-white border-white text-black'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-2">
        <button
          onClick={() => handlePaymentConfirmationSubmit('CASH')}
          className="bg-zinc-900 hover:bg-zinc-850 text-white font-mono font-bold text-[10px] uppercase tracking-wider py-3.5 border border-zinc-800 rounded-xl transition cursor-pointer active:scale-95 text-center"
        >
          💵 Cash Settled
        </button>
        <button
          onClick={() => handlePaymentConfirmationSubmit('UPI')}
          className="bg-white hover:bg-zinc-200 text-black font-sans font-bold text-[10px] uppercase tracking-wider py-3.5 rounded-xl transition cursor-pointer active:scale-95 text-center"
        >
          💳 UPI Verified
        </button>
      </div>
    </div>
  );
};

interface DriverTripManagerProps {
  // Pass down active states from container to keep AST/effects intact
  activeTrip: any;
  stats: any;
  activeVehicle: string;
  setActiveVehicle: (v: string) => void;
  preferredTripFilter: 'ALL' | 'CITY' | 'OUTSTATION';
  setPreferredTripFilter: (f: 'ALL' | 'CITY' | 'OUTSTATION') => void;
  handleToggleDutySwitch: () => Promise<void>;
  logAudit: (e: string, m: any) => void;

  // En Route props
  mapGlideProgress: number;
  setShowCancelModal: (show: boolean) => void;
  handleArrivedAtPickup: () => Promise<void>;

  // Arrived props
  freeWaitSeconds: number;
  waitingCharges: number;
  otpError: string;
  startOdometer: string;
  setStartOdometer: (o: string) => void;
  startFuel: number;
  setStartFuel: (f: number) => void;
  startOdoPhoto: string | null;
  setStartOdoPhoto: (p: string | null) => void;
  otpVerificationCode: string;
  setOtpVerificationCode: (c: string) => void;
  handleVerifyOtpAndStart: (e: React.FormEvent) => Promise<void>;
  setDutyState: (s: DutyState) => void;
  setActiveTrip: (t: any) => void;

  // Delivering props
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

  // Completed props
  riderRating: number;
  setRiderRating: (r: number) => void;
  riderCommentTags: string[];
  toggleRiderCommentTag: (t: string) => void;
  handlePaymentConfirmationSubmit: (m: string) => void;
  calculateTotalBill: () => number;
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
          waitingCharges={props.waitingCharges}
          otpError={props.otpError}
          startOdometer={props.startOdometer}
          setStartOdometer={props.setStartOdometer}
          startFuel={props.startFuel}
          setStartFuel={props.setStartFuel}
          startOdoPhoto={props.startOdoPhoto}
          setStartOdoPhoto={props.setStartOdoPhoto}
          otpVerificationCode={props.otpVerificationCode}
          setOtpVerificationCode={props.setOtpVerificationCode}
          handleVerifyOtpAndStart={props.handleVerifyOtpAndStart}
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
        />
      );
    default:
      return <DashboardHome {...props} dutyState={state} />;
  }
};
