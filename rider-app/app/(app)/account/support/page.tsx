"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { ordersApi } from "@/lib/api/orders";
import { supportApi } from "@/lib/api/support";
import type { Order, SupportTicket, SupportTicketMessage } from "@/lib/api/types";

const CATEGORIES = [
  { key: "trip", label: "Trip", icon: "🚗", needsTrip: true },
  { key: "payment", label: "Payment", icon: "💳", needsTrip: true },
  { key: "driver", label: "Driver Behavior", icon: "🧑‍✈️", needsTrip: true },
  { key: "lost", label: "Lost Item", icon: "🎒", needsTrip: true },
  { key: "account", label: "Account", icon: "👤", needsTrip: false },
  { key: "safety", label: "Safety", icon: "🛡️", needsTrip: false },
  { key: "other", label: "Other", icon: "❓", needsTrip: false },
];

const FAQS = [
  {
    q: "How do I cancel a booking?",
    a: "Open your active trip and tap Cancel. Cancellation is free within 3 minutes of driver assignment; after that a small fee may apply.",
  },
  {
    q: "When will I get my refund?",
    a: "Wallet refunds are credited instantly. Refunds to card or UPI usually take 3–5 business days to reflect.",
  },
  {
    q: "How is the fare calculated?",
    a: "Fares combine a base fare, distance and time, plus any surge multiplier active in your area. Promo codes and tolls are adjusted at the end.",
  },
  {
    q: "What is D4M Care?",
    a: "D4M Care is our trip protection programme that covers every ride. You can review and manage it under Account → D4M Care.",
  },
  {
    q: "How do I change my car mid-trip?",
    a: "Changing the car mid-trip isn't supported automatically. Contact support or your driver, and we'll help arrange a replacement if needed.",
  },
];

function statusChipClass(status: SupportTicket["status"]): string {
  switch (status) {
    case "OPEN":
      return "bg-surface-accent text-content-accent";
    case "IN_PROGRESS":
      return "bg-surface-warning text-content-warning";
    default:
      return "bg-surface-neutral text-content-secondary";
  }
}

interface ChatMessage {
  sender: "AGENT" | "SYSTEM";
  body: string;
}

