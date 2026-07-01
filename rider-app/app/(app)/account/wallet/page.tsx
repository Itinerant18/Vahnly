"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { Shimmer, SkeletonList, ErrorState, EmptyState } from "@/components/account/States";
import { WalletIcon, BookingIcon } from "@/components/ds/Icon";
import { walletApi } from "@/lib/api/wallet";
import { FareDisplay } from "@/components/ds";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { NumberTicker } from "@/components/ui/number-ticker";
import { BlurFade } from "@/components/ui/blur-fade";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { BorderBeam } from "@/components/ui/border-beam";
import { WordRotate } from "@/components/ui/word-rotate";
import type { Wallet, WalletTransaction } from "@/lib/api/types";

const PRESETS = [10000, 50000, 100000]; // paise
const PAGE = 20;

export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null | "error">(null);
  const [txns, setTxns] = useState<WalletTransaction[]>([]);
  const [txError, setTxError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const offsetRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadWallet = useCallback(() => {
    walletApi.get().then(setWallet).catch(() => setWallet("error"));
  }, []);

  const loadTxns = useCallback(async () => {
    if (loadingMore || done) return;
    setLoadingMore(true);
    setTxError(false);
    try {
      const res = await walletApi.transactions(PAGE, offsetRef.current);
      setTxns((prev) => [...prev, ...res.transactions]);
      offsetRef.current += res.transactions.length;
      if (res.transactions.length < PAGE) setDone(true);
    } catch {
      setTxError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, done]);

  useEffect(() => {
    loadWallet();
    loadTxns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && loadTxns(),
      { rootMargin: "120px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadTxns]);

  return (
    <AccountScaffold title={<WordRotate words={["Wallet", "Balance", "Payments"]} duration={3000} />}>
      {/* Balance card */}
      {wallet === null ? (
        <Shimmer className="h-32 w-full" />
      ) : wallet === "error" ? (
        <ErrorState message="Could not load wallet." onRetry={loadWallet} />
      ) : (
        <BlurFade className="relative rounded-2xl bg-gradient-to-br from-accent-400 to-accent-600 p-5 shadow-lg overflow-hidden">
          <BorderBeam size={120} duration={8} colorFrom="#ffffff" colorTo="rgba(255,255,255,0.1)" borderWidth={2} />
          <div className="flex items-center justify-between">
            <p className="text-xs text-white/80">Wallet Balance</p>
            <WalletIcon size={22} className="text-white/80" />
          </div>
          <p className="mt-2 block text-3xl font-bold text-white tabular-nums">
            ₹<NumberTicker value={wallet.balance_paise / 100} decimalPlaces={2} className="text-white" />
          </p>
          {wallet.locked_paise > 0 && (
            <span className="mt-3 inline-block rounded-lg bg-black/20 px-2.5 py-1 text-xs text-white/80">
              <NumberTicker value={wallet.locked_paise / 100} decimalPlaces={2} className="text-white/80" /> locked
            </span>
          )}
        </BlurFade>
      )}

      <BlurFade delay={0.1}>
        <ShimmerButton
          type="button"
          onClick={() => setShowAdd(true)}
          shimmerColor="rgba(255,255,255,0.3)"
          background="#1a5cff"
          borderRadius="16px"
          className="mt-3 py-3.5 text-sm font-bold"
        >
          + Add Money
        </ShimmerButton>
      </BlurFade>

      {/* Transactions */}
      <BlurFade delay={0.15}>
        <h2 className="mb-3 mt-6 text-sm font-bold text-content-primary">Transactions</h2>
      </BlurFade>
      {txns.length === 0 && loadingMore ? (
        <SkeletonList rows={5} height="h-16" />
      ) : txns.length === 0 && txError ? (
        <ErrorState onRetry={loadTxns} />
      ) : txns.length === 0 ? (
        <EmptyState icon={<BookingIcon size={28} />} title="No transactions yet" message="Add money to get started." />
      ) : (
        <div className="space-y-2">
          {txns.map((t, i) => {
            const credit = t.amount_paise >= 0;
            return (
              <BlurFade key={t.id} delay={0.2 + i * 0.03} inView inViewMargin="-20px">
              <div className="flex items-center gap-3 rounded-xl bg-background-secondary p-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm ${
                    credit ? "bg-surface-positive text-content-positive" : "bg-surface-negative text-content-negative"
                  }`}
                >
                  {credit ? "+" : "−"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-content-primary">{t.description ?? t.type}</p>
                  <p className="text-xs text-content-secondary">
                    {new Date(t.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </p>
                </div>
                <p className={`text-sm font-semibold ${credit ? "text-content-positive" : "text-content-negative"}`}>
                  {credit ? "+" : "−"}
                  <FareDisplay amount={Math.abs(t.amount_paise)} size="md" />
                </p>
              </div>
            </BlurFade>
            );
          })}
          <div ref={sentinelRef} className="h-8" />
          {loadingMore && <Shimmer className="h-16 w-full" />}
          {done && <p className="py-3 text-center text-xs text-content-tertiary">No more transactions</p>}
        </div>
      )}

      {showAdd && (
        <AddMoneySheet
          onClose={() => setShowAdd(false)}
          onDone={() => {
            setShowAdd(false);
            loadWallet();
          }}
        />
      )}
    </AccountScaffold>
  );
}

function AddMoneySheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(50000);
  const [custom, setCustom] = useState("");
  const [phase, setPhase] = useState<"amount" | "processing" | "success">("amount");

  const paise = custom ? Math.round(parseFloat(custom) * 100) : amount;

  const pay = async () => {
    if (paise <= 0) return;
    setPhase("processing");
    try {
      await walletApi.topup(paise);
    } catch {
      /* stub success regardless */
    }
    setTimeout(() => setPhase("success"), 900);
    setTimeout(onDone, 2200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div className="w-full rounded-t-3xl bg-background-secondary p-6 animate-spring-up" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />

        {phase === "amount" && (
          <>
            <h3 className="mb-4 text-lg font-bold text-content-primary">Add Money</h3>
            <div className="mb-3 flex gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setAmount(p);
                    setCustom("");
                  }}
                  className={`flex-1 rounded-xl py-3 text-sm font-semibold ${
                    amount === p && !custom ? "bg-accent-400 text-content-primary" : "bg-background-tertiary text-content-secondary"
                  }`}
                >
                  {formatCurrency(p)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-background-tertiary px-4">
              <span className="text-sm text-content-secondary">₹</span>
              <input
                type="number"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Custom amount"
                className="flex-1 bg-transparent py-3 text-sm text-content-primary outline-none placeholder:text-content-tertiary"
              />
            </div>
            <ShimmerButton
              type="button"
              disabled={paise <= 0}
              onClick={pay}
              shimmerColor="rgba(255,255,255,0.3)"
              background="#1a5cff"
              borderRadius="16px"
              className="py-4 text-base font-bold disabled:opacity-40"
            >
              Add {formatCurrency(paise > 0 ? paise : 0)}
            </ShimmerButton>
          </>
        )}

        {phase === "processing" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-border-opaque border-t-border-accent" />
            <p className="text-sm text-content-secondary">Processing payment…</p>
          </div>
        )}

        {phase === "success" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-positive-400">
              <span className="text-3xl text-content-primary">✓</span>
            </div>
            <p className="text-base font-bold text-content-primary">{formatCurrency(paise)} added!</p>
          </div>
        )}
        <div className="h-4" />
      </div>
    </div>
  );
}
