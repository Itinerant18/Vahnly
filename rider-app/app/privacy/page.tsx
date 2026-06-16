'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PrivacyPolicy() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'privacy' | 'terms'>('privacy');

  const handleTabChange = (tab: 'privacy' | 'terms') => {
    setActiveTab(tab);
    if (tab === 'terms') {
      router.push('/terms/');
    }
  };

  return (
    <div className="min-h-screen relative flex flex-col items-center py-12 px-4 md:px-8 bg-slate-50 text-slate-800 font-sans overflow-x-hidden selection:bg-slate-900 selection:text-white">
      {/* Subtle grid pattern for premium vibe */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-50 pointer-events-none" />

      {/* Content Container */}
      <div className="relative z-10 w-full max-w-4xl animate-enter-up">
        {/* Navigation / Header Actions */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-8 pb-6 border-b border-slate-200">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/')}
              className="group flex items-center justify-center h-10 px-4 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-all duration-200 cursor-pointer text-sm font-medium shadow-sm"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mr-2 group-hover:-translate-x-1 transition-transform"
              >
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              Home
            </button>

            <div className="flex bg-slate-200/60 p-1 rounded-lg border border-slate-200/80">
              <button
                onClick={() => handleTabChange('privacy')}
                className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer ${
                  activeTab === 'privacy'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Privacy Policy
              </button>
              <button
                onClick={() => handleTabChange('terms')}
                className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer ${
                  activeTab === 'terms'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Terms of Service
              </button>
            </div>
          </div>

          <button
            onClick={() => window.print()}
            className="flex items-center justify-center h-10 px-4 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all cursor-pointer text-sm shadow-sm"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mr-2"
            >
              <polyline points="6 9 6 2 18 2 18 9"></polyline>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
              <rect x="6" y="14" width="12" height="8"></rect>
            </svg>
            Print
          </button>
        </div>

        {/* Card containing policy */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 md:p-10 shadow-sm">
          <div className="space-y-6">
            <div className="border-b border-slate-100 pb-6">
              <span className="text-xs font-mono uppercase tracking-widest text-indigo-600 font-bold">Legal Document</span>
              <h1 className="text-3xl font-extrabold tracking-tight mt-2 text-slate-900">
                Privacy Policy
              </h1>
              <p className="text-xs text-slate-400 font-mono mt-2">Last Updated: June 15, 2026</p>
            </div>

            <div className="prose prose-slate max-w-none text-slate-600 space-y-6 text-sm md:text-base leading-relaxed">
              <p>
                At <strong>Vahnly</strong>, we prioritize the protection and confidentiality of your personal data. 
                This Privacy Policy explains how our unified dispatch matching platform collects, stores, uses, and protects 
                information when you access our mobile and web applications (the "Service").
              </p>

              <div>
                <h2 className="text-lg font-bold text-slate-900 mb-2">1. Information We Collect</h2>
                <p>We collect information to provide, maintain, and secure a premium experience. This includes:</p>
                <ul className="list-disc pl-5 space-y-2 mt-2">
                  <li>
                    <strong>Account Identity:</strong> Information supplied during signup or federated Google Sign-In, 
                    such as your name, email address, profile photo, and credential tokens.
                  </li>
                  <li>
                    <strong>Verification Credentials:</strong> Mobile phone numbers collected for multi-factor OTP 
                    verification to authenticate your identity in compliance with regional fraud prevention models.
                  </li>
                  <li>
                    <strong>Real-Time Location:</strong> Continuous or transactional geolocation coordinates collected 
                    from your device while the app is active, required to calculate driver distances, perform matches, 
                    track ongoing trips, and ensure safety.
                  </li>
                  <li>
                    <strong>Device Details:</strong> Unique hardware identifiers, IP addresses, OS version, Capacitor 
                    runtime builds, and system audit logs.
                  </li>
                </ul>
              </div>

              <div>
                <h2 className="text-lg font-bold text-slate-900 mb-2">2. How We Use Your Information</h2>
                <p>Your data is processed strictly to fulfill operational and safety requirements:</p>
                <ul className="list-disc pl-5 space-y-2 mt-2">
                  <li>Facilitating instant matching between riders and professional drivers.</li>
                  <li>Verifying authentication sessions using secure Firebase credentials.</li>
                  <li>Calculating regional trip fares, ETA updates, and processing transaction routing.</li>
                  <li>Distributing instant push notifications for matching status and safety alerts.</li>
                  <li>Monitoring system logs to maintain platform performance and detect malicious activities.</li>
                </ul>
              </div>

              <div>
                <h2 className="text-lg font-bold text-slate-900 mb-2">3. SMS & Communication Policy</h2>
                <p>
                  To secure user accounts, we utilize Firebase Phone Authentication. Verification codes (OTPs) and 
                  critical transaction updates are sent via SMS. 
                </p>
                <p className="mt-2">
                  <strong>SMS Region Policy:</strong> To maintain security and control billing overhead, SMS OTP delivery 
                  is restricted to supported operational domains (specifically India, country code <code>+91</code>).
                </p>
              </div>

              <div>
                <h2 className="text-lg font-bold text-slate-900 mb-2">4. Information Sharing & Third-Parties</h2>
                <p>We do not sell your personal data. Your information is shared only under strict conditions:</p>
                <ul className="list-disc pl-5 space-y-2 mt-2">
                  <li>
                    <strong>Rider-Driver Matching:</strong> Drivers see a rider's name, pickup location, and destination 
                    to execute a dispatch. Riders see the matching driver's profile, phone number, and location.
                  </li>
                  <li>
                    <strong>Firebase and Google Services:</strong> We integrate Google Maps API and Firebase Authentication 
                    to support identity verification, maps, and push notification transport.
                  </li>
                  <li>
                    <strong>Legal Mandates:</strong> Data may be disclosed if required by law, regulatory compliance, or 
                    judicial inquiries.
                  </li>
                </ul>
              </div>

              <div>
                <h2 className="text-lg font-bold text-slate-900 mb-2">5. Data Retention & Deletion Rights</h2>
                <p>
                  We retain personal data as long as your account remains active. You hold the right to request deletion 
                  of your profile and all linked records. Upon request, we will expunge your sensitive details from our active 
                  PostgreSQL and Redis stores, subject to standard regulatory backups.
                </p>
              </div>

              <div>
                <h2 className="text-lg font-bold text-slate-900 mb-2">6. Contact and Administration</h2>
                <p>
                  If you have questions, feedback, or data privacy requests regarding the Vahnly platform, 
                  please reach out to our administration team at:
                </p>
                <p className="mt-2 font-mono text-xs text-slate-700 bg-slate-100 p-3 rounded border border-slate-200">
                  Email: karmakaraniket018@gmail.com<br />
                  Operational Hub: Asia-South1 (India)
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="mt-8 text-center text-[10px] text-slate-400 font-mono">
          <span>Vahnly © 2026. All rights reserved.</span>
        </div>
      </div>
    </div>
  );
}
