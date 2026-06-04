'use client';

import React, { useState } from 'react';

export default function RiderPaymentsPage() {
  const [cards, setCards] = useState([
    { id: 'cd-1', brand: 'Visa', last4: '4321', expiry: '12/28', isDefault: true },
    { id: 'cd-2', brand: 'Mastercard', last4: '8890', expiry: '06/29', isDefault: false }
  ]);

  const [upis, setUpis] = useState(['sarah.connor@okaxis', '9999988888@paytm']);
  const [billingAddress, setBillingAddress] = useState('Cyberdyne Systems HQ, Alipore Grid, Kolkata');
  const [isEditingAddress, setIsEditingAddress] = useState(false);

  const handleAddCard = (e: React.FormEvent) => {
    e.preventDefault();
    const brand = prompt('Enter card brand (Visa/Mastercard):') || 'Visa';
    const last4 = prompt('Enter last 4 digits of card:') || '1111';
    const expiry = prompt('Enter expiry (MM/YY):') || '12/30';

    if (!last4 || last4.length !== 4) return;

    setCards((prev) => [
      ...prev,
      { id: `cd-${Date.now()}`, brand, last4, expiry, isDefault: false }
    ]);
    alert('Card payment method added.');
  };

  const handleSetDefaultCard = (id: string) => {
    setCards((prev) => prev.map((c) => ({ ...c, isDefault: c.id === id })));
    alert('Default payment card updated.');
  };

  const handleRemoveCard = (id: string) => {
    if (confirm('Delete this card?')) {
      setCards((prev) => prev.filter((c) => c.id !== id));
    }
  };

  const handleAddUPI = () => {
    const upi = prompt('Enter UPI ID (e.g. name@okaxis):');
    if (upi && upi.includes('@')) {
      setUpis((prev) => [...prev, upi]);
      alert('UPI account linked.');
    }
  };

  const handleRemoveUPI = (upi: string) => {
    if (confirm(`Remove UPI account "${upi}"?`)) {
      setUpis((prev) => prev.filter((u) => u !== upi));
    }
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">Payment Methods</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Manage credit/debit cards, UPI accounts, and invoice addresses</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Saved Cards */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
          <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
            <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">Credit & Debit Cards</h4>
            <button
              onClick={handleAddCard}
              className="bg-white hover:bg-zinc-200 text-black text-[8px] font-mono font-bold uppercase px-3 py-1.5 rounded-full cursor-pointer"
            >
              Add Card
            </button>
          </div>

          <div className="divide-y divide-zinc-900">
            {cards.map((c) => (
              <div key={c.id} className="py-3 flex justify-between items-center text-xs font-mono">
                <div>
                  <span className="text-white block font-sans font-medium">{c.brand} •••• {c.last4}</span>
                  <span className="text-zinc-650 text-[8px] block mt-0.5">Expires {c.expiry}</span>
                </div>
                <div className="flex items-center gap-3 font-mono text-[8px] uppercase tracking-wider font-bold">
                  {c.isDefault ? (
                    <span className="text-emerald-400">DEFAULT</span>
                  ) : (
                    <button
                      onClick={() => handleSetDefaultCard(c.id)}
                      className="text-zinc-400 hover:text-white cursor-pointer"
                    >
                      Set Default
                    </button>
                  )}
                  <button
                    onClick={() => handleRemoveCard(c.id)}
                    className="text-red-500 hover:text-red-400 cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* UPI IDs */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
          <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
            <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">Linked UPI Handles</h4>
            <button
              onClick={handleAddUPI}
              className="bg-white hover:bg-zinc-200 text-black text-[8px] font-mono font-bold uppercase px-3 py-1.5 rounded-full cursor-pointer"
            >
              Link UPI
            </button>
          </div>

          <div className="divide-y divide-zinc-900">
            {upis.map((upi) => (
              <div key={upi} className="py-3 flex justify-between items-center text-xs font-mono">
                <span className="text-white font-sans font-medium">{upi}</span>
                <button
                  onClick={() => handleRemoveUPI(upi)}
                  className="text-red-500 hover:text-red-400 font-mono text-[8px] uppercase tracking-wider cursor-pointer"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Invoice Billing Address */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3">
        <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">Corporate Billing Address (GST Invoices)</h4>
          <button
            onClick={() => setIsEditingAddress(!isEditingAddress)}
            className="text-[9px] font-mono font-bold text-zinc-400 hover:text-white uppercase tracking-wider"
          >
            {isEditingAddress ? 'Save Address' : 'Edit'}
          </button>
        </div>

        {isEditingAddress ? (
          <textarea
            value={billingAddress}
            onChange={(e) => setBillingAddress(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs text-white focus:outline-none"
            rows={2}
          />
        ) : (
          <p className="text-xs text-zinc-400 font-mono">{billingAddress}</p>
        )}
      </div>

    </div>
  );
}
