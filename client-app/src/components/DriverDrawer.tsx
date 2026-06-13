"use client";

import React from "react";
import Link from "next/link";
import { useDriverDutyStore } from "@/store/useDriverDutyStore";

interface DriverDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  driverProfile: {
    name: string;
    photo: string;
    rating: number;
  };
}

export const DriverDrawer: React.FC<DriverDrawerProps> = ({ isOpen, onClose, driverProfile }) => {
  const { dutyState, setDutyState } = useDriverDutyStore();

  if (!isOpen) return null;

  const navigationItems = [
    { label: "Profile", path: "/driver-account/profile", icon: "👤" },
    { label: "Trip History", path: "/driver-account/trip-history", icon: "🕒" },
    { label: "Earnings", path: "/driver-account/earnings", icon: "📊" },
    { label: "Payouts", path: "/driver-account/payouts", icon: "💳" },
    { label: "Incentives", path: "/driver-account/incentives", icon: "🏆" },
    { label: "Vehicle Management", path: "/driver-account/vehicles", icon: "🚗" },
    { label: "Performance", path: "/driver-account/performance", icon: "📈" },
    { label: "Wallet", path: "/driver-account/wallet", icon: "👛" },
    { label: "Notifications", path: "/driver-account/notifications", icon: "🔔" },
    { label: "Support Terminal", path: "/driver-account/support", icon: "💬" },
    { label: "Training & Quizzes", path: "/driver-account/training", icon: "🎓" },
    { label: "Settings", path: "/driver-account/settings", icon: "⚙️" },
  ];

  return (
    <div className="fixed inset-0 z-[99999] flex animate-fadeIn">
      {/* Dark Overlay Background */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={onClose} />
      
      {/* Sliding Content Container */}
      <div className="relative w-80 max-w-sm bg-background-primary border-r border-border-opaque p-6 shadow-2xl flex flex-col justify-between h-full overflow-y-auto text-left font-mono animate-slideInLeft">
        <div>
          {/* Profile Card Summary Section */}
          <div className="flex items-center gap-3 border-b border-border-opaque pb-5 mb-5">
            {driverProfile.photo ? (
              <img src={driverProfile.photo} alt="Driver" className="h-12 w-12 rounded-xl object-cover border border-border-opaque" />
            ) : (
              <div className="h-12 w-12 rounded-xl bg-background-secondary border border-border-opaque flex items-center justify-center text-sm font-bold text-white uppercase overflow-hidden">
                👤
              </div>
            )}
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-tight">{driverProfile.name}</h3>
              <p className="text-[10px] text-content-warning font-bold mt-0.5">★ {driverProfile.rating.toFixed(2)}</p>
            </div>
          </div>

          {/* Dynamic Online Duty Toggle Mechanism inside Drawer */}
          <div className="mb-6">
            <button
              onClick={() => setDutyState(dutyState === "OFFLINE" ? "ONLINE" : "OFFLINE")}
              className={`w-full py-3 rounded-xl text-center font-bold text-[9px] uppercase tracking-wider transition-all cursor-pointer border ${
                dutyState !== "OFFLINE"
                  ? "bg-background-secondary text-content-positive border-positive-400 hover:bg-surface-positive/20"
                  : "bg-background-secondary text-content-secondary border-border-opaque hover:text-white"
              }`}
            >
              {dutyState !== "OFFLINE" ? "● Go Offline" : "○ Go Online"}
            </button>
          </div>

          {/* Navigation Core List Links */}
          <nav className="flex flex-col gap-1">
            {navigationItems.map((item, index) => (
              <Link
                key={index}
                href={item.path}
                onClick={onClose}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-content-secondary hover:text-white hover:bg-background-secondary text-[9px] font-bold uppercase tracking-wider transition-colors"
              >
                <span className="text-xs">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>

        {/* Exit Application Action */}
        <div className="border-t border-border-opaque pt-5 mt-6">
          <Link
            href="/login"
            onClick={onClose}
            className="flex items-center justify-center gap-2.5 w-full bg-background-secondary hover:bg-background-tertiary text-content-negative hover:text-content-negative rounded-xl py-3 text-[9px] font-bold uppercase tracking-wider transition-colors border border-border-opaque"
          >
            <span>🚪</span>
            <span>Logout & Exit</span>
          </Link>
        </div>
      </div>
      <div className="flex-1 cursor-pointer" onClick={onClose} />
    </div>
  );
};