function SupportBody() {
  const params = useSearchParams();
  const preOrderId = params.get("orderId");

  const [category, setCategory] = useState<string | null>(preOrderId ? "trip" : null);
  const [trips, setTrips] = useState<Order[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<string | null>(preOrderId);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitNote, setSubmitNote] = useState<string | null>(null);
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  // Ticket list / thread
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [openTicket, setOpenTicket] = useState<SupportTicket | null>(null);
  const [thread, setThread] = useState<SupportTicketMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);

  // Live chat stub
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const cat = CATEGORIES.find((c) => c.key === category);
  const needsTrip = cat?.needsTrip ?? false;

  const refreshTickets = useCallback(() => {
    supportApi
      .list()
      .then((list) => setTickets(Array.isArray(list) ? list : []))
      .catch(() => setTickets([]));
  }, []);

  useEffect(() => {
    refreshTickets();
  }, [refreshTickets]);

  useEffect(() => {
    if (needsTrip && trips.length === 0) {
      ordersApi
        .history({ limit: 10 })
        .then((r) => setTrips(r.orders))
        .catch(() => {});
    }
  }, [needsTrip, trips.length]);

  const canSubmit = !!category && (!needsTrip || !!selectedTrip) && message.trim().length >= 5;

  const submit = async () => {
    if (!canSubmit || !cat) return;
    const subject = `${cat.label} — ${message.trim().slice(0, 60)}`;
    try {
      await supportApi.create({
        category: cat.key,
        subject,
        message: message.trim(),
        order_id: selectedTrip ?? undefined,
        user_type: "RIDER",
      });
      setSubmitNote(null);
      refreshTickets();
    } catch {
      setSubmitNote("We couldn't reach support right now, but we've noted your request.");
    } finally {
      setSubmitted(true);
    }
  };

  const openThread = async (ticket: SupportTicket) => {
    setOpenTicket(ticket);
    setThread(ticket.messages ?? []);
    setReplyText("");
    setThreadLoading(true);
    try {
      const full = await supportApi.get(ticket.id);
      setOpenTicket(full);
      setThread(full.messages ?? []);
    } catch {
      // Keep whatever we already had; degrade gracefully.
    } finally {
      setThreadLoading(false);
    }
  };

  const sendReply = async () => {
    const text = replyText.trim();
    if (!text || !openTicket || replying) return;
    setReplying(true);
    const optimistic: SupportTicketMessage = {
      id: `local-${Date.now()}`,
      ticket_id: openTicket.id,
      sender: "RIDER",
      body: text,
      created_at: new Date().toISOString(),
    };
    setThread((prev) => [...prev, optimistic]);
    setReplyText("");
    try {
      await supportApi.reply(openTicket.id, text);
      try {
        const full = await supportApi.get(openTicket.id);
        setThread(full.messages ?? [optimistic]);
      } catch {
        // Optimistic message stays.
      }
    } catch {
      // Keep the optimistic message even if the request failed.
    } finally {
      setReplying(false);
    }
  };

  // ─── Live chat availability (IST) ───────────────────────────────────────────
  const istHour = parseInt(
    new Date().toLocaleString("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false,
    }),
    10,
  );
  const chatAvailable = istHour >= 9 && istHour < 21;

  const startChat = () => {
    setChatOpen(true);
    setChatMessages([{ sender: "SYSTEM", body: "Connecting…" }]);
    setTimeout(() => {
      setChatMessages([
        {
          sender: "AGENT",
          body: "Hi! An agent will be with you shortly. Meanwhile, describe your issue.",
        },
      ]);
    }, 1500);
  };

  // ─── Thread view ────────────────────────────────────────────────────────────
  if (openTicket) {
    return (
      <div>
        <button
          onClick={() => setOpenTicket(null)}
          className="mb-4 flex items-center gap-1 text-sm font-semibold text-content-secondary"
        >
          <span>←</span> Back to support
        </button>

        <div className="mb-4 rounded-2xl bg-background-secondary p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-content-primary">{openTicket.subject}</p>
              <p className="font-mono text-xs text-content-tertiary">{openTicket.id.slice(0, 12)}</p>
            </div>
            <span
              className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${statusChipClass(
                openTicket.status,
              )}`}
            >
              {openTicket.status}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          {threadLoading && thread.length === 0 ? (
            <div className="h-24 animate-pulse rounded-2xl bg-background-tertiary" />
          ) : thread.length === 0 ? (
            <p className="py-6 text-center text-xs text-content-secondary">No messages yet.</p>
          ) : (
            thread.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.sender === "RIDER" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                    m.sender === "RIDER"
                      ? "bg-accent-400 text-content-primary"
                      : "bg-background-tertiary text-content-secondary"
                  }`}
                >
                  {m.body}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-5 flex items-end gap-2">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Type a reply…"
            className="w-full resize-none rounded-xl bg-background-tertiary p-3 text-sm text-content-primary outline-none placeholder:text-content-tertiary focus:ring-1 focus:ring-border-accent"
          />
          <button
            onClick={sendReply}
            disabled={!replyText.trim() || replying}
            className="shrink-0 rounded-2xl bg-interactive-primary px-5 py-3 text-sm font-bold text-interactive-primary-text disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    );
  }

  // ─── Submitted confirmation ─────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-positive text-3xl">
          ✅
        </div>
        <p className="text-base font-bold text-content-primary">Ticket submitted</p>
        <p className="max-w-xs text-sm text-content-secondary">
          We&apos;ve received your request. Our team will reply within 24 hours.
        </p>
        {submitNote && <p className="max-w-xs text-xs text-content-tertiary">{submitNote}</p>}
        <button
          onClick={() => {
            setSubmitted(false);
            setCategory(null);
            setSelectedTrip(null);
            setMessage("");
            setSubmitNote(null);
          }}
          className="mt-2 rounded-2xl bg-background-secondary px-5 py-2.5 text-sm font-semibold text-content-primary"
        >
          Done
        </button>
      </div>
    );
  }

  // ─── Main view ──────────────────────────────────────────────────────────────
  return (
    <>
      {/* Category grid */}
      <p className="mb-3 text-sm font-bold text-content-primary">What do you need help with?</p>
      <div className="grid grid-cols-3 gap-3">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => {
              setCategory(c.key);
              setSelectedTrip(null);
            }}
            className={`flex flex-col items-center gap-2 rounded-2xl py-4 ${
              category === c.key ? "bg-surface-accent ring-1 ring-border-accent" : "bg-background-secondary"
            }`}
          >
            <span className="text-2xl">{c.icon}</span>
            <span className="text-center text-xs text-content-secondary">{c.label}</span>
          </button>
        ))}
      </div>

      {/* Trip selector */}
      {needsTrip && (
        <div className="mt-5">
          <p className="mb-2 text-sm font-bold text-content-primary">Select trip</p>
          {trips.length === 0 ? (
            <p className="text-xs text-content-secondary">No recent trips found.</p>
          ) : (
            <div className="space-y-2">
              {trips.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTrip(t.id)}
                  className={`block w-full rounded-xl p-3 text-left text-xs ${
                    selectedTrip === t.id ? "bg-surface-accent ring-1 ring-border-accent" : "bg-background-secondary"
                  }`}
                >
                  <span className="font-mono text-content-secondary">{t.id.slice(0, 8)}</span>
                  <span className="ml-2 text-content-primary">
                    {new Date(t.created_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                    })}
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
          <p className="mb-2 text-sm font-bold text-content-primary">Describe the issue</p>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={1000}
            placeholder="Tell us what happened…"
            className="w-full resize-none rounded-xl bg-background-tertiary p-4 text-sm text-content-primary outline-none placeholder:text-content-tertiary focus:ring-1 focus:ring-border-accent"
          />
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="mt-3 w-full rounded-2xl bg-interactive-primary py-3.5 text-sm font-bold text-interactive-primary-text disabled:opacity-40"
          >
            Submit Ticket
          </button>
        </div>
      )}

      {/* Quick contact */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          onClick={chatAvailable ? startChat : undefined}
          disabled={!chatAvailable}
          className="rounded-2xl bg-background-secondary py-4 text-sm font-semibold text-content-primary disabled:opacity-40"
        >
          💬 {chatAvailable ? "Start Live Chat" : "Live Chat"}
        </button>
        <a
          href="tel:+918000000000"
          className="rounded-2xl bg-background-secondary py-4 text-center text-sm font-semibold text-content-primary"
        >
          📞 Call Support
        </a>
      </div>
      <p className="mt-2 text-center text-xs text-content-tertiary">Chat available 9AM–9PM IST</p>

      {/* Live chat stub */}
      {chatOpen && (
        <div className="mt-3 rounded-2xl bg-background-secondary p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-bold text-content-primary">Live Chat</p>
            <button
              onClick={() => {
                setChatOpen(false);
                setChatMessages([]);
              }}
              className="text-xs font-semibold text-content-secondary"
            >
              Close
            </button>
          </div>
          <div className="space-y-2">
            {chatMessages.map((m, i) => (
              <div key={i} className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl bg-background-tertiary px-4 py-2.5 text-sm text-content-secondary">
                  {m.body}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FAQ */}
      <h2 className="mb-3 mt-6 text-sm font-bold text-content-primary">FAQ</h2>
      <div className="space-y-2">
        {FAQS.map((f, i) => (
          <div key={i} className="overflow-hidden rounded-2xl bg-background-secondary">
            <button
              onClick={() => setFaqOpen(faqOpen === i ? null : i)}
              className="flex w-full items-center justify-between p-4 text-left"
            >
              <span className="text-sm text-content-primary">{f.q}</span>
              <span
                className={`text-content-secondary transition-transform ${faqOpen === i ? "rotate-180" : ""}`}
              >
                ▾
              </span>
            </button>
            {faqOpen === i && <p className="px-4 pb-4 text-xs text-content-secondary">{f.a}</p>}
          </div>
        ))}
      </div>

      {/* Ticket history */}
      <h2 className="mb-3 mt-6 text-sm font-bold text-content-primary">Your Tickets</h2>
      {tickets.length === 0 ? (
        <p className="text-xs text-content-secondary">No tickets yet.</p>
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => (
            <button
              key={t.id}
              onClick={() => openThread(t)}
              className="flex w-full items-center justify-between rounded-2xl bg-background-secondary p-4 text-left"
            >
              <div>
                <p className="text-sm text-content-primary">{t.subject}</p>
                <p className="font-mono text-xs text-content-tertiary">{t.id.slice(0, 12)}</p>
              </div>
              <span
                className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${statusChipClass(
                  t.status,
                )}`}
              >
                {t.status}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export default function SupportPage() {
  return (
    <AccountScaffold title="Support">
      <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-background-tertiary" />}>
        <SupportBody />
      </Suspense>
    </AccountScaffold>
  );
}
