import { updateDriverLocation } from '@/api/client';
import { TelemetryRingBuffer, GPSCoordinatePacket } from '@/network/TelemetryRingBuffer';

export interface TelemetryStreamOptions {
  token: string;
  driverId: string;
  cityPrefix: string;
  /** Live connectivity probe. When it returns false, points are buffered locally
   *  instead of being sent, and flushed (oldest→newest) once connectivity returns. */
  isConnected?: () => boolean;
}

export interface TelemetryStreamHandle {
  stop: () => void;
  /** Drain any locally-buffered points. Call this when the connection comes back. */
  flush: () => void;
}

export function startTelemetryStream(options: TelemetryStreamOptions): TelemetryStreamHandle {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    console.error('[TELEMETRY_STREAM] Browser geolocation is unavailable.');
    return { stop: () => { }, flush: () => { } };
  }

  let isVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const isConnected = options.isConnected ?? (() => true);

  const readDeviceContext = async (): Promise<{ batteryLevel: number; networkType: string }> => {
    let batteryLevel = 100;
    let networkType = 'unknown';

    const nav = navigator as any;
    if (nav.getBattery) {
      try {
        const battery = await nav.getBattery();
        batteryLevel = Math.round(battery.level * 100);
      } catch {
        // ignore
      }
    }
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (conn) {
      networkType = conn.type || conn.effectiveType || 'unknown';
    }
    return { batteryLevel, networkType };
  };

  // The uploader drains the ring buffer oldest→newest. updateDriverLocation posts a single
  // point, so cached packets are replayed sequentially; device context is read once per flush.
  const buffer = new TelemetryRingBuffer(async (packets: GPSCoordinatePacket[]) => {
    const ctx = await readDeviceContext();
    for (const p of packets) {
      await updateDriverLocation(
        options.token,
        p.driver_id,
        p.city_prefix,
        p.latitude,
        p.longitude,
        p.bearing,
        p.speed_kms,
        ctx.batteryLevel,
        ctx.networkType,
      );
    }
    return true;
  });

  const onPosition = (lat: number, lng: number, bearing: number, speedKms: number) => {
    if (!isVisible) return;
    const packet: GPSCoordinatePacket = {
      driver_id: options.driverId,
      city_prefix: options.cityPrefix,
      latitude: lat,
      longitude: lng,
      bearing,
      speed_kms: speedKms,
      timestamp_utc: Date.now(),
    };
    // When connected, logCoordinate sends immediately (and flushes any backlog);
    // when offline, the point is retained in the ring buffer for a later flush.
    buffer.logCoordinate(packet, isConnected());
  };

  const handleVisibilityChange = () => {
    isVisible = document.visibilityState !== 'hidden';
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      onPosition(
        pos.coords.latitude,
        pos.coords.longitude,
        pos.coords.heading || 0,
        (pos.coords.speed || 0) * 3.6,
      );
    },
    (err) => console.error('[TELEMETRY_STREAM] GPS error:', err),
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 5000 },
  );

  return {
    stop: () => {
      navigator.geolocation.clearWatch(watchId);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    },
    flush: () => {
      void buffer.flushCachedTelemetryPools();
    },
  };
}
