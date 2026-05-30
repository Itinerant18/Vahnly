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

  constructor(uploader: TelemetryUploader, maxSize: number = 100) {
    this.uploader = uploader;
    this.bufferSizeLimit = maxSize;
  }

  /**
   * Push a high-frequency driver location into the local ring buffer.
   * Evicts the oldest packet once the size limit is breached.
   */
  public logCoordinate(packet: GPSCoordinatePacket, isNetworkOnline: boolean): void {
    if (this.ringBuffer.length >= this.bufferSizeLimit) {
      this.ringBuffer.shift();
      console.warn('[TELEMETRY_CACHE] Buffer full. Evicting oldest location snapshot packet.');
    }

    this.ringBuffer.push(packet);

    if (isNetworkOnline && !this.isUploading) {
      void this.flushCachedTelemetryPools();
    }
  }

  /**
   * Flush cached telemetry points to the backend once connectivity returns.
   *
   * Successfully-flushed packets are removed BY REFERENCE rather than by index/count, so
   * coordinates pushed (or evicted) during the awaited upload are never accidentally
   * dropped or re-sent.
   */
  public async flushCachedTelemetryPools(): Promise<void> {
    if (this.ringBuffer.length === 0 || this.isUploading) return;

    this.isUploading = true;
    const recordsToFlush = [...this.ringBuffer];

    try {
      const uploadSuccess = await this.uploader(recordsToFlush);
      if (uploadSuccess) {
        const flushed = new Set<GPSCoordinatePacket>(recordsToFlush);
        this.ringBuffer = this.ringBuffer.filter((p) => !flushed.has(p));
        console.log('[TELEMETRY_CACHE] Flushed cached points successfully.');
      }
    } catch (err) {
      console.error('[TELEMETRY_CACHE] Flush failed. Preserving local cache:', err);
    } finally {
      this.isUploading = false;
    }
  }

  public getPendingCount(): number {
    return this.ringBuffer.length;
  }
}
