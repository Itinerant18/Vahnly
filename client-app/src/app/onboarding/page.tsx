'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RiderOnboardingWizard() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [logs, setLogs] = useState<string[]>([]);
  const [riderData, setOnboardingData] = useState({
    // Step 1: Personal
    fullName: '',
    email: '',
    gender: 'Male',
    dob: '',
    profilePhoto: null as string | null,

    // Step 2: Car Details
    carMake: '',
    carModel: '',
    carYear: '2022',
    carType: 'Sedan',
    carTransmission: 'AUTOMATIC',
    carFuel: 'Petrol',
    carPlate: '',
    carColor: '',
    carInsuranceExpiry: '',

    // Step 3: Saved Addresses
    homeAddress: '',
    workAddress: '',

    // Step 4: Emergency Contacts
    emergencyContacts: [
      { name: '', phone: '' },
      { name: '', phone: '' }
    ],

    // Step 5: Notification Toggles
    pushEnabled: true,
    smsEnabled: true,
    emailEnabled: false,

    // Step 6: Location Permission
    locationPermission: 'WHILE_USING_APP'
  });

  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

  const logEvent = (action: string, meta: any) => {
    const time = new Date().toISOString();
    const str = `[RIDER_ONBOARDING_LOG] ${time} | ${action} | Meta: ${JSON.stringify(meta)}`;
    console.log(str);
    setLogs((prev) => [str, ...prev]);
  };

  const handleSimulatedUpload = (fieldName: string, docName: string) => {
    logEvent('UPLOAD_START', { fieldName, docName });
    setUploadProgress((prev) => ({ ...prev, [fieldName]: 10 }));
    
    let current = 10;
    const interval = setInterval(() => {
      current += 30;
      if (current >= 100) {
        clearInterval(interval);
        setUploadProgress((prev) => ({ ...prev, [fieldName]: 100 }));
        setOnboardingData((prev) => ({ ...prev, [fieldName]: `s3://rider-vault/photos/${fieldName}-${Date.now()}.png` }));
        logEvent('UPLOAD_COMPLETE', { fieldName, docName, status: 'VERIFIED' });
      } else {
        setUploadProgress((prev) => ({ ...prev, [fieldName]: current }));
      }
    }, 150);
  };

  const nextStep = () => {
    logEvent('STEP_TRANSITION', { from: currentStep, to: currentStep + 1 });
    setCurrentStep((prev) => prev + 1);
  };

  const prevStep = () => {
    logEvent('STEP_TRANSITION', { from: currentStep, to: currentStep - 1 });
    setCurrentStep((prev) => prev - 1);
  };

  const skipStep = () => {
    logEvent('STEP_SKIPPED', { step: currentStep });
    setCurrentStep((prev) => prev + 1);
  };

  const handleEmergencyContactChange = (idx: number, key: 'name' | 'phone', val: string) => {
    const updated = [...riderData.emergencyContacts];
    updated[idx] = { ...updated[idx], [key]: val };
    setOnboardingData((prev) => ({ ...prev, emergencyContacts: updated }));
  };

  const handleOnboardingFinish = () => {
    logEvent('RIDER_ONBOARDING_FINISHED', {
      riderName: riderData.fullName,
      carPlate: riderData.carPlate || 'SKIPPED'
    });
    alert('Onboarding setup finished! Welcome to the Drivers-For-U ride portal.');
    router.push('/login?role=rider');
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-8 font-sans flex flex-col justify-between selection:bg-white selection:text-black">
      
      {/* Header */}
      <header className="border-b border-zinc-800 pb-4 flex justify-between items-center w-full max-w-2xl mx-auto text-left">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white font-move font-extrabold uppercase">Rider Onboarding</h1>
          <p className="text-zinc-500 text-[10px] font-mono uppercase font-bold tracking-wider mt-0.5">Step {currentStep} of 6 Setup Wizard</p>
        </div>
      </header>

      {/* Progress indicators */}
      <div className="w-full max-w-2xl mx-auto my-6">
        <div className="h-1.5 bg-zinc-900 rounded-full w-full overflow-hidden flex">
          {Array.from({ length: 6 }).map((_, i) => (
            <div 
              key={i} 
              className={`flex-1 border-r border-black h-full transition-all duration-300 ${
                i + 1 <= currentStep ? 'bg-white' : 'bg-zinc-850'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Main step container */}
      <main className="w-full max-w-2xl mx-auto flex-grow flex items-center justify-center my-6">
        <div className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-6 sm:p-8 space-y-6 text-left relative overflow-hidden">
          
          {/* STEP 1: PERSONAL */}
          {currentStep === 1 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-white border-b border-zinc-900 pb-2">Step 1 — Personal Information</h2>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Full Legal Name</label>
                  <input
                    type="text"
                    value={riderData.fullName}
                    onChange={(e) => setOnboardingData({ ...riderData, fullName: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500"
                    placeholder="Sarah Connor"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Email Address</label>
                  <input
                    type="email"
                    value={riderData.email}
                    onChange={(e) => setOnboardingData({ ...riderData, email: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500 font-mono"
                    placeholder="sarah@skynet.com"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Gender (Optional)</label>
                  <select
                    value={riderData.gender}
                    onChange={(e) => setOnboardingData({ ...riderData, gender: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500"
                  >
                    <option>Male</option>
                    <option>Female</option>
                    <option>Prefer not to say</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Date of Birth (Optional)</label>
                  <input
                    type="date"
                    value={riderData.dob}
                    onChange={(e) => setOnboardingData({ ...riderData, dob: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500 text-zinc-400 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-2 font-mono">Profile Photo</label>
                <div className="flex items-center gap-4 bg-zinc-900/50 p-4 border border-zinc-800 rounded-xl">
                  <div className="h-14 w-14 bg-zinc-850 rounded-xl flex items-center justify-center text-xs font-mono text-zinc-600 border border-zinc-800 shrink-0">
                    {riderData.profilePhoto ? '✔️ Ready' : 'NO SCAN'}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSimulatedUpload('profilePhoto', 'RiderProfilePic')}
                    className="bg-zinc-850 hover:bg-zinc-800 border border-zinc-700 text-white rounded-lg px-4 py-2 text-[10px] font-bold uppercase tracking-wider cursor-pointer"
                  >
                    {uploadProgress.profilePhoto ? `Uploading ${uploadProgress.profilePhoto}%` : 'Upload Picture'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: FIRST CAR */}
          {currentStep === 2 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                <h2 className="text-lg font-bold font-move text-white">Step 2 — Add Your Garage Car</h2>
                <button
                  onClick={skipStep}
                  className="text-zinc-500 hover:text-white font-mono text-[9px] uppercase font-bold tracking-wider"
                >
                  Skip Step ➔
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Car Make</label>
                  <input
                    type="text"
                    value={riderData.carMake}
                    onChange={(e) => setOnboardingData({ ...riderData, carMake: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none"
                    placeholder="e.g. Maruti Suzuki"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Car Model</label>
                  <input
                    type="text"
                    value={riderData.carModel}
                    onChange={(e) => setOnboardingData({ ...riderData, carModel: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none"
                    placeholder="e.g. Swift"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Registration Plate</label>
                  <input
                    type="text"
                    value={riderData.carPlate}
                    onChange={(e) => setOnboardingData({ ...riderData, carPlate: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none font-mono uppercase"
                    placeholder="WB-02-AK-1234"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1">Type</label>
                  <select
                    value={riderData.carType}
                    onChange={(e) => setOnboardingData({ ...riderData, carType: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs"
                  >
                    <option>Hatchback</option>
                    <option>Sedan</option>
                    <option>SUV</option>
                    <option>Premium</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1">Transmission</label>
                  <select
                    value={riderData.carTransmission}
                    onChange={(e) => setOnboardingData({ ...riderData, carTransmission: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs"
                  >
                    <option>AUTOMATIC</option>
                    <option>MANUAL</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1">Fuel Type</label>
                  <select
                    value={riderData.carFuel}
                    onChange={(e) => setOnboardingData({ ...riderData, carFuel: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs"
                  >
                    <option>Petrol</option>
                    <option>Diesel</option>
                    <option>EV</option>
                    <option>CNG</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1">Color</label>
                  <input
                    type="text"
                    value={riderData.carColor}
                    onChange={(e) => setOnboardingData({ ...riderData, carColor: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs"
                    placeholder="e.g. Silver"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: HOME & WORK ADDRESSES */}
          {currentStep === 3 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-white border-b border-zinc-900 pb-2">Step 3 — Favorite Addresses</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">🏠 Home Address</label>
                  <input
                    type="text"
                    value={riderData.homeAddress}
                    onChange={(e) => setOnboardingData({ ...riderData, homeAddress: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none"
                    placeholder="Enter home location address"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">🏢 Work Address</label>
                  <input
                    type="text"
                    value={riderData.workAddress}
                    onChange={(e) => setOnboardingData({ ...riderData, workAddress: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none"
                    placeholder="Enter office location address"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: EMERGENCY CONTACTS */}
          {currentStep === 4 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-white border-b border-zinc-900 pb-2">Step 4 — Emergency Contacts (Up to 3)</h2>
              <p className="text-[10px] text-zinc-500 font-mono leading-relaxed">
                Emergency contacts will receive instant SMS alerts containing coordinates when the SOS button is triggered.
              </p>

              <div className="space-y-4 pt-2">
                {[0, 1].map((idx) => (
                  <div key={idx} className="grid grid-cols-2 gap-4 bg-zinc-900/40 p-4 border border-zinc-900 rounded-xl">
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1 font-mono">Contact Name</label>
                      <input
                        type="text"
                        value={riderData.emergencyContacts[idx].name}
                        onChange={(e) => handleEmergencyContactChange(idx, 'name', e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-850 rounded-lg p-2.5 text-xs focus:outline-none"
                        placeholder="Name"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1 font-mono">Phone Number</label>
                      <input
                        type="tel"
                        value={riderData.emergencyContacts[idx].phone}
                        onChange={(e) => handleEmergencyContactChange(idx, 'phone', e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-850 rounded-lg p-2.5 text-xs focus:outline-none font-mono"
                        placeholder="+91 99999 88888"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 5: NOTIFICATIONS */}
          {currentStep === 5 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-white border-b border-zinc-900 pb-2">Step 5 — Communication Preferences</h2>
              
              <div className="space-y-4 font-mono text-xs text-zinc-400">
                <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                  <span className="text-white font-sans font-medium">Push Notification Dispatch Alerts</span>
                  <button
                    type="button"
                    onClick={() => setOnboardingData({ ...riderData, pushEnabled: !riderData.pushEnabled })}
                    className={`h-5 w-10 rounded-full transition relative p-0.5 ${riderData.pushEnabled ? 'bg-white' : 'bg-zinc-800'}`}
                  >
                    <div className={`h-4 w-4 rounded-full shadow transition-transform ${riderData.pushEnabled ? 'translate-x-5 bg-black' : 'translate-x-0 bg-zinc-400'}`} />
                  </button>
                </div>

                <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                  <span className="text-white font-sans font-medium">Critical Status SMS Updates</span>
                  <button
                    type="button"
                    onClick={() => setOnboardingData({ ...riderData, smsEnabled: !riderData.smsEnabled })}
                    className={`h-5 w-10 rounded-full transition relative p-0.5 ${riderData.smsEnabled ? 'bg-white' : 'bg-zinc-800'}`}
                  >
                    <div className={`h-4 w-4 rounded-full shadow transition-transform ${riderData.smsEnabled ? 'translate-x-5 bg-black' : 'translate-x-0 bg-zinc-400'}`} />
                  </button>
                </div>

                <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                  <span className="text-white font-sans font-medium">Weekly Promotion & Offer Emails</span>
                  <button
                    type="button"
                    onClick={() => setOnboardingData({ ...riderData, emailEnabled: !riderData.emailEnabled })}
                    className={`h-5 w-10 rounded-full transition relative p-0.5 ${riderData.emailEnabled ? 'bg-white' : 'bg-zinc-800'}`}
                  >
                    <div className={`h-4 w-4 rounded-full shadow transition-transform ${riderData.emailEnabled ? 'translate-x-5 bg-black' : 'translate-x-0 bg-zinc-400'}`} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 6: LOCATION */}
          {currentStep === 6 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-white border-b border-zinc-900 pb-2">Step 6 — Platform Location Permissions</h2>
              
              <div className="space-y-4 text-center py-6 font-sans">
                <span className="text-4xl block">📍</span>
                <p className="text-xs text-zinc-400 max-w-sm mx-auto leading-relaxed">
                  To trace pickup hubs, show nearby drivers, and secure active route timelines, we request location credentials.
                </p>

                <div className="flex flex-col gap-2 max-w-xs mx-auto pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setOnboardingData({ ...riderData, locationPermission: 'ALWAYS' });
                      logEvent('LOCATION_PERMISSION_GRANTED', { scope: 'ALWAYS' });
                      alert('Location Permission (Always) Mock granted successfully.');
                    }}
                    className={`py-3 text-xs font-bold uppercase rounded-xl border transition cursor-pointer ${
                      riderData.locationPermission === 'ALWAYS' 
                        ? 'bg-white text-black border-white' 
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                  >
                    Allow Always (Recommended)
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => {
                      setOnboardingData({ ...riderData, locationPermission: 'WHILE_USING_APP' });
                      logEvent('LOCATION_PERMISSION_GRANTED', { scope: 'WHILE_USING_APP' });
                      alert('Location Permission (While using app) Mock granted.');
                    }}
                    className={`py-2.5 text-xs font-bold uppercase rounded-xl border transition cursor-pointer ${
                      riderData.locationPermission === 'WHILE_USING_APP' 
                        ? 'bg-white text-black border-white' 
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                  >
                    While Using App
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Stepper Navigation */}
          <div className="flex justify-between items-center border-t border-zinc-900 pt-6">
            <button
              onClick={prevStep}
              disabled={currentStep === 1}
              type="button"
              className="bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded-full px-6 py-2.5 text-xs font-bold uppercase tracking-wider transition disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
            >
              Back
            </button>

            {currentStep < 6 ? (
              <button
                onClick={nextStep}
                type="button"
                className="bg-white hover:bg-zinc-200 text-black rounded-full px-6 py-2.5 text-xs font-bold uppercase tracking-wider transition active:scale-95"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleOnboardingFinish}
                type="button"
                className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-full px-6 py-2.5 text-xs font-bold uppercase tracking-wider transition active:scale-95 font-mono"
              >
                Complete Setup
              </button>
            )}
          </div>

        </div>
      </main>

      {/* Logs preview panel */}
      {logs.length > 0 && (
        <div className="w-full max-w-2xl mx-auto border-t border-zinc-900 pt-4 text-left">
          <span className="text-[9px] font-mono font-bold text-zinc-600 uppercase tracking-widest block mb-2">Setup audit logs stream:</span>
          <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-3 max-h-32 overflow-y-auto font-mono text-[8px] text-zinc-500 space-y-1 scrollbar-thin">
            {logs.map((lg, i) => (
              <div key={i} className="truncate select-all">{lg}</div>
            ))}
          </div>
        </div>
      )}

      <footer className="w-full max-w-2xl mx-auto text-left flex justify-between items-center text-[9px] text-zinc-600 font-mono pt-4 mt-6 border-t border-zinc-900">
        <span>SECURITY: RIDER_ONBOARD_ENCRYPT</span>
        <span>HUB: KOLKATA / BANGALORE</span>
      </footer>
    </div>
  );
}
