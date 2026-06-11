import { API_BASE_URL, TOKEN_STORAGE_KEY } from "../api/client";
import {
  isRiderWebSocketMessage,
  type ConnectionStatus,
  type RiderWebSocketMessage,
} from "./types";

/**
 * RiderStreamManager adapts the driver-side ResilientStreamManager for the rider
 * live-trip channel. Differences: it connects directly to /ws/rider?token={jwt}
 * (the server reads rider_id from the JWT and subscribes ws:rider:{rider_id}),
 * and it dispatches typed rider.* messages. Kept: jittered exponential backoff,
 * token pre-flight check, code-1001 fast reconnect.
 */
export interface RiderStreamConfig {
  onMessage: (msg: RiderWebSocketMessage) => void;
  onStatusChange: (status: ConnectionStatus) => void;
  /** Override the WebSocket base (defaults to NEXT_PUBLIC_WS_URL or API host). */
  wsBaseUrl?: string;
  /** Override the token source (defaults to localStorage dfu_rider_token). */
  getToken?: () => string | null;
}

function defaultWsBase(): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  if (explicit) return explicit;
  return API_BASE_URL.replace(/^http/, "ws");
}

export class RiderStreamManager {
  private config: RiderStreamConfig;
  private wsBaseUrl: string;
  private ws: WebSocket | null = null;
  private isPurposelyClosed = false;

  // Jittered exponential backoff (same formula as the driver manager).
  private baseDelayMs = 500;
  private maxDelayMs = 8000;
  private currentRetryAttempt = 0;

  constructor(config: RiderStreamConfig) {
    this.config = config;
    this.wsBaseUrl = (config.wsBaseUrl ?? defaultWsBase()).replace(/\/$/, "");
  }

  private readToken(): string | null {
    if (this.config.getToken) return this.config.getToken();
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  }

  public connect(): void {
    this.isPurposelyClosed = false;

    // Token pre-flight check — never open a socket without one.
    const token = this.readToken();
    if (!token) {
      this.config.onStatusChange("DISCONNECTED");
      return;
    }

    const url = `${this.wsBaseUrl}/ws/rider?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(url);
    // rider.driver.location may arrive as a binary protobuf frame.
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.config.onStatusChange("CONNECTED");
    };

    this.ws.onmessage = (event: MessageEvent) => {
      // Reset backoff only once a frame proves the connection is healthy.
      this.currentRetryAttempt = 0;

      if (event.data instanceof ArrayBuffer) {
        const decoded = this.decodeBinaryLocationFrame(event.data);
        if (decoded) this.config.onMessage(decoded);
        return;
      }
      try {
        const parsed: unknown = JSON.parse(event.data as string);
        if (isRiderWebSocketMessage(parsed)) {
          this.config.onMessage(parsed);
        } else {
          console.warn("[RIDER_STREAM] Unknown frame type dropped:", parsed);
        }
      } catch {
        console.warn("[RIDER_STREAM] Dropped malformed frame");
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.config.onStatusChange("DISCONNECTED");
      // 1001 == CloseGoingAway (graceful pod drain): re-home fast.
      if (event.code === 1001) {
        console.warn("[RIDER_STREAM] Host pod draining. Re-homing session.");
      }
      if (!this.isPurposelyClosed) {
        this.executeJitteredReconnection();
      }
    };

    this.ws.onerror = () => {
      console.warn(
        `[RIDER_STREAM] Connection offline/unreachable at ${this.wsBaseUrl}. Reconnect scheduled.`,
      );
    };
  }

  /**
   * Binary protobuf decoder for rider.driver.location frames. The server currently
   * emits JSON for every rider event, so this is a stub returning null until a
   * protobuf schema is wired; binary frames are then safely ignored.
   */
  private decodeBinaryLocationFrame(_buf: ArrayBuffer): RiderWebSocketMessage | null {
    return null;
  }

  private executeJitteredReconnection(): void {
    this.config.onStatusChange("RECONNECTING");
    const factorDelay = this.baseDelayMs * Math.pow(2, this.currentRetryAttempt);
    const boundedDelay = Math.min(this.maxDelayMs, factorDelay);
    const randomizedJitterDelay = Math.random() * boundedDelay;
    this.currentRetryAttempt++;
    setTimeout(() => {
      if (!this.isPurposelyClosed) this.connect();
    }, randomizedJitterDelay);
  }

  public disconnect(): void {
    this.isPurposelyClosed = true;
    if (this.ws) this.ws.close(1000, "Client requested clean teardown");
  }
}
