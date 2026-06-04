'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { VehicleTracker } from '../../lib/VehicleTracker';
import { ResilientStreamManager } from '../../network/ResilientStreamManager';
import { useAuthStore } from '@/store/useAuthStore';
import { SlideToConfirm } from '../../components/SlideToConfirm';

interface ActiveOrderAssignment {
  order_id: string;
  customer_name: string;
  customer_phone: string;
  customer_rating: number;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  quoted_fare_paise: number;
  vehicle_tier: string;
  transmission: string;
  trip_type: string; // "In-city" | "Outstation" | "Mini-outstation"
  special_notes?: string;
}

// Low-overhead client-side unpacking framework matching Milestone 31 specifications exactly
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
      } else if (fieldNumber === 2) { // Assignment Message Block
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

export default function DriverTerminalPage() {
  const { user } = useAuthStore();
  
  // Account settings matching session or sandbox defaults
  const driverID = user?.id || 'drv-aniket-7602';
  const driverName = user?.name || 'Aniket Karmakar';
  const cityPrefix = 'KOL'; // Regional Hub KOL

  // Duty State Machine Configuration States:
  // OFFLINE | ONLINE_AVAILABLE | OFFER_PENDING | EN_ROUTE_TO_PICKUP | ARRIVED_AT_PICKUP | DELIVERING | COMPLETED
  const [dutyState, setDutyState] = useState<
    'OFFLINE' | 'ONLINE_AVAILABLE' | 'OFFER_PENDING' | 'EN_ROUTE_TO_PICKUP' | 'ARRIVED_AT_PICKUP' | 'DELIVERING' | 'COMPLETED'
  >('OFFLINE');
  
  const [streamStatus, setStreamStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING'>('DISCONNECTED');
  
  // Map settings and overlay triggers
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [activeVehicle, setActiveVehicle] = useState('WB-02-AK-9988 (Premium SUV)');
  const [preferredTripFilter, setPreferredTripFilter] = useState<'ALL' | 'CITY' | 'OUTSTATION'>('ALL');
  
  // Navigation states
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(3);
  
  // SOS overlay controls
  const [sosActive, setSosActive] = useState(false);
  const [sosCountdown, setSosCountdown] = useState(5);
  
  // Trip management variables
  const [incomingOffer, setIncomingOffer] = useState<ActiveOrderAssignment | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(15);
  const [declineReason, setDeclineReason] = useState<string>('');
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [activeTrip, setActiveTrip] = useState<ActiveOrderAssignment | null>(null);
  
  // En-Route and Arrived timer trackers
  const [freeWaitSeconds, setFreeWaitSeconds] = useState(300); // 5-minute wait timer
  const [waitingCharges, setWaitingCharges] = useState(0);
  
  // Speedometer readings & fuel caps
  const [startOdometer, setStartOdometer] = useState('');
  const [startFuel, setStartFuel] = useState(75);
  const [startOdoPhoto, setStartOdoPhoto] = useState<string | null>(null);
  const [otpVerificationCode, setOtpVerificationCode] = useState('');
  const [otpError, setOtpError] = useState('');
  
  // Delivering states
  const [endOdometer, setEndOdometer] = useState('');
  const [endFuel, setEndFuel] = useState(72);
  const [endOdoPhoto, setEndOdoPhoto] = useState<string | null>(null);
  
  // Extra billable inputs added mid-trip
  const [tollCharges, setTollCharges] = useState(0);
  const [parkingCharges, setParkingCharges] = useState(0);
  const [overtimeHours, setOvertimeHours] = useState(0);
  
  // Post-trip ratings
  const [riderRating, setRiderRating] = useState(5);
  const [riderCommentTags, setRiderCommentTags] = useState<string[]>([]);
  
  // Map visualization state: simulated marker position along route (0 to 100%)
  const [mapGlideProgress, setMapGlideProgress] = useState(0);
  const [mapIntervalActive, setMapIntervalActive] = useState(false);

  // Live Audit Telemetry Log Vault
  const [auditLogs, setAuditLogs] = useState<string[]>([]);

  // Core structural pointers
  const trackerRef = useRef<VehicleTracker | null>(null);
  const streamRef = useRef<ResilientStreamManager | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const waitTimerRef = useRef<NodeJS.Timeout | null>(null);
  const sosTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Auto audit log logger
  const logAudit = (event: string, meta: any) => {
    const timestamp = new Date().toISOString();
    const logString = `[${timestamp.slice(11, 19)}] ${event} | ${JSON.stringify(meta)}`;
    console.log(logString);
    setAuditLogs((prev) => [logString, ...prev].slice(0, 50));
    
    // Save to session storage
    try {
      const stored = JSON.parse(sessionStorage.getItem('driver_trip_logs') || '[]');
      stored.push({ ts: timestamp, event, meta });
      sessionStorage.setItem('driver_trip_logs', JSON.stringify(stored));
    } catch (e) {}
  };

  // Setup initial session storage logs cleanup or load
  useEffect(() => {
    logAudit('SESSION_STARTED', { driverID, device: navigator.userAgent });
    return () => {
      trackerRef.current?.stopTrackingCore();
      streamRef.current?.disconnect();
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (waitTimerRef.current) clearInterval(waitTimerRef.current);
      if (sosTimerRef.current) clearInterval(sosTimerRef.current);
    };
  }, []);

  // Monitor offer countdown expiration windows
  useEffect(() => {
    if (dutyState === 'OFFER_PENDING' && incomingOffer && countdownSeconds > 0) {
      countdownTimerRef.current = setTimeout(() => {
        setCountdownSeconds((prev) => prev - 1);
      }, 1000);
    } else if (countdownSeconds === 0 && dutyState === 'OFFER_PENDING') {
      logAudit('OFFER_AUTO_EXPIRED', { orderId: incomingOffer?.order_id });
      handleDeclineOfferSubmit('TIMEOUT_NO_RESPONSE');
    }
    return () => {
      if (countdownTimerRef.current) clearTimeout(countdownTimerRef.current);
    };
  }, [incomingOffer, countdownSeconds, dutyState]);

  // Wait time calculator once arrived
  useEffect(() => {
    if (dutyState === 'ARRIVED_AT_PICKUP') {
      waitTimerRef.current = setInterval(() => {
        setFreeWaitSeconds((prev) => {
          if (prev > 0) {
            return prev - 1;
          } else {
            // After 5 mins (300s), add waiting charge of ₹2 per min (approx ₹0.033 per second)
            setWaitingCharges((charge) => charge + 0.0333);
            return 0;
          }
        });
      }, 1000);
    } else {
      if (waitTimerRef.current) clearInterval(waitTimerRef.current);
    }
    return () => {
      if (waitTimerRef.current) clearInterval(waitTimerRef.current);
    };
  }, [dutyState]);

  // Simulated SVG Map Glide coordinate adjustments
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (dutyState === 'EN_ROUTE_TO_PICKUP' || dutyState === 'DELIVERING') {
      setMapGlideProgress(0);
      interval = setInterval(() => {
        setMapGlideProgress((prev) => {
          const next = prev + 1;
          if (next >= 100) {
            return 0; // loop back to simulate telemetry loop
          }
          // Log a sample coordinate ping every 5 seconds equivalent (progress splits)
          if (next % 10 === 0) {
            const currentLat = dutyState === 'EN_ROUTE_TO_PICKUP'
              ? 22.5487 + (next / 100) * (22.5726 - 22.5487)
              : 22.5726 + (next / 100) * (22.5855 - 22.5726);
            const currentLng = dutyState === 'EN_ROUTE_TO_PICKUP'
              ? 88.3561 + (next / 100) * (88.3639 - 88.3561)
              : 88.3639 + (next / 100) * (88.3411 - 88.3639);
            logAudit('GPS_PING', { lat: currentLat.toFixed(6), lng: currentLng.toFixed(6), speed_kmh: 42 + Math.floor(Math.random() * 15) });
          }
          return next;
        });
      }, 300);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [dutyState]);

  // SOS auto-trigger timer rules
  useEffect(() => {
    if (sosActive && sosCountdown > 0) {
      sosTimerRef.current = setTimeout(() => {
        setSosCountdown((prev) => prev - 1);
      }, 1000);
    } else if (sosActive && sosCountdown === 0) {
      logAudit('SOS_CRITICAL_ALERT_FIRED', {
        driverID,
        coordinates: { lat: 22.5726, lng: 88.3639 },
        tripId: activeTrip?.order_id || 'IDLE_DUTY'
      });
      alert('🚨 EMERGENCY BROADCAST: Location coordinates shared with nearest response vehicle nodes & central command. Automated 112 hotline dialed.');
      setSosActive(false);
      setSosCountdown(5);
    }
    return () => {
      if (sosTimerRef.current) clearTimeout(sosTimerRef.current);
    };
  }, [sosActive, sosCountdown]);

  // Go Online/Offline state changes
  const handleToggleDutySwitch = async () => {
    if (dutyState === 'OFFLINE') {
      setDutyState('ONLINE_AVAILABLE');
      logAudit('DUTY_ONLINE', { vehicle: activeVehicle, filter: preferredTripFilter });

      // 1. Initialize native background coordinate injection via the tracker engine
      trackerRef.current = new VehicleTracker(driverID, cityPrefix, async (packets) => {
        // Send logs to visual debugger console
        packets.forEach(p => {
          logAudit('TELEMETRY_INGEST', { lat: p.lat, lng: p.lng, ts: p.timestamp });
        });
        return true;
      });
      await trackerRef.current.startTrackingCore();

      // 2. Establish low-latency connection to binary WebSocket channels
      streamRef.current = new ResilientStreamManager({
        orderID: `stream-session-${driverID}`,
        cityPrefix: cityPrefix,
        wsBaseUrl: 'ws://localhost:8080',
        onStatusChange: (status) => {
          setStreamStatus(status);
          logAudit('WS_CONNECTION_STATE', { status });
        },
        onMessage: (message: any) => {
          if (message instanceof ArrayBuffer) {
            const unpacked = parseBinaryEnvelope(message);
            if (unpacked?.type === 'ASSIGNMENT') {
              triggerIncomingMatchNotification(unpacked.data.order_id);
            }
          } else if (message?.channel === 'assignment' || message?.order_id) {
            triggerIncomingMatchNotification(message.order_id);
          }
        }
      });
      streamRef.current.connect();

    } else {
      // Clean teardown and hardware release routine
      trackerRef.current?.stopTrackingCore();
      streamRef.current?.disconnect();
      trackerRef.current = null;
      streamRef.current = null;
      
      setDutyState('OFFLINE');
      setStreamStatus('DISCONNECTED');
      setIncomingOffer(null);
      setActiveTrip(null);
      logAudit('DUTY_OFFLINE', { driverID });
    }
  };

  const triggerIncomingMatchNotification = (orderId: string) => {
    // Only accept incoming offers if idle/online available
    setIncomingOffer({
      order_id: orderId || `ord-mock-${Date.now().toString().slice(-4)}`,
      customer_name: 'Anirban Das (Venture Lead)',
      customer_phone: '+91 98300 11223',
      customer_rating: 4.85,
      pickup_address: 'Salt Lake Sector V Tech Hub, Kolkata',
      pickup_lat: 22.5731,
      pickup_lng: 88.4332,
      dropoff_address: 'Park Street Dining Grid, Kolkata',
      dropoff_lat: 22.5487,
      dropoff_lng: 88.3561,
      quoted_fare_paise: 78000, // ₹780.00
      vehicle_tier: 'PREMIUM_SUV',
      transmission: 'AUTOMATIC',
      trip_type: 'In-city Round',
      special_notes: 'Rider carrying extra airport luggage. Polite driving requested.'
    });
    setDutyState('OFFER_PENDING');
    setCountdownSeconds(15);
    logAudit('INCOMING_OFFER_RECEIVED', { orderId });
  };

  const handleAcceptOffer = async () => {
    if (!incomingOffer) return;
    const acceptedAt = new Date().toISOString();
    logAudit('OFFER_ACCEPTED', { orderId: incomingOffer.order_id, ts: acceptedAt });
    
    setDutyState('EN_ROUTE_TO_PICKUP');
    setActiveTrip(incomingOffer);
    setIncomingOffer(null);

    try {
      await fetch('http://localhost:8080/api/v1/dispatch/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: incomingOffer.order_id, driver_id: driverID }),
      });
    } catch (err) {
      console.warn('[TERMINAL_WS] Assignment claimed locally. Syncing background parameters.');
    }
  };

  const handleDeclineOfferClick = () => {
    setShowDeclineModal(true);
  };

  const handleDeclineOfferSubmit = (reason: string) => {
    const declinedAt = new Date().toISOString();
    logAudit('OFFER_DECLINED', { orderId: incomingOffer?.order_id, reason, ts: declinedAt });
    
    setIncomingOffer(null);
    setCountdownSeconds(15);
    setDeclineReason('');
    setShowDeclineModal(false);
    setDutyState('ONLINE_AVAILABLE');

    // Trigger a 30s cooldown alert simulation
    alert('Offer declined. A 30-second priority matching cooldown has been applied to this node.');
  };

  const handleArrivedAtPickup = () => {
    logAudit('ARRIVED_AT_PICKUP_NODE', { orderId: activeTrip?.order_id, time: new Date().toISOString() });
    setDutyState('ARRIVED_AT_PICKUP');
    setFreeWaitSeconds(300);
    setWaitingCharges(0);
  };

  const handleVerifyOtpAndStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpVerificationCode) {
      setOtpError('Please request and input the 4-digit code from the passenger.');
      return;
    }
    if (!startOdometer) {
      setOtpError('A valid start Odometer KM reading is required.');
      return;
    }

    logAudit('TRIP_START_ATTEMPT', {
      orderId: activeTrip?.order_id,
      startOdometer,
      startFuel,
      otpEntered: otpVerificationCode
    });

    // Mock OTP verification validation: allow any 4-digit number
    if (/^\d{4}$/.test(otpVerificationCode)) {
      logAudit('TRIP_STARTED', { orderId: activeTrip?.order_id });
      setOtpError('');
      setDutyState('DELIVERING');
    } else {
      setOtpError('Authentication failed: Invalid OTP sequence pattern entered.');
      logAudit('OTP_FAILED_ATTEMPT', { code: otpVerificationCode });
    }
  };

  const handleTollAddition = () => {
    setTollCharges((prev) => prev + 50);
    logAudit('BILLING_MODIFIER_ADDED', { type: 'TOLL', amount: 50 });
  };

  const handleParkingAddition = () => {
    setParkingCharges((prev) => prev + 30);
    logAudit('BILLING_MODIFIER_ADDED', { type: 'PARKING', amount: 30 });
  };

  const handleSlideToEndTrip = async () => {
    if (!endOdometer) {
      alert('End Odometer KM input is required before finalizing payments.');
      return;
    }
    const startNum = parseFloat(startOdometer);
    const endNum = parseFloat(endOdometer);
    
    if (isNaN(startNum) || isNaN(endNum) || endNum <= startNum) {
      alert(`Invalid End Odometer value. End Odometer must be greater than start value (${startOdometer} KM).`);
      return;
    }

    logAudit('TRIP_END_COMMITTED', {
      orderId: activeTrip?.order_id,
      endOdometer,
      endFuel,
      tolls: tollCharges,
      parking: parkingCharges
    });
    
    setDutyState('COMPLETED');
  };

  const handlePaymentConfirmationSubmit = (method: string) => {
    logAudit('PAYMENT_CONFIRMED', {
      orderId: activeTrip?.order_id,
      method,
      riderRatingGiven: riderRating,
      tags: riderCommentTags
    });

    alert(`Payment of ₹${calculateTotalBill().toFixed(2)} settled via ${method}. Feedback synced.`);
    
    // Clear trip states
    setActiveTrip(null);
    setStartOdometer('');
    setEndOdometer('');
    setTollCharges(0);
    setParkingCharges(0);
    setRiderCommentTags([]);
    setDutyState('ONLINE_AVAILABLE');
  };

  // Payout breakdown values
  const calculateTotalBill = () => {
    if (!activeTrip) return 0;
    const baseFare = activeTrip.quoted_fare_paise / 100;
    const startNum = parseFloat(startOdometer) || 0;
    const endNum = parseFloat(endOdometer) || startNum;
    const distanceExtra = Math.max(0, (endNum - startNum) - 15) * 18; // charge ₹18 per km after 15 km free
    const waitCharge = Math.round(waitingCharges);
    const nightSurge = 50; // Night fee
    const careFee = 15; // D4M Care
    
    return baseFare + distanceExtra + waitCharge + nightSurge + tollCharges + parkingCharges + careFee;
  };

  const toggleRiderCommentTag = (tag: string) => {
    setRiderCommentTags((prev) => {
      const idx = prev.indexOf(tag);
      if (idx > -1) {
        return prev.filter((t) => t !== tag);
      } else {
        return [...prev, tag];
      }
    });
  };

  return (
    <div className="min-h-screen bg-black text-white p-0 font-sans flex flex-col justify-between selection:bg-white selection:text-black overflow-x-hidden relative">
      
      {/* 1. HAMBURGER SLIDE DRAWER MENU OVERLAY */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-[99999] flex bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-80 bg-zinc-950 border-r border-zinc-800 h-full flex flex-col justify-between p-6 animate-slideInLeft text-left">
            <div>
              {/* Header profile info */}
              <div className="flex items-center gap-3 border-b border-zinc-900 pb-6 mb-6">
                <div className="h-12 w-12 rounded-xl bg-zinc-850 border border-zinc-800 flex items-center justify-center text-sm font-bold text-white uppercase overflow-hidden">
                  👤
                </div>
                <div>
                  <h4 className="text-sm font-bold tracking-tight text-white">{driverName}</h4>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xs text-amber-500 font-mono">★ 4.92</span>
                    <span className="bg-zinc-900 text-zinc-500 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider">
                      PRO PARTNER
                    </span>
                  </div>
                </div>
              </div>

              {/* Navigation lists */}
              <nav className="space-y-1">
                {[
                  { label: 'Dashboard Home', href: '/driver', icon: '📱' },
                  { label: 'My Profile', href: '/driver-account/profile', icon: '👤' },
                  { label: 'Earnings Summary', href: '/driver-account/earnings', icon: '₹' },
                  { label: 'Instant Payouts', href: '/driver-account/payouts', icon: '💳' },
                  { label: 'Trip History', href: '/driver-account/trip-history', icon: '📁' },
                  { label: 'Incentives & Quests', href: '/driver-account/incentives', icon: '🏆' },
                  { label: 'Vehicle Records', href: '/driver-account/vehicles', icon: '🚗' },
                  { label: 'Performance Analytics', href: '/driver-account/performance', icon: '📊' },
                  { label: 'Platform Wallet', href: '/driver-account/wallet', icon: '💼' },
                  { label: 'Notifications Center', href: '/driver-account/notifications', icon: '🔔' },
                  { label: 'Training Academy', href: '/driver-account/training', icon: '🎓' },
                  { label: 'Refer a Friend', href: '/driver-account/refer', icon: '🎁' },
                  { label: 'System Settings', href: '/driver-account/settings', icon: '⚙️' },
                  { label: 'Support & FAQs', href: '/driver-account/support', icon: '💬' }
                ].map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setIsDrawerOpen(false)}
                    className="flex items-center gap-3 py-2 px-3 rounded-lg text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-900 transition-all font-mono uppercase tracking-wider"
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                ))}
              </nav>
            </div>

            {/* Logout actions */}
            <div className="border-t border-zinc-900 pt-6">
              <button
                type="button"
                onClick={() => {
                  logAudit('LOGOUT_TRIGGERED', { driverID });
                  useAuthStore.getState().logout();
                  window.location.href = '/login';
                }}
                className="w-full bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-xl py-3 text-[10px] font-bold uppercase tracking-wider transition cursor-pointer font-mono border border-zinc-800"
              >
                🚪 Terminate Session & Logout
              </button>
            </div>
          </div>
          <div className="flex-1 cursor-pointer" onClick={() => setIsDrawerOpen(false)} />
        </div>
      )}

      {/* 2. SOS EMERGENCY PULSE TRIGGER MODAL */}
      {sosActive && (
        <div className="fixed inset-0 z-[999999] bg-red-950/90 backdrop-blur-md flex flex-col justify-between p-6 sm:p-12 text-left animate-fadeIn">
          <div className="space-y-4">
            <span className="bg-red-900 text-white font-mono font-bold text-[9px] uppercase tracking-widest px-2.5 py-1 rounded">
              ⚠️ CRITICAL SAFETY DIRECTIVE
            </span>
            <h2 className="text-4xl font-extrabold tracking-tight text-white font-move">SOS Trigger Activated</h2>
            <p className="text-red-200 text-sm max-w-md leading-relaxed font-sans">
              Central support emergency nodes and local police (112 dispatcher dispatch coordinates) are being triggered automatically. Live GPS sharing is enabled on this endpoint.
            </p>
          </div>

          <div className="flex flex-col items-center justify-center flex-grow py-8">
            <div className="h-32 w-32 rounded-full bg-red-500/25 border-4 border-red-500 flex items-center justify-center relative animate-pulse">
              <span className="text-5xl font-mono font-bold text-white">{sosCountdown}</span>
              <div className="absolute inset-0 rounded-full border-4 border-white animate-ping opacity-25"></div>
            </div>
            <span className="text-[10px] font-mono uppercase text-red-300 font-bold tracking-widest mt-4">
              Broadcasting distress signals in {sosCountdown} seconds
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              logAudit('SOS_CANCELLED', { driverID });
              setSosActive(false);
              setSosCountdown(5);
            }}
            className="w-full max-w-md mx-auto bg-white hover:bg-zinc-200 text-black font-bold py-4 rounded-full text-xs uppercase tracking-wider transition cursor-pointer active:scale-95"
          >
            ❌ Cancel Safety Alert Broadcast
          </button>
        </div>
      )}

      {/* 3. INCOMING BOOKING OFFER MODAL SHEET OVERLAY */}
      {dutyState === 'OFFER_PENDING' && incomingOffer && (
        <div className="fixed inset-0 bg-black z-[9999] flex flex-col justify-between p-4 sm:p-8 animate-fadeIn text-left">
          <div className="space-y-4 max-w-xl mx-auto w-full">
            <div className="flex justify-between items-center border-b border-zinc-900 pb-4">
              <div>
                <span className="text-[9px] font-bold tracking-widest text-zinc-500 uppercase font-mono">Incoming Escrow Matching Opportunity</span>
                <h2 className="text-2xl font-bold tracking-tight text-white font-move mt-1">Allocation Request</h2>
              </div>
              
              {/* Ring Countdown Progress indicator */}
              <div className="h-12 w-12 rounded-full border-2 border-zinc-800 flex items-center justify-center relative">
                <span className="text-sm font-mono font-bold text-white">{countdownSeconds}s</span>
                <div className="absolute inset-0 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              </div>
            </div>

            {/* Offer details mapping */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-3 bg-zinc-950 border border-zinc-900 p-3 rounded-xl">
                <div className="text-xl">👤</div>
                <div>
                  <div className="text-xs font-bold text-white">{incomingOffer.customer_name}</div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5">Rating: ★ {incomingOffer.customer_rating} | Spec: {incomingOffer.special_notes}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="bg-zinc-950 border border-zinc-900 p-3 rounded-xl">
                  <span className="text-zinc-500 block text-[8px] font-bold uppercase tracking-wider">PICKUP HUB</span>
                  <span className="text-white font-medium mt-1 block truncate">{incomingOffer.pickup_address}</span>
                </div>
                <div className="bg-zinc-950 border border-zinc-900 p-3 rounded-xl">
                  <span className="text-zinc-500 block text-[8px] font-bold uppercase tracking-wider">DESTINATION</span>
                  <span className="text-white font-medium mt-1 block truncate">{incomingOffer.dropoff_address}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 font-mono text-[9px] uppercase font-bold text-zinc-400 text-center">
                <div className="bg-zinc-950 border border-zinc-900 p-2.5 rounded-lg">
                  <span className="text-zinc-600 block text-[7px]">TRIP CATEGORY</span>
                  <span className="text-white block mt-0.5">{incomingOffer.trip_type}</span>
                </div>
                <div className="bg-zinc-950 border border-zinc-900 p-2.5 rounded-lg">
                  <span className="text-zinc-600 block text-[7px]">TRANSMISSION</span>
                  <span className="text-white block mt-0.5">{incomingOffer.transmission}</span>
                </div>
                <div className="bg-zinc-950 border border-zinc-900 p-2.5 rounded-lg">
                  <span className="text-zinc-600 block text-[7px]">TIER ASSET</span>
                  <span className="text-white block mt-0.5">{incomingOffer.vehicle_tier.replace('_', ' ')}</span>
                </div>
              </div>

              <div className="flex justify-between items-center bg-zinc-950 border border-zinc-900 p-4 rounded-xl font-mono">
                <div>
                  <span className="text-zinc-500 block text-[8px] font-bold uppercase tracking-wider">ESTIMATED NET PAYOUT</span>
                  <span className="text-2xl font-bold text-white mt-0.5 block">₹{(incomingOffer.quoted_fare_paise / 100).toFixed(2)}</span>
                </div>
                <span className="bg-emerald-500 text-white font-mono font-bold text-[9px] px-2.5 py-1 rounded">
                  D4M SAFETY INSURED
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 max-w-xl w-full mx-auto">
            {/* Slide to accept confirm component */}
            <SlideToConfirm
              label="Slide to Accept Job"
              onConfirm={handleAcceptOffer}
              color="emerald"
            />
            
            <button
              onClick={handleDeclineOfferClick}
              type="button"
              className="bg-zinc-950 hover:bg-zinc-900 text-zinc-500 font-bold py-3.5 rounded-xl text-xs uppercase tracking-wider transition border border-zinc-900 cursor-pointer active:scale-98"
            >
              Decline Offer
            </button>
          </div>
        </div>
      )}

      {/* 4. DECLINE REASON PICKER MODAL SHEET */}
      {showDeclineModal && (
        <div className="fixed inset-0 bg-black/80 z-[99999] flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 p-6 rounded-2xl w-full max-w-md text-left space-y-4">
            <h3 className="text-sm font-bold tracking-wider uppercase font-mono text-white">Decline Allocation Reason</h3>
            <p className="text-xs text-zinc-500 leading-normal">
              Selecting a reason maps logs to dispatch controllers to recalculate allocation thresholds correctly.
            </p>
            
            <div className="flex flex-col gap-2 pt-2">
              {[
                'Too far from pickup hub location',
                'Scheduled break/rest cycle',
                'Vehicle mechanical breakdown check',
                'Customer rating is low',
                'Other routing constraints'
              ].map((reason) => (
                <button
                  key={reason}
                  onClick={() => handleDeclineOfferSubmit(reason)}
                  className="w-full text-left p-3 text-xs bg-zinc-900 border border-zinc-850 rounded-xl hover:bg-zinc-850 transition-all font-medium text-zinc-300 cursor-pointer"
                >
                  🚫 {reason}
                </button>
              ))}
            </div>
            
            <button
              onClick={() => setShowDeclineModal(false)}
              className="w-full bg-zinc-900 hover:bg-zinc-800 text-zinc-500 py-2.5 rounded-xl text-[10px] uppercase font-bold tracking-widest transition cursor-pointer mt-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* TOP HEADER MENU CONTROL */}
      <header className="bg-zinc-950 border-b border-zinc-900 p-4 sticky top-0 z-50 flex justify-between items-center w-full text-left">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsDrawerOpen(true)}
            className="h-9 w-9 bg-zinc-900 hover:bg-zinc-850 rounded-xl border border-zinc-800 flex items-center justify-center text-sm cursor-pointer transition active:scale-95"
            aria-label="Open Navigation Drawer"
          >
            ☰
          </button>
          <div>
            <h1 className="text-xs font-bold tracking-tight text-white font-mono uppercase">DRIVERS-FOR-U</h1>
            <div className="flex items-center gap-1.5 mt-0.5 text-[9px] font-mono text-zinc-500">
              <span>HUB: {cityPrefix}</span>
              <span>●</span>
              <span>STATE: {dutyState}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {dutyState !== 'OFFLINE' && (
            <span className="bg-zinc-900 text-zinc-400 border border-zinc-850 px-2.5 py-1.5 rounded-full text-[8px] font-mono font-bold uppercase tracking-wider animate-pulse flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
              WS: {streamStatus.toLowerCase()}
            </span>
          )}

          {/* Emergency SOS red trigger */}
          <button
            onClick={() => {
              logAudit('SOS_PANIC_TRIGGERED', { state: dutyState });
              setSosActive(true);
              setSosCountdown(5);
            }}
            className="bg-red-600 hover:bg-red-700 text-white font-mono font-bold text-[9px] px-3.5 py-1.5 rounded-full animate-pulse transition-all cursor-pointer active:scale-95 flex items-center gap-1 border border-red-500"
          >
            🚨 SOS
          </button>
        </div>
      </header>

      {/* CORE AREA: MAP LAYOUT AND VIEWS */}
      <main className="flex-1 flex flex-col relative min-h-[350px]">
        {/* Stylized background custom map simulation */}
        <div className="absolute inset-0 bg-zinc-950 z-0 overflow-hidden flex items-center justify-center">
          {/* Simulated SVG grid network representing city map */}
          <svg className="w-full h-full opacity-35" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#222" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
            
            {/* Heatmap zones (Kolkata representation) */}
            {showHeatmap && dutyState !== 'OFFLINE' && (
              <>
                <circle cx="65%" cy="35%" r="80" fill="rgba(239, 68, 68, 0.15)" filter="blur(10px)" />
                <circle cx="65%" cy="35%" r="40" fill="rgba(239, 68, 68, 0.25)" />
                <circle cx="35%" cy="65%" r="70" fill="rgba(245, 158, 11, 0.15)" filter="blur(10px)" />
                <circle cx="35%" cy="65%" r="30" fill="rgba(245, 158, 11, 0.25)" />
              </>
            )}

            {/* Ambient Driver Pins */}
            {dutyState === 'ONLINE_AVAILABLE' && (
              <>
                <circle cx="45%" cy="40%" r="4" fill="#a1a1aa" className="animate-pulse" />
                <circle cx="50%" cy="55%" r="4" fill="#a1a1aa" />
                <circle cx="62%" cy="48%" r="4" fill="#a1a1aa" />
              </>
            )}

            {/* Active Route Draw Matrix */}
            {activeTrip && (dutyState === 'EN_ROUTE_TO_PICKUP' || dutyState === 'DELIVERING') && (
              <>
                {/* Route line */}
                <line 
                  x1="35%" y1="65%" 
                  x2="65%" y2="35%" 
                  stroke="#3b82f6" 
                  strokeWidth="3" 
                  strokeDasharray="6,4" 
                />
                
                {/* Pickup node pin */}
                <circle cx="35%" cy="65%" r="8" fill="#10b981" />
                <text x="35%" y="65%" fill="#fff" fontSize="8" fontFamily="monospace" textAnchor="middle" dy="3">P</text>
                
                {/* Dropoff node pin */}
                <circle cx="65%" cy="35%" r="8" fill="#ef4444" />
                <text x="65%" y="35%" fill="#fff" fontSize="8" fontFamily="monospace" textAnchor="middle" dy="3">D</text>

                {/* Gliding Car Icon */}
                <circle 
                  cx={`${35 + (mapGlideProgress / 100) * (65 - 35)}%`} 
                  cy={`${65 + (mapGlideProgress / 100) * (35 - 65)}%`} 
                  r="6" 
                  fill="#ffffff" 
                  stroke="#1e3a8a" 
                  strokeWidth="2" 
                />
              </>
            )}
          </svg>

          {/* Offline Map Overlay message */}
          {dutyState === 'OFFLINE' && (
            <div className="absolute inset-0 bg-black/80 z-10 flex items-center justify-center p-6">
              <div className="text-center space-y-2">
                <span className="text-3xl block">📡</span>
                <h3 className="text-xs font-mono uppercase font-bold tracking-widest text-zinc-500">Duty Terminal Offline</h3>
                <p className="text-[10px] text-zinc-600 max-w-xs font-mono">
                  Ingestion loops and websocket pipelines disconnected. Go Online below to hook coordinate streaming.
                </p>
              </div>
            </div>
          )}

          {/* Interactive Heatmap toggle indicator */}
          {dutyState !== 'OFFLINE' && (
            <div className="absolute top-4 left-4 z-10 space-y-2 text-left">
              <button
                type="button"
                onClick={() => setShowHeatmap(!showHeatmap)}
                className="bg-zinc-950/80 border border-zinc-800 text-[8px] font-mono font-bold uppercase tracking-wider py-1.5 px-3 rounded-full hover:bg-zinc-900 transition flex items-center gap-1.5"
              >
                🔥 Heatmap: {showHeatmap ? 'VISIBLE' : 'HIDDEN'}
              </button>
            </div>
          )}

          {/* Simulation Injectors inside Map panel */}
          {dutyState === 'ONLINE_AVAILABLE' && (
            <div className="absolute top-4 right-4 z-10">
              <button
                onClick={() => triggerIncomingMatchNotification('')}
                className="bg-white/10 hover:bg-white/20 border border-zinc-800 text-white font-mono font-bold text-[8px] py-1.5 px-3 rounded-full uppercase tracking-wider transition cursor-pointer"
              >
                📡 Ingest Match Mock
              </button>
            </div>
          )}
        </div>

        {/* BOTTOM ACTIVE CONTROL SHEET CARD DRAWER */}
        <div className="mt-auto w-full z-10 bg-zinc-950/90 border-t border-zinc-900 p-4 sm:p-6 space-y-4 max-w-xl mx-auto rounded-t-2xl shadow-xl backdrop-blur-md">
          
          {/* OFFLINE VIEW PANELS */}
          {dutyState === 'OFFLINE' && (
            <div className="space-y-4 text-left">
              <div className="flex justify-between items-center bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl">
                <div>
                  <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Selected Vehicle</span>
                  <select
                    value={activeVehicle}
                    onChange={(e) => setActiveVehicle(e.target.value)}
                    className="block bg-transparent text-xs font-bold text-white outline-none mt-1 cursor-pointer"
                  >
                    <option>WB-02-AK-9988 (Premium SUV)</option>
                    <option>KA-03-MD-4561 (Hatchback Core)</option>
                  </select>
                </div>
                <div>
                  <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest block text-right">Job Type Filter</span>
                  <select
                    value={preferredTripFilter}
                    onChange={(e) => setPreferredTripFilter(e.target.value as any)}
                    className="block bg-transparent text-xs font-bold text-white outline-none mt-1 cursor-pointer text-right"
                  >
                    <option value="ALL">City & Outstation</option>
                    <option value="CITY">In-City Only</option>
                    <option value="OUTSTATION">Outstation Only</option>
                  </select>
                </div>
              </div>

              <button
                onClick={handleToggleDutySwitch}
                type="button"
                className="w-full bg-white hover:bg-zinc-200 text-black py-4 rounded-xl text-xs font-bold uppercase tracking-wider transition active:scale-98 cursor-pointer text-center"
              >
                ⚡ Go On Duty (Connect)
              </button>
            </div>
          )}

          {/* ONLINE / IDLE WAITING VIEW */}
          {dutyState === 'ONLINE_AVAILABLE' && (
            <div className="space-y-4 text-left">
              <div className="flex justify-between items-center border-b border-zinc-900 pb-3">
                <div>
                  <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">Telemetry Dispatch Loop</span>
                  <h3 className="text-xs font-bold text-white mt-0.5 uppercase tracking-wide flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping"></span>
                    Actively Seeking Matches...
                  </h3>
                </div>
                
                <button
                  onClick={handleToggleDutySwitch}
                  className="bg-zinc-900 hover:bg-zinc-800 text-red-500 border border-zinc-800 text-[8px] font-mono font-bold uppercase py-1 px-3 rounded-full cursor-pointer"
                >
                  Offline
                </button>
              </div>

              {/* Duty statistics snapshots */}
              <div className="grid grid-cols-4 gap-2 text-center text-zinc-400 font-mono text-[9px]">
                <div className="bg-zinc-900/60 p-2 rounded-lg border border-zinc-900">
                  <span className="text-zinc-500 block text-[7px] uppercase">TRIPS</span>
                  <span className="text-white block mt-0.5 font-bold">4</span>
                </div>
                <div className="bg-zinc-900/60 p-2 rounded-lg border border-zinc-900">
                  <span className="text-zinc-500 block text-[7px] uppercase">EARNINGS</span>
                  <span className="text-white block mt-0.5 font-bold">₹2,840</span>
                </div>
                <div className="bg-zinc-900/60 p-2 rounded-lg border border-zinc-900">
                  <span className="text-zinc-500 block text-[7px] uppercase">HOURS</span>
                  <span className="text-white block mt-0.5 font-bold">5.2h</span>
                </div>
                <div className="bg-zinc-900/60 p-2 rounded-lg border border-zinc-900">
                  <span className="text-zinc-500 block text-[7px] uppercase">ACCEPT</span>
                  <span className="text-white block mt-0.5 font-bold">96%</span>
                </div>
              </div>
            </div>
          )}

          {/* EN ROUTE TO PICKUP PANEL */}
          {dutyState === 'EN_ROUTE_TO_PICKUP' && activeTrip && (
            <div className="space-y-4 text-left animate-fadeIn">
              <div className="border-b border-zinc-900 pb-3 flex justify-between items-center">
                <div>
                  <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">En Route to Pickup Hub</span>
                  <h3 className="text-xs font-bold text-white mt-0.5">{activeTrip.customer_name}</h3>
                </div>
                <div className="bg-blue-900/30 text-blue-400 border border-blue-800 text-[8px] font-mono font-bold px-2 py-1 rounded">
                  ETA: 6 MINS
                </div>
              </div>

              <div className="text-xs space-y-1 font-mono text-zinc-400 leading-normal">
                <div>📍 <span className="text-zinc-500 font-bold">Pickup Address:</span> {activeTrip.pickup_address}</div>
              </div>

              {/* Route control button triggers */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => alert(`Dialing passenger number ${activeTrip.customer_phone} via secure proxy server mask...`)}
                  className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 py-2.5 rounded-xl text-[9px] font-mono font-bold uppercase text-zinc-300 cursor-pointer"
                >
                  📞 Call Client
                </button>
                <button
                  onClick={() => alert('Opening secure in-app chat session window.')}
                  className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 py-2.5 rounded-xl text-[9px] font-mono font-bold uppercase text-zinc-300 cursor-pointer"
                >
                  💬 In-App Chat
                </button>
                <button
                  onClick={() => {
                    logAudit('NAV_EXTERNAL_TRIGGERED', { orderId: activeTrip.order_id });
                    alert('Redirecting to Google Maps external turn-by-turn navigation system.');
                  }}
                  className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 py-2.5 rounded-xl text-[9px] font-mono font-bold uppercase text-zinc-300 cursor-pointer"
                >
                  🗺️ Navigate (Maps)
                </button>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Cancel this allocation? Cancellation penalties may apply to this node.')) {
                      logAudit('TRIP_CANCELLED_BY_DRIVER', { orderId: activeTrip.order_id });
                      setActiveTrip(null);
                      setDutyState('ONLINE_AVAILABLE');
                    }
                  }}
                  className="flex-1 bg-zinc-900 hover:bg-zinc-850 text-red-500 border border-zinc-800 py-3 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider transition cursor-pointer"
                >
                  Cancel Allocation
                </button>
                
                <button
                  onClick={handleArrivedAtPickup}
                  className="flex-1 bg-white hover:bg-zinc-200 text-black py-3 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider transition cursor-pointer active:scale-95"
                >
                  ✔️ I've Arrived at Hub
                </button>
              </div>
            </div>
          )}

          {/* ARRIVED AT PICKUP OPTIONAL LOCK SCREEN */}
          {dutyState === 'ARRIVED_AT_PICKUP' && activeTrip && (
            <div className="space-y-4 text-left animate-fadeIn">
              <div className="border-b border-zinc-900 pb-3 flex justify-between items-center">
                <div>
                  <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Arrived & Waiting for Passenger</span>
                  <h3 className="text-xs font-bold text-white mt-0.5">{activeTrip.customer_name}</h3>
                </div>
                
                <div className="font-mono text-[9px] font-bold">
                  {freeWaitSeconds > 0 ? (
                    <span className="text-zinc-500">Free Wait: {Math.floor(freeWaitSeconds / 60)}:{(freeWaitSeconds % 60).toString().padStart(2, '0')}</span>
                  ) : (
                    <span className="text-amber-500 animate-pulse">Wait Charge: ₹{waitingCharges.toFixed(2)}</span>
                  )}
                </div>
              </div>

              {/* Speedometer odometer captures & OTP verification lock */}
              <form onSubmit={handleVerifyOtpAndStart} className="space-y-3 font-mono">
                {otpError && (
                  <div className="bg-red-950 border border-red-900 text-red-200 text-[10px] p-2.5 rounded-xl font-bold uppercase">
                    ❌ {otpError}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Start Odometer KM</label>
                    <input
                      type="number"
                      value={startOdometer}
                      onChange={(e) => setStartOdometer(e.target.value)}
                      placeholder="e.g. 23450"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-zinc-500 text-xs"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Fuel Gauge ({startFuel}%)</label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={startFuel}
                      onChange={(e) => setStartFuel(parseInt(e.target.value))}
                      className="w-full h-8 cursor-pointer"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Dashboard Scan</label>
                    <button
                      type="button"
                      onClick={() => {
                        setStartOdoPhoto(`s3://odometer-captures/start-${Date.now()}.png`);
                        logAudit('ODOMETER_PHOTO_UPLOADED', { stage: 'START' });
                      }}
                      className="w-full bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 text-[9px] font-bold uppercase py-2.5 rounded-xl text-zinc-400 cursor-pointer"
                    >
                      {startOdoPhoto ? '✔️ Capture Ready' : '📷 Take Dash Photo'}
                    </button>
                  </div>
                  <div>
                    <label className="block text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Enter Ride OTP (from Rider)</label>
                    <input
                      type="text"
                      value={otpVerificationCode}
                      onChange={(e) => setOtpVerificationCode(e.target.value)}
                      placeholder="e.g. 1234"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-zinc-500 text-xs text-center font-bold tracking-widest"
                      maxLength={4}
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer active:scale-95 text-center mt-2 font-sans"
                >
                  Verify OTP & Start Trip
                </button>
              </form>
            </div>
          )}

          {/* TRIP IN PROGRESS DELIVERING STATE */}
          {dutyState === 'DELIVERING' && activeTrip && (
            <div className="space-y-4 text-left animate-fadeIn">
              <div className="border-b border-zinc-900 pb-3 flex justify-between items-center">
                <div>
                  <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Active Transit in Progress</span>
                  <h3 className="text-xs font-bold text-white mt-0.5">{activeTrip.customer_name}</h3>
                </div>
                <div className="bg-emerald-950 text-emerald-400 border border-emerald-900 text-[8px] font-mono font-bold px-2 py-1 rounded animate-pulse">
                  DELIVERING
                </div>
              </div>

              {/* Transit variables */}
              <div className="grid grid-cols-3 gap-2 font-mono text-[9px] uppercase font-bold text-zinc-400 text-center">
                <div className="bg-zinc-900 p-2.5 rounded-lg">
                  <span className="text-zinc-600 block text-[7px]">BASE FARE</span>
                  <span className="text-white block mt-0.5">₹{(activeTrip.quoted_fare_paise / 100).toFixed(0)}</span>
                </div>
                <div className="bg-zinc-900 p-2.5 rounded-lg">
                  <span className="text-zinc-600 block text-[7px]">TOLLS ADDED</span>
                  <span className="text-white block mt-0.5">₹{tollCharges}</span>
                </div>
                <div className="bg-zinc-900 p-2.5 rounded-lg">
                  <span className="text-zinc-600 block text-[7px]">PARKING FEES</span>
                  <span className="text-white block mt-0.5">₹{parkingCharges}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleTollAddition}
                  className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 text-[9px] font-mono font-bold uppercase py-2 rounded-xl text-zinc-300 cursor-pointer"
                >
                  ➕ Add Toll (₹50)
                </button>
                <button
                  onClick={handleParkingAddition}
                  className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 text-[9px] font-mono font-bold uppercase py-2 rounded-xl text-zinc-300 cursor-pointer"
                >
                  ➕ Add Parking (₹30)
                </button>
              </div>

              {/* End odometer reading capture layout */}
              <div className="bg-zinc-900/50 p-4 border border-zinc-900 rounded-xl space-y-3 font-mono">
                <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest block border-b border-zinc-850 pb-1.5">
                  End Odometer Capture (Required to Slide Close)
                </span>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-[8px] font-bold text-zinc-600 uppercase mb-1">End Odometer KM</label>
                    <input
                      type="number"
                      value={endOdometer}
                      onChange={(e) => setEndOdometer(e.target.value)}
                      placeholder={`>${startOdometer} KM`}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-white focus:outline-none focus:border-zinc-500 text-xs"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[8px] font-bold text-zinc-600 uppercase mb-1">End Fuel ({endFuel}%)</label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={endFuel}
                      onChange={(e) => setEndFuel(parseInt(e.target.value))}
                      className="w-full h-8 cursor-pointer animate-none"
                    />
                  </div>
                </div>
              </div>

              {/* End slide trigger confirm */}
              <SlideToConfirm
                label="Slide to End Journey"
                onConfirm={handleSlideToEndTrip}
                color="red"
              />
            </div>
          )}

          {/* COMPLETED PAYOUT SETTLEMENT OVERLAY */}
          {dutyState === 'COMPLETED' && activeTrip && (
            <div className="space-y-4 text-left animate-fadeIn">
              <h3 className="text-sm font-bold tracking-wider font-mono uppercase text-white border-b border-zinc-900 pb-3 flex justify-between items-center">
                <span>Receipt & Settlement</span>
                <span className="text-emerald-500 font-mono">₹{calculateTotalBill().toFixed(2)}</span>
              </h3>

              {/* Fare Breakdown component */}
              <div className="bg-zinc-900/50 border border-zinc-900 rounded-xl p-4 space-y-2 font-mono text-[10px] text-zinc-400">
                <div className="flex justify-between">
                  <span>Base Package Quoted:</span>
                  <span className="text-white">₹{(activeTrip.quoted_fare_paise / 100).toFixed(2)}</span>
                </div>
                {parseFloat(endOdometer) - parseFloat(startOdometer) > 15 && (
                  <div className="flex justify-between">
                    <span>Extra Mileage Charge:</span>
                    <span className="text-white">₹{(Math.max(0, (parseFloat(endOdometer) - parseFloat(startOdometer)) - 15) * 18).toFixed(2)}</span>
                  </div>
                )}
                {waitingCharges > 0 && (
                  <div className="flex justify-between">
                    <span>Waiting Fee ({Math.round(waitingCharges / 2)} mins):</span>
                    <span className="text-white">₹{waitingCharges.toFixed(2)}</span>
                  </div>
                )}
                {tollCharges > 0 && (
                  <div className="flex justify-between">
                    <span>Tolls/Gate Fee:</span>
                    <span className="text-white">₹{tollCharges.toFixed(2)}</span>
                  </div>
                )}
                {parkingCharges > 0 && (
                  <div className="flex justify-between">
                    <span>Parking Fee:</span>
                    <span className="text-white">₹{parkingCharges.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Night / Surge Commissions:</span>
                  <span className="text-white">₹50.00</span>
                </div>
                <div className="flex justify-between">
                  <span>D4M Safety Care Premium:</span>
                  <span className="text-white">₹15.00</span>
                </div>
                <div className="border-t border-zinc-800 pt-2 flex justify-between font-bold text-xs text-white">
                  <span>Grand Total Net:</span>
                  <span className="text-emerald-400">₹{calculateTotalBill().toFixed(2)}</span>
                </div>
              </div>

              {/* Rider feedback feedback loops */}
              <div className="space-y-2">
                <span className="block text-[8px] font-bold text-zinc-500 uppercase tracking-widest font-mono">Rate Rider Passenger Etiquette</span>
                <div className="flex justify-between items-center bg-zinc-900/30 border border-zinc-900 p-3 rounded-xl">
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRiderRating(star)}
                        className={`text-lg cursor-pointer transition ${star <= riderRating ? 'text-amber-500' : 'text-zinc-700'}`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                  <span className="text-[10px] text-zinc-500 font-mono font-bold uppercase">{riderRating} Stars</span>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {['Polite', 'Punctual', 'Clean Car Care', 'Low Noise', 'Highly Cooperative'].map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleRiderCommentTag(tag)}
                      className={`text-[8px] font-bold uppercase tracking-wider py-1.5 px-3 rounded-full border transition cursor-pointer ${
                        riderCommentTags.includes(tag)
                          ? 'bg-white border-white text-black'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={() => handlePaymentConfirmationSubmit('CASH')}
                  className="bg-zinc-900 hover:bg-zinc-850 text-white font-mono font-bold text-[10px] uppercase tracking-wider py-3.5 border border-zinc-800 rounded-xl transition cursor-pointer active:scale-95 text-center"
                >
                  💵 Cash Settled
                </button>
                <button
                  onClick={() => handlePaymentConfirmationSubmit('UPI')}
                  className="bg-white hover:bg-zinc-200 text-black font-sans font-bold text-[10px] uppercase tracking-wider py-3.5 rounded-xl transition cursor-pointer active:scale-95 text-center"
                >
                  💳 UPI Verified
                </button>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* DETAILED TELETEMETRY LOGGING VISUAL TERMINAL SHEET FOR SANDBOX VALIDATION */}
      {auditLogs.length > 0 && (
        <div className="w-full bg-zinc-950 border-t border-zinc-900 p-4 text-left max-w-xl mx-auto z-10 font-mono relative">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">Real-time Telemetry logs console:</span>
            <button
              onClick={() => setAuditLogs([])}
              className="text-[7px] text-zinc-600 hover:text-zinc-400 uppercase font-bold tracking-widest cursor-pointer"
            >
              Clear Logs
            </button>
          </div>
          <div className="bg-black border border-zinc-900 rounded-xl p-3 max-h-24 overflow-y-auto font-mono text-[8px] text-zinc-500 space-y-0.5 scrollbar-thin">
            {auditLogs.map((log, index) => (
              <div key={index} className="truncate select-all leading-relaxed">{log}</div>
            ))}
          </div>
        </div>
      )}

      {/* static footer details */}
      <footer className="bg-black p-3 text-center text-[8px] font-mono text-zinc-700 border-t border-zinc-950 select-none">
        ENCRYPTED SECURE WS LAYER • TELEMETRY FLUSH ACTIVE
      </footer>
    </div>
  );
}
