'use client';

import React from 'react';
import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-white text-black flex flex-col justify-between p-6 sm:p-12 font-sans selection:bg-black selection:text-white">
      {/* Platform Branding Header */}
      <header className="border-b border-zinc-100 pb-6 w-full text-left">
        <h1 className="text-2xl font-bold tracking-tight font-move">drivers-for-u</h1>
        <p className="text-zinc-500 text-xs mt-0.5">On-Demand Professional Drivers for Car Owners</p>
      </header>

      {/* Main Core Selector Grid Matrix */}
      <div className="w-full max-w-2xl mx-auto my-12 grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Portal Route: Vehicle/Car Owners Looking for Drivers */}
        <Link 
          href="/rider"
          className="group p-8 bg-zinc-50 hover:bg-black hover:text-white border border-zinc-200 hover:border-black rounded-2xl flex flex-col justify-between min-h-[220px] transition duration-300 shadow-sm text-left no-underline"
        >
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 group-hover:text-zinc-400 mb-2">Demand Side Gateway</div>
            <h2 className="text-xl font-bold font-move tracking-tight">Hire a Professional Driver</h2>
            <p className="text-xs text-zinc-500 group-hover:text-zinc-300 mt-2 leading-relaxed">
              Book an authenticated, transmission-certified expert to pilot your personal vehicle. Perfect for commutes, evening events, or inter-city travel.
            </p>
          </div>
          <div className="text-xs font-bold uppercase tracking-widest pt-4 opacity-60 group-hover:opacity-100 transition">
            Request Driver →
          </div>
        </Link>

        {/* Portal Route: Professional Drivers Going on Duty */}
        <Link 
          href="/driver"
          className="group p-8 bg-zinc-50 hover:bg-black hover:text-white border border-zinc-200 hover:border-black rounded-2xl flex flex-col justify-between min-h-[220px] transition duration-300 shadow-sm text-left no-underline"
        >
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 group-hover:text-zinc-400 mb-2">Supply Side Gateway</div>
            <h2 className="text-xl font-bold font-move tracking-tight">Driver Duty Terminal</h2>
            <p className="text-xs text-zinc-500 group-hover:text-zinc-300 mt-2 leading-relaxed">
              Go on duty, stream live background telemetry vectors, view structural heatmaps, and accept incoming customer vehicle requests.
            </p>
          </div>
          <div className="text-xs font-bold uppercase tracking-widest pt-4 opacity-60 group-hover:opacity-100 transition">
            Go On Duty →
          </div>
        </Link>

      </div>

      {/* Static Footer Context Meta Logs */}
      <footer className="w-full border-t border-zinc-100 pt-6 text-left flex justify-between items-center text-[10px] text-zinc-400 font-mono">
        <span>RUNNING ENVIRONMENT: SANDBOX_CONTAINER</span>
        <span>REGIONAL CORE HUBS: KOL / BLR</span>
      </footer>
    </main>
  );
}
