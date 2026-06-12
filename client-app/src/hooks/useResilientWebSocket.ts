import { useEffect, useState, useRef, useCallback } from 'react';
import { ResilientStreamManager } from '../network/ResilientStreamManager';

export function useResilientWebSocket(orderID: string, cityPrefix: string, active: boolean = true) {
  const [status, setStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING' | 'OFFLINE'>('DISCONNECTED');
  const [messages, setMessages] = useState<unknown[]>([]);
  const [lastMessage, setLastMessage] = useState<unknown | null>(null);
  
  const streamManagerRef = useRef<ResilientStreamManager | null>(null);

  useEffect(() => {
    if (!active || !orderID) {
      if (streamManagerRef.current) {
        streamManagerRef.current.disconnect();
        streamManagerRef.current = null;
        setStatus('DISCONNECTED');
      }
      return;
    }

    const manager = new ResilientStreamManager({
      orderID,
      cityPrefix,
      onStatusChange: (newStatus) => {
        setStatus(newStatus);
      },
      onMessage: (data) => {
        setLastMessage(data);
        setMessages((prev) => [...prev, data]);
      },
    });

    streamManagerRef.current = manager;
    manager.connect();

    return () => {
      if (streamManagerRef.current) {
        streamManagerRef.current.disconnect();
        streamManagerRef.current = null;
        setStatus('DISCONNECTED');
      }
    };
  }, [orderID, cityPrefix, active]);

  // Manual retry for the OFFLINE state — resets the backoff and reconnects.
  const reconnect = useCallback(() => {
    streamManagerRef.current?.retry();
  }, []);

  return { status, messages, lastMessage, reconnect };
}
