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

// Leaflet must be lazily loaded — no SSR
const RiderMap = dynamic(() => import("@/components/map/RiderMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-background-secondary" />,
});

export default function HomePage() {
  const [userLocation, setUserLocation]  = useState<{ lat: number; lng: number } | null>(null);
  const [nearbyDrivers, setNearbyDrivers] = useState<NearbyDriver[]>([]);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>({ lat: 22.5726, lng: 88.3639 });
  const setPickup = useBookingStore((s) => s.setPickup);

  // Hydrate the bell unread badge and the SOS shortcut's active-order gate.
  useEffect(() => {
    useNotificationStore.getState().fetchNotifications().catch(() => {});
    useTripStore.getState().hydrateActiveOrder();
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
        const fallback = { lat: 22.5726, lng: 88.3639 };
        setMapCenter(fallback);
        setPickup({ ...fallback, address: "Kolkata, West Bengal" });
        loadNearby(fallback.lat, fallback.lng);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRecenter = useCallback(() => {
    if (userLocation) setMapCenter({ ...userLocation });
  }, [userLocation]);

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-background-secondary">
      {/* Map — full screen behind everything */}
      <div className="absolute inset-0 z-0">
        <RiderMap
          center={mapCenter}
          nearbyDrivers={nearbyDrivers}
          onRecenter={handleRecenter}
        />
      </div>

      {/* Top bar — floats above map */}
      <div className="absolute inset-x-0 top-0 z-20">
        <TopBar />
      </div>

      {/* Booking bottom sheet — floats above map */}
      <SentryErrorBoundary name="rider-booking">
        <BookingSheet />
      </SentryErrorBoundary>
    </div>
  );
}
