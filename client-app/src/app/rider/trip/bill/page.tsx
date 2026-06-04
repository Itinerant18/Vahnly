'use client';

import React, { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function TripBillContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tripId = searchParams?.get('tripId') || 'trp-2209';

  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [billSettled, setBillSettled] = useState(false);

  const billBreakdown = {
    base: 780.00,
    mileageExtra: 120.00,
    waitingFee: 0,
    nightCharge: 50.00,
    careCharge: 49.00,
    surge: 50.00,
    promoDiscount: 100.00,
    walletDiscount: 50.00,
    gst: 42.00,
    total: 941.00
  };

  const handlePayNow = () => {
    setBillSettled(true);
    alert(`Payment of ₹${billBreakdown.total.toFixed(2)} charged successfully via ${paymentMethod}! PDF invoice generated.`);
    
    // Redirect to rating flow
    setTimeout(() => {
      router.push(`/rider/trip/rate?tripId=${tripId}`);
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-8 font-sans flex flex-col justify-between selection:bg-white selection:text-black">
      
      {/* Header */}
      <header className="border-b border-zinc-900 pb-4 flex justify-between items-center w-full max-w-md mx-auto text-left">
        <div>
          <span className="bg-zinc-900 text-zinc-500 border border-zinc-850 px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider block w-max mb-1">
            FARE RECEIPT SETTLEMENT
          </span>
          <h1 className="text-sm font-bold tracking-tight text-white font-mono uppercase">Grand Total Ledger</h1>
        </div>
        <span className="text-[9px] font-mono text-zinc-500 uppercase font-bold">ID: {tripId}</span>
      </header>

      {/* Main Billing details */}
      <main className="w-full max-w-md mx-auto flex-grow my-6 flex flex-col gap-4 text-left">
        
        {billSettled && (
          <div className="bg-emerald-950 border border-emerald-900 text-emerald-300 text-xs p-4 rounded-xl text-center font-mono font-bold uppercase tracking-wider animate-pulse">
            ✔️ Payout settled successfully! Redirecting to feed rating...
          </div>
        )}

        {/* Itemized bill receipt */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3 font-mono text-xs text-zinc-400">
          <div className="flex justify-between">
            <span>Base Package Quoted:</span>
            <span className="text-white">₹{billBreakdown.base.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Extra Mileage mileage (15 km limit exceeded):</span>
            <span className="text-white">₹{billBreakdown.mileageExtra.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Tolls & Gate Surcharges:</span>
            <span className="text-white">₹{billBreakdown.surge.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>D4M Care Surcharge:</span>
            <span className="text-white">₹{billBreakdown.careCharge.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Night Hours Surcharge:</span>
            <span className="text-white">₹{billBreakdown.nightCharge.toFixed(2)}</span>
          </div>
          
          <div className="flex justify-between text-zinc-500 border-t border-zinc-900 pt-2.5">
            <span>Promo Coupon Code Discount (-):</span>
            <span className="text-emerald-400">-₹{billBreakdown.promoDiscount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>Wallet Credit Cashbacks (-):</span>
            <span className="text-emerald-400">-₹{billBreakdown.walletDiscount.toFixed(2)}</span>
          </div>

          <div className="flex justify-between text-zinc-500 border-t border-zinc-900 pt-2.5">
            <span>Taxes & GST (5%):</span>
            <span className="text-white">₹{billBreakdown.gst.toFixed(2)}</span>
          </div>

          <div className="flex justify-between font-bold text-sm text-white border-t border-zinc-800 pt-2.5">
            <span>Total Payable Amount:</span>
            <span className="text-emerald-400">₹{billBreakdown.total.toFixed(2)}</span>
          </div>
        </div>

        {/* Change Payment method dropdown */}
        <div className="flex justify-between items-center bg-zinc-950 border border-zinc-900 p-4 rounded-xl text-xs font-mono">
          <div className="space-y-0.5">
            <span className="text-zinc-500 text-[8px] uppercase block">Selected Settlement Method</span>
            <span className="font-bold text-white">{paymentMethod} Account link</span>
          </div>

          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            disabled={billSettled}
            className="bg-zinc-900 border border-zinc-850 rounded-xl p-2 text-zinc-300 outline-none cursor-pointer"
          >
            <option>UPI</option>
            <option>CASH</option>
            <option>CREDIT CARD</option>
            <option>WALLET</option>
          </select>
        </div>

        <button
          onClick={handlePayNow}
          disabled={billSettled}
          className="w-full bg-white hover:bg-zinc-200 text-black py-4 rounded-xl text-xs font-bold uppercase tracking-wider transition active:scale-95 cursor-pointer text-center font-sans shadow-lg disabled:opacity-55"
        >
          Pay ₹{billBreakdown.total.toFixed(2)} Now
        </button>

      </main>

      <footer className="w-full max-w-md mx-auto text-center text-[8px] font-mono text-zinc-700 select-none pt-4 border-t border-zinc-900">
        PLATFORM BILLING SERVICE GSTIN: 19AAACD4561M1Z5
      </footer>
    </div>
  );
}

export default function TripBillPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center font-sans text-zinc-500 font-mono text-xs uppercase animate-pulse">
        Generating Itemized Invoice...
      </div>
    }>
      <TripBillContent />
    </Suspense>
  );
}
