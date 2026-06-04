'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ResilientStreamManager } from '@/network/ResilientStreamManager';

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

export default function RiderDispatchPage() {
  const router = useRouter();
  
  // Dispatch states: SEARCHING | ASSIGNED | TIMEOUT
  const [matchState, setMatchState] = useState<'SEARCHING' | 'ASSIGNED' | 'TIMEOUT'>('SEARCHING');
  const [countdown, setCountdown] = useState(30); // 30s simulation matching
  const [bookingSpecs, setBookingSpecs] = useState<any>(null);

  useEffect(() => {
    // Read session booking details
    let currentOrderId = '';
    try {
      const specs = JSON.parse(sessionStorage.getItem('current_booking_specs') || '{}');
      setBookingSpecs(specs);
      currentOrderId = specs.orderId || '';
    } catch (e) {}

    if (!currentOrderId) {
      currentOrderId = 'ord-mock-' + Math.random().toString(36).substring(2, 10);
    }

    if (matchState !== 'SEARCHING') return;

    // Establish low-latency connection to binary WebSocket channels
    const stream = new ResilientStreamManager({
      orderID: currentOrderId,
      cityPrefix: 'KOL',
      onStatusChange: (status) => {
        console.log('[RiderDispatch] WS state:', status);
      },
      onMessage: (message: any) => {
        console.log('[RiderDispatch] Stream msg:', message);
        let driverData: any = null;
        if (message instanceof ArrayBuffer) {
          const unpacked = parseBinaryEnvelope(message);
          if (unpacked?.type === 'ASSIGNMENT') {
            driverData = unpacked.data;
          }
        } else if (message?.type === 'order.assigned' || message?.status === 'ASSIGNED' || message?.assigned_driver_id) {
          driverData = message;
        }

        if (driverData) {
          const driverSpecs = {
            id: driverData.assigned_driver_id || driverData.driver_id || 'drv-aniket-7602',
            name: driverData.driver_name || 'Aniket Karmakar',
            rating: driverData.driver_rating ? `★ ${driverData.driver_rating}` : '★ 4.92',
            plate: driverData.vehicle_plate || 'WB-02-AK-9988',
            car: driverData.vehicle_model || 'Audi A6 Sedan',
            eta: '4 mins away'
          };
          sessionStorage.setItem('assigned_driver_specs', JSON.stringify(driverSpecs));
          setMatchState('ASSIGNED');
        }
      }
    });

    stream.connect();

    // Countdown simulation loop
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setMatchState('TIMEOUT');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(timer);
      stream.disconnect();
    };
  }, [matchState]);

  const handleCancelDispatch = () => {
    if (confirm('Cancel looking for drivers? Zero cancellation fee applies before driver assignment matches.')) {
      router.push('/rider');
    }
  };

  const handleRetryDispatch = () => {
    setMatchState('SEARCHING');
    setCountdown(30);
  };

  const handleConfirmLiveTrip = () => {
    // Store mock assigned driver data if not already populated
    if (!sessionStorage.getItem('assigned_driver_specs')) {
      const mockDriver = {
        id: 'drv-aniket-7602',
        name: 'Aniket Karmakar',
        rating: '★ 4.92',
        plate: 'WB-02-AK-9988',
        car: 'Audi A6 Sedan',
        eta: '4 mins away'
      };
      sessionStorage.setItem('assigned_driver_specs', JSON.stringify(mockDriver));
    }
    
    // Redirect to active journey
    const orderId = bookingSpecs?.orderId || 'trp-2209';
    router.push(`/rider/trip/live?tripId=${orderId}`);
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-8 font-sans flex flex-col justify-between selection:bg-white selection:text-black">
      
      {/* Header */}
      <header className="border-b border-zinc-900 pb-4 flex justify-between items-center w-full max-w-md mx-auto text-left">
        <h1 className="text-xs font-bold font-mono text-zinc-500 uppercase tracking-widest">Platform Dispatch Engine</h1>
        <span className="text-[8px] font-mono text-zinc-600 uppercase">STATUS: {matchState}</span>
      </header>

      {/* 1. MATCH SEARCHING CONTROLS */}
      {matchState === 'SEARCHING' && (
        <div className="flex-grow flex flex-col items-center justify-center space-y-8 py-8 animate-fadeIn text-center">
          
          {/* Pulsing Radar Circle */}
          <div className="h-40 w-40 rounded-full border border-zinc-800 flex items-center justify-center relative bg-zinc-950/20">
            <div className="h-28 w-28 rounded-full border border-zinc-700/40 flex items-center justify-center relative animate-pulse">
              <div className="h-16 w-16 rounded-full bg-white/5 border-2 border-dashed border-white flex items-center justify-center animate-spin duration-10000" />
            </div>
            {/* Pulsating animation rings */}
            <div className="absolute inset-0 rounded-full border-2 border-white animate-ping opacity-10 duration-2000" />
            <div className="absolute inset-4 rounded-full border border-white animate-ping opacity-10 duration-1000" />
            <span className="absolute font-mono text-xs font-bold text-white bg-black px-2 py-0.5 rounded border border-zinc-850">
              {countdown}s
            </span>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-bold text-white font-mono uppercase tracking-widest animate-pulse">Finding Driver Partner Near You...</h3>
            <p className="text-[10px] text-zinc-500 max-w-xs mx-auto leading-normal">
              Resolving upfront matching cost metrics. Connecting to supplies streams in {bookingSpecs?.pickup.split(',')[0]}...
            </p>
          </div>

          {/* Booking recap chip */}
          {bookingSpecs && (
            <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-3.5 max-w-xs text-left text-[10px] font-mono text-zinc-400 space-y-1">
              <div>➔ <span className="text-zinc-600 font-bold">TYPE:</span> {bookingSpecs.tripType}</div>
              <div className="truncate">➔ <span className="text-zinc-600 font-bold">FROM:</span> {bookingSpecs.pickup}</div>
              <div className="text-emerald-400 font-bold">➔ <span className="text-zinc-600 font-bold">ESTIMATE:</span> ₹{bookingSpecs.fare.toFixed(2)}</div>
            </div>
          )}

          <button
            onClick={handleCancelDispatch}
            className="bg-zinc-950 hover:bg-zinc-900 border border-zinc-900 text-red-500 hover:text-red-400 py-3.5 px-8 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer active:scale-95"
          >
            Cancel Dispatch Request
          </button>
        </div>
      )}

      {/* 2. DRIVER ASSIGNED POPUP MODAL SHEET */}
      {matchState === 'ASSIGNED' && (
        <div className="flex-grow flex flex-col items-center justify-center max-w-md mx-auto w-full animate-fadeIn text-left pt-6">
          <div className="w-full bg-zinc-950 border border-zinc-900 rounded-2xl p-6 space-y-5">
            
            <div className="text-center border-b border-zinc-900 pb-4 space-y-1">
              <span className="bg-emerald-950/20 text-emerald-400 border border-emerald-900 px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider">
                DRIVER ASSIGNED SUCCESSFULLY
              </span>
              <h3 className="text-lg font-bold text-white font-sans mt-2">Operator En Route to Your Car</h3>
              <p className="text-[10px] text-zinc-500 font-mono">ETA: 4 Mins away (0.8 KM)</p>
            </div>

            {/* Driver Profile */}
            <div className="flex items-center gap-4 bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl">
              <div className="h-16 w-16 bg-zinc-950 rounded-xl flex items-center justify-center text-2xl border border-zinc-800 shrink-0">
                👤
              </div>
              <div className="space-y-1 text-xs">
                <h4 className="font-bold text-white">Aniket Karmakar</h4>
                <div className="flex items-center gap-1.5 font-mono text-[9px]">
                  <span className="text-amber-500">★ 4.92 Rating</span>
                  <span className="text-zinc-600">•</span>
                  <span className="text-zinc-400">412 completed trips</span>
                </div>
                <span className="bg-zinc-950 text-zinc-400 px-2.5 py-0.5 rounded text-[8px] font-mono font-bold border border-zinc-850 uppercase inline-block">
                  Automatic Cert
                </span>
              </div>
            </div>

            {/* Vehicle recap */}
            <div className="bg-zinc-900/40 p-3.5 border border-zinc-900 rounded-xl text-xs font-mono text-zinc-400 leading-normal">
              🚗 <span className="text-zinc-500 font-bold uppercase text-[9px]">YOUR VEHICLE:</span> Driving your Audi A6 Sedan (Plate: WB-02-AK-9988)
            </div>

            {/* Buttons call/chat */}
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <button
                onClick={() => alert('Dialing driver mobile via masked forwarding server...')}
                className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 py-3 rounded-xl font-bold uppercase text-zinc-300 cursor-pointer text-center"
              >
                📞 Call Driver
              </button>
              <button
                onClick={() => alert('Opening dispatcher in-app chat page.')}
                className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 py-3 rounded-xl font-bold uppercase text-zinc-300 cursor-pointer text-center"
              >
                💬 In-App Chat
              </button>
            </div>

            <button
              onClick={handleConfirmLiveTrip}
              className="w-full bg-white hover:bg-zinc-200 text-black py-4 rounded-xl text-xs font-bold uppercase tracking-wider transition active:scale-95 cursor-pointer text-center font-sans mt-2"
            >
              ➔ Open Active Journey Timelines
            </button>
          </div>
        </div>
      )}

      {/* 3. TIMEOUT SCREEN NO DRIVER AVAILABLE */}
      {matchState === 'TIMEOUT' && (
        <div className="flex-grow flex flex-col items-center justify-center space-y-6 animate-fadeIn text-center">
          <span className="text-4xl block">🔍</span>
          <div className="space-y-1.5">
            <h3 className="text-sm font-bold text-white font-mono uppercase tracking-widest">No Driver Available Nearby</h3>
            <p className="text-[10px] text-zinc-500 max-w-xs mx-auto leading-normal">
              High matching costs and traffic surge in Kolkata Sector V area. Adjust booking parameters or retry search sweep.
            </p>
          </div>

          <div className="flex flex-col gap-2 max-w-xs w-full pt-4 font-mono text-xs uppercase font-bold">
            <button
              onClick={handleRetryDispatch}
              className="bg-white hover:bg-zinc-200 text-black py-3.5 rounded-xl transition cursor-pointer active:scale-95 text-center font-sans"
            >
              🔄 Retry Dispatch Search
            </button>
            <button
              onClick={() => {
                alert('Scheduled matching set for this route! We will pre-assign 30 mins before departure.');
                router.push('/rider');
              }}
              className="bg-zinc-900 hover:bg-zinc-850 text-zinc-300 border border-zinc-800 py-3 rounded-xl transition cursor-pointer text-center"
            >
              📅 Schedule for Later
            </button>
          </div>

          <button
            onClick={() => router.push('/rider')}
            className="text-zinc-500 hover:text-white font-mono text-[9px] uppercase tracking-widest font-bold"
          >
            ← Back to booking console
          </button>
        </div>
      )}

      <footer className="w-full max-w-md mx-auto text-center text-[8px] font-mono text-zinc-700 select-none pt-4 border-t border-zinc-900">
        SECURE SHA-256 MATCHER NODE • KOL-HUB CONNECTED
      </footer>
    </div>
  );
}
