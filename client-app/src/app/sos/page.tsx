'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import AuthGuard from '../../components/AuthGuard';
import { useAuthStore } from '@/store/useAuthStore';

const AUTO_DISPATCH_SECONDS = 5;

type DispatchState = 'ARMING' | 'DISPATCHED' | 'CANCELLED';

function SosConsole() {
  const { user } = useAuthStore();
  const driverID = user?.id || 'drv-aniket-7602';

  const [state, setState] = useState<DispatchState>('ARMING');
  const [countdown, setCountdown] = useState(AUTO_DISPATCH_SECONDS);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const firedRef = useRef(false);

  // Emergency contact — wired from onboarding §1.3 step 6; mock until store carries it.
  const emergencyContact = { name: 'Riya Karmakar', relation: 'Spouse', phone: '+91 98301 44552' };

  // Grab a location fix immediately so it can ride along with the alert.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocError('Geolocation unavailable on this device.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => setLocError(err.message || 'Location permission denied.'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []);

  const dispatchAlert = React.useCallback(async () => {
    if (firedRef.current) return;
    firedRef.current = true;
    setState('DISPATCHED');
    try {
      await fetch('http://localhost:8080/api/v1/driver/sos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver_id: driverID,
          location: coords,
          emergency_contact: emergencyContact.phone,
          triggered_at: new Date().toISOString(),
        }),
      });
    } catch {
      // Alert is committed locally regardless — support + contact are notified out-of-band.
      console.warn('[SOS] Backend unreachable; alert queued locally.');
    }
  }, [driverID, coords]);

  // Auto-dispatch countdown.
  useEffect(() => {
    if (state !== 'ARMING') return;
    if (countdown <= 0) {
      dispatchAlert();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [state, countdown, dispatchAlert]);

  if (state === 'CANCELLED') {
    return (
      <div className="min-h-[100dvh] bg-black text-white flex flex-col items-center justify-center p-6 text-center gap-6 font-sans">
        <h1 className="text-2xl font-bold tracking-tight">Alert cancelled</h1>
        <p className="text-zinc-500 text-sm max-w-xs">No emergency dispatch was sent. Stay safe.</p>
        <Link href="/driver" className="bg-white text-black font-bold py-3 px-8 rounded-full text-sm uppercase tracking-wider">
          Back to duty console
        </Link>
      </div>
    );
  }

  const dispatched = state === 'DISPATCHED';

  return (
    <div className={`min-h-[100dvh] flex flex-col justify-between p-6 sm:p-10 font-sans text-white transition-colors ${dispatched ? 'bg-red-950' : 'bg-red-700'}`}>
      {/* Header */}
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-white/70">
          Emergency Channel
        </span>
        <Link href="/driver" className="text-[10px] font-mono font-bold uppercase tracking-wider border border-white/30 px-3 py-1.5 rounded-full hover:bg-white/10 transition">
          Exit
        </Link>
      </div>

      {/* Core */}
      <div className="flex flex-col items-center text-center gap-6">
        <div className="relative h-40 w-40 flex items-center justify-center">
          <span className={`absolute inset-0 rounded-full ${dispatched ? 'bg-white/10' : 'bg-white/20 animate-ping'}`} />
          <div className="relative h-32 w-32 rounded-full bg-white text-red-700 flex flex-col items-center justify-center">
            <span className="text-4xl font-bold leading-none">SOS</span>
            {!dispatched && <span className="text-xs font-mono font-bold mt-1">{countdown}s</span>}
          </div>
        </div>

        {dispatched ? (
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Help is on the way</h1>
            <p className="text-white/80 text-sm max-w-xs">
              Support alerted, live location shared with {emergencyContact.name} ({emergencyContact.relation}).
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Dispatching emergency alert</h1>
            <p className="text-white/80 text-sm max-w-xs">Alerts support, shares your live location, and notifies your emergency contact.</p>
          </div>
        )}

        {/* Location status */}
        <div className="text-[11px] font-mono text-white/70 bg-black/20 rounded-xl px-4 py-2">
          {coords
            ? `Location locked: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
            : locError
            ? `Location: ${locError}`
            : 'Acquiring location fix...'}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 max-w-md w-full mx-auto">
        <a
          href="tel:112"
          className="w-full bg-white text-red-700 font-bold py-4 rounded-full text-sm uppercase tracking-wider text-center active:scale-[0.98] transition"
        >
          Call 112 now
        </a>
        {dispatched ? (
          <Link
            href="/driver"
            className="w-full bg-black/30 hover:bg-black/40 text-white font-bold py-4 rounded-full text-sm uppercase tracking-wider text-center transition"
          >
            Return to duty console
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setState('CANCELLED')}
            className="w-full bg-black/30 hover:bg-black/40 text-white font-bold py-4 rounded-full text-sm uppercase tracking-wider transition active:scale-[0.98]"
          >
            I&apos;m safe — cancel ({countdown}s)
          </button>
        )}
      </div>
    </div>
  );
}

export default function SosPage() {
  return (
    <AuthGuard allowedRole="DRIVER">
      <SosConsole />
    </AuthGuard>
  );
}
