"use client";

import { useState } from "react";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { EmptyState } from "@/components/account/States";

const INPUT =
  "w-full rounded-xl bg-[#1E1E1E] px-4 py-3 text-sm text-white outline-none placeholder:text-[#6B7280] focus:ring-1 focus:ring-[#FF6B35]";

interface UpiId {
  id: string;
  vpa: string;
}

export default function PaymentsPage() {
  const [upis, setUpis] = useState<UpiId[]>([]);
  const [newUpi, setNewUpi] = useState("");
  const [upiErr, setUpiErr] = useState<string | null>(null);
  const [autoPay, setAutoPay] = useState(false);
  const [gst, setGst] = useState({ name: "", gstin: "", address: "" });
  const [toast, setToast] = useState<string | null>(null);

  const addUpi = () => {
    if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(newUpi)) {
      setUpiErr("Enter a valid UPI ID (e.g. name@bank)");
      return;
    }
    setUpis((u) => [...u, { id: newUpi + Date.now(), vpa: newUpi }]);
    setNewUpi("");
    setUpiErr(null);
  };

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1800);
  };

  return (
    <AccountScaffold title="Payments">
      {/* Saved cards */}
      <Section title="Saved Cards">
        <EmptyState icon="💳" title="No cards saved" message="Add a card for faster checkout." />
        <button
          onClick={() => flash("Payment gateway coming soon")}
          className="w-full rounded-2xl bg-[#1E1E1E] py-3.5 text-sm font-semibold text-[#FF6B35] ring-1 ring-white/8"
        >
          + Add Card
        </button>
      </Section>

      {/* UPI IDs */}
      <Section title="UPI IDs">
        {upis.length > 0 && (
          <div className="mb-3 space-y-2">
            {upis.map((u) => (
              <div key={u.id} className="flex items-center justify-between rounded-xl bg-[#141414] px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🏦</span>
                  <span className="text-sm text-white">{u.vpa}</span>
                </div>
                <button
                  onClick={() => setUpis((list) => list.filter((x) => x.id !== u.id))}
                  className="text-xs font-semibold text-[#EF4444]"
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
            onChange={(e) => setNewUpi(e.target.value)}
            onBlur={() => newUpi && addUpi()}
            placeholder="name@bank"
            className={`${INPUT} flex-1`}
          />
          <button onClick={addUpi} className="rounded-xl bg-[#FF6B35] px-4 text-sm font-semibold text-white">
            Add
          </button>
        </div>
        {upiErr && <p className="mt-1 text-xs text-[#EF4444]">{upiErr}</p>}
      </Section>

      {/* Auto-pay */}
      <Section title="Auto-pay">
        <Toggle
          label="Auto-pay trip fares"
          desc="Charge default method automatically at trip end"
          on={autoPay}
          onChange={() => setAutoPay((v) => !v)}
        />
      </Section>

      {/* Billing address */}
      <Section title="Billing Address (GST)">
        <div className="space-y-3">
          <input
            value={gst.name}
            onChange={(e) => setGst({ ...gst, name: e.target.value })}
            placeholder="Business / billing name"
            className={INPUT}
          />
          <input
            value={gst.gstin}
            onChange={(e) => setGst({ ...gst, gstin: e.target.value.toUpperCase() })}
            placeholder="GSTIN (optional)"
            className={INPUT}
          />
          <textarea
            value={gst.address}
            onChange={(e) => setGst({ ...gst, address: e.target.value })}
            placeholder="Billing address"
            rows={2}
            className={`${INPUT} resize-none`}
          />
          <button
            onClick={() => flash("Billing details saved")}
            className="w-full rounded-2xl bg-[#FF6B35] py-3.5 text-sm font-bold text-white"
          >
            Save Billing Details
          </button>
        </div>
      </Section>

      {toast && (
        <div className="fixed inset-x-4 bottom-24 z-50 rounded-2xl bg-[#1E1E1E] px-4 py-3 text-center text-sm text-white ring-1 ring-white/10">
          {toast}
        </div>
      )}
    </AccountScaffold>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="mb-3 text-sm font-bold text-white">{title}</h2>
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
    <div className="flex items-center justify-between rounded-2xl bg-[#141414] p-4">
      <div className="mr-3">
        <p className="text-sm text-white">{label}</p>
        {desc && <p className="mt-0.5 text-xs text-[#9CA3AF]">{desc}</p>}
      </div>
      <button
        onClick={onChange}
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${on ? "bg-[#FF6B35]" : "bg-[#3A3A3A]"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`}
        />
      </button>
    </div>
  );
}
