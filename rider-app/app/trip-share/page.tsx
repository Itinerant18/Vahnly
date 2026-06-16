"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ordersApi } from "@/lib/api/orders";

// Public (no-auth) live trip tracking page. Lives outside the (app) route group
// so it has no auth guard — anyone with the share link can view it. The token is
// a query param (?token=) rather than a path segment because the app is built with
// `output: export`, which can't statically render unknown dynamic path segments.

const POLL_MS = 10_000;

interface TripShareData {
  status: string;
  driver_name?: string;
  driver_location?: { lat: number; lng: number };
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  eta_minutes: number;
}

const STATUS_LABELS: Record<string, string> = {
  ASSIGNED: "Driver assigned",
  EN_ROUTE_TO_PICKUP: "Driver on the way",
  ARRIVED_AT_PICKUP: "Driver arrived",
  IN_PROGRESS: "Trip in progress",
  DELIVERING: "Trip in progress",
  COMPLETED: "Trip completed",
  CANCELLED: "Trip cancelled",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ").toLowerCase();
}

function TripShareView() {
  const token = useSearchParams().get("token") ?? "";

  const [data, setData] = useState<TripShareData | null>(null);
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setExpired(true);
      setLoading(false);
      return;
    }
    let active = true;

    const fetchOnce = async () => {
      try {
        const res = await ordersApi.tripShare(token);
        if (!active) return;
        setData(res);
        setExpired(false);
      } catch {
        // 404 / 410 / network — treat as no-longer-active. The link is public,
        // so there is nothing to retry on auth grounds.
        if (!active) return;
        setExpired(true);
      } finally {
        if (active) setLoading(false);
      }
    };

    void fetchOnce();
    const id = window.setInterval(fetchOnce, POLL_MS);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [token]);

  return (
    <div className="flex min-h-screen flex-col bg-background-primary px-4 pb-10 pt-12">
      <div className="mx-auto w-full max-w-md">
        {/* Header */}
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-content-accent">Vahnly</p>
          <h1 className="mt-1 text-2xl font-bold text-content-primary">Live trip</h1>
          <p className="mt-1 text-sm text-content-secondary">
            You&apos;re tracking a shared trip in real time.
          </p>
        </div>

        {loading ? (
          <div className="space-y-3">
            <div className="h-24 animate-pulse rounded-2xl bg-background-secondary" />
            <div className="h-32 animate-pulse rounded-2xl bg-background-secondary" />
          </div>
        ) : expired || !data ? (
          <div className="rounded-2xl bg-background-secondary p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-background-tertiary text-2xl">
              🔗
            </div>
            <h2 className="text-base font-bold text-content-primary">This trip link is no longer active</h2>
            <p className="mt-1.5 text-sm text-content-secondary">
              The trip may have ended or the link has expired. Ask the rider to share a fresh link.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Status + driver */}
            <div className="rounded-2xl bg-background-secondary p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-content-secondary">Status</p>
                  <p className="mt-0.5 text-base font-semibold text-content-primary">
                    {statusLabel(data.status)}
                  </p>
                </div>
                <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive-400 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-positive-400" />
                </span>
              </div>
              {data.driver_name && (
                <div className="mt-3 flex items-center gap-3 border-t border-border-opaque pt-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-accent text-sm font-bold text-content-accent">
                    {data.driver_name.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-content-primary">{data.driver_name}</p>
                    <p className="text-xs text-content-secondary">Your driver</p>
                  </div>
                </div>
              )}
            </div>

            {/* ETA */}
            <div className="rounded-2xl bg-background-secondary p-4">
              <p className="text-xs text-content-secondary">Estimated arrival</p>
              <p className="mt-1 font-mono text-2xl font-bold text-content-primary">
                {data.eta_minutes} min
              </p>
            </div>

            {/* Route */}
            <div className="rounded-2xl bg-background-secondary px-4 py-3">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-content-secondary">Route</p>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-positive-400">
                    <div className="h-1.5 w-1.5 rounded-full bg-white" />
                  </div>
                  <div>
                    <p className="text-sm text-content-primary">Pickup</p>
                    <p className="font-mono text-xs text-content-secondary">
                      {data.pickup_lat.toFixed(4)}, {data.pickup_lng.toFixed(4)}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-negative-400">
                    <div className="h-1.5 w-1.5 rounded-full bg-white" />
                  </div>
                  <div>
                    <p className="text-sm text-content-primary">Drop-off</p>
                    <p className="font-mono text-xs text-content-secondary">
                      {data.dropoff_lat.toFixed(4)}, {data.dropoff_lng.toFixed(4)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Driver location */}
            {data.driver_location && (
              <div className="rounded-2xl bg-background-secondary px-4 py-3">
                <p className="text-xs text-content-secondary">Driver location</p>
                <p className="mt-0.5 font-mono text-sm text-content-primary">
                  {data.driver_location.lat.toFixed(4)}, {data.driver_location.lng.toFixed(4)}
                </p>
              </div>
            )}

            <p className="pt-2 text-center text-xs text-content-tertiary">
              Updates automatically every 10 seconds.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TripSharePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background-primary" />}>
      <TripShareView />
    </Suspense>
  );
}
