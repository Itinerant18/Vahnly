'use client';

import React, { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { API_GATEWAY_BASE_URL } from '@/config';

function TripRateContent() {
  const t = useTranslations('riderTripRate');
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
  const tagLabels: Record<string, string> = {
    'Safe Driving': t('tagSafeDriving'),
    'Knew Routes': t('tagKnewRoutes'),
    'Punctual': t('tagPunctual'),
    'Polite': t('tagPolite'),
    'Clean Vehicle': t('tagCleanVehicle'),
    'Rash Driving': t('tagRashDriving'),
    'Late Arrival': t('tagLateArrival'),
    'Rude Behavior': t('tagRudeBehavior'),
    'Navigational Errors': t('tagNavigationalErrors'),
  };

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

    alert(t('feedbackCompleted'));
    
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
      <header className="border-b border-border-opaque pb-4 flex justify-between items-center w-full max-w-md mx-auto text-left shrink-0">
        <div>
          <span className="bg-background-secondary text-content-tertiary border border-border-opaque px-2.5 py-1 rounded text-[8px] font-mono font-bold uppercase tracking-wider block w-max mb-1">
            {t('badge')}
          </span>
          <h1 className="text-sm font-bold tracking-tight text-white font-mono uppercase">{t('title')}</h1>
        </div>
        <span className="text-[9px] font-mono text-content-tertiary uppercase font-bold">ID: {tripId.slice(0, 10)}</span>
      </header>

      {/* Main feedback forms layout */}
      <main className="w-full max-w-md mx-auto flex-grow my-4 flex flex-col gap-4 text-left">
        
        {/* Interactive 5-Star block with hover effects */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 text-center space-y-3">
          <span className="text-content-tertiary text-[8px] font-mono font-bold uppercase tracking-widest block">{t('howWasService')}</span>
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
                    isActive ? 'text-content-warning scale-110' : 'text-content-tertiary'
                  }`}
                >
                  ★
                </button>
              );
            })}
          </div>
          <span className="text-xs font-mono font-bold text-white block mt-1 uppercase">
            {rating === 5 && t('ratingExcellent')}
            {rating === 4 && t('ratingGood')}
            {rating === 3 && t('ratingAverage')}
            {rating < 3 && t('ratingUnsatisfactory')}
          </span>
        </div>

        {/* Dynamic Behavioral Tag Chips (Bi-Axial: positive vs negative conditional display) */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4">
          <span className="block text-[8px] font-bold text-content-tertiary uppercase tracking-widest font-mono">
            {rating <= 3 ? t('areasForImprovement') : t('whatWentWell')}
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
                      ? 'bg-surface-positive border-positive-400 text-content-positive shadow-md shadow-emerald-950/25'
                      : 'bg-background-secondary border-border-opaque text-content-secondary hover:text-white'
                  }`}
                >
                  👍 {tagLabels[tag]}
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
                        ? 'bg-surface-negative border-negative-400 text-content-negative shadow-md shadow-red-950/25'
                        : 'bg-background-secondary border-border-opaque text-content-secondary hover:text-white'
                    }`}
                  >
                    ⚠️ {tagLabels[tag]}
                  </button>
                ))}
              </div>
              <p className="text-[8px] text-content-tertiary font-mono uppercase mt-1 leading-normal">
                {t('poorRatingNote')}
              </p>
            </div>
          )}
        </div>

        {/* Deduplicated Tip Allocation Row */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4 font-mono">
          <span className="block text-[8px] font-bold text-content-tertiary uppercase tracking-widest block">{t('addTip')}</span>
          
          <div className="grid grid-cols-5 gap-2 text-xs">
            {[0, 20, 50, 100].map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => handleSelectTipOption(amt)}
                className={`py-2 rounded-xl border transition cursor-pointer font-bold ${
                  tipAmount === amt && tipAmount !== -1 
                    ? 'bg-white border-white text-black' 
                    : 'bg-background-secondary border-border-opaque text-content-secondary'
                }`}
              >
                {amt === 0 ? t('noTip') : `₹${amt}`}
              </button>
            ))}
            
            <button
              onClick={() => handleSelectTipOption(-1)}
              className={`py-2 rounded-xl border transition cursor-pointer font-bold ${
                tipAmount === -1 ? 'bg-white border-white text-black' : 'bg-background-secondary border-border-opaque text-content-secondary'
              }`}
            >
              {t('customTip')}
            </button>
          </div>

          {/* Custom Tip Input Display */}
          {tipAmount === -1 && (
            <div className="flex gap-2 items-center animate-fadeIn pt-1">
              <span className="text-content-tertiary text-xs">₹</span>
              <input
                type="number"
                value={customTip}
                onChange={(e) => setCustomTip(e.target.value)}
                placeholder={t('customAmountPlaceholder')}
                className="bg-background-secondary border border-border-opaque rounded-xl p-2 text-xs text-white focus:outline-none focus:border-border-opaque w-full"
              />
            </div>
          )}
        </div>

        {/* Text Comments */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-3 text-xs">
          <span className="block text-[8px] font-bold text-content-tertiary uppercase tracking-widest font-mono">{t('commentsLabel')}</span>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            rows={2}
            placeholder={t('commentsPlaceholder')}
            className="w-full bg-background-secondary border border-border-opaque rounded-xl p-3 text-white focus:outline-none focus:border-border-opaque font-sans"
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
            className="bg-background-primary hover:bg-background-secondary text-content-tertiary font-mono font-bold uppercase py-3.5 border border-border-opaque rounded-xl transition cursor-pointer text-center disabled:opacity-50"
          >
            {t('skipFeedback')}
          </button>
          <button
            onClick={handleSubmitFeedback}
            disabled={isSubmitting}
            className="bg-white hover:bg-background-tertiary text-black font-sans font-bold uppercase py-3.5 rounded-xl transition cursor-pointer text-center disabled:opacity-50"
          >
            {isSubmitting ? t('submitting') : t('submitReview')}
          </button>
        </div>

      </main>

      <footer className="w-full max-w-md mx-auto text-center text-[7px] font-mono text-content-tertiary select-none pt-4 border-t border-border-opaque shrink-0">
        RATED ON-DUTY OPERATOR: ANIKET KARMAKAR • SHARD: KOL
      </footer>
    </div>
  );
}

export default function TripRatePage() {
  const t = useTranslations('riderTripRate');
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center font-sans text-content-tertiary font-mono text-xs uppercase animate-pulse">
        {t('loadingPortal')}
      </div>
    }>
      <TripRateContent />
    </Suspense>
  );
}
