'use client';

import React, { useEffect, useState } from 'react';
import { getDriverProfile, DriverProfile } from '@/api/client';
import { useAuthStore } from '@/store/useAuthStore';

export default function DriverProfilePage() {
  const { user, token } = useAuthStore();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const driverName = profile?.name || user?.name || 'Driver Partner';
  const driverPhone = profile?.phone || user?.phone || 'Phone unavailable';
  const cityPrefix = profile?.city_prefix || 'KOL';
  
  const [bio, setBio] = useState('Professional pilot dedicated to safe, smooth, and premium commuter and outstation transits across Kolkata.');
  const [isEditingBio, setIsEditingBio] = useState(false);
  const [kycDocs, setKycDocs] = useState([
    { name: 'Driving License', status: 'Verified', date: '2026-01-10' },
    { name: 'Aadhaar Card (National ID)', status: 'Verified', date: '2026-01-10' },
    { name: 'PAN Card (Tax Registration)', status: 'Verified', date: '2026-01-11' },
    { name: 'Police Verification Clearance', status: 'Pending Review', date: '2026-05-24' },
    { name: 'Address Proof (Utility Bill)', status: 'Verified', date: '2026-01-10' }
  ]);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    getDriverProfile(token)
      .then((data) => {
        if (!cancelled) {
          setProfile(data);
          setProfileError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('[DriverProfile] Profile fetch failed:', err);
          setProfileError('Live profile data is unavailable.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleUploadDoc = () => {
    const docName = prompt('Enter the name of the new document to upload:');
    if (!docName) return;
    
    setKycDocs((prev) => [
      ...prev,
      { name: docName, status: 'Pending Verification', date: new Date().toISOString().split('T')[0] }
    ]);
    alert(`Document "${docName}" uploaded successfully and sent for admin review.`);
  };

  return (
    <div className="space-y-6 text-left">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">My Partner Profile</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Manage credentials, bio, and KYC document uploads</p>
        {profileError && <p className="text-red-400 text-[10px] font-mono mt-2">{profileError}</p>}
      </div>

      {/* Profile Overview Card */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-6 flex flex-col sm:flex-row gap-6 items-center">
        <div className="h-20 w-20 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center text-3xl shrink-0">
          👤
        </div>
        
        <div className="space-y-2 text-center sm:text-left flex-grow">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <h3 className="text-base font-bold text-white">{driverName}</h3>
            <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider w-max mx-auto sm:mx-0">
              {profile?.is_verified === false ? 'KYC Pending' : 'KYC Active'}
            </span>
          </div>
          <p className="text-xs text-zinc-500 font-mono">{driverPhone} • Hub: {cityPrefix}</p>
          
          <div className="flex justify-center sm:justify-start gap-4 text-xs font-mono pt-1 text-zinc-400">
            <div>
              <span className="text-zinc-600 block text-[9px] uppercase">RATING</span>
              <span className="font-bold text-amber-500">★ 4.92</span>
            </div>
            <div className="border-r border-zinc-900 h-6"></div>
            <div>
              <span className="text-zinc-600 block text-[9px] uppercase">TOTAL TRIPS</span>
              <span className="font-bold text-white">{profile?.total_trips ?? 0} Jobs</span>
            </div>
            <div className="border-r border-zinc-900 h-6"></div>
            <div>
              <span className="text-zinc-600 block text-[9px] uppercase">ACCEPTANCE</span>
              <span className="font-bold text-emerald-400">
                {profile ? `${Math.round(profile.acceptance_rate * 100)}%` : '--'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bio Editor */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3">
        <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">Pilot Bio Statement</h4>
          <button
            onClick={() => setIsEditingBio(!isEditingBio)}
            className="text-[9px] font-mono font-bold text-zinc-400 hover:text-white uppercase tracking-wider cursor-pointer"
          >
            {isEditingBio ? 'Save Statement' : 'Edit Bio'}
          </button>
        </div>

        {isEditingBio ? (
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-zinc-500 font-sans"
            rows={3}
          />
        ) : (
          <p className="text-xs text-zinc-400 leading-relaxed font-sans">{bio}</p>
        )}
      </div>

      {/* Technical Badges and Languages */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
            Transmission Licenses
          </h4>
          <div className="flex gap-2">
            <span className="bg-zinc-900 text-white border border-zinc-850 px-3 py-1.5 rounded-xl text-[9px] font-mono font-bold uppercase tracking-wider">
              ⚙️ Stick Shift Manual
            </span>
            <span className="bg-zinc-900 text-white border border-zinc-850 px-3 py-1.5 rounded-xl text-[9px] font-mono font-bold uppercase tracking-wider">
              🕹️ Automatic / EV
            </span>
          </div>
        </div>

        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
            Verified Languages
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {['Bengali (Native)', 'English (Professional)', 'Hindi (Fluent)'].map((lang) => (
              <span key={lang} className="bg-zinc-900 text-zinc-400 border border-zinc-850 px-2.5 py-1 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider">
                {lang}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* KYC Documents Section */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
        <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">KYC Compliance Documents</h4>
          <button
            onClick={handleUploadDoc}
            className="bg-white hover:bg-zinc-200 text-black text-[9px] font-mono font-bold uppercase px-3 py-1.5 rounded-full cursor-pointer"
          >
            Upload New Doc
          </button>
        </div>

        <div className="divide-y divide-zinc-900">
          {kycDocs.map((doc, idx) => (
            <div key={idx} className="py-3 flex justify-between items-center text-xs font-mono">
              <div>
                <span className="text-white block font-medium font-sans">{doc.name}</span>
                <span className="text-zinc-600 text-[8px] block mt-0.5">Uploaded on: {doc.date}</span>
              </div>
              <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border ${
                doc.status === 'Verified' 
                  ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900' 
                  : 'bg-amber-950/20 text-amber-500 border-amber-900'
              }`}>
                {doc.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Serviced Cities and Vehicles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-2.5">
          <span className="text-zinc-500 block text-[9px] uppercase font-mono tracking-wider font-bold">Serviced Cities</span>
          <p className="text-xs text-white leading-relaxed">Kolkata Metro (Salt Lake, New Town, Alipore, Howrah, Park Street, Tollygunge)</p>
        </div>
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-2.5">
          <span className="text-zinc-500 block text-[9px] uppercase font-mono tracking-wider font-bold">Assigned Fleet Vehicles</span>
          <p className="text-xs text-white leading-relaxed">WB-02-AK-9988 (Luxury Audi A6 SUV), KA-03-MD-4561 (Hatchback Swift Manual)</p>
        </div>
      </div>

    </div>
  );
}
