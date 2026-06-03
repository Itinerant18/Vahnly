'use client';

import React, { useState, useEffect, useRef } from 'react';
import { VehicleTracker } from '../../lib/VehicleTracker';
import { ResilientStreamManager } from '../../network/ResilientStreamManager';

interface ActiveOrderAssignment {
  order_id: string;
  customer_name: string;
  pickup_address: string;
  dropoff_address: string;
  quoted_fare_paise: number;
  vehicle_tier: string;
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
  // Hardcoded target authentication metadata for instant local sandbox test execution loopback
  const [driverID] = useState<string>('drv-aniket-7602');
  const [cityPrefix] = useState<string>('KOL');

  // Duty State Machine Configuration States
  const [dutyState, setDutyState] = useState<'OFFLINE' | 'ONLINE_AVAILABLE' | 'ON_TRIP'>('OFFLINE');
  const [streamStatus, setStreamStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING'>('DISCONNECTED');
  
  // High-Priority Match Allocation Overlay Hooks
  const [incomingOffer, setIncomingOffer] = useState<ActiveOrderAssignment | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(15);
  const [activeTrip, setActiveTrip] = useState<ActiveOrderAssignment | null>(null);

  // Structural Class Reference Pointer Scopes
  const trackerRef = useRef<VehicleTracker | null>(null);
  const streamRef = useRef<ResilientStreamManager | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up streaming sessions and hardware trackers on component unmount
  useEffect(() => {
    return () => {
      trackerRef.current?.stopTrackingCore();
      streamRef.current?.disconnect();
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, []);

  // Monitor allocation offer lifecycles to manage the 15-second expiration windows
  useEffect(() => {
    if (incomingOffer && countdownSeconds > 0) {
      countdownTimerRef.current = setTimeout(() => {
        setCountdownSeconds((prev) => prev - 1);
      }, 1000);
    } else if (countdownSeconds === 0 && incomingOffer) {
      handleDeclineOffer(); // Automatic expiration fallback if dispatcher validation interval passes
    }
    return () => {
      if (countdownTimerRef.current) clearTimeout(countdownTimerRef.current);
    };
  }, [incomingOffer, countdownSeconds]);

  const handleToggleDutySwitch = async () => {
    if (dutyState === 'OFFLINE') {
      setDutyState('ONLINE_AVAILABLE');

      // 1. Initialize native background coordinate injection via the tracker engine
      trackerRef.current = new VehicleTracker(driverID, cityPrefix, async (packets) => {
        console.log('[DUTY_TERMINAL] Flushing telemetry chunk payloads:', packets);
        return true;
      });
      await trackerRef.current.startTrackingCore();

      // 2. Establish low-latency connection to binary WebSocket channels
      streamRef.current = new ResilientStreamManager({
        orderID: `stream-session-${driverID}`,
        cityPrefix: cityPrefix,
        wsBaseUrl: 'ws://localhost:8080',
        onStatusChange: (status) => setStreamStatus(status),
        onMessage: (message: any) => {
          // Intercept incoming byte stream buffers or standard text fallback events
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
    }
  };

  const triggerIncomingMatchNotification = (orderId: string) => {
    if (dutyState !== 'ONLINE_AVAILABLE' || activeTrip) return;

    // Build incoming transaction package mapping structural configurations safely
    setIncomingOffer({
      order_id: orderId || `ord-mock-${Date.now().toString().slice(-4)}`,
      customer_name: 'Aniket Karmakar (Car Owner)',
      pickup_address: 'Salt Lake Sector V Tech Hub, Kolkata',
      dropoff_address: 'Park Street Dining Grid, Kolkata',
      quoted_fare_paise: 68000, // ₹680.00
      vehicle_tier: 'ULTRA_LUXURY',
    });
    setCountdownSeconds(15);
  };

  const handleAcceptOffer = async () => {
    if (!incomingOffer) return;
    setDutyState('ON_TRIP');
    setActiveTrip(incomingOffer);
    setIncomingOffer(null);

    try {
      // Post validation receipt parameters directly to your Go matching controllers
      await fetch('http://localhost:8080/api/v1/dispatch/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: incomingOffer.order_id, driver_id: driverID }),
      });
    } catch (err) {
      console.warn('[TERMINAL_WS] Assignment claimed locally. Syncing background parameters.');
    }
  };

  const handleDeclineOffer = () => {
    setIncomingOffer(null);
    setCountdownSeconds(15);
  };

  const handleCompleteCurrentTrip = () => {
    setDutyState('ONLINE_AVAILABLE');
    setActiveTrip(null);
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-8 font-sans flex flex-col justify-between selection:bg-white selection:text-black">
      
      {/* 15-Second High-Priority Full Screen Acceptance Modal Overlay */}
      {incomingOffer && (
        <div className="fixed inset-0 bg-black z-[99999] flex flex-col justify-between p-6 sm:p-12 animate-fadeIn text-left">
          <div className="space-y-2">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-4">
              <div>
                <span className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase font-mono">High-Priority Allocation Target</span>
                <h2 className="text-2xl font-bold tracking-tight text-white font-move mt-1">New Match Offer Received</h2>
              </div>
              
              {/* Animated Countdown Ring Component Canvas Visual Indicator */}
              <div className="h-14 w-14 rounded-full border-4 border-zinc-800 flex items-center justify-center relative overflow-hidden">
                <span className="text-base font-mono font-bold animate-pulse text-white">{countdownSeconds}s</span>
                <div className="absolute inset-0 border-4 border-white border-t-transparent rounded-full animate-spin duration-1000"></div>
              </div>
            </div>

            {/* Trip Parameters Metadata Grid Layout */}
            <div className="pt-6 space-y-6 max-w-xl">
              <div>
                <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider block">Vehicle Asset Owner</span>
                <span className="text-lg font-bold font-move text-white mt-0.5 block">{incomingOffer.customer_name}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
                <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl">
                  <span className="text-zinc-500 block text-[8px] font-bold uppercase">Route Pickup Base</span>
                  <span className="text-white font-medium mt-1 block">{incomingOffer.pickup_address}</span>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl">
                  <span className="text-zinc-500 block text-[8px] font-bold uppercase">Destination Dropoff</span>
                  <span className="text-white font-medium mt-1 block">{incomingOffer.dropoff_address}</span>
                </div>
              </div>

              <div className="flex justify-between items-center bg-zinc-900 border border-zinc-800 p-4 rounded-xl font-mono">
                <div>
                  <span className="text-zinc-500 block text-[8px] font-bold uppercase">Guaranteed Payout Split</span>
                  <span className="text-xl font-bold text-white mt-0.5 block">₹{(incomingOffer.quoted_fare_paise / 100).toFixed(2)}</span>
                </div>
                <span className="bg-white text-black px-2.5 py-1 text-[9px] font-bold rounded uppercase tracking-wider">
                  {incomingOffer.vehicle_tier.replace('_', ' ')}
                </span>
              </div>
            </div>
          </div>

          {/* Action Trigger Handles */}
          <div className="flex gap-4 max-w-xl w-full mx-auto">
            <button
              onClick={handleDeclineOffer}
              type="button"
              className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 font-bold py-4 rounded-full text-xs uppercase tracking-wider transition cursor-pointer border border-zinc-800 active:scale-95"
            >
              Decline Offer
            </button>
            <button
              onClick={handleAcceptOffer}
              type="button"
              className="flex-1 bg-white hover:bg-zinc-200 text-black font-bold py-4 rounded-full text-xs uppercase tracking-wider transition cursor-pointer active:scale-95 animate-bounce"
            >
              Accept Match Offer
            </button>
          </div>
        </div>
      )}

      {/* Primary On-Duty View Header Panel */}
      <header className="border-b border-zinc-800 pb-4 flex justify-between items-center w-full text-left">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white font-move">Driver Duty Terminal</h1>
          <p className="text-zinc-500 text-[10px] font-mono uppercase font-bold tracking-wider mt-0.5">ID: {driverID.toUpperCase()} (Hub: {cityPrefix})</p>
        </div>
        
        {/* On Duty Status Network Color Badges */}
        <div className="flex items-center gap-2">
          {dutyState !== 'OFFLINE' && (
            <span className="bg-zinc-900 text-zinc-400 border border-zinc-800 px-3 py-1.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider animate-pulse">
              ● Stream: {streamStatus.toLowerCase()}
            </span>
          )}
          <a href="/" className="text-xs font-bold uppercase tracking-wider border border-zinc-800 px-4 py-2 rounded-full hover:bg-zinc-900 transition">
            ← Home
          </a>
        </div>
      </header>

      {/* Main Control Status Dashboard Panel Module */}
      <div className="w-full max-w-md mx-auto my-8 bg-zinc-950 border border-zinc-800 rounded-2xl p-6 space-y-6 relative overflow-hidden">
        <div className="text-left border-b border-zinc-900 pb-4 flex justify-between items-center">
          <div>
            <h3 className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">Operating Lifecycle State</h3>
            <div className="text-lg font-bold font-move text-white mt-1">
              {dutyState === 'OFFLINE' ? '🔴 System Disconnected' : dutyState === 'ONLINE_AVAILABLE' ? '🟢 Active & Seeking Match' : '⚡ Busy on Active Trip'}
            </div>
          </div>

          {/* Core Master On-Duty Toggle Switch */}
          <button
            onClick={handleToggleDutySwitch}
            disabled={dutyState === 'ON_TRIP'}
            className={`h-7 w-14 rounded-full transition relative flex items-center p-1 cursor-pointer disabled:opacity-30 ${
              dutyState !== 'OFFLINE' ? 'bg-white' : 'bg-zinc-800'
            }`}
          >
            <div className={`h-5 w-5 rounded-full shadow transition-transform duration-300 ${
              dutyState !== 'OFFLINE' ? 'translate-x-7 bg-black' : 'translate-x-0 bg-zinc-400'
            }`} />
          </button>
        </div>

        {/* Conditional Terminal Views Rendering Matrix */}
        {dutyState === 'OFFLINE' ? (
          <div className="py-8 text-center text-xs text-zinc-500 font-medium italic">
            Toggle the on-duty master switch above to launch native background telemetry runners and bind session streaming pipes.
          </div>
        ) : dutyState === 'ONLINE_AVAILABLE' ? (
          <div className="space-y-4 animate-fadeIn text-left">
            <div className="p-4 bg-zinc-900/40 border border-zinc-900 rounded-xl text-[11px] text-zinc-400 leading-relaxed font-mono">
              [TELEMETRY_DAEMON]: Geolocation hardware polling loops operational.<br />
              [STREAM_BACKPLANE]: Awaiting binary allocation vector payload frames from gateway...
            </div>
            
            {/* Simulation Interface Trigger Check for Offline Sandbox Environments */}
            <button
              onClick={() => triggerIncomingMatchNotification('')}
              type="button"
              className="w-full bg-zinc-900 hover:bg-zinc-800 text-zinc-300 font-bold py-2.5 px-4 rounded-xl text-[10px] font-mono uppercase tracking-wider border border-zinc-800 transition cursor-pointer"
            >
              [Simulate Inbound Match Frame Ingestion]
            </button>
          </div>
        ) : (
          /* Active Journey Navigation Tracking Execution Sheet Component view */
          <div className="space-y-4 animate-fadeIn text-left">
            <div className="border-b border-zinc-900 pb-2">
              <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Active Pilot Navigation Journey</span>
              <div className="text-sm font-bold text-white mt-0.5">{activeTrip?.customer_name}</div>
            </div>
            <div className="space-y-2 text-xs font-mono text-zinc-400">
              <div><span className="font-bold text-zinc-500">From:</span> {activeTrip?.pickup_address}</div>
              <div><span className="font-bold text-zinc-500">To:</span> {activeTrip?.dropoff_address}</div>
              <div><span className="font-bold text-zinc-500">Fare Matrix:</span> ₹{(activeTrip!.quoted_fare_paise / 100).toFixed(2)}</div>
            </div>
            <button
              onClick={handleCompleteCurrentTrip}
              type="button"
              className="w-full bg-white hover:bg-zinc-200 text-black font-bold py-3 px-4 rounded-full text-xs uppercase tracking-wider font-sans transition cursor-pointer mt-2"
            >
              Complete Transit & Return to Pool
            </button>
          </div>
        )}
      </div>

      {/* Static Footer Context Meta Logs */}
      <footer className="w-full text-left flex justify-between items-center text-[9px] text-zinc-600 font-mono pt-4 border-t border-zinc-900">
        <span>SECURITY: PROTOBUF_OVER_WS_BINARY_FRAMING</span>
        <span>SLOTS_SHARD_STATUS: SYNCED</span>
      </footer>
    </div>
  );
}
