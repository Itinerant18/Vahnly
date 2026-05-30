# State Architecture & WebSocket Integration Strategy
## Deep-Dive Architectural Blueprint for High-Frequency Event-Driven Frontend

**Version:** 1.0  
**Tech Stack:** Next.js 15 + React 18 + Zustand + Framer Motion + Mapbox GL JS  
**Target:** 60 FPS map interpolation + zero jank under 4-second telemetry batches  
**Problem Solved:** Prevent React re-render thrashing when piping high-frequency GPS data to maps

---

## The Core Problem

**Naive Approach (WRONG):**
```tsx
// ❌ BAD: Every coordinate update triggers React re-render
const [vehicleCoords, setVehicleCoords] = useState({ lat: 0, lng: 0 });

websocket.onMessage((event) => {
  const { lat, lng } = JSON.parse(event.data);
  setVehicleCoords({ lat, lng }); // FULL TREE RE-RENDER every 4 seconds
});
```

**Result:** Map stutters, battery drains, UI freezes on lower-end Android devices.

**Our Solution:** **Dual-Brain Paradigm**
- **Brain A (Zustand):** App state only (order status, driver details, surge multiplier)
- **Brain B (Refs):** Mutable coordinate data, bypasses React entirely

---

## Part 1: State Architecture — The Dual-Brain Pattern

### Brain A: Global App State (Zustand Store)

**File:** `src/lib/store/useAppState.ts`

```typescript
import { create } from 'zustand';

// Enums (immutable metadata)
export type OrderStatus = 
  | 'CREATED' 
  | 'ASSIGNED' 
  | 'ARRIVED_AT_PICKUP' 
  | 'IN_TRIP' 
  | 'COMPLETED';

export type DriverState = 
  | 'OFFLINE' 
  | 'ONLINE_AVAILABLE' 
  | 'ONLINE_BUSY';

// Store interface (only app state, NOT coordinates)
export interface AppState {
  // Order lifecycle
  currentOrderId: string | null;
  orderStatus: OrderStatus;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;

  // Driver lifecycle
  driverId: string | null;
  driverState: DriverState;
  driverName: string;
  driverRating: number;
  vehiclePlate: string;

  // Surge pricing
  surgeMultiplier: number;

  // Connection state (for resilience)
  isConnected: boolean;
  isReconnecting: boolean;

  // Actions
  setOrderStatus: (status: OrderStatus) => void;
  setDriverState: (state: DriverState) => void;
  setSurgeMultiplier: (multiplier: number) => void;
  setConnected: (connected: boolean) => void;
  setReconnecting: (reconnecting: boolean) => void;
}

export const useAppState = create<AppState>((set) => ({
  // Initial state
  currentOrderId: null,
  orderStatus: 'CREATED',
  pickupLat: 0,
  pickupLng: 0,
  dropoffLat: 0,
  dropoffLng: 0,
  driverId: null,
  driverState: 'OFFLINE',
  driverName: '',
  driverRating: 0,
  vehiclePlate: '',
  surgeMultiplier: 1.0,
  isConnected: false,
  isReconnecting: false,

  // Actions
  setOrderStatus: (status) => set({ orderStatus: status }),
  setDriverState: (state) => set({ driverState: state }),
  setSurgeMultiplier: (multiplier) => set({ surgeMultiplier: multiplier }),
  setConnected: (connected) => set({ isConnected: connected }),
  setReconnecting: (reconnecting) => set({ isReconnecting: reconnecting }),
}));
```

**Usage in Components:**
```tsx
// ✅ GOOD: Component subscribes only to slices it needs
export function BottomSheet() {
  const orderStatus = useAppState((s) => s.orderStatus);
  const driverName = useAppState((s) => s.driverName);
  
  // This component re-renders ONLY when orderStatus or driverName changes
  // NOT when coordinates arrive every 4 seconds
  
  return (
    <div>
      <p>Driver: {driverName}</p>
      <p>Status: {orderStatus}</p>
    </div>
  );
}
```

---

### Brain B: Mutable Map State (Refs + VehicleTracker Class)

**File:** `src/lib/VehicleTracker.ts`

```typescript
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

      // Fire callback for Mapbox to update the marker
      if (this.onPositionUpdate) {
        this.onPositionUpdate(this.currentLat, this.currentLng);
      }

      this.animationFrameId = requestAnimationFrame(tick);
    };

    this.animationFrameId = requestAnimationFrame(tick);
  }

  /**
   * Register a callback that fires every frame with the interpolated position.
   * This callback directly updates Mapbox markers without triggering React re-renders.
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
```

