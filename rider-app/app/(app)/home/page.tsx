"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { BookingSheet } from "@/components/booking/BookingSheet";
import { SentryErrorBoundary } from "@/components/SentryErrorBoundary";
import { useBookingStore } from "@/lib/store/bookingStore";

// Leaflet must be lazily loaded — no SSR
const RiderMap = dynamic(() => import("@/components/map/RiderMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-background-secondary" />,
});

interface NearbyDriver {
  id: string;
  lat: number;
  lng: number;
}

export default function HomePage() {
  const [userLocation, setUserLocation]  = useState<{ lat: number; lng: number } | null>(null);
  const [nearbyDrivers] = useState<NearbyDriver[]>([
    { id: "d1", lat: 22.575, lng: 88.367 },
    { id: "d2", lat: 22.570, lng: 88.360 },
    { id: "d3", lat: 22.578, lng: 88.371 },
  ]);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>({ lat: 22.5726, lng: 88.3639 });
  const setPickup = useBookingStore((s) => s.setPickup);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        setMapCenter(loc);
        setPickup({ ...loc, address: "Current location" });
      },
      () => {
        const fallback = { lat: 22.5726, lng: 88.3639 };
        setMapCenter(fallback);
        setPickup({ ...fallback, address: "Kolkata, West Bengal" });
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRecenter = useCallback(() => {
    if (userLocation) setMapCenter({ ...userLocation });
  }, [userLocation]);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-background-secondary">
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
