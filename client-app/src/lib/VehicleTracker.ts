import { Capacitor } from '@capacitor/core';
import { TelemetryRingBuffer, GPSCoordinatePacket } from '../network/TelemetryRingBuffer';

export interface CoordinateBatch {
  lat: number;
  lng: number;
  timestamp: number; // milliseconds since epoch
}

export class VehicleTracker {
  // --- Native Geolocation Tracking Properties ---
  private isTrackingActive: boolean = false;
  private watchId: string | null = null;
  private ringBuffer: TelemetryRingBuffer;
  private driverID: string;
  private cityPrefix: string;
  private worker: Worker | null = null;

  // --- Visual Interpolation Properties ---
  private coordinateQueue: CoordinateBatch[] = [];
  private currentLat: number = 0;
  private currentLng: number = 0;
  private targetLat: number = 0;
  private targetLng: number = 0;
  private lastUpdateTime: number = 0;
  private lastProcessedTimestamp: number = 0;
  private animationFrameId: number | null = null;
  private onPositionUpdate: ((lat: number, lng: number) => void) | null = null;

  // Delay the visual rendering by 4 seconds to ensure we always have two points to interpolate between
  private readonly RENDER_DELAY_MS = 4000;

  constructor(
    driverID?: string,
    cityPrefix?: string,
    uploadHandler?: (packets: any[]) => Promise<boolean>
  ) {
    this.driverID = driverID || '';
    this.cityPrefix = cityPrefix || 'KOL';
    // Instantiate an offline ring buffer with a strict 50-packet boundary cap limit
    this.ringBuffer = new TelemetryRingBuffer(uploadHandler || (async () => true), 50);

    // Initialize visual interpolation loop automatically on the client side
    this.startInterpolationLoop();
  }

