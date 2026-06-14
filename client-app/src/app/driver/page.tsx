'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { useDriverDutyStore } from '@/store/useDriverDutyStore';
import { useResilientWebSocket } from '@/hooks/useResilientWebSocket';
import { SlideToConfirm } from '../../components/SlideToConfirm';
import { DriverTripManager } from '../../components/DriverTripManager';
import { SentryErrorBoundary } from '../../components/SentryErrorBoundary';
import MapInterpolated, { MapDriver } from '../../components/MapInterpolated';
import { DriverDrawer } from '../../components/DriverDrawer';
import { SosModal } from '../../components/SosModal';
import { useSafetyStore } from '../../store/useSafetyStore';
import {
  completeTrip,
  getDriverProfile,
  getPendingOffer,
  OdometerCheckpointPayload,
  OrderOffer,
  submitOdometerCheckpoint,
  setDriverDutyState,
  getDriverDutyStats,
  driverArriveAtPickup,
  driverStartTrip,
  ApiClientError,
  addOrderEvent,
  driverEndTrip,
  driverConfirmPayment,
  FinalBill,
  getDriverOrder,
} from '@/api/client';
import { StartTripPayload } from '../../types/trip';
import { connectDispatchStream } from '@/services/dispatchStream';
import { connectHeatmapStream, HeatmapData } from '@/services/heatmapStream';
import { startTelemetryStream, TelemetryStreamHandle } from '@/services/telemetryStream';
import { OfferPopup } from '@/components/OfferPopup';
import { useOfferStore } from '@/store/useOfferStore';
import { cellToBoundary } from 'h3-js';

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
  backend_offer?: OrderOffer;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function h3CellToSvgPoints(cell: string): string {
  try {
    return cellToBoundary(cell)
      .map(([lat, lng]) => {
        const x = clampPercent(((lng - 88.25) / (88.5 - 88.25)) * 100);
        const y = clampPercent(((22.7 - lat) / (22.7 - 22.45)) * 100);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  } catch {
    return '';
  }
}

export default function DriverTerminalPage() {
  const router = useRouter();
  const { user, token } = useAuthStore();
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof getDriverProfile>> | null>(null);
  const [kycPending, setKycPending] = useState(true); // Assume pending until profile loads
  
  // Account settings matching session or sandbox defaults
  const driverID = user?.id || 'd-placeholder-id';
  const driverName = profile?.name || user?.name || 'Driver...';
  const cityPrefix = profile?.city_prefix || 'KOL'; // Regional Hub KOL

  const { dutyState, setDutyState, forceMatched } = useDriverDutyStore();
  const [activeTrip, setActiveTrip] = useState<ActiveOrderAssignment | null>(null);
  
  // Resilient WebSocket hook — single source of truth for the connection chip.
  const { status: connectionStatus, reconnect } = useResilientWebSocket(
    activeTrip?.order_id || 'global-driver',
    cityPrefix,
    dutyState !== 'OFFLINE'
  );

  // Mirror connectionStatus into a ref so the telemetry stream can probe live
  // connectivity without being torn down and re-created on every status change.
  const connectionStatusRef = useRef<typeof connectionStatus>(connectionStatus);
  useEffect(() => {
    connectionStatusRef.current = connectionStatus;
    // On reconnection, drain any GPS points buffered while we were offline.
    if (connectionStatus === 'CONNECTED') {
      telemetryStopRef.current?.flush();
    }
  }, [connectionStatus]);

  // Statistics polling state
  const [stats, setStats] = useState({
    trips_count: 0,
    earnings_rupees: 0,
    online_hours: 0,
    acceptance_rate: 100,
    rating: 5.0,
  });

  // SOS hold to confirm trigger states
  const sosHoldTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [sosHolding, setSosHolding] = useState(false);
  const [sosProgress, setSosProgress] = useState(0);
  
  // Map settings and overlay triggers
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [activeVehicle, setActiveVehicle] = useState('WB-02-AK-9988 (Premium SUV)');
  const [preferredTripFilter, setPreferredTripFilter] = useState<'ALL' | 'CITY' | 'OUTSTATION'>('ALL');
  
  // Navigation states
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(3);
  

  
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
  const [finalBill, setFinalBill] = useState<FinalBill | null>(null);

  // Wait timer reference time and Cancel picker overlay states
  const [arrivedTime, setArrivedTime] = useState<Date | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [selectedCancelReason, setSelectedCancelReason] = useState('');
  
  // Map visualization state: simulated marker position along route (0 to 100%)
  const [mapGlideProgress, setMapGlideProgress] = useState(0);
  const [mapIntervalActive, setMapIntervalActive] = useState(false);
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null);

  // Live Audit Telemetry Log Vault
  const [auditLogs, setAuditLogs] = useState<string[]>([]);
  const [mapDrivers, setMapDrivers] = useState<MapDriver[]>([]);

  // Core structural pointers
  const telemetryStopRef = useRef<TelemetryStreamHandle | null>(null);
  const streamRef = useRef<(() => void) | null>(null);
  const waitTimerRef = useRef<NodeJS.Timeout | null>(null);
  const sosTimerRef = useRef<NodeJS.Timeout | null>(null);

  const startSosHold = () => {
    if (useSafetyStore.getState().isEmergencyActive) return;
    setSosHolding(true);
    setSosProgress(0);

    const startTime = Date.now();
    const duration = 2000;

    sosHoldTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min((elapsed / duration) * 100, 100);
      setSosProgress(progress);

      if (progress >= 100) {
        clearInterval(sosHoldTimerRef.current!);
        sosHoldTimerRef.current = null;
        setSosHolding(false);
        setSosProgress(0);
        const lat = 22.5726;
        const lng = 88.3639;
        const orderId = activeTrip?.order_id || "";
        useSafetyStore.getState().triggerSOS(lat, lng, orderId);
      }
    }, 50);
  };

  const cancelSosHold = () => {
    if (sosHoldTimerRef.current) {
      clearInterval(sosHoldTimerRef.current);
      sosHoldTimerRef.current = null;
    }
    setSosHolding(false);
    setSosProgress(0);
  };

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
      telemetryStopRef.current?.stop();
      streamRef.current?.();
      if (waitTimerRef.current) clearInterval(waitTimerRef.current);
      if (sosTimerRef.current) clearInterval(sosTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!showHeatmap) {
      setHeatmapData(null);
      return;
    }

    return connectHeatmapStream((data) => {
      setHeatmapData(data);
    });
  }, [showHeatmap]);

  // Wait time calculator once arrived
  useEffect(() => {
    if (dutyState === 'ARRIVED') {
      let currentArrivedTime = arrivedTime;
      if (!currentArrivedTime) {
        currentArrivedTime = new Date();
        setArrivedTime(currentArrivedTime);
      }
      waitTimerRef.current = setInterval(() => {
        const now = new Date();
        const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - currentArrivedTime!.getTime()) / 1000));
        
        const remainingFree = Math.max(0, 300 - elapsedSeconds);
        setFreeWaitSeconds(remainingFree);
        
        if (elapsedSeconds > 300) {
          const excessSeconds = elapsedSeconds - 300;
          setWaitingCharges(excessSeconds * (2 / 60));
        } else {
          setWaitingCharges(0);
        }
      }, 1000);
    } else {
      if (waitTimerRef.current) clearInterval(waitTimerRef.current);
      setArrivedTime(null);
    }
    return () => {
      if (waitTimerRef.current) clearInterval(waitTimerRef.current);
    };
  }, [dutyState, arrivedTime]);

  // Poll stats every 30 seconds when not offline
  useEffect(() => {
    if (!token || dutyState === 'OFFLINE') return;

    const fetchStats = async () => {
      try {
        const data = await getDriverDutyStats(token);
        setStats(data);
      } catch (err) {
        console.warn('Failed to fetch stats:', err);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [token, dutyState]);

  // Simulated SVG Map Glide coordinate adjustments
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (dutyState === 'EN_ROUTE' || dutyState === 'DELIVERING') {
      setMapGlideProgress(0);
      interval = setInterval(() => {
        setMapGlideProgress((prev) => {
          const next = prev + 1;
          if (next >= 100) {
            return 0; // loop back to simulate telemetry loop
          }
          const currentLat = dutyState === 'EN_ROUTE'
            ? 22.5487 + (next / 100) * (22.5726 - 22.5487)
            : 22.5726 + (next / 100) * (22.5855 - 22.5726);
          const currentLng = dutyState === 'EN_ROUTE'
            ? 88.3561 + (next / 100) * (88.3639 - 88.3561)
            : 88.3639 + (next / 100) * (88.3411 - 88.3639);

          // Log a sample coordinate ping every 5 seconds equivalent (progress splits)
          if (next % 10 === 0) {
            logAudit('GPS_PING', { lat: currentLat.toFixed(6), lng: currentLng.toFixed(6), speed_kmh: 42 + Math.floor(Math.random() * 15) });
          }

          setMapDrivers([{
            id: driverID,
            latitude: currentLat,
            longitude: currentLng,
            bearing: dutyState === 'EN_ROUTE' ? 45 : 135,
            speed: 42
          }]);

          return next;
        });
      }, 300);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [dutyState]);

  // hydrateForceMatch pulls a directly-assigned (force-matched) order, builds the active
  // trip from it, and pushes the driver into EN_ROUTE with a banner. Coordinates and fare
  // come from the order endpoint; rider name/address text is not stored server-side.
  const hydrateForceMatch = async (orderId: string) => {
    if (!token) return;
    if (useDriverDutyStore.getState().dutyState === 'EN_ROUTE' && activeTrip?.order_id === orderId) {
      return; // already handling this assignment
    }
    try {
      const order = await getDriverOrder(token, orderId);
      setActiveTrip({
        order_id: order.id,
        customer_name: 'Assigned Rider',
        customer_phone: 'Unavailable',
        customer_rating: 5,
        pickup_address: `Pickup (${order.pickup_lat.toFixed(4)}, ${order.pickup_lng.toFixed(4)})`,
        pickup_lat: order.pickup_lat,
        pickup_lng: order.pickup_lng,
        dropoff_address: `Drop (${order.dropoff_lat.toFixed(4)}, ${order.dropoff_lng.toFixed(4)})`,
        dropoff_lat: order.dropoff_lat,
        dropoff_lng: order.dropoff_lng,
        quoted_fare_paise: order.base_fare_paise,
        vehicle_tier: activeVehicle,
        transmission: 'ANY',
        trip_type: 'CITY',
        special_notes: 'Assigned by dispatch (force-match)',
      });
      useDriverDutyStore.getState().setForceMatched(true);
      setDutyState('EN_ROUTE');
      logAudit('FORCE_MATCH_RECEIVED', { orderId });
    } catch (err) {
      console.warn('[FORCE_MATCH] Failed to hydrate force-matched order:', err);
    }
  };

  const openOnlineStreams = () => {
    if (!token) return;

    if (!telemetryStopRef.current) {
      telemetryStopRef.current = startTelemetryStream({
        token,
        driverId: driverID,
        cityPrefix,
        // While not CONNECTED, GPS points buffer locally and flush on reconnect.
        isConnected: () => connectionStatusRef.current === 'CONNECTED',
      });
      logAudit('TELEMETRY_STREAM_STARTED', { driverID, cityPrefix });
    }

    if (!streamRef.current) {
      streamRef.current = connectDispatchStream(
        `stream-session-${driverID}`,
        token,
        {
          onAssignment: (frame) => {
            void getPendingOffer(token)
              .then((pendingOffer) => {
                if (pendingOffer.order) {
                  // Normal flow: a pending 15s offer exists. Only surface it while ONLINE.
                  if (useDriverDutyStore.getState().dutyState === 'ONLINE') {
                    useOfferStore.getState().setOffer(pendingOffer.order, pendingOffer.offer_expires_in_seconds);
                    useDriverDutyStore.getState().setDutyState('OFFER_PENDING');
                    logAudit('INCOMING_OFFER_RECEIVED', { orderId: pendingOffer.order.orderId, source: 'WEBSOCKET' });
                  }
                  return;
                }
                // No pending offer but an ASSIGNED frame arrived: this is an admin
                // force-match (a direct assignment, not a 15s offer). Hydrate it and push
                // the driver into the trip with a banner — never silently drop it.
                if (frame.status === 'ASSIGNED' && frame.order_id) {
                  void hydrateForceMatch(frame.order_id);
                }
              })
              .catch((err) => console.warn('[DRIVER_OFFER] Assignment hydration failed:', err));
          },
          onTelemetry: (frame) => {
            logAudit('WS_TELEMETRY_FRAME', {
              orderId: frame.order_id,
              lat: frame.latitude,
              lng: frame.longitude,
              speed_kms: frame.speed_kms,
            });
            setMapDrivers([{
              id: frame.driver_id || driverID,
              latitude: frame.latitude,
              longitude: frame.longitude,
              bearing: frame.bearing || 0,
              speed: frame.speed_kms || 0
            }]);
          },
          onClose: () => {
            logAudit('WS_CONNECTION_STATE', { status: 'DISCONNECTED' });
            streamRef.current = null;
          },
        },
        cityPrefix,
      );
      logAudit('WS_CONNECTION_STATE', { status: 'CONNECTED' });
    }

    void getPendingOffer(token)
      .then((pendingOffer) => {
        if (pendingOffer.order && (pendingOffer.offer_expires_in_seconds ?? 0) > 0) {
          const currentDutyState = useDriverDutyStore.getState().dutyState;
          if (currentDutyState !== 'ONLINE') {
            console.warn('[DRIVER_OFFER] Ignoring fallback offer since duty state is:', currentDutyState);
            return;
          }
          useOfferStore.getState().setOffer(pendingOffer.order);
          useDriverDutyStore.getState().setDutyState('OFFER_PENDING');
          logAudit('INCOMING_OFFER_RECEIVED', { orderId: pendingOffer.order.orderId, source: 'HTTP_FALLBACK' });
        }
      })
      .catch((err) => {
        console.warn('[DRIVER_OFFER] Pending offer fallback fetch failed:', err);
      });
  };

  const closeOnlineStreams = () => {
    telemetryStopRef.current?.stop();
    streamRef.current?.();
    telemetryStopRef.current = null;
    streamRef.current = null;
  };

  useEffect(() => {
    if (!token) {
      router.push('/login?role=driver');
      return;
    };

    let cancelled = false;
    getDriverProfile(token)
      .then((fetchedProfile) => {
        if (cancelled) return;
        
        setProfile(fetchedProfile);

        // Redirect based on KYC / Verification status
        const status = fetchedProfile.verification_status || 'ONBOARDING';
        if (status === 'ONBOARDING' || status === 'REJECTED') {
          router.push('/driver-onboarding');
          return;
        }
        
        setKycPending(status === 'PENDING');

        // Set initial duty state from profile
        if (fetchedProfile.current_state === 'ONLINE_AVAILABLE') {
          setDutyState('ONLINE');
          openOnlineStreams();
        } else if (fetchedProfile.current_state === 'ONLINE_EN_ROUTE') {
          setDutyState('EN_ROUTE');
        } else if (fetchedProfile.current_state === 'ONLINE_DELIVERING') {
          setDutyState('DELIVERING');
        } else {
          setDutyState('OFFLINE');
        }

        // Set initial stats from profile
        setStats(prev => ({
          ...prev,
          trips_count: fetchedProfile.total_trips || 0,
          acceptance_rate: fetchedProfile.acceptance_rate * 100,
          cancellation_rate: fetchedProfile.cancellation_rate * 100,
        }));
      })
      .catch((err) => {
        console.warn('[DRIVER_PROFILE] Initial hydration failed:', err);
        // If profile fails, logout to force re-authentication
        useAuthStore.getState().logout();
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  // Go Online/Offline state changes
  const handleToggleDutySwitch = async () => {
    if (dutyState === 'OFFLINE') {
      if (token) {
        try {
          // Send KOL center lat/lng coordinates (22.5726, 88.3639) for dispatcher GeoHash
          await setDriverDutyState(token, 'ONLINE', 22.5726, 88.3639);
        } catch (err) {
          console.warn('[DRIVER_STATUS] Online duty state sync failed:', err);
        }
      }

      setDutyState('ONLINE');
      logAudit('DUTY_ONLINE', { vehicle: activeVehicle, filter: preferredTripFilter });
      openOnlineStreams();

    } else {
      if (token) {
        try {
          await setDriverDutyState(token, 'OFFLINE');
        } catch (err) {
          console.warn('[DRIVER_STATUS] Offline duty state sync failed:', err);
        }
      }

      // Clean teardown and hardware release routine
      closeOnlineStreams();
      
      setDutyState('OFFLINE');
      setActiveTrip(null);
      logAudit('DUTY_OFFLINE', { driverID });
    }
  };

  const { currentOffer, status: offerStatus } = useOfferStore();

  useEffect(() => {
    if (offerStatus === 'ACCEPTED' && currentOffer) {
      setActiveTrip({
        order_id: currentOffer.orderId,
        customer_name: currentOffer.riderName,
        customer_phone: 'Unavailable',
        customer_rating: currentOffer.riderRating,
        pickup_address: currentOffer.pickup.address,
        pickup_lat: currentOffer.pickup.lat,
        pickup_lng: currentOffer.pickup.lng,
        dropoff_address: currentOffer.drop.address,
        dropoff_lat: currentOffer.drop.lat,
        dropoff_lng: currentOffer.drop.lng,
        quoted_fare_paise: currentOffer.fareEstimate,
        vehicle_tier: currentOffer.carTypeRequested || 'PREMIUM_SUV',
        transmission: currentOffer.transmissionRequired || 'AUTOMATIC',
        trip_type: currentOffer.tripType,
        special_notes: currentOffer.notes,
        backend_offer: currentOffer,
      });
      // Clear offer from store now that it is active
      useOfferStore.getState().clearOffer();
    }
  }, [offerStatus, currentOffer]);

  const handleArrivedAtPickup = async () => {
    logAudit('ARRIVED_AT_PICKUP_NODE', { orderId: activeTrip?.order_id, time: new Date().toISOString() });
    setDutyState('ARRIVED');
    setArrivedTime(new Date());
    setFreeWaitSeconds(300);
    setWaitingCharges(0);

    if (activeTrip?.order_id) {
      try {
        if (token) {
          await driverArriveAtPickup(token, activeTrip.order_id);
        }
      } catch (err) {
        console.warn('Arrive sync failed:', err);
      }
    }
  };

  // Exponential backoff retry helper for odometer checkpoint submission
  const submitCheckpointWithRetry = async (
    orderId: string,
    payload: OdometerCheckpointPayload,
    maxAttempts = 3,
  ): Promise<boolean> => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (token) {
          await submitOdometerCheckpoint(token, orderId, payload);
          logAudit('ODOMETER_CHECKPOINT_SYNCED', { orderId, type: payload.checkpoint_type, attempt });
          return true;
        }
      } catch (err) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 8000);
        logAudit('ODOMETER_CHECKPOINT_RETRY', { orderId, type: payload.checkpoint_type, attempt, backoffMs });
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
    return false;
  };

  // Queue failed checkpoint for offline sync when connectivity resumes
  const queueOfflineCheckpoint = (orderId: string, payload: OdometerCheckpointPayload) => {
    try {
      const queue = JSON.parse(sessionStorage.getItem('offline_odometer_queue') || '[]');
      queue.push({ orderId, payload, queuedAt: new Date().toISOString() });
      sessionStorage.setItem('offline_odometer_queue', JSON.stringify(queue));
      logAudit('ODOMETER_CHECKPOINT_QUEUED_OFFLINE', { orderId, type: payload.checkpoint_type });
    } catch (e) {
      console.warn('[OFFLINE_QUEUE] Storage write failed:', e);
    }
  };

  const handleVerifyOtpAndStart = async (e: React.FormEvent) => {
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

    if (activeTrip?.order_id && token) {
      try {
        const res = await driverStartTrip(token, activeTrip.order_id, {
          odometerReading: parseInt(startOdometer, 10),
          fuelPercentage: startFuel,
          otp: otpVerificationCode,
          photoUrl: startOdoPhoto || '',
        });

        if (res.success) {
          setOtpError('');
          logAudit('TRIP_STARTED', { orderId: activeTrip.order_id });
          setDutyState('DELIVERING');
        }
      } catch (err: any) {
        if (err instanceof ApiClientError) {
          try {
            const errorJson = JSON.parse(err.body);
            setOtpError(errorJson.message || errorJson.error || 'OTP verification failed.');
          } catch {
            if (err.status === 403 || err.body.includes('too_many_otp_attempts')) {
              setOtpError('OTP locked: Too many failed attempts. Trip is locked.');
            } else {
              setOtpError(err.body || 'OTP verification failed.');
            }
          }
        } else {
          setOtpError(err.message || 'OTP verification failed.');
        }
      }
    } else {
      // No client-side OTP bypass: the trip can only start on a server-verified OTP.
      // Without an authenticated session, force re-auth rather than advancing state.
      setOtpError('Session expired. Please re-authenticate before starting the trip.');
    }
  };

  const handleTollAddition = async () => {
    if (activeTrip?.order_id && token) {
      try {
        await addOrderEvent(token, activeTrip.order_id, {
          event_type: 'ADD_TOLL',
          amount_paise: 5000,
          description: 'Highway toll fee added mid-trip',
        });
        setTollCharges((prev) => prev + 50);
        logAudit('BILLING_MODIFIER_ADDED', { type: 'TOLL', amount: 50 });
      } catch (err) {
        alert('Failed to record toll event on server. Please try again.');
      }
    } else {
      setTollCharges((prev) => prev + 50);
    }
  };

  const handleParkingAddition = async () => {
    if (activeTrip?.order_id && token) {
      try {
        await addOrderEvent(token, activeTrip.order_id, {
          event_type: 'ADD_STOP',
          amount_paise: 3000,
          description: 'Stop/parking fee added mid-trip',
        });
        setParkingCharges((prev) => prev + 30);
        logAudit('BILLING_MODIFIER_ADDED', { type: 'PARKING', amount: 30 });
      } catch (err) {
        alert('Failed to record parking event on server. Please try again.');
      }
    } else {
      setParkingCharges((prev) => prev + 30);
    }
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

    let finalBillData: any = null;
    if (activeTrip?.order_id && token) {
      try {
        const bill = await driverEndTrip(token, activeTrip.order_id, {
          odometer_reading: parseInt(endOdometer, 10),
          fuel_level: endFuel,
          photo_url: endOdoPhoto || '',
        });
        setFinalBill(bill);
        finalBillData = bill;
        logAudit('TRIP_END_SYNCED', { orderId: activeTrip.order_id, total: bill.total_fare_paise });
      } catch (err) {
        console.warn('End trip sync failed, using local fallback calculations:', err);
        const fallbackBill = {
          order_id: activeTrip.order_id,
          base_fare_paise: activeTrip.quoted_fare_paise,
          distance_km: endNum - startNum,
          distance_charge_paise: Math.max(0, (endNum - startNum) - 15) * 1800,
          wait_minutes: Math.round(waitingCharges / 2),
          wait_charge_paise: Math.round(waitingCharges) * 100,
          overtime_minutes: 10,
          overtime_charge_paise: 500,
          tolls_paise: tollCharges * 100,
          parking_charges_paise: parkingCharges * 100,
          night_surge_paise: 5000,
          care_surcharge_paise: 1500,
          total_fare_paise: calculateTotalBill() * 100,
          // Local offline estimate at the base take rate; the backend returns the
          // authoritative tiered payout on the real /end response.
          driver_payout_paise: Math.max(
            0,
            Math.round((calculateTotalBill() * 100 - tollCharges * 100 - parkingCharges * 100) * 0.8) +
              tollCharges * 100 +
              parkingCharges * 100,
          ),
        };
        setFinalBill(fallbackBill);
        finalBillData = fallbackBill;
      }
    } else if (activeTrip) {
      const mockBill = {
        order_id: activeTrip.order_id,
        base_fare_paise: activeTrip.quoted_fare_paise,
        distance_km: endNum - startNum,
        distance_charge_paise: Math.max(0, (endNum - startNum) - 15) * 1800,
        wait_minutes: Math.round(waitingCharges / 2),
        wait_charge_paise: Math.round(waitingCharges) * 100,
        overtime_minutes: 10,
        overtime_charge_paise: 500,
        tolls_paise: tollCharges * 100,
        parking_charges_paise: parkingCharges * 100,
        night_surge_paise: 5000,
        care_surcharge_paise: 1500,
        total_fare_paise: calculateTotalBill() * 100,
        // Local offline estimate at the base take rate; the backend returns the
        // authoritative tiered payout on the real /end response.
        driver_payout_paise: Math.max(
          0,
          Math.round((calculateTotalBill() * 100 - tollCharges * 100 - parkingCharges * 100) * 0.8) +
            tollCharges * 100 +
            parkingCharges * 100,
        ),
      };
      setFinalBill(mockBill);
      finalBillData = mockBill;
    }

    if (finalBillData && activeTrip) {
      try {
        sessionStorage.setItem(`final_bill_${activeTrip.order_id}`, JSON.stringify(finalBillData));
        sessionStorage.setItem('current_final_bill', JSON.stringify(finalBillData));
      } catch (e) {}
      setDutyState('COMPLETED');
      router.push(`/driver/trip/bill?order_id=${activeTrip.order_id}`);
    } else {
      setDutyState('COMPLETED');
    }
  };

  const handlePaymentConfirmationSubmit = async (method: string) => {
    logAudit('PAYMENT_CONFIRMED', {
      orderId: activeTrip?.order_id,
      method,
      riderRatingGiven: riderRating,
      tags: riderCommentTags
    });

    if (activeTrip?.order_id && token) {
      try {
        await driverConfirmPayment(token, activeTrip.order_id, {
          payment_method: method as 'UPI' | 'CASH',
          rider_rating: riderRating,
          tags: riderCommentTags,
        });
      } catch (err) {
        console.warn('Payment confirmation sync failed:', err);
      }
    }

    alert(`Payment of ₹${(finalBill ? finalBill.total_fare_paise / 100 : calculateTotalBill()).toFixed(2)} settled via ${method}. Feedback synced.`);
    
    // Clear trip states
    setActiveTrip(null);
    setStartOdometer('');
    setEndOdometer('');
    setTollCharges(0);
    setParkingCharges(0);
    setRiderCommentTags([]);
    setFinalBill(null);
    setDutyState('ONLINE');
  };

  // Payout breakdown values
  const calculateTotalBill = () => {
    if (finalBill) return finalBill.total_fare_paise / 100;
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
  if (kycPending) {
    return (
      <div className="min-h-screen bg-background-primary text-content-primary p-6 sm:p-12 font-body flex flex-col justify-between">
        <header className="border-b border-border-opaque pb-6 text-left">
          <h1 className="text-heading-large font-mono tracking-tight uppercase">DRIVERS-FOR-U</h1>
        </header>

        <main className="flex-grow flex flex-col items-center justify-center max-w-md mx-auto text-center space-y-6">
          <div className="h-16 w-16 rounded-pill bg-background-secondary border border-border-opaque flex items-center justify-center text-2xl animate-pulse">
            ⏳
          </div>
          <div className="space-y-3">
            <span className="badge badge-neutral">
              KYC Compliance Review
            </span>
            <h2 className="text-heading-xl text-content-primary">Application Pending Verification</h2>
            <p className="text-paragraph-medium text-content-secondary max-w-sm">
              Your onboarding documents (Aadhaar, DL, Police Verification) are being validated by our regional compliance team. This normally takes 12–24 hours.
            </p>
          </div>

          <div className="w-full space-y-3 pt-2">
            <button
              onClick={() => {
                if (token) {
                  getDriverProfile(token)
                    .then((profile) => {
                      if (profile.verification_status === 'VERIFIED') {
                        setKycPending(false);
                        window.location.reload();
                      } else {
                        alert('Your application is still under review. Please wait or contact support.');
                      }
                    })
                    .catch(() => alert('Failed to check status. Try again later.'));
                }
              }}
              className="w-full h-14 rounded-sm bg-interactive-primary text-interactive-primary-text
                text-label-large font-medium cursor-pointer transition-base
                hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              🔄 Refresh Status
            </button>
            <button
              onClick={() => {
                useAuthStore.getState().logout();
                router.push('/login?role=driver');
              }}
              className="w-full h-12 rounded-sm bg-background-secondary border border-border-opaque
                text-label-medium text-content-secondary cursor-pointer transition-base
                hover:bg-background-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            >
              Sign Out
            </button>
          </div>
        </main>

        <footer className="text-center text-label-small text-content-tertiary font-mono pt-6 border-t border-border-opaque">
          KYC_COMPLIANCE_PENDING_GATEWAY
        </footer>
      </div>
    );
  }

  const triggerSOS = () => {
    const lat = 22.5726;
    const lng = 88.3639;
    const orderId = activeTrip?.order_id || "";
    useSafetyStore.getState().triggerSOS(lat, lng, orderId);
    logAudit('SOS_CRITICAL_TRIGGERED', { driverID, time: new Date().toISOString() });
  };

  return (
    <div className="min-h-screen bg-black text-white p-0 font-sans flex flex-col justify-between selection:bg-white selection:text-black overflow-x-hidden relative">
      
      {/* 1. HAMBURGER SLIDE DRAWER MENU OVERLAY */}
      <DriverDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        driverProfile={{
          name: driverName || "Driver Partner",
          photo: "",
          rating: 4.92,
        }}
      />

      {/* 2. SOS EMERGENCY PULSE TRIGGER MODAL */}
      <SosModal />

      {/* FORCE-MATCH BANNER */}
      {forceMatched && dutyState !== 'ONLINE' && dutyState !== 'OFFLINE' && (
        <div className="fixed top-0 inset-x-0 z-[100001] bg-surface-warning px-4 py-2.5 flex items-center justify-center gap-2 font-mono text-label-small text-content-warning shadow-elevation-1">
          <span className="animate-pulse">●</span>
          Assigned by dispatch — proceed to pickup. This trip was force-matched to you.
        </div>
      )}

      {/* CONNECTIVITY DEGRADED BANNER */}
      {connectionStatus === 'RECONNECTING' && dutyState !== 'OFFLINE' && (
        <div className="fixed top-0 inset-x-0 z-[100000] bg-background-secondary border-b border-border-opaque px-4 py-2 flex items-center justify-center gap-2 font-mono text-label-small text-content-secondary shadow">
          <span className="h-2 w-2 rounded-full border border-content-warning border-t-transparent animate-spin" />
          Reconnecting to dispatch — you won&apos;t receive new offers until the link is restored.
        </div>
      )}

      {/* 3. INCOMING BOOKING OFFER MODAL SHEET OVERLAY */}
      <OfferPopup />

      {/* CANCEL ALLOCATION PICKER OVERLAY */}
      {showCancelModal && activeTrip && (
        <div className="fixed inset-0 z-[100000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-background-primary border border-border-opaque p-6 rounded-lg w-full max-w-sm space-y-4 text-left shadow-elevation-3">
            <div>
              <h3 className="text-heading-small text-content-primary">Cancel Allocation</h3>
              <p className="text-paragraph-small text-content-secondary mt-1">Select a reason. Penalty charges may apply.</p>
            </div>

            <div className="space-y-2">
              {[
                { label: 'Rider No Show', value: 'RIDER_NO_SHOW' },
                { label: 'Wrong Address', value: 'WRONG_ADDRESS' },
                { label: 'Vehicle Breakdown', value: 'VEHICLE_BREAKDOWN' },
                { label: 'Safety Concerns', value: 'SAFETY' },
                { label: 'Other', value: 'OTHER' },
              ].map((reason) => (
                <button
                  key={reason.value}
                  type="button"
                  onClick={() => setSelectedCancelReason(reason.value)}
                  className={[
                    'w-full text-left h-11 px-4 rounded-sm border text-label-medium transition-base cursor-pointer',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400',
                    selectedCancelReason === reason.value
                      ? 'bg-surface-negative border-negative-300 text-content-negative'
                      : 'bg-background-secondary border-border-opaque text-content-secondary hover:text-content-primary',
                  ].join(' ')}
                >
                  {reason.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setShowCancelModal(false); setSelectedCancelReason(''); }}
                className="h-11 rounded-sm bg-background-secondary border border-border-opaque
                  text-label-medium text-content-secondary cursor-pointer hover:bg-background-tertiary
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!selectedCancelReason) { alert('Please select a reason.'); return; }
                  logAudit('TRIP_CANCELLED_BY_DRIVER', { orderId: activeTrip.order_id, reason: selectedCancelReason });
                  setActiveTrip(null);
                  setDutyState('ONLINE');
                  setShowCancelModal(false);
                  setSelectedCancelReason('');
                }}
                className="h-11 rounded-sm bg-negative-400 text-white text-label-medium font-medium
                  cursor-pointer hover:bg-negative-500 transition-base
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative-400"
              >
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOP HEADER */}
      <header className="bg-background-primary border-b border-border-opaque px-4 py-3 sticky top-0 z-50 flex justify-between items-center w-full">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsDrawerOpen(true)}
            className="h-11 w-11 bg-background-secondary hover:bg-background-tertiary rounded-sm border border-border-opaque
              flex items-center justify-center text-content-primary cursor-pointer transition-base active:scale-95
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            aria-label="Open Navigation Drawer"
          >
            ☰
          </button>
          <div>
            <h1 className="text-label-large font-mono tracking-tight uppercase text-content-primary">DRIVERS-FOR-U</h1>
            <div className="flex items-center gap-1.5 mt-0.5 font-mono text-label-small text-content-tertiary">
              <span>HUB: {cityPrefix}</span>
              <span>·</span>
              <span>{dutyState}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {dutyState !== 'OFFLINE' && (
            <span role="status" aria-live="polite">{
            connectionStatus === 'OFFLINE' ? (
              <button
                type="button"
                onClick={reconnect}
                className="badge badge-negative cursor-pointer hover:opacity-80 min-h-[36px] px-3
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative-400"
              >
                <span className="status-dot status-dot-negative" />
                <span className="ml-1">Offline · Retry</span>
              </button>
            ) : connectionStatus === 'CONNECTED' ? (
              <span className="badge badge-positive">
                <span className="status-dot status-dot-online" />
                <span className="ml-1">Connected</span>
              </span>
            ) : (
              <span className="badge badge-warning">
                <span className="status-dot status-dot-pending" />
                <span className="ml-1">Reconnecting</span>
              </span>
            )
          }</span>)}

          {/* SOS — 2-second hold */}
          <button
            onMouseDown={startSosHold}
            onMouseUp={cancelSosHold}
            onMouseLeave={cancelSosHold}
            onTouchStart={startSosHold}
            onTouchEnd={cancelSosHold}
            className="relative overflow-hidden bg-negative-400 hover:bg-negative-500
              text-white text-label-small font-medium
              h-9 px-3 rounded-pill
              cursor-pointer select-none transition-base
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative-400"
            style={{ minWidth: '80px' }}
          >
            {sosHolding && (
              <span className="absolute inset-0 bg-negative-600 transition-none" style={{ width: `${sosProgress}%` }} />
            )}
            <span className="relative z-10">🚨 SOS {sosHolding ? `${Math.round(sosProgress)}%` : '(Hold)'}</span>
          </button>
        </div>
      </header>

      {/* CORE AREA: MAP LAYOUT AND VIEWS */}
      <main className="flex-1 flex flex-col relative min-h-[350px]">
        <div
          className="absolute inset-0 bg-background-primary z-0 overflow-hidden flex items-center justify-center"
          style={{ filter: dutyState === 'OFFLINE' ? 'grayscale(1) opacity(0.6)' : 'none' }}
        >
          {dutyState === 'OFFLINE' ? (
            <svg className="w-full h-full opacity-20" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" className="text-border-opaque" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
          ) : (
            <div className="w-full h-full">
              <MapInterpolated
                drivers={mapDrivers}
                pickup={activeTrip ? { lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lng } : null}
                destination={activeTrip ? { lat: activeTrip.dropoff_lat, lng: activeTrip.dropoff_lng } : null}
                center={activeTrip ? { lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lng } : { lat: 22.5726, lng: 88.3639 }}
                theme="dark"
              />
            </div>
          )}

          {/* Turn-by-Turn Navigation panel */}
          {activeTrip && (dutyState === 'EN_ROUTE' || dutyState === 'DELIVERING') && (
            <div className="absolute top-4 left-4 z-20 bg-background-primary/90 border border-border-opaque p-3 rounded-md font-mono text-label-small space-y-1 max-w-xs shadow-elevation-2 text-left animate-enter">
              <span className="text-label-small text-content-tertiary uppercase tracking-wider block">Navigation</span>
              <div className="text-content-primary font-medium flex items-center gap-1.5">
                <span>🛞</span>
                <span>{dutyState === 'EN_ROUTE' ? 'Drive to Pickup' : 'Drive to Dropoff'}</span>
              </div>
              <div className="text-content-secondary">
                {dutyState === 'EN_ROUTE'
                  ? `Turn Left — Howrah Bridge Rd in ${(150 - mapGlideProgress * 1.5).toFixed(0)}m`
                  : `Turn Right — E.M. Bypass in ${(200 - mapGlideProgress * 2).toFixed(0)}m`}
              </div>
            </div>
          )}

          {/* Offline overlay */}
          {dutyState === 'OFFLINE' && (
            <div className="absolute inset-0 bg-black/60 z-10 flex items-center justify-center p-6">
              <div className="text-center space-y-3">
                <span className="text-4xl block">📡</span>
                <h3 className="text-heading-small text-content-secondary">Terminal Offline</h3>
                <p className="text-paragraph-small text-content-tertiary max-w-xs">
                  Go Online to connect to dispatch and start receiving trip offers.
                </p>
              </div>
            </div>
          )}

          {/* Heatmap toggle */}
          {dutyState !== 'OFFLINE' && (
            <div className="absolute top-4 right-4 z-10 space-y-2">
              <button
                type="button"
                onClick={() => setShowHeatmap(!showHeatmap)}
                className="bg-background-primary/90 border border-border-opaque text-label-small text-content-secondary
                  py-1.5 px-3 rounded-pill hover:bg-background-secondary transition-base flex items-center gap-1.5
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
              >
                🔥 {showHeatmap ? 'Heatmap ON' : 'Heatmap OFF'}
              </button>
              {heatmapData && (
                <div className="bg-background-primary/90 border border-border-opaque text-label-small text-content-tertiary py-1.5 px-3 rounded-pill">
                  {heatmapData.region} · {Object.keys(heatmapData.cell_data).length} cells
                </div>
              )}
            </div>
          )}
        </div>

        {/* BOTTOM CONTROL SHEET */}
        <div className="mt-auto w-full z-10 bg-background-primary/95 border-t border-border-opaque p-4 sm:p-6 space-y-4 max-w-xl mx-auto rounded-t-lg shadow-elevation-3 backdrop-blur-sm">
          <SentryErrorBoundary name="driver-trip-manager">
          <DriverTripManager
            activeTrip={activeTrip}
            stats={stats}
            activeVehicle={activeVehicle}
            setActiveVehicle={setActiveVehicle}
            preferredTripFilter={preferredTripFilter}
            setPreferredTripFilter={setPreferredTripFilter}
            handleToggleDutySwitch={handleToggleDutySwitch}
            logAudit={logAudit}
            triggerSOS={triggerSOS}
            mapGlideProgress={mapGlideProgress}
            setShowCancelModal={setShowCancelModal}
            handleArrivedAtPickup={handleArrivedAtPickup}
            freeWaitSeconds={freeWaitSeconds}
            setFreeWaitSeconds={setFreeWaitSeconds}
            waitingCharges={waitingCharges}
            setWaitingCharges={setWaitingCharges}
            otpError={otpError}
            setOtpError={setOtpError}
            startOdometer={startOdometer}
            setStartOdometer={setStartOdometer}
            startFuel={startFuel}
            setStartFuel={setStartFuel}
            startOdoPhoto={startOdoPhoto}
            setStartOdoPhoto={setStartOdoPhoto}
            otpVerificationCode={otpVerificationCode}
            setOtpVerificationCode={setOtpVerificationCode}
            setDutyState={setDutyState}
            setActiveTrip={setActiveTrip}
            tollCharges={tollCharges}
            parkingCharges={parkingCharges}
            handleTollAddition={handleTollAddition}
            handleParkingAddition={handleParkingAddition}
            endOdometer={endOdometer}
            setEndOdometer={setEndOdometer}
            endFuel={endFuel}
            setEndFuel={setEndFuel}
            endOdoPhoto={endOdoPhoto}
            setEndOdoPhoto={setEndOdoPhoto}
            handleSlideToEndTrip={handleSlideToEndTrip}
            riderRating={riderRating}
            setRiderRating={setRiderRating}
            riderCommentTags={riderCommentTags}
            toggleRiderCommentTag={toggleRiderCommentTag}
            handlePaymentConfirmationSubmit={handlePaymentConfirmationSubmit}
            calculateTotalBill={calculateTotalBill}
            finalBill={finalBill}
          />
          </SentryErrorBoundary>
        </div>
      </main>

      {/* TELEMETRY LOG CONSOLE */}
      {auditLogs.length > 0 && (
        <div className="w-full bg-background-secondary border-t border-border-opaque p-4 text-left max-w-xl mx-auto z-10">
          <div className="flex justify-between items-center mb-2">
            <span className="text-label-small text-content-tertiary font-mono uppercase tracking-wider">Telemetry logs</span>
            <button
              onClick={() => setAuditLogs([])}
              className="text-label-small text-content-tertiary hover:text-content-secondary cursor-pointer
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            >
              Clear
            </button>
          </div>
          <div className="bg-background-primary border border-border-opaque rounded-sm p-3 max-h-24 overflow-y-auto font-mono text-label-small text-content-tertiary space-y-0.5">
            {auditLogs.map((log, index) => (
              <div key={index} className="truncate select-all leading-relaxed">{log}</div>
            ))}
          </div>
        </div>
      )}

      <footer className="bg-background-primary border-t border-border-opaque p-3 text-center text-label-small font-mono text-content-tertiary select-none">
        D4U · ENCRYPTED WS · TELEMETRY ACTIVE
      </footer>
    </div>
  );
}