**Usage in Map Component:**
```tsx
'use client';
import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { VehicleTracker } from '@/lib/VehicleTracker';

export function InterpolatedMapComponent() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const vehicleTracker = useRef<VehicleTracker | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  useEffect(() => {
    // Initialize Mapbox
    const map = new mapboxgl.Map({
      container: mapContainer.current!,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [0, 0],
      zoom: 13,
    });

    // Initialize VehicleTracker
    vehicleTracker.current = new VehicleTracker();

    // Register callback: update Mapbox marker without React re-render
    vehicleTracker.current.onUpdate((lat, lng) => {
      if (!markerRef.current) {
        markerRef.current = new mapboxgl.Marker()
          .setLngLat([lng, lat])
          .addTo(map);
      } else {
        markerRef.current.setLngLat([lng, lat]);
      }
    });

    return () => {
      vehicleTracker.current?.destroy();
      map.remove();
    };
  }, []);

  return <div ref={mapContainer} className="w-full h-screen" />;
}
```

---

## Part 2: WebSocket Provider with Resilience

### The ResilientWebSocketProvider

**File:** `src/lib/providers/ResilientWebSocketProvider.tsx`

```tsx
'use client';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAppState } from '@/lib/store/useAppState';
import { VehicleTracker } from '@/lib/VehicleTracker';

interface WebSocketContextType {
  vehicleTracker: VehicleTracker | null;
  sendMessage: (event: string, payload: any) => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export function ResilientWebSocketProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [vehicleTracker] = useState(() => new VehicleTracker());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;

  const setConnected = useAppState((s) => s.setConnected);
  const setReconnecting = useAppState((s) => s.setReconnecting);
  const setOrderStatus = useAppState((s) => s.setOrderStatus);
  const setDriverState = useAppState((s) => s.setDriverState);
  const setSurgeMultiplier = useAppState((s) => s.setSurgeMultiplier);

  // Establish WebSocket connection
  const connect = async () => {
    try {
      setReconnecting(true);

      const wsUrl = process.env.NEXT_PUBLIC_WS_GATEWAY || 'ws://localhost:8080';
      const jwtToken = localStorage.getItem('jwt_token');

      const ws = new WebSocket(`${wsUrl}/api/v1/dispatch/stream?jwt=${jwtToken}`);

      ws.onopen = () => {
        console.log('WebSocket connected');
        setConnected(true);
        setReconnecting(false);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // Route messages based on event type
        switch (data.type) {
          case 'driver.location.updated':
            // Push to VehicleTracker (bypasses React)
            vehicleTracker.pushCoordinate({
              lat: data.latitude,
              lng: data.longitude,
              timestamp: Date.now(),
            });
            break;

          case 'order.assigned':
            setOrderStatus('ASSIGNED');
            break;

          case 'order.arrived_at_pickup':
            setOrderStatus('ARRIVED_AT_PICKUP');
            break;

          case 'order.in_trip':
            setOrderStatus('IN_TRIP');
            break;

          case 'order.completed':
            setOrderStatus('COMPLETED');
            break;

          case 'surge.zone.updated':
            setSurgeMultiplier(data.multiplier);
            break;

          case 'driver.state.changed':
            setDriverState(data.state);
            break;

          default:
            console.warn('Unknown event type:', data.type);
        }
      };

      ws.onclose = (event) => {
        if (event.code === 1001) {
          // CloseGoingAway: pod is scaling down, silently reconnect
          console.log('Pod shutting down (1001), attempting reconnect...');
          scheduleReconnect();
        } else {
          console.error('WebSocket closed unexpectedly', event.code);
          scheduleReconnect();
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnected(false);
        scheduleReconnect();
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to establish WebSocket:', error);
      scheduleReconnect();
    }
  };

  // Exponential backoff reconnection
  const scheduleReconnect = () => {
    setConnected(false);
    setReconnecting(true);

    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    const delayMs = Math.min(
      1000 * Math.pow(2, reconnectAttemptsRef.current),
      30000
    );
    const jitterMs = Math.random() * 1000; // Full-jitter

    console.log(`Reconnecting in ${delayMs + jitterMs}ms...`);

    setTimeout(() => {
      reconnectAttemptsRef.current++;
      connect();
    }, delayMs + jitterMs);
  };

  const sendMessage = (event: string, payload: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: event,
          payload,
        })
      );
    } else {
      console.warn('WebSocket not open, message not sent:', event);
    }
  };

  // Initialize connection on mount
  useEffect(() => {
    connect();

    return () => {
      vehicleTracker.destroy();
      wsRef.current?.close();
    };
  }, []);

  return (
    <WebSocketContext.Provider value={{ vehicleTracker, sendMessage }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within ResilientWebSocketProvider');
  }
  return context;
};
```

