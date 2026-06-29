'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import AuthGuard from '../../components/AuthGuard';
import { useAuthStore } from '@/store/useAuthStore';

import {
  IconFolder as FolderIcon
} from '@tabler/icons-react';
import {
  CarIcon,
  UserIcon,
  CardIcon,
  WalletIcon,
  GiftIcon,
  TrophyIcon,
  LocationIcon,
  SirenIcon,
  ShieldIcon,
  NotificationIcon,
  SettingsIcon,
  ChatIcon,
  DocumentIcon,
  LogoutDoorIcon,
  MenuIcon,
  SuccessIcon
} from '@/components/ds/Icon';

export default function RiderAccountLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);

  React.useEffect(() => {
    // Sync avatar from local storage
    const storedAvatar = localStorage.getItem('rider_avatar');
    if (storedAvatar) {
      setAvatar(storedAvatar);
    }
    
    // Listen for avatar updates in the same window
    const handleAvatarUpdate = () => {
      const updated = localStorage.getItem('rider_avatar');
      setAvatar(updated);
    };
    window.addEventListener('rider_avatar_changed', handleAvatarUpdate);
    return () => window.removeEventListener('rider_avatar_changed', handleAvatarUpdate);
  }, []);

  const riderName = user?.name || 'Sarah Connor';
  const riderID = user?.id || 'usr-mock-11';

  const menuItems: { label: string; href: string; icon: React.ReactNode }[] = [
    { label: 'My Garage', href: '/account/garage', icon: <CarIcon size={18} /> },
    { label: 'Trip History', href: '/account/bookings', icon: <FolderIcon size={18} /> },
    { label: 'My Profile', href: '/account/profile', icon: <UserIcon size={18} /> },
    { label: 'Payments & Methods', href: '/account/payments', icon: <CardIcon size={18} /> },
    { label: 'Wallet Balance', href: '/account/wallet', icon: <WalletIcon size={18} /> },
    { label: 'Promos & Rewards', href: '/account/rewards', icon: <GiftIcon size={18} /> },
    { label: 'Refer & Earn', href: '/account/refer', icon: <TrophyIcon size={18} /> },
    { label: 'Saved Places', href: '/account/places', icon: <LocationIcon size={18} /> },
    { label: 'Emergency Contacts', href: '/account/emergency', icon: <SirenIcon size={18} /> },
    { label: 'Insurance & Care', href: '/account/insurance', icon: <ShieldIcon size={18} /> },
    { label: 'Notifications Inbox', href: '/account/notifications', icon: <NotificationIcon size={18} /> },
    { label: 'System Settings', href: '/account/settings', icon: <SettingsIcon size={18} /> },
    { label: 'Support & FAQs', href: '/account/support', icon: <ChatIcon size={18} /> },
    { label: 'Legal Policies', href: '/account/legal', icon: <DocumentIcon size={18} /> }
  ];

  return (
    <AuthGuard allowedRole="RIDER">
      <div className="min-h-screen bg-black text-white font-sans flex flex-col md:flex-row relative">
        
        {/* 1. LEFT SIDEBAR FOR DESKTOP SCREEN RESOLUTIONS */}
        <aside className="hidden md:flex md:w-72 bg-background-primary border-r border-border-opaque flex-col justify-between p-6 shrink-0 text-left h-screen sticky top-0">
          <div className="overflow-y-auto space-y-6 scrollbar-thin pr-1">
            {/* Logo */}
            <div className="pb-4 border-b border-border-opaque">
              <h2 className="text-sm font-extrabold tracking-widest font-mono text-white">VAHNLY</h2>
              <span className="text-[8px] font-mono text-content-tertiary uppercase tracking-widest">Rider Portal Console</span>
            </div>

            {/* Profile info */}
            <div className="flex items-center gap-3 bg-background-secondary/40 p-3 border border-border-opaque rounded-xl">
              {avatar ? (
                <img 
                  src={avatar} 
                  alt="Profile" 
                  className="h-10 w-10 rounded-lg object-cover border border-border-opaque"
                />
              ) : (
                <div className="h-10 w-10 bg-background-tertiary rounded-lg flex items-center justify-center text-xs text-content-tertiary border border-border-opaque">
                  <UserIcon size={18} />
                </div>
              )}
              <div className="truncate">
                <div className="flex items-center gap-1.5">
                  <h4 className="text-xs font-bold text-white truncate">{riderName}</h4>
                  <span className="text-[10px] text-content-positive" title="Verified Driver Partner / Asset Owner"><SuccessIcon size={12} /></span>
                </div>
                <span className="text-[9px] font-mono text-content-tertiary block truncate">{riderID.toUpperCase()}</span>
              </div>
            </div>

            {/* Nav lists */}
            <nav className="space-y-1">
              {menuItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-center gap-3 py-2.5 px-3 rounded-lg text-[10px] font-bold text-content-secondary hover:text-white hover:bg-background-secondary border border-transparent hover:border-border-opaque transition-all font-mono uppercase tracking-wider"
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
              className="w-full bg-background-secondary hover:bg-background-tertiary text-content-secondary hover:text-white rounded-lg py-2.5 text-[9px] font-bold uppercase tracking-wider transition font-mono border border-border-opaque cursor-pointer flex items-center justify-center gap-1.5"
            >
              <LogoutDoorIcon size={14} /> Terminate Session
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
              <MenuIcon size={18} />
            </button>
            <h2 className="text-xs font-bold font-mono tracking-widest text-white">RIDER PORTAL</h2>
          </div>
        </div>

        {/* 3. MOBILE MENU SIDE DRAWER POPUP */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden bg-black/60 backdrop-blur-sm animate-fadeIn">
            <div className="w-72 bg-background-primary border-r border-border-opaque h-full flex flex-col justify-between p-6 animate-slideInLeft text-left">
              <div className="overflow-y-auto space-y-6">
                <div className="flex justify-between items-center pb-4 border-b border-border-opaque">
                  <h2 className="text-xs font-bold font-mono text-white">DRAWER MENU</h2>
                  <button 
                    onClick={() => setMobileMenuOpen(false)}
                    className="text-xs text-content-tertiary font-bold font-mono"
                  >
                    CLOSE
                  </button>
                </div>

                {/* Mobile Identity Apex Card */}
                <div className="flex items-center gap-3 bg-background-secondary/40 p-3 border border-border-opaque rounded-xl">
                  {avatar ? (
                    <img 
                      src={avatar} 
                      alt="Profile" 
                      className="h-10 w-10 rounded-lg object-cover border border-border-opaque"
                    />
                  ) : (
                    <div className="h-10 w-10 bg-background-tertiary rounded-lg flex items-center justify-center text-xs text-content-tertiary border border-border-opaque">
                      <UserIcon size={18} />
                    </div>
                  )}
                  <div className="truncate">
                    <div className="flex items-center gap-1.5">
                      <h4 className="text-xs font-bold text-white truncate">{riderName}</h4>
                      <span className="text-[10px] text-content-positive"><SuccessIcon size={12} /></span>
                    </div>
                    <span className="text-[9px] font-mono text-content-tertiary block truncate">{riderID.toUpperCase()}</span>
                  </div>
                </div>

                <nav className="space-y-1">
                  {menuItems.map((item) => (
                    <Link
                      key={item.label}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-3 py-2 px-3 rounded-lg text-[10px] font-bold text-content-secondary hover:text-white hover:bg-background-secondary transition-all font-mono uppercase tracking-wider"
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
                  className="w-full bg-background-secondary hover:bg-background-tertiary text-content-tertiary hover:text-white border border-border-opaque rounded-lg py-2 text-[9px] font-bold uppercase tracking-wider transition font-mono flex items-center justify-center gap-1.5"
                >
                  <LogoutDoorIcon size={14} /> Logout
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
