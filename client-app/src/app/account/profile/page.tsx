'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { UserIcon, SuccessIcon } from '@/components/ds/Icon';

export default function RiderProfilePage() {
  const { user } = useAuthStore();
  const riderName = user?.name || 'Sarah Connor';
  const riderPhone = user?.phone || '+91 99999 88888';

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [email, setEmail] = useState('sarah@skynet.com');
  const [dob, setDob] = useState('1985-05-12');
  const [gender, setGender] = useState('Female');
  const [lang, setLang] = useState('English');
  const [emailVerified, setEmailVerified] = useState(true);
  const [phoneVerified, setPhoneVerified] = useState(true);
  const [kycLevel, setKycLevel] = useState<'Basic' | 'Fully Authenticated'>('Basic');

  useEffect(() => {
    const savedAvatar = localStorage.getItem('rider_avatar');
    if (savedAvatar) {
      setAvatar(savedAvatar);
    }
  }, []);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Create canvas for compression and resize to 128x128
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, 128, 128);
          // Compress to JPEG with 70% quality
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
          localStorage.setItem('rider_avatar', compressedDataUrl);
          setAvatar(compressedDataUrl);
          // Dispatch event to sync Layout header/sidebar immediately
          window.dispatchEvent(new Event('rider_avatar_changed'));
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsEditing(false);
    alert('Profile preferences updated successfully.');
  };

  const handleVerifyEmail = () => {
    setEmailVerified(true);
    alert('Email verified successfully! Profile focus locked.');
  };

  const handleUpgradeKyc = () => {
    setKycLevel('Fully Authenticated');
    alert('KYC Validation Succeeded! Premium vehicle options and outstation routes are now unlocked.');
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">My Profile Details</h2>
        <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">Manage personal settings and check KYC authorization status</p>
      </div>

      {/* Account Overview Card */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-6 flex flex-col sm:flex-row gap-6 items-center">
        {/* Avatar Picker & Compression Trigger */}
        <div role="button" tabIndex={0} aria-label="Change profile photo" className="relative group cursor-pointer" onClick={handleAvatarClick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleAvatarClick(); } }}>
          {avatar ? (
            <img 
              src={avatar} 
              alt="Avatar" 
              className="h-20 w-20 rounded-2xl object-cover border border-border-opaque group-hover:opacity-75 transition"
            />
          ) : (
            <div className="h-20 w-20 bg-background-secondary border border-border-opaque rounded-2xl flex items-center justify-center text-3xl text-content-tertiary group-hover:opacity-75 transition">
              <UserIcon size={32} />
            </div>
          )}
          <div className="absolute inset-0 bg-black/60 rounded-2xl opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-[10px] font-mono uppercase font-bold text-white">
            Upload
          </div>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleAvatarChange} 
            accept="image/*" 
            className="hidden" 
          />
        </div>
        
        <div className="space-y-2 text-center sm:text-left flex-grow">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <h3 className="text-base font-bold text-white flex items-center gap-1.5 justify-center sm:justify-start">
              <span>{riderName}</span>
              <span className="text-content-positive text-xs" title="Verified Account"><SuccessIcon size={14} /></span>
            </h3>
            <span className={`px-2.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider w-max mx-auto sm:mx-0 border ${
              kycLevel === 'Fully Authenticated'
                ? 'bg-surface-positive/20 text-content-positive border-positive-400'
                : 'bg-surface-warning/20 text-content-warning border-warning-400'
            }`}>
              KYC: {kycLevel}
            </span>
          </div>
          <p className="text-xs text-content-tertiary font-mono">{riderPhone} • City: Kolkata</p>
        </div>

        {kycLevel !== 'Fully Authenticated' && (
          <button
            onClick={handleUpgradeKyc}
            className="bg-white hover:bg-background-tertiary text-black text-[10px] font-mono font-bold uppercase py-2 px-4 rounded-xl cursor-pointer transition active:scale-95 shrink-0 self-center"
          >
            Upgrade to Fully Authenticated
          </button>
        )}
      </div>

      {/* KYC Limitations Alert */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-3">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
          KYC Tier Capability Mapping
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <div className={`p-3 rounded-xl border ${kycLevel === 'Basic' ? 'border-warning-400/50 bg-surface-warning/5' : 'border-border-opaque bg-background-primary/40 opacity-55'}`}>
            <span className="text-[10px] font-bold text-content-warning block mb-1">Tier 1: Basic Identity</span>
            <p className="text-[10px] text-content-secondary font-sans leading-normal">
              For initial registrations. Limits bookings to City Hourly matches, budget/hatchback classes, and distances under 50km.
            </p>
          </div>
          <div className={`p-3 rounded-xl border ${kycLevel === 'Fully Authenticated' ? 'border-positive-400 bg-surface-positive/5' : 'border-border-opaque bg-background-primary/40 opacity-55'}`}>
            <span className="text-[10px] font-bold text-content-positive block mb-1">Tier 2: Fully Authenticated</span>
            <p className="text-[10px] text-content-secondary font-sans leading-normal">
              Unlocks premium/luxury fleets (Sedans, SUVs), outstation long-distance round trips, and priority pilot matching pools.
            </p>
          </div>
        </div>
      </div>

      {/* Profile Form */}
      <form onSubmit={handleSave} className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
        <div className="flex justify-between items-center border-b border-border-opaque pb-2">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">Personal Settings</h4>
          <button
            type="button"
            onClick={() => setIsEditing(!isEditing)}
            className="text-[9px] font-mono font-bold text-content-secondary hover:text-white uppercase tracking-wider cursor-pointer"
          >
            {isEditing ? 'Cancel' : 'Edit Info'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <div>
            <label className="block text-[8px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Email Address</label>
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!isEditing || emailVerified}
                className={`flex-grow bg-background-secondary border rounded-xl p-2.5 focus:outline-none ${
                  emailVerified ? 'border-positive-400 text-content-secondary' : 'border-border-opaque text-white'
                }`}
              />
              {emailVerified ? (
                <span className="bg-surface-positive/20 text-content-positive border border-positive-400 text-[8px] px-3 py-2.5 rounded-xl font-bold flex items-center justify-center uppercase shrink-0">
                  Verified <SuccessIcon size={14} />
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleVerifyEmail}
                  className="bg-white text-black hover:bg-background-tertiary text-[8px] font-bold px-3 py-2.5 rounded-xl cursor-pointer shrink-0 uppercase transition active:scale-95"
                >
                  Verify
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-[8px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Phone Number</label>
            <div className="flex gap-2">
              <input
                type="tel"
                value={riderPhone}
                disabled
                className="flex-grow bg-background-secondary border border-positive-400 text-content-secondary rounded-xl p-2.5 focus:outline-none"
              />
              <span className="bg-surface-positive/20 text-content-positive border border-positive-400 text-[8px] px-3 py-2.5 rounded-xl font-bold flex items-center justify-center uppercase shrink-0">
                Verified <SuccessIcon size={14} />
              </span>
            </div>
          </div>

          <div>
            <label className="block text-[8px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Date of Birth</label>
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              disabled={!isEditing}
              className="w-full bg-background-secondary border border-border-opaque rounded-xl p-2.5 text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[8px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Gender</label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              disabled={!isEditing}
              className="w-full bg-background-secondary border border-border-opaque rounded-xl p-2.5 text-white focus:outline-none"
            >
              <option>Male</option>
              <option>Female</option>
              <option>Other</option>
            </select>
          </div>

          <div>
            <label className="block text-[8px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Language preference</label>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              disabled={!isEditing}
              className="w-full bg-background-secondary border border-border-opaque rounded-xl p-2.5 text-white focus:outline-none"
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
            className="w-full bg-white hover:bg-background-tertiary text-black py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer active:scale-95"
          >
            Save Profile Preferences
          </button>
        )}
      </form>
    </div>
  );
}
