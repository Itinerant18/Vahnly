'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import AuthGuard from '../../components/AuthGuard';
import { useAuthStore } from '@/store/useAuthStore';

export default function DriverAccountLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const driverName = user?.name || 'Aniket Karmakar';
  const driverID = user?.id || 'drv-aniket-7602';

  const menuItems = [
    { label: 'Dashboard Home', href: '/driver', icon: '📱' },
    { label: 'My Profile', href: '/driver-account/profile', icon: '👤' },
    { label: 'Earnings Summary', href: '/driver-account/earnings', icon: '₹' },
    { label: 'Instant Payouts', href: '/driver-account/payouts', icon: '💳' },
    { label: 'Trip History', href: '/driver-account/trip-history', icon: '📁' },
    { label: 'Incentives & Quests', href: '/driver-account/incentives', icon: '🏆' },
    { label: 'Vehicle Records', href: '/driver-account/vehicles', icon: '🚗' },
    { label: 'Performance Analytics', href: '/driver-account/performance', icon: '📊' },
    { label: 'Platform Wallet', href: '/driver-account/wallet', icon: '💼' },
    { label: 'Notifications Inbox', href: '/driver-account/notifications', icon: '🔔' },
    { label: 'Training Academy', href: '/driver-account/training', icon: '🎓' },
    { label: 'Refer a Friend', href: '/driver-account/refer', icon: '🎁' },
    { label: 'System Settings', href: '/driver-account/settings', icon: '⚙️' },
    { label: 'Support & FAQs', href: '/driver-account/support', icon: '💬' }
  ];

  return (
    <AuthGuard allowedRole="DRIVER">
      <div className="min-h-screen bg-background-primary text-content-primary font-sans flex flex-col md:flex-row relative">
        
        {/* 1. LEFT SIDEBAR FOR DESKTOP SCREEN RESOLUTIONS */}
        <aside className="hidden md:flex md:w-72 bg-background-primary border-r border-border-opaque flex-col justify-between p-6 shrink-0 text-left h-screen sticky top-0">
          <div className="overflow-y-auto space-y-6 scrollbar-thin pr-1">
            {/* Logo */}
            <div className="pb-4 border-b border-border-opaque">
              <h2 className="text-sm font-extrabold tracking-widest font-mono text-content-primary">VAHNLY</h2>
              <span className="text-[8px] font-mono text-content-tertiary uppercase tracking-widest">Core Account Hub</span>
            </div>

            {/* Profile recap */}
            <div className="flex items-center gap-3 bg-background-secondary/40 p-3 border border-border-opaque rounded-xl">
              <div className="h-10 w-10 bg-background-tertiary rounded-lg flex items-center justify-center text-xs">
                👤
              </div>
              <div className="truncate">
                <h4 className="text-xs font-bold text-content-primary truncate">{driverName}</h4>
                <span className="text-[9px] font-mono text-content-tertiary block truncate">{driverID.toUpperCase()}</span>
              </div>
            </div>

            {/* Nav lists */}
            <nav className="space-y-1">
              {menuItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-center gap-3 py-2.5 px-3 rounded-lg text-[10px] font-bold text-content-secondary hover:text-content-primary hover:bg-background-secondary border border-transparent hover:border-border-opaque transition-all font-mono uppercase tracking-wider"
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>
          </div>

          <div className="border-t border-border-opaque pt-4 mt-4">
            <button
              onClick={() => {
                useAuthStore.getState().logout();
                window.location.href = '/login';
              }}
              className="w-full bg-background-secondary hover:bg-background-tertiary text-content-secondary hover:text-content-primary rounded-lg py-2.5 text-[9px] font-bold uppercase tracking-wider transition font-mono border border-border-opaque cursor-pointer"
            >
              🚪 Terminate Session
            </button>
          </div>
        </aside>

        {/* 2. RESPONSIVE MOBILE TOP NAVIGATION HEADER BAR */}
        <div className="md:hidden bg-background-primary border-b border-border-opaque p-4 flex justify-between items-center w-full sticky top-0 z-50">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Open menu"
              className="h-8 w-8 bg-background-secondary rounded-lg border border-border-opaque flex items-center justify-center text-sm cursor-pointer"
            >
              ☰
            </button>
            <h2 className="text-xs font-bold font-mono tracking-widest text-content-primary">CORE ACCT HUB</h2>
          </div>

          <Link href="/driver" className="text-[9px] font-mono font-bold uppercase tracking-wider border border-border-opaque px-3 py-1.5 rounded-full hover:bg-background-secondary transition">
            ← Duty Console
          </Link>
        </div>

        {/* 3. MOBILE MENU SIDE DRAWER POPUP */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden bg-black/60 backdrop-blur-sm animate-fadeIn">
            <div className="w-72 bg-background-primary border-r border-border-opaque h-full flex flex-col justify-between p-6 animate-slideInLeft text-left">
              <div className="overflow-y-auto space-y-6">
                <div className="flex justify-between items-center pb-4 border-b border-border-opaque">
                  <h2 className="text-xs font-bold font-mono text-content-primary">ACCOUNTS</h2>
                  <button 
                    onClick={() => setMobileMenuOpen(false)}
                    className="text-xs text-content-tertiary font-bold font-mono"
                  >
                    CLOSE
                  </button>
                </div>

                <nav className="space-y-1">
                  {menuItems.map((item) => (
                    <Link
                      key={item.label}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-3 py-2 px-3 rounded-lg text-[10px] font-bold text-content-secondary hover:text-content-primary hover:bg-background-secondary transition-all font-mono uppercase tracking-wider"
                    >
                      <span>{item.icon}</span>
                      <span>{item.label}</span>
                    </Link>
                  ))}
                </nav>
              </div>

              <div className="border-t border-border-opaque pt-4">
                <button
                  onClick={() => {
                    useAuthStore.getState().logout();
                    window.location.href = '/login';
                  }}
                  className="w-full bg-background-secondary hover:bg-background-tertiary text-content-tertiary hover:text-content-primary border border-border-opaque rounded-lg py-2 text-[9px] font-bold uppercase tracking-wider transition font-mono"
                >
                  🚪 Logout
                </button>
              </div>
            </div>
            <div className="flex-1 cursor-pointer" onClick={() => setMobileMenuOpen(false)} />
          </div>
        )}

        {/* 4. MAIN CENTRAL CONTENT AREA PANEL */}
        <main className="flex-1 p-4 sm:p-8 overflow-y-auto h-screen max-w-4xl mx-auto w-full">
          {children}
        </main>

      </div>
    </AuthGuard>
  );
}
