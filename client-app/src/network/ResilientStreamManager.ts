import { WS_GATEWAY_BASE_URL } from '../config';

export interface StreamConfig {
  orderID: string;
  cityPrefix: string;
  onMessage: (data: unknown) => void;
  onStatusChange: (status: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING') => void;
  /** Override the default WebSocket gateway base URL. */
  wsBaseUrl?: string;
}

export class ResilientStreamManager {
  private config: StreamConfig;
  private wsBaseUrl: string;
  private ws: WebSocket | null = null;
  private isPurposelyClosed: boolean = false;

  // Reconnection backoff state
  private baseDelayMs: number = 500;
  private maxDelayMs: number = 8000;
  private currentRetryAttempt: number = 0;

  constructor(config: StreamConfig) {
    this.config = config;
    this.wsBaseUrl = (config.wsBaseUrl ?? WS_GATEWAY_BASE_URL).replace(/\/$/, '');
  }

  /** Establish a persistent connection to the public gateway stream handler. */
  public connect(): void {
    this.isPurposelyClosed = false;
    const url = `${this.wsBaseUrl}/api/v1/dispatch/stream?order_id=${encodeURIComponent(
      this.config.orderID,
    )}&city_prefix=${encodeURIComponent(this.config.cityPrefix)}`;

    this.ws = new WebSocket(url);
    // Gateway emits compressed Protobuf allocation frames; receive them as raw buffers.
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.currentRetryAttempt = 0;
      this.config.onStatusChange('CONNECTED');
    };

    this.ws.onmessage = (event: MessageEvent) => {
      // Binary frames pass through untouched so consumers can decode the envelope;
      // text frames are JSON-parsed as a fallback control channel.
      if (event.data instanceof ArrayBuffer) {
        this.config.onMessage(event.data);
        return;
      }
      try {
        this.config.onMessage(JSON.parse(event.data as string));
      } catch {
        console.warn('[STREAM_MANAGER] Dropped malformed frame:', event.data);
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.config.onStatusChange('DISCONNECTED');

      // Milestone 16: 1001 == CloseGoingAway (graceful pod drain). Re-home to a healthy pod.
      if (event.code === 1001) {
        console.warn('[STREAM_MANAGER] Host pod draining. Re-homing session to an alternate replica.');
      }

      if (!this.isPurposelyClosed) {
        this.executeJitteredReconnection();
      }
    };

    this.ws.onerror = () => {
      // Browser WebSocket error events carry no descriptive details for security reasons,
      // showing up as an empty object '{}' in logs. We print a descriptive warning here.
      console.warn(`[STREAM_MANAGER] Connection offline or unreachable at: ${this.wsBaseUrl}. Reconnection scheduled.`);
    };
  }

  /** Schedule a reconnect using full-jitter exponential backoff. */
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
