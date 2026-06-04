'use client';

import React, { useEffect, useRef, useState } from 'react';
import { getPricingQuote, PendingOfferOrder } from '@/api/client';
import { useAuthStore } from '@/store/useAuthStore';

export type OrderOffer = PendingOfferOrder;

interface OfferPopupProps {
  offer: OrderOffer;
  onAccept: () => void;
  onDecline: (reason?: string) => void;
  timeoutSeconds: number;
}

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[key]) {
    return process.env[key];
  }
  return undefined;
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const apiKey = readEnv('VITE_GOOGLE_MAPS_API_KEY') || readEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY');
  if (!apiKey) {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('latlng', `${lat},${lng}`);
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString());
  if (!response.ok) {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }

  const payload = await response.json() as {
    results?: Array<{ formatted_address?: string }>;
  };
  return payload.results?.[0]?.formatted_address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function formatRupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export function OfferPopup({ offer, onAccept, onDecline, timeoutSeconds }: OfferPopupProps) {
  const { token } = useAuthStore();
  const [remaining, setRemaining] = useState(Math.max(0, timeoutSeconds));
  const [pickupAddress, setPickupAddress] = useState('Resolving pickup...');
  const [dropoffAddress, setDropoffAddress] = useState('Resolving dropoff...');
  const [farePaise, setFarePaise] = useState(
    Math.round(offer.base_fare_paise * offer.surge_multiplier),
  );
  const expiredRef = useRef(false);

  useEffect(() => {
    setRemaining(Math.max(0, timeoutSeconds));
    expiredRef.current = false;
  }, [offer.id, timeoutSeconds]);

  useEffect(() => {
    let cancelled = false;

    reverseGeocode(offer.pickup_lat, offer.pickup_lng)
      .then((address) => {
        if (!cancelled) setPickupAddress(address);
      })
      .catch(() => setPickupAddress(`${offer.pickup_lat.toFixed(5)}, ${offer.pickup_lng.toFixed(5)}`));

    reverseGeocode(offer.dropoff_lat, offer.dropoff_lng)
      .then((address) => {
        if (!cancelled) setDropoffAddress(address);
      })
      .catch(() => setDropoffAddress(`${offer.dropoff_lat.toFixed(5)}, ${offer.dropoff_lng.toFixed(5)}`));

    if (token && offer.pickup_h3_cell) {
      getPricingQuote(token, offer.pickup_h3_cell, offer.base_fare_paise)
        .then((quote) => {
          if (!cancelled) setFarePaise(quote.calculated_fare_paise);
        })
        .catch((err) => console.warn('[OfferPopup] Pricing quote failed:', err));
    }

    return () => {
      cancelled = true;
    };
  }, [offer, token]);

  useEffect(() => {
    if (remaining <= 0) {
      if (!expiredRef.current) {
        expiredRef.current = true;
        onDecline('timeout');
      }
      return;
    }

    const timer = window.setTimeout(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [onDecline, remaining]);

  const progress = timeoutSeconds <= 0 ? 0 : Math.max(0, remaining / timeoutSeconds);
  const ringStyle = {
    background: `conic-gradient(#ffffff ${progress * 360}deg, #27272a 0deg)`,
  };

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-white shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            New ride offer
          </p>
          <h3 className="mt-1 text-lg font-bold">Rider</h3>
          <p className="font-mono text-[10px] text-zinc-500">Rating unavailable for MVP</p>
        </div>
        <div
          className="grid h-14 w-14 place-items-center rounded-full p-1"
          style={ringStyle}
          aria-label={`${remaining} seconds remaining`}
        >
          <div className="grid h-full w-full place-items-center rounded-full bg-zinc-950 font-mono text-sm font-bold">
            {remaining}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3 text-sm">
        <div>
          <p className="font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-600">Pickup</p>
          <p className="text-zinc-200">{pickupAddress}</p>
        </div>
        <div>
          <p className="font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-600">Drop</p>
          <p className="text-zinc-200">{dropoffAddress}</p>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between border-t border-zinc-900 pt-4">
        <div>
          <p className="font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-600">Estimated fare</p>
          <p className="text-2xl font-bold">{formatRupees(farePaise)}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onDecline('driver_declined')}
            className="rounded-xl border border-zinc-800 px-4 py-2 font-mono text-[10px] font-bold uppercase text-zinc-300"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="rounded-xl bg-white px-4 py-2 font-mono text-[10px] font-bold uppercase text-black"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
