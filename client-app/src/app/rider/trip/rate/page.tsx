'use client';

import React, { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function TripRateContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tripId = searchParams?.get('tripId') || 'trp-2209';

  const [rating, setRating] = useState(5);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tipAmount, setTipAmount] = useState<number>(0);
  const [comments, setComments] = useState('');

  const tags = [
    { text: 'Polite Behavior', type: 'positive' },
    { text: 'Safe Driving Habits', type: 'positive' },
    { text: 'Knew Routes Well', type: 'positive' },
    { text: 'Clean Cabin Care', type: 'positive' },
    { text: 'Rash Speed Limits', type: 'negative' },
    { text: 'Late Pickup Arrival', type: 'negative' },
    { text: 'Uncooperative / Rude', type: 'negative' }
  ];

  const handleToggleTag = (tagText: string) => {
    setSelectedTags((prev) => {
      const idx = prev.indexOf(tagText);
      if (idx > -1) {
        return prev.filter((t) => t !== tagText);
      } else {
        return [...prev, tagText];
      }
    });
  };

  const handleSubmitFeedback = () => {
    alert(`Feedback registered! Rating: ${rating} Stars. Tip: ₹${tipAmount}. Exiting active journey.`);
    router.push('/rider');
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-8 font-sans flex flex-col justify-between selection:bg-white selection:text-black">
      
      {/* Header */}
      <header className="border-b border-zinc-900 pb-4 flex justify-between items-center w-full max-w-md mx-auto text-left">
        <div>
          <span className="bg-zinc-900 text-zinc-500 border border-zinc-850 px-2.5 py-1 rounded text-[8px] font-mono font-bold uppercase tracking-wider block w-max mb-1">
            RATE YOUR PILOT
          </span>
          <h1 className="text-sm font-bold tracking-tight text-white font-mono uppercase">Driver Quality Review</h1>
        </div>
        <span className="text-[9px] font-mono text-zinc-500 uppercase font-bold">ID: {tripId}</span>
      </header>

      {/* Main rating area */}
      <main className="w-full max-w-md mx-auto flex-grow my-6 flex flex-col gap-5 text-left">
        
        {/* Stars */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 text-center space-y-3">
          <span className="text-zinc-500 text-[8px] font-mono font-bold uppercase tracking-widest block">How was your pilot?</span>
          <div className="flex justify-center gap-3">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                className={`text-2xl cursor-pointer transition ${star <= rating ? 'text-amber-500' : 'text-zinc-800'}`}
              >
                ★
              </button>
            ))}
          </div>
          <span className="text-xs font-mono font-bold text-white block mt-1 uppercase">
            {rating === 5 && 'Excellent Service'}
            {rating === 4 && 'Good Service'}
            {rating === 3 && 'Average'}
            {rating < 3 && 'Unsatisfactory'}
          </span>
        </div>

        {/* Tags */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
          <span className="block text-[8px] font-bold text-zinc-500 uppercase tracking-widest font-mono">Select Service Tag Flags</span>
          <div className="flex flex-wrap gap-2 pt-1">
            {tags.map((tag) => (
              <button
                key={tag.text}
                type="button"
                onClick={() => handleToggleTag(tag.text)}
                className={`text-[9px] font-bold uppercase tracking-wider py-1.5 px-3 rounded-full border transition cursor-pointer ${
                  selectedTags.includes(tag.text)
                    ? 'bg-white border-white text-black'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                {tag.text}
              </button>
            ))}
          </div>
        </div>

        {/* Tip selector */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
          <span className="block text-[8px] font-bold text-zinc-500 uppercase tracking-widest font-mono">Add Tip for the Driver Partner</span>
          <div className="grid grid-cols-4 gap-2 font-mono text-xs">
            {[0, 20, 50, 100].map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => setTipAmount(amt)}
                className={`py-2 rounded-xl border transition cursor-pointer font-bold ${
                  tipAmount === amt ? 'bg-white border-white text-black' : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                }`}
              >
                {amt === 0 ? 'No Tip' : `₹${amt}`}
              </button>
            ))}
          </div>
        </div>

        {/* Text comments */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3">
          <span className="block text-[8px] font-bold text-zinc-500 uppercase tracking-widest font-mono">Feedback Review Comments</span>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            rows={2}
            placeholder="Write comments about your trip (optional)..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-zinc-500 font-sans"
            maxLength={500}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            onClick={() => router.push('/rider')}
            className="bg-zinc-950 hover:bg-zinc-900 text-zinc-500 font-mono font-bold text-xs uppercase py-3.5 border border-zinc-900 rounded-xl transition cursor-pointer text-center"
          >
            Skip Feedback
          </button>
          <button
            onClick={handleSubmitFeedback}
            className="bg-white hover:bg-zinc-200 text-black font-sans font-bold text-xs uppercase py-3.5 rounded-xl transition cursor-pointer text-center font-bold"
          >
            Submit Review
          </button>
        </div>

      </main>

      <footer className="w-full max-w-md mx-auto text-center text-[8px] font-mono text-zinc-700 select-none pt-4 border-t border-zinc-900">
        RATED ON-DUTY OPERATOR: ANIKET KARMAKAR
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
