'use client';

import React, { useState } from 'react';

type LegalSection = 'terms' | 'cancellation' | 'privacy' | 'insurance';

export default function LegalPoliciesPage() {
  const [activeSection, setActiveSection] = useState<LegalSection>('terms');
  const [searchQuery, setSearchQuery] = useState('');

  const policies = {
    terms: {
      title: 'Terms of Service',
      lastUpdated: 'Updated May 28, 2026',
      intro: 'Please read these Terms of Service carefully before requesting driver services. By accessing or using the platform, you agree to be bound by these conditions.',
      paragraphs: [
        {
          heading: '1. Service Scope & Definition',
          text: 'Vahnly operates an on-demand matching platform connecting vehicle owners ("Riders") with certified professional drivers ("Partners"). The platform provides real-time allocation, billing ledger compilation, routing assistance, and secure digital handshakes. Riders are solely responsible for ensuring their vehicle is fully legal, registered, and carries active primary third-party liability insurance.'
        },
        {
          heading: '2. Rider Declarations & Vehicle Condition',
          text: 'By booking a driver, you represent and warrant that: (a) you are the legal owner of the vehicle or have explicit permission to operate it, (b) the vehicle is in a safe, roadworthy condition, free from mechanical or structural hazards, and (c) all necessary registration certificates (RC), pollution checks (PUC), and insurance policies are active and compliant with local traffic authorities.'
        },
        {
          heading: '3. Driver Safe Harbor & Limitation of Liability',
          text: 'While all driver partners undergo background screening and practical verification, the platform acts as an intermediary. Vahnly is not liable for direct, indirect, incidental, or consequential damages resulting from vehicle operation, including traffic infractions, engine failures, or transport delays, except as explicitly covered under the optional D4M Care insurance addon.'
        },
        {
          heading: '4. Digital Ledger & Automatic Billing',
          text: 'All fares are calculated based on time elapsed, kilometers navigated, tolls incurred, and night premiums. The digital ledger compiled at trip completion is binding. Any disputes regarding billing must be submitted within 48 hours of completion through the support center.'
        }
      ]
    },
    cancellation: {
      title: 'Cancellation & Refund Policy',
      lastUpdated: 'Updated April 15, 2026',
      intro: 'Our policy is designed to maintain fair compensation for driver partners while preserving rider flexibility. Cancellations impact driver schedules and earnings directly.',
      paragraphs: [
        {
          heading: '1. Dispatch Window & Cancellation Fees',
          text: 'Cancellation of a dispatch request is free within the first 2 minutes of a driver accepting the allocation. If a cancellation is requested after 2 minutes, a dynamic cancellation fee (ranging from ₹50 to ₹150 depending on distance traveled by the driver to the pickup) will be charged to the rider\'s payment ledger.'
        },
        {
          heading: '2. Driver No-Show & Automatic Waiver',
          text: 'If the driver partner fails to arrive at the designated pickup location within 10 minutes past the estimated arrival time (ETA), the rider may cancel the trip with zero penalty. In such cases, any pre-authorized fare blocks on digital wallets or cards are automatically released.'
        },
        {
          heading: '3. Refund Ledger Process',
          text: 'Disputed cancellation fees or incorrect trip billings are refunded directly to the rider\'s D4M Wallet within 24 hours of support validation. Refunds to external credit cards or UPI banks take 5-7 business days depending on the financial institution.'
        },
        {
          heading: '4. Waiting Time Thresholds',
          text: 'Drivers are required to wait at the pickup location for a minimum of 10 minutes. The first 5 minutes of waiting time are free. Subsequent waiting time is billed at a standard rate of ₹3/minute. If the rider does not appear after 15 minutes, the driver may cancel the trip, triggering a standard rider no-show fee.'
        }
      ]
    },
    privacy: {
      title: 'Privacy & Data Protection Policy',
      lastUpdated: 'Updated May 12, 2026',
      intro: 'We value your privacy. This document outlines what telemetry data, profile logs, and personal details we collect and how we safeguard them.',
      paragraphs: [
        {
          heading: '1. Spatial Telemetry & Location Sharing',
          text: 'To enable real-time routing, batch matching, and shareable public tracking streams, the app gathers high-precision GPS coordinate feeds. For riders, location tracking occurs only when the app is actively in use or during an ongoing trip. For drivers on duty, continuous background telemetry is recorded in the Redis spatial indexes.'
        },
        {
          heading: '2. Personal & Device Logs',
          text: 'We collect name, email, contact list entries (for SOS sharing), vehicle information, and device logs (IP address, operating system, and hardware identifiers). This data is encrypted in transit using TLS 1.3 and at rest using AES-256 keys.'
        },
        {
          heading: '3. Data Retention & Erasure Rights',
          text: 'Account details and transaction histories are preserved as required by law. Users can request immediate and permanent account deletion under the System Settings page, which expunges all active profile tables, garage listings, and payment card tokens from our databases.'
        },
        {
          heading: '4. Third-Party Sharing Limits',
          text: 'We never sell your personal details. Telemetry coordinates are shared securely with mapping services (e.g. Mapbox/Google) and emergency services in the event of an SOS activation. In-transit metadata is shared with the allocated driver partner to facilitate physical location matching.'
        }
      ]
    },
    insurance: {
      title: 'D4M Care & Insurance Terms',
      lastUpdated: 'Updated February 20, 2026',
      intro: 'Every ride booked on our platform is protected by D4M Care coverage to ensure peace of mind. Review coverage details and claim procedures below.',
      paragraphs: [
        {
          heading: '1. Underwritten Coverage Scope',
          text: 'D4M Care provides secondary accidental coverage for your vehicle during an active trip (from OTP validation to bill clearance). This includes coverage for vehicle damage up to ₹2,00,000, medical expenses for occupant injuries up to ₹1,00,000, and third-party liabilities up to ₹5,00,000.'
        },
        {
          heading: '2. Deductible & Deductions',
          text: 'An industry-standard deductible of ₹5,000 applies to all vehicle damage claims. Claims are validated using on-board telemetry, trip logs, and official traffic police reports (FIR) filed within 24 hours of the incident.'
        },
        {
          heading: '3. Exclusions from Coverage',
          text: 'The insurance is invalidated if: (a) the vehicle has pre-existing mechanical malfunctions, (b) the rider instructs the driver to violate traffic regulations, (c) illegal substances or contraband are found in the vehicle, or (d) the driver partner was replaced mid-trip without platform authorization.'
        },
        {
          heading: '4. Filing a Digital Claim',
          text: 'To file an insurance claim, navigate to your "Insurance & Care" section in the Account Drawer, select the disputed trip, upload photographs of vehicle damage, and attach a copy of the police report. Our adjusters review claims within 3 business days.'
        }
      ]
    }
  };

  const currentPolicy = policies[activeSection];

  const handleDownloadPdf = () => {
    alert(`📥 PDF Download Request: Bounded copy of "${currentPolicy.title}" has been scheduled for offline sync.`);
  };

  // Filter paragraphs by search query
  const filteredParagraphs = currentPolicy.paragraphs.filter(
    (p) =>
      p.heading.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 text-left font-sans animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-border-opaque pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white font-move flex items-center gap-2">
            <span>⚖️</span> Legal & Policy Documents
          </h2>
          <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">
            Review user terms, cancellations rules, privacy safeguards, and insurance coverage
          </p>
        </div>
        <button
          onClick={handleDownloadPdf}
          className="bg-background-secondary hover:bg-background-tertiary text-white font-mono font-bold text-[9px] uppercase tracking-wider py-2 px-3 border border-border-opaque rounded-lg hover:border-border-opaque transition self-start sm:self-center"
        >
          📥 Download PDF
        </button>
      </div>

      {/* Tabs Row */}
      <div className="flex flex-wrap gap-2 border-b border-border-opaque pb-3">
        {(Object.keys(policies) as LegalSection[]).map((sectionKey) => (
          <button
            key={sectionKey}
            onClick={() => {
              setActiveSection(sectionKey);
              setSearchQuery('');
            }}
            className={`py-1.5 px-3 rounded-lg text-[9px] font-mono font-bold uppercase tracking-wider border transition cursor-pointer ${
              activeSection === sectionKey
                ? 'bg-white text-black border-white'
                : 'bg-background-primary text-content-secondary border-border-opaque hover:border-border-opaque hover:text-white'
            }`}
          >
            {policies[sectionKey].title}
          </button>
        ))}
      </div>

      {/* Search Input Filter */}
      <div className="relative">
        <input
          type="text"
          placeholder="Filter legal terms or keywords (e.g. 'cancellation', 'liability', 'GPS')..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-background-primary border border-border-opaque rounded-xl py-2.5 pl-9 pr-4 text-xs text-white placeholder-zinc-600 outline-none focus:border-border-opaque transition font-mono"
        />
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary text-xs">
          🔍
        </div>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-content-tertiary hover:text-white text-xs font-mono"
          >
            CLEAR
          </button>
        )}
      </div>

      {/* Primary Policy Box */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-6 space-y-6">
        <div>
          <span className="text-[9px] font-mono font-bold text-content-tertiary uppercase tracking-widest block mb-1">
            {currentPolicy.lastUpdated}
          </span>
          <h3 className="text-base font-bold text-white font-mono">{currentPolicy.title}</h3>
          <p className="text-content-secondary text-xs mt-2 leading-relaxed font-sans italic border-l-2 border-border-opaque pl-3">
            "{currentPolicy.intro}"
          </p>
        </div>

        {/* Content list */}
        <div className="space-y-6 pt-2">
          {filteredParagraphs.length > 0 ? (
            filteredParagraphs.map((para, i) => (
              <div key={i} className="space-y-2 border-b border-border-opaque/50 pb-4 last:border-b-0 last:pb-0">
                <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wide">
                  {para.heading}
                </h4>
                <p className="text-content-secondary text-xs font-sans leading-relaxed">
                  {para.text}
                </p>
              </div>
            ))
          ) : (
            <div className="py-8 text-center text-content-tertiary font-mono text-xs">
              No matching legal clauses found for query: "{searchQuery}"
            </div>
          )}
        </div>
      </div>

      {/* Support Trigger Footer */}
      <div className="bg-background-secondary/30 border border-border-opaque rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-left">
          <h4 className="text-xs font-bold text-white font-mono uppercase">Have a Policy Dispute or Query?</h4>
          <p className="text-content-tertiary text-[10px] mt-1 font-sans">
            Our legal compliance team answers within 24 business hours to address billing discrepancies or terms.
          </p>
        </div>
        <a
          href="/account/support"
          className="bg-white hover:bg-background-tertiary text-black font-mono font-bold text-[9px] uppercase tracking-wider py-2.5 px-4 rounded-xl transition shrink-0 inline-block text-center cursor-pointer"
        >
          💬 Contact Legal Desk
        </a>
      </div>
    </div>
  );
}
