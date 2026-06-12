'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import {
  getDriverPayouts, requestDriverPayout, ApiClientError,
  type DriverPayoutsResponse, type PayoutStatus,
} from '@/api/client';
import { formatCurrency, formatCompactDate } from '@/lib/format';

const MIN_PAYOUT_PAISE = 10000; // ₹100

const STATUS_STYLE: Record<PayoutStatus, string> = {
  PENDING: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  PROCESSING: 'text-sky-400 bg-sky-400/10 border-sky-400/30',
  PAID: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  FAILED: 'text-red-400 bg-red-400/10 border-red-400/30',
};

export default function DriverPayoutsPage() {
  const { token } = useAuthStore();
  const [data, setData] = useState<DriverPayoutsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    try {
      setData(await getDriverPayouts(token));
    } catch (err) {
      console.warn('[Payouts] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const availablePaise = data?.available_balance_paise ?? 0;
  const bank = data?.bank_account;

  const handleMax = () => setAmount((availablePaise / 100).toFixed(2));

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setFeedback(null);
    const amountPaise = Math.round(parseFloat(amount || '0') * 100);
    if (!amountPaise || amountPaise < MIN_PAYOUT_PAISE) {
      setFeedback({ kind: 'err', msg: 'Minimum withdrawal is ₹100.' });
      return;
    }
    if (amountPaise > availablePaise) {
      setFeedback({ kind: 'err', msg: 'Amount exceeds your available balance.' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await requestDriverPayout(token, amountPaise);
      setFeedback({ kind: 'ok', msg: `Payout requested (${res.payout_id}). ${res.estimated_time}.` });
      setAmount('');
      await load();
    } catch (err) {
      // Idempotency: the backend returns 409 when a payout is already in flight.
      if (err instanceof ApiClientError) {
        if (err.status === 409) {
          setFeedback({ kind: 'err', msg: 'Payout already requested — only one per hour.' });
        } else if (err.status === 403) {
          setFeedback({ kind: 'err', msg: 'Add a verified bank account before withdrawing.' });
        } else if (err.status === 400) {
          setFeedback({ kind: 'err', msg: 'Invalid amount for withdrawal.' });
        } else {
          setFeedback({ kind: 'err', msg: 'Withdrawal failed. Please try again.' });
        }
      } else {
        setFeedback({ kind: 'err', msg: 'Withdrawal failed. Please try again.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 text-left">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">Payouts</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Withdraw your earnings to your bank</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="sm:col-span-2 space-y-6">
          {/* Balance */}
          <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-6 space-y-1">
            <span className="text-zinc-500 text-[9px] uppercase font-mono tracking-wider font-bold">Available to Withdraw</span>
            <h3 className="text-3xl font-mono font-bold text-emerald-400">{loading ? '₹—' : formatCurrency(availablePaise)}</h3>
            <span className="text-[8px] font-mono text-zinc-600 block pt-0.5">Net ledger earnings minus pending payouts</span>
          </div>

          {/* Withdraw form */}
          <form onSubmit={handleRequest} className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
            <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">Request Payout</h4>
            <div className="space-y-2">
              <label className="block text-[8px] font-bold text-zinc-500 uppercase font-mono tracking-wider">Amount (min ₹100)</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3.5 top-3.5 text-zinc-500 font-mono text-xs">₹</span>
                  <input
                    type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                    placeholder="Enter amount" min="100" step="0.01"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 pl-7 text-white focus:outline-none focus:border-zinc-500 text-xs font-mono"
                    required
                  />
                </div>
                <button type="button" onClick={handleMax} disabled={availablePaise < MIN_PAYOUT_PAISE}
                  className="bg-zinc-900 hover:bg-zinc-850 text-zinc-300 border border-zinc-800 rounded-xl px-4 text-[10px] font-bold uppercase tracking-wider transition cursor-pointer font-mono disabled:opacity-40">
                  Max
                </button>
              </div>
            </div>

            {feedback && (
              <div className={`rounded-xl px-3 py-2 text-[10px] font-mono ${feedback.kind === 'ok' ? 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/30' : 'bg-red-400/10 text-red-300 border border-red-400/30'}`}>
                {feedback.kind === 'ok' ? '✓ ' : '⚠ '}{feedback.msg}
              </div>
            )}

            <button type="submit" disabled={submitting || loading || availablePaise < MIN_PAYOUT_PAISE}
              className="w-full bg-white hover:bg-zinc-200 text-black py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer active:scale-95 font-sans disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? 'Requesting…' : 'Request Payout'}
            </button>
          </form>
        </div>

        {/* Linked bank */}
        <div className="space-y-6">
          <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
            <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
              <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">Linked Bank</h4>
              {bank?.verified
                ? <span className="text-[8px] font-mono text-emerald-400 uppercase">● Verified</span>
                : <span className="text-[8px] font-mono text-amber-400 uppercase">● Unverified</span>}
            </div>
            <div className="space-y-3 font-mono text-xs text-zinc-400 leading-relaxed">
              <div>
                <span className="text-zinc-600 block text-[8px] uppercase">Bank</span>
                <span className="font-bold text-white">{bank?.bank_name || '—'}</span>
              </div>
              <div>
                <span className="text-zinc-600 block text-[8px] uppercase">Account</span>
                <span className="font-bold text-white">{bank?.account_masked || '—'}</span>
              </div>
              <div>
                <span className="text-zinc-600 block text-[8px] uppercase">IFSC</span>
                <span className="font-bold text-white">{bank?.ifsc || '—'}</span>
              </div>
            </div>
            <p className="text-[8px] font-mono text-zinc-600 leading-relaxed">Bank details are managed during onboarding / KYC. Contact support to change them.</p>
          </div>
        </div>
      </div>

      {/* History */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">Payout History</h4>
        <div className="divide-y divide-zinc-900">
          {(data?.payout_history ?? []).length === 0 && (
            <p className="py-3 text-[10px] font-mono text-zinc-600 text-center">No payouts yet.</p>
          )}
          {(data?.payout_history ?? []).map((p) => (
            <div key={p.id} className="py-3 flex justify-between items-center text-xs font-mono">
              <div>
                <span className="text-white block font-sans font-medium">{formatCurrency(p.amount_paise)}</span>
                <span className="text-zinc-500 text-[8px] block mt-0.5">
                  Requested {formatCompactDate(p.requested_at)}
                  {p.status === 'PAID' ? ` • Paid ${formatCompactDate(p.updated_at)}` : ''}
                </span>
              </div>
              <span className={`text-[8px] font-mono uppercase font-bold px-2 py-1 rounded-full border ${STATUS_STYLE[p.status] ?? STATUS_STYLE.PENDING}`}>
                {p.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
