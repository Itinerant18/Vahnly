'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useDriverOnboardingStore } from '@/store/useDriverOnboardingStore';
import { useAuthStore } from '@/store/useAuthStore';
import { saveOnboardingStep, uploadDocument, syncOfflineOnboarding, updateDriverProfile } from '@/api/client';
import { SettingsIcon, CarIcon, CheckIcon } from '@/components/ds/Icon';

export default function DriverOnboardingWizard() {
  const router = useRouter();
  const { token } = useAuthStore();
  const { step: currentStep, data: onboardingStoreData, updateData, setStep, clearStore } = useDriverOnboardingStore();
  
  const [logs, setLogs] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [termsScrolledToBottom, setTermsScrolledToBottom] = useState(false);

  // IFSC resolution (Razorpay free public lookup). 'verified' shows BANK — BRANCH,
  // 'error' shows a subtle hint. Never blocks form submit.
  const [ifscLookup, setIfscLookup] = useState<{
    status: 'idle' | 'loading' | 'verified' | 'error';
    label: string;
  }>({ status: 'idle', label: '' });

  const handleIfscBlur = async (code: string) => {
    const ifsc = code.trim().toUpperCase();
    if (ifsc.length !== 11) {
      setIfscLookup({ status: 'idle', label: '' });
      return;
    }
    setIfscLookup({ status: 'loading', label: '' });
    try {
      const res = await fetch(`https://ifsc.razorpay.com/${ifsc}`);
      if (!res.ok) {
        setIfscLookup({ status: 'error', label: '' });
        return;
      }
      const data = await res.json();
      const label = data.BANK ? `${data.BANK} — ${data.BRANCH}` : '';
      setIfscLookup({ status: 'verified', label });
      // Persist the resolved bank name so the payout step has it on record.
      setOnboardingData({ ifscBankName: label });
    } catch {
      setIfscLookup({ status: 'error', label: '' });
    }
  };

  // Hidden file input references for KYC document uploading
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeUploadField, setActiveUploadField] = useState<{ fieldName: string; docType: string } | null>(null);

  const defaultData = {
    fullName: '',
    dob: '',
    gender: 'Male',
    profilePhoto: null as string | null,
    languages: [] as string[],
    permAddress: '',
    currAddress: '',
    city: 'Kolkata',
    drivingLicense: null as string | null,
    aadhaarId: null as string | null,
    panCard: null as string | null,
    policeVerification: null as string | null,
    addressProof: null as string | null,
    manualExpertise: true,
    automaticExpertise: true,
    yearsOfExperience: '5',
    accountNo: '',
    ifscCode: '',
    holderName: '',
    upiId: '',
    cancelledCheque: null as string | null,
    emergencyName: '',
    emergencyRelation: '',
    emergencyPhone: '',
    signatureName: '',
    agreedToTerms: false,
  };

  const onboardingData = { ...defaultData, ...onboardingStoreData };

  const setOnboardingData = (updater: any) => {
    if (typeof updater === 'object' && updater !== null) {
      updateData(updater);
    } else if (typeof updater === 'function') {
      updateData(updater(onboardingData));
    }
  };

  useEffect(() => {
    if (!token) {
      alert("Authentication token required to access driver onboarding pipeline.");
      router.push('/login?role=driver');
      return;
    }

    // Attempt to sync any cached offline payloads
    void syncOfflineOnboarding();
  }, [token, router]);

  // Helper log function
  const logEvent = (action: string, meta: any) => {
    const time = new Date().toISOString();
    const str = `[ONBOARDING_LOG] ${time} | ${action} | Meta: ${JSON.stringify(meta)}`;
    console.log(str);
    setLogs((prev) => [str, ...prev]);
  };

  const triggerUploadClick = (fieldName: string, docType: string) => {
    setActiveUploadField({ fieldName, docType });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeUploadField) return;
    const { fieldName, docType } = activeUploadField;

    if (!token) {
      alert("Session expired. Please log in again.");
      router.push('/login?role=driver');
      return;
    }

    logEvent('UPLOAD_START', { fieldName, docType, fileName: file.name });
    setUploadProgress((prev) => ({ ...prev, [fieldName]: 10 }));

    try {
      let currentProgress = 10;
      const interval = setInterval(() => {
        currentProgress = Math.min(currentProgress + 15, 90);
        setUploadProgress((prev) => ({ ...prev, [fieldName]: currentProgress }));
      }, 100);

      const res = await uploadDocument(token, docType, file);
      clearInterval(interval);
      setUploadProgress((prev) => ({ ...prev, [fieldName]: 100 }));

      updateData({ [fieldName]: res.storage_url });
      logEvent('UPLOAD_COMPLETE', { fieldName, docType, storage_url: res.storage_url });
    } catch (err) {
      logEvent('UPLOAD_ERROR', { fieldName, docType, error: String(err) });
      alert("Failed to upload document. Please try again.");
      setUploadProgress((prev) => ({ ...prev, [fieldName]: 0 }));
    }
  };

  const nextStep = async () => {
    if (token) {
      try {
        // Collect partial step data payload to commit
        let stepPayload: Record<string, any> = {};
        if (currentStep === 1) {
          stepPayload = {
            fullName: onboardingData.fullName,
            dob: onboardingData.dob,
            gender: onboardingData.gender,
            profilePhoto: onboardingData.profilePhoto,
            languages: onboardingData.languages,
          };
        } else if (currentStep === 2) {
          stepPayload = {
            permAddress: onboardingData.permAddress,
            currAddress: onboardingData.currAddress,
            city: onboardingData.city,
          };
        } else if (currentStep === 3) {
          stepPayload = {
            drivingLicense: onboardingData.drivingLicense,
            aadhaarId: onboardingData.aadhaarId,
            panCard: onboardingData.panCard,
            policeVerification: onboardingData.policeVerification,
            addressProof: onboardingData.addressProof,
          };
        } else if (currentStep === 4) {
          stepPayload = {
            manualExpertise: onboardingData.manualExpertise,
            automaticExpertise: onboardingData.automaticExpertise,
            yearsOfExperience: onboardingData.yearsOfExperience,
          };
        } else if (currentStep === 5) {
          stepPayload = {
            accountNo: onboardingData.accountNo,
            ifscCode: onboardingData.ifscCode,
            holderName: onboardingData.holderName,
            upiId: onboardingData.upiId,
            cancelledCheque: onboardingData.cancelledCheque,
          };
        } else if (currentStep === 6) {
          stepPayload = {
            emergencyName: onboardingData.emergencyName,
            emergencyRelation: onboardingData.emergencyRelation,
            emergencyPhone: onboardingData.emergencyPhone,
          };
        } else if (currentStep === 7) {
          stepPayload = {
            signatureName: onboardingData.signatureName,
            agreedToTerms: onboardingData.agreedToTerms,
          };
        }

        await saveOnboardingStep(token, currentStep, stepPayload);
        logEvent('STEP_SYNC_SUCCESS', { step: currentStep });

        // Step 4 captures transmission skill. Persist it to the matchable driver record
        // (can_drive_manual gates manual-car bookings) — the onboarding JSONB blob the
        // step save writes is not read by the matcher.
        if (currentStep === 4) {
          try {
            await updateDriverProfile(token, { can_drive_manual: onboardingData.manualExpertise });
          } catch (err) {
            logEvent('CAN_DRIVE_MANUAL_SYNC_FAILED', { error: String(err) });
          }
        }
      } catch (err) {
        logEvent('STEP_SYNC_FAILED', { step: currentStep, error: String(err) });
      }
    }

    const next = currentStep + 1;
    setStep(next);
    logEvent('STEP_TRANSITION', { from: currentStep, to: next });
  };

  const prevStep = () => {
    const prev = currentStep - 1;
    setStep(prev);
    logEvent('STEP_TRANSITION', { from: currentStep, to: prev });
  };

  const saveAndExit = async () => {
    if (token) {
      try {
        await saveOnboardingStep(token, currentStep, onboardingData);
        logEvent('SAVE_AND_EXIT_SYNC_SUCCESS', { step: currentStep });
      } catch (err) {
        logEvent('SAVE_AND_EXIT_SYNC_FAILED', { step: currentStep, error: String(err) });
      }
    }
    alert('Onboarding status saved successfully. You can resume this application session later.');
    router.push('/login?role=driver');
  };

  const selectLanguage = (lang: string) => {
    const current = [...onboardingData.languages];
    const index = current.indexOf(lang);
    if (index > -1) {
      current.splice(index, 1);
    } else {
      current.push(lang);
    }
    setOnboardingData({ languages: current });
    logEvent('LANGUAGE_PREFERENCE_UPDATED', { languages: current });
  };

  const handleTermsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 2;
    if (isAtBottom) {
      setTermsScrolledToBottom(true);
    }
  };

  const submitOnboarding = async () => {
    if (!token) return;

    logEvent('ONBOARDING_SUBMIT_START', { driverName: onboardingData.fullName });

    try {
      await saveOnboardingStep(token, 7, {
        signatureName: onboardingData.signatureName,
        agreedToTerms: onboardingData.agreedToTerms,
      });
      logEvent('ONBOARDING_COMPLETED', {
        driverName: onboardingData.fullName,
        timestamp: new Date().toISOString()
      });
      alert('Verification Completed! Welcome to Vahnly Fleet Engine. Your application has been submitted for administrative KYC approval.');

      // Clear wizard store
      clearStore();

      router.push('/driver');
    } catch (err) {
      logEvent('ONBOARDING_SUBMIT_ERROR', { error: String(err) });
      alert("Failed to submit application. Please check network connection.");
    }
  };

  return (
    <div className="min-h-screen bg-background-primary text-content-primary p-4 sm:p-8 font-sans flex flex-col justify-between selection:bg-gray-1000 selection:text-gray-0">
      {/* Hidden file input for document uploading */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*,application/pdf"
      />
      
      {/* Onboarding Header */}
      <header className="border-b border-border-opaque pb-4 flex justify-between items-center w-full max-w-4xl mx-auto text-left">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-content-primary font-move">Driver Partner Registration</h1>
          <p className="text-content-tertiary text-[10px] font-mono uppercase font-bold tracking-wider mt-0.5">7-Step Safety & KYC Compliance Wizard</p>
        </div>
        
        <div className="flex gap-2">
          <button 
            onClick={saveAndExit} 
            className="text-[10px] font-mono font-bold uppercase tracking-wider border border-border-opaque px-3 py-1.5 rounded-full hover:bg-background-secondary transition"
          >
            Save & Exit
          </button>
        </div>
      </header>

      {/* Progress Stepper Bar */}
      <div className="w-full max-w-4xl mx-auto my-6">
        <div className="flex justify-between items-center text-xs font-mono mb-2 text-content-tertiary">
          <span>Progress: Step {currentStep} of 7</span>
          <span>{Math.round((currentStep / 7) * 100)}% Complete</span>
        </div>
        <div className="h-1.5 bg-background-secondary rounded-full w-full overflow-hidden flex">
          {Array.from({ length: 7 }).map((_, i) => (
            <div 
              key={i} 
              className={`flex-1 border-r border-border-opaque h-full transition-all duration-300 ${
                i + 1 <= currentStep ? 'bg-gray-1000' : 'bg-background-tertiary'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Active Form Step Cards rendering */}
      <main className="w-full max-w-4xl mx-auto flex-grow flex items-center justify-center my-6">
        <div className="w-full bg-background-primary border border-border-opaque rounded-2xl p-6 sm:p-8 space-y-6 text-left relative overflow-hidden">
          
          {/* STEP 1: PERSONAL DETAILS */}
          {currentStep === 1 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-content-primary border-b border-border-opaque pb-2">Step 1 — Personal Identification</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Full Legal Name (matching PAN/Aadhaar)</label>
                  <input
                    type="text"
                    value={onboardingData.fullName}
                    onChange={(e) => setOnboardingData({ ...onboardingData, fullName: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque"
                    placeholder="Enter name"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Date of Birth</label>
                  <input
                    type="date"
                    value={onboardingData.dob}
                    onChange={(e) => setOnboardingData({ ...onboardingData, dob: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque text-content-secondary"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Gender Identification</label>
                  <select
                    value={onboardingData.gender}
                    onChange={(e) => setOnboardingData({ ...onboardingData, gender: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque"
                  >
                    <option>Male</option>
                    <option>Female</option>
                    <option>Non-binary</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Languages Spoken</label>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {['English', 'Hindi', 'Bengali', 'Kannada', 'Tamil'].map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => selectLanguage(lang)}
                        className={`text-[9px] uppercase tracking-wider font-bold py-1.5 px-3 rounded-full border transition cursor-pointer ${
                          onboardingData.languages.includes(lang)
                            ? 'bg-interactive-primary border-border-selected text-interactive-primary-text'
                            : 'bg-background-secondary border-border-opaque text-content-secondary hover:text-content-primary'
                        }`}
                      >
                        {lang}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="pt-2">
                <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-2 font-mono">Profile Photo Scan</label>
                <div className="flex items-center gap-4 bg-background-secondary/50 p-4 border border-border-opaque rounded-xl">
                  <div className="h-16 w-16 bg-background-tertiary rounded-xl flex items-center justify-center text-xs font-mono text-content-tertiary border border-border-opaque">
                    {onboardingData.profilePhoto ? '✔️ Ready' : 'NO SCAN'}
                  </div>
                  <button
                    type="button"
                    onClick={() => triggerUploadClick('profilePhoto', 'PROFILE_PHOTO')}
                    className="bg-background-tertiary hover:opacity-90 border border-border-opaque text-content-primary rounded-lg px-4 py-2 text-[10px] font-bold uppercase tracking-wider cursor-pointer"
                  >
                    {uploadProgress.profilePhoto ? `Uploading ${uploadProgress.profilePhoto}%` : 'Upload Live Scan'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: ADDRESS */}
          {currentStep === 2 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-content-primary border-b border-border-opaque pb-2">Step 2 — Operating Location</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Permanent Residential Address</label>
                  <textarea
                    rows={2}
                    value={onboardingData.permAddress}
                    onChange={(e) => setOnboardingData({ ...onboardingData, permAddress: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque font-sans"
                    placeholder="Enter permanent address details..."
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Current Residential Address</label>
                  <textarea
                    rows={2}
                    value={onboardingData.currAddress}
                    onChange={(e) => setOnboardingData({ ...onboardingData, currAddress: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque font-sans"
                    placeholder="Enter current address details..."
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Primary City of Operation</label>
                  <select
                    value={onboardingData.city}
                    onChange={(e) => setOnboardingData({ ...onboardingData, city: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque"
                  >
                    <option>Kolkata</option>
                    <option>Bangalore</option>
                    <option>Mumbai</option>
                    <option>Delhi NCR</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: KYC DOCUMENTS */}
          {currentStep === 3 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-content-primary border-b border-border-opaque pb-2">Step 3 — KYC Verification Credentials</h2>
              <div className="space-y-4">
                {[
                  { field: 'drivingLicense', label: 'Driving License (Front & Back OCR Scan)', type: 'DL_FRONT' },
                  { field: 'aadhaarId', label: 'Aadhaar Card (National ID)', type: 'AADHAAR' },
                  { field: 'panCard', label: 'Permanent Account Number (PAN Card)', type: 'PAN' },
                  { field: 'policeVerification', label: 'Police Clearance Certificate (Last 6 Months)', type: 'POLICE_VERIFY' },
                  { field: 'addressProof', label: 'Address Proof Document (Utility Bill / Rent Agreement)', type: 'ADDRESS_PROOF' }
                ].map((doc) => (
                  <div key={doc.field} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-background-secondary/50 p-4 border border-border-opaque rounded-xl">
                    <div className="flex-grow">
                      <span className="block text-xs font-bold text-content-primary">{doc.label}</span>
                      <span className="block text-[8px] font-mono text-content-tertiary mt-1 uppercase">
                        {onboardingData[doc.field as keyof typeof onboardingData] 
                          ? `SYNCED: ${onboardingData[doc.field as keyof typeof onboardingData]?.toString().slice(0, 30)}...` 
                          : 'Awaiting Secure Document Submission'
                        }
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => triggerUploadClick(doc.field, doc.type)}
                      className="bg-background-tertiary hover:opacity-90 text-content-primary rounded-lg px-4 py-2 text-[10px] font-bold uppercase tracking-wider cursor-pointer font-mono shrink-0"
                    >
                      {uploadProgress[doc.field] ? `Uploading ${uploadProgress[doc.field]}%` : 'Upload Doc'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 4: VEHICLE EXPERTISE */}
          {currentStep === 4 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-content-primary border-b border-border-opaque pb-2">Step 4 — Transmission & Expertise Filters</h2>
              <div className="space-y-5">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-2 font-mono">Transmission Systems Qualified to Drive</label>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => setOnboardingData({ ...onboardingData, manualExpertise: !onboardingData.manualExpertise })}
                      className={`py-4 rounded-xl border text-xs font-bold uppercase tracking-wider transition cursor-pointer flex flex-col items-center gap-2 ${
                        onboardingData.manualExpertise ? 'bg-interactive-primary text-interactive-primary-text border-border-selected' : 'bg-background-secondary border-border-opaque text-content-secondary'
                      }`}
                    >
                      <span className="text-xl"><SettingsIcon size={20} /></span>
                      <span>Manual Gearbox</span>
                      <span className="text-[8px] font-mono uppercase">{onboardingData.manualExpertise ? 'Certified' : 'Bypassed'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setOnboardingData({ ...onboardingData, automaticExpertise: !onboardingData.automaticExpertise })}
                      className={`py-4 rounded-xl border text-xs font-bold uppercase tracking-wider transition cursor-pointer flex flex-col items-center gap-2 ${
                        onboardingData.automaticExpertise ? 'bg-interactive-primary text-interactive-primary-text border-border-selected' : 'bg-background-secondary border-border-opaque text-content-secondary'
                      }`}
                    >
                      <span className="text-xl"><CarIcon size={20} /></span>
                      <span>Automatic / EV</span>
                      <span className="text-[8px] font-mono uppercase">{onboardingData.automaticExpertise ? 'Certified' : 'Bypassed'}</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Professional Driving Experience (Years)</label>
                  <input
                    type="number"
                    value={onboardingData.yearsOfExperience}
                    onChange={(e) => setOnboardingData({ ...onboardingData, yearsOfExperience: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque font-mono"
                    placeholder="e.g. 5"
                    min="1"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: BANK DETAILS */}
          {currentStep === 5 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-content-primary border-b border-border-opaque pb-2">Step 5 — Payout Bank Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Account Number</label>
                  <input
                    type="text"
                    value={onboardingData.accountNo}
                    onChange={(e) => setOnboardingData({ ...onboardingData, accountNo: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque font-mono"
                    placeholder="Enter Bank Account No"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">IFSC Code</label>
                  <input
                    type="text"
                    value={onboardingData.ifscCode}
                    onChange={(e) => setOnboardingData({ ...onboardingData, ifscCode: e.target.value })}
                    onBlur={(e) => handleIfscBlur(e.target.value)}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque font-mono"
                    placeholder="IFSC0001234"
                  />
                  {ifscLookup.status === 'loading' && (
                    <p className="mt-1.5 text-[10px] font-mono text-content-tertiary">Verifying IFSC…</p>
                  )}
                  {ifscLookup.status === 'verified' && ifscLookup.label && (
                    <p className="mt-1.5 inline-flex items-center gap-1.5 text-[10px] font-mono text-content-positive">
                      <span><CheckIcon size={14} /></span>
                      <span>{ifscLookup.label}</span>
                    </p>
                  )}
                  {ifscLookup.status === 'error' && (
                    <p className="mt-1.5 text-[10px] font-mono text-content-tertiary">Could not verify IFSC</p>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Account Holder Name</label>
                  <input
                    type="text"
                    value={onboardingData.holderName}
                    onChange={(e) => setOnboardingData({ ...onboardingData, holderName: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque"
                    placeholder="Enter Bank Holder Name"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">UPI ID (for instant payouts)</label>
                  <input
                    type="text"
                    value={onboardingData.upiId}
                    onChange={(e) => setOnboardingData({ ...onboardingData, upiId: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque font-mono"
                    placeholder="name@okbank"
                  />
                </div>
              </div>
              <div className="pt-2">
                <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-2 font-mono">Upload Cancelled Cheque / Statement Proof</label>
                <div className="flex items-center gap-4 bg-background-secondary/50 p-4 border border-border-opaque rounded-xl">
                  <div className="h-12 w-12 bg-background-tertiary rounded-xl flex items-center justify-center text-xs font-mono text-content-tertiary border border-border-opaque">
                    {onboardingData.cancelledCheque ? '✔️ Validated' : 'NO FILE'}
                  </div>
                  <button
                    type="button"
                    onClick={() => triggerUploadClick('cancelledCheque', 'CANCELLED_CHEQUE')}
                    className="bg-background-tertiary hover:opacity-90 border border-border-opaque text-content-primary rounded-lg px-4 py-2 text-[10px] font-bold uppercase tracking-wider cursor-pointer"
                  >
                    {uploadProgress.cancelledCheque ? `Uploading ${uploadProgress.cancelledCheque}%` : 'Upload Cancelled Cheque'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 6: EMERGENCY CONTACT */}
          {currentStep === 6 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-content-primary border-b border-border-opaque pb-2">Step 6 — Emergency Contacts</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Contact Name</label>
                  <input
                    type="text"
                    value={onboardingData.emergencyName}
                    onChange={(e) => setOnboardingData({ ...onboardingData, emergencyName: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque"
                    placeholder="Emergency Contact Name"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Relationship</label>
                  <input
                    type="text"
                    value={onboardingData.emergencyRelation}
                    onChange={(e) => setOnboardingData({ ...onboardingData, emergencyRelation: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque"
                    placeholder="e.g. Spouse / Sibling / Parent"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Phone Number</label>
                  <input
                    type="tel"
                    value={onboardingData.emergencyPhone}
                    onChange={(e) => setOnboardingData({ ...onboardingData, emergencyPhone: e.target.value })}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque font-mono"
                    placeholder="+91 99999 00000"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 7: AGREEMENT */}
          {currentStep === 7 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-content-primary border-b border-border-opaque pb-2">Step 7 — Digitally Sign Agreements</h2>
              <div className="space-y-4 text-content-secondary text-xs leading-relaxed">
                <div 
                  onScroll={handleTermsScroll}
                  className="bg-background-secondary p-4 rounded-xl border border-border-opaque max-h-48 overflow-y-auto space-y-3 font-sans"
                >
                  <h4 className="font-bold text-content-primary text-xs">Terms & Conditions of Partner Dispatch Node</h4>
                  <p>1. The Driver Partner acts as an independent service provider executing matching allocations on behalf of registered vehicle owners.</p>
                  <p>2. Payment ledgers, fees, night surcharges, and wait-time commissions are settled directly via platform escrow accounts upon successful trip confirmations.</p>
                  <p>3. Telemetry tracking coordinates are ingested every 4-5 seconds and are mandatory to maintain connectivity inside Redis spatial clusters.</p>
                  <p>4. Safety regulations and maximum fatigue controls (mandatory rest after 10 hours) must be followed without exception.</p>
                </div>

                <div className="flex justify-between items-center text-[9px] font-mono font-bold uppercase tracking-wider">
                  {termsScrolledToBottom ? (
                    <span className="text-content-positive">✓ Terms Read & Completed</span>
                  ) : (
                    <span className="text-content-tertiary">↓ Please scroll to the bottom of terms to read</span>
                  )}
                </div>
                
                <div className="space-y-3 font-sans">
                  <label className="flex items-start gap-2 cursor-pointer pt-2">
                    <input
                      type="checkbox"
                      checked={onboardingData.agreedToTerms}
                      onChange={(e) => setOnboardingData({ ...onboardingData, agreedToTerms: e.target.checked })}
                      className="mt-0.5"
                    />
                    <span>I read, understood, and digitally authorize the terms, safety guidelines, and escrow payment settlement criteria.</span>
                  </label>

                  <div>
                    <label className="block text-[10px] uppercase font-bold text-content-tertiary mb-1.5 font-mono">Digital Signature (Type your Full Legal Name)</label>
                    <input
                      type="text"
                      value={onboardingData.signatureName}
                      onChange={(e) => setOnboardingData({ ...onboardingData, signatureName: e.target.value })}
                      className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs focus:outline-none focus:border-border-opaque font-mono italic"
                      placeholder="Type name to sign digitally"
                    />
                  </div>
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
              className="bg-background-secondary hover:bg-background-tertiary text-content-secondary border border-border-opaque rounded-full px-6 py-2.5 text-xs font-bold uppercase tracking-wider transition disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
            >
              Back
            </button>

            {currentStep < 7 ? (
              <button
                onClick={nextStep}
                type="button"
                className="bg-interactive-primary hover:opacity-90 text-interactive-primary-text rounded-full px-6 py-2.5 text-xs font-bold uppercase tracking-wider transition disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
              >
                Next
              </button>
            ) : (
              <button
                onClick={submitOnboarding}
                disabled={!termsScrolledToBottom || !onboardingData.agreedToTerms || !onboardingData.signatureName.trim()}
                type="button"
                className="bg-positive-400 hover:opacity-90 text-gray-0 rounded-full px-6 py-2.5 text-xs font-bold uppercase tracking-wider transition disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 font-mono"
              >
                I Agree and Submit Application
              </button>
            )}
          </div>

        </div>
      </main>

      {/* Onboarding Logs Terminal panel */}
      {logs.length > 0 && (
        <div className="w-full max-w-4xl mx-auto border-t border-border-opaque pt-4 text-left">
          <span className="text-[9px] font-mono font-bold text-content-tertiary uppercase tracking-widest block mb-2">Live Verification Stream Audit logs:</span>
          <div className="bg-background-primary border border-border-opaque rounded-xl p-3 max-h-32 overflow-y-auto font-mono text-[8px] text-content-tertiary space-y-1 scrollbar-thin">
            {logs.map((lg, i) => (
              <div key={i} className="truncate select-all">{lg}</div>
            ))}
          </div>
        </div>
      )}

      <footer className="w-full max-w-4xl mx-auto text-left flex justify-between items-center text-[9px] text-content-tertiary font-mono pt-4 mt-6 border-t border-border-opaque">
        <span>SECURITY NODE: ID_VERIFY_ACTIVE</span>
        <span>HUB: KOLKATA / BANGALORE CORPS</span>
      </footer>
    </div>
  );
}
