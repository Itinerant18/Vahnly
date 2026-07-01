'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store/authStore';
import { ordersApi } from '@/lib/api/orders';
import Link from 'next/link';
import WebGLShaderBackground from '@/components/ui/WebGLShaderBackground';
import { ShieldIcon, BoltIcon, WalletIcon, HeadsetIcon, ForwardIcon } from '@/components/ds/Icon';

// Statuses for which an in-progress trip should send the rider straight to the
// live screen instead of the home tab.
const LIVE_TRIP_STATUSES = [
  'ASSIGNED',
  'EN_ROUTE_TO_PICKUP',
  'ARRIVED_AT_PICKUP',
  'DELIVERING',
] as const;

export default function IndexPage() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const [mounted, setMounted] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!token) return;
    // Logged-in rider: check for an active trip before routing. If one is
    // in progress, jump to the live screen; otherwise land on home.
    let cancelled = false;
    ordersApi
      .active()
      .then((res) => {
        if (cancelled) return;
        const status = res.order?.status;
        if (status && (LIVE_TRIP_STATUSES as readonly string[]).includes(status)) {
          router.replace('/trip/live');
        } else {
          router.replace('/home');
        }
      })
      .catch(() => {
        if (!cancelled) router.replace('/home');
      });
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 10) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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
    <div className="bg-[#f8f9ff] text-[#0b1c30] relative min-h-screen overflow-x-hidden selection:bg-secondary selection:text-white flex flex-col font-sans">
      {/* Background Shader & Overlay Grid */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 w-full h-full opacity-60">
          <WebGLShaderBackground />
        </div>
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#e5e7eb_1px,transparent_1px),linear-gradient(to_bottom,#e5e7eb_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_70%,transparent_100%)] opacity-20" />
      </div>

      {/* TopNavBar */}
      <nav
        className={`fixed top-0 w-full z-50 transition-all duration-300 ${scrolled
          ? 'bg-white/95 shadow-md border-b border-slate-200/50'
          : 'bg-white/80 backdrop-blur-xl border-b border-slate-200/20 md:bg-transparent md:border-none md:backdrop-blur-none'
          }`}
        id="mainNav"
      >
        <div className="flex justify-between items-center px-6 py-4 max-w-7xl mx-auto">
          {/* Brand */}
          <Link href="#" className="flex items-center gap-2 cursor-pointer group">
            <div className="w-8 h-8 rounded-full bg-black flex items-center justify-center text-white font-bold text-lg group-hover:scale-95 transition-transform">
              V
            </div>
            <span className="font-extrabold text-black text-xl tracking-tight">Vahnly</span>
          </Link>

          {/* Desktop Nav Links */}
          {/* <div className="hidden md:flex items-center gap-8">
            <Link href="#" className="text-sm text-secondary font-bold border-b-2 border-secondary pb-0.5 hover:opacity-90 transition-all">
              Fleet
            </Link>
            <Link href="#" className="text-sm text-[#45474b] hover:text-secondary hover:bg-slate-100/50 px-2 py-1 rounded transition-all duration-300">
              Services
            </Link>
            <Link href="#" className="text-sm text-[#45474b] hover:text-secondary hover:bg-slate-100/50 px-2 py-1 rounded transition-all duration-300">
              Safety
            </Link>
            <Link href="#" className="text-sm text-[#45474b] hover:text-secondary hover:bg-slate-100/50 px-2 py-1 rounded transition-all duration-300">
              Business
            </Link>
          </div> */}

          {/* Trailing Action */}
          <div className="flex items-center gap-4">
            <Link href="/login/" className="text-sm font-semibold text-slate-700 hover:text-secondary transition-colors">
              Log In
            </Link>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-grow pt-32 pb-24 px-6 max-w-7xl mx-auto w-full flex flex-col items-center relative z-10">

        {/* Hero Section */}
        <section className="w-full max-w-3xl mx-auto text-center mb-20 animate-fade-in-up">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container-low text-secondary font-semibold text-xs mb-6 mx-auto shadow-sm border border-secondary/10">
            <span className="w-2 h-2 rounded-full bg-secondary animate-pulse"></span>
            Verified Professional Driver Dispatch
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-[#0b1c30] mb-6 tracking-tight leading-tight">
            Hire a Professional <br className="hidden md:block" />
            <span className="text-black">Driver</span> <br className="hidden md:block" />
            <span className="text-secondary bg-clip-text">For Your Own Car</span>
          </h1>
          <p className="text-base md:text-lg text-[#45474b] mb-10 max-w-2xl mx-auto leading-relaxed">
            Vahnly provides a premium, safe, and dynamic ride matching ecosystem. Connect instantly with verified, highly trained independent drivers to navigate your car, whether for daily commutes, road trips, or late-night events.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/login/" className="w-full sm:w-auto bg-black text-white px-8 py-3.5 rounded-xl text-base font-semibold hover:bg-slate-900 shadow-[0_4px_20px_rgba(0,0,0,0.15)] active:scale-95 transition-all flex items-center justify-center gap-2">
              Get Started Now
              <ForwardIcon size={16} />
            </Link>
            <a href="#features" className="w-full sm:w-auto bg-white border border-slate-300 text-slate-700 px-8 py-3.5 rounded-xl text-base font-semibold hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center">
              Learn More
            </a>
          </div>
        </section>

        {/* Bento Grid Features */}
        <section id="features" className="w-full max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

            {/* Feature 1: Large Span */}
            <div className="glass-card rounded-2xl p-6 flex flex-col gap-4 animate-fade-in-up hover:-translate-y-1 hover:shadow-lg transition-all duration-300 cursor-default group md:col-span-2 lg:col-span-2">
              <div className="w-12 h-12 rounded-xl bg-surface-container-highest text-secondary flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                <ShieldIcon size={24} className="text-secondary" />
              </div>
              <div>
                <h3 className="font-bold text-[#0b1c30] text-lg mb-2">Verified Drivers</h3>
                <p className="text-sm text-[#45474b] leading-relaxed">
                  Every driver undergoes rigorous background verification, identity matching, and driving assessments to guarantee your absolute safety and peace of mind on every journey.
                </p>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="glass-card rounded-2xl p-6 flex flex-col gap-4 animate-fade-in-up delay-100 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 cursor-default group">
              <div className="w-12 h-12 rounded-xl bg-surface-container-highest text-secondary flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                <BoltIcon size={24} className="text-secondary" />
              </div>
              <div>
                <h3 className="font-bold text-[#0b1c30] text-lg mb-2">Instant Dispatch</h3>
                <p className="text-sm text-[#45474b] leading-relaxed">
                  Our advanced matching algorithm pairs you with the closest qualified driver within minutes, minimizing wait times.
                </p>
              </div>
            </div>

            {/* Feature 3 */}
            <div className="glass-card rounded-2xl p-6 flex flex-col gap-4 animate-fade-in-up delay-200 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 cursor-default group">
              <div className="w-12 h-12 rounded-xl bg-surface-container-highest text-secondary flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                <WalletIcon size={24} className="text-secondary" />
              </div>
              <div>
                <h3 className="font-bold text-[#0b1c30] text-lg mb-2">Transparent Pricing</h3>
                <p className="text-sm text-[#45474b] leading-relaxed">
                  Standardized fares calculated dynamically using precise distance routing, ensuring absolutely no hidden charges.
                </p>
              </div>
            </div>

            {/* Feature 4: Wide layout */}
            <div className="glass-card rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center gap-6 animate-fade-in-up delay-300 md:col-span-2 lg:col-span-2 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 cursor-default group">
              <div className="w-14 h-14 shrink-0 rounded-xl bg-surface-container-highest text-secondary flex items-center justify-center group-hover:scale-110 transition-transform">
                <HeadsetIcon size={28} className="text-secondary" />
              </div>
              <div>
                <h3 className="font-bold text-[#0b1c30] text-lg mb-2">24/7 Premium Support</h3>
                <p className="text-sm text-[#45474b] leading-relaxed">
                  Dedicated concierge-level support available around the clock. Whether you need route adjustments or have special requests, our team is always ready to assist.
                </p>
              </div>
            </div>

          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full py-12 bg-white border-t border-slate-200 mt-20 relative z-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex flex-col items-center md:items-start gap-2">
            <span className="text-2xl font-extrabold text-black">Vahnly</span>
            <p className="text-xs text-slate-500">© 2026 Vahnly Premium Services. All rights reserved.</p>
          </div>
          <div className="flex flex-wrap justify-center gap-6 text-xs text-slate-500 font-semibold">
            <Link href="/privacy/" className="hover:text-secondary transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms/" className="hover:text-secondary transition-colors">
              Terms of Service
            </Link>
            <a href="mailto:karmakaraniket018@gmail.com" className="hover:text-secondary transition-colors font-mono">
              Contact Us
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
