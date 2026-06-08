'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { FinalBill } from '@/api/client';

export default function FinalBillPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderID = searchParams.get('order_id') || '';
  const { token } = useAuthStore();
  
  const [bill, setBill] = useState<FinalBill | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'CASH' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Read from sessionStorage first
    try {
      const stored = sessionStorage.getItem(`final_bill_${orderID}`);
      if (stored) {
        setBill(JSON.parse(stored));
        return;
      }
      const general = sessionStorage.getItem('current_final_bill');
      if (general) {
        setBill(JSON.parse(general));
        return;
      }
    } catch (e) {
      console.warn('Failed reading bill from session storage:', e);
    }
    
    // Fallback Mock values if not found (in offline/sandbox mode)
    if (orderID) {
      setBill({
        order_id: orderID,
        base_fare_paise: 35000,
        distance_km: 18.2,
        distance_charge_paise: 5760,
        wait_minutes: 8,
        wait_charge_paise: 600,
        overtime_minutes: 25,
        overtime_charge_paise: 1250,
        tolls_paise: 5000,
        parking_charges_paise: 3000,
        night_surge_paise: 5000,
        care_surcharge_paise: 1500,
        total_fare_paise: 62110,
      });
    }
  }, [orderID]);

  if (!bill) {
    return (
      <div className="min-h-screen bg-black text-white p-6 font-mono flex items-center justify-center">
        <div className="text-center space-y-2">
          <span className="text-2xl animate-spin block">⏳</span>
          <p className="text-xs text-zinc-500">HYDRATING TRANSIT RECEIPT...</p>
        </div>
      </div>
    );
  }

  // Map to the requested TypeScript model format in Rupees
  const baseFare = bill.base_fare_paise / 100;
  const extraKmCharge = bill.distance_charge_paise / 100;
  const overtimeCharge = bill.overtime_charge_paise / 100;
  const nightCharge = bill.night_surge_paise / 100;
  const waitingCharge = bill.wait_charge_paise / 100;
  const tolls = bill.tolls_paise / 100;
  const parking = bill.parking_charges_paise / 100;
  const surge = bill.night_surge_paise / 100; // night surge
  const d4mCareFee = bill.care_surcharge_paise / 100;
  const totalAmount = bill.total_fare_paise / 100;

  const handleMarkPaid = () => {
    if (!paymentMethod) return;
    setIsSubmitting(true);
    try {
      sessionStorage.setItem(`payment_method_${orderID}`, paymentMethod);
      router.push(`/driver/trip/rate?order_id=${orderID}`);
    } catch (e) {
      console.warn('Storage failed:', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-6 font-mono flex flex-col justify-between selection:bg-white selection:text-black">
      <header className="border-b border-zinc-900 pb-4 mb-4">
        <span className="text-[8px] text-zinc-500 uppercase tracking-widest font-bold">Transit Settlement Panel</span>
        <h1 className="text-sm font-bold text-white mt-1 uppercase">Trip Finalization Receipt</h1>
        <p className="text-[8px] text-zinc-650 mt-0.5">ORDER ID: {orderID.substring(0, 18)}...</p>
      </header>

      <main className="flex-grow max-w-md mx-auto w-full space-y-6">
        {/* Receipt Table Component */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 bg-zinc-900 text-zinc-400 text-[7px] uppercase font-bold tracking-widest rounded-bl border-l border-b border-zinc-850">
            Invoice
          </div>
          <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block border-b border-zinc-900 pb-2">
            Itemized Breakdown (INR)
          </span>

          <div className="space-y-2 text-[10px] text-zinc-400">
            <div className="flex justify-between">
              <span>Base Package Quoted:</span>
              <span className="text-white">₹{baseFare.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Extra Distance ({bill.distance_km.toFixed(1)} KM):</span>
              <span className="text-white">₹{extraKmCharge.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Waiting Time ({bill.wait_minutes} mins):</span>
              <span className="text-white">₹{waitingCharge.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Overtime Transit ({bill.overtime_minutes} mins):</span>
              <span className="text-white">₹{overtimeCharge.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Night Surcharge:</span>
              <span className="text-white">₹{nightCharge.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Highway Toll Charges:</span>
              <span className="text-white">₹{tolls.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Parking / Stops:</span>
              <span className="text-white">₹{parking.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>D4M Care Trust Surcharge:</span>
              <span className="text-white">₹{d4mCareFee.toFixed(2)}</span>
            </div>
            <div className="border-t border-zinc-900 pt-3 flex justify-between items-center text-xs font-bold mt-1">
              <span className="text-white">TOTAL AMOUNT DUE:</span>
              <span className="text-emerald-400 text-sm font-extrabold">₹{totalAmount.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Payment Selector */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4 shadow-xl text-left">
          <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block border-b border-zinc-900 pb-2">
            Select Payment Method
          </span>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setPaymentMethod('UPI')}
              className={`py-4 px-4 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition cursor-pointer flex flex-col items-center justify-center gap-1.5 ${
                paymentMethod === 'UPI'
                  ? 'bg-zinc-900 border-white text-white font-extrabold shadow-lg shadow-white/5'
                  : 'bg-black border-zinc-900 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <span className="text-base">📱</span>
              <span>UPI / QR Code</span>
            </button>
            <button
              onClick={() => setPaymentMethod('CASH')}
              className={`py-4 px-4 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition cursor-pointer flex flex-col items-center justify-center gap-1.5 ${
                paymentMethod === 'CASH'
                  ? 'bg-zinc-900 border-white text-white font-extrabold shadow-lg shadow-white/5'
                  : 'bg-black border-zinc-900 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <span className="text-base">💵</span>
              <span>Cash Payment</span>
            </button>
          </div>
        </div>
      </main>

      <footer className="mt-8 space-y-2 max-w-md mx-auto w-full">
        <button
          onClick={handleMarkPaid}
          disabled={!paymentMethod || isSubmitting}
          className={`w-full font-bold py-3.5 rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer font-mono border ${
            paymentMethod
              ? 'bg-white text-black hover:bg-zinc-200 border-white font-extrabold active:scale-[0.98]'
              : 'bg-zinc-950 border-zinc-900 text-zinc-550 cursor-not-allowed'
          }`}
        >
          {isSubmitting ? 'Finalizing Invoice...' : 'Confirm payment & next'}
        </button>
      </footer>
    </div>
  );
}
