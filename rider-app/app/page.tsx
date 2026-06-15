'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store/authStore';
import Link from 'next/link';

export default function IndexPage() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (token) {
      router.replace('/home');
    }
  }, [token, router]);

  if (!mounted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-400">
        <div className="text-center space-y-2">
          <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin mx-auto" />
          <p className="text-xs font-mono tracking-widest uppercase">Loading...</p>
        </div>
      </main>
    );
  }

  // If logged in, do not render the landing page to avoid layout shifts during redirect
  if (token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-400">
        <div className="text-center space-y-2">
          <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin mx-auto" />
          <p className="text-xs font-mono tracking-widest uppercase">Redirecting...</p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col justify-between selection:bg-slate-900 selection:text-white">
      {/* Subtle grid pattern background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-40 pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 w-full max-w-6xl mx-auto px-6 py-6 flex justify-between items-center border-b border-slate-200/60">
        <div className="flex items-center gap-2">
          <span className="h-8 w-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-lg shadow-sm">
            D
          </span>
          <span className="font-extrabold text-slate-900 tracking-tight text-lg">
            Drivers-for-u
          </span>
        </div>
        
        <Link
          href="/login/"
          className="flex items-center justify-center h-10 px-5 rounded-lg bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-all shadow-sm"
        >
          Sign In
        </Link>
      </header>

      {/* Main Hero & Purpose Details */}
      <main className="relative z-10 w-full max-w-4xl mx-auto px-6 py-12 md:py-20 flex-grow flex flex-col justify-center gap-12 text-center md:text-left">
        <div className="space-y-6 max-w-2xl animate-enter-up">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 animate-pulse" />
            Verified Professional Driver Dispatch
          </span>
          
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-950 leading-tight">
            Hire a Professional Driver <br />
            <span className="bg-gradient-to-r from-indigo-600 to-indigo-800 bg-clip-text text-transparent">
              For Your Own Car
            </span>
          </h1>
          
          <p className="text-slate-600 text-base md:text-lg leading-relaxed">
            Drivers-for-u provides a premium, safe, and dynamic ride matching ecosystem. 
            Connect instantly with verified, highly trained independent drivers to navigate your car, 
            whether for daily commutes, road trips, or late-night events.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start pt-4">
            <Link
              href="/login/"
              className="flex items-center justify-center h-12 px-8 rounded-lg bg-slate-900 text-white font-semibold text-base hover:bg-indigo-700 transition-all shadow-md hover:-translate-y-0.5"
            >
              Get Started Now
            </Link>
            <a
              href="#features"
              className="flex items-center justify-center h-12 px-8 rounded-lg border border-slate-300 bg-white text-slate-700 font-semibold text-base hover:bg-slate-50 transition-all shadow-sm"
            >
              Learn More
            </a>
          </div>
        </div>

        {/* Features / Purpose Outline Grid */}
        <section id="features" className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-12 border-t border-slate-200/80">
          <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-sm space-y-3">
            <div className="h-10 w-10 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold text-lg mb-2">
              🛡️
            </div>
            <h3 className="font-bold text-slate-900 text-base">Verified Drivers</h3>
            <p className="text-slate-500 text-sm leading-relaxed">
              Every driver undergoes rigorous background verification, identity matching, and driving assessments to guarantee your absolute safety.
            </p>
          </div>

          <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-sm space-y-3">
            <div className="h-10 w-10 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold text-lg mb-2">
              ⚡
            </div>
            <h3 className="font-bold text-slate-900 text-base">Instant Dispatch</h3>
            <p className="text-slate-500 text-sm leading-relaxed">
              Our advanced matching algorithm pairs you with the closest qualified driver in Kolkata or Bengaluru within minutes.
            </p>
          </div>

          <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-sm space-y-3">
            <div className="h-10 w-10 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold text-lg mb-2">
              💰
            </div>
            <h3 className="font-bold text-slate-900 text-base">Transparent Pricing</h3>
            <p className="text-slate-500 text-sm leading-relaxed">
              Standardized fares calculated dynamically using precise distance routing, ensuring no hidden charges or surprises.
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full border-t border-slate-200 bg-white/80 backdrop-blur-sm py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-4">
            <Link href="/privacy/" className="hover:text-slate-950 font-semibold transition-colors">
              Privacy Policy
            </Link>
            <span className="text-slate-300">|</span>
            <Link href="/terms/" className="hover:text-slate-950 font-semibold transition-colors">
              Terms of Service
            </Link>
          </div>
          <div>
            <span>Drivers-for-u © 2026. Admin Contact: </span>
            <a href="mailto:karmakaraniket018@gmail.com" className="hover:text-slate-950 underline font-mono">
              karmakaraniket018@gmail.com
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
