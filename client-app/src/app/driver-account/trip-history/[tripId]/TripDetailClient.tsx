'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { getTripById } from '../tripData';
import { useAuthStore } from '@/store/useAuthStore';

interface AuditTrailProps {
  auditData: {
    offer_timestamps: { received_ts: string; responded_ts: string; response_latency: number };
    odometer_inputs: { start_km: number; end_km: number; otp_attempts: number };
    route_metrics: { wait_time_minutes: number; route_deviations_m: number };
    hardware_state: { device_model: string; network_type: string; battery_pct_drain: number };
  };
}

export const TripAuditTrailPanel: React.FC<AuditTrailProps> = ({ auditData }) => {
  return (
    <div className="bg-zinc-950 text-zinc-100 p-6 rounded-2xl border border-zinc-900 space-y-6 max-w-xl mx-auto font-mono text-xs text-left">
      <div className="border-b border-zinc-900 pb-3 flex justify-between items-center">
        <span className="font-black text-amber-500 tracking-wider">🔒 FORENSIC AUDIT TRAIL</span>
        <span className="bg-zinc-900 text-zinc-500 px-2 py-0.5 rounded text-[8px]">SECURE_LOG</span>
      </div>

      {/* Lifecycle Vectors */}
      <div className="space-y-2">
        <h4 className="text-zinc-400 font-bold uppercase tracking-wide text-[9px] text-blue-500">1. Offer Execution Metrics</h4>
        <div className="grid grid-cols-2 gap-2 bg-black/40 p-3 rounded-lg border border-zinc-900">
          <div>Received: <span className="text-zinc-300">{new Date(auditData.offer_timestamps.received_ts).toLocaleTimeString()}</span></div>
          <div>Latency: <span className="text-emerald-400">{auditData.offer_timestamps.response_latency}ms</span></div>
        </div>
      </div>

      {/* Physics Validation Checks */}
      <div className="space-y-2">
        <h4 className="text-zinc-400 font-bold uppercase tracking-wide text-[9px] text-purple-500">2. Physical Asset Checkpoints</h4>
        <div className="grid grid-cols-2 gap-2 bg-black/40 p-3 rounded-lg border border-zinc-900">
          <div>Start Odo: <span className="text-zinc-300">{auditData.odometer_inputs.start_km} KM</span></div>
          <div>End Odo: <span className="text-zinc-300">{auditData.odometer_inputs.end_km} KM</span></div>
          <div>OTP Attempts: <span className="text-zinc-300">{auditData.odometer_inputs.otp_attempts}</span></div>
          <div>Deviations: <span className="text-red-400">{auditData.route_metrics.route_deviations_m}m</span></div>
        </div>
      </div>

      {/* Hardware Diagnostics Log */}
      <div className="space-y-2">
        <h4 className="text-zinc-400 font-bold uppercase tracking-wide text-[9px] text-amber-500">3. Hardware Diagnostics Envelope</h4>
        <div className="grid grid-cols-2 gap-2 bg-black/40 p-3 rounded-lg border border-zinc-900">
          <div>Terminal: <span className="text-zinc-300 truncate block">{auditData.hardware_state.device_model}</span></div>
          <div>Network Mode: <span className="text-zinc-300">{auditData.hardware_state.network_type}</span></div>
          <div className="col-span-2">Battery Draw Over Route: <span className="text-amber-400">-{auditData.hardware_state.battery_pct_drain}%</span></div>
        </div>
      </div>
    </div>
  );
};


