"use client";

import { Capacitor } from "@capacitor/core";

export interface LatLng {
  lat: number;
  lng: number;
}

const FALLBACK_DELAY_MS = 500;

function googleMapsWebUrl(destination: LatLng): string {
  const params = new URLSearchParams({
    api: "1",
    destination: `${destination.lat},${destination.lng}`,
    travelmode: "driving",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function openWithFallback(nativeUrl: string, fallbackUrl: string): void {
  let didHide = false;
  const markHidden = () => {
    didHide = true;
  };
  document.addEventListener("visibilitychange", markHidden, { once: true });
  window.location.href = nativeUrl;
  window.setTimeout(() => {
    document.removeEventListener("visibilitychange", markHidden);
    if (!didHide && document.visibilityState === "visible") {
      window.open(fallbackUrl, "_blank", "noopener,noreferrer");
    }
  }, FALLBACK_DELAY_MS);
}

export function openGoogleMapsNavigation(destination: LatLng): void {
  if (typeof window === "undefined") return;

  const fallbackUrl = googleMapsWebUrl(destination);
  const platform = Capacitor.getPlatform();

  if (platform === "android") {
    openWithFallback(`google.navigation:q=${destination.lat},${destination.lng}&mode=d`, fallbackUrl);
    return;
  }

  if (platform === "ios") {
    openWithFallback(
      `comgooglemaps://?daddr=${destination.lat},${destination.lng}&directionsmode=driving`,
      fallbackUrl,
    );
    return;
  }

  window.open(fallbackUrl, "_blank", "noopener,noreferrer");
}

