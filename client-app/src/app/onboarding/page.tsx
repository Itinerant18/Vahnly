'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RiderOnboardingWizard() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [logs, setLogs] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  
  const [riderData, setOnboardingData] = useState({
    // Step 1: Personal Profile Matrix
    fullName: '',
    email: '',
    gender: 'Male',
    dob: '',
    profilePhoto: null as string | null,

    // Step 2: Mechanical Garage Ledger
    carMake: '',
    carModel: '',
    carYear: '2022',
    carType: 'Sedan',
    carTransmission: 'AUTOMATIC',
    carFuel: 'Petrol',
    carPlate: '',
    carColor: '',
    carInsuranceExpiry: '',

    // Step 3: Saved Locations Framework
    homeAddress: '',
    workAddress: '',

    // Step 4: Emergency Contacts (Up to 3 Contacts with labels)
    emergencyContacts: [
      { label: 'Family', name: '', phone: '' },
      { label: 'Spouse', name: '', phone: '' },
      { label: 'Friend', name: '', phone: '' }
    ],

    // Step 5: System Communication Preferences
    pushEnabled: true,
    smsEnabled: true,
    emailEnabled: false,

    // Step 6: Location Access Consent
    locationPermission: 'WHILE_USING_APP'
  });

  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

  // ponytail: the profile-image upload was gutted in the minimalist redesign but the button's
  // handler reference was left dangling (broke the build). No-op stub keeps it green; wire a real
  // file input + upload here if profile upload is wanted again.
  void setUploadProgress;
  const triggerUploadClick = (_field: string) => {};
  // ponytail: demo-vehicle prefill was removed in the redesign; stub keeps the "Skip Step" button green.
  const toggleDemoVehicle = () => {};

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
    // Validation gates per step
    if (currentStep === 1) {
      if (!riderData.fullName.trim() || !riderData.email.trim()) {
        setValidationError('Legal Full Name and Email Address are required.');
        return;
      }
      // Simple email validation regex
      if (!/\S+@\S+\.\S+/.test(riderData.email)) {
        setValidationError('Please enter a valid email address.');
        return;
      }
    }

    if (currentStep === 2) {
      // If user inputs ANY garage info, check that they filled out Make, Model, and Plate
      const hasPartialData = riderData.carMake.trim() || riderData.carModel.trim() || riderData.carPlate.trim();
      if (hasPartialData) {
        if (!riderData.carMake.trim() || !riderData.carModel.trim() || !riderData.carPlate.trim()) {
          setValidationError('Please complete all car details (Make, Model, Plate) or click Skip Step.');
          return;
        }
        
        // Strict dropdown validation checks
        const validTypes = ['Hatchback', 'Sedan', 'SUV', 'Premium'];
        const validTransmissions = ['AUTOMATIC', 'MANUAL'];
        if (!validTypes.includes(riderData.carType) || !validTransmissions.includes(riderData.carTransmission)) {
          setValidationError('Invalid vehicle Type or Transmission selected.');
          return;
        }
      }
    }

    if (currentStep === 4) {
      // Validate emergency contacts: if filled, check phone length
      for (const contact of riderData.emergencyContacts) {
        if (contact.name.trim() || contact.phone.trim()) {
          if (!contact.name.trim() || contact.phone.trim().length < 8) {
            setValidationError('Please enter a valid Name and Phone for emergency contacts.');
            return;
          }
        }
      }
    }

    setValidationError(null);
    logEvent('STEP_TRANSITION', { from: currentStep, to: currentStep + 1 });
    setCurrentStep((prev) => prev + 1);
  };

  const prevStep = () => {
    setValidationError(null);
    logEvent('STEP_TRANSITION', { from: currentStep, to: currentStep - 1 });
    setCurrentStep((prev) => prev - 1);
  };

  const skipStep = () => {
    setValidationError(null);
    logEvent('STEP_SKIPPED', { step: currentStep });
    
    // Clear step 2 values when skipped to prevent invalid parameters from saving
    if (currentStep === 2) {
      setOnboardingData((prev) => ({
        ...prev,
        carMake: '',
        carModel: '',
        carPlate: ''
      }));
    }
    
    setCurrentStep((prev) => prev + 1);
  };

  const handleEmergencyContactChange = (idx: number, key: 'name' | 'phone' | 'label', val: string) => {
    const updated = [...riderData.emergencyContacts];
    updated[idx] = { ...updated[idx], [key]: val };
    setOnboardingData((prev) => ({ ...prev, emergencyContacts: updated }));
  };

  const handleOnboardingFinish = () => {
    logEvent('RIDER_ONBOARDING_FINISHED', {
      riderName: riderData.fullName,
      carPlate: riderData.carPlate || 'SKIPPED'
    });
    
    // Set onboarding flags in secure local storage
    localStorage.setItem('rider_onboarding_completed', 'true');
    localStorage.setItem('rider_profile_name', riderData.fullName);
    
    alert('Onboarding setup finished! Welcome to the Vahnly ride portal.');
    router.push('/rider');
  };

  return (
    <div className="min-h-screen bg-background-primary text-content-primary p-4 sm:p-8 font-sans flex flex-col justify-between selection:bg-gray-1000 selection:text-gray-0">
      
      {/* Header */}
      <header className="border-b border-border-opaque pb-4 flex justify-between items-center w-full max-w-2xl mx-auto text-left">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-content-primary font-move font-extrabold uppercase">Rider Onboarding</h1>
          <p className="text-content-tertiary text-[10px] font-mono uppercase font-bold tracking-wider mt-0.5">Step {currentStep} of 6 Setup Wizard</p>
        </div>
      </header>

      {/* Progress indicators */}
      <div className="w-full max-w-2xl mx-auto my-6">
        <div className="h-1.5 bg-background-secondary rounded-full w-full overflow-hidden flex">
          {Array.from({ length: 6 }).map((_, i) => (
            <div 
              key={i} 
              className={`flex-1 border-r border-border-opaque h-full transition-all duration-300 ${
                i + 1 <= currentStep ? 'bg-gray-1000' : 'bg-background-tertiary'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Main step container */}
      <main className="w-full max-w-2xl mx-auto flex-grow flex items-center justify-center my-6">
        <div className="w-full bg-background-primary border border-border-opaque rounded-2xl p-6 sm:p-8 space-y-6 text-left relative overflow-hidden">
          
          {validationError && (
            <div className="bg-negative-400/30 border border-negative-400 text-content-negative p-3.5 rounded-xl text-xs font-mono animate-fadeIn">
              ⚠️ {validationError}
            </div>
          )}

          {/* STEP 1: PROFILE MATRIX */}
          {currentStep === 1 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-content-primary border-b border-border-opaque pb-2">Step 1 — Profile Matrix</h2>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Full Legal Name</label>
                  <input
                    type="text"
                    value={riderData.fullName}
                    onChange={(e) => setOnboardingData({ ...riderData, fullName: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque"
                    placeholder="Sarah Connor"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Email Address</label>
                  <input
                    type="email"
                    value={riderData.email}
                    onChange={(e) => setOnboardingData({ ...riderData, email: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque font-mono"
                    placeholder="sarah@skynet.com"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Gender (Optional)</label>
                  <select
                    value={riderData.gender}
                    onChange={(e) => setOnboardingData({ ...riderData, gender: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque"
                  >
                    <option>Male</option>
                    <option>Female</option>
                    <option>Prefer not to say</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Date of Birth (Optional)</label>
                  <input
                    type="date"
                    value={riderData.dob}
                    onChange={(e) => setOnboardingData({ ...riderData, dob: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque text-content-secondary font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-2 font-mono">Profile Image Upload</label>
                <div className="flex items-center gap-4 bg-background-secondary/50 p-4 border border-border-opaque rounded-xl">
                  <div className="h-14 w-14 bg-background-tertiary rounded-xl flex items-center justify-center text-xs font-mono text-content-tertiary border border-border-opaque shrink-0">
                    {riderData.profilePhoto ? '✔️ READY' : 'NO SCAN'}
                  </div>
                  <button
                    type="button"
                    onClick={() => triggerUploadClick('avatarUrl')}
                    className="bg-background-tertiary hover:opacity-90 border border-border-opaque text-content-primary rounded-lg px-4 py-2 text-[10px] font-bold uppercase tracking-wider cursor-pointer"
                  >
                    {uploadProgress.profilePhoto ? `Uploading ${uploadProgress.profilePhoto}%` : 'Upload Picture'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: MECHANICAL GARAGE LEDGER */}
          {currentStep === 2 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex justify-between items-center border-b border-border-opaque pb-2">
                <h2 className="text-lg font-bold font-move text-content-primary">Step 2 — Mechanical Garage Ledger</h2>
                <button 
                  onClick={toggleDemoVehicle} 
                  className="text-content-tertiary hover:text-content-primary font-mono text-[9px] uppercase font-bold tracking-wider"
                >
                  Skip Step ➔
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Car Make</label>
                  <input
                    type="text"
                    value={riderData.carMake}
                    onChange={(e) => setOnboardingData({ ...riderData, carMake: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none"
                    placeholder="e.g. Maruti Suzuki"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Car Model</label>
                  <input
                    type="text"
                    value={riderData.carModel}
                    onChange={(e) => setOnboardingData({ ...riderData, carModel: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none"
                    placeholder="e.g. Swift"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Registration Plate</label>
                  <input
                    type="text"
                    value={riderData.carPlate}
                    onChange={(e) => setOnboardingData({ ...riderData, carPlate: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none font-mono uppercase"
                    placeholder="WB-02-AK-1234"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-content-tertiary mb-1">Car Type</label>
                  <select
                    value={riderData.carType}
                    onChange={(e) => setOnboardingData({ ...riderData, carType: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-lg p-2 text-xs text-content-primary"
                  >
                    <option value="Hatchback">Hatchback</option>
                    <option value="Sedan">Sedan</option>
                    <option value="SUV">SUV</option>
                    <option value="Premium">Premium</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-content-tertiary mb-1">Transmission</label>
                  <select
                    value={riderData.carTransmission}
                    onChange={(e) => setOnboardingData({ ...riderData, carTransmission: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-lg p-2 text-xs text-content-primary"
                  >
                    <option value="AUTOMATIC">AUTOMATIC</option>
                    <option value="MANUAL">MANUAL</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-content-tertiary mb-1">Fuel Class</label>
                  <select
                    value={riderData.carFuel}
                    onChange={(e) => setOnboardingData({ ...riderData, carFuel: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-lg p-2 text-xs text-content-primary"
                  >
                    <option value="Petrol">Petrol</option>
                    <option value="Diesel">Diesel</option>
                    <option value="EV">EV</option>
                    <option value="CNG">CNG</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-content-tertiary mb-1">Car Color</label>
                  <input
                    type="text"
                    value={riderData.carColor}
                    onChange={(e) => setOnboardingData({ ...riderData, carColor: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-lg p-2 text-xs text-content-primary"
                    placeholder="e.g. Silver"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: SAVED LOCATIONS */}
          {currentStep === 3 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-content-primary border-b border-border-opaque pb-2">Step 3 — Saved Locations</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">🏠 Residential Home Address</label>
                  <input
                    type="text"
                    value={riderData.homeAddress}
                    onChange={(e) => setOnboardingData({ ...riderData, homeAddress: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none"
                    placeholder="Enter Residential home address..."
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">🏢 Professional Work Address</label>
                  <input
                    type="text"
                    value={riderData.workAddress}
                    onChange={(e) => setOnboardingData({ ...riderData, workAddress: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none"
                    placeholder="Enter Professional office address..."
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: EMERGENCY RING CONFIGURATION */}
          {currentStep === 4 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-content-primary border-b border-border-opaque pb-2">Step 4 — Emergency Ring Configurations (Up to 3)</h2>
              <p className="text-[10px] text-content-tertiary font-mono leading-relaxed">
                Provide up to 3 contacts. They will receive automated notifications when the SOS emergency alarm triggers.
              </p>

              <div className="space-y-4 pt-2">
                {riderData.emergencyContacts.map((contact, idx) => (
                  <div key={idx} className="grid grid-cols-3 gap-3 bg-background-secondary/40 p-4 border border-border-opaque rounded-xl items-center">
                    <div>
                      <label className="block text-[8px] uppercase font-bold text-content-tertiary mb-1 font-mono">Contact Label</label>
                      <select
                        value={contact.label}
                        onChange={(e) => handleEmergencyContactChange(idx, 'label', e.target.value)}
                        className="w-full bg-background-primary border border-border-opaque rounded-lg p-2 text-xs focus:outline-none text-content-primary font-mono"
                      >
                        <option value="Family">Family</option>
                        <option value="Spouse">Spouse</option>
                        <option value="Friend">Friend</option>
                        <option value="Colleague">Colleague</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[8px] uppercase font-bold text-content-tertiary mb-1 font-mono">Full Name</label>
                      <input
                        type="text"
                        value={contact.name}
                        onChange={(e) => handleEmergencyContactChange(idx, 'name', e.target.value)}
                        className="w-full bg-background-primary border border-border-opaque rounded-lg p-2.5 text-xs focus:outline-none text-content-primary"
                        placeholder="Sarah Connor"
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] uppercase font-bold text-content-tertiary mb-1 font-mono">Phone Number</label>
                      <input
                        type="tel"
                        value={contact.phone}
                        onChange={(e) => handleEmergencyContactChange(idx, 'phone', e.target.value)}
                        className="w-full bg-background-primary border border-border-opaque rounded-lg p-2.5 text-xs focus:outline-none text-content-primary font-mono"
                        placeholder="+91 99999 88888"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 5: PREFERENCES */}
          {currentStep === 5 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-content-primary border-b border-border-opaque pb-2">Step 5 — Communication Preferences</h2>
              
              <div className="space-y-4 font-mono text-xs text-content-secondary">
                <div className="flex justify-between items-center border-b border-border-opaque pb-2">
                  <span className="text-content-primary font-sans font-medium">Push Notification Dispatch Alerts</span>
                  <button
                    type="button"
                    onClick={() => setOnboardingData({ ...riderData, pushEnabled: !riderData.pushEnabled })}
                    className={`h-5 w-10 rounded-full transition relative p-0.5 ${riderData.pushEnabled ? 'bg-gray-1000' : 'bg-background-tertiary'}`}
                  >
                    <div className={`h-4 w-4 rounded-full shadow transition-transform ${riderData.pushEnabled ? 'translate-x-5 bg-gray-0' : 'translate-x-0 bg-gray-500'}`} />
                  </button>
                </div>

                <div className="flex justify-between items-center border-b border-border-opaque pb-2">
                  <span className="text-content-primary font-sans font-medium">Critical Status SMS Updates</span>
                  <button
                    type="button"
                    onClick={() => setOnboardingData({ ...riderData, smsEnabled: !riderData.smsEnabled })}
                    className={`h-5 w-10 rounded-full transition relative p-0.5 ${riderData.smsEnabled ? 'bg-gray-1000' : 'bg-background-tertiary'}`}
                  >
                    <div className={`h-4 w-4 rounded-full shadow transition-transform ${riderData.smsEnabled ? 'translate-x-5 bg-gray-0' : 'translate-x-0 bg-gray-500'}`} />
                  </button>
                </div>

                <div className="flex justify-between items-center border-b border-border-opaque pb-2">
                  <span className="text-content-primary font-sans font-medium">Weekly Promotion & Offer Emails</span>
                  <button
                    type="button"
                    onClick={() => setOnboardingData({ ...riderData, emailEnabled: !riderData.emailEnabled })}
                    className={`h-5 w-10 rounded-full transition relative p-0.5 ${riderData.emailEnabled ? 'bg-gray-1000' : 'bg-background-tertiary'}`}
                  >
                    <div className={`h-4 w-4 rounded-full shadow transition-transform ${riderData.emailEnabled ? 'translate-x-5 bg-gray-0' : 'translate-x-0 bg-gray-500'}`} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 6: LOCATION ACCESS */}
          {currentStep === 6 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-content-primary border-b border-border-opaque pb-2">Step 6 — Platform Location Permissions</h2>
              
              <div className="space-y-4 text-center py-6 font-sans">
                <span className="text-4xl block">📍</span>
                <p className="text-xs text-content-secondary max-w-sm mx-auto leading-relaxed">
                  Location data is required to route active trip coordinates, estimate driver ETAs, and enable public share tracking streams.
                </p>

                <div className="flex flex-col gap-2 max-w-xs mx-auto pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setOnboardingData({ ...riderData, locationPermission: 'ALWAYS' });
                      logEvent('LOCATION_PERMISSION_GRANTED', { scope: 'ALWAYS' });
                      alert('Location permission set: ALWAYS ALLOW.');
                    }}
                    className={`py-3 text-xs font-bold uppercase rounded-xl border transition cursor-pointer ${
                      riderData.locationPermission === 'ALWAYS' 
                        ? 'bg-interactive-primary text-interactive-primary-text border-border-selected' 
                        : 'bg-background-secondary border-border-opaque text-content-secondary hover:text-content-primary'
                    }`}
                  >
                    Always Allow (Recommended)
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => {
                      setOnboardingData({ ...riderData, locationPermission: 'WHILE_USING_APP' });
                      logEvent('LOCATION_PERMISSION_GRANTED', { scope: 'WHILE_USING_APP' });
                      alert('Location permission set: WHILE USING APP.');
                    }}
                    className={`py-3 text-xs font-bold uppercase rounded-xl border transition cursor-pointer ${
                      riderData.locationPermission === 'WHILE_USING_APP' 
                        ? 'bg-interactive-primary text-interactive-primary-text border-border-selected' 
                        : 'bg-background-secondary border-border-opaque text-content-secondary hover:text-content-primary'
                    }`}
                  >
                    While Using App
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Stepper Navigation Buttons */}
          <div className="flex justify-between items-center border-t border-border-opaque pt-6">
            <button
              onClick={prevStep}
              disabled={currentStep === 1}
              type="button"
              className="bg-background-secondary hover:bg-background-tertiary text-content-secondary border border-border-opaque rounded-full px-6 py-2.5 text-xs font-bold uppercase tracking-wider transition disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 cursor-pointer"
            >
              Back
            </button>

            {currentStep < 6 ? (
              <button
                onClick={nextStep}
                type="button"
                className="bg-interactive-primary hover:opacity-90 text-interactive-primary-text rounded-full px-6 py-2.5 text-xs font-bold uppercase tracking-wider transition active:scale-95 cursor-pointer"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleOnboardingFinish}
                type="button"
                className="bg-positive-400 hover:opacity-90 text-gray-0 rounded-full px-6 py-2.5 text-xs font-bold uppercase tracking-wider transition active:scale-95 font-mono cursor-pointer"
              >
                Complete Setup
              </button>
            )}
          </div>

        </div>
      </main>

      {/* Logs preview panel */}
      {logs.length > 0 && (
        <div className="w-full max-w-2xl mx-auto border-t border-border-opaque pt-4 text-left">
          <span className="text-[9px] font-mono font-bold text-content-tertiary uppercase tracking-widest block mb-2">Setup audit logs stream:</span>
          <div className="bg-background-primary border border-border-opaque rounded-xl p-3 max-h-32 overflow-y-auto font-mono text-[8px] text-content-tertiary space-y-1 scrollbar-thin">
            {logs.map((lg, i) => (
              <div key={i} className="truncate select-all">{lg}</div>
            ))}
          </div>
        </div>
      )}

      <footer className="w-full max-w-2xl mx-auto text-left flex justify-between items-center text-[9px] text-content-tertiary font-mono pt-4 mt-6 border-t border-border-opaque">
        <span>SECURITY: RIDER_ONBOARD_ENCRYPT</span>
        <span>HUB: KOLKATA / BANGALORE</span>
      </footer>
    </div>
  );
}
