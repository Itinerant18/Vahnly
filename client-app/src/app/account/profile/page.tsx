'use client';

import React, { useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';

export default function RiderProfilePage() {
  const { user } = useAuthStore();
  const riderName = user?.name || 'Sarah Connor';
  const riderPhone = user?.phone || '+91 99999 88888';

  const [isEditing, setIsEditing] = useState(false);
  const [email, setEmail] = useState('sarah@skynet.com');
  const [dob, setDob] = useState('1985-05-12');
  const [gender, setGender] = useState('Female');
  const [lang, setLang] = useState('English');
  const [emailVerified, setEmailVerified] = useState(true);
  const [kycLevel, setKycLevel] = useState('Verified');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsEditing(false);
    alert('Profile preferences updated successfully.');
  };

  const handleVerifyEmail = () => {
    alert('Verification OTP link dispatched to email inbox.');
  };

  const handleChangePhone = () => {
    const newPhone = prompt('Enter new phone number (with country code):');
    if (newPhone) {
      alert(`OTP verification SMS dispatched to ${newPhone}.`);
    }
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">My Profile Details</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Manage personal settings and check KYC authorization status</p>
      </div>

      {/* Account Overview */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-6 flex flex-col sm:flex-row gap-6 items-center">
        <div className="h-16 w-16 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center text-2xl shrink-0">
          👤
        </div>
        
        <div className="space-y-1 text-center sm:text-left flex-grow">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <h3 className="text-base font-bold text-white">{riderName}</h3>
            <span className="bg-emerald-950/20 text-emerald-400 border border-emerald-900 px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider w-max mx-auto sm:mx-0">
              KYC {kycLevel}
            </span>
          </div>
          <p className="text-xs text-zinc-500 font-mono">{riderPhone} • City: Kolkata</p>
        </div>
      </div>

      {/* Profile Form */}
      <form onSubmit={handleSave} className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
        <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">Personal Settings</h4>
          <button
            type="button"
            onClick={() => setIsEditing(!isEditing)}
            className="text-[9px] font-mono font-bold text-zinc-400 hover:text-white uppercase tracking-wider cursor-pointer"
          >
            {isEditing ? 'Cancel' : 'Edit Info'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <div>
            <label className="block text-[8px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Email Address</label>
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!isEditing}
                className="flex-grow bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-white focus:outline-none"
              />
              {!isEditing && !emailVerified && (
                <button
                  type="button"
                  onClick={handleVerifyEmail}
                  className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 text-amber-500 text-[8px] px-2.5 rounded-xl cursor-pointer"
                >
                  Verify
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-[8px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Phone Number</label>
            <div className="flex gap-2">
              <input
                type="tel"
                value={riderPhone}
                disabled
                className="flex-grow bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-zinc-500 focus:outline-none"
              />
              {isEditing && (
                <button
                  type="button"
                  onClick={handleChangePhone}
                  className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 text-zinc-300 text-[8px] px-2.5 rounded-xl cursor-pointer"
                >
                  Change
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-[8px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Date of Birth</label>
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              disabled={!isEditing}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[8px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Gender</label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              disabled={!isEditing}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-white focus:outline-none"
            >
              <option>Male</option>
              <option>Female</option>
              <option>Other</option>
            </select>
          </div>

          <div>
            <label className="block text-[8px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Language preference</label>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              disabled={!isEditing}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-white focus:outline-none"
            >
              <option>English</option>
              <option>Bengali</option>
              <option>Hindi</option>
            </select>
          </div>
        </div>

        {isEditing && (
          <button
            type="submit"
            className="w-full bg-white hover:bg-zinc-200 text-black py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer active:scale-95"
          >
            Save Profile Preferences
          </button>
        )}
      </form>

    </div>
  );
}
