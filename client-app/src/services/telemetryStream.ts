import { updateDriverLocation } from '@/api/client';

export interface TelemetryStreamOptions {
  token: string;
  driverId: string;
  cityPrefix: string;
}

export function startTelemetryStream(options: TelemetryStreamOptions): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    console.error('[TELEMETRY_STREAM] Browser geolocation is unavailable.');
    return () => {};
  }

  let isVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden';

  const sendPosition = (lat: number, lng: number, bearing: number, speedKms: number) => {
    if (!isVisible) return;

    void updateDriverLocation(
      options.token,
      options.driverId,
      options.cityPrefix,
      lat,
      lng,
      bearing,
      speedKms,
    ).catch((err) => {
      console.error('[TELEMETRY_STREAM] Location update failed:', err);
    });
  };

  const handleVisibilityChange = () => {
    isVisible = document.visibilityState !== 'hidden';
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      sendPosition(
        pos.coords.latitude,
        pos.coords.longitude,
        pos.coords.heading || 0,
        (pos.coords.speed || 0) * 3.6,
      );
    },
    (err) => console.error('[TELEMETRY_STREAM] GPS error:', err),
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 5000 },
  );

  return () => {
    navigator.geolocation.clearWatch(watchId);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  };
}
