'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
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

function LiveTripContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tripId = searchParams?.get('tripId') || 'trp-2209';

  // Active states: ARRIVING | ARRIVED | IN_TRANSIT | COMPLETED
  const [tripStatus, setTripStatus] = useState<'ARRIVING' | 'ARRIVED' | 'IN_TRANSIT' | 'COMPLETED'>('ARRIVING');
  const [mapGlide, setMapGlide] = useState(0);
  const [tripTimer, setTripTimer] = useState(0);
  
  // Custom modifier state variables
  const [stops, setStops] = useState<string[]>([]);
  const [dropoffText, setDropoffText] = useState('Park Street Dining Grid, Kolkata');
  const [durationHours, setDurationHours] = useState(4);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issueText, setIssueText] = useState('');

  // Live WebSocket Connection
  useEffect(() => {
    const stream = new ResilientStreamManager({
      orderID: tripId,
      cityPrefix: 'KOL',
      onStatusChange: (status) => {
        console.log('[LiveTrip] WS status:', status);
      },
      onMessage: (message: any) => {
        console.log('[LiveTrip] Stream envelope:', message);
        let status = '';

        if (message instanceof ArrayBuffer) {
          const unpacked = parseBinaryEnvelope(message);
          if (unpacked?.type === 'ASSIGNMENT') {
            status = unpacked.data.status;
          }
        } else if (message?.status) {
          status = message.status;
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

    return () => {
      stream.disconnect();
    };
  }, [tripId]);

  // Gliding coordinates interval
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (tripStatus === 'ARRIVING' || tripStatus === 'IN_TRANSIT') {
      interval = setInterval(() => {
        setMapGlide((prev) => {
          const next = prev + 2;
          if (next >= 100) {
            return 0;
          }
          return next;
        });
      }, 250);
    }
    return () => clearInterval(interval);
  }, [tripStatus]);

  // Trip clock timer
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (tripStatus === 'IN_TRANSIT') {
      timer = setInterval(() => {
        setTripTimer((t) => t + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [tripStatus]);

  const handleStartTripSimulated = () => {
    setTripStatus('IN_TRANSIT');
    setMapGlide(0);
  };

  const handleEndTripSimulated = () => {
    setTripStatus('COMPLETED');
    router.push(`/rider/trip/bill?tripId=${tripId}`);
  };

  const handleSOS = () => {
    alert('🚨 SAFETY EXECUTIONS DIALED: Distress location shared with emergency support and authorities immediately.');
  };

  const handleReportIssue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueText.trim()) return;
    alert(`Report filed: "${issueText}". Dispatch operations team will investigate.`);
    setIssueText('');
    setShowIssueModal(false);
  };

  const handleExtendDuration = () => {
    setDurationHours((prev) => prev + 1);
    alert('Journey hourly package extended by 1 hour (extra ₹100 applied).');
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-8 font-sans flex flex-col justify-between selection:bg-white selection:text-black">
      
      {/* Header */}
      <header className="border-b border-zinc-900 pb-4 flex justify-between items-center w-full max-w-md mx-auto text-left">
        <div>
          <span className="bg-zinc-900 text-zinc-500 border border-zinc-850 px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider block w-max mb-1">
            ACTIVE PILOT JOURNEY
          </span>
          <h1 className="text-sm font-bold tracking-tight text-white font-mono uppercase">Rider Tracking Panel</h1>
        </div>
        <span className="text-[9px] font-mono text-zinc-500 uppercase font-bold">ID: {tripId}</span>
      </header>

      {/* 1. MOCK INCIDENT REPORT MODAL SHEET */}
      {showIssueModal && (
        <div className="fixed inset-0 bg-black/80 z-[99999] flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 p-6 rounded-2xl w-full max-w-sm text-left space-y-4">
            <h3 className="text-xs font-bold font-mono text-white uppercase tracking-widest border-b border-zinc-900 pb-2">
              Report Route Safety Issue
            </h3>
            
            <form onSubmit={handleReportIssue} className="space-y-4 font-mono text-xs">
              <div>
                <label className="block text-[8px] font-bold text-zinc-500 uppercase mb-1">Provide details</label>
                <textarea
                  value={issueText}
                  onChange={(e) => setIssueText(e.target.value)}
                  rows={3}
                  placeholder="Rash driving, route deviation, safety concerns..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-white focus:outline-none focus:border-zinc-500 font-sans"
                  required
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowIssueModal(false)}
                  className="flex-1 bg-zinc-900 hover:bg-zinc-850 text-zinc-500 py-2.5 rounded-lg border border-zinc-850 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-white hover:bg-zinc-200 text-black font-bold py-2.5 rounded-lg cursor-pointer"
                >
                  Submit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MAIN CONTAINER */}
      <main className="w-full max-w-md mx-auto flex-grow my-4 flex flex-col gap-4 text-left">
        
        {/* Simulated SVG Gliding Map */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl overflow-hidden relative min-h-[220px] flex flex-col justify-between">
          <div className="absolute inset-0 bg-black/60 z-0">
            <svg className="w-full h-full opacity-40" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="liveGrid" width="30" height="30" patternUnits="userSpaceOnUse">
                  <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#222" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#liveGrid)" />

              {/* Route */}
              <line x1="25%" y1="75%" x2="75%" y2="25%" stroke="#3b82f6" strokeWidth="3" strokeDasharray="5,5" />
              
              {/* Pickup/Drop */}
              <circle cx="25%" cy="75%" r="6" fill="#10b981" />
              <circle cx="75%" cy="25%" r="6" fill="#ef4444" />
              
              {/* Glide vehicle */}
              <circle 
                cx={`${25 + (mapGlide / 100) * (75 - 25)}%`} 
                cy={`${75 + (mapGlide / 100) * (25 - 75)}%`} 
                r="7" 
                fill="#fff" 
                stroke="#1e3a8a" 
                strokeWidth="2" 
              />
            </svg>
          </div>

          {/* Status Overlay Banner */}
          <div className="relative z-10 p-4 bg-gradient-to-b from-black to-transparent flex justify-between items-center text-[8px] font-mono font-bold">
            <span className="text-zinc-500">
              {tripStatus === 'ARRIVING' && 'DRIVER ASSIGNED (ARRIVING)'}
              {tripStatus === 'ARRIVED' && 'DRIVER ARRIVED AT HUB (WAITING)'}
              {tripStatus === 'IN_TRANSIT' && `EN ROUTE (CLOCK: ${Math.floor(tripTimer / 60)}:${(tripTimer % 60).toString().padStart(2, '0')})`}
              {tripStatus === 'COMPLETED' && 'TRIP COMPLETED'}
            </span>

            <span className="bg-emerald-950/20 text-emerald-400 border border-emerald-900 px-2 py-0.5 rounded uppercase">
              {tripStatus.replace('_', ' ')}
            </span>
          </div>

          <div className="relative z-10 p-4 bg-gradient-to-t from-black to-transparent text-[8px] font-mono text-zinc-500">
            {tripStatus === 'IN_TRANSIT' && 'Speed checking: 46 km/h • Deviations: None'}
            {tripStatus === 'ARRIVING' && 'Driver distance to pickup: 0.8 KM'}
          </div>
        </div>

        {/* Dynamic simulator trigger buttons based on state */}
        <div className="grid grid-cols-1 gap-2 font-mono text-xs font-bold uppercase">
          {tripStatus === 'ARRIVED' && (
            <button
              onClick={handleStartTripSimulated}
              className="w-full bg-white text-black hover:bg-zinc-200 py-3 rounded-xl cursor-pointer text-center font-sans"
            >
              🔄 [Start Trip: OTP Handshake Verification]
            </button>
          )}

          {tripStatus === 'IN_TRANSIT' && (
            <button
              onClick={handleEndTripSimulated}
              className="w-full bg-red-600 text-white hover:bg-red-700 py-3 rounded-xl border border-red-500 cursor-pointer text-center"
            >
              🏁 [Arrived at drop: Complete Transit]
            </button>
          )}
        </div>

        {/* 2. RIDER OTP DISPLAY BANNER (Only Awaiting verification) */}
        {(tripStatus === 'ARRIVING' || tripStatus === 'ARRIVED') && (
          <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 text-center space-y-2">
            <span className="text-zinc-500 text-[8px] font-mono font-bold uppercase tracking-widest block">RIDE AUTHENTICATION SECURITY CODE</span>
            <div className="text-3xl font-mono font-extrabold tracking-widest text-white animate-pulse">
              1234
            </div>
            <p className="text-[10px] text-zinc-400 font-sans leading-normal max-w-xs mx-auto pt-1">
              Provide this 4-digit security code to your driver partner once they arrive at your vehicle location to verify.
            </p>
          </div>
        )}

        {/* Driver mini details card */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
          <div className="flex justify-between items-start gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-zinc-900 border border-zinc-850 rounded-xl flex items-center justify-center text-lg">
                👤
              </div>
              <div className="text-xs">
                <h4 className="font-bold text-white">Aniket Karmakar (★ 4.92)</h4>
                <span className="text-[9px] font-mono text-zinc-500 block mt-0.5">Driving: Audi A6 (WB-02-AK-9988)</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => alert('Dialing driver mobile proxy forwarding address...')}
                className="h-8 w-8 bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 rounded-lg flex items-center justify-center text-xs"
              >
                📞
              </button>
              <button
                onClick={handleSOS}
                className="h-8 w-8 bg-red-950 hover:bg-red-900 text-red-500 border border-red-900 rounded-lg flex items-center justify-center text-xs"
              >
                🚨
              </button>
            </div>
          </div>
        </div>

        {/* Expandable active trip variables */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
            Trip Specifications
          </h4>

          <div className="space-y-3 text-xs font-mono text-zinc-400">
            <div>📍 <span className="text-zinc-600 font-bold uppercase text-[8px] block mb-0.5">Pickup Node</span> Salt Lake Sector V Tech Hub, Kolkata</div>
            {stops.map((st, i) => (
              <div key={i}>🛑 <span className="text-zinc-600 font-bold uppercase text-[8px] block mb-0.5">Stop {i + 1}</span> {st || 'Not configured'}</div>
            ))}
            <div>🏁 <span className="text-zinc-600 font-bold uppercase text-[8px] block mb-0.5 font-mono">Destination</span> {dropoffText}</div>
          </div>
        </div>

        {/* In-Trip Modifiers actions */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3">
          <h4 className="text-[10px] font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
            In-Trip Adjustments
          </h4>

          <div className="grid grid-cols-2 gap-2 text-[9px] font-mono font-bold uppercase">
            <button
              onClick={() => {
                const newStop = prompt('Enter address for new stop:');
                if (newStop) setStops((prev) => [...prev, newStop]);
              }}
              className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 py-2.5 rounded-xl text-zinc-300 cursor-pointer text-center"
            >
              🛑 Add Stop
            </button>
            <button
              onClick={() => {
                const newDrop = prompt('Enter new destination address:', dropoffText);
                if (newDrop) setDropoffText(newDrop);
              }}
              className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 py-2.5 rounded-xl text-zinc-300 cursor-pointer text-center"
            >
              🗺️ Change Drop
            </button>
            <button
              onClick={handleExtendDuration}
              className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 py-2.5 rounded-xl text-zinc-300 cursor-pointer text-center col-span-2"
            >
              📅 Extend Duration (+1h)
            </button>
            <button
              onClick={() => setShowIssueModal(true)}
              className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 py-2.5 rounded-xl text-zinc-400 hover:text-white cursor-pointer text-center col-span-2"
            >
              ⚠️ Report Safety Issue
            </button>
          </div>
        </div>

        {/* Timeline tracker */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3 font-mono text-[9px]">
          <h4 className="text-[10px] font-bold text-white uppercase tracking-wider border-b border-zinc-900 pb-2">
            Trip Milestone Timeline
          </h4>
          <div className="space-y-2 text-zinc-500">
            <div className="flex items-center gap-2 text-zinc-600">
              <span>●</span>
              <span>Trip booked at 14:02</span>
            </div>
            <div className="flex items-center gap-2 text-zinc-600">
              <span>●</span>
              <span>Driver assigned at 14:05</span>
            </div>
            <div className={`flex items-center gap-2 ${tripStatus !== 'ARRIVING' ? 'text-zinc-600' : 'text-white font-bold animate-pulse'}`}>
              <span>●</span>
              <span>Driver Arriving at Location</span>
            </div>
            {tripStatus !== 'ARRIVING' && (
              <div className={`flex items-center gap-2 ${tripStatus === 'ARRIVED' ? 'text-white font-bold animate-pulse' : 'text-zinc-600'}`}>
                <span>●</span>
                <span>Driver Arrived (Awaiting OTP)</span>
              </div>
            )}
            {tripStatus === 'IN_TRANSIT' && (
              <div className="flex items-center gap-2 text-white font-bold">
                <span>●</span>
                <span>Trip Started (En Route)</span>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="w-full max-w-md mx-auto text-center text-[8px] font-mono text-zinc-700 select-none pt-4 border-t border-zinc-900">
        SECURE VEHICLE ROUTE DATA LAYER • FAST-TAG CLUSTER
      </footer>
    </div>
  );
}

export default function LiveTripPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center font-sans text-zinc-500 font-mono text-xs uppercase animate-pulse">
        Initializing Live Journey Monitor...
      </div>
    }>
      <LiveTripContent />
    </Suspense>
  );
}
