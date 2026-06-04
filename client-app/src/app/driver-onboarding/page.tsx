'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

interface QuizQuestion {
  id: number;
  text: string;
  options: string[];
  correctAnswer: number;
}

export default function DriverOnboardingWizard() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [logs, setLogs] = useState<string[]>([]);
  const [onboardingData, setOnboardingData] = useState({
    // Step 1: Personal
    fullName: '',
    dob: '',
    gender: 'Male',
    profilePhoto: null as string | null,
    languages: [] as string[],
    
    // Step 2: Address
    permAddress: '',
    currAddress: '',
    city: 'Kolkata',

    // Step 3: KYC Docs
    drivingLicense: null as string | null,
    aadhaarId: null as string | null,
    panCard: null as string | null,
    policeVerification: null as string | null,
    addressProof: null as string | null,

    // Step 4: Vehicle Expertise
    manualExpertise: true,
    automaticExpertise: true,
    yearsOfExperience: '5',

    // Step 5: Bank Details
    accountNo: '',
    ifscCode: '',
    holderName: '',
    upiId: '',
    cancelledCheque: null as string | null,

    // Step 6: Emergency Contact
    emergencyName: '',
    emergencyRelation: '',
    emergencyPhone: '',

    // Step 7: Agreement
    signatureName: '',
    agreedToTerms: false,

    // Step 8: Training Quiz Answers
    quizAnswers: {} as Record<number, number>
  });

  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [showScore, setShowScore] = useState(false);
  const [quizScore, setQuizScore] = useState(0);

  // Safety Etiquette quiz data bank
  const quizQuestions: QuizQuestion[] = [
    {
      id: 1,
      text: "What is the mandatory action upon arriving at a customer's vehicle location?",
      options: [
        "Immediately start the engine and drive off",
        "Verify the customer's identity, input the start Odometer reading, and verify the 4-digit OTP",
        "Wait inside the car and listen to music",
        "Ask the customer to transfer funds to your personal account first"
      ],
      correctAnswer: 1
    },
    {
      id: 2,
      text: "How should you respond to unexpected heavy route congestion or delays during Outstation journeys?",
      options: [
        "Take high-speed risky shortcuts without checking safety conditions",
        "Politely explain the situation to the customer, navigate via standard safe routes, and update ETA",
        "Cancel the trip immediately and drop the customer off on the highway",
        "Speed up past local speed limit thresholds to make up for lost time"
      ],
      correctAnswer: 1
    },
    {
      id: 3,
      text: "If a rider has activated 'D4M Care' protection, this implies:",
      options: [
        "The driver receives a higher incentive bonus for zero-incident safety ratings",
        "Rider has premium support coverage, and driver must follow priority safety protocols",
        "The driver is allowed to drive faster than usual",
        "Both A and B are correct"
      ],
      correctAnswer: 3
    },
    {
      id: 4,
      text: "What is the daily fatigue threshold limit in our platform before a mandatory rest break is triggered?",
      options: [
        "6 continuous duty hours",
        "10 continuous duty hours",
        "16 continuous duty hours",
        "24 continuous duty hours"
      ],
      correctAnswer: 1
    },
    {
      id: 5,
      text: "What action should you take if an emergency situation arises during the trip?",
      options: [
        "Tap the red SOS safety trigger on the screen to alert emergency nodes & call local hotline authorities",
        "Try to resolve the dispute yourself on the road",
        "Continue driving to the destination ignoring the issue",
        "Turn off your phone to avoid distractions"
      ],
      correctAnswer: 0
    }
  ];

  // Helper log function
  const logEvent = (action: string, meta: any) => {
    const time = new Date().toISOString();
    const str = `[ONBOARDING_LOG] ${time} | ${action} | Meta: ${JSON.stringify(meta)}`;
    console.log(str);
    setLogs((prev) => [str, ...prev]);
  };

  // Simulate file upload
  const handleSimulatedUpload = (fieldName: string, docName: string) => {
    logEvent('UPLOAD_START', { fieldName, docName });
    setUploadProgress((prev) => ({ ...prev, [fieldName]: 10 }));
    
    let current = 10;
    const interval = setInterval(() => {
      current += 30;
      if (current >= 100) {
        clearInterval(interval);
        setUploadProgress((prev) => ({ ...prev, [fieldName]: 100 }));
        setOnboardingData((prev) => ({ ...prev, [fieldName]: `s3://driversforu-vault/docs/${fieldName}-${Date.now()}.png` }));
        logEvent('UPLOAD_COMPLETE', { fieldName, docName, status: 'VERIFIED', reviewer: 'admin-auto-ocr-92' });
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

  const saveAndExit = () => {
    logEvent('SAVE_AND_EXIT', { step: currentStep, dataSnapshot: onboardingData });
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
    setOnboardingData((prev) => ({ ...prev, languages: current }));
    logEvent('LANGUAGE_PREFERENCE_UPDATED', { languages: current });
  };

  const handleQuizAnswer = (qId: number, optionIdx: number) => {
    const currentAnswers = { ...onboardingData.quizAnswers, [qId]: optionIdx };
    setOnboardingData((prev) => ({ ...prev, quizAnswers: currentAnswers }));
    logEvent('QUIZ_ANSWER_SELECT', { questionId: qId, selectedOption: optionIdx });
  };

  const evaluateQuizAndSubmit = () => {
    let score = 0;
    quizQuestions.forEach((q) => {
      if (onboardingData.quizAnswers[q.id] === q.correctAnswer) {
        score += 1;
      }
    });

    setQuizScore(score);
    setShowScore(true);

    const passed = score >= 4; // requires 80%+ to pass
    logEvent('QUIZ_EVALUATION', { score, totalQuestions: quizQuestions.length, passed });

    if (passed) {
      logEvent('ONBOARDING_COMPLETED', {
        driverName: onboardingData.fullName,
        timestamp: new Date().toISOString()
      });
      alert('Verification Completed! Welcome to Drivers-For-U Fleet Engine.');
      router.push('/login?role=driver');
    } else {
      alert('Safety & Etiquette Quiz score below standard thresholds (requires 4/5 correct answers). Please review safety details and retry the quiz.');
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-8 font-sans flex flex-col justify-between selection:bg-white selection:text-black">
      
      {/* Onboarding Header */}
      <header className="border-b border-zinc-800 pb-4 flex justify-between items-center w-full max-w-4xl mx-auto text-left">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white font-move">Driver Partner Registration</h1>
          <p className="text-zinc-500 text-[10px] font-mono uppercase font-bold tracking-wider mt-0.5">8-Step Safety & KYC Compliance Wizard</p>
        </div>
        
        <div className="flex gap-2">
          <button 
            onClick={saveAndExit} 
            className="text-[10px] font-mono font-bold uppercase tracking-wider border border-zinc-800 px-3 py-1.5 rounded-full hover:bg-zinc-900 transition"
          >
            Save & Exit
          </button>
        </div>
      </header>

      {/* Progress Stepper Bar */}
      <div className="w-full max-w-4xl mx-auto my-6">
        <div className="flex justify-between items-center text-xs font-mono mb-2 text-zinc-500">
          <span>Progress: Step {currentStep} of 8</span>
          <span>{Math.round((currentStep / 8) * 100)}% Complete</span>
        </div>
        <div className="h-1.5 bg-zinc-900 rounded-full w-full overflow-hidden flex">
          {Array.from({ length: 8 }).map((_, i) => (
            <div 
              key={i} 
              className={`flex-1 border-r border-black h-full transition-all duration-300 ${
                i + 1 <= currentStep ? 'bg-white' : 'bg-zinc-850'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Active Form Step Cards rendering */}
      <main className="w-full max-w-4xl mx-auto flex-grow flex items-center justify-center my-6">
        <div className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-6 sm:p-8 space-y-6 text-left relative overflow-hidden">
          
          {/* STEP 1: PERSONAL DETAILS */}
          {currentStep === 1 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-white border-b border-zinc-900 pb-2">Step 1 — Personal Identification</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Full Legal Name (matching PAN/Aadhaar)</label>
                  <input
                    type="text"
                    value={onboardingData.fullName}
                    onChange={(e) => setOnboardingData({ ...onboardingData, fullName: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500"
                    placeholder="Enter name"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Date of Birth</label>
                  <input
                    type="date"
                    value={onboardingData.dob}
                    onChange={(e) => setOnboardingData({ ...onboardingData, dob: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500 text-zinc-400"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Gender Identification</label>
                  <select
                    value={onboardingData.gender}
                    onChange={(e) => setOnboardingData({ ...onboardingData, gender: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500"
                  >
                    <option>Male</option>
                    <option>Female</option>
                    <option>Non-binary</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Languages Spoken</label>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {['English', 'Hindi', 'Bengali', 'Kannada', 'Tamil'].map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => selectLanguage(lang)}
                        className={`text-[9px] uppercase tracking-wider font-bold py-1.5 px-3 rounded-full border transition cursor-pointer ${
                          onboardingData.languages.includes(lang)
                            ? 'bg-white border-white text-black'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                        }`}
                      >
                        {lang}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="pt-2">
                <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-2 font-mono">Profile Photo Scan</label>
                <div className="flex items-center gap-4 bg-zinc-900/50 p-4 border border-zinc-800 rounded-xl">
                  <div className="h-16 w-16 bg-zinc-850 rounded-xl flex items-center justify-center text-xs font-mono text-zinc-600 border border-zinc-800">
                    {onboardingData.profilePhoto ? '✔️ Ready' : 'NO SCAN'}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSimulatedUpload('profilePhoto', 'ProfilePicture_Scan')}
                    className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white rounded-lg px-4 py-2 text-[10px] font-bold uppercase tracking-wider cursor-pointer"
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
              <h2 className="text-lg font-bold font-move text-white border-b border-zinc-900 pb-2">Step 2 — Operating Location</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Permanent Residential Address</label>
                  <textarea
                    rows={2}
                    value={onboardingData.permAddress}
                    onChange={(e) => setOnboardingData({ ...onboardingData, permAddress: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500 font-sans"
                    placeholder="Enter permanent address details..."
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Current Residential Address</label>
                  <textarea
                    rows={2}
                    value={onboardingData.currAddress}
                    onChange={(e) => setOnboardingData({ ...onboardingData, currAddress: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500 font-sans"
                    placeholder="Enter current address details..."
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Primary City of Operation</label>
                  <select
                    value={onboardingData.city}
                    onChange={(e) => setOnboardingData({ ...onboardingData, city: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500"
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
              <h2 className="text-lg font-bold font-move text-white border-b border-zinc-900 pb-2">Step 3 — KYC Verification Credentials</h2>
              <div className="space-y-4">
                {[
                  { field: 'drivingLicense', label: 'Driving License (Front & Back OCR Scan)' },
                  { field: 'aadhaarId', label: 'Aadhaar Card (National ID)' },
                  { field: 'panCard', label: 'Permanent Account Number (PAN Card)' },
                  { field: 'policeVerification', label: 'Police Clearance Certificate (Last 6 Months)' },
                  { field: 'addressProof', label: 'Address Proof Document (Utility Bill / Rent Agreement)' }
                ].map((doc) => (
                  <div key={doc.field} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-900/50 p-4 border border-zinc-800 rounded-xl">
                    <div>
                      <span className="block text-xs font-bold text-white">{doc.label}</span>
                      <span className="block text-[8px] font-mono text-zinc-500 mt-1 uppercase">
                        {onboardingData[doc.field as keyof typeof onboardingData] 
                          ? `SYNCED: ${onboardingData[doc.field as keyof typeof onboardingData]?.toString().slice(0, 30)}...` 
                          : 'Awaiting Secure Document Submission'
                        }
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSimulatedUpload(doc.field, doc.label)}
                      className="bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg px-4 py-2 text-[10px] font-bold uppercase tracking-wider cursor-pointer font-mono shrink-0"
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
              <h2 className="text-lg font-bold font-move text-white border-b border-zinc-900 pb-2">Step 4 — Transmission & Expertise Filters</h2>
              <div className="space-y-5">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-2 font-mono">Transmission Systems Qualified to Drive</label>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => setOnboardingData({ ...onboardingData, manualExpertise: !onboardingData.manualExpertise })}
                      className={`py-4 rounded-xl border text-xs font-bold uppercase tracking-wider transition cursor-pointer flex flex-col items-center gap-2 ${
                        onboardingData.manualExpertise ? 'bg-white text-black border-white' : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                      }`}
                    >
                      <span className="text-xl">⚙️</span>
                      <span>Manual Gearbox</span>
                      <span className="text-[8px] font-mono uppercase">{onboardingData.manualExpertise ? 'Certified' : 'Bypassed'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setOnboardingData({ ...onboardingData, automaticExpertise: !onboardingData.automaticExpertise })}
                      className={`py-4 rounded-xl border text-xs font-bold uppercase tracking-wider transition cursor-pointer flex flex-col items-center gap-2 ${
                        onboardingData.automaticExpertise ? 'bg-white text-black border-white' : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                      }`}
                    >
                      <span className="text-xl">🕹️</span>
                      <span>Automatic / EV</span>
                      <span className="text-[8px] font-mono uppercase">{onboardingData.automaticExpertise ? 'Certified' : 'Bypassed'}</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Professional Driving Experience (Years)</label>
                  <input
                    type="number"
                    value={onboardingData.yearsOfExperience}
                    onChange={(e) => setOnboardingData({ ...onboardingData, yearsOfExperience: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500 font-mono"
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
              <h2 className="text-lg font-bold font-move text-white border-b border-zinc-900 pb-2">Step 5 — Payout Bank Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Account Number</label>
                  <input
                    type="text"
                    value={onboardingData.accountNo}
                    onChange={(e) => setOnboardingData({ ...onboardingData, accountNo: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500 font-mono"
                    placeholder="Enter Bank Account No"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">IFSC Code</label>
                  <input
                    type="text"
                    value={onboardingData.ifscCode}
                    onChange={(e) => setOnboardingData({ ...onboardingData, ifscCode: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500 font-mono"
                    placeholder="IFSC0001234"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Account Holder Name</label>
                  <input
                    type="text"
                    value={onboardingData.holderName}
                    onChange={(e) => setOnboardingData({ ...onboardingData, holderName: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500"
                    placeholder="Enter Bank Holder Name"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">UPI ID (for instant payouts)</label>
                  <input
                    type="text"
                    value={onboardingData.upiId}
                    onChange={(e) => setOnboardingData({ ...onboardingData, upiId: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500 font-mono"
                    placeholder="name@okbank"
                  />
                </div>
              </div>
              <div className="pt-2">
                <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-2 font-mono">Upload Cancelled Cheque / Statement Proof</label>
                <div className="flex items-center gap-4 bg-zinc-900/50 p-4 border border-zinc-800 rounded-xl">
                  <div className="h-12 w-12 bg-zinc-850 rounded-xl flex items-center justify-center text-xs font-mono text-zinc-600 border border-zinc-800">
                    {onboardingData.cancelledCheque ? '✔️ Validated' : 'NO FILE'}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSimulatedUpload('cancelledCheque', 'Cancelled_Cheque_Scan')}
                    className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white rounded-lg px-4 py-2 text-[10px] font-bold uppercase tracking-wider cursor-pointer"
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
              <h2 className="text-lg font-bold font-move text-white border-b border-zinc-900 pb-2">Step 6 — Emergency Contacts</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Contact Name</label>
                  <input
                    type="text"
                    value={onboardingData.emergencyName}
                    onChange={(e) => setOnboardingData({ ...onboardingData, emergencyName: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500"
                    placeholder="Emergency Contact Name"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Relationship</label>
                  <input
                    type="text"
                    value={onboardingData.emergencyRelation}
                    onChange={(e) => setOnboardingData({ ...onboardingData, emergencyRelation: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500"
                    placeholder="e.g. Spouse / Sibling / Parent"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Phone Number</label>
                  <input
                    type="tel"
                    value={onboardingData.emergencyPhone}
                    onChange={(e) => setOnboardingData({ ...onboardingData, emergencyPhone: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500 font-mono"
                    placeholder="+91 99999 00000"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 7: AGREEMENT */}
          {currentStep === 7 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-white border-b border-zinc-900 pb-2">Step 7 — Digitally Sign Agreements</h2>
              <div className="space-y-4 text-zinc-400 text-xs leading-relaxed">
                <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-800 max-h-48 overflow-y-auto space-y-3 font-sans">
                  <h4 className="font-bold text-white text-xs">Terms & Conditions of Partner Dispatch Node</h4>
                  <p>1. The Driver Partner acts as an independent service provider executing matching allocations on behalf of registered vehicle owners.</p>
                  <p>2. Payment ledgers, fees, night surcharges, and wait-time commissions are settled directly via platform escrow accounts upon successful trip confirmations.</p>
                  <p>3. Telemetry tracking coordinates are ingested every 4-5 seconds and are mandatory to maintain connectivity inside Redis spatial clusters.</p>
                  <p>4. Safety regulations and maximum fatigue controls (mandatory rest after 10 hours) must be followed without exception.</p>
                </div>
                
                <div className="space-y-3">
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
                    <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5 font-mono">Digital Signature (Type your Full Legal Name)</label>
                    <input
                      type="text"
                      value={onboardingData.signatureName}
                      onChange={(e) => setOnboardingData({ ...onboardingData, signatureName: e.target.value })}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none focus:border-zinc-500 font-mono italic"
                      placeholder="Type name to sign digitally"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 8: TRAINING QUIZ */}
          {currentStep === 8 && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold font-move text-white border-b border-zinc-900 pb-2">Step 8 — Safety & Etiquette Certification Quiz</h2>
              <p className="text-[10px] text-zinc-500 font-mono leading-relaxed">
                Passing Score requirement: 80% (at least 4/5 answers correct). Review the safety and etiquette questions below.
              </p>
              
              <div className="space-y-6 pt-2">
                {quizQuestions.map((q, idx) => (
                  <div key={q.id} className="space-y-2 border-b border-zinc-900 pb-4">
                    <span className="block text-xs font-bold text-white">{idx + 1}. {q.text}</span>
                    <div className="flex flex-col gap-2 pt-1">
                      {q.options.map((opt, optIdx) => (
                        <button
                          key={optIdx}
                          type="button"
                          onClick={() => handleQuizAnswer(q.id, optIdx)}
                          className={`w-full text-left p-3 text-xs rounded-xl border transition cursor-pointer flex items-center justify-between ${
                            onboardingData.quizAnswers[q.id] === optIdx
                              ? 'bg-white border-white text-black font-semibold'
                              : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                          }`}
                        >
                          <span>{opt}</span>
                          {onboardingData.quizAnswers[q.id] === optIdx && <span className="text-[10px]">✔️</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stepper Navigation Buttons */}
          <div className="flex justify-between items-center border-t border-zinc-900 pt-6">
            <button
              onClick={prevStep}
              disabled={currentStep === 1}
              type="button"
              className="bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded-full px-6 py-2.5 text-xs font-bold uppercase tracking-wider transition disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
            >
              Back
            </button>

            {currentStep < 8 ? (
              <button
                onClick={nextStep}
                type="button"
                className="bg-white hover:bg-zinc-200 text-black rounded-full px-6 py-2.5 text-xs font-bold uppercase tracking-wider transition active:scale-95"
              >
                Next
              </button>
            ) : (
              <button
                onClick={evaluateQuizAndSubmit}
                type="button"
                className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-full px-6 py-2.5 text-xs font-bold uppercase tracking-wider transition active:scale-95 font-mono"
              >
                Submit for Verification
              </button>
            )}
          </div>

        </div>
      </main>

      {/* Onboarding Logs Terminal panel */}
      {logs.length > 0 && (
        <div className="w-full max-w-4xl mx-auto border-t border-zinc-900 pt-4 text-left">
          <span className="text-[9px] font-mono font-bold text-zinc-600 uppercase tracking-widest block mb-2">Live Verification Stream Audit logs:</span>
          <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-3 max-h-32 overflow-y-auto font-mono text-[8px] text-zinc-500 space-y-1 scrollbar-thin">
            {logs.map((lg, i) => (
              <div key={i} className="truncate select-all">{lg}</div>
            ))}
          </div>
        </div>
      )}

      <footer className="w-full max-w-4xl mx-auto text-left flex justify-between items-center text-[9px] text-zinc-600 font-mono pt-4 mt-6 border-t border-zinc-900">
        <span>SECURITY NODE: ID_VERIFY_ACTIVE</span>
        <span>HUB: KOLKATA / BANGALORE CORPS</span>
      </footer>
    </div>
  );
}
