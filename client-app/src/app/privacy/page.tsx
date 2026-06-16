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
    <div className="min-h-screen relative flex flex-col items-center py-12 px-4 md:px-8 bg-black text-white font-sans overflow-x-hidden selection:bg-white selection:text-black">
      {/* Grid line matrix background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-20 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-tr from-background-primary via-black to-background-secondary z-0 opacity-80 pointer-events-none" />

      {/* Content Container */}
      <div className="relative z-10 w-full max-w-4xl animate-enter-up">
        {/* Navigation / Header Actions */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-8 pb-6 border-b border-border-opaque">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/')}
              className="group flex items-center justify-center h-10 px-4 rounded-md border border-border-opaque bg-background-secondary hover:bg-white hover:text-black hover:border-white transition-all duration-200 cursor-pointer"
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

            <div className="flex bg-background-secondary border border-border-opaque p-1 rounded-lg">
              <button
                onClick={() => handleTabChange('privacy')}
                className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer ${
                  activeTab === 'privacy'
                    ? 'bg-white text-black shadow-md'
                    : 'text-content-secondary hover:text-white'
                }`}
              >
                Privacy Policy
              </button>
              <button
                onClick={() => handleTabChange('terms')}
                className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer ${
                  activeTab === 'terms'
                    ? 'bg-white text-black shadow-md'
                    : 'text-content-secondary hover:text-white'
                }`}
              >
                Terms of Service
              </button>
            </div>
          </div>

          <button
            onClick={() => window.print()}
            className="flex items-center justify-center h-10 px-4 rounded-md border border-border-opaque bg-background-secondary hover:border-white transition-all cursor-pointer text-sm"
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
        <div className="bg-background-secondary/40 backdrop-blur-md border border-border-opaque rounded-2xl p-6 md:p-10 shadow-elevation-3">
          <div className="space-y-6">
            <div className="border-b border-border-opaque pb-6">
              <span className="text-xs font-mono uppercase tracking-widest text-accent-400 font-bold">Legal Document</span>
              <h1 className="text-3xl font-extrabold tracking-tight mt-2 font-move bg-gradient-to-r from-white via-gray-300 to-gray-500 bg-clip-text text-transparent">
                Privacy Policy
              </h1>
              <p className="text-xs text-content-tertiary font-mono mt-2">Last Updated: June 15, 2026</p>
            </div>

            <div className="prose prose-invert max-w-none text-content-secondary space-y-6 text-paragraph-medium leading-relaxed">
              <p>
                At <strong>Vahnly</strong>, we prioritize the protection and confidentiality of your personal data. 
                This Privacy Policy explains how our unified dispatch matching platform collects, stores, uses, and protects 
                information when you access our mobile and web applications (the "Service").
              </p>

              <div>
                <h2 className="text-heading-large text-white mb-3">1. Information We Collect</h2>
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
                <h2 className="text-heading-large text-white mb-3">2. How We Use Your Information</h2>
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
                <h2 className="text-heading-large text-white mb-3">3. SMS & Communication Policy</h2>
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
                <h2 className="text-heading-large text-white mb-3">4. Information Sharing & Third-Parties</h2>
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
                <h2 className="text-heading-large text-white mb-3">5. Data Retention & Deletion Rights</h2>
                <p>
                  We retain personal data as long as your account remains active. You hold the right to request deletion 
                  of your profile and all linked records. Upon request, we will expunge your sensitive details from our active 
                  PostgreSQL and Redis stores, subject to standard regulatory backups.
                </p>
              </div>

              <div>
                <h2 className="text-heading-large text-white mb-3">6. Contact and Administration</h2>
                <p>
                  If you have questions, feedback, or data privacy requests regarding the Vahnly platform, 
                  please reach out to our administration team at:
                </p>
                <p className="mt-2 font-mono text-xs text-white bg-black/60 p-3 rounded border border-border-opaque">
                  Email: karmakaraniket018@gmail.com<br />
                  Operational Hub: Asia-South1 (India)
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="mt-8 text-center text-[10px] text-content-tertiary font-mono">
          <span>Vahnly © 2026. All rights reserved.</span>
        </div>
      </div>
    </div>
  );
}
