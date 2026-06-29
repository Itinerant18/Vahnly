'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CameraIcon, CrossIcon, ChevronIcon, SirenIcon } from '@/components/ds/Icon';

export default function RiderSupportPage() {
  const [ticketCategory, setTicketCategory] = useState('Trip dispute issue');
  const [description, setDescription] = useState('');
  const [selectedTripId, setSelectedTripId] = useState('');
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  
  const [chatMessages, setChatMessages] = useState([
    { sender: 'bot', text: 'Welcome to Rider Support. Select an issue category or message us to speak with a dispatch coordinator.', time: '12:00 PM' }
  ]);
  const [chatInput, setChatInput] = useState('');
  
  const [tickets, setTickets] = useState([
    { id: 'TCK-9901', category: 'Payment dispute (Surge)', date: '2026-06-03', status: 'Closed', response: 'Surge multiplier adjusted to baseline rate. Wallet cashback ₹150 processed.' }
  ]);

  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Extract trip ID from URL search parameters on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tripId = params.get('tripId');
      if (tripId) {
        setSelectedTripId(tripId);
        setTicketCategory('Trip dispute issue');
        setDescription(`Filing billing/route dispute for trip: ${tripId}. Please audit telemetry paths.`);
      }
    }
  }, []);

  const faqs = [
    { q: 'How does the 4-digit OTP matching verification work?', a: 'Once your assigned driver partner arrives at your vehicle location, share the 4-digit OTP passcode displayed on your active trip tracker. This OTP verifies the driver\'s session and starts coordinate tracking.' },
    { q: 'What is the cancellation policy once a matching search starts?', a: 'Riders can cancel dispatch requests for free within 30 seconds of starting. Cancellations after a driver has accepted and is en route will incur a ₹50 fee to compensate the driver partner.' },
    { q: 'What does the D4M Care premium add-on cover?', a: 'D4M Care (₹49 per trip) secures full accidental towing cover, medical reimbursement, real-time geofenced route anomaly tracking, and priority customer care routes.' },
    { q: 'How do I add multiple intermediate stops to my journey?', a: 'You can configure up to 3 intermediate stops during the initial booking or add/modify stops mid-trip directly from your active trip tracker dashboard.' }
  ];

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMsg = { sender: 'rider', text: chatInput, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput('');

    setTimeout(() => {
      const botMsg = {
        sender: 'bot',
        text: `Support agent node received: "${chatInput}". Forwarding this query logs to dispatch operators.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setChatMessages((prev) => [...prev, botMsg]);
    }, 1000);
  };

  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;

    const created = {
      id: `TCK-${Math.floor(Math.random() * 9000 + 1000)}`,
      category: ticketCategory,
      date: new Date().toISOString().split('T')[0],
      status: 'Open',
      response: 'Support ticket registered. Customer care agents will review coordinates and logs.'
    };

    setTickets((prev) => [created, ...prev]);
    setDescription('');
    setSelectedTripId('');
    setUploadedImage(null);
    alert(`Support ticket ${created.id} registered successfully.`);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setUploadedImage(ev.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="space-y-6 text-left font-sans">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">Rider Support Center</h2>
        <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">Read FAQs, speak with dispatcher representatives, or raise formal trip disputes</p>
      </div>

      {/* Safety dial */}
      <div className="bg-surface-negative/20 border border-negative-400 rounded-2xl p-5 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h4 className="text-xs font-bold text-content-negative font-mono uppercase tracking-wider"><SirenIcon size={16} className="inline-block align-middle" /> Rider Safety Hotline</h4>
          <p className="text-[11px] text-content-negative/70 mt-1 font-sans leading-normal">
            For critical on-road accidents, immediate security concerns, or lost items contact, call emergency support.
          </p>
        </div>
        
        <button
          onClick={() => alert('Dialing rider support hotline proxy: +91 1800 220 1122...')}
          className="bg-negative-400 hover:bg-negative-400 text-white font-mono font-bold text-[10px] uppercase tracking-wider py-2.5 px-4 rounded-xl shrink-0 cursor-pointer active:scale-95"
        >
          Call Helpline
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* FAQs */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
            Frequently Asked Questions
          </h3>

          <div className="space-y-2">
            {faqs.map((faq, idx) => (
              <div key={idx} className="bg-background-primary border border-border-opaque rounded-xl overflow-hidden">
                <button
                  onClick={() => setFaqOpen(faqOpen === idx ? null : idx)}
                  className="w-full text-left p-4 text-xs font-bold text-content-secondary hover:text-white transition flex justify-between items-center cursor-pointer"
                >
                  <span>{faq.q}</span>
                  <span>{faqOpen === idx ? <ChevronIcon size={16} className="-rotate-90" /> : <ChevronIcon size={16} className="rotate-90" />}</span>
                </button>
                {faqOpen === idx && (
                  <div className="px-4 pb-4 text-[11px] text-content-secondary leading-relaxed font-sans border-t border-border-opaque/40 pt-2 bg-background-secondary/10">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Live Chat */}
        <div className="space-y-4 flex flex-col h-[400px]">
          <h3 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
            Speak with Support agent
          </h3>

          <div className="bg-background-primary border border-border-opaque rounded-2xl flex-1 flex flex-col justify-between overflow-hidden">
            <div className="p-4 overflow-y-auto space-y-3 flex-grow max-h-[280px] scrollbar-thin">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex flex-col max-w-[85%] ${msg.sender === 'rider' ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                  <div className={`p-3 rounded-2xl text-[11px] leading-relaxed ${
                    msg.sender === 'rider' ? 'bg-white text-black font-medium' : 'bg-background-secondary text-content-secondary'
                  }`}>
                    {msg.text}
                  </div>
                  <span className="text-[7px] font-mono text-content-tertiary mt-1">{msg.time}</span>
                </div>
              ))}
            </div>

            <form onSubmit={handleSendChat} className="p-3 border-t border-border-opaque flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Message support dispatcher..."
                className="flex-1 bg-background-secondary border border-border-opaque rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-border-opaque font-sans"
              />
              <button
                type="submit"
                className="bg-white hover:bg-background-tertiary text-black px-4 rounded-xl text-[10px] font-bold uppercase tracking-wider transition cursor-pointer"
              >
                Send
              </button>
            </form>
          </div>
        </div>

      </div>

      {/* Ticket Create & History */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
        
        {/* Ticket Form */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
            File Support Ticket
          </h4>

          <form onSubmit={handleCreateTicket} className="space-y-4 font-sans text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[8px] font-bold text-content-tertiary uppercase font-mono mb-1.5">Issue Category</label>
                <select
                  value={ticketCategory}
                  onChange={(e) => setTicketCategory(e.target.value)}
                  className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs text-content-secondary focus:outline-none"
                >
                  <option>Trip dispute issue</option>
                  <option>Payment / Billing mismatch</option>
                  <option>Driver behavior complaint</option>
                  <option>Lost item search query</option>
                  <option>Other account settings issues</option>
                </select>
              </div>

              <div>
                <label className="block text-[8px] font-bold text-content-tertiary uppercase font-mono mb-1.5">Associated Trip ID</label>
                <input
                  type="text"
                  placeholder="e.g. trp-2209 (Optional)"
                  value={selectedTripId}
                  onChange={(e) => setSelectedTripId(e.target.value)}
                  className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs text-white focus:outline-none font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-[8px] font-bold text-content-tertiary uppercase font-mono mb-1.5">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Enter description of incident..."
                className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs text-white focus:outline-none"
                required
              />
            </div>

            {/* Mock Incident Image Upload */}
            <div className="space-y-2">
              <label className="block text-[8px] font-bold text-content-tertiary uppercase font-mono">Incident Screenshot / Proof</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="bg-background-secondary hover:bg-background-tertiary border border-border-opaque hover:border-border-opaque text-white font-mono text-[9px] uppercase px-4 py-2.5 rounded-xl cursor-pointer"
                >
                  <CameraIcon size={14} className="inline-block align-middle" /> Attach Photo
                </button>
                <input
                  type="file"
                  ref={imageInputRef}
                  onChange={handleImageChange}
                  accept="image/*"
                  className="hidden"
                />
                {uploadedImage && (
                  <div className="relative">
                    <img 
                      src={uploadedImage} 
                      alt="Proof Thumbnail" 
                      className="h-10 w-10 rounded-lg object-cover border border-border-opaque"
                    />
                    <button
                      type="button"
                      onClick={() => setUploadedImage(null)}
                      aria-label="Remove photo"
                      className="absolute -top-1.5 -right-1.5 bg-negative-400 rounded-full h-4 w-4 text-[8px] font-bold flex items-center justify-center text-white"
                    >
                      <CrossIcon size={10} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-white hover:bg-background-tertiary text-black py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer"
            >
              Submit Ticket
            </button>
          </form>
        </div>

        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
            Ticket Resolutions History
          </h4>

          <div className="divide-y divide-border-opaque">
            {tickets.map((t) => (
              <div key={t.id} className="py-3.5 space-y-2 text-xs font-mono">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-white font-sans font-medium block">{t.category}</span>
                    <span className="text-content-tertiary text-[8px] block mt-0.5">{t.date} • ID: {t.id}</span>
                  </div>
                  <span className="bg-background-secondary border border-border-opaque text-content-secondary px-2 py-0.5 rounded text-[8px] font-bold uppercase">
                    {t.status}
                  </span>
                </div>
                <div className="bg-background-secondary/40 p-2.5 rounded-lg border border-border-opaque text-[10px] text-content-secondary leading-normal font-sans">
                  <span className="font-bold font-mono text-[8px] text-content-tertiary block uppercase mb-1">Resolution:</span>
                  {t.response}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
}