---

## Part 3: Neo-Brutalist Swipe Gesture Components

### The SlideToConfirm Component (Driver Actions)

**File:** `src/components/SlideToConfirm.tsx`

```tsx
'use client';
import { motion } from 'framer-motion';
import { useRef, useState } from 'react';
import { Haptics } from '@capacitor/haptics';

interface SlideToConfirmProps {
  label: string;
  onConfirm: () => Promise<void>;
  color?: 'emerald' | 'red' | 'blue';
  disabled?: boolean;
}

export function SlideToConfirm({
  label,
  onConfirm,
  color = 'emerald',
  disabled = false,
}: SlideToConfirmProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [dragX, setDragX] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const trackWidth = 300;
  const thumbWidth = 60;
  const threshold = trackWidth - thumbWidth; // Must drag to 80%+

  const colorMap = {
    emerald: 'bg-emerald-500 hover:bg-emerald-600',
    red: 'bg-red-500 hover:bg-red-600',
    blue: 'bg-blue-500 hover:bg-blue-600',
  };

  const handleDragEnd = async () => {
    if (dragX >= threshold * 0.8) {
      // Confirm action
      setIsLoading(true);

      try {
        // Haptic feedback on confirm
        await Haptics.impact({ style: 'Medium' });

        // Call the async action
        await onConfirm();

        // Success feedback
        await Haptics.notification({ type: 'Success' });
        setDragX(0);
      } catch (error) {
        console.error('Action failed:', error);
        await Haptics.notification({ type: 'Error' });
        setDragX(0);
      } finally {
        setIsLoading(false);
      }
    } else {
      // Snap back
      setDragX(0);
    }
  };

  const progress = dragX / (threshold * 0.8);

  return (
    <div ref={trackRef} className="w-full">
      <motion.div
        className={`relative h-16 rounded-lg ${colorMap[color]} flex items-center justify-center overflow-hidden ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        {/* Background tint at threshold */}
        {progress > 0.7 && (
          <div
            className="absolute inset-0 bg-white opacity-10"
            style={{
              backgroundColor: `rgba(255, 255, 255, ${(progress - 0.7) * 0.5})`,
            }}
          />
        )}

        {/* Label text */}
        <span className="text-white font-bold text-lg z-10 pointer-events-none">
          {isLoading ? 'Processing...' : label}
        </span>

        {/* Draggable thumb */}
        <motion.div
          drag="x"
          dragConstraints={{ left: 0, right: threshold }}
          onDrag={(_, info) => setDragX(info.x)}
          onDragEnd={handleDragEnd}
          className={`absolute left-2 w-12 h-12 bg-white rounded-lg z-20 ${
            isLoading ? 'opacity-50' : 'cursor-grab active:cursor-grabbing'
          }`}
          disabled={disabled || isLoading}
          animate={{
            x: dragX,
            opacity: isLoading ? 0.5 : 1,
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          {/* Inner indicator */}
          <div className="absolute inset-2 flex items-center justify-center">
            <div className="text-sm font-bold text-gray-800">{'→'}</div>
          </div>
        </motion.div>
      </motion.div>

      {/* Progress indicator text */}
      {dragX > 0 && (
        <p className="text-xs text-gray-500 mt-2">
          {Math.round(progress * 100)}% — {Math.round(threshold * 0.8 - dragX)}px to go
        </p>
      )}
    </div>
  );
}
```

---

### The RadialCountdown Component (Offer Timer)

**File:** `src/components/RadialCountdown.tsx`

```tsx
'use client';
import { useEffect, useState } from 'react';

interface RadialCountdownProps {
  expiresAt: number; // Unix timestamp (ms) when offer expires
  onExpire: () => void;
}

