'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { API_GATEWAY_BASE_URL } from '@/config';

function TripBillContent() {
  const t = useTranslations('riderTripBill');
  const searchParams = useSearchParams();
  const router = useRouter();
  const tripId = searchParams?.get('tripId') || 'trp-sandbox-2209';

  // Transaction Processing States: IDLE | AWAITING_INTENT | PROCESSING_DEBIT | SETTLED | RETRY_FALLBACK
  const [paymentState, setPaymentState] = useState<'IDLE' | 'AWAITING_INTENT' | 'PROCESSING_DEBIT' | 'SETTLED' | 'RETRY_FALLBACK'>('IDLE');
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [emailSent, setEmailSent] = useState(false);

  // finality state constraints
  useEffect(() => {
    const isSettled = sessionStorage.getItem(`trip_settled_${tripId}`);
    if (isSettled === 'true') {
      // Steer settled users back to the map screen to prevent double checkout re-renders
      router.replace('/rider');
    }
  }, [tripId, router]);

  const billBreakdown = {
    distance: '12.4 km',
    duration: '42 mins',
    stops: '1 Stop',
    waitingTime: '8 mins',
    base: 850.00,
    overage: 43.20,      // 2.4 km x ₹18
    waitingFee: 28.00,   // 8 mins x ₹3.50
    nightCharge: 100.00,
    surgeIndex: 64.50,   // 1.25x Floor
    safetyMargin: 49.00,
    gstTax: 45.35,
    promoDiscount: 150.00, // LEAP2026
    total: 1030.05       // 850 + 43.20 + 28 + 100 + 64.50 + 49 + 45.35 - 150
  };

  const handlePayNow = () => {
    if (paymentState !== 'IDLE' && paymentState !== 'RETRY_FALLBACK') return;

    // Double-Debit Prevention Guard: lock interface immediately on first click
    setPaymentState('AWAITING_INTENT');

    // Simulate UPI/card intent deep-link retrieval
    setTimeout(() => {
      setPaymentState('PROCESSING_DEBIT');
      
      // Simulate bank gateway debit validation checks
      setTimeout(() => {
        // Deterministic check to demonstrate RETRY_FALLBACK if paymentMethod is CASH (for verification)
        if (paymentMethod === 'CASH') {
          setPaymentState('RETRY_FALLBACK');
        } else {
          setPaymentState('SETTLED');
          sessionStorage.setItem(`trip_settled_${tripId}`, 'true');
        }
      }, 2000);
    }, 1200);
  };

  const handleRetryPayment = () => {
    setPaymentMethod('UPI');
    setPaymentState('IDLE');
  };

  const handleTriggerEmailDispatch = () => {
    setEmailSent(true);
    alert(t('emailDispatchAlert'));
  };

  const handlePrintPDFInvoice = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-8 font-sans flex flex-col justify-between selection:bg-white selection:text-black">
      
      {/* Header */}
      <header className="border-b border-zinc-900 pb-4 flex justify-between items-center w-full max-w-md mx-auto text-left shrink-0">
        <div>
          <span className="bg-zinc-900 text-zinc-500 border border-zinc-850 px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider block w-max mb-1">
            {t('badge')}
          </span>
          <h1 className="text-sm font-bold tracking-tight text-white font-mono uppercase">{t('title')}</h1>
        </div>
        <span className="text-[9px] font-mono text-zinc-500 uppercase font-bold">ID: {tripId.slice(0, 10)}</span>
      </header>

      {/* Main Billing and post billing layout */}
      <main className="w-full max-w-md mx-auto flex-grow my-4 flex flex-col gap-4 text-left">
        
        {/* State Banner / Spinner indicators */}
        {paymentState === 'AWAITING_INTENT' && (
          <div className="bg-blue-950/60 border border-blue-900 text-blue-200 text-xs p-4 rounded-xl text-center font-mono font-bold uppercase tracking-wider animate-pulse">
            {t('stateAwaitingIntent')}
          </div>
        )}

        {paymentState === 'PROCESSING_DEBIT' && (
          <div className="bg-amber-950/60 border border-amber-900 text-amber-200 text-xs p-4 rounded-xl text-center font-mono font-bold uppercase tracking-wider flex items-center justify-center gap-2">
            <span className="h-2 w-2 bg-amber-400 rounded-full animate-ping" />
            <span>{t('stateProcessingDebit')}</span>
          </div>
        )}

        {paymentState === 'RETRY_FALLBACK' && (
          <div className="bg-red-950 border border-red-900 text-red-200 text-xs p-4 rounded-xl space-y-3 font-mono text-center">
            <h4 className="font-bold uppercase tracking-wider">{t('retryFailedTitle')}</h4>
            <p className="text-[10px] leading-normal text-red-300 font-sans normal-case">
              {t('retryFailedBody')}
            </p>
            <button
              onClick={handleRetryPayment}
              className="bg-white text-black font-bold px-4 py-2 rounded-lg text-[10px] uppercase cursor-pointer"
            >
              {t('retryButton')}
            </button>
          </div>
        )}

        {paymentState === 'SETTLED' && (
          <div className="bg-emerald-950 border border-emerald-900 text-emerald-300 text-xs p-4 rounded-xl text-center font-mono font-bold uppercase tracking-wider animate-pulse">
            {t('stateSettled')}
          </div>
        )}

        {/* Section A: Journey Metrics Block */}
        <div className="grid grid-cols-2 gap-2 bg-zinc-950 border border-zinc-900 p-4 rounded-2xl text-[10px] font-mono text-zinc-400">
          <div className="border-r border-zinc-900 pr-2">
            <span className="text-zinc-600 font-bold uppercase text-[8px] block mb-1">{t('distanceCount')}</span>
            <span className="text-white text-xs font-semibold">{billBreakdown.distance}</span>
          </div>
          <div className="pl-2">
            <span className="text-zinc-600 font-bold uppercase text-[8px] block mb-1">{t('totalDuration')}</span>
            <span className="text-white text-xs font-semibold">{billBreakdown.duration}</span>
          </div>
          <div className="border-t border-zinc-900 border-r pr-2 pt-2 mt-2">
            <span className="text-zinc-600 font-bold uppercase text-[8px] block mb-1">{t('stopsNode')}</span>
            <span className="text-white text-xs font-semibold">{billBreakdown.stops}</span>
          </div>
          <div className="border-t border-zinc-900 pl-2 pt-2 mt-2">
            <span className="text-zinc-600 font-bold uppercase text-[8px] block mb-1">{t('waitingTime')}</span>
            <span className="text-white text-xs font-semibold">{billBreakdown.waitingTime}</span>
          </div>
        </div>

        {/* Section B: Itemized Fare Ledger Matrix */}
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3 font-mono text-xs text-zinc-400">
          <div className="flex justify-between items-center text-[8px] font-bold text-zinc-500 uppercase tracking-wider border-b border-zinc-900 pb-2">
            <span>{t('itemizedComponents')}</span>
            <span className="text-zinc-400">{t('paiseMappings')}</span>
          </div>

          <div className="flex justify-between">
            <span>{t('lineBasePackage')}</span>
            <span className="text-white">₹{billBreakdown.base.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('lineDistanceOverage')}</span>
            <span className="text-white">₹{billBreakdown.overage.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('lineWaitingFee')}</span>
            <span className="text-white">₹{billBreakdown.waitingFee.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('lineNightCharge')}</span>
            <span className="text-white">₹{billBreakdown.nightCharge.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('lineSurgeIndex')}</span>
            <span className="text-white">₹{billBreakdown.surgeIndex.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('lineCareSurcharge')}</span>
            <span className="text-white">₹{billBreakdown.safetyMargin.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('lineGstTax')}</span>
            <span className="text-white">₹{billBreakdown.gstTax.toFixed(2)}</span>
          </div>

          <div className="flex justify-between text-zinc-500 border-t border-zinc-900 pt-2.5">
            <span>{t('linePromoDiscount')}</span>
            <span className="text-emerald-400">-₹{billBreakdown.promoDiscount.toFixed(2)}</span>
          </div>

          <div className="flex justify-between font-bold text-sm text-white border-t border-zinc-800 pt-2.5">
            <span>{t('lineTotalPayable')}</span>
            <span className="text-emerald-400">₹{billBreakdown.total.toFixed(2)}</span>
          </div>
        </div>

        {/* Section C: Checkout Access Interface (Only before settlement) */}
        {paymentState !== 'SETTLED' ? (
          <div className="space-y-3">
            <div className="flex justify-between items-center bg-zinc-950 border border-zinc-900 p-4 rounded-xl text-xs font-mono">
              <div className="space-y-0.5">
                <span className="text-zinc-500 text-[8px] uppercase block">{t('settlementInstrument')}</span>
                <span className="font-bold text-white text-xs">{t('instrumentLink', { method: paymentMethod })}</span>
              </div>

              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                disabled={paymentState !== 'IDLE' && paymentState !== 'RETRY_FALLBACK'}
                className="bg-zinc-900 border border-zinc-850 rounded-xl p-2.5 text-zinc-300 outline-none cursor-pointer"
              >
                <option value="UPI">{t('optionUpi')}</option>
                <option value="CREDIT CARD">{t('optionCreditCard')}</option>
                <option value="WALLET">{t('optionWallet')}</option>
                <option value="CASH">{t('optionCash')}</option>
              </select>
            </div>

            <button
              onClick={handlePayNow}
              disabled={paymentState !== 'IDLE' && paymentState !== 'RETRY_FALLBACK'}
              className="w-full bg-white hover:bg-zinc-200 text-black py-4.5 rounded-xl text-xs font-bold uppercase tracking-wider transition active:scale-98 cursor-pointer text-center font-sans shadow-lg disabled:opacity-50"
            >
              {t('confirmAndPay', { amount: billBreakdown.total.toFixed(2) })}
            </button>
          </div>
        ) : (
          /* Post-Trip Accounting & Post-Billing Invoice Integrity */
          <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4 animate-fadeIn">
            <div className="flex justify-between items-center border-b border-zinc-900 pb-3">
              <span className="font-mono text-[9px] text-zinc-500 font-bold uppercase">{t('invoiceActions')}</span>
              <span className="bg-emerald-950 text-emerald-400 border border-emerald-900 text-[7px] font-bold px-1.5 py-0.5 rounded uppercase">
                {t('paid')}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 font-mono text-[9px] font-bold uppercase">
              {/* PDF Invoicing Infrastructure */}
              <button
                onClick={handlePrintPDFInvoice}
                className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 py-3 rounded-xl text-zinc-300 text-center cursor-pointer"
              >
                {t('printSavePdf')}
              </button>

              {/* Asynchronous Email dispatch */}
              <button
                onClick={handleTriggerEmailDispatch}
                className={`py-3 rounded-xl text-center border cursor-pointer ${
                  emailSent 
                    ? 'bg-zinc-900 border-zinc-800 text-zinc-500' 
                    : 'bg-zinc-900 hover:bg-zinc-850 border-zinc-850 text-zinc-300'
                }`}
              >
                {emailSent ? t('emailSent') : t('emailReceipt')}
              </button>

              {/* Dispute escalation router */}
              <button
                onClick={() => {
                  router.push(`/account/support?tripId=${tripId}&dispute=billing`);
                }}
                className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 py-3 rounded-xl text-zinc-400 hover:text-white text-center col-span-2 cursor-pointer"
              >
                {t('reportDispute')}
              </button>
            </div>

            <button
              onClick={() => router.push(`/rider/trip/rate?tripId=${tripId}`)}
              className="w-full bg-white text-black py-4 rounded-xl text-xs font-bold uppercase tracking-wider transition active:scale-95 cursor-pointer text-center font-sans mt-2"
            >
              {t('continueToReview')}
            </button>
          </div>
        )}

      </main>

      {/* Invoice Legal parameters */}
      <footer className="w-full max-w-md mx-auto text-center text-[7px] font-mono text-zinc-700 select-none pt-4 border-t border-zinc-900 shrink-0">
        REGISTRY GSTIN: 19AAACD4561M1Z5 • INVOICE NO: inv-2026-0604 • FAST-TAG ACTIVE
      </footer>
    </div>
  );
}

export default function TripBillPage() {
  const t = useTranslations('riderTripBill');
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center font-sans text-zinc-500 font-mono text-xs uppercase animate-pulse">
        {t('loadingInvoice')}
      </div>
    }>
      <TripBillContent />
    </Suspense>
  );
}