  /**
   * Initializes the native hardware geolocation engine using the Capacitor runtime bridge.
   * Leverages background permission systems to maintain active tracking when minimized.
   */
  public async startTrackingCore(): Promise<void> {
    if (this.isTrackingActive) return;

    const isNativePlatform = Capacitor.isNativePlatform();
    this.isTrackingActive = true;

    if (isNativePlatform) {
      console.log('[VEHICLE_TRACKER] Initializing native background execution threads via Capacitor Bridge...');
    } else {
      console.warn('[VEHICLE_TRACKER] Native hardware absent. Initializing fallback browser tracking loops.');
    }

    if (typeof window !== 'undefined') {
      try {
        const workerCode = `
          let timer = null;
          self.onmessage = function(e) {
            if (e.data === 'start') {
              if (timer) clearInterval(timer);
              timer = setInterval(() => {
                self.postMessage('tick');
              }, 2000);
            } else if (e.data === 'stop') {
              if (timer) {
                clearInterval(timer);
                timer = null;
              }
            }
          };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.worker = new Worker(URL.createObjectURL(blob));
        this.worker.onmessage = (e) => {
          if (e.data === 'tick') {
            this.pollGeolocation();
          }
        };
        this.worker.postMessage('start');
        console.log('[VEHICLE_TRACKER] Inline Web Worker successfully spawned for unthrottled geolocation ticking.');
      } catch (err) {
        console.warn('[VEHICLE_TRACKER] Failed to spawn Web Worker, falling back to setTimeout:', err);
        this.executePollingLoop();
      }
    } else {
      this.executePollingLoop();
    }
  }

  private pollGeolocation(): void {
    if (!this.isTrackingActive || typeof window === 'undefined') return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, heading, speed } = pos.coords;

        // Drop packets without a usable fix rather than substituting fabricated
        // coordinates/speed, which would inject fake movement into telemetry and billing.
        // Only the exact null-island (0,0) is rejected; a real lat or lng of 0 is kept.
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) {
          console.warn('[VEHICLE_TRACKER] Dropped telemetry packet: no valid GPS fix.');
          return;
        }

        const telemetryPacket: GPSCoordinatePacket = {
          driver_id: this.driverID,
          city_prefix: this.cityPrefix,
          latitude,
          longitude,
          bearing: Number.isFinite(heading as number) ? (heading as number) : 0.0,
          speed_kms: Number.isFinite(speed as number) && (speed as number) > 0 ? (speed as number) * 3.6 : 0,
          timestamp_utc: Date.now(),
        };

        const isDeviceOnline = navigator.onLine;
        this.ringBuffer.logCoordinate(telemetryPacket, isDeviceOnline);
      },
      (err) => {
        console.error('[VEHICLE_TRACKER] Geolocation harvest exception:', err);
      },
      { enableHighAccuracy: true, timeout: 1500 }
    );
  }

  private executePollingLoop(): void {
    if (!this.isTrackingActive || typeof window === 'undefined') return;

    this.pollGeolocation();
    setTimeout(() => this.executePollingLoop(), 2000);
  }

  public stopTrackingCore(): void {
    this.isTrackingActive = false;
    if (this.worker) {
      this.worker.postMessage('stop');
      this.worker.terminate();
      this.worker = null;
    }
    if (this.watchId) {
      this.watchId = null;
    }
    console.log('[VEHICLE_TRACKER] Telemetry tracking lifecycle terminated.');
  }

  public getRingBuffer(): TelemetryRingBuffer {
    return this.ringBuffer;
  }

  // --- Visual Interpolation Methods ---

  /**
   * Push an incoming coordinate batch from the backend.
   * This bypasses React entirely.
   */
  public pushCoordinate(batch: CoordinateBatch): void {
    if (batch.timestamp <= this.lastProcessedTimestamp) {
      // Drop duplicate or out-of-order coordinate
      return;
    }
    if (this.coordinateQueue.some((q) => q.timestamp === batch.timestamp)) {
      // Drop duplicate in queue
      return;
    }
    this.coordinateQueue.push(batch);
    this.coordinateQueue.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * The core interpolation loop that runs at 60 FPS.
   * This reads from mutable state and updates the map directly via DOM/Canvas.
   */
  private startInterpolationLoop(): void {
    if (typeof window === 'undefined') return;

    const tick = () => {
      const now = Date.now();

      // Process queued coordinates (apply the 4-second delay)
      if (this.coordinateQueue.length > 0) {
        const batch = this.coordinateQueue[0];
        if (now - batch.timestamp >= this.RENDER_DELAY_MS) {
          // Dequeue this batch
          this.coordinateQueue.shift();
          this.lastProcessedTimestamp = batch.timestamp;

          // Set it as the new target
          this.targetLat = batch.lat;
          this.targetLng = batch.lng;
          this.lastUpdateTime = now;
        }
      }

      // Linear interpolation: calculate percentage of time passed since last update
      const timeSinceLastUpdate = now - this.lastUpdateTime;
      const interpolationDuration = this.RENDER_DELAY_MS; // 4 seconds
      const progress = Math.min(timeSinceLastUpdate / interpolationDuration, 1);

      // Lerp between current position and target
      this.currentLat = this.currentLat + (this.targetLat - this.currentLat) * progress;
      this.currentLng = this.currentLng + (this.targetLng - this.currentLng) * progress;

      // Fire callback for Mapbox or Canvas to update the marker
      if (this.onPositionUpdate) {
        this.onPositionUpdate(this.currentLat, this.currentLng);
      }

      this.animationFrameId = requestAnimationFrame(tick);
    };

    this.animationFrameId = requestAnimationFrame(tick);
  }

  /**
   * Register a callback that fires every frame with the interpolated position.
   * This callback directly updates markers without triggering React re-renders.
   */
  public onUpdate(callback: (lat: number, lng: number) => void): void {
    this.onPositionUpdate = callback;
  }

  /**
   * Stop the interpolation loop (cleanup).
   */
  public destroy(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  /**
   * Get current position (read-only, for testing or UI fallback).
   */
  public getPosition(): { lat: number; lng: number } {
    return { lat: this.currentLat, lng: this.currentLng };
  }
}
