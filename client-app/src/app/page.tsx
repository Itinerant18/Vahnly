'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';

export default function Home() {
  const router = useRouter();
  const { token, isAuthenticated } = useAuthStore();
  const [statusMessage, setStatusMessage] = useState('Initializing Secure Access...');

  useEffect(() => {
    const runBootstrapping = async () => {
      // 1. App Launch Delay (Bootstrapping phase)
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Capture initial boot information
      const bootInfo = {
        boot_timestamp_utc: Math.floor(Date.now() / 1000),
        device_fingerprint: 'anon-device-' + Math.random().toString(36).substring(2, 15),
        client_runtime_build: 'v2.4.1-prod',
        initial_coordinate_snapshot: [22.57264, 88.36389]
      };
      
      try {
        localStorage.setItem('boot_audit_log', JSON.stringify(bootInfo));
      } catch (e) {
        console.warn('LocalStorage unavailable for boot auditing:', e);
      }

      // 2. Local Secure Storage Auth Token Validation
      if (!token || !isAuthenticated) {
        setStatusMessage('Authentication Required. Redirecting...');
        await new Promise(resolve => setTimeout(resolve, 800));
        router.push('/login');
        return;
      }

      // 3. Verify User Session Status (Check for active ongoing trips)
      setStatusMessage('Verifying Session Integrity...');
      const activeTripId = localStorage.getItem('active_trip_id');
      
      if (activeTripId) {
        setStatusMessage('Active Ride State Detected. Restoring trip...');
        await new Promise(resolve => setTimeout(resolve, 800));
        router.push(`/rider/trip/live?tripId=${encodeURIComponent(activeTripId)}`);
        return;
      }

      // 4. Check Onboarding Completion
      setStatusMessage('Checking Onboarding Completion...');
      const onboardingCompleted = localStorage.getItem('rider_onboarding_completed') === 'true';
      await new Promise(resolve => setTimeout(resolve, 600));

      if (onboardingCompleted) {
        setStatusMessage('Onboarding Verified. Redirecting...');
        router.push('/rider');
      } else {
        setStatusMessage('Setup Required. Redirecting to onboarding...');
        router.push('/onboarding');
      }
    };

    runBootstrapping();
  }, [token, isAuthenticated, router]);

  return (
    <div className="min-h-screen relative flex flex-col justify-center items-center p-6 bg-black text-white font-sans overflow-hidden selection:bg-white selection:text-black">
      {/* Grid line matrix background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-20" />
      <div className="absolute inset-0 bg-gradient-to-tr from-zinc-950 via-black to-zinc-900 z-0 animate-pulse" />

      {/* Main Core Loader */}
      <div className="relative z-10 text-center space-y-6">
        <h1 className="text-4xl font-extrabold tracking-tight font-move bg-gradient-to-r from-white via-zinc-400 to-zinc-600 bg-clip-text text-transparent">
          DRIVERS-FOR-U
        </h1>
        
        <div className="flex flex-col items-center gap-3">
          <div className="relative flex h-8 w-8">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-20"></span>
            <span className="relative inline-flex rounded-full h-8 w-8 bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <span className="h-2 w-2 rounded-full bg-white animate-pulse"></span>
            </span>
          </div>
          <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-500 font-bold select-none">
            {statusMessage}
          </span>
        </div>
      </div>

      <footer className="absolute bottom-8 left-6 right-6 flex justify-between items-center text-[9px] text-zinc-600 font-mono select-none">
        <span>SECURITY: SHA-256 SESSION LOCK</span>
        <span>BUILD: v2.4.1-prod</span>
      </footer>
    </div>
  );
}
