'use client';

import React, { useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';

export default function RiderPaymentsPage() {
  const { user } = useAuthStore();
  const riderName = user?.name || 'Sarah Connor';

  const [cards, setCards] = useState([
    { id: 'cd-1', brand: 'Visa', last4: '5642', expiry: '12/28', isDefault: true },
    { id: 'cd-2', brand: 'Mastercard', last4: '8890', expiry: '06/29', isDefault: false }
  ]);

  const [upis, setUpis] = useState(['sarah.connor@okaxis', '9999988888@paytm']);
  const [billingAddress, setBillingAddress] = useState('Cyberdyne Systems HQ, Alipore Grid, Kolkata');
  const [isEditingAddress, setIsEditingAddress] = useState(false);

  // Card form states
  const [showAddCard, setShowAddCard] = useState(false);
  const [cardBrand, setCardBrand] = useState('Visa');
  const [cardNumber, setCardNumber] = useState('');
  const [rawCardNumber, setRawCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [rawCvv, setRawCvv] = useState('');

  // UPI form states
  const [showAddUpi, setShowAddUpi] = useState(false);
  const [newUpi, setNewUpi] = useState('');

  const maskUPI = (upi: string) => {
    const parts = upi.split('@');
    if (parts.length !== 2) return upi;
    const [userPart, domainPart] = parts;
    if (userPart.length <= 3) {
      return `${userPart[0]}***@${domainPart}`;
    }
    return `${userPart.slice(0, 2)}***${userPart.slice(-1)}@${domainPart}`;
  };

  const handleCardNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const digitsOnly = val.replace(/\D/g, '').slice(0, 16);
    setRawCardNumber(digitsOnly);

    // Format display to scramble as typed (e.g. •••• •••• •••• 1234)
    let formatted = '';
    for (let i = 0; i < digitsOnly.length; i++) {
      if (i > 0 && i % 4 === 0) formatted += ' ';
      if (i < 12) {
        formatted += '•';
      } else {
        formatted += digitsOnly[i];
      }
    }
    setCardNumber(formatted);
  };

  const handleCvvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const digitsOnly = val.replace(/\D/g, '').slice(0, 3);
    setRawCvv(digitsOnly);
    setCardCvv('•'.repeat(digitsOnly.length));
  };

  const handleAddCardSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (rawCardNumber.length !== 16) {
      alert('Card number must be exactly 16 digits.');
      return;
    }
    if (!cardExpiry) {
      alert('Expiry date required.');
      return;
    }

    const last4 = rawCardNumber.slice(-4);
    const newCard = {
      id: `cd-${Date.now()}`,
      brand: cardBrand,
      last4,
      expiry: cardExpiry,
      isDefault: false
    };

    setCards((prev) => [...prev, newCard]);
    setShowAddCard(false);
    setCardNumber('');
    setRawCardNumber('');
    setCardExpiry('');
    setCardCvv('');
    setRawCvv('');
    alert('Payment instrument successfully linked in your secure vault.');
  };

  const handleAddUpiSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUpi.includes('@')) {
      alert('Invalid UPI address format (missing @ domain).');
      return;
    }

    setUpis((prev) => [...prev, newUpi.trim()]);
    setShowAddUpi(false);
    setNewUpi('');
    alert('UPI verification complete. Handle linked.');
  };

  const handleSetDefaultCard = (id: string) => {
    setCards((prev) => prev.map((c) => ({ ...c, isDefault: c.id === id })));
    alert('Default payment card updated.');
  };

  const handleRemoveCard = (id: string, brand: string, last4: string) => {
    // Destructive Mutator Action Gate: type REMOVE to confirm
    const confirmation = prompt(
      `🚨 DESTRUCTIVE OPERATION: You are unlinking "${brand} •••• ${last4}".\n\nTo confirm unlinking card, type the word "REMOVE" below:`
    );
    if (!confirmation) return;
    if (confirmation.trim().toUpperCase() !== 'REMOVE') {
      alert('Verification string mismatch. Card remains linked.');
      return;
    }

    setCards((prev) => prev.filter((c) => c.id !== id));
    alert('Card unlinked successfully.');
  };

  const handleRemoveUPI = (upi: string) => {
    // Destructive Mutator Action Gate: type REMOVE to confirm
    const confirmation = prompt(
      `🚨 DESTRUCTIVE OPERATION: You are unlinking UPI profile "${upi}".\n\nTo confirm removal, type the word "REMOVE" below:`
    );
    if (!confirmation) return;
    if (confirmation.trim().toUpperCase() !== 'REMOVE') {
      alert('Verification string mismatch. UPI profile remains linked.');
      return;
    }

    setUpis((prev) => prev.filter((u) => u !== upi));
    alert('UPI profile unlinked successfully.');
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">Payment Methods</h2>
        <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">Manage credit/debit cards, UPI accounts, and invoice addresses</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Saved Cards */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
          <div className="flex justify-between items-center border-b border-border-opaque pb-2">
            <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">Credit & Debit Cards</h4>
            <button
              onClick={() => setShowAddCard(true)}
              className="bg-white hover:bg-background-tertiary text-black text-[8px] font-mono font-bold uppercase px-3 py-1.5 rounded-full cursor-pointer transition active:scale-95"
            >
              Add Card
            </button>
          </div>

          <div className="divide-y divide-border-opaque">
            {cards.map((c) => (
              <div key={c.id} className="py-3 flex justify-between items-center text-xs font-mono">
                <div>
                  <span className="text-white block font-sans font-medium">{c.brand} •••• {c.last4}</span>
                  <span className="text-content-tertiary text-[8px] block mt-0.5">Expires {c.expiry}</span>
                </div>
                <div className="flex items-center gap-3 font-mono text-[8px] uppercase tracking-wider font-bold">
                  {c.isDefault ? (
                    <span className="text-content-positive">DEFAULT</span>
                  ) : (
                    <button
                      onClick={() => handleSetDefaultCard(c.id)}
                      className="text-content-secondary hover:text-white cursor-pointer transition"
                    >
                      Set Default
                    </button>
                  )}
                  <button
                    onClick={() => handleRemoveCard(c.id, c.brand, c.last4)}
                    className="text-content-negative hover:text-content-negative cursor-pointer transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* UPI IDs */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
          <div className="flex justify-between items-center border-b border-border-opaque pb-2">
            <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">Linked UPI Handles</h4>
            <button
              onClick={() => setShowAddUpi(true)}
              className="bg-white hover:bg-background-tertiary text-black text-[8px] font-mono font-bold uppercase px-3 py-1.5 rounded-full cursor-pointer transition active:scale-95"
            >
              Link UPI
            </button>
          </div>

          <div className="divide-y divide-border-opaque">
            {upis.map((upi) => (
              <div key={upi} className="py-3 flex justify-between items-center text-xs font-mono">
                <span className="text-white font-sans font-medium" title={upi}>{maskUPI(upi)}</span>
                <button
                  onClick={() => handleRemoveUPI(upi)}
                  className="text-content-negative hover:text-content-negative font-mono text-[8px] uppercase tracking-wider cursor-pointer transition"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Corporate Invoices Address */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-3">
        <div className="flex justify-between items-center border-b border-border-opaque pb-2">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">Corporate Billing Address (GST Invoices)</h4>
          <button
            onClick={() => setIsEditingAddress(!isEditingAddress)}
            className="text-[9px] font-mono font-bold text-content-secondary hover:text-white uppercase tracking-wider cursor-pointer"
          >
            {isEditingAddress ? 'Save Address' : 'Edit'}
          </button>
        </div>

        {isEditingAddress ? (
          <textarea
            value={billingAddress}
            onChange={(e) => setBillingAddress(e.target.value)}
            className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-xs text-white focus:outline-none font-mono"
            rows={2}
          />
        ) : (
          <p className="text-xs text-content-secondary font-mono">{billingAddress}</p>
        )}
      </div>

      {/* ADD CARD MODAL FORM */}
      {showAddCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-background-primary border border-border-opaque w-full max-w-md rounded-2xl p-6 relative font-mono text-xs text-left space-y-4">
            <h4 className="text-xs font-bold text-white uppercase border-b border-border-opaque pb-2 flex justify-between">
              <span>Secure Card Ingestion Vault</span>
              <button 
                onClick={() => setShowAddCard(false)}
                className="text-[9px] text-content-tertiary hover:text-white uppercase cursor-pointer"
              >
                Close
              </button>
            </h4>

            {/* Virtual card UI representing scrambled value */}
            <div className="bg-gradient-to-tr from-background-secondary to-background-tertiary rounded-2xl p-5 border border-border-opaque/40 relative overflow-hidden flex flex-col justify-between min-h-[140px] text-white">
              <div className="flex justify-between items-start">
                <span className="text-[10px] font-bold tracking-widest">{cardBrand.toUpperCase()} PLATINUM</span>
                <span className="text-[14px]">💳</span>
              </div>

              <div className="space-y-3">
                {/* Digit scrambling displaying placeholders */}
                <div className="text-base font-bold tracking-widest py-1">
                  {cardNumber || '•••• •••• •••• ••••'}
                </div>
                <div className="flex justify-between items-center text-[8px] text-content-secondary">
                  <div>
                    <span className="block text-[6px] text-content-tertiary uppercase">Cardholder</span>
                    {riderName.toUpperCase()}
                  </div>
                  <div>
                    <span className="block text-[6px] text-content-tertiary uppercase">Expires</span>
                    {cardExpiry || 'MM/YY'}
                  </div>
                  <div>
                    <span className="block text-[6px] text-content-tertiary uppercase">CVV</span>
                    {cardCvv || '•••'}
                  </div>
                </div>
              </div>
            </div>

            <form onSubmit={handleAddCardSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[8px] text-content-tertiary uppercase mb-1">Network Brand</label>
                  <select
                    value={cardBrand}
                    onChange={(e) => setCardBrand(e.target.value)}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-2.5 text-white focus:outline-none"
                  >
                    <option>Visa</option>
                    <option>Mastercard</option>
                    <option>RuPay</option>
                    <option>Amex</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[8px] text-content-tertiary uppercase mb-1">Card Number (16 Digits)</label>
                  <input
                    type="text"
                    value={cardNumber}
                    onChange={handleCardNumberChange}
                    placeholder="•••• •••• •••• ••••"
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-2.5 text-white focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[8px] text-content-tertiary uppercase mb-1">Expiry Date</label>
                  <input
                    type="text"
                    value={cardExpiry}
                    onChange={(e) => setCardExpiry(e.target.value)}
                    placeholder="MM/YY"
                    maxLength={5}
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-2.5 text-white focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[8px] text-content-tertiary uppercase mb-1">Security Code (CVV)</label>
                  <input
                    type="text"
                    value={cardCvv}
                    onChange={handleCvvChange}
                    placeholder="•••"
                    className="w-full bg-background-secondary border border-border-opaque rounded-xl p-2.5 text-white focus:outline-none animate-pulse"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-white hover:bg-background-tertiary text-black py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer"
              >
                Ingest & Authorize card
              </button>
            </form>
          </div>
        </div>
      )}

      {/* LINK UPI MODAL FORM */}
      {showAddUpi && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-background-primary border border-border-opaque w-full max-w-md rounded-2xl p-6 relative font-mono text-xs text-left space-y-4">
            <h4 className="text-xs font-bold text-white uppercase border-b border-border-opaque pb-2 flex justify-between">
              <span>Link UPI Virtual Payment Address</span>
              <button 
                onClick={() => setShowAddUpi(false)}
                className="text-[9px] text-content-tertiary hover:text-white uppercase cursor-pointer"
              >
                Close
              </button>
            </h4>

            <form onSubmit={handleAddUpiSubmit} className="space-y-4">
              <div>
                <label className="block text-[8px] text-content-tertiary uppercase mb-1">UPI Address / VPA</label>
                <input
                  type="text"
                  value={newUpi}
                  onChange={(e) => setNewUpi(e.target.value)}
                  placeholder="e.g. mobile@paytm or name@okaxis"
                  className="w-full bg-background-secondary border border-border-opaque rounded-xl p-2.5 text-white focus:outline-none"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full bg-white hover:bg-background-tertiary text-black py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer"
              >
                Verify & Link UPI
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
