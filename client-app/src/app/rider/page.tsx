'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/store/useAuthStore';
import { useRouter } from 'next/navigation';
import { API_GATEWAY_BASE_URL } from '@/config';
import { latLngToCell } from 'h3-js';

// Types
interface CarItem {
  id: string;
  make: string;
  model: string;
  type: string; // 'HATCHBACK' | 'PREMIUM_SUV' | 'ULTRA_LUXURY'
  transmission: 'MANUAL' | 'AUTOMATIC';
  plate: string;
  isDefault: boolean;
}

interface DriverState {
  id: string;
  sourceLat: number;
  sourceLng: number;
  targetLat: number;
  targetLng: number;
  currentLat: number;
  currentLng: number;
  bearing: number;
  speedKms: number;
  lastUpdate: number;
}

export default function RiderDashboardPage() {
  const t = useTranslations('riderHome');
  const router = useRouter();
  const { user, token } = useAuthStore();
  const riderName = user?.name || 'Sarah Connor';

  // Layout Viewport State Variables
  const [sheetHeight, setSheetHeight] = useState(15); // Bottom sheet height in vh
  const [isDraggingSheet, setIsDraggingSheet] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  // App navigation state variables
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [currentCity, setCurrentCity] = useState('Kolkata');
  const [unreadCount, setUnreadCount] = useState(2);
  const [showSosModal, setShowSosModal] = useState(false);

  // Map state
  const [mapCenter, setMapCenter] = useState({ lat: 22.5726, lng: 88.3639 });
  const [mapZoom, setMapZoom] = useState(14);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panRef = useRef({
    isPanning: false,
    startX: 0,
    startY: 0,
    centerLat: 22.5726,
    centerLng: 88.3639
  });

  // Coordinates
  const [pickupCoords, setPickupCoords] = useState({ lat: 22.5726, lng: 88.3639 });
  const [dropoffCoords, setDropoffCoords] = useState<null | { lat: number, lng: number }>(null);

  // Ambient Telemetry supply states
  const driversRef = useRef<Record<string, DriverState>>({});
  const [closestDriverEta, setClosestDriverEta] = useState(3);
  const [closestDriverId, setClosestDriverId] = useState('');
  
  // Booking selections
  const [tripType, setTripType] = useState<'CITY_ROUND' | 'CITY_ONEWAY' | 'MINI_OUTSTATION' | 'OUTSTATION'>('CITY_ROUND');
  const [pickupText, setPickupText] = useState('Salt Lake Sector V Tech Hub, Kolkata');
  const [dropoffText, setDropoffText] = useState('');
  const [stops, setStops] = useState<string[]>([]);
  const [scheduleLater, setScheduleLater] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('2026-06-04');
  const [scheduleTime, setScheduleTime] = useState('14:30');
  const [durationHours, setDurationHours] = useState(4); // Hourly slider
  const [durationDays, setDurationDays] = useState(1);   // Outstation slider

  // Car Selection States
  const [garageCars, setGarageCars] = useState<CarItem[]>([
    { id: 'c-1', make: 'Audi', model: 'A6 Sedan', type: 'ULTRA_LUXURY', transmission: 'AUTOMATIC', plate: 'WB-02-AK-9988', isDefault: true },
    { id: 'c-2', make: 'Maruti Suzuki', model: 'Swift Dzire', type: 'HATCHBACK', transmission: 'MANUAL', plate: 'KA-03-MD-4561', isDefault: false }
  ]);
  const [selectedCarId, setSelectedCarId] = useState('c-1');
  const [useOneTimeCar, setUseOneTimeCar] = useState(false);
  
  // One-time car override form state
  const [oneTimeMake, setOneTimeMake] = useState('');
  const [oneTimeModel, setOneTimeModel] = useState('');
  const [oneTimeTransmission, setOneTimeTransmission] = useState<'MANUAL' | 'AUTOMATIC'>('AUTOMATIC');
  const [oneTimeTier, setOneTimeTier] = useState<'HATCHBACK' | 'PREMIUM_SUV' | 'ULTRA_LUXURY'>('HATCHBACK');
  const [oneTimeError, setOneTimeError] = useState('');

  // Additional modifiers
  const [passengersCount, setPassengersCount] = useState(1);
  const [promoCode, setPromoCode] = useState('');
  const [promoApplied, setPromoApplied] = useState<'SUCCESS' | 'ERROR' | null>(null);
  const [d4mCareEnabled, setD4mCareEnabled] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('UPI');

  const [estimatedFare, setEstimatedFare] = useState(350);
  const [surgeMultiplier, setSurgeMultiplier] = useState(1.0);
  const [isQuoteLoading, setIsQuoteLoading] = useState(false);

  // Committing slide state
  const [slideX, setSlideX] = useState(0);
  const sliderTrackRef = useRef<HTMLDivElement>(null);
  const [isSliding, setIsSliding] = useState(false);
  const slideStartX = useRef(0);
  const [dropoffInputFlash, setDropoffInputFlash] = useState(false);

  // Auto load garage car details from session if available
  useEffect(() => {
    try {
      const storedCars = JSON.parse(localStorage.getItem('rider_garage_cars') || '[]');
      if (storedCars.length > 0) {
        setGarageCars(storedCars);
        const def = storedCars.find((c: any) => c.isDefault);
        if (def) setSelectedCarId(def.id);
        else setSelectedCarId(storedCars[0].id);
      }
    } catch (e) {}
  }, []);

  // Distance helper (Haversine)
  const getDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // Convert Lat/Lng to Canvas Coordinates (Mercator approximation)
  const toScreen = (lat: number, lng: number, width: number, height: number, center: { lat: number, lng: number }, zoom: number) => {
    const scale = 150000 * Math.pow(2, zoom - 14);
    const x = width / 2 + (lng - center.lng) * scale * Math.cos(center.lat * Math.PI / 180);
    const y = height / 2 - (lat - center.lat) * scale;
    return { x, y };
  };

  // Convert Canvas Coordinates to Lat/Lng
  const toLatLng = (x: number, y: number, width: number, height: number, center: { lat: number, lng: number }, zoom: number) => {
    const scale = 150000 * Math.pow(2, zoom - 14);
    const lng = center.lng + (x - width / 2) / (scale * Math.cos(center.lat * Math.PI / 180));
    const lat = center.lat - (y - height / 2) / scale;
    return { lat, lng };
  };

  // Canvas interaction handlers (pan and double-click to place pins)
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    panRef.current.isPanning = true;
    panRef.current.startX = e.clientX;
    panRef.current.startY = e.clientY;
    panRef.current.centerLat = mapCenter.lat;
    panRef.current.centerLng = mapCenter.lng;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!panRef.current.isPanning) return;
    const dx = e.clientX - panRef.current.startX;
    const dy = e.clientY - panRef.current.startY;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scale = 150000 * Math.pow(2, mapZoom - 14);
    const dLng = dx / (scale * Math.cos(mapCenter.lat * Math.PI / 180));
    const dLat = dy / scale;

    setMapCenter({
      lat: panRef.current.centerLat + dLat,
      lng: panRef.current.centerLng - dLng
    });
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    panRef.current.isPanning = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const clickedCoords = toLatLng(x, y, canvas.width, canvas.height, mapCenter, mapZoom);

    // If bottom sheet is collapsed, focus search and expand to Route Config
    if (sheetHeight <= 25) {
      setPickupCoords(clickedCoords);
      setPickupText(t('pinLabel', { lat: clickedCoords.lat.toFixed(4), lng: clickedCoords.lng.toFixed(4) }));
      setSheetHeight(45);
    } else {
      // Set dropoff location
      setDropoffCoords(clickedCoords);
      setDropoffText(t('dropoffLabel', { lat: clickedCoords.lat.toFixed(4), lng: clickedCoords.lng.toFixed(4) }));
      // Shift bottom sheet to spec config phase
      setSheetHeight(85);
    }
  };

  // Zoom handlers
  const handleZoomIn = () => setMapZoom(z => Math.min(18, z + 1));
  const handleZoomOut = () => setMapZoom(z => Math.max(10, z - 1));

  // Snapping Bottom Sheet Pointer Handlers
  const handleSheetPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDraggingSheet(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = sheetHeight;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleSheetPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingSheet) return;
    const deltaY = dragStartY.current - e.clientY;
    const deltaVh = (deltaY / window.innerHeight) * 100;
    const nextHeight = Math.max(15, Math.min(100, dragStartHeight.current + deltaVh));
    setSheetHeight(nextHeight);
  };

  const handleSheetPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingSheet) return;
    setIsDraggingSheet(false);
    e.currentTarget.releasePointerCapture(e.pointerId);

    // Snapping thresholds: A=15, B=45, C=85, D=100
    const snaps = [15, 45, 85, 100];
    const closest = snaps.reduce((prev, curr) => 
      Math.abs(curr - sheetHeight) < Math.abs(prev - sheetHeight) ? curr : prev
    );
    setSheetHeight(closest);
  };

  // Poll Ambient Driver supply locations every 5 seconds
  const fetchAmbientSupply = async () => {
    try {
      const res = await fetch(
        `${API_GATEWAY_BASE_URL}/api/v1/telemetry/supply/near?latitude=${mapCenter.lat}&longitude=${mapCenter.lng}&city_prefix=KOL`,
        {
          headers: {
            'X-Region-Prefix': 'KOL'
          }
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.drivers && Array.isArray(data.drivers)) {
          const now = Date.now();
          const currentCache = { ...driversRef.current };

          data.drivers.forEach((d: any) => {
            const id = d.driver_id;
            if (currentCache[id]) {
              // Update target coords and begin new 4-second interpolation window
              currentCache[id] = {
                id,
                sourceLat: currentCache[id].currentLat,
                sourceLng: currentCache[id].currentLng,
                targetLat: d.latitude,
                targetLng: d.longitude,
                currentLat: currentCache[id].currentLat,
                currentLng: currentCache[id].currentLng,
                bearing: d.bearing || 0,
                speedKms: d.speed_kms || 0,
                lastUpdate: now
              };
            } else {
              // Fresh driver node discovery
              currentCache[id] = {
                id,
                sourceLat: d.latitude,
                sourceLng: d.longitude,
                targetLat: d.latitude,
                targetLng: d.longitude,
                currentLat: d.latitude,
                currentLng: d.longitude,
                bearing: d.bearing || 0,
                speedKms: d.speed_kms || 0,
                lastUpdate: now
              };
            }
          });

          // Evict stale drivers inactive for more than 15s
          Object.keys(currentCache).forEach((id) => {
            const d = currentCache[id];
            if (now - d.lastUpdate > 15000) {
              delete currentCache[id];
            }
          });

          driversRef.current = currentCache;

          // Recalculate Closest driver ETA & Halo indicator
          let minDistance = Infinity;
          let closestId = '';
          data.drivers.forEach((d: any) => {
            const dist = getDistance(pickupCoords.lat, pickupCoords.lng, d.latitude, d.longitude);
            if (dist < minDistance) {
              minDistance = dist;
              closestId = d.driver_id;
            }
          });

          if (minDistance !== Infinity) {
            const eta = Math.max(1, Math.round(minDistance * 3.5));
            setClosestDriverEta(eta);
            setClosestDriverId(closestId);
          } else {
            setClosestDriverEta(3);
            setClosestDriverId('');
          }
        }
      }
    } catch (e) {
      console.warn('Failed fetching ambient supply telemetry:', e);
    }
  };

  useEffect(() => {
    fetchAmbientSupply();
    const interval = setInterval(fetchAmbientSupply, 5000);
    return () => clearInterval(interval);
  }, [mapCenter, pickupCoords]);

  // Request Animation Frame loop drawing the canvas elements
  useEffect(() => {
    let animationId = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const renderLoop = () => {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Draw complete vector simulation
        ctx.fillStyle = '#09090b';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Grid overlay
        ctx.strokeStyle = '#18181b';
        ctx.lineWidth = 1;
        const gridSize = 40;
        for (let x = 0; x < canvas.width; x += gridSize) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
          ctx.stroke();
        }
        for (let y = 0; y < canvas.height; y += gridSize) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
          ctx.stroke();
        }

        // Hooghly River ribbon
        ctx.strokeStyle = 'rgba(29, 78, 216, 0.25)';
        ctx.lineWidth = 40 * Math.pow(1.3, mapZoom - 14);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const riverCoords = [
          { lat: 22.6200, lng: 88.3220 },
          { lat: 22.6050, lng: 88.3300 },
          { lat: 22.5900, lng: 88.3320 },
          { lat: 22.5750, lng: 88.3260 },
          { lat: 22.5600, lng: 88.3250 },
          { lat: 22.5450, lng: 88.3280 },
          { lat: 22.5300, lng: 88.3340 },
          { lat: 22.5150, lng: 88.3420 }
        ];
        riverCoords.forEach((pt, idx) => {
          const screen = toScreen(pt.lat, pt.lng, canvas.width, canvas.height, mapCenter, mapZoom);
          if (idx === 0) ctx.moveTo(screen.x, screen.y);
          else ctx.lineTo(screen.x, screen.y);
        });
        ctx.stroke();

        // City streets
        ctx.strokeStyle = '#27272a';
        ctx.lineWidth = 4 * Math.pow(1.3, mapZoom - 14);

        // Central Avenue
        ctx.beginPath();
        let pt1 = toScreen(22.6100, 88.3620, canvas.width, canvas.height, mapCenter, mapZoom);
        let pt2 = toScreen(22.5300, 88.3620, canvas.width, canvas.height, mapCenter, mapZoom);
        ctx.moveTo(pt1.x, pt1.y);
        ctx.lineTo(pt2.x, pt2.y);
        ctx.stroke();

        // Park Street
        ctx.beginPath();
        pt1 = toScreen(22.5480, 88.3300, canvas.width, canvas.height, mapCenter, mapZoom);
        pt2 = toScreen(22.5480, 88.4200, canvas.width, canvas.height, mapCenter, mapZoom);
        ctx.moveTo(pt1.x, pt1.y);
        ctx.lineTo(pt2.x, pt2.y);
        ctx.stroke();

        // EM Bypass
        ctx.beginPath();
        const bypassCoords = [
          { lat: 22.6000, lng: 88.4100 },
          { lat: 22.5700, lng: 88.4150 },
          { lat: 22.5400, lng: 88.4050 },
          { lat: 22.5100, lng: 88.3950 }
        ];
        bypassCoords.forEach((pt, idx) => {
          const screen = toScreen(pt.lat, pt.lng, canvas.width, canvas.height, mapCenter, mapZoom);
          if (idx === 0) ctx.moveTo(screen.x, screen.y);
          else ctx.lineTo(screen.x, screen.y);
        });
        ctx.stroke();

        // Howrah Bridge structure
        ctx.strokeStyle = '#3f3f46';
        ctx.lineWidth = 6 * Math.pow(1.3, mapZoom - 14);
        ctx.beginPath();
        pt1 = toScreen(22.5850, 88.3300, canvas.width, canvas.height, mapCenter, mapZoom);
        pt2 = toScreen(22.5830, 88.3620, canvas.width, canvas.height, mapCenter, mapZoom);
        ctx.moveTo(pt1.x, pt1.y);
        ctx.lineTo(pt2.x, pt2.y);
        ctx.stroke();

        // Draw Route connector vectors if dropoff configured
        if (dropoffCoords) {
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          const p1 = toScreen(pickupCoords.lat, pickupCoords.lng, canvas.width, canvas.height, mapCenter, mapZoom);
          const p2 = toScreen(dropoffCoords.lat, dropoffCoords.lng, canvas.width, canvas.height, mapCenter, mapZoom);
          ctx.moveTo(p1.x, p1.y);
          
          // Bezier curve detour styling
          const midLat = (pickupCoords.lat + dropoffCoords.lat) / 2;
          const midLng = (pickupCoords.lng + dropoffCoords.lng) / 2 + 0.006;
          const mid = toScreen(midLat, midLng, canvas.width, canvas.height, mapCenter, mapZoom);
          ctx.quadraticCurveTo(mid.x, mid.y, p2.x, p2.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Draw Pulsing Pickup Halo
        const pulseRadius = 35 + Math.sin(Date.now() / 250) * 8;
        const pScreen = toScreen(pickupCoords.lat, pickupCoords.lng, canvas.width, canvas.height, mapCenter, mapZoom);
        
        ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
        ctx.beginPath();
        ctx.arc(pScreen.x, pScreen.y, pulseRadius, 0, 2 * Math.PI);
        ctx.fill();
        
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pScreen.x, pScreen.y, pulseRadius, 0, 2 * Math.PI);
        ctx.stroke();

        // Pickup Anchor Point
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(pScreen.x, pScreen.y, 9, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(pScreen.x, pScreen.y, 3, 0, 2 * Math.PI);
        ctx.fill();

        // Pickup text estimation tag
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.font = 'bold 9px monospace';
        const txt = `DRIVERS: ${closestDriverEta} MIN`;
        const txtWidth = ctx.measureText(txt).width;
        ctx.fillStyle = '#09090b';
        ctx.fillRect(pScreen.x - txtWidth / 2 - 6, pScreen.y - 25, txtWidth + 12, 16);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1;
        ctx.strokeRect(pScreen.x - txtWidth / 2 - 6, pScreen.y - 25, txtWidth + 12, 16);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(txt, pScreen.x - txtWidth / 2, pScreen.y - 14);

        // Draw Dropoff Anchor Pin if configured
        if (dropoffCoords) {
          const dScreen = toScreen(dropoffCoords.lat, dropoffCoords.lng, canvas.width, canvas.height, mapCenter, mapZoom);
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(dScreen.x, dScreen.y, 9, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.5;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(dScreen.x, dScreen.y, 3, 0, 2 * Math.PI);
          ctx.fill();
        }

        // Animating Ambient Cab nodes
        const now = Date.now();
        Object.values(driversRef.current).forEach((driver) => {
          const elapsed = now - driver.lastUpdate;
          const t = Math.min(1, elapsed / 4000);
          driver.currentLat = driver.sourceLat + (driver.targetLat - driver.sourceLat) * t;
          driver.currentLng = driver.sourceLng + (driver.targetLng - driver.sourceLng) * t;

          const screen = toScreen(driver.currentLat, driver.currentLng, canvas.width, canvas.height, mapCenter, mapZoom);

          // Draw yellow cab bodies rotated to match course bearing
          ctx.save();
          ctx.translate(screen.x, screen.y);
          ctx.rotate(driver.bearing * Math.PI / 180);

          ctx.fillStyle = '#eab308';
          ctx.fillRect(-5, -8, 10, 16);
          ctx.fillStyle = '#000000';
          ctx.fillRect(-3, -5, 6, 3);
          ctx.fillRect(-3, 2, 6, 2);
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(-2, -1, 4, 1);

          ctx.restore();

          // Green circle pulse around nearest matching driver node
          if (closestDriverId === driver.id) {
            ctx.strokeStyle = 'rgba(16, 185, 129, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, 16 + Math.sin(now / 150) * 4, 0, 2 * Math.PI);
            ctx.stroke();
          }
        });
      }
      animationId = requestAnimationFrame(renderLoop);
    };

    renderLoop();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationId);
    };
  }, [mapCenter, mapZoom, pickupCoords, dropoffCoords, closestDriverEta, closestDriverId]);

  // Debounced Upfront Cost Quotes calculations Handshake
  useEffect(() => {
    const quoteTimer = setTimeout(() => {
      triggerQuoteFetch();
    }, 300);

    return () => clearTimeout(quoteTimer);
  }, [
    tripType,
    durationHours,
    durationDays,
    selectedCarId,
    useOneTimeCar,
    oneTimeMake,
    oneTimeModel,
    oneTimeTransmission,
    oneTimeTier,
    d4mCareEnabled,
    promoApplied,
    pickupCoords,
    dropoffCoords
  ]);

  const triggerQuoteFetch = async () => {
    setIsQuoteLoading(true);
    let base = 350;

    let targetCarTier = 'HATCHBACK';
    if (useOneTimeCar) {
      targetCarTier = oneTimeTier;
    } else {
      const activeCar = garageCars.find(c => c.id === selectedCarId);
      if (activeCar) {
        targetCarTier = activeCar.type;
      }
    }

    if (targetCarTier === 'PREMIUM_SUV') base = 500;
    if (targetCarTier === 'ULTRA_LUXURY') base = 750;

    // Trip type duration calculations
    if (tripType === 'CITY_ROUND') {
      base += durationHours * 100;
    } else if (tripType === 'OUTSTATION') {
      base = durationDays * 1800 + 400;
    } else if (tripType === 'MINI_OUTSTATION') {
      base = 1200;
    } else {
      base += 200; // One way flat
    }

    let h3Cell = '863cf1007ffffff';
    try {
      h3Cell = latLngToCell(pickupCoords.lat, pickupCoords.lng, 8);
    } catch (e) {}

    const baseFarePaise = base * 100;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Region-Prefix': 'KOL'
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/orders/quote`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          h3_cell: h3Cell,
          base_fare_paise: baseFarePaise
        })
      });

      if (res.ok) {
        const data = await res.json();
        const fareInRupees = data.calculated_fare_paise / 100;
        setSurgeMultiplier(data.active_surge_multiplier || 1.0);

        let finalFare = fareInRupees;
        if (d4mCareEnabled) finalFare += 49;
        if (promoApplied === 'SUCCESS') finalFare -= 100;
        setEstimatedFare(Math.max(150, finalFare));
      } else {
        // Fallback calculations
        let finalFare = base;
        if (d4mCareEnabled) finalFare += 49;
        if (promoApplied === 'SUCCESS') finalFare -= 100;
        setEstimatedFare(Math.max(150, finalFare));
        setSurgeMultiplier(1.0);
      }
    } catch (err) {
      console.warn('POST orders quote failed, doing offline estimate calculations:', err);
      let finalFare = base;
      if (d4mCareEnabled) finalFare += 49;
      if (promoApplied === 'SUCCESS') finalFare -= 100;
      setEstimatedFare(Math.max(150, finalFare));
      setSurgeMultiplier(1.0);
    } finally {
      setIsQuoteLoading(false);
    }
  };

  // Autocomplete shortcuts
  const handleSetFavoriteLocation = (target: 'PICKUP' | 'DROPOFF', loc: { name: string, lat: number, lng: number }) => {
    if (target === 'PICKUP') {
      setPickupCoords({ lat: loc.lat, lng: loc.lng });
      setPickupText(loc.name);
    } else {
      setDropoffCoords({ lat: loc.lat, lng: loc.lng });
      setDropoffText(loc.name);
      setSheetHeight(85); // Auto slide to asset selection on destination confirmations
    }
  };

  const handleAddStop = () => {
    if (stops.length >= 3) {
      alert(t('maxStopsAlert'));
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

  const handleApplyPromo = () => {
    if (promoCode.toUpperCase() === 'FREE50' || promoCode.toUpperCase() === 'WELCOME') {
      setPromoApplied('SUCCESS');
    } else {
      setPromoApplied('ERROR');
    }
  };

  // Commit dispatch orders with cryptographic X-Idempotency-Key
  const handleDispatchTrigger = async () => {
    const baseFarePaise = estimatedFare * 100;
    const idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : 'idemp-' + Math.random().toString(36).substring(2, 15);

    let h3Cell = '863cf1007ffffff';
    try {
      h3Cell = latLngToCell(pickupCoords.lat, pickupCoords.lng, 8);
    } catch (e) {}

    const optimisticOrderId = 'ord-opt-' + Math.random().toString(36).substring(2, 10);
    const bookingDetails = {
      orderId: optimisticOrderId,
      tripType,
      pickup: pickupText,
      dropoff: dropoffText,
      stops,
      schedule: scheduleLater ? { date: scheduleDate, time: scheduleTime } : 'NOW',
      car: useOneTimeCar 
        ? { make: oneTimeMake || 'Custom Car', model: oneTimeModel || 'Override', type: oneTimeTier, transmission: oneTimeTransmission }
        : garageCars.find(c => c.id === selectedCarId),
      passengers: passengersCount,
      care: d4mCareEnabled,
      payment: paymentMethod,
      fare: estimatedFare
    };

    // Save specifications and transition immediately
    sessionStorage.setItem('current_booking_specs', JSON.stringify(bookingDetails));
    router.push(`/rider/dispatch?orderId=${optimisticOrderId}`);

    // Asynchronous background retry ingestion loop with exponential backoff
    const dispatchOrderBackground = async (attempt = 1) => {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Region-Prefix': 'KOL',
          'X-Idempotency-Key': idempotencyKey
        };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/orders`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            city_prefix: 'KOL',
            customer_id: user?.id || 'usr-mock-11',
            pickup_h3_cell: h3Cell,
            pickup_lat: pickupCoords.lat,
            pickup_lng: pickupCoords.lng,
            pickup_osm_node_id: 123456,
            dropoff_lat: dropoffCoords?.lat || pickupCoords.lat,
            dropoff_lng: dropoffCoords?.lng || pickupCoords.lng,
            base_fare_paise: baseFarePaise
          })
        });

        if (!res.ok) {
          throw new Error(`Gateway returned error status: ${res.status}`);
        }
        
        const data = await res.json();
        const realOrderId = data.id || data.order_id;
        console.log('[OPTIMISTIC_UI] Background order successfully created:', realOrderId);
        
        // Update specs with real ID
        bookingDetails.orderId = realOrderId;
        sessionStorage.setItem('current_booking_specs', JSON.stringify(bookingDetails));
      } catch (err) {
        console.warn(`[OPTIMISTIC_UI] Background dispatch attempt ${attempt} failed:`, err);
        if (attempt < 4) {
          const delay = Math.pow(2, attempt) * 1000;
          setTimeout(() => dispatchOrderBackground(attempt + 1), delay);
        } else {
          // Trigger error modal / alert to rider
          alert(t('orderCreationError'));
        }
      }
    };

    dispatchOrderBackground();
  };

  const handleSliderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Prevent dragging from starting if validation fails
    const dropoffRequired = tripType !== 'CITY_ROUND';
    if (dropoffRequired && !dropoffText.trim()) {
      setDropoffInputFlash(true);
      setTimeout(() => setDropoffInputFlash(false), 800);
      alert(t('destinationRequiredAlert'));
      return;
    }

    setIsSliding(true);
    slideStartX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleSliderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isSliding || !sliderTrackRef.current) return;
    const trackWidth = sliderTrackRef.current.clientWidth;
    const thumbWidth = 56;
    const maxSlide = trackWidth - thumbWidth - 12;
    const deltaX = e.clientX - slideStartX.current;
    const nextX = Math.max(0, Math.min(maxSlide, deltaX));
    setSlideX(nextX);
  };

  const handleSliderPointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isSliding || !sliderTrackRef.current) return;
    setIsSliding(false);
    e.currentTarget.releasePointerCapture(e.pointerId);

    const trackWidth = sliderTrackRef.current.clientWidth;
    const thumbWidth = 56;
    const maxSlide = trackWidth - thumbWidth - 12;

    if (slideX >= maxSlide * 0.85) {
      setSlideX(maxSlide);
      await handleDispatchTrigger();
    } else {
      setSlideX(0);
    }
  };

  // Override Form Validation Bind
  const handleBindOneTimeCar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!oneTimeMake.trim() || !oneTimeModel.trim()) {
      setOneTimeError(t('makeModelMandatory'));
      return;
    }
    setOneTimeError('');
    setSheetHeight(85); // Slide back down to C
    alert(t('overrideBoundAlert', { make: oneTimeMake, model: oneTimeModel, tier: oneTimeTier }));
  };

  const triggerSOS = () => {
    setShowSosModal(false);
    alert(t('sosDispatchAlert'));
  };

  // Coordinate shortcuts databases
  const favorites = [
    { label: t('favoriteHomeLabel'), name: t('favoriteHomeName'), lat: 22.5480, lng: 88.3512 },
    { label: t('favoriteWorkLabel'), name: t('favoriteWorkName'), lat: 22.5726, lng: 88.4339 },
    { label: t('favoriteAirportLabel'), name: t('favoriteAirportName'), lat: 22.6547, lng: 88.4467 },
    { label: t('favoriteHowrahLabel'), name: t('favoriteHowrahName'), lat: 22.5834, lng: 88.3418 }
  ];

  return (
    <div className="min-h-screen bg-black text-white p-0 font-sans flex flex-col justify-between selection:bg-white selection:text-black overflow-hidden relative">
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }
        .animate-shake {
          animation: shake 0.4s ease-in-out;
        }
      `}</style>

      {/* ==================== LAYER 3 (Z-INDEX: 50): TOP NAVIGATION HEADER BAR ==================== */}
      <header className="bg-zinc-950/80 border-b border-zinc-900/60 p-4 fixed top-0 left-0 right-0 z-50 flex justify-between items-center w-full backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsDrawerOpen(true)}
            className="h-9 w-9 bg-zinc-900 hover:bg-zinc-850 rounded-xl border border-zinc-800 flex items-center justify-center text-sm cursor-pointer transition active:scale-95"
            aria-label={t('openNavigationDrawer')}
          >
            ☰
          </button>

          <div>
            <h1 className="text-xs font-bold font-mono tracking-tight text-white uppercase">{t('appTitle')}</h1>
            <select
              value={currentCity}
              onChange={(e) => setCurrentCity(e.target.value)}
              className="bg-transparent text-[9px] font-mono font-bold text-zinc-500 uppercase outline-none cursor-pointer mt-0.5"
            >
              <option value="Kolkata">{t('cityKolkata')}</option>
              <option value="Bangalore">{t('cityBangalore')}</option>
              <option value="Mumbai">{t('cityMumbai')}</option>
              <option value="Delhi NCR">{t('cityDelhiNcr')}</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Notification bell and SOS red triggers */}
          <Link
            href="/account/notifications"
            className="h-9 w-9 bg-zinc-900 hover:bg-zinc-850 rounded-xl border border-zinc-800 flex items-center justify-center relative transition hover:text-white"
          >
            🔔
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-600 text-white font-mono font-bold text-[8px] h-4 w-4 rounded-full flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </Link>

          <button
            onClick={() => setShowSosModal(true)}
            className="bg-red-600 hover:bg-red-700 text-white font-mono font-bold text-[9px] px-3.5 py-1.5 rounded-full animate-pulse transition cursor-pointer border border-red-500"
          >
            {t('sosButton')}
          </button>
        </div>
      </header>

      {/* ==================== LAYER 1 (Z-INDEX: 10): VECTOR MAP WORKSPACE ==================== */}
      <div className="absolute inset-0 z-10 w-full h-full">
        <canvas
          ref={canvasRef}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onDoubleClick={handleCanvasDoubleClick}
          className="w-full h-full block cursor-grab active:cursor-grabbing"
        />

        {/* Map UI overlays */}
        <div className="absolute top-20 left-4 z-20 flex flex-col gap-2">
          {/* Pulsing Supply Badge */}
          <div className="bg-zinc-950/80 border border-zinc-800 text-[8px] font-mono font-bold uppercase py-1 px-2.5 rounded-full tracking-wider select-none backdrop-blur-sm">
            {t('nearestDriver', { eta: closestDriverEta })}
          </div>
        </div>

        {/* Zoom controls */}
        <div className="absolute bottom-[20vh] right-4 z-20 flex flex-col gap-1.5 font-mono font-bold text-xs select-none">
          <button
            onClick={handleZoomIn}
            className="h-8 w-8 bg-zinc-950/80 border border-zinc-800 rounded-lg flex items-center justify-center text-white hover:bg-zinc-900 transition backdrop-blur-sm cursor-pointer"
          >
            +
          </button>
          <button
            onClick={handleZoomOut}
            className="h-8 w-8 bg-zinc-950/80 border border-zinc-800 rounded-lg flex items-center justify-center text-white hover:bg-zinc-900 transition backdrop-blur-sm cursor-pointer"
          >
            -
          </button>
        </div>
      </div>

      {/* ==================== LAYER 2 (Z-INDEX: 30): GESTURE SNAPPING BOTTOM SHEET ==================== */}
      <div
        style={{ height: `${sheetHeight}vh` }}
        className={`fixed bottom-0 left-0 right-0 z-30 bg-zinc-950/95 border-t border-zinc-900/60 shadow-2xl backdrop-blur-md rounded-t-3xl overflow-hidden flex flex-col transition-all duration-300 ${
          isDraggingSheet ? 'transition-none' : ''
        }`}
      >
        {/* Gestures drag handle primitive bar */}
        <div
          onPointerDown={handleSheetPointerDown}
          onPointerMove={handleSheetPointerMove}
          onPointerUp={handleSheetPointerUp}
          className="w-full py-3.5 flex items-center justify-center cursor-ns-resize select-none border-b border-zinc-900/40"
        >
          <div className="w-12 h-1 bg-zinc-800 hover:bg-zinc-600 rounded-full transition-colors" />
        </div>

        {/* Dynamic State Scroll Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 max-w-xl mx-auto w-full text-left">
          
          {/* ==================== STATE A: COLLAPSED_SNAP (<25vh) ==================== */}
          {sheetHeight <= 25 && (
            <div className="space-y-4 animate-fadeIn">
              {/* Fake Search Input bar */}
              <div
                onClick={() => setSheetHeight(45)}
                className="w-full bg-zinc-900/80 border border-zinc-850 rounded-2xl p-3.5 flex items-center gap-3 cursor-pointer hover:border-zinc-700 transition"
              >
                <span className="text-zinc-500">🔍</span>
                <span className="text-xs text-zinc-400 font-mono">{t('searchPrompt')}</span>
              </div>

              {/* Quick Tiles grid shortcuts */}
              <div className="grid grid-cols-4 gap-2 font-mono text-[8px] font-bold text-zinc-500 uppercase">
                <Link
                  href="/account/garage"
                  className="bg-zinc-900 hover:bg-zinc-850 p-2.5 rounded-xl border border-zinc-850 text-center flex flex-col items-center gap-1 transition no-underline text-zinc-400 hover:text-white"
                >
                  <span>🚗</span>
                  <span className="truncate">{t('tileMyGarage')}</span>
                </Link>
                <button
                  onClick={() => {
                    setPickupText('Salt Lake Sector V Tech Hub, Kolkata');
                    setDropoffText('Park Street Dining Grid, Kolkata');
                    setPickupCoords({ lat: 22.5726, lng: 88.4339 });
                    setDropoffCoords({ lat: 22.5480, lng: 88.3512 });
                    setTripType('CITY_ROUND');
                    setSheetHeight(85);
                    alert(t('rebookLoadedAlert'));
                  }}
                  className="bg-zinc-900 hover:bg-zinc-850 p-2.5 rounded-xl border border-zinc-850 text-center flex flex-col items-center gap-1 transition cursor-pointer text-zinc-400 hover:text-white"
                >
                  <span>🔄</span>
                  <span className="truncate">{t('tileRebookLast')}</span>
                </button>
                <Link
                  href="/account/rewards"
                  className="bg-zinc-900 hover:bg-zinc-850 p-2.5 rounded-xl border border-zinc-850 text-center flex flex-col items-center gap-1 transition no-underline text-zinc-400 hover:text-white"
                >
                  <span>🎁</span>
                  <span className="truncate">{t('tileOffers')}</span>
                </Link>
                <Link
                  href="/account/refer"
                  className="bg-zinc-900 hover:bg-zinc-850 p-2.5 rounded-xl border border-zinc-850 text-center flex flex-col items-center gap-1 transition no-underline text-zinc-400 hover:text-white"
                >
                  <span>🏆</span>
                  <span className="truncate">{t('tileReferEarn')}</span>
                </Link>
              </div>
            </div>
          )}

          {/* ==================== STATE B: ROUTE_CONFIG_SNAP (25vh - 55vh) ==================== */}
          {sheetHeight > 25 && sheetHeight <= 55 && (
            <div className="space-y-4 animate-fadeIn">
              {/* Segmented Trip Type Tab switches */}
              <div className="flex bg-zinc-900/60 p-1 rounded-xl border border-zinc-900 font-mono text-[9px] uppercase font-bold text-zinc-500">
                {[
                  { id: 'CITY_ROUND', label: t('tripTypeRoundTrip') },
                  { id: 'CITY_ONEWAY', label: t('tripTypeOneWay') },
                  { id: 'MINI_OUTSTATION', label: t('tripTypeMini') },
                  { id: 'OUTSTATION', label: t('tripTypeOutstation') }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setTripType(tab.id as any)}
                    className={`flex-1 py-2 rounded-lg transition-all cursor-pointer ${
                      tripType === tab.id ? 'bg-white text-black' : 'hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Autocomplete Input Forms */}
              <div className="bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl space-y-3 font-sans text-xs">
                <div>
                  <label className="block text-[8px] uppercase font-bold text-zinc-500 mb-1 font-mono">{t('pickupLocationLabel')}</label>
                  <input
                    type="text"
                    value={pickupText}
                    onChange={(e) => setPickupText(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-850 rounded-lg p-2.5 text-white focus:outline-none focus:border-zinc-500 text-xs"
                    placeholder={t('pickupAddressPlaceholder')}
                  />
                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                    {favorites.slice(0, 3).map((f) => (
                      <button
                        key={f.label}
                        onClick={() => handleSetFavoriteLocation('PICKUP', f)}
                        className="bg-zinc-900 text-zinc-400 hover:text-white px-2 py-1 rounded text-[8px] font-mono border border-zinc-850"
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Stops */}
                {stops.map((stop, i) => (
                  <div key={i} className="flex gap-2 items-center animate-fadeIn">
                    <div className="flex-1">
                      <label className="block text-[8px] uppercase font-bold text-zinc-500 mb-1 font-mono">{t('stopLabel', { number: i + 1 })}</label>
                      <input
                        type="text"
                        value={stop}
                        onChange={(e) => handleStopChange(i, e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-850 rounded-lg p-2 text-white focus:outline-none focus:border-zinc-500 text-xs"
                        placeholder={t('stopAddressPlaceholder')}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveStop(i)}
                      className="bg-zinc-950 hover:bg-zinc-900 text-red-500 border border-zinc-850 h-8 w-8 rounded-lg mt-4 flex items-center justify-center cursor-pointer text-xs"
                    >
                      ✕
                    </button>
                  </div>
                ))}

                {/* Dropoff Address */}
                {tripType !== 'CITY_ROUND' && (
                  <div>
                    <label className="block text-[8px] uppercase font-bold text-zinc-500 mb-1 font-mono">{t('destinationAddressLabel')}</label>
                    <input
                      type="text"
                      value={dropoffText}
                      onChange={(e) => setDropoffText(e.target.value)}
                      className={`w-full bg-zinc-950 border rounded-lg p-2.5 text-white focus:outline-none text-xs transition-all ${
                        dropoffInputFlash
                          ? 'border-red-500 ring-2 ring-red-500/20 animate-shake'
                          : 'border-zinc-850 focus:border-zinc-500'
                      }`}
                      placeholder={t('searchPrompt')}
                    />
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {favorites.map((f) => (
                        <button
                          key={f.label}
                          onClick={() => handleSetFavoriteLocation('DROPOFF', f)}
                          className="bg-zinc-900 text-zinc-400 hover:text-white px-2 py-1 rounded text-[8px] font-mono border border-zinc-850"
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleAddStop}
                    className="text-[8px] font-mono font-bold uppercase text-zinc-500 hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    {t('addStopButton')}
                  </button>
                </div>
              </div>

              {/* Next phase CTA */}
              <button
                type="button"
                onClick={() => {
                  const dropoffRequired = tripType !== 'CITY_ROUND';
                  if (dropoffRequired && !dropoffText.trim()) {
                    setDropoffInputFlash(true);
                    setTimeout(() => setDropoffInputFlash(false), 800);
                    return;
                  }
                  setSheetHeight(85);
                }}
                className="w-full bg-white text-black font-mono font-bold text-[10px] py-3.5 rounded-xl uppercase tracking-wider transition hover:bg-zinc-200"
              >
                {t('proceedToAssetCta')}
              </button>
            </div>
          )}

          {/* ==================== STATE C: ASSET_SPEC_SNAP (55vh - 95vh) ==================== */}
          {sheetHeight > 55 && sheetHeight <= 95 && (
            <div className="space-y-4 animate-fadeIn">
              {/* Route Summary bar */}
              <div className="flex justify-between items-center bg-zinc-900/30 border border-zinc-900 p-3.5 rounded-xl font-mono text-[9px]">
                <div className="truncate pr-4">
                  <span className="text-zinc-500 block uppercase">{t('routeLabel')}</span>
                  <span className="text-white font-sans block truncate text-xs font-semibold">{pickupText} ➔ {tripType === 'CITY_ROUND' ? t('roundPack') : dropoffText}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSheetHeight(45)}
                  className="text-zinc-400 hover:text-white uppercase font-bold text-[8px]"
                >
                  {t('editButton')}
                </button>
              </div>

              {/* Garage Vehicle Selector matrix */}
              <div className="bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl space-y-3 text-xs">
                <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                  <span className="text-zinc-500 uppercase font-mono font-bold text-[8px]">{t('selectVehicleFromGarage')}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setUseOneTimeCar(!useOneTimeCar);
                      if (!useOneTimeCar) {
                        setSheetHeight(100); // Pull up fully to present input overrides
                      }
                    }}
                    className="text-[8px] font-mono font-bold text-zinc-400 hover:text-white uppercase"
                  >
                    {useOneTimeCar ? t('useGarageToggle') : t('oneTimeOverrideToggle')}
                  </button>
                </div>

                {!useOneTimeCar ? (
                  <div className="space-y-2 text-xs font-mono">
                    {garageCars.map((car) => (
                      <label key={car.id} className="flex items-center justify-between p-2.5 bg-zinc-950 border border-zinc-850 rounded-xl cursor-pointer">
                        <div className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="garage-selector"
                            checked={selectedCarId === car.id}
                            onChange={() => setSelectedCarId(car.id)}
                            className="cursor-pointer"
                          />
                          <div>
                            <span className="text-white font-sans font-medium block">{car.make} {car.model}</span>
                            <span className="text-[8px] text-zinc-500 block uppercase mt-0.5">{car.plate} • {car.transmission} • {car.type}</span>
                          </div>
                        </div>
                        {car.isDefault && (
                          <span className="bg-zinc-900 text-zinc-400 border border-zinc-850 text-[7px] font-bold px-1.5 py-0.5 rounded uppercase">
                            {t('defaultBadge')}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 bg-zinc-950 border border-zinc-900 rounded-xl flex justify-between items-center font-mono text-xs">
                    <div>
                      <span className="text-white block font-sans font-semibold">{oneTimeMake || t('overrideFallbackMake')} {oneTimeModel || t('overrideFallbackModel')}</span>
                      <span className="text-[8px] text-zinc-500 block uppercase mt-0.5">{oneTimeTransmission} • {oneTimeTier}</span>
                    </div>
                    <button
                      onClick={() => setSheetHeight(100)}
                      className="text-zinc-400 hover:text-white text-[8px] font-bold uppercase"
                    >
                      {t('configButton')}
                    </button>
                  </div>
                )}
              </div>

              {/* Schedule control */}
              <div className="flex justify-between items-center bg-zinc-900/40 p-3 border border-zinc-900 rounded-xl text-xs">
                <div className="space-y-0.5">
                  <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider block">{t('departureScheduleLabel')}</span>
                  <span className="font-bold text-white text-xs">{scheduleLater ? t('scheduledFor', { date: scheduleDate, time: scheduleTime }) : t('immediateDeparture')}</span>
                </div>

                <button
                  onClick={() => setScheduleLater(!scheduleLater)}
                  className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 text-[9px] font-mono font-bold uppercase py-1.5 px-3 rounded-xl text-zinc-300 cursor-pointer"
                >
                  {scheduleLater ? t('scheduleNow') : t('scheduleLater')}
                </button>
              </div>

              {scheduleLater && (
                <div className="grid grid-cols-2 gap-2 animate-fadeIn text-xs font-mono">
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="bg-zinc-950 border border-zinc-850 rounded-lg p-2 text-white outline-none"
                  />
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="bg-zinc-950 border border-zinc-850 rounded-lg p-2 text-white outline-none"
                  />
                </div>
              )}

              {/* Duration adjustments sliders */}
              {(tripType === 'CITY_ROUND' || tripType === 'OUTSTATION') && (
                <div className="bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl space-y-2 text-xs font-mono">
                  {tripType === 'CITY_ROUND' ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-zinc-500 uppercase font-bold text-[8px]">{t('jobDuration')}</span>
                        <span className="text-white font-bold">{t('hoursPackage', { hours: durationHours })}</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="24"
                        value={durationHours}
                        onChange={(e) => setDurationHours(parseInt(e.target.value))}
                        className="w-full h-8 cursor-pointer accent-white"
                      />
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between">
                        <span className="text-zinc-500 uppercase font-bold text-[8px]">{t('outstationDays')}</span>
                        <span className="text-white font-bold">{t('daysPackage', { days: durationDays })}</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="7"
                        value={durationDays}
                        onChange={(e) => setDurationDays(parseInt(e.target.value))}
                        className="w-full h-8 cursor-pointer accent-white"
                      />
                    </>
                  )}
                </div>
              )}

              {/* Surcharges steps grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="flex justify-between items-center bg-zinc-900/40 p-3.5 border border-zinc-900 rounded-xl">
                  <span className="text-[8px] font-mono font-bold text-zinc-500 uppercase">{t('passengersLabel')}</span>
                  <div className="flex gap-3 items-center font-mono font-bold">
                    <button
                      onClick={() => setPassengersCount(c => Math.max(1, c - 1))}
                      className="h-6 w-6 bg-zinc-950 border border-zinc-800 rounded flex items-center justify-center"
                    >
                      -
                    </button>
                    <span>{passengersCount}</span>
                    <button
                      onClick={() => setPassengersCount(c => Math.min(8, c + 1))}
                      className="h-6 w-6 bg-zinc-950 border border-zinc-800 rounded flex items-center justify-center"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="flex justify-between items-center bg-zinc-900/40 p-3.5 border border-zinc-900 rounded-xl">
                  <div>
                    <span className="text-[8px] font-mono font-bold text-zinc-500 uppercase block">{t('d4mCareSurcharge')}</span>
                    <span className="text-[9px] text-zinc-400 block mt-0.5">{t('d4mCareDetail')}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setD4mCareEnabled(!d4mCareEnabled)}
                    className={`h-5 w-10 rounded-full transition relative p-0.5 ${d4mCareEnabled ? 'bg-white' : 'bg-zinc-800'}`}
                  >
                    <div className={`h-4 w-4 rounded-full shadow transition-transform ${d4mCareEnabled ? 'translate-x-5 bg-black' : 'translate-x-0 bg-zinc-400'}`} />
                  </button>
                </div>
              </div>

              {/* Promos */}
              <div className="bg-zinc-900/40 p-3 border border-zinc-900 rounded-xl text-xs">
                <label className="block text-[8px] font-mono font-bold text-zinc-500 uppercase mb-1">{t('promoCouponCodeLabel')}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value)}
                    placeholder={t('promoCodePlaceholder')}
                    className="flex-grow bg-zinc-950 border border-zinc-850 rounded-xl p-2.5 text-white focus:outline-none font-mono text-xs uppercase"
                  />
                  <button
                    type="button"
                    onClick={handleApplyPromo}
                    className="bg-zinc-900 hover:bg-zinc-850 text-zinc-300 border border-zinc-850 rounded-xl px-4 text-[9px] font-mono font-bold uppercase tracking-wider transition cursor-pointer"
                  >
                    {t('applyButton')}
                  </button>
                </div>
                {promoApplied && (
                  <span className={`text-[8px] font-mono block mt-1.5 uppercase font-bold ${
                    promoApplied === 'SUCCESS' ? 'text-emerald-400' : 'text-red-500'
                  }`}>
                    {promoApplied === 'SUCCESS' ? t('promoSuccess') : t('promoError')}
                  </span>
                )}
              </div>

              {/* Payment methods */}
              <div className="flex justify-between items-center bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl text-xs">
                <div className="space-y-0.5">
                  <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest block">{t('paymentMethodLabel')}</span>
                  <span className="font-bold text-white text-xs">{t('paymentWallet', { method: paymentMethod })}</span>
                </div>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="bg-zinc-950 border border-zinc-850 rounded-xl p-2 font-mono text-[9px] font-bold text-zinc-300 outline-none cursor-pointer"
                >
                  <option value="UPI">{t('paymentUpi')}</option>
                  <option value="CASH">{t('paymentCash')}</option>
                  <option value="CREDIT CARD">{t('paymentCreditCard')}</option>
                  <option value="WALLET">{t('paymentWalletOption')}</option>
                </select>
              </div>

              {/* Dynamic Surge Matrix Banner */}
              {surgeMultiplier > 1.0 && (
                <div className="bg-amber-950/80 border border-amber-900 text-amber-200 p-3 rounded-xl font-mono text-[9px] uppercase tracking-wider flex items-center justify-between animate-pulse">
                  <span>{t('surgeActive')}</span>
                  <span className="font-extrabold text-amber-300">{t('surgeMultiplier', { multiplier: surgeMultiplier })}</span>
                </div>
              )}

              {/* Pricing breakdown summary */}
              <div className="flex justify-between items-center bg-zinc-950 border border-zinc-900 p-4 rounded-xl font-mono text-xs border-dashed">
                <div>
                  <span className="text-zinc-500 block text-[8px] uppercase">{t('estimatedFareLabel')}</span>
                  <span className="text-2xl font-bold text-white block mt-0.5">
                    {isQuoteLoading ? t('fareCalculating') : `₹${estimatedFare.toFixed(2)}`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => alert(t('billingBreakdown', { surge: surgeMultiplier, promo: promoApplied === 'SUCCESS' ? '₹100' : '₹0', care: d4mCareEnabled ? '₹49' : '₹0' }))}
                  className="text-zinc-500 hover:text-white text-[8px] font-bold uppercase tracking-wider block"
                >
                  {t('breakdownButton')}
                </button>
              </div>

              {/* ==================== SLIDE TO CONFIRM DISPATCH GESTURE WIDGET ==================== */}
              <div 
                ref={sliderTrackRef}
                className="relative w-full h-16 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center overflow-hidden select-none"
              >
                {/* Drag progress highlight background */}
                <div 
                  className="absolute left-0 top-0 bottom-0 bg-emerald-500/20 transition-all"
                  style={{ width: `${slideX + 28}px` }}
                />

                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-400 pointer-events-none z-10">
                  {isSliding ? t('slideToConfirm') : t('slideToBookPilot')}
                </span>

                <div
                  onPointerDown={handleSliderPointerDown}
                  onPointerMove={handleSliderPointerMove}
                  onPointerUp={handleSliderPointerUp}
                  style={{ transform: `translateX(${slideX}px)` }}
                  className="absolute left-2 w-12 h-12 bg-white hover:bg-zinc-200 text-black rounded-xl flex items-center justify-center cursor-grab active:cursor-grabbing shadow-lg z-20 transition-colors"
                >
                  <span className="text-lg font-bold">➔</span>
                </div>
              </div>
            </div>
          )}

          {/* ==================== STATE D: EXPANDED_FULL (95vh - 100vh) ==================== */}
          {sheetHeight > 95 && (
            <div className="space-y-5 animate-fadeIn">
              <div className="flex justify-between items-center border-b border-zinc-900 pb-3">
                <h3 className="text-sm font-mono font-bold uppercase text-white">{t('oneTimeCarConfigHeading')}</h3>
                <button
                  type="button"
                  onClick={() => setSheetHeight(85)}
                  className="text-xs text-zinc-500 hover:text-white uppercase font-bold"
                >
                  {t('cancelButton')}
                </button>
              </div>

              <form onSubmit={handleBindOneTimeCar} className="space-y-4 font-sans text-xs">
                {oneTimeError && (
                  <div className="bg-red-950/60 border border-red-900 text-red-200 p-3 rounded-lg font-mono text-[9px] uppercase">
                    {oneTimeError}
                  </div>
                )}

                <div className="space-y-3">
                  <div>
                    <label className="block text-[8px] uppercase font-bold text-zinc-500 mb-1 font-mono">{t('manufacturerMakeLabel')}</label>
                    <input
                      type="text"
                      value={oneTimeMake}
                      onChange={(e) => setOneTimeMake(e.target.value)}
                      placeholder={t('manufacturerMakePlaceholder')}
                      className="w-full bg-zinc-950 border border-zinc-850 rounded-lg p-2.5 text-white outline-none focus:border-zinc-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[8px] uppercase font-bold text-zinc-500 mb-1 font-mono">{t('modelNameLabel')}</label>
                    <input
                      type="text"
                      value={oneTimeModel}
                      onChange={(e) => setOneTimeModel(e.target.value)}
                      placeholder={t('modelNamePlaceholder')}
                      className="w-full bg-zinc-950 border border-zinc-850 rounded-lg p-2.5 text-white outline-none focus:border-zinc-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 font-mono text-xs">
                    <div>
                      <label className="block text-[8px] uppercase font-bold text-zinc-500 mb-1">{t('transmissionLabel')}</label>
                      <select
                        value={oneTimeTransmission}
                        onChange={(e) => setOneTimeTransmission(e.target.value as any)}
                        className="w-full bg-zinc-950 border border-zinc-850 rounded-lg p-2.5 text-zinc-300 outline-none"
                      >
                        <option value="AUTOMATIC">AUTOMATIC</option>
                        <option value="MANUAL">MANUAL</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[8px] uppercase font-bold text-zinc-500 mb-1">{t('pricingTierLabel')}</label>
                      <select
                        value={oneTimeTier}
                        onChange={(e) => setOneTimeTier(e.target.value as any)}
                        className="w-full bg-zinc-950 border border-zinc-850 rounded-lg p-2.5 text-zinc-300 outline-none"
                      >
                        <option value="HATCHBACK">HATCHBACK</option>
                        <option value="PREMIUM_SUV">PREMIUM_SUV</option>
                        <option value="ULTRA_LUXURY">ULTRA_LUXURY</option>
                      </select>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-white text-black font-mono font-bold text-[10px] py-3.5 rounded-xl uppercase tracking-wider hover:bg-zinc-200 mt-2"
                >
                  {t('bindOverrideButton')}
                </button>
              </form>
            </div>
          )}

        </div>

        <footer className="bg-black py-2.5 text-center text-[7px] font-mono text-zinc-700 border-t border-zinc-950 select-none">
          {t('footerShard', { shard: currentCity.toUpperCase() })}
        </footer>
      </div>

      {/* ==================== SOS SAFETY INCIDENT OVERLAY PANEL ==================== */}
      {showSosModal && (
        <div className="fixed inset-0 z-[999999] bg-red-950/95 backdrop-blur-md flex flex-col justify-center items-center p-6 text-center animate-fadeIn">
          <div className="max-w-md space-y-6">
            <span className="text-5xl block animate-bounce">🚨</span>
            <h2 className="text-3xl font-extrabold tracking-tight text-white font-mono uppercase">{t('emergencySosLockout')}</h2>
            <p className="text-red-200 text-xs leading-relaxed font-mono">
              {t('sosModalDescription', { name: riderName })}
            </p>
            <div className="flex gap-4 max-w-xs mx-auto">
              <button
                type="button"
                onClick={() => setShowSosModal(false)}
                className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 py-3 rounded-full text-xs font-bold uppercase tracking-wider transition cursor-pointer"
              >
                {t('cancelButton')}
              </button>
              <button
                type="button"
                onClick={triggerSOS}
                className="flex-1 bg-white hover:bg-zinc-200 text-red-600 font-bold py-3 rounded-full text-xs uppercase tracking-wider transition cursor-pointer active:scale-95 animate-pulse"
              >
                {t('dial112Button')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== NAVIGATION HAMBURGER DRAWER PANEL ==================== */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-[99999] flex bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-80 bg-zinc-950 border-r border-zinc-900 h-full flex flex-col justify-between p-6 animate-slideInLeft text-left">
            <div>
              <div className="flex items-center gap-3 border-b border-zinc-900 pb-6 mb-6">
                <div className="h-12 w-12 rounded-xl bg-zinc-900 border border-zinc-850 flex items-center justify-center text-lg">
                  👤
                </div>
                <div>
                  <h4 className="text-sm font-bold tracking-tight text-white">{riderName}</h4>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] text-zinc-500 font-mono">{t('passengerAccount')}</span>
                    <span className="bg-zinc-900 text-emerald-400 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider">
                      {t('verifiedBadge')}
                    </span>
                  </div>
                </div>
              </div>

              <nav className="space-y-1">
                {[
                  { label: t('navBookingHome'), href: '/rider', icon: '🔑' },
                  { label: t('navMyGarage'), href: '/account/garage', icon: '🚗' },
                  { label: t('navTripHistory'), href: '/account/bookings', icon: '📁' },
                  { label: t('navMyProfile'), href: '/account/profile', icon: '👤' },
                  { label: t('navPaymentsMethods'), href: '/account/payments', icon: '💳' },
                  { label: t('navWalletBalance'), href: '/account/wallet', icon: '💼' },
                  { label: t('navPromosRewards'), href: '/account/rewards', icon: '🎁' },
                  { label: t('navReferEarn'), href: '/account/refer', icon: '🏆' },
                  { label: t('navSavedPlaces'), href: '/account/places', icon: '📍' },
                  { label: t('navEmergencyContacts'), href: '/account/emergency', icon: '🛡️' },
                  { label: t('navSupportHelp'), href: '/account/support', icon: '💬' }
                ].map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setIsDrawerOpen(false)}
                    className="flex items-center gap-3 py-2.5 px-3 rounded-lg text-[10px] font-bold text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent hover:border-zinc-850 transition-all font-mono uppercase tracking-wider"
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                ))}
              </nav>
            </div>

            <div className="border-t border-zinc-900 pt-6">
              <button
                type="button"
                onClick={() => {
                  useAuthStore.getState().logout();
                  window.location.href = '/login';
                }}
                className="w-full bg-zinc-900 hover:bg-zinc-850 text-zinc-400 hover:text-white rounded-xl py-3.5 text-[9px] font-bold uppercase tracking-wider transition cursor-pointer font-mono border border-zinc-800"
              >
                {t('logoutButton')}
              </button>
            </div>
          </div>
          <div className="flex-1 cursor-pointer" onClick={() => setIsDrawerOpen(false)} />
        </div>
      )}
    </div>
  );
}
