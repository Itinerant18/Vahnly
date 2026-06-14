import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useDriverDutyStore, DutyState } from '@/store/useDriverDutyStore';
import { verifyTripOTP, ApiClientError } from '@/api/client';
import { FareDisplay } from '@/components/ds';

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

// OTP 4-box component with auto-advance
function OtpInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const refs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  const handleChange = (idx: number, char: string) => {
    const cleaned = char.replace(/[^0-9]/g, '').slice(-1);
    const arr = value.padEnd(4, ' ').split('');
    arr[idx] = cleaned || ' ';
    const next = arr.join('').trimEnd();
    onChange(next);
    if (cleaned && idx < 3) refs[idx + 1]?.current?.focus();
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !value[idx] && idx > 0) {
      refs[idx - 1]?.current?.focus();
    }
  };

  return (
    <div className="flex gap-3 justify-center" role="group" aria-label="OTP code">
      {[0, 1, 2, 3].map((i) => (
        <input
          key={i}
          ref={refs[i]}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={value[i] ?? ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          className="w-16 h-20 rounded-sm border border-border-opaque bg-background-secondary
            text-display-small font-mono text-content-primary text-center
            focus:border-border-accent focus:ring-2 focus:ring-accent-400 outline-none
            transition-base"
          aria-label={`OTP digit ${i + 1}`}
        />
      ))}
    </div>
  );
}

