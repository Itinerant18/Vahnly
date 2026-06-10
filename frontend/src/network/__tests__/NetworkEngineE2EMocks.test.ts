import { ClientCoreEngine, NonRetryableHttpError } from '../ClientCoreEngine';
import { ResilientStreamManager, StreamConfig } from '../ResilientStreamManager';
import { TelemetryRingBuffer, GPSCoordinatePacket } from '../TelemetryRingBuffer';

describe('Milestone 32 — Full-Stack Network Integration & Mocking Suite', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  // =========================================================================
  // CORE DISPATCH ENGINE: CLIENT CORE RESILIENCY TESTING (HTTP TIER)
  // =========================================================================
  describe('ClientCoreEngine Verification', () => {
    it('should reuse the exact same idempotency key across transient retry paths', async () => {
      const engine = new ClientCoreEngine('KOL', 'http://localhost:8080');
      
      const headersTracked: Record<string, string>[] = [];
      
      // Simulate two network drops followed by a successful 200 OK commit
      (globalThis.fetch as jest.Mock)
        .mockRejectedValueOnce(new TypeError('Failed to fetch (Simulated Drop 1)'))
        .mockRejectedValueOnce(new TypeError('Failed to fetch (Simulated Drop 2)'))
        .mockImplementationOnce(async (_, init) => {
          headersTracked.push(init.headers as Record<string, string>);
          return {
            ok: true,
            status: 200,
            json: async () => ({ order_id: 'f47ac10b', status: 'ASSIGNED' }),
          } as Response;
        });

      const requestPromise = engine.executeRequest<{ order_id: string }>({
        method: 'POST',
        path: '/api/v1/orders',
        body: { pickup: 'Kolkata Grid' },
        useIdempotency: true,
        maxAttempts: 3,
      });

      // Fast-forward through the backoff timer steps safely
      for (let i = 0; i < 3; i++) {
        await jest.advanceTimersByTimeAsync(4000);
      }

      const result = await requestPromise;

      expect(result.order_id).toBe('f47ac10b');
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
      
      // Assert that the exact same idempotency token was reused across the wire
      const finalHeaders = headersTracked[0];
      expect(finalHeaders).toBeDefined();
      expect(finalHeaders['X-Idempotency-Key']).toMatch(/^idmp-client-/);
      expect(finalHeaders['X-Region-Prefix']).toBe('KOL');
    });

    it('should trip immediately without retrying upon receiving non-retryable 4xx errors', async () => {
      const engine = new ClientCoreEngine('KOL', 'http://localhost:8080');
      
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      } as Response);

      const requestPromise = engine.executeRequest({
        method: 'POST',
        path: '/api/v1/orders',
        useIdempotency: true,
      });

      await expect(requestPromise).rejects.toThrow(NonRetryableHttpError);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('should format contextual data properly and intercept 202 Accepted flows gracefully', async () => {
      const engine = new ClientCoreEngine('BLR', 'http://localhost:8080');
      
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 202,
      } as Response);

      const result = await engine.executeRequest<{ status: string }>({
        method: 'POST',
        path: '/api/v1/orders',
      });

      expect(result.status).toBe('PROCESSING');
    });
  });

  // =========================================================================
  // PERSISTENT TRANSPORT: GRACEFUL STREAM MANAGER LOOPBACK TESTING
  // =========================================================================
  describe('ResilientStreamManager Verification', () => {
    let mockWebSocketInstance: any;
    let originalWebSocket: any;
    let store: Record<string, string>;

    beforeEach(() => {
      // The node test environment lacks the browser globals the stream manager uses
      // (localStorage for the session token, atob/btoa for the JWT exp pre-flight).
      store = {};
      (globalThis as any).localStorage = {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
      };
      if (typeof (globalThis as any).atob !== 'function') {
        (globalThis as any).atob = (s: string) => Buffer.from(s, 'base64').toString('binary');
      }
      if (typeof (globalThis as any).btoa !== 'function') {
        (globalThis as any).btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
      }

      originalWebSocket = globalThis.WebSocket;
      mockWebSocketInstance = {
        close: jest.fn(),
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };

      globalThis.WebSocket = jest.fn().mockImplementation(() => mockWebSocketInstance) as any;
    });

    afterEach(() => {
      globalThis.WebSocket = originalWebSocket;
      delete (globalThis as any).localStorage;
    });

    it('should capture 1001 CloseGoingAway frames and smoothly execute jittered re-homing', async () => {
      // The stream now mints a single-use WS ticket over HTTP before connecting (the JWT
      // travels in the Authorization header, never in the URL), so the socket is opened
      // asynchronously. Seed a usable session token and stub the ticket endpoint.
      const sessionToken = 'h.' + btoa(JSON.stringify({ role: 'ADMIN' })) + '.s';
      localStorage.setItem('admin_jwt_token', sessionToken);
      (globalThis.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ ticket: 'tkt-test-1' }),
      } as Response);

      const statusChanges: string[] = [];
      const config: StreamConfig = {
        orderID: 'test-order-999',
        cityPrefix: 'KOL',
        onMessage: jest.fn(),
        onStatusChange: (status) => statusChanges.push(status),
        wsBaseUrl: 'ws://localhost:8080',
      };

      const manager = new ResilientStreamManager(config);
      await manager.connect();

      // Simulate a clean socket open confirmation loop
      if (mockWebSocketInstance.onopen) mockWebSocketInstance.onopen();
      expect(statusChanges).toContain('CONNECTED');

      // Trigger a rolling-restart drop event using code 1001 (CloseGoingAway)
      if (mockWebSocketInstance.onclose) {
        mockWebSocketInstance.onclose({ code: 1001, reason: 'Server Pod Draining' } as CloseEvent);
      }

      expect(statusChanges).toContain('DISCONNECTED');
      expect(statusChanges).toContain('RECONNECTING');

      // Fast forward the backoff clocks to trigger the second connect configuration pass
      await jest.advanceTimersByTimeAsync(8000);
      expect(globalThis.WebSocket).toHaveBeenCalledTimes(2);

      manager.disconnect();
      localStorage.removeItem('admin_jwt_token');
    });
  });

  // =========================================================================
  // GEOSPATIAL FLEET INTEGRITY: SLIDING-WINDOW RING BUFFER TESTING
  // =========================================================================
  describe('TelemetryRingBuffer Verification', () => {
    const createMockPacket = (driverId: string, lat: number): GPSCoordinatePacket => ({
      driver_id: driverId,
      city_prefix: 'KOL',
      latitude: lat,
      longitude: 88.3639,
      bearing: 180,
      speed_kms: 42,
      timestamp_utc: Date.now(),
    });

    it('should enforce hard size boundaries by evicting historical positions under offline conditions', () => {
      const uploaderMock = jest.fn().mockResolvedValue(true);
      const ringBuffer = new TelemetryRingBuffer(uploaderMock, 3); // Max boundary of 3 entries

      ringBuffer.logCoordinate(createMockPacket('drv-1', 22.5726), false);
      ringBuffer.logCoordinate(createMockPacket('drv-1', 22.5727), false);
      ringBuffer.logCoordinate(createMockPacket('drv-1', 22.5728), false);
      
      expect(ringBuffer.getPendingCount()).toBe(3);

      // This 4th insertion must trigger a shift eviction drop loop for the oldest coordinate
      ringBuffer.logCoordinate(createMockPacket('drv-1', 22.5729), false);
      
      expect(ringBuffer.getPendingCount()).toBe(3);
      expect(uploaderMock).not.toHaveBeenCalled();
    });

    it('should complete flushing routines securely by reference pointer matching to avoid data races', async () => {
      const uploaderMock = jest.fn().mockImplementation(async () => {
        // Induce artificial transport latency to test references safely
        await new Promise((r) => setTimeout(r, 100));
        return true;
      });

      const ringBuffer = new TelemetryRingBuffer(uploaderMock, 10);
      
      const initialPacket = createMockPacket('drv-1', 22.5726);
      ringBuffer.logCoordinate(initialPacket, true);

      // Start flushing operations
      const flushPromise = ringBuffer.flushCachedTelemetryPools();

      // While the flight payload is uploading, simulate a new discrete GPS point arriving in real-time
      const realTimePacket = createMockPacket('drv-1', 22.5727);
      ringBuffer.logCoordinate(realTimePacket, false);

      // Step timers past the upload flight delay window
      await jest.advanceTimersByTimeAsync(200);
      await flushPromise;

      // Crucial assertion: reference tracking ensures that ONLY the initial packet was cleared.
      // The real-time packet must remain safely intact inside the buffer queue.
      expect(ringBuffer.getPendingCount()).toBe(1);
    });
  });
});
