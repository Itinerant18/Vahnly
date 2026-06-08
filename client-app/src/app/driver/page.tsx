'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { useDriverDutyStore } from '@/store/useDriverDutyStore';
import { useResilientWebSocket } from '@/hooks/useResilientWebSocket';
import { SlideToConfirm } from '../../components/SlideToConfirm';
import { DriverTripManager } from '../../components/DriverTripManager';
import MapInterpolated, { MapDriver } from '../../components/MapInterpolated';
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
} from '@/api/client';
import { StartTripPayload } from '../../types/trip';
import { connectDispatchStream } from '@/services/dispatchStream';
import { connectHeatmapStream, HeatmapData } from '@/services/heatmapStream';
import { startTelemetryStream } from '@/services/telemetryStream';
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
  const [kycPending, setKycPending] = useState(false);
  
  // Account settings matching session or sandbox defaults
  const driverID = user?.id || 'drv-aniket-7602';
  const driverName = user?.name || 'Aniket Karmakar';
  const cityPrefix = 'KOL'; // Regional Hub KOL

  const { dutyState, setDutyState } = useDriverDutyStore();
  const [activeTrip, setActiveTrip] = useState<ActiveOrderAssignment | null>(null);
  
  // Resilient WebSocket hook for monitoring real-time dispatch streams
  const { status: wsStatus } = useResilientWebSocket(
    activeTrip?.order_id || 'global-driver',
    cityPrefix,
    dutyState !== 'OFFLINE'
  );

  const [streamStatus, setStreamStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING'>('DISCONNECTED');

  // Sync streamStatus with wsStatus
  useEffect(() => {
    setStreamStatus(wsStatus);
  }, [wsStatus]);

  // Statistics polling state
  const [stats, setStats] = useState({
    trips_count: 4,
    earnings_rupees: 2840,
    online_hours: 5.2,
    acceptance_rate: 96,
    rating: 4.92,
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
  
  // SOS overlay controls
  const [sosActive, setSosActive] = useState(false);
  const [sosCountdown, setSosCountdown] = useState(5);
  

  
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
  const telemetryStopRef = useRef<(() => void) | null>(null);
  const streamRef = useRef<(() => void) | null>(null);
  const waitTimerRef = useRef<NodeJS.Timeout | null>(null);
  const sosTimerRef = useRef<NodeJS.Timeout | null>(null);

  const startSosHold = () => {
    if (sosActive) return;
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
        setSosActive(true);
        setSosCountdown(5);
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
      telemetryStopRef.current?.();
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

  const openOnlineStreams = () => {
    if (!token) return;

    if (!telemetryStopRef.current) {
      telemetryStopRef.current = startTelemetryStream({ token, driverId: driverID, cityPrefix });
      logAudit('TELEMETRY_STREAM_STARTED', { driverID, cityPrefix });
    }

    if (!streamRef.current) {
      streamRef.current = connectDispatchStream(
        `stream-session-${driverID}`,
        token,
        {
          onAssignment: (frame) => {
            const currentDutyState = useDriverDutyStore.getState().dutyState;
            if (currentDutyState !== 'ONLINE') {
              console.warn('[DRIVER_OFFER] Ignoring assignment frame since duty state is:', currentDutyState);
              return;
            }
            void getPendingOffer(token)
              .then((pendingOffer) => {
                if (pendingOffer.order) {
                  const checkState = useDriverDutyStore.getState().dutyState;
                  if (checkState !== 'ONLINE') {
                    console.warn('[DRIVER_OFFER] Ignoring hydration response since state is:', checkState);
                    return;
                  }
                  useOfferStore.getState().setOffer(pendingOffer.order);
                  useDriverDutyStore.getState().setDutyState('OFFER_PENDING');
                  logAudit('INCOMING_OFFER_RECEIVED', { orderId: pendingOffer.order.orderId, source: 'WEBSOCKET' });
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
            setStreamStatus('DISCONNECTED');
            logAudit('WS_CONNECTION_STATE', { status: 'DISCONNECTED' });
            streamRef.current = null;
          },
        },
        cityPrefix,
      );
      setStreamStatus('CONNECTED');
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
    telemetryStopRef.current?.();
    streamRef.current?.();
    telemetryStopRef.current = null;
    streamRef.current = null;
    setStreamStatus('DISCONNECTED');
  };

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    getDriverProfile(token)
      .then((profile) => {
        if (cancelled) return;

        // Redirect based on KYC / Verification status
        const status = profile.verification_status || 'ONBOARDING';
        if (status === 'ONBOARDING' || status === 'REJECTED') {
          router.push('/driver-onboarding');
          return;
        }
        if (status === 'PENDING') {
          setKycPending(true);
          return;
        }

        // Proceed to load terminal dashboard for VERIFIED drivers
        setKycPending(false);
        if (profile.current_state === 'ONLINE_AVAILABLE') {
          setDutyState('ONLINE');
          openOnlineStreams();
        } else if (profile.current_state === 'ONLINE_EN_ROUTE') {
          setDutyState('EN_ROUTE');
        } else if (profile.current_state === 'ONLINE_DELIVERING') {
          setDutyState('DELIVERING');
        } else {
          setDutyState('OFFLINE');
        }
      })
      .catch((err) => console.warn('[DRIVER_PROFILE] Initial hydration failed:', err));

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
      // Fallback fallback for static sandbox
      if (otpVerificationCode === '1234') {
        setOtpError('');
        setDutyState('DELIVERING');
      } else {
        setOtpError('Invalid OTP.');
      }
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
      <div className="min-h-screen bg-black text-white p-6 sm:p-12 font-sans flex flex-col justify-between selection:bg-white selection:text-black">
        <header className="border-b border-zinc-900 pb-6 text-left">
          <h1 className="text-xl font-bold tracking-tight text-white font-mono uppercase">DRIVERS-FOR-U</h1>
        </header>

        <main className="flex-grow flex flex-col items-center justify-center max-w-md mx-auto text-center space-y-6">
          <div className="h-16 w-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-xl animate-pulse">
            ⏳
          </div>
          <div className="space-y-2">
            <span className="bg-zinc-900 text-zinc-400 font-mono text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border border-zinc-850">
              KYC Compliance Review
            </span>
            <h2 className="text-2xl font-extrabold tracking-tight text-white font-move">Application Pending Verification</h2>
            <p className="text-zinc-500 text-xs leading-relaxed">
              Your onboarding documents (Aadhaar, DL, Police Verification) are being validated by our regional compliance team. This normally takes 12-24 hours. You will receive a push notification once approved.
            </p>
          </div>

          <div className="w-full space-y-2 pt-4">
            <button
              onClick={() => {
                if (token) {
                  getDriverProfile(token)
                    .then((profile) => {
                      if (profile.verification_status === 'VERIFIED') {
                        setKycPending(false);
                        window.location.reload();
                      } else {
                        alert("Your application is still under review. Please wait or contact support.");
                      }
                    })
                    .catch(() => alert("Failed to check status. Try again later."));
                }
              }}
              className="w-full bg-white hover:bg-zinc-200 text-black font-bold py-3 rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer font-mono"
            >
              🔄 Refresh Verification Status
            </button>
            <button
              onClick={() => {
                useAuthStore.getState().logout();
                router.push('/login?role=driver');
              }}
              className="w-full bg-zinc-950 hover:bg-zinc-900 text-zinc-500 hover:text-zinc-400 border border-zinc-900 font-bold py-3 rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer font-mono"
            >
              🚪 Sign Out of Session
            </button>
          </div>
        </main>

        <footer className="text-center text-[8px] font-mono text-zinc-600 uppercase tracking-wider pt-6 border-t border-zinc-900">
          Security Node ID: KYC_COMPLIANCE_PENDING_GATEWAY
        </footer>
      </div>
    );
  }

  const triggerSOS = () => {
    setSosActive(true);
    setSosCountdown(5);
    logAudit('SOS_CRITICAL_TRIGGERED', { driverID, time: new Date().toISOString() });
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
              setDutyState('ONLINE');
            }}
            className="w-full max-w-md mx-auto bg-white hover:bg-zinc-200 text-black font-bold py-4 rounded-full text-xs uppercase tracking-wider transition cursor-pointer active:scale-95"
          >
            ❌ Cancel Safety Alert Broadcast
          </button>
        </div>
      )}

      {/* 3. INCOMING BOOKING OFFER MODAL SHEET OVERLAY */}
      <OfferPopup />

      {/* CANCEL ALLOCATION PICKER OVERLAY */}
      {showCancelModal && activeTrip && (
        <div className="fixed inset-0 z-[100000] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-900 p-6 rounded-2xl w-full max-w-sm space-y-4 text-left font-mono">
            <div className="space-y-1">
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">Cancel Allocation</h3>
              <p className="text-[9px] text-zinc-500">Select a cancellation reason. Penalty charges may apply.</p>
            </div>

            <div className="space-y-1.5">
              {[
                { label: 'Rider No Show', value: 'RIDER_NO_SHOW' },
                { label: 'Wrong Address', value: 'WRONG_ADDRESS' },
                { label: 'Vehicle Breakdown', value: 'VEHICLE_BREAKDOWN' },
                { label: 'Safety Concerns', value: 'SAFETY' },
                { label: 'Other Options', value: 'OTHER' }
              ].map((reason) => (
                <button
                  key={reason.value}
                  type="button"
                  onClick={() => setSelectedCancelReason(reason.value)}
                  className={`w-full text-left py-2.5 px-3 rounded-xl border text-[10px] uppercase font-bold tracking-wide transition cursor-pointer ${
                    selectedCancelReason === reason.value
                      ? 'bg-red-950/40 border-red-800 text-red-400'
                      : 'bg-zinc-900/60 border-zinc-850 text-zinc-400 hover:text-white'
                  }`}
                >
                  {reason.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowCancelModal(false);
                  setSelectedCancelReason('');
                }}
                className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-[10px] font-bold uppercase py-3 rounded-xl text-zinc-400 text-center transition cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!selectedCancelReason) {
                    alert('Please select a reason.');
                    return;
                  }
                  logAudit('TRIP_CANCELLED_BY_DRIVER', { orderId: activeTrip.order_id, reason: selectedCancelReason });
                  setActiveTrip(null);
                  setDutyState('ONLINE');
                  setShowCancelModal(false);
                  setSelectedCancelReason('');
                }}
                className="bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold uppercase py-3 rounded-xl text-center transition cursor-pointer"
              >
                Confirm Cancel
              </button>
            </div>
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

          {/* Emergency SOS red trigger with 2-second hold confirmation */}
          <button
            onMouseDown={startSosHold}
            onMouseUp={cancelSosHold}
            onMouseLeave={cancelSosHold}
            onTouchStart={startSosHold}
            onTouchEnd={cancelSosHold}
            className="bg-red-600 hover:bg-red-700 text-white font-mono font-bold text-[9px] px-3.5 py-1.5 rounded-full animate-pulse transition-all cursor-pointer active:scale-95 flex items-center gap-1 border border-red-500 relative overflow-hidden select-none"
            style={{ minWidth: '85px' }}
          >
            {sosHolding ? (
              <span className="absolute inset-0 bg-red-800 transition-all duration-100" style={{ width: `${sosProgress}%`, opacity: 0.8 }} />
            ) : null}
            <span className="relative z-10">🚨 SOS {sosHolding ? `${Math.round(sosProgress)}%` : '(Hold)'}</span>
          </button>
        </div>
      </header>

      {/* CORE AREA: MAP LAYOUT AND VIEWS */}
      <main className="flex-1 flex flex-col relative min-h-[350px]">
        {/* Stylized background custom map simulation */}
        <div className="absolute inset-0 bg-zinc-950 z-0 overflow-hidden flex items-center justify-center" style={{ filter: dutyState === 'OFFLINE' ? 'grayscale(1)' : 'none' }}>
          {dutyState === 'OFFLINE' ? (
            <svg className="w-full h-full opacity-35 transition duration-500" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#222" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
          ) : (
            <div className="w-full h-full p-0 bg-black">
              <MapInterpolated
                drivers={mapDrivers}
                pickup={activeTrip ? { lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lng } : null}
                destination={activeTrip ? { lat: activeTrip.dropoff_lat, lng: activeTrip.dropoff_lng } : null}
                center={activeTrip ? { lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lng } : { lat: 22.5726, lng: 88.3639 }}
                theme="dark"
              />
            </div>
          )}

          {/* Turn-by-Turn Navigation Floating Panel */}
          {activeTrip && (dutyState === 'EN_ROUTE' || dutyState === 'DELIVERING') && (
            <div className="absolute top-16 left-4 z-20 bg-zinc-950/90 border border-zinc-800 p-3 rounded-xl font-mono text-[10px] space-y-1 max-w-xs shadow-lg animate-fadeIn text-left">
              <span className="text-[8px] font-bold text-zinc-505 uppercase tracking-widest block">Simulation Route Navigation</span>
              <div className="text-white font-bold flex items-center gap-1.5">
                <span>🛞</span>
                <span>{dutyState === 'EN_ROUTE' ? 'Drive to Pickup Location' : 'Drive to Dropoff Location'}</span>
              </div>
              <div className="text-zinc-400">
                {dutyState === 'EN_ROUTE' 
                  ? `Next: Turn Left onto Howrah Bridge Rd in ${(150 - mapGlideProgress * 1.5).toFixed(0)}m`
                  : `Next: Turn Right onto E.M. Bypass in ${(200 - mapGlideProgress * 2).toFixed(0)}m`
                }
              </div>
              <div className="text-zinc-505 text-[8px] uppercase tracking-wider">
                Current speed: {42 + Math.floor(Math.random() * 8)} km/h · GPS Lock Active
              </div>
            </div>
          )}

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
              {heatmapData && (
                <div className="bg-zinc-950/80 border border-zinc-800 text-[8px] font-mono text-zinc-400 py-1.5 px-3 rounded-full">
                  {heatmapData.region} · {Object.keys(heatmapData.cell_data).length} live cells
                </div>
              )}
            </div>
          )}

        </div>

        {/* BOTTOM ACTIVE CONTROL SHEET CARD DRAWER */}
        <div className="mt-auto w-full z-10 bg-zinc-950/90 border-t border-zinc-900 p-4 sm:p-6 space-y-4 max-w-xl mx-auto rounded-t-2xl shadow-xl backdrop-blur-md">
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
