"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { ordersApi } from "@/lib/api/orders";
import type { Order } from "@/lib/api/types";

const CATEGORIES = [
  { key: "trip", label: "Trip issue", icon: "🚗", needsTrip: true },
  { key: "payment", label: "Payment", icon: "💳", needsTrip: true },
  { key: "driver", label: "Driver behavior", icon: "🧑‍✈️", needsTrip: true },
  { key: "account", label: "Account", icon: "👤", needsTrip: false },
  { key: "lost", label: "Lost item", icon: "🎒", needsTrip: true },
  { key: "safety", label: "Safety", icon: "🛡️", needsTrip: false },
  { key: "other", label: "Other", icon: "❓", needsTrip: false },
];

const FAQS = [
  { q: "How do I cancel a ride?", a: "Open your active trip and tap Cancel. Free within 3 minutes of assignment." },
  { q: "When is a driver charged a fee?", a: "Cancellation fees apply after the free window or once the driver arrives." },
  { q: "How do refunds work?", a: "Wallet refunds are instant. Card/UPI refunds take 3–5 business days." },
  { q: "Is my trip insured?", a: "Yes, every trip with D4M Care is covered. Manage it under Account → D4M Care." },
];

interface Ticket {
  id: string;
  subject: string;
  status: "OPEN" | "CLOSED";
}

const MOCK_TICKETS: Ticket[] = [
  { id: "TKT-1042", subject: "Refund for cancelled trip", status: "OPEN" },
  { id: "TKT-0988", subject: "Wrong fare charged", status: "CLOSED" },
];

function SupportBody() {
  const params = useSearchParams();
  const preOrderId = params.get("orderId");

  const [category, setCategory] = useState<string | null>(preOrderId ? "trip" : null);
  const [trips, setTrips] = useState<Order[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<string | null>(preOrderId);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  const cat = CATEGORIES.find((c) => c.key === category);
  const needsTrip = cat?.needsTrip ?? false;

  useEffect(() => {
    if (needsTrip && trips.length === 0) {
      ordersApi.history({ limit: 10 }).then((r) => setTrips(r.orders)).catch(() => {});
    }
  }, [needsTrip, trips.length]);

  const canSubmit = !!category && (!needsTrip || !!selectedTrip) && message.trim().length >= 5;

  const submit = () => {
    if (!canSubmit) return;
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#22C55E]/15 text-3xl">✅</div>
        <p className="text-base font-bold text-white">Ticket submitted</p>
        <p className="max-w-xs text-sm text-[#9CA3AF]">
          We&apos;ve received your request. Our team will reply within 24 hours.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Category grid */}
      <p className="mb-3 text-sm font-bold text-white">What do you need help with?</p>
      <div className="grid grid-cols-3 gap-3">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => {
              setCategory(c.key);
              setSelectedTrip(null);
            }}
            className={`flex flex-col items-center gap-2 rounded-2xl py-4 ${
              category === c.key ? "bg-[#FF6B35]/15 ring-1 ring-[#FF6B35]" : "bg-[#141414]"
            }`}
          >
            <span className="text-2xl">{c.icon}</span>
            <span className="text-center text-xs text-[#D1D5DB]">{c.label}</span>
          </button>
        ))}
      </div>

      {/* Trip selector */}
      {needsTrip && (
        <div className="mt-5">
          <p className="mb-2 text-sm font-bold text-white">Select trip</p>
          {trips.length === 0 ? (
            <p className="text-xs text-[#9CA3AF]">No recent trips found.</p>
          ) : (
            <div className="space-y-2">
              {trips.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTrip(t.id)}
                  className={`block w-full rounded-xl p-3 text-left text-xs ${
                    selectedTrip === t.id ? "bg-[#FF6B35]/15 ring-1 ring-[#FF6B35]" : "bg-[#141414]"
                  }`}
                >
                  <span className="font-mono text-[#9CA3AF]">{t.id.slice(0, 8)}</span>
                  <span className="ml-2 text-white">
                    {new Date(t.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Message */}
      {category && (
        <div className="mt-5">
          <p className="mb-2 text-sm font-bold text-white">Describe the issue</p>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={1000}
            placeholder="Tell us what happened…"
            className="w-full resize-none rounded-xl bg-[#1E1E1E] p-4 text-sm text-white outline-none placeholder:text-[#6B7280] focus:ring-1 focus:ring-[#FF6B35]"
          />
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="mt-3 w-full rounded-2xl bg-[#FF6B35] py-3.5 text-sm font-bold text-white disabled:opacity-40"
          >
            Submit Ticket
          </button>
        </div>
      )}

      {/* Quick contact */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          onClick={() => alert("Chat available 9AM–9PM")}
          className="rounded-2xl bg-[#141414] py-4 text-sm font-semibold text-white"
        >
          💬 Live Chat
        </button>
        <a
          href="tel:+918000000000"
          className="rounded-2xl bg-[#141414] py-4 text-center text-sm font-semibold text-white"
        >
          📞 Call Support
        </a>
      </div>

      {/* FAQ */}
      <h2 className="mb-3 mt-6 text-sm font-bold text-white">FAQ</h2>
      <div className="space-y-2">
        {FAQS.map((f, i) => (
          <div key={i} className="overflow-hidden rounded-2xl bg-[#141414]">
            <button
              onClick={() => setFaqOpen(faqOpen === i ? null : i)}
              className="flex w-full items-center justify-between p-4 text-left"
            >
              <span className="text-sm text-white">{f.q}</span>
              <span className={`text-[#9CA3AF] transition-transform ${faqOpen === i ? "rotate-180" : ""}`}>▾</span>
            </button>
            {faqOpen === i && <p className="px-4 pb-4 text-xs text-[#9CA3AF]">{f.a}</p>}
          </div>
        ))}
      </div>

      {/* Ticket history */}
      <h2 className="mb-3 mt-6 text-sm font-bold text-white">Your Tickets</h2>
      <div className="space-y-2">
        {MOCK_TICKETS.map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded-2xl bg-[#141414] p-4">
            <div>
              <p className="text-sm text-white">{t.subject}</p>
              <p className="font-mono text-xs text-[#6B7280]">{t.id}</p>
            </div>
            <span
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                t.status === "OPEN" ? "bg-[#FF6B35]/10 text-[#FF6B35]" : "bg-[#9CA3AF]/10 text-[#9CA3AF]"
              }`}
            >
              {t.status}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

export default function SupportPage() {
  return (
    <AccountScaffold title="Support">
      <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-[#1E1E1E]" />}>
        <SupportBody />
      </Suspense>
    </AccountScaffold>
  );
}
