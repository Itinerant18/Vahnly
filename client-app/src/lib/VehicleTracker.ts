/**
 * VehicleTracker manages high-frequency coordinate data without triggering React re-renders.
 * Uses mutable state + requestAnimationFrame for 60 FPS smooth gliding.
 */

export interface CoordinateBatch {
  lat: number;
  lng: number;
  timestamp: number; // milliseconds since epoch
}

export class VehicleTracker {
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

  constructor() {
    this.startInterpolationLoop();
  }

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
