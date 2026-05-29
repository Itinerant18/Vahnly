export interface StreamConfig {
  wsBaseUrl: string;
  orderID: string;
  cityPrefix: string;
  onMessage: (data: any) => void;
  onStatusChange: (status: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING') => void;
}

export class ResilientStreamManager {
  private config: StreamConfig;
  private ws: WebSocket | null = null;
  private isPurposelyClosed: boolean = false;
  
  // Reconnection variables
  private baseDelayMs: number = 500;
  private maxDelayMs: number = 8000;
  private currentRetryAttempt: number = 0;

  constructor(config: StreamConfig) {
    this.config = config;
  }

  /**
   * Establish persistent connection bounds to the public gateway stream handler
   */
  public connect(): void {
    this.isPurposelyClosed = false;
    // Construct target regional routing parameters matching Milestone 22 boundaries
    const url = `${this.config.wsBaseUrl}/api/v1/dispatch/stream?order_id=${this.config.orderID}&city_prefix=${this.config.cityPrefix}`;

    console.log(`[STREAM_MANAGER] Initiating real-time connection to gateway node: ${url}`);
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log(`[STREAM_MANAGER] Connection established cleanly for order: ${this.config.orderID}`);
      this.currentRetryAttempt = 0; // Reset retry tracking mechanics
      this.config.onStatusChange('CONNECTED');
    };

    this.ws.onmessage = (event) => {
      try {
        const parsedPayload = JSON.parse(event.data);
        this.config.onMessage(parsedPayload);
      } catch (err) {
        console.warn('[STREAM_MANAGER] Dropped malformed string segment frame:', event.data);
      }
    };

    this.ws.onclose = (event) => {
      this.config.onStatusChange('DISCONNECTED');
      
      // MILESTONE 16 DISCONNECT INTERCEPTION: Handle graceful connection draining loops cleanly
      if (event.code === 1001) { // 1001 maps explicitly to CloseGoingAway handshakes
        console.warn('[STREAM_MANAGER] Host pod is undergoing maintenance. Moving session to alternate replica.');
      }

      if (!this.isPurposelyClosed) {
        this.executeJitteredReconnection();
      }
    };

    this.ws.onerror = (error) => {
      console.error('[STREAM_MANAGER] Underlying network socket exception caught:', error);
    };
  }

  /**
   * Calculate randomized exponential backoff intervals to prevent backend load spikes
   */
  private executeJitteredReconnection(): void {
    this.config.onStatusChange('RECONNECTING');
    
    // Formula: Delay = min(MaxDelay, BaseDelay * 2^attempt)
    const factorDelay = this.baseDelayMs * Math.pow(2, this.currentRetryAttempt);
    const boundedDelay = Math.min(this.maxDelayMs, factorDelay);
    
    // Full Jitter: Randomize the delay interval uniformly between 0 and the bounded backoff limit
    const randomizedJitterDelay = Math.random() * boundedDelay;

    this.currentRetryAttempt++;
    console.log(`[STREAM_MANAGER] Rescheduling connection attempt #${this.currentRetryAttempt} in ${randomizedJitterDelay.toFixed(0)}ms...`);

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
    console.log('[STREAM_MANAGER] Persistent tracking socket closed by application mandate.');
  }
}
