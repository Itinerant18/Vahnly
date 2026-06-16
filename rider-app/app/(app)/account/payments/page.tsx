"use client";

import { useEffect, useState } from "react";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { EmptyState } from "@/components/account/States";
import { paymentsApi, type AddPaymentMethodInput } from "@/lib/api/payments";
import type { SavedCard, UpiMethod } from "@/lib/api/types";

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
    <AccountScaffold title="Payments">
      {loadError && (
        <div className="mb-4 rounded-xl bg-surface-negative px-4 py-3 text-sm text-content-negative">
          {loadError}
        </div>
      )}

      {/* Saved cards */}
      <Section title="Saved Cards">
        {cards.length === 0 ? (
          <EmptyState icon="💳" title="No cards saved" message="Add a card for faster checkout." />
        ) : (
          <div className="mb-3 space-y-2">
            {cards.map((c) => (
              <div key={c.id} className="rounded-xl bg-background-secondary px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">💳</span>
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
                    className="text-xs font-semibold text-content-negative"
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
                      className="text-xs font-semibold text-content-accent"
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
          <div className="space-y-3 rounded-2xl bg-background-secondary p-4">
            <div className="rounded-xl bg-background-tertiary px-3 py-2 text-xs text-content-secondary">
              We store only your card brand and last 4 digits — never the full number.
            </div>
            <input
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
            <div className="flex gap-2">
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
              value={cardName}
              onChange={(e) => setCardName(e.target.value)}
              placeholder="Name on card"
              className={INPUT}
            />
            {cardError && <p className="text-xs text-content-negative">{cardError}</p>}
            <div className="flex gap-2">
              <button
                onClick={resetCardForm}
                className="flex-1 rounded-2xl bg-background-tertiary py-3 text-sm font-semibold text-content-secondary ring-1 ring-border-opaque"
              >
                Cancel
              </button>
              <button
                onClick={saveCard}
                disabled={!cardMasked || !expMonth || !expYear || saving}
                className="flex-1 rounded-2xl bg-interactive-primary py-3 text-sm font-bold text-interactive-primary-text disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save Card"}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowCardForm(true)}
            className="w-full rounded-2xl bg-background-tertiary py-3.5 text-sm font-semibold text-content-accent ring-1 ring-border-opaque"
          >
            + Add Card
          </button>
        )}
      </Section>

      {/* UPI IDs */}
      <Section title="UPI IDs">
        {upis.length > 0 && (
          <div className="mb-3 space-y-2">
            {upis.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between rounded-xl bg-background-secondary px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">🏦</span>
                  <span className="text-sm text-content-primary">{u.vpa}</span>
                  {u.is_default && (
                    <span className="rounded-full bg-surface-accent px-2 py-0.5 text-[10px] font-semibold text-content-accent">
                      Default
                    </span>
                  )}
                </div>
                <button
                  onClick={() => removeUpi(u.id)}
                  className="text-xs font-semibold text-content-negative"
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
            className="rounded-xl bg-interactive-primary px-4 text-sm font-semibold text-interactive-primary-text"
          >
            Add
          </button>
        </div>
        {upiErr && <p className="mt-1 text-xs text-content-negative">{upiErr}</p>}
      </Section>

      {/* Auto-pay (device-local preference) */}
      <Section title="Auto-pay">
        <Toggle
          label="Auto-pay trip fares"
          desc="Saved on this device · charges default method at trip end"
          on={autoPay}
          onChange={toggleAutoPay}
        />
      </Section>

      {/* Billing address (device-local) */}
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
            className="w-full rounded-2xl bg-interactive-primary py-3.5 text-sm font-bold text-interactive-primary-text"
          >
            Save Billing Details
          </button>
        </div>
      </Section>

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
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${on ? "bg-accent-400" : "bg-background-tertiary"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`}
        />
      </button>
    </div>
  );
}
