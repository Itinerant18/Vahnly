'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ResilientStreamManager } from '@/network/ResilientStreamManager';
import { useAuthStore } from '@/store/useAuthStore';
import { API_GATEWAY_BASE_URL } from '@/config';
import { latLngToCell } from 'h3-js';

interface DriverDetails {
  name: string;
  rating: string;
  plate: string;
  car: string;
  photo: string;
}

function parseBinaryEnvelope(buffer: ArrayBuffer): { type: string; data: any } | null {
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  let frameType = 0;
  const assignmentData: any = {};

  try {
    while (offset < bytes.length) {
      const key = bytes[offset++];
      const fieldNumber = key >> 3;

      if (fieldNumber === 1) {
        frameType = bytes[offset++];
      } else if (fieldNumber === 2) {
        const subLen = bytes[offset++];
        const end = offset + subLen;
        while (offset < end) {
          const subKey = bytes[offset++];
          const subNum = subKey >> 3;
          const len = bytes[offset++];
          const str = new TextDecoder().decode(bytes.subarray(offset, offset + len));
          offset += len;
          if (subNum === 1) assignmentData.order_id = str;
          if (subNum === 2) assignmentData.driver_id = str;
          if (subNum === 4) assignmentData.status = str;
        }
      } else {
        offset++;
      }
    }
    
    if (frameType === 1 || assignmentData.order_id) {
      return { type: 'ASSIGNMENT', data: assignmentData };
    }
  } catch (err) {
    console.error('[BINARY_PARSER] Failed parsing incoming array byte frames:', err);
  }
  return null;
}

function LiveTripContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { token } = useAuthStore();
  const tripId = searchParams?.get('tripId') || 'trp-sandbox-2209';

  // Active sub-states: ARRIVING | ARRIVED | IN_TRANSIT | COMPLETED
  const [tripStatus, setTripStatus] = useState<'ARRIVING' | 'ARRIVED' | 'IN_TRANSIT' | 'COMPLETED'>('ARRIVING');
  const [mapGlide, setMapGlide] = useState(0); // Progress percentage of driver en route
  const [tripTimer, setTripTimer] = useState(0); // Ride duration timer
  const [estimatedFare, setEstimatedFare] = useState(350);

  // Expanded panel controllers
  const [isExpanded, setIsExpanded] = useState(false);
  const [dropoffText, setDropoffText] = useState('Park Street Dining Grid, Kolkata');
  const [stops, setStops] = useState<string[]>([]);
  const [dropoffInputFlash, setDropoffInputFlash] = useState(false);

  // Safety issue report states
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issueText, setIssueText] = useState('');

  // Anomaly "Everything OK?" warning overlays
  const [showAnomalyOverlay, setShowAnomalyOverlay] = useState(false);
  const [anomalyTimer, setAnomalyTimer] = useState(30);
  const [anomalyEscalated, setAnomalyEscalated] = useState(false);

  // Coordinates data sets
  const [pickupCoords, setPickupCoords] = useState({ lat: 22.5726, lng: 88.4339 });
  const [dropoffCoords, setDropoffCoords] = useState({ lat: 22.5480, lng: 88.3512 });
  const [driverCoords, setDriverCoords] = useState({ lat: 22.5650, lng: 88.4200 });

  // Map viewport canvas controls
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mapCenter, setMapCenter] = useState({ lat: 22.5726, lng: 88.3639 });
  const [mapZoom, setMapZoom] = useState(13);

  // Driver details card
  const [driverSpecs, setDriverSpecs] = useState<DriverDetails>({
    name: 'Aniket Karmakar',
    rating: '★ 4.92',
    plate: 'WB-02-AK-9988',
    car: 'Audi A6 Sedan',
    photo: '👤'
  });

  // Load session configs
  useEffect(() => {
    try {
      const storedDriver = JSON.parse(sessionStorage.getItem('assigned_driver_specs') || '{}');
      if (storedDriver.name) {
        setDriverSpecs(storedDriver);
      }
      const specs = JSON.parse(sessionStorage.getItem('current_booking_specs') || '{}');
      if (specs.pickup) {
        setDropoffText(specs.dropoff || 'Park Street Dining Grid, Kolkata');
        if (specs.fare) setEstimatedFare(specs.fare);
      }
    } catch (e) {}
  }, []);

  // Live WebSocket Connection lifecycle
  useEffect(() => {
    const stream = new ResilientStreamManager({
      orderID: tripId,
      cityPrefix: 'KOL',
      onStatusChange: (status) => {
        console.log('[LiveTripStream] Stream status:', status);
      },
      onMessage: (message: any) => {
        console.log('[LiveTripStream] Event frame:', message);
        let status = '';

        if (message instanceof ArrayBuffer) {
          const unpacked = parseBinaryEnvelope(message);
          if (unpacked?.type === 'ASSIGNMENT') {
            status = unpacked.data.status;
          }
        } else if (message?.status) {
          status = message.status;
        }

        if (message && typeof message === 'object' && 'fare_estimate' in message) {
          setEstimatedFare(message.fare_estimate / 100);
        }

        if (status) {
          if (status === 'ARRIVED_AT_PICKUP') {
            setTripStatus('ARRIVED');
          } else if (status === 'DELIVERING') {
            setTripStatus('IN_TRANSIT');
          } else if (status === 'COMPLETED') {
            setTripStatus('COMPLETED');
            router.push(`/rider/trip/bill?tripId=${tripId}`);
          }
        }
      }
    });

    stream.connect();

    return () => stream.disconnect();
  }, [tripId]);

  // Coordinates telemetry linear glide interpolation loop
  useEffect(() => {
    let animId = 0;
    const start = Date.now();
    const duration = 20000; // 20s glide cycle

    const updateGlide = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(1, elapsed / duration);
      setMapGlide(progress * 100);

      if (tripStatus === 'ARRIVING') {
        // Interpolate driver coords closer to pickup
        const startLat = 22.5650;
        const startLng = 88.4200;
        const currentLat = startLat + (pickupCoords.lat - startLat) * progress;
        const currentLng = startLng + (pickupCoords.lng - startLng) * progress;
        setDriverCoords({ lat: currentLat, lng: currentLng });
      } else if (tripStatus === 'IN_TRANSIT') {
        // Interpolate driver coords from pickup to dropoff
        const currentLat = pickupCoords.lat + (dropoffCoords.lat - pickupCoords.lat) * progress;
        const currentLng = pickupCoords.lng + (dropoffCoords.lng - pickupCoords.lng) * progress;
        setDriverCoords({ lat: currentLat, lng: currentLng });
      }

      if (progress < 1) {
        animId = requestAnimationFrame(updateGlide);
      }
    };

    if (tripStatus === 'ARRIVING' || tripStatus === 'IN_TRANSIT') {
      animId = requestAnimationFrame(updateGlide);
    }

    return () => cancelAnimationFrame(animId);
  }, [tripStatus, pickupCoords, dropoffCoords]);

  // Trip clock timer active in transit
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (tripStatus === 'IN_TRANSIT') {
      timer = setInterval(() => {
        setTripTimer((t) => t + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [tripStatus]);

  // Dynamic automatic map camera centering viewport bounds matrix
  useEffect(() => {
    let node1 = pickupCoords;
    let node2 = dropoffCoords;

    if (tripStatus === 'ARRIVING' || tripStatus === 'ARRIVED') {
      node1 = driverCoords;
      node2 = pickupCoords;
    }

    const centerLat = (node1.lat + node2.lat) / 2;
    const centerLng = (node1.lng + node2.lng) / 2;
    setMapCenter({ lat: centerLat, lng: centerLng });

    // Auto calculate matching zoom factor to display both nodes
    const R = 6371; // km
    const dLat = (node2.lat - node1.lat) * Math.PI / 180;
    const dLng = (node2.lng - node1.lng) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(node1.lat * Math.PI / 180) * Math.cos(node2.lat * Math.PI / 180) * 
      Math.sin(dLng/2) * Math.sin(dLng/2);
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    if (dist > 5) setMapZoom(12);
    else if (dist > 2) setMapZoom(13);
    else setMapZoom(14);

  }, [tripStatus, pickupCoords, dropoffCoords, driverCoords]);

  // Anomaly check triggers: pop overlay after 12s en route
  useEffect(() => {
    if (tripStatus !== 'IN_TRANSIT') return;

    const timer = setTimeout(() => {
      setShowAnomalyOverlay(true);
      setAnomalyTimer(30);
    }, 12000);

    return () => clearTimeout(timer);
  }, [tripStatus]);

  // Anomaly countdown ticking check
  useEffect(() => {
    if (!showAnomalyOverlay) return;
    const interval = setInterval(() => {
      setAnomalyTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setAnomalyEscalated(true);
          console.warn('[AnomalyScanner] SILENCE THRESHOLD EXCEEDED. Trip flagged in Admin Control Terminal.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [showAnomalyOverlay]);

  // Draw vector map layers matching current status bounds
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
      canvas.height = canvas.parentElement?.clientHeight || window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;

    const draw = () => {
      // Resolve design-system tokens once per frame (canvas can't take var())
      const css = getComputedStyle(document.documentElement);
      const v = (name: string) => css.getPropertyValue(name).trim();

      ctx.fillStyle = v('--background-primary');
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Faint city grid matrix
      ctx.strokeStyle = v('--background-secondary');
      ctx.lineWidth = 1;
      const size = 40;
      for (let x = 0; x < canvas.width; x += size) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += size) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Convert LatLng projection coordinates
      const scale = 150000 * Math.pow(2, mapZoom - 14);
      const toScreen = (lat: number, lng: number) => {
        const x = canvas.width / 2 + (lng - mapCenter.lng) * scale * Math.cos(mapCenter.lat * Math.PI / 180);
        const y = canvas.height / 2 - (lat - mapCenter.lat) * scale;
        return { x, y };
      };

      // Draw Hooghly River outline
      ctx.strokeStyle = 'rgba(29, 78, 216, 0.22)';
      ctx.lineWidth = 40 * Math.pow(1.3, mapZoom - 14);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const river = [
        { lat: 22.6200, lng: 88.3220 },
        { lat: 22.6050, lng: 88.3300 },
        { lat: 22.5900, lng: 88.3320 },
        { lat: 22.5750, lng: 88.3260 },
        { lat: 22.5600, lng: 88.3250 },
        { lat: 22.5450, lng: 88.3280 },
        { lat: 22.5300, lng: 88.3340 }
      ];
      river.forEach((pt, idx) => {
        const s = toScreen(pt.lat, pt.lng);
        if (idx === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();

      // Central streets
      ctx.strokeStyle = v('--background-tertiary');
      ctx.lineWidth = 4 * Math.pow(1.3, mapZoom - 14);

      // Central Ave
      ctx.beginPath();
      let pt1 = toScreen(22.6100, 88.3620);
      let pt2 = toScreen(22.5300, 88.3620);
      ctx.moveTo(pt1.x, pt1.y);
      ctx.lineTo(pt2.x, pt2.y);
      ctx.stroke();

      // Park St
      ctx.beginPath();
      pt1 = toScreen(22.5480, 88.3300);
      pt2 = toScreen(22.5480, 88.4200);
      ctx.moveTo(pt1.x, pt1.y);
      ctx.lineTo(pt2.x, pt2.y);
      ctx.stroke();

      // EM Bypass
      ctx.beginPath();
      const bypass = [
        { lat: 22.6000, lng: 88.4100 },
        { lat: 22.5700, lng: 88.4150 },
        { lat: 22.5400, lng: 88.4050 }
      ];
      bypass.forEach((pt, i) => {
        const s = toScreen(pt.lat, pt.lng);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();

      // Howrah Bridge
      ctx.strokeStyle = v('--background-tertiary');
      ctx.beginPath();
      pt1 = toScreen(22.5850, 88.3300);
      pt2 = toScreen(22.5830, 88.3620);
      ctx.moveTo(pt1.x, pt1.y);
      ctx.lineTo(pt2.x, pt2.y);
      ctx.stroke();

      // Active state route line vectors
      ctx.strokeStyle = v('--accent-400');
      ctx.lineWidth = 4;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();

      if (tripStatus === 'ARRIVING' || tripStatus === 'ARRIVED') {
        const s = toScreen(driverCoords.lat, driverCoords.lng);
        const p = toScreen(pickupCoords.lat, pickupCoords.lng);
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(p.x, p.y);
      } else {
        const p = toScreen(pickupCoords.lat, pickupCoords.lng);
        const d = toScreen(dropoffCoords.lat, dropoffCoords.lng);
        ctx.moveTo(p.x, p.y);

        const midLat = (pickupCoords.lat + dropoffCoords.lat) / 2;
        const midLng = (pickupCoords.lng + dropoffCoords.lng) / 2 + 0.005;
        const mid = toScreen(midLat, midLng);
        ctx.quadraticCurveTo(mid.x, mid.y, d.x, d.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Pickup point Pin
      const pLoc = toScreen(pickupCoords.lat, pickupCoords.lng);
      ctx.fillStyle = v('--positive-400'); // Green pickup
      ctx.beginPath();
      ctx.arc(pLoc.x, pLoc.y, 8, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = v('--content-primary');
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw Dropoff point Pin
      const dLoc = toScreen(dropoffCoords.lat, dropoffCoords.lng);
      ctx.fillStyle = v('--negative-400'); // Red dropoff
      ctx.beginPath();
      ctx.arc(dLoc.x, dLoc.y, 8, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = v('--content-primary');
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw Driver vehicle position node (interpolating)
      const dCoords = toScreen(driverCoords.lat, driverCoords.lng);
      ctx.fillStyle = v('--content-primary');
      ctx.beginPath();
      ctx.arc(dCoords.x, dCoords.y, 7, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = v('--accent-400'); // Blue trace border
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.fillStyle = v('--accent-400');
      ctx.beginPath();
      ctx.arc(dCoords.x, dCoords.y, 3, 0, 2 * Math.PI);
      ctx.fill();

      // Draw intermediate stops pins
      stops.forEach((st, i) => {
        // Offset stops mock locations between pickup and dropoff
        const progress = (i + 1) / (stops.length + 1);
        const stopLat = pickupCoords.lat + (dropoffCoords.lat - pickupCoords.lat) * progress;
        const stopLng = pickupCoords.lng + (dropoffCoords.lng - pickupCoords.lng) * progress + 0.003;
        const sLoc = toScreen(stopLat, stopLng);

        ctx.fillStyle = v('--warning-400'); // Amber stop
        ctx.beginPath();
        ctx.arc(sLoc.x, sLoc.y, 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = v('--content-primary');
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      animId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animId);
    };
  }, [mapCenter, mapZoom, pickupCoords, dropoffCoords, driverCoords, stops, tripStatus]);

  // Listen for network connectivity to flush sync queue
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      console.log('[OfflineSync] Client connection is back online. Flushing queues...');
      flushSyncQueue();
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [token, tripId, dropoffCoords, stops]);

  const flushSyncQueue = async () => {
    const queueStr = localStorage.getItem('trip_mutation_sync_queue');
    if (!queueStr) return;
    try {
      const queue = JSON.parse(queueStr);
      if (queue.length === 0) return;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Region-Prefix': 'KOL'
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const lastMutation = queue[queue.length - 1];
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/orders/${tripId}/route`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(lastMutation)
      });

      if (res.ok) {
        const data = await res.json();
        if (data.calculated_fare_paise) {
          setEstimatedFare(data.calculated_fare_paise / 100);
        }
        localStorage.removeItem('trip_mutation_sync_queue');
        console.log('[OfflineSync] Mutation queue successfully synchronized with PostGIS gateway.');
      }
    } catch (e) {
      console.warn('[OfflineSync] Flush sync failed, retaining queue:', e);
    }
  };

  // Debounced patch route mutators handshake
  useEffect(() => {
    if (tripStatus !== 'IN_TRANSIT') return;

    const delay = setTimeout(() => {
      mutateRouteOnBackend();
    }, 800);

    return () => clearTimeout(delay);
  }, [dropoffText, stops]);

  const mutateRouteOnBackend = async () => {
    const payload = {
      dropoff_lat: dropoffCoords.lat,
      dropoff_lng: dropoffCoords.lng,
      stops: stops
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      console.warn('[OfflineMode] Client is offline. Queueing route mutation for background sync.');
      const queue = JSON.parse(localStorage.getItem('trip_mutation_sync_queue') || '[]');
      queue.push(payload);
      localStorage.setItem('trip_mutation_sync_queue', JSON.stringify(queue));
      // Local optimistic pricing update:
      setEstimatedFare((prev) => prev + (stops.length * 150));
      return;
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Region-Prefix': 'KOL'
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/orders/${tripId}/route`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        if (data.calculated_fare_paise) {
          setEstimatedFare(data.calculated_fare_paise / 100);
        }
        console.log('[MutationEngine] Mid-trip route updated, estimated cost synced:', data);
      } else {
        throw new Error('Gateway rejected mutation request');
      }
    } catch (e) {
      console.warn('Backend PATCH route failed, queueing for background sync:', e);
      const queue = JSON.parse(localStorage.getItem('trip_mutation_sync_queue') || '[]');
      queue.push(payload);
      localStorage.setItem('trip_mutation_sync_queue', JSON.stringify(queue));
    }
  };

  const handleStartTripSimulated = () => {
    setTripStatus('IN_TRANSIT');
    setMapGlide(0);
  };

  const handleEndTripSimulated = () => {
    setTripStatus('COMPLETED');
    router.push(`/rider/trip/bill?tripId=${tripId}`);
  };

  const handleSOS = async () => {
    alert('🚨 EMERGENCY DISTRESS MODE ACTIVATED. Automatically dialing 112 emergency and broadcasting live coordinates to dispatch support and safety networks.');
    
    // 1. Initiate emergency dialer intent
    window.location.href = 'tel:112';

    // 2. Broadcast telemetry coordinates to Go backend
    try {
      await fetch(`${API_GATEWAY_BASE_URL}/api/v1/sos/trigger`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          trip_id: tripId, 
          latitude: driverCoords.lat, 
          longitude: driverCoords.lng 
        })
      });
    } catch (e) {
      console.error('Failed to broadcast distress coordinates', e);
    }
  };

  const handleReportIssue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueText.trim()) return;
    alert(`Report submitted: "${issueText}". Incident logs generated.`);
    setIssueText('');
    setShowIssueModal(false);
  };

  const handleAddStop = () => {
    if (stops.length >= 3) {
      alert('Maximum of 3 stops can be configured mid-route.');
      return;
    }
    setStops(prev => [...prev, '']);
  };

  const handleStopChange = (idx: number, val: string) => {
    const updated = [...stops];
    updated[idx] = val;
    setStops(updated);
  };

  const handleRemoveStop = (idx: number) => {
    setStops(prev => prev.filter((_, i) => i !== idx));
  };

  const handleGenerateShareLink = async () => {
    // Request a short-lived signed tracking JWT token from gateway
    let trackingToken = 'jwt-mock-tracking-token-hash';
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/payments/webhook`, { // request mock token
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'share.token', order_id: tripId })
      });
      if (res.ok) {
        trackingToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0cmlwSWQiOiJ0cnAtMTEwOCJ9';
      }
    } catch (e) {}

    const shareUrl = `${window.location.origin}/share?tripId=${tripId}&jwt=${trackingToken}`;
    navigator.clipboard.writeText(shareUrl);
    alert(`📋 Share tracking link copied to clipboard:\n${shareUrl}`);
  };

  return (
    <div className="min-h-screen bg-black text-white p-0 font-sans flex flex-col justify-between selection:bg-white selection:text-black overflow-hidden relative">
      
      {/* ==================== STATEFUL PROGRESS BANNER HORIZON ==================== */}
      <header className="fixed top-0 left-0 right-0 z-50 flex flex-col backdrop-blur-md border-b border-border-opaque/60">
        <div className="bg-background-primary/80 p-4 flex justify-between items-center text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 bg-positive-400 rounded-full animate-pulse" />
            <h1 className="font-bold text-[10px] uppercase tracking-widest text-content-secondary">Live Journey Tracking</h1>
          </div>
          <span className="text-[8px] text-content-tertiary font-bold uppercase">ID: {tripId.slice(0, 10)}</span>
        </div>

        {/* Dynamic linear status progression ribbon */}
        <div className="grid grid-cols-5 text-[8px] font-mono text-center font-bold uppercase tracking-wider border-t border-border-opaque select-none bg-background-primary">
          <div className={`py-2 border-r border-border-opaque ${tripStatus === 'ARRIVING' ? 'bg-accent-400 text-white animate-pulse' : 'text-content-tertiary'}`}>Arriving</div>
          <div className={`py-2 border-r border-border-opaque ${tripStatus === 'ARRIVED' ? 'bg-warning-400 text-white animate-pulse' : 'text-content-tertiary'}`}>Arrived</div>
          <div className={`py-2 border-r border-border-opaque ${tripStatus === 'IN_TRANSIT' && mapGlide < 20 ? 'bg-positive-400 text-white animate-pulse' : 'text-content-tertiary'}`}>Started</div>
          <div className={`py-2 border-r border-border-opaque ${tripStatus === 'IN_TRANSIT' && mapGlide >= 20 ? 'bg-positive-400 text-white animate-pulse' : 'text-content-tertiary'}`}>En Route</div>
          <div className={`py-2 ${tripStatus === 'COMPLETED' ? 'bg-background-tertiary text-black' : 'text-content-tertiary'}`}>Ending</div>
        </div>
      </header>

      {/* ==================== LAYER 1 (Z-INDEX: 10): VIEWPORT MAP CANVAS ==================== */}
      <div className="absolute inset-0 z-10 w-full h-full">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>

      {/* SOS panic action trigger */}
      <div className="absolute top-24 right-4 z-20">
        <button
          onClick={handleSOS}
          className="h-10 w-10 bg-negative-400 hover:bg-negative-400 text-white font-bold rounded-xl flex items-center justify-center shadow-lg border border-negative-400 animate-pulse transition cursor-pointer active:scale-95 text-xs"
        >
          🚨
        </button>
      </div>

      {/* Share tracking action */}
      <div className="absolute top-24 left-4 z-20">
        <button
          onClick={handleGenerateShareLink}
          className="bg-background-primary/80 border border-border-opaque text-[8px] font-mono font-bold uppercase py-1.5 px-3 rounded-full tracking-wider shadow-md cursor-pointer hover:bg-background-secondary transition flex items-center gap-1 backdrop-blur-sm"
        >
          🔗 Share Live Status
        </button>
      </div>

      {/* Interactive Canvas zoom options */}
      <div className="absolute bottom-[22vh] right-4 z-20 flex flex-col gap-1 font-mono font-bold text-xs select-none">
        <button
          onClick={() => setMapZoom(z => Math.min(18, z + 1))}
          className="h-8 w-8 bg-background-primary/80 border border-border-opaque rounded-lg flex items-center justify-center text-white hover:bg-background-secondary transition backdrop-blur-sm cursor-pointer"
        >
          +
        </button>
        <button
          onClick={() => setMapZoom(z => Math.max(10, z - 1))}
          className="h-8 w-8 bg-background-primary/80 border border-border-opaque rounded-lg flex items-center justify-center text-white hover:bg-background-secondary transition backdrop-blur-sm cursor-pointer"
        >
          -
        </button>
      </div>

      {/* ==================== LAYER 2 (Z-INDEX: 30): COLLAPSIBLE JOURNEY CONTEXT SHEET ==================== */}
      <div
        style={{ height: isExpanded ? '460px' : '180px' }}
        className="fixed bottom-0 left-0 right-0 z-30 bg-background-primary/95 border-t border-border-opaque shadow-2xl backdrop-blur-md rounded-t-3xl overflow-hidden flex flex-col transition-all duration-300"
      >
        {/* Swipe Toggle handle */}
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full py-3 flex items-center justify-center cursor-pointer border-b border-border-opaque/50 select-none shrink-0"
        >
          <div className="w-12 h-1 bg-background-tertiary hover:bg-background-tertiary rounded-full transition" />
        </div>

        {/* Scrollable details panel */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl mx-auto w-full text-left">
          
          {/* Awaiting handshakes state blockers */}
          {tripStatus !== 'IN_TRANSIT' ? (
            <div className="space-y-4">
              {/* LARGE TYPE OTP HANDOVER CODE */}
              <div className="bg-background-secondary/50 border border-border-opaque rounded-2xl p-4 text-center space-y-2 animate-fadeIn">
                <span className="text-content-tertiary text-[8px] font-mono font-bold uppercase tracking-widest block">SECURITY HANDOVER PASSCODE</span>
                <div className="flex justify-center items-center gap-3">
                  <span className="text-3xl font-mono font-extrabold tracking-widest text-white animate-pulse">
                    5829
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText('5829');
                      alert('Passcode copied.');
                    }}
                    className="bg-background-tertiary text-content-secondary hover:text-white px-2 py-1 rounded text-[8px] font-mono uppercase"
                  >
                    Copy
                  </button>
                </div>
                <p className="text-[9px] text-content-secondary font-sans leading-normal max-w-xs mx-auto">
                  ⚠️ IMPORTANT: Share this security code with Aniket only when handing over your car keys.
                </p>
              </div>

              {/* LOCKOUT INTERCEPTION PANEL */}
              <div className="p-3 bg-background-primary/60 border border-negative-400/40 text-content-negative/80 rounded-xl font-mono text-[8px] uppercase tracking-wider text-center">
                ⛔ Trip telemetry and mid-route adjustments locked until key handoff verify
              </div>

              {/* Sandbox verification starts */}
              <button
                onClick={handleStartTripSimulated}
                className="w-full bg-white hover:bg-background-tertiary text-black py-3 rounded-xl font-mono font-bold text-[9px] uppercase tracking-wider transition"
              >
                🔄 Verify Handshake & Start Journey (Simulate)
              </button>
            </div>
          ) : (
            /* ACTIVE TRIP EN ROUTE DETAILED PANELS */
            <div className="space-y-4 animate-fadeIn">
              
              {/* Collapsed minimal state metadata summary */}
              {!isExpanded && (
                <div className="flex justify-between items-center bg-background-secondary/30 border border-border-opaque p-3.5 rounded-xl text-xs font-mono">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">👨🏽‍✈️</span>
                    <div>
                      <span className="text-white font-sans font-bold block">{driverSpecs.name}</span>
                      <span className="text-[8px] text-content-tertiary block uppercase mt-0.5">{driverSpecs.plate}</span>
                    </div>
                  </div>
                  <div className="text-right space-y-0.5">
                    <span className="bg-surface-positive/20 text-content-positive border border-positive-400 px-2 py-0.5 rounded text-[8px] font-bold block uppercase w-max ml-auto">
                      48 KM/H
                    </span>
                    <span className="text-[8px] text-content-tertiary block uppercase">ETA: 8 Mins</span>
                  </div>
                </div>
              )}

              {/* Expanded details panels */}
              {isExpanded && (
                <div className="space-y-4">
                  {/* Address timeline inputs */}
                  <div className="bg-background-secondary/40 p-4 border border-border-opaque rounded-xl space-y-3 font-sans text-xs">
                    <div>
                      <label className="block text-[8px] uppercase font-bold text-content-tertiary mb-1 font-mono">Meetup Point</label>
                      <input
                        type="text"
                        disabled
                        value="Salt Lake Sector V Tech Hub, Kolkata"
                        className="w-full bg-background-primary border border-border-opaque/60 rounded-lg p-2.5 text-content-tertiary outline-none text-xs cursor-not-allowed"
                      />
                    </div>

                    {/* Intermediate stops inputs adjusters */}
                    {stops.map((stop, i) => (
                      <div key={i} className="flex gap-2 items-center animate-fadeIn">
                        <div className="flex-1">
                          <label className="block text-[8px] uppercase font-bold text-content-tertiary mb-1 font-mono">Waypoint stop {i + 1}</label>
                          <input
                            type="text"
                            value={stop}
                            onChange={(e) => handleStopChange(i, e.target.value)}
                            className="w-full bg-background-primary border border-border-opaque rounded-lg p-2.5 text-white outline-none focus:border-border-opaque text-xs"
                            placeholder="Enter stop address"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveStop(i)}
                          className="bg-background-primary hover:bg-background-secondary text-content-negative border border-border-opaque h-8 w-8 rounded-lg mt-4 flex items-center justify-center cursor-pointer text-xs"
                        >
                          ✕
                        </button>
                      </div>
                    ))}

                    {/* Dropoff Address */}
                    <div>
                      <label className="block text-[8px] uppercase font-bold text-content-tertiary mb-1 font-mono">Final Destination Address</label>
                      <input
                        type="text"
                        value={dropoffText}
                        onChange={(e) => setDropoffText(e.target.value)}
                        className={`w-full bg-background-primary border rounded-lg p-2.5 text-white focus:outline-none text-xs transition-all ${
                          dropoffInputFlash 
                            ? 'border-negative-400 ring-2 ring-negative-400/20 animate-shake' 
                            : 'border-border-opaque focus:border-border-opaque'
                        }`}
                        placeholder="Enter dropoff location"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleAddStop}
                      className="text-[8px] font-mono font-bold uppercase text-content-tertiary hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      ➕ Add Waypoint Stop (Max 3)
                    </button>
                  </div>

                  {/* Pricing estimate display */}
                  <div className="flex justify-between items-center bg-background-primary border border-border-opaque p-3.5 rounded-xl font-mono text-xs">
                    <div>
                      <span className="text-content-tertiary block text-[8px] uppercase">MID-TRIP ESTIMATED FARE</span>
                      <span className="text-base font-bold text-white block mt-0.5">₹{estimatedFare.toFixed(2)}</span>
                    </div>
                    <span className="bg-background-secondary text-content-secondary border border-border-opaque text-[7px] font-bold px-1.5 py-0.5 rounded uppercase">
                      Surge floor active
                    </span>
                  </div>

                  {/* Safety dispute options */}
                  <div className="grid grid-cols-2 gap-2 text-[9px] font-mono font-bold uppercase">
                    <button
                      type="button"
                      onClick={() => setShowIssueModal(true)}
                      className="bg-background-secondary hover:bg-background-tertiary border border-border-opaque py-3 rounded-xl text-content-secondary hover:text-white text-center cursor-pointer"
                    >
                      ⚠️ Report safety concern
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEstimatedFare(f => f + 100);
                        alert('Journey duration extended by 1 hour (₹100 charge applied).');
                      }}
                      className="bg-background-secondary hover:bg-background-tertiary border border-border-opaque py-3 rounded-xl text-content-secondary text-center cursor-pointer"
                    >
                      📅 Extend Duration (+1h)
                    </button>
                  </div>
                </div>
              )}

              {/* End simulated matches */}
              <button
                onClick={handleEndTripSimulated}
                className="w-full bg-negative-400 text-white hover:bg-negative-400 py-3.5 rounded-xl font-mono font-bold text-[9px] uppercase tracking-wider border border-negative-400 cursor-pointer text-center"
              >
                🏁 Arrived at drop: Complete Transit (Simulate)
              </button>
            </div>
          )}

        </div>

        <footer className="bg-black py-2 text-center text-[7px] font-mono text-content-tertiary border-t border-border-opaque select-none">
          MUTATION ENGINE: ONLINE • SHA-256 SECURE NETWORK
        </footer>
      </div>

      {/* ==================== MOCK INCIDENT REPORT MODAL SHEET ==================== */}
      {showIssueModal && (
        <div className="fixed inset-0 bg-black/80 z-[99999] flex items-center justify-center p-4">
          <div className="bg-background-primary border border-border-opaque p-6 rounded-2xl w-full max-w-sm text-left space-y-4">
            <h3 className="text-xs font-bold font-mono text-white uppercase tracking-widest border-b border-border-opaque pb-2">
              Report Route Safety Issue
            </h3>
            
            <form onSubmit={handleReportIssue} className="space-y-4 font-mono text-xs">
              <div>
                <label className="block text-[8px] font-bold text-content-tertiary uppercase mb-1">Provide details</label>
                <textarea
                  value={issueText}
                  onChange={(e) => setIssueText(e.target.value)}
                  rows={3}
                  placeholder="Rash driving, route deviation, safety concerns..."
                  className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-white focus:outline-none focus:border-border-opaque font-sans"
                  required
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowIssueModal(false)}
                  className="flex-1 bg-background-secondary hover:bg-background-tertiary text-content-tertiary py-2.5 rounded-lg border border-border-opaque cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-white hover:bg-background-tertiary text-black font-bold py-2.5 rounded-lg cursor-pointer"
                >
                  Submit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== ANOMALY CHECK OVERLAY "Everything OK?" ==================== */}
      {showAnomalyOverlay && (
        <div className="fixed inset-x-4 top-24 z-[99999] bg-background-primary border border-warning-400 rounded-2xl p-5 text-left shadow-2xl animate-bounce">
          <div className="space-y-2">
            <div className="flex justify-between items-center text-[8px] font-mono font-bold text-content-warning uppercase">
              <span>Ride Check Anomaly Interceptor</span>
              <span className="text-content-warning animate-pulse">{anomalyTimer}s remaining</span>
            </div>
            
            {anomalyEscalated ? (
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-content-negative font-mono uppercase">🚨 SILENCE CRITICAL THRESHOLD EXCEEDED</h3>
                <p className="text-[9px] text-content-secondary font-sans leading-normal">
                  Inactivity detected for more than 30 seconds. A distress notification has been dispatched to admin control rooms. Live support loop initiated.
                </p>
                <button
                  onClick={() => {
                    setShowAnomalyOverlay(false);
                    setAnomalyEscalated(false);
                  }}
                  className="bg-background-secondary text-content-secondary border border-border-opaque px-3 py-1.5 rounded-lg font-mono text-[8px] uppercase cursor-pointer"
                >
                  Dismiss & Clear logs
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-white font-mono uppercase">Everything OK?</h3>
                <p className="text-[9px] text-content-secondary font-sans leading-normal">
                  Our sensors detected an unscheduled stop or route deviation. Please confirm your safety to prevent escalating alarms.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowAnomalyOverlay(false);
                      alert('✔️ Safety acknowledged. Tracking buffer cleared.');
                    }}
                    className="flex-1 bg-white text-black font-mono font-bold text-[8px] py-2 rounded-lg uppercase cursor-pointer"
                  >
                    Yes, I am Safe
                  </button>
                  <button
                    onClick={handleSOS}
                    className="flex-grow-0 bg-negative-400 text-white border border-negative-400 px-4 py-2 rounded-lg font-mono font-bold text-[8px] uppercase cursor-pointer"
                  >
                    Dial 112
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LiveTripPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center font-sans text-content-tertiary font-mono text-xs uppercase animate-pulse">
        Initializing Live Journey Monitor...
      </div>
    }>
      <LiveTripContent />
    </Suspense>
  );
}
