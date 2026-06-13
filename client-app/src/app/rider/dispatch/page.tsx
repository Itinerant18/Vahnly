'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ResilientStreamManager } from '@/network/ResilientStreamManager';
import { useAuthStore } from '@/store/useAuthStore';
import { API_GATEWAY_BASE_URL } from '@/config';
import { latLngToCell } from 'h3-js';

interface DriverDetails {
  id: string;
  name: string;
  rating: string;
  plate: string;
  car: string;
  eta: string;
  transmission: 'MANUAL' | 'AUTOMATIC';
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
    console.error('[BINARY_PARSER] Failed parsing array buffers:', err);
  }
  return null;
}

export default function RiderDispatchPage() {
  const t = useTranslations('riderDispatch');
  const router = useRouter();
  const { token } = useAuthStore();

  // Core Dispatch States: SEARCHING | ASSIGNED | TIMEOUT
  const [matchState, setMatchState] = useState<'SEARCHING' | 'ASSIGNED' | 'TIMEOUT'>('SEARCHING');
  const [countdown, setCountdown] = useState(60); // 60-second match loop quota
  const [bookingSpecs, setBookingSpecs] = useState<any>(null);
  const [assignedDriver, setAssignedDriver] = useState<DriverDetails | null>(null);

  // Sub-status parameters
  const [scanRadiusExpanded, setScanRadiusExpanded] = useState(false);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [showSchedulerModal, setShowSchedulerModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showChatModal, setShowChatModal] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ sender: 'RIDER' | 'DRIVER'; text: string; time: string }[]>([
    { sender: 'DRIVER', text: t('chatGreeting'), time: '14:31' }
  ]);
  const [newChatMessage, setNewChatMessage] = useState('');

  // Map canvas and animation refs
  const mapCanvasRef = useRef<HTMLCanvasElement>(null);
  const radarCanvasRef = useRef<HTMLCanvasElement>(null);
  const mapCenterRef = useRef({ lat: 22.5726, lng: 88.3639 });

  // Load session specifications
  useEffect(() => {
    try {
      const specs = JSON.parse(sessionStorage.getItem('current_booking_specs') || '{}');
      setBookingSpecs(specs);
      if (specs.pickupCoords) {
        mapCenterRef.current = specs.pickupCoords;
      } else {
        // Fallback search center
        mapCenterRef.current = { lat: 22.5726, lng: 88.3639 };
      }
    } catch (e) {
      console.warn('Failed loading booking specs from sessionStorage:', e);
    }
  }, []);

  // Connect to persistent WebSocket allocations queue stream
  useEffect(() => {
    if (matchState !== 'SEARCHING' || !bookingSpecs) return;

    const orderId = bookingSpecs.orderId || 'ord-sandbox-default';
    const stream = new ResilientStreamManager({
      orderID: orderId,
      cityPrefix: 'KOL',
      onStatusChange: (status) => {
        console.log('[DispatchStream] Connection status:', status);
      },
      onMessage: (message: any) => {
        console.log('[DispatchStream] Received message payload:', message);
        let matchPayload: any = null;

        if (message instanceof ArrayBuffer) {
          const unpacked = parseBinaryEnvelope(message);
          if (unpacked?.type === 'ASSIGNMENT') {
            matchPayload = unpacked.data;
          }
        } else if (message?.type === 'order.assigned' || message?.status === 'ASSIGNED' || message?.assigned_driver_id) {
          matchPayload = message;
        }

        if (matchPayload) {
          // Hydrate dynamic driver credentials
          const carTransmission = bookingSpecs?.car?.transmission || 'AUTOMATIC';
          const vehicleLabel = bookingSpecs?.car 
            ? `${bookingSpecs.car.make} ${bookingSpecs.car.model}` 
            : 'Vehicle';

          const details: DriverDetails = {
            id: matchPayload.assigned_driver_id || matchPayload.driver_id || 'drv-prabir-kol',
            name: matchPayload.driver_name || 'Prabir Roy',
            rating: matchPayload.driver_rating ? `★ ${matchPayload.driver_rating}` : '★ 4.88',
            plate: matchPayload.vehicle_plate || 'WB-04-BG-7762',
            car: vehicleLabel,
            eta: t('etaMinsAway', { mins: 3 }),
            transmission: carTransmission,
            photo: '👨🏽‍✈️'
          };

          setAssignedDriver(details);
          sessionStorage.setItem('assigned_driver_specs', JSON.stringify(details));
          setMatchState('ASSIGNED');
        }
      }
    });

    stream.connect();

    // Trigger simulation match automatically after 6 seconds for client sandbox validation
    const mockMatchTimer = setTimeout(() => {
      const carTransmission = bookingSpecs?.car?.transmission || 'AUTOMATIC';
      const vehicleLabel = bookingSpecs?.car 
        ? `${bookingSpecs.car.make} ${bookingSpecs.car.model}` 
        : 'Vehicle';

      const mockDetails: DriverDetails = {
        id: 'drv-aniket-7602',
        name: 'Aniket Karmakar',
        rating: '★ 4.92',
        plate: 'WB-02-AK-9988',
        car: vehicleLabel,
        eta: t('etaMinsAway', { mins: 4 }),
        transmission: carTransmission,
        photo: '👨🏽‍✈️'
      };

      setAssignedDriver(mockDetails);
      sessionStorage.setItem('assigned_driver_specs', JSON.stringify(mockDetails));
      setMatchState('ASSIGNED');
    }, 6000);

    // Countdown quota clock timer
    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          clearTimeout(mockMatchTimer);
          setMatchState('TIMEOUT');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(countdownInterval);
      clearTimeout(mockMatchTimer);
      stream.disconnect();
    };
  }, [matchState, bookingSpecs]);

  // Layer 1: Draw static background map dimmed with dark mask overlay
  useEffect(() => {
    const canvas = mapCanvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
      canvas.height = canvas.parentElement?.clientHeight || window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Resolve design-system tokens once (canvas can't take var())
      const css = getComputedStyle(document.documentElement);
      const v = (name: string) => css.getPropertyValue(name).trim();

      // 1. Draw Grid lines
      ctx.fillStyle = v('--background-primary');
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = v('--background-secondary');
      ctx.lineWidth = 1;
      const size = 45;
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

      // Projection parameters
      const center = mapCenterRef.current;
      const zoom = 14;
      const scale = 150000 * Math.pow(2, zoom - 14);

      const toScreen = (lat: number, lng: number) => {
        const x = canvas.width / 2 + (lng - center.lng) * scale * Math.cos(center.lat * Math.PI / 180);
        const y = canvas.height / 2 - (lat - center.lat) * scale;
        return { x, y };
      };

      // Draw Hooghly river
      ctx.strokeStyle = 'rgba(29, 78, 216, 0.15)';
      ctx.lineWidth = 45;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const river = [
        { lat: 22.6200, lng: 88.3220 },
        { lat: 22.5900, lng: 88.3320 },
        { lat: 22.5600, lng: 88.3250 },
        { lat: 22.5300, lng: 88.3340 }
      ];
      river.forEach((pt, i) => {
        const s = toScreen(pt.lat, pt.lng);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();

      // Draw central streets
      ctx.strokeStyle = v('--background-tertiary');
      ctx.lineWidth = 4;
      ctx.beginPath();
      const st1 = toScreen(22.6100, 88.3620);
      const st2 = toScreen(22.5300, 88.3620);
      ctx.moveTo(st1.x, st1.y);
      ctx.lineTo(st2.x, st2.y);
      ctx.stroke();

      ctx.beginPath();
      const st3 = toScreen(22.5480, 88.3300);
      const st4 = toScreen(22.5480, 88.4200);
      ctx.moveTo(st3.x, st3.y);
      ctx.lineTo(st4.x, st4.y);
      ctx.stroke();

      // Draw origin coordinates anchor pin
      const origin = toScreen(center.lat, center.lng);
      ctx.fillStyle = v('--accent-400');
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, 8, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = v('--content-primary');
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Apply the Dark Alpha Mask overlay to dim map background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    return () => window.removeEventListener('resize', resizeCanvas);
  }, [bookingSpecs]);

  // Layer 2: Draw hardware-accelerated concentric waves searching radar scan circles
  useEffect(() => {
    if (matchState !== 'SEARCHING') return;
    const canvas = radarCanvasRef.current;
    if (!canvas) return;

    canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
    canvas.height = canvas.parentElement?.clientHeight || window.innerHeight;

    let waves = [
      { r: 20, maxR: 180, alpha: 1, speed: 1.2 },
      { r: 60, maxR: 180, alpha: 0.7, speed: 1.2 },
      { r: 110, maxR: 180, alpha: 0.4, speed: 1.2 }
    ];

    let animId = 0;
    const ctx = canvas.getContext('2d');

    const drawRadar = () => {
      if (ctx) {
        // Resolve design-system tokens once per frame (canvas can't take var())
        const css = getComputedStyle(document.documentElement);
        const v = (name: string) => css.getPropertyValue(name).trim();

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const cx = canvas.width / 2;
        const cy = canvas.height / 2;

        // Circular background grid frames
        ctx.strokeStyle = v('--background-secondary');
        ctx.lineWidth = 1;
        [40, 90, 140, 190].forEach((r) => {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, 2 * Math.PI);
          ctx.stroke();
        });

        // Pulsing search rings
        waves.forEach((w) => {
          w.r += w.speed;
          w.alpha = Math.max(0, 1 - (w.r / w.maxR));

          if (w.r >= w.maxR) {
            w.r = 10;
            w.alpha = 1;
          }

          ctx.strokeStyle = `rgba(59, 130, 246, ${w.alpha * 0.45})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, w.r, 0, 2 * Math.PI);
          ctx.stroke();

          // Outer glowing boundaries
          ctx.fillStyle = `rgba(59, 130, 246, ${w.alpha * 0.04})`;
          ctx.beginPath();
          ctx.arc(cx, cy, w.r, 0, 2 * Math.PI);
          ctx.fill();
        });

        // Glowing center core node
        const rad = 25 + Math.sin(Date.now() / 200) * 4;
        const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad);
        grad.addColorStop(0, v('--content-primary'));
        grad.addColorStop(0.3, v('--accent-400'));
        grad.addColorStop(1, 'rgba(59,130,246,0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, 2 * Math.PI);
        ctx.fill();
      }
      animId = requestAnimationFrame(drawRadar);
    };

    drawRadar();

    return () => cancelAnimationFrame(animId);
  }, [matchState]);

  // Cancel Button Interaction with 30s Grace Period verification gates
  const handleAbortTrigger = () => {
    const elapsedSeconds = 60 - countdown;
    if (elapsedSeconds <= 30) {
      // 30-Second Grace Window Interceptor - Cancel immediately without warnings/penalties
      router.push('/rider');
    } else {
      // Post-Match / Post-Grace warnings panel alert trigger
      setShowCancelConfirmation(true);
    }
  };

  const handleConfirmCancel = () => {
    if (!cancelReason) {
      alert(t('selectReasonAlert'));
      return;
    }
    console.log('[AbortControl] Cancellation log entry:', {
      orderId: bookingSpecs?.orderId,
      reason: cancelReason,
      fineApplied: true,
      timestamp: new Date().toISOString()
    });
    setShowCancelConfirmation(false);
    setMatchState('SEARCHING');
    router.push('/rider');
  };

  // Re-Queue Selector resetting countdown and queue injection
  const handleRequeueSearch = () => {
    setCountdown(60);
    setMatchState('SEARCHING');
    console.log('[DispatchControl] Re-injecting order dispatch payload:', bookingSpecs?.orderId);
  };

  // Chat message send handler
  const handleSendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatMessage.trim()) return;
    setChatMessages(prev => [...prev, {
      sender: 'RIDER',
      text: newChatMessage,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }]);
    setNewChatMessage('');
    // Simulate auto driver reply
    setTimeout(() => {
      setChatMessages(prev => [...prev, {
        sender: 'DRIVER',
        text: t('chatAutoReply'),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-black text-white p-0 font-sans flex flex-col justify-between selection:bg-white selection:text-black overflow-hidden relative">
      
      {/* Header overlay */}
      <header className="bg-background-primary/80 border-b border-border-opaque/60 p-4 fixed top-0 left-0 right-0 z-50 flex justify-between items-center w-full backdrop-blur-md font-mono text-[10px]">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 bg-positive-400 rounded-full animate-pulse" />
          <span className="font-bold uppercase tracking-widest text-content-secondary">{t('headerTitle')}</span>
        </div>
        <span className="text-content-tertiary font-semibold uppercase">{t('headerShard')}</span>
      </header>

      {/* ==================== LAYER 1 (Z-INDEX: 10): DIMMED MAP BACKGROUND ==================== */}
      <div className="absolute inset-0 z-10 w-full h-full">
        <canvas ref={mapCanvasRef} className="w-full h-full block" />
      </div>

      {/* ==================== LAYER 2 (Z-INDEX: 30): PULSING RADAR CANVAS ==================== */}
      {matchState === 'SEARCHING' && (
        <div className="absolute inset-0 z-30 w-full h-full pointer-events-none flex items-center justify-center">
          <canvas ref={radarCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          
          {/* Circular Countdown Tracker Badge */}
          <div className="bg-black/90 border border-border-opaque h-16 w-16 rounded-full flex items-center justify-center shadow-2xl z-40 select-none">
            <span className="font-mono text-sm font-bold text-white animate-pulse">
              {t('countdownSeconds', { seconds: countdown })}
            </span>
          </div>
        </div>
      )}

      {/* ==================== LAYER 3 (Z-INDEX: 50): CENTRALIZED INTERFACE MODALS ==================== */}
      <main className="relative z-40 flex-1 flex flex-col justify-end p-5 min-h-screen pt-20">
        
        {/* State A: SEARCHING - Float Component summary block */}
        {matchState === 'SEARCHING' && (
          <div className="w-full max-w-md mx-auto bg-background-primary/95 border border-border-opaque rounded-2xl p-5 space-y-4 shadow-2xl backdrop-blur-md text-left animate-slideUp">
            
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[8px] font-mono font-bold text-content-tertiary uppercase tracking-widest">
                <span>{t('seekingMatch')}</span>
                <span className="text-content-accent">{t('activeScan')}</span>
              </div>
              <h3 className="text-xs font-bold text-white font-mono mt-1 uppercase">
                {scanRadiusExpanded ? t('searchExpanded') : t('searchFiltering')}
              </h3>
              <p className="text-[9px] text-content-secondary font-sans leading-relaxed">
                {t('matchingAttributes', {
                  transmission: bookingSpecs?.car?.transmission || 'AUTOMATIC',
                  make: bookingSpecs?.car?.make || 'default',
                  model: bookingSpecs?.car?.model || 'vehicle',
                })}
              </p>
            </div>

            {/* Route summary info strip */}
            {bookingSpecs && (
              <div className="bg-background-secondary/50 p-3.5 border border-border-opaque rounded-xl text-[10px] font-mono text-content-secondary space-y-1.5 leading-normal">
                <div className="truncate"><span className="text-content-tertiary font-bold uppercase">{t('pickupLabel')}</span> {bookingSpecs.pickup}</div>
                <div className="truncate"><span className="text-content-tertiary font-bold uppercase">{t('dropLabel')}</span> {bookingSpecs.dropoff || t('hourlyPack')}</div>
                <div className="flex justify-between items-center text-content-positive font-bold border-t border-border-opaque pt-1.5 mt-1.5 text-xs">
                  <span>{t('upfrontPricing')}</span>
                  <span>₹{bookingSpecs.fare.toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Cancellation abort trigger */}
            <button
              onClick={handleAbortTrigger}
              className="w-full bg-background-secondary hover:bg-background-tertiary border border-border-opaque text-content-negative py-3.5 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider transition active:scale-98 cursor-pointer text-center"
            >
              {t('cancelDispatch')}
            </button>
          </div>
        )}

        {/* State B: ASSIGNED_MODAL - Full drawer view */}
        {matchState === 'ASSIGNED' && assignedDriver && (
          <div className="w-full max-w-md mx-auto bg-background-primary/95 border border-border-opaque rounded-2xl p-5 space-y-4 shadow-2xl backdrop-blur-md text-left animate-slideUp">
            
            <div className="text-center border-b border-border-opaque pb-3.5 space-y-1">
              <span className="bg-surface-positive/20 text-content-positive border border-positive-400 px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider">
                {t('matchDetected')}
              </span>
              <h3 className="text-sm font-bold text-white font-sans mt-2">{t('driverEnRoute')}</h3>
              <p className="text-[9px] text-content-tertiary font-mono">{t('arrivingIn', { eta: assignedDriver.eta })}</p>
            </div>

            {/* Pilot Profile Identity Card */}
            <div className="flex items-center gap-4 bg-background-secondary/40 p-4 border border-border-opaque rounded-xl">
              <div className="h-16 w-16 bg-background-secondary rounded-xl flex items-center justify-center text-3xl border border-border-opaque shrink-0">
                {assignedDriver.photo}
              </div>
              <div className="space-y-1 text-xs">
                <h4 className="font-bold text-white text-sm">{assignedDriver.name}</h4>
                <div className="flex items-center gap-1.5 font-mono text-[9px]">
                  <span className="text-content-warning font-bold">{t('ratingLabel', { rating: assignedDriver.rating })}</span>
                  <span className="text-content-tertiary">•</span>
                  <span className="text-content-tertiary">{t('verifiedProfessional')}</span>
                </div>
                
                {/* Transmission Competency Verification Badge */}
                <span className="bg-surface-positive/30 text-content-positive border border-positive-400/50 px-2.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase inline-block">
                  {assignedDriver.transmission === 'MANUAL' ? t('manualCertified') : t('automaticCertified')}
                </span>
              </div>
            </div>

            {/* Matched Vehicle Context Label */}
            <div className="bg-background-secondary/40 p-3.5 border border-border-opaque rounded-xl text-xs font-mono text-content-secondary leading-normal">
              🚗 <span className="text-content-tertiary font-bold uppercase text-[9px]">{t('vehicleTarget')}</span> {t('guidingYourVehicle', { car: assignedDriver.car, plate: assignedDriver.plate })}
            </div>

            {/* Secure Communication Channels */}
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <button
                onClick={() => alert('📞 Connection routed: Dialing proxy number +91 99999 88888. Real identity secure.')}
                className="bg-background-secondary hover:bg-background-tertiary border border-border-opaque py-3 rounded-xl font-bold uppercase text-content-secondary cursor-pointer text-center"
              >
                📞 Secure Call
              </button>
              <button
                onClick={() => setShowChatModal(true)}
                className="bg-background-secondary hover:bg-background-tertiary border border-border-opaque py-3 rounded-xl font-bold uppercase text-content-secondary cursor-pointer text-center"
              >
                💬 In-App Chat
              </button>
            </div>

            <button
              onClick={() => {
                const orderId = bookingSpecs?.orderId || 'trp-sandbox-99';
                router.push(`/rider/trip/live?tripId=${orderId}`);
              }}
              className="w-full bg-white hover:bg-background-tertiary text-black py-4 rounded-xl text-xs font-bold uppercase tracking-wider transition active:scale-95 cursor-pointer text-center font-sans mt-2"
            >
              ➔ Open Active Journey Timelines
            </button>
          </div>
        )}

        {/* State C: TIMEOUT_FALLBACK - Out-of-service matrix overlay */}
        {matchState === 'TIMEOUT' && (
          <div className="w-full max-w-md mx-auto bg-background-primary/95 border border-border-opaque rounded-2xl p-6 space-y-5 shadow-2xl backdrop-blur-md text-left animate-slideUp">
            
            <div className="text-center border-b border-border-opaque pb-3.5">
              <span className="text-4xl block animate-bounce">🔍</span>
              <h3 className="text-base font-bold text-white font-mono uppercase tracking-widest mt-3">No Driver Available Nearby</h3>
              <p className="text-[10px] text-content-secondary font-sans leading-normal mt-1">
                Regional demand spike in Kolkata Sector V area. Scanning bounds limits reached without pilot allocation handshake.
              </p>
            </div>

            {/* Recovery actions selector */}
            <div className="flex flex-col gap-2.5 font-mono text-xs uppercase font-bold">
              {/* Immediate Re-Queue Selector */}
              <button
                onClick={handleRequeueSearch}
                className="w-full bg-white hover:bg-background-tertiary text-black py-4 rounded-xl transition cursor-pointer active:scale-95 text-center font-sans"
              >
                🔄 Re-verify & Re-queue Match
              </button>

              {/* Radius Expansion Multiplier Trigger */}
              <button
                onClick={() => {
                  setScanRadiusExpanded(true);
                  handleRequeueSearch();
                  alert('🔍 Spatial parameters expanded: Grid scope widened to adjacent H3 cells.');
                }}
                className="w-full bg-background-secondary hover:bg-background-tertiary text-content-secondary border border-border-opaque py-3.5 rounded-xl transition cursor-pointer text-center"
              >
                📡 Expand Scan search Radius
              </button>

              {/* Future Scheduler Integration Drawer */}
              <button
                onClick={() => setShowSchedulerModal(true)}
                className="w-full bg-background-secondary hover:bg-background-tertiary text-content-secondary border border-border-opaque py-3.5 rounded-xl transition cursor-pointer text-center"
              >
                📅 Convert to scheduled trip
              </button>
            </div>

            <button
              onClick={() => router.push('/rider')}
              className="w-full text-center text-content-tertiary hover:text-white font-mono text-[9px] uppercase tracking-widest font-bold block pt-2"
            >
              ← Back to booking console
            </button>
          </div>
        )}

      </main>

      {/* ==================== ABORT JUSTIFICATION CANCELLATION OVERLAY SHEET ==================== */}
      {showCancelConfirmation && (
        <div className="fixed inset-0 z-[999999] bg-black/85 backdrop-blur-md flex flex-col justify-end sm:justify-center items-center p-0 sm:p-6 animate-fadeIn">
          <div className="w-full sm:max-w-md bg-background-primary border-t sm:border border-border-opaque rounded-t-3xl sm:rounded-2xl p-6 space-y-5 text-left">
            <div className="space-y-1">
              <span className="bg-surface-negative/20 text-content-negative border border-negative-400/60 px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider">
                CANCEL DISPATCH WARNING
              </span>
              <h3 className="text-sm font-bold text-white font-mono mt-2 uppercase">Post-Match Penalty Indicator</h3>
              <p className="text-[10px] text-content-secondary font-sans leading-normal">
                Cancellation grace period of 30 seconds has expired. Proceeding will apply an immediate cancellation penalty of ₹50 directly onto your ledger account.
              </p>
            </div>

            {/* Abort Reason Justification Selectors */}
            <div className="space-y-2 text-xs font-mono font-bold">
              <label className="block text-[8px] uppercase font-bold text-content-tertiary mb-1">Select cancellation reason</label>
              {[
                'Driver too far away / ETA mismatch',
                'Plans changed / No longer require pilot',
                'Vehicle mechanical issue / Incorrect details',
                'Decided to drive myself'
              ].map((reason) => (
                <button
                  key={reason}
                  onClick={() => setCancelReason(reason)}
                  className={`w-full py-3 px-4 border rounded-xl text-left text-[10px] transition ${
                    cancelReason === reason
                      ? 'bg-surface-negative/30 border-negative-400 text-content-negative'
                      : 'bg-background-secondary/50 border-border-opaque text-content-secondary hover:text-white'
                  }`}
                >
                  {cancelReason === reason ? '✔️ ' : ''}{reason}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-2">
              <button
                onClick={() => setShowCancelConfirmation(false)}
                className="bg-background-secondary hover:bg-background-tertiary border border-border-opaque py-3 rounded-xl font-bold uppercase text-content-secondary cursor-pointer text-center"
              >
                Keep Searching
              </button>
              <button
                onClick={handleConfirmCancel}
                disabled={!cancelReason}
                className={`py-3 rounded-xl font-bold uppercase text-center cursor-pointer ${
                  cancelReason 
                    ? 'bg-negative-400 hover:bg-negative-400 text-white border border-negative-400' 
                    : 'bg-background-secondary text-content-tertiary border border-transparent cursor-not-allowed'
                }`}
              >
                Confirm Cancel (Charge ₹50)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== IN-APP CHAT MESSAGE GATEWAY OVERLAY ==================== */}
      {showChatModal && assignedDriver && (
        <div className="fixed inset-0 z-[999999] bg-black/90 backdrop-blur-md flex flex-col justify-end items-center p-0 sm:p-6 animate-fadeIn">
          <div className="w-full sm:max-w-md h-[80vh] sm:h-[650px] bg-background-primary border-t sm:border border-border-opaque rounded-t-3xl sm:rounded-2xl flex flex-col justify-between overflow-hidden shadow-2xl text-left">
            
            {/* Header info */}
            <div className="bg-background-secondary/50 p-4 border-b border-border-opaque flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">👨🏽‍✈️</span>
                <div>
                  <h4 className="font-bold text-xs text-white leading-none">{assignedDriver.name}</h4>
                  <span className="text-[8px] text-content-tertiary font-mono block mt-1 uppercase">PILOT MASKED CONNECTION PORT</span>
                </div>
              </div>
              <button
                onClick={() => setShowChatModal(false)}
                className="text-xs font-mono text-content-tertiary hover:text-white uppercase font-bold"
              >
                Close
              </button>
            </div>

            {/* Messages body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-background-primary/20">
              {chatMessages.map((msg, i) => (
                <div 
                  key={i} 
                  className={`flex flex-col max-w-[80%] ${msg.sender === 'RIDER' ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                >
                  <div 
                    className={`p-3 rounded-2xl text-xs leading-relaxed ${
                      msg.sender === 'RIDER' 
                        ? 'bg-accent-400 text-white rounded-tr-none' 
                        : 'bg-background-secondary text-content-secondary rounded-tl-none border border-border-opaque'
                    }`}
                  >
                    {msg.text}
                  </div>
                  <span className="text-[7px] font-mono text-content-tertiary mt-1">{msg.time}</span>
                </div>
              ))}
            </div>

            {/* Input bar */}
            <form onSubmit={handleSendChatMessage} className="bg-background-primary border-t border-border-opaque p-3 flex gap-2 shrink-0">
              <input
                type="text"
                value={newChatMessage}
                onChange={(e) => setNewChatMessage(e.target.value)}
                placeholder="Type messaging to operator..."
                className="flex-1 bg-background-secondary border border-border-opaque rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-border-opaque font-sans"
              />
              <button
                type="submit"
                className="bg-white text-black font-mono font-bold text-[9px] px-4.5 rounded-xl uppercase hover:bg-background-tertiary transition"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ==================== FUTURE SCHEDULER DRAWER OVERLAY ==================== */}
      {showSchedulerModal && (
        <div className="fixed inset-0 z-[999999] bg-black/85 backdrop-blur-md flex flex-col justify-end sm:justify-center items-center p-0 sm:p-6 animate-fadeIn">
          <div className="w-full sm:max-w-md bg-background-primary border-t sm:border border-border-opaque rounded-t-3xl sm:rounded-2xl p-6 space-y-4 text-left">
            <div className="space-y-1">
              <span className="bg-surface-accent/20 text-content-accent border border-border-accent/60 px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider">
                Future Scheduling drawer
              </span>
              <h3 className="text-sm font-bold text-white font-mono mt-2 uppercase">Plan booking for later</h3>
              <p className="text-[10px] text-content-secondary font-sans leading-normal">
                Convert failed real-time scan matching sequence into a pre-reserved scheduled appointment. A driver will be dispatched 30 mins before target time.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="space-y-1">
                <label className="block text-[8px] uppercase text-content-tertiary font-bold">Select Date</label>
                <input
                  type="date"
                  defaultValue="2026-06-04"
                  className="w-full bg-background-secondary border border-border-opaque rounded-lg p-2 text-white outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[8px] uppercase text-content-tertiary font-bold">Select Time</label>
                <input
                  type="time"
                  defaultValue="16:00"
                  className="w-full bg-background-secondary border border-border-opaque rounded-lg p-2 text-white outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-3">
              <button
                onClick={() => setShowSchedulerModal(false)}
                className="bg-background-secondary hover:bg-background-tertiary border border-border-opaque py-3 rounded-xl font-bold uppercase text-content-secondary cursor-pointer text-center"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowSchedulerModal(false);
                  alert('📅 Booking converted successfully to scheduled appointment queue.');
                  router.push('/rider');
                }}
                className="bg-white hover:bg-background-tertiary text-black py-3 rounded-xl font-bold uppercase text-center cursor-pointer"
              >
                Confirm Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer Details */}
      <footer className="bg-background-primary py-3.5 text-center text-[7px] font-mono text-content-tertiary border-t border-border-opaque z-50 select-none">
        ENCRYPTED SHA-256 MATCHER RADAR • SHARD REPLICA ACTIVE
      </footer>
    </div>
  );
}
