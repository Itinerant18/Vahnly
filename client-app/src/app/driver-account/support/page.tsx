'use client';

import React, { useState } from 'react';

export default function DriverSupportPage() {
  const [ticketCategory, setTicketCategory] = useState('Payment settlement mismatch');
  const [ticketDescription, setTicketDescription] = useState('');
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState([
    { sender: 'bot', text: 'Welcome to Driver Support. Select a category below or type a query to speak with a dispatcher.', time: '12:00 PM' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [tickets, setTickets] = useState([
    { id: 'TCK-2241', category: 'Odometer mismatch report', date: '2026-05-28', status: 'Closed', response: 'End Odometer reading recalculated to match GPS track logs.' },
    { id: 'TCK-2190', category: 'Commission refund request', date: '2026-05-24', status: 'Closed', response: 'GST credit notes refunded to wallet balance.' }
  ]);

  const faqs = [
    { q: 'How are extra mileage charges computed during trips?', a: 'Extra mileage charges are computed at ₹18 per KM after exceeding the upfront packaged limit. End Odometer minus Start Odometer provides the total mileage elapsed.' },
    { q: 'Why did my match acceptance index decrease?', a: 'Acceptance index decreases when booking offer popups time out (after 15 seconds) or are explicitly declined. Maintain a >85% acceptance rate to unlock Gold/Platinum incentives.' },
    { q: 'When do instant withdrawals settle to bank accounts?', a: 'Withdrawals requested via linked UPI IDs settle within 10 minutes. Bank transfers (IMPS/NEFT) can take up to 24 hours depending on network bank processing windows.' },
    { q: 'How does fatigue tracking geofencing alert drivers?', a: 'Drivers are restricted from going on duty for 6 mandatory hours after completing 10 continuous hours of operational ride tracking.' }
  ];

  const handleSendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMsg = { sender: 'driver', text: chatInput, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    setChatMessages((prev) => [...prev, userMsg]);

    setChatInput('');

    // Simulated reply
    setTimeout(() => {
      const botReply = {
        sender: 'bot',
        text: `Dispatcher node acknowledged: "${chatInput}". Syncing coordinates and forwarding this query to regional team leaders.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setChatMessages((prev) => [...prev, botReply]);
    }, 1000);
  };

  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketDescription.trim()) {
      alert('Provide a description of the support ticket.');
      return;
    }

    const newTicket = {
      id: `TCK-${Math.floor(Math.random() * 9000 + 1000)}`,
      category: ticketCategory,
      date: new Date().toISOString().split('T')[0],
      status: 'Open',
      response: 'Ticket registered. A support representative will review details shortly.'
    };

    setTickets((prev) => [newTicket, ...prev]);
    setTicketDescription('');
    alert(`Support ticket ${newTicket.id} created successfully.`);
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">Support Academy & Tickets</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Access FAQs, raise formal dispute tickets, or chat with dispatch coordinators</p>
      </div>

      {/* Hotline emergency quick dialer */}
      <div className="bg-red-950/20 border border-red-900 rounded-2xl p-5 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h4 className="text-xs font-bold text-red-400 font-mono uppercase tracking-wider">🚨 Safety Dispatch Hotline</h4>
          <p className="text-[11px] text-red-200/70 mt-1 font-sans leading-normal">
            For on-road emergencies, physical vehicle issues, or safety concern alerts, call the emergency hotline immediately.
          </p>
        </div>
        
        <button
          onClick={() => alert('Dialing safety dispatch hotline proxy: +91 1800 220 9988...')}
          className="bg-red-600 hover:bg-red-700 text-white font-mono font-bold text-[10px] uppercase tracking-wider py-2.5 px-4 rounded-xl shrink-0 cursor-pointer active:scale-95"
        >
          Call Emergency Support
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* FAQs Accordion Column */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
            Frequently Asked Questions
          </h3>

          <div className="space-y-2">
            {faqs.map((faq, idx) => (
              <div key={idx} className="bg-zinc-950 border border-zinc-900 rounded-xl overflow-hidden">
                <button
                  onClick={() => setFaqOpen(faqOpen === idx ? null : idx)}
                  className="w-full text-left p-4 text-xs font-bold text-zinc-300 hover:text-white transition flex justify-between items-center cursor-pointer"
                >
                  <span>{faq.q}</span>
                  <span>{faqOpen === idx ? '▲' : '▼'}</span>
                </button>
                {faqOpen === idx && (
                  <div className="px-4 pb-4 text-[11px] text-zinc-400 leading-relaxed font-sans border-t border-zinc-900/40 pt-2 bg-zinc-900/10">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Live Chat simulation Column */}
        <div className="space-y-4 flex flex-col h-[400px]">
          <h3 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
            Dispatcher Live Chat
          </h3>

          <div className="bg-zinc-950 border border-zinc-900 rounded-2xl flex-1 flex flex-col justify-between overflow-hidden">
            {/* Messages box */}
            <div className="p-4 overflow-y-auto space-y-3 flex-grow max-h-[280px] scrollbar-thin">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex flex-col max-w-[80%] ${msg.sender === 'driver' ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                  <div className={`p-3 rounded-2xl text-[11px] leading-relaxed ${
                    msg.sender === 'driver' ? 'bg-white text-black font-medium' : 'bg-zinc-900 text-zinc-300'
                  }`}>
                    {msg.text}
                  </div>
                  <span className="text-[7px] font-mono text-zinc-600 mt-1">{msg.time}</span>
                </div>
              ))}
            </div>

            {/* Input form */}
            <form onSubmit={handleSendChatMessage} className="p-3 border-t border-zinc-900 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type query to speak with dispatcher..."
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-500"
              />
              <button
                type="submit"
                className="bg-white hover:bg-zinc-200 text-black px-4 rounded-xl text-[10px] font-bold uppercase tracking-wider transition cursor-pointer"
              >
                Send
              </button>
            </form>
          </div>
        </div>

      </div>

      {/* Support ticket creation form and history */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
        
        {/* Ticket Form */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
            Raise Support Ticket
          </h4>

          <form onSubmit={handleCreateTicket} className="space-y-4">
            <div>
              <label className="block text-[8px] font-bold text-zinc-500 uppercase font-mono mb-1.5">Problem Category</label>
              <select
                value={ticketCategory}
                onChange={(e) => setTicketCategory(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none text-zinc-300"
              >
                <option>Payment settlement mismatch</option>
                <option>Odometer capture error</option>
                <option>App crash / GPS loop issues</option>
                <option>Rider behavioral dispute</option>
                <option>Other routing compliance questions</option>
              </select>
            </div>

            <div>
              <label className="block text-[8px] font-bold text-zinc-500 uppercase font-mono mb-1.5">Incident Description</label>
              <textarea
                value={ticketDescription}
                onChange={(e) => setTicketDescription(e.target.value)}
                rows={3}
                placeholder="Describe details of the issue..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs focus:outline-none text-white font-sans"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-white hover:bg-zinc-200 text-black py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer active:scale-95"
            >
              Submit Ticket
            </button>
          </form>
        </div>

        {/* Ticket history */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
            Ticket History / Status
          </h4>

          <div className="divide-y divide-zinc-900">
            {tickets.map((t) => (
              <div key={t.id} className="py-3.5 space-y-2 text-xs font-mono">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-white font-sans font-medium block">{t.category}</span>
                    <span className="text-zinc-500 text-[8px] block mt-0.5">{t.date} • ID: {t.id}</span>
                  </div>
                  <span className="bg-zinc-900 border border-zinc-800 text-zinc-400 px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider">
                    {t.status}
                  </span>
                </div>
                <div className="bg-zinc-900/40 p-2.5 rounded-lg border border-zinc-900 text-[10px] text-zinc-400 leading-normal font-sans">
                  <span className="font-bold font-mono text-[8px] text-zinc-500 block uppercase mb-1">Support Resolution:</span>
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
