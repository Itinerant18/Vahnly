"use client";

import { useEffect, useRef, useState } from "react";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { EmptyState } from "@/components/account/States";
import { paymentsApi, type AddPaymentMethodInput } from "@/lib/api/payments";
import type { SavedCard, UpiMethod } from "@/lib/api/types";
import { AnimatedIcon, CardIcon, PaymentIcon } from "@/components/ds/Icon";
import { AnimWallet } from "@/assets/icons/animated";
import { BlurFade } from "@/components/ui/blur-fade";
import { ShineBorder } from "@/components/ui/shine-border";
import { AnimatedBeam } from "@/components/ui/animated-beam";
import { WordRotate } from "@/components/ui/word-rotate";

const INPUT =
  "w-full rounded-xl bg-background-tertiary px-4 py-3 text-sm text-content-primary outline-none placeholder:text-content-tertiary focus:ring-1 focus:ring-border-accent";

interface Billing {
  name: string;
  address: string;
  city: string;
  state: string;
  pin: string;
  gstin: string;
}

const EMPTY_BILLING: Billing = {
  name: "",
  address: "",
  city: "",
  state: "",
  pin: "",
  gstin: "",
};

export default function PaymentsPage() {
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [upis, setUpis] = useState<UpiMethod[]>([]);

  const [showCardForm, setShowCardForm] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [cardMasked, setCardMasked] = useState(false);
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cardName, setCardName] = useState("");

  const [newUpi, setNewUpi] = useState("");
  const [upiErr, setUpiErr] = useState<string | null>(null);

  const [autoPay, setAutoPay] = useState(false);
  const [billing, setBilling] = useState<Billing>(EMPTY_BILLING);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cardFormRef = useRef<HTMLDivElement>(null);
  const cardNumberRef = useRef<HTMLInputElement>(null);
  const cardExpiryRef = useRef<HTMLDivElement>(null);
  const cardNameRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1800);
  };

  // ─── Load ──────────────────────────────────────────────────────────────────
  const refresh = async () => {
    const data = await paymentsApi.list();
    setCards(data.cards ?? []);
    setUpis(data.upis ?? []);
  };

  useEffect(() => {
    (async () => {
      try {
        await refresh();
        setLoadError(null);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Couldn't load payment methods.");
      }
    })();

    try {
      setAutoPay(localStorage.getItem("dfu_autopay") === "true");
      const raw = localStorage.getItem("dfu_billing");
      if (raw) setBilling({ ...EMPTY_BILLING, ...(JSON.parse(raw) as Partial<Billing>) });
    } catch {
      // localStorage unavailable / corrupt — keep defaults.
    }
  }, []);

  // ─── Cards ─────────────────────────────────────────────────────────────────
  const last4 = (digits: string) => digits.replace(/\s+/g, "").slice(-4);

  const maskCard = () => {
    const d = last4(cardNumber);
    if (d) {
      setCardNumber(`•••• •••• •••• ${d}`);
      setCardMasked(true);
    }
  };

  const resetCardForm = () => {
    setShowCardForm(false);
    setCardNumber("");
    setCardMasked(false);
    setExpMonth("");
    setExpYear("");
    setCardName("");
  };

  const saveCard = async () => {
    const digits = cardNumber.replace(/[^\d]/g, "");
    const input: AddPaymentMethodInput = {
      type: "CARD",
      card_number: digits,
      exp_month: Number(expMonth) || undefined,
      exp_year: Number(expYear) || undefined,
      name: cardName || undefined,
    };
    setSaving(true);
    setCardError(null);
    try {
      // Server returns the full list incl. the new card (brand + last4 only).
      const data = await paymentsApi.add(input);
      setCards(data.cards ?? []);
      setUpis(data.upis ?? []);
      resetCardForm();
      const added = (data.cards ?? []).find((c) => c.last4 === last4(digits));
      flash(added ? `${added.brand} •••• ${added.last4} added` : "Card added");
    } catch (e) {
      setCardError(e instanceof Error ? e.message : "Couldn't add card. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const removeCard = async (id: string) => {
    try {
      await paymentsApi.remove(id);
      await refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Couldn't remove card.");
    }
  };

  const setDefaultCard = async (id: string) => {
    try {
      await paymentsApi.setDefault(id);
      await refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Couldn't update default.");
    }
  };

  // ─── UPI ───────────────────────────────────────────────────────────────────
  const addUpi = async () => {
    const vpa = newUpi.trim();
    if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(vpa)) {
      setUpiErr("Enter a valid UPI ID (e.g. name@bank)");
      return;
    }
    if (upis.some((u) => u.vpa === vpa)) {
      setUpiErr("This UPI ID is already saved");
      return;
    }
    setUpiErr(null);

    try {
      const verify = await paymentsApi.verifyUpi(vpa);
      if (!verify.valid) {
        setUpiErr("This UPI ID could not be verified.");
        return;
      }
    } catch {
      // verify is a stub; don't block add on its failure.
    }

    try {
      const data = await paymentsApi.add({ type: "UPI", vpa });
      setCards(data.cards ?? []);
      setUpis(data.upis ?? []);
      setNewUpi("");
    } catch (e) {
      setUpiErr(e instanceof Error ? e.message : "Couldn't add UPI ID.");
    }
  };

  const removeUpi = async (id: string) => {
    try {
      await paymentsApi.remove(id);
      await refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Couldn't remove UPI ID.");
    }
  };

  // ─── Prefs ─────────────────────────────────────────────────────────────────
  const toggleAutoPay = () => {
    setAutoPay((v) => {
      const next = !v;
      try {
        localStorage.setItem("dfu_autopay", String(next));
      } catch {
        // Ignore storage failures.
      }
      return next;
    });
    flash("Auto-pay preference saved on this device");
  };

  const saveBilling = () => {
    try {
      localStorage.setItem("dfu_billing", JSON.stringify(billing));
    } catch {
      // Ignore storage failures.
    }
    flash("Billing details saved on this device");
  };

  return (
    <AccountScaffold title={<WordRotate words={["Payments", "Billing", "Payment Methods"]} duration={3000} />}>
      {loadError && (
        <div className="mb-4 rounded-xl bg-surface-negative px-4 py-3 text-sm text-content-negative">
          {loadError}
        </div>
      )}

      {/* Saved cards */}
      <BlurFade delay={0.1}>
        <Section title="Saved Cards">
          {cards.length === 0 ? (
            <EmptyState icon={<AnimatedIcon src={AnimWallet} size={64} trigger="in" colors="primary:#10B981,secondary:#34D399" />} title="No cards saved" message="Add a card for faster checkout." />
          ) : (
            <div className="mb-3 space-y-2">
              {cards.map((c) => (
                <div key={c.id} className="group relative rounded-xl bg-background-secondary px-4 py-3 overflow-hidden transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:scale-[1.01]">
                  <ShineBorder borderWidth={1} duration={8} shineColor="#4A6FA5" className="opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardIcon size={20} className="text-content-secondary" />
                      <span className="text-sm text-content-primary">
                        {c.brand} •••• {c.last4}
                      </span>
                      {c.is_default && (
                        <span className="rounded-full bg-surface-accent px-2 py-0.5 text-[10px] font-semibold text-content-accent">
                          Default
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => removeCard(c.id)}
                      className="text-xs font-semibold text-content-negative active:scale-90 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-xs text-content-secondary">
                      Exp {String(c.exp_month).padStart(2, "0")}/{c.exp_year}
                    </span>
                    {!c.is_default && (
                      <button
                        onClick={() => setDefaultCard(c.id)}
                        className="text-xs font-semibold text-content-accent active:scale-90 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
                      >
                        Set default
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {showCardForm ? (
            <div ref={cardFormRef} className="relative space-y-3 rounded-2xl bg-background-secondary p-4">
              <AnimatedBeam
                containerRef={cardFormRef}
                fromRef={cardNumberRef}
                toRef={cardExpiryRef}
                curvature={-20}
                duration={5}
                pathColor="#4A6FA5"
                pathWidth={1.5}
                pathOpacity={0.12}
                gradientStartColor="#4A6FA5"
                gradientStopColor="#1a5cff"
              />
              <AnimatedBeam
                containerRef={cardFormRef}
                fromRef={cardExpiryRef}
                toRef={cardNameRef}
                curvature={-20}
                duration={5}
                pathColor="#4A6FA5"
                pathWidth={1.5}
                pathOpacity={0.12}
                gradientStartColor="#4A6FA5"
                gradientStopColor="#1a5cff"
                reverse
              />
              <div className="rounded-xl bg-background-tertiary px-3 py-2 text-xs text-content-secondary">
                We store only your card brand and last 4 digits — never the full number.
              </div>
              <input
                ref={cardNumberRef}
                value={cardNumber}
                onChange={(e) => {
                  setCardNumber(e.target.value);
                  setCardMasked(false);
                }}
                onBlur={maskCard}
                inputMode="numeric"
                placeholder="Card number"
                className={INPUT}
              />
              <div ref={cardExpiryRef} className="flex gap-2">
                <input
                  value={expMonth}
                  onChange={(e) => setExpMonth(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                  inputMode="numeric"
                  placeholder="MM"
                  className={`${INPUT} flex-1`}
                />
                <input
                  value={expYear}
                  onChange={(e) => setExpYear(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
                  inputMode="numeric"
                  placeholder="YYYY"
                  className={`${INPUT} flex-1`}
                />
              </div>
              <input
                ref={cardNameRef}
                value={cardName}
                onChange={(e) => setCardName(e.target.value)}
                placeholder="Name on card"
                className={INPUT}
              />
              {cardError && <p className="text-xs text-content-negative">{cardError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={resetCardForm}
                  className="flex-1 rounded-2xl bg-background-tertiary py-3 text-sm font-semibold text-content-secondary ring-1 ring-border-opaque active:scale-[0.98] transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
                >
                  Cancel
                </button>
                <button
                  onClick={saveCard}
                  disabled={!cardMasked || !expMonth || !expYear || saving}
                  className="flex-1 rounded-2xl bg-interactive-primary py-3 text-sm font-bold text-interactive-primary-text disabled:opacity-40 active:scale-[0.98] transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
                >
                  {saving ? "Saving…" : "Save Card"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowCardForm(true)}
              className="w-full rounded-2xl bg-background-tertiary py-3.5 text-sm font-semibold text-content-accent ring-1 ring-border-opaque active:scale-[0.98] transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
            >
              + Add Card
            </button>
          )}
        </Section>
      </BlurFade>

      {/* UPI IDs */}
      <BlurFade delay={0.15}>
        <Section title="UPI IDs">
          {upis.length > 0 && (
            <div className="mb-3 space-y-2">
              {upis.map((u) => (
                <div
                  key={u.id}
                  className="group relative flex items-center justify-between rounded-xl bg-background-secondary px-4 py-3 overflow-hidden transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:scale-[1.01]"
                >
                  <ShineBorder borderWidth={1} duration={8} shineColor="#4A6FA5" className="opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="flex items-center gap-2">
                    <PaymentIcon size={20} className="text-content-secondary" />
                    <span className="text-sm text-content-primary">{u.vpa}</span>
                    {u.is_default && (
                      <span className="rounded-full bg-surface-accent px-2 py-0.5 text-[10px] font-semibold text-content-accent">
                        Default
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => removeUpi(u.id)}
                    className="text-xs font-semibold text-content-negative active:scale-90 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={newUpi}
              onChange={(e) => {
                setNewUpi(e.target.value);
                if (upiErr) setUpiErr(null);
              }}
              placeholder="name@bank"
              className={`${INPUT} flex-1`}
            />
            <button
              onClick={addUpi}
              className="rounded-xl bg-interactive-primary px-4 text-sm font-semibold text-interactive-primary-text active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
            >
              Add
            </button>
          </div>
          {upiErr && <p className="mt-1 text-xs text-content-negative">{upiErr}</p>}
        </Section>
      </BlurFade>

      {/* Auto-pay (device-local preference) */}
      <BlurFade delay={0.2}>
        <Section title="Auto-pay">
          <Toggle
            label="Auto-pay trip fares"
            desc="Saved on this device · charges default method at trip end"
            on={autoPay}
            onChange={toggleAutoPay}
          />
        </Section>
      </BlurFade>

      {/* Billing address (device-local) */}
      <BlurFade delay={0.25}>
        <Section title="Billing Address (GST)">
          <p className="-mt-1 mb-3 text-xs text-content-tertiary">Saved on this device for your invoices.</p>
          <div className="space-y-3">
            <input
              value={billing.name}
              onChange={(e) => setBilling({ ...billing, name: e.target.value })}
              placeholder="Business / billing name"
              className={INPUT}
            />
            <textarea
              value={billing.address}
              onChange={(e) => setBilling({ ...billing, address: e.target.value })}
              placeholder="Billing address"
              rows={2}
              className={`${INPUT} resize-none`}
            />
            <div className="flex gap-2">
              <input
                value={billing.city}
                onChange={(e) => setBilling({ ...billing, city: e.target.value })}
                placeholder="City"
                className={`${INPUT} flex-1`}
              />
              <input
                value={billing.state}
                onChange={(e) => setBilling({ ...billing, state: e.target.value })}
                placeholder="State"
                className={`${INPUT} flex-1`}
              />
            </div>
            <input
              value={billing.pin}
              onChange={(e) =>
                setBilling({ ...billing, pin: e.target.value.replace(/[^\d]/g, "").slice(0, 6) })
              }
              inputMode="numeric"
              placeholder="PIN"
              className={INPUT}
            />
            <input
              value={billing.gstin}
              onChange={(e) => setBilling({ ...billing, gstin: e.target.value.toUpperCase() })}
              placeholder="GSTIN (optional)"
              className={INPUT}
            />
            <button
              onClick={saveBilling}
              className="w-full rounded-2xl bg-interactive-primary py-3.5 text-sm font-bold text-interactive-primary-text active:scale-[0.98] transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
            >
              Save Billing Details
            </button>
          </div>
        </Section>
      </BlurFade>

      {toast && (
        <div className="fixed inset-x-4 bottom-24 z-50 rounded-2xl bg-background-tertiary px-4 py-3 text-center text-sm text-content-primary ring-1 ring-border-opaque">
          {toast}
        </div>
      )}
    </AccountScaffold>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="mb-3 text-sm font-bold text-content-primary">{title}</h2>
      {children}
    </div>
  );
}

function Toggle({
  label,
  desc,
  on,
  onChange,
}: {
  label: string;
  desc?: string;
  on: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-background-secondary p-4">
      <div className="mr-3">
        <p className="text-sm text-content-primary">{label}</p>
        {desc && <p className="mt-0.5 text-xs text-content-secondary">{desc}</p>}
      </div>
      <button
        onClick={onChange}
        aria-label={label}
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] active:scale-90 ${on ? "bg-accent-400" : "bg-background-tertiary"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${on ? "translate-x-5" : "translate-x-0.5"}`}
        />
      </button>
    </div>
  );
}
