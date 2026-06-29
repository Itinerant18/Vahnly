'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import Link from 'next/link';
import { CarIcon, ShieldIcon, LocationIcon } from '@/components/ds/Icon';

export default function Home() {
  const router = useRouter();
  const { token, isAuthenticated } = useAuthStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // If authenticated, perform auto-onboarding redirect checks
    if (token && isAuthenticated) {
      const activeTripId = localStorage.getItem('active_trip_id');
      if (activeTripId) {
        router.push('/driver');
        return;
      }

      const onboardingCompleted = localStorage.getItem('rider_onboarding_completed') === 'true';
      if (onboardingCompleted) {
        router.push('/driver');
      } else {
        router.push('/onboarding');
      }
    }
  }, [token, isAuthenticated, router]);

  if (!mounted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin mx-auto" />
          <p className="text-xs text-content-tertiary font-mono uppercase tracking-widest">Initializing...</p>
        </div>
      </main>
    );
  }

  // If already logged in, do not render landing page to prevent layout shifts
  if (token && isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin mx-auto" />
          <p className="text-xs text-content-tertiary font-mono uppercase tracking-widest">Redirecting...</p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen relative flex flex-col justify-between p-6 bg-black text-white font-sans overflow-x-hidden selection:bg-white selection:text-black">
      {/* Grid line matrix background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-20 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-tr from-background-primary via-black to-background-secondary z-0 opacity-80 pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 w-full max-w-6xl mx-auto flex justify-between items-center py-4 border-b border-border-opaque">
        <div className="flex items-center gap-2">
          <span className="h-8 w-8 rounded-lg bg-white text-black flex items-center justify-center font-bold text-lg">
            V
          </span>
          <span className="font-extrabold tracking-tight font-move text-lg text-white">
            VAHNLY
          </span>
        </div>
        
        <Link
          href="/login/"
          className="flex items-center justify-center h-10 px-5 rounded-lg border border-border-opaque bg-background-secondary hover:bg-white hover:text-black hover:border-white transition-all duration-200 text-sm font-semibold cursor-pointer"
        >
          Sign In
        </Link>
      </header>

      {/* Main Core Landing Details */}
      <main className="relative z-10 w-full max-w-4xl mx-auto py-12 md:py-20 flex-grow flex flex-col justify-center gap-12 text-center md:text-left">
        <div className="space-y-6 max-w-2xl animate-enter-up">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-widest bg-white/5 text-accent-400 border border-border-opaque">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-400 animate-pulse" />
            Unified Match & Dispatch Ecosystem
          </span>
          
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight font-move bg-gradient-to-r from-white via-gray-300 to-gray-500 bg-clip-text text-transparent leading-tight">
            Professional Dispatch <br />
            Matching Platform
          </h1>
          
          <p className="text-content-secondary text-sm md:text-base leading-relaxed">
            Vahnly runs a secure, high-performance dynamic ride dispatch匹配 matching ecosystem. 
            Our platform allows registered independent professional drivers to connect with booking requests 
            across supported metropolitan regions, optimizing route navigation and transaction routing.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start pt-4">
            <Link
              href="/login/"
              className="flex items-center justify-center h-12 px-8 rounded-lg bg-white text-black font-semibold hover:bg-gray-200 transition-all shadow-md hover:-translate-y-0.5"
            >
              Sign In to App
            </Link>
            <a
              href="#features"
              className="flex items-center justify-center h-12 px-8 rounded-lg border border-border-opaque bg-background-secondary text-white font-semibold hover:border-white transition-all shadow-sm"
            >
              System Features
            </a>
          </div>
        </div>

        {/* Features / Purpose Outline Grid */}
        <section id="features" className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-12 border-t border-border-opaque">
          <div className="bg-background-secondary/30 backdrop-blur-sm border border-border-opaque p-6 rounded-xl shadow-sm space-y-3">
            <div className="h-10 w-10 rounded-lg bg-white/5 text-white flex items-center justify-center font-bold text-lg mb-2">
              <CarIcon size={24} />
            </div>
            <h3 className="font-bold text-white text-base">Match Optimizer</h3>
            <p className="text-content-secondary text-xs leading-relaxed">
              Dynamically matches booking dispatches utilizing pre-built contraction hierarchy models and surge rates.
            </p>
          </div>

          <div className="bg-background-secondary/30 backdrop-blur-sm border border-border-opaque p-6 rounded-xl shadow-sm space-y-3">
            <div className="h-10 w-10 rounded-lg bg-white/5 text-white flex items-center justify-center font-bold text-lg mb-2">
              <ShieldIcon size={24} />
            </div>
            <h3 className="font-bold text-white text-base">MFA Gateways</h3>
            <p className="text-content-secondary text-xs leading-relaxed">
              Integrates secure federated Google logins and phone number OTP verification to maintain account integrity.
            </p>
          </div>

          <div className="bg-background-secondary/30 backdrop-blur-sm border border-border-opaque p-6 rounded-xl shadow-sm space-y-3">
            <div className="h-10 w-10 rounded-lg bg-white/5 text-white flex items-center justify-center font-bold text-lg mb-2">
              <LocationIcon size={24} />
            </div>
            <h3 className="font-bold text-white text-base">Telemetry Hubs</h3>
            <p className="text-content-secondary text-xs leading-relaxed">
              Monitors spatial coordinates and telemetry for Kolkata and Bengaluru sharded regional dispatch boundaries.
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full border-t border-border-opaque bg-black py-6 mt-8">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] text-content-tertiary font-mono">
          <div className="flex items-center gap-4">
            <Link href="/privacy/" className="hover:text-white transition-colors">
              Privacy Policy
            </Link>
            <span className="text-border-opaque">|</span>
            <Link href="/terms/" className="hover:text-white transition-colors">
              Terms of Service
            </Link>
          </div>
          <div>
            <span>Vahnly © 2026. Support Contact: </span>
            <a href="mailto:karmakaraniket018@gmail.com" className="hover:text-white underline">
              karmakaraniket018@gmail.com
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
