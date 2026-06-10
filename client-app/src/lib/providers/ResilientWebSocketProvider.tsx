'use client';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAppState } from '@/lib/store/useAppState';
import { VehicleTracker } from '@/lib/VehicleTracker';
import { WS_GATEWAY_BASE_URL } from '@/config';
import { useAuthStore } from '@/store/useAuthStore';
import { fetchWsTicket } from '@/services/dispatchStream';

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

      const wsUrl = process.env.NEXT_PUBLIC_WS_GATEWAY || WS_GATEWAY_BASE_URL;
      const jwtToken = useAuthStore.getState().token;
      if (!jwtToken) {
        setReconnecting(false);
        setConnected(false);
        return;
      }

      // Mint a single-use ticket (JWT in the Authorization header) and connect with
      // ?ticket= so the long-lived token never lands in the WebSocket URL or logs.
      let ticket: string;
      try {
        ticket = await fetchWsTicket(jwtToken);
      } catch {
        scheduleReconnect();
        return;
      }

      const ws = new WebSocket(`${wsUrl}/api/v1/dispatch/stream?ticket=${encodeURIComponent(ticket)}`);

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
