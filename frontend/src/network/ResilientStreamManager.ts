import { WS_GATEWAY_BASE_URL } from '../config';

export interface StreamConfig {
  orderID: string;
  cityPrefix: string;
  onMessage: (data: unknown) => void;
  onStatusChange: (status: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING') => void;
  wsBaseUrl?: string;
}

// MILESTONE 31: Lightweight client-side Protobuf decoder mapping binary stream arrays 
// directly back to standard platform data envelopes to prevent dependency bloating.
function decodeBinaryWebSocketEnvelope(buffer: ArrayBuffer): unknown {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  
  // Custom precise byte un-packing adhering strictly to W3C binary array allocations
  let offset = 0;
  
  // Read wire field tags to extract message properties sequentially
  let frameType = 0;
  const assignmentData: any = {};
  const telemetryData: any = {};

  while (offset < bytes.length) {
    const key = bytes[offset++];
    const fieldNumber = key >> 3;

    if (fieldNumber === 1) { // FrameType enum
      frameType = bytes[offset++];
    } else if (fieldNumber === 2) { // Embedded Assignment Message block
      const subLen = bytes[offset++];
      const end = offset + subLen;
      while (offset < end) {
        const subKey = bytes[offset++];
        const subNum = subKey >> 3;
        const subLenStr = bytes[offset++];
        const strBytes = bytes.subarray(offset, offset + subLenStr);
        offset += subLenStr;
        const val = new TextDecoder().decode(strBytes);
        if (subNum === 1) assignmentData.order_id = val;
        if (subNum === 2) assignmentData.driver_id = val;
        if (subNum === 3) assignmentData.city_prefix = val;
        if (subNum === 4) assignmentData.status = val;
      }
    } else if (fieldNumber === 3) { // Embedded Telemetry Message block
      const subLen = bytes[offset++];
      const end = offset + subLen;
      while (offset < end) {
        const subKey = bytes[offset++];
        const subNum = subKey >> 3;
        if (subNum === 1 || subNum === 2) { // String values
          const len = bytes[offset++];
          const str = new TextDecoder().decode(bytes.subarray(offset, offset + len));
          offset += len;
          if (subNum === 1) telemetryData.order_id = str;
          if (subNum === 2) telemetryData.driver_id = str;
        } else if (subNum >= 3 && subNum <= 6) { // Float64 (8 bytes precision keys)
          const val = view.getFloat64(offset, true);
          offset += 8;
          if (subNum === 3) telemetryData.latitude = val;
          if (subNum === 4) telemetryData.longitude = val;
          if (subNum === 5) telemetryData.bearing = val;
          if (subNum === 6) telemetryData.speed_kms = val;
        } else if (subNum === 7) { // Int64 timestamp (Varint allocation)
          let shift = 0, val = 0;
          while (true) {
            const b = bytes[offset++];
            val |= (b & 0x7f) << shift;
            if (!(b & 0x80)) break;
            shift += 7;
          }
          telemetryData.timestamp_utc = val;
        }
      }
    } else {
      offset++; // Safe advance fallback for un-mapped custom payload frames
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

  // isTokenUsable decodes the JWT payload and rejects a missing/expired token.
  // The browser cannot read the 401 body of a failed WS handshake, so without
  // this guard an expired admin session reconnects forever, flooding the console.
  private isTokenUsable(token: string): boolean {
    if (!token) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (typeof payload.exp !== 'number') return true; // no exp claim: let the server decide
      // 5s skew tolerance; exp is in seconds, Date.now() in ms.
      return payload.exp * 1000 > Date.now() - 5000;
    } catch {
      return false;
    }
  }

  public connect(): void {
    this.isPurposelyClosed = false;
    const token = (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.getItem === 'function')
      ? (localStorage.getItem('admin_jwt_token') || localStorage.getItem('jwt_token') || '')
      : '';

    // Pre-flight: halt instead of spin-retrying when the session token is dead.
    if (!this.isTokenUsable(token)) {
      this.isPurposelyClosed = true;
      console.error('[STREAM_MANAGER] Admin session token missing or expired — stream halted. Please re-authenticate.');
      this.config.onStatusChange('DISCONNECTED');
      return;
    }

    const url = `${this.wsBaseUrl}/api/v1/dispatch/stream?order_id=${encodeURIComponent(
      this.config.orderID,
    )}&city_prefix=${encodeURIComponent(this.config.cityPrefix)}&jwt=${encodeURIComponent(token)}`;

    this.ws = new WebSocket(url);
    
    // MILESTONE 31: Enforce arraybuffer context tracking rules natively
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.currentRetryAttempt = 0;
      this.config.onStatusChange('CONNECTED');
    };

    this.ws.onmessage = (event: MessageEvent) => {
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
