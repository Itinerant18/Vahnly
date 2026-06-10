import React, { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useDriverDutyStore, DutyState } from '@/store/useDriverDutyStore';
import { verifyTripOTP, ApiClientError } from '@/api/client';

interface ArrivedVerificationPaneProps {
  activeTrip: any;
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
  logAudit: (e: string, m: any) => void;
  setDutyState: (s: DutyState) => void;
  setActiveTrip: (t: any) => void;
}

export const ArrivedVerificationPane: React.FC<ArrivedVerificationPaneProps> = ({
  activeTrip,
  freeWaitSeconds,
  setFreeWaitSeconds,
  waitingCharges,
  setWaitingCharges,
  otpError,
  setOtpError,
  startOdometer,
  setStartOdometer,
  startFuel,
  setStartFuel,
  startOdoPhoto,
  setStartOdoPhoto,
  otpVerificationCode,
  setOtpVerificationCode,
  logAudit,
  setDutyState,
  setActiveTrip,
}) => {
  const { token } = useAuthStore();
  const [minOdometer, setMinOdometer] = useState<number>(0);
  const [validationError, setValidationError] = useState<string>('');
  const [waitingStartedAt, setWaitingStartedAt] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [failedAttempts, setFailedAttempts] = useState<number>(0);

  const orderId = activeTrip?.order_id;

  // 1. Fetch active order details (waiting_started_at and last_odometer)
  useEffect(() => {
    if (!orderId || !token) return;

    let active = true;

    const fetchOrderDetails = async () => {
      try {
        const response = await fetch(`/api/v1/driver/orders/${orderId}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        });
        if (response.ok && active) {
          const data = await response.json();
          if (data.waiting_started_at) {
            setWaitingStartedAt(data.waiting_started_at);
          }
          if (data.last_odometer !== undefined) {
            setMinOdometer(data.last_odometer);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch active order details:', err);
      }
    };

    fetchOrderDetails();
    const pollInterval = setInterval(fetchOrderDetails, 5000);

    return () => {
      active = false;
      clearInterval(pollInterval);
    };
  }, [orderId, token]);

  // 2. Local Wait Timer clock loop
  useEffect(() => {
    if (!waitingStartedAt) return;

    const interval = setInterval(() => {
      const startedAtTime = new Date(waitingStartedAt).getTime();
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAtTime) / 1000));
      setElapsedSeconds(elapsed);

      // Sync parent states
      const remainingFree = Math.max(0, 300 - elapsed);
      setFreeWaitSeconds(remainingFree);

      if (elapsed > 300) {
        const excessSeconds = elapsed - 300;
        setWaitingCharges(excessSeconds * (2 / 60));
      } else {
        setWaitingCharges(0);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [waitingStartedAt, setFreeWaitSeconds, setWaitingCharges]);

  // Handle Verify and Start
  const handleVerifyOtpAndStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');
    setOtpError('');

    if (otpVerificationCode.length !== 4) {
      setValidationError('OTP must be exactly 4 digits.');
      return;
    }

    const odoValue = parseInt(startOdometer, 10);
    if (isNaN(odoValue) || odoValue <= 0) {
      setValidationError('A valid positive integer odometer value is required.');
      return;
    }

    if (odoValue < minOdometer) {
      setValidationError(`Odometer reading cannot be less than previous end value of ${minOdometer} KM.`);
      return;
    }

    logAudit('TRIP_START_ATTEMPT', {
      orderId,
      startOdometer: odoValue,
      startFuel,
      otpEntered: otpVerificationCode,
    });

    if (failedAttempts >= 3) {
      setOtpError('OTP locked: too many failed attempts. Restart the trip flow.');
      return;
    }

    // The trip can only start on a server-verified OTP. There is no client-side bypass:
    // without an authenticated session we force re-auth rather than advancing state.
    if (!orderId || !token) {
      setOtpError('Session expired. Please re-authenticate before starting the trip.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await verifyTripOTP(token, orderId, otpVerificationCode, odoValue, startFuel);
      if (res.success) {
        logAudit('TRIP_STARTED', { orderId });
        setDutyState('DELIVERING');
      }
    } catch (err: any) {
      if (err instanceof ApiClientError) {
        // Count genuine OTP rejections toward the local lockout (mirrors the server's
        // 3-attempt lock); a server-side lock (403) caps it immediately.
        if (err.status === 403 || err.body.includes('too_many_otp_attempts')) {
          setFailedAttempts(3);
          setOtpError('OTP locked: Too many failed attempts. Trip is locked.');
        } else {
          setFailedAttempts((n) => n + 1);
          try {
            const errorJson = JSON.parse(err.body);
            setOtpError(errorJson.message || errorJson.error || 'OTP verification failed.');
          } catch {
            setOtpError(err.body || 'OTP verification failed.');
          }
        }
      } else {
        // Network/transport error — do not count toward the lockout.
        setOtpError(err.message || 'OTP verification failed. Check your connection.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle No-Show Reporting
  const handleReportNoShow = () => {
    if (elapsedSeconds <= 300) {
      alert('You cannot report a no-show during the initial 5-minute wait period.');
      return;
    }
    if (confirm('Report rider no-show? This will cancel the booking with reason RIDER_NO_SHOW.')) {
      logAudit('TRIP_CANCELLED_BY_DRIVER', { orderId, reason: 'RIDER_NO_SHOW' });
      setActiveTrip(null);
      setDutyState('ONLINE');
    }
  };

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
        {elapsedSeconds <= 300 ? (
          <>
            <div className="h-8 w-8 rounded-full border-2 border-zinc-800 border-t-zinc-400 animate-spin flex items-center justify-center text-[10px] font-bold text-zinc-400">
              ⏳
            </div>
            <div>
              <span className="text-[8px] text-zinc-500 uppercase tracking-widest block">Free Waiting Period</span>
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
              <span className="text-[8px] text-zinc-500 uppercase tracking-widest block text-red-400 font-bold">Waiting Charges Incurred</span>
              <span className="text-xs font-bold text-amber-500 animate-pulse">
                ₹{waitingCharges.toFixed(2)} (Accumulating at ₹2/min)
              </span>
            </div>
          </>
        )}
      </div>

      {/* Inputs form */}
      <form onSubmit={handleVerifyOtpAndStart} className="space-y-3 font-mono">
        {otpError && (
          <div className="bg-red-950 border border-red-900 text-red-200 text-[10px] p-2.5 rounded-xl font-bold uppercase">
            ❌ {otpError}
          </div>
        )}

        {validationError && (
          <div className="bg-red-950 border border-red-900 text-red-200 text-[10px] p-2.5 rounded-xl font-bold uppercase">
            ⚠️ {validationError}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
              Start Odometer KM (Min: {minOdometer})
            </label>
            <input
              type="number"
              value={startOdometer}
              onChange={(e) => setStartOdometer(e.target.value)}
              placeholder={`Min: ${minOdometer}`}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-zinc-500 text-xs"
              required
            />
          </div>
          <div>
            <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
              Fuel Gauge ({startFuel}%)
            </label>
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
            <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
              Dashboard Scan (Optional)
            </label>
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
            <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
              Enter Ride OTP (4 Digits)
            </label>
            <input
              type="text"
              pattern="[0-9]*"
              inputMode="numeric"
              maxLength={4}
              value={otpVerificationCode}
              onChange={(e) => setOtpVerificationCode(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="e.g. 1234"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-zinc-500 text-xs text-center font-bold tracking-widest"
              required
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <button
            type="submit"
            disabled={otpVerificationCode.length !== 4 || isSubmitting || failedAttempts >= 3}
            className={`w-full py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer active:scale-95 text-center font-sans ${
              otpVerificationCode.length !== 4 || isSubmitting || failedAttempts >= 3
                ? 'bg-zinc-800 text-zinc-550 border border-zinc-900 cursor-not-allowed opacity-50'
                : 'bg-emerald-500 hover:bg-emerald-600 text-white'
            }`}
          >
            {failedAttempts >= 3 ? 'OTP Locked' : isSubmitting ? 'Verifying...' : 'Verify OTP & Start Trip'}
          </button>

          <button
            type="button"
            disabled={elapsedSeconds <= 300}
            onClick={handleReportNoShow}
            className={`w-full py-3 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider transition cursor-pointer text-center ${
              elapsedSeconds <= 300
                ? 'bg-zinc-900 text-zinc-650 border border-zinc-950 cursor-not-allowed opacity-40'
                : 'bg-zinc-900 hover:bg-zinc-850 text-red-500 border border-zinc-800'
            }`}
            title={elapsedSeconds <= 300 ? 'Disabled during initial 5-min wait period' : 'Report no-show'}
          >
            Report Rider No-Show {elapsedSeconds <= 300 ? `(${Math.floor(freeWaitSeconds / 60)}:${(freeWaitSeconds % 60).toString().padStart(2, '0')})` : ''}
          </button>
        </div>
      </form>
    </div>
  );
};
