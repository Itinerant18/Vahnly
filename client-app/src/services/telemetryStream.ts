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

  const sendPosition = async (lat: number, lng: number, bearing: number, speedKms: number) => {
    if (!isVisible) return;

    let batteryLevel = 100;
    let networkType = 'unknown';

    const nav = navigator as any;
    if (nav.getBattery) {
      try {
        const battery = await nav.getBattery();
        batteryLevel = Math.round(battery.level * 100);
      } catch (e) {
        // ignore
      }
    }
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (conn) {
      networkType = conn.type || conn.effectiveType || 'unknown';
    }

    void updateDriverLocation(
      options.token,
      options.driverId,
      options.cityPrefix,
      lat,
      lng,
      bearing,
      speedKms,
      batteryLevel,
      networkType,
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