export function RadialCountdown({ expiresAt, onExpire }: RadialCountdownProps) {
  const [remaining, setRemaining] = useState(0);

  const radius = 60;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const delta = expiresAt - now;

      if (delta <= 0) {
        setRemaining(0);
        onExpire();
        return;
      }

      setRemaining(delta);
    };

    tick(); // Initial call
    const interval = setInterval(tick, 100);

    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const duration = 15000; // 15 seconds in ms
  const progress = Math.max(0, Math.min(1, (duration - remaining) / duration));
  const strokeDashoffset = circumference * (1 - progress);

  // Color gradient: Green → Amber → Red
  let color = '#10B981'; // Emerald
  if (remaining < 10000) color = '#F59E0B'; // Amber
  if (remaining < 5000) color = '#EF4444'; // Red

  const seconds = Math.ceil(remaining / 1000);

  return (
    <div className="flex flex-col items-center justify-center">
      <svg width="150" height="150" viewBox="0 0 150 150" className="mb-4">
        {/* Background circle */}
        <circle
          cx="75"
          cy="75"
          r={radius}
          fill="none"
          stroke="#E5E7EB"
          strokeWidth="4"
        />

        {/* Progress circle */}
        <circle
          cx="75"
          cy="75"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{
            transition: 'stroke-dashoffset 0.1s linear, stroke 0.3s ease',
            transform: 'rotate(-90deg)',
            transformOrigin: '75px 75px',
          }}
        />

        {/* Center text */}
        <text
          x="75"
          y="75"
          textAnchor="middle"
          dy="0.3em"
          fontSize="32"
          fontWeight="bold"
          fill={color}
          style={{ transition: 'fill 0.3s ease' }}
        >
          {seconds}s
        </text>
      </svg>

      <p className="text-sm text-gray-600">Time remaining to accept offer</p>
    </div>
  );
}
```

---

## Part 4: Connection Resilience Mask

### ReconnectingOverlay Component

**File:** `src/components/ReconnectingOverlay.tsx`

```tsx
'use client';
import { useAppState } from '@/lib/store/useAppState';

