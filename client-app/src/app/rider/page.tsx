'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ClientCoreEngine } from '../../network/ClientCoreEngine';
import { SlideToConfirm } from '../../components/SlideToConfirm';

interface PriceQuoteResponse {
  estimated_fare_paise: number;
  surge_multiplier: number;
  distance_meters: number;
  duration_seconds: number;
  currency: string;
}

interface PlacePrediction {
  description: string;
  place_id: string;
}

export default function RiderBookingPage() {
  const engineRef = useRef(new ClientCoreEngine('KOL', 'http://localhost:8080'));
  
  // Geographic State Machine Boundaries
  const [pickupText, setPickupText] = useState<string>('');
  const [dropoffText, setDropoffText] = useState<string>('');
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Address Autocomplete UI Lists
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [activeSearchTarget, setActiveSearchTarget] = useState<'PICKUP' | 'DROPOFF' | null>(null);

  // Car Asset Constraints Mapped Directly to Backend Kuhn-Munkres Match Match Loops
  const [transmission, setTransmission] = useState<'MANUAL' | 'AUTOMATIC'>('AUTOMATIC');
  const [vehicleTier, setVehicleTier] = useState<'HATCHBACK' | 'PREMIUM_SUV' | 'ULTRA_LUXURY'>('PREMIUM_SUV');

  // Transaction States
  const [priceQuote, setPriceQuote] = useState<PriceQuoteResponse | null>(null);
  const [isEstimating, setIsEstimating] = useState<boolean>(false);
  const [isBooking, setIsBooking] = useState<boolean>(false);
  const [bookingLog, setBookingLog] = useState<{ status: 'SUCCESS' | 'ERROR'; message: string } | null>(null);

  // Trigger pricing quote evaluation whenever coordinates or vehicle parameters mutate
  useEffect(() => {
    if (pickupCoords && dropoffCoords) {
      executeFetchUpfrontQuote();
    }
  }, [pickupCoords, dropoffCoords, transmission, vehicleTier]);

  // Simulate Google Places Autocomplete Engine Lookup Hooks
  const handleLocationInputChange = (text: string, target: 'PICKUP' | 'DROPOFF') => {
    if (target === 'PICKUP') setPickupText(text);
    else setDropoffText(text);
    
    setActiveSearchTarget(target);

    if (text.trim().length < 3) {
      setPredictions([]);
      return;
    }

    // High-fidelity predictive completions anchor paths mapping locally within Kolkata metro grids
    const mockPlacesLibrary: Record<string, PlacePrediction[]> = {
      'how': [
        { description: 'Howrah Junction Railway Station, Kolkata', place_id: 'pl-hw-01' },
        { description: 'Howrah Bridge Overpass Core, West Bengal', place_id: 'pl-hw-02' }
      ],
      'par': [
        { description: 'Park Street Dining & Corporate Sector, Kolkata', place_id: 'pl-pk-01' },
        { description: 'Park Circus Seven-Point Crossing, Kolkata', place_id: 'pl-pk-02' }
      ],
      'sal': [
        { description: 'Salt Lake Sector V Tech Hub, Bidhannagar', place_id: 'pl-sl-01' },
        { description: 'Salt Lake Central Park Metro Boundary, Kolkata', place_id: 'pl-sl-02' }
      ]
    };

    const tokenSearchKey = text.toLowerCase().slice(0, 3);
    setPredictions(mockPlacesLibrary[tokenSearchKey] || [
      { description: `${text} Main Road Intersection, Kolkata`, place_id: `pl-gen-${Date.now()}` }
    ]);
  };

  const handleSelectPrediction = (place: PlacePrediction) => {
    // Deterministic mock lat/lng resolution boundaries to supply our Directions API wrappers safely
    let assignedLat = 22.5726;
    let assignedLng = 88.3639;

    if (place.place_id.includes('hw')) { assignedLat = 22.5855; assignedLng = 88.3411; }
    else if (place.place_id.includes('pk')) { assignedLat = 22.5487; assignedLng = 88.3561; }
    else if (place.place_id.includes('sl')) { assignedLat = 22.5731; assignedLng = 88.4332; }

    if (activeSearchTarget === 'PICKUP') {
      setPickupText(place.description);
      setPickupCoords({ lat: assignedLat, lng: assignedLng });
    } else {
      setDropoffText(place.description);
      setDropoffCoords({ lat: assignedLat + 0.015, lng: assignedLng + 0.015 }); // Guarantee spatial offset displacement
    }

    setPredictions([]);
    setActiveSearchTarget(null);
  };

  const executeFetchUpfrontQuote = async () => {
    if (!pickupCoords || !dropoffCoords) return;
    setIsEstimating(true);
    setBookingLog(null);

    try {
      // Access backend gateway via our client core network manager wrapper engine
      const data = await engineRef.current.executeRequest<PriceQuoteResponse>({
        method: 'POST',
        path: '/api/v1/orders/quote',
        body: {
          pickup_latitude: pickupCoords.lat,
          pickup_longitude: pickupCoords.lng,
          dropoff_latitude: dropoffCoords.lat,
          dropoff_longitude: dropoffCoords.lng,
          transmission_requirement: transmission,
          asset_tier: vehicleTier,
        },
      });
      setPriceQuote(data);
    } catch (err) {
      console.error('Upfront calculation handshake failure, using failover parameters:', err);
      // Failover static baseline estimation tracking for network sandbox environments
      setPriceQuote({
        estimated_fare_paise: vehicleTier === 'ULTRA_LUXURY' ? 98000 : vehicleTier === 'PREMIUM_SUV' ? 62000 : 35000,
        surge_multiplier: 1.2,
        distance_meters: 8400,
        duration_seconds: 1440,
        currency: 'INR',
      });
    } finally {
      setIsEstimating(false);
    }
  };

  const handleBookingExecutionCommit = async () => {
    if (!pickupCoords || !dropoffCoords || !priceQuote) return;
    setIsBooking(true);
    setBookingLog(null);

    try {
      // Execute demand commit using the X-Idempotency-Key guard rule configuration pattern
      const data = await engineRef.current.executeRequest<{ order_id: string; status: string }>({
        method: 'POST',
        path: '/api/v1/orders',
        body: {
          pickup_address: pickupText,
          pickup_latitude: pickupCoords.lat,
          pickup_longitude: pickupCoords.lng,
          dropoff_address: dropoffText,
          dropoff_latitude: dropoffCoords.lat,
          dropoff_longitude: dropoffCoords.lng,
          transmission_requirement: transmission,
          asset_tier: vehicleTier,
          quoted_fare_paise: priceQuote.estimated_fare_paise,
        },
        useIdempotency: true, // Core Security Check: Reuses same fingerprint token across retry sweeps
        maxAttempts: 3,
      });

      setBookingLog({
        status: 'SUCCESS',
        message: `Trip request registered cleanly! Dispatch Matrix Order UUID: ${data.order_id.slice(0, 13)}... Seeking professional operator match.`,
      });
    } catch (err) {
      setBookingLog({
        status: 'ERROR',
        message: 'Order submission rejected by gateway network sanity checks.',
      });
    } finally {
      setIsBooking(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-black p-4 sm:p-8 font-sans flex flex-col justify-between selection:bg-black selection:text-white">
      {/* Platform Sub-Header Context Navigation Menu */}
      <header className="border-b border-zinc-100 pb-4 mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight font-move">Hire Professional Pilot</h1>
          <p className="text-[10px] text-zinc-400 uppercase font-mono tracking-wider font-bold mt-0.5"> Demand Terminal (Hub: Kol)</p>
        </div>
        <a href="/" className="text-xs font-bold uppercase tracking-wider border border-zinc-200 px-4 py-2 rounded-full hover:bg-zinc-50 transition">
          ← Cancel
        </a>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-8 flex-grow">
        {/* Left Input Fields Section (3/5 Columns) */}
        <div className="md:col-span-3 space-y-5 text-left">
          
          {/* Spatial Address Autocomplete Inputs Container Box */}
          <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-5 space-y-4 relative">
            <h3 className="text-[10px] uppercase font-bold tracking-wider text-zinc-400">Route Specifications</h3>
            
            {/* Pickup Node Field */}
            <div className="relative">
              <label className="block text-[9px] uppercase tracking-wide font-bold text-zinc-500 mb-1">Pick-Up Address (Your Car's Location)</label>
              <input
                type="text"
                className="w-full bg-white border border-zinc-200 rounded-xl p-3 text-xs text-black focus:outline-none focus:border-black font-medium"
                placeholder="Type 'Howrah', 'Park Street', or 'Salt Lake'..."
                value={pickupText}
                onChange={(e) => handleLocationInputChange(e.target.value, 'PICKUP')}
                disabled={isBooking}
              />
            </div>

            {/* Dropoff Node Field */}
            <div className="relative">
              <label className="block text-[9px] uppercase tracking-wide font-bold text-zinc-500 mb-1">Destination Address</label>
              <input
                type="text"
                className="w-full bg-white border border-zinc-200 rounded-xl p-3 text-xs text-black focus:outline-none focus:border-black font-medium"
                placeholder="Where should the pilot guide your vehicle?"
                value={dropoffText}
                onChange={(e) => handleLocationInputChange(e.target.value, 'DROPOFF')}
                disabled={isBooking}
              />
            </div>

            {/* Autocomplete Predictions Dropdown Panel */}
            {predictions.length > 0 && (
              <div className="absolute left-5 right-5 bg-white border border-zinc-200 rounded-xl shadow-xl z-50 overflow-hidden divide-y divide-zinc-100">
                {predictions.map((place) => (
                  <button
                    key={place.place_id}
                    type="button"
                    onClick={() => handleSelectPrediction(place)}
                    className="w-full text-left px-4 py-3 text-xs text-black hover:bg-zinc-50 font-medium transition cursor-pointer"
                  >
                    📍 {place.description}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Customer Owned Vehicle Mechanical Asset Specification Matrix */}
          <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-5 space-y-4">
            <h3 className="text-[10px] uppercase font-bold tracking-wider text-zinc-400">Vehicle Profile Matching Criteria</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Transmission Choice Switches */}
              <div>
                <span className="block text-[9px] uppercase tracking-wide font-bold text-zinc-500 mb-2">Transmission Mechanism</span>
                <div className="flex gap-2">
                  {(['AUTOMATIC', 'MANUAL'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setTransmission(type)}
                      disabled={isBooking}
                      className={`flex-1 py-2.5 text-[10px] font-bold uppercase tracking-wider rounded-xl border transition cursor-pointer ${
                        transmission === type ? 'bg-black border-black text-white' : 'bg-white border-zinc-200 hover:bg-zinc-100 text-black'
                      }`}
                    >
                      {type === 'AUTOMATIC' ? '🕹️ Auto / EV' : '⚙️ Stick Shift'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Asset Class Tier Grid Selectors */}
              <div>
                <span className="block text-[9px] uppercase tracking-wide font-bold text-zinc-500 mb-2">Vehicle Class Classification</span>
                <div className="flex flex-col gap-1.5">
                  {(['HATCHBACK', 'PREMIUM_SUV', 'ULTRA_LUXURY'] as const).map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => setVehicleTier(tier)}
                      disabled={isBooking}
                      className={`w-full text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider rounded-xl border transition cursor-pointer flex justify-between items-center ${
                        vehicleTier === tier ? 'bg-black border-black text-white' : 'bg-white border-zinc-200 hover:bg-zinc-100 text-black'
                      }`}
                    >
                      <span>{tier.replace('_', ' ')}</span>
                      <span className="text-[9px] opacity-60 font-mono">
                        {tier === 'ULTRA_LUXURY' ? 'Premium Imports' : tier === 'PREMIUM_SUV' ? 'Sedans/SUVs' : 'Compact Core'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Right Pricing Summary Section (2/5 Columns) */}
        <div className="md:col-span-2 bg-zinc-50 border border-zinc-200 rounded-2xl p-6 flex flex-col justify-between min-h-[350px]">
          <div className="text-left space-y-4 w-full">
            <h3 className="text-[10px] uppercase font-bold tracking-wider text-zinc-400">Upfront Price Summary</h3>

            {isEstimating ? (
              <div className="py-12 text-center text-xs font-mono text-zinc-400 animate-pulse italic">
                Evaluating physical track road conditions & surge indices...
              </div>
            ) : priceQuote ? (
              <div className="space-y-4 animate-fadeIn w-full">
                {/* Large Currency Price Display Metric */}
                <div className="border-b border-zinc-200/60 pb-3">
                  <span className="text-3xl font-mono font-bold tracking-tighter text-black">
                    ₹{(priceQuote.estimated_fare_paise / 100).toFixed(2)}
                  </span>
                  {priceQuote.surge_multiplier > 1.0 && (
                    <span className="ml-2 inline-block bg-black text-white text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase animate-pulse">
                      Surge {priceQuote.surge_multiplier}x
                    </span>
                  )}
                </div>

                {/* Subtitle Journey Length Analytics Meta Values */}
                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono border-b border-zinc-200/60 pb-3">
                  <div>
                    <span className="text-zinc-400 block uppercase font-bold tracking-tight">Driving Distance</span>
                    <span className="font-bold text-black text-xs mt-0.5 block">{(priceQuote.distance_meters / 1000).toFixed(2)} km</span>
                  </div>
                  <div>
                    <span className="text-zinc-400 block uppercase font-bold tracking-tight">Est. Transit Time</span>
                    <span className="font-bold text-black text-xs mt-0.5 block">{Math.round(priceQuote.duration_seconds / 60)} mins</span>
                  </div>
                </div>

                {/* Compliance Matching Parameter Recaps */}
                <div className="text-[10px] space-y-1 text-zinc-600 font-medium">
                  <div>• Bipartite match constraint: <span className="font-bold text-black font-mono">{transmission} pilot only</span></div>
                  <div>• Escrow routing ledger: <span className="font-bold text-black uppercase font-mono">{vehicleTier} category</span></div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-zinc-400 border border-dashed border-zinc-200 rounded-xl italic px-4">
                Provide pickup and destination coordinates to evaluate live upfront pricing splits.
              </div>
            )}
          </div>

          {/* Interactive Booking Execution Commit Container Layer */}
          <div className="w-full mt-6 space-y-3">
            {priceQuote && !isEstimating && (
              <SlideToConfirm 
                label={isBooking ? "Broadcasting Request..." : "Slide to Hire Pilot"}
                onConfirm={handleBookingExecutionCommit}
                disabled={isBooking}
              />
            )}

            {bookingLog && (
              <div className={`p-4 rounded-xl text-[10px] text-left font-mono font-bold uppercase tracking-wider leading-relaxed ${
                bookingLog.status === 'SUCCESS' ? 'bg-zinc-200 text-black border border-zinc-300' : 'bg-black text-white'
              }`}>
                {bookingLog.message}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
