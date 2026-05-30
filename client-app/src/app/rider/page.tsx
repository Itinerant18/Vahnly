'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import MapInterpolated, { MapDriver } from '../../components/MapInterpolated';
import { useResilientWebSocket } from '../../hooks/useResilientWebSocket';
import { ClientCoreEngine } from '../../network/ClientCoreEngine';

export default function RiderPage() {
  const [cityPrefix] = useState('KOL');
  
  // Rider state machine: 'idle' | 'pricing' | 'requesting' | 'assigned' | 'completed'
  const [rideState, setRideState] = useState<'idle' | 'pricing' | 'requesting' | 'assigned' | 'completed'>('idle');
  
  // Trip details
  const [pickup, setPickup] = useState<{ name: string; lat: number; lng: number } | null>(null);
  const [destination, setDestination] = useState<{ name: string; lat: number; lng: number } | null>(null);
  const [surgeMultiplier, setSurgeMultiplier] = useState(1.0);
  const [fareEstimate, setFareEstimate] = useState(0);
  const [orderID, setOrderID] = useState('');
  
  // Driver states
  const [activeDrivers, setActiveDrivers] = useState<MapDriver[]>([]);
  const [assignedDriver, setAssignedDriver] = useState<MapDriver | null>(null);

  // Mock active drivers for discovery phase
  useEffect(() => {
    if (rideState === 'idle' || rideState === 'pricing') {
      const interval = setInterval(() => {
        // Simulating 5 available drivers circling nearby
        const mockDrivers: MapDriver[] = Array.from({ length: 5 }).map((_, i) => {
          const angle = (Date.now() / 6000) + (i * Math.PI * 2) / 5;
          const radius = 0.005 + (i * 0.001);
          return {
            id: `drv-online-00${i + 1}`,
            latitude: 22.5726 + radius * Math.cos(angle),
            longitude: 88.3639 + radius * Math.sin(angle),
            bearing: (angle * 180) / Math.PI,
            speed: 15 + i * 5,
          };
        });
        setActiveDrivers(mockDrivers);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [rideState]);

  // WebSocket Subscription Loop
  const { status: wsStatus, lastMessage } = useResilientWebSocket(
    orderID,
    cityPrefix,
    rideState === 'requesting' || rideState === 'assigned'
  );

  // Monitor incoming matching messages
  useEffect(() => {
    if (lastMessage) {
      const msg = lastMessage as { event: string; payload?: { driver_id?: string; latitude?: number; longitude?: number; bearing?: number; speed?: number } };
      
      if (msg.event === 'order.assigned' && msg.payload) {
        setRideState('assigned');
        const drvId = msg.payload.driver_id ?? 'drv-reconciled-99';
        setAssignedDriver({
          id: drvId,
          latitude: msg.payload.latitude ?? 22.574,
          longitude: msg.payload.longitude ?? 88.365,
          bearing: msg.payload.bearing ?? 45,
          speed: msg.payload.speed ?? 30,
        });
      } else if (msg.event === 'driver.location.updated' && msg.payload && rideState === 'assigned') {
        // Continuous updates glide vehicle across client map
        setAssignedDriver((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            latitude: msg.payload?.latitude ?? prev.latitude,
            longitude: msg.payload?.longitude ?? prev.longitude,
            bearing: msg.payload?.bearing ?? prev.bearing,
            speed: msg.payload?.speed ?? prev.speed,
          };
        });
      }
    }
  }, [lastMessage, rideState]);

  // Animate assigned driver moving towards the pickup point
  useEffect(() => {
    if (rideState === 'assigned' && assignedDriver && pickup) {
      // Feed assigned driver details to the rendering map component
      setActiveDrivers([assignedDriver]);

      // Mock progress to pickup (simulating driver movement if stream is quiet)
      const interval = setInterval(() => {
        setAssignedDriver((prev) => {
          if (!prev) return null;
          const latDiff = pickup.lat - prev.latitude;
          const lngDiff = pickup.lng - prev.longitude;
          const dist = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
          
          if (dist < 0.0005) {
            clearInterval(interval);
            setTimeout(() => setRideState('completed'), 2000);
            return prev;
          }

          // Advance towards pickup by 10% on each iteration
          const bearing = (Math.atan2(latDiff, lngDiff) * 180) / Math.PI;
          return {
            ...prev,
            latitude: prev.latitude + latDiff * 0.1,
            longitude: prev.longitude + lngDiff * 0.1,
            bearing,
            speed: 40,
          };
        });
      }, 4000); // Trigger every 4 seconds to match backend ingestion bounds

      return () => clearInterval(interval);
    }
  }, [rideState, pickup]);

  // Request Quote API Hook
  const handleSelectRoute = async (routeId: number) => {
    let pName = 'Salt Lake City, Sector V';
    let pLat = 22.5726;
    let pLng = 88.3639;
    let dName = 'Park Street Operations Hub';
    let dLat = 22.5535;
    let dLng = 88.3512;

    if (routeId === 2) {
      pName = 'Howrah Junction Terminal';
      pLat = 22.5855;
      pLng = 88.3415;
    }

    setPickup({ name: pName, lat: pLat, lng: pLng });
    setDestination({ name: dName, lat: dLat, lng: dLng });
    setRideState('pricing');

    // Simulate backend pricing client lookup
    const client = new ClientCoreEngine(cityPrefix);
    try {
      // Mocked endpoint execution query
      const response = await client.executeRequest<{ active_surge_multiplier: number; base_fare_paise: number }>({
        method: 'GET',
        path: `/api/v1/pricing/quote?pickup_lat=${pLat}&pickup_lng=${pLng}&drop_lat=${dLat}&drop_lng=${dLng}`,
      }).catch(() => {
        // Fallback pricing if backend compose stack is not fully warm
        return { active_surge_multiplier: 1.4, base_fare_paise: 25000 };
      });

      setSurgeMultiplier(response.active_surge_multiplier);
      setFareEstimate((response.base_fare_paise / 100) * response.active_surge_multiplier);
    } catch {
      setSurgeMultiplier(1.4);
      setFareEstimate(350);
    }
  };

  // Submit Order Creation to gRPC Ingestion & Kafka
  const handleRequestRide = async () => {
    if (!pickup || !destination) return;
    setRideState('requesting');
    
    // Generate order ID
    const newOrderID = `ord-${Math.floor(Math.random() * 900000 + 100000)}`;
    setOrderID(newOrderID);

    const client = new ClientCoreEngine(cityPrefix);
    try {
      await client.executeRequest<{ status: string }>({
        method: 'POST',
        path: '/api/v1/orders',
        useIdempotency: true,
        body: {
          order_id: newOrderID,
          pickup_latitude: pickup.lat,
          pickup_longitude: pickup.lng,
          drop_latitude: destination.lat,
          drop_longitude: destination.lng,
          city_prefix: cityPrefix,
        },
      }).catch(() => {
        // Fallback simulate matching
        console.warn('Backend stack disconnected; triggering loopback simulation matches.');
      });
    } catch {
      // Silent catch to handle offline local development gracefully
    }

    // Loopback simulated matching trigger for un-orchestrated sandboxes
    setTimeout(() => {
      // If still in requesting state, force match completion
      setRideState((curr) => {
        if (curr === 'requesting') {
          setAssignedDriver({
            id: 'drv-offline-99',
            latitude: pickup.lat + 0.01,
            longitude: pickup.lng - 0.01,
            bearing: 120,
            speed: 45,
          });
          return 'assigned';
        }
        return curr;
      });
    }, 9000);
  };

  const handleReset = () => {
    setRideState('idle');
    setPickup(null);
    setDestination(null);
    setOrderID('');
    setAssignedDriver(null);
  };

  return (
    <main className="min-h-screen bg-white text-ink flex flex-col md:flex-row antialiased font-sans selection:bg-black selection:text-white">
      
      {/* 1. Left Control Panel: Core Rides Panel UI */}
      <section className="w-full md:w-[380px] p-6 flex flex-col justify-between border-b md:border-b-0 md:border-r border-canvas-soft bg-white z-10">
        
        {/* Top Header */}
        <div>
          <div className="flex items-center justify-between mb-8">
            <Link href="/" className="flex items-center gap-2 group">
              <span className="text-xs font-bold text-mute group-hover:text-ink transition">←</span>
              <h1 className="text-xl font-bold tracking-tight text-ink font-move">
                drivers-for-u
              </h1>
            </Link>
            <span className="px-2.5 py-0.5 rounded-full border border-surface-pressed bg-canvas-soft text-[10px] font-bold text-ink tracking-wider uppercase">
              Rider portal
            </span>
          </div>

          {/* Idle State: Destination Selector */}
          {rideState === 'idle' && (
            <div className="space-y-4 animate-in">
              <h2 className="text-lg font-bold text-ink font-move">Where are you heading?</h2>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => handleSelectRoute(1)}
                  className="w-full p-5 rounded-xl text-left border border-canvas-soft bg-canvas-softer hover:border-ink hover:bg-white transition duration-200 group cursor-pointer"
                >
                  <div className="font-bold text-ink group-hover:text-black font-move">Sector V Office Hub</div>
                  <div className="text-xs text-body mt-1">From Sector V → Park Street Hub</div>
                </button>

                <button
                  onClick={() => handleSelectRoute(2)}
                  className="w-full p-5 rounded-xl text-left border border-canvas-soft bg-canvas-softer hover:border-ink hover:bg-white transition duration-200 group cursor-pointer"
                >
                  <div className="font-bold text-ink group-hover:text-black font-move">Howrah Junction Terminal</div>
                  <div className="text-xs text-body mt-1">From Howrah Station → Park Street Hub</div>
                </button>
              </div>
            </div>
          )}

          {/* Pricing State: Quote Breakdown */}
          {rideState === 'pricing' && pickup && destination && (
            <div className="space-y-6 animate-in">
              <h2 className="text-lg font-bold text-ink font-move">Select a ride option</h2>
              
              <div className="p-5 rounded-xl border border-canvas-soft bg-canvas-softer space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-ink text-base font-move">Classic journey</h3>
                    <p className="text-xs text-body mt-0.5">Reliable door-to-door dispatch comfort</p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-ink font-move">₹{fareEstimate.toFixed(2)}</div>
                    <div className="text-[10px] text-mute uppercase font-semibold">Fare estimate</div>
                  </div>
                </div>

                {/* Dynamic Surge Warning Badge */}
                {surgeMultiplier > 1.0 && (
                  <div className="flex items-center gap-2.5 p-3 rounded-lg border border-black/10 bg-black text-white shadow-sm">
                    <svg className="w-4 h-4 fill-none stroke-current" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                    </svg>
                    <span className="text-[10px] font-bold uppercase tracking-wider">
                      Surge active: x{surgeMultiplier.toFixed(2)} multiplier
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleReset}
                  className="flex-1 py-3.5 rounded-full border border-canvas-soft bg-white font-semibold text-ink hover:bg-canvas-softer transition duration-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRequestRide}
                  className="flex-1 py-3.5 rounded-full bg-black text-white font-semibold hover:bg-black-elevated transition duration-200 cursor-pointer"
                >
                  Request ride
                </button>
              </div>
            </div>
          )}

          {/* Requesting State: Radar Matching Console */}
          {rideState === 'requesting' && (
            <div className="space-y-6 animate-in">
              <div className="p-6 rounded-xl border border-canvas-soft bg-canvas-softer text-center space-y-4">
                <div className="relative w-12 h-12 mx-auto flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border border-black/20 animate-ping" />
                  <div className="w-10 h-10 rounded-full border border-black flex items-center justify-center bg-black/5">
                    <svg className="w-4 h-4 text-black animate-spin" fill="none" strokeWidth="3.5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                </div>
                <div>
                  <h3 className="font-bold text-ink text-base font-move">Booking radar active</h3>
                  <p className="text-xs text-body mt-1">Hungarian dispatch solver searching available drivers...</p>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-canvas-soft bg-black font-mono text-[9px] text-canvas-soft space-y-1.5 max-h-[160px] overflow-y-auto leading-relaxed shadow-inner">
                <div>[SYSTEM] Inbound order created: {orderID}</div>
                <div>[KAFKA] Order committed to order.created</div>
                <div>[SOLVER] EWMA batch window set to 300ms</div>
                <div className="animate-pulse text-white font-semibold">[HUNGARIAN] Scanning bipartite driver matching vectors...</div>
              </div>
            </div>
          )}

          {/* Assigned State: Ride Active */}
          {rideState === 'assigned' && assignedDriver && (
            <div className="space-y-6 animate-in">
              <h2 className="text-lg font-bold text-ink font-move">Meet your driver</h2>
              
              <div className="p-5 rounded-xl border border-canvas-soft bg-canvas-softer space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center text-white font-bold text-xs select-none">
                    DR
                  </div>
                  <div>
                    <h3 className="font-bold text-ink font-move">Driver partner assigned</h3>
                    <p className="text-xs text-body mt-0.5">Vehicle reference: {assignedDriver.id}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3.5 rounded-lg border border-canvas-soft bg-white text-xs">
                  <span className="text-body font-semibold">Estimated arrival</span>
                  <span className="font-bold text-black uppercase tracking-wide">3 Mins Away</span>
                </div>
              </div>
            </div>
          )}

          {/* Completed State: Arrival */}
          {rideState === 'completed' && (
            <div className="space-y-6 animate-in text-center">
              <div className="p-6 rounded-xl border border-canvas-soft bg-canvas-softer space-y-5">
                <div className="w-12 h-12 rounded-full bg-black mx-auto flex items-center justify-center text-white font-bold text-xl select-none">
                  ✓
                </div>
                <div>
                  <h3 className="font-bold text-ink text-lg font-move">Arrival successful!</h3>
                  <p className="text-xs text-body mt-1">Thank you for riding with drivers-for-u.</p>
                </div>
                <button
                  onClick={handleReset}
                  className="w-full py-3 rounded-full bg-black hover:bg-black-elevated font-semibold text-white transition duration-200 cursor-pointer"
                >
                  Book another ride
                </button>
              </div>
            </div>
          )}

        </div>

        {/* WebSocket Graceful Reconnection Mask */}
        {(rideState === 'requesting' || rideState === 'assigned') && (
          <div className="mt-6 border-t border-canvas-soft pt-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${
                wsStatus === 'CONNECTED' ? 'bg-black' :
                wsStatus === 'RECONNECTING' ? 'bg-mute animate-pulse' : 'bg-mute'
              }`} />
              <span className="text-[10px] text-body font-bold uppercase tracking-wider">
                Stream: {wsStatus}
              </span>
            </div>
            {wsStatus === 'RECONNECTING' && (
              <span className="text-[10px] text-ink font-bold animate-pulse uppercase tracking-wider">
                Reconnecting...
              </span>
            )}
          </div>
        )}

      </section>
      
      {/* 2. Right Canvas Map View Panel */}
      <section className="flex-1 h-[450px] md:h-screen relative p-4 bg-canvas-softer">
        <MapInterpolated
          drivers={activeDrivers}
          pickup={pickup}
          destination={destination}
        />

        {/* Global Connection Draining Banner */}
        {wsStatus === 'RECONNECTING' && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-50 p-6">
            <div className="p-8 rounded-xl border border-canvas-soft bg-white shadow-xl text-center space-y-4 max-w-sm">
              <div className="w-8 h-8 rounded-full border-2 border-canvas-soft border-t-black animate-spin mx-auto" />
              <h3 className="font-bold text-ink text-base font-move">Reconnecting stream</h3>
              <p className="text-xs text-body leading-relaxed">
                Pod scale-down completed. Re-homing WebSocket to an alternate healthy replica gateway cleanly...
              </p>
            </div>
          </div>
        )}
      </section>

    </main>
  );
}
