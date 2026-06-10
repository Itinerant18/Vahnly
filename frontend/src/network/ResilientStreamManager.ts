import { WS_GATEWAY_BASE_URL, API_GATEWAY_BASE_URL } from '../config';

export interface StreamConfig {
  orderID: string;
  cityPrefix: string;
  onMessage: (data: unknown) => void;
  onStatusChange: (status: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING') => void;
  wsBaseUrl?: string;
}

// MILESTONE 31: Lightweight client-side Protobuf decoder mapping binary stream arrays 
// directly back to standard platform data envelopes to prevent dependency bloating.
// Bounds-checked decoder. Every read validates against the buffer length before
// consuming bytes, so a malformed or hostile frame throws a contained error
// (caught by onmessage) instead of reading past the ArrayBuffer or spinning in an
// unterminated varint loop.
function decodeBinaryWebSocketEnvelope(buffer: ArrayBuffer): unknown {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  const ensure = (n: number): void => {
    if (n < 0 || offset + n > bytes.length) {
      throw new Error('protobuf_frame_truncated');
    }
  };

  const readVarint = (): number => {
    let result = 0;
    let multiplier = 1;
    for (let i = 0; i < 10; i++) {
      ensure(1);
      const b = bytes[offset++];
      result += (b & 0x7f) * multiplier;
      if ((b & 0x80) === 0) return result;
      multiplier *= 128;
    }
    throw new Error('protobuf_varint_overflow');
  };

  const readString = (len: number): string => {
    ensure(len);
    const s = new TextDecoder().decode(bytes.subarray(offset, offset + len));
    offset += len;
    return s;
  };

  const skipField = (wireType: number): void => {
    if (wireType === 0) { readVarint(); return; }
    if (wireType === 1) { ensure(8); offset += 8; return; }
    if (wireType === 2) { const l = readVarint(); ensure(l); offset += l; return; }
    if (wireType === 5) { ensure(4); offset += 4; return; }
    throw new Error('protobuf_unsupported_wire_type_' + wireType);
  };

  let frameType = 0;
  const assignmentData: any = {};
  const telemetryData: any = {};

  while (offset < bytes.length) {
    const key = readVarint();
    const fieldNumber = key >> 3;
    const wireType = key & 0x7;

    if (fieldNumber === 1 && wireType === 0) { // FrameType enum
      frameType = readVarint();
    } else if (fieldNumber === 2 && wireType === 2) { // Embedded Assignment block
      const subLen = readVarint();
      ensure(subLen);
      const end = offset + subLen;
      while (offset < end) {
        const subKey = readVarint();
        const subNum = subKey >> 3;
        const subWire = subKey & 0x7;
        if (subWire === 2) {
          const val = readString(readVarint());
          if (subNum === 1) assignmentData.order_id = val;
          else if (subNum === 2) assignmentData.driver_id = val;
          else if (subNum === 3) assignmentData.city_prefix = val;
          else if (subNum === 4) assignmentData.status = val;
        } else {
          skipField(subWire);
        }
      }
    } else if (fieldNumber === 3 && wireType === 2) { // Embedded Telemetry block
      const subLen = readVarint();
      ensure(subLen);
      const end = offset + subLen;
      while (offset < end) {
        const subKey = readVarint();
        const subNum = subKey >> 3;
        const subWire = subKey & 0x7;
        if (subWire === 2) { // String values
          const val = readString(readVarint());
          if (subNum === 1) telemetryData.order_id = val;
          else if (subNum === 2) telemetryData.driver_id = val;
        } else if (subWire === 1) { // Float64 (fixed 8 bytes)
          ensure(8);
          const val = view.getFloat64(offset, true);
          offset += 8;
          if (subNum === 3) telemetryData.latitude = val;
          else if (subNum === 4) telemetryData.longitude = val;
          else if (subNum === 5) telemetryData.bearing = val;
          else if (subNum === 6) telemetryData.speed_kms = val;
        } else if (subWire === 0) { // Varint timestamp
          const val = readVarint();
          if (subNum === 7) telemetryData.timestamp_utc = val;
        } else {
          skipField(subWire);
        }
      }
    } else {
      skipField(wireType);
    }
  }

  return frameType === 1
    ? { channel: 'assignment', ...assignmentData }
    : { channel: 'telemetry', ...telemetryData };
}

export class ResilientStreamManager {
  private config: StreamConfig;
  private wsBaseUrl: string;
  private ws: WebSocket | null = null;
  private isPurposelyClosed: boolean = false;

