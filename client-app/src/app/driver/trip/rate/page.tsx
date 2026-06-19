'use client';

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/store/useAuthStore';
import { useDriverDutyStore } from '@/store/useDriverDutyStore';
import { rateRider } from '@/api/client';
import { CheckIcon } from '@/components/ds';

export default function RateRiderPage() {
  const t = useTranslations('driverTripRate');
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderID = searchParams.get('order_id') || '';
  const { token } = useAuthStore();
  const { setDutyState } = useDriverDutyStore();

  const [rating, setRating] = useState<number>(5);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [comment, setComment] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const positiveTags: { value: string; labelKey: string }[] = [
    { value: 'On-time', labelKey: 'tagOnTime' },
    { value: 'Polite', labelKey: 'tagPolite' },
    { value: 'Easy to deal with', labelKey: 'tagEasy' },
  ];
  const negativeTags: { value: string; labelKey: string }[] = [
    { value: 'Rude', labelKey: 'tagRude' },
    { value: 'Late', labelKey: 'tagLate' },
    { value: 'Car in bad condition', labelKey: 'tagBadCondition' },
  ];

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      if (token && orderID) {
        await rateRider(token, orderID, {
          rating,
          tags: selectedTags,
          comment: comment.trim(),
        });
      }
      try {
        sessionStorage.removeItem(`final_bill_${orderID}`);
        sessionStorage.removeItem('current_final_bill');
      } catch (e) {}
      setSubmitted(true);
    } catch (err) {
      console.error('Failed to rate rider:', err);
      // Even on failure, advance to the next-step choice — the trip is over.
      setSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const goOnline = () => {
    setDutyState('ONLINE');
    router.push('/driver');
  };

  const takeBreak = () => {
    setDutyState('OFFLINE');
    router.push('/driver');
  };

  // Tags shown depend on the score: positive set for 4-5★, negative set for 1-3★.
  const activeTagSet = rating >= 4 ? positiveTags : negativeTags;

  if (submitted) {
    return (
      <div className="min-h-screen bg-black text-white p-4 sm:p-6 font-mono flex flex-col justify-center selection:bg-white selection:text-black">
        <main className="max-w-md mx-auto w-full space-y-6 text-center">
          <div className="space-y-2">
            <span className="flex justify-center text-content-positive"><CheckIcon size={40} /></span>
            <h1 className="text-sm font-bold text-white uppercase tracking-wider">{t('thanksTitle')}</h1>
            <p className="text-[10px] text-content-tertiary">{t('nextPrompt')}</p>
          </div>

          <div className="space-y-2.5">
            <button
              onClick={goOnline}
              className="w-full bg-white hover:bg-background-tertiary text-black font-extrabold py-3.5 rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer border border-white active:scale-[0.98]"
            >
              {t('goOnline')}
            </button>
            <button
              onClick={takeBreak}
              className="w-full bg-background-primary hover:bg-background-secondary text-content-secondary hover:text-white border border-border-opaque font-bold py-3.5 rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer active:scale-[0.98]"
            >
              {t('takeBreak')}
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-6 font-mono flex flex-col justify-between selection:bg-white selection:text-black">
      <header className="border-b border-border-opaque pb-4 mb-4">
        <span className="text-[8px] text-content-tertiary uppercase tracking-widest font-bold">{t('panelLabel')}</span>
        <h1 className="text-sm font-bold text-white mt-1 uppercase">{t('title')}</h1>
        <p className="text-[8px] text-content-tertiary mt-0.5">{t('orderId', { id: orderID.substring(0, 18) })}</p>
      </header>

      <main className="flex-grow max-w-md mx-auto w-full space-y-6 flex flex-col justify-center py-4">
        {/* Star Rating Component */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-6 text-center space-y-4 shadow-xl">
          <span className="text-[9px] font-bold text-content-secondary uppercase tracking-wider block">
            {t('riderScoreRating')}
          </span>
          <div className="flex justify-center gap-3 text-3xl select-none">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                className={`transition-all hover:scale-110 active:scale-95 cursor-pointer ${
                  star <= rating ? 'text-content-warning' : 'text-content-tertiary'
                }`}
              >
                ★
              </button>
            ))}
          </div>
          <span className="text-[10px] text-content-tertiary block font-bold">
            {rating === 5 && t('rating5')}
            {rating === 4 && t('rating4')}
            {rating === 3 && t('rating3')}
            {rating === 2 && t('rating2')}
            {rating === 1 && t('rating1')}
          </span>
        </div>

        {/* Quick-Tap Feedback Tags */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-3.5 shadow-xl text-left">
          <span className="text-[9px] font-bold text-content-secondary uppercase tracking-wider block border-b border-border-opaque pb-2">
            {t('addQuickFeedbackTags')}
          </span>
          <div className="flex flex-wrap gap-2 pt-1.5">
            {activeTagSet.map((tag) => {
              const active = selectedTags.includes(tag.value);
              return (
                <button
                  key={tag.value}
                  type="button"
                  onClick={() => toggleTag(tag.value)}
                  className={`px-3 py-1.5 rounded-full border text-[9px] font-bold uppercase tracking-wider transition cursor-pointer ${
                    active
                      ? 'bg-white border-white text-black'
                      : 'bg-black border-border-opaque text-content-tertiary hover:text-content-secondary'
                  }`}
                >
                  {t(tag.labelKey)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Free-text comment */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-2.5 shadow-xl text-left">
          <span className="text-[9px] font-bold text-content-secondary uppercase tracking-wider block">
            {t('commentLabel')}
          </span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={t('commentPlaceholder')}
            className="w-full bg-black border border-border-opaque rounded-xl p-3 text-[11px] text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-border-opaque resize-none font-sans"
          />
        </div>
      </main>

      <footer className="mt-8 max-w-md mx-auto w-full">
        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full bg-white hover:bg-background-tertiary text-black font-extrabold py-3.5 rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer font-mono border border-white active:scale-[0.98] disabled:opacity-60"
        >
          {isSubmitting ? t('submitting') : t('submitButton')}
        </button>
      </footer>
    </div>
  );
}
