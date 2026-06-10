import React, { useState, useEffect, useRef } from 'react';
import { API_GATEWAY_BASE_URL } from '../config';
import { ResilientStreamManager } from '../network/ResilientStreamManager';

export interface ActiveOrderRecord {
  id: string;
  city_prefix: string;
  customer_id: string;
  status: 'CREATED' | 'ASSIGNED' | 'EN_ROUTE_TO_PICKUP' | 'DELIVERING' | 'COMPLETED' | 'CANCELLED';
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  pickup_h3_cell: string;
  assigned_driver_id: string | null;
  surge_multiplier: number;
  base_fare_paise: number;
  created_at: string;
  assigned_at: string | null;
}

export const ActiveTripRadar: React.FC = () => {
  const [orders, setOrders] = useState<ActiveOrderRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<{ status: 'SUCCESS' | 'ERROR'; text: string } | null>(null);
  
  // Track WebSocket connection statuses and instances reactively
  const [streamStatuses, setStreamStatuses] = useState<Record<string, 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING'>>({});
  const activeStreamsRef = useRef<Record<string, ResilientStreamManager>>({});

  // Stagnant-asset watchdog: record the last telemetry timestamp per active order
  // and flag any that have gone silent past the threshold — i.e. a driver whose
  // stream may still read CONNECTED but has stopped reporting position ("phantom").
  const STAGNANT_THRESHOLD_MS = 45000;
  const lastSeenRef = useRef<Map<string, number>>(new Map());
  // Last applied telemetry timestamp per order — guards against stale/out-of-order frames
  // (e.g. replays or reordering after a reconnect) overwriting a fresher position.
  const lastTelemetryTsRef = useRef<Map<string, number>>(new Map());
  const [stagnantOrders, setStagnantOrders] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchActiveOrders();
    const interval = setInterval(fetchActiveOrders, 10000); // Auto-refresh order records list every 10 seconds
    return () => clearInterval(interval);
  }, []);

  // Synchronize WebSocket stream connections for active orders
  useEffect(() => {
    const activeOrders = orders.filter(o => o.status !== 'COMPLETED' && o.status !== 'CANCELLED');
    const activeOrderIds = new Set(activeOrders.map(o => o.id));

    // 1. Tear down streams for orders that are no longer active or have been evicted
    Object.keys(activeStreamsRef.current).forEach(orderId => {
      if (!activeOrderIds.has(orderId)) {
        console.log(`[RADAR_STREAM] Teardown telemetry channel for Order: ${orderId}`);
        activeStreamsRef.current[orderId].disconnect();
        delete activeStreamsRef.current[orderId];
        lastSeenRef.current.delete(orderId);
        lastTelemetryTsRef.current.delete(orderId);
        setStreamStatuses(prev => {
          const next = { ...prev };
          delete next[orderId];
          return next;
        });
      }
    });

    // 2. Instantiate and connect telemetry streams for newly discovered active orders
    activeOrders.forEach(order => {
      if (!activeStreamsRef.current[order.id]) {
        console.log(`[RADAR_STREAM] Init live telemetry stream for Order: ${order.id} (Region: ${order.city_prefix})`);
        
        const manager = new ResilientStreamManager({
          orderID: order.id,
          cityPrefix: order.city_prefix,
          onMessage: (data: any) => {
            if (!data) return;
            // Heartbeat: any packet means the asset is still reporting in (connection alive),
            // even if its payload is stale.
            lastSeenRef.current.set(order.id, Date.now());

            // Drop stale/out-of-order telemetry: only apply a frame strictly newer than the
            // last one we rendered for this order, so a replayed/reordered packet after a
            // reconnect cannot move the dot backwards or show an old position as live.
            if (data.channel === 'telemetry' && typeof data.timestamp_utc === 'number') {
              const lastTs = lastTelemetryTsRef.current.get(order.id) ?? 0;
              if (data.timestamp_utc <= lastTs) {
                return;
              }
              lastTelemetryTsRef.current.set(order.id, data.timestamp_utc);
            }

            setOrders(prevOrders => {
              return prevOrders.map(o => {
                if (o.id !== order.id) return o;

                if (data.channel === 'telemetry') {
                  // Live update coordinates dynamically inside state as they arrive from WebSocket stream
                  return {
                    ...o,
                    pickup_lat: data.latitude ?? o.pickup_lat,
                    pickup_lng: data.longitude ?? o.pickup_lng,
                  };
                } else if (data.channel === 'assignment') {
                  // Live update driver/assignment status
                  return {
                    ...o,
                    status: (data.status as any) ?? o.status,
                    assigned_driver_id: data.driver_id ?? o.assigned_driver_id,
                  };
                }
                return o;
              });
            });
          },
          onStatusChange: (status) => {
            setStreamStatuses(prev => ({
              ...prev,
              [order.id]: status,
            }));
          },
        });
        
        // Seed the heartbeat at connect time so a stream that connects but never
        // emits telemetry still trips the watchdog after the threshold elapses.
        lastSeenRef.current.set(order.id, Date.now());
        activeStreamsRef.current[order.id] = manager;
        manager.connect();
      }
    });
  }, [orders]);

  // Clean up all WebSocket connections on unmount
  useEffect(() => {
    return () => {
      Object.values(activeStreamsRef.current).forEach(manager => {
        manager.disconnect();
      });
    };
  }, []);

  // Stagnant-asset watchdog loop: every 5s, flag active orders whose last
  // telemetry is older than the threshold. Recovery is automatic — a fresh
  // packet updates lastSeenRef and the next tick clears the flag.
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setStagnantOrders(prev => {
        const next = new Set<string>();
        for (const o of orders) {
          if (o.status === 'COMPLETED' || o.status === 'CANCELLED') continue;
          const last = lastSeenRef.current.get(o.id);
          if (last !== undefined && now - last > STAGNANT_THRESHOLD_MS) {
            next.add(o.id);
          }
        }
        // Skip the state update (and re-render) when the set is unchanged.
        if (next.size === prev.size && [...next].every(id => prev.has(id))) {
          return prev;
        }
        return next;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [orders]);

  const fetchActiveOrders = async () => {
    try {
      const token = localStorage.getItem('admin_jwt_token') ?? '';
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setOrders(data || []);
      } else if (import.meta.env.DEV) {
        // Dev-only mock fallback for offline/loopback testing — production shows an empty
        // radar on failure rather than fabricated "live" trips.
        setOrders([
          {
            id: 'ord-a0ee-bc99-9c0b',
            city_prefix: 'KOL',
            customer_id: 'cust-7731-abc',
            status: 'CREATED',
            pickup_lat: 22.5726,
            pickup_lng: 88.3639,
            dropoff_lat: 22.5800,
            dropoff_lng: 88.3700,
            pickup_h3_cell: '882834725dfffff',
            assigned_driver_id: null,
            surge_multiplier: 1.25,
            base_fare_paise: 35000,
            created_at: new Date(Date.now() - 45000).toISOString(),
            assigned_at: null,
          },
          {
            id: 'ord-f47a-c10b-58cc',
            city_prefix: 'KOL',
            customer_id: 'cust-9912-xyz',
            status: 'EN_ROUTE_TO_PICKUP',
            pickup_lat: 22.5680,
            pickup_lng: 88.3520,
            dropoff_lat: 22.6100,
            dropoff_lng: 88.3900,
            pickup_h3_cell: '8828347253fffff',
            assigned_driver_id: 'drv-mock-99',
            surge_multiplier: 1.00,
            base_fare_paise: 48000,
            created_at: new Date(Date.now() - 300000).toISOString(),
            assigned_at: new Date(Date.now() - 280000).toISOString(),
          },
          {
            id: 'ord-b3e8-5420-2a44',
            city_prefix: 'KOL',
            customer_id: 'cust-1102-pqr',
            status: 'DELIVERING',
            pickup_lat: 22.5900,
            pickup_lng: 88.3800,
            dropoff_lat: 22.5400,
            dropoff_lng: 88.3300,
            pickup_h3_cell: '8828347257fffff',
            assigned_driver_id: 'drv-mock-12',
            surge_multiplier: 1.50,
            base_fare_paise: 95000,
            created_at: new Date(Date.now() - 600000).toISOString(),
            assigned_at: new Date(Date.now() - 580000).toISOString(),
          }
        ]);
      } else {
        setOrders([]);
      }
    } catch (err) {
      console.error('Failed communicating with dispatch radar endpoints:', err);
    }
  };

  const handleForceCancelOrder = async (orderId: string) => {
    if (!window.confirm(
      `Force-cancel live trip ${orderId.slice(0, 8)}…?\n\n` +
      `This terminates an in-progress customer trip and releases the driver. This cannot be undone.`
    )) {
      return;
    }
    setIsLoading(true);
    setMessage(null);

    try {
      const token = localStorage.getItem('admin_jwt_token') ?? '';
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ order_id: orderId })
      });

      if (response.ok) {
        setMessage({
          status: 'SUCCESS',
          text: `Trip ${orderId.slice(0, 8)}... successfully terminated and driver released.`
        });
        // Remove or update the cancelled order record in local state
        setOrders(orders.filter(o => o.id !== orderId));
      } else {
        setMessage({ status: 'ERROR', text: 'Force cancellation was rejected by transaction gates.' });
      }
    } catch {
      setMessage({ status: 'ERROR', text: 'Gateway communication timeout occurred.' });
    } finally {
      setIsLoading(false);
    }
  };

  const renderStreamStatus = (order: ActiveOrderRecord) => {
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold font-sans uppercase tracking-wider text-zinc-500 bg-zinc-50 border border-zinc-200 select-none">
          ● Inactive
        </span>
      );
    }

    const status = streamStatuses[order.id];
    switch (status) {
      case 'CONNECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold font-sans uppercase tracking-wider text-emerald-600 bg-emerald-50 border border-emerald-200 select-none">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
            </span>
            Live Tracking
          </span>
        );
      case 'RECONNECTING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold font-sans uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-200 select-none">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
            </span>
            Reconnecting
          </span>
        );
      case 'DISCONNECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold font-sans uppercase tracking-wider text-rose-600 bg-rose-50 border border-rose-200 select-none">
            ● Offline
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold font-sans uppercase tracking-wider text-zinc-500 bg-zinc-50 border border-zinc-200 select-none">
            ● Standby
          </span>
        );
    }
  };

  return (
    <div className="bg-canvas-softer rounded-xl p-6 border border-canvas-soft shadow-sm space-y-4 lg:col-span-3">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-canvas-soft pb-4">
        <div>
          <h2 className="text-lg font-bold text-ink font-move flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-black opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-black"></span>
            </span>
            Real-time Active Trip Radar
          </h2>
          <p className="text-xs text-body">Live dispatch operations control-board & manual order cancellation overrides</p>
        </div>
        <button
          onClick={fetchActiveOrders}
          className="bg-white hover:bg-canvas-softer text-[10px] font-bold py-2 px-5 rounded-full border border-canvas-soft text-ink uppercase tracking-wider transition duration-200 cursor-pointer"
        >
          Refresh Radar
        </button>
      </div>

      {stagnantOrders.size > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-800 text-[11px] font-bold uppercase tracking-wider">
          <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
          {stagnantOrders.size} stagnant asset{stagnantOrders.size > 1 ? 's' : ''} — no telemetry for &gt;{STAGNANT_THRESHOLD_MS / 1000}s. Verify driver connectivity.
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-canvas-soft bg-white">
        <table className="w-full text-left text-xs font-mono border-collapse">
          <thead>
            <tr className="bg-canvas-softer text-mute uppercase text-[9px] font-bold border-b border-canvas-soft">
              <th className="p-4">Order ID</th>
              <th className="p-4">Region</th>
              <th className="p-4">H3 Pick-up Cell</th>
              <th className="p-4 text-center">Status</th>
              <th className="p-4">Assigned Driver</th>
              <th className="p-4 text-right">Multiplier</th>
              <th className="p-4 text-right">Fare Value</th>
              <th className="p-4 text-center">Connection State</th>
              <th className="p-4 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-canvas-soft text-ink">
            {orders.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-6 text-center text-body italic leading-relaxed">
                  Zero active bookings currently routed through matching channels.
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id} className={`transition ${stagnantOrders.has(order.id) ? 'bg-amber-50 hover:bg-amber-100/70' : 'hover:bg-canvas-softer/50'}`}>
                  <td className="p-4 text-body select-all">
                    <div>{order.id.slice(0, 18)}...</div>
                    {(order.status !== 'COMPLETED' && order.status !== 'CANCELLED') && (
                      <div className="text-[9px] text-mute font-normal mt-0.5">
                        Pos: {order.pickup_lat.toFixed(4)}, {order.pickup_lng.toFixed(4)}
                      </div>
                    )}
                  </td>
                  <td className="p-4">
                    <span className="bg-canvas-soft border border-surface-pressed text-ink px-2 py-0.5 rounded text-[10px] font-bold select-none">
                      {order.city_prefix}
                    </span>
                  </td>
                  <td className="p-4 font-bold text-body">{order.pickup_h3_cell}</td>
                  <td className="p-4 text-center">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                        order.status === 'CREATED'
                          ? 'bg-amber-100 text-amber-800'
                          : order.status === 'ASSIGNED' || order.status === 'EN_ROUTE_TO_PICKUP'
                          ? 'bg-blue-100 text-blue-800'
                          : order.status === 'DELIVERING'
                          ? 'bg-black text-white'
                          : 'bg-canvas-soft text-ink'
                      }`}
                    >
                      {order.status === 'CREATED' && (
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                      )}
                      {order.status}
                    </span>
                  </td>
                  <td className="p-4 text-body font-mono">
                    {order.assigned_driver_id ? (
                      <span className="bg-canvas-soft text-ink px-2 py-0.5 rounded text-[10px] font-bold">
                        {order.assigned_driver_id.slice(0, 12)}...
                      </span>
                    ) : (
                      <span className="text-mute italic text-[10px]">Unassigned</span>
                    )}
                  </td>
                  <td className="p-4 text-right font-bold font-mono">
                    {order.surge_multiplier.toFixed(2)}x
                  </td>
                  <td className="p-4 text-right font-bold font-mono">
                    ₹{(order.base_fare_paise / 100).toFixed(2)}
                  </td>
                  <td className="p-4 text-center">
                    {renderStreamStatus(order)}
                    {stagnantOrders.has(order.id) && (
                      <div className="mt-1">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100 border border-amber-300 animate-pulse select-none">
                          ⚠ Stagnant
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="p-4 text-center">
                    {order.status !== 'COMPLETED' && order.status !== 'CANCELLED' ? (
                      <button
                        onClick={() => handleForceCancelOrder(order.id)}
                        disabled={isLoading}
                        className="bg-black hover:bg-black-elevated disabled:opacity-40 text-white font-bold py-1.5 px-3.5 rounded-full transition text-[9px] uppercase tracking-wider active:scale-[0.98] cursor-pointer"
                      >
                        Force Cancel
                      </button>
                    ) : (
                      <span className="text-mute text-[9px] uppercase tracking-wider">Terminal</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {message && (
        <div className={`p-3 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider text-center ${
          message.status === 'SUCCESS' ? 'bg-canvas-soft border border-surface-pressed text-ink' : 'bg-black text-white'
        }`}>
          {message.text}
        </div>
      )}
    </div>
  );
};
