'use client';

// ponytail: dev-only GPS spoof. Gated on NODE_ENV so it tree-shakes out of prod builds.
// Patches navigator.geolocation once; the live telemetry stream (watchPosition) then feeds
// whatever preset is selected. "Real GPS" falls back to the device. No prod code path.

import { useEffect, useState } from 'react';

type Preset = { name: string; lat: number; lng: number };

const PRESETS: Preset[] = [
  { name: 'Kolkata (pickup)', lat: 22.5726, lng: 88.3639 },
  { name: 'Howrah Station', lat: 22.5839, lng: 88.3433 },
  { name: 'Kolkata Airport', lat: 22.6531, lng: 88.4467 },
];

// Module-scoped mock the patched geolocation reads each tick. null = use real device GPS.
let mock: Preset | null = null;

function makePosition(p: Preset): GeolocationPosition {
  return {
    coords: {
      latitude: p.lat,
      longitude: p.lng,
      accuracy: 10,
      altitude: null,
      altitudeAccuracy: null,
      heading: 0,
      speed: 0,
      toJSON() { return this; },
    },
    timestamp: Date.now(),
    toJSON() { return this; },
  } as GeolocationPosition;
}

function installPatch() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return;
  const original = navigator.geolocation;
  if ((original as unknown as { __spoofed?: boolean }).__spoofed) return;

  const patched = {
    __spoofed: true,
    getCurrentPosition(
      success: PositionCallback,
      error?: PositionErrorCallback | null,
      opts?: PositionOptions,
    ) {
      if (mock) { success(makePosition(mock)); return; }
      original.getCurrentPosition(success, error, opts);
    },
    // Self-polls every 2s: emit the mock when set, else poll the real device. One
    // registration handles any preset/go-online ordering since each tick re-checks `mock`.
    watchPosition(
      success: PositionCallback,
      error?: PositionErrorCallback | null,
      opts?: PositionOptions,
    ) {
      const tick = () => {
        if (mock) success(makePosition(mock));
        else original.getCurrentPosition(success, error, opts);
      };
      tick();
      return window.setInterval(tick, 2000) as unknown as number;
    },
    clearWatch(id: number) { clearInterval(id); },
  } as unknown as Geolocation;

  Object.defineProperty(navigator, 'geolocation', { value: patched, configurable: true });
}

export function DevLocationSpoof() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => { installPatch(); }, []);

  if (process.env.NODE_ENV !== 'development') return null;

  const pick = (p: Preset | null) => {
    mock = p;
    setActive(p?.name ?? null);
  };

  return (
    <div className="fixed bottom-2 left-2 z-[100003] bg-black/85 border border-yellow-500 rounded-md p-2 font-mono text-[10px] text-yellow-300 space-y-1 max-w-[180px]">
      <div className="uppercase tracking-wider opacity-70">dev · spoof GPS</div>
      {PRESETS.map((p) => (
        <button
          key={p.name}
          onClick={() => pick(p)}
          className={`block w-full text-left px-2 py-1 rounded-sm border ${
            active === p.name ? 'bg-yellow-500 text-black border-yellow-500' : 'border-yellow-700 hover:bg-yellow-900/40'
          }`}
        >
          {p.name}
        </button>
      ))}
      <button
        onClick={() => pick(null)}
        className={`block w-full text-left px-2 py-1 rounded-sm border ${
          active === null ? 'bg-yellow-500 text-black border-yellow-500' : 'border-yellow-700 hover:bg-yellow-900/40'
        }`}
      >
        Real GPS
      </button>
    </div>
  );
}
