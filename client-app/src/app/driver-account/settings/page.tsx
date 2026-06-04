'use client';

import React, { useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';

export default function DriverSettingsPage() {
  const [lang, setLang] = useState('English');
  const [navApp, setNavApp] = useState('Google Maps');
  const [darkMode, setDarkMode] = useState(true);
  const [pushNotif, setPushNotif] = useState(true);
  const [biometric, setBiometric] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      alert('Provide both current and new passwords.');
      return;
    }
    alert('Password updated successfully.');
    setCurrentPassword('');
    setNewPassword('');
  };

  const handleDeleteAccount = () => {
    if (confirm('🚨 DANGER ZONE: Are you sure you want to permanently delete your Driver Partner account and clear all escrow history? This action is irreversible.')) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">Account Settings</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Configure navigation preferences, biometrics, notification targets, and passwords</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Toggle options */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
            App Preferences
          </h4>

          <div className="space-y-4 text-xs font-mono">
            {/* Lang select */}
            <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
              <span className="text-zinc-400 font-sans">System Language</span>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                className="bg-zinc-900 text-white outline-none rounded border border-zinc-800 p-1 font-bold"
              >
                <option>English</option>
                <option>Bengali</option>
                <option>Hindi</option>
                <option>Kannada</option>
              </select>
            </div>

            {/* Nav select */}
            <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
              <span className="text-zinc-400 font-sans">Navigation Target Map</span>
              <select
                value={navApp}
                onChange={(e) => setNavApp(e.target.value)}
                className="bg-zinc-900 text-white outline-none rounded border border-zinc-800 p-1 font-bold"
              >
                <option>Google Maps</option>
                <option>Mapbox Core</option>
                <option>Apple Maps</option>
              </select>
            </div>

            {/* Dark mode */}
            <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
              <span className="text-zinc-400 font-sans">Dark Mode Theme</span>
              <button
                onClick={() => setDarkMode(!darkMode)}
                className={`h-5 w-10 rounded-full transition relative p-0.5 cursor-pointer ${darkMode ? 'bg-white' : 'bg-zinc-800'}`}
              >
                <div className={`h-4 w-4 rounded-full shadow transition-transform ${darkMode ? 'translate-x-5 bg-black' : 'translate-x-0 bg-zinc-400'}`} />
              </button>
            </div>

            {/* Push notification */}
            <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
              <span className="text-zinc-400 font-sans">Push Notifications</span>
              <button
                onClick={() => setPushNotif(!pushNotif)}
                className={`h-5 w-10 rounded-full transition relative p-0.5 cursor-pointer ${pushNotif ? 'bg-white' : 'bg-zinc-800'}`}
              >
                <div className={`h-4 w-4 rounded-full shadow transition-transform ${pushNotif ? 'translate-x-5 bg-black' : 'translate-x-0 bg-zinc-400'}`} />
              </button>
            </div>

            {/* Biometric login */}
            <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
              <span className="text-zinc-400 font-sans">FaceID / TouchID Biometrics</span>
              <button
                onClick={() => setBiometric(!biometric)}
                className={`h-5 w-10 rounded-full transition relative p-0.5 cursor-pointer ${biometric ? 'bg-white' : 'bg-zinc-800'}`}
              >
                <div className={`h-4 w-4 rounded-full shadow transition-transform ${biometric ? 'translate-x-5 bg-black' : 'translate-x-0 bg-zinc-400'}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Change password */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
            Change Password
          </h4>

          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <label className="block text-[8px] font-bold text-zinc-500 uppercase font-mono mb-1.5">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-zinc-900 border border-zinc-850 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-zinc-500 font-mono"
                required
              />
            </div>
            <div>
              <label className="block text-[8px] font-bold text-zinc-500 uppercase font-mono mb-1.5">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-zinc-900 border border-zinc-850 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-zinc-500 font-mono"
                required
              />
            </div>

            <button
              type="submit"
              className="w-full bg-white hover:bg-zinc-200 text-black py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer active:scale-95"
            >
              Update Password
            </button>
          </form>
        </div>

      </div>

      {/* Danger Zone */}
      <div className="bg-zinc-950 border border-red-950 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-red-500 font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          Danger Zone
        </h4>

        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 text-xs">
          <div className="text-zinc-400 font-sans leading-relaxed">
            <span className="font-bold text-white block">Delete Partner Account</span>
            Permanent removal of all KYC documents, vehicle history, and wallet details.
          </div>

          <button
            onClick={handleDeleteAccount}
            className="bg-red-600 hover:bg-red-700 text-white font-mono font-bold text-[9px] uppercase tracking-wider py-2.5 px-4 rounded-xl cursor-pointer transition shrink-0 active:scale-95 border border-red-500"
          >
            Delete Account
          </button>
        </div>
      </div>

    </div>
  );
}
