'use client';

import React, { useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';

export default function RiderSettingsPage() {
  const [lang, setLang] = useState('English');
  const [theme, setTheme] = useState('Dark');
  const [units, setUnits] = useState('KM');
  const [currency, setCurrency] = useState('INR (₹)');
  const [locationPerm, setLocationPerm] = useState(true);
  const [notifPerm, setNotifPerm] = useState(true);

  // Fine-grained communication consent switches
  const [emailConsent, setEmailConsent] = useState(true);
  const [smsConsent, setSmsConsent] = useState(false);
  const [whatsappConsent, setWhatsappConsent] = useState(true);
  
  const handleDeleteAccount = () => {
    if (confirm('🚨 DANGER: Permanently delete your Rider account? This clears saved cars, wallets, and invoices. Irreversible.')) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
  };

  return (
    <div className="space-y-6 text-left font-sans">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">App Settings</h2>
        <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">Configure preferred themes, unit metrics, map permissions, and privacy data deletion</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs font-mono">
        
        {/* Basic Preferences */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
          <h4 className="text-xs font-bold text-white uppercase border-b border-border-opaque pb-2">Rider Preferences</h4>

          <div className="space-y-4">
            <div className="flex justify-between items-center border-b border-border-opaque pb-2">
              <span className="text-content-secondary font-sans">System Language</span>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                className="bg-background-secondary text-white outline-none rounded border border-border-opaque p-1 font-bold focus:outline-none"
              >
                <option>English</option>
                <option>Bengali</option>
                <option>Hindi</option>
              </select>
            </div>

            <div className="flex justify-between items-center border-b border-border-opaque pb-2">
              <span className="text-content-secondary font-sans">Display Theme</span>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                className="bg-background-secondary text-white outline-none rounded border border-border-opaque p-1 font-bold focus:outline-none"
              >
                <option>Dark</option>
                <option>Light</option>
                <option>System Default</option>
              </select>
            </div>

            <div className="flex justify-between items-center border-b border-border-opaque pb-2">
              <span className="text-content-secondary font-sans">Distance Units</span>
              <select
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                className="bg-background-secondary text-white outline-none rounded border border-border-opaque p-1 font-bold focus:outline-none"
              >
                <option>KM</option>
                <option>Miles</option>
              </select>
            </div>

            <div className="flex justify-between items-center border-b border-border-opaque pb-2">
              <span className="text-content-secondary font-sans">Operating Currency</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="bg-background-secondary text-white outline-none rounded border border-border-opaque p-1 font-bold focus:outline-none"
              >
                <option>INR (₹)</option>
                <option>USD ($)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Permissions & Communication Consents */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
          <h4 className="text-xs font-bold text-white uppercase border-b border-border-opaque pb-2">Permissions & Consents</h4>

          <div className="space-y-4">
            <div className="flex justify-between items-center border-b border-border-opaque pb-2">
              <span className="text-content-secondary font-sans">GPS Location Access</span>
              <button
                onClick={() => setLocationPerm(!locationPerm)}
                className={`h-5 w-10 rounded-full transition relative p-0.5 cursor-pointer ${locationPerm ? 'bg-white' : 'bg-background-secondary'}`}
              >
                <div className={`h-4 w-4 rounded-full shadow transition-transform ${locationPerm ? 'translate-x-5 bg-black' : 'translate-x-0 bg-background-tertiary'}`} />
              </button>
            </div>

            <div className="flex justify-between items-center border-b border-border-opaque pb-2">
              <span className="text-content-secondary font-sans">Push Notifications Alerts</span>
              <button
                onClick={() => setNotifPerm(!notifPerm)}
                className={`h-5 w-10 rounded-full transition relative p-0.5 cursor-pointer ${notifPerm ? 'bg-white' : 'bg-background-secondary'}`}
              >
                <div className={`h-4 w-4 rounded-full shadow transition-transform ${notifPerm ? 'translate-x-5 bg-black' : 'translate-x-0 bg-background-tertiary'}`} />
              </button>
            </div>

            <div className="flex justify-between items-center border-b border-border-opaque pb-2">
              <span className="text-content-secondary font-sans">Email Invoice Dispatch</span>
              <button
                onClick={() => setEmailConsent(!emailConsent)}
                className={`h-5 w-10 rounded-full transition relative p-0.5 cursor-pointer ${emailConsent ? 'bg-white' : 'bg-background-secondary'}`}
              >
                <div className={`h-4 w-4 rounded-full shadow transition-transform ${emailConsent ? 'translate-x-5 bg-black' : 'translate-x-0 bg-background-tertiary'}`} />
              </button>
            </div>

            <div className="flex justify-between items-center border-b border-border-opaque pb-2">
              <span className="text-content-secondary font-sans">SMS SOS Alerts</span>
              <button
                onClick={() => setSmsConsent(!smsConsent)}
                className={`h-5 w-10 rounded-full transition relative p-0.5 cursor-pointer ${smsConsent ? 'bg-white' : 'bg-background-secondary'}`}
              >
                <div className={`h-4 w-4 rounded-full shadow transition-transform ${smsConsent ? 'translate-x-5 bg-black' : 'translate-x-0 bg-background-tertiary'}`} />
              </button>
            </div>

            <div className="flex justify-between items-center border-b border-border-opaque pb-2">
              <span className="text-content-secondary font-sans">WhatsApp Booking Updates</span>
              <button
                onClick={() => setWhatsappConsent(!whatsappConsent)}
                className={`h-5 w-10 rounded-full transition relative p-0.5 cursor-pointer ${whatsappConsent ? 'bg-white' : 'bg-background-secondary'}`}
              >
                <div className={`h-4 w-4 rounded-full shadow transition-transform ${whatsappConsent ? 'translate-x-5 bg-black' : 'translate-x-0 bg-background-tertiary'}`} />
              </button>
            </div>
          </div>
        </div>

      </div>

      {/* Danger Zone */}
      <div className="bg-background-primary border border-negative-400 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-content-negative font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
          Danger Zone
        </h4>

        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 text-xs">
          <div className="text-content-secondary font-sans leading-relaxed">
            <span className="font-bold text-white block">Delete Platform Account</span>
            Permanent removal of all saved cars, addresses, and receipts ledger records.
          </div>

          <button
            onClick={handleDeleteAccount}
            className="bg-negative-400 hover:bg-negative-400 text-white font-mono font-bold text-[9px] uppercase tracking-wider py-2.5 px-4 rounded-xl cursor-pointer transition shrink-0 active:scale-95 border border-negative-400"
          >
            Delete Account
          </button>
        </div>
      </div>

    </div>
  );
}
