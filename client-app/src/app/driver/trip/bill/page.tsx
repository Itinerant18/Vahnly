'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { FinalBill, reportCarIssue, CarIssueType } from '@/api/client';
import { FareDisplay, ClockIcon, WrenchIcon, CheckIcon, PhoneIcon, CashIcon } from '@/components/ds';

const CAR_ISSUE_TYPES: { value: CarIssueType; label: string }[] = [
  { value: 'FUEL_LOW', label: 'Fuel Low' },
  { value: 'WARNING_LIGHT', label: 'Warning Light' },
  { value: 'TYRE', label: 'Tyre' },
  { value: 'AC', label: 'AC' },
  { value: 'OTHER', label: 'Other' },
];

export default function FinalBillPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderID = searchParams.get('order_id') || '';
  const { token } = useAuthStore();

  const [bill, setBill] = useState<FinalBill | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'CASH' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Phase 10: post-trip car issue report
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueType, setIssueType] = useState<CarIssueType>('FUEL_LOW');
  const [issueDesc, setIssueDesc] = useState('');
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [issueDone, setIssueDone] = useState(false);

  const submitCarIssue = async () => {
    if (issueSubmitting) return;
    setIssueSubmitting(true);
    try {
      if (token && orderID) {
        await reportCarIssue(token, orderID, { issue_type: issueType, description: issueDesc });
      }
      setIssueDone(true);
      setShowIssueForm(false);
      setIssueDesc('');
    } catch (e) {
      alert('Failed to report car issue. Please try again.');
    } finally {
      setIssueSubmitting(false);
    }
  };

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
        driver_payout_paise: 49688,
      });
    }
  }, [orderID]);

  if (!bill) {
    return (
      <div className="min-h-screen bg-black text-white p-6 font-mono flex items-center justify-center">
        <div className="text-center space-y-2">
          <span className="flex justify-center animate-spin text-content-tertiary"><ClockIcon size={24} /></span>
          <p className="text-xs text-content-tertiary">HYDRATING TRANSIT RECEIPT...</p>
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
      <header className="border-b border-border-opaque pb-4 mb-4">
        <span className="text-[8px] text-content-tertiary uppercase tracking-widest font-bold">Transit Settlement Panel</span>
        <h1 className="text-sm font-bold text-white mt-1 uppercase">Trip Finalization Receipt</h1>
        <p className="text-[8px] text-content-tertiary mt-0.5">ORDER ID: {orderID.substring(0, 18)}...</p>
      </header>

      <main className="flex-grow max-w-md mx-auto w-full space-y-6">
        {/* Receipt Table Component */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 bg-background-secondary text-content-secondary text-[7px] uppercase font-bold tracking-widest rounded-bl border-l border-b border-border-opaque">
            Invoice
          </div>
          <span className="text-[9px] font-bold text-content-secondary uppercase tracking-wider block border-b border-border-opaque pb-2">
            Itemized Breakdown (INR)
          </span>

          <div className="space-y-2 text-[10px] text-content-secondary">
            <div className="flex justify-between">
              <span>Base Package Quoted:</span>
              <FareDisplay amount={baseFare * 100} size="md" className="text-white" />
            </div>
            <div className="flex justify-between">
              <span>Extra Distance ({bill.distance_km.toFixed(1)} KM):</span>
              <FareDisplay amount={extraKmCharge * 100} size="md" className="text-white" />
            </div>
            <div className="flex justify-between">
              <span>Waiting Time ({bill.wait_minutes} mins):</span>
              <FareDisplay amount={waitingCharge * 100} size="md" className="text-white" />
            </div>
            <div className="flex justify-between">
              <span>Overtime Transit ({bill.overtime_minutes} mins):</span>
              <FareDisplay amount={overtimeCharge * 100} size="md" className="text-white" />
            </div>
            <div className="flex justify-between">
              <span>Night Surcharge:</span>
              <FareDisplay amount={nightCharge * 100} size="md" className="text-white" />
            </div>
            <div className="flex justify-between">
              <span>Highway Toll Charges:</span>
              <FareDisplay amount={tolls * 100} size="md" className="text-white" />
            </div>
            <div className="flex justify-between">
              <span>Parking / Stops:</span>
              <FareDisplay amount={parking * 100} size="md" className="text-white" />
            </div>
            <div className="flex justify-between">
              <span>D4M Care Trust Surcharge:</span>
              <FareDisplay amount={d4mCareFee * 100} size="md" className="text-white" />
            </div>
            <div className="border-t border-border-opaque pt-3 flex justify-between items-center text-xs font-bold mt-1">
              <span className="text-white">TOTAL AMOUNT DUE:</span>
              <FareDisplay amount={totalAmount * 100} size="md" className="text-content-positive text-sm font-extrabold" />
            </div>
          </div>
        </div>

        {/* Report Car Issue (Phase 10) */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-4 shadow-xl text-left">
          {!showIssueForm && !issueDone && (
            <button
              onClick={() => setShowIssueForm(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-warning-400/40 bg-surface-warning/20 text-[10px] font-bold uppercase tracking-wider text-content-warning hover:bg-surface-warning/40 transition cursor-pointer"
            >
              <WrenchIcon size={14} /> Report Car Issue
            </button>
          )}
          {issueDone && (
            <p className="flex items-center justify-center gap-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-content-positive">
              <CheckIcon size={14} /> Car issue reported — admin notified
            </p>
          )}
          {showIssueForm && (
            <div className="space-y-3">
              <span className="text-[9px] font-bold text-content-warning uppercase tracking-wider block">
                Report Car Issue
              </span>
              <div className="grid grid-cols-3 gap-2">
                {CAR_ISSUE_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setIssueType(t.value)}
                    className={`py-2 rounded-lg text-[9px] font-bold uppercase tracking-wide border transition cursor-pointer ${
                      issueType === t.value
                        ? 'bg-surface-warning/40 border-warning-400 text-content-warning'
                        : 'bg-black border-border-opaque text-content-tertiary hover:text-content-secondary'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <textarea
                value={issueDesc}
                onChange={(e) => setIssueDesc(e.target.value)}
                placeholder="Describe the issue (optional)"
                rows={2}
                className="w-full bg-black border border-border-opaque rounded-lg p-2 text-white focus:outline-none focus:border-warning-400 text-xs font-mono resize-none"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowIssueForm(false)}
                  className="bg-background-secondary border border-border-opaque px-3 py-1.5 rounded text-[8px] font-bold uppercase tracking-wider text-content-secondary cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={submitCarIssue}
                  disabled={issueSubmitting}
                  className="bg-warning-400 hover:bg-warning-400 text-black px-3 py-1.5 rounded text-[8px] font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50"
                >
                  {issueSubmitting ? 'Filing...' : 'Submit Report'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Payment Selector */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4 shadow-xl text-left">
          <span className="text-[9px] font-bold text-content-secondary uppercase tracking-wider block border-b border-border-opaque pb-2">
            Select Payment Method
          </span>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setPaymentMethod('UPI')}
              className={`py-4 px-4 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition cursor-pointer flex flex-col items-center justify-center gap-1.5 ${
                paymentMethod === 'UPI'
                  ? 'bg-background-secondary border-white text-white font-extrabold shadow-lg shadow-white/5'
                  : 'bg-black border-border-opaque text-content-tertiary hover:text-content-secondary'
              }`}
            >
              <PhoneIcon size={18} />
              <span>UPI / QR Code</span>
            </button>
            <button
              onClick={() => setPaymentMethod('CASH')}
              className={`py-4 px-4 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition cursor-pointer flex flex-col items-center justify-center gap-1.5 ${
                paymentMethod === 'CASH'
                  ? 'bg-background-secondary border-white text-white font-extrabold shadow-lg shadow-white/5'
                  : 'bg-black border-border-opaque text-content-tertiary hover:text-content-secondary'
              }`}
            >
              <CashIcon size={18} />
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
              ? 'bg-white text-black hover:bg-background-tertiary border-white font-extrabold active:scale-[0.98]'
              : 'bg-background-primary border-border-opaque text-content-tertiary cursor-not-allowed'
          }`}
        >
          {isSubmitting ? 'Finalizing Invoice...' : 'Confirm payment & next'}
        </button>
      </footer>
    </div>
  );
}
