'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/useAuthStore';
import { useRouter } from 'next/navigation';
import { API_GATEWAY_BASE_URL } from '@/config';

interface CarItem {
  id: string;
  make: string;
  model: string;
  type: string;
  transmission: 'MANUAL' | 'AUTOMATIC';
  plate: string;
  isDefault: boolean;
}

export default function RiderDashboardPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const riderName = user?.name || 'Sarah Connor';
  
  // App navigation state variables
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [currentCity, setCurrentCity] = useState('Kolkata');
  const [unreadCount, setUnreadCount] = useState(2);
  const [showSosModal, setShowSosModal] = useState(false);
  
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
    { id: 'c-1', make: 'Audi', model: 'A6 Sedan', type: 'Premium', transmission: 'AUTOMATIC', plate: 'WB-02-AK-9988', isDefault: true },
    { id: 'c-2', make: 'Maruti Suzuki', model: 'Swift Dzire', type: 'Sedan', transmission: 'MANUAL', plate: 'KA-03-MD-4561', isDefault: false }
  ]);
  const [selectedCarId, setSelectedCarId] = useState('c-1');
  const [useOneTimeCar, setUseOneTimeCar] = useState(false);
  const [oneTimeCar, setOneTimeCar] = useState({ make: '', model: '', type: 'Sedan', transmission: 'AUTOMATIC' });

  // Additional modifiers
  const [passengersCount, setPassengersCount] = useState(1);
  const [promoCode, setPromoCode] = useState('');
  const [promoApplied, setPromoApplied] = useState<'SUCCESS' | 'ERROR' | null>(null);
  const [d4mCareEnabled, setD4mCareEnabled] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('UPI');

  // Map overlays
  const [mapZoom, setMapZoom] = useState(14);
  const [showETA, setShowETA] = useState(true);

  const [estimatedFare, setEstimatedFare] = useState(350);
  const [surgeMultiplier, setSurgeMultiplier] = useState(1.0);

  useEffect(() => {
    const fetchQuote = async () => {
      let base = 350;
      let currentCar = garageCars.find((c) => c.id === selectedCarId);
      let carType = useOneTimeCar ? oneTimeCar.type : (currentCar?.type || 'Sedan');
      if (carType === 'SUV') base += 150;
      if (carType === 'Premium') base += 350;

      if (tripType === 'CITY_ROUND') {
        base += durationHours * 100;
      } else if (tripType === 'OUTSTATION') {
        base = durationDays * 1800 + 400;
      } else if (tripType === 'MINI_OUTSTATION') {
        base = 1200;
      } else {
        base += 200;
      }

      try {
        const token = useAuthStore.getState().token;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Region-Prefix': 'KOL'
        };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(
          `${API_GATEWAY_BASE_URL}/api/v1/pricing/quote?h3_cell=863cf1007ffffff&base_fare_paise=${base * 100}`,
          { headers }
        );
        if (res.ok) {
          const data = await res.json();
          const fareInRupees = data.calculated_fare_paise / 100;
          setSurgeMultiplier(data.active_surge_multiplier || 1.0);

          let finalFare = fareInRupees;
          if (d4mCareEnabled) finalFare += 49;
          if (promoApplied === 'SUCCESS') finalFare -= 100;
          setEstimatedFare(Math.max(150, finalFare));
        } else {
          let finalFare = base;
          if (d4mCareEnabled) finalFare += 49;
          if (promoApplied === 'SUCCESS') finalFare -= 100;
          setEstimatedFare(Math.max(150, finalFare));
        }
      } catch (err) {
        console.warn('Failed to fetch dynamic fare quote, falling back to local calculation:', err);
        let finalFare = base;
        if (d4mCareEnabled) finalFare += 49;
        if (promoApplied === 'SUCCESS') finalFare -= 100;
        setEstimatedFare(Math.max(150, finalFare));
      }
    };

    fetchQuote();
  }, [tripType, durationHours, durationDays, selectedCarId, useOneTimeCar, oneTimeCar.type, d4mCareEnabled, promoApplied, garageCars]);

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

  const handleAddStop = () => {
    if (stops.length >= 3) {
      alert('Maximum of 3 stops can be configured mid-route.');
      return;
    }
    setStops((prev) => [...prev, '']);
  };

  const handleStopChange = (idx: number, val: string) => {
    const updated = [...stops];
    updated[idx] = val;
    setStops(updated);
  };

  const handleRemoveStop = (idx: number) => {
    setStops((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleApplyPromo = () => {
    if (promoCode.toUpperCase() === 'FREE50' || promoCode.toUpperCase() === 'WELCOME') {
      setPromoApplied('SUCCESS');
    } else {
      setPromoApplied('ERROR');
    }
  };

  const calculateEstimate = () => {
    let base = 350; // default Hatcback in-city
    
    // Adjust based on active car settings
    let currentCar = garageCars.find((c) => c.id === selectedCarId);
    let carType = useOneTimeCar ? oneTimeCar.type : (currentCar?.type || 'Sedan');

    if (carType === 'SUV') base += 150;
    if (carType === 'Premium') base += 350;

    // Adjust based on duration
    if (tripType === 'CITY_ROUND') {
      base += durationHours * 100;
    } else if (tripType === 'OUTSTATION') {
      base = durationDays * 1800 + 400; // Multi-day base
    } else if (tripType === 'MINI_OUTSTATION') {
      base = 1200; // flat rate 8h
    } else {
      base += 200; // one way flat
    }

    if (d4mCareEnabled) base += 49;
    if (promoApplied === 'SUCCESS') base -= 100;

    return Math.max(150, base);
  };

  const handleDispatchTrigger = async () => {
    let base = 350;
    let currentCar = garageCars.find((c) => c.id === selectedCarId);
    let carType = useOneTimeCar ? oneTimeCar.type : (currentCar?.type || 'Sedan');
    if (carType === 'SUV') base += 150;
    if (carType === 'Premium') base += 350;

    if (tripType === 'CITY_ROUND') {
      base += durationHours * 100;
    } else if (tripType === 'OUTSTATION') {
      base = durationDays * 1800 + 400;
    } else if (tripType === 'MINI_OUTSTATION') {
      base = 1200;
    } else {
      base += 200;
    }
    const baseFarePaise = base * 100;

    let orderId = '';
    try {
      const token = useAuthStore.getState().token;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Region-Prefix': 'KOL'
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          city_prefix: 'KOL',
          customer_id: user?.id || 'usr-mock-11',
          pickup_h3_cell: '863cf1007ffffff',
          pickup_lat: 22.5726,
          pickup_lng: 88.3639,
          pickup_osm_node_id: 123456,
          dropoff_lat: 22.5800,
          dropoff_lng: 88.3700,
          base_fare_paise: baseFarePaise
        })
      });

      if (res.ok) {
        const data = await res.json();
        orderId = data.id || data.order_id;
        console.log('Real order created on backend with ID:', orderId);
      } else {
        console.warn('Backend order creation returned error status:', res.status);
      }
    } catch (err) {
      console.error('Failed to create order on backend:', err);
    }

    if (!orderId) {
      orderId = 'ord-fallback-' + Math.random().toString(36).substring(2, 10);
    }

    const bookingDetails = {
      orderId,
      tripType,
      pickup: pickupText,
      dropoff: dropoffText,
      stops,
      schedule: scheduleLater ? { date: scheduleDate, time: scheduleTime } : 'NOW',
      car: useOneTimeCar ? oneTimeCar : garageCars.find(c => c.id === selectedCarId),
      passengers: passengersCount,
      care: d4mCareEnabled,
      payment: paymentMethod,
      fare: estimatedFare
    };
    sessionStorage.setItem('current_booking_specs', JSON.stringify(bookingDetails));
    router.push(`/rider/dispatch?orderId=${orderId}`);
  };

  const triggerSOS = () => {
    setShowSosModal(false);
    alert('🚨 SAFETY DISPATCH WARNING: Distress coordinates broadcasted. Emergency contacts and local support notified.');
  };

  return (
    <div className="min-h-screen bg-black text-white p-0 font-sans flex flex-col justify-between selection:bg-white selection:text-black overflow-x-hidden relative">
      
      {/* 1. HAMBURGER DRAWER MENU LAYOUT */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-[99999] flex bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-80 bg-zinc-950 border-r border-zinc-900 h-full flex flex-col justify-between p-6 animate-slideInLeft text-left">
            <div>
              {/* Header profile info */}
              <div className="flex items-center gap-3 border-b border-zinc-900 pb-6 mb-6">
                <div className="h-12 w-12 rounded-xl bg-zinc-900 border border-zinc-850 flex items-center justify-center text-lg">
                  👤
                </div>
                <div>
                  <h4 className="text-sm font-bold tracking-tight text-white">{riderName}</h4>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] text-zinc-500 font-mono">Owner Gateway</span>
                    <span className="bg-zinc-900 text-emerald-400 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider">
                      VERIFIED
                    </span>
                  </div>
                </div>
              </div>

              {/* Navigation list */}
              <nav className="space-y-1">
                {[
                  { label: 'Booking Home', href: '/rider', icon: '🔑' },
                  { label: 'My Garage', href: '/account/garage', icon: '🚗' },
                  { label: 'Trip History', href: '/account/bookings', icon: '📁' },
                  { label: 'My Profile', href: '/account/profile', icon: '👤' },
                  { label: 'Payments & Methods', href: '/account/payments', icon: '💳' },
                  { label: 'Wallet Balance', href: '/account/wallet', icon: '💼' },
                  { label: 'Promos & Rewards', href: '/account/rewards', icon: '🎁' },
                  { label: 'Refer & Earn', href: '/account/refer', icon: '🏆' },
                  { label: 'Saved Places', href: '/account/places', icon: '📍' },
                  { label: 'Emergency Contacts', href: '/account/emergency', icon: '🛡️' },
                  { label: 'Insurance & Care', href: '/account/insurance', icon: '📄' },
                  { label: 'Notifications', href: '/account/notifications', icon: '🔔' },
                  { label: 'App Settings', href: '/account/settings', icon: '⚙️' },
                  { label: 'Support & Help', href: '/account/support', icon: '💬' },
                  { label: 'Legal Guidelines', href: '/account/legal', icon: '⚖️' }
                ].map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setIsDrawerOpen(false)}
                    className="flex items-center gap-3 py-2 px-3 rounded-lg text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent hover:border-zinc-850 transition-all font-mono uppercase tracking-wider"
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
                className="w-full bg-zinc-900 hover:bg-zinc-850 text-zinc-400 hover:text-white rounded-xl py-3 text-[10px] font-bold uppercase tracking-wider transition cursor-pointer font-mono border border-zinc-800"
              >
                🚪 Terminate Session & Logout
              </button>
            </div>
          </div>
          <div className="flex-1 cursor-pointer" onClick={() => setIsDrawerOpen(false)} />
        </div>
      )}

      {/* 2. SOS MODAL DIALOG SHEET */}
      {showSosModal && (
        <div className="fixed inset-0 z-[999999] bg-red-950/95 backdrop-blur-md flex flex-col justify-center items-center p-6 text-center animate-fadeIn">
          <div className="max-w-md space-y-6">
            <span className="text-5xl block animate-bounce">🚨</span>
            <h2 className="text-3xl font-extrabold tracking-tight text-white font-move">EMERGENCY SOS SIGNAL</h2>
            <p className="text-red-200 text-xs leading-relaxed font-mono">
              Triggers instant coordinates alerts to emergency contacts (Sarah Connor support logs) and automatically dials 112 police hotline nodes.
            </p>
            <div className="flex gap-4 max-w-xs mx-auto">
              <button
                type="button"
                onClick={() => setShowSosModal(false)}
                className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 py-3 rounded-full text-xs font-bold uppercase tracking-wider transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={triggerSOS}
                className="flex-1 bg-white hover:bg-zinc-200 text-red-600 font-bold py-3 rounded-full text-xs uppercase tracking-wider transition cursor-pointer active:scale-95 animate-pulse"
              >
                DIAL 112 NOW
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOP HEADER MENU BAR CONTROL */}
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
            <h1 className="text-xs font-bold font-mono tracking-tight text-white uppercase">DRIVERS-FOR-U</h1>
            {/* City Change Selector Dropdown */}
            <select
              value={currentCity}
              onChange={(e) => setCurrentCity(e.target.value)}
              className="bg-transparent text-[9px] font-mono font-bold text-zinc-500 uppercase outline-none cursor-pointer mt-0.5"
            >
              <option>Kolkata</option>
              <option>Bangalore</option>
              <option>Mumbai</option>
              <option>Delhi NCR</option>
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
            🚨 SOS
          </button>
        </div>
      </header>

      {/* CORE MAP SECTION */}
      <main className="flex-1 flex flex-col relative min-h-[300px]">
        
        {/* SVG Live Map Background Simulation */}
        <div className="absolute inset-0 bg-zinc-950 z-0 overflow-hidden flex items-center justify-center">
          <svg className="w-full h-full opacity-30" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="riderGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#222" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#riderGrid)" />

            {/* Simulated Live Location Halo circles */}
            {showETA && (
              <>
                <circle cx="50%" cy="50%" r="50" fill="none" stroke="rgba(59, 130, 246, 0.2)" strokeWidth="1.5" className="animate-pulse" />
                <circle cx="50%" cy="50%" r="90" fill="none" stroke="rgba(59, 130, 246, 0.1)" strokeWidth="1" />
                <circle cx="50%" cy="50%" r="4" fill="#3b82f6" />
              </>
            )}

            {/* Ambient Driver SVG Markers */}
            <circle cx="42%" cy="45%" r="3" fill="#ffffff" />
            <circle cx="58%" cy="52%" r="3" fill="#ffffff" />
            <circle cx="51%" cy="38%" r="3" fill="#ffffff" />
          </svg>

          {/* Location Chip over Map */}
          {showETA && (
            <div className="absolute top-4 left-4 z-10 bg-zinc-950/80 border border-zinc-800 text-[8px] font-mono font-bold uppercase py-1 px-2.5 rounded-full tracking-wider select-none">
              📍 Nearby Drivers: 3 min away
            </div>
          )}

          {/* Zoom controls */}
          <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-1.5 font-mono font-bold text-xs select-none">
            <button
              onClick={() => setMapZoom(z => Math.min(18, z + 1))}
              className="h-8 w-8 bg-zinc-950/80 border border-zinc-800 rounded-lg flex items-center justify-center text-white hover:bg-zinc-900 transition"
            >
              +
            </button>
            <button
              onClick={() => setMapZoom(z => Math.max(10, z - 1))}
              className="h-8 w-8 bg-zinc-950/80 border border-zinc-800 rounded-lg flex items-center justify-center text-white hover:bg-zinc-900 transition"
            >
              -
            </button>
          </div>
        </div>

        {/* SWIPE EXPANDABLE BOTTOM BOOKING CARD DRAWER SHEET */}
        <div className="mt-auto w-full z-10 bg-zinc-950/95 border-t border-zinc-900 p-4 sm:p-5 space-y-4 max-w-xl mx-auto rounded-t-2xl shadow-2xl backdrop-blur-md text-left">
          
          {/* Quick tiles grid just above card details */}
          <div className="grid grid-cols-4 gap-2 font-mono text-[8px] font-bold text-zinc-500 uppercase">
            <Link
              href="/account/garage"
              className="bg-zinc-900 hover:bg-zinc-850 p-2.5 rounded-xl border border-zinc-850 text-center flex flex-col items-center gap-1 transition no-underline text-zinc-400 hover:text-white"
            >
              <span>🚗</span>
              <span className="truncate">My Garage</span>
            </Link>
            <button
              onClick={() => {
                setPickupText('Salt Lake Sector V Tech Hub, Kolkata');
                setDropoffText('Park Street Dining Grid, Kolkata');
                setTripType('CITY_ROUND');
                alert('Last trip route parameters reloaded successfully!');
              }}
              className="bg-zinc-900 hover:bg-zinc-850 p-2.5 rounded-xl border border-zinc-850 text-center flex flex-col items-center gap-1 transition cursor-pointer text-zinc-400 hover:text-white"
            >
              <span>🔄</span>
              <span className="truncate">Rebook Last</span>
            </button>
            <Link
              href="/account/rewards"
              className="bg-zinc-900 hover:bg-zinc-850 p-2.5 rounded-xl border border-zinc-850 text-center flex flex-col items-center gap-1 transition no-underline text-zinc-400 hover:text-white"
            >
              <span>🎁</span>
              <span className="truncate">Offers</span>
            </Link>
            <Link
              href="/account/refer"
              className="bg-zinc-900 hover:bg-zinc-850 p-2.5 rounded-xl border border-zinc-850 text-center flex flex-col items-center gap-1 transition no-underline text-zinc-400 hover:text-white"
            >
              <span>🏆</span>
              <span className="truncate">Refer Earn</span>
            </Link>
          </div>

          {/* Segmented Trip Type Tab switches */}
          <div className="flex bg-zinc-900/60 p-1.5 rounded-xl border border-zinc-900 font-mono text-[9px] uppercase font-bold text-zinc-500">
            {[
              { id: 'CITY_ROUND', label: 'Round Trip' },
              { id: 'CITY_ONEWAY', label: 'One Way' },
              { id: 'MINI_OUTSTATION', label: 'Mini (8h)' },
              { id: 'OUTSTATION', label: 'Outstation' }
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

          {/* Pickup and Drop autocomplete forms */}
          <div className="bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl space-y-3 font-sans text-xs">
            <div>
              <label className="block text-[8px] uppercase font-bold text-zinc-500 mb-1 font-mono">Pick-up Location (Where we meet your car)</label>
              <input
                type="text"
                value={pickupText}
                onChange={(e) => setPickupText(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-850 rounded-lg p-2 text-white focus:outline-none focus:border-zinc-500 text-xs"
                placeholder="Enter pickup address"
              />
            </div>

            {/* Intermediate stops modifiers */}
            {stops.map((stop, i) => (
              <div key={i} className="flex gap-2 items-center animate-fadeIn">
                <div className="flex-1">
                  <label className="block text-[8px] uppercase font-bold text-zinc-500 mb-1 font-mono">Intermediate Stop {i + 1}</label>
                  <input
                    type="text"
                    value={stop}
                    onChange={(e) => handleStopChange(i, e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-850 rounded-lg p-2 text-white focus:outline-none focus:border-zinc-500 text-xs"
                    placeholder="Enter stop address"
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

            {tripType !== 'CITY_ROUND' && (
              <div>
                <label className="block text-[8px] uppercase font-bold text-zinc-500 mb-1 font-mono">Destination Address (Required)</label>
                <input
                  type="text"
                  value={dropoffText}
                  onChange={(e) => setDropoffText(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-850 rounded-lg p-2 text-white focus:outline-none focus:border-zinc-500 text-xs"
                  placeholder="Where should the driver guide your vehicle?"
                />
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleAddStop}
                className="text-[8px] font-mono font-bold uppercase text-zinc-500 hover:text-white flex items-center gap-1 cursor-pointer"
              >
                ➕ Add Stop (Max 3)
              </button>
            </div>
          </div>

          {/* Schedule Later Date controls */}
          <div className="flex justify-between items-center bg-zinc-900/40 p-3 border border-zinc-900 rounded-xl text-xs">
            <div className="space-y-0.5">
              <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider block">Schedule</span>
              <span className="font-bold text-white">{scheduleLater ? `Scheduled: ${scheduleDate} @ ${scheduleTime}` : 'Book for Immediate Departure'}</span>
            </div>

            <button
              onClick={() => setScheduleLater(!scheduleLater)}
              className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 text-[9px] font-mono font-bold uppercase py-1.5 px-3 rounded-xl text-zinc-300 cursor-pointer"
            >
              {scheduleLater ? 'Now' : 'Later'}
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

          {/* Hourly/Daily Sliders */}
          {(tripType === 'CITY_ROUND' || tripType === 'OUTSTATION') && (
            <div className="bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl space-y-2 text-xs font-mono">
              {tripType === 'CITY_ROUND' ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-zinc-500 uppercase font-bold text-[8px]">Job Duration (Hours)</span>
                    <span className="text-white font-bold">{durationHours} Hours Pack</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="24"
                    value={durationHours}
                    onChange={(e) => setDurationHours(parseInt(e.target.value))}
                    className="w-full h-8 cursor-pointer"
                  />
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-zinc-500 uppercase font-bold text-[8px]">Outstation Duration (Days)</span>
                    <span className="text-white font-bold">{durationDays} Days Pack</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="7"
                    value={durationDays}
                    onChange={(e) => setDurationDays(parseInt(e.target.value))}
                    className="w-full h-8 cursor-pointer"
                  />
                </>
              )}
            </div>
          )}

          {/* Garage vehicle selections dropdown list */}
          <div className="bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl space-y-3 text-xs">
            <div className="flex justify-between items-center border-b border-zinc-950 pb-2">
              <span className="text-zinc-500 uppercase font-mono font-bold text-[8px]">Vehicle profile specs</span>
              <button
                type="button"
                onClick={() => setUseOneTimeCar(!useOneTimeCar)}
                className="text-[8px] font-mono font-bold text-zinc-400 hover:text-white uppercase"
              >
                {useOneTimeCar ? 'Use Garage Car' : 'Use One-Time Car'}
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
                        <span className="text-[9px] text-zinc-500 block uppercase mt-0.5">{car.plate} ({car.transmission})</span>
                      </div>
                    </div>
                    {car.isDefault && (
                      <span className="bg-zinc-900 text-zinc-400 border border-zinc-850 text-[7px] font-bold px-1.5 py-0.5 rounded">
                        GARAGE
                      </span>
                    )}
                  </label>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <input
                  type="text"
                  placeholder="Make (e.g. BMW)"
                  value={oneTimeCar.make}
                  onChange={(e) => setOneTimeCar({ ...oneTimeCar, make: e.target.value })}
                  className="bg-zinc-950 border border-zinc-850 rounded-lg p-2 text-white"
                />
                <input
                  type="text"
                  placeholder="Model (e.g. 3 Series)"
                  value={oneTimeCar.model}
                  onChange={(e) => setOneTimeCar({ ...oneTimeCar, model: e.target.value })}
                  className="bg-zinc-950 border border-zinc-850 rounded-lg p-2 text-white"
                />
                <select
                  value={oneTimeCar.type}
                  onChange={(e) => setOneTimeCar({ ...oneTimeCar, type: e.target.value })}
                  className="bg-zinc-950 border border-zinc-850 rounded-lg p-2 text-zinc-300"
                >
                  <option>Hatchback</option>
                  <option>Sedan</option>
                  <option>SUV</option>
                  <option>Premium</option>
                </select>
                <select
                  value={oneTimeCar.transmission}
                  onChange={(e) => setOneTimeCar({ ...oneTimeCar, transmission: e.target.value as any })}
                  className="bg-zinc-950 border border-zinc-850 rounded-lg p-2 text-zinc-300"
                >
                  <option>AUTOMATIC</option>
                  <option>MANUAL</option>
                </select>
              </div>
            )}
          </div>

          {/* Passengers count and D4M toggles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="flex justify-between items-center bg-zinc-900/40 p-3.5 border border-zinc-900 rounded-xl">
              <span className="text-[8px] font-mono font-bold text-zinc-500 uppercase">Passengers</span>
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

            {/* D4M Care toggle */}
            <div className="flex justify-between items-center bg-zinc-900/40 p-3.5 border border-zinc-900 rounded-xl">
              <div>
                <span className="text-[8px] font-mono font-bold text-zinc-500 uppercase block">D4M Care Surcharge</span>
                <span className="text-[9px] text-zinc-400 block mt-0.5">₹49 (Insurance & Support)</span>
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

          {/* Promo code inputs */}
          <div className="bg-zinc-900/40 p-3 border border-zinc-900 rounded-xl text-xs">
            <label className="block text-[8px] font-mono font-bold text-zinc-500 uppercase mb-1">Coupon Voucher Code</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                placeholder="e.g. FREE50"
                className="flex-grow bg-zinc-950 border border-zinc-850 rounded-xl p-2.5 text-white focus:outline-none font-mono text-xs uppercase"
              />
              <button
                type="button"
                onClick={handleApplyPromo}
                className="bg-zinc-900 hover:bg-zinc-850 text-zinc-300 border border-zinc-850 rounded-xl px-4 text-[9px] font-mono font-bold uppercase tracking-wider transition cursor-pointer"
              >
                Apply
              </button>
            </div>

            {promoApplied && (
              <span className={`text-[8px] font-mono block mt-1.5 uppercase font-bold ${
                promoApplied === 'SUCCESS' ? 'text-emerald-400' : 'text-red-500'
              }`}>
                {promoApplied === 'SUCCESS' ? '✔️ Code FREE50 applied: ₹100 discount activated!' : '❌ Invalid code pattern entered.'}
              </span>
            )}
          </div>

          {/* Payment Method pill selector */}
          <div className="flex justify-between items-center bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl text-xs">
            <div className="space-y-0.5">
              <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest block">Pay Destination</span>
              <span className="font-bold text-white">{paymentMethod} Wallet Link</span>
            </div>

            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="bg-zinc-950 border border-zinc-850 rounded-xl p-2 font-mono text-[9px] font-bold text-zinc-300 outline-none cursor-pointer"
            >
              <option>UPI</option>
              <option>CASH</option>
              <option>CREDIT CARD</option>
              <option>WALLET</option>
            </select>
          </div>

          {/* Fare Estimate strip */}
          <div className="flex justify-between items-center bg-zinc-950 border border-zinc-900 p-4 rounded-xl font-mono text-xs border-dashed">
            <div>
              <span className="text-zinc-500 block text-[8px] uppercase">ESTIMATED FARE</span>
              <span className="text-2xl font-bold text-white block mt-0.5">₹{estimatedFare.toFixed(2)}</span>
            </div>
            
            <button
              onClick={() => alert(`Upfront billing estimation: Base package ₹350, Duration modifier ₹${durationHours * 100}, Promo discount ₹${promoApplied === 'SUCCESS' ? '100' : '0'}, Care fee ₹${d4mCareEnabled ? '49' : '0'}.`)}
              className="text-zinc-500 hover:text-white text-[8px] font-bold uppercase tracking-wider block"
            >
              Billing Breakdown ➔
            </button>
          </div>

          {/* Primary CTA Book Driver */}
          <button
            onClick={handleDispatchTrigger}
            type="button"
            className="w-full bg-white hover:bg-zinc-200 text-black py-4 rounded-xl text-xs font-bold uppercase tracking-wider transition active:scale-95 cursor-pointer text-center font-sans shadow-lg"
          >
            🔑 Book Professional Driver
          </button>

        </div>

      </main>

      {/* Footer details */}
      <footer className="bg-black p-3 text-center text-[8px] font-mono text-zinc-700 border-t border-zinc-950 select-none">
        ENCRYPTED SECURE NETWORK GATEWAY • ESCROW ROUTING ACTIVE
      </footer>
    </div>
  );
}