  private baseDelayMs: number = 500;
  private maxDelayMs: number = 8000;
  private currentRetryAttempt: number = 0;

  constructor(config: StreamConfig) {
    this.config = config;
    this.wsBaseUrl = (config.wsBaseUrl ?? WS_GATEWAY_BASE_URL).replace(/\/$/, '');
  }

  // Mint a single-use WS ticket using the HttpOnly session cookie (credentials:'include').
  // The JWT is never read by JS or placed in the WS URL. A 401 means the session is dead;
  // mintTicket returns null and connect() backs off instead of spinning.
  private async mintTicket(): Promise<string | null> {
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL.replace(/\/$/, '')}/api/v1/ws/ticket`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { ticket?: string };
      return data.ticket ?? null;
    } catch {
      return null;
    }
  }

  public async connect(): Promise<void> {
    this.isPurposelyClosed = false;

    const ticket = await this.mintTicket();
    if (this.isPurposelyClosed) {
      return;
    }
    if (!ticket) {
      this.config.onStatusChange('DISCONNECTED');
      this.executeJitteredReconnection();
      return;
    }

    const url = `${this.wsBaseUrl}/api/v1/dispatch/stream?order_id=${encodeURIComponent(
      this.config.orderID,
    )}&city_prefix=${encodeURIComponent(this.config.cityPrefix)}&ticket=${encodeURIComponent(ticket)}`;

    this.ws = new WebSocket(url);
    
    // MILESTONE 31: Enforce arraybuffer context tracking rules natively
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.config.onStatusChange('CONNECTED');
    };

    this.ws.onmessage = (event: MessageEvent) => {
      // Reset backoff only once the connection proves healthy (first frame received),
      // not on bare onopen — a pod that accepts the upgrade then immediately drops would
      // otherwise reset the counter every cycle and stampede the gateway at the floor delay.
      this.currentRetryAttempt = 0;

      try {
        if (event.data instanceof ArrayBuffer) {
          const parsedPayload = decodeBinaryWebSocketEnvelope(event.data);
          this.config.onMessage(parsedPayload);
        } else {
          this.config.onMessage(JSON.parse(event.data as string));
        }
      } catch (err) {
        console.warn('[STREAM_MANAGER] Dropped corrupted packet segment:', err);
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.config.onStatusChange('DISCONNECTED');
      if (event.code === 1001) {
        console.warn('[STREAM_MANAGER] Host pod draining. Re-homing session to an alternate replica.');
      }
      if (!this.isPurposelyClosed) {
        this.executeJitteredReconnection();
      }
    };

    this.ws.onerror = (error) => {
      console.error('[STREAM_MANAGER] Underlying socket exception:', error);
    };
  }

  private executeJitteredReconnection(): void {
    this.config.onStatusChange('RECONNECTING');
    const factorDelay = this.baseDelayMs * Math.pow(2, this.currentRetryAttempt);
    const boundedDelay = Math.min(this.maxDelayMs, factorDelay);
    const randomizedJitterDelay = Math.random() * boundedDelay;

    this.currentRetryAttempt++;
    setTimeout(() => {
      if (!this.isPurposelyClosed) {
        this.connect();
      }
    }, randomizedJitterDelay);
  }

  public disconnect(): void {
    this.isPurposelyClosed = true;
    if (this.ws) {
      this.ws.close(1000, 'Client requested clean teardown');
    }
  }
}
