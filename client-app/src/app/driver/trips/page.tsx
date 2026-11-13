'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '../../../components/AuthGuard';
import { TabBarRedesign } from '@/components/TabBarRedesign';
import TripHistoryList from '../../driver-account/trip-history/page';
import { ClockIcon, FareDisplay } from '@/components/ds';
import {
  getUpcomingTrips,
  UpcomingTrip,
  getScheduledOffers,
  acceptScheduledOffer,
  declineScheduledOffer,
  respondToOffer,
  ScheduledOffer,
} from '@/api/client';
import { useAuthStore } from '@/store/useAuthStore';
import { useToastStore } from '@/store/useToastStore';
import { friendlyError } from '@/lib/ui/errorMessage';

type TripsTab = 'UPCOMING' | 'HISTORY';

// Matches the backend dispatch lead (SCHEDULED_DISPATCH_LEAD_MINUTES, default
// 40): a committed trip becomes startable once inside this window.
const START_WINDOW_MS = 40 * 60 * 1000;

function whenLabel(iso: string) {
  const when = new Date(iso);
  return (
    <>
      {when.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
      {' · '}
      <span className="font-mono tabular-nums">
        {when.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
      </span>
    </>
  );
}

// ── Advance-commitment offers: scheduled orders open for early accept ─────────
function ScheduledOffersList({ onCommitted }: { onCommitted: () => void }) {
  const { token } = useAuthStore();
  const [offers, setOffers] = useState<ScheduledOffer[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    getScheduledOffers(token)
      .then((res) => setOffers(res.offers ?? []))
      .catch(() => setOffers([]));
  }, [token]);

  useEffect(load, [load]);

  const act = async (id: string, action: 'accept' | 'decline') => {
    if (!token || busyId) return;
    setBusyId(id);
    try {
      if (action === 'accept') {
        await acceptScheduledOffer(token, id);
        useToastStore.getState().show('Booking committed — it is now in your Upcoming list.', 'success');
        onCommitted();
      } else {
        await declineScheduledOffer(token, id);
      }
      setOffers((prev) => (prev ?? []).filter((o) => o.id !== id));
    } catch (err) {
      useToastStore.getState().show(friendlyError(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (!offers || offers.length === 0) return null;

  return (
    <section className="space-y-2.5">
      <h2 className="text-label-large text-content-secondary">Available scheduled bookings</h2>
      {offers.map((o) => (
        <div key={o.id} className="card space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-label-large">{whenLabel(o.scheduled_at)}</p>
              <p className="text-paragraph-small text-content-secondary mt-0.5">
                {o.trip_type.replaceAll('_', ' ')} · pickup {o.pickup_lat.toFixed(4)}, {o.pickup_lng.toFixed(4)}
              </p>
            </div>
            <FareDisplay amount={o.base_fare_paise} size="md" />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busyId === o.id}
              onClick={() => act(o.id, 'accept')}
              className="flex-1 h-10 rounded-sm bg-interactive-primary text-interactive-primary-text text-label-medium font-semibold transition-base cursor-pointer disabled:opacity-50"
            >
              Commit to trip
            </button>
            <button
              type="button"
              disabled={busyId === o.id}
              onClick={() => act(o.id, 'decline')}
              className="flex-1 h-10 rounded-sm border border-border-opaque text-content-secondary text-label-medium transition-base cursor-pointer hover:text-content-primary disabled:opacity-50"
            >
              Not interested
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

// ── Committed / assigned upcoming trips ───────────────────────────────────────
function UpcomingList({ reloadKey }: { reloadKey: number }) {
  const { token } = useAuthStore();
  const router = useRouter();
  const [trips, setTrips] = useState<UpcomingTrip[] | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  // Clock anchor for the start-window check — set in an effect, not during render.
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (trips?.length) setNow(Date.now());
  }, [trips]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getUpcomingTrips(token)
      .then((res) => {
        if (!cancelled) setTrips(res.trips ?? []);
      })
      .catch(() => {
        if (!cancelled) setTrips([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, reloadKey]);

  // Inside the start window the committed ASSIGNED trip can begin: the existing
  // offer-response ACCEPTED transition moves it to EN_ROUTE_TO_PICKUP.
  const startTrip = async (id: string) => {
    if (!token || startingId) return;
    setStartingId(id);
    try {
      await respondToOffer(token, id, 'ACCEPTED');
      router.push('/driver');
    } catch (err) {
      useToastStore.getState().show(friendlyError(err), 'error');
      setStartingId(null);
    }
  };

  if (trips === null) {
    return <div className="skeleton h-24 w-full" aria-label="Loading upcoming trips" />;
  }

  if (trips.length === 0) {
    return (
      /* Empty state teaches the feature — no fabricated rows. */
      <div className="card text-center py-10 space-y-3">
        <span className="mx-auto h-12 w-12 rounded-pill bg-accent-50 text-content-accent flex items-center justify-center">
          <ClockIcon size={24} />
        </span>
        <h2 className="text-heading-small">No scheduled bookings</h2>
        <p className="text-paragraph-small text-content-secondary max-w-xs mx-auto">
          Riders can book drivers in advance. Commit to an available scheduled
          booking above, or wait — offers also arrive shortly before start time.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {trips.map((t) => {
        const startable =
          t.status === 'ASSIGNED' && new Date(t.scheduled_at).getTime() - now <= START_WINDOW_MS;
        return (
          <div key={t.id} className="card space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-label-large">{whenLabel(t.scheduled_at)}</p>
                <p className="text-paragraph-small text-content-secondary mt-0.5">
                  {t.trip_type.replaceAll('_', ' ')} · pickup {t.pickup_lat.toFixed(4)}, {t.pickup_lng.toFixed(4)}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <FareDisplay amount={t.base_fare_paise} size="md" />
                <span className="badge badge-accent mt-1">{t.status.replaceAll('_', ' ')}</span>
              </div>
            </div>
            {startable && (
              <button
                type="button"
                disabled={startingId === t.id}
                onClick={() => startTrip(t.id)}
                className="w-full h-10 rounded-sm bg-interactive-primary text-interactive-primary-text text-label-medium font-semibold transition-base cursor-pointer disabled:opacity-50"
              >
                {startingId === t.id ? 'Starting…' : 'Start trip — head to pickup'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TripsContent() {
  const [tab, setTab] = useState<TripsTab>('UPCOMING');
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="min-h-screen bg-background-primary text-content-primary font-sans">
      <div className="max-w-2xl mx-auto p-4 sm:p-6 pb-24 space-y-5">
        <header>
          <h1 className="text-display-serif text-[28px]">Trips</h1>
        </header>

        {/* Tab switch */}
        <div className="flex bg-background-secondary p-1 rounded-sm border border-border-opaque">
          {(['UPCOMING', 'HISTORY'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 h-10 rounded-sm text-label-medium transition-base cursor-pointer ${
                tab === t
                  ? 'bg-interactive-primary text-interactive-primary-text font-semibold'
                  : 'text-content-secondary hover:text-content-primary'
              }`}
            >
              {t === 'UPCOMING' ? 'Upcoming' : 'History'}
            </button>
          ))}
        </div>

        {tab === 'UPCOMING' ? (
          <>
            <ScheduledOffersList onCommitted={() => setReloadKey((k) => k + 1)} />
            <UpcomingList reloadKey={reloadKey} />
          </>
        ) : (
          <TripHistoryList />
        )}
      </div>
      <TabBarRedesign />
    </div>
  );
}

export default function DriverTripsPage() {
  return (
    <AuthGuard allowedRole="DRIVER">
      <TripsContent />
    </AuthGuard>
  );
}