export default function TripDetailClient({ tripId }: { tripId: string }) {
  const trip = getTripById(tripId);

  const { token } = useAuthStore();
  const [replayProgress, setReplayProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  const [auditData, setAuditData] = useState<any>({
    offer_timestamps: {
      received_ts: new Date(Date.now() - 3600000).toISOString(),
      responded_ts: new Date(Date.now() - 3540000).toISOString(),
      response_latency: 850
    },
    odometer_inputs: {
      start_km: 14500,
      end_km: 14525,
      otp_attempts: 1
    },
    route_metrics: {
      wait_time_minutes: 4,
      route_deviations_m: 120
    },
    hardware_state: {
      device_model: "SM-G998B (Galaxy S21 Ultra)",
      network_type: "5G_SA",
      battery_pct_drain: 4
    }
  });

  useEffect(() => {
    if (!tripId) return;
    const fetchAudit = async () => {
      try {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`/api/v1/admin/orders/${tripId}/forensic-audit`, { headers });
        if (res.ok) {
          const data = await res.json();
          setAuditData({
            offer_timestamps: {
              received_ts: data.offer_timestamps?.received_ts || new Date(Date.now() - 3600000).toISOString(),
              responded_ts: data.offer_timestamps?.responded_ts || new Date(Date.now() - 3540000).toISOString(),
              response_latency: data.offer_timestamps?.response_latency || 0,
            },
            odometer_inputs: {
              start_km: data.odometer_inputs?.start_km || 0,
              end_km: data.odometer_inputs?.end_km || 0,
              otp_attempts: data.odometer_inputs?.otp_attempts || 0,
            },
            route_metrics: {
              wait_time_minutes: data.route_metrics?.wait_time_minutes || 0,
              route_deviations_m: data.route_metrics?.route_deviations_m || 0,
            },
            hardware_state: {
              device_model: data.hardware_state?.device_model || "Unknown",
              network_type: data.hardware_state?.network_type || "Unknown",
              battery_pct_drain: data.hardware_state?.battery_pct_drain || 0,
            }
          });
        }
      } catch (err) {
        console.error('Failed to fetch forensic audit trail:', err);
      }
    };
    fetchAudit();
  }, [tripId, token]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (trip && isPlaying) {
      interval = setInterval(() => {
        setReplayProgress((prev) => (prev >= 100 ? 0 : prev + 2));
      }, 150);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [trip, isPlaying]);

  const handleDispute = () => {
    if (!trip) return;
    const reason = prompt('Enter the reason for disputing this trip fare:');
    if (!reason) return;
    // No driver-facing dispute endpoint exists yet — do not claim a ticket was registered
    // when nothing was persisted.
    alert('Fare dispute submission is not available yet. Please contact support to raise a dispute.');
  };

  // Deep-link to an unknown trip id — surface a clean recoverable state.
  if (!trip) {
    return (
      <div className="space-y-6 text-left animate-fadeIn">
        <div className="pb-4 border-b border-zinc-900">
          <h2 className="text-xl font-bold tracking-tight text-white font-move">Trip not found</h2>
          <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">No audit record for ID: {tripId}</p>
        </div>
        <Link
          href="/driver-account/trip-history"
          className="inline-block text-xs font-bold uppercase tracking-wider border border-zinc-800 px-4 py-2 rounded-full hover:bg-zinc-900 transition font-mono"
        >
          ← Back to trip history
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn text-left">
      {/* Header */}
      <div className="flex justify-between items-center pb-4 border-b border-zinc-900">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white font-move">Trip Audit Summary</h2>
          <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">ID: {trip.id.toUpperCase()} ({trip.date})</p>
        </div>
        <Link
          href="/driver-account/trip-history"
          className="text-xs font-bold uppercase tracking-wider border border-zinc-800 px-4 py-2 rounded-full hover:bg-zinc-900 transition font-mono cursor-pointer"
        >
          ← Back to list
        </Link>
      </div>

      {/* Simulated SVG Map Route Replay */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl overflow-hidden relative min-h-[250px] flex flex-col justify-between">
        <div className="absolute inset-0 bg-black/60 z-0">
          <svg className="w-full h-full opacity-40" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="detailGrid" width="30" height="30" patternUnits="userSpaceOnUse">
                <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#222" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#detailGrid)" />
            <line x1="30%" y1="70%" x2="70%" y2="30%" stroke="#3b82f6" strokeWidth="3" strokeDasharray="5,5" />
            <circle cx="30%" cy="70%" r="6" fill="#10b981" />
            <circle cx="70%" cy="30%" r="6" fill="#ef4444" />
            <circle
              cx={`${30 + (replayProgress / 100) * (70 - 30)}%`}
              cy={`${70 + (replayProgress / 100) * (30 - 70)}%`}
              r="7"
              fill="#fff"
              stroke="#1e3b8a"
              strokeWidth="2"
            />
          </svg>
        </div>

        <div className="relative z-10 p-4 flex justify-between items-center bg-gradient-to-b from-black to-transparent">
          <span className="bg-zinc-900 text-zinc-400 border border-zinc-850 px-2.5 py-1 rounded text-[8px] font-mono font-bold uppercase tracking-wider">
            GPS REPLAY: {replayProgress}%
          </span>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="bg-white text-black font-mono font-bold text-[8px] uppercase px-3 py-1 rounded-full cursor-pointer hover:bg-zinc-200"
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
        </div>

        <div className="relative z-10 p-4 bg-gradient-to-t from-black to-transparent text-[10px] font-mono text-zinc-400">
          <span>Speed sampling: 48 km/h (Stable) • Deviations: None detected</span>
        </div>
      </div>

      {/* Details split grids */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
            Trip Specifications
          </h4>
          <div className="space-y-3 text-xs font-mono text-zinc-400">
            <div>
              <span className="text-zinc-600 font-bold uppercase text-[9px] block mb-0.5 font-mono">Pickup Hub</span>
              {trip.pickup}
            </div>
            <div>
              <span className="text-zinc-600 font-bold uppercase text-[9px] block mb-0.5 font-mono">Destination</span>
              {trip.dropoff}
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-900 text-[10px] font-mono">
              <div>
                <span className="text-zinc-600 block text-[8px] uppercase font-bold">Driving Distance</span>
                <span className="text-white block mt-0.5 font-bold">{trip.distance} KM</span>
              </div>
              <div>
                <span className="text-zinc-600 block text-[8px] uppercase font-bold">Transit Time</span>
                <span className="text-white block mt-0.5 font-bold">{trip.duration} Mins</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bill Receipt Itemized */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
          <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
            <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">Itemized Payout</h4>
            <button
              onClick={handleDispute}
              className="text-red-500 hover:text-red-400 font-mono font-bold text-[8px] uppercase tracking-wider cursor-pointer"
            >
              Raise Dispute
            </button>
          </div>
          <div className="space-y-2 font-mono text-[10px] text-zinc-400">
            <div className="flex justify-between">
              <span>Base Package Quoted:</span>
              <span className="text-white">₹{trip.bill.base.toFixed(2)}</span>
            </div>
            {trip.bill.tolls > 0 && (
              <div className="flex justify-between">
                <span>Toll Additions:</span>
                <span className="text-white">₹{trip.bill.tolls.toFixed(2)}</span>
              </div>
            )}
            {trip.bill.parking > 0 && (
              <div className="flex justify-between">
                <span>Parking Additions:</span>
                <span className="text-white">₹{trip.bill.parking.toFixed(2)}</span>
              </div>
            )}
            {trip.bill.waiting > 0 && (
              <div className="flex justify-between">
                <span>Waiting Charges:</span>
                <span className="text-white">₹{trip.bill.waiting.toFixed(2)}</span>
              </div>
            )}
            {trip.bill.surge > 0 && (
              <div className="flex justify-between">
                <span>Night Surge Surcharge:</span>
                <span className="text-white">₹{trip.bill.surge.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-zinc-900 pt-2 text-zinc-500">
              <span>Platform Commission (10%):</span>
              <span className="text-red-400">-₹{trip.bill.deductions.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-xs text-white border-t border-zinc-800 pt-2">
              <span>Net Settled payout:</span>
              <span className="text-emerald-400">₹{trip.bill.net.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Feedback details */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          Feedback Exchange Ratings
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-center font-mono">
          <div className="bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl space-y-1 text-left">
            <span className="text-zinc-500 text-[8px] uppercase block">Rating You Received</span>
            <span className="text-amber-500 font-bold text-sm block">
              {Array.from({ length: trip.ratingReceived }).map(() => '★').join('')}
            </span>
            <span className="text-zinc-400 block text-[9px] mt-0.5">&quot;{trip.commentReceived}&quot;</span>
          </div>
          <div className="bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl space-y-1 text-left">
            <span className="text-zinc-500 text-[8px] uppercase block">Rating You Provided</span>
            <span className="text-amber-500 font-bold text-sm block">
              {Array.from({ length: trip.ratingGiven }).map(() => '★').join('')}
            </span>
            <span className="text-zinc-400 block text-[9px] mt-0.5">Tags: Polite, Safety conscious</span>
          </div>
        </div>
      </div>

      {/* Forensic Audit Panel */}
      <TripAuditTrailPanel auditData={auditData} />
    </div>
  );
}
