'use client';

import React, { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { API_GATEWAY_BASE_URL } from '@/config';

function TripRateContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tripId = searchParams?.get('tripId') || 'trp-sandbox-2209';

  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tipAmount, setTipAmount] = useState<number>(0);
  const [customTip, setCustomTip] = useState('');
  const [comments, setComments] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Bi-Axial Behavioral Tag Chips
  const positiveTags = ['Safe Driving', 'Knew Routes', 'Punctual', 'Polite', 'Clean Vehicle'];
  const negativeTags = ['Rash Driving', 'Late Arrival', 'Rude Behavior', 'Navigational Errors'];

  const handleToggleTag = (tag: string) => {
    setSelectedTags((prev) => 
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmitFeedback = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const finalTip = tipAmount === -1 ? parseFloat(customTip) || 0 : tipAmount;

    console.log('[FeedbackEngine] Submitting metrics:', {
      tripId,
      rating,
      tags: selectedTags,
      tip: finalTip,
      comments
    });

    // Simulate separate transaction processing if a tip is added
    if (finalTip > 0) {
      console.log(`[PaymentEngine] Debited tip ₹${finalTip.toFixed(2)} to driver wallet profile.`);
      try {
        await fetch(`${API_GATEWAY_BASE_URL}/api/v1/payments/webhook`, { // simulate wallet ledger write
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'driver.tip', amount_paise: finalTip * 100, order_id: tripId })
        });
      } catch (e) {}
    }

    alert(`Feedback and review completed! steering back to booking dashboard.`);
    
    // Clear active session parameters
    sessionStorage.removeItem('current_booking_specs');
    sessionStorage.removeItem('assigned_driver_specs');

    router.push('/rider');
  };

  const handleSelectTipOption = (amt: number) => {
    setTipAmount(amt);
    if (amt !== -1) {
      setCustomTip('');
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-8 font-sans flex flex-col justify-between selection:bg-white selection:text-black">
      
      {/* Header */}
      <header className="border-b border-zinc-900 pb-4 flex justify-between items-center w-full max-w-md mx-auto text-left shrink-0">
        <div>
          <span className="bg-zinc-900 text-zinc-500 border border-zinc-850 px-2.5 py-1 rounded text-[8px] font-mono font-bold uppercase tracking-wider block w-max mb-1">
            RATE YOUR PILOT
          </span>
          <h1 className="text-sm font-bold tracking-tight text-white font-mono uppercase">Driver Quality Review</h1>
        </div>
        <span className="text-[9px] font-mono text-zinc-500 uppercase font-bold">ID: {tripId.slice(0, 10)}</span>
      </header>

      {/* Main feedback forms layout */}
      <main className="w-full max-w-md mx-auto flex-grow my-4 flex flex-col gap-4 text-left">
        
        {/* Interactive 5-Star block with hover effects */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 text-center space-y-3">
          <span className="text-zinc-500 text-[8px] font-mono font-bold uppercase tracking-widest block">How was Aniket's service?</span>
          <div className="flex justify-center gap-3">
            {[1, 2, 3, 4, 5].map((star) => {
              const isActive = hoverRating !== null ? star <= hoverRating : star <= rating;
              return (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(null)}
                  className={`text-3xl transition-transform active:scale-95 duration-100 cursor-pointer ${
                    isActive ? 'text-amber-500 scale-110' : 'text-zinc-800'
                  }`}
                >
                  ★
                </button>
              );
            })}
          </div>
          <span className="text-xs font-mono font-bold text-white block mt-1 uppercase">
            {rating === 5 && 'Excellent Service'}
            {rating === 4 && 'Good Service'}
            {rating === 3 && 'Average'}
            {rating < 3 && 'Unsatisfactory'}
          </span>
        </div>

        {/* Dynamic Behavioral Tag Chips (Bi-Axial: positive vs negative conditional display) */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
          <span className="block text-[8px] font-bold text-zinc-500 uppercase tracking-widest font-mono">
            {rating <= 3 ? 'Select Areas for Improvement' : 'What went well?'}
          </span>

          {/* Positive Tag Grid (Only shown if rating is Good/Excellent) */}
          {rating > 3 && (
            <div className="flex flex-wrap gap-2 pt-1 animate-fadeIn">
              {positiveTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => handleToggleTag(tag)}
                  className={`text-[9px] font-bold uppercase tracking-wider py-1.5 px-3 rounded-full border transition cursor-pointer ${
                    selectedTags.includes(tag)
                      ? 'bg-emerald-950 border-emerald-500 text-emerald-200 shadow-md shadow-emerald-950/25'
                      : 'bg-zinc-900 border-zinc-850 text-zinc-400 hover:text-white'
                  }`}
                >
                  👍 {tag}
                </button>
              ))}
            </div>
          )}

          {/* Detailed Secondary Form for low rating reviews (<= 3 stars) */}
          {rating <= 3 && (
            <div className="space-y-3 animate-fadeIn">
              <div className="flex flex-wrap gap-2 pt-1">
                {negativeTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleToggleTag(tag)}
                    className={`text-[9px] font-bold uppercase tracking-wider py-1.5 px-3 rounded-full border transition cursor-pointer ${
                      selectedTags.includes(tag)
                        ? 'bg-red-950 border-red-500 text-red-200 shadow-md shadow-red-950/25'
                        : 'bg-zinc-900 border-zinc-850 text-zinc-400 hover:text-white'
                    }`}
                  >
                    ⚠️ {tag}
                  </button>
                ))}
              </div>
              <p className="text-[8px] text-zinc-500 font-mono uppercase mt-1 leading-normal">
                ❗ Note: Poor ratings trigger automatic quality assurance compliance review.
              </p>
            </div>
          )}
        </div>

        {/* Deduplicated Tip Allocation Row */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4 font-mono">
          <span className="block text-[8px] font-bold text-zinc-500 uppercase tracking-widest block">Add Tip for the Driver Partner</span>
          
          <div className="grid grid-cols-5 gap-2 text-xs">
            {[0, 20, 50, 100].map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => handleSelectTipOption(amt)}
                className={`py-2 rounded-xl border transition cursor-pointer font-bold ${
                  tipAmount === amt && tipAmount !== -1 
                    ? 'bg-white border-white text-black' 
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                }`}
              >
                {amt === 0 ? 'No Tip' : `₹${amt}`}
              </button>
            ))}
            
            <button
              onClick={() => handleSelectTipOption(-1)}
              className={`py-2 rounded-xl border transition cursor-pointer font-bold ${
                tipAmount === -1 ? 'bg-white border-white text-black' : 'bg-zinc-900 border-zinc-800 text-zinc-400'
              }`}
            >
              Custom
            </button>
          </div>

          {/* Custom Tip Input Display */}
          {tipAmount === -1 && (
            <div className="flex gap-2 items-center animate-fadeIn pt-1">
              <span className="text-zinc-500 text-xs">₹</span>
              <input
                type="number"
                value={customTip}
                onChange={(e) => setCustomTip(e.target.value)}
                placeholder="Enter custom amount"
                className="bg-zinc-900 border border-zinc-850 rounded-xl p-2 text-xs text-white focus:outline-none focus:border-zinc-700 w-full"
              />
            </div>
          )}
        </div>

        {/* Text Comments */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3 text-xs">
          <span className="block text-[8px] font-bold text-zinc-500 uppercase tracking-widest font-mono">Feedback Review Comments</span>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            rows={2}
            placeholder="Write comments about your trip experience (optional)..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-white focus:outline-none focus:border-zinc-500 font-sans"
            maxLength={500}
          />
        </div>

        {/* CTAs */}
        <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
          <button
            onClick={() => {
              // Reset and redirect back to booking home map console directly
              sessionStorage.removeItem('current_booking_specs');
              sessionStorage.removeItem('assigned_driver_specs');
              router.push('/rider');
            }}
            disabled={isSubmitting}
            className="bg-zinc-950 hover:bg-zinc-900 text-zinc-500 font-mono font-bold uppercase py-3.5 border border-zinc-900 rounded-xl transition cursor-pointer text-center disabled:opacity-50"
          >
            Skip Feedback
          </button>
          <button
            onClick={handleSubmitFeedback}
            disabled={isSubmitting}
            className="bg-white hover:bg-zinc-200 text-black font-sans font-bold uppercase py-3.5 rounded-xl transition cursor-pointer text-center disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Review'}
          </button>
        </div>

      </main>

      <footer className="w-full max-w-md mx-auto text-center text-[7px] font-mono text-zinc-700 select-none pt-4 border-t border-zinc-900 shrink-0">
        RATED ON-DUTY OPERATOR: ANIKET KARMAKAR • SHARD: KOL
      </footer>
    </div>
  );
}

export default function TripRatePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center font-sans text-zinc-500 font-mono text-xs uppercase animate-pulse">
        Loading Review Portal...
      </div>
    }>
      <TripRateContent />
    </Suspense>
  );
}
