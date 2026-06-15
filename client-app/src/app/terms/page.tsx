'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function TermsOfService() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'privacy' | 'terms'>('terms');

  const handleTabChange = (tab: 'privacy' | 'terms') => {
    setActiveTab(tab);
    if (tab === 'privacy') {
      router.push('/privacy/');
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

        {/* Card containing terms */}
        <div className="bg-background-secondary/40 backdrop-blur-md border border-border-opaque rounded-2xl p-6 md:p-10 shadow-elevation-3">
          <div className="space-y-6">
            <div className="border-b border-border-opaque pb-6">
              <span className="text-xs font-mono uppercase tracking-widest text-accent-400 font-bold">Legal Agreement</span>
              <h1 className="text-3xl font-extrabold tracking-tight mt-2 font-move bg-gradient-to-r from-white via-gray-300 to-gray-500 bg-clip-text text-transparent">
                Terms of Service
              </h1>
              <p className="text-xs text-content-tertiary font-mono mt-2">Last Updated: June 15, 2026</p>
            </div>

            <div className="prose prose-invert max-w-none text-content-secondary space-y-6 text-paragraph-medium leading-relaxed">
              <p>
                Welcome to <strong>Drivers-For-U</strong>. By accessing or using our unified dispatch ride matching 
                ecosystem, including our mobile and web applications (the "Service"), you agree to be bound by these 
                Terms of Service. If you do not agree to all terms, you are prohibited from utilizing the Service.
              </p>

              <div>
                <h2 className="text-heading-large text-white mb-3">1. Scope of Service</h2>
                <p>
                  Drivers-For-U acts exclusively as a technology dispatch matching platform that connects independent 
                  riders with independent professional drivers. 
                </p>
                <p className="mt-2">
                  <strong>Non-Carrier Status:</strong> Drivers-For-U does not operate as a transportation provider, 
                  nor does it employ drivers. Any matches or agreements made between a rider and a driver represent an 
                  agreement solely between those parties.
                </p>
              </div>

              <div>
                <h2 className="text-heading-large text-white mb-3">2. Account Registration & MFA Verification</h2>
                <p>To use the Service, you must comply with the following registration requirements:</p>
                <ul className="list-disc pl-5 space-y-2 mt-2">
                  <li>You must be at least 18 years of age or the age of legal majority in your jurisdiction.</li>
                  <li>You must verify your phone number via a Multi-Factor Authentication OTP code sent to your device.</li>
                  <li>
                    You are responsible for safeguarding your login credentials, including Federated Google account tokens, 
                    and for all transactions initiated under your account.
                  </li>
                  <li>
                    <strong>SMS Regions:</strong> Registration and SMS transmission are restricted to supported 
                    networks within our active region (specifically India, country code <code>+91</code>).
                  </li>
                </ul>
              </div>

              <div>
                <h2 className="text-heading-large text-white mb-3">3. Acceptable Code of Conduct</h2>
                <p>You agree to utilize the platform in a safe, legal, and respectful manner. You shall not:</p>
                <ul className="list-disc pl-5 space-y-2 mt-2">
                  <li>Use the service to transport illicit, dangerous, or hazardous substances.</li>
                  <li>Initiate fraudulent bookings or manipulate dispatch matching algorithms.</li>
                  <li>Abuse or harass drivers, riders, or platform administrative staff.</li>
                  <li>Violate traffic codes or safety rules when acting as a driver.</li>
                </ul>
              </div>

              <div>
                <h2 className="text-heading-large text-white mb-3">4. Fare Calculation, Pricing, and Payments</h2>
                <p>
                  Fares are calculated dynamically based on regional routing models. Factors include base rates, trip duration, 
                  distance, hub zones, and real-time surge multipliers. 
                </p>
                <p className="mt-2">
                  By accepting a trip match, you authorize the charge of the dynamic fare. Payments are handled via linked digital 
                  wallets or cash fallback routing, depending on local region availability.
                </p>
              </div>

              <div>
                <h2 className="text-heading-large text-white mb-3">5. Disclaimer and Limitation of Liability</h2>
                <p>
                  DRIVERS-FOR-U PROVIDES THE SERVICE ON AN "AS IS" AND "AS AVAILABLE" BASIS. WE DISCLAIM ALL WARRANTIES, EXPRESS 
                  OR IMPLIED, INCLUDING MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE.
                </p>
                <p className="mt-2">
                  To the maximum extent permitted by law, Drivers-For-U is not liable for direct, indirect, incidental, punitive, 
                  or consequential damages arising out of matching operations, driver performance, trip safety, or platform downtime.
                </p>
              </div>

              <div>
                <h2 className="text-heading-large text-white mb-3">6. Governing Law</h2>
                <p>
                  These Terms of Service and any disputes arising out of your relationship with Drivers-For-U are governed 
                  exclusively by the laws of India, under the jurisdiction of Kolkata courts.
                </p>
              </div>

              <div>
                <h2 className="text-heading-large text-white mb-3">7. Modifications & Termination</h2>
                <p>
                  We reserve the right to revise these Terms of Service or suspend your access to the Service at our sole 
                  discretion, without notice, in the event of code of conduct violations or security compromises.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="mt-8 text-center text-[10px] text-content-tertiary font-mono">
          <span>Drivers-For-U © 2026. All rights reserved.</span>
        </div>
      </div>
    </div>
  );
}