// Fuel slider with color gradient by level
function FuelSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const pct = value;
  const fillCls =
    pct >= 50
      ? 'bg-status-online'
      : pct >= 20
      ? 'bg-status-pending'
      : 'bg-status-negative';

  return (
    <div>
      <div className="flex justify-between text-label-small text-content-tertiary mb-1">
        <span>E</span>
        <span className="font-mono tabular-nums">{value}%</span>
        <span>F</span>
      </div>
      <div className="relative h-2 rounded-pill bg-background-tertiary">
        <div
          className={`absolute left-0 top-0 h-full rounded-pill transition-all ${fillCls}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full h-8 opacity-0 absolute top-0 left-0 cursor-pointer"
        aria-label="Fuel level"
      />
    </div>
  );
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
  const [validationError, setValidationError] = useState('');
  const [waitingStartedAt, setWaitingStartedAt] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);

  const orderId = activeTrip?.order_id;

  // Fetch order details (waiting_started_at + last_odometer)
  useEffect(() => {
    if (!orderId || !token) return;
    let active = true;
    const fetchOrderDetails = async () => {
      try {
        const res = await fetch(`/api/v1/driver/orders/${orderId}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        if (res.ok && active) {
          const data = await res.json();
          if (data.waiting_started_at) setWaitingStartedAt(data.waiting_started_at);
          if (data.last_odometer !== undefined) setMinOdometer(data.last_odometer);
        }
      } catch {}
    };
    fetchOrderDetails();
    const poll = setInterval(fetchOrderDetails, 5000);
    return () => { active = false; clearInterval(poll); };
  }, [orderId, token]);

  // Wait timer
  useEffect(() => {
    if (!waitingStartedAt) return;
    const interval = setInterval(() => {
      const started = new Date(waitingStartedAt).getTime();
      const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
      setElapsedSeconds(elapsed);
      setFreeWaitSeconds(Math.max(0, 300 - elapsed));
      setWaitingCharges(elapsed > 300 ? (elapsed - 300) * (2 / 60) : 0);
    }, 1000);
    return () => clearInterval(interval);
  }, [waitingStartedAt, setFreeWaitSeconds, setWaitingCharges]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');
    setOtpError('');

    if (otpVerificationCode.replace(/\s/g, '').length !== 4) {
      setValidationError('OTP must be exactly 4 digits.');
      return;
    }
    const odoValue = parseInt(startOdometer, 10);
    if (isNaN(odoValue) || odoValue <= 0) {
      setValidationError('Enter a valid odometer reading.');
      return;
    }
    if (odoValue < minOdometer) {
      setValidationError(`Odometer cannot be below previous value of ${minOdometer} km.`);
      return;
    }
    if (failedAttempts >= 3) {
      setOtpError('OTP locked: too many failed attempts.');
      return;
    }
    if (!orderId || !token) {
      setOtpError('Session expired. Please re-authenticate.');
      return;
    }

    logAudit('TRIP_START_ATTEMPT', { orderId, startOdometer: odoValue, startFuel });
    setIsSubmitting(true);

    try {
      const res = await verifyTripOTP(token, orderId, otpVerificationCode.replace(/\s/g, ''), odoValue, startFuel);
      if (res.success) {
        logAudit('TRIP_STARTED', { orderId });
        setDutyState('DELIVERING');
      }
    } catch (err: any) {
      if (err instanceof ApiClientError) {
        if (err.status === 403 || err.body.includes('too_many_otp_attempts')) {
          setFailedAttempts(3);
          setOtpError('OTP locked: too many attempts.');
        } else {
          setFailedAttempts((n) => n + 1);
          try {
            const j = JSON.parse(err.body);
            setOtpError(j.message || j.error || 'OTP verification failed.');
          } catch {
            setOtpError(err.body || 'OTP verification failed.');
          }
        }
      } else {
        setOtpError(err.message || 'OTP verification failed. Check connection.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNoShow = () => {
    if (elapsedSeconds <= 300) {
      alert('Cannot report no-show during initial 5-minute wait.');
      return;
    }
    if (confirm('Report rider no-show? Trip will be cancelled.')) {
      logAudit('TRIP_CANCELLED_BY_DRIVER', { orderId, reason: 'RIDER_NO_SHOW' });
      setActiveTrip(null);
      setDutyState('ONLINE');
    }
  };

  const freeMin = Math.floor(freeWaitSeconds / 60);
  const freeSec = (freeWaitSeconds % 60).toString().padStart(2, '0');
  const isChargingWait = elapsedSeconds > 300;

  return (
    <div className="space-y-4 text-left animate-enter">

      {/* ── Arrived status banner ── */}
      <div role="status" aria-live="polite" className="flex items-center gap-3 bg-surface-positive border border-positive-200 rounded-sm px-4 py-3">
        <span className="text-content-positive text-heading-medium">✓</span>
        <div>
          <p className="text-label-medium text-content-positive">You&apos;ve arrived at pickup</p>
          <p className="text-paragraph-small text-content-positive opacity-80">{activeTrip.customer_name}</p>
        </div>
      </div>

      {/* ── Wait timer ── */}
      <div className={`rounded-md p-4 ${isChargingWait ? 'bg-surface-warning' : 'bg-background-secondary border border-border-opaque'}`}>
        <div className="flex items-center gap-3">
          {isChargingWait ? (
            <>
              <span className="text-xl animate-pulse">🚨</span>
              <div>
                <span className="text-label-small text-content-warning block">Waiting charge active</span>
                <span className="font-mono text-mono-large text-content-warning tabular-nums">
                  <FareDisplay amount={waitingCharges * 100} size="md" className="text-content-warning" /> at ₹2/min
                </span>
              </div>
            </>
          ) : (
            <>
              <span className="text-xl">⏳</span>
              <div>
                <span className="text-label-small text-content-secondary block">Free wait remaining</span>
                <span className="font-mono text-mono-large text-content-primary tabular-nums">
                  {freeMin}:{freeSec}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Verification form ── */}
      <form onSubmit={handleVerify} className="space-y-4">

        {/* Error banners */}
        {(otpError || validationError) && (
          <div className="bg-surface-negative border border-negative-200 rounded-sm p-3">
            <p className="text-label-medium text-content-negative">
              ❌ {otpError || validationError}
            </p>
          </div>
        )}

        {/* Odometer + Fuel */}
        <div className="card space-y-4">
          <h4 className="text-heading-small text-content-primary">Start odometer</h4>

          <div>
            <label className="text-label-small text-content-secondary block mb-1">
              KM reading (min: {minOdometer})
            </label>
            <input
              type="number"
              value={startOdometer}
              onChange={(e) => setStartOdometer(e.target.value)}
              placeholder={`Min ${minOdometer}`}
              className="w-full h-12 rounded-sm border border-border-opaque bg-background-secondary
                font-mono text-display-small text-content-primary text-center
                focus:border-border-accent focus:ring-2 focus:ring-accent-400 outline-none
                transition-base placeholder:text-content-tertiary"
              required
            />
          </div>

          <div className="relative">
            <FuelSlider value={startFuel} onChange={setStartFuel} />
          </div>

          <button
            type="button"
            onClick={() => {
              setStartOdoPhoto(`s3://odometer-captures/start-${Date.now()}.png`);
              logAudit('ODOMETER_PHOTO_UPLOADED', { stage: 'START' });
            }}
            className="w-full h-11 rounded-sm border border-border-opaque bg-background-secondary
              text-label-medium text-content-secondary
              cursor-pointer hover:bg-background-tertiary transition-base
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
          >
            {startOdoPhoto ? '✔ Photo captured' : '📷 Take dashboard photo'}
          </button>
        </div>

        {/* OTP entry */}
        <div className="card space-y-4">
          <div>
            <h4 className="text-heading-small text-content-primary mb-1">Enter rider OTP</h4>
            <p className="text-paragraph-small text-content-secondary">
              4-digit code shown in the rider app
            </p>
          </div>
          <OtpInput value={otpVerificationCode} onChange={setOtpVerificationCode} />
        </div>

        {/* Verify CTA */}
        <button
          type="submit"
          disabled={otpVerificationCode.replace(/\s/g, '').length !== 4 || isSubmitting || failedAttempts >= 3}
          className="w-full h-14 rounded-sm bg-interactive-primary text-interactive-primary-text
            text-label-large font-medium cursor-pointer transition-base
            disabled:opacity-40 disabled:cursor-not-allowed
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          {failedAttempts >= 3
            ? 'OTP Locked'
            : isSubmitting
            ? 'Verifying…'
            : 'Verify & Start Trip'}
        </button>

        {/* No-show */}
        <button
          type="button"
          disabled={elapsedSeconds <= 300}
          onClick={handleNoShow}
          className="w-full text-center text-label-medium text-content-negative py-3 min-h-[44px]
            cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed
            hover:opacity-80 transition-base
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative-400"
        >
          Report No-Show{elapsedSeconds <= 300 ? ` (${freeMin}:${freeSec} remaining)` : ''}
        </button>
      </form>
    </div>
  );
};