export function ReconnectingOverlay() {
  const isReconnecting = useAppState((s) => s.isReconnecting);

  if (!isReconnecting) return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* Glassmorphic overlay */}
      <div className="absolute inset-0 bg-white/20 backdrop-blur-sm" />

      {/* Center content */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          {/* Pulsing dot animation */}
          <div className="flex gap-2 justify-center mb-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"
                style={{ animationDelay: `${i * 0.1}s` }}
              />
            ))}
          </div>

          <p className="text-gray-700 font-medium">Acquiring GPS Signal...</p>
          <p className="text-xs text-gray-500 mt-2">Connection re-establishing</p>
        </div>
      </div>
    </div>
  );
}
```

**Usage in Layout:**
```tsx
// In your root layout or app wrapper
import { ReconnectingOverlay } from '@/components/ReconnectingOverlay';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ResilientWebSocketProvider>
          {children}
          <ReconnectingOverlay />
        </ResilientWebSocketProvider>
      </body>
    </html>
  );
}
```

---

## Part 5: Implementation Roadmap for Agents

### Phase 1: State Architecture (Week 1)
**Goal:** Establish Zustand store + VehicleTracker without touching map components.

**Steps:**
1. Create `src/lib/store/useAppState.ts` (copy code from Part 1)
2. Create `src/lib/VehicleTracker.ts` (copy code from Part 1)
3. Write unit tests for VehicleTracker:
   - Push coordinate batches
   - Verify interpolation math (linear lerp)
   - Verify no React re-renders
4. Integrate into layout: wrap app with Zustand store provider
5. Create test component that subscribes to store slices

**Success Metrics:**
- Zustand store works without errors
- VehicleTracker processes 4-second batches smoothly
- No console warnings

---

### Phase 2: WebSocket Provider (Week 2)
**Goal:** Establish resilient WebSocket connection with mock data.

**Steps:**
1. Create `src/lib/providers/ResilientWebSocketProvider.tsx` (copy from Part 2)
2. Mock WebSocket server locally (use `ws-echo` or mock fixture)
3. Test incoming events:
   - `driver.location.updated` → VehicleTracker.pushCoordinate()
   - `order.assigned` → Zustand setOrderStatus()
   - `surge.zone.updated` → Zustand setSurgeMultiplier()
4. Verify Zustand updates propagate to subscribed components
5. Test pod failover: send `CloseGoingAway` (1001) and verify reconnect

**Success Metrics:**
- WebSocket connects without errors
- Mock events update Zustand store
- Reconnection logic works (simulate network drop)
- No error alerts in console

---

### Phase 3: Swipe Gesture & Neo-Brutalism (Week 3)
**Goal:** Build driver-facing swipe controls.

**Steps:**
1. Create `src/components/SlideToConfirm.tsx` (copy from Part 3)
2. Create `src/components/RadialCountdown.tsx` (copy from Part 3)
3. Test on real mobile device (iOS + Android via Capacitor)
   - Swipe gesture must drag smoothly (60 FPS)
   - Haptic feedback must fire on threshold + confirm
4. Mock API calls (POST /api/v1/trip/start)
5. Verify loading state blocks re-swipes

**Success Metrics:**
- Swipe gesture responsive (< 50ms latency)
- Haptic feedback triggers on device
- Timer countdown accurate (no clock drift)
- Locked state prevents double-submission

---

### Phase 4: Map Integration (Week 4)
**Goal:** Render Mapbox with smooth vehicle interpolation.

**Steps:**
1. Create `src/components/InterpolatedMapComponent.tsx`
2. Initialize Mapbox GL JS
3. Register VehicleTracker.onUpdate() callback
4. Verify marker glides smoothly (60 FPS, no jank)
5. Test with real WebSocket events (not mock)

**Success Metrics:**
- Marker animates smoothly between coordinates
- Map is interactive (pan/zoom) while animation plays
- Bottom sheet updates (Zustand) don't affect marker animation
- Battery drain is minimal (profile with DevTools)

---

### Phase 5: Connection Resilience Mask (Week 5)
**Goal:** Implement graceful reconnection UX.

**Steps:**
1. Create `src/components/ReconnectingOverlay.tsx` (copy from Part 4)
2. Test WebSocket disconnect scenarios:
   - Network down (toggle airplane mode)
   - Pod failover (kill backend container)
   - Timeout (close connection without close frame)
3. Verify overlay appears only briefly (no long frozen screens)
4. Test TelemetryRingBuffer flush on reconnect (ledger accuracy)

**Success Metrics:**
- Overlay appears on disconnect (glassmorphic, non-intrusive)
- Connection re-established within 10 seconds
- No data loss during disconnect
- Ledger remains balanced after reconnect

---

## Part 6: Testing Checklist

### Unit Tests
- [ ] VehicleTracker.pushCoordinate() queues batches correctly
- [ ] Linear interpolation math is accurate
- [ ] requestAnimationFrame loop never blocks
- [ ] Zustand store slices update independently

### Integration Tests
- [ ] WebSocket connects + receives events
- [ ] Zustand updates trigger component re-renders only in subscribed components
- [ ] VehicleTracker.onUpdate() fires every frame
- [ ] Marker position updates without re-rendering bottom sheet

### Mobile Tests (Capacitor)
- [ ] Swipe gesture works on real iPhone + Android
- [ ] Haptic feedback fires on device
- [ ] WebSocket stays open while app backgrounded
- [ ] GPS coordinates update while screen is off

### Performance Tests
- [ ] Map marker glides at 60 FPS (no dropped frames)
- [ ] Battery drain < 2% per hour (idle with active connection)
- [ ] Memory usage stable (no leaks in VehicleTracker)
- [ ] WebSocket reconnection < 5 seconds (with backoff)

---

## Conclusion

This architecture solves the core tension: **high-frequency backend events + React reactivity without jank.**

**Key Insights:**
1. **Zustand** manages app state (enums, metadata) → triggers UI updates
2. **VehicleTracker** manages coordinates (mutable refs) → bypasses React entirely
3. **requestAnimationFrame** loop ensures 60 FPS map interpolation
4. **ResilientWebSocketProvider** handles failover + reconnection silently
5. **SlideToConfirm** prevents accidental driver actions

**For agents:** Start with Phase 1 (Zustand + VehicleTracker). Once store state flows correctly, add WebSocket. Map integration is trivial once these layers work.

**For performance:** Profile continuously. Every re-render, every WebSocket dispatch, every interpolation frame matters on mobile.

---

**Document Version:** 1.0  
**Last Updated:** 2026-05-30  
**Status:** Agent-Ready Implementation Guide
