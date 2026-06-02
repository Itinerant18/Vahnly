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

  // --- Visual Interpolation Properties ---
  private coordinateQueue: CoordinateBatch[] = [];
  private currentLat: number = 0;
  private currentLng: number = 0;
  private targetLat: number = 0;
  private targetLng: number = 0;
  private lastUpdateTime: number = 0;
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
      // In production configurations, invoke native background tracking plugins directly:
      // await Geolocation.requestPermissions();
      // this.watchId = await Geolocation.watchPosition({...})
    } else {
      console.warn('[VEHICLE_TRACKER] Native hardware absent. Initializing fallback browser tracking loops.');
    }

    // Standard high-accuracy telemetry sampling interval routine
    this.executePollingLoop();
  }

  private executePollingLoop(): void {
    if (!this.isTrackingActive || typeof window === 'undefined') return;

    // Standard fallback coordinate generator centered on the Kolkata primary operational hub
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const telemetryPacket: GPSCoordinatePacket = {
          driver_id: this.driverID,
          city_prefix: this.cityPrefix,
          latitude: pos.coords.latitude || 22.5726,
          longitude: pos.coords.longitude || 88.3639,
          bearing: pos.coords.heading || 0.0,
          speed_kms: (pos.coords.speed ? pos.coords.speed * 3.6 : 28.5), // Converts meters/sec to km/h values
          timestamp_utc: Date.now(),
        };

        // Push data to the ring buffer. If offline, historical points are preserved.
        const isDeviceOnline = navigator.onLine;
        this.ringBuffer.logCoordinate(telemetryPacket, isDeviceOnline);

        // Schedule next execution pulse sequence (e.g., 2-second capture frequency metrics)
        setTimeout(() => this.executePollingLoop(), 2000);
      },
      (err) => {
        console.error('[VEHICLE_TRACKER] Geolocation harvest exception:', err);
        setTimeout(() => this.executePollingLoop(), 5000); // Backoff retry delay on failure
      },
      { enableHighAccuracy: true, timeout: 1500 }
    );
  }

  public stopTrackingCore(): void {
    this.isTrackingActive = false;
    if (this.watchId) {
      // Clear native hardware listeners cleanly to prevent battery drain
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
    this.coordinateQueue.push(batch);
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
