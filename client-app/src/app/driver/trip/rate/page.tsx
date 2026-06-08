'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { useDriverDutyStore } from '@/store/useDriverDutyStore';
import { driverConfirmPayment } from '@/api/client';

export default function RateRiderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderID = searchParams.get('order_id') || '';
  const { token } = useAuthStore();
  const { setDutyState } = useDriverDutyStore();

  const [rating, setRating] = useState<number>(5);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<string>('UPI');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableTags = ['Polite', 'Friendly', 'Clean', 'On Time', 'Respectful'];

  useEffect(() => {
    try {
      const storedMethod = sessionStorage.getItem(`payment_method_${orderID}`);
      if (storedMethod) {
        setPaymentMethod(storedMethod);
      }
    } catch (e) {
      console.warn('Failed reading payment method from storage:', e);
    }
  }, [orderID]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      if (token && orderID) {
        // Calls the POST confirm-payment endpoint which posts double-entry financial ledger splits
        await driverConfirmPayment(token, orderID, {
          payment_method: paymentMethod as 'UPI' | 'CASH',
          rider_rating: rating,
          tags: selectedTags,
        });
      }
      
      // Update store state and local cleanup
      setDutyState('ONLINE');
      try {
        sessionStorage.removeItem(`payment_method_${orderID}`);
        sessionStorage.removeItem(`final_bill_${orderID}`);
        sessionStorage.removeItem('current_final_bill');
      } catch (e) {}

      alert('Settlement complete. You are now ONLINE to receive next offers.');
      router.push('/driver');
    } catch (err) {
      console.error('Failed to confirm payment and rate:', err);
      // Fallback transition
      setDutyState('ONLINE');
      router.push('/driver');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-6 font-mono flex flex-col justify-between selection:bg-white selection:text-black">
      <header className="border-b border-zinc-900 pb-4 mb-4">
        <span className="text-[8px] text-zinc-500 uppercase tracking-widest font-bold">Transit Feedback Panel</span>
        <h1 className="text-sm font-bold text-white mt-1 uppercase">Rate Your Journey Experience</h1>
        <p className="text-[8px] text-zinc-655 mt-0.5">ORDER ID: {orderID.substring(0, 18)}...</p>
      </header>

      <main className="flex-grow max-w-md mx-auto w-full space-y-6 flex flex-col justify-center py-4">
        {/* Star Rating Component */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-6 text-center space-y-4 shadow-xl">
          <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">
            Rider Score Rating
          </span>
          <div className="flex justify-center gap-3 text-3xl select-none">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                className={`transition-all hover:scale-110 active:scale-95 cursor-pointer ${
                  star <= rating ? 'text-amber-500' : 'text-zinc-800'
                }`}
              >
                ★
              </button>
            ))}
          </div>
          <span className="text-[10px] text-zinc-500 block font-bold">
            {rating === 5 && 'EXCELLENT TRANSIT'}
            {rating === 4 && 'GOOD EXPERIENCE'}
            {rating === 3 && 'AVERAGE TRIP'}
            {rating === 2 && 'UNSATISFACTORY'}
            {rating === 1 && 'CRITICAL DISPUTE'}
          </span>
        </div>

        {/* Quick-Tap Feedback Tags */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3.5 shadow-xl text-left">
          <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block border-b border-zinc-900 pb-2">
            Add Quick Feedback Tags
          </span>
          <div className="flex flex-wrap gap-2 pt-1.5">
            {availableTags.map((tag) => {
              const active = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`px-3 py-1.5 rounded-full border text-[9px] font-bold uppercase tracking-wider transition cursor-pointer ${
                    active
                      ? 'bg-white border-white text-black'
                      : 'bg-black border-zinc-850 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      </main>

      <footer className="mt-8 max-w-md mx-auto w-full">
        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full bg-white hover:bg-zinc-200 text-black font-extrabold py-3.5 rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer font-mono border border-white active:scale-[0.98]"
        >
          {isSubmitting ? 'Submitting Settlement...' : 'Submit Feedback & Go Online'}
        </button>
      </footer>
    </div>
  );
}
