export interface GPSCoordinatePacket {
  driver_id: string;
  city_prefix: string;
  latitude: number;
  longitude: number;
  bearing: number;
  speed_kms: number;
  timestamp_utc: number;
}

type TelemetryUploader = (packets: GPSCoordinatePacket[]) => Promise<boolean>;

export class TelemetryRingBuffer {
  private bufferSizeLimit: number;
  private ringBuffer: GPSCoordinatePacket[] = [];
  private isUploading: boolean = false;
  private uploader: TelemetryUploader;

  constructor(maxSize: number = 100, uploader: TelemetryUploader) {
    this.bufferSizeLimit = maxSize;
    this.uploader = uploader;
  }

  /**
   * Push high-frequency driver locations into the local ring buffer memory
   */
  public logCoordinate(packet: GPSCoordinatePacket, isNetworkOnline: boolean): void {
    // If the storage limit is breached, evict the oldest point to maintain memory limits
    if (this.ringBuffer.length >= this.bufferSizeLimit) {
      this.ringBuffer.shift(); 
      console.warn('[TELEMETRY_CACHE] Buffer size exceeded. Evicting oldest location snapshot packet.');
    }

    this.ringBuffer.push(packet);
    console.log(`[TELEMETRY_CACHE] Location logged. Current local window storage count: ${this.ringBuffer.length}`);

    if (isNetworkOnline && !this.isUploading) {
      this.flushCachedTelemetryPools();
    }
  }

  /**
   * Flush cached telemetry points to the backend once connectivity returns
   */
  public async flushCachedTelemetryPools(): Promise<void> {
    if (this.ringBuffer.length === 0 || this.isUploading) return;

    this.isUploading = true;
    // Snapshot the current window contents for the network operation pass
    const recordsToFlush = [...this.ringBuffer];
    console.log(`[TELEMETRY_CACHE] System online. Flushing ${recordsToFlush.length} points to ingestion engines...`);

    try {
      const uploadSuccess = await this.uploader(recordsToFlush);
      if (uploadSuccess) {
        // Clear only the records that were successfully processed
        this.ringBuffer = this.ringBuffer.slice(recordsToFlush.length);
        console.log('[TELEMETRY_CACHE] Location cache flushed successfully. Cache cleared.');
      }
    } catch (err) {
      console.error('[TELEMETRY_CACHE] Network transmission failed during flush sequence. Preserving local cache lines:', err);
    } finally {
      this.isUploading = false;
    }
  }

  public getPendingCount(): number {
    return this.ringBuffer.length;
  }
}
