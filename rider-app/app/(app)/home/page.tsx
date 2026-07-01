"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { BookingSheet } from "@/components/booking/BookingSheet";
import { SentryErrorBoundary } from "@/components/SentryErrorBoundary";
import { useBookingStore } from "@/lib/store/bookingStore";
import { useNotificationStore } from "@/lib/store/notificationStore";
import { useTripStore } from "@/lib/store/tripStore";
import { nearbyApi, type NearbyDriver } from "@/lib/api/nearby";
import { cityConfigApi } from "@/lib/api/cityConfig";
import { BlurFade } from "@/components/ui/blur-fade";
import { ScrollVelocityRow } from "@/components/ui/scroll-based-velocity";

// Leaflet must be lazily loaded — no SSR
const RiderMap = dynamic(() => import("@/components/map/RiderMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-background-secondary" />,
});

// Fallback only — replaced by city config on load
const DEFAULT_CENTER = { lat: 22.5726, lng: 88.3639 };

export default function HomePage() {
  const [userLocation, setUserLocation]  = useState<{ lat: number; lng: number } | null>(null);
  const [nearbyDrivers, setNearbyDrivers] = useState<NearbyDriver[]>([]);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>(DEFAULT_CENTER);
  const [geoError, setGeoError] = useState(false);
  const setPickup = useBookingStore((s) => s.setPickup);

  // Hydrate the bell unread badge and the SOS shortcut's active-order gate.
  useEffect(() => {
    useNotificationStore.getState().fetchNotifications().catch(() => {});
    useTripStore.getState().hydrateActiveOrder();
  }, []);

  useEffect(() => {
    cityConfigApi
      .get()
      .then((config) => {
        if (typeof config.center_lat === "number" && typeof config.center_lng === "number") {
          setMapCenter({ lat: config.center_lat, lng: config.center_lng });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    const loadNearby = (lat: number, lng: number) => {
      nearbyApi
        .list(lat, lng)
        .then((res) => setNearbyDrivers(res.drivers ?? []))
        .catch(() => setNearbyDrivers([]));
    };

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        setMapCenter(loc);
        setPickup({ ...loc, address: "Current location" });
        loadNearby(loc.lat, loc.lng);
      },
      () => {
        setGeoError(true);
        setMapCenter(DEFAULT_CENTER);
        setPickup({ ...DEFAULT_CENTER, address: "Kolkata, West Bengal" });
        loadNearby(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRecenter = useCallback(() => {
    if (userLocation) setMapCenter({ ...userLocation });
  }, [userLocation]);

  return (
    <BlurFade duration={0.5} className="relative h-[100dvh] w-full overflow-hidden bg-background-secondary" style={{ paddingBottom: 'env(safe-area-inset-bottom)' } as React.CSSProperties}>
      {/* Map — full screen behind everything */}
      <div className="absolute inset-0 z-0">
        <RiderMap
          center={mapCenter}
          nearbyDrivers={nearbyDrivers}
          onRecenter={handleRecenter}
        />
      </div>

      {/* Top bar — floats above map; sets --topbar-offset for sibling elements */}
      <div className="absolute inset-x-0 top-0 z-20" style={{ '--topbar-offset': '64px' } as React.CSSProperties}>
        <TopBar />
      </div>

      {/* Marquee tagline — positioned below TopBar via CSS variable */}
      <div className="absolute inset-x-0 z-10" style={{ top: 'var(--topbar-offset)' }}>
        <ScrollVelocityRow baseVelocity={0.8} className="text-[10px] text-content-tertiary/30 tracking-[0.2em] uppercase">
          Driver on demand · Safe rides · 24/7 support · Cashless payments ·
        </ScrollVelocityRow>
      </div>

      {/* Geolocation-denied banner */}
      {geoError && (
        <div className="absolute left-1/2 z-10 mt-2 -translate-x-1/2" style={{ top: 'calc(var(--topbar-offset) + 8px)' }}>
          <div className="rounded-full bg-surface-negative/90 px-4 py-1.5 text-xs font-medium text-content-negative backdrop-blur-sm">
            Location unavailable — showing default area
          </div>
        </div>
      )}

      {/* Booking bottom sheet — floats above map */}
      <SentryErrorBoundary name="rider-booking">
        <BookingSheet />
      </SentryErrorBoundary>
    </BlurFade>
  );
}
